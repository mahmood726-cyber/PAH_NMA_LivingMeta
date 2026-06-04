/* Baujat plot — per-trial diagnostics for meta-analysis (Baujat et al. 2002).
 *
 * X axis: contribution to overall heterogeneity Q
 * Y axis: influence on pooled effect (squared standardised difference between
 *         the pooled estimate with and without the trial)
 *
 * Trials in upper-right are simultaneously contributing to heterogeneity
 * AND driving the effect — outlier candidates.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'baujat-plot-expanded';

  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d };
  }

  function compute(P, trials) {
    if (trials.length < 3) return null;
    const points = trials.map(trialLogOR);
    // Fixed-effect pool of all
    let W = 0, WY = 0;
    points.forEach(p => { const w = 1/p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    const seFE = Math.sqrt(1/W);
    // Per-trial diagnostics
    const out = [];
    points.forEach((p, i) => {
      // Contribution to Q: w_i * (y_i - y_FE)²
      const w = 1/p.vi;
      const qContrib = w * Math.pow(p.yi - yFE, 2);
      // Influence: re-pool excluding this trial, compute (yFE - yFE_minus_i)² / (Var(yFE) + Var(yFE_minus_i))
      const subset = points.filter((_, j) => j !== i);
      let W_ = 0, WY_ = 0;
      subset.forEach(q => { const ww = 1/q.vi; W_ += ww; WY_ += ww * q.yi; });
      const yFE_minus = WY_ / W_;
      const seFE_minus = Math.sqrt(1/W_);
      const denom = seFE * seFE + seFE_minus * seFE_minus;
      const influence = denom > 0 ? Math.pow(yFE - yFE_minus, 2) / denom : 0;
      out.push({ name: trials[i].name, qContrib, influence, OR: Math.exp(p.yi) });
    });
    return out;
  }

  function buildSVG(rows) {
    const W = 720, H = 380, margin = { l: 60, r: 30, t: 30, b: 50 };
    const innerW = W - margin.l - margin.r, innerH = H - margin.t - margin.b;

    const xMax = Math.max(...rows.map(r => r.qContrib), 1);
    const yMax = Math.max(...rows.map(r => r.influence), 0.01);

    const x = v => margin.l + (v / xMax) * innerW;
    const y = v => margin.t + innerH - (v / yMax) * innerH;

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    // Axes
    svg += '<line x1="' + margin.l + '" x2="' + (W - margin.r) + '" y1="' + (H - margin.b) + '" y2="' + (H - margin.b) + '" stroke="#475569" />';
    svg += '<line x1="' + margin.l + '" x2="' + margin.l + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#475569" />';
    // Axis labels
    svg += '<text x="' + (margin.l + innerW / 2) + '" y="' + (H - margin.b + 36) + '" fill="#cbd5e1" font-size="11" text-anchor="middle">Contribution to heterogeneity Q (w·(yᵢ−ȳ)²)</text>';
    svg += '<text transform="translate(' + (margin.l - 42) + ',' + (margin.t + innerH / 2) + ') rotate(-90)" fill="#cbd5e1" font-size="11" text-anchor="middle">Influence on pooled estimate</text>';
    // Tick marks (rough)
    [0.25, 0.5, 0.75, 1.0].forEach(f => {
      const tx = margin.l + f * innerW;
      const ty = margin.t + (1 - f) * innerH;
      svg += '<line x1="' + tx + '" x2="' + tx + '" y1="' + (H - margin.b) + '" y2="' + (H - margin.b + 4) + '" stroke="#94a3b8" />';
      svg += '<text x="' + tx + '" y="' + (H - margin.b + 16) + '" fill="#94a3b8" font-size="9.5" text-anchor="middle">' + (f * xMax).toFixed(2) + '</text>';
      svg += '<line x1="' + (margin.l - 4) + '" x2="' + margin.l + '" y1="' + ty + '" y2="' + ty + '" stroke="#94a3b8" />';
      svg += '<text x="' + (margin.l - 8) + '" y="' + ty + '" fill="#94a3b8" font-size="9.5" text-anchor="end" dominant-baseline="central">' + (f * yMax).toFixed(2) + '</text>';
    });

    // Quadrant markers (median split)
    const xMed = xMax / 2, yMed = yMax / 2;
    svg += '<line x1="' + x(xMed) + '" x2="' + x(xMed) + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#1e293b" stroke-dasharray="2,3" />';
    svg += '<line x1="' + margin.l + '" x2="' + (W - margin.r) + '" y1="' + y(yMed) + '" y2="' + y(yMed) + '" stroke="#1e293b" stroke-dasharray="2,3" />';

    // Points
    rows.forEach(r => {
      const px = x(r.qContrib), py = y(r.influence);
      const outlier = r.qContrib > xMed && r.influence > yMed;
      const color = outlier ? '#fbbf24' : '#7dd3fc';
      svg += '<circle cx="' + px + '" cy="' + py + '" r="5" fill="' + color + '" stroke="#0b1220" stroke-width="1.5"><title>' + r.name + ' — Q-contrib=' + r.qContrib.toFixed(2) + ' influence=' + r.influence.toFixed(3) + '</title></circle>';
      // Label nearby, only for outliers and top-3
      const labelMe = outlier || r.qContrib > 0.6 * xMax;
      if (labelMe) {
        svg += '<text x="' + (px + 8) + '" y="' + (py - 6) + '" fill="#f1f5f9" font-size="10" font-weight="600">' + r.name.slice(0, 22) + '</text>';
      }
    });

    // Header
    svg += '<text x="' + margin.l + '" y="18" fill="#cbd5e1" font-size="11" font-weight="600">Baujat (2002) — outliers in upper-right</text>';
    svg += '</svg>';
    return svg;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 4) return false;

    const rows = compute(P, trials);
    if (!rows) return false;

    // Identify "outlier candidates" — top quadrant
    const xMax = Math.max(...rows.map(r => r.qContrib), 1);
    const yMax = Math.max(...rows.map(r => r.influence), 0.01);
    const outliers = rows.filter(r => r.qContrib > xMax / 2 && r.influence > yMax / 2);

    const umbrella = P.isNMA && P.isNMA() ? ' [umbrella]' : '';
    const summary = (outliers.length > 0
      ? '⚠ outlier candidate' + (outliers.length > 1 ? 's' : '') + ': ' + outliers.map(o => o.name).slice(0, 3).join(', ') + ' · k=' + trials.length
      : '✓ no outliers — diagnostic clean across k=' + trials.length) + umbrella;

    const svg = buildSVG(rows);
    const note = '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
               + 'X = contribution to overall Q; Y = influence on pooled estimate (squared standardised difference of pooled '
               + 'log-OR with vs without the trial). Trials in the upper-right quadrant simultaneously add heterogeneity '
               + 'AND drive the effect — investigate before pooling. Baujat B et al. <em>Stat Med</em> 2002;21(18):2641–52.'
               + '</div>';

    const panel = P.buildCollapsiblePanel({
      id: 'baujat-plot-panel',
      badge: 'Baujat',
      summary,
      bodyHtml: svg + note,
      storageKey: STORAGE_KEY,
    });

    const existing = document.getElementById('baujat-plot-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 500));
    } else {
      setTimeout(tick, 500);
    }
  }

  global.BaujatPlot = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
