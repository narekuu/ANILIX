async function loadBottomNavigation() {
  const nav = document.getElementById("bottomNav");
  if (!nav) return;

  try {
    // JSON selalu berada di root project, baik halaman dibuka dari / maupun /public/.
    const response = await fetch("/json/navigation.json");
    if (!response.ok) throw new Error("Gagal memuat navigation.json");

    const config = await response.json();
    const items = Array.isArray(config.navigation) ? config.navigation : [];
    const inPublic = location.pathname.startsWith("/public/");
    const currentPage = location.pathname.split("/").pop() || "index.html";

    nav.innerHTML = items.map(item => {
      const isHome = item.id === "home" || item.href === "/";
      const href = isHome ? "/" : (inPublic ? item.href : `/public/${item.href}`);
      const active = isHome
        ? location.pathname === "/" || location.pathname.endsWith("/index.html")
        : item.href === currentPage;

      return `
        <a href="${href}" class="nav-item${active ? " active" : ""}"
           data-nav-id="${item.id}" ${active ? 'aria-current="page"' : ""}>
          ${item.icon}
          <span>${item.label}</span>
        </a>`;
    }).join("");
  } catch (error) {
    console.error("ANILIX Navigation Error:", error);
  }
}

loadBottomNavigation();
