/*!
 * video-modal.js — Mast (GeekyGrowth fork)
 *
 * Companion to modal.js. That file opens and closes <dialog> elements; this
 * one manages whatever video is inside them.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * A closed <dialog> is display:none, so everything inside it is 0x0. A
 * YouTube iframe that loads in that state initialises its player at zero
 * size, picks the smallest poster image it has, and never re-picks — so the
 * first time you open the modal you get a heavily upscaled, blocky thumbnail.
 * Open it a second time and it looks fine, which makes the bug maddening to
 * track down.
 *
 * The fix is to not load the embed until the dialog is actually open, and to
 * unload it again on close — which also stops playback, so this replaces the
 * usual "reset the src on close" snippet.
 *
 * Three things fall out of that:
 *   - sharp thumbnails, because the player measures itself at full size
 *   - no YouTube player (~1MB) on page views where nobody opens the modal
 *   - nothing loads or autoplays in the Webflow Designer, because the URL
 *     sits in data-src and only this script ever promotes it
 *
 * ---------------------------------------------------------------------------
 * MARKUP
 * ---------------------------------------------------------------------------
 * Nothing to configure. Every <dialog> on the page is picked up, and any
 * <iframe> inside one is managed.
 *
 *   <dialog>
 *     <iframe data-src="https://www.youtube-nocookie.com/embed/ID?autoplay=1&rel=0"></iframe>
 *   </dialog>
 *
 * Put the URL in data-src. A plain src is also accepted and moved to data-src
 * on init, but by then it has already loaded once, and it will autoplay at
 * you in the Designer — which is the whole thing we are avoiding.
 *
 * autoplay=1 is worth having: opening the modal is a user gesture, so the
 * player may start immediately instead of making the visitor click twice.
 *
 * Native <video> elements inside a dialog are paused on close. They are not
 * unloaded — they have no third-party player to tear down.
 *
 * ---------------------------------------------------------------------------
 * OPTIONS — attributes on the <dialog>
 * ---------------------------------------------------------------------------
 *   data-video-modal="ignore"           leave this dialog alone entirely
 *   data-video-modal-keep-loaded="true" pause on close instead of unloading,
 *                                       so reopening is instant. Requires
 *                                       enablejsapi=1 on the embed URL.
 *                                       Costs memory and holds the
 *                                       connection open; worth it only when
 *                                       people reopen the same video.
 *
 * ---------------------------------------------------------------------------
 * API
 * ---------------------------------------------------------------------------
 *   MastVideoModal.init(scope?)   idempotent; call again after CMS renders
 *   MastVideoModal.unloadAll()    stop and unload every managed embed
 */
(function () {
  "use strict";

  /** Dialogs already wired, so init() can be called as often as you like. */
  const handled = new WeakSet();

  /**
   * The URL this iframe should eventually load.
   * @param {HTMLIFrameElement} iframe
   * @returns {string}
   */
  function urlFor(iframe) {
    return iframe.getAttribute("data-src") || iframe.getAttribute("src") || "";
  }

  /**
   * Ask a YouTube embed to pause without tearing it down.
   *
   * Needs enablejsapi=1 on the embed URL. Without it the message is simply
   * ignored, which is why this is opt-in — silently doing nothing would be
   * worse than unloading.
   *
   * @param {HTMLIFrameElement} iframe
   */
  function pauseEmbed(iframe) {
    if (!iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        '{"event":"command","func":"pauseVideo","args":""}',
        "*"
      );
    } catch (error) {
      /* frame not ready, or not a player that speaks this protocol */
    }
  }

  /**
   * Wire one dialog.
   * @param {HTMLDialogElement} dialog
   * @returns {boolean} whether it was newly wired
   */
  function setupDialog(dialog) {
    if (handled.has(dialog)) return false;
    if (dialog.getAttribute("data-video-modal") === "ignore") return false;

    const frames = [];

    dialog.querySelectorAll("iframe").forEach(function (iframe) {
      const url = urlFor(iframe);
      if (!url) return;

      // Park the URL. removeAttribute rather than src="" — an empty src
      // makes some browsers load the current page into the iframe.
      iframe.setAttribute("data-src", url);
      iframe.removeAttribute("src");
      frames.push(iframe);
    });

    const videos = dialog.querySelectorAll("video");
    if (!frames.length && !videos.length) return false;

    handled.add(dialog);

    const keepLoaded =
      dialog.getAttribute("data-video-modal-keep-loaded") === "true";

    function load() {
      frames.forEach(function (iframe) {
        if (iframe.getAttribute("src")) return;
        iframe.setAttribute("src", iframe.getAttribute("data-src"));
      });
    }

    function stop() {
      frames.forEach(function (iframe) {
        if (keepLoaded) pauseEmbed(iframe);
        else iframe.removeAttribute("src");
      });
      videos.forEach(function (video) {
        video.pause();
      });
    }

    // <dialog> fires "close" but has no matching "open" event, and modal.js
    // is what calls showModal() — so watch the attribute rather than trying
    // to hook whichever button happened to open it.
    //
    // Assigning src here rather than inside requestAnimationFrame is
    // deliberate: rAF does not fire in a background tab, which would leave
    // the video never loading for anyone who opened the modal in one.
    // Layout is recalculated before the iframe's document loads anyway.
    new MutationObserver(function () {
      if (dialog.open) load();
      else stop();
    }).observe(dialog, { attributes: true, attributeFilter: ["open"] });

    // Also catch close directly: Esc and <form method="dialog"> both fire it.
    dialog.addEventListener("close", stop);

    // modal.js can open a dialog on load, before we got here.
    if (dialog.open) load();

    return true;
  }

  /**
   * Find every dialog in `scope` and wire it up.
   *
   * Safe to call repeatedly — dialogs already wired are skipped — so this is
   * the hook to use after a CMS list or a component injects new markup.
   *
   * @param {ParentNode} [scope=document]
   * @returns {number} how many dialogs were newly wired
   */
  function init(scope) {
    const root = scope || document;
    const dialogs = root.querySelectorAll("dialog");

    // Early exit: most pages have no dialogs at all.
    if (!dialogs.length) return 0;

    let wired = 0;
    dialogs.forEach(function (dialog) {
      if (setupDialog(dialog)) wired++;
    });
    return wired;
  }

  const api = {
    init: init,

    /** Stop and unload every managed embed, wherever it is. */
    unloadAll: function () {
      document.querySelectorAll("dialog iframe[data-src]").forEach(function (iframe) {
        iframe.removeAttribute("src");
      });
      document.querySelectorAll("dialog video").forEach(function (video) {
        video.pause();
      });
    },
  };

  window.MastVideoModal = api;

  /**
   * A bare DOMContentLoaded listener never fires if the script is cached,
   * deferred or injected late — the event has already been and gone. This
   * covers both cases, which is how every Mast file is written.
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
