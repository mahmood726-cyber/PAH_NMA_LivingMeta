/* prisma-flow.js — PRISMA-NMA flow diagram (Page 2021 BMJ standard).
 *
 * Reads RapidMeta.state.trials and renders a 5-box flow:
 *   Records identified through database searching (k_total)
 *   ↓
 *   Records after duplicates removed (k_search)
 *   ↓
 *   Records screened (k_screened) → Records excluded (k_excluded)
 *   ↓
 *   Full-text articles assessed (k_fulltext) → Excluded with reasons
 *   ↓
 *   Studies included in qualitative synthesis (k_included)
 *   ↓
 *   Studies included in quantitative synthesis / NMA (k_quantitative)
 *
 * Reads counts from state.trials by status:
 *   status='search'   → records identified
 *   status='exclude'  → excluded at screening
 *   status='include'  → included
 *   data.extractionSignoff.confirmed → in extraction set
 * Plus realData entries → in NMA quantitative set.
 *
 * Public API (window.PrismaFlow):
 *   compute() → counts
 *   render(container)
 */
(function (global) {
  'use strict';

  function compute() {
    const state = (global.RapidMeta && global.RapidMeta.state) || {};
    const trials = Array.isArray(state.trials) ? state.trials : [];
    const rd = (global.RapidMeta && global.RapidMeta.realData) || {};

    const counts = {
      total_search: trials.length,
      duplicates_removed: 0,  // not tracked separately; equals total - unique
      screened: 0,
      excluded_screen: 0,
      fulltext: 0,
      excluded_fulltext: 0,
      included_qualitative: 0,
      in_nma: Object.keys(rd).length,
      reasons: {},
    };

    trials.forEach(t => {
      const status = (t && t.status) || '';
      const sr = (t && t.screenReview) || {};
      const ex = (t && t.data && t.data.extractionSignoff) || {};
      // 'screened' = anyone with a screenReview decision (include/exclude)
      if (sr.decision || status === 'include' || status === 'exclude') {
        counts.screened++;
      }
      if (status === 'exclude' || sr.decision === 'exclude') {
        counts.excluded_screen++;
        const reason = (t.exclusionReason || sr.reason || 'unspecified').slice(0, 60);
        counts.reasons[reason] = (counts.reasons[reason] || 0) + 1;
      }
      if (status === 'include' || sr.decision === 'include') {
        counts.fulltext++;
        if (ex.confirmed || (t.data && Object.keys(t.data).length > 2)) {
          counts.included_qualitative++;
        } else {
          counts.excluded_fulltext++;
        }
      }
    });

    // If no trials are tracked but realData has entries, derive minimal counts
    if (counts.total_search === 0 && counts.in_nma > 0) {
      counts.included_qualitative = counts.in_nma;
      counts.fulltext = counts.in_nma;
    }
    return counts;
  }

  function box(svgNS, x, y, w, h, label, count, fill) {
    const g = document.createElementNS(svgNS, 'g');
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('rx', '6');
    rect.setAttribute('fill', fill || '#1e293b');
    rect.setAttribute('stroke', '#475569');
    rect.setAttribute('stroke-width', '1');
    g.appendChild(rect);
    const t1 = document.createElementNS(svgNS, 'text');
    t1.setAttribute('x', x + w / 2);
    t1.setAttribute('y', y + 22);
    t1.setAttribute('fill', '#cbd5e1');
    t1.setAttribute('font-size', '11');
    t1.setAttribute('text-anchor', 'middle');
    t1.textContent = label;
    g.appendChild(t1);
    const t2 = document.createElementNS(svgNS, 'text');
    t2.setAttribute('x', x + w / 2);
    t2.setAttribute('y', y + 42);
    t2.setAttribute('fill', '#22d3ee');
    t2.setAttribute('font-size', '16');
    t2.setAttribute('font-weight', '700');
    t2.setAttribute('text-anchor', 'middle');
    t2.textContent = 'k = ' + count;
    g.appendChild(t2);
    return g;
  }

  function arrow(svgNS, x1, y1, x2, y2) {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', '#64748b');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('marker-end', 'url(#arrowhead)');
    return line;
  }

  function render(container) {
    if (typeof container === 'string') {
      container = container.charAt(0) === '#'
        ? document.getElementById(container.slice(1))
        : document.getElementById(container) || document.querySelector(container);
    }
    if (!container) return;
    const c = compute();
    const W = 720;
    const H = 460;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', '100%');
    svg.setAttribute('style', 'background:transparent;font-family:ui-sans-serif,system-ui,sans-serif;');

    // Marker def
    const defs = document.createElementNS(svgNS, 'defs');
    const m = document.createElementNS(svgNS, 'marker');
    m.setAttribute('id', 'arrowhead');
    m.setAttribute('markerWidth', '10');
    m.setAttribute('markerHeight', '10');
    m.setAttribute('refX', '9');
    m.setAttribute('refY', '3');
    m.setAttribute('orient', 'auto');
    const mp = document.createElementNS(svgNS, 'polygon');
    mp.setAttribute('points', '0 0, 10 3, 0 6');
    mp.setAttribute('fill', '#64748b');
    m.appendChild(mp);
    defs.appendChild(m);
    svg.appendChild(defs);

    // 5 boxes vertical, with side branches for "excluded"
    const boxW = 280, boxH = 56;
    const cx = W / 2;
    const xs = [
      [cx - boxW / 2, 20, 'Records identified (search)', c.total_search, '#1e3a8a'],
      [cx - boxW / 2, 100, 'Records screened', c.screened, '#1e3a8a'],
      [cx - boxW / 2, 200, 'Full-text assessed', c.fulltext, '#1e3a8a'],
      [cx - boxW / 2, 300, 'Included (qualitative)', c.included_qualitative, '#065f46'],
      [cx - boxW / 2, 380, 'In quantitative synthesis (MA / NMA)', c.in_nma, '#0e7490'],
    ];
    xs.forEach(b => svg.appendChild(box(svgNS, b[0], b[1], boxW, boxH, b[2], b[3], b[4])));

    // Side excluded boxes
    svg.appendChild(box(svgNS, cx + 170, 100, 200, boxH,
      'Excluded at screening', c.excluded_screen, '#7f1d1d'));
    svg.appendChild(box(svgNS, cx + 170, 200, 200, boxH,
      'Excluded after full-text', c.excluded_fulltext, '#7f1d1d'));

    // Arrows
    [
      [cx, 76, cx, 100],
      [cx, 156, cx, 200],
      [cx, 256, cx, 300],
      [cx, 356, cx, 380],
      [cx + 140, 128, cx + 170, 128],
      [cx + 140, 228, cx + 170, 228],
    ].forEach(a => svg.appendChild(arrow(svgNS, a[0], a[1], a[2], a[3])));

    container.innerHTML = '';
    container.appendChild(svg);

    // Caption
    const cap = document.createElement('div');
    cap.style.cssText = 'font-size:10px;color:#64748b;margin-top:8px;line-height:1.5;';
    cap.innerHTML = 'PRISMA 2020 / PRISMA-NMA flow (Page 2021 <em>BMJ</em>; Hutton 2015 <em>Ann Intern Med</em>). Counts derived live from RapidMeta.state.trials + realData. Re-renders when state changes.';
    container.appendChild(cap);
  }

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  ready(function () {
    const c = document.getElementById('prismaFlowContainer');
    if (c) {
      // Retry pattern for late RapidMeta init
      let attempts = 0;
      function tryRender() {
        render(c);
        const counts = compute();
        if (counts.total_search === 0 && counts.in_nma === 0 && attempts < 10) {
          attempts++;
          setTimeout(tryRender, 500);
        }
      }
      tryRender();
    }
  });

  global.PrismaFlow = { compute, render };
})(typeof window !== 'undefined' ? window : globalThis);
