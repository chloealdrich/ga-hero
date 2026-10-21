/*
 * Hero: "The Evolution of Sustainability Reporting"
 * Scroll-driven line chart. All content comes from data.json; geometry follows
 * the 1440 × 900 reference frames in hero-spec.md.
 */
(() => {
  'use strict';

  // ---- Reference geometry (1440 × 900) ----
  const STAGE_W = 1440;
  const STAGE_H = 900;
  const X_START = 160;            // x of the first year
  const X_END = 1070;             // x of the domain end
  const PLOT_LEFT = 104;
  const PLOT_RIGHT = 1392;
  const PLOT_TOP = 372;           // 100%
  const BASELINE = 752;           // 0%
  const Y_PER_PCT = (BASELINE - PLOT_TOP) / 100;
  const GRID_STEPS = [100, 75, 50, 25];
  const GRID_OPACITY = 0.5;
  const HIT_RADIUS = 20;          // hover target around an event's points (and the split connector)
  const Y_LABEL_X = 92;
  const PLAYHEAD_OVERSHOOT = 8;
  const MIN_DOMAIN_END = 2015;
  const LABEL_GAP = 14;
  const LABEL_HALF_HEIGHT = 9;    // 18px line height, centred on the point
  const LABEL_MIN_SPACING = 20;
  const BAND_INSET = 10;
  const R_POINT = 3.5;
  const R_HEAD = 6;
  const R_STALK_DOT = 3.5;

  // Event card placement per anchor type, from the T1–T3 frames.
  const CARD = {
    point: { width: 340, offsetX: -40, gapAbovePoint: 102 },
    split: { width: 380, gapRight: 56, top: 500, stalkY: 570 },
    gap:   { width: 340, top: 505, stalkTop: 450 },
  };

  const C = {
    anchor: '#003973',
    graphite: '#474747',
    line: '#d6d6d6',
    clarity10: '#e6f0fc',
  };

  const SPACING_MS = 240;
  const YEAR_EPSILON = 0.01;
  const SETTLE_DELAY_MS = 120;    // fallback idle time where `scrollend` is unsupported
  const SETTLE_COMMIT_PX = 24;    // scroll this far past a year and it carries on to the next
  const ease = cubicBezier(.2, .8, .2, 1);
  const NS = 'http://www.w3.org/2000/svg';

  // ---- DOM ----
  const root = document.querySelector('[data-hero]');
  if (!root) return;
  const stage = root.querySelector('[data-stage]');
  const chart = root.querySelector('[data-chart]');
  const overlay = root.querySelector('[data-overlay]');
  const layer = name => root.querySelector(`[data-layer="${name}"]`);
  const L = {
    grid: layer('grid'),
    band: layer('band'),
    playhead: layer('playhead'),
    connector: layer('connector'),
    stalks: layer('stalks'),
    series: layer('series'),
    hits: layer('hits'),
  };
  const calloutYear = root.querySelector('[data-callout-year]');
  const calloutBlurb = root.querySelector('[data-callout-blurb]');
  const sourceEl = root.querySelector('[data-source]');
  const cta = root.querySelector('[data-cta]');
  const CTA_HIDE_AFTER_PX = 2;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---- State ----
  let data, Y0, Y1, brk;
  let t;                    // continuous current year
  let shownYear = null;     // integer year last written to the call-out
  let domainEnd;            // displayed (tweened) x-domain end
  let tween = null;         // { from, to, start }
  let raf = 0;
  let previewId = null;     // past event whose card is shown on hover/focus
  let lastScrollY = window.scrollY;
  let scrollDir = 1;
  let settleTimer = 0;
  const els = { xlabels: new Map(), lineLabels: new Map(), cards: new Map(), stalks: new Map(), events: new Map(), hits: new Map() };
  const cardHeights = new Map();

  fetch('data.json')
    .then(r => {
      if (!r.ok) throw new Error(`data.json: HTTP ${r.status}`);
      return r.text();
    })
    .then(text => init(parseData(text)))
    .catch(err => console.error('[hero] could not load data.json', err));

  // ---- Data ----

  function parseData(text) {
    // Quote year-keyed numbers before parsing so values keep their source
    // formatting (the spec shows "86.0%", which JSON.parse would turn into 86).
    const d = JSON.parse(text.replace(/("\d{4}"\s*:\s*)(-?\d+(?:\.\d+)?)/g, '$1"$2"'));
    d.series.forEach(s => {
      s.points = Object.keys(s.values)
        .map(Number)
        .sort((a, b) => a - b)
        .map(year => ({ year, value: Number(s.values[year]), text: String(s.values[year]) }));
    });
    return d;
  }

  const isBreak = (a, b) => a === brk.after && b === brk.before;

  // Last data point at or before `year` (never crosses into a year the series lacks).
  function pointAt(s, year) {
    let found = null;
    for (const p of s.points) if (p.year <= year) found = p;
    return found;
  }

  function labelFor(s, year) {
    return year >= s.fullLabelFrom ? s.labelFull : s.labelEarly;
  }

  function blurbFor(year) {
    let best = null;
    for (const key of Object.keys(data.yearBlurbs)) {
      const k = Number(key);
      if (Number.isInteger(k) && k <= year && (best === null || k > best)) best = k;
    }
    return best === null ? '' : data.yearBlurbs[best];
  }

  // ---- Scales ----

  const xs = year => X_START + (year - Y0) / (domainEnd - Y0) * (X_END - X_START);
  const ys = value => BASELINE - value * Y_PER_PCT;
  const targetDomainEnd = year => Math.min(Math.max(Math.floor(year) + 1, MIN_DOMAIN_END), Y1);

  function anchorX(a) {
    if (a.type === 'gap') return (xs(a.between[0]) + xs(a.between[1])) / 2;
    return xs(a.year);
  }

  // ---- Setup ----

  function init(d) {
    data = d;
    [Y0, Y1] = data.years;
    brk = data.methodologyBreak;
    sourceEl.textContent = `Source: ${data.source}`;

    buildStatic();
    buildDynamic();
    buildSnapPoints();

    reducedMotion.addEventListener('change', applyMotionMode);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setPreview(null); });
    window.addEventListener('scroll', onScroll, { passive: true });
    if ('onscrollend' in window) window.addEventListener('scrollend', settle);
    // Also fires when the Overview tab is shown again: re-measure what was hidden.
    window.addEventListener('resize', () => { fitStage(); measureCards(); schedule(); });
    cta.addEventListener('click', e => { e.preventDefault(); goToYear(Y0 + 1); });
    if (document.fonts) document.fonts.ready.then(() => { measureCards(); schedule(); });

    fitStage();
    measureCards();
    applyMotionMode();
  }

  function applyMotionMode() {
    root.classList.toggle('is-static', reducedMotion.matches);
    tween = null;
    domainEnd = undefined;
    schedule();
  }

  function fitStage() {
    const scale = Math.min(stage.parentElement.clientWidth / STAGE_W, stage.parentElement.clientHeight / STAGE_H);
    stage.style.setProperty('--hero-scale', scale);
  }

  function svg(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }

  function html(tag, className, parent, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }

  function buildStatic() {
    const grid = svg('g', { stroke: C.line, 'stroke-width': 1, 'stroke-opacity': GRID_OPACITY }, L.grid);
    GRID_STEPS.forEach(v => svg('line', { x1: PLOT_LEFT, y1: ys(v), x2: PLOT_RIGHT, y2: ys(v) }, grid));
    svg('line', { x1: PLOT_LEFT, y1: BASELINE, x2: PLOT_RIGHT, y2: BASELINE, stroke: C.graphite, 'stroke-width': 1 }, L.grid);

    const yl = svg('g', { 'font-size': 12, fill: C.graphite, 'text-anchor': 'end' }, L.grid);
    [...GRID_STEPS, 0].forEach(v => {
      svg('text', { x: Y_LABEL_X, y: ys(v) + 4 }, yl).textContent = `${v}%`;
    });
  }

  function buildDynamic() {
    // X-axis years are buttons: clicking one scrolls back (or ahead) to that year.
    for (let y = Y0; y <= Y1; y++) {
      const btn = html('button', 'hero-year', overlay, y);
      btn.type = 'button';
      btn.setAttribute('aria-label', `Go to ${y}`);
      btn.addEventListener('click', () => goToYear(y));
      els.xlabels.set(y, btn);
    }

    svg('rect', { y: PLOT_TOP, height: BASELINE - PLOT_TOP, fill: C.clarity10 }, L.band);
    svg('line', { y1: PLOT_TOP - PLAYHEAD_OVERSHOOT, y2: BASELINE, stroke: C.anchor, 'stroke-width': 1.5 }, L.playhead);
    svg('line', { stroke: C.graphite, 'stroke-width': 1.5, 'stroke-dasharray': '3 4' }, L.connector);

    // Line-end labels, in data order so screen readers meet them top-down.
    data.series.forEach(s => els.lineLabels.set(s.id, html('span', 'hero-line-label', overlay)));

    data.events.forEach(e => {
      const g = svg('g', { class: 'hero__stalk', stroke: C.anchor, fill: C.anchor }, L.stalks);
      svg('line', { 'stroke-width': 1.5 }, g);
      svg('circle', { r: R_STALK_DOT, stroke: 'none' }, g);
      els.stalks.set(e.id, g);

      const card = html('div', 'hero-card', overlay);
      card.setAttribute('role', 'note');
      card.style.width = `${CARD[e.anchor.type].width}px`;
      html('div', 'hero-card__eyebrow', card, e.eyebrow);
      html('div', 'hero-card__title', card, e.title);
      html('p', 'hero-card__body', card, e.body);
      els.cards.set(e.id, card);

      card.id = `hero-event-${e.id}`;
      const row = html('button', 'hero-event', overlay);
      row.type = 'button';
      row.setAttribute('aria-describedby', card.id);
      html('span', 'hero-event__marker', row).setAttribute('aria-hidden', 'true');
      row.appendChild(document.createTextNode(e.title));
      row.addEventListener('pointerenter', () => setPreview(e.id));
      row.addEventListener('pointerleave', () => setPreview(null));
      row.addEventListener('focus', () => setPreview(e.id));
      row.addEventListener('blur', () => setPreview(null));
      els.events.set(e.id, row);

      // Hover targets on the line itself (same preview as the event row).
      const hits = svg('g', { display: 'none' }, L.hits);
      eventPoints(e).forEach(() => svg('circle', { r: HIT_RADIUS }, hits));
      if (e.anchor.type === 'gap') svg('rect', { y: PLOT_TOP, height: BASELINE - PLOT_TOP }, hits);
      if (e.anchor.type === 'split') svg('rect', { width: 2 * HIT_RADIUS }, hits);
      hits.addEventListener('pointerenter', () => setPreview(e.id));
      hits.addEventListener('pointerleave', () => setPreview(null));
      els.hits.set(e.id, hits);
    });
  }

  // The data points on the line that belong to an event.
  function eventPoints(e) {
    const a = e.anchor;
    const years = a.type === 'gap' ? a.between : [a.year];
    const series = a.type === 'point' ? data.series.filter(s => s.id === a.series) : data.series;
    const out = [];
    series.forEach(s => s.points.forEach(p => {
      if (years.includes(p.year)) out.push(p);
    }));
    return out;
  }

  // One snap target per year; the CTA jumps to the second year's.
  function buildSnapPoints() {
    root.style.setProperty('--hero-steps', Y1 - Y0);
    for (let y = Y0; y <= Y1; y++) {
      const point = html('div', 'hero-snap-point', root);
      point.id = `hero-year-${y}`;
      point.setAttribute('aria-hidden', 'true');
      point.style.setProperty('--i', y - Y0);
    }
    cta.setAttribute('href', `#hero-year-${Y0 + 1}`);
  }

  // Scroll to a year's snap point; the smooth scroll replays the line on the way.
  function goToYear(y) {
    if (reducedMotion.matches) return;
    const point = document.getElementById(`hero-year-${y}`);
    window.scrollTo({ top: root.offsetTop + point.offsetTop, behavior: 'smooth' });
  }

  // ---- Settle on a whole year once scrolling stops ----
  // Scrolling itself is free (no CSS snap, which fights fast wheel input); when it
  // ends we ease to a year, leaning in the direction the user was scrolling.

  function onScroll() {
    const y = window.scrollY;
    if (y !== lastScrollY) scrollDir = Math.sign(y - lastScrollY);
    lastScrollY = y;
    schedule();
    if (!('onscrollend' in window)) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, SETTLE_DELAY_MS);
    }
  }

  function settle() {
    if (reducedMotion.matches) return;
    const span = root.offsetHeight - window.innerHeight;
    if (span <= 0) return;
    const yearPx = span / (Y1 - Y0);
    const pos = (window.scrollY - root.offsetTop) / yearPx;  // years since Y0
    if (pos <= 0 || pos >= Y1 - Y0) return;
    const fracPx = (pos - Math.floor(pos)) * yearPx;
    if (fracPx < 1 || yearPx - fracPx < 1) return;            // already on a year
    const lean = scrollDir < 0 ? yearPx - fracPx : fracPx;     // distance travelled into the gap
    const step = lean > SETTLE_COMMIT_PX ? (scrollDir < 0 ? Math.floor(pos) : Math.ceil(pos))
                                         : (scrollDir < 0 ? Math.ceil(pos) : Math.floor(pos));
    goToYear(Y0 + step);
  }

  function setPreview(id) {
    if (previewId === id) return;
    previewId = id;
    schedule();
  }

  // offsetHeight ignores the stage transform, so heights stay in frame px.
  function measureCards() {
    els.cards.forEach((card, id) => cardHeights.set(id, card.offsetHeight));
  }

  // ---- Frame loop ----

  function schedule() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function scrollProgress() {
    const r = root.getBoundingClientRect();
    const span = r.height - window.innerHeight;
    return span > 0 ? Math.min(Math.max(-r.top / span, 0), 1) : 1;
  }

  function frame(now) {
    raf = 0;
    t = reducedMotion.matches ? Y1 : Y0 + scrollProgress() * (Y1 - Y0);
    // Snap points can land a sub-pixel short of a year; treat that as the year itself.
    if (Math.abs(t - Math.round(t)) < YEAR_EPSILON) t = Math.round(t);
    const scrolled = -root.getBoundingClientRect().top > CTA_HIDE_AFTER_PX;
    cta.classList.toggle('is-hidden', reducedMotion.matches || scrolled);
    updateDomain(now);
    render();
    if (tween) schedule();
  }

  function updateDomain(now) {
    const target = targetDomainEnd(t);
    if (reducedMotion.matches || domainEnd === undefined) {
      domainEnd = target;
      tween = null;
      return;
    }
    if (tween ? tween.to !== target : domainEnd !== target) {
      tween = { from: domainEnd, to: target, start: now };
    }
    if (tween) {
      const k = Math.min((now - tween.start) / SPACING_MS, 1);
      domainEnd = tween.from + (tween.to - tween.from) * ease(k);
      if (k >= 1) tween = null;
    }
  }

  // ---- Render ----

  function render() {
    const year = Math.floor(t);
    const target = targetDomainEnd(t);

    // X labels: every year up to the target domain end; the current one is the pill.
    els.xlabels.forEach((el, y) => {
      el.style.left = `${xs(y)}px`;
      el.classList.toggle('is-visible', y <= target);
      el.classList.toggle('is-current', y === year);
      if (y === year) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });

    // Methodology band
    const band = L.band.firstChild;
    if (t >= brk.before) {
      band.setAttribute('x', xs(brk.after) + BAND_INSET);
      band.setAttribute('width', Math.max(xs(brk.before) - xs(brk.after) - 2 * BAND_INSET, 0));
      band.removeAttribute('display');
    } else {
      band.setAttribute('display', 'none');
    }

    // Playhead
    const ph = L.playhead.firstChild;
    ph.setAttribute('x1', xs(t));
    ph.setAttribute('x2', xs(t));

    renderConnector();
    renderSeries(year);
    renderEvents(year);

    if (year !== shownYear) {
      shownYear = year;
      calloutYear.textContent = year;
      calloutBlurb.textContent = blurbFor(year);
      chart.setAttribute('aria-label', describe(year));
    }
  }

  // The year every series starts at once (2018): dashed split cue between their points.
  function splitYear() {
    const e = data.events.find(ev => ev.anchor.type === 'split');
    return e ? e.anchor.year : null;
  }

  function renderConnector() {
    const line = L.connector.firstChild;
    const sy = splitYear();
    if (sy === null || t < sy) {
      line.setAttribute('display', 'none');
      return;
    }
    const yv = data.series.map(s => s.points.find(p => p.year === sy)).filter(Boolean).map(p => ys(p.value));
    const x = xs(sy);
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.setAttribute('y1', Math.min(...yv));
    line.setAttribute('y2', Math.max(...yv));
    line.removeAttribute('display');
  }

  // Points revealed up to t, split into segments at the methodology break.
  function reveal(s) {
    const segs = [];
    const dots = [];
    let seg = null;
    let head = null;
    const pts = s.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.year > t) break;
      if (!seg || isBreak(pts[i - 1].year, p.year)) segs.push(seg = []);
      const pt = { x: xs(p.year), y: ys(p.value) };
      seg.push(pt);
      dots.push(pt);
      head = pt;
      const n = pts[i + 1];
      if (n && n.year > t && !isBreak(p.year, n.year)) {
        const f = (t - p.year) / (n.year - p.year);
        if (f > 0) {
          head = { x: xs(t), y: ys(p.value + (n.value - p.value) * f) };
          seg.push(head);
        }
      }
    }
    return { segs, dots, head };
  }

  function renderSeries(year) {
    let out = '';
    const labels = [];
    // Back to front: last series in data.json is drawn first.
    [...data.series].reverse().forEach(s => {
      const label = els.lineLabels.get(s.id);
      const { segs, dots, head } = reveal(s);
      if (!head) {
        label.hidden = true;
        return;
      }
      segs.forEach(seg => {
        if (seg.length > 1) {
          out += `<polyline fill="none" stroke="${s.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="${seg.map(p => `${p.x},${p.y}`).join(' ')}"/>`;
        }
      });
      out += `<g fill="${s.color}">`;
      dots.forEach(p => { if (p !== head) out += `<circle cx="${p.x}" cy="${p.y}" r="${R_POINT}"/>`; });
      out += `<circle cx="${head.x}" cy="${head.y}" r="${R_HEAD}"/></g>`;

      const p = pointAt(s, year);
      label.hidden = false;
      label.textContent = `${labelFor(s, year)} · ${p.text}%`;
      labels.push({ el: label, x: head.x + LABEL_GAP, y: head.y - LABEL_HALF_HEIGHT });
    });
    L.series.innerHTML = out;

    // Keep line-end labels from overlapping when values converge.
    labels.sort((a, b) => a.y - b.y);
    labels.forEach((l, i) => {
      if (i > 0) l.y = Math.max(l.y, labels[i - 1].y + LABEL_MIN_SPACING);
      l.el.style.left = `${l.x}px`;
      l.el.style.top = `${l.y}px`;
    });
  }

  function renderEvents(year) {
    // A hovered/focused past event replaces the current year's card while previewed.
    const preview = data.events.find(e => e.id === previewId && e.year <= year);
    data.events.forEach(e => {
      const active = e.year === year;
      const shown = preview ? e === preview : active;
      const ax = anchorX(e.anchor);
      const card = els.cards.get(e.id);
      const stalk = els.stalks.get(e.id);
      const row = els.events.get(e.id);
      const [line, dot] = stalk.children;
      const h = cardHeights.get(e.id) || 0;
      const cfg = CARD[e.anchor.type];
      let left, top, x1, y1, x2, y2;

      if (e.anchor.type === 'point') {
        const s = data.series.find(sr => sr.id === e.anchor.series);
        const p = s.points.find(pt => pt.year === e.anchor.year);
        const py = ys(p.value);
        left = ax + cfg.offsetX;
        top = py - cfg.gapAbovePoint - h;
        x1 = x2 = ax; y1 = top + h; y2 = py;
      } else if (e.anchor.type === 'split') {
        left = ax - cfg.gapRight - cfg.width;
        top = cfg.top;
        x1 = left + cfg.width; x2 = ax; y1 = y2 = cfg.stalkY;
      } else {
        left = ax - cfg.width / 2;
        top = cfg.top;
        x1 = x2 = ax; y1 = top; y2 = cfg.stalkTop;
      }

      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      card.classList.toggle('is-active', shown);
      card.setAttribute('aria-hidden', String(!shown));

      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      dot.setAttribute('cx', x2); dot.setAttribute('cy', y2);
      stalk.classList.toggle('is-active', shown);

      row.style.left = `${ax}px`;
      row.classList.toggle('is-visible', e.year <= year);
      row.classList.toggle('is-active', active);
      row.classList.toggle('is-previewed', e === preview);

      const hits = els.hits.get(e.id);
      if (e.year <= year) {
        hits.removeAttribute('display');
        const circles = hits.querySelectorAll('circle');
        eventPoints(e).forEach((p, i) => {
          circles[i].setAttribute('cx', xs(p.year));
          circles[i].setAttribute('cy', ys(p.value));
        });
        const rect = hits.querySelector('rect');
        if (rect && e.anchor.type === 'gap') {
          rect.setAttribute('x', xs(e.anchor.between[0]) + BAND_INSET);
          rect.setAttribute('width', Math.max(xs(e.anchor.between[1]) - xs(e.anchor.between[0]) - 2 * BAND_INSET, 0));
        } else if (rect) {
          // Strip along the dashed split connector, between its top and bottom points.
          const yv = eventPoints(e).map(p => ys(p.value));
          rect.setAttribute('x', anchorX(e.anchor) - HIT_RADIUS);
          rect.setAttribute('y', Math.min(...yv));
          rect.setAttribute('height', Math.max(...yv) - Math.min(...yv));
        }
      } else {
        hits.setAttribute('display', 'none');
      }
    });
  }

  // ---- Accessible description ----

  function describe(year) {
    const parts = [year > Y0 ? `Timeline chart, ${Y0} to ${year}.` : `Timeline chart at ${year}.`];
    const shown = data.series
      .map(s => ({ s, p: pointAt(s, year) }))
      .filter(o => o.p);
    parts.push(`Share of companies publishing a sustainability report in ${year}: ` +
      shown.map(o => `${labelFor(o.s, year)} ${o.p.text}%`).join(', ') + '.');
    const later = data.series.filter(s => s.points[0].year > year);
    if (later.length) {
      parts.push(`${later.map(s => s.labelFull).join(' and ')} data begin in ${later[0].points[0].year}.`);
    }
    if (year >= brk.before) {
      parts.push(`All lines break between ${brk.after} and ${brk.before} because the methodology changed.`);
    }
    return parts.join(' ');
  }

  // ---- Easing ----

  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = u => ((ax * u + bx) * u + cx) * u;
    const sy = u => ((ay * u + by) * u + cy) * u;
    const dx = u => (3 * ax * u + 2 * bx) * u + cx;
    return x => {
      let u = x;
      for (let i = 0; i < 8; i++) {
        const err = sx(u) - x;
        const d = dx(u);
        if (Math.abs(err) < 1e-5 || !d) break;
        u -= err / d;
      }
      return sy(Math.min(Math.max(u, 0), 1));
    };
  }
})();
