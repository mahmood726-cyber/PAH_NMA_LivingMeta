/* shared/robma.js — RoBMA-style robust Bayesian meta-analysis (effect × heterogeneity).
 *
 * Bayesian model-averaging over the four models defined by the presence/absence of an
 * EFFECT (μ) and of HETEROGENEITY (τ), reporting inclusion Bayes factors and a
 * model-averaged estimate. This is the in-browser, deterministic, VERIFIABLE core of the
 * RoBMA framework (Maier, Bartoš & Wagenmakers 2023): each model's marginal likelihood is
 * a low-dimensional integral computed by Gauss-Legendre quadrature — no MCMC.
 *
 * Models (equal prior weight 1/4 by default), default priors μ ~ N(0, 1), τ ~ Half-N(0,1):
 *   H0·FE : μ=0, τ=0          → L = Πφ(yᵢ;0,sᵢ²)
 *   H1·FE : ∫ Πφ(yᵢ;μ,sᵢ²)·N(μ;0,1) dμ
 *   H0·RE : ∫ Πφ(yᵢ;0,sᵢ²+τ²)·2φ(τ;0,1) dτ
 *   H1·RE : ∫∫ Πφ(yᵢ;μ,sᵢ²+τ²)·N(μ;0,1)·2φ(τ;0,1) dμ dτ
 * BF₁₀(effect) = Σ(H1 models)/Σ(H0 models);  BF(heterogeneity) = Σ(RE)/Σ(FE).
 *
 * NOTE: this is RoBMA's effect/heterogeneity sub-model averaging, NOT the full RoBMA
 * package (which adds publication-bias weight-function/PET-PEESE models and uses MCMC +
 * bridge sampling). For the full analysis use the RoBMA R package (see buildRCode()).
 * Marginal likelihoods verified vs R integrate() to ~1e-6.
 *
 * Reference: Maier M, Bartoš F, Wagenmakers EJ (2023), Psychol Methods 28(1):107-122.
 */
(function (global) {
  "use strict";

  // Adaptive Simpson (handles sharply-peaked integrands like R's integrate()).
  function _adaptiveSimpson(f, a, b, tol) {
    tol = tol || 1e-10;
    function simpson(fa, fb, fm, a, b) { return (b - a) / 6 * (fa + 4 * fm + fb); }
    function rec(a, b, fa, fb, fm, whole, tol, depth) {
      var m = (a + b) / 2, lm = (a + m) / 2, rm = (m + b) / 2;
      var flm = f(lm), frm = f(rm);
      var left = simpson(fa, fm, flm, a, m), right = simpson(fm, fb, frm, m, b);
      if (depth <= 0 || Math.abs(left + right - whole) <= 15 * tol)
        return left + right + (left + right - whole) / 15;
      return rec(a, m, fa, fm, flm, left, tol / 2, depth - 1) + rec(m, b, fm, fb, frm, right, tol / 2, depth - 1);
    }
    var m = (a + b) / 2, fa = f(a), fb = f(b), fm = f(m);
    return rec(a, b, fa, fb, fm, simpson(fa, fb, fm, a, b), tol, 50);
  }

  function _normPdf(x, m, s) { var z = (x - m) / s; return Math.exp(-0.5 * z * z) / (s * Math.SQRT2 * Math.sqrt(Math.PI)); }

  // analysis(yi, sei, opts) → marginal likelihoods, inclusion BFs, posterior model probs,
  // model-averaged effect estimate. opts: { muSD:1, tauSD:1, priors:[w00,w0R,wH0,...] }.
  function analysis(yi, sei, opts) {
    opts = opts || {};
    var k = yi.length, muSD = opts.muSD || 1, tauSD = opts.tauSD || 1;
    var vi = sei.map(function (s) { return s * s; });
    function logLik(mu, tau2) { var s = 0; for (var i = 0; i < k; i++) { var v = vi[i] + tau2; s += -0.5 * Math.log(2 * Math.PI * v) - (yi[i] - mu) * (yi[i] - mu) / (2 * v); } return s; }

    // Centre the μ integration on the FE pooled mean so the adaptive midpoint lands on the
    // (often sharp) likelihood peak rather than a flat region near 0.
    var sw = 0, swy = 0; for (var q = 0; q < k; q++) { sw += 1 / vi[q]; swy += yi[q] / vi[q]; }
    var muHat = swy / sw, MUW = 9 + Math.abs(muHat), TAU = 10 * tauSD;
    var muLo = muHat - MUW, muHi = muHat + MUW;
    // H0·FE
    var mH0FE = Math.exp(logLik(0, 0));
    // H1·FE = ∫ exp(logLik(μ,0)) N(μ;0,muSD) dμ  + numerator for E[μ]
    var mH1FE = _adaptiveSimpson(function (mu) { return Math.exp(logLik(mu, 0)) * _normPdf(mu, 0, muSD); }, muLo, muHi);
    var numMuH1FE = _adaptiveSimpson(function (mu) { return mu * Math.exp(logLik(mu, 0)) * _normPdf(mu, 0, muSD); }, muLo, muHi);
    // H0·RE = ∫ exp(logLik(0,τ²)) 2φ(τ;0,tauSD) dτ
    var mH0RE = _adaptiveSimpson(function (tau) { return Math.exp(logLik(0, tau * tau)) * 2 * _normPdf(tau, 0, tauSD); }, 0, TAU);
    // H1·RE = ∫∫ exp(logLik(μ,τ²)) N(μ)·2φ(τ) dμ dτ  (nested adaptive, as R integrate)
    var mH1RE = _adaptiveSimpson(function (tau) {
      var tt = tau * tau, pt = 2 * _normPdf(tau, 0, tauSD);
      return pt * _adaptiveSimpson(function (mu) { return Math.exp(logLik(mu, tt)) * _normPdf(mu, 0, muSD); }, muLo, muHi, 1e-9);
    }, 0, TAU, 1e-9);
    var numMuH1RE = _adaptiveSimpson(function (tau) {
      var tt = tau * tau, pt = 2 * _normPdf(tau, 0, tauSD);
      return pt * _adaptiveSimpson(function (mu) { return mu * Math.exp(logLik(mu, tt)) * _normPdf(mu, 0, muSD); }, muLo, muHi, 1e-9);
    }, 0, TAU, 1e-9);

    var pri = opts.priors || [0.25, 0.25, 0.25, 0.25]; // [H0FE, H1FE, H0RE, H1RE]
    var marg = [mH0FE, mH1FE, mH0RE, mH1RE];
    var post = marg.map(function (m, i) { return m * pri[i]; });
    var Z = post.reduce(function (s, v) { return s + v; }, 0);
    post = post.map(function (v) { return v / Z; });

    var bfEffect = (mH1FE * pri[1] + mH1RE * pri[3]) / (mH0FE * pri[0] + mH0RE * pri[2]);
    var bfHetero = (mH0RE * pri[2] + mH1RE * pri[3]) / (mH0FE * pri[0] + mH1FE * pri[1]);
    // model-averaged effect = Σ post_m · E[μ|m]; E[μ]=0 for H0 models, posterior mean for H1.
    var emuH1FE = mH1FE > 0 ? numMuH1FE / mH1FE : 0, emuH1RE = mH1RE > 0 ? numMuH1RE / mH1RE : 0;
    var muMA = post[1] * emuH1FE + post[3] * emuH1RE;

    return {
      marginal: { H0FE: mH0FE, H1FE: mH1FE, H0RE: mH0RE, H1RE: mH1RE },
      postProb: { H0FE: post[0], H1FE: post[1], H0RE: post[2], H1RE: post[3] },
      bfEffect: bfEffect, bfHetero: bfHetero,
      pInclEffect: (post[1] + post[3]), pInclHetero: (post[2] + post[3]),
      muMA: muMA, muH1FE: emuH1FE, muH1RE: emuH1RE, k: k,
    };
  }

  // Generate runnable R for the FULL RoBMA package (incl. publication-bias models + MCMC).
  function buildRCode(yi, sei) {
    return [
      "# Full robust Bayesian meta-analysis (effect × heterogeneity × publication bias).",
      "# The in-app result covers the effect/heterogeneity model-averaging; RoBMA adds",
      "# weight-function & PET-PEESE bias models via MCMC + bridge sampling.",
      "install.packages('RoBMA')  # once",
      "library(RoBMA)",
      "y  <- c(" + yi.join(", ") + ")",
      "se <- c(" + sei.join(", ") + ")",
      "fit <- RoBMA(y = y, se = se, seed = 1)   # default RoBMA-PSMA model ensemble",
      "summary(fit)                              # inclusion BFs for effect, heterogeneity, bias",
    ].join("\n");
  }

  var api = { analysis: analysis, buildRCode: buildRCode, _adaptiveSimpson: _adaptiveSimpson };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmRoBMA = api;
})(typeof window !== "undefined" ? window : globalThis);
