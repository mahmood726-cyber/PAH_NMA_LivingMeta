/* Cumulative meta-analysis for single-arm proportion pools.
 *
 * Sort trials by year, plot the running pooled proportion (logit-RE,
 * back-transformed) as each trial is added to the pool. Detects when
 * the pooled estimate "settles" — point estimate stable, CI tightens.
 *
 * Lau J, Schmid CH, Chalmers TC. Cumulative meta-analysis of clinical
 * trials builds evidence for exemplary medical care. JAMA 1992.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'single-arm-cumulative-expanded';

  function pickSingleArmTrialsWithYears(rd) {
    if (!rd) return [];
    const out = [];
    Object.values(rd).forEach(t => {
      if (!t) return;
      let e, n;
      const ao = t.allOutcomes;
      if (Array.isArray(ao)) {
        const prop = ao.find(o => o && (o.type === 'PROPORTION' || o.type === 'SINGLE_ARM')
                                     && Number.isFinite(+o.events) && Number.isFinite(+o.n) && +o.n > 0);
        if (prop) { e = +prop.events; n = +prop.n; }
      }
      if (e === undefined && t.singleArm === true && Number.isFinite(+t.events) && Number.isFinite(+t.n) && +t.n > 0) {
        e = +t.events; n = +t.n;
      }
      if (e === undefined && Number.isFinite(+t.events) && Number.isFinite(+t.n) && +t.n > 0
          && (t.cN == null || +t.cN === 0) && (t.cE == null || +t.cE === 0)) {
        e = +t.events; n = +t.n;
      }
      if (e === undefined && Number.isFinite(+t.tE) && Number.isFinite(+t.tN) && +t.tN > 0
          && (t.cN === undefined || t.cN === null || +t.cN === 0)
          && (t.cE === undefined || t.cE === null || +t.cE === 0)) {
        e = +t.tE; n = +t.tN;
      }
      if (e === undefined || n === undefined || e < 0 || n <= 0 || e > n) return;
      const year = +t.year;
      if (!Number.isFinite(year)) return;
      out.push({ name: t.name || '?', e, n, year });
    });
    return out;
  }

  function poolLogit(trials) {
    if (!trials || trials.length === 0) return null;
    const points = trials.map(t => {
      let e = t.e, n = t.n;
      if (e === 0 || e === n) { e += 0.5; n += 1; }
      const p = e / n;
      return { yi: Math.log(p / (1 - p)), vi: 1/e + 1/(n - e) };
    });
    if (points.length === 1) {
      const p = points[0];
      return { yi: p.yi, ci_low: p.yi - 1.96 * Math.sqrt(p.vi), ci_high: p.yi + 1.96 * Math.sqrt(p.vi), k: 1 };
    }
    let W = 0, WY = 0;
    points.forEach(p => { const w = 1/p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    let Q = 0;
    points.forEach(p => { const w = 1/p.vi; Q += w * Math.pow(p.yi - yFE, 2); });
    const df = points.length - 1;
    const sumW2 = points.reduce((s, p) => s + Math.pow(1/p.vi, 2), 0);
    const c = W - sumW2 / W;
    const tau2 = Math.max(0, (Q - df) / c);
    let W2 = 0, WY2 = 0;
    points.forEach(p => { const w = 1/(p.vi + tau2); W2 += w; WY2 += w * p.yi; });
    const yRE = WY2 / W2;
    const seRE = Math.sqrt(1/W2);
    return { yi: yRE, ci_low: yRE - 1.96 * seRE, ci_high: yRE + 1.96 * seRE, k: points.length };
  }

  function invLogit(y) { return Math.exp(y) / (1 + Math.exp(y)); }

  function buildSVG(P, points, fullPool) {
    const W = 760, rowH = 22, H = 60 + rowH * points.length;
    const yearCol = 80, propLabelCol = 250;
    const axCol = W - propLabelCol - 10;
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    // Header
    svg += '<text x="6" y="20" fill="#94a3b8" font-size="10" font-weight="600">Through year</text>';
    svg += '<text x="' + (yearCol + 6) + '" y="20" fill="#94a3b8" font-size="10" font-weight="600">Pooled (95% CI), k</text>';
    svg += '<text x="' + (propLabelCol + axCol/2) + '" y="20" fill="#7dd3fc" font-size="11" text-anchor="middle" font-weight="600">Cumulative pooled proportion</text>';
    [0, 0.25, 0.5, 0.75, 1.0].forEach(p => {
      const xp = propLabelCol + p * axCol;
      svg += '<line x1="' + xp + '" x2="' + xp + '" y1="32" y2="' + (H - 16) + '" stroke="#1e293b" stroke-dasharray="2,3" />';
      svg += '<text x="' + xp + '" y="' + (H - 4) + '" fill="#94a3b8" font-size="9.5" text-anchor="middle">' + (p*100).toFixed(0) + '%</text>';
    });

    points.forEach((pt, i) => {
      const y = 36 + rowH * i;
      const prop = invLogit(pt.yi);
      const lo = invLogit(pt.ci_low), hi = invLogit(pt.ci_high);
      svg += '<text x="6" y="' + (y + 4) + '" fill="#cbd5e1" font-size="10.5">' + pt.year + '</text>';
      svg += '<text x="' + (yearCol + 6) + '" y="' + (y + 4) + '" fill="#7dd3fc" font-size="10" font-family="JetBrains Mono,monospace">'
           + (prop*100).toFixed(1) + '% [' + (lo*100).toFixed(1) + '–' + (hi*100).toFixed(1) + '%], k=' + pt.k + '</text>';
      const xC = propLabelCol + prop * axCol;
      const xL = propLabelCol + lo * axCol;
      const xH = propLabelCol + hi * axCol;
      svg += '<line x1="' + xL + '" x2="' + xH + '" y1="' + y + '" y2="' + y + '" stroke="#7dd3fc" stroke-width="1.5" />';
      svg += '<rect x="' + (xC - 4) + '" y="' + (y - 4) + '" width="8" height="8" transform="rotate(45 ' + xC + ' ' + y + ')" fill="#7dd3fc" stroke="#0b1220" stroke-width="1" />';
    });
    svg += '</svg>';
    return svg;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = pickSingleArmTrialsWithYears(rd);
    if (trials.length < 3) return false;
    trials.sort((a, b) => a.year - b.year);

    const fullPool = poolLogit(trials);
    const points = [];
    for (let i = 1; i < trials.length; i++) {
      const subset = trials.slice(0, i + 1);
      const pool = poolLogit(subset);
      if (!pool) continue;
      points.push({ year: trials[i].year, ...pool });
    }

    // Stability: when does CI width drop below 5pp?
    let firstStable = null;
    for (const p of points) {
      const lo = invLogit(p.ci_low), hi = invLogit(p.ci_high);
      if ((hi - lo) < 0.05) { firstStable = p; break; }
    }
    const finalProp = invLogit(fullPool.yi) * 100;
    const summary = firstStable
      ? 'CI width <5 pp first reached at ' + firstStable.year + ' (k=' + firstStable.k + ') · final ' + P.fmt(finalProp, 1) + '%'
      : 'k=' + trials.length + ' · CI width still >5 pp · final ' + P.fmt(finalProp, 1) + '%';

    const svg = buildSVG(P, points, fullPool);
    const note = '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
               + 'Each row = pooled proportion through that year (DL+RE logit, back-transformed). '
               + 'Useful for spotting when the evidence "settled" — point estimate stops drifting and CI tightens. '
               + 'Lau JAMA 1992; Cochrane Handbook v6.5 §10.10.5.'
               + '</div>';
    const panel = P.buildCollapsiblePanel({
      id: 'single-arm-cumulative-panel', badge: 'Cumulative MA (single-arm)',
      summary, bodyHtml: svg + note, storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('single-arm-cumulative-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1850));
    } else { setTimeout(tick, 1850); }
  }

  global.SingleArmCumulative = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
