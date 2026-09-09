/*!
 * video-player.js — Mast (GeekyGrowth fork)
 *
 * A dependency-free, multi-instance custom video player.
 *
 * ---------------------------------------------------------------------------
 * DESIGN RULES
 * ---------------------------------------------------------------------------
 * 1. This file contains NO styling. It never writes a colour, a size or a
 *    `display` value. Every visual state is published as a class on the
 *    component root (default prefix `cc-`) and mirrored on a
 *    `data-video-player-state` attribute. Each site styles the player
 *    entirely in the Designer.
 *    The only exceptions — unavoidable for a progress bar — are the width of
 *    the progress/buffer elements and the `--video-player-progress` custom
 *    property, both listed under "Progress" below.
 * 2. Nothing is selected by class name. Every part is found through the
 *    `data-video-player` attribute, so class names are the site's business.
 * 3. Every part is optional. A component with only a <video> works; add a
 *    play button and it wires itself up. Missing parts are simply skipped.
 * 4. Any role may appear more than once. Two play buttons, three time
 *    labels — all of them get wired.
 *
 * ---------------------------------------------------------------------------
 * MARKUP — roles, via data-video-player="<role>"
 * ---------------------------------------------------------------------------
 *   component        the wrapper. Required. State classes land here.
 *   media            the <video>. Required (falls back to the first <video>).
 *   poster           a poster overlay (img/picture/div) you hide with CSS.
 *   controls         the control bar wrapper.
 *   play             plays. Use for the big centre chip.
 *   pause            pauses.
 *   toggle           play/pause toggle.
 *   back             seeks backwards by `skip` seconds.
 *   forward          seeks forwards by `skip` seconds.
 *   mute             mute/unmute toggle.
 *   fullscreen       fullscreen toggle.
 *   progress         the scrub track. Click, drag and keyboard seeking.
 *   progress-fill    grows to the played position (width is set inline).
 *   progress-buffer  grows to the buffered position (width is set inline).
 *   time-current     text: elapsed time.
 *   time-duration    text: total duration.
 *   time             text: "0:42 / 4:09" (see `time-separator`).
 *
 * ---------------------------------------------------------------------------
 * OPTIONS — attributes on the component root
 * ---------------------------------------------------------------------------
 *   data-video-player-src              lazy-loaded video URL
 *   data-video-player-poster-src       lazy-loaded poster URL
 *   data-video-player-lazy             "false" loads immediately
 *   data-video-player-root-margin      lazy-load distance, default "200px"
 *   data-video-player-autoplay         "true" (forces muted)
 *   data-video-player-muted            "true" / "false"
 *   data-video-player-loop             "true" / "false"
 *   data-video-player-preload          none | metadata | auto
 *   data-video-player-skip             seconds for back/forward, default 10
 *   data-video-player-click-to-toggle  "false" to stop clicks on the video
 *   data-video-player-keyboard         "false" to disable keyboard control
 *   data-video-player-pause-offscreen  "true" pauses when scrolled away
 *   data-video-player-reset-on-end     "true" rewinds to 0 when finished
 *   data-video-player-desktop-only     "true" disables at <= 991px
 *   data-video-player-time-separator   default " / "
 *   data-video-player-class-prefix     default "cc-"
 *   data-video-player-label-play       aria-label, default "Play"
 *   data-video-player-label-pause      aria-label, default "Pause"
 *   data-video-player-label-mute       aria-label, default "Mute"
 *   data-video-player-label-unmute     aria-label, default "Unmute"
 *   data-video-player-label-fullscreen        default "Fullscreen"
 *   data-video-player-label-exit-fullscreen   default "Exit fullscreen"
 *
 * ---------------------------------------------------------------------------
 * STATE — classes on the component root (prefix configurable)
 * ---------------------------------------------------------------------------
 *   cc-ready       metadata has arrived, duration is known
 *   cc-started     has played at least once (use this to retire the poster)
 *   cc-playing     currently playing
 *   cc-paused      paused, not finished
 *   cc-ended       reached the end
 *   cc-muted       muted, or volume is zero
 *   cc-loading     stalled, waiting for data
 *   cc-scrubbing   the user is dragging the progress track
 *   cc-fullscreen  in fullscreen
 *   cc-no-fullscreen  this browser offers no fullscreen route — hide the
 *                     button with .cc-no-fullscreen [data-video-player=
 *                     "fullscreen"]{display:none}
 *   cc-disabled    switched off (desktop-only below the breakpoint)
 *
 * `data-video-player-state` carries the primary state as one word:
 * idle | playing | paused | ended | disabled.
 *
 * Progress is published two ways, pick whichever suits the design:
 *   - width on [data-video-player="progress-fill"] / "progress-buffer"
 *   - --video-player-progress / --video-player-buffer on the root ("42%")
 *
 * ---------------------------------------------------------------------------
 * MINIMUM CSS THE SITE MUST PROVIDE
 * ---------------------------------------------------------------------------
 * Nothing here hides anything, so the site decides what each state looks
 * like. A typical set:
 *
 *   .video-player_wrap.cc-started .video-player_poster { display: none; }
 *   .video-player_wrap.cc-playing .video-player_chip   { opacity: 0; }
 *   .video-player_wrap.cc-playing .video-player_icon-play  { display: none; }
 *   .video-player_wrap:not(.cc-playing) .video-player_icon-pause { display: none; }
 *
 * ---------------------------------------------------------------------------
 * API
 * ---------------------------------------------------------------------------
 *   MastVideoPlayer.init(scope?)   idempotent; call again after CMS renders
 *   MastVideoPlayer.get(element)   the instance for a component root
 *   MastVideoPlayer.all()          every live instance
 *   MastVideoPlayer.pauseAll()
 *   MastVideoPlayer.destroyAll()
 *
 * Each instance exposes: play, pause, toggle, skip, seekToRatio, setMuted,
 * toggleMute, toggleFullscreen, refresh, destroy.
 */
(function () {
  "use strict";

  /** Attribute that marks every part of the player. */
  const ATTR = "data-video-player";

  /** Prefix for option attributes, e.g. data-video-player-autoplay. */
  const OPT = ATTR + "-";

  /** Anything at or below this width counts as "not desktop". */
  const SMALL_SCREEN = 991;

  /** @type {WeakMap<HTMLElement, VideoPlayer>} Guards against double init. */
  const instances = new WeakMap();

  /** @type {VideoPlayer[]} Every live instance, for the public API. */
  const registry = [];

  /** Read once — changing the OS setting reloads the page anyway. */
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  /**
   * One player. Created per element carrying data-video-player="component".
   */
  class VideoPlayer {
    /**
     * @param {HTMLElement} root       the component wrapper
     * @param {HTMLVideoElement} video the <video> inside it
     */
    constructor(root, video) {
      this.root = root;
      this.video = video;

      /** Every listener we add, so destroy() can take them all back off. */
      this.listeners = [];
      /** IntersectionObservers, likewise. */
      this.observers = [];

      this.prefix = this.option("class-prefix") || "cc-";
      this.skipSeconds = this.numberOption("skip", 10);
      this.timeSeparator = this.option("time-separator") || " / ";

      this.loadRequested = false;
      this.hasStarted = false;
      this.isScrubbing = false;
      this.resumeAfterScrub = false;
      this.renderQueued = false;
      this.disabled = false;
      this.isVisible = true;
      /** Cache of the last string written to each text node. */
      this.lastText = new WeakMap();

      this.cacheParts();
      this.applyMediaProperties();
      this.bindMediaEvents();
      this.bindControls();
      this.bindProgress();
      this.bindKeyboard();
      this.bindFullscreen();
      this.setupDesktopOnly();
      this.setupPauseOffscreen();
      this.setupLazyLoad();

      this.syncState();
      this.render();
    }

    /* ------------------------------------------------------------------ *
     * Lookups
     * ------------------------------------------------------------------ */

    /**
     * Every element inside this component that plays the given role.
     * Scoped to the root, so sibling players never see each other.
     * @param {string} role
     * @returns {HTMLElement[]}
     */
    parts(role) {
      return Array.prototype.slice.call(
        this.root.querySelectorAll("[" + ATTR + '="' + role + '"]')
      );
    }

    /**
     * The first element playing the given role, or null.
     * @param {string} role
     * @returns {HTMLElement|null}
     */
    part(role) {
      return this.root.querySelector("[" + ATTR + '="' + role + '"]');
    }

    /**
     * Raw option value, or null when the attribute is absent or empty.
     * @param {string} name option name without the prefix
     * @returns {string|null}
     */
    option(name) {
      const value = this.root.getAttribute(OPT + name);
      return value === null || value === "" ? null : value;
    }

    /**
     * @param {string} name
     * @param {boolean} fallback used when the attribute is absent
     * @returns {boolean}
     */
    boolOption(name, fallback) {
      const value = this.option(name);
      if (value === null) return fallback;
      return value !== "false" && value !== "0";
    }

    /**
     * @param {string} name
     * @param {number} fallback used when absent or unparseable
     * @returns {number}
     */
    numberOption(name, fallback) {
      const value = parseFloat(this.option(name));
      return isFinite(value) ? value : fallback;
    }

    /**
     * addEventListener that remembers itself, so destroy() is complete.
     * @param {EventTarget} target
     * @param {string} type
     * @param {Function} handler
     * @param {Object|boolean} [options]
     */
    on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      this.listeners.push({ target, type, handler, options });
    }

    /* ------------------------------------------------------------------ *
     * Setup
     * ------------------------------------------------------------------ */

    /** Resolve every role once, up front. No DOM queries in handlers. */
    cacheParts() {
      this.posters = this.parts("poster");
      this.progressTrack = this.part("progress");
      this.progressFills = this.parts("progress-fill");
      this.progressBuffers = this.parts("progress-buffer");
      this.timeCurrentLabels = this.parts("time-current");
      this.timeDurationLabels = this.parts("time-duration");
      this.timeLabels = this.parts("time");
      this.muteButtons = this.parts("mute");
      this.toggleButtons = this.parts("toggle");
      this.fullscreenButtons = this.parts("fullscreen");
    }

    /**
     * Webflow strips the boolean `muted` and `loop` attributes when it
     * publishes. Setting the IDL properties here is the only reliable way
     * to get them, so the data attributes above are the source of truth and
     * we always re-apply them.
     */
    applyMediaProperties() {
      const video = this.video;
      const wantsAutoplay = this.boolOption("autoplay", false);

      // Autoplay is only permitted while muted, so it implies muted.
      const muted =
        this.boolOption("muted", video.hasAttribute("muted")) || wantsAutoplay;

      video.muted = muted;
      video.loop = this.boolOption("loop", video.hasAttribute("loop"));
      video.playsInline = true;
      video.setAttribute("playsinline", "");

      const preload = this.option("preload");
      if (preload) video.preload = preload;

      // A custom bar is pointless next to the browser's own.
      video.removeAttribute("controls");

      this.wantsAutoplay = wantsAutoplay && !prefersReducedMotion;
    }

    /**
     * State is derived from the video's own events, never from the click
     * that caused them. However playback changed — a click, a keypress, the
     * end of the file, another script — the classes stay correct.
     */
    bindMediaEvents() {
      const video = this.video;
      const sync = () => this.syncState();
      const render = () => this.requestRender();

      this.on(video, "loadedmetadata", () => {
        this.syncState();
        this.render();
      });
      this.on(video, "durationchange", render);
      this.on(video, "timeupdate", render);
      this.on(video, "progress", render);
      this.on(video, "seeking", render);
      this.on(video, "seeked", render);

      this.on(video, "play", () => {
        this.hasStarted = true;
        this.syncState();
      });
      this.on(video, "playing", sync);
      this.on(video, "pause", sync);
      this.on(video, "volumechange", sync);
      this.on(video, "waiting", sync);
      this.on(video, "canplay", sync);
      this.on(video, "stalled", sync);

      this.on(video, "ended", () => {
        if (this.boolOption("reset-on-end", false)) video.currentTime = 0;
        this.syncState();
        this.render();
      });

      this.on(video, "error", () => this.setState("loading", false));
    }

    /** Wire every button role. Each one is optional. */
    bindControls() {
      this.parts("play").forEach((el) => {
        this.prepareButton(el, this.option("label-play") || "Play");
        this.on(el, "click", (event) => {
          event.preventDefault();
          this.play();
        });
      });

      this.parts("pause").forEach((el) => {
        this.prepareButton(el, this.option("label-pause") || "Pause");
        this.on(el, "click", (event) => {
          event.preventDefault();
          this.pause();
        });
      });

      this.toggleButtons.forEach((el) => {
        this.prepareButton(el, this.option("label-play") || "Play");
        this.on(el, "click", (event) => {
          event.preventDefault();
          this.toggle();
        });
      });

      this.parts("back").forEach((el) => {
        this.prepareButton(el, "Back " + this.skipSeconds + " seconds");
        this.on(el, "click", (event) => {
          event.preventDefault();
          this.skip(-this.skipSeconds);
        });
      });

      this.parts("forward").forEach((el) => {
        this.prepareButton(el, "Forward " + this.skipSeconds + " seconds");
        this.on(el, "click", (event) => {
          event.preventDefault();
          this.skip(this.skipSeconds);
        });
      });

      this.muteButtons.forEach((el) => {
        this.prepareButton(el, this.option("label-mute") || "Mute");
        this.on(el, "click", (event) => {
          event.preventDefault();
          this.toggleMute();
        });
      });

      if (this.boolOption("click-to-toggle", true)) {
        this.on(this.video, "click", () => this.toggle());
      }

      // The poster overlay is a play affordance whether or not it is a button.
      this.posters.forEach((el) => this.on(el, "click", () => this.play()));
    }

    /**
     * Make a non-button element behave like one for keyboard and screen
     * reader users. A real <button> already has all of this.
     * @param {HTMLElement} el
     * @param {string} label
     */
    prepareButton(el, label) {
      const isButton = el.tagName === "BUTTON";

      if (isButton) {
        // Without an explicit type, a button inside a form submits it.
        if (!el.hasAttribute("type")) el.setAttribute("type", "button");
      } else {
        if (!el.hasAttribute("role")) el.setAttribute("role", "button");
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
        this.on(el, "keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            el.click();
          }
        });
      }

      // An icon-only control has no accessible name until we give it one.
      if (!el.hasAttribute("aria-label") && !el.textContent.trim()) {
        el.setAttribute("aria-label", label);
      }
    }

    /**
     * Click, drag and keyboard seeking on the progress track.
     *
     * Pointer events with setPointerCapture keep the drag alive when the
     * cursor leaves the track — no document-level listeners to leak, and
     * mouse, touch and pen all take the same path.
     */
    bindProgress() {
      const track = this.progressTrack;
      if (!track) return;

      // The track is a slider, so tell assistive tech that.
      if (!track.hasAttribute("role")) track.setAttribute("role", "slider");
      if (!track.hasAttribute("tabindex")) track.setAttribute("tabindex", "0");
      if (!track.hasAttribute("aria-label")) {
        track.setAttribute("aria-label", "Seek");
      }
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");

      // Stop the browser turning a drag into a scroll or a text selection.
      track.style.touchAction = "none";

      const ratioFromEvent = (event) => {
        const box = track.getBoundingClientRect();
        if (!box.width) return 0;
        return (event.clientX - box.left) / box.width;
      };

      this.on(track, "pointerdown", (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();

        this.isScrubbing = true;
        this.resumeAfterScrub = !this.video.paused && !this.video.ended;
        if (this.resumeAfterScrub) this.video.pause();

        this.setState("scrubbing", true);
        if (track.setPointerCapture) track.setPointerCapture(event.pointerId);
        this.seekToRatio(ratioFromEvent(event));
      });

      this.on(track, "pointermove", (event) => {
        if (!this.isScrubbing) return;
        this.seekToRatio(ratioFromEvent(event));
      });

      const endScrub = (event) => {
        if (!this.isScrubbing) return;
        this.isScrubbing = false;
        this.setState("scrubbing", false);

        if (track.releasePointerCapture && event.pointerId != null) {
          try {
            track.releasePointerCapture(event.pointerId);
          } catch (error) {
            /* the pointer was already released */
          }
        }

        if (this.resumeAfterScrub) this.play();
        this.resumeAfterScrub = false;
      };

      this.on(track, "pointerup", endScrub);
      this.on(track, "pointercancel", endScrub);

      this.on(track, "keydown", (event) => {
        if (!this.duration()) return;
        switch (event.key) {
          case "ArrowLeft":
            this.skip(-this.skipSeconds);
            break;
          case "ArrowRight":
            this.skip(this.skipSeconds);
            break;
          case "Home":
            this.seekToRatio(0);
            break;
          case "End":
            this.seekToRatio(1);
            break;
          default:
            return;
        }
        event.preventDefault();
      });
    }

    /**
     * Keyboard shortcuts, active while the component itself has focus.
     * Skipped when the user is typing into a field, and when focus is on a
     * control that handles its own keys.
     */
    bindKeyboard() {
      if (!this.boolOption("keyboard", true)) return;

      // Focus has to be able to land on the component for this to fire.
      if (!this.root.hasAttribute("tabindex")) {
        this.root.setAttribute("tabindex", "0");
      }

      this.on(this.root, "keydown", (event) => {
        const target = event.target;
        if (target !== this.root) return;

        switch (event.key) {
          case " ":
          case "k":
            this.toggle();
            break;
          case "ArrowLeft":
            this.skip(-this.skipSeconds);
            break;
          case "ArrowRight":
            this.skip(this.skipSeconds);
            break;
          case "ArrowUp":
            this.video.volume = Math.min(1, this.video.volume + 0.1);
            break;
          case "ArrowDown":
            this.video.volume = Math.max(0, this.video.volume - 0.1);
            break;
          case "m":
            this.toggleMute();
            break;
          case "f":
            this.toggleFullscreen();
            break;
          case "Home":
            this.seekToRatio(0);
            break;
          case "End":
            this.seekToRatio(1);
            break;
          default:
            return;
        }
        event.preventDefault();
      });
    }

    /**
     * Fullscreen toggle, plus the state class for however fullscreen was
     * entered or left — our button, the Esc key, or the browser's own chrome.
     */
    bindFullscreen() {
      this.fullscreenButtons.forEach((el) => {
        this.prepareButton(el, this.option("label-fullscreen") || "Fullscreen");
        this.on(el, "click", (event) => {
          event.preventDefault();
          this.toggleFullscreen();
        });
      });

      // No route at all — an old browser, or an iframe without
      // allowfullscreen. Publish it so the button can be hidden in CSS
      // rather than sitting there doing nothing.
      if (!this.canFullscreen()) this.setState("no-fullscreen", true);

      const sync = () => {
        this.setState("fullscreen", this.isFullscreen());
        this.syncState();
      };

      // Safari below 16.4 only fires the prefixed event.
      this.on(document, "fullscreenchange", sync);
      this.on(document, "webkitfullscreenchange", sync);

      // iPhone has no element fullscreen. The video goes fullscreen on its
      // own and reports it through these two events instead.
      this.on(this.video, "webkitbeginfullscreen", sync);
      this.on(this.video, "webkitendfullscreen", sync);
    }

    /**
     * Whether any fullscreen route exists in this browser.
     * @returns {boolean}
     */
    canFullscreen() {
      return !!(
        this.root.requestFullscreen ||
        this.root.webkitRequestFullscreen ||
        this.video.webkitEnterFullscreen ||
        this.video.webkitSupportsFullscreen
      );
    }

    /**
     * Whether this player is what is currently fullscreen.
     *
     * Checks the video as well as the wrapper, because the iPhone route
     * fullscreens the video element rather than the component.
     *
     * @returns {boolean}
     */
    isFullscreen() {
      const current =
        document.fullscreenElement || document.webkitFullscreenElement || null;
      if (current) return current === this.root || current === this.video;
      return !!this.video.webkitDisplayingFullscreen;
    }

    /**
     * Mast parity: some videos are decoration and have no business
     * downloading on a phone. Below the breakpoint the player is switched
     * off entirely — no source, no playback, `cc-disabled` on the root.
     */
    setupDesktopOnly() {
      if (!this.boolOption("desktop-only", false)) return;

      const apply = () => {
        const shouldDisable = window.innerWidth <= SMALL_SCREEN;
        if (shouldDisable === this.disabled) return;

        this.disabled = shouldDisable;
        if (shouldDisable) this.video.pause();
        else if (this.isVisible) this.load();

        this.syncState();
      };

      apply();

      // Debounced: resize fires continuously while a window is dragged.
      let timer = null;
      this.on(window, "resize", () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(apply, 150);
      });
    }

    /**
     * Defer the download until the player is near the viewport.
     *
     * This is the single biggest win over a plain `src` on the element: a
     * page with four videos below the fold downloads none of them until you
     * scroll, instead of competing for bandwidth during first paint.
     */
    setupLazyLoad() {
      const hasLazySource = !!(
        this.option("src") ||
        this.video.getAttribute("data-src") ||
        this.video.querySelector("source[data-src]")
      );

      if (!hasLazySource || !this.boolOption("lazy", true)) {
        // Nothing deferred — the markup already carries a real src.
        this.loadRequested = true;
        if (this.wantsAutoplay && !this.disabled) this.play();
        return;
      }

      if (!("IntersectionObserver" in window)) {
        this.load().then(() => {
          if (this.wantsAutoplay) this.play();
        });
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            observer.unobserve(entry.target);
            this.load().then(() => {
              if (this.wantsAutoplay) this.play();
            });
          });
        },
        { rootMargin: this.option("root-margin") || "200px", threshold: 0 }
      );

      observer.observe(this.root);
      this.observers.push(observer);
    }

    /** Stop playback the moment the player scrolls away. Opt-in. */
    setupPauseOffscreen() {
      if (!this.boolOption("pause-offscreen", false)) return;
      if (!("IntersectionObserver" in window)) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            this.isVisible = entry.isIntersecting;
            if (entry.isIntersecting) {
              if (this.wantsAutoplay) this.play();
            } else {
              this.video.pause();
            }
          });
        },
        { threshold: 0.25 }
      );

      observer.observe(this.root);
      this.observers.push(observer);
    }

    /* ------------------------------------------------------------------ *
     * Loading
     * ------------------------------------------------------------------ */

    /**
     * Promote the deferred URLs to real ones and wait for metadata.
     *
     * Resolving on `loadedmetadata` rather than `canplaythrough` matters:
     * metadata is enough to know the duration and to start playing, and it
     * arrives in a few kilobytes instead of after the whole file has
     * buffered.
     *
     * @returns {Promise<void>}
     */
    load() {
      if (this.loadRequested || this.disabled) return Promise.resolve();
      this.loadRequested = true;

      const video = this.video;

      const posterSrc = this.option("poster-src");
      if (posterSrc && !video.poster) video.poster = posterSrc;

      const directSrc = this.option("src") || video.getAttribute("data-src");
      const lazySources = video.querySelectorAll("source[data-src]");
      let changed = false;

      if (directSrc && !video.getAttribute("src")) {
        video.setAttribute("src", directSrc);
        changed = true;
      } else if (lazySources.length) {
        lazySources.forEach((source) => {
          if (source.getAttribute("src")) return;
          source.setAttribute("src", source.getAttribute("data-src"));
          changed = true;
        });
      }

      if (!changed) return Promise.resolve();

      video.load();

      return new Promise((resolve) => {
        if (video.readyState >= 1) {
          resolve();
          return;
        }
        const done = () => {
          video.removeEventListener("loadedmetadata", done);
          video.removeEventListener("error", done);
          resolve();
        };
        video.addEventListener("loadedmetadata", done);
        video.addEventListener("error", done);
      });
    }

    /* ------------------------------------------------------------------ *
     * Playback
     * ------------------------------------------------------------------ */

    /**
     * Start playing, loading the source first if it is still deferred.
     *
     * play() is called immediately, before the load promise, so the click's
     * user activation is spent inside the gesture. Browsers stop trusting a
     * gesture that has been sitting in a promise queue, and the second call
     * after load() covers the case where the first one had no source yet.
     */
    play() {
      if (this.disabled) return;

      const attempt = () => {
        const promise = this.video.play();
        if (promise && promise.catch) {
          promise.catch(() => {
            /* autoplay refused, or a newer load interrupted this one */
          });
        }
      };

      attempt();
      if (!this.loadRequested) this.load().then(attempt);
    }

    /** Pause playback. */
    pause() {
      this.video.pause();
    }

    /** Play if paused, pause if playing. */
    toggle() {
      if (this.video.paused || this.video.ended) this.play();
      else this.pause();
    }

    /**
     * Move the playhead by a number of seconds, clamped to the file.
     * @param {number} seconds negative seeks backwards
     */
    skip(seconds) {
      const duration = this.duration();
      if (!duration) return;
      this.video.currentTime = Math.max(
        0,
        Math.min(duration, this.video.currentTime + seconds)
      );
      this.requestRender();
    }

    /**
     * Jump to a fraction of the duration.
     * @param {number} ratio 0 to 1, clamped
     */
    seekToRatio(ratio) {
      const duration = this.duration();
      if (!duration) return;
      this.video.currentTime = Math.max(0, Math.min(1, ratio)) * duration;
      this.requestRender();
    }

    /** @param {boolean} muted */
    setMuted(muted) {
      this.video.muted = !!muted;
    }

    /** Flip the mute state. */
    toggleMute() {
      this.video.muted = !this.video.muted;
    }

    /**
     * Enter or leave fullscreen. Three routes, in order of preference:
     *
     *   1. Element Fullscreen on the WRAPPER — desktop, Android, iPad. The
     *      whole component goes fullscreen, so our control bar goes with it.
     *   2. The webkit-prefixed version of the same — Safari below 16.4.
     *   3. video.webkitEnterFullscreen() — iPhone, which has no element
     *      fullscreen at all. This hands playback to Apple's own player,
     *      with Apple's controls. Nothing can be done about that.
     */
    toggleFullscreen() {
      if (this.isFullscreen()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
        else if (this.video.webkitExitFullscreen) {
          this.video.webkitExitFullscreen();
        }
        return;
      }

      const request =
        this.root.requestFullscreen || this.root.webkitRequestFullscreen;

      if (request) {
        // May reject when called outside a user gesture — that is fine.
        const result = request.call(this.root);
        if (result && result.catch) result.catch(() => {});
      } else if (this.video.webkitEnterFullscreen) {
        this.video.webkitEnterFullscreen();
      }
    }

    /**
     * The duration, or 0 while it is unknown or infinite (a live stream).
     * @returns {number}
     */
    duration() {
      const duration = this.video.duration;
      return isFinite(duration) && duration > 0 ? duration : 0;
    }

    /* ------------------------------------------------------------------ *
     * State and rendering
     * ------------------------------------------------------------------ */

    /**
     * Toggle one state class on the root.
     * @param {string} name state name without the prefix
     * @param {boolean} on
     */
    setState(name, on) {
      this.root.classList.toggle(this.prefix + name, !!on);
    }

    /** Recompute every state class from the video's current properties. */
    syncState() {
      const video = this.video;
      const playing = !video.paused && !video.ended;

      this.setState("disabled", this.disabled);
      this.setState("ready", video.readyState >= 1);
      this.setState("started", this.hasStarted);
      this.setState("playing", playing);
      this.setState("paused", video.paused && !video.ended);
      this.setState("ended", video.ended);
      this.setState("muted", video.muted || video.volume === 0);
      this.setState("loading", playing && video.readyState < 3);

      this.root.setAttribute(OPT + "state", this.primaryState(playing));

      // aria-pressed says "is this toggle currently engaged", which is
      // exactly what a mute button and a play/pause toggle are.
      const muteLabel = video.muted
        ? this.option("label-unmute") || "Unmute"
        : this.option("label-mute") || "Mute";

      this.muteButtons.forEach((el) => {
        el.setAttribute("aria-pressed", video.muted ? "true" : "false");
        if (!el.textContent.trim()) el.setAttribute("aria-label", muteLabel);
      });

      const toggleLabel = playing
        ? this.option("label-pause") || "Pause"
        : this.option("label-play") || "Play";

      this.toggleButtons.forEach((el) => {
        el.setAttribute("aria-pressed", playing ? "true" : "false");
        if (!el.textContent.trim()) el.setAttribute("aria-label", toggleLabel);
      });

      // No aria-pressed here: a screen reader already announces the change
      // through the label, and saying it twice is worse than saying it once.
      const fullscreenLabel = this.isFullscreen()
        ? this.option("label-exit-fullscreen") || "Exit fullscreen"
        : this.option("label-fullscreen") || "Fullscreen";

      this.fullscreenButtons.forEach((el) => {
        if (!el.textContent.trim()) {
          el.setAttribute("aria-label", fullscreenLabel);
        }
      });
    }

    /**
     * The one-word state for data-video-player-state.
     * @param {boolean} playing
     * @returns {string}
     */
    primaryState(playing) {
      if (this.disabled) return "disabled";
      if (this.video.ended) return "ended";
      if (playing) return "playing";
      return this.hasStarted ? "paused" : "idle";
    }

    /**
     * Ask for one render at the next repaint.
     *
     * timeupdate fires a few times a second, but a drag can fire
     * pointermove dozens of times between two frames. Coalescing through
     * requestAnimationFrame means the DOM is written once per painted
     * frame no matter how noisy the input is.
     */
    requestRender() {
      if (this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        this.render();
      });
    }

    /** Write the progress bar, the time labels and the track's aria state. */
    render() {
      const video = this.video;
      const duration = this.duration();
      const current = video.currentTime || 0;
      const playedPercent = duration ? (current / duration) * 100 : 0;
      const bufferedPercent = this.bufferedPercent(duration, current);

      this.root.style.setProperty(
        "--video-player-progress",
        playedPercent + "%"
      );
      this.root.style.setProperty(
        "--video-player-buffer",
        bufferedPercent + "%"
      );

      this.progressFills.forEach((el) => {
        el.style.width = playedPercent + "%";
      });
      this.progressBuffers.forEach((el) => {
        el.style.width = bufferedPercent + "%";
      });

      const currentText = formatTime(current);
      const durationText = formatTime(duration);

      this.timeCurrentLabels.forEach((el) => this.setText(el, currentText));
      this.timeDurationLabels.forEach((el) => this.setText(el, durationText));
      this.timeLabels.forEach((el) =>
        this.setText(el, currentText + this.timeSeparator + durationText)
      );

      if (this.progressTrack) {
        this.progressTrack.setAttribute(
          "aria-valuenow",
          String(Math.round(playedPercent))
        );
        this.progressTrack.setAttribute(
          "aria-valuetext",
          currentText + " of " + durationText
        );
      }
    }

    /**
     * How far the buffer reaches, as a percentage.
     *
     * `buffered` is a list of ranges, not one number — seeking around
     * leaves holes. Only the range containing the playhead is meaningful
     * for a progress bar.
     *
     * @param {number} duration
     * @param {number} current
     * @returns {number}
     */
    bufferedPercent(duration, current) {
      const buffered = this.video.buffered;
      if (!duration || !buffered || !buffered.length) return 0;

      for (let i = 0; i < buffered.length; i++) {
        if (buffered.start(i) <= current && buffered.end(i) >= current) {
          return (buffered.end(i) / duration) * 100;
        }
      }
      return 0;
    }

    /**
     * Write text only when it actually changed.
     *
     * A time label updates four times a second per player. Assigning the
     * same string still dirties the node and costs a layout, so the cache
     * earns its WeakMap.
     *
     * @param {HTMLElement} el
     * @param {string} text
     */
    setText(el, text) {
      if (this.lastText.get(el) === text) return;
      this.lastText.set(el, text);
      el.textContent = text;
    }

    /* ------------------------------------------------------------------ *
     * Lifecycle
     * ------------------------------------------------------------------ */

    /** Re-read the roles after the markup inside the component changed. */
    refresh() {
      this.cacheParts();
      this.syncState();
      this.render();
    }

    /** Remove every listener and observer, and clear the state classes. */
    destroy() {
      this.listeners.forEach(({ target, type, handler, options }) => {
        target.removeEventListener(type, handler, options);
      });
      this.listeners = [];

      this.observers.forEach((observer) => observer.disconnect());
      this.observers = [];

      STATE_NAMES.forEach((name) => this.setState(name, false));
      this.root.removeAttribute(OPT + "state");

      instances.delete(this.root);
      const index = registry.indexOf(this);
      if (index > -1) registry.splice(index, 1);
    }
  }

  /* -------------------------------------------------------------------- *
   * Helpers
   * -------------------------------------------------------------------- */

  /** Every state class this library owns. Used to clean up on destroy. */
  const STATE_NAMES = [
    "ready",
    "started",
    "playing",
    "paused",
    "ended",
    "muted",
    "loading",
    "scrubbing",
    "fullscreen",
    "no-fullscreen",
    "disabled",
  ];

  /**
   * Seconds to "m:ss", or "h:mm:ss" once it runs past an hour.
   * @param {number} seconds
   * @returns {string}
   */
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;

    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = (value) => (value < 10 ? "0" + value : String(value));

    return hours
      ? hours + ":" + pad(minutes) + ":" + pad(secs)
      : minutes + ":" + pad(secs);
  }

  /* -------------------------------------------------------------------- *
   * Bootstrap
   * -------------------------------------------------------------------- */

  /**
   * Find every player in `scope` and wire it up.
   *
   * Safe to call as often as you like: components that already have an
   * instance are skipped, so this is the hook to call after a CMS list, a
   * slider clone or a modal injects new markup.
   *
   * @param {ParentNode} [scope=document]
   * @returns {VideoPlayer[]} the instances created by this call
   */
  function init(scope) {
    const root = scope || document;
    const created = [];

    const components = Array.prototype.slice.call(
      root.querySelectorAll("[" + ATTR + '="component"]')
    );

    // Resilience: a <video data-video-player="media"> with no component
    // wrapper still works — its parent becomes the component.
    root.querySelectorAll("video[" + ATTR + '="media"]').forEach((video) => {
      const owner = video.closest("[" + ATTR + '="component"]');
      const parent = video.parentElement;
      if (!owner && parent && components.indexOf(parent) === -1) {
        components.push(parent);
      }
    });

    components.forEach((component) => {
      if (instances.has(component)) return;

      const video =
        component.querySelector("video[" + ATTR + '="media"]') ||
        component.querySelector("video");

      if (!video) return;

      const player = new VideoPlayer(component, video);
      instances.set(component, player);
      registry.push(player);
      created.push(player);
    });

    return created;
  }

  /** Public API. */
  const api = {
    init,

    /**
     * @param {HTMLElement} element a component root
     * @returns {VideoPlayer|undefined}
     */
    get(element) {
      return instances.get(element);
    },

    /** @returns {VideoPlayer[]} every live instance */
    all() {
      return registry.slice();
    },

    pauseAll() {
      registry.forEach((player) => player.pause());
    },

    destroyAll() {
      registry.slice().forEach((player) => player.destroy());
    },

    VideoPlayer,
  };

  window.MastVideoPlayer = api;

  /**
   * Auto-initialise.
   *
   * The readyState check matters more than it looks. A bare
   * DOMContentLoaded listener never fires if the script is cached, deferred
   * or injected late — the event has already been and gone. This covers
   * both cases, which is why every Mast file is written this way.
   */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init();
    });
  } else {
    init();
  }

  // Export for module usage.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
