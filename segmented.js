/*
 * Sliding selection for pill (segmented) controls.
 *
 * Adds one "thumb" behind a control's options that glides to the selected one
 * instead of each pill filling itself in. Works for native radios inside labels
 * (the Sector View toggle) and for role="radio" buttons with aria-checked (the
 * Frameworks group switch). Controls marked [data-segmented] in the page are set up
 * on load; ones built later call window.segmented(element).
 */
(() => {
  'use strict';

  const options = control => [...control.children].filter(el => !el.classList.contains('seg-thumb'));
  const selected = control => options(control).find(el =>
    el.getAttribute('aria-checked') === 'true' || el.querySelector?.('input:checked'));

  function segmented(control) {
    if (!control || control.querySelector(':scope > .seg-thumb')) return;
    const thumb = document.createElement('span');
    thumb.className = 'seg-thumb is-instant';
    thumb.setAttribute('aria-hidden', 'true');
    control.prepend(thumb);
    control.classList.add('is-sliding');
    // The thumb is positioned inside the control. Only give the control a positioning
    // context if it has none: an absolutely positioned control keeps its own placement.
    if (getComputedStyle(control).position === 'static') control.style.position = 'relative';

    const place = () => {
      const el = selected(control);
      if (!el || !el.offsetWidth) return;     // hidden: placed again once it has a size
      thumb.style.width = `${el.offsetWidth}px`;
      thumb.style.transform = `translateX(${el.offsetLeft}px)`;
    };

    // First placement (and any re-layout, e.g. fonts loading or a hidden view
    // opening) lands without sliding; selection changes slide.
    const snap = () => {
      thumb.classList.add('is-instant');
      place();
      void thumb.offsetWidth;
      thumb.classList.remove('is-instant');
    };
    snap();
    new ResizeObserver(snap).observe(control);
    if (document.fonts) document.fonts.ready.then(snap);

    // Native radios: capture phase, so the thumb is told to move before any heavy
    // work the page does on the same change (e.g. re-drawing the sector chart).
    control.addEventListener('change', place, true);
    new MutationObserver(place).observe(control, { subtree: true, attributes: true, attributeFilter: ['aria-checked'] });
  }

  window.segmented = segmented;
  document.querySelectorAll('[data-segmented]').forEach(segmented);
})();
