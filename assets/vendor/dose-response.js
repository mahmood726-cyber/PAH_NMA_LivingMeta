/* Dose-response meta-regression panel.
 *
 * For reviews where trial arms encode a numeric dose (e.g. "Empagliflozin
 * 10 mg", "Tofacitinib 5 mg BID", "Avacincaptad 2 mg"), fits a one-stage
 * mixed-effects meta-regression of log-OR on log-dose:
 *
 *   y_i  = β₀ + β₁·log(dose_i) + ε_i,    ε_i ~ N(0, v_i + τ²)
 *
 * Weights: w_i = 1/(v_i + τ²). τ² from intercept-only DerSimonian-Laird.
 *
 * Reports:
 *   - β̂ (dose-response slope on log-OR per log-dose unit)
 *   - SE(β̂) with Knapp-Hartung small-sample correction, t_{k-2} test, p-value, 95% CI
 *   - Pseudo-R² = 1 − τ²_residual / τ²_total
 *   - Bubble plot SVG (x = log-dose, y = log-OR, bubble area ∝ w_i)
 *
 * Self-skips silently when fewer than 3 trials carry parseable doses.
 *
 * Methodology grounded in:
 *   Greenland & Longnecker. Methods for trend estimation from summarized
 *     dose-response data. Am J Epidemiol 1992;135(11):1301-9.
 *   Crippa A, Orsini N. Multivariate dose-response meta-analysis: the
 *     dosresmeta R package. JSS 2016;72(11):1-15.
 *   Cochrane Handbook v6.5 §10.4.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'dose-response-expanded';

  // Match a numeric dose followed by a recognised unit anywhere in the string.
  // Handles: "10 mg", "10mg", "0.5 mg", "200 µg", "200 mcg", "1 g".
  // Returns dose in milligrams (canonical scale).
  function parseDose(text) {
    if (!text) return null;
    const re = /(\d+(?:\.\d+)?)\s*(mg|μg|µg|mcg|g)\b/i;
    const m = text.match(re);
    if (!m) return null;
    let v = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === 'g') v *= 1000;
    else if (unit === 'μg' || unit === 'µg' || unit === 'mcg') v /= 1000;
    return v > 0 ? v : null;
  }

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

  // Student-t CDF via the regularised incomplete beta — vendored verbatim from the
  // R-validated allmeta/shared/dta-bivariate.js (used there for Deeks' test). Used
  // for the dose-response slope's small-sample (Knapp-Hartung) t_{k-2} test.
  function _lnGamma(x) { var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 1.208650973866179e-3, -5.395239384953e-6]; var y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); var s = 1.000000000190015; for (var j = 0; j < 6; j++) { y++; s += c[j] / y; } return -t + Math.log(2.5066282746310005 * s / x); }
  function _betacf(a, b, x) { var F = 1e-300, c = 1, d = 1 - (a + b) * x / (a + 1); if (Math.abs(d) < F) d = F; d = 1 / d; var h = d; for (var m = 1; m <= 300; m++) { var m2 = 2 * m, aa = m * (b - m) * x / ((a - 1 + m2) * (a + m2)); d = 1 + aa * d; if (Math.abs(d) < F) d = F; c = 1 + aa / c; if (Math.abs(c) < F) c = F; d = 1 / d; h *= d * c; aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + 1 + m2)); d = 1 + aa * d; if (Math.abs(d) < F) d = F; c = 1 + aa / c; if (Math.abs(c) < F) c = F; d = 1 / d; var del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; } return h; }
  function _betai(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; var bt = Math.exp(_lnGamma(a + b) - _lnGamma(a) - _lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * _betacf(a, b, x) / a : 1 - bt * _betacf(b, a, 1 - x) / b; }
  function _tcdf(t, df) { var x = df / (df + t * t), ib = 0.5 * _betai(df / 2, 0.5, x); return t >= 0 ? 1 - ib : ib; }
  // t_{0.975,df} critical value by bisection on _tcdf (exact, no lookup table).
  function _tCrit975(df) {
    if (!(df > 0)) return 1.959963984540054;
    var lo = 0, hi = 1000;
    for (var i = 0; i < 200; i++) { var m = 0.5 * (lo + hi); if (_tcdf(m, df) < 0.975) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
  }

  function metaReg(yi, vi, x) {
    const k = yi.length;
    if (k < 3) return null;
    // Step 1: intercept-only DL τ²
    let W0 = 0, WY0 = 0;
    for (let i = 0; i < k; i++) { const w = 1 / vi[i]; W0 += w; WY0 += w * yi[i]; }
    const yFE = WY0 / W0;
    let Q0 = 0;
    for (let i = 0; i < k; i++) Q0 += (1 / vi[i]) * Math.pow(yi[i] - yFE, 2);
    const sumW2 = vi.reduce((s, v) => s + Math.pow(1/v, 2), 0);
    const c0 = W0 - sumW2 / W0;
    const tau2_total = Math.max(0, (Q0 - (k - 1)) / c0);

    // Step 2: weighted regression on the (μ, dose) plane
    const w = vi.map(v => 1 / (v + tau2_total));
    let Sw = 0, Swx = 0, Swy = 0, Swxx = 0, Swxy = 0;
    for (let i = 0; i < k; i++) {
      Sw += w[i];
      Swx += w[i] * x[i];
      Swy += w[i] * yi[i];
      Swxx += w[i] * x[i] * x[i];
      Swxy += w[i] * x[i] * yi[i];
    }
    const xbar = Swx / Sw, ybar = Swy / Sw;
    const Sxx = Swxx - Sw * xbar * xbar;
    const Sxy = Swxy - Sw * xbar * ybar;
    if (Sxx === 0) return null;
    const beta = Sxy / Sxx;
    const alpha = ybar - beta * xbar;
    const se_beta_model = Math.sqrt(1 / Sxx);

    // Knapp-Hartung small-sample correction for meta-regression (metafor
    // rma(..., test="knha")): scale the slope SE by s = sqrt(weighted-RSS/(k−2))
    // and test against t_{k−2}, NOT z. A z-test on a handful of dose-points is
    // anticonservative — the same small-k issue corrected across the kit's pools.
    const dfReg = k - 2;
    let qStar = 0;   // Σ w_i (y_i − fitted_i)² over the RE-weighted residuals
    for (let i = 0; i < k; i++) {
      const fitted = alpha + beta * x[i];
      qStar += w[i] * Math.pow(yi[i] - fitted, 2);
    }
    const s2 = dfReg > 0 ? qStar / dfReg : 1;
    const se_beta = se_beta_model * Math.sqrt(Math.max(1, s2));  // HKSJ floor at 1
    const t = beta / se_beta;
    const p = dfReg > 0 ? 2 * (1 - _tcdf(Math.abs(t), dfReg)) : 1;
    const tc = _tCrit975(dfReg);
    const beta_ci_lo = beta - tc * se_beta, beta_ci_hi = beta + tc * se_beta;

    // Residual τ² (DL, for pseudo-R²) using the model-based weights' RSS.
    let rss = 0;
    for (let i = 0; i < k; i++) {
      const fitted = alpha + beta * x[i];
      rss += (1 / vi[i]) * Math.pow(yi[i] - fitted, 2);
    }
    const c_after = Sw - sumW2 / Sw;
    const tau2_resid = Math.max(0, (rss - (k - 2)) / c_after);
    const pseudoR2 = tau2_total > 0 ? Math.max(0, 1 - tau2_resid / tau2_total) : 0;

    return { alpha, beta, se_beta, t, z: t, p, df: dfReg, beta_ci_lo, beta_ci_hi,
             k, tau2_total, tau2_resid, pseudoR2,
             xbar, ybar, Sxx, weights: w, xbar_orig: xbar };
  }

  // Quadratic dose-response: log-OR ~ β₀ + β₁·log(dose) + β₂·log(dose)²
  // Solves the 3×3 weighted normal equations directly. Returns AIC vs linear.
  function metaRegQuadratic(yi, vi, x, tau2_total) {
    const k = yi.length;
    if (k < 4) return null;
    const w = vi.map(v => 1 / (v + tau2_total));
    // Design: rows are [1, x, x²]
    let M00 = 0, M01 = 0, M02 = 0, M11 = 0, M12 = 0, M22 = 0;
    let r0 = 0, r1 = 0, r2 = 0;
    for (let i = 0; i < k; i++) {
      const wi = w[i], xi = x[i], xi2 = xi * xi;
      M00 += wi;          M01 += wi * xi;     M02 += wi * xi2;
                          M11 += wi * xi2;    M12 += wi * xi2 * xi;
                                              M22 += wi * xi2 * xi2;
      r0 += wi * yi[i];   r1 += wi * yi[i] * xi;   r2 += wi * yi[i] * xi2;
    }
    // Solve symmetric 3×3 via Cramer's rule
    function det3(a,b,c,d,e,f,g,h,i){return a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);}
    const D = det3(M00, M01, M02, M01, M11, M12, M02, M12, M22);
    if (Math.abs(D) < 1e-12) return null;
    const a = det3(r0,  M01, M02, r1,  M11, M12, r2,  M12, M22) / D;
    const b1 = det3(M00, r0,  M02, M01, r1,  M12, M02, r2,  M22) / D;
    const b2 = det3(M00, M01, r0,  M01, M11, r1,  M02, M12, r2)  / D;
    // Residual SS for AIC
    let rss = 0;
    for (let i = 0; i < k; i++) {
      const fitted = a + b1 * x[i] + b2 * x[i] * x[i];
      rss += w[i] * Math.pow(yi[i] - fitted, 2);
    }
    const dfQuad = k - 3;
    // We deliberately do NOT compute a quadratic τ²_resid here: the proper
    // estimator requires tr(M⁻¹·X^T W² X) which is heavy in pure JS. The
    // AIC verdict (in render()) is the published preference test.
    return { alpha: a, beta1: b1, beta2: b2, rss, dfQuad };
  }

  function buildBubble(P, mr, points, baseUnit) {
    const W = 760, H = 320, margin = { l: 60, r: 30, t: 30, b: 50 };
    const innerW = W - margin.l - margin.r, innerH = H - margin.t - margin.b;

    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const xMin = Math.min(...xs) - 0.2;
    const xMax = Math.max(...xs) + 0.2;
    const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.15 + 0.1;
    const yMin = Math.min(...ys, mr.alpha + mr.beta * xMin) - yPad;
    const yMax = Math.max(...ys, mr.alpha + mr.beta * xMax) + yPad;

    const x = v => margin.l + ((v - xMin) / (xMax - xMin)) * innerW;
    const y = v => margin.t + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    svg += '<line x1="' + margin.l + '" x2="' + (W - margin.r) + '" y1="' + (H - margin.b) + '" y2="' + (H - margin.b) + '" stroke="#475569" />';
    svg += '<line x1="' + margin.l + '" x2="' + margin.l + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#475569" />';

    // Null line at y=0 (log-OR)
    if (yMin < 0 && yMax > 0) {
      const yz = y(0);
      svg += '<line x1="' + margin.l + '" x2="' + (W - margin.r) + '" y1="' + yz + '" y2="' + yz + '" stroke="#475569" stroke-dasharray="3,3" />';
      svg += '<text x="' + (margin.l - 6) + '" y="' + yz + '" fill="#94a3b8" font-size="10" text-anchor="end" dominant-baseline="central">log-OR=0</text>';
    }

    // Regression line
    const x1 = xMin, x2 = xMax;
    const y1 = mr.alpha + mr.beta * x1, y2v = mr.alpha + mr.beta * x2;
    svg += '<line x1="' + x(x1) + '" y1="' + y(y1) + '" x2="' + x(x2) + '" y2="' + y(y2v) + '" stroke="#fbbf24" stroke-width="2" />';

    // Bubbles
    const wMax = Math.max(...mr.weights);
    points.forEach((pt, i) => {
      const r = 3 + 9 * Math.sqrt(mr.weights[i] / wMax);
      svg += '<circle cx="' + x(pt.x) + '" cy="' + y(pt.y) + '" r="' + r + '" fill="#7dd3fc" fill-opacity="0.55" stroke="#0b1220" stroke-width="1"><title>' + pt.name + ' (' + pt.dose + ' ' + baseUnit + '): logOR=' + pt.y.toFixed(3) + '</title></circle>';
    });

    // Axis labels
    svg += '<text x="' + (margin.l + innerW / 2) + '" y="' + (H - margin.b + 36) + '" fill="#cbd5e1" font-size="11" text-anchor="middle">log(dose, ' + baseUnit + ')</text>';
    svg += '<text transform="translate(' + (margin.l - 42) + ',' + (margin.t + innerH / 2) + ') rotate(-90)" fill="#cbd5e1" font-size="11" text-anchor="middle">log-OR</text>';

    // X tick labels: show as actual doses (not logs)
    [xMin, (xMin + xMax) / 2, xMax].forEach(xv => {
      const dose = Math.exp(xv);
      const display = dose < 1 ? dose.toFixed(2) : dose < 10 ? dose.toFixed(1) : dose.toFixed(0);
      svg += '<text x="' + x(xv) + '" y="' + (H - margin.b + 14) + '" fill="#94a3b8" font-size="10" text-anchor="middle">' + display + '</text>';
    });

    // Header
    svg += '<text x="' + margin.l + '" y="' + (margin.t - 8) + '" fill="#cbd5e1" font-size="11" font-weight="600">Dose-response meta-regression</text>';

    svg += '</svg>';
    return svg;
  }

  function buildBody(P, doseTrials, mr, baseUnit) {
    const fmt = P.fmt;
    let html = '';

    // Headline verdict
    const slopePerDoubling = mr.beta * Math.log(2); // log-OR change per doubling of dose
    const orPerDoubling = Math.exp(slopePerDoubling);
    let toneCol, toneBg, toneBorder, verdict;
    if (mr._crossClass) {
      // Cross-class guard: mg not on a common scale across distinct drugs;
      // do not present the slope as a clinical dose-response. Show as
      // exploratory scatter only.
      toneCol = '#fbbf24'; toneBg = '#3a2a0a'; toneBorder = '#92400e';
      verdict = '⚠ <strong>Cross-class scatter — not a clinical dose-response.</strong> Trials span ' + (mr._drugStems || []).slice(0, 4).join(' / ')
              + ' (' + (mr._drugStems || []).length + ' distinct drug stems). Milligram doses across heterogeneous mechanisms / molecular weights are not commensurable; '
              + 'a regression slope on log-mg is uninterpretable as a true dose-response. '
              + 'Greenland & Longnecker 1992 assumes a single agent; for a true multi-drug dose-response see component / dose-equivalence analyses.';
    } else if (mr.p < 0.05) {
      toneCol = '#fbbf24'; toneBg = '#3a2a0a'; toneBorder = '#92400e';
      verdict = '⚠ Significant dose-response slope (β̂ = ' + fmt(mr.beta, 3)
              + ' log-OR per log-' + baseUnit + ', p = ' + fmt(mr.p, 3)
              + '). Each doubling of dose changes pooled OR by × ' + fmt(orPerDoubling, 2) + '.';
    } else {
      toneCol = '#34d399'; toneBg = '#0e3a1f'; toneBorder = '#34d399';
      verdict = '✓ No significant dose-response (p = ' + fmt(mr.p, 3) + '). Pseudo-R² = ' + fmt(mr.pseudoR2 * 100, 1) + '%.';
    }
    html += '<div style="background:' + toneBg + ';border:1px solid ' + toneBorder + ';color:' + toneCol + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">' + verdict + '</div>';

    // Cells
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px;">';
    html += cell('β̂ (slope)', fmt(mr.beta, 3),
      (mr.beta_ci_lo != null ? '95% CI ' + fmt(mr.beta_ci_lo, 3) + ' to ' + fmt(mr.beta_ci_hi, 3) : 'log-OR per log-' + baseUnit));
    html += cell('SE(β̂)', fmt(mr.se_beta, 3), 'Knapp-Hartung');
    html += cell('t (df=' + (mr.df != null ? mr.df : '?') + ')', fmt(mr.t, 2), 'p = ' + fmt(mr.p, 3) + ' · t-test');
    html += cell('Pseudo-R²', fmt(mr.pseudoR2 * 100, 1) + '%', '1 − τ²_resid / τ²_total');
    html += cell('Trials with parsed dose', String(mr.k));
    html += cell('OR per doubling', fmt(orPerDoubling, 2));
    html += '</div>';

    // Quadratic-vs-linear preference flag
    if (mr.prefer_quadratic) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-size:11px;">'
            + '⚠ Quadratic fit favoured over linear by ΔAIC = ' + fmt(mr.quadratic_aic_diff, 1)
            + ' (β₁ = ' + fmt(mr.quadratic.beta1, 3) + ', β₂ = ' + fmt(mr.quadratic.beta2, 3)
            + '). A non-monotonic dose-response (e.g. inverted-U or threshold effect) may better fit the data than the linear model — '
            + 'consider restricted cubic splines via R `dosresmeta`.'
            + '</div>';
    }

    // Bubble plot
    const points = doseTrials.map(t => ({ x: Math.log(t.dose), y: t.yi, name: t.name, dose: t.dose }));
    html += buildBubble(P, mr, points, baseUnit);

    // Per-trial table
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:10px;margin-bottom:4px;">Per-trial parsed doses:</div>';
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;">Trial</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Dose (' + baseUnit + ')</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">log-OR</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">OR</th>'
          + '</tr></thead><tbody>';
    doseTrials.forEach(t => {
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + t.name + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(t.dose, t.dose < 1 ? 2 : (t.dose < 10 ? 1 : 0)) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(t.yi, 3) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(Math.exp(t.yi), 2) + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    // Method note
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> doses parsed from trial name/group field via regex (mg / µg / g). '
          + 'One-stage mixed-effects meta-regression on log-dose with weights w<sub>i</sub> = 1/(v<sub>i</sub> + τ²); '
          + 'τ² from DerSimonian–Laird intercept-only pool. Pseudo-R² per Raudenbush 2009. '
          + 'Linear log-dose model (Greenland-Longnecker 1992); non-linear / spline models out of scope here. '
          + 'Cochrane Handbook v6.5 §10.4. <strong>Cross-class detection:</strong> if ≥3 distinct drug stems are detected from group fields, '
          + 'the regression is tagged exploratory only — log-mg is not commensurable across mechanistically heterogeneous classes. '
          + '<strong>Quadratic vs linear:</strong> preference is reported via ΔAIC = RSS<sub>lin</sub> − RSS<sub>quad</sub> − 2 (one extra parameter); '
          + 'no τ²<sub>resid</sub> estimator is reported because the ad-hoc DL-univariate analogue does not generalize cleanly to a 3-parameter design (proper Raudenbush trace requires tr(M⁻¹·X<sup>T</sup>W²X), out of scope). '
          + '<strong>Limitations:</strong> requires ≥1 dose per trial parseable from the name; '
          + 'trials at the same dose share regression weight; bubble plot shows trial-level points, not within-trial dose-pairs.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 3) return false;

    // Map name -> raw realData entry to recover the group / drug-name fields
    const byName = {};
    Object.values(rd).forEach(t => { if (t && t.name) byName[t.name] = t; });

    // Parse a dose for each trial; abandon if too few trials carry one
    const doseTrials = [];
    trials.forEach(t => {
      const raw = byName[t.name] || {};
      const candidate = (t.name || '') + ' ' + (raw.group || '') + ' ' + (raw.snippet || '');
      const dose = parseDose(candidate);
      if (dose == null) return;
      const lo = (function () {
        let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
        if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
          ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
        }
        const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
        return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d };
      })();
      doseTrials.push({ name: t.name, dose, yi: lo.yi, vi: lo.vi });
    });

    if (doseTrials.length < 3) return false;
    // Need variation in dose, otherwise regression undefined
    const uniqueDoses = new Set(doseTrials.map(t => t.dose));
    if (uniqueDoses.size < 2) return false;

    // Drug-class detection: extract the first word of each trial's group
    // field as a drug-stem proxy. Used to gate cross-class regression
    // (Greenland-Longnecker 1992 assumes a single agent).
    //
    //  drugStems.size === 1 → single-drug multi-dose: full dose-response
    //                         is methodologically valid (gold standard)
    //  drugStems.size === 2 → mark as cautious (possible heterogeneity)
    //  drugStems.size  > 2 → cross-class scatter (mg not commensurable)
    const drugStems = new Set();
    doseTrials.forEach(t => {
      const raw = byName[t.name] || {};
      const g = (raw.group || '').toLowerCase();
      const stem = g.split(/\s|\/|,|-|\(|\+/)[0];
      if (stem && stem.length >= 4) drugStems.add(stem);
    });
    const crossClass = drugStems.size > 2;
    const singleDrug = drugStems.size === 1;
    const twoDrugCaution = drugStems.size === 2;

    const yi = doseTrials.map(t => t.yi);
    const vi = doseTrials.map(t => t.vi);
    const x = doseTrials.map(t => Math.log(t.dose));
    const mr = metaReg(yi, vi, x);
    if (!mr) return false;

    // Try quadratic; report whether it improves on linear
    const mrQ = metaRegQuadratic(yi, vi, x, mr.tau2_total);
    if (mrQ) {
      // RSS for linear at the same weights
      const wLin = vi.map(v => 1 / (v + mr.tau2_total));
      let rssLin = 0;
      for (let i = 0; i < doseTrials.length; i++) {
        const fitted = mr.alpha + mr.beta * x[i];
        rssLin += wLin[i] * Math.pow(yi[i] - fitted, 2);
      }
      // ΔAIC = AIC_lin − AIC_quad = (RSS_lin − RSS_quad) − 2  (under inverse-
      // variance weights, σ̂² is implicit at 1; +2 for the extra quadratic
      // parameter). Positive ⇒ quadratic preferred (lower AIC).
      const aicDiff = (rssLin - mrQ.rss) - 2;
      mr.quadratic = mrQ;
      mr.quadratic_aic_diff = aicDiff;
      mr.prefer_quadratic = aicDiff > 2;  // ΔAIC > 2 favours quadratic
    }

    const baseUnit = 'mg';
    const orPerDoubling = Math.exp(mr.beta * Math.log(2));
    const drugTag = crossClass ? ' · ⚠ cross-class (mg not commensurable)'
                  : twoDrugCaution ? ' · ⚠ two-drug pool'
                  : singleDrug ? ' · single-drug · ' + Array.from(drugStems)[0]
                  : '';
    const sig = mr.p < 0.05 && !crossClass;
    const summary = (sig ? '⚠ ' : '· ')
                  + (crossClass ? 'exploratory across-arm dose scatter'
                       : ('β̂ = ' + P.fmt(mr.beta, 3) + ' (p = ' + P.fmt(mr.p, 3) + ')'))
                  + ' · OR × ' + P.fmt(orPerDoubling, 2) + ' per doubling'
                  + ' · k=' + mr.k
                  + drugTag;
    mr._crossClass = crossClass;
    mr._twoDrugCaution = twoDrugCaution;
    mr._singleDrug = singleDrug;
    mr._drugStems = Array.from(drugStems);

    const panel = P.buildCollapsiblePanel({
      id: 'dose-response-panel',
      badge: 'Dose-response',
      summary,
      bodyHtml: buildBody(P, doseTrials, mr, baseUnit),
      storageKey: STORAGE_KEY,
    });

    const existing = document.getElementById('dose-response-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1250));
    } else {
      setTimeout(tick, 1250);
    }
  }

  // Extracted helper for testability (see tests/test_panel_improvements.mjs).
  // Mirrors the inline drug-stem detection in render().
  function detectDrugStems(groupFields) {
    const stems = new Set();
    (groupFields || []).forEach(g => {
      const s = (g || '').toLowerCase();
      const stem = s.split(/\s|\/|,|-|\(|\+/)[0];
      if (stem && stem.length >= 4) stems.add(stem);
    });
    return stems;
  }
  global.DoseResponse = { render, __test__: { detectDrugStems } };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
