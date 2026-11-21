/* ANILIX shared page transition controller */
(() => {
  "use strict";

  const root = document.documentElement;
  const duration = 460;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let navigationStarted = false;

  if (reducedMotion.matches) {
    root.classList.remove("is-entering", "is-ready", "is-leaving");
  } else {
    root.classList.add("is-entering");
    window.addEventListener("DOMContentLoaded", () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => root.classList.add("is-ready"));
        window.setTimeout(() => {
          root.classList.remove("is-entering", "is-ready");
        }, duration + 80);
      });
    }, { once: true });
  }

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target && target.closest("a[href]");
    if (!link || event.defaultPrevented) return;

    if (
      event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      link.target === "_blank" ||
      link.hasAttribute("download") ||
      link.hasAttribute("data-no-transition")
    ) return;

    const rawHref = link.getAttribute("href");
    if (!rawHref || /^(#|javascript:|mailto:|tel:)/i.test(rawHref.trim())) return;

    let destination;
    try { destination = new URL(link.href, window.location.href); }
    catch { return; }

    if (destination.origin !== window.location.origin) return;

    // Same page / active navigation item: cancel the browser's reload.
    // Hash-only links remain native so in-page anchors still work.
    const sameDocument =
      destination.pathname === window.location.pathname &&
      destination.search === window.location.search;

    if (sameDocument && destination.hash === window.location.hash) {
      event.preventDefault();
      return;
    }
    if (sameDocument && destination.hash !== window.location.hash) return;

    if (reducedMotion.matches || navigationStarted) return;

    event.preventDefault();
    navigationStarted = true;
    root.classList.remove("is-entering", "is-ready");
    root.classList.add("is-leaving");

    // Ignore additional taps while the outgoing transition is running.
    document.addEventListener("click", stopRepeatedNavigation, true);

    window.setTimeout(() => {
      window.location.assign(destination.href);
    }, duration);
  });

  function stopRepeatedNavigation(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest("a[href]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  window.addEventListener("pageshow", event => {
    navigationStarted = false;
    document.removeEventListener("click", stopRepeatedNavigation, true);
    if (event.persisted) {
      root.classList.remove("is-entering", "is-ready", "is-leaving");
    }
  });
})();
