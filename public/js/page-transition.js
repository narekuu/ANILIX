/* =========================================
   ANILIX PAGE TRANSITION
========================================= */

(() => {
  "use strict";

  const TRANSITION_TIME = 380;

  const currentURL = new URL(window.location.href);

  // Animasi masuk halaman
  document.documentElement.classList.add("is-entering");

  window.addEventListener("DOMContentLoaded", () => {
    requestAnimationFrame(() => {
      document.documentElement.classList.add("is-ready");

      setTimeout(() => {
        document.documentElement.classList.remove(
          "is-entering",
          "is-ready"
        );
      }, TRANSITION_TIME + 50);
    });
  });

  // Jangan mengaktifkan animasi jika pengguna mengurangi animasi
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  if (reducedMotion.matches) {
    document.documentElement.classList.remove(
      "is-entering",
      "is-ready"
    );
  }

  // Animasi ketika berpindah halaman
  document.addEventListener("click", event => {
    const link = event.target.closest("a");

    if (!link) return;

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return;

    if (reducedMotion.matches) return;

    if (
      link.target === "_blank" ||
      link.hasAttribute("download") ||
      link.getAttribute("href")?.startsWith("#")
    ) return;

    const destination = new URL(link.href, window.location.href);

    if (
      destination.origin !== currentURL.origin ||
      destination.href === currentURL.href
    ) return;

    if (
      destination.pathname === currentURL.pathname &&
      destination.search === currentURL.search &&
      destination.hash !== currentURL.hash
    ) return;

    if (
      link.hasAttribute("data-no-transition")
    ) return;

    event.preventDefault();

    document.documentElement.classList.remove(
      "is-entering",
      "is-ready"
    );

    document.documentElement.classList.add("is-leaving");

    setTimeout(() => {
      window.location.href = destination.href;
    }, TRANSITION_TIME);
  });

  // Jika halaman dikembalikan melalui tombol Back/Forward
  window.addEventListener("pageshow", event => {
    if (event.persisted) {
      document.documentElement.classList.remove(
        "is-leaving",
        "is-entering",
        "is-ready"
      );
    }
  });
})();