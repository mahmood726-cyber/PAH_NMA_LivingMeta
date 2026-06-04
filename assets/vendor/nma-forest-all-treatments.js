/* NMA forest — all treatments vs the reference treatment, one panel.
 *
 * For each non-reference treatment T:
 *   - Pool trials directly comparing T vs reference (DL+RE)
 *   - Plot row: T name, k, pooled OR (95% CI)
 * Reference treatment is the protocol comparator (cfg.protocol.comp) when
 * present, else the most-frequent comparator in cfg.comparisons, else
 * "Placebo" if it's in treatments, else treatments[0].
 *
 * NMA-only — exits silently if window.NMA_CONFIG.treatments missing.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'nma-forest-all-treatments-expanded';

  function getNMACfg() {
    return global.NMA_CONFIG || null;
  }

  function trialLogOR(t) {
    let ai = +t.tE, ci = +t.cE, n1 = +t.tN, n2 = +t.cN;
    if (!isFinite(ai) || !isFinite(ci) || !isFinite(n1) || !isFinite(n2) || n1 <= 0 || n2 <= 0) return null;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d };
  }

  function poolDLRE(points) {
    if (!points || points.length === 0) return null;
    if (points.length === 1) {
      const p = points[0];
      return { logOR: p.yi, se: Math.sqrt(p.vi), OR: Math.exp(p.yi),
               ci_low: Math.exp(p.yi - 1.96 * Math.sqrt(p.vi)),
               ci_high: Math.exp(p.yi + 1.96 * Math.sqrt(p.vi)),
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
      logOR: yRE, se: seRE, OR: Math.exp(yRE),
      ci_low: Math.exp(yRE - 1.96 * seRE),
      ci_high: Math.exp(yRE + 1.96 * seRE),
      k: points.length, tau2,
    };
  }

  function pickReference(cfg, treatments) {
    if (cfg && cfg.protocol && cfg.protocol.comp) {
      const t = treatments.find(t => cfg.protocol.comp.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes('placebo') || t.toLowerCase().includes('control'));
      if (t) return t;
    }
    const placebo = treatments.find(t => t.toLowerCase().includes('placebo'));
    if (placebo) return placebo;
    const ctrl = treatments.find(t => t.toLowerCase().includes('control'));
    if (ctrl) return ctrl;
    // Most-frequent comparator
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

    const lows = rows.map(r => Math.log(r.pool.ci_low));
    const highs = rows.map(r => Math.log(r.pool.ci_high));
    let xMin = Math.min(...lows, Math.log(0.5));
    let xMax = Math.max(...highs, Math.log(2));
    const span = xMax - xMin;
    xMin -= span * 0.1; xMax += span * 0.1;

    const x = v => margin.l + ((v - xMin) / (xMax - xMin)) * innerW;
    const xZero = x(0);

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    // Null line
    if (xZero >= margin.l && xZero <= W - margin.r) {
      svg += '<line x1="' + xZero + '" x2="' + xZero + '" y1="' + margin.t + '" y2="' + xAxisY + '" stroke="#475569" stroke-dasharray="3,3" />';
    }
    // X axis ticks
    [0.25, 0.5, 1, 2, 4, 8].forEach(t => {
      const lx = Math.log(t);
      if (lx < xMin || lx > xMax) return;
      const px = x(lx);
      svg += '<line x1="' + px + '" x2="' + px + '" y1="' + (xAxisY - 4) + '" y2="' + (xAxisY + 4) + '" stroke="#94a3b8" />';
      svg += '<text x="' + px + '" y="' + (xAxisY + 14) + '" fill="#94a3b8" font-size="10" text-anchor="middle">' + t + '</text>';
    });
    svg += '<text x="' + ((margin.l + W - margin.r) / 2) + '" y="' + (xAxisY + 30) + '" fill="#cbd5e1" font-size="11" text-anchor="middle">OR vs ' + refLabel + ' (log scale)</text>';
    // Favours labels
    svg += '<text x="' + (xZero - 6) + '" y="' + (margin.t - 8) + '" fill="#7dd3fc" font-size="10" text-anchor="end" font-style="italic">← favours treatment</text>';
    svg += '<text x="' + (xZero + 6) + '" y="' + (margin.t - 8) + '" fill="#fbbf24" font-size="10" text-anchor="start" font-style="italic">favours ' + refLabel + ' →</text>';
    // Header
    svg += '<text x="6" y="' + (margin.t + 14) + '" fill="#94a3b8" font-size="10" font-weight="600">Treatment</text>';
    svg += '<text x="' + (W - margin.r + 8) + '" y="' + (margin.t + 14) + '" fill="#94a3b8" font-size="10" font-weight="600">OR (95% CI), k</text>';

    rows.forEach((r, i) => {
      const y = margin.t + 28 + rowH * i;
      // Treatment label
      svg += '<text x="6" y="' + y + '" fill="#cbd5e1" font-size="11" dominant-baseline="central">' + r.treatment.slice(0, 28) + '</text>';
      const sig = (r.pool.ci_low > 1) || (r.pool.ci_high < 1);
      const color = sig ? '#7dd3fc' : '#94a3b8';
      // CI line
      svg += '<line x1="' + x(Math.log(r.pool.ci_low)) + '" x2="' + x(Math.log(r.pool.ci_high)) + '" y1="' + y + '" y2="' + y + '" stroke="' + color + '" stroke-width="1.5" />';
      // Diamond
      const px = x(Math.log(r.pool.OR));
      const sz = Math.min(8, Math.max(4, Math.sqrt(r.pool.k) * 2.5));
      svg += '<rect x="' + (px - sz) + '" y="' + (y - sz) + '" width="' + (sz*2) + '" height="' + (sz*2) + '" transform="rotate(45 ' + px + ' ' + y + ')" fill="' + color + '" stroke="#0b1220" stroke-width="1" />';
      // Right label
      svg += '<text x="' + (W - margin.r + 8) + '" y="' + y + '" fill="' + color + '" font-size="10.5" font-family="JetBrains Mono,monospace" dominant-baseline="central">'
           + P.fmt(r.pool.OR, 2) + ' [' + P.fmt(r.pool.ci_low, 2) + '–' + P.fmt(r.pool.ci_high, 2) + '], k=' + r.pool.k + '</text>';
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
      // Find direct comparisons of T vs reference
      const points = [];
      const comparisons = cfg.comparisons || [];
      comparisons.forEach(c => {
        if ((c.t1 === T && c.t2 === reference) || (c.t1 === reference && c.t2 === T)) {
          (c.trials || []).forEach(nctRef => {
            const t = (typeof nctRef === 'string' && rd[nctRef]) ? rd[nctRef] : nctRef;
            if (!t) return;
            const flip = (c.t1 === reference);  // pool is t1 vs t2; flip when t1 is reference
            const lo = trialLogOR(t);
            if (!lo) return;
            if (flip) lo.yi = -lo.yi;
            points.push(lo);
          });
        }
      });
      if (points.length === 0) return;
      const pool = poolDLRE(points);
      if (!pool) return;
      rows.push({ treatment: T, pool });
    });

    if (rows.length === 0) return false;

    // Sort: by OR ascending (most beneficial first if OR<1 means benefit)
    rows.sort((a, b) => a.pool.OR - b.pool.OR);

    const svg = buildSVG(P, rows, reference);

    const sigCount = rows.filter(r => (r.pool.ci_low > 1) || (r.pool.ci_high < 1)).length;
    const summary = rows.length + ' direct comparisons vs ' + reference + ' · ' + sigCount + ' sig at 95%';

    const note = '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
               + 'One row per treatment with direct comparison to <strong>' + reference + '</strong>. '
               + 'Random-effects DL pool of direct trials only — for indirect/network estimates see consistency + contribution-matrix widgets. '
               + 'Diamond size ~ √(k trials). Coloured cyan when 95% CI excludes OR=1.'
               + '</div>';

    const panel = P.buildCollapsiblePanel({
      id: 'nma-forest-all-treatments-panel',
      badge: 'NMA Forest',
      summary,
      bodyHtml: svg + note,
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('nma-forest-all-treatments-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 650));
    } else {
      setTimeout(tick, 650);
    }
  }

  global.NMAForestAll = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
