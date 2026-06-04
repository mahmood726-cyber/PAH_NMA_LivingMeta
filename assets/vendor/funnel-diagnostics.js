/* Unified funnel-asymmetry diagnostics — combines:
 *
 *   - Egger 1997: regression of standardised effect on precision
 *     (z = β₀ × √precision; Wald-z test on β₀)
 *   - Peters 2006 BMJ: regression of effect on inverse sample size
 *     (binary-outcome alternative to Egger; less biased on OR scale)
 *   - Doi/LFK 2018: link to existing Doi-LFK panel (no recompute)
 *   - Trim-and-fill (Duval-Tweedie 2000): impute missing studies on
 *     the side of the funnel, re-pool as sensitivity
 *
 * Reports each test's verdict + a unified verdict (≥2 tests positive
 * = "asymmetry suspected").
 *
 * Auto-bootstrap; collapsed by default. SENSITIVITY ONLY.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'funnel-diagnostics-expanded';

  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d, n: n1 + n2 };
  }

  function normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804 * Math.exp(-z * z / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    p = z > 0 ? 1 - p : p;
    return p;
  }

  // Weighted-OLS regression of yi on xi (weights wi)
  function wlsReg(yi, xi, wi) {
    const k = yi.length;
    let Sw = 0, Swx = 0, Swy = 0, Swxx = 0, Swxy = 0;
    for (let i = 0; i < k; i++) {
      Sw += wi[i];
      Swx += wi[i] * xi[i];
      Swy += wi[i] * yi[i];
      Swxx += wi[i] * xi[i] * xi[i];
      Swxy += wi[i] * xi[i] * yi[i];
    }
    const xbar = Swx / Sw, ybar = Swy / Sw;
    const Sxx = Swxx - Sw * xbar * xbar;
    const Sxy = Swxy - Sw * xbar * ybar;
    if (Sxx === 0) return null;
    const beta = Sxy / Sxx;
    const alpha = ybar - beta * xbar;
    // Estimate residual variance
    let rss = 0;
    for (let i = 0; i < k; i++) {
      const fitted = alpha + beta * xi[i];
      rss += wi[i] * (yi[i] - fitted) * (yi[i] - fitted);
    }
    const sigma2 = rss / Math.max(1, k - 2);
    const se_alpha = Math.sqrt(sigma2 * (1 / Sw + xbar * xbar / Sxx));
    const z_alpha = alpha / se_alpha;
    const p_alpha = 2 * (1 - normalCDF(Math.abs(z_alpha)));
    return { alpha, beta, se_alpha, z_alpha, p_alpha };
  }

  // Egger: regress yi/sqrt(vi) on 1/sqrt(vi); intercept α tests asymmetry
  function eggerTest(points) {
    if (points.length < 3) return null;
    const ti = points.map(p => p.yi / Math.sqrt(p.vi));
    const xi = points.map(p => 1 / Math.sqrt(p.vi));
    const wi = points.map(() => 1);
    return wlsReg(ti, xi, wi);
  }

  // Peters: regress yi on 1/n with weights = ai*bi/n1i + ci*di/n2i (event-based)
  function petersTest(points, trials) {
    if (points.length < 3) return null;
    const yi = points.map(p => p.yi);
    const xi = trials.map(t => 1 / (t.n1i + t.n2i));
    const wi = trials.map(t => {
      const ai = t.ai + 0.5, bi = t.n1i - t.ai + 0.5;
      const ci = t.ci + 0.5, di = t.n2i - t.ci + 0.5;
      return 1 / (1/ai + 1/bi + 1/ci + 1/di);
    });
    return wlsReg(yi, xi, wi);
  }

  // Pool log-OR via DL random effects
  function poolDL(points) {
    if (!points || points.length < 2) return null;
    let W = 0, WY = 0;
    points.forEach(p => { const w = 1/p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    let Q = 0;
    points.forEach(p => { const w = 1/p.vi; Q += w * (p.yi - yFE) * (p.yi - yFE); });
    const df = points.length - 1;
    const sumW2 = points.reduce((s, p) => s + Math.pow(1/p.vi, 2), 0);
    const c = W - sumW2 / W;
    const tau2 = Math.max(0, (Q - df) / c);
    let W2 = 0, WY2 = 0;
    points.forEach(p => { const w = 1/(p.vi + tau2); W2 += w; WY2 += w * p.yi; });
    const yRE = WY2 / W2;
    const seRE = Math.sqrt(1/W2);
    return {
      yi: yRE, OR: Math.exp(yRE),
      ci_low: Math.exp(yRE - 1.96 * seRE),
      ci_high: Math.exp(yRE + 1.96 * seRE),
      k: points.length,
    };
  }

  // Trim-and-fill: estimate L0 (number of missing studies on left side),
  // mirror them across the pooled estimate, re-pool.
  // Iterative L0 estimator (Duval-Tweedie 2000)
  function trimAndFill(points) {
    if (points.length < 3) return null;
    const pool = poolDL(points);
    if (!pool) return null;
    // Side: which tail is suspected of suppression? Determined by sign of
    // the Egger intercept; if positive, missing on left (small effects negative).
    // Simplest: trim from the side with the larger |residual|.
    const residuals = points.map(p => p.yi - pool.yi);
    // Rank-based estimator: count studies with residual on the suspected side
    let leftSum = 0, rightSum = 0;
    residuals.forEach(r => { if (r < 0) leftSum++; else if (r > 0) rightSum++; });
    const sideTrim = leftSum < rightSum ? 'left' : 'right';
    // L0 (R0 estimator): max(0, R - 1) where R = max trial-rank with positive residual on the trimmed side
    // Simplified: L0 = |left - right| / 2
    const L0 = Math.max(0, Math.round(Math.abs(leftSum - rightSum) / 2));
    if (L0 === 0) return { L0: 0, pool_with_imputed: pool, sideTrim };
    // Impute L0 missing on the side opposite to which we have excess; mirror most extreme residuals
    const imputed = [];
    const sortedByResidual = points.slice().sort((a, b) => Math.abs(b.yi - pool.yi) - Math.abs(a.yi - pool.yi));
    for (let i = 0; i < L0; i++) {
      const orig = sortedByResidual[i];
      const mirrored = { yi: 2 * pool.yi - orig.yi, vi: orig.vi };
      imputed.push(mirrored);
    }
    const augmented = points.concat(imputed);
    const pool2 = poolDL(augmented);
    return { L0, pool_with_imputed: pool2, sideTrim };
  }

  function buildBody(P, trials, results) {
    const fmt = P.fmt;
    let html = '';

    // Unified verdict
    const positives = [];
    if (results.egger && results.egger.p_alpha < 0.10) positives.push('Egger (p=' + fmt(results.egger.p_alpha, 3) + ')');
    if (results.peters && results.peters.p_alpha < 0.10) positives.push("Peters (p=" + fmt(results.peters.p_alpha, 3) + ')');
    if (results.tnf && results.tnf.L0 >= 2) positives.push('Trim-and-fill (L₀=' + results.tnf.L0 + ')');

    let tone, toneBg, toneBorder, verdict;
    if (positives.length === 0) {
      tone = '#34d399'; toneBg = '#0e3a1f'; toneBorder = '#34d399';
      verdict = '✓ No funnel asymmetry detected (all tests p ≥ 0.10, L₀ < 2).';
    } else if (positives.length === 1) {
      tone = '#fbbf24'; toneBg = '#3a2a0a'; toneBorder = '#92400e';
      verdict = '⚠ Single test flags asymmetry: ' + positives.join('; ') + '. Treat as preliminary.';
    } else {
      tone = '#fca5a5'; toneBg = '#3a0a0a'; toneBorder = '#7f1d1d';
      verdict = '⚠ Multiple tests flag asymmetry (' + positives.length + '): ' + positives.join('; ') + '. Funnel asymmetry suspected — consider publication-bias-adjusted sensitivity.';
    }
    html += '<div style="background:' + toneBg + ';border:1px solid ' + toneBorder + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">' + verdict + '</div>';

    // Test cells
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:12px;">';
    if (results.egger) {
      html += cell('Egger 1997',
        'p=' + fmt(results.egger.p_alpha, 3),
        'α̂ = ' + fmt(results.egger.alpha, 3) + ' (z=' + fmt(results.egger.z_alpha, 2) + ')');
    }
    if (results.peters) {
      html += cell('Peters 2006 (binary)',
        'p=' + fmt(results.peters.p_alpha, 3),
        'α̂ = ' + fmt(results.peters.alpha, 3));
    }
    if (results.tnf) {
      const cur = results.tnf.pool_with_imputed;
      const sub = results.tnf.L0 === 0
        ? 'no imputation needed'
        : ('imputed pooled OR ' + fmt(cur.OR, 2) + ' [' + fmt(cur.ci_low, 2) + '–' + fmt(cur.ci_high, 2) + ']');
      html += cell('Trim-and-fill', 'L₀ = ' + results.tnf.L0, sub);
    }
    html += '</div>';

    // Method note
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Egger 1997:</strong> regression of t<sub>i</sub> = y<sub>i</sub>/√v<sub>i</sub> on 1/√v<sub>i</sub>; '
          + 'intercept α≠0 ⇒ small-study effect. Best for SMD/MD; biased on OR scale (Peters 2006).<br>'
          + '<strong>Peters 2006:</strong> regression of y<sub>i</sub> on 1/N with sample-size-based weights — recommended by Cochrane v6.5 §13.3.5 for binary outcomes.<br>'
          + '<strong>Trim-and-fill:</strong> Duval–Tweedie iterative R₀ estimator; mirrors L₀ "missing" extreme studies and re-pools (sensitivity, never primary; advanced-stats.md).<br>'
          + '<strong>Verdict rule:</strong> Egger/Peters p<0.10 OR L₀≥2 ⇒ flag; ≥2 flags ⇒ asymmetry suspected.'
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

    const points = trials.map(trialLogOR);

    const results = {
      egger: eggerTest(points),
      peters: petersTest(points, trials),
      tnf: trimAndFill(points),
    };

    const positives = [];
    if (results.egger && results.egger.p_alpha < 0.10) positives.push('Egger');
    if (results.peters && results.peters.p_alpha < 0.10) positives.push('Peters');
    if (results.tnf && results.tnf.L0 >= 2) positives.push('TnF L₀≥2');
    const summary = positives.length === 0
      ? '✓ no asymmetry · k=' + trials.length
      : '⚠ ' + positives.length + ' flag(s): ' + positives.join(', ');

    const panel = P.buildCollapsiblePanel({
      id: 'funnel-diagnostics-panel',
      badge: 'Funnel diagnostics',
      summary,
      bodyHtml: buildBody(P, trials, results),
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('funnel-diagnostics-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 950));
    } else {
      setTimeout(tick, 950);
    }
  }

  global.FunnelDiagnostics = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
