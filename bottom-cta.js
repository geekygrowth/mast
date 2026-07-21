(function () {
  "use strict";

  const STORAGE_KEY = "bottomCtaDismissed";

  function initializeBottomCta() {
    const banner = document.querySelector("[data-bottom-cta-component]");

    if (!banner) {
      return;
    }

    let isDismissed = false;

    try {
      isDismissed = sessionStorage.getItem(STORAGE_KEY) === "true";
    } catch (e) {
      isDismissed = false;
    }

    if (isDismissed) {
      return;
    }

    const exitBtn = banner.querySelector("[data-bottom-cta-exit]");
    const seconds = parseFloat(banner.getAttribute("data-bottom-cta-seconds")) || 0;

    const timer = setTimeout(() => {
      banner.classList.add("cc-active");
    }, seconds * 1000);

    if (exitBtn) {
      exitBtn.addEventListener("click", () => {
        clearTimeout(timer);
        banner.classList.remove("cc-active");

        try {
          sessionStorage.setItem(STORAGE_KEY, "true");
        } catch (e) {
          // sessionStorage unavailable (e.g. private mode) — fail silently,
          // banner just won't persist dismissal across page loads this session
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeBottomCta);
  } else {
    initializeBottomCta();
  }
})();