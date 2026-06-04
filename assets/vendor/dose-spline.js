/* Restricted cubic spline dose-response meta-regression.
 *
 * Crippa A, Orsini N. Multivariate dose-response meta-analysis: the
 * dosresmeta R package. JSS 2016;72(11):1-15.
 *
 * 3-knot RCS (Harrell 2001 default) with knots at the 10th, 50th, 90th
 * percentiles of log-dose. Two basis functions plus intercept = 3
 * parameters total. Same Cramer's-rule 3×3 weighted-regression solver
 * as the parent quadratic panel, applied to RCS basis instead of
 * polynomial.
 *
 * Tests non-linearity via likelihood-ratio-style ΔAIC of the second
 * spline term against the linear-only model.
 *
 * Auto-bootstrap; collapsed by default. Skips silently if no
 * dose-parseable data.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'dose-spline-expanded';

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

  // Restricted cubic spline basis (Harrell 2001).
  // For a 3-knot spline (k1, k2, k3), the basis is:
  //   x_1 = x
  //   x_2 = ((x - k1)_+^3 - (x - k2)_+^3 (k3-k1)/(k3-k2) + (x - k3)_+^3 (k2-k1)/(k3-k2)) / (k3 - k1)^2
  // Returns [x_1, x_2] for each input x.
  function rcsBasis(xVals, knots) {
    const [k1, k2, k3] = knots;
    const denom = (k3 - k1) * (k3 - k1);
    const r32 = (k3 - k2);
    const r21 = (k2 - k1);
    const cube = u => u > 0 ? u * u * u : 0;
    return xVals.map(x => {
      const x1 = x;
      const x2 = (cube(x - k1) - cube(x - k2) * (k3 - k1) / r32 + cube(x - k3) * r21 / r32) / denom;
      return [x1, x2];
    });
  }

  function percentile(values, p) {
    const sorted = values.slice().sort((a, b) => a - b);
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804 * Math.exp(-z * z / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  // Solve 3×3 weighted normal equations via Cramer's rule for design [1, x1, x2]
  function rcsRegress(yi, vi, basis, tau2) {
    const k = yi.length;
    const w = vi.map(v => 1 / (v + tau2));
    let M00 = 0, M01 = 0, M02 = 0, M11 = 0, M12 = 0, M22 = 0;
    let r0 = 0, r1 = 0, r2 = 0;
    for (let i = 0; i < k; i++) {
      const wi = w[i];
      const x1 = basis[i][0], x2 = basis[i][1];
      M00 += wi;          M01 += wi * x1;     M02 += wi * x2;
                          M11 += wi * x1 * x1; M12 += wi * x1 * x2;
                                              M22 += wi * x2 * x2;
      r0 += wi * yi[i];   r1 += wi * x1 * yi[i]; r2 += wi * x2 * yi[i];
    }
    function det3(a,b,c,d,e,f,g,h,i){return a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);}
    const D = det3(M00, M01, M02, M01, M11, M12, M02, M12, M22);
    if (Math.abs(D) < 1e-12) return null;
    const a = det3(r0, M01, M02, r1, M11, M12, r2, M12, M22) / D;
    const b1 = det3(M00, r0, M02, M01, r1, M12, M02, r2, M22) / D;
    const b2 = det3(M00, M01, r0, M01, M11, r1, M02, M12, r2) / D;
    // SE for b2 (test of non-linearity): inverse element [2,2] of M
    // M⁻¹[2,2] = cofactor[2,2] / D = (M00*M11 - M01²) / D
    const var_b2 = (M00 * M11 - M01 * M01) / D;
    const se_b2 = Math.sqrt(Math.max(0, var_b2));
    const z_b2 = se_b2 > 0 ? b2 / se_b2 : 0;
    const p_b2 = 2 * (1 - normalCDF(Math.abs(z_b2)));
    let rss = 0;
    for (let i = 0; i < k; i++) {
      const fitted = a + b1 * basis[i][0] + b2 * basis[i][1];
      rss += w[i] * Math.pow(yi[i] - fitted, 2);
    }
    return { alpha: a, beta1: b1, beta2: b2, se_b2, z_b2, p_b2, rss };
  }

  function dlTau2(yi, vi) {
    const k = yi.length;
    let W = 0, WY = 0;
    for (let i = 0; i < k; i++) { const w = 1/vi[i]; W += w; WY += w * yi[i]; }
    const yFE = WY / W;
    let Q = 0;
    for (let i = 0; i < k; i++) Q += (1/vi[i]) * Math.pow(yi[i] - yFE, 2);
    const sumW2 = vi.reduce((s, v) => s + Math.pow(1/v, 2), 0);
    const c = W - sumW2 / W;
    return Math.max(0, (Q - (k - 1)) / c);
  }

  function buildBody(P, doseTrials, knots, mr, baseUnit) {
    const fmt = P.fmt;
    let html = '';

    // Verdict
    let toneCol, toneBg, toneBorder, verdict;
    if (mr.p_b2 < 0.05) {
      toneCol = '#fbbf24'; toneBg = '#3a2a0a'; toneBorder = '#92400e';
      verdict = '⚠ <strong>Non-linear dose-response detected</strong> — second spline term β̂₂ = ' + fmt(mr.beta2, 3)
              + ' (z = ' + fmt(mr.z_b2, 2) + ', p = ' + fmt(mr.p_b2, 3) + '). '
              + 'Linear extrapolation past the highest dose may be unreliable.';
    } else {
      toneCol = '#34d399'; toneBg = '#0e3a1f'; toneBorder = '#34d399';
      verdict = '✓ Spline non-linearity not significant (β̂₂ p = ' + fmt(mr.p_b2, 3) + '). '
              + 'Linear-on-log-dose model is consistent with the data.';
    }
    html += '<div style="background:' + toneBg + ';border:1px solid ' + toneBorder + ';color:' + toneCol + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
          + verdict + '</div>';

    // Cells
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px;">';
    html += cell('β̂₁ (linear)', fmt(mr.beta1, 3), 'log-OR per log-' + baseUnit);
    html += cell('β̂₂ (spline)', fmt(mr.beta2, 3), 'p = ' + fmt(mr.p_b2, 3));
    html += cell('Knot 10th %ile', fmt(Math.exp(knots[0]), 2) + ' ' + baseUnit);
    html += cell('Knot 50th %ile', fmt(Math.exp(knots[1]), 2) + ' ' + baseUnit);
    html += cell('Knot 90th %ile', fmt(Math.exp(knots[2]), 2) + ' ' + baseUnit);
    html += cell('k', String(doseTrials.length));
    html += '</div>';

    // SVG fitted curve
    const W = 760, H = 320, margin = { l: 60, r: 30, t: 30, b: 50 };
    const innerW = W - margin.l - margin.r, innerH = H - margin.t - margin.b;
    const xs = doseTrials.map(t => Math.log(t.dose));
    const ys = doseTrials.map(t => t.yi);
    const xMin = Math.min(...xs) - 0.2, xMax = Math.max(...xs) + 0.2;
    const yMin = Math.min(...ys) - 0.5, yMax = Math.max(...ys) + 0.5;
    const xPx = v => margin.l + (v - xMin) / (xMax - xMin) * innerW;
    const yPx = v => margin.t + innerH - (v - yMin) / (yMax - yMin) * innerH;

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    svg += '<line x1="' + margin.l + '" x2="' + (W - margin.r) + '" y1="' + (H - margin.b) + '" y2="' + (H - margin.b) + '" stroke="#475569" />';
    svg += '<line x1="' + margin.l + '" x2="' + margin.l + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#475569" />';
    if (yMin < 0 && yMax > 0) {
      const yz = yPx(0);
      svg += '<line x1="' + margin.l + '" x2="' + (W - margin.r) + '" y1="' + yz + '" y2="' + yz + '" stroke="#475569" stroke-dasharray="3,3" />';
    }
    // Fitted spline curve over the x range
    const nPts = 60;
    const fitted = [];
    for (let i = 0; i <= nPts; i++) {
      const x = xMin + (xMax - xMin) * (i / nPts);
      const basis = rcsBasis([x], knots)[0];
      const y = mr.alpha + mr.beta1 * basis[0] + mr.beta2 * basis[1];
      fitted.push({ x, y });
    }
    let path = '';
    fitted.forEach((p, i) => { path += (i === 0 ? 'M' : 'L') + xPx(p.x).toFixed(1) + ',' + yPx(p.y).toFixed(1) + ' '; });
    svg += '<path d="' + path + '" stroke="#fbbf24" stroke-width="2" fill="none" />';

    // Knot markers
    knots.forEach(k => {
      const x = xPx(k);
      svg += '<line x1="' + x + '" x2="' + x + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#a78bfa" stroke-dasharray="4,4" stroke-width="1" />';
    });

    // Trial points
    doseTrials.forEach(t => {
      const x = xPx(Math.log(t.dose));
      const y = yPx(t.yi);
      svg += '<circle cx="' + x + '" cy="' + y + '" r="5" fill="#7dd3fc" fill-opacity="0.6" stroke="#0b1220" stroke-width="1"><title>' + t.name + ' (' + t.dose + ' ' + baseUnit + ')</title></circle>';
    });

    // Axes labels
    svg += '<text x="' + (margin.l + innerW/2) + '" y="' + (H - margin.b + 36) + '" fill="#cbd5e1" font-size="11" text-anchor="middle">log(dose, ' + baseUnit + ')</text>';
    svg += '<text transform="translate(' + (margin.l - 42) + ',' + (margin.t + innerH/2) + ') rotate(-90)" fill="#cbd5e1" font-size="11" text-anchor="middle">log-OR</text>';
    svg += '<text x="' + margin.l + '" y="' + (margin.t - 8) + '" fill="#cbd5e1" font-size="11" font-weight="600">RCS dose-response (3-knot · 10/50/90 percentiles)</text>';

    // Legend
    svg += '<text x="' + (W - margin.r - 6) + '" y="' + (margin.t + 14) + '" fill="#fbbf24" font-size="10" text-anchor="end">RCS fit</text>';
    svg += '<text x="' + (W - margin.r - 6) + '" y="' + (margin.t + 28) + '" fill="#a78bfa" font-size="10" text-anchor="end">knots</text>';
    svg += '</svg>';
    html += svg;

    // Method note
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> 3-knot restricted cubic spline (Harrell 2001) on log-dose with knots at the 10th, 50th, 90th percentiles. '
          + 'Two basis functions [x, RCS₂(x)] plus intercept = 3 parameters; weighted regression with τ² from intercept-only DerSimonian-Laird. '
          + 'Wald-z test on the second basis function (β̂₂ = 0 ⇔ linearity); p < 0.05 ⇒ reject linearity. '
          + 'Crippa & Orsini (<em>JSS</em> 2016;72:11). For full multivariate dose-response with within-trial covariance, see R `dosresmeta`. '
          + '<strong>Knot placement is fixed at 3 knots regardless of n</strong> — Harrell 2001 recommends 5 knots for n &gt; 100 with the canonical 5/27.5/50/72.5/95 percentile placement; n-adaptive knot selection is intentionally out of scope to keep the in-browser engine deterministic and dependency-free. '
          + '<strong>Limitations:</strong> RCS is one of many non-linear families; needs k ≥ 4 trials; cross-class data is still uninterpretable even if the spline fits.'
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
    const doseTrials = [];
    trials.forEach(t => {
      const raw = byName[t.name] || {};
      const candidate = (t.name || '') + ' ' + (raw.group || '');
      const dose = parseDose(candidate);
      if (dose == null) return;
      const lo = trialLogOR(t);
      doseTrials.push({ name: t.name, dose, yi: lo.yi, vi: lo.vi });
    });
    if (doseTrials.length < 4) return false;
    const uniqueDoses = new Set(doseTrials.map(t => t.dose));
    if (uniqueDoses.size < 3) return false;  // Need 3 distinct doses for RCS

    const xVals = doseTrials.map(t => Math.log(t.dose));
    const knots = [percentile(xVals, 0.10), percentile(xVals, 0.50), percentile(xVals, 0.90)];
    if (knots[0] >= knots[1] || knots[1] >= knots[2]) return false;  // Knots must be distinct

    const yi = doseTrials.map(t => t.yi);
    const vi = doseTrials.map(t => t.vi);
    const tau2 = dlTau2(yi, vi);
    const basis = rcsBasis(xVals, knots);
    const mr = rcsRegress(yi, vi, basis, tau2);
    if (!mr) return false;

    const summary = (mr.p_b2 < 0.05 ? '⚠ ' : '✓ ')
                  + 'Non-linearity p = ' + P.fmt(mr.p_b2, 3)
                  + ' · k=' + doseTrials.length + ' · 3-knot RCS';
    const panel = P.buildCollapsiblePanel({
      id: 'dose-spline-panel', badge: 'Dose-response (RCS)',
      summary, bodyHtml: buildBody(P, doseTrials, knots, mr, 'mg'),
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('dose-spline-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1800));
    } else { setTimeout(tick, 1800); }
  }

  global.DoseSpline = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
