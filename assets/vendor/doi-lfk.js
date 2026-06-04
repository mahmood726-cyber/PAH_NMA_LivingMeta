/* doi-lfk.js — Doi plot + LFK index for small-study effects (k<10).
 *
 * Reference: Furuya-Kanamori L, Barendregt JJ, Doi SA. JBI Evid Synth 2018.
 * "A new improved graphical and quantitative method for detecting bias in
 *  meta-analysis."
 *
 * Why this matters for our corpus: Egger's test is underpowered at k<10
 * (advanced-stats.md rule). Almost every Cochrane review using Egger at
 * k=3-9 will fail to reject regardless of asymmetry. Doi/LFK is the
 * JBI/Cochrane-Australia standard for that range.
 *
 * Doi plot:
 *   Plot |Z| = |effect / SE| (y-axis) vs ranked effect size (x-axis).
 *   Should be a symmetric "M" shape under no bias.
 *   Asymmetry → small-study effects.
 *
 * LFK index:
 *   1. Sort effects, find median.
 *   2. Compute area under the |Z| curve below median (a1) vs above (a2).
 *   3. LFK = (a1 - a2) / SD(|Z|).
 *   |LFK| < 1   = no asymmetry
 *   1 ≤ |LFK| < 2 = minor asymmetry
 *   |LFK| ≥ 2    = major asymmetry
 *
 * Public API (window.DoiLFK):
 *   compute(studies)            — studies: [{yi: log-effect, vi: var}, ...]
 *                                 Returns {lfk, verdict, points: [...]}.
 *   render(container, result)   — SVG plot + LFK readout
 */
(function (global) {
  'use strict';

  function compute(studies) {
    const valid = (studies || []).filter(s =>
      s && isFinite(s.yi) && isFinite(s.vi) && s.vi > 0
    );
    const k = valid.length;
    if (k < 3) return { error: 'k<3 — LFK undefined' };

    // Compute |Z| = |yi| / sqrt(vi). For comparison vs pooled, caller can
    // pre-center the yi.
    const points = valid.map((s, i) => {
      const se = Math.sqrt(s.vi);
      return { yi: s.yi, se, absZ: Math.abs(s.yi / se), name: s.name || ('Study ' + (i + 1)) };
    });
    // Sort by yi ascending
    points.sort((a, b) => a.yi - b.yi);

    // Median of yi
    const yi_sorted = points.map(p => p.yi);
    const med = k % 2
      ? yi_sorted[(k - 1) / 2]
      : (yi_sorted[k / 2 - 1] + yi_sorted[k / 2]) / 2;

    // Numerical area under |Z| curve, split at median
    // (Simple trapezoidal sum; LFK is qualitative anyway)
    function trapArea(pts) {
      if (pts.length < 2) return 0;
      let a = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        a += 0.5 * (pts[i + 1].yi - pts[i].yi) * (pts[i].absZ + pts[i + 1].absZ);
      }
      return a;
    }

    const below = points.filter(p => p.yi <= med);
    const above = points.filter(p => p.yi >= med);
    const a1 = trapArea(below);
    const a2 = trapArea(above);

    // SD of |Z|
    const meanZ = points.reduce((s, p) => s + p.absZ, 0) / k;
    const varZ = points.reduce((s, p) => s + (p.absZ - meanZ) * (p.absZ - meanZ), 0) / Math.max(1, k - 1);
    const sdZ = Math.sqrt(varZ);

    const lfk = sdZ > 0 ? (a1 - a2) / sdZ : 0;
    const aLFK = Math.abs(lfk);
    let verdict, color;
    if (aLFK < 1) { verdict = 'No asymmetry'; color = '#10b981'; }
    else if (aLFK < 2) { verdict = 'Minor asymmetry'; color = '#f59e0b'; }
    else { verdict = 'Major asymmetry'; color = '#ef4444'; }

    return {
      k, lfk, aLFK, verdict, color,
      median: med, points, a1, a2, sdZ,
    };
  }

  function fmt(x, d) {
    return x == null || !isFinite(x) ? '—' : x.toFixed(d != null ? d : 2);
  }

  function render(container, result, opts) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    if (result.error) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:8px;">' + result.error + '</div>';
      return;
    }
    opts = opts || {};
    const W = opts.width || 600, H = 280;
    const padL = 60, padR = 20, padT = 30, padB = 50;

    const points = result.points;
    const yiVals = points.map(p => p.yi);
    const absZVals = points.map(p => p.absZ);
    const xMin = Math.min.apply(null, yiVals);
    const xMax = Math.max.apply(null, yiVals);
    const yMin = 0;
    const yMax = Math.max.apply(null, absZVals) * 1.1;
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    const xScale = v => padL + ((v - xMin) / xRange) * (W - padL - padR);
    const yScale = v => H - padB - ((v - yMin) / yRange) * (H - padT - padB);

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', '100%');
    svg.setAttribute('style', 'background:transparent;');

    function el(tag, attrs, text) {
      const e = document.createElementNS(svgNS, tag);
      Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k]));
      if (text != null) e.textContent = text;
      return e;
    }

    // axes
    svg.appendChild(el('line', {
      x1: padL, x2: W - padR, y1: H - padB, y2: H - padB,
      stroke: '#475569', 'stroke-width': 1
    }));
    svg.appendChild(el('line', {
      x1: padL, x2: padL, y1: padT, y2: H - padB,
      stroke: '#475569', 'stroke-width': 1
    }));
    // axis labels
    svg.appendChild(el('text', {
      x: padL + (W - padL - padR) / 2, y: H - 12,
      fill: '#94a3b8', 'font-size': 10, 'text-anchor': 'middle'
    }, 'Effect size (log scale)'));
    svg.appendChild(el('text', {
      x: 16, y: H / 2, fill: '#94a3b8', 'font-size': 10,
      transform: 'rotate(-90 16 ' + (H / 2) + ')',
      'text-anchor': 'middle'
    }, '|Z| = |effect / SE|'));

    // median line
    const xMed = xScale(result.median);
    svg.appendChild(el('line', {
      x1: xMed, x2: xMed, y1: padT, y2: H - padB,
      stroke: '#fbbf24', 'stroke-width': 1, 'stroke-dasharray': '4,3'
    }));
    svg.appendChild(el('text', {
      x: xMed + 4, y: padT + 12, fill: '#fbbf24', 'font-size': 9
    }, 'median'));

    // points connected by line (Doi M-shape)
    let pathD = '';
    points.forEach((p, i) => {
      const cx = xScale(p.yi), cy = yScale(p.absZ);
      pathD += (i === 0 ? 'M' : 'L') + cx + ',' + cy;
    });
    svg.appendChild(el('path', {
      d: pathD, fill: 'none', stroke: result.color, 'stroke-width': 1.5
    }));
    points.forEach(p => {
      svg.appendChild(el('circle', {
        cx: xScale(p.yi), cy: yScale(p.absZ),
        r: 3, fill: result.color, stroke: '#0f172a', 'stroke-width': 1
      }));
    });

    container.innerHTML = '';
    container.appendChild(svg);

    // LFK readout below SVG
    const readout = document.createElement('div');
    readout.style.cssText = 'background:rgba(0,0,0,0.25);border:1px solid ' + result.color + ';border-radius:8px;padding:10px 14px;margin-top:8px;font-size:12px;color:#cbd5e1;';
    readout.innerHTML = '<strong style="color:' + result.color + ';">LFK index = ' + fmt(result.lfk, 2) + '</strong> · ' +
      result.verdict + ' (k=' + result.k + ', median effect=' + fmt(result.median, 2) +
      ', a1=' + fmt(result.a1, 1) + ', a2=' + fmt(result.a2, 1) +
      '). Furuya-Kanamori 2018 thresholds: |LFK|<1 no asymmetry; 1–2 minor; ≥2 major.';
    container.appendChild(readout);
  }

  global.DoiLFK = { compute, render };
})(typeof window !== 'undefined' ? window : globalThis);
