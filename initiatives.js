/*
 * Section 3, Initiatives: drag initiative pills into a comparison box; each pill in
 * the box draws a line on a 2019–2025 chart (initiatives-data.json). Geometry follows
 * the I1–I5 frames. The logo, section nav, group switch (.fw-groups + segmented.js)
 * and hover card shell (.sector-card) are the ones the Sector section uses.
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-initiatives]');
  if (!root) return;

  const STAGE_W = 1440;
  const STAGE_H = 900;
  const PLOT = { left: 560, right: 1392, top: 372, base: 752 };
  const GUIDE_TOP = 364;
  const BOX = { left: 48, top: 456, width: 400, height: 296 };
  const xOf = i => 620 + i * 122;
  const yOf = v => PLOT.base - 380 * v;

  const DRAW_MS = 600;     // a new line draws left to right
  const SWITCH_MS = 400;   // lines move to another group's values
  const FADE_MS = 240;     // a removed line fades out
  const RETURN_MS = 240;   // a dropped pill flies back to its palette slot
  const DRAG_START = 4;    // px a press must move before it becomes a drag
  const EASE = 'cubic-bezier(.2,.8,.2,1)';   // --ease in hero.css
  const CDP_INK = '#0a192a';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  // Phosphor icons (paths from the frames): x and waves Regular; info, leaf and tree Fill.
  const ICONS = {
    x: 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z',
    info: 'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-4,48a12,12,0,1,1-12,12A12,12,0,0,1,124,72Zm12,112a16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40a8,8,0,0,1,0,16Z',
    leaf: 'M223.45,40.07a8,8,0,0,0-7.52-7.52C139.8,28.08,78.82,51,52.82,94a87.09,87.09,0,0,0-12.76,49A101.72,101.72,0,0,0,46.7,175.2a4,4,0,0,0,6.61,1.43l85-86.3a8,8,0,0,1,11.32,11.32L56.74,195.94,42.55,210.13a8.2,8.2,0,0,0-.6,11.1,8,8,0,0,0,11.71.43l16.79-16.79c14.14,6.84,28.41,10.57,42.56,11.07q1.67.06,3.33.06A86.93,86.93,0,0,0,162,203.18C205,177.18,227.93,116.21,223.45,40.07Z',
    tree: 'M128,187.85a72.44,72.44,0,0,0,8,4.62V232a8,8,0,0,1-16,0V192.47A72.44,72.44,0,0,0,128,187.85ZM198.1,62.59a76,76,0,0,0-140.2,0A71.71,71.71,0,0,0,16,127.8C15.9,166,48,199,86.14,200A72.22,72.22,0,0,0,120,192.47V156.94L76.42,135.16a8,8,0,1,1,7.16-14.32L120,139.06V88a8,8,0,0,1,16,0v27.06l36.42-18.22a8,8,0,1,1,7.16,14.32L136,132.94v59.53A72.17,72.17,0,0,0,168,200l1.82,0C208,199,240.11,166,240,127.8A71.71,71.71,0,0,0,198.1,62.59Z',
    waves: 'M222.16,177.25a8,8,0,0,1-1,11.25c-17.36,14.39-32.86,19.5-47,19.5-18.58,0-34.82-8.82-49.93-17-25.35-13.76-47.24-25.64-79.07.74a8,8,0,1,1-10.22-12.31c40.17-33.28,70.32-16.92,96.93-2.48,25.35,13.75,47.24,25.63,79.07-.74A8,8,0,0,1,222.16,177.25Zm-11.27-57c-31.83,26.38-53.72,14.5-79.07.74-26.61-14.43-56.76-30.79-96.93,2.49a8,8,0,0,0,10.22,12.31c31.83-26.38,53.72-14.5,79.07-.74,15.11,8.19,31.35,17,49.93,17,14.14,0,29.64-5.11,47-19.5a8,8,0,1,0-10.22-12.31ZM45.11,79.8c31.83-26.37,53.72-14.49,79.07-.74,15.11,8.2,31.35,17,49.93,17,14.14,0,29.64-5.12,47-19.5a8,8,0,1,0-10.22-12.31c-31.83,26.38-53.72,14.5-79.07.74C105.21,50.58,75.06,34.22,34.89,67.5A8,8,0,1,0,45.11,79.8Z',
  };
  const icon = (name, size) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

  function el(tag, className, parent) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }
  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // The colour at 12% over white, per channel.
  function tint(hex) {
    const c = [1, 3, 5].map(i => Math.round(255 - (255 - parseInt(hex.slice(i, i + 2), 16)) * 0.12));
    return `rgb(${c.join(',')})`;
  }

  // Whole percent; values between 0 and 1% keep one decimal (0.002 → 0.2%).
  function fmt(v) {
    const p = v * 100;
    return (p > 0 && p < 1 ? p.toFixed(1) : String(Math.round(p))) + '%';
  }

  // cubic-bezier(.2,.8,.2,1) for the rAF-driven group switch.
  function ease(t) {
    const b = (a, c, s) => 3 * a * s * (1 - s) ** 2 + 3 * c * s * s * (1 - s) + s ** 3;
    let lo = 0, hi = 1, s = t;
    for (let k = 0; k < 24; k++) { s = (lo + hi) / 2; if (b(.2, .2, s) < t) lo = s; else hi = s; }
    return b(.8, 1, s);
  }

  // ---- Shell ----
  // Built synchronously so nav.js, which runs next, marks this section's nav link current.

  const stage = el('div', 'ini__stage', root);
  const sectorStage = document.querySelector('[data-sector-stage]');
  for (const sel of ['.sector__logo', '.site-nav']) {
    const src = sectorStage?.querySelector(sel);
    if (src) stage.appendChild(src.cloneNode(true));
  }

  function fitStage() {
    if (!root.clientWidth) return;   // hidden tab: measured again when shown
    stage.style.setProperty('--ini-scale', Math.min(root.clientWidth / STAGE_W, root.clientHeight / STAGE_H));
  }
  window.addEventListener('resize', fitStage);
  fitStage();

  // ---- State ----

  let data, byId, group;
  let selection = [];          // initiative ids in the box, in the order added
  const cur = {};              // id -> drawn y per year (null = no point)
  const series = new Map();    // id -> { g, path, dots, marker }
  const paletteBtn = {};
  const boxBtn = {};
  let hover = null;            // { id, i } of the emphasised point
  let hoverByKey = false;
  let tween = 0;
  let drag = null;
  let suppressClick = false;
  const els = {};

  const values = id => data.groups[group].series[id] ?? data.years.map(() => null);
  const unavailable = id => values(id).every(v => v == null);
  const target = id => values(id).map(v => (v == null ? null : yOf(v)));
  const shown = () => selection.filter(id => !unavailable(id));

  fetch('initiatives-data.json')
    .then(r => r.json())
    .then(d => {
      data = d;
      byId = Object.fromEntries(d.initiatives.map(ini => [ini.id, ini]));
      group = d.defaultGroup;
      build();
      setGroup(group, false);
      d.defaultSelection.forEach(id => add(id, { animate: false, announce: false }));
    });

  // ---- Build ----

  function build() {
    const y0 = data.years[0], y1 = data.years.at(-1);

    const intro = el('div', 'ini-intro', stage);
    const h2 = el('h2', null, intro);
    h2.id = 'initiatives-title';
    h2.textContent = `Reporting Initiatives, ${y0}–${y1}`;
    el('p', null, intro).textContent = 'Drag initiatives into the box to compare them over time. Hover a point for its value.';

    // Group switch: the frameworks view's segmented control.
    const groups = el('div', 'fw-groups', stage);
    groups.setAttribute('role', 'radiogroup');
    groups.setAttribute('aria-label', 'Companies');
    els.radios = Object.entries(data.groups).map(([key, g]) => {
      const b = el('button', null, groups);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.group = key;
      b.textContent = g.label;
      return b;
    });
    groups.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b && b.dataset.group !== group) setGroup(b.dataset.group, true);
    });
    groups.addEventListener('keydown', e => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const n = els.radios.length;
      const b = els.radios[(els.radios.findIndex(r => r.dataset.group === group) + dir + n) % n];
      setGroup(b.dataset.group, true);
      b.focus();
    });
    window.segmented?.(groups);

    // Palette: one slot per initiative, in data order.
    const palette = el('div', 'ini-palette', stage);
    palette.setAttribute('role', 'list');
    palette.setAttribute('aria-label', 'Initiatives');
    data.initiatives.forEach(ini => {
      const slot = el('span', 'ini-slot', palette);
      slot.setAttribute('role', 'listitem');
      slot.appendChild(paletteBtn[ini.id] = pill(ini, false));
    });

    // Comparison box.
    const box = els.box = el('div', 'ini-box', stage);
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Comparison: drop initiatives here');
    els.boxPills = el('div', 'ini-box__pills', box);
    const note = els.note = el('div', 'ini-note', box);
    note.setAttribute('role', 'note');
    note.innerHTML = `${icon('info', 16)}<span>SDG data isn’t available by market cap. Switch to Russell 1000 to plot it.</span>`;
    els.hint = el('span', 'ini-box__hint', box);

    // Chart.
    const fig = els.fig = el('figure', 'ini-chart', stage);
    fig.setAttribute('role', 'img');
    fig.tabIndex = 0;
    const svg = svgEl('svg', { width: STAGE_W, height: STAGE_H, viewBox: `0 0 ${STAGE_W} ${STAGE_H}`, 'aria-hidden': 'true' }, fig);
    svgEl('rect', { class: 'ini-ring', x: 500, y: 344, width: 912, height: 448, rx: 12 }, svg);
    const grid = svgEl('g', { class: 'ini-grid' }, svg);
    [1, .75, .5, .25].forEach(v => svgEl('line', { x1: PLOT.left, x2: PLOT.right, y1: yOf(v), y2: yOf(v) }, grid));
    svgEl('line', { class: 'ini-baseline', x1: PLOT.left, x2: PLOT.right, y1: PLOT.base, y2: PLOT.base }, svg);
    const yLabels = svgEl('g', { class: 'ini-axis', 'text-anchor': 'end' }, svg);
    [1, .75, .5, .25, 0].forEach(v => (svgEl('text', { x: 548, y: yOf(v) + 4 }, yLabels).textContent = `${v * 100}%`));
    const xLabels = svgEl('g', { class: 'ini-axis', 'text-anchor': 'middle' }, svg);
    els.years = data.years.map((y, i) => {
      const t = svgEl('text', { x: xOf(i), y: 776 }, xLabels);
      t.textContent = y;
      return t;
    });
    els.lines = svgEl('g', null, svg);
    els.guide = svgEl('line', { class: 'ini-guide', y1: GUIDE_TOP, y2: PLOT.base }, svg);
    els.big = svgEl('circle', { class: 'ini-big', r: 7 }, svg);
    els.hits = svgEl('g', null, svg);

    els.year = el('span', 'ini-year', stage);
    els.year.setAttribute('aria-hidden', 'true');
    const tip = els.tip = el('div', 'sector-card ini-tip', stage);
    tip.setAttribute('role', 'tooltip');
    tip.innerHTML = '<div class="ini-tip__name"><span class="ini-tip__dot"></span><span></span></div>' +
      '<div class="ini-tip__value"></div><div class="ini-tip__caption"></div>';
    els.empty = el('div', 'ini-empty', stage);
    els.empty.textContent = 'Drag an initiative into the box to plot it.';
    els.live = el('div', 'visually-hidden', stage);
    els.live.setAttribute('aria-live', 'polite');

    // Pills: click or keyboard adds and removes.
    stage.addEventListener('click', e => {
      const b = e.target.closest('.ini-pill');
      if (!b) return;
      if (suppressClick) { suppressClick = false; return; }
      if (b.parentElement === els.boxPills) remove(b.dataset.id, { focus: true });
      else if (b.getAttribute('aria-disabled') !== 'true') add(b.dataset.id, { focus: true });
    });
    els.boxPills.addEventListener('keydown', e => {
      const b = e.target.closest('.ini-pill');
      if (b && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        remove(b.dataset.id, { focus: true });
      }
    });

    // Pills: drag (Pointer Events, so mouse and touch both work).
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', e => endDrag(e, false));
    stage.addEventListener('pointercancel', e => endDrag(e, true));

    // Chart points: pointer hover, and arrow keys while the chart has focus.
    els.hits.addEventListener('pointerover', e => {
      const h = e.target.closest('.ini-hit');
      if (h && !drag) { hoverByKey = false; setHover({ id: h.dataset.id, i: +h.dataset.i }); }
    });
    els.hits.addEventListener('pointerout', e => {
      if (e.target.closest('.ini-hit') && !hoverByKey) setHover(null);
    });
    fig.addEventListener('keydown', onChartKey);
    fig.addEventListener('blur', () => { if (hoverByKey) setHover(null); });

    root.addEventListener('focusin', fitStage);
  }

  function pill(ini, boxed) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ini-pill ini-pill--${ini.style}`;
    b.dataset.id = ini.id;
    if (ini.style === 'cdp') {
      b.style.setProperty('--c', CDP_INK);
      b.innerHTML = `<span class="ini-pill__disc" aria-hidden="true">${icon(ini.icon, 10)}</span>`;
    } else {
      b.style.setProperty('--c', ini.color);
      b.style.setProperty('--tint', tint(ini.color));
    }
    b.append(ini.label);
    if (boxed) b.insertAdjacentHTML('beforeend', `<span class="ini-pill__x" aria-hidden="true">${icon('x', 10)}</span>`);
    b.setAttribute('aria-label', boxed ? `Remove ${ini.label} from comparison` : `Add ${ini.label} to comparison`);
    return b;
  }

  // ---- Add / remove ----

  function add(id, { focus = false, animate = true, announce: say = true } = {}) {
    if (selection.includes(id) || unavailable(id)) return;
    selection.push(id);
    setPlaced(id, true);
    const b = boxBtn[id] = pill(byId[id], true);
    els.boxPills.appendChild(b);
    addSeries(id, animate);
    changed();
    if (say) announce(`${byId[id].label} added to comparison.`);
    if (focus) b.focus();
  }

  function remove(id, { focus = false, keepGhost = false } = {}) {
    const at = selection.indexOf(id);
    if (at < 0) return;
    selection.splice(at, 1);
    boxBtn[id].remove();
    delete boxBtn[id];
    if (!keepGhost) setPlaced(id, false);
    if (hover?.id === id) setHover(null);

    const s = series.get(id);
    series.delete(id);
    delete cur[id];
    if (reduced.matches) s.g.remove();
    else s.g.animate([{ opacity: getComputedStyle(s.g).opacity }, { opacity: 0 }], { duration: FADE_MS, easing: EASE, fill: 'forwards' })
      .onfinish = () => s.g.remove();

    changed();
    announce(`${byId[id].label} removed from comparison.`);
    if (focus) (boxBtn[selection[at]] ?? boxBtn[selection[at - 1]] ?? paletteBtn[id]).focus();
  }

  // A palette pill whose initiative is in the box becomes a same-width ghost slot.
  function setPlaced(id, on) {
    paletteBtn[id].classList.toggle('is-placed', on);
    paletteBtn[id].inert = on;
  }

  function announce(text) {
    const n = selection.length;
    els.live.textContent = `${text} ${n} initiative${n === 1 ? '' : 's'} shown.`;
  }

  function changed() {
    updateBox();
    updateChart();
  }

  function updateBox() {
    const empty = !selection.length;
    const over = els.box.classList.contains('is-over');
    els.box.classList.toggle('is-empty', empty);
    els.hint.textContent = over ? 'Drop to add' : empty ? 'Drag initiatives here' : 'Drag more here, or drag out to remove';
  }

  // ---- Group switch ----

  function setGroup(key, animate) {
    group = key;
    els.radios.forEach(b => {
      const on = b.dataset.group === key;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    // Initiatives without data for this group (SDGs by market cap) are disabled; any
    // already in the box stay there, disabled, with their line hidden.
    let anyOff = false;
    data.initiatives.forEach(ini => {
      const off = unavailable(ini.id);
      anyOff ||= off;
      for (const b of [paletteBtn[ini.id], boxBtn[ini.id]]) {
        if (!b) continue;
        if (off) b.setAttribute('aria-disabled', 'true');
        else b.removeAttribute('aria-disabled');
      }
    });
    els.note.hidden = !anyOff;
    setHover(null);

    // Every plotted line moves to the new values; hidden lines keep their last shape.
    const from = { ...cur };
    const to = Object.fromEntries(selection.map(id => [id, target(id)]));
    series.forEach((s, id) => s.g.classList.toggle('is-hidden', unavailable(id)));
    const frame = e => selection.forEach(id => {
      if (unavailable(id)) return;
      cur[id] = to[id].map((y, i) => (y == null ? null : from[id][i] == null ? y : from[id][i] + (y - from[id][i]) * e));
      drawSeries(id);
    });

    cancelAnimationFrame(tween);
    els.hits.replaceChildren();
    if (!animate || reduced.matches) { frame(1); changed(); return; }
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / SWITCH_MS);
      frame(ease(t));
      if (t < 1) tween = requestAnimationFrame(step);
      else changed();
    };
    tween = requestAnimationFrame(step);
    updateLabel();
  }

  // ---- Chart ----

  function addSeries(id, animate) {
    const ini = byId[id];
    const color = ini.style === 'cdp' ? CDP_INK : ini.color;
    const g = svgEl('g', { class: 'ini-series', 'data-id': id }, els.lines);
    const clipId = `ini-clip-${id}`;
    document.getElementById(clipId)?.closest('.ini-series')?.remove();   // still fading out
    const clip = svgEl('clipPath', { id: clipId }, g);
    const reveal = svgEl('rect', { x: 600, y: 330, width: 820, height: 460 }, clip);
    g.setAttribute('clip-path', `url(#${clipId})`);
    const path = svgEl('path', { class: 'ini-line', stroke: color }, g);
    const dots = svgEl('g', { fill: color }, g);
    let marker = null;
    if (ini.icon) {
      // CDP lines share one colour, so each carries its icon on its first point.
      marker = svgEl('g', { class: 'ini-marker' }, g);
      svgEl('circle', { r: 10, fill: CDP_INK, stroke: '#fff', 'stroke-width': 2 }, marker);
      const glyph = svgEl('svg', { x: -6, y: -6, width: 12, height: 12, viewBox: '0 0 256 256', fill: '#fff' }, marker);
      svgEl('path', { d: ICONS[ini.icon] }, glyph);
    }
    series.set(id, { g, path, dots, marker });
    g.classList.toggle('is-hidden', unavailable(id));
    cur[id] = target(id);
    drawSeries(id);
    if (animate && !reduced.matches) {
      reveal.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: DRAW_MS, easing: EASE });
    }
  }

  function drawSeries(id) {
    const { path, dots, marker } = series.get(id);
    const ys = cur[id];
    let d = '';
    let pen = false;
    ys.forEach((y, i) => {
      if (y == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${xOf(i)},${y.toFixed(1)}`;
      pen = true;
    });
    path.setAttribute('d', d);
    const first = ys.findIndex(y => y != null);
    dots.replaceChildren();
    ys.forEach((y, i) => {
      if (y != null && !(marker && i === first)) svgEl('circle', { cx: xOf(i), cy: y.toFixed(1), r: 3.5 }, dots);
    });
    if (marker && first >= 0) marker.setAttribute('transform', `translate(${xOf(first)},${ys[first].toFixed(1)})`);
  }

  function updateChart() {
    // Hit targets in the order added, so the newest line's points win where they overlap.
    els.hits.replaceChildren();
    shown().forEach(id => cur[id].forEach((y, i) => {
      if (y != null) svgEl('circle', { class: 'ini-hit', cx: xOf(i), cy: y, r: 12, 'data-id': id, 'data-i': i }, els.hits);
    }));
    els.empty.hidden = shown().length > 0;
    updateLabel();
  }

  function updateLabel() {
    const parts = shown().map(id => `${byId[id].label}: ` +
      data.years.flatMap((y, i) => (values(id)[i] == null ? [] : [`${y} ${fmt(values(id)[i])}`])).join(', '));
    els.fig.setAttribute('aria-label',
      `Line chart, share of ${data.groups[group].label} companies by initiative, ${data.years[0]} to ${data.years.at(-1)}. ` +
      (parts.length ? `${parts.join('; ')}.` : 'No initiatives selected.'));
  }

  // ---- Hover / focus on a point ----

  function setHover(h) {
    hover = h;
    els.fig.classList.toggle('is-hovering', !!h);
    series.forEach((s, id) => s.g.classList.toggle('is-active', h?.id === id));
    els.years.forEach((t, i) => t.classList.toggle('is-current', h?.i === i));
    for (const e of [els.guide, els.big, els.year]) e.classList.toggle('is-on', !!h);
    els.tip.classList.toggle('is-visible', !!h);
    if (!h) return;

    const ini = byId[h.id];
    const color = ini.style === 'cdp' ? CDP_INK : ini.color;
    const x = xOf(h.i), y = cur[h.id][h.i];
    const v = values(h.id)[h.i];
    els.guide.setAttribute('x1', x);
    els.guide.setAttribute('x2', x);
    els.big.setAttribute('cx', x);
    els.big.setAttribute('cy', y);
    els.big.setAttribute('fill', color);
    els.year.textContent = data.years[h.i];
    els.year.style.left = `${x}px`;

    const tip = els.tip;
    tip.querySelector('.ini-tip__dot').style.background = color;
    tip.querySelector('.ini-tip__name span:last-child').textContent = ini.label;
    tip.querySelector('.ini-tip__value').textContent = fmt(v);
    tip.querySelector('.ini-tip__caption').textContent = `${data.groups[group].caption}, ${data.years[h.i]}`;
    // Above and to the left of the point; flip right or down where that leaves the plot.
    let left = x - 236, top = y - 124;
    if (left < PLOT.left) left = x + 16;
    if (top < GUIDE_TOP) top = y + 16;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function onChartKey(e) {
    if (e.key === 'Escape') {
      if (hover) { e.preventDefault(); setHover(null); }
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const lines = shown();
    if (!lines.length) return;
    e.preventDefault();

    let h = hover && lines.includes(hover.id) ? hover : null;
    if (!h) {
      const id = lines.at(-1);
      h = { id, i: cur[id].findIndex(y => y != null) };
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      let i = h.i + dir;
      while (i >= 0 && i < data.years.length && cur[h.id][i] == null) i += dir;
      if (i >= 0 && i < data.years.length) h = { id: h.id, i };
    } else {
      // Up and down step between the lines plotted at this year, top to bottom.
      const at = lines.filter(id => cur[id][h.i] != null).sort((a, b) => cur[a][h.i] - cur[b][h.i]);
      const next = at[at.indexOf(h.id) + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next) h = { id: next, i: h.i };
    }
    hoverByKey = true;
    setHover(h);
    els.live.textContent = `${byId[h.id].label}, ${data.years[h.i]}: ${fmt(values(h.id)[h.i])}`;
  }

  // ---- Drag and drop ----

  function stageRect() {
    const r = stage.getBoundingClientRect();
    return { r, k: r.width / STAGE_W };
  }
  function toStage(clientX, clientY) {
    const { r, k } = stageRect();
    return { x: (clientX - r.left) / k, y: (clientY - r.top) / k };
  }
  function rectInStage(node) {
    const { r, k } = stageRect();
    const b = node.getBoundingClientRect();
    return { left: (b.left - r.left) / k, top: (b.top - r.top) / k };
  }
  const inBox = p => p.x >= BOX.left && p.x <= BOX.left + BOX.width && p.y >= BOX.top && p.y <= BOX.top + BOX.height;

  function onPointerDown(e) {
    suppressClick = false;
    const b = e.target.closest('.ini-pill');
    if (!b || e.button !== 0 || drag) return;
    const fromBox = b.parentElement === els.boxPills;
    if (!fromBox && b.getAttribute('aria-disabled') === 'true') return;
    drag = { b, id: b.dataset.id, fromBox, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, float: null };
    try { b.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.float) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_START) return;
      lift();
    }
    const p = toStage(e.clientX, e.clientY);
    drag.float.style.left = `${p.x - drag.dx}px`;
    drag.float.style.top = `${p.y - drag.dy}px`;
    const over = !drag.fromBox && inBox(p);
    if (over !== els.box.classList.contains('is-over')) {
      els.box.classList.toggle('is-over', over);
      updateBox();
    }
  }

  // The pressed pill lifts out: a tilted copy follows the pointer and its place empties.
  function lift() {
    const start = toStage(drag.x0, drag.y0);
    const at = rectInStage(drag.b);
    drag.dx = start.x - at.left;
    drag.dy = start.y - at.top;
    const float = drag.float = el('div', 'ini-float', stage);
    float.setAttribute('aria-hidden', 'true');
    float.inert = true;
    const copy = drag.b.cloneNode(true);
    copy.classList.add('is-floating');
    float.appendChild(copy);
    if (drag.fromBox) drag.b.classList.add('is-lifted');
    else setPlaced(drag.id, true);
    stage.classList.add('is-dragging');
    setHover(null);
  }

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    if (!d.float) return;              // a plain click: the click handler takes it
    // Swallow the click this pointerup produces, if any (it is dispatched before the timeout).
    suppressClick = true;
    setTimeout(() => { suppressClick = false; });
    stage.classList.remove('is-dragging');
    els.box.classList.remove('is-over');
    const inside = !cancelled && inBox(toStage(e.clientX, e.clientY));

    if (!d.fromBox && inside) {        // dropped in the box: added
      d.float.remove();
      add(d.id);
    } else if (!d.fromBox) {           // dropped elsewhere: back to its slot
      flyTo(d.float, paletteBtn[d.id], () => setPlaced(d.id, false));
      updateBox();
    } else if (!inside) {              // dragged out of the box: removed
      remove(d.id, { keepGhost: true });
      flyTo(d.float, paletteBtn[d.id], () => setPlaced(d.id, false));
    } else {                           // dropped back in the box: unchanged
      d.b.classList.remove('is-lifted');
      d.float.remove();
    }
  }

  function flyTo(float, node, done) {
    const to = rectInStage(node);
    const dx = to.left - parseFloat(float.style.left);
    const dy = to.top - parseFloat(float.style.top);
    const finish = () => { float.remove(); done(); };
    if (reduced.matches) { finish(); return; }
    float.classList.add('is-returning');
    float.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px)` }],
      { duration: RETURN_MS, easing: EASE, fill: 'forwards' }).onfinish = finish;
  }
})();
