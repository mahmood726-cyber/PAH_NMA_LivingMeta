/* shared/uwls.js — UWLS / multiplicative-heterogeneity meta-analysis
 * (Stanley & Doucouliagos 2015, "Neither fixed nor random").
 *
 * Instead of ADDING a between-study variance τ² (random effects), the
 * multiplicative model INFLATES the within-study variances by a single
 * overdispersion factor φ = Q/(k−1). The point estimate equals the fixed-effect
 * (inverse-variance) estimate; the SE is the fixed-effect SE × √φ. This is the
 * "unrestricted weighted least squares" (UWLS) estimator — exactly
 * lm(yi ~ 1, weights = 1/vi), with t_{k−1} confidence intervals.
 *
 * Why it matters (advanced-stats.md): for OBSERVATIONAL meta-analyses,
 * inverse-variance random-effects weights amplify SE-manipulation by primary
 * modellers (Stanley 2025); UWLS / sample-size weighting is recommended as the
 * primary estimator, with IV-RE only as a sensitivity analysis. UWLS is also a
 * robust alternative under publication bias.
 *
 * Verified vs R summary(lm(yi ~ 1, weights = 1/vi)) — see tests/test_uwls.py:
 *   yi=c(.10,.30,.50,.20,.90,.40,1.10,.05) sei=c(.20,.25,.18,.30,.22,.28,.35,.15)
 *   -> est=0.35416256 se=0.12134013 (Q=17.417741, φ=2.488249).
 *
 * Reference: Stanley TD, Doucouliagos H. Stat Med. 2015;34(13):2116-2127.
 * doi:10.1002/sim.6481.
 */
(function (global) {
  "use strict";

  // yi: effect sizes, vi: sampling variances (analysis scale). opts.level (0.95).
  // Returns { mu, se, seFE, phi, Q, k, df, ciLo, ciHi, tCrit } or null (k<2).
  function uwls(yi, vi, opts) {
    opts = opts || {};
    var k = yi.length;
    if (k < 2 || vi.length !== k) return null;
    var sw = 0, swy = 0, i;
    for (i = 0; i < k; i++) { var w = 1 / vi[i]; sw += w; swy += w * yi[i]; }
    var mu = swy / sw;                 // = fixed-effect (inverse-variance) estimate
    var seFE = Math.sqrt(1 / sw);
    var Q = 0;
    for (i = 0; i < k; i++) Q += (yi[i] - mu) * (yi[i] - mu) / vi[i];
    var df = k - 1;
    var phi = df > 0 ? Q / df : 1;     // multiplicative overdispersion (unfloored, matches lm)
    var se = seFE * Math.sqrt(phi);
    var level = opts.level || 0.95;
    var t = (global.AlmMaCore && global.AlmMaCore._qt)
      ? global.AlmMaCore._qt(1 - (1 - level) / 2, df) : 1.959963984540054;
    return {
      mu: mu, se: se, seFE: seFE, phi: phi, Q: Q, k: k, df: df,
      ciLo: mu - t * se, ciHi: mu + t * se, tCrit: t,
    };
  }

  var api = { uwls: uwls };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmUWLS = api;
})(typeof window !== "undefined" ? window : globalThis);
