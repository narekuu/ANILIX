
/* ANILIX SKELETON CONTROLLER */

(() => {
    "use strict";

    const ANILIXSkeleton = {
        show(target) {
            const elements = typeof target === "string"
                ? document.querySelectorAll(target)
                : target instanceof Element
                    ? [target]
                    : target;

            elements?.forEach?.(element => {
                element.classList.add("is-loading");
            });
        },

        hide(target) {
            const elements = typeof target === "string"
                ? document.querySelectorAll(target)
                : target instanceof Element
                    ? [target]
                    : target;

            elements?.forEach?.(element => {
                element.classList.remove("is-loading");
            });
        },

        hideAll() {
            document.querySelectorAll(
                ".is-loading, .anilix-skeleton"
            ).forEach(element => {
                element.classList.remove(
                    "is-loading",
                    "anilix-skeleton"
                );
            });
        }
    };

    window.ANILIXSkeleton = ANILIXSkeleton;

    // Aktifkan skeleton untuk elemen yang ditandai.
    function initializeSkeletons(root = document) {
        root.querySelectorAll?.("[data-skeleton]").forEach(element => {
            if (element.dataset.skeleton !== "false") {
                element.classList.add("is-loading");
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            () => initializeSkeletons(),
            { once: true }
        );
    } else {
        initializeSkeletons();
    }

    // Mendukung elemen baru yang dibuat secara dinamis.
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    if (node.matches?.("[data-skeleton]")) {
                        if (node.dataset.skeleton !== "false") {
                            node.classList.add("is-loading");
                        }
                    }

                    initializeSkeletons(node);
                }
            });
        });
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
})();
