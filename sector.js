/*
 * Section 2: "Reporting by Sector"
 * Packed-circle chart, one circle per GICS sector and one dot per company.
 * All counts come from sector-data.json; geometry follows the 1440 × 900
 * frames in frames/sector/ (see sector-spec.md).
 */
(() => {
  'use strict';

  // ---- Reference geometry (1440 × 900) ----
  const STAGE_W = 1440;
  const STAGE_H = 900;
  const DOT_SPACING = 5.6;        // sunflower spiral step
  const GOLDEN_ANGLE = 2.399963;  // rad
  const DOT_R = 3;
  const CIRCLE_PAD = 6;           // circle edge beyond the outermost dot
  const SINGLE_DOT_R = 9;
  const CIRCLE_GAP = 10;          // between neighbouring sector circles
  const PLOT_TOP = 380;           // full view: below the intro text
  const SPLIT_PLOT_TOP = 405;     // split view: 24px below the split headers (which end ~381)
  const PLOT_BOTTOM = 770;        // above the year slider
  const CARD_GAP = 12;
  const CARD_W = { full: 300, split: 300 };   // spec allows 280–300; 280 wraps the split rows in Runda
  const SPLIT_CARD_MIN_TOP = 330; // below the intro text
  const DIVIDER_X = 720;
  // Dot motion (colour and opacity only; keep FADE_MS in step with --t-fill in sector.css).
  const FADE_MS = 240;
  const SWEEP_MS = 220;           // a colour change travels across the changed band
  const OUTWARD_MS = 220;         // fades spread from a circle's centre to its edge
  const PLAY_STEP_MS = 700;       // per year when playing; each year's dot animation finishes in ~460ms
  const DELTA_HOLD_MS = 2500;     // change bubbles fade this long after the last year change
  // Phosphor arrow-up / arrow-down (Bold) for the change bubbles.
  const ARROWS = {
    up: '<path d="M208.49,120.49a12,12,0,0,1-17,0L140,69V216a12,12,0,0,1-24,0V69L64.49,120.49a12,12,0,0,1-17-17l72-72a12,12,0,0,1,17,0l72,72A12,12,0,0,1,208.49,120.49Z"/>',
    down: '<path d="M208.49,152.49l-72,72a12,12,0,0,1-17,0l-72-72a12,12,0,0,1,17-17L116,187V40a12,12,0,0,1,24,0V187l51.51-51.52a12,12,0,0,1,17,17Z"/>',
  };

  // Reference sector centres (2025) by sector id. Full view from the spec table;
  // split views read from the S3 frame. Packing starts here for every year;
  // `compact` layouts are then drawn together to CIRCLE_GAP spacing.
  const REF = {
    russell1000: {
      bounds: [104, 1336],
      centers: {
        'information-technology': [262.5, 566.1], 'industrials': [429.2, 556.3],
        'communications': [562.7, 588.4], 'utilities': [630.7, 516.0],
        'consumer-staples': [665.7, 616.3], 'energy': [726.5, 531.0],
        'consumer-discretionary': [797.2, 633.0], 'health-care': [839.2, 491.1],
        'financials': [953.7, 597.7], 'real-estate': [1089.3, 551.4],
        'materials': [1202.0, 567.6],
      },
    },
    sp500: {
      bounds: [104, 664],
      compact: true,
      centers: {
        'communications': [337.2, 557.2], 'consumer-discretionary': [455.1, 557.2],
        'consumer-staples': [376.9, 637.0], 'energy': [378.4, 485.9],
        'financials': [515.6, 662.3], 'health-care': [496.8, 452.2],
        'industrials': [243.3, 485.2], 'information-technology': [239.6, 619.8],
        'materials': [573.9, 532.1], 'real-estate': [634.2, 606.0],
        'utilities': [133.8, 554.0],
      },
    },
    smallestHalf: {
      bounds: [776, 1336],
      compact: true,
      centers: {
        'communications': [970.1, 572.2], 'consumer-discretionary': [1129.2, 572.2],
        'consumer-staples': [1019.9, 646.7], 'energy': [1021.6, 504.0],
        'financials': [1164.0, 697.7], 'health-care': [1137.1, 458.1],
        'industrials': [863.8, 488.6], 'information-technology': [862.4, 646.3],
        'materials': [1262.2, 510.2], 'real-estate': [1281.8, 616.3],
        'utilities': [1012.9, 438.6],
      },
    },
  };

  const FULL = 'russell1000';
  const HALVES = ['sp500', 'smallestHalf'];   // left, right

  // ---- DOM ----
  const root = document.querySelector('[data-sector]');
  if (!root) return;
  const $ = sel => root.querySelector(sel);
  const stage = $('[data-sector-stage]');
  const plot = $('[data-sector-plot]');
  const chart = $('[data-sector-chart]');
  const targetsEl = $('[data-sector-targets]');
  const card = $('[data-sector-card]');
  const slider = $('[data-sector-slider]');
  const yearsEl = $('[data-sector-years]');
  const ticksEl = $('[data-slider-ticks]');
  const sliderFill = $('[data-slider-fill]');
  const sliderThumb = $('[data-slider-thumb]');
  const playBtn = $('[data-sector-play]');
  const legend = $('[data-sector-legend]');
  const table = $('[data-sector-table]');

  // ---- State ----
  let data, years, layouts;
  let year;
  let view = 'full';
  let active = null;      // index of the highlighted sector: hovered, else focused
  let hovered = null;
  let focused = null;
  const sectorsUI = [];   // per sector: { layer, circles, dots: Map, targets, prevNon }
  let pendingFadeIns = [];
  let playTimer = 0;
  let deltasOn = false;   // change bubbles showing (after a year change)
  let deltaTimer = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  fetch('sector-data.json')
    .then(r => {
      if (!r.ok) throw new Error(`sector-data.json: HTTP ${r.status}`);
      return r.json();
    })
    .then(init)
    .catch(err => console.error('[sector] could not load sector-data.json', err));

  // ---- Data helpers ----

  function counts(group, i, y = year) {
    const g = data.groups[group];
    const total = g.totals[y][i];
    const non = g.nonReporters[y][i];
    return { total, non, rep: total - non };
  }

  function groupCounts(group, y = year) {
    const g = data.groups[group];
    const total = g.totals[y].reduce((a, b) => a + b, 0);
    const non = g.nonReporters[y].reduce((a, b) => a + b, 0);
    return { total, non, rep: total - non };
  }

  const pct = (part, whole) => (whole ? (part / whole) * 100 : 0).toFixed(1);
  const fmt = n => n.toLocaleString('en-US');
  const circleR = n => (n <= 0 ? 0 : n === 1 ? SINGLE_DOT_R : DOT_SPACING * Math.sqrt(n - 0.5) + DOT_R + CIRCLE_PAD);

  // ---- Layout: pack sector circles per group and year ----

  function pack(group, y) {
    const ref = REF[group];
    const ids = data.sectors.map(s => s.id);
    const nodes = ids.map((id, i) => {
      const [x, yy] = ref.centers[id];
      return { x, y: yy, rx: x, ry: yy, r: circleR(data.groups[group].totals[y][i]) };
    });
    const [x0, x1] = ref.bounds;
    const top = ref.compact ? SPLIT_PLOT_TOP : PLOT_TOP;

    const collide = () => {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          const min = a.r + b.r + CIRCLE_GAP;
          if (d >= min) continue;
          if (d === 0) { dx = 1; dy = 0; d = 1; }
          const push = (min - d) / 2;
          a.x -= dx / d * push; a.y -= dy / d * push;
          b.x += dx / d * push; b.y += dy / d * push;
        }
      }
    };
    const clamp = () => nodes.forEach(n => {
      n.x = Math.min(Math.max(n.x, x0 + n.r), x1 - n.r);
      n.y = Math.min(Math.max(n.y, top + n.r), PLOT_BOTTOM - n.r);
    });

    if (ref.compact) {
      // Split halves: the frame's reference spots are loosely spaced, so pull every
      // circle toward its half's centre until neighbours sit CIRCLE_GAP apart.
      // Starting from the reference spots keeps each sector's place in the cluster.
      const cx = nodes.reduce((a, n) => a + n.rx, 0) / nodes.length;
      const cy = nodes.reduce((a, n) => a + n.ry, 0) / nodes.length;
      for (let k = 0; k < 400; k++) {
        const pull = Math.max(0.06 * (1 - k / 400), 0.01);   // never zero, so every circle settles against a neighbour
        nodes.forEach(n => {
          n.x += (cx - n.x) * pull;
          n.y += (cy - n.y) * pull;
        });
        collide();
        clamp();
      }
    } else {
      // Full view: resolve overlaps while pulling each circle back toward its 2025
      // reference spot (already packed along the band's centreline), so 2025 matches
      // the frames and other years read as circles resizing, not reshuffling.
      for (let k = 0; k < 300; k++) {
        collide();
        nodes.forEach(n => {
          n.x += (n.rx - n.x) * 0.05;
          n.y += (n.ry - n.y) * 0.05;
        });
        clamp();
      }
    }
    for (let k = 0; k < 60; k++) { collide(); clamp(); }
    return nodes.map(({ x, y: yy, r }) => ({ x, y: yy, r }));
  }

  // Dot k of a circle on the sunflower spiral.
  function spiral(cx, cy, k, n) {
    if (n === 1) return [cx, cy];
    const rad = DOT_SPACING * Math.sqrt(k + 0.5);
    const a = k * GOLDEN_ANGLE;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  }

  /*
   * A dot is keyed by its circle (the view's group) and its spiral index, so a year
   * change keeps every dot in its place: only the boundary between non-reporters
   * (the first indexes, at the centre) and reporters moves, and outer dots come and
   * go. A view change swaps one set of circles for the other.
   */
  function dotTargets(i) {
    const out = [];
    (view === 'full' ? [FULL] : HALVES).forEach(g => {
      const c = layouts[g][year][i];
      const { total, non } = counts(g, i);
      const maxRad = DOT_SPACING * Math.sqrt(Math.max(total - 1, 0) + 0.5);
      for (let k = 0; k < total; k++) {
        const [x, y] = spiral(c.x, c.y, k, total);
        out.push({ key: `${g}|${k}`, g, k, x, y, non: k < non, nonCount: non, rad: DOT_SPACING * Math.sqrt(k + 0.5), maxRad });
      }
    });
    return out;
  }

  // Delay for a fade that spreads from the centre of a circle to its edge.
  const outwardDelay = (rad, maxRad) => (maxRad ? OUTWARD_MS * rad / maxRad : 0);

  // ---- Setup ----

  function init(d) {
    data = d;
    years = Object.keys(data.groups[FULL].totals).map(Number).sort((a, b) => a - b);
    year = years[years.length - 1];

    layouts = {};
    [FULL, ...HALVES].forEach(g => {
      layouts[g] = {};
      years.forEach(y => { layouts[g][y] = pack(g, y); });
    });

    $('[data-sector-source]').textContent = `Source: ${data.source}`;
    $('[data-view-label="russell1000"]').textContent = data.groups[FULL].label;

    slider.min = years[0];
    slider.max = years[years.length - 1];
    slider.value = year;
    years.forEach((y, k) => {
      const f = k / (years.length - 1);
      el('span', 'year-slider__tick', ticksEl).style.setProperty('--f', f);
      const label = el('span', '', yearsEl);
      label.textContent = y;
      label.dataset.year = y;
      label.style.setProperty('--f', f);
      label.addEventListener('click', () => { stopPlayback(); setYear(y); });   // mouse shortcut; the input handles keys
    });

    buildSectors();

    slider.addEventListener('input', () => { stopPlayback(); setYear(Number(slider.value)); });
    playBtn.addEventListener('click', () => (playTimer ? stopPlayback() : startPlayback()));
    root.querySelectorAll('input[name="sector-view"]').forEach(r =>
      r.addEventListener('change', () => { if (r.checked) { view = r.value; render(); } }));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { hovered = focused = null; updateActive(); }
    });
    window.addEventListener('resize', fitStage);

    fitStage();
    // First paint lands in place; transitions only apply to later changes.
    root.classList.add('is-instant');
    render();
    void root.offsetWidth;
    root.classList.remove('is-instant');
  }

  function fitStage() {
    const scale = Math.min(root.clientWidth / STAGE_W, root.clientHeight / STAGE_H);
    stage.style.setProperty('--sector-scale', scale);
  }

  function el(tag, className, parent) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  function buildSectors() {
    data.sectors.forEach((s, i) => {
      const layer = el('div', 'sector-layer', plot);
      const circles = {};
      [FULL, ...HALVES].forEach(g => { circles[g] = el('div', 'sector-circle', layer); });

      // One tab stop per sector; in split view a pointer-only twin covers the right half.
      const primary = el('button', 'sector-target', targetsEl);
      primary.type = 'button';
      primary.setAttribute('aria-describedby', 'sector-card');
      const twin = el('button', 'sector-target', targetsEl);
      twin.type = 'button';
      twin.tabIndex = -1;
      twin.setAttribute('aria-hidden', 'true');
      [primary, twin].forEach(t => {
        t.addEventListener('pointerenter', () => { hovered = i; updateActive(); });
        t.addEventListener('pointerleave', () => { if (hovered === i) hovered = null; updateActive(); });
      });
      primary.addEventListener('focus', () => { focused = i; updateActive(); });
      primary.addEventListener('blur', () => { if (focused === i) focused = null; updateActive(); });

      // Year-over-year change in non-reporters, one bubble per circle (decorative:
      // the counts themselves are in the card, aria-label and table).
      const deltas = {};
      [FULL, ...HALVES].forEach(g => {
        deltas[g] = el('div', 'sector-delta', layer);
        deltas[g].setAttribute('aria-hidden', 'true');
      });

      sectorsUI[i] = { layer, circles, deltas, dots: new Map(), targets: { primary, twin } };
    });
  }

  // ---- Render ----

  // ---- Play through the years ----

  function startPlayback() {
    // From the last year, start over at the first; otherwise carry on from here.
    if (year === years[years.length - 1]) setYear(years[0]);
    playBtn.classList.add('is-playing');
    playBtn.setAttribute('aria-label', 'Pause timeline');
    playTimer = setInterval(() => {
      if (root.hidden) { stopPlayback(); return; }   // left the Sector tab
      const next = years[years.indexOf(year) + 1];
      setYear(next);
      if (next === years[years.length - 1]) stopPlayback();
    }, PLAY_STEP_MS);
  }

  function stopPlayback() {
    if (!playTimer) return;
    clearInterval(playTimer);
    playTimer = 0;
    playBtn.classList.remove('is-playing');
    playBtn.setAttribute('aria-label', 'Play timeline');
  }

  function setYear(y) {
    if (y === year) return;
    year = y;
    slider.value = y;
    // Show the change bubbles while the year is moving; fade them once it settles.
    deltasOn = true;
    clearTimeout(deltaTimer);
    deltaTimer = setTimeout(() => { deltasOn = false; renderDeltas(); }, DELTA_HOLD_MS);
    render();
  }

  // ---- Year-over-year change bubbles ----

  function renderDeltas() {
    const prev = years[years.indexOf(year) - 1];
    sectorsUI.forEach((ui, i) => Object.entries(ui.deltas).forEach(([g, b]) => {
      const show = deltasOn && prev !== undefined && (view === 'full' ? g === FULL : g !== FULL);
      b.classList.toggle('is-visible', show);
      if (!show) return;
      const d = counts(g, i).non - counts(g, i, prev).non;
      // Solid fill: more non-reporters in the non-reporter colour, fewer in Thrive
      // Green, no change in Graphite (both CSS). Text and arrow are white.
      const kind = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
      b.classList.toggle('is-down', kind === 'down');
      b.style.background = kind === 'up' ? data.nonReporterColor : '';
      b.innerHTML = (kind === 'flat' ? '' : `<svg width="10" height="10" viewBox="0 0 256 256" fill="currentColor">${ARROWS[kind]}</svg>`) +
        `<span>${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}</span>`;
      // Top-left of the circle, on its edge (45°).
      const c = layouts[g][year][i];
      b.style.left = `${c.x - c.r * Math.SQRT1_2}px`;
      b.style.top = `${c.y - c.r * Math.SQRT1_2}px`;
    }));
  }

  function render() {
    root.classList.toggle('is-split', view === 'split');
    renderText();
    pendingFadeIns = [];
    data.sectors.forEach((s, i) => renderSector(i));
    renderDeltas();
    renderHighlight();
    renderCard();

    // New dots were added at opacity 0; commit that, then fade them in.
    if (pendingFadeIns.length) {
      void root.offsetWidth;
      pendingFadeIns.forEach(d => { d.style.opacity = 1; });
    }
  }

  function renderText() {
    const full = groupCounts(FULL);
    $('[data-sector-year]').textContent = year;
    // Two sentences, the second always on its own line, so the first line keeps the year
    // and short counts never split "did / not." across lines.
    const summary = $('[data-sector-summary]');
    summary.innerHTML = '';
    el('span', 'sector__summary-line', summary).textContent =
      `${fmt(full.rep)} of ${fmt(full.total)} Russell 1000 companies published a sustainability report in ${year}.`;
    summary.appendChild(document.createTextNode(' '));
    el('span', 'sector__summary-line', summary).textContent = `${fmt(full.non)} did not.`;

    HALVES.forEach(h => {
      const c = groupCounts(h);
      const header = $(`[data-split-header="${h}"]`);
      header.innerHTML = '';
      el('div', 'sector__split-name', header).textContent = data.groups[h].label;
      el('div', 'sector__split-count', header).textContent =
        `${fmt(c.rep)} of ${fmt(c.total)} companies reporting (${pct(c.rep, c.total)}%)`;
    });

    legend.innerHTML = '';
    const rep = el('span', 'sector__legend-item', legend);
    const swatches = el('span', 'sector__legend-swatches', rep);
    swatches.setAttribute('aria-hidden', 'true');
    (view === 'full' ? [FULL] : HALVES).forEach(g => {
      el('span', 'sector-swatch', swatches).style.background = data.groups[g].reporterColor;
    });
    rep.appendChild(document.createTextNode('Reporters'));
    const non = el('span', 'sector__legend-item', legend);
    const sw = el('span', 'sector-swatch', non);
    sw.setAttribute('aria-hidden', 'true');
    sw.style.background = data.nonReporterColor;
    non.appendChild(document.createTextNode('Non-Reporters'));

    slider.setAttribute('aria-valuetext', String(year));
    const f = years.indexOf(year) / (years.length - 1);
    sliderFill.style.setProperty('--f', f);
    sliderThumb.style.setProperty('--f', f);
    ticksEl.querySelectorAll('.year-slider__tick').forEach((t, k) => t.classList.toggle('is-passed', years[k] <= year));
    yearsEl.querySelectorAll('span').forEach(s => s.classList.toggle('is-current', Number(s.dataset.year) === year));

    chart.setAttribute('aria-label', describe());
    renderTable();
  }

  function placeCircle(e, c, visible) {
    e.style.width = e.style.height = `${2 * c.r}px`;
    e.style.transform = `translate(${c.x - c.r}px, ${c.y - c.r}px)`;
    e.style.opacity = visible ? 1 : 0;
  }

  function renderSector(i) {
    const ui = sectorsUI[i];
    const full = layouts[FULL][year][i];
    const split = view === 'split';

    placeCircle(ui.circles[FULL], full, !split);
    HALVES.forEach(h => placeCircle(ui.circles[h], layouts[h][year][i], split));

    // Hit targets follow the visible circles.
    const place = (t, c) => {
      t.style.width = t.style.height = `${2 * c.r}px`;
      t.style.transform = `translate(${c.x - c.r}px, ${c.y - c.r}px)`;
    };
    place(ui.targets.primary, split ? layouts.sp500[year][i] : full);
    ui.targets.twin.hidden = !split;
    if (split) place(ui.targets.twin, layouts.smallestHalf[year][i]);
    const fc = counts(FULL, i);
    ui.targets.primary.setAttribute('aria-label', split
      ? `${data.sectors[i].name}: ${data.groups.sp500.shortLabel} ${counts('sp500', i).rep} of ${counts('sp500', i).total} reporting; ${data.groups.smallestHalf.shortLabel} ${counts('smallestHalf', i).rep} of ${counts('smallestHalf', i).total} reporting`
      : `${data.sectors[i].name}: ${fc.rep} of ${fc.total} companies reporting`);

    // Dots never move. A colour change sweeps along the non-reporter boundary:
    // inward when the orange core shrinks (the colour recedes to the centre),
    // outward when it grows. Dots added or removed, and a whole view change,
    // fade from the centre of the circle out.
    const seen = new Set();
    const prevNon = ui.prevNon || {};
    const nextNon = {};
    dotTargets(i).forEach(t => {
      seen.add(t.key);
      nextNon[t.g] = t.nonCount;
      const color = t.non ? data.nonReporterColor : data.groups[t.g].reporterColor;
      let dot = ui.dots.get(t.key);
      let delay = 0;
      if (!dot || dot._leaving) {
        if (!dot) {
          dot = el('div', 'sector-dot', ui.layer);
          dot.style.opacity = 0;
          ui.dots.set(t.key, dot);
        }
        clearTimeout(dot._leave);
        dot._leaving = false;
        delay = outwardDelay(t.rad, t.maxRad);
        pendingFadeIns.push(dot);
      } else if (dot._color !== color && prevNon[t.g] !== undefined) {
        const was = prevNon[t.g];
        const lo = Math.min(was, t.nonCount);
        const p = (t.k - lo) / Math.max(Math.abs(t.nonCount - was) - 1, 1);
        delay = SWEEP_MS * (t.nonCount < was ? 1 - p : p);
      }
      dot.style.transitionDelay = `${delay}ms`;
      dot.style.transform = `translate(${t.x - DOT_R}px, ${t.y - DOT_R}px)`;
      dot.style.background = color;
      dot._color = color;
      dot._rad = t.rad;
      dot._maxRad = t.maxRad;
    });
    ui.dots.forEach((dot, key) => {
      if (seen.has(key) || dot._leaving) return;
      dot._leaving = true;
      const delay = outwardDelay(dot._rad, dot._maxRad);
      dot.style.transitionDelay = `${delay}ms`;
      dot.style.opacity = 0;
      dot._leave = setTimeout(() => { dot.remove(); ui.dots.delete(key); },
        reducedMotion.matches ? 0 : delay + FADE_MS);
    });
    ui.prevNon = nextNon;
  }

  // ---- Hover / focus ----

  function updateActive() {
    const next = hovered ?? focused;
    if (active === next) return;
    active = next;
    renderHighlight();
    renderCard();
  }

  function renderHighlight() {
    sectorsUI.forEach((ui, i) => {
      ui.layer.classList.toggle('is-dimmed', active !== null && i !== active);
      Object.values(ui.circles).forEach(c => c.classList.toggle('is-highlighted', i === active));
    });
  }

  function rowHTML(color, count, label, share) {
    return `<div class="sector-card__row"><span class="sector-swatch" aria-hidden="true" style="background:${color}"></span>` +
      `<strong>${fmt(count)}</strong> ${label} (${share}%)</div>`;
  }

  function rowsHTML(group, i) {
    const c = counts(group, i);
    return rowHTML(data.groups[group].reporterColor, c.rep, 'reporters', pct(c.rep, c.total)) +
      rowHTML(data.nonReporterColor, c.non, 'non-reporters', pct(c.non, c.total));
  }

  const escapeHTML = s => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function renderCard() {
    if (active === null) {
      card.classList.remove('is-visible');
      return;
    }
    const i = active;
    const s = data.sectors[i];
    const split = view === 'split';
    const icon = (window.SECTOR_ICONS || {})[s.icon] || '';

    let body = `<div class="sector-card__name">${escapeHTML(s.name)}</div>`;
    if (split) {
      // Smallest half first, then S&P 500, as in the S4 frame.
      body += ['smallestHalf', 'sp500'].map(g =>
        `<div class="sector-card__block"><div class="sector-card__meta">${escapeHTML(data.groups[g].shortLabel)} · ${fmt(counts(g, i).total)} companies</div>${rowsHTML(g, i)}</div>`
      ).join('');
    } else {
      body = `<div class="sector-card__head">${body}<div class="sector-card__meta">${fmt(counts(FULL, i).total)} companies</div></div>` +
        rowsHTML(FULL, i);
    }

    card.innerHTML =
      `<span class="sector-card__icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 256 256" fill="currentColor">${icon}</svg></span>` +
      `<div class="sector-card__body">${body}</div>`;
    card.classList.toggle('is-split', split);
    card.style.width = `${CARD_W[view]}px`;

    // Position: beside the circle (full) or centred on the divider (split), above the slider.
    const h = card.offsetHeight;
    let left, top;
    if (split) {
      ({ left, top } = splitCardPosition(i, h));
    } else {
      const c = layouts[FULL][year][i];
      left = c.x + c.r + CARD_GAP;
      if (left + CARD_W.full > STAGE_W - 48) left = c.x - c.r - CARD_GAP - CARD_W.full;
      top = Math.max(Math.min(c.y - CARD_GAP, PLOT_BOTTOM - h), PLOT_TOP - 40);
    }
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.classList.add('is-visible');
  }

  /*
   * Split view: the card sits on the divider by default, but must never cover the
   * highlighted circle in either half. Try the divider at heights nearest the
   * default first, then beside either circle; take the first spot that is clear.
   */
  function splitCardPosition(i, h) {
    const w = CARD_W.split;
    const circles = HALVES.map(g => layouts[g][year][i]);
    const minTop = SPLIT_CARD_MIN_TOP;
    const maxTop = PLOT_BOTTOM - h;
    const clampTop = t => Math.max(Math.min(t, maxTop), minTop);
    const clear = (left, top) => left >= 48 && left + w <= STAGE_W - 48 && circles.every(c => {
      const nx = Math.max(left, Math.min(c.x, left + w));
      const ny = Math.max(top, Math.min(c.y, top + h));
      return Math.hypot(c.x - nx, c.y - ny) >= c.r + CARD_GAP;
    });

    // Preferred: on the divider, vertically centred on the midpoint of the two circles.
    const centred = DIVIDER_X - w / 2;
    const preferredTop = clampTop((circles[0].y + circles[1].y) / 2 - h / 2);
    const candidates = [{ left: centred, top: preferredTop }];
    for (let t = minTop; t <= maxTop; t += 10) candidates.push({ left: centred, top: t });
    candidates.sort((a, b) => Math.abs(a.top - preferredTop) - Math.abs(b.top - preferredTop));
    circles.forEach(c => {
      const top = clampTop(c.y - h / 2);
      candidates.push({ left: c.x - c.r - CARD_GAP - w, top }, { left: c.x + c.r + CARD_GAP, top });
    });

    return candidates.find(p => clear(p.left, p.top)) || { left: centred, top: preferredTop };
  }

  // ---- Accessible description + table ----

  function describe() {
    const list = group => data.sectors
      .map((s, i) => { const c = counts(group, i); return `${s.name} ${c.rep} of ${c.total}`; })
      .join('; ');
    if (view === 'full') {
      const t = groupCounts(FULL);
      return `Packed circle chart of ${fmt(t.total)} Russell 1000 companies by sector, ${year}, reporters and non-reporters. ${list(FULL)} reporting.`;
    }
    return `Packed circle chart split by market cap, ${year}. ` +
      HALVES.map(h => `${data.groups[h].label}: ${list(h)} reporting.`).join(' ');
  }

  function renderTable() {
    const groups = [FULL, ...HALVES];
    const cell = (g, i) => {
      const c = i === null ? groupCounts(g) : counts(g, i);
      return `<td>${fmt(c.rep)} of ${fmt(c.total)} (${pct(c.rep, c.total)}%)</td>`;
    };
    table.innerHTML =
      `<caption>Companies publishing a sustainability report by sector, ${year}</caption>` +
      `<thead><tr><th scope="col">Sector</th>${groups.map(g => `<th scope="col">${escapeHTML(data.groups[g].label)}</th>`).join('')}</tr></thead>` +
      `<tbody>${data.sectors.map((s, i) => `<tr><th scope="row">${escapeHTML(s.name)}</th>${groups.map(g => cell(g, i)).join('')}</tr>`).join('')}` +
      `<tr><th scope="row">All sectors</th>${groups.map(g => cell(g, null)).join('')}</tr></tbody>`;
  }
})();
