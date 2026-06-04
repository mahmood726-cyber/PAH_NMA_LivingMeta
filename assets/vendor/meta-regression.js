/* Meta-regression panel — Cochrane Handbook v6.5 §10.11.4.
 *
 * Mixed-effects (REML-analog DL random) meta-regression of log-OR
 * against trial-level moderators:
 *   - Year of publication
 *   - Total sample size (log-N)
 *
 * Reports per moderator:
 *   - β̂ (slope on log-OR scale per unit covariate)
 *   - SE(β̂), z = β̂/SE, p-value
 *   - Pseudo-R² (proportion of τ² explained)
 *   - Bubble plot SVG
 *
 * Cochrane: "When ≥10 studies, meta-regression is recommended."
 * For k < 10 the panel still renders but flags low power.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'meta-regression-expanded';

  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d };
  }

  function normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804 * Math.exp(-z * z / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    p = z > 0 ? 1 - p : p;
    return p;
  }

  // Compute τ² from intercept-only DL pool, then weighted regression
  function metaReg(yi, vi, x) {
    const k = yi.length;
    if (k < 3) return null;
    // Step 1: intercept-only DL
    let W0 = 0, WY0 = 0;
    for (let i = 0; i < k; i++) { const w = 1 / vi[i]; W0 += w; WY0 += w * yi[i]; }
    const yFE = WY0 / W0;
    let Q0 = 0;
    for (let i = 0; i < k; i++) Q0 += (1 / vi[i]) * Math.pow(yi[i] - yFE, 2);
    const sumW2 = vi.reduce((s, v) => s + Math.pow(1/v, 2), 0);
    const c0 = W0 - sumW2 / W0;
    const tau2_total = Math.max(0, (Q0 - (k - 1)) / c0);

    // Step 2: weighted regression with weights = 1/(vi + tau2_total)
    const w = vi.map(v => 1 / (v + tau2_total));
    let Sw = 0, Swx = 0, Swy = 0, Swxx = 0, Swxy = 0;
    for (let i = 0; i < k; i++) {
      Sw += w[i];
      Swx += w[i] * x[i];
      Swy += w[i] * yi[i];
      Swxx += w[i] * x[i] * x[i];
      Swxy += w[i] * x[i] * yi[i];
    }
    const xbar = Swx / Sw;
    const ybar = Swy / Sw;
    const Sxx = Swxx - Sw * xbar * xbar;
    const Sxy = Swxy - Sw * xbar * ybar;
    if (Sxx === 0) return null;
    const beta = Sxy / Sxx;
    const alpha = ybar - beta * xbar;
    const se_beta = Math.sqrt(1 / Sxx);
    const z = beta / se_beta;
    const p = 2 * (1 - normalCDF(Math.abs(z)));

    // Step 3: residual τ² for pseudo-R²
    let rss = 0;
    for (let i = 0; i < k; i++) {
      const fitted = alpha + beta * x[i];
      rss += (1 / vi[i]) * Math.pow(yi[i] - fitted, 2);
    }
    const sumW2_after = vi.reduce((s, v) => s + Math.pow(1/v, 2), 0);
    const c_after = Sw - sumW2_after / Sw;
    const tau2_resid = Math.max(0, (rss - (k - 2)) / c_after);
    const pseudoR2 = tau2_total > 0 ? Math.max(0, 1 - tau2_resid / tau2_total) : 0;

    return { alpha, beta, se_beta, z, p, k, tau2_total, tau2_resid, pseudoR2,
             xbar, ybar, Sxx, weights: w };
  }

  function buildBubbleSVG(P, mr, xlabel, points) {
    const W = 720, H = 280, margin = { l: 50, r: 30, t: 20, b: 50 };
    const innerW = W - margin.l - margin.r, innerH = H - margin.t - margin.b;

    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys, mr.alpha + mr.beta * xMin);
    const yMax = Math.max(...ys, mr.alpha + mr.beta * xMax);
    const xPad = (xMax - xMin) * 0.05 + 0.001;
    const yPad = (yMax - yMin) * 0.1 + 0.1;

    const x = v => margin.l + ((v - (xMin - xPad)) / ((xMax + xPad) - (xMin - xPad))) * innerW;
    const y = v => margin.t + innerH - ((v - (yMin - yPad)) / ((yMax + yPad) - (yMin - yPad))) * innerH;

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    // Axes
    svg += '<line x1="' + margin.l + '" x2="' + (W - margin.r) + '" y1="' + (H - margin.b) + '" y2="' + (H - margin.b) + '" stroke="#475569" />';
    svg += '<line x1="' + margin.l + '" x2="' + margin.l + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#475569" />';
    // Null line at y=0 (log-OR)
    if (yMin < 0 && yMax > 0) {
      const yz = y(0);
      svg += '<line x1="' + margin.l + '" x2="' + (W - margin.r) + '" y1="' + yz + '" y2="' + yz + '" stroke="#475569" stroke-dasharray="3,3" />';
      svg += '<text x="' + (margin.l - 6) + '" y="' + yz + '" fill="#94a3b8" font-size="10" text-anchor="end" dominant-baseline="central">log-OR=0</text>';
    }

    // Regression line
    const x1 = xMin - xPad, x2 = xMax + xPad;
    const y1 = mr.alpha + mr.beta * x1, y2 = mr.alpha + mr.beta * x2;
    svg += '<line x1="' + x(x1) + '" y1="' + y(y1) + '" x2="' + x(x2) + '" y2="' + y(y2) + '" stroke="#fbbf24" stroke-width="2" />';

    // Bubbles
    const wMax = Math.max(...mr.weights);
    points.forEach((pt, i) => {
      const r = 3 + 8 * Math.sqrt(mr.weights[i] / wMax);
      svg += '<circle cx="' + x(pt.x) + '" cy="' + y(pt.y) + '" r="' + r + '" fill="#7dd3fc" fill-opacity="0.6" stroke="#0b1220" stroke-width="1"><title>' + pt.name + ': x=' + pt.x.toFixed(2) + ', logOR=' + pt.y.toFixed(3) + '</title></circle>';
    });

    // Axis labels
    svg += '<text x="' + (margin.l + innerW / 2) + '" y="' + (H - margin.b + 36) + '" fill="#cbd5e1" font-size="11" text-anchor="middle">' + xlabel + '</text>';
    svg += '<text transform="translate(' + (margin.l - 32) + ',' + (margin.t + innerH / 2) + ') rotate(-90)" fill="#cbd5e1" font-size="11" text-anchor="middle">log-OR</text>';

    // X tick labels
    [xMin, (xMin + xMax) / 2, xMax].forEach(xv => {
      svg += '<text x="' + x(xv) + '" y="' + (H - margin.b + 14) + '" fill="#94a3b8" font-size="10" text-anchor="middle">' + xv.toFixed(1) + '</text>';
    });

    svg += '</svg>';
    return svg;
  }

  function buildBody(P, models, k) {
    const fmt = P.fmt;
    let html = '';
    if (k < 10) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
            + '⚠ k=' + k + ' (<10) — meta-regression has limited power per Cochrane v6.5 §10.11.4. Treat as exploratory.'
            + '</div>';
    } else {
      const sig = models.find(m => m.mr && m.mr.p < 0.05);
      if (sig) {
        html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
              + '⚠ Significant moderator: <strong>' + sig.label + '</strong> — slope p=' + fmt(sig.mr.p, 3) + ', pseudo-R² = ' + fmt(sig.mr.pseudoR2 * 100, 1) + '%.'
              + '</div>';
      } else {
        html += '<div style="background:#0e3a1f;border:1px solid #34d399;color:#34d399;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
              + '✓ No moderator significantly explains heterogeneity (all p ≥ 0.05).'
              + '</div>';
      }
    }

    // Per-model table
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:14px;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;">Moderator</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">β̂ (slope)</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">SE</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">z</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">p</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">pseudo-R²</th>'
          + '</tr></thead><tbody>';
    models.forEach(m => {
      if (!m.mr) {
        html += '<tr><td style="padding:3px 6px;color:#cbd5e1;">' + m.label + '</td>'
              + '<td colspan="5" style="padding:3px 6px;text-align:right;color:#475569;">insufficient data</td></tr>';
        return;
      }
      const sig = m.mr.p < 0.05;
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + m.label + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:' + (sig ? '#7dd3fc' : '#cbd5e1') + ';">' + fmt(m.mr.beta, 3) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(m.mr.se_beta, 3) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(m.mr.z, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:' + (sig ? '#7dd3fc' : '#cbd5e1') + ';">' + fmt(m.mr.p, 3) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#94a3b8;">' + fmt(m.mr.pseudoR2 * 100, 1) + '%</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    // Bubble plots
    models.forEach(m => {
      if (!m.mr || !m.points) return;
      html += '<div style="margin-bottom:12px;">';
      html += '<div style="font-size:11px;color:#cbd5e1;margin-bottom:4px;font-weight:600;">' + m.label + ' bubble plot</div>';
      html += buildBubbleSVG(P, m.mr, m.label, m.points);
      html += '</div>';
    });

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> mixed-effects meta-regression with τ² from DerSimonian–Laird estimator; '
          + 'weights w<sub>i</sub> = 1/(v<sub>i</sub> + τ²); slope tested as Wald-z. '
          + 'Pseudo-R² = 1 − τ²<sub>residual</sub>/τ²<sub>total</sub> (Raudenbush 2009). '
          + 'Cochrane Handbook v6.5 §10.11.4. Bubble area ∝ regression weight (w<sub>i</sub>).'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 4) return false;

    const byName = {};
    Object.values(rd).forEach(t => { if (t && t.name) byName[t.name] = t; });
    trials.forEach(t => {
      const r = byName[t.name];
      t.year = r && r.year ? +r.year : null;
      t.totalN = (t.n1i || 0) + (t.n2i || 0);
    });

    const points = trials.map(trialLogOR);
    const yi = points.map(p => p.yi);
    const vi = points.map(p => p.vi);

    const models = [];

    // Year
    const haveYear = trials.filter(t => t.year);
    if (haveYear.length >= 4) {
      const subYi = haveYear.map((t, i) => points[trials.indexOf(t)].yi);
      const subVi = haveYear.map((t, i) => points[trials.indexOf(t)].vi);
      const x = haveYear.map(t => t.year);
      const mr = metaReg(subYi, subVi, x);
      models.push({
        label: 'Publication year',
        mr,
        points: haveYear.map((t, i) => ({ name: t.name, x: t.year, y: subYi[i] })),
      });
    }

    // log(N)
    const haveN = trials.filter(t => t.totalN > 0);
    if (haveN.length >= 4) {
      const subYi = haveN.map(t => points[trials.indexOf(t)].yi);
      const subVi = haveN.map(t => points[trials.indexOf(t)].vi);
      const x = haveN.map(t => Math.log(t.totalN));
      const mr = metaReg(subYi, subVi, x);
      models.push({
        label: 'log(total N)',
        mr,
        points: haveN.map((t, i) => ({ name: t.name, x: Math.log(t.totalN), y: subYi[i] })),
      });
    }

    if (models.length === 0) return false;

    const sigMods = models.filter(m => m.mr && m.mr.p < 0.05).map(m => m.label);
    const summary = sigMods.length > 0
      ? '⚠ significant moderator(s): ' + sigMods.join(', ')
      : '✓ no significant moderator (k=' + trials.length + ')';

    const panel = P.buildCollapsiblePanel({
      id: 'meta-regression-panel',
      badge: 'Meta-regression',
      summary,
      bodyHtml: buildBody(P, models, trials.length),
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('meta-regression-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 900));
    } else {
      setTimeout(tick, 900);
    }
  }

  global.MetaRegression = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
