/*
 * Section tabs: shows the one [data-page] section that matches the URL hash
 * (#overview, #sector, ...) and hides the rest. Unknown hashes leave the current
 * section in place; no hash shows the first section.
 */
(() => {
  'use strict';

  const pages = [...document.querySelectorAll('[data-page]')];
  if (!pages.length) return;
  const ids = pages.map(p => p.dataset.page);
  let current = null;

  function show(id, { fromNav }) {
    current = id;
    pages.forEach(p => { p.hidden = p.dataset.page !== id; });
    document.querySelectorAll('.site-nav a').forEach(a => {
      if (a.hash.slice(1) === id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const page = pages[ids.indexOf(id)];
    if (page.dataset.title) document.title = page.dataset.title;

    window.scrollTo({ top: 0, behavior: 'instant' });
    // Sections size their stage on resize; they measured 0 × 0 while hidden.
    window.dispatchEvent(new Event('resize'));

    // The link that was clicked lives in the section just hidden, so keep
    // keyboard users in the nav of the section now showing.
    if (fromNav) page.querySelector('.site-nav a[aria-current="page"]')?.focus({ preventScroll: true });
  }

  function route(fromNav) {
    const id = location.hash.slice(1).split('/')[0];
    if (ids.includes(id)) { if (id !== current) show(id, { fromNav }); }
    else if (current === null) show(ids[0], { fromNav });
  }

  window.addEventListener('hashchange', () => route(true));
  route(false);
})();
