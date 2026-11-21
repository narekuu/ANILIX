/* ANILIX shared page transition controller */
(() => {
  "use strict";
  const root = document.documentElement;
  const duration = 420;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (reducedMotion.matches) {
    root.classList.remove("is-entering", "is-ready", "is-leaving");
  } else {
    root.classList.add("is-entering");
    window.addEventListener("DOMContentLoaded", () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => root.classList.add("is-ready"));
        window.setTimeout(() => root.classList.remove("is-entering", "is-ready"), duration + 40);
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
      reducedMotion.matches ||
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
    if (
      destination.pathname === window.location.pathname &&
      destination.search === window.location.search
    ) return;

    event.preventDefault();
    root.classList.remove("is-entering", "is-ready");
    root.classList.add("is-leaving");
    window.setTimeout(() => window.location.assign(destination.href), duration);
  });

  window.addEventListener("pageshow", event => {
    if (event.persisted) root.classList.remove("is-entering", "is-ready", "is-leaving");
  });
})();
