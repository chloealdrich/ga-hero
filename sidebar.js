/*
 * The page frame and the sidebar route through the report.
 *
 * Every section sits in one vertical scroll behind a fixed, rounded content window
 * (.frame). layoutWindow() reports the size each section scales its 1440 × 900
 * stage to (see CROP). The sidebar marks each section as reached once scrolled
 * to, fills the route line as the section above is read, keeps the address bar on
 * the current section (without adding history entries) and scrolls to a section
 * when its link is clicked. Each sub-list unfurls only while the reader is in its
 * section. A floater at the bottom of the window scrolls on to the
 * next section.
 */
(() => {
  'use strict';

  const side = document.querySelector('[data-side]');
  const frame = document.querySelector('[data-frame]');
  if (!side || !frame) return;

  const STAGE_W = 1440;
  const STAGE_H = 900;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // The part of every 1440 × 900 stage that holds content (x 48–1395, y 160–849 across
  // the sections) plus about 40px. This box, not the whole stage, is fitted to the window, so
  // the stages' empty outer margins (and the band where the logo and nav used to be)
  // fall outside it. layoutWindow() inflates the window by the trimmed margin, so the
  // sections' own fit (min(width / 1440, height / 900)) scales the box to the window;
  // --stage-dy shifts the stages up to centre the box.
  const CROP = { left: 8, top: 120, right: 1432, bottom: 889 };
  const CROP_W = CROP.right - CROP.left;
  const CROP_H = CROP.bottom - CROP.top;

  window.layoutWindow = () => {
    const r = frame.getBoundingClientRect();
    return { width: r.width * STAGE_W / CROP_W, height: r.height * STAGE_H / CROP_H };
  };

  // Placeholder sections have no script of their own; scale their stages here.
  const fitStages = [...document.querySelectorAll('[data-fit-stage]')];
  function fit() {
    const { width, height } = window.layoutWindow();
    const scale = Math.min(width / STAGE_W, height / STAGE_H);
    fitStages.forEach(s => s.style.setProperty('--fit-scale', scale));
    const dy = ((CROP.top + CROP.bottom) / 2 - STAGE_H / 2) * scale;
    document.documentElement.style.setProperty('--stage-dy', `${dy}px`);
  }

  // ---- Route ----

  // Each link and its section. A main item with a sub-list ("Initiatives", "Sector")
  // shares its first sub-item's section, so both are reached together.
  const links = [...side.querySelectorAll('a')].map(a => ({
    a,
    section: document.getElementById(a.hash.slice(1)),
    leaf: !a.nextElementSibling,
  })).filter(l => l.section);
  const leaves = links.filter(l => l.leaf);

  // A line from each item's dot to the next item's dot in the same list. The main
  // route runs Overview → Initiatives → Sector, past the sub-lists beside it.
  const lines = [];
  side.querySelectorAll('ol').forEach(list => {
    const items = [...list.children];
    items.slice(0, -1).forEach((li, i) => {
      const line = document.createElement('span');
      line.className = 'side__line';
      line.setAttribute('aria-hidden', 'true');
      li.appendChild(line);
      const from = li.querySelector(':scope > a');
      const to = items[i + 1].querySelector(':scope > a');
      lines.push({ line, from, to, a: sectionOf(from), b: sectionOf(to) });
    });
  });
  function sectionOf(a) { return links.find(l => l.a === a)?.section; }

  // Lines run down the dots' centre line, from the edge of one dot to the edge of the
  // next, overlapping each by half a pixel so they meet the rings without a gap. The
  // end is set from the li's bottom, so a line past a sub-list stretches with it as
  // the list unfurls or folds.
  const LINE_W = 1.5;
  function placeLines() {
    lines.forEach(({ line, from, to }) => {
      const li = line.parentElement.getBoundingClientRect();
      const d1 = from.querySelector('.side__dot').getBoundingClientRect();
      const d2 = to.querySelector('.side__dot').getBoundingClientRect();
      line.style.left = `${d1.left + d1.width / 2 - LINE_W / 2 - li.left}px`;
      line.style.top = `${d1.bottom - 0.5 - li.top}px`;
      line.style.bottom = `${li.bottom - d2.top - 0.5}px`;
    });
  }

  // Sub-lists: open while the current section is one of theirs; closed ones are
  // inert, so their links leave the tab order too.
  const subs = [...side.querySelectorAll('.side__sub')];
  function setSubs() {
    subs.forEach(sub => {
      const open = !!current && sub.contains(current.a);
      sub.classList.toggle('is-open', open);
      sub.inert = !open;
      sub.style.height = open ? `${sub.scrollHeight}px` : '0px';
    });
  }

  const docTop = el => el.getBoundingClientRect().top + window.scrollY;
  let current = null;

  // A section is reached once its top passes the middle of the viewport. A line fills
  // from its section reaching the top of the window to the next section being reached.
  function update() {
    const at = window.scrollY + window.innerHeight / 2;
    links.forEach(l => l.a.classList.toggle('is-reached', docTop(l.section) <= at));
    lines.forEach(({ line, a, b }) => {
      const t0 = docTop(a), t1 = docTop(b) - window.innerHeight / 2;
      line.style.setProperty('--fill', t1 > t0 ? Math.min(Math.max((window.scrollY - t0) / (t1 - t0), 0), 1) : 1);
    });

    const now = [...leaves].reverse().find(l => docTop(l.section) <= at) ?? leaves[0];
    if (now === current) return;
    current = now;
    leaves.forEach(l => l.a.classList.toggle('is-current', l === now));
    setSubs();
    updateNext();
    side.querySelectorAll('a[aria-current]').forEach(a => a.removeAttribute('aria-current'));
    now.a.setAttribute('aria-current', 'location');
    // Keep the address and title on the current section. A sector drill-down
    // (#sector/<id>) keeps its own address and title while the Sector section is in view.
    const id = now.section.id;
    if (id === 'sector' && location.hash.startsWith('#sector/')) return;
    if (now.section.dataset.title) document.title = now.section.dataset.title;
    if (location.hash !== `#${id}` && (location.hash || now !== leaves[0])) setAddress(id);
  }

  // Replace the address without a history entry. Moving off a drill-down's address
  // closes it (drill.js routes on hashchange), without the jump a real hash change makes.
  function setAddress(id) {
    const leavingDrill = location.hash.startsWith('#sector/');
    history.replaceState(null, '', `#${id}`);
    if (leavingDrill) window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); };

  // Scroll a section into the window and move focus there.
  function goTo(section) {
    window.scrollTo({ top: docTop(section), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    if (location.hash !== `#${section.id}`) setAddress(section.id);
    if (!section.hasAttribute('tabindex')) section.setAttribute('tabindex', '-1');
    section.focus({ preventScroll: true });
  }

  side.addEventListener('click', e => {
    const a = e.target.closest('a');
    const link = a && links.find(l => l.a === a);
    if (!link) return;
    e.preventDefault();
    goTo(link.section);
  });

  // ---- Next-section floater ----

  const nextWrap = document.createElement('div');
  nextWrap.className = 'next';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'next__button';
  // Phosphor arrow-down (Regular).
  nextBtn.innerHTML = '<span>Scroll to next section</span><svg width="16" height="16" viewBox="0 0 256 256" ' +
    'fill="currentColor" aria-hidden="true"><path d="M205.66,149.66l-72,72a8,8,0,0,1-11.32,0l-72-72a8,8,0,0,1,' +
    '11.32-11.32L120,196.69V40a8,8,0,0,1,16,0V196.69l58.34-58.35a8,8,0,0,1,11.32,11.32Z"/></svg>';
  nextWrap.appendChild(nextBtn);
  document.body.appendChild(nextWrap);
  const nextLeaf = () => leaves[leaves.indexOf(current) + 1];
  nextBtn.addEventListener('click', () => { const n = nextLeaf(); if (n) goTo(n.section); });

  function updateNext() {
    const n = nextLeaf();
    nextWrap.classList.toggle('is-hidden', !n);
    nextBtn.disabled = !n;   // keeps it out of the tab order on the last section
    if (n) nextBtn.setAttribute('aria-label', `Scroll to next section: ${n.a.textContent.trim()}`);
  }

  // Open at the address's section, including on reload (the address follows the
  // reader, so the browser's own scroll restoration is not needed). A drill-down
  // address (#sector/<id>) names no element; it opens at the Sector section.
  history.scrollRestoration = 'manual';
  const hash = location.hash.startsWith('#sector/') ? '#sector' : location.hash;
  const start = hash.length > 1 && document.getElementById(hash.slice(1));
  if (start) window.scrollTo(0, docTop(start));

  window.addEventListener('scroll', schedule, { passive: true });
  // A drill-down opening or closing sets its own title; settle the address and title after it.
  window.addEventListener('hashchange', () => { current = null; schedule(); });
  window.addEventListener('resize', () => { fit(); placeLines(); setSubs(); schedule(); });
  if (document.fonts) document.fonts.ready.then(() => { placeLines(); setSubs(); schedule(); });
  fit();
  placeLines();
  update();
})();
