/**
 * Mast Tabs (GeekyGrowth fork)
 *
 * Based on Mast's tabs.js and the sibe.io refactor. Adds:
 * - The [data-tabs-link] wrapper is the tab (roving tabindex, ids, aria-controls / aria-labelledby).
 * - Legacy markup still works: a [data-tabs-link-button] cover button is made inert and
 *   click-through, so the tab itself takes focus and clicks.
 * - role="tablist" lives on [data-tabs-menu-wrapper] (moved there at runtime if the markup
 *   still has it on [data-tabs-menu]).
 * - Per-tab autoplay duration via data-tabs-link-duration (empty values are ignored).
 * - Pane videos follow the autoplay state; the Webflow video play/pause button also
 *   pauses and resumes autoplay.
 * - Autoplay pauses while keyboard focus is inside the component (or any focus inside a
 *   pane) and while the browser tab is in the background, and starts paused when the
 *   visitor prefers reduced motion. Pressing play overrides hover and focus pauses.
 * - Tabs components nested inside a pane are independent of their parent.
 * - Tabs hidden with display: none are skipped by the arrow keys, Home/End and autoplay.
 * - Safe to run twice: a component that was already initialized is cleaned up first.
 *
 * Versions: v1.x = original Mast tabs (legacy cover-button markup). v2.x = this script.
 */
(function () {
    'use strict';

    // Tab names that are really just the component default, so the visible text is used instead
    const PLACEHOLDER_NAMES = ['tab'];

    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /**
     * Initialize a single tabs component
     */
    function initTabsComponent(component) {
        // Already initialized (script loaded twice, or re-init after a DOM change)
        if (typeof component.__tabsCleanup === 'function') {
            component.__tabsCleanup();
        }

        // Only this component's own elements, never those of a tabs component nested in a pane
        const ownAll = (selector) => Array.from(component.querySelectorAll(selector)).filter((el) => el.closest('[data-tabs-component]') === component);
        const own = (selector) => ownAll(selector)[0] || null;

        const tabMenu = own('[data-tabs-menu]');
        const dropdownMenu = own('[data-tabs-menu-dropdown-menu]');
        const tabMenuWrapper = own('[data-tabs-menu-wrapper]');
        const tabLinksArray = ownAll('[data-tabs-link]');
        const tabPanesArray = ownAll('[data-tabs-pane]');

        if (!tabMenu || !dropdownMenu || !tabMenuWrapper || !tabLinksArray.length || !tabPanesArray.length) {
            return;
        }

        // State
        let currentActiveIndex = 0;
        const dropdownToggle = own('[data-tabs-menu-dropdown-toggle]');
        const dropdownText = dropdownToggle ? dropdownToggle.querySelector('[data-tabs-menu-dropdown-text]') : null;
        const isMobileDropdown = tabMenu.getAttribute('data-tab-mobile-dropdown') === 'true';
        const isVertical = tabMenu.getAttribute('data-wf--tabs-menu--settings-alignment') === 'vertical';

        // Cache autoplay toggle button
        const autoplayToggleButton = own('[data-tabs-autoplay-toggle]');

        // Autoplay state (a single tab has nothing to rotate to)
        const autoplayEnabled = tabMenu.getAttribute('data-tabs-autoplay') === 'true' && tabLinksArray.length > 1;
        const autoplayDuration = parseDuration(tabMenu.getAttribute('data-tabs-autoplay-duration')) || 5;
        const autoplayHoverPause = tabMenu.getAttribute('data-tabs-autoplay-hover-pause') === 'true';
        let currentTabDuration = autoplayDuration;
        let autoplayTimer = null;
        let autoplayObserver = null;
        let autoplayStartTime = null;
        let autoplayElapsedTime = 0;

        // Why autoplay is paused. Autoplay runs only while this set is empty.
        // 'user'      - play/pause toggle, video button, or reduced motion
        // 'hover'     - pointer over the component (only with data-tabs-autoplay-hover-pause)
        // 'focus'     - keyboard focus inside the component, or any focus inside a pane
        // 'offscreen' - component scrolled out of view
        // 'hidden'    - browser tab in the background
        const pauseReasons = new Set();

        // Cache window width for responsive checks
        let cachedWindowWidth = window.innerWidth;
        let resizeTimer = null;

        // Event listener references for cleanup
        const eventListeners = [];

        function on(element, type, handler, capture) {
            element.addEventListener(type, handler, !!capture);
            eventListeners.push({ element, type, handler, capture: !!capture });
        }

        function isAutoplayPaused() {
            return pauseReasons.size > 0;
        }

        /**
         * The tab's accessible name: data-tab-link-name, unless it is empty or a placeholder
         */
        function getTabName(link) {
            const name = (link.getAttribute('data-tab-link-name') || '').trim();
            if (!name || PLACEHOLDER_NAMES.includes(name.toLowerCase())) return '';
            return name;
        }

        /**
         * Accessible tab semantics. The [data-tabs-link] wrapper is the tab.
         */
        function setupTabSemantics() {
            const uid = 'tabs-' + Math.random().toString(36).slice(2, 7);

            // The tablist should only contain tabs, so it belongs on the wrapper, not the menu
            // (the menu also holds the mobile dropdown toggle)
            if (tabMenu.getAttribute('role') === 'tablist') {
                tabMenu.removeAttribute('role');
            }
            tabMenuWrapper.setAttribute('role', 'tablist');
            if (isVertical) {
                tabMenuWrapper.setAttribute('aria-orientation', 'vertical');
            }

            tabLinksArray.forEach((link, i) => {
                link.setAttribute('role', 'tab');
                if (!link.id) link.id = uid + '-tab-' + i;

                const name = getTabName(link);
                if (name) link.setAttribute('aria-label', name);

                // Legacy markup: the cover button is no longer the tab. It's made inert (no focus,
                // no accessibility tree, not a nested control) and clicks pass through to the tab.
                link.querySelectorAll('[data-tabs-link-button]').forEach((overlay) => {
                    overlay.setAttribute('tabindex', '-1');
                    overlay.setAttribute('aria-hidden', 'true');
                    overlay.inert = true;
                    overlay.style.pointerEvents = 'none';
                    link.style.cursor = 'pointer';
                });

                // The progress bar is decoration
                link.querySelectorAll('[data-tabs-autoplay-progress]').forEach((bar) => {
                    bar.setAttribute('aria-hidden', 'true');
                });

                const pane = tabPanesArray[i];
                if (pane) {
                    if (!pane.id) pane.id = uid + '-panel-' + i;
                    pane.setAttribute('role', 'tabpanel');
                    pane.setAttribute('aria-labelledby', link.id);
                    link.setAttribute('aria-controls', pane.id);

                    // A panel without focusable content gets a Tab stop, so keyboard users can reach it
                    const hasFocusable = pane.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
                    if (!hasFocusable && !pane.hasAttribute('tabindex')) {
                        pane.setAttribute('tabindex', '0');
                    }
                }
            });

            if (autoplayToggleButton) {
                if (autoplayToggleButton.tagName === 'BUTTON' && !autoplayToggleButton.hasAttribute('type')) {
                    autoplayToggleButton.setAttribute('type', 'button');
                }
                // Without autoplay the toggle has nothing to control (inline style, because
                // the hidden attribute loses against the class's display value)
                if (!autoplayEnabled) autoplayToggleButton.style.display = 'none';
            }
        }

        /**
         * Pane videos follow the autoplay state.
         * Only the active pane's video plays, and only while autoplay is running,
         * so the video and the progress bar always start, pause and restart together.
         * Selects every <video> inside a pane (Webflow Background Video renders one),
         * so a client-swapped video needs no extra attribute. Tabs without autoplay
         * are left alone.
         */
        // A pane's own videos, not those inside a nested tabs component's panes
        function paneVideos(pane) {
            return Array.from(pane.querySelectorAll('video')).filter((video) => video.closest('[data-tabs-pane]') === pane);
        }

        function shouldPaneVideoPlay(paneIndex) {
            return paneIndex === currentActiveIndex && !isAutoplayPaused();
        }

        function syncPaneVideos(restart) {
            if (!autoplayEnabled) return;

            tabPanesArray.forEach((pane, i) => {
                paneVideos(pane).forEach((video) => {
                    if (restart && i === currentActiveIndex) {
                        video.currentTime = 0;
                    }
                    if (shouldPaneVideoPlay(i)) {
                        const playing = video.play(); // rejected if the video is not muted
                        if (playing && typeof playing.catch === 'function') playing.catch(() => {});
                    } else {
                        video.pause();
                    }
                });
            });
        }

        // Webflow's own autoplay can start a video at any time - pause it again
        // whenever it is not the one that should be playing
        function guardPaneVideos() {
            if (!autoplayEnabled) return;

            tabPanesArray.forEach((pane, i) => {
                paneVideos(pane).forEach((video) => {
                    on(video, 'play', () => {
                        if (!shouldPaneVideoPlay(i)) video.pause();
                    });

                    // Keep Webflow's play/pause icon in step when this script plays or pauses the video
                    const iconHandler = () => syncVideoButton(pane, video);
                    on(video, 'play', iconHandler);
                    on(video, 'pause', iconHandler);
                });

                // The video's play/pause button also pauses/resumes autoplay.
                // Capture phase, so the state is set before Webflow's own handler toggles the video.
                on(pane, 'click', (e) => {
                    if (!e.target.closest('[data-w-bg-video-control]')) return;
                    const video = e.target.closest('[data-tabs-pane]') === pane ? paneVideos(pane)[0] : null;
                    if (!video) return;

                    if (video.paused) {
                        userResume(false); // Webflow plays the video itself
                    } else {
                        addPause('user', false); // Webflow pauses the video itself
                    }
                }, true);
            });
        }

        // Webflow's button only swaps its icon when it is clicked itself.
        // Its two <span>s are Webflow-generated (no hook possible): [0] = pause icon, [1] = play icon.
        function syncVideoButton(pane, video) {
            const button = pane.querySelector('[data-w-bg-video-control]');
            if (!button || button.children.length < 2) return;
            button.children[0].hidden = video.paused;
            button.children[1].hidden = !video.paused;
        }

        /**
         * Set the active tab by index
         */
        function setActiveTab(index) {
            if (index < 0 || index >= tabLinksArray.length) {
                return;
            }

            // The wrapper is the tab: roving tabindex, only the active tab is in the Tab order
            for (let i = 0; i < tabLinksArray.length; i++) {
                const link = tabLinksArray[i];
                const isActive = i === index;

                link.setAttribute('aria-selected', isActive);
                link.setAttribute('tabindex', isActive ? '0' : '-1');
                link.classList.toggle('cc-active', isActive);
            }

            // Update tab panes (hidden by CSS: .tabs-pane[aria-hidden="true"])
            for (let i = 0; i < tabPanesArray.length; i++) {
                tabPanesArray[i].setAttribute('aria-hidden', i !== index);
            }

            currentActiveIndex = index;

            // Update dropdown toggle text if it exists
            if (dropdownText && isMobileDropdown) {
                dropdownText.textContent = getTabName(tabLinksArray[index]) || tabLinksArray[index].textContent.trim();
            }

            // Close dropdown if open
            if (dropdownToggle && dropdownMenu.classList.contains('cc-open')) {
                closeDropdown();
            }

            // Scroll active tab into view within the overflow container
            if (!isMobileDropdown) {
                const activeLink = tabLinksArray[index];
                const scrollContainer = tabMenuWrapper;

                const containerLeft = scrollContainer.scrollLeft;
                const containerWidth = scrollContainer.clientWidth;
                const tabLeft = activeLink.offsetLeft;
                const tabWidth = activeLink.offsetWidth;

                if (tabLeft < containerLeft || tabLeft + tabWidth > containerLeft + containerWidth) {
                    scrollContainer.scrollTo({
                        left: tabLeft,
                        behavior: prefersReducedMotion ? 'auto' : 'smooth',
                    });
                }
            }

            // Per-tab duration, falling back to the menu's duration
            currentTabDuration = parseDuration(tabLinksArray[index].getAttribute('data-tabs-link-duration')) || autoplayDuration;
            component.style.setProperty('--autoplay-duration', `${currentTabDuration}s`);

            // Restart autoplay if enabled
            if (autoplayEnabled) {
                if (isAutoplayPaused()) {
                    autoplayElapsedTime = 0;
                    resetProgressBar();
                } else {
                    restartAutoplay();
                }
            }

            // New tab's video starts from 0; it only plays if autoplay is running
            syncPaneVideos(true);
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

            dropdownToggle.setAttribute('aria-haspopup', 'true');
            dropdownToggle.setAttribute('aria-expanded', 'false');

            const activeLink = tabLinksArray.find((link) => link.getAttribute('aria-selected') === 'true') || tabLinksArray.find((link) => link.classList.contains('cc-active')) || tabLinksArray[0];
            if (dropdownText && activeLink) {
                dropdownText.textContent = getTabName(activeLink) || activeLink.textContent.trim();
            }

            on(dropdownToggle, 'click', (e) => {
                e.stopPropagation();
                toggleDropdown();
            });

            on(document, 'click', (e) => {
                if (!component.contains(e.target)) {
                    closeDropdown();
                }
            });

            on(document, 'keydown', (e) => {
                if (e.key === 'Escape' && dropdownMenu.classList.contains('cc-open')) {
                    closeDropdown();
                    dropdownToggle.focus();
                }
            });
        }

        /**
         * Setup autoplay progress bars
         */
        function setupAutoplayProgressBars() {
            if (!autoplayEnabled) return;
            component.style.setProperty('--autoplay-duration', `${currentTabDuration}s`);
        }

        /**
         * Start autoplay
         */
        function startAutoplay() {
            if (!autoplayEnabled || isAutoplayPaused()) return;

            stopAutoplay();

            const remainingTime = Math.max(0, currentTabDuration * 1000 - autoplayElapsedTime);

            autoplayStartTime = Date.now();

            autoplayTimer = setTimeout(() => {
                setActiveTab(findAvailableIndex(currentActiveIndex, 1));
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
         * Restart the active tab's progress bar animation from 0
         */
        function resetProgressBar() {
            const progressBar = tabLinksArray[currentActiveIndex].querySelector('[data-tabs-autoplay-progress]');
            if (!progressBar) return;

            // Reading offsetWidth forces a reflow, so the animation restarts synchronously.
            // (A requestAnimationFrame-based reset can stall where frames are throttled,
            // leaving the bar stuck at animation: none.)
            progressBar.style.animation = 'none';
            void progressBar.offsetWidth;
            progressBar.style.animation = '';
        }

        /**
         * Restart autoplay (used when manually switching tabs)
         */
        function restartAutoplay() {
            if (!autoplayEnabled) return;

            autoplayElapsedTime = 0;
            resetProgressBar();
            startAutoplay();
        }

        /**
         * Reflect the paused state on the component class and the toggle's aria-label
         */
        function updatePausedState() {
            const paused = isAutoplayPaused();
            component.classList.toggle('autoplay-paused', paused);

            if (autoplayToggleButton) {
                autoplayToggleButton.setAttribute('aria-label', paused ? 'Play autoplay' : 'Pause autoplay');
            }
        }

        /**
         * Add a pause reason. Pauses autoplay if it was running.
         */
        function addPause(reason, syncVideos = true) {
            if (!autoplayEnabled || pauseReasons.has(reason)) return;

            const wasRunning = !isAutoplayPaused();
            pauseReasons.add(reason);

            if (wasRunning) {
                if (autoplayStartTime !== null) {
                    autoplayElapsedTime += Date.now() - autoplayStartTime;
                }
                stopAutoplay();
                if (syncVideos) syncPaneVideos(false);
            }
            updatePausedState();
        }

        /**
         * Remove a pause reason. Resumes autoplay once no reason is left.
         */
        function removePause(reason, syncVideos = true) {
            if (!autoplayEnabled || !pauseReasons.has(reason)) return;

            pauseReasons.delete(reason);

            if (!isAutoplayPaused()) {
                startAutoplay();
                if (syncVideos) syncPaneVideos(false);
            }
            updatePausedState();
        }

        /**
         * The visitor explicitly asked to play: this overrides hover and focus pauses
         * (but not 'offscreen', which clears itself when the component scrolls back in)
         */
        function userResume(syncVideos = true) {
            pauseReasons.delete('hover');
            pauseReasons.delete('focus');
            pauseReasons.add('user'); // so removePause runs its resume logic
            removePause('user', syncVideos);
        }

        /**
         * Setup intersection observer for autoplay
         */
        function setupAutoplayObserver() {
            if (!autoplayEnabled || !('IntersectionObserver' in window)) return;

            autoplayObserver = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) {
                            removePause('offscreen');
                        } else {
                            addPause('offscreen');
                        }
                    });
                },
                { threshold: 0.5 },
            );

            autoplayObserver.observe(component);
        }

        /**
         * Pause while the browser tab is in the background, so the visitor
         * doesn't come back to a tab that rotated on without them
         */
        function setupAutoplayVisibilityPause() {
            if (!autoplayEnabled) return;

            on(document, 'visibilitychange', () => {
                if (document.hidden) {
                    addPause('hidden');
                } else {
                    removePause('hidden');
                }
            });
        }

        /**
         * Setup hover pause for autoplay
         */
        function setupAutoplayHoverPause() {
            if (!autoplayEnabled || !autoplayHoverPause) return;

            on(component, 'mouseenter', () => addPause('hover'));
            on(component, 'mouseleave', () => removePause('hover'));
        }

        /**
         * Pause autoplay while keyboard focus is inside the component, so content doesn't
         * change under a keyboard or screen reader user. Any focus inside a pane (also a mouse
         * click) pauses too, otherwise the next tab change would hide the focused element.
         */
        function setupAutoplayFocusPause() {
            if (!autoplayEnabled) return;

            on(component, 'focusin', (e) => {
                let isKeyboardFocus = true;
                try {
                    isKeyboardFocus = e.target.matches(':focus-visible');
                } catch (err) {
                    // Browsers without :focus-visible: treat every focus as keyboard focus
                }
                const inPane = tabPanesArray.some((pane) => pane.contains(e.target));
                if (isKeyboardFocus || inPane) addPause('focus');
            });

            on(component, 'focusout', (e) => {
                if (!e.relatedTarget || !component.contains(e.relatedTarget)) {
                    removePause('focus');
                }
            });
        }

        /**
         * Setup play/pause toggle button
         */
        function setupAutoplayToggle() {
            if (!autoplayEnabled || !autoplayToggleButton) return;

            on(autoplayToggleButton, 'click', () => {
                if (isAutoplayPaused()) {
                    userResume();
                } else {
                    addPause('user');
                }
            });
        }

        /**
         * A tab hidden with display: none (e.g. a page script hiding tabs whose CMS list is
         * empty) is skipped by the arrow keys, Home/End and autoplay. Only the tab's own
         * display counts, because a closed mobile dropdown hides every tab via its parent.
         */
        function isTabAvailable(link) {
            return !link.hidden && getComputedStyle(link).display !== 'none';
        }

        /**
         * Next available tab from `from` in direction `step` (1 or -1), wrapping around.
         * Returns the current index if no other tab is available.
         */
        function findAvailableIndex(from, step) {
            const length = tabLinksArray.length;
            for (let n = 1; n <= length; n++) {
                const i = (((from + step * n) % length) + length) % length;
                if (isTabAvailable(tabLinksArray[i])) return i;
            }
            return currentActiveIndex;
        }

        /**
         * Find initial active tab index
         */
        function findInitialActiveIndex() {
            if (window.location.hash) {
                const hash = window.location.hash.substring(1);
                const matchIndex = tabLinksArray.findIndex((link) => link.id === hash);
                if (matchIndex !== -1) {
                    return matchIndex;
                }
            }

            const customActiveIndex = tabLinksArray.findIndex((link) => link.classList.contains('cc-active'));
            if (customActiveIndex !== -1) {
                return customActiveIndex;
            }

            return 0;
        }

        /**
         * Setup keyboard navigation (Left/Right, or Up/Down for vertical menus; Home, End, Enter, Space)
         */
        function setupKeyboardNav() {
            const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft';
            const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight';

            tabLinksArray.forEach((link, index) => {
                on(link, 'keydown', (e) => {
                    let newIndex = currentActiveIndex;

                    switch (e.key) {
                        case 'Enter':
                        case ' ':
                            newIndex = index;
                            break;
                        case prevKey:
                            newIndex = findAvailableIndex(currentActiveIndex, -1);
                            break;
                        case nextKey:
                            newIndex = findAvailableIndex(currentActiveIndex, 1);
                            break;
                        case 'Home':
                            newIndex = findAvailableIndex(-1, 1);
                            break;
                        case 'End':
                            newIndex = findAvailableIndex(tabLinksArray.length, -1);
                            break;
                        default:
                            return;
                    }

                    e.preventDefault();
                    removePause('user');
                    setActiveTab(newIndex);
                    tabLinksArray[newIndex].focus();
                });
            });
        }

        /**
         * Setup click handlers
         */
        function setupClickHandlers() {
            tabLinksArray.forEach((link, index) => {
                on(link, 'click', (e) => {
                    e.preventDefault();
                    removePause('user');
                    setActiveTab(index);

                    if (cachedWindowWidth < 768 && !isMobileDropdown) {
                        link.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
                    }
                });
            });
        }

        /**
         * Setup window resize handler
         */
        function setupResizeHandler() {
            on(window, 'resize', () => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                    cachedWindowWidth = window.innerWidth;
                }, 150);
            });
        }

        /**
         * Cleanup function to remove event listeners and observers
         */
        function cleanup() {
            eventListeners.forEach(({ element, type, handler, capture }) => {
                element.removeEventListener(type, handler, capture);
            });
            eventListeners.length = 0;

            if (autoplayObserver) {
                autoplayObserver.disconnect();
            }

            stopAutoplay();
            clearTimeout(resizeTimer);
            delete component.__tabsCleanup;
        }

        /**
         * Initialize the component
         */
        function init() {
            setupTabSemantics();
            setupMobileDropdown();
            guardPaneVideos();

            // Reduced motion: start paused, the play/pause toggle can still start it
            if (autoplayEnabled && prefersReducedMotion) {
                pauseReasons.add('user');
            }

            const initialIndex = findInitialActiveIndex();
            setActiveTab(initialIndex);

            setupAutoplayProgressBars();
            setupAutoplayObserver();
            setupAutoplayHoverPause();
            setupAutoplayFocusPause();
            setupAutoplayVisibilityPause();
            setupAutoplayToggle();
            setupClickHandlers();
            setupKeyboardNav();
            setupResizeHandler();

            if (autoplayEnabled) {
                updatePausedState();
                startAutoplay();
            }

            on(window, 'hashchange', () => {
                if (window.location.hash) {
                    const hash = window.location.hash.substring(1);
                    const matchIndex = tabLinksArray.findIndex((link) => link.id === hash);
                    if (matchIndex !== -1) {
                        setActiveTab(matchIndex);
                    }
                }
            });
        }

        init();
        component.__tabsCleanup = cleanup;
    }

    /**
     * Parse a duration attribute ("12", "26s"). Returns 0 for empty or invalid values.
     */
    function parseDuration(value) {
        const parsed = parseFloat(value);
        return !isNaN(parsed) && parsed > 0 ? parsed : 0;
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
