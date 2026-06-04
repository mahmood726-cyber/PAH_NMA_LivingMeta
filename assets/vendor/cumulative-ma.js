/* Cumulative meta-analysis panel.
 * Sort trials by year, plot the running pooled OR (RE) as each trial enters.
 * Helps reveal when the evidence "settled" (point estimate stable, CI tightens).
 *
 * SVG forest-style; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'cumulative-ma-expanded';

  function buildSVG(P, points, fullPool) {
    const W = 720, H = 36 + 24 * points.length, margin = { l: 200, r: 30, t: 20, b: 30 };
    const xAxisY = H - margin.b;
    // Effect range: log scale OR
    const lows = points.map(p => Math.log(p.ci_low));
    const highs = points.map(p => Math.log(p.ci_high));
    let xMin = Math.min(...lows, Math.log(fullPool.ci_low));
    let xMax = Math.max(...highs, Math.log(fullPool.ci_high));
    // Pad
    const span = xMax - xMin;
    xMin -= span * 0.1; xMax += span * 0.1;

    const innerW = W - margin.l - margin.r;
    const x = v => margin.l + ((v - xMin) / (xMax - xMin)) * innerW;
    const xZero = x(0);

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    // Null line
    if (xZero >= margin.l && xZero <= W - margin.r) {
      svg += '<line x1="' + xZero + '" x2="' + xZero + '" y1="' + margin.t + '" y2="' + xAxisY + '" stroke="#475569" stroke-dasharray="3,3" />';
    }
    // X axis ticks at OR=0.25, 0.5, 1, 2, 4
    const ticks = [0.25, 0.5, 1, 2, 4];
    ticks.forEach(t => {
      const lx = Math.log(t);
      if (lx < xMin || lx > xMax) return;
      const px = x(lx);
      svg += '<line x1="' + px + '" x2="' + px + '" y1="' + (xAxisY - 4) + '" y2="' + (xAxisY + 4) + '" stroke="#94a3b8" />';
      svg += '<text x="' + px + '" y="' + (xAxisY + 14) + '" fill="#94a3b8" font-size="10" text-anchor="middle">' + t + '</text>';
    });
    svg += '<text x="' + ((margin.l + W - margin.r) / 2) + '" y="' + (xAxisY + 26) + '" fill="#cbd5e1" font-size="10.5" text-anchor="middle">Pooled OR (log scale)</text>';

    // Header
    svg += '<text x="6" y="14" fill="#94a3b8" font-size="10" font-weight="600">Through year</text>';
    svg += '<text x="' + (margin.l - 10) + '" y="14" fill="#94a3b8" font-size="10" text-anchor="end" font-weight="600">Pooled OR (95% CI), k</text>';

    points.forEach((p, i) => {
      const y = margin.t + 8 + 24 * i;
      // Year label
      svg += '<text x="6" y="' + y + '" fill="#cbd5e1" font-size="10.5" dominant-baseline="central">' + p.year + '</text>';
      // Pooled OR label
      svg += '<text x="' + (margin.l - 10) + '" y="' + y + '" fill="#7dd3fc" font-size="10.5" text-anchor="end" font-family="JetBrains Mono,monospace" dominant-baseline="central">'
           + P.fmt(p.OR, 2) + ' [' + P.fmt(p.ci_low, 2) + '–' + P.fmt(p.ci_high, 2) + '], k=' + p.k + '</text>';
      // CI line
      svg += '<line x1="' + x(Math.log(p.ci_low)) + '" x2="' + x(Math.log(p.ci_high)) + '" y1="' + y + '" y2="' + y + '" stroke="#7dd3fc" stroke-width="1.5" />';
      // Diamond at point estimate
      const px = x(Math.log(p.OR));
      svg += '<rect x="' + (px - 4) + '" y="' + (y - 4) + '" width="8" height="8" transform="rotate(45 ' + px + ' ' + y + ')" fill="#7dd3fc" stroke="#0b1220" stroke-width="1" />';
    });
    svg += '</svg>';
    return svg;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    let trials = P.extractBinaryTrials(rd);
    if (trials.length < 2) return false;
    // Need years; assign a virtual year if missing (use index)
    let hasYears = trials.every(t => t.year);
    if (!hasYears) {
      // Take year from realData entry directly
      Object.values(rd).forEach((entry, i) => {
        const t = trials.find(x => x.name === entry.name);
        if (t && entry.year) t.year = +entry.year;
      });
      hasYears = trials.every(t => t.year);
    }
    if (!hasYears) {
      // Fall back: just sequence them
      trials.forEach((t, i) => { t.year = 2000 + i; });
    }
    trials.sort((a, b) => a.year - b.year);

    // Cumulative pools
    const fullPool = P.poolRandomLogOR(trials);
    if (!fullPool) return false;
    const points = [];
    for (let i = 1; i < trials.length; i++) {
      const subset = trials.slice(0, i + 1);
      const pool = P.poolRandomLogOR(subset);
      if (!pool) continue;
      points.push({ year: trials[i].year, OR: pool.OR, ci_low: pool.ci_low, ci_high: pool.ci_high, k: pool.k });
    }

    // Detect when CI first excludes null (settled)
    let firstSig = null;
    for (let i = 0; i < points.length; i++) {
      if ((points[i].ci_low > 1) || (points[i].ci_high < 1)) { firstSig = points[i]; break; }
    }
    const umbrella = P.isNMA && P.isNMA() ? ' [umbrella]' : '';
    const summary = (firstSig
      ? 'evidence first significant at ' + firstSig.year + ' (k=' + firstSig.k + ') · ' + points.length + ' cumulative pools'
      : 'evidence not yet conclusive across ' + points.length + ' pools (CI still crosses null)') + umbrella;

    const svg = buildSVG(P, points, fullPool);
    const note = '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
               + 'Each row = pooled OR after that year\'s trial enters (DerSimonian–Laird random effects). '
               + 'Useful for spotting when the evidence "settled" — point estimate stops drifting and CI tightens. '
               + 'Lau et al. JAMA 1992; Cochrane Handbook v6.5 §10.10.5.'
               + '</div>';

    const panel = P.buildCollapsiblePanel({
      id: 'cumulative-ma-panel',
      badge: 'Cumulative MA',
      summary,
      bodyHtml: svg + note,
      storageKey: STORAGE_KEY,
    });

    const existing = document.getElementById('cumulative-ma-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 450));
    } else {
      setTimeout(tick, 450);
    }
  }

  global.CumulativeMA = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
