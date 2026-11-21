/* ANILIX shared navigation.
   Mount outside <body> so body transforms used by page transitions
   cannot capture the fixed-position navigation. */
(() => {
  "use strict";
  const scriptURL = document.currentScript && document.currentScript.src;
  const configURL = new URL("./navigation.json", scriptURL || location.href);

  let nav = document.getElementById("anilixBottomNav");
  if (!nav) {
    nav = document.createElement("nav");
    nav.id = "anilixBottomNav";
    nav.className = "bottom-nav";
    nav.setAttribute("aria-label", "Navigasi utama");
    document.documentElement.appendChild(nav);
  }

  // The active destination is already open; do not reload it on repeated taps.
  nav.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target && target.closest("a.nav-item[aria-current='page']");
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  async function renderNavigation() {
    try {
      const response = await fetch(configURL, { cache: "no-cache" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const config = await response.json();
      const items = Array.isArray(config.navigation) ? config.navigation : [];
      const path = location.pathname;
      const currentPage = path.split("/").pop() || "index.html";

      nav.innerHTML = items.map(item => {
        const href = item.href === "/" ? "/" : "/" + String(item.href || "").replace(/^\/+/, "");
        const active = item.href === "/"
          ? path === "/" || currentPage === "index.html"
          : currentPage === String(item.href).split("/").pop();
        return '<a class="nav-item' + (active ? ' active' : '') +
          '" href="' + href + '" data-nav-id="' + item.id + '"' +
          (active ? ' aria-current="page"' : '') + '>' +
          item.icon + '<span>' + item.label + '</span></a>';
      }).join("");
    } catch (error) {
      console.error("[ANILIX navigation]", error);
    }
  }
  renderNavigation();
})();
