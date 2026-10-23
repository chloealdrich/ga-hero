/*
 * Section 3: sector drill-down.
 *
 * Opens from a sector circle in Section 2 without touching Section 2's code: a
 * click listener on Section 2's root reacts to its existing sector buttons.
 * Renders inside Section 2's 1440 × 900 stage and reuses its logo, nav and View
 * toggle (the shared full/split setting).
 *
 * Routes:
 *   #sector/<id>            framework overview        (D1 full / D4 split)
 *   #sector/<id>/sdgs       SDG breakdown             (D2 full / D5 split)
 *   #sector/<id>/assurance  external assurance        (D3 full / D6 split)
 *
 * 2025 values from drill-data.json; sector ids, names, icons and short group
 * names from sector-data.json. Geometry follows the D1–D6 frames (drill-spec.md).
 */
(() => {
  'use strict';

  const sectorRoot = document.querySelector('[data-sector]');
  const host = document.querySelector('[data-drill]');
  if (!sectorRoot || !host) return;
  const targetsEl = sectorRoot.querySelector('[data-sector-targets]');
  const viewInputs = [...sectorRoot.querySelectorAll('input[name="sector-view"]')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const STAGE_W = 1440;
  const STAGE_H = 900;
  const EDGE = 48;
  const ROUTE = /^#sector\/([a-z0-9-]+)(?:\/(sdgs|assurance))?$/;
  const FULL = 'russell1000';
  const HALVES = ['sp500', 'smallestHalf'];
  const SDG_KEY = 'sdgs';
  const EA_KEY = 'externalAssurance';
  const TINT = 0.12;              // pill fill / ring track: colour at 12% over white
  const FADE = 0.35;              // other donut segments while one is active
  const GOAL_MAX_R = 30;          // bubble radius at the largest goal share
  const ZERO_DOT = 6;

  // Phosphor caret-left / arrow-right (Regular).
  const ICON = {
    back: '<path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/>',
    forward: '<path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"/>',
  };

  // Ring styles per frame: size, radius, stroke, label font [size, line height, weight].
  const RING = {
    overview:      { size: 128, r: 56, stroke: 14, font: [28, 32, 400] },          // D1
    overviewSplit: { size: 104, r: 46, stroke: 12, font: [24, 28, 400], missing: 20 }, // D4
    breakdown:     { size: 176, r: 79, stroke: 18, font: [48, 56, 300], fill: '#ffffff' }, // D2, D3
    sdgSplit:      { size: 120, r: 53, stroke: 14, font: [24, 28, 400], fill: '#ffffff', missing: 24 }, // D5
    eaSplit:       { size: 104, r: 45, stroke: 12, font: [24, 28, 400], fill: '#ffffff', missing: 24 }, // D6
  };

  // Zoom transition timings (ms) and easings.
  const ZOOM = {
    chart: 520,         // chart scales up and fades
    chartScale: 3,
    fade: 200,          // Section 2's text and slider fade out (and back in)
    disc: 560,          // the bubble's highlight grows to fill the stage
    discOut: 260,       // ...then clears to white
    contentIn: 380,     // drill-down starts fading in over the tint
    contentDur: 320,
  };
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const EASE_IN = 'cubic-bezier(.4,0,1,1)';
  const EASE_IN_OUT = 'cubic-bezier(.6,0,.2,1)';
  // Section 2's own content (not its logo, nav or View toggle) that steps aside.
  const SECTION2_PARTS = '.sector__intro, .sector__legend, .sector__split-header, .sector__divider, .year-slider, .sector__play, .sector-card';

  // Donut geometry per spec.
  const DONUT = {
    full:  { size: 128, R: 64, r: 38, gap: 3, c: 5 },
    split: { size: 104, R: 52, r: 31, gap: 3, c: 4 },
  };

  let drill, sectors, shortLabel, goalMax;
  let current = null;            // { index, sector, state }
  let tips = new Map();          // data-tip key -> tooltip info
  let activeTip = null;
  let lastOpenedByKeyboard = false;
  let returnByKeyboard = false;
  let pendingOrigin = null;      // the clicked bubble, in stage px, for the zoom-in
  let openedFrom = -1;           // index of the clicked sector button, to zoom back into the same circle
  let zoom = null;               // running zoom: { anims, finish }

  Promise.all(['drill-data.json', 'sector-data.json'].map(url =>
    fetch(url).then(r => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.json();
    })))
    .then(([d, s]) => init(d, s))
    .catch(err => console.error('[drill] could not load data', err));

  // ---- Setup ----

  function init(d, s) {
    drill = d;
    sectors = s.sectors;
    shortLabel = Object.fromEntries(Object.entries(s.groups).map(([g, v]) => [g, v.shortLabel]));
    // Bubble scale: the largest goal share in any sector or group, so sizes compare across sectors.
    goalMax = Math.max(...Object.values(drill.groups).flatMap(g =>
      Object.values(g.sectors).flatMap(v => v.sdgs || [])));

    // Open from Section 2's sector buttons. They come in pairs per sector, in data
    // order (the focusable circle, then its split-view twin). Enter/Space on a
    // focused circle arrive here as clicks too.
    sectorRoot.addEventListener('click', e => {
      const btn = e.target.closest('.sector-target');
      if (!btn || !targetsEl.contains(btn)) return;
      const position = [...targetsEl.querySelectorAll('.sector-target')].indexOf(btn);
      const index = Math.floor(position / 2);
      if (!sectors[index]) return;
      openedFrom = position;
      lastOpenedByKeyboard = e.detail === 0;
      pendingOrigin = bubbleOrigin(btn);   // zoom from the circle actually clicked (either half in split view)
      location.hash = `#sector/${sectors[index].id}`;
    });

    // The View radios are Section 2's: they hold the one full/split setting.
    viewInputs.forEach(input => input.addEventListener('change', () => { if (current) render({ sweep: false }); }));

    host.addEventListener('click', e => {
      const link = e.target.closest('a[href^="#sector"]');
      if (link) returnByKeyboard = e.detail === 0;
      const t = e.target.closest('[data-tip]');
      if (t) setTip(t.dataset.tip);
    });
    host.addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse') return;
      const t = e.target.closest('[data-tip]');
      if (t) setTip(t.dataset.tip);
    });
    host.addEventListener('pointerout', e => {
      if (e.pointerType !== 'mouse') return;
      const t = e.target.closest('[data-tip]');
      if (!t || t.contains(e.relatedTarget)) return;
      // Leaving with the mouse falls back to whatever has keyboard focus, if anything.
      const focused = document.activeElement?.closest?.('[data-tip]');
      setTip(focused && host.contains(focused) ? focused.dataset.tip : null);
    });
    host.addEventListener('focusin', e => {
      const t = e.target.closest('[data-tip]');
      if (t) setTip(t.dataset.tip);
    });
    host.addEventListener('focusout', e => {
      if (!e.relatedTarget || !e.relatedTarget.closest?.('[data-tip]')) setTip(null);
    });
    // Touch: a tap shows a tooltip; a tap anywhere else clears it.
    document.addEventListener('pointerdown', e => {
      if (activeTip && !e.target.closest?.('[data-tip]')) setTip(null);
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !activeTip) return;
      const focused = document.activeElement?.closest?.('[data-tip]');
      setTip(null);
      if (focused) focused.blur();
    });

    window.addEventListener('hashchange', route);
    route();
  }

  // ---- Routing ----

  function route() {
    stopZoom();
    const m = location.hash.match(ROUTE);
    const index = m ? sectors.findIndex(s => s.id === m[1]) : -1;
    const origin = pendingOrigin;
    pendingOrigin = null;
    if (index < 0) { if (current) close(); return; }
    const wasOpen = !!current;
    current = { index, sector: sectors[index], state: m[2] || 'overview' };
    // Zoom only when arriving from the sector chart (not on a direct link or between drill states).
    const zoomIn = !wasOpen && origin && !reducedMotion.matches;
    if (!zoomIn) sectorRoot.classList.add('is-drilling');
    host.hidden = false;
    document.title = `${current.sector.name} · ${sectorRoot.dataset.title}`;
    render({ sweepDelay: zoomIn ? ZOOM.contentIn : 0 });
    if (zoomIn) zoomIntoSector(origin);
    // Keep keyboard and screen-reader users oriented: land on the sector heading.
    if (wasOpen || lastOpenedByKeyboard) host.querySelector('.drill-title h2')?.focus({ preventScroll: true });
    lastOpenedByKeyboard = false;
  }

  function close() {
    const index = current.index;
    current = null;
    setTip(null);
    document.title = sectorRoot.dataset.title;
    const finish = () => {
      host.hidden = true;
      host.innerHTML = '';
      sectorRoot.classList.remove('is-drilling');
      // Back on the sector chart: return keyboard focus to the circle the user came from.
      if (returnByKeyboard) targetsEl.querySelectorAll('.sector-target')[index * 2]?.focus({ preventScroll: true });
      returnByKeyboard = false;
    };
    // Zoom back out into the bubble when returning to the sector chart itself.
    if (location.hash.startsWith('#sector') && !reducedMotion.matches) zoomOutToSector(index, finish);
    else finish();
  }

  const view = () => (viewInputs.find(i => i.checked)?.value === 'split' ? 'split' : 'full');

  // ---- Helpers ----

  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const pct = v => (v == null ? 'data pending' : `${Math.round(v * 100)}%`);
  const rgb = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  // Colour at `f` strength over white: 255 − (255 − c) × f per channel.
  const tint = (hex, f) => `rgb(${rgb(hex).map(c => Math.round(255 - (255 - c) * f)).join(',')})`;
  const fwIndex = key => drill.frameworks.findIndex(f => f.key === key);
  const values = group => drill.groups[group].sectors[current.sector.name];
  const svg = (w, h, inner) =>
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${inner}</svg>`;
  const icon = (path, size) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${path}</svg>`;

  // Donut segment path: unchanged from drill-spec.md.
  // Angles in degrees, clockwise from 12 o'clock. gap = px between segments, c = corner radius px.
  function seg(cx, cy, R, r, a0, a1, gap, c) {
    const P = (rr, d) => { const t = (d - 90) * Math.PI / 180; return [cx + rr * Math.cos(t), cy + rr * Math.sin(t)]; };
    const deg = (px, rr) => px / rr * 180 / Math.PI;
    const f = p => p[0].toFixed(2) + ' ' + p[1].toFixed(2);
    const along = (p, q, d) => { const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy); return [p[0] + dx * d / L, p[1] + dy * d / L]; };
    const ao0 = a0 + deg(gap / 2, R), ao1 = a1 - deg(gap / 2, R), ai0 = a0 + deg(gap / 2, r), ai1 = a1 - deg(gap / 2, r);
    c = Math.max(0.5, Math.min(c, (R - r) / 2 - 0.5, (ai1 - ai0) * Math.PI / 180 * r / 2 - 0.5));
    const co = deg(c, R), ci = deg(c, r);
    const Po0 = P(R, ao0), Po1 = P(R, ao1), Pi0 = P(r, ai0), Pi1 = P(r, ai1);
    const lo = (ao1 - ao0 - 2 * co) > 180 ? 1 : 0, li = (ai1 - ai0 - 2 * ci) > 180 ? 1 : 0;
    return 'M' + f(along(Po0, Pi0, c)) + ' Q' + f(Po0) + ' ' + f(P(R, ao0 + co)) +
      ' A' + R + ' ' + R + ' 0 ' + lo + ' 1 ' + f(P(R, ao1 - co)) + ' Q' + f(Po1) + ' ' + f(along(Po1, Pi1, c)) +
      ' L' + f(along(Pi1, Po1, c)) + ' Q' + f(Pi1) + ' ' + f(P(r, ai1 - ci)) +
      ' A' + r + ' ' + r + ' 0 ' + li + ' 0 ' + f(P(r, ai0 + ci)) + ' Q' + f(Pi0) + ' ' + f(along(Pi0, Po0, c)) + ' Z';
  }

  // A closed ring for a donut with one category at 100% (seg() can't draw 360°).
  const annulus = (cx, cy, R, r) =>
    `M${cx - R} ${cy} a${R} ${R} 0 1 0 ${2 * R} 0 a${R} ${R} 0 1 0 ${-2 * R} 0 Z ` +
    `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;

  // ---- Building blocks ----

  function pill(label, color, at) {
    const pos = at ? ` drill-pill--at" style="left:${at[0]}px;top:${at[1]}px;` : '" style="';
    return color
      ? `<span class="drill-pill${pos}border-color:${color};background:${tint(color, TINT)};color:${color}">${esc(label)}</span>`
      : `<span class="drill-pill drill-pill--grey${pos}">${esc(label)}</span>`;
  }

  // Progress ring. value null renders the "data pending" state: dashed grey track, "XX%".
  function ring(kind, value, color, attrs = '') {
    const { size, r, stroke, font, fill = 'none', missing = font[0] } = RING[kind];
    const c = size / 2;
    const C = 2 * Math.PI * r;
    if (value == null) {
      return `<div class="drill-ring" style="width:${size}px;height:${size}px" ${attrs}>` +
        svg(size, size, `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}" stroke="#d6d6d6" stroke-width="${stroke}" stroke-dasharray="4 5"/>`) +
        `<span class="drill-ring__label is-missing" style="font-size:${missing}px;line-height:28px">XX%</span></div>`;
    }
    const dash = `${(value * C).toFixed(1)} ${C.toFixed(1)}`;
    return `<div class="drill-ring" style="width:${size}px;height:${size}px" ${attrs}>` +
      svg(size, size,
        `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}" stroke="${tint(color, TINT)}" stroke-width="${stroke}"/>` +
        `<circle class="drill-ring__arc" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" ` +
        `stroke-linecap="${value > 0 ? 'round' : 'butt'}" style="stroke-dasharray:0 ${C.toFixed(1)}" data-dash="${dash}" transform="rotate(-90 ${c} ${c})"/>`) +
      `<span class="drill-ring__label" style="color:${color};font-size:${font[0]}px;line-height:${font[1]}px;font-weight:${font[2]}">${pct(value)}</span></div>`;
  }

  function rowLabel(group, left, top, width, height) {
    const g = drill.groups[group];
    const size = height ? `height:${height}px;justify-content:center;` : '';
    return `<div class="drill-row-label" style="left:${left}px;top:${top}px;width:${width}px;${size}">` +
      `<div class="drill-row-label__name"><span class="drill-chip" aria-hidden="true" style="background:${g.chip}"></span>${esc(g.label)}</div>` +
      `<div class="drill-row-label__meta">${values(group).companies} companies</div></div>`;
  }

  const dots = (left, top, width) =>
    `<div class="drill-dots" aria-hidden="true" style="left:${left}px;top:${top}px;width:${width}px"></div>`;

  const link = (href, text) => `<a class="drill-link" href="${href}">${esc(text)}${icon(ICON.forward, 14)}</a>`;

  // One SDG row: numbers above, bubbles on the line; focusable when data exists.
  function goalRow({ group, cy, x0, step, numberTop, tipTop, placeholder }) {
    const sdgs = values(group).sdgs;
    const name = current.sector.name;
    const who = group === FULL ? `${name} companies` : `${shortLabel[group]} ${name} companies`;
    if (!sdgs || placeholder) {
      return drill.sdgGoals.map((g, i) => {
        const cx = x0 + i * step;
        return `<span class="drill-goal__num" aria-hidden="true" style="left:${cx - 20}px;top:${numberTop}px">${g.n}</span>` +
          `<span class="drill-goal-ph" aria-hidden="true" style="left:${cx - 10}px;top:${cy - 10}px;border-color:${g.color}"></span>`;
      }).join('');
    }
    const label = `SDGs referenced by ${who}, ${drill.year}: ` +
      drill.sdgGoals.map((g, i) => `Goal ${g.n} ${pct(sdgs[i])}`).join(', ') + '.';
    const btnTop = numberTop - 4;
    const buttons = drill.sdgGoals.map((g, i) => {
      const v = sdgs[i] || 0;
      const cx = x0 + i * step;
      const r = v > 0 ? GOAL_MAX_R * Math.sqrt(v / goalMax) : ZERO_DOT / 2;
      const key = `goal:${group}:${i}`;
      tips.set(key, { kind: 'goal', goal: g, value: v, who, cx, bubbleBottom: cy + r, tipTop, row: group });
      const bubbleTop = cy - btnTop;
      const height = Math.max(bubbleTop + GOAL_MAX_R, bubbleTop + r) + 4;
      return `<button type="button" class="drill-goal" data-tip="${key}" ` +
        `aria-label="Goal ${g.n}, ${esc(g.name)}: ${pct(v)} of ${esc(who)}" ` +
        `style="left:${cx - 20}px;top:${btnTop}px;height:${height}px">` +
        `<span class="drill-goal__num" aria-hidden="true">${g.n}</span>` +
        `<span class="drill-goal__bubble" aria-hidden="true" style="left:${20 - r}px;top:${bubbleTop - r}px;width:${2 * r}px;height:${2 * r}px;` +
        `background:${v > 0 ? g.color : '#d6d6d6'}"></span></button>`;
    }).join('');
    return `<div class="drill-goals" role="group" aria-label="${esc(label)}" data-row="${group}">${buttons}</div>`;
  }

  // Donut of assured-company shares; each non-zero category is a focusable segment.
  function donut({ group, kind, cx, top, split }) {
    const geo = DONUT[split ? 'split' : 'full'];
    const cats = drill.assuranceCategories[kind];
    const vals = values(group)[kind];
    const total = vals.reduce((a, v) => a + (v || 0), 0) || 1;
    const title = kind[0].toUpperCase() + kind.slice(1);
    const prefix = group === FULL ? '' : `${drill.groups[group].label}, `;
    const label = `${prefix}${title}: ` + cats.map((c, k) => `${c.label} ${pct(vals[k] || 0)}`).join(', ');
    const sub = split ? `of assured ${shortLabel[group]} companies` : 'of assured companies';
    const left = cx - geo.size / 2;
    const m = geo.size / 2;
    let angle = 0;
    const nonZero = cats.map((c, k) => ({ c, k, v: vals[k] || 0 })).filter(x => x.v > 0);
    const paths = nonZero.map(({ c, k, v }) => {
      const a0 = angle;
      const a1 = angle + (v / total) * 360;
      angle = a1;
      const d = nonZero.length === 1 ? annulus(m, m, geo.R, geo.r) : seg(m, m, geo.R, geo.r, a0, a1, geo.gap, geo.c);
      const key = `seg:${group}:${kind}:${k}`;
      tips.set(key, { kind: 'seg', cat: c, value: v, sub, donutLeft: left, donutTop: top, size: geo.size, split, group, donut: `${group}:${kind}` });
      return `<path class="drill-seg" d="${d}" fill="${c.color}" fill-rule="evenodd" data-fill="${c.color}" data-fade="${tint(c.color, FADE)}" ` +
        `data-tip="${key}" data-donut="${group}:${kind}" tabindex="0" role="img" aria-label="${esc(`${c.label}: ${pct(v)} ${sub}`)}"/>`;
    }).join('');
    return `<div class="drill-donut" role="group" aria-label="${esc(label)}" style="left:${left}px;top:${top}px;width:${geo.size}px;height:${geo.size}px">` +
      `<svg width="${geo.size}" height="${geo.size}" viewBox="0 0 ${geo.size} ${geo.size}">${paths}</svg></div>`;
  }

  // ---- States ----

  function header() {
    const { sector, state } = current;
    const back = state === 'overview'
      ? { href: '#sector', text: 'Return To All Sectors' }
      : { href: `#sector/${sector.id}`, text: 'Return To All Initiatives' };
    const sectorIcon = (window.SECTOR_ICONS || {})[sector.icon] || '';   // shared with Section 2
    return `<a class="drill-back" href="${back.href}">${icon(ICON.back, 16)}${back.text}</a>` +
      `<div class="drill-title"><span class="drill-title__icon" aria-hidden="true">${icon(sectorIcon, 36)}</span>` +
      `<h2 tabindex="-1">${esc(sector.name)}</h2></div>`;
  }

  // D1: one row of 8 framework rings.
  function overviewFull() {
    const v = values(FULL).frameworks;
    const label = `${current.sector.name} framework rates, ${drill.year}: ` +
      drill.frameworks.map((f, k) => `${f.label} ${pct(v[k])}`).join(', ') + '.';
    const cols = drill.frameworks.map((f, k) => {
      const more = f.key === SDG_KEY ? link(`#sector/${current.sector.id}/sdgs`, 'View Breakdown')
        : f.key === EA_KEY ? link(`#sector/${current.sector.id}/assurance`, 'View Breakdown') : '';
      return `<div class="drill-fw__col" role="listitem" style="width:168px">${pill(f.label, f.color)}${ring('overview', v[k], f.color)}${more}</div>`;
    }).join('');
    return `<div class="drill-fw" role="list" aria-label="${esc(label)}" style="left:${EDGE}px;top:360px;width:1344px">${cols}</div>`;
  }

  // D4: pill header row, then one ring row per market-cap half.
  function overviewSplit() {
    const COL = 138, LEFT = 288;
    let html = `<div class="drill-cols" aria-hidden="true" style="left:${LEFT}px;top:316px">` +
      drill.frameworks.map(f => `<div style="width:${COL}px">${pill(f.label, f.color)}</div>`).join('') + '</div>';
    [['sp500', 356], ['smallestHalf', 500]].forEach(([group, top]) => {
      const v = values(group).frameworks;
      const label = `${drill.groups[group].label}, ${current.sector.name}, ${drill.year}: ` +
        drill.frameworks.map((f, k) => `${f.label} ${pct(v[k])}`).join(', ');
      html += rowLabel(group, EDGE, top, 220, 104) +
        `<div class="drill-cols" role="list" aria-label="${esc(label)}" style="left:${LEFT}px;top:${top}px">` +
        drill.frameworks.map((f, k) =>
          `<div role="listitem" style="width:${COL}px"><span class="visually-hidden">${esc(f.label)} </span>${ring('overviewSplit', v[k], f.color)}</div>`).join('') +
        '</div>';
    });
    const sdgCol = fwIndex(SDG_KEY), eaCol = fwIndex(EA_KEY);
    html += `<div class="drill-cols" style="left:${LEFT + sdgCol * COL}px;top:624px">` +
      `<div style="width:${COL}px">${link(`#sector/${current.sector.id}/sdgs`, 'View Breakdown')}</div>` +
      (eaCol === sdgCol + 1 ? `<div style="width:${COL}px">${link(`#sector/${current.sector.id}/assurance`, 'View Breakdown')}</div>` : '') +
      '</div>';
    if (eaCol !== sdgCol + 1) {
      html += `<div class="drill-cols" style="left:${LEFT + eaCol * COL}px;top:624px"><div style="width:${COL}px">${link(`#sector/${current.sector.id}/assurance`, 'View Breakdown')}</div></div>`;
    }
    return html;
  }

  // D2: large SDG ring, then 17 goal bubbles on a dotted line.
  function sdgsFull() {
    const f = drill.frameworks[fwIndex(SDG_KEY)];
    const v = values(FULL).frameworks[fwIndex(SDG_KEY)];
    return dots(272, 519, 1120) +
      `<div class="drill-abs" style="left:88px;top:432px">${ring('breakdown', v, f.color, `role="img" aria-label="${esc(`SDGs: ${pct(v)} of ${current.sector.name} companies`)}"`)}</div>` +
      pill(f.label, f.color, [176, 392]) +
      goalRow({ group: FULL, cy: 520, x0: 330, step: 65, numberTop: 466, tipTop: 600 });
  }

  // D5: one row per half. Placeholder until the halves' SDG figures arrive.
  function sdgsSplit() {
    const k = fwIndex(SDG_KEY);
    const f = drill.frameworks[k];
    let html = pill(f.label, f.color, [296, 286]);
    [['sp500', 400], ['smallestHalf', 600]].forEach(([group, cy]) => {
      const v = values(group).frameworks[k];
      const pending = !values(group).sdgs;
      const name = `${drill.groups[group].label}, ${current.sector.name} SDGs, ${drill.year}`;
      html += rowLabel(group, EDGE, cy - 70, 180) +
        dots(364, cy - 1, 1028) +
        `<div class="drill-abs" style="left:236px;top:${cy - 60}px">` +
        ring('sdgSplit', pending ? null : v, f.color, `role="img" aria-label="${esc(pending ? `${name}: data pending` : `${name}: ${pct(v)}`)}"`) +
        '</div>' +
        goalRow({ group, cy, x0: 410, step: 60, numberTop: cy - 36, tipTop: cy + 40, placeholder: pending });
    });
    return html;
  }

  // D3: large External Assurance ring, then Scope / Level / Provider donuts.
  function assuranceFull() {
    const f = drill.frameworks[fwIndex(EA_KEY)];
    const v = values(FULL).frameworks[fwIndex(EA_KEY)];
    const xs = { scope: 560, level: 880, provider: 1200 };
    return dots(272, 467, 1120) +
      pill(f.label, f.color, [176, 336]) +
      `<div class="drill-abs" style="left:88px;top:380px">${ring('breakdown', v, f.color, `role="img" aria-label="${esc(`External Assurance: ${pct(v)} of ${current.sector.name} companies`)}"`)}</div>` +
      Object.entries(xs).map(([kind, cx]) =>
        pill(kind[0].toUpperCase() + kind.slice(1), null, [cx, 336]) + donut({ group: FULL, kind, cx, top: 404 })).join('');
  }

  // D6: one row per half: External Assurance ring, then the three donuts.
  function assuranceSplit() {
    const k = fwIndex(EA_KEY);
    const f = drill.frameworks[k];
    const xs = { scope: 640, level: 920, provider: 1200 };
    let html = pill(f.label, f.color, [296, 316]) +
      Object.entries(xs).map(([kind, cx]) => pill(kind[0].toUpperCase() + kind.slice(1), null, [cx, 316])).join('');
    [['sp500', 420], ['smallestHalf', 600]].forEach(([group, cy]) => {
      const v = values(group).frameworks[k];
      html += rowLabel(group, EDGE, cy - 30, 180) +
        dots(356, cy - 1, 1036) +
        `<div class="drill-abs" style="left:244px;top:${cy - 52}px">` +
        ring('eaSplit', v, f.color, `role="img" aria-label="${esc(`${drill.groups[group].label}, External Assurance ${pct(v)}`)}"`) +
        '</div>' +
        Object.entries(xs).map(([kind, cx]) => donut({ group, kind, cx, top: cy - 52, split: true })).join('');
    });
    return html;
  }

  // ---- Render ----

  // sweep: ring arcs draw in from 0 (after sweepDelay ms); false draws them in place.
  function render({ sweep = true, sweepDelay = 0 } = {}) {
    tips = new Map();
    activeTip = null;
    const split = view() === 'split';
    const body = {
      overview: split ? overviewSplit : overviewFull,
      sdgs: split ? sdgsSplit : sdgsFull,
      assurance: split ? assuranceSplit : assuranceFull,
    }[current.state]();
    // One content layer, so the zoom can fade the whole drill-down in and out.
    host.innerHTML = '<div class="drill-content">' + header() + body +
      '<span class="drill-connector" aria-hidden="true" hidden></span>' +
      '<div class="drill-tip" role="tooltip" id="drill-tip"></div></div>';

    // Ring arcs sweep in from 0 on entering a state (skipped under reduced motion).
    const arcs = [...host.querySelectorAll('.drill-ring__arc')];
    const settle = () => arcs.forEach(a => { a.style.strokeDasharray = a.dataset.dash; });
    if (sweep && !reducedMotion.matches) {
      void host.offsetWidth;
      setTimeout(() => requestAnimationFrame(settle), sweepDelay);
    } else {
      arcs.forEach(a => a.classList.add('is-instant'));
      settle();
    }
  }

  // ---- Zoom transition between the sector chart and the drill-down ----
  //
  // In: the clicked bubble's highlight disc grows from the bubble until it fills the
  // stage while the chart scales up and fades; the drill-down fades in over the tint,
  // then the tint clears. Out: the reverse, shrinking back into the same bubble.
  // Section 2's logo, nav and View toggle stay on top throughout (drill.css).

  function bubbleOrigin(btn) {
    const stage = sectorRoot.querySelector('[data-sector-stage]').getBoundingClientRect();
    const k = stage.width / STAGE_W;
    const b = btn.getBoundingClientRect();
    if (!b.width || !k) return null;
    return { cx: (b.left + b.width / 2 - stage.left) / k, cy: (b.top + b.height / 2 - stage.top) / k, r: b.width / 2 / k };
  }

  // Scale at which a disc on the bubble covers every corner of the stage.
  const coverScale = o => Math.max(
    ...[[0, 0], [STAGE_W, 0], [0, STAGE_H], [STAGE_W, STAGE_H]].map(([x, y]) => Math.hypot(x - o.cx, y - o.cy))) / o.r * 1.02;

  function makeDisc(o) {
    const disc = document.createElement('div');
    disc.className = 'drill-disc';
    disc.setAttribute('aria-hidden', 'true');
    disc.style.cssText = `left:${o.cx - o.r}px;top:${o.cy - o.r}px;width:${2 * o.r}px;height:${2 * o.r}px`;
    host.insertBefore(disc, host.firstChild);   // behind the drill content, above the chart
    return disc;
  }

  function runZoom(anims, after) {
    const finish = () => {
      if (zoom?.finish !== finish) return;
      zoom = null;
      after();
      anims.forEach(a => a.cancel());
      host.querySelector('.drill-disc')?.remove();
      sectorRoot.classList.remove('is-zooming');
    };
    zoom = { finish };
    Promise.all(anims.map(a => a.finished)).then(finish, () => {});
  }

  // Jump a running zoom to its end state (e.g. the user navigates mid-animation).
  const stopZoom = () => zoom?.finish();

  function zoomIntoSector(o) {
    const content = host.querySelector('.drill-content');
    const chart = sectorRoot.querySelector('.sector__chart');
    const parts = [...sectorRoot.querySelectorAll(SECTION2_PARTS)];
    const disc = makeDisc(o);
    sectorRoot.classList.add('is-zooming');
    chart.style.transformOrigin = `${o.cx}px ${o.cy}px`;
    runZoom([
      chart.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: `scale(${ZOOM.chartScale})`, opacity: 0 }],
        { duration: ZOOM.chart, easing: EASE_IN, fill: 'forwards' }),
      ...parts.map(p => p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ZOOM.fade, easing: EASE, fill: 'forwards' })),
      disc.animate([{ transform: 'scale(1)' }, { transform: `scale(${coverScale(o)})` }],
        { duration: ZOOM.disc, easing: EASE_IN_OUT, fill: 'forwards' }),
      disc.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ZOOM.discOut, delay: ZOOM.disc, easing: EASE, fill: 'forwards' }),
      content.animate([{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }],
        { duration: ZOOM.contentDur, delay: ZOOM.contentIn, easing: EASE, fill: 'backwards' }),
    ], () => {
      sectorRoot.classList.add('is-drilling');
      chart.style.transformOrigin = '';
    });
  }

  function zoomOutToSector(index, done) {
    sectorRoot.classList.remove('is-drilling');   // Section 2 back in layout, so its bubble can be measured
    // Back into the circle the user came from (either half in split view), if it's still showing.
    const buttons = targetsEl.querySelectorAll('.sector-target');
    const from = Math.floor(openedFrom / 2) === index ? buttons[openedFrom] : null;
    const btn = from && !from.hidden ? from : buttons[index * 2];
    const o = btn && bubbleOrigin(btn);
    if (!o) { done(); return; }
    const content = host.querySelector('.drill-content');
    const chart = sectorRoot.querySelector('.sector__chart');
    const parts = [...sectorRoot.querySelectorAll(SECTION2_PARTS)];
    const disc = makeDisc(o);
    const k = coverScale(o);
    sectorRoot.classList.add('is-zooming');
    chart.style.transformOrigin = `${o.cx}px ${o.cy}px`;
    runZoom([
      content.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.98)' }],
        { duration: ZOOM.fade, easing: EASE, fill: 'forwards' }),
      disc.animate([
        { transform: `scale(${k})`, opacity: 0 },
        { transform: `scale(${k})`, opacity: 1, offset: 0.25 },
        { transform: 'scale(1)', opacity: 1 },
      ], { duration: ZOOM.fade + ZOOM.disc, easing: EASE_IN_OUT, fill: 'forwards' }),
      disc.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ZOOM.discOut, delay: ZOOM.fade + ZOOM.disc, easing: EASE, fill: 'forwards' }),
      chart.animate([{ transform: `scale(${ZOOM.chartScale})`, opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: ZOOM.chart, delay: ZOOM.fade + 80, easing: EASE, fill: 'backwards' }),
      ...parts.map(p => p.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: ZOOM.fade, delay: ZOOM.fade + ZOOM.chart - 120, easing: EASE, fill: 'backwards' })),
    ], () => {
      chart.style.transformOrigin = '';
      done();
    });
  }

  // ---- Tooltips ----

  function setTip(key) {
    if (key === activeTip) return;
    activeTip = key;
    const tip = host.querySelector('.drill-tip');
    const connector = host.querySelector('.drill-connector');
    if (!tip) return;
    const info = key ? tips.get(key) : null;

    // Goals: dim the other bubbles in the same row; bold the active number.
    host.querySelectorAll('.drill-goals').forEach(row => {
      row.classList.toggle('has-active', !!info && info.kind === 'goal' && row.dataset.row === info.row);
    });
    host.querySelectorAll('.drill-goal').forEach(b => b.classList.toggle('is-active', b.dataset.tip === key));
    // Segments: blend the other segments of the same donut toward white.
    host.querySelectorAll('.drill-seg').forEach(p => {
      const dim = info && info.kind === 'seg' && p.dataset.donut === info.donut && p.dataset.tip !== key;
      p.setAttribute('fill', dim ? p.dataset.fade : p.dataset.fill);
    });

    if (!info) {
      tip.classList.remove('is-visible');
      connector.hidden = true;
      return;
    }

    if (info.kind === 'goal') {
      const w = 240;
      const left = Math.max(EDGE, Math.min(info.cx - 30, STAGE_W - EDGE - w));
      tip.className = 'drill-tip drill-tip--goal is-visible';
      tip.style.width = `${w}px`;
      tip.style.left = `${left}px`;
      tip.style.top = `${info.tipTop}px`;
      tip.innerHTML =
        `<div class="drill-tip__head"><span class="drill-tip__goal" style="background:${info.goal.color}">${info.goal.n}</span>` +
        `<span class="drill-tip__name">${esc(info.goal.name)}</span></div>` +
        `<div class="drill-tip__value">${pct(info.value)}</div>` +
        `<div class="drill-tip__sub">of ${esc(info.who)}</div>`;
      connector.hidden = false;
      connector.style.left = `${info.cx - 1}px`;
      connector.style.top = `${info.bubbleBottom + 2}px`;
      connector.style.height = `${Math.max(info.tipTop - info.bubbleBottom - 2, 0)}px`;
    } else {
      const w = info.split ? 156 : 168;
      let left = info.donutLeft + info.size + 12;
      if (left + w > STAGE_W - EDGE) left = info.donutLeft - 12 - w;
      tip.className = 'drill-tip drill-tip--seg is-visible';
      tip.style.width = `${w}px`;
      tip.style.left = `${left}px`;
      tip.style.top = `${info.donutTop + (info.split ? 0 : 16)}px`;
      tip.innerHTML =
        `<div class="drill-tip__head drill-tip__head--seg"><span class="drill-tip__swatch" style="background:${info.cat.color}"></span>${esc(info.cat.label)}</div>` +
        `<div class="drill-tip__value">${pct(info.value)}</div>` +
        `<div class="drill-tip__sub">${esc(info.sub)}</div>`;
      connector.hidden = true;
    }
  }
})();
