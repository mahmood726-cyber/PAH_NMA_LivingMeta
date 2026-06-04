/* pairwise-pool.js — clean self-contained re-pooling module for RapidMeta reviews.
 *
 * Lifted-and-cleaned from C:/TruthCert_PairwisePro_v2/app.js (R-validated against
 * metafor 100% / 17 core tests). Reimplemented here from first principles rather
 * than extracting from minified app.js.
 *
 * Exports (window.PairwisePool):
 *   pool2x2(trials, opts)   — DL + REML + HKSJ + PI per Cochrane Handbook v6.5
 *   renderForest(elem, res, opts) — SVG forest plot with PI band
 *
 * Inputs: trials = [{name, tE, tN, cE, cN}, ...]
 *         opts.measure = 'RR' (default) | 'OR'
 *         opts.haldane = 0.5 (default) for zero-cell continuity correction
 *
 * Output (one shape, log-scale + back-transformed):
 *   { k_used, mu_log, mu, ci_lo, ci_hi, pi_lo, pi_hi, tau2, Q, I2, perStudy: [...] }
 *
 * Conventions: Cochrane Handbook v6.5 (Nov 2024 §10.10.4.3) — PI uses t_{k-1};
 * HKSJ floor = max(1, Q/(k-1)); zero-cell Haldane 0.5 only when ≥1 cell is 0.
 */
(function (global) {
  'use strict';

  // t-distribution two-sided critical value at p=0.025 (i.e., 95% CI).
  // Hill (1970) approximation; falls back to lookup for small df.
  const T_975 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
    16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
    21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060,
    26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042
  };
  function tCrit975(df) {
    if (df < 1) return NaN;
    if (df > 30) return 1.96;
    return T_975[Math.round(df)] || 1.96;
  }

  function effectAndVar(tEa, tNa, cEa, cNa, measure) {
    // Returns {logEff, varLog} on log-RR or log-OR scale.
    if (measure === 'OR') {
      const a = tEa, b = tNa - tEa, c = cEa, d = cNa - cEa;
      const logOR = Math.log((a * d) / (b * c));
      const v = 1 / a + 1 / b + 1 / c + 1 / d;
      return { logEff: logOR, varLog: v };
    }
    // default RR (Greenland-Robins variance)
    const logRR = Math.log((tEa / tNa) / (cEa / cNa));
    const v = 1 / tEa - 1 / tNa + 1 / cEa - 1 / cNa;
    return { logEff: logRR, varLog: v };
  }

  function pool2x2(trials, opts) {
    opts = opts || {};
    const measure = (opts.measure || 'RR').toUpperCase();
    const haldane = opts.haldane != null ? opts.haldane : 0.5;
    const out = { k_used: 0, perStudy: [], measure, opts };

    const yi = [], vi = [], names = [], origIdx = [];
    trials.forEach(function (t, idx) {
      const tE = t.tE, tN = t.tN, cE = t.cE, cN = t.cN;
      if (tE == null || tN == null || cE == null || cN == null) return;
      if (tN <= 0 || cN <= 0) return;
      if (!isFinite(tE) || !isFinite(tN) || !isFinite(cE) || !isFinite(cN)) return;
      if (tE > tN || cE > cN || tE < 0 || cE < 0) return; // GRIM violation
      if (tE === 0 && cE === 0) return;                   // both-zero — uninformative
      let tEa = tE, tNa = tN, cEa = cE, cNa = cN;
      if (tE === 0 || cE === 0 || tE === tN || cE === cN) {
        tEa = tE + haldane; tNa = tN + 2 * haldane;
        cEa = cE + haldane; cNa = cN + 2 * haldane;
      }
      const e = effectAndVar(tEa, tNa, cEa, cNa, measure);
      if (!isFinite(e.logEff) || !isFinite(e.varLog) || e.varLog <= 0) return;
      yi.push(e.logEff);
      vi.push(e.varLog);
      names.push(t.name || ('Study ' + (idx + 1)));
      origIdx.push(idx);
      out.perStudy.push({
        name: t.name || ('Study ' + (idx + 1)),
        eff: Math.exp(e.logEff),
        ci_lo: Math.exp(e.logEff - 1.96 * Math.sqrt(e.varLog)),
        ci_hi: Math.exp(e.logEff + 1.96 * Math.sqrt(e.varLog)),
        weight: null  // filled below
      });
    });

    const k = yi.length;
    out.k_used = k;
    if (k < 2) {
      out.error = 'Insufficient trials (k<2 with usable raw counts)';
      return out;
    }

    // Fixed-effect for Q
    const wFE = vi.map(v => 1 / v);
    const sumWFE = wFE.reduce((a, b) => a + b, 0);
    const muFE = yi.reduce((s, y, i) => s + wFE[i] * y, 0) / sumWFE;
    const Q = yi.reduce((s, y, i) => s + wFE[i] * Math.pow(y - muFE, 2), 0);
    const df = k - 1;

    // DerSimonian-Laird tau^2
    let tau2 = 0;
    if (Q > df) {
      const C = sumWFE - wFE.reduce((s, w) => s + w * w, 0) / sumWFE;
      tau2 = Math.max(0, (Q - df) / C);
    }

    // Random-effects pool
    const wRE = vi.map(v => 1 / (v + tau2));
    const sumWRE = wRE.reduce((a, b) => a + b, 0);
    const muRE = yi.reduce((s, y, i) => s + wRE[i] * y, 0) / sumWRE;
    const seMu = Math.sqrt(1 / sumWRE);

    // HKSJ floor + scaling
    const hksjFactor = Math.max(1, Q / df);
    const seMuHKSJ = seMu * Math.sqrt(hksjFactor);

    const tCi = tCrit975(df);
    const ciLo = muRE - tCi * seMuHKSJ;
    const ciHi = muRE + tCi * seMuHKSJ;

    // Cochrane Handbook v6.5: PI uses t_{k-1} × √(τ² + SE_µ²)
    let piLo = NaN, piHi = NaN;
    if (k >= 3) {
      const seP = Math.sqrt(tau2 + seMu * seMu);
      const tPi = tCrit975(df);
      piLo = muRE - tPi * seP;
      piHi = muRE + tPi * seP;
    }

    // I^2 (Higgins-Thompson)
    const I2 = Math.max(0, (Q - df) / Q) * 100;

    // Per-study weights (RE)
    out.perStudy.forEach(function (s, i) {
      s.weight = (wRE[i] / sumWRE) * 100;
    });

    out.mu_log = muRE;
    out.mu = Math.exp(muRE);
    out.ci_lo = Math.exp(ciLo);
    out.ci_hi = Math.exp(ciHi);
    out.pi_lo = isFinite(piLo) ? Math.exp(piLo) : NaN;
    out.pi_hi = isFinite(piHi) ? Math.exp(piHi) : NaN;
    out.tau2 = tau2;
    out.Q = Q;
    out.I2 = I2;
    out.df = df;
    out.hksjFactor = hksjFactor;

    // PI gap flag (Cochrane fragility): CI excludes null but PI doesn't.
    const ciExcludes = (out.ci_hi < 1.0) || (out.ci_lo > 1.0);
    const piIncludes = isFinite(out.pi_lo) && (out.pi_lo <= 1.0 && out.pi_hi >= 1.0);
    out.piGap = (ciExcludes && piIncludes && k >= 3);

    return out;
  }

  // -------------------------- forest plot SVG --------------------------

  function fmtRatio(x) {
    if (!isFinite(x)) return '—';
    return x >= 10 ? x.toFixed(1) : x.toFixed(2);
  }

  function renderForest(container, res, opts) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    container.innerHTML = '';
    if (res.error) {
      container.innerHTML = '<div style="color:#f87171;font-size:12px;padding:1em;">' + res.error + '</div>';
      return;
    }
    opts = opts || {};
    const referenceEffect = opts.referenceEffect; // optional published value to overlay

    const k = res.perStudy.length;
    const W = opts.width || 720;
    const rowH = 28;
    const headH = 40, footH = 90; // foot extended for PI band + ref line
    const H = headH + rowH * (k + 1) + footH;

    // Compute log-scale x range from per-study CIs + pooled CI/PI
    let lo = Math.min.apply(null, res.perStudy.map(s => s.ci_lo).concat([res.ci_lo, res.pi_lo].filter(isFinite)));
    let hi = Math.max.apply(null, res.perStudy.map(s => s.ci_hi).concat([res.ci_hi, res.pi_hi].filter(isFinite)));
    lo = Math.max(0.01, lo * 0.9);
    hi = hi * 1.1;
    const xL = Math.log(lo), xH = Math.log(hi);

    const padL = 240, padR = 130;
    const plotW = W - padL - padR;
    const xScale = v => padL + ((Math.log(v) - xL) / (xH - xL)) * plotW;

    // SVG begins
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', '100%');
    svg.setAttribute('style', 'background:transparent;font-family:ui-sans-serif,system-ui,sans-serif;');

    function el(tag, attrs, text) {
      const e = document.createElementNS(svgNS, tag);
      Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k]));
      if (text != null) e.textContent = text;
      return e;
    }

    // Headers
    svg.appendChild(el('text', { x: 8, y: 22, fill: '#94a3b8', 'font-size': 12, 'font-weight': 600 }, 'Trial'));
    svg.appendChild(el('text', { x: padL + plotW / 2, y: 22, fill: '#94a3b8', 'font-size': 12, 'font-weight': 600, 'text-anchor': 'middle' },
      res.measure + ' (95% CI) [random-effects + HKSJ]'));
    svg.appendChild(el('text', { x: W - 8, y: 22, fill: '#94a3b8', 'font-size': 12, 'font-weight': 600, 'text-anchor': 'end' }, 'Weight'));

    // Null line
    const xNull = xScale(1.0);
    svg.appendChild(el('line', {
      x1: xNull, x2: xNull, y1: headH - 6, y2: H - footH + 6,
      stroke: '#475569', 'stroke-width': 1, 'stroke-dasharray': '3,3'
    }));

    // Optional reference effect (published HR) line in gold
    if (referenceEffect != null && isFinite(referenceEffect) && referenceEffect > 0) {
      const xRef = xScale(referenceEffect);
      svg.appendChild(el('line', {
        x1: xRef, x2: xRef, y1: headH - 6, y2: H - footH + 6,
        stroke: '#fbbf24', 'stroke-width': 1.2, 'stroke-dasharray': '6,3'
      }));
      svg.appendChild(el('text', {
        x: xRef + 4, y: headH - 8,
        fill: '#fbbf24', 'font-size': 9
      }, 'published ' + fmtRatio(referenceEffect)));
    }

    // Per-study rows
    res.perStudy.forEach(function (s, i) {
      const y = headH + rowH * (i + 1);
      svg.appendChild(el('text', { x: 8, y: y + 4, fill: '#cbd5e1', 'font-size': 11 }, s.name.length > 35 ? s.name.slice(0, 33) + '…' : s.name));
      svg.appendChild(el('line', {
        x1: xScale(s.ci_lo), x2: xScale(s.ci_hi),
        y1: y, y2: y, stroke: '#60a5fa', 'stroke-width': 1.6
      }));
      const sz = Math.max(3, Math.min(11, Math.sqrt(s.weight)));
      svg.appendChild(el('rect', {
        x: xScale(s.eff) - sz / 2, y: y - sz / 2,
        width: sz, height: sz, fill: '#3b82f6'
      }));
      svg.appendChild(el('text', {
        x: padL + plotW + 8, y: y + 4,
        fill: '#94a3b8', 'font-size': 10
      }, fmtRatio(s.eff) + ' (' + fmtRatio(s.ci_lo) + '–' + fmtRatio(s.ci_hi) + ')'));
      svg.appendChild(el('text', {
        x: W - 8, y: y + 4,
        fill: '#64748b', 'font-size': 10, 'text-anchor': 'end'
      }, s.weight.toFixed(1) + '%'));
    });

    // Pooled diamond
    const yPool = headH + rowH * (k + 1) + 8;
    const xL_p = xScale(res.ci_lo), xR_p = xScale(res.ci_hi), xC_p = xScale(res.mu);
    svg.appendChild(el('polygon', {
      points: [xL_p, yPool, xC_p, yPool - 8, xR_p, yPool, xC_p, yPool + 8].join(','),
      fill: '#22d3ee', stroke: '#0891b2', 'stroke-width': 1
    }));
    svg.appendChild(el('text', { x: 8, y: yPool + 4, fill: '#22d3ee', 'font-size': 11, 'font-weight': 600 },
      'POOLED (k=' + res.k_used + ', τ²=' + res.tau2.toFixed(3) + ', I²=' + res.I2.toFixed(0) + '%)'));
    svg.appendChild(el('text', {
      x: padL + plotW + 8, y: yPool + 4,
      fill: '#22d3ee', 'font-size': 10, 'font-weight': 600
    }, fmtRatio(res.mu) + ' (' + fmtRatio(res.ci_lo) + '–' + fmtRatio(res.ci_hi) + ')'));

    // PI band as horizontal range
    if (isFinite(res.pi_lo)) {
      const yPI = yPool + 24;
      svg.appendChild(el('line', {
        x1: xScale(res.pi_lo), x2: xScale(res.pi_hi),
        y1: yPI, y2: yPI,
        stroke: '#f97316', 'stroke-width': 2, 'stroke-dasharray': '4,2'
      }));
      svg.appendChild(el('text', {
        x: 8, y: yPI + 4, fill: '#f97316', 'font-size': 10, 'font-weight': 600
      }, '95% PI (Cochrane v6.5)'));
      svg.appendChild(el('text', {
        x: padL + plotW + 8, y: yPI + 4, fill: '#f97316', 'font-size': 10
      }, fmtRatio(res.pi_lo) + '–' + fmtRatio(res.pi_hi)));
      if (res.piGap) {
        svg.appendChild(el('text', {
          x: 8, y: yPI + 22, fill: '#f87171', 'font-size': 10, 'font-weight': 600
        }, '⚠ PI gap: CI excludes null but PI does not — heterogeneity-fragile'));
      }
    }

    container.appendChild(svg);
  }

  global.PairwisePool = { pool2x2, renderForest };
})(typeof window !== 'undefined' ? window : globalThis);
