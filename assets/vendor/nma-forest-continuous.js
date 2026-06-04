/* NMA forest for continuous outcomes — analogue of nma-forest-all-treatments.js
 * for NMAs whose primary outcome is continuous (mean difference, SMD, change-from-baseline).
 *
 * Per comparison T vs reference, pools log-MD via DerSimonian–Laird random
 * effects on trial-level (md, se) extracted from allOutcomes[*] with
 * type='CONTINUOUS'. Self-skips silently if not an NMA, or no continuous
 * outcomes detected.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'nma-forest-continuous-expanded';

  function getNMACfg() { return global.NMA_CONFIG || null; }

  // Continuous-instrument shortLabels — when an outcome is type:'PRIMARY'
  // but the shortLabel matches one of these, treat it as continuous (MD)
  // and back-compute se from pubHR_LCI/pubHR_UCI.
  const CONT_LABEL_RE = /^(CDR_?SB|CDR-?SB|MMSE|ADAS|PPF[Ee]V1|FEV1|BCVA|KCCQ|SF36|EQ5D|EQ-?5D|ETDRS|HADS|PHQ|GAD|HRSD|MADRS|YBOCS|SLEDAI|UPDRS|MD|change|score)/i;

  function pickContinuous(t) {
    if (!t) return null;
    const allOutcomes = t.allOutcomes || (t.data && t.data.allOutcomes);
    if (!Array.isArray(allOutcomes)) return null;
    // Variant 1: explicit type='CONTINUOUS' with md+se (current standard)
    let cont = allOutcomes.find(o => o && (o.type === 'CONTINUOUS' || o.type === 'continuous')
                                          && typeof o.md === 'number' && typeof o.se === 'number'
                                          && o.se > 0);
    if (cont) return { md: cont.md, se: cont.se };
    // Variant 2: legacy NMA encoding — type='PRIMARY' with continuous-
    // instrument shortLabel and pubHR / pubHR_LCI / pubHR_UCI carrying
    // MD + 95% CI (despite the "HR" naming, the numbers are mean differences).
    cont = allOutcomes.find(o => o && o.type === 'PRIMARY'
                                    && CONT_LABEL_RE.test(String(o.shortLabel || o.title || ''))
                                    && typeof o.pubHR === 'number'
                                    && typeof o.pubHR_LCI === 'number'
                                    && typeof o.pubHR_UCI === 'number'
                                    && o.pubHR_UCI > o.pubHR_LCI);
    if (cont) {
      const md = cont.pubHR;
      const se = (cont.pubHR_UCI - cont.pubHR_LCI) / 3.92;  // (UCI - LCI) / (2 * 1.96)
      if (se > 0 && isFinite(se)) return { md, se };
    }
    return null;
  }

  function poolDLRE(points) {
    if (!points || points.length === 0) return null;
    if (points.length === 1) {
      const p = points[0];
      return { md: p.yi, se: Math.sqrt(p.vi),
               ci_low: p.yi - 1.96 * Math.sqrt(p.vi),
               ci_high: p.yi + 1.96 * Math.sqrt(p.vi),
               k: 1, tau2: 0 };
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
    return {
      md: yRE, se: seRE,
      ci_low: yRE - 1.96 * seRE,
      ci_high: yRE + 1.96 * seRE,
      k: points.length, tau2,
    };
  }

  function pickReference(cfg, treatments) {
    if (cfg && cfg.protocol && cfg.protocol.comp) {
      const t = treatments.find(t =>
        cfg.protocol.comp.toLowerCase().includes(t.toLowerCase()) ||
        t.toLowerCase().includes('placebo') || t.toLowerCase().includes('control'));
      if (t) return t;
    }
    const placebo = treatments.find(t => t.toLowerCase().includes('placebo'));
    if (placebo) return placebo;
    const ctrl = treatments.find(t => t.toLowerCase().includes('control'));
    if (ctrl) return ctrl;
    if (cfg && cfg.comparisons) {
      const cnt = {};
      cfg.comparisons.forEach(c => {
        cnt[c.t1] = (cnt[c.t1] || 0) + 1;
        cnt[c.t2] = (cnt[c.t2] || 0) + 1;
      });
      let best = null, bestN = 0;
      Object.entries(cnt).forEach(([t, n]) => { if (n > bestN) { bestN = n; best = t; } });
      if (best && treatments.indexOf(best) >= 0) return best;
    }
    return treatments[treatments.length - 1];
  }

  function buildSVG(P, rows, refLabel) {
    const W = 760, rowH = 26, H = 70 + rowH * rows.length;
    const margin = { l: 200, r: 130, t: 30, b: 40 };
    const innerW = W - margin.l - margin.r;
    const xAxisY = H - margin.b;

    const lows = rows.map(r => r.pool.ci_low);
    const highs = rows.map(r => r.pool.ci_high);
    let xMin = Math.min(...lows, 0);
    let xMax = Math.max(...highs, 0);
    const span = xMax - xMin;
    xMin -= span * 0.1; xMax += span * 0.1;

    const x = v => margin.l + ((v - xMin) / (xMax - xMin)) * innerW;
    const xZero = x(0);

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    if (xZero >= margin.l && xZero <= W - margin.r) {
      svg += '<line x1="' + xZero + '" x2="' + xZero + '" y1="' + margin.t + '" y2="' + xAxisY + '" stroke="#475569" stroke-dasharray="3,3" />';
    }
    [xMin, xMin/2, 0, xMax/2, xMax].forEach(t => {
      const px = x(t);
      svg += '<line x1="' + px + '" x2="' + px + '" y1="' + (xAxisY - 4) + '" y2="' + (xAxisY + 4) + '" stroke="#94a3b8" />';
      svg += '<text x="' + px + '" y="' + (xAxisY + 14) + '" fill="#94a3b8" font-size="10" text-anchor="middle">' + P.fmt(t, 2) + '</text>';
    });
    svg += '<text x="' + ((margin.l + W - margin.r) / 2) + '" y="' + (xAxisY + 30) + '" fill="#cbd5e1" font-size="11" text-anchor="middle">Mean difference vs ' + refLabel + '</text>';
    svg += '<text x="6" y="' + (margin.t + 14) + '" fill="#94a3b8" font-size="10" font-weight="600">Treatment</text>';
    svg += '<text x="' + (W - margin.r + 8) + '" y="' + (margin.t + 14) + '" fill="#94a3b8" font-size="10" font-weight="600">MD (95% CI), k</text>';

    rows.forEach((r, i) => {
      const y = margin.t + 28 + rowH * i;
      svg += '<text x="6" y="' + y + '" fill="#cbd5e1" font-size="11" dominant-baseline="central">' + r.treatment.slice(0, 28) + '</text>';
      const sig = (r.pool.ci_low > 0) || (r.pool.ci_high < 0);
      const color = sig ? '#7dd3fc' : '#94a3b8';
      svg += '<line x1="' + x(r.pool.ci_low) + '" x2="' + x(r.pool.ci_high) + '" y1="' + y + '" y2="' + y + '" stroke="' + color + '" stroke-width="1.5" />';
      const px = x(r.pool.md);
      const sz = Math.min(8, Math.max(4, Math.sqrt(r.pool.k) * 2.5));
      svg += '<rect x="' + (px - sz) + '" y="' + (y - sz) + '" width="' + (sz*2) + '" height="' + (sz*2) + '" transform="rotate(45 ' + px + ' ' + y + ')" fill="' + color + '" stroke="#0b1220" stroke-width="1" />';
      svg += '<text x="' + (W - margin.r + 8) + '" y="' + y + '" fill="' + color + '" font-size="10.5" font-family="JetBrains Mono,monospace" dominant-baseline="central">'
           + P.fmt(r.pool.md, 2) + ' [' + P.fmt(r.pool.ci_low, 2) + '–' + P.fmt(r.pool.ci_high, 2) + '], k=' + r.pool.k + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const cfg = getNMACfg();
    if (!cfg || !cfg.treatments || cfg.treatments.length < 2) return false;
    const rd = P.getRealData();
    if (!rd) return false;

    const treatments = cfg.treatments;
    const reference = pickReference(cfg, treatments);
    const others = treatments.filter(t => t !== reference);
    const rows = [];

    others.forEach(T => {
      const points = [];
      const comparisons = cfg.comparisons || [];
      comparisons.forEach(c => {
        if ((c.t1 === T && c.t2 === reference) || (c.t1 === reference && c.t2 === T)) {
          (c.trials || []).forEach(nctRef => {
            const t = (typeof nctRef === 'string' && rd[nctRef]) ? rd[nctRef] : nctRef;
            if (!t) return;
            const cont = pickContinuous(t);
            if (!cont) return;
            const flip = (c.t1 === reference);
            const yi = flip ? -cont.md : cont.md;
            points.push({ yi, vi: cont.se * cont.se });
          });
        }
      });
      if (points.length === 0) return;
      const pool = poolDLRE(points);
      if (!pool) return;
      rows.push({ treatment: T, pool });
    });

    if (rows.length === 0) return false;
    rows.sort((a, b) => a.pool.md - b.pool.md);

    const svg = buildSVG(P, rows, reference);
    const sigCount = rows.filter(r => (r.pool.ci_low > 0) || (r.pool.ci_high < 0)).length;
    const summary = rows.length + ' direct continuous comparisons vs ' + reference + ' · ' + sigCount + ' sig at 95%';

    const note = '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
               + 'Continuous-outcome analogue of NMA Forest. Pooled mean difference (DL random effects) '
               + 'per direct comparison vs <strong>' + reference + '</strong>. '
               + 'Diamond size ∝ √k. Cyan when 95% CI excludes MD=0. '
               + '<strong>Limitation:</strong> each comparison vs reference is pooled <em>univariately</em>; multi-arm trials with shared control are <em>not</em> adjusted for the off-diagonal covariance τ²/2 (advanced-stats.md). '
               + 'For trials with arms A, B, C vs D, treat the three pairwise (A−D, B−D, C−D) estimates as if independent — an over-confidence bias of unknown magnitude. '
               + 'For publication-grade NMA, use <code>netmeta</code> (R) or <code>BUGSnet</code> with proper shared-control covariance. '
               + 'Cochrane Handbook v6.5 §10.5; sensitivity only for indirect estimates.'
               + '</div>';

    const panel = P.buildCollapsiblePanel({
      id: 'nma-forest-continuous-panel',
      badge: 'NMA Forest (cont)',
      summary,
      bodyHtml: svg + note,
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('nma-forest-continuous-panel');
    if (existing) existing.replaceWith(panel);
    else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => {
      if (render()) return;
      if (++tries < 20) setTimeout(tick, 250);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1150));
    } else {
      setTimeout(tick, 1150);
    }
  }

  global.NMAForestContinuous = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
