/*!
 * video-modal.js — Mast (GeekyGrowth fork)
 *
 * Companion to modal.js. That file opens and closes <dialog> elements; this
 * one loads and unloads the video embed inside the YouTube Modal component.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * A closed <dialog> is display:none, so everything inside it is 0x0. A
 * YouTube iframe that loads in that state initialises its player at zero
 * size, picks the smallest poster image it has, and never re-picks — so the
 * first open shows a blocky, upscaled thumbnail. The second open looks fine,
 * which makes it a maddening bug to track down.
 *
 * So the embed is not loaded until the dialog is open, and it is unloaded
 * again on close — which also stops playback, replacing the usual
 * reset-the-src-on-close snippet.
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
 * Only iframes carrying data-video-modal="embed" are touched, so other
 * iframes in other dialogs — maps, forms, anything — are left alone.
 *
 *   <dialog>
 *     <iframe
 *       data-video-modal="embed"
 *       data-src="https://www.youtube-nocookie.com/embed/ID?autoplay=1&rel=0">
 *     </iframe>
 *   </dialog>
 *
 * The iframe must be inside a <dialog>; that dialog is found automatically.
 *
 * Put the URL in data-src. A plain src is accepted and moved on init, but by
 * then it has already loaded once and will autoplay at you in the Designer,
 * which is the thing we are avoiding.
 *
 * autoplay=1 is worth having: opening the modal is a user gesture, so the
 * player can start straight away instead of making the visitor click twice.
 *
 * ---------------------------------------------------------------------------
 * API
 * ---------------------------------------------------------------------------
 *   MastVideoModal.init(scope?)   idempotent; call again after CMS renders
 */
(function () {
  "use strict";

  /** The only thing this file touches. */
  const SELECTOR = '[data-video-modal="embed"]';

  /** dialog -> the embeds inside it. */
  const managed = new WeakMap();

  /** Embeds already parked, so init() can be called as often as you like. */
  const known = new WeakSet();

  /**
   * Promote every parked URL in this dialog to a real src.
   * @param {HTMLDialogElement} dialog
   */
  function load(dialog) {
    (managed.get(dialog) || []).forEach(function (iframe) {
      if (iframe.getAttribute("src")) return;
      iframe.setAttribute("src", iframe.getAttribute("data-src"));
    });
  }

  /**
   * Tear the embeds down, which is what stops playback.
   * @param {HTMLDialogElement} dialog
   */
  function unload(dialog) {
    (managed.get(dialog) || []).forEach(function (iframe) {
      iframe.removeAttribute("src");
    });
  }

  /**
   * Start following a dialog's open state. Called once per dialog; the
   * handlers read the embed list at call time, so embeds discovered by a
   * later init() are picked up without a second observer.
   *
   * @param {HTMLDialogElement} dialog
   */
  function watch(dialog) {
    // <dialog> fires "close" but has no matching "open" event, and modal.js
    // is what calls showModal() — so watch the attribute rather than trying
    // to hook whichever button happened to open it.
    //
    // Assigning src here rather than inside requestAnimationFrame is
    // deliberate: rAF does not fire in a background tab, which would leave
    // the video never loading for anyone who opened the modal in one.
    // Layout is recalculated before the iframe's document loads anyway.
    new MutationObserver(function () {
      if (dialog.open) load(dialog);
      else unload(dialog);
    }).observe(dialog, { attributes: true, attributeFilter: ["open"] });

    // Esc and <form method="dialog"> both fire close without necessarily
    // going through anything else we can see.
    dialog.addEventListener("close", function () {
      unload(dialog);
    });
  }

  /**
   * Find every embed in `scope` and wire up the dialog around it.
   *
   * Safe to call repeatedly — embeds already parked are skipped — so this is
   * the hook to use after a CMS list or a component injects new markup.
   *
   * @param {ParentNode} [scope=document]
   * @returns {number} how many embeds were newly parked
   */
  function init(scope) {
    const root = scope || document;
    const embeds = root.querySelectorAll(SELECTOR);

    // Early exit: most pages have no video modal on them at all.
    if (!embeds.length) return 0;

    let parked = 0;

    embeds.forEach(function (iframe) {
      if (known.has(iframe)) return;

      const dialog = iframe.closest("dialog");
      if (!dialog) return;

      const url = iframe.getAttribute("data-src") || iframe.getAttribute("src");
      if (!url) return;

      // Park the URL. removeAttribute rather than src="" — an empty src
      // makes some browsers load the current page into the iframe.
      iframe.setAttribute("data-src", url);
      iframe.removeAttribute("src");

      known.add(iframe);
      parked++;

      if (managed.has(dialog)) {
        managed.get(dialog).push(iframe);
      } else {
        managed.set(dialog, [iframe]);
        watch(dialog);
      }

      // modal.js can open a dialog on load, before we got here.
      if (dialog.open) load(dialog);
    });

    return parked;
  }

  const api = { init: init };

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
