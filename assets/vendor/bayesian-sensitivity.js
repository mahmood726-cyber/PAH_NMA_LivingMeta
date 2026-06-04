/* Bayesian sensitivity panel — weakly-informative pairwise meta-analysis.
 *
 * Grid integration over (μ, τ²) on log-OR scale with:
 *   - Flat (improper N(0, 1e6)) prior on μ
 *   - Half-Cauchy(scale = 1) prior on τ  (Gelman 2006; widely accepted)
 * Likelihood: per-trial yi ~ N(μ, vi + τ²)
 *
 * 200 × 200 grid (Cochrane Bayesian gotcha threshold per advanced-stats.md).
 * Reports: posterior median + 95% credible interval for OR; posterior
 * predictive 95% interval (PI).
 *
 * Bayesian as SENSITIVITY ONLY — never replaces frequentist primary.
 * Always shown side-by-side with the existing R metafor result.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'bayesian-sensitivity-expanded';

  // Grid configuration
  const N_MU = 201, N_TAU = 201;
  const MU_MIN = -5, MU_MAX = 5;       // log-OR range
  const TAU_MIN = 0, TAU_MAX = 2;       // τ range (NB: τ not τ²)

  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d };
  }

  function logHalfCauchyPdf(x, scale) {
    if (x < 0) return -Infinity;
    return Math.log(2 / Math.PI) - Math.log(scale) - Math.log(1 + (x/scale)*(x/scale));
  }

  // Compute log posterior (up to constant) on the (μ, τ) grid
  function computePosterior(points) {
    const muStep = (MU_MAX - MU_MIN) / (N_MU - 1);
    const tauStep = (TAU_MAX - TAU_MIN) / (N_TAU - 1);
    const logPost = new Float64Array(N_MU * N_TAU);
    let maxLP = -Infinity;
    for (let i = 0; i < N_MU; i++) {
      const mu = MU_MIN + i * muStep;
      for (let j = 0; j < N_TAU; j++) {
        const tau = TAU_MIN + j * tauStep;
        const tau2 = tau * tau;
        // Prior: flat on μ + half-Cauchy(1) on τ
        let lp = logHalfCauchyPdf(tau, 1.0);
        // Likelihood
        for (let k = 0; k < points.length; k++) {
          const v = points[k].vi + tau2;
          const diff = points[k].yi - mu;
          lp += -0.5 * Math.log(2 * Math.PI * v) - 0.5 * (diff * diff) / v;
        }
        logPost[i * N_TAU + j] = lp;
        if (lp > maxLP) maxLP = lp;
      }
    }
    // Normalise to get posterior probability per cell
    let total = 0;
    const post = new Float64Array(N_MU * N_TAU);
    for (let i = 0; i < N_MU * N_TAU; i++) {
      const v = Math.exp(logPost[i] - maxLP);
      post[i] = v;
      total += v;
    }
    if (total <= 0 || !isFinite(total)) return null;
    for (let i = 0; i < N_MU * N_TAU; i++) post[i] /= total;
    return { post, muStep, tauStep };
  }

  function marginalMu(post) {
    const arr = new Float64Array(N_MU);
    for (let i = 0; i < N_MU; i++) {
      let s = 0;
      for (let j = 0; j < N_TAU; j++) s += post[i * N_TAU + j];
      arr[i] = s;
    }
    return arr;
  }

  function marginalTau(post) {
    const arr = new Float64Array(N_TAU);
    for (let j = 0; j < N_TAU; j++) {
      let s = 0;
      for (let i = 0; i < N_MU; i++) s += post[i * N_TAU + j];
      arr[j] = s;
    }
    return arr;
  }

  function muValue(i) { return MU_MIN + i * (MU_MAX - MU_MIN) / (N_MU - 1); }
  function tauValue(j) { return TAU_MIN + j * (TAU_MAX - TAU_MIN) / (N_TAU - 1); }

  function quantileFromMarginal(marg, valFn, q) {
    let cum = 0;
    for (let i = 0; i < marg.length; i++) {
      cum += marg[i];
      if (cum >= q) {
        // Linear interp between i-1 and i
        if (i === 0) return valFn(0);
        const prev = cum - marg[i];
        const frac = (q - prev) / (marg[i] || 1e-12);
        return valFn(i - 1) + frac * (valFn(i) - valFn(i - 1));
      }
    }
    return valFn(marg.length - 1);
  }

  // Posterior predictive: integrate over (μ, τ) using grid; for each
  // posterior cell, compute predictive density at sample points.
  // Approximation: take posterior median of μ and median of τ, then
  // PI = μ ± 1.96 × τ.  This matches Cochrane v6.5 t_{k-1} convention
  // closely when posterior is roughly normal and τ small.
  // For full posterior predictive, sum-mixture of normals with different τ.
  function posteriorPredictive(post) {
    // For PI: Pr(y_new ≤ y) = Σ_{i,j} p(μ_i, τ_j) × Φ((y - μ_i)/τ_j)
    // Use bisection on y.
    function cdfAt(y) {
      let cum = 0;
      for (let i = 0; i < N_MU; i++) {
        const mu = muValue(i);
        for (let j = 0; j < N_TAU; j++) {
          const tau = tauValue(j);
          const t = tau < 1e-6 ? 1e-6 : tau;
          const z = (y - mu) / t;
          // Approx normal CDF
          cum += post[i * N_TAU + j] * normalCDF(z);
        }
      }
      return cum;
    }
    function quantile(q) {
      let lo = -10, hi = 10;
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) / 2;
        if (cdfAt(mid) < q) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    return { lo: quantile(0.025), hi: quantile(0.975), median: quantile(0.5) };
  }

  function normalCDF(z) {
    // Abramowitz & Stegun 7.1.26 approximation
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804 * Math.exp(-z * z / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    p = z > 0 ? 1 - p : p;
    return p;
  }

  function compute(P, trials) {
    if (!trials || trials.length < 2) return null;
    const points = trials.map(trialLogOR);
    const r = computePosterior(points);
    if (!r) return null;
    const muMarg = marginalMu(r.post);
    const tauMarg = marginalTau(r.post);
    const muMed = quantileFromMarginal(muMarg, muValue, 0.5);
    const muLo = quantileFromMarginal(muMarg, muValue, 0.025);
    const muHi = quantileFromMarginal(muMarg, muValue, 0.975);
    const tauMed = quantileFromMarginal(tauMarg, tauValue, 0.5);
    const tauLo = quantileFromMarginal(tauMarg, tauValue, 0.025);
    const tauHi = quantileFromMarginal(tauMarg, tauValue, 0.975);
    const pp = posteriorPredictive(r.post);
    return {
      muMed, muLo, muHi,
      OR: Math.exp(muMed),
      ci_low: Math.exp(muLo),
      ci_high: Math.exp(muHi),
      tauMed, tauLo, tauHi,
      tau2_med: tauMed * tauMed,
      PI_low: Math.exp(pp.lo),
      PI_high: Math.exp(pp.hi),
      k: trials.length,
    };
  }

  function buildBody(P, b, freqPool) {
    const fmt = P.fmt;
    let html = '';

    // Comparison headline
    if (freqPool && b) {
      const delta = Math.abs(b.OR - freqPool.OR);
      const deltaPct = 100 * delta / freqPool.OR;
      const tone = deltaPct < 5 ? '#34d399' : (deltaPct < 15 ? '#fbbf24' : '#fca5a5');
      const toneBg = deltaPct < 5 ? '#0e3a1f' : (deltaPct < 15 ? '#3a2a0a' : '#3a0a0a');
      const toneBorder = deltaPct < 5 ? '#34d399' : (deltaPct < 15 ? '#92400e' : '#7f1d1d');
      const verdict = deltaPct < 5 ? '✓ posterior agrees with frequentist'
                  : (deltaPct < 15 ? '⚠ modest disagreement' : '⚠ substantial disagreement');
      html += '<div style="background:' + toneBg + ';border:1px solid ' + toneBorder + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
            + verdict + ' — Bayesian OR ' + fmt(b.OR, 2) + ' [' + fmt(b.ci_low, 2) + '–' + fmt(b.ci_high, 2) + '] '
            + 'vs frequentist ' + fmt(freqPool.OR, 2) + ' [' + fmt(freqPool.ci_low, 2) + '–' + fmt(freqPool.ci_high, 2) + '] · |Δ| = ' + fmt(deltaPct, 1) + '%'
            + '</div>';
    }

    // Side-by-side cells
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px;">';
    html += cell('Posterior OR', fmt(b.OR, 2), '95% CrI ' + fmt(b.ci_low, 2) + '–' + fmt(b.ci_high, 2));
    html += cell('τ (between-study SD)', fmt(b.tauMed, 3), '95% CrI ' + fmt(b.tauLo, 3) + '–' + fmt(b.tauHi, 3));
    html += cell('τ² (variance)', fmt(b.tau2_med, 4));
    html += cell('Predictive 95% PI', fmt(b.PI_low, 2) + '–' + fmt(b.PI_high, 2), 'posterior-predictive');
    html += cell('Trials (k)', String(b.k));
    html += '</div>';

    // Method note
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Model:</strong> y<sub>i</sub> | μ, τ ~ N(μ, v<sub>i</sub> + τ²). '
          + '<strong>Priors:</strong> flat on μ; half-Cauchy(scale=1) on τ (Gelman 2006). '
          + '<strong>Inference:</strong> 201×201 grid integration over (μ, τ); reported quantities are posterior median + central 95% credible interval. '
          + 'Posterior predictive 95% PI from full mixture-of-normals over the joint posterior.<br>'
          + '<strong>Status:</strong> sensitivity analysis only — does not replace the primary frequentist DerSimonian–Laird + HKSJ + Cochrane v6.5 PI(t<sub>k−1</sub>) result. '
          + 'Disagreement (|Δ| ≥ 15%) is a flag for further investigation, not for switching the headline estimate.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 2) return false;
    const b = compute(P, trials);
    if (!b) return false;
    const freqPool = P.poolRandomLogOR(trials);

    const summary = 'OR ' + P.fmt(b.OR, 2) + ' [' + P.fmt(b.ci_low, 2) + '–' + P.fmt(b.ci_high, 2) + '] · τ ' + P.fmt(b.tauMed, 2) + ' · k=' + b.k + ' · sensitivity vs frequentist';

    const panel = P.buildCollapsiblePanel({
      id: 'bayesian-sensitivity-panel',
      badge: 'Bayesian',
      summary,
      bodyHtml: buildBody(P, b, freqPool),
      storageKey: STORAGE_KEY,
    });

    const existing = document.getElementById('bayesian-sensitivity-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 750));
    } else {
      setTimeout(tick, 750);
    }
  }

  global.BayesianSensitivity = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
