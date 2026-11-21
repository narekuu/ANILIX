/* ANILIX — global navigation mount
   Mounted on <html>, outside <body>, so body page-transition transforms
   cannot turn position:fixed into a page-relative element. */
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
