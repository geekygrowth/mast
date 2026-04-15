(function () {
  "use strict";

  // Early exit if no accordion elements exist on the page
  function initializeAccordions() {
    const detailsElements = document.querySelectorAll("details");

    // Performance optimization: exit early if no accordions present
    if (detailsElements.length === 0) {
      return;
    }

    // Modern browsers (Chrome 131+, Safari 17.6+) wrap <details> content in a
    // ::details-content pseudo with content-visibility:hidden when [open] is
    // removed — inline styles on the child can't override it. This rule keeps
    // the pseudo visible while we animate a sibling closed.
    const style = document.createElement("style");
    style.textContent = "details[data-accordion-animating]::details-content{content-visibility:visible!important;display:block!important;}";
    document.head.appendChild(style);

    // Reduced motion preference
    let prefersReducedMotion = false;
    let reducedMotionQuery = null;

    try {
      reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      prefersReducedMotion = reducedMotionQuery.matches;

      reducedMotionQuery.addEventListener("change", (e) => {
        prefersReducedMotion = e.matches;
      });
    } catch (e) {
      prefersReducedMotion = false;
    }

    // Handle open attribute based on data-accordion-start-open value
    document.querySelectorAll("details[open]").forEach((details) => {
      const startOpen = details.getAttribute("data-accordion-start-open");

      if (startOpen === "true") {
        return;
      } else {
        details.removeAttribute("open");
      }
    });

    // Process each accordion
    detailsElements.forEach((details) => {
      const summary = details.querySelector("summary");
      const content = details.querySelector("[data-accordion='content']");

      if (!summary || !content) {
        return;
      }

      // Set initial collapsed state
      const startOpen = details.getAttribute("data-accordion-start-open");
      if (startOpen !== "true") {
        if (typeof gsap !== "undefined") {
          gsap.set(content, { height: 0, overflow: "clip" });
        } else {
          content.style.height = "0px";
          content.style.overflow = "clip";
        }
      }

      summary.addEventListener("click", (event) => {
        const isClosing = details.hasAttribute("open");

        if (isClosing) {
          event.preventDefault();

          if (prefersReducedMotion) {
            details.removeAttribute("open");
          } else {
            // Animate closing
            content.style.height = `${content.scrollHeight}px`;
            content.offsetHeight; // force reflow

            if (typeof gsap !== "undefined") {
              gsap.killTweensOf(content);
              gsap.to(content, {
                height: 0,
                duration: 0.4,
                ease: "power3.inOut",
                onComplete: () => {
                  details.removeAttribute("open");
                },
              });
            } else {
              content.style.transition = "height 0.4s ease-in-out";
              content.style.height = "0px";
              setTimeout(() => {
                details.removeAttribute("open");
                content.style.transition = "";
              }, 400);
            }
          }
        } else {
          // When this <details> is part of an exclusive name="..." group, the
          // browser will instantly close any open sibling in the same tick.
          // Animate the sibling closed ourselves before that happens.
          const groupName = details.getAttribute("name");
          if (groupName && !prefersReducedMotion) {
            const siblings = document.querySelectorAll(`details[name="${groupName}"][open]`);

            siblings.forEach((sib) => {
              if (sib === details) return;
              const sibContent = sib.querySelector("[data-accordion='content']");
              if (!sibContent) return;

              if (typeof gsap !== "undefined") {
                gsap.killTweensOf(sibContent);
              }

              sibContent.style.height = `${sibContent.scrollHeight}px`;
              sibContent.style.overflow = "clip";
              sibContent.style.display = "block";

              // Activates the injected ::details-content CSS rule above.
              sib.dataset.accordionAnimating = "closing";

              // Force a reflow then start the tween SYNCHRONOUSLY. Between this
              // handler returning and the next frame, the browser will remove
              // [open] from the sibling — by the time rAF fires the content's
              // natural size has already resolved to 0 and the tween would be
              // invisible.
              void sibContent.offsetHeight;

              if (typeof gsap !== "undefined") {
                gsap.to(sibContent, {
                  height: 0,
                  duration: 0.4,
                  ease: "power3.inOut",
                  onComplete: () => {
                    delete sib.dataset.accordionAnimating;
                    sibContent.style.height = "0px";
                    sibContent.style.display = "";
                  },
                });
              } else {
                sibContent.style.transition = "height 0.4s ease-in-out";
                sibContent.style.height = "0px";
                setTimeout(() => {
                  delete sib.dataset.accordionAnimating;
                  sibContent.style.transition = "";
                  sibContent.style.display = "";
                }, 400);
              }
            });
          }
        }
      });

      // Animate opening on toggle
      details.addEventListener("toggle", () => {
        if (details.open) {
          const fullHeight = content.scrollHeight;

          if (prefersReducedMotion) {
            content.style.height = "auto";
          } else {
            if (typeof gsap !== "undefined") {
              gsap.killTweensOf(content);
              gsap.to(content, {
                height: fullHeight,
                duration: 0.4,
                ease: "power3.out",
                onComplete: () => {
                  content.style.height = "auto";
                },
              });
            } else {
              content.style.transition = "height 0.4s ease-out";
              content.style.height = `${fullHeight}px`;
              setTimeout(() => {
                content.style.height = "auto";
                content.style.transition = "";
              }, 400);
            }
          }
        }
      });
    });
  }

  // Initialize on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeAccordions);
  } else {
    initializeAccordions();
  }
})();
