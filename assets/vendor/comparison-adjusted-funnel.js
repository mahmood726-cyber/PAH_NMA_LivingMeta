/* comparison-adjusted-funnel.js — Chaimani & Salanti (2012) funnel plot
 * for network meta-analysis. Lifted from NMA Pro v8 L8025
 * (renderComparisonAdjustedFunnel), reimplemented for the Finrenone corpus.
 *
 * Why: standard funnel plots assume one common comparison. In an NMA with
 * multiple treatments, you have to "comparison-adjust" each trial: subtract
 * the comparison-specific pooled effect from each trial's effect, so that
 * under the null (no small-study effects), all trials should center on
 * zero regardless of which treatments they compared.
 *
 * Plot:
 *   x-axis: study effect minus comparison-pooled effect (centered)
 *   y-axis: SE
 *   95% CI funnel (triangle): ±1.96·SE on x at each y
 *   Symmetric ⇒ no small-study effects.
 *   Trials cluster on one side ⇒ favoring smaller (or newer/active)
 *   treatments — a publication-bias / novelty signal.
 *
 * Egger-on-comparison-adjusted: regress (centered_effect / SE) on (1/SE).
 * If intercept p<0.10, asymmetry detected.
 *
 * Public API (window.ComparisonAdjustedFunnel):
 *   compute(realData, cfg, opts) — opts.measure='RR'|'OR'
 *   render(container, result, opts)
 */
(function (global) {
  'use strict';

  function pnorm(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-z * z / 2);
    const cdf = 1 - phi * (0.319381530 * t + -0.356563782 * t * t + 1.781477937 * t * t * t + -1.821255978 * t * t * t * t + 1.330274429 * t * t * t * t * t);
    return z >= 0 ? cdf : 1 - cdf;
  }

  function effectFromTrial(t, measure) {
    const tE = t.tE, tN = t.tN, cE = t.cE, cN = t.cN;
    if (tE == null || tN == null || cE == null || cN == null) return null;
    if (tN <= 0 || cN <= 0) return null;
    if (tE > tN || cE > cN || tE < 0 || cE < 0) return null;
    if (tE === 0 && cE === 0) return null;
    let tEa = tE, tNa = tN, cEa = cE, cNa = cN;
    if (tEa === 0 || cEa === 0 || tEa === tNa || cEa === cNa) {
      tEa += 0.5; tNa += 1;
      cEa += 0.5; cNa += 1;
    }
    if (measure === 'OR') {
      const a = tEa, b = tNa - tEa, c = cEa, d = cNa - cEa;
      return { yi: Math.log((a * d) / (b * c)), vi: 1 / a + 1 / b + 1 / c + 1 / d };
    }
    const log_rr = Math.log((tEa / tNa) / (cEa / cNa));
    return { yi: log_rr, vi: 1 / tEa - 1 / tNa + 1 / cEa - 1 / cNa };
  }

  function poolEdgeDL(trials) {
    const valid = trials.filter(t => t && isFinite(t.yi) && isFinite(t.vi) && t.vi > 0);
    if (valid.length === 0) return null;
    const wFE = valid.map(t => 1 / t.vi);
    const sumW = wFE.reduce((a, b) => a + b, 0);
    const muFE = valid.reduce((s, t, i) => s + wFE[i] * t.yi, 0) / sumW;
    const Q = valid.reduce((s, t, i) => s + wFE[i] * (t.yi - muFE) * (t.yi - muFE), 0);
    const df = valid.length - 1;
    let tau2 = 0;
    if (Q > df && df > 0) {
      const C = sumW - wFE.reduce((s, w) => s + w * w, 0) / sumW;
      tau2 = Math.max(0, (Q - df) / C);
    }
    const wRE = valid.map(t => 1 / (t.vi + tau2));
    const sumWRE = wRE.reduce((a, b) => a + b, 0);
    const mu = valid.reduce((s, t, i) => s + wRE[i] * t.yi, 0) / sumWRE;
    return { mu, tau2, k: valid.length };
  }

  function compute(realData, cfg, opts) {
    opts = opts || {};
    const measure = opts.measure || 'RR';
    if (!realData || !cfg) return { error: 'Missing realData or NMA_CONFIG' };

    const points = [];
    const edgeFits = [];
    (cfg.comparisons || []).forEach(c => {
      const trials = (c.trials || [])
        .map(nct => realData[nct])
        .filter(Boolean)
        .map(t => {
          const e = effectFromTrial(t, measure);
          return e ? { name: t.name || '?', yi: e.yi, vi: e.vi, t1: c.t1, t2: c.t2 } : null;
        })
        .filter(Boolean);
      if (!trials.length) return;
      const pool = poolEdgeDL(trials);
      if (!pool) return;
      edgeFits.push({ t1: c.t1, t2: c.t2, k: pool.k, mu: pool.mu, tau2: pool.tau2 });
      trials.forEach(t => {
        points.push({
          name: t.name,
          edge: c.t1 + ' vs ' + c.t2,
          yi: t.yi,
          se: Math.sqrt(t.vi),
          centered: t.yi - pool.mu,
        });
      });
    });

    if (points.length === 0) return { error: 'No usable trials' };

    // Egger on comparison-adjusted: y = β0 + β1·(1/SE), where y = centered/SE
    // (equivalent to Egger's standard test on the centered effects)
    let beta0 = 0, beta0_se = 0, p_egger = null;
    if (points.length >= 4) {
      const ys = points.map(p => p.centered / p.se);
      const xs = points.map(p => 1 / p.se);
      const n = ys.length;
      const meanX = xs.reduce((s, v) => s + v, 0) / n;
      const meanY = ys.reduce((s, v) => s + v, 0) / n;
      let sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) {
        sxy += (xs[i] - meanX) * (ys[i] - meanY);
        sxx += (xs[i] - meanX) * (xs[i] - meanX);
      }
      const beta1 = sxx > 0 ? sxy / sxx : 0;
      beta0 = meanY - beta1 * meanX;
      // residual SE
      let rss = 0;
      for (let i = 0; i < n; i++) {
        const yhat = beta0 + beta1 * xs[i];
        rss += (ys[i] - yhat) * (ys[i] - yhat);
      }
      const sigma2 = n > 2 ? rss / (n - 2) : 0;
      beta0_se = sigma2 > 0 ? Math.sqrt(sigma2 * (1 / n + (meanX * meanX) / sxx)) : 0;
      const t_stat = beta0_se > 0 ? beta0 / beta0_se : 0;
      p_egger = 2 * (1 - pnorm(Math.abs(t_stat)));
    }

    return {
      measure,
      nPoints: points.length,
      nEdges: edgeFits.length,
      points,
      edgeFits,
      egger: { intercept: beta0, intercept_se: beta0_se, p: p_egger },
    };
  }

  function render(container, result, opts) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    if (result.error) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:8px;">' + result.error + '</div>';
      return;
    }
    opts = opts || {};
    const W = opts.width || 620, H = 320;
    const padL = 70, padR = 30, padT = 30, padB = 50;

    const points = result.points;
    const seVals = points.map(p => p.se);
    const cVals = points.map(p => p.centered);

    let xMin = Math.min.apply(null, cVals);
    let xMax = Math.max.apply(null, cVals);
    let absX = Math.max(Math.abs(xMin), Math.abs(xMax));
    absX = Math.max(absX, 0.5) * 1.2;
    xMin = -absX; xMax = absX;
    const yMax = Math.max.apply(null, seVals) * 1.15;
    const yMin = 0;

    const xScale = v => padL + ((v - xMin) / (xMax - xMin)) * (W - padL - padR);
    const yScale = v => H - padB - ((yMax - v) / (yMax - yMin)) * (H - padT - padB);
    // NB: inverted Y so larger SE (less precise) at the top — standard funnel orientation

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

    // 95% funnel triangle (vertex at SE=0, x=0; base at yMax, x=±1.96·yMax)
    svg.appendChild(el('polygon', {
      points: [
        xScale(0) + ',' + yScale(0),
        xScale(-1.96 * yMax) + ',' + yScale(yMax),
        xScale(1.96 * yMax) + ',' + yScale(yMax),
      ].join(' '),
      fill: 'rgba(96,165,250,0.08)',
      stroke: 'rgba(96,165,250,0.4)',
      'stroke-width': 1,
      'stroke-dasharray': '3,3',
    }));

    // Center line at x=0
    svg.appendChild(el('line', {
      x1: xScale(0), x2: xScale(0),
      y1: yScale(yMin), y2: yScale(yMax),
      stroke: '#475569', 'stroke-width': 1
    }));

    // X axis (at base)
    svg.appendChild(el('line', {
      x1: padL, x2: W - padR,
      y1: yScale(yMax), y2: yScale(yMax),
      stroke: '#475569', 'stroke-width': 1
    }));
    // Y axis
    svg.appendChild(el('line', {
      x1: padL, x2: padL,
      y1: yScale(yMin), y2: yScale(yMax),
      stroke: '#475569', 'stroke-width': 1
    }));

    // axis labels
    svg.appendChild(el('text', {
      x: padL + (W - padL - padR) / 2, y: H - 12,
      fill: '#94a3b8', 'font-size': 10, 'text-anchor': 'middle'
    }, 'Centered effect (study − comparison pool, log scale)'));
    svg.appendChild(el('text', {
      x: 16, y: H / 2, fill: '#94a3b8', 'font-size': 10,
      transform: 'rotate(-90 16 ' + (H / 2) + ')',
      'text-anchor': 'middle'
    }, 'SE'));

    // Trial points colored by edge
    const edges = Array.from(new Set(points.map(p => p.edge)));
    const palette = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#f87171', '#22d3ee'];
    const colorFor = e => palette[edges.indexOf(e) % palette.length];

    points.forEach(p => {
      svg.appendChild(el('circle', {
        cx: xScale(p.centered),
        cy: yScale(p.se),
        r: 4, fill: colorFor(p.edge), stroke: '#0f172a', 'stroke-width': 1
      }));
    });

    // Legend
    edges.forEach((e, i) => {
      const ly = padT + i * 14;
      svg.appendChild(el('rect', {
        x: W - padR - 140, y: ly, width: 8, height: 8, fill: colorFor(e)
      }));
      svg.appendChild(el('text', {
        x: W - padR - 128, y: ly + 7,
        fill: '#cbd5e1', 'font-size': 9
      }, e.length > 25 ? e.slice(0, 23) + '…' : e));
    });

    container.innerHTML = '';
    container.appendChild(svg);

    // Egger readout
    const eg = result.egger;
    if (eg && eg.p != null) {
      const sig = eg.p < 0.10;
      const color = sig ? '#ef4444' : '#10b981';
      const verdict = sig ? 'Asymmetry detected' : 'No asymmetry';
      const r = document.createElement('div');
      r.style.cssText = 'background:rgba(0,0,0,0.25);border:1px solid ' + color + ';border-radius:8px;padding:10px 14px;margin-top:8px;font-size:12px;color:#cbd5e1;';
      r.innerHTML = '<strong style="color:' + color + ';">Egger\'s test (comparison-adjusted): ' + verdict + '</strong> · ' +
        'intercept=' + eg.intercept.toFixed(3) +
        ' (SE=' + eg.intercept_se.toFixed(3) +
        '), p=' + eg.p.toFixed(3) +
        '. ' + result.nPoints + ' trial-arm points across ' + result.nEdges + ' direct comparisons.';
      container.appendChild(r);
    }
  }

  global.ComparisonAdjustedFunnel = { compute, render };
})(typeof window !== 'undefined' ? window : globalThis);
