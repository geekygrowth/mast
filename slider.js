(function () {
  "use strict";

  // Early exit if Swiper is not available
  if (typeof Swiper === "undefined") {
    return;
  }

  function initializeSwipers() {
    const swiperElements = document.querySelectorAll('[data-slider="slider"]');

    // Gracefully exit if no sliders found
    if (swiperElements.length === 0) {
      return;
    }

    // Initialize each swiper instance
    swiperElements.forEach((element, index) => {
      initializeSwiper(element, index);
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeSwipers);
  } else {
    initializeSwipers();
  }

  // Handle viewport resize with debouncing - only for width changes
  let resizeTimeout;
  let lastWidth = window.innerWidth;

  function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const currentWidth = window.innerWidth;

      // Only reinitialize if width changed (ignore iOS Safari chrome height changes)
      if (currentWidth !== lastWidth) {
        lastWidth = currentWidth;

        if (window.AttributesSwiper && window.AttributesSwiper.reinitialize) {
          window.AttributesSwiper.reinitialize();
        }
      }
    }, 250); // 250ms debounce delay
  }

  // Add resize listener
  window.addEventListener("resize", handleResize);

  function initializeSwiper(element, index) {
    try {
      // Process Webflow CMS collection lists before initialization
      processWebflowCMSLists(element);

      // Get configuration from data attributes
      const config = getSwiperConfig(element);

      // Initialize Swiper
      const swiper = new Swiper(element, config);

      // Store reference for potential future access
      element.swiperInstance = swiper;

      // Add height calculation and update mechanism
      setupHeightCalculation(element, swiper);
    } catch (error) {
      // Silently handle errors in production
      if (typeof console !== "undefined" && console.error) {
        console.error("Swiper initialization failed:", error);
      }
    }
  }

  function setupHeightCalculation(element, swiper) {
    // Function to calculate and set the proper height
    function updateSliderHeight() {
      const slides = element.querySelectorAll('.swiper-slide');
      if (slides.length === 0) return;

      let maxHeight = 0;
      
      // Calculate the maximum height among visible slides
      slides.forEach(slide => {
        // Reset any inline height styles to get natural height
        slide.style.height = 'auto';
        const slideHeight = slide.offsetHeight;
        if (slideHeight > maxHeight) {
          maxHeight = slideHeight;
        }
      });

      // Set the calculated height to the swiper container
      if (maxHeight > 0) {
        element.style.height = maxHeight + 'px';
      }
    }

    // Initial height calculation
    updateSliderHeight();

    // Update height on slide change (both drag and navigation)
    swiper.on('slideChange', updateSliderHeight);
    swiper.on('slideChangeTransitionEnd', updateSliderHeight);
    
    // Update height on touch end (when dragging stops)
    swiper.on('touchEnd', updateSliderHeight);
    
    // Update height on resize
    swiper.on('resize', updateSliderHeight);
  }

  function processWebflowCMSLists(element) {
    // Find and process Webflow CMS collection list elements
    const webflowSelectors = [".w-dyn-list", ".w-dyn-items", ".w-dyn-item"];

    webflowSelectors.forEach((selector) => {
      const webflowElements = element.querySelectorAll(selector);

      webflowElements.forEach((webflowElement) => {
        // Get all child nodes (including text nodes and elements)
        const children = Array.from(webflowElement.childNodes);

        // Insert children before the webflow element
        children.forEach((child) => {
          webflowElement.parentNode.insertBefore(child, webflowElement);
        });

        // Remove the now-empty webflow wrapper element
        webflowElement.remove();
      });
    });
  }

  function getSwiperConfig(element) {
    // Get computed styles to read CSS variables for proper slide calculation
    const computedStyle = getComputedStyle(element);
    const xs = parseFloat(computedStyle.getPropertyValue("--xs").trim()) || 1;
    const sm = parseFloat(computedStyle.getPropertyValue("--sm").trim()) || 1;
    const md = parseFloat(computedStyle.getPropertyValue("--md").trim()) || 2;
    const lg = parseFloat(computedStyle.getPropertyValue("--lg").trim()) || 3;
    const spaceBetween =
      parseInt(computedStyle.getPropertyValue("--gap").trim()) || 24;

    // Base configuration - sync with CSS-controlled layout
    const config = {
      // Use breakpoints that match our CSS exactly
      breakpoints: {
        0: { slidesPerView: xs, spaceBetween: spaceBetween },
        480: { slidesPerView: sm, spaceBetween: spaceBetween },
        768: { slidesPerView: md, spaceBetween: spaceBetween },
        992: { slidesPerView: lg, spaceBetween: spaceBetween },
      },
      watchSlidesProgress: true,
      simulateTouch: true,
      allowTouchMove: true,
      keyboard: { enabled: true, onlyInViewport: true },
      a11y: { enabled: true },
      // Better handling for decimal slidesPerView values
      watchOverflow: true,
      normalizeSlideIndex: false,
      roundLengths: false,
    };

    // Configure grab cursor (default: true, can be disabled for clickable content)
    const grabCursor = element.dataset.grabCursor;
    if (grabCursor === "false") {
      config.grabCursor = false;
    } else {
      config.grabCursor = true;
    }

    // Find the parent component wrapper
    const componentWrapper = element.closest('[data-slider="component"]');

    // Configure navigation if elements exist
    const nextEl = componentWrapper.querySelector('[data-slider="next"]');
    const prevEl = componentWrapper.querySelector('[data-slider="previous"]');

    if (nextEl && prevEl) {
      config.navigation = { nextEl, prevEl };
    }

    // Configure pagination if element exists
    const paginationEl = componentWrapper.querySelector(
      '[data-slider="pagination"]'
    );

    if (paginationEl) {
      config.pagination = {
        el: paginationEl,
        clickable: true,
        bulletElement: "button",
        bulletClass: "slider-pagination_button",
        bulletActiveClass: "cc-active",
      };
    }

    // Configure loop if requested
    if (element.dataset.loop === "true") {
      config.loop = true;
      config.loopFillGroupWithBlank = true;

      // Configure loopAdditionalSlides if specified
      const loopAdditionalSlides = element.dataset.loopAdditionalSlides;
      if (loopAdditionalSlides && !isNaN(loopAdditionalSlides)) {
        config.loopAdditionalSlides = parseInt(loopAdditionalSlides);
      }
    }

    // Configure autoplay if requested
    const autoplayDelay = element.dataset.autoplay;
    if (autoplayDelay && autoplayDelay !== "false" && !isNaN(autoplayDelay)) {
      config.autoplay = {
        delay: parseInt(autoplayDelay),
        disableOnInteraction: false,
        pauseOnMouseEnter: true,
      };
    }

    // Configure centered slides if requested
    if (element.dataset.centered === "true") {
      config.centeredSlides = true;
      config.centeredSlidesBounds = true;
    }

    // Configure fade effect if specified
  if (element.dataset.effect === "fade") {
    config.effect = "fade";
    config.fadeEffect = { crossFade: true };
  } else if (element.dataset.effect === "cards") {
    config.effect = "cards";
    config.cardsEffect = {
      slideShadows: true,
      rotate: true,
      perSlideRotate: 2,
      perSlideOffset: 8,
  };
}

    // Configure speed if specified
    const speed = element.dataset.speed;
    if (speed && !isNaN(speed)) {
      config.speed = parseInt(speed);
    }

    return config;
  }

  // Utility functions for external use
  window.AttributesSwiper = {
    // Reinitialize all swipers (useful for dynamic content)
    reinitialize: function () {
      if (typeof Swiper === "undefined") return;

      const swiperElements = document.querySelectorAll(
        '[data-slider="slider"]'
      );
      swiperElements.forEach((element) => {
        if (element.swiperInstance) {
          element.swiperInstance.destroy(true, true);
        }
      });

      setTimeout(() => {
        swiperElements.forEach((element, index) => {
          initializeSwiper(element, index);
        });
      }, 50);
    },

    // Get a specific swiper instance
    getInstance: function (index) {
      const swiperElements = document.querySelectorAll(
        '[data-slider="slider"]'
      );
      if (swiperElements[index] && swiperElements[index].swiperInstance) {
        return swiperElements[index].swiperInstance;
      }
      return null;
    },
  };
})();
