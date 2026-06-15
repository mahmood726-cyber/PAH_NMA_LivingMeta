/* shared/bma-tau.js — Bayesian Model Averaging across τ² priors.
 *
 * The choice of τ² prior is a known driver of posterior sensitivity in
 * small-k random-effects meta-analysis (Friede et al. 2017; Röver 2020).
 * Rather than commit to one prior, this module integrates the posterior
 * for the pooled effect μ over a model space M_1..M_K where each M_k
 * differs only in its τ² prior. The averaged posterior is
 *
 *     p(μ | data) = Σ_k w_k · p(μ | data, M_k)
 *
 * with weights w_k ∝ π(M_k) · p(data | M_k). We use uniform model priors
 * π(M_k) = 1/K and compute the marginal likelihood p(data | M_k) by
 * Simpson's-rule integration of the τ² grid 0..10·σ̂² (oracle from the
 * Higgins-Whitehead 2009 grid spacing).
 *
 * For each τ² on the grid the integrand is
 *     L(τ²) = ∫ p(data | μ, τ²) p(μ | τ²) dμ
 *           = (with a vague N(0, 10000) prior on μ — basically flat)
 *           ≈ p(data | μ̂(τ²), τ²) · √(2π · 1/Σ wᵢ(τ²))
 * — i.e. Laplace approximation around the conditional MLE of μ at that τ².
 *
 * Output: μ̂, posterior SE, 95 % CrI, model weights, plus the per-prior
 * τ² estimate. Use it as a sensitivity layer on top of any pooler.
 *
 * Reference: Friede T, Röver C, Wandel S, Neuenschwander B (2017),
 * "Meta-analysis of two studies in the presence of heterogeneity with
 * applications in rare diseases", Biom J 59(4):658-671.
 */
(function (global) {
  "use strict";

  // ----- τ² priors --------------------------------------------------------
  //
  // Each prior is a function p_tau(τ²) returning the prior density (NOT
  // log). For half-normal / half-Cauchy etc., we work on the τ scale
  // internally and convert via the Jacobian d/dτ²(τ) = 1/(2τ) → density on
  // τ² scale = density on τ scale × 1/(2τ).

  function halfNormal(sd) {
    return function (tau2) {
      if (tau2 < 0) return 0;
      var tau = Math.sqrt(tau2);
      if (tau === 0) return 0;
      var p_tau = Math.sqrt(2 / Math.PI) / sd * Math.exp(-tau * tau / (2 * sd * sd));
      return p_tau / (2 * tau);
    };
  }
  function halfCauchy(scale) {
    return function (tau2) {
      if (tau2 < 0) return 0;
      var tau = Math.sqrt(tau2);
      if (tau === 0) return 0;
      var p_tau = (2 / Math.PI / scale) / (1 + (tau / scale) * (tau / scale));
      return p_tau / (2 * tau);
    };
  }
  function invGamma(shape, scale) {
    // Inverse-gamma on τ², density at x = (β^α / Γ(α)) x^{-α-1} e^{-β/x}.
    var logBetaTerm = shape * Math.log(scale) - _lgamma(shape);
    return function (tau2) {
      if (tau2 <= 0) return 0;
      var logD = logBetaTerm + (-shape - 1) * Math.log(tau2) - scale / tau2;
      return Math.exp(logD);
    };
  }
  function uniform(upper) {
    return function (tau2) {
      if (tau2 < 0) return 0;
      var tau = Math.sqrt(tau2);
      // Same τ=0 guard as halfNormal/halfCauchy: the τ²-scale density has an
      // integrable 1/(2τ) singularity at τ=0; return 0 at that node (dropping a
      // single grid point is harmless on a fine grid). WITHOUT this guard the
      // Math.max(tau,1e-12) fallback returned ~5e10 at the τ²=0 node, which
      // dominated the marginal-likelihood integral and gave the uniform prior a
      // spuriously huge BMA weight (≈1), defeating the model averaging.
      if (tau === 0) return 0;
      if (tau > upper) return 0;
      // p_tau = 1/upper → p_{tau²} via Jacobian 1/(2τ)
      return (1 / upper) / (2 * tau);
    };
  }
  function _lgamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, t = x + 5.5;
    t -= (x + 0.5) * Math.log(t);
    var ser = 1.000000000190015;
    for (var j = 0; j < 6; j++) { y += 1; ser += c[j] / y; }
    return -t + Math.log(2.5066282746310005 * ser / x);
  }

  // ----- Conditional posterior for μ given τ² ---------------------------
  //
  // For each τ², the conditional posterior of μ (flat prior limit) is
  // N(μ̂_τ², 1 / Σ wᵢ(τ²)) where wᵢ = 1/(vᵢ + τ²).

  function muCondPosterior(yi, vi, tau2) {
    var k = yi.length;
    var sw = 0, swy = 0;
    for (var i = 0; i < k; i++) {
      var w = 1 / (vi[i] + tau2);
      sw += w; swy += w * yi[i];
    }
    return { muHat: swy / sw, sePost: Math.sqrt(1 / sw), sw: sw };
  }

  // ----- Marginal likelihood (Laplace approximation) --------------------
  //
  // p(data | τ²) = ∏ N(yᵢ; μ̂(τ²), vᵢ + τ²) × √(2π · sePost²)  (the
  // marginal over μ under a flat prior; equivalently
  // p(y | τ²) · ∫ p(μ | y, τ²) dμ ≈ p(y | μ̂, τ²) · √(2π sePost²)).

  function _logMarginal(yi, vi, tau2) {
    var k = yi.length;
    var sw = 0, swy = 0;
    for (var i = 0; i < k; i++) {
      var w = 1 / (vi[i] + tau2);
      sw += w; swy += w * yi[i];
    }
    var muHat = swy / sw;
    var ll = 0;
    for (var j = 0; j < k; j++) {
      var v = vi[j] + tau2;
      var resid = yi[j] - muHat;
      ll += -0.5 * Math.log(2 * Math.PI * v) - 0.5 * resid * resid / v;
    }
    // Laplace correction term: ∫ p(μ | y, τ²) dμ ≈ √(2π / sw)
    ll += 0.5 * Math.log(2 * Math.PI / sw);
    return ll;
  }

  // ----- Marginalisation over τ² (Simpson grid) -------------------------

  function _simpsonIntegrate(fnAtNode, nodes) {
    // Composite Simpson on a uniform grid (nodes.length must be odd).
    var n = nodes.length;
    if (n < 3 || (n - 1) % 2 !== 0) {
      // fall back to trapezoid
      var sum = 0;
      for (var i = 0; i + 1 < n; i++) {
        sum += 0.5 * (fnAtNode[i] + fnAtNode[i + 1]) * (nodes[i + 1] - nodes[i]);
      }
      return sum;
    }
    var h = nodes[1] - nodes[0];
    var s = fnAtNode[0] + fnAtNode[n - 1];
    for (var k = 1; k < n - 1; k++) s += (k % 2 === 0 ? 2 : 4) * fnAtNode[k];
    return s * h / 3;
  }

  function _buildGrid(yi, vi, opts) {
    opts = opts || {};
    var nGrid = opts.nGrid || 201;
    if (nGrid % 2 === 0) nGrid += 1;
    // Upper bound: 25 × empirical between-study variance + safety floor.
    var emp = 0, mean = 0;
    for (var i = 0; i < yi.length; i++) mean += yi[i];
    mean /= yi.length;
    for (var j = 0; j < yi.length; j++) emp += (yi[j] - mean) * (yi[j] - mean);
    emp /= Math.max(1, yi.length - 1);
    var upper = Math.max(opts.upper || 0, 25 * emp + 0.5);
    var nodes = new Array(nGrid);
    for (var n = 0; n < nGrid; n++) nodes[n] = (n / (nGrid - 1)) * upper;
    return nodes;
  }

  /**
   * Fit a single τ²-prior model. Returns the posterior μ̂ (weighted by
   * the conditional posterior at each τ² node), the posterior SE, and
   * the log-marginal-likelihood of the model (for cross-model weights).
   */
  function fitModel(yi, vi, prior, opts) {
    var nodes = _buildGrid(yi, vi, opts);
    var n = nodes.length;
    var lp = new Array(n), priorVals = new Array(n);
    var maxLp = -Infinity;
    for (var i = 0; i < n; i++) {
      lp[i] = _logMarginal(yi, vi, nodes[i]);
      priorVals[i] = prior(nodes[i]);
      if (lp[i] > maxLp) maxLp = lp[i];
    }
    var integrand = new Array(n);
    for (var k = 0; k < n; k++) {
      integrand[k] = Math.exp(lp[k] - maxLp) * priorVals[k];
    }
    var Z = _simpsonIntegrate(integrand, nodes);
    if (!isFinite(Z) || Z <= 0) {
      return { ok: false, error: "degenerate integrand" };
    }
    // Posterior moments of μ across τ² nodes. Each moment is the Simpson
    // integral of (integrand(τ²) × moment-at-τ²) divided by Z. We
    // pre-build per-node moment integrands then call Simpson on each.
    var muMomentIntegrand = new Array(n);
    var mu2MomentIntegrand = new Array(n);
    var posteriorMode = 0, posteriorModeWeight = 0;
    for (var m = 0; m < n; m++) {
      if (integrand[m] > posteriorModeWeight) {
        posteriorModeWeight = integrand[m]; posteriorMode = nodes[m];
      }
      var cond = muCondPosterior(yi, vi, nodes[m]);
      muMomentIntegrand[m]  = integrand[m] * cond.muHat;
      mu2MomentIntegrand[m] = integrand[m] * (cond.sePost * cond.sePost + cond.muHat * cond.muHat);
    }
    var muHat = _simpsonIntegrate(muMomentIntegrand, nodes) / Z;
    var mu2   = _simpsonIntegrate(mu2MomentIntegrand, nodes) / Z;
    var seHat = Math.sqrt(Math.max(0, mu2 - muHat * muHat));
    // log marginal likelihood (for cross-model averaging)
    var logZ = maxLp + Math.log(Z);
    return {
      ok: true,
      muHat: muHat, sePost: seHat,
      tau2_post_mode: posteriorMode,
      logMarginalLik: logZ,
      grid: nodes, integrand: integrand, normaliser: Z,
    };
  }

  /**
   * Average over a list of prior models with equal model prior weights.
   * Returns the BMA μ̂, BMA SE (accounts for within- and between-model
   * variance), CrI, per-model weights.
   */
  function fit(yi, vi, models, opts) {
    opts = opts || {};
    var fits = models.map(function (m) {
      var f = fitModel(yi, vi, m.prior, opts);
      return { name: m.name, fit: f };
    }).filter(function (f) { return f.fit.ok; });
    if (!fits.length) return { ok: false, error: "all models failed" };
    // Cross-model weights via softmax of log marginal likelihoods.
    var maxLM = -Infinity;
    for (var i = 0; i < fits.length; i++)
      if (fits[i].fit.logMarginalLik > maxLM) maxLM = fits[i].fit.logMarginalLik;
    var unnorm = fits.map(function (f) { return Math.exp(f.fit.logMarginalLik - maxLM); });
    var sumW = unnorm.reduce(function (a, b) { return a + b; }, 0);
    var weights = unnorm.map(function (u) { return u / sumW; });
    // Mixture posterior moments (law of total variance):
    //   E[μ] = Σ w_k μ_k
    //   V[μ] = Σ w_k (V_k + μ_k²) - E[μ]²
    var muBMA = 0;
    for (var k = 0; k < fits.length; k++) muBMA += weights[k] * fits[k].fit.muHat;
    var varBMA = 0;
    for (var k2 = 0; k2 < fits.length; k2++) {
      var f2 = fits[k2].fit;
      varBMA += weights[k2] * (f2.sePost * f2.sePost + f2.muHat * f2.muHat);
    }
    varBMA -= muBMA * muBMA;
    var seBMA = Math.sqrt(Math.max(0, varBMA));
    // 95 % CrI: use normal approximation (the mixture of normals is close
    // enough to normal for k ≥ 5 and well-separated weights).
    var Z975 = 1.959963984540054;
    return {
      ok: true,
      muHat: muBMA, sePost: seBMA,
      ci_lo: muBMA - Z975 * seBMA, ci_hi: muBMA + Z975 * seBMA,
      perModel: fits.map(function (f, j) {
        return { name: f.name, weight: weights[j],
                 muHat: f.fit.muHat, sePost: f.fit.sePost,
                 tau2_mode: f.fit.tau2_post_mode };
      }),
    };
  }

  // Convenience: a "default" panel of priors that the literature often uses.
  function defaultModels() {
    return [
      { name: "halfNormal(0.5)",  prior: halfNormal(0.5) },
      { name: "halfNormal(1.0)",  prior: halfNormal(1.0) },
      { name: "halfCauchy(0.5)",  prior: halfCauchy(0.5) },
      { name: "halfCauchy(1.0)",  prior: halfCauchy(1.0) },
      { name: "invGamma(0.1, 0.1)", prior: invGamma(0.1, 0.1) },
      { name: "uniform(5)",       prior: uniform(5) },
    ];
  }

  var api = {
    halfNormal: halfNormal, halfCauchy: halfCauchy,
    invGamma: invGamma, uniform: uniform,
    fitModel: fitModel, fit: fit,
    defaultModels: defaultModels,
    _muCondPosterior: muCondPosterior,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmBMA = api;
})(typeof window !== "undefined" ? window : globalThis);
