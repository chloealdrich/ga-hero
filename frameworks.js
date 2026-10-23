/*
 * Frameworks by Sector: the Sector (Initiatives) section, built into its own stage.
 *
 * 2025 values from frameworks-data.json; sector ids, names and (Fill) icons from
 * sector-data.json. Geometry follows frameworks-spec.md and the E1–E5 frames
 * (1440 × 900); the stage scales to the content window (sidebar.js).
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-frameworks]');
  const stage = root?.querySelector('[data-frameworks-stage]');
  if (!stage) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const STAGE_W = 1440;
  const STAGE_H = 900;
  const EDGE = 48;
  const HUB = [720, 812];
  const SLOT_STEP = 18;                 // degrees between stems; slot 0 points left (180°)
  const ICON_R = 232;                   // sector icon distance from the hub
  const ICON_SIZE = 56;                 // sector icon circle diameter
  const LINE_GAP = 10;                  // perpendicular spacing between a stem's lines (hit targets are as wide)
  const FLARE = 1.5;                    // lines fan out to this × their spacing at the stem's end
  const BRAID = 0.45;                   // lines start crossed, at −BRAID × their offset, on the bubble's edge
  const GUIDE = { bend: 281, join: 300, end: 530 };
  // 100% reaches the end of the stem (the guides' end), so line length reads against the full stem.
  const VALUE = { start: 310, length: GUIDE.end - 310 };
  const TIP_PAST = 40;                  // tooltip centre beyond the guides' end
  const TIP_W = 148;
  const DIM = 0.22;                     // other frameworks while one is emphasised
  const TINT = 0.12;                    // centre half-circle: colour at 12% over white
  const MS = { sort: 600, length: 400 };

  // Phosphor caret-down (Regular).
  const ICON = {
    caret: '<path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/>',
  };

  let data, sectors;                    // frameworks-data.json; sector-data.json sectors
  let host, els = {};
  let group = 'russell1000';
  let sortKey = 'az';                   // 'az' or a framework key
  let hover = null;                     // framework index emphasised by hover/focus
  let tipAt = null;                     // { i, k } line showing the tooltip
  let lineEls = [];                     // [i][k] -> { value, ring, gap, hit }
  let stemEls = [];                     // [i] -> stem group
  let iconEls = [];                     // [i] -> icon group
  let angle = [];                       // [i] displayed angle (degrees)
  let shown = [];                       // [i][k] displayed value
  const tweens = new Map();

  Promise.all(['frameworks-data.json', 'sector-data.json'].map(url =>
    fetch(url).then(r => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.json();
    })))
    .then(([f, s]) => init(f, s))
    .catch(err => console.error('[frameworks] could not load data', err));

  // ---- Helpers ----

  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const pct = v => `${Math.round(v * 100)}%`;
  const rgb = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  const tint = (hex, f) => `rgb(${rgb(hex).map(c => Math.round(255 - (255 - c) * f)).join(',')})`;
  const icon = (path, size) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${path}</svg>`;
  const values = (i, g = group) => data.groups[g].sectors.find(s => s.id === sectors[i].id).values;
  const slotAngle = slot => 180 - slot * SLOT_STEP;
  // Perpendicular offset of line k (GRI on the clockwise side) and its y at local x.
  const off = k => (2.5 - k) * LINE_GAP;
  const yAt = (o, x) => o + (FLARE - 1) * o * (x - GUIDE.join) / (GUIDE.end - GUIDE.join);
  // Where a line at perpendicular offset y meets the sector bubble's edge, so the stem grows out of it.
  const bubbleEdgeX = y => ICON_R + Math.sqrt((ICON_SIZE / 2) ** 2 - y * y);
  const abs = (x, y) => [HUB[0] + x, HUB[1] + y];

  // Local stem coordinates (pointing right) rotated by the stem angle, in stage px.
  function rotate(x, y, deg) {
    const a = -deg * Math.PI / 180;
    return [HUB[0] + x * Math.cos(a) - y * Math.sin(a), HUB[1] + x * Math.sin(a) + y * Math.cos(a)];
  }

  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = u => ((ax * u + bx) * u + cx) * u;
    const sy = u => ((ay * u + by) * u + cy) * u;
    const dx = u => (3 * ax * u + 2 * bx) * u + cx;
    return x => {
      let u = x;
      for (let n = 0; n < 8; n++) {
        const e = sx(u) - x, d = dx(u);
        if (Math.abs(e) < 1e-5 || !d) break;
        u -= e / d;
      }
      return sy(Math.min(Math.max(u, 0), 1));
    };
  }
  const ease = cubicBezier(.2, .8, .2, 1);

  // Keyed tweens on one rAF loop; a new tween for a key replaces the old one.
  function tween(key, from, to, ms, apply) {
    if (reducedMotion.matches || !ms || from === to) { tweens.delete(key); apply(to); return; }
    tweens.set(key, { from, to, ms, apply, start: performance.now() });
    if (tweens.size === 1) requestAnimationFrame(step);
  }
  function step(now) {
    tweens.forEach((t, key) => {
      const p = Math.min((now - t.start) / t.ms, 1);
      t.apply(t.from + (t.to - t.from) * ease(p));
      if (p >= 1) tweens.delete(key);
    });
    if (tweens.size) requestAnimationFrame(step);
  }

  // ---- Setup ----

  function init(f, s) {
    data = f;
    sectors = s.sectors;

    host = document.createElement('div');
    host.className = 'fw';
    host.innerHTML = markup();
    stage.appendChild(host);
    els = {
      legend: [...host.querySelectorAll('.fw-legend button')],
      radios: [...host.querySelectorAll('.fw-groups button')],
      select: host.querySelector('.fw-sort select'),
      figure: host.querySelector('.fw-chart'),
      svg: host.querySelector('.fw-chart svg'),
      centerShape: host.querySelector('.fw-center-shape'),
      center: host.querySelector('.fw-center'),
      tip: host.querySelector('.fw-tip'),
      live: host.querySelector('[data-fw-live]'),
    };
    buildFan();
    wire();
    window.segmented?.(host.querySelector('.fw-groups'));   // sliding pill, shared with the View toggle

    window.addEventListener('resize', fitStage);
    fitStage();
    render({ animate: false });
  }

  function fitStage() {
    const { width, height } = window.layoutWindow();
    stage.style.setProperty('--sector-scale', Math.min(width / STAGE_W, height / STAGE_H));
  }

  function markup() {
    const legend = data.frameworks.map((f, k) =>
      `<button type="button" aria-pressed="false" data-k="${k}"><span class="fw-swatch" aria-hidden="true" style="background:${f.color}"></span>${esc(f.label)}</button>`).join('');
    const radios = Object.entries(data.groups).map(([key, g]) =>
      `<button type="button" role="radio" aria-checked="false" data-group="${key}">${esc(g.label)}</button>`).join('');
    // Sort options in data order (GRI, SASB, TCFD, ISSB, ESRS, TNFD), as the spec lists them.
    const options = '<option value="az">Sector (A–Z)</option>' +
      data.frameworks.map(f => `<option value="${f.key}">${esc(f.label)}</option>`).join('');
    return '<div class="fw-intro"><h2 id="fw-title">Frameworks by Sector, ' + data.year + '</h2>' +
      '<p>Line length shows the share of each sector’s companies aligned with a framework.</p></div>' +
      `<div class="fw-legend" role="group" aria-label="Frameworks">${legend}</div>` +
      `<div class="fw-groups" role="radiogroup" aria-label="Companies">${radios}</div>` +
      '<div class="fw-sort"><label for="fw-sort">Sort by</label><div class="fw-select">' +
      `<select id="fw-sort">${options}</select>${icon(ICON.caret, 16)}</div></div>` +
      // tabindex -1: some browsers otherwise make the chart's <svg> an extra, empty tab stop.
      `<figure class="fw-chart"><svg width="${STAGE_W}" height="900" viewBox="0 0 ${STAGE_W} 900" tabindex="-1">` +
      // Half-circle on a straight base that runs down to the bottom edge of the end sector icons.
      `<path class="fw-center-shape" d="M${HUB[0] - 160} ${HUB[1] + ICON_SIZE / 2} L${HUB[0] - 160} ${HUB[1]} ` +
      `A160 160 0 0 1 ${HUB[0] + 160} ${HUB[1]} L${HUB[0] + 160} ${HUB[1] + ICON_SIZE / 2} Z" aria-hidden="true"/>` +
      '<g class="fw-stems"></g><g class="fw-icons" aria-hidden="true"></g></svg>' +
      '<div class="fw-center" aria-hidden="true"><span class="fw-center__value"></span><span class="fw-center__caption"></span></div>' +
      '</figure>' +
      '<div class="sector-card fw-tip" role="tooltip" id="fw-tip"></div>' +
      '<span class="visually-hidden" aria-live="polite" data-fw-live></span>';
  }

  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const a in attrs) e.setAttribute(a, attrs[a]);
    parent.appendChild(e);
    return e;
  }

  function buildFan() {
    const stems = els.svg.querySelector('.fw-stems');
    const icons = els.svg.querySelector('.fw-icons');
    sectors.forEach((s, i) => {
      const g = svgEl('g', { class: 'fw-stem' }, stems);
      lineEls[i] = data.frameworks.map((f, k) => {
        const o = off(k);
        const y0 = -BRAID * o;
        const [a, b] = abs(bubbleEdgeX(y0), y0), [c, d] = abs(GUIDE.bend, y0), [e2, f2] = abs(GUIDE.bend, o),
          [g2, h] = abs(GUIDE.join, o), [m, n] = abs(GUIDE.end, FLARE * o);
        svgEl('path', { class: 'fw-guide', d: `M${a.toFixed(2)} ${b.toFixed(2)} C${c} ${d.toFixed(2)} ${e2} ${f2.toFixed(2)} ${g2} ${h.toFixed(2)} L${m} ${n.toFixed(2)}` }, g);
        const ring = svgEl('line', { class: 'fw-ring', 'stroke-linecap': 'round' }, g);
        const gap = svgEl('line', { class: 'fw-gap', 'stroke-linecap': 'round' }, g);
        const value = svgEl('line', { class: 'fw-value', stroke: f.color, 'stroke-width': 3.5, 'stroke-linecap': 'round' }, g);
        const hit = svgEl('line', { class: 'fw-hit', 'stroke-linecap': 'round', tabindex: 0, role: 'img', 'data-i': i, 'data-k': k }, g);
        return { value, ring, gap, hit };
      });
      stemEls[i] = g;
      const ic = svgEl('g', { class: 'fw-icon' }, icons);
      svgEl('circle', { r: ICON_SIZE / 2 }, ic);
      const glyph = svgEl('svg', { x: -15, y: -15, width: 30, height: 30, viewBox: '0 0 256 256', fill: 'currentColor' }, ic);
      glyph.innerHTML = (window.SECTOR_ICONS || {})[s.icon] || '';   // shared Fill icons
      iconEls[i] = ic;
    });
  }

  // ---- Wiring ----

  function wire() {
    els.legend.forEach(b => {
      const k = +b.dataset.k;
      b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') setHover(k); });
      b.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') setHover(null); });
      b.addEventListener('focus', () => setHover(k));
      b.addEventListener('blur', () => setHover(null));
      b.addEventListener('click', () => setSort(data.frameworks[k].key));
    });
    els.select.addEventListener('change', () => setSort(els.select.value));
    els.radios.forEach((b, n) => {
      b.addEventListener('click', () => setGroup(b.dataset.group));
      b.addEventListener('keydown', e => {
        const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!dir) return;
        e.preventDefault();
        const next = els.radios[(n + dir + els.radios.length) % els.radios.length];
        next.focus();
        setGroup(next.dataset.group);
      });
    });

    const svg = els.svg;
    svg.addEventListener('pointerover', e => {
      const hit = e.target.closest('.fw-hit');
      if (hit && e.pointerType === 'mouse') showLine(+hit.dataset.i, +hit.dataset.k);
    });
    svg.addEventListener('pointerout', e => {
      const hit = e.target.closest('.fw-hit');
      if (!hit || e.pointerType !== 'mouse' || hit.contains(e.relatedTarget)) return;
      const focused = document.activeElement?.closest?.('.fw-hit');
      focused ? showLine(+focused.dataset.i, +focused.dataset.k) : showLine(null);
    });
    // Clicking (or tapping) a line sorts by its framework, like clicking it in the legend.
    svg.addEventListener('click', e => {
      const hit = e.target.closest('.fw-hit');
      if (hit) sortFromLine(hit);
    });
    svg.addEventListener('focusin', e => {
      const hit = e.target.closest('.fw-hit');
      if (!hit) return;
      showLine(+hit.dataset.i, +hit.dataset.k);
      setRing(hit, hit.matches(':focus-visible'));
    });
    svg.addEventListener('focusout', e => {
      const hit = e.target.closest('.fw-hit');
      if (hit) setRing(hit, false);
      if (!e.relatedTarget?.closest?.('.fw-hit')) showLine(null);
    });
    svg.addEventListener('keydown', e => {
      const hit = e.target.closest('.fw-hit');
      if (!hit) return;
      const i = +hit.dataset.i, k = +hit.dataset.k;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        sortFromLine(hit);
        return;
      }
      let ni = i, nk = k;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const order = currentOrder();
        const slot = order.indexOf(i) + (e.key === 'ArrowLeft' ? -1 : 1);
        if (slot < 0 || slot >= order.length) return;
        ni = order[slot];
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        nk = k + (e.key === 'ArrowUp' ? -1 : 1);
        if (nk < 0 || nk >= data.frameworks.length) return;
      } else return;
      e.preventDefault();
      lineEls[ni][nk].hit.focus();
    });
    // Touch: tapping empty space clears.
    document.addEventListener('pointerdown', e => {
      if ((hover !== null || tipAt) && !e.target.closest?.('.fw-hit, .fw-legend button')) showLine(null);
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const focused = document.activeElement?.closest?.('.fw-hit, .fw-legend button');
      showLine(null);
      setHover(null);
      focused?.blur();
    });
  }

  // ---- State changes ----

  function setSort(key) {
    sortKey = key;
    els.select.value = key;
    render({ animate: true });
  }

  // Sort by the line's framework and keep its tooltip on it while the stems swing round.
  function sortFromLine(hit) {
    const i = +hit.dataset.i, k = +hit.dataset.k;
    setSort(data.frameworks[k].key);
    showLine(i, k);
  }

  function setGroup(key) {
    if (group === key) return;
    group = key;
    render({ animate: true });
  }

  function setHover(k) {
    hover = k;
    paintEmphasis();
  }

  // Emphasise a line (hover, focus or tap) and show its tooltip; null clears.
  function showLine(i, k) {
    tipAt = i == null ? null : { i, k };
    hover = i == null ? null : k;
    paintEmphasis();
    paintTip();
  }

  // Sector indices in slot order: A–Z, or by the sort framework (highest first, ties A–Z).
  function currentOrder() {
    const order = sectors.map((s, i) => i);
    if (sortKey === 'az') return order;
    const k = data.frameworks.findIndex(f => f.key === sortKey);
    return order.sort((a, b) => values(b)[k] - values(a)[k] || a - b);
  }

  const emphasis = () => hover ?? (sortKey === 'az' ? null : data.frameworks.findIndex(f => f.key === sortKey));

  // ---- Render ----

  function render({ animate }) {
    // Group radios and legend pressed state.
    els.radios.forEach(b => {
      const on = b.dataset.group === group;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    els.legend.forEach(b => b.setAttribute('aria-pressed', String(data.frameworks[+b.dataset.k].key === sortKey)));

    // Stems rotate to their slots; icons follow the same arc.
    currentOrder().forEach((i, slot) => {
      const to = slotAngle(slot);
      const from = angle[i] ?? to;
      tween(`angle:${i}`, from, to, animate ? MS.sort : 0, a => placeStem(i, a));
    });

    // Line lengths ease to the group's values.
    sectors.forEach((s, i) => values(i).forEach((v, k) => {
      shown[i] = shown[i] || [];
      const from = shown[i][k] ?? v;
      tween(`len:${i}:${k}`, from, v, animate ? MS.length : 0, x => placeLine(i, k, x));
      lineEls[i][k].hit.setAttribute('aria-label', `${s.name}, ${data.frameworks[k].label} ${pct(v)}`);
    }));

    els.figure.setAttribute('aria-label', `Framework alignment by sector, ${data.groups[group].label}, ${data.year}. ` +
      sectors.map((s, i) => `${s.name}: ` + data.frameworks.map((f, k) => `${f.label} ${pct(values(i)[k])}`).join(', ')).join('; ') + '.');

    paintEmphasis();
    paintTip();
  }

  function placeStem(i, a) {
    angle[i] = a;
    stemEls[i].setAttribute('transform', `rotate(${(-a).toFixed(2)} ${HUB[0]} ${HUB[1]})`);
    const r = a * Math.PI / 180;
    const cx = HUB[0] + ICON_R * Math.cos(r), cy = HUB[1] - ICON_R * Math.sin(r);
    iconEls[i].setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`);
    if (tipAt?.i === i) paintTip();
  }

  // Value line from local x 310 to 310 + v × 220 (100% = stem end) along the guide's slope (≥ 0.5 so zeros show as dots).
  function placeLine(i, k, v) {
    shown[i][k] = v;
    const o = off(k);
    const [x1, y1] = abs(VALUE.start, yAt(o, VALUE.start));
    const x2l = VALUE.start + Math.max(v * VALUE.length, 0.5);
    const [x2, y2] = abs(x2l, yAt(o, x2l));
    Object.values(lineEls[i][k]).forEach(line => {
      line.setAttribute('x1', x1); line.setAttribute('y1', y1.toFixed(2));
      line.setAttribute('x2', x2.toFixed(1)); line.setAttribute('y2', y2.toFixed(2));
    });
  }

  function paintEmphasis() {
    const k = emphasis();
    lineEls.forEach(stem => stem.forEach((l, n) => l.value.setAttribute('opacity', k == null || n === k ? 1 : DIM)));
    els.legend.forEach(b => {
      const n = +b.dataset.k;
      b.classList.toggle('is-emphasised', k === n);
      b.classList.toggle('is-muted', k != null && k !== n);
    });
    const shape = els.centerShape;
    if (k == null) {
      shape.classList.remove('is-visible');
      els.center.classList.remove('is-visible');
      return;
    }
    const f = data.frameworks[k];
    const g = data.groups[group];
    const caption = g.centerCaption.replace('{framework}', f.label);
    const [line1, line2] = caption.split(/(?<=companies) /);
    shape.setAttribute('fill', tint(f.color, TINT));
    shape.classList.add('is-visible');
    els.center.style.color = f.textColor;
    els.center.querySelector('.fw-center__value').textContent = pct(g.overall[k]);
    els.center.querySelector('.fw-center__caption').innerHTML = `${esc(line1)}<br>${esc(line2 || '')}`;
    els.center.classList.add('is-visible');
    const message = `${pct(g.overall[k])} ${caption}`;
    if (els.live.textContent !== message) els.live.textContent = message;
  }

  // Tooltip centred 40px past the guides' end along the hovered stem (on the line's mirrored side, as in E3).
  function paintTip() {
    const tip = els.tip;
    if (!tipAt) { tip.classList.remove('is-visible'); return; }
    const { i, k } = tipAt;
    const f = data.frameworks[k];
    tip.innerHTML = `<span class="fw-tip__name">${esc(sectors[i].name)}</span>` +
      `<span class="fw-tip__row"><span class="fw-tip__swatch" aria-hidden="true" style="background:${f.color}"></span>` +
      `${esc(f.label)} <strong>${pct(values(i)[k])}</strong></span>`;
    const [cx, cy] = rotate(GUIDE.end + TIP_PAST, -off(k), angle[i]);
    const h = tip.offsetHeight;
    tip.style.left = `${Math.max(EDGE, Math.min(cx - TIP_W / 2, STAGE_W - EDGE - TIP_W))}px`;
    tip.style.top = `${cy - h / 2}px`;
    tip.classList.add('is-visible');
  }

  // Keyboard focus ring: a 3px Anchor stroke 2px clear of the focused line.
  function setRing(hit, on) {
    const l = lineEls[+hit.dataset.i][+hit.dataset.k];
    l.ring.classList.toggle('is-on', on);
    l.gap.classList.toggle('is-on', on);
  }
})();
