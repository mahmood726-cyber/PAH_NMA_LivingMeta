/* shared/personalised-te.js — personalised treatment-effect synthesis via
 * empirical Bayes shrinkage of subgroup estimates.
 *
 * Standard meta-analysis returns a single pooled effect. Patients differ;
 * effects can differ across subgroups (defined by sex, age, baseline
 * severity, biomarker, …). When subgroup-specific effects are reported,
 * naively trusting a single subgroup's estimate is noisy; ignoring the
 * subgroup is biased. Empirical Bayes shrinkage gives each subgroup a
 * posterior estimate that's pulled toward the overall pooled effect by
 * an amount inversely proportional to its evidence.
 *
 * Two layers of estimation:
 *
 *   1. Within each subgroup, pool the subgroup-specific effects across
 *      studies via inverse-variance (with DL τ²_subgroup).
 *
 *   2. Across subgroups, treat each subgroup's pooled estimate ŷ_s as an
 *      observation of the true subgroup effect θ_s ~ N(μ, σ²_between).
 *      The James-Stein / empirical Bayes posterior is
 *        θ̂_s = ŵ_s · ŷ_s + (1 - ŵ_s) · μ̂
 *      where ŵ_s = σ²_between / (σ²_between + se²(ŷ_s)).
 *
 * Personalised prediction: for a new patient with subgroup label s,
 * return θ̂_s with its posterior SE. For unobserved subgroups (no
 * studies report them), return μ̂ alone.
 *
 * Reference: Brand R, Kragh Andersen P 1992 (Stat Med 11:1879-1894) on
 * empirical Bayes for clinical trials; Henderson NC, Louis TA, Wang C,
 * Varadhan R 2016 (BMC Med Res Methodol 16:128) on shrinkage in HTE
 * estimation. Modern unified framing: Kent DM et al. 2018
 * "The Predictive Approaches to Treatment effect Heterogeneity (PATH)
 * Statement" (Ann Intern Med 172:35-45).
 *
 * Input rows: { study, subgroup, yi, vi }
 *
 * Output:
 *   { overall: { mu, se, ci_lo, ci_hi, tau2 },
 *     subgroups: {
 *       [name]: { yi_pooled, se_pooled,            // raw subgroup pool
 *                 theta_shrunk, se_shrunk,          // EB posterior
 *                 ci_lo, ci_hi, shrinkage_weight,   // 0..1; 1 = no shrink
 *                 k }
 *     },
 *     sigma2_between }
 */
(function (global) {
  "use strict";

  function _ivPool(rows, tau2) {
    var sw = 0, swy = 0;
    for (var i = 0; i < rows.length; i++) {
      var w = 1 / (rows[i].vi + tau2);
      sw += w; swy += w * rows[i].yi;
    }
    return { mu: swy / sw, se: Math.sqrt(1 / sw), k: rows.length };
  }

  function _tau2_DL(rows) {
    var k = rows.length;
    if (k < 2) return 0;
    var w = rows.map(function (r) { return 1 / r.vi; });
    var sw = w.reduce(function (a, b) { return a + b; }, 0);
    var swy = 0;
    for (var i = 0; i < k; i++) swy += w[i] * rows[i].yi;
    var muFE = swy / sw;
    var Q = 0;
    for (var j = 0; j < k; j++) Q += w[j] * (rows[j].yi - muFE) * (rows[j].yi - muFE);
    var sw2 = w.reduce(function (a, b) { return a + b * b; }, 0);
    var denom = sw - sw2 / sw;
    if (denom <= 1e-12) return 0;
    return Math.max(0, (Q - (k - 1)) / denom);
  }

  function fit(rowsIn, opts) {
    opts = opts || {};
    var Z975 = 1.959963984540054;
    var rows = rowsIn.filter(function (r) {
      return r && r.study && r.subgroup
          && isFinite(r.yi) && isFinite(r.vi) && r.vi > 0;
    });
    if (rows.length < 2) return { ok: false, error: "need ≥ 2 valid rows" };

    // Group by subgroup.
    var byGroup = Object.create(null);
    var groupOrder = [];
    for (var i = 0; i < rows.length; i++) {
      var g = String(rows[i].subgroup).trim();
      if (!byGroup[g]) { byGroup[g] = []; groupOrder.push(g); }
      byGroup[g].push(rows[i]);
    }

    // (1) Per-subgroup random-effects pool (DL τ² within each subgroup).
    var subgroupPools = Object.create(null);
    for (var s = 0; s < groupOrder.length; s++) {
      var g2 = groupOrder[s];
      var grp = byGroup[g2];
      var tau2g = _tau2_DL(grp);
      var p = _ivPool(grp, tau2g);
      subgroupPools[g2] = {
        yi_pooled: p.mu, se_pooled: p.se, k: grp.length, tau2_within: tau2g,
      };
    }

    // (2) Across-subgroup pooled overall (treat each subgroup pool as one
    //     observation). Then estimate σ²_between via method of moments.
    var sgRows = groupOrder.map(function (g3) {
      return { yi: subgroupPools[g3].yi_pooled,
               vi: subgroupPools[g3].se_pooled * subgroupPools[g3].se_pooled };
    });
    var sigma2_between = _tau2_DL(sgRows);
    var overall = _ivPool(sgRows, sigma2_between);

    // (3) Empirical Bayes shrinkage per subgroup.
    var subgroupResults = Object.create(null);
    for (var s2 = 0; s2 < groupOrder.length; s2++) {
      var name = groupOrder[s2];
      var pool = subgroupPools[name];
      var seSq = pool.se_pooled * pool.se_pooled;
      var w = (sigma2_between + seSq) > 1e-12
        ? sigma2_between / (sigma2_between + seSq)
        : 0;
      var thetaShrunk = w * pool.yi_pooled + (1 - w) * overall.mu;
      // Posterior variance: shrinkage formula (Morris 1983).
      var v_post = w * seSq + (1 - w) * overall.se * overall.se
                 + w * (1 - w) * (pool.yi_pooled - overall.mu) * (pool.yi_pooled - overall.mu);
      var seShrunk = Math.sqrt(Math.max(1e-12, v_post));
      subgroupResults[name] = {
        yi_pooled: pool.yi_pooled, se_pooled: pool.se_pooled,
        theta_shrunk: thetaShrunk, se_shrunk: seShrunk,
        ci_lo: thetaShrunk - Z975 * seShrunk,
        ci_hi: thetaShrunk + Z975 * seShrunk,
        shrinkage_weight: w, k: pool.k, tau2_within: pool.tau2_within,
      };
    }

    return {
      ok: true,
      overall: {
        mu: overall.mu, se: overall.se,
        ci_lo: overall.mu - Z975 * overall.se,
        ci_hi: overall.mu + Z975 * overall.se,
        tau2: sigma2_between,
      },
      subgroups: subgroupResults,
      sigma2_between: sigma2_between,
      n_subgroups: groupOrder.length,
      n_rows: rows.length,
    };
  }

  /**
   * Predict the treatment effect for a patient described by a subgroup
   * label. Returns { estimate, se, ci_lo, ci_hi, basis }.
   *   basis = "subgroup-shrunk"  — used the EB posterior for that subgroup
   *   basis = "overall-fallback" — subgroup not observed; used the overall
   */
  function predict(fitResult, subgroupLabel) {
    if (!fitResult || !fitResult.ok) return null;
    var Z = 1.959963984540054;
    var sg = fitResult.subgroups[subgroupLabel];
    if (sg) {
      return {
        estimate: sg.theta_shrunk, se: sg.se_shrunk,
        ci_lo: sg.ci_lo, ci_hi: sg.ci_hi,
        basis: "subgroup-shrunk", shrinkage_weight: sg.shrinkage_weight,
      };
    }
    var o = fitResult.overall;
    return {
      estimate: o.mu, se: o.se,
      ci_lo: o.ci_lo, ci_hi: o.ci_hi,
      basis: "overall-fallback", shrinkage_weight: 0,
    };
  }

  var api = {
    fit: fit, predict: predict,
    _ivPool: _ivPool, _tau2_DL: _tau2_DL,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmPersonalisedTE = api;
})(typeof window !== "undefined" ? window : globalThis);
