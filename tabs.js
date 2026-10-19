(function() {
    'use strict';

    // Early exit if no tabs components exist on the page
    const tabComponents = document.querySelectorAll('[data-tabs-component]');
    if (!tabComponents.length) {
        return;
    }

    /**
     * Initialize a single tabs component
     */
    function initTabsComponent(component) {
        const tabMenu = component.querySelector('[data-tabs-menu]');
        const dropdownMenu = component.querySelector('[data-tabs-menu-dropdown-menu]');
        const tabMenuWrapper = component.querySelector('[data-tabs-menu-wrapper]');
        const tabLinks = component.querySelectorAll('[data-tabs-link]');
        const tabPanes = component.querySelectorAll('[data-tabs-pane]');

        if (!tabMenu || !dropdownMenu || !tabMenuWrapper || !tabLinks.length || !tabPanes.length) {
            return;
        }

        // Convert NodeLists to arrays once for better performance
        const tabLinksArray = Array.from(tabLinks);
        const tabPanesArray = Array.from(tabPanes);

        // State
        let currentActiveIndex = 0;
        let dropdownToggle = tabMenu.querySelector('[data-tabs-menu-dropdown-toggle]');
        let dropdownText = dropdownToggle ? dropdownToggle.querySelector('[data-tabs-menu-dropdown-text]') : null;
        let isMobileDropdown = tabMenu.getAttribute('data-tab-mobile-dropdown') === 'true';

        // Cache autoplay toggle button
        let autoplayToggleButton = component.querySelector('[data-tabs-autoplay-toggle]');

        // Autoplay state
        let autoplayEnabled = tabMenu.getAttribute('data-tabs-autoplay') === 'true';
        let autoplayDuration = parseFloat(tabMenu.getAttribute('data-tabs-autoplay-duration')) || 5;
        let autoplayHoverPause = tabMenu.getAttribute('data-tabs-autoplay-hover-pause') === 'true';
        let autoplayTimer = null;
        let autoplayObserver = null;
        let isAutoplayPaused = false;
        let autoplayStartTime = null;
        let autoplayElapsedTime = 0;

        // Cache window width for responsive checks
        let cachedWindowWidth = window.innerWidth;
        let resizeTimer = null;

        // Event listener references for cleanup
        const eventListeners = [];

        /**
         * Set the active tab by index
         */
        function setActiveTab(index) {
            if (index < 0 || index >= tabLinksArray.length) {
                return;
            }

            // Batch DOM reads and writes to avoid layout thrashing
            const overlays = [];
            const isActiveStates = [];

            // Phase 1: Read from DOM
            for (let i = 0; i < tabLinksArray.length; i++) {
                const link = tabLinksArray[i];
                const overlay = link.querySelector('[data-tabs-link-button]');
                overlays.push(overlay);
                isActiveStates.push(i === index);
            }

            // Phase 2: Write to DOM (batch updates)
            for (let i = 0; i < tabLinksArray.length; i++) {
                const link = tabLinksArray[i];
                const isActive = isActiveStates[i];

                link.setAttribute('aria-selected', isActive);
                link.classList.toggle('cc-active', isActive);

                if (overlays[i]) {
                    overlays[i].setAttribute('tabindex', isActive ? '0' : '-1');
                }
            }

            // Update tab panes
            for (let i = 0; i < tabPanesArray.length; i++) {
                tabPanesArray[i].setAttribute('aria-hidden', i !== index);
            }

            currentActiveIndex = index;

            // Update dropdown toggle text if it exists
            if (dropdownText && isMobileDropdown) {
                const activeTabName = tabLinksArray[index].getAttribute('data-tab-link-name');
                dropdownText.textContent = activeTabName || tabLinksArray[index].textContent;
            }

            // Close dropdown if open
            if (dropdownToggle && dropdownMenu.classList.contains('cc-open')) {
                closeDropdown();
            }

            // Scroll active tab into view within the overflow container
            if (!isMobileDropdown) {
                const activeLink = tabLinksArray[index];
                const scrollContainer = tabMenuWrapper;

                // Batch read operations
                const containerLeft = scrollContainer.scrollLeft;
                const containerWidth = scrollContainer.clientWidth;
                const tabLeft = activeLink.offsetLeft;
                const tabWidth = activeLink.offsetWidth;

                // Scroll to show the tab on the left side of the container
                if (tabLeft < containerLeft || tabLeft + tabWidth > containerLeft + containerWidth) {
                    scrollContainer.scrollTo({
                        left: tabLeft,
                        behavior: 'smooth'
                    });
                }
            }

            // Restart autoplay if enabled
            if (autoplayEnabled) {
                if (isAutoplayPaused) {
                    // Reset elapsed time when manually switching tabs while paused
                    autoplayElapsedTime = 0;
                } else {
                    restartAutoplay();
                }
            }
        }

        /**
         * Open the mobile dropdown
         */
        function openDropdown() {
            if (!dropdownToggle || !dropdownMenu) return;
            dropdownMenu.classList.add('cc-open');
            dropdownToggle.classList.add('cc-open');
            dropdownToggle.setAttribute('aria-expanded', 'true');
        }

        /**
         * Close the mobile dropdown
         */
        function closeDropdown() {
            if (!dropdownToggle || !dropdownMenu) return;
            dropdownMenu.classList.remove('cc-open');
            dropdownToggle.classList.remove('cc-open');
            dropdownToggle.setAttribute('aria-expanded', 'false');
        }

        /**
         * Toggle the mobile dropdown
         */
        function toggleDropdown() {
            if (dropdownMenu.classList.contains('cc-open')) {
                closeDropdown();
            } else {
                openDropdown();
            }
        }

        /**
         * Setup mobile dropdown interactions
         */
        function setupMobileDropdown() {
            if (!isMobileDropdown || !dropdownToggle) return;

            // Set initial aria attributes
            dropdownToggle.setAttribute('aria-haspopup', 'true');
            dropdownToggle.setAttribute('aria-expanded', 'false');

            // Set initial text to active tab
            const activeLink = component.querySelector('[data-tabs-link][aria-selected="true"]') ||
                              component.querySelector('[data-tabs-link].cc-active') ||
                              tabLinksArray[0];
            if (dropdownText && activeLink) {
                const activeTabName = activeLink.getAttribute('data-tab-link-name');
                dropdownText.textContent = activeTabName || activeLink.textContent;
            }

            // Toggle dropdown on click
            const toggleHandler = function(e) {
                e.stopPropagation();
                toggleDropdown();
            };
            dropdownToggle.addEventListener('click', toggleHandler);
            eventListeners.push({ element: dropdownToggle, type: 'click', handler: toggleHandler });

            // Close dropdown when clicking outside - use delegation on document
            const outsideClickHandler = function(e) {
                if (!component.contains(e.target)) {
                    closeDropdown();
                }
            };
            document.addEventListener('click', outsideClickHandler);
            eventListeners.push({ element: document, type: 'click', handler: outsideClickHandler });

            // Close on escape key - use delegation on document
            const escapeHandler = function(e) {
                if (e.key === 'Escape' && dropdownMenu.classList.contains('cc-open')) {
                    closeDropdown();
                    dropdownToggle.focus();
                }
            };
            document.addEventListener('keydown', escapeHandler);
            eventListeners.push({ element: document, type: 'keydown', handler: escapeHandler });
        }

        /**
         * Setup autoplay progress bars
         */
        function setupAutoplayProgressBars() {
            if (!autoplayEnabled) return;

            // Set CSS variable for duration
            component.style.setProperty('--autoplay-duration', `${autoplayDuration}s`);
        }

        /**
         * Start autoplay
         */
        function startAutoplay() {
            if (!autoplayEnabled || isAutoplayPaused) return;

            stopAutoplay();

            const remainingTime = (autoplayDuration * 1000) - autoplayElapsedTime;
            autoplayStartTime = Date.now();

            autoplayTimer = setTimeout(() => {
                const nextIndex = (currentActiveIndex + 1) % tabLinksArray.length;
                setActiveTab(nextIndex);
            }, remainingTime);
        }

        /**
         * Stop autoplay
         */
        function stopAutoplay() {
            if (autoplayTimer) {
                clearTimeout(autoplayTimer);
                autoplayTimer = null;
            }
            autoplayStartTime = null;
        }

        /**
         * Restart autoplay (used when manually switching tabs)
         */
        function restartAutoplay() {
            if (!autoplayEnabled) return;

            // Reset elapsed time
            autoplayElapsedTime = 0;

            // Remove and re-add animation to restart it
            const activeLink = tabLinksArray[currentActiveIndex];
            const progressBar = activeLink.querySelector('[data-tabs-autoplay-progress]');

            if (progressBar) {
                // Use requestAnimationFrame for smoother animation restart
                progressBar.style.animation = 'none';
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        progressBar.style.animation = '';
                    });
                });
            }

            startAutoplay();
        }

        /**
         * Update toggle button aria-label
         */
        function updateToggleButton() {
            if (!autoplayToggleButton) return;

            if (isAutoplayPaused) {
                autoplayToggleButton.setAttribute('aria-label', 'Play autoplay');
            } else {
                autoplayToggleButton.setAttribute('aria-label', 'Pause autoplay');
            }
        }

        /**
         * Pause autoplay
         */
        function pauseAutoplay() {
            if (!autoplayEnabled) return;

            // Calculate elapsed time
            if (autoplayStartTime !== null) {
                autoplayElapsedTime += Date.now() - autoplayStartTime;
            }

            isAutoplayPaused = true;
            component.classList.add('autoplay-paused');
            stopAutoplay();
            updateToggleButton();
        }

        /**
         * Resume autoplay
         */
        function resumeAutoplay() {
            if (!autoplayEnabled) return;
            isAutoplayPaused = false;
            component.classList.remove('autoplay-paused');
            startAutoplay();
            updateToggleButton();
        }

        /**
         * Setup intersection observer for autoplay
         */
        function setupAutoplayObserver() {
            if (!autoplayEnabled) return;

            autoplayObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        resumeAutoplay();
                    } else {
                        pauseAutoplay();
                    }
                });
            }, { threshold: 0.5 });

            autoplayObserver.observe(component);
        }

        /**
         * Setup hover pause for autoplay
         */
        function setupAutoplayHoverPause() {
            if (!autoplayEnabled || !autoplayHoverPause) return;

            const mouseEnterHandler = () => {
                pauseAutoplay();
            };
            const mouseLeaveHandler = () => {
                resumeAutoplay();
            };

            component.addEventListener('mouseenter', mouseEnterHandler);
            component.addEventListener('mouseleave', mouseLeaveHandler);

            eventListeners.push({ element: component, type: 'mouseenter', handler: mouseEnterHandler });
            eventListeners.push({ element: component, type: 'mouseleave', handler: mouseLeaveHandler });
        }

        /**
         * Setup play/pause toggle button
         */
        function setupAutoplayToggle() {
            if (!autoplayEnabled || !autoplayToggleButton) return;

            const toggleHandler = () => {
                if (isAutoplayPaused) {
                    resumeAutoplay();
                } else {
                    pauseAutoplay();
                }
            };

            autoplayToggleButton.addEventListener('click', toggleHandler);
            eventListeners.push({ element: autoplayToggleButton, type: 'click', handler: toggleHandler });
        }

        /**
         * Find initial active tab index
         */
        function findInitialActiveIndex() {
            // Check for URL hash match
            if (window.location.hash) {
                const hash = window.location.hash.substring(1);
                const matchIndex = tabLinksArray.findIndex(link => link.id === hash);
                if (matchIndex !== -1) {
                    return matchIndex;
                }
            }

            // Check for cc-active class
            const customActiveIndex = tabLinksArray.findIndex(
                link => link.classList.contains('cc-active')
            );
            if (customActiveIndex !== -1) {
                return customActiveIndex;
            }

            // Default to first tab
            return 0;
        }

        /**
         * Setup keyboard navigation
         */
        function setupKeyboardNav() {
            const tabLinksLength = tabLinksArray.length;

            tabLinksArray.forEach((link) => {
                const overlay = link.querySelector('[data-tabs-link-button]');
                if (!overlay) return;

                const keydownHandler = function(e) {
                    let newIndex = currentActiveIndex;

                    switch(e.key) {
                        case 'ArrowLeft':
                            e.preventDefault();
                            newIndex = currentActiveIndex > 0 ? currentActiveIndex - 1 : tabLinksLength - 1;
                            break;
                        case 'ArrowRight':
                            e.preventDefault();
                            newIndex = currentActiveIndex < tabLinksLength - 1 ? currentActiveIndex + 1 : 0;
                            break;
                        case 'Home':
                            e.preventDefault();
                            newIndex = 0;
                            break;
                        case 'End':
                            e.preventDefault();
                            newIndex = tabLinksLength - 1;
                            break;
                        default:
                            return;
                    }

                    setActiveTab(newIndex);
                    const nextOverlay = tabLinksArray[newIndex].querySelector('[data-tabs-link-button]');
                    if (nextOverlay) {
                        nextOverlay.focus();
                    }
                };

                overlay.addEventListener('keydown', keydownHandler);
                eventListeners.push({ element: overlay, type: 'keydown', handler: keydownHandler });
            });
        }

        /**
         * Setup click handlers
         */
        function setupClickHandlers() {
            tabLinksArray.forEach((link, index) => {
                const overlay = link.querySelector('[data-tabs-link-button]');
                if (!overlay) return;

                const clickHandler = function(e) {
                    e.preventDefault();
                    setActiveTab(index);

                    // Scroll the active tab into view on mobile - use cached width
                    if (cachedWindowWidth < 768 && !isMobileDropdown) {
                        link.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }
                };

                overlay.addEventListener('click', clickHandler);
                eventListeners.push({ element: overlay, type: 'click', handler: clickHandler });
            });
        }

        /**
         * Setup window resize handler
         */
        function setupResizeHandler() {
            const resizeHandler = function() {
                // Debounce resize events
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                    cachedWindowWidth = window.innerWidth;
                }, 150);
            };

            window.addEventListener('resize', resizeHandler);
            eventListeners.push({ element: window, type: 'resize', handler: resizeHandler });
        }

        /**
         * Cleanup function to remove event listeners and observers
         */
        function cleanup() {
            // Remove all event listeners
            eventListeners.forEach(({ element, type, handler }) => {
                element.removeEventListener(type, handler);
            });

            // Disconnect observer
            if (autoplayObserver) {
                autoplayObserver.disconnect();
            }

            // Clear timers
            stopAutoplay();
            clearTimeout(resizeTimer);
        }

        /**
         * Initialize the component
         */
        function init() {
            // Setup mobile dropdown if needed
            setupMobileDropdown();

            // Setup autoplay if needed
            setupAutoplayProgressBars();
            setupAutoplayObserver();
            setupAutoplayHoverPause();
            setupAutoplayToggle();

            // Find and set initial active tab
            const initialIndex = findInitialActiveIndex();
            setActiveTab(initialIndex);

            // Setup interactions
            setupClickHandlers();
            setupKeyboardNav();
            setupResizeHandler();

            // Start autoplay if enabled
            if (autoplayEnabled) {
                startAutoplay();
            }

            // Handle hash changes for deep linking
            const hashChangeHandler = function() {
                if (window.location.hash) {
                    const hash = window.location.hash.substring(1);
                    const matchIndex = tabLinksArray.findIndex(link => link.id === hash);
                    if (matchIndex !== -1) {
                        setActiveTab(matchIndex);
                    }
                }
            };

            window.addEventListener('hashchange', hashChangeHandler);
            eventListeners.push({ element: window, type: 'hashchange', handler: hashChangeHandler });
        }

        // Initialize this component
        init();

        // Store cleanup function on component for potential later use
        component.__tabsCleanup = cleanup;
    }

    /**
     * Initialize all tabs components on the page
     */
    function initAllTabs() {
        // Re-query for tabs components in case they were added dynamically
        const components = document.querySelectorAll('[data-tabs-component]');

        if (!components.length) {
            return;
        }

        components.forEach(initTabsComponent);
    }

    // Wait for DOM to be fully loaded before initializing
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAllTabs);
    } else {
        initAllTabs();
    }
})();
