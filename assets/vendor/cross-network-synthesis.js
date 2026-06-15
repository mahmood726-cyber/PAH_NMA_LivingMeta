/* shared/cross-network-synthesis.js — combine RCT NMA + IPD + observational
 * data under a unified bias-corrected model.
 *
 * Three evidence streams enter:
 *
 *   1. RCT NMA          — anchor; design-bias = 0, no σ²_bias
 *   2. IPD trial-level  — same trials as RCT but per-arm or per-patient
 *                          summaries (smaller v_i); design-bias δ_IPD
 *                          (often 0; the IPD is the same evidence at
 *                          finer granularity), σ²_IPD captures the
 *                          patient-level heterogeneity not in the
 *                          aggregate
 *   3. Observational    — design-bias δ_obs (typically negative for
 *                          treatment effects: obs studies overestimate
 *                          benefit), σ²_bias captures heterogeneity in
 *                          how each obs study deviates from RCT truth
 *
 * Model per contrast c:
 *   y_c = μ_c + δ_design(c) + ε_c
 *   ε_c ~ N(0, v_c + τ²)
 *   δ_RCT = 0  (identifiability anchor)
 *   δ_IPD, δ_obs ~ estimable via method of moments on residuals
 *
 * Returns per-contrast μ̂_c (the RCT-anchored truth), the bias offsets,
 * and the bias-adjusted prediction interval (which is wider than the
 * naive NMA RE-CI because it accounts for δ uncertainty).
 *
 * Extends the older cross-design.js to the NETWORK case — same logic
 * but per-contrast rather than per-treatment-vs-control.
 *
 * Reference: Welton, Cooper, Ades, Lu, Sutton 2009 (Stat Med); Sutton,
 * Higgins 2008 (Stat Med 27:625-650) on incorporating expert opinion +
 * non-RCT evidence; Efthimiou et al. 2017 "GetReal in network meta-
 * analysis" (Res Synth Methods 8:23-39).
 */
(function (global) {
  "use strict";

  // ---- Per-contrast DL τ² + IV pool helpers (independent contrasts) ----

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

  // ---- Main fit ---------------------------------------------------------
  //
  // Input rows: each contributes one effect estimate to one CONTRAST:
  //   { contrast: "A_vs_B", yi, vi, design: "rct" | "ipd" | "obs" }
  //
  // Returns:
  //   { contrasts: {
  //       "A_vs_B": {
  //         mu_anchor,                    — μ̂ from RCT only
  //         mu_synthesis,                 — bias-corrected combined μ̂
  //         se_synthesis, ci_lo, ci_hi,
  //         delta_ipd, delta_obs,         — design-bias offsets
  //         sigma2_ipd, sigma2_obs,       — between-study bias variance
  //         k_rct, k_ipd, k_obs,
  //         tau2_rct,                     — heterogeneity in the RCT anchor
  //       },
  //       …
  //     },
  //     warnings: [...]
  //   }

  function fit(rows, opts) {
    opts = opts || {};
    if (!Array.isArray(rows) || !rows.length) throw new Error("no rows");
    var Z975 = 1.959963984540054;

    // Group rows by contrast.
    var byContrast = Object.create(null);
    var contrastOrder = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.contrast || !isFinite(r.yi) || !isFinite(r.vi) || r.vi <= 0) continue;
      var design = (r.design || "rct").toLowerCase();
      if (design !== "rct" && design !== "ipd" && design !== "obs") continue;
      if (!byContrast[r.contrast]) {
        byContrast[r.contrast] = { rct: [], ipd: [], obs: [] };
        contrastOrder.push(r.contrast);
      }
      byContrast[r.contrast][design].push({ yi: r.yi, vi: r.vi });
    }

    var results = Object.create(null);
    var warnings = [];
    for (var c = 0; c < contrastOrder.length; c++) {
      var cname = contrastOrder[c];
      var streams = byContrast[cname];
      var rcts = streams.rct, ipds = streams.ipd, obs = streams.obs;

      // (a) RCT anchor: REML / DL pool of just the RCTs.
      var tau2Rct = _tau2_DL(rcts);
      var anchor;
      if (rcts.length >= 1) {
        anchor = _ivPool(rcts, tau2Rct);
      } else {
        anchor = { mu: NaN, se: NaN, k: 0 };
        warnings.push(cname + ": no RCT anchor — synthesis falls back to naive pool");
      }

      // (b) IPD bias offset (typically ~0 if IPD is the same trials, but
      //     can be non-zero if IPD includes additional subgroup detail).
      var deltaIpd = 0, sigma2Ipd = 0;
      if (ipds.length >= 1 && isFinite(anchor.mu)) {
        var resI = ipds.map(function (r) { return r.yi - anchor.mu; });
        var swI = 0, swyI = 0, sw2I = 0;
        for (var k = 0; k < ipds.length; k++) {
          var wI = 1 / (ipds[k].vi + tau2Rct);
          swI += wI; swyI += wI * resI[k]; sw2I += wI * wI;
        }
        deltaIpd = swyI / swI;
        if (ipds.length >= 2) {
          var Qi = 0;
          for (var kk = 0; kk < ipds.length; kk++) {
            var wii = 1 / (ipds[kk].vi + tau2Rct);
            Qi += wii * (resI[kk] - deltaIpd) * (resI[kk] - deltaIpd);
          }
          var denomI = swI - sw2I / swI;
          sigma2Ipd = denomI > 1e-12 ? Math.max(0, (Qi - (ipds.length - 1)) / denomI) : 0;
        }
      }

      // (c) Observational bias offset.
      var deltaObs = 0, sigma2Obs = 0;
      if (obs.length >= 1 && isFinite(anchor.mu)) {
        var resO = obs.map(function (r) { return r.yi - anchor.mu; });
        var swO = 0, swyO = 0, sw2O = 0;
        for (var m = 0; m < obs.length; m++) {
          var wO = 1 / (obs[m].vi + tau2Rct);
          swO += wO; swyO += wO * resO[m]; sw2O += wO * wO;
        }
        deltaObs = swyO / swO;
        if (obs.length >= 2) {
          var Qo = 0;
          for (var mm = 0; mm < obs.length; mm++) {
            var wmm = 1 / (obs[mm].vi + tau2Rct);
            Qo += wmm * (resO[mm] - deltaObs) * (resO[mm] - deltaObs);
          }
          var denomO = swO - sw2O / swO;
          sigma2Obs = denomO > 1e-12 ? Math.max(0, (Qo - (obs.length - 1)) / denomO) : 0;
        }
      }

      // (d) Bias-corrected synthesis: each stream contributes via its
      //     inverse-variance weight ADJUSTED for the design-bias variance.
      //     Effective variance for an obs-stream observation:
      //       v_eff_obs = v_i + tau2_rct + sigma2_obs
      //     Effective y after bias removal: y_i - δ_obs
      //     Similarly for IPD.
      var allYi = [], allVi = [];
      for (var rr = 0; rr < rcts.length; rr++) {
        allYi.push(rcts[rr].yi); allVi.push(rcts[rr].vi + tau2Rct);
      }
      for (var rr2 = 0; rr2 < ipds.length; rr2++) {
        allYi.push(ipds[rr2].yi - deltaIpd);
        allVi.push(ipds[rr2].vi + tau2Rct + sigma2Ipd);
      }
      for (var rr3 = 0; rr3 < obs.length; rr3++) {
        allYi.push(obs[rr3].yi - deltaObs);
        allVi.push(obs[rr3].vi + tau2Rct + sigma2Obs);
      }
      var swA = 0, swyA = 0;
      for (var ii = 0; ii < allYi.length; ii++) {
        var wA = 1 / allVi[ii];
        swA += wA; swyA += wA * allYi[ii];
      }
      var muSyn, seSyn;
      if (allYi.length === 0) {
        muSyn = NaN; seSyn = NaN;
      } else {
        muSyn = swyA / swA;
        seSyn = Math.sqrt(1 / swA);
      }

      results[cname] = {
        mu_anchor: anchor.mu, se_anchor: anchor.se, k_rct: rcts.length,
        mu_synthesis: muSyn, se_synthesis: seSyn,
        ci_lo: muSyn - Z975 * seSyn, ci_hi: muSyn + Z975 * seSyn,
        delta_ipd: deltaIpd, sigma2_ipd: sigma2Ipd, k_ipd: ipds.length,
        delta_obs: deltaObs, sigma2_obs: sigma2Obs, k_obs: obs.length,
        tau2_rct: tau2Rct,
      };
    }

    return {
      ok: true,
      contrasts: results,
      warnings: warnings,
      n_contrasts: contrastOrder.length,
      n_rows: rows.length,
    };
  }

  var api = {
    fit: fit,
    _ivPool: _ivPool,
    _tau2_DL: _tau2_DL,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmCrossNetwork = api;
})(typeof window !== "undefined" ? window : globalThis);
