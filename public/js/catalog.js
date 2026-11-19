/* =========================================
   ANILIX CATALOG — SANKA API
   Anime dan Donghua menggunakan data live.
   Halaman tanpa endpoint terverifikasi
   menampilkan pesan, bukan data demo.
========================================= */
(function () {
  "use strict";

  const PAGE_TYPE = document.body.dataset.page || "anime";
  const PAGE_CONFIG = {
    anime: {
      title: "Anime",
      subtitle: "Temukan berbagai anime favoritmu."
    },
    donghua: {
      title: "Donghua",
      subtitle: "Jelajahi koleksi donghua terbaru."
    },
    movie: {
      title: "Movie",
      subtitle: "Koleksi film."
    },
    rekomendasi: {
      title: "Rekomendasi",
      subtitle: "Pilihan tontonan."
    },
    kategori: {
      title: "Kategori",
      subtitle: "Jelajahi tontonan berdasarkan genre."
    }
  };

  const config = PAGE_CONFIG[PAGE_TYPE] || PAGE_CONFIG.anime;
  const pageTitle = document.getElementById("pageTitle");
  const pageSubtitle = document.getElementById("pageSubtitle");
  const grid = document.getElementById("posterGrid");
  const loading = document.getElementById("loading");
  const emptyState = document.getElementById("emptyState");
  const resultCount = document.getElementById("resultCount");
  const sentinel = document.getElementById("scrollSentinel");

  if (pageTitle) pageTitle.textContent = config.title;
  if (pageSubtitle) pageSubtitle.textContent = config.subtitle;

  let allItems = [];
  let filteredItems = [];
  let activeStatus = "Semua";
  let loadedCount = 0;
  let isLoading = false;

  const BATCH_SIZE = 30;

  function showMessage(message) {
    if (emptyState) {
      emptyState.textContent = message;
      emptyState.classList.add("show");
    }
    if (resultCount) resultCount.textContent = "0 koleksi";
    if (loading) loading.classList.remove("show");
  }

  function normalizeStatus(value, defaultStatus) {
    const status = String(value || defaultStatus || "").trim().toLowerCase();

    if (["new", "baru", "latest", "upcoming"].includes(status)) return "New";
    if (["ongoing", "airing", "currently airing", "berjalan"].includes(status)) return "Ongoing";
    if (["completed", "complete", "finished", "tamat", "selesai"].includes(status)) return "Completed";

    return value || defaultStatus || "";
  }

  function normalizeAnime(item) {
    return {
      id: item.animeId ?? item.id ?? item.slug ?? "",
      title: item.title ?? item.name ?? "",
      type: "anime",
      status: normalizeStatus(item.status, "Ongoing"),
      image: item.poster ?? item.image ?? "",
      episode: item.episodes ? `EP ${item.episodes}` : "",
      date: item.latestReleaseDate ?? item.lastReleaseDate ?? "",
      score: item.score ?? null,
      genre: []
    };
  }

  function normalizeDonghua(item) {
    return {
      id: item.slug ?? item.id ?? "",
      title: item.title ?? "",
      type: "donghua",
      status: normalizeStatus(item.status, ""),
      image: item.poster ?? item.image ?? "",
      episode: item.current_episode
        ? item.current_episode
        : item.episodes
          ? `EP ${item.episodes}`
          : "",
      date: item.latestReleaseDate ?? item.date ?? "",
      score: null,
      genre: []
    };
  }

  async function loadCatalogData() {
    if (!window.SankaAPI || typeof window.SankaAPI.getCatalog !== "function") {
      throw new Error("Sanka API Manager belum dimuat.");
    }

    if (PAGE_TYPE === "anime") {
      const response = await window.SankaAPI.getCatalog("/anime/ongoing-anime?page=1");

      if (!response.data || !Array.isArray(response.data.animeList)) {
        throw new Error("Format daftar anime dari Sanka tidak sesuai.");
      }

      return response.data.animeList
        .map(normalizeAnime)
        .filter(item => item.id && item.title);
    }

    if (PAGE_TYPE === "donghua") {
      // Request bergantian; limiter SankaAPI mengatur jeda minimal.
      const ongoingResponse = await window.SankaAPI.getCatalog(
        "/anime/donghua/ongoing/1"
      );

      const completedResponse = await window.SankaAPI.getCatalog(
        "/anime/donghua/completed/1"
      );

      const latestResponse = await window.SankaAPI.getCatalog(
        "/anime/donghua/latest/1"
      );

      const ongoing = Array.isArray(ongoingResponse.ongoing_donghua)
        ? ongoingResponse.ongoing_donghua
        : [];

      const completed = Array.isArray(completedResponse.completed_donghua)
        ? completedResponse.completed_donghua
        : [];

      const latest = Array.isArray(latestResponse.latest_donghua)
        ? latestResponse.latest_donghua
        : [];

      const unique = new Map();

      function addItems(items) {
        items.forEach(item => {
          const normalized = normalizeDonghua(item);

          if (normalized.id && normalized.title) {
            unique.set(normalized.id, normalized);
          }
        });
      }

      // Urutan prioritas: completed, ongoing, lalu latest.
      addItems(completed);
      addItems(ongoing);
      addItems(latest);

      if (unique.size === 0) {
        throw new Error("Sanka tidak mengirim daftar Donghua.");
      }

      return [...unique.values()];
    }

    throw new Error("Sumber data untuk halaman ini belum dikonfigurasi.");
  }

  function createFilterTabs() {
    const container = document.getElementById("statusFilters");
    if (!container) return;

    const statuses = ["Semua", "New", "Ongoing", "Completed"];

    container.innerHTML = statuses.map((status, index) =>
      `<button class="filter-tab ${index === 0 ? "active" : ""}" data-value="${status}">${status}</button>`
    ).join("");

    container.querySelectorAll(".filter-tab").forEach(button => {
      button.addEventListener("click", () => {
        container.querySelectorAll(".filter-tab").forEach(tab => {
          tab.classList.remove("active");
        });

        button.classList.add("active");
        activeStatus = button.dataset.value;
        applyFilters();
      });
    });
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  // Poster alternatif khusus katalog Donghua.
  let DONGHUA_POSTER_FALLBACKS = {};

  async function loadDonghuaPosterFallbacks() {
    if (PAGE_TYPE !== "donghua") return;

    try {
      const response = await fetch("data/donghua-posters.json", {
        cache: "no-cache"
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const data = await response.json();
      if (data && typeof data === "object" && !Array.isArray(data)) {
        DONGHUA_POSTER_FALLBACKS = data;
      }
    } catch (error) {
      console.warn("Daftar poster alternatif tidak dapat dimuat:", error);
    }
  }

  function createPoster(item) {
    const posterEntry = item.type === "donghua"
      ? DONGHUA_POSTER_FALLBACKS[String(item.id)]
      : null;

    const fallbackList = posterEntry && Array.isArray(posterEntry.posters)
      ? posterEntry.posters.filter(url => typeof url === "string" && url.trim())
      : [];

    const originalImage = item.image || "";
    const imageList = [...new Set([originalImage, ...fallbackList].filter(Boolean))];

    const imageMarkup = imageList.length
      ? `<img
          src="${escapeHTML(imageList[0])}"
          data-image-list="${escapeHTML(JSON.stringify(imageList))}"
          data-image-index="0"
          alt="${escapeHTML(item.title)}"
          loading="lazy"
          onerror="
            try {
              const list = JSON.parse(this.dataset.imageList || '[]');
              const next = Number(this.dataset.imageIndex || 0) + 1;
              if (next < list.length) {
                this.dataset.imageIndex = String(next);
                this.src = list[next];
              } else {
                this.style.display = 'none';
                this.parentElement.classList.add('poster-no-image');
              }
            } catch (error) {
              this.style.display = 'none';
              this.parentElement.classList.add('poster-no-image');
            }
          "
        >`
      : "";

    const score = Number(item.score);
    const scoreMarkup = item.score != null && Number.isFinite(score)
      ? `<span class="poster-score">★ ${score.toFixed(2)}</span>`
      : "";

    return `
      <a class="poster-card"
         href="detail.html?type=${encodeURIComponent(item.type)}&id=${encodeURIComponent(item.id)}">
        <div class="poster">
          ${imageMarkup}
          ${item.status ? `<span class="poster-tag">${escapeHTML(item.status)}</span>` : ""}
          ${scoreMarkup}
          ${item.episode ? `<span class="poster-status">${escapeHTML(item.episode)}</span>` : ""}
        </div>
        <div class="poster-name">${escapeHTML(item.title)}</div>
        <div class="poster-meta">${escapeHTML(item.type).toUpperCase()}</div>
      </a>
    `;
  }

  function loadNextBatch() {
    if (!grid || isLoading || loadedCount >= filteredItems.length) return;

    isLoading = true;
    if (loading) loading.classList.add("show");

    const nextItems = filteredItems.slice(
      loadedCount,
      loadedCount + BATCH_SIZE
    );

    grid.insertAdjacentHTML("beforeend", nextItems.map(createPoster).join(""));
    loadedCount += nextItems.length;

    isLoading = false;
    if (loading) loading.classList.remove("show");

    if (filteredItems.length === 0) {
      showMessage("Belum ada koleksi yang sesuai.");
    }
  }

  function applyFilters() {
    filteredItems = allItems.filter(item => {
      return activeStatus === "Semua" || item.status === activeStatus;
    });

    filteredItems.sort((a, b) => {
      return new Date(b.date || 0) - new Date(a.date || 0);
    });

    loadedCount = 0;
    isLoading = false;

    if (grid) grid.innerHTML = "";
    if (emptyState) emptyState.classList.remove("show");

    if (resultCount) {
      resultCount.textContent =
        filteredItems.length.toLocaleString("id-ID") + " koleksi";
    }

    if (filteredItems.length === 0) {
      showMessage("Belum ada data untuk filter ini.");
      return;
    }

    loadNextBatch();
  }

  async function initializeCatalog() {
    if (!grid || !emptyState) {
      console.error("Elemen katalog tidak ditemukan di halaman ini.");
      return;
    }

    if (!["anime", "donghua"].includes(PAGE_TYPE)) {
      showMessage("Data untuk halaman ini belum tersedia dari endpoint Sanka yang sudah diverifikasi.");
      return;
    }

    try {
      if (loading) loading.classList.add("show");

      createFilterTabs();

      if (PAGE_TYPE === "donghua") {
        await loadDonghuaPosterFallbacks();
      }

      allItems = await loadCatalogData();

      if (loading) loading.classList.remove("show");

      if (!allItems.length) {
        showMessage("Sanka belum mengirimkan koleksi untuk halaman ini.");
        return;
      }

      applyFilters();
    } catch (error) {
      console.error("Gagal memuat katalog Sanka:", error);
      showMessage(error.message || "Gagal memuat data. Periksa koneksi lalu coba lagi.");
    }
  }

  if (sentinel && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        loadNextBatch();
      }
    }, { rootMargin: "500px" });

    observer.observe(sentinel);
  }

  const currentPage = location.pathname.split("/").pop() || "index.html";

  document.querySelectorAll(".nav-item").forEach(link => {
    link.classList.toggle(
      "active",
      link.getAttribute("href") === currentPage
    );
  });

  initializeCatalog();
})();
