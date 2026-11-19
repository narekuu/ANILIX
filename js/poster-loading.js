
/* ANILIX POSTER LOADING CONTROLLER */

(() => {
    "use strict";

    const POSTER_SELECTOR = [
        "img[data-poster]",
        ".poster img",
        ".poster-card img",
        ".anime-card img",
        ".anime-poster img",
        ".movie-poster img",
        ".donghua-card img"
    ].join(",");

    function preparePoster(img) {
        if (!(img instanceof HTMLImageElement)) return;

        if (img.dataset.posterReady === "true") return;
        img.dataset.posterReady = "true";

        let wrapper = img.parentElement;

        if (!wrapper?.classList.contains("anilix-poster-media")) {
            const computed = getComputedStyle(img);

            let ratio = 2 / 3;

            if (computed.aspectRatio !== "auto") {
                const parts = computed.aspectRatio.split("/");
                const width = parseFloat(parts[0]);
                const height = parseFloat(parts[1]);

                if (width > 0 && height > 0) {
                    ratio = width / height;
                }
            } else if (
                img.width > 0 &&
                img.height > 0
            ) {
                ratio = img.width / img.height;
            }

            wrapper = document.createElement("span");
            wrapper.className = "anilix-poster-media";
            wrapper.style.aspectRatio = String(ratio);
            wrapper.style.borderRadius = computed.borderRadius;

            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
        }

        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = img.style.objectFit || "cover";

        wrapper.classList.remove("is-loaded", "is-error");

        const loaded = () => {
            wrapper.classList.remove("is-error");
            wrapper.classList.add("is-loaded");
        };

        const failed = () => {
            wrapper.classList.remove("is-loaded");
            wrapper.classList.add("is-error");
        };

        img.addEventListener("load", loaded, { once: true });
        img.addEventListener("error", failed, { once: true });

        // Menangani gambar dari cache browser.
        if (img.complete) {
            if (img.naturalWidth > 0) {
                loaded();
            } else if (img.currentSrc || img.src) {
                failed();
            }
        }
    }

    function scanPosters(root = document) {
        if (root instanceof HTMLImageElement) {
            if (root.matches(POSTER_SELECTOR)) {
                preparePoster(root);
            }
        }

        root.querySelectorAll?.(POSTER_SELECTOR).forEach(preparePoster);
    }

    function start() {
        scanPosters();

        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.type === "childList") {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            scanPosters(node);
                        }
                    });
                }

                if (
                    mutation.type === "attributes" &&
                    mutation.target instanceof HTMLImageElement
                ) {
                    const img = mutation.target;

                    if (img.matches(POSTER_SELECTOR)) {
                        img.dataset.posterReady = "";
                        preparePoster(img);
                    }
                }
            });
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "srcset"]
        });

        window.ANILIXPosterLoading = {
            refresh: scanPosters
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, {
            once: true
        });
    } else {
        start();
    }
})();
