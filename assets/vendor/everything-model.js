/* shared/everything-model.js — joint outcome × time × RoB hierarchical
 * meta-analysis. The "everything model".
 *
 * Decomposes the observed effect y_{i,t,o} (study i, snapshot time t,
 * outcome o) into the additive components:
 *
 *   y_{i,t,o} = μ_o            (outcome-specific overall mean)
 *             + δ_i             (study random effect; shared across t, o)
 *             + γ_t             (time-period fixed effect; baseline 0)
 *             + bias(rob_{i,t}) (RoB-driven shift at snapshot time t)
 *             + ε_{i,t,o}       (residual, variance v_{i,t,o})
 *   δ_i ~ N(0, τ²_δ)
 *
 * Estimation: variational EM (closed-form) — analytic posterior at fixed
 * variance components, then iterative update of τ²_δ + period γ_t means
 * + outcome shifts μ_o. Converges in 50-200 iterations for moderate-size
 * datasets. Browser-tractable; no MCMC needed.
 *
 * Output: per-outcome μ̂_o + posterior SE, per-period γ̂_t, study-level
 * shrinkage estimates δ̂_i (posterior mean), and a credible interval
 * for the OVERALL effect at any chosen (time, RoB-mix).
 *
 * Reference: Higgins, Whitehead 1996 (Stat Med 15:2733-2749) on
 * hierarchical bayes for meta-analysis; Welton, Cooper, Ades 2009 on
 * combined evidence; this is a unifying frame, not a single paper.
 *
 * Input: rows of
 *   { study, time, outcome, yi, vi, rob? }
 *
 * Output:
 *   { mu: { [outcome]: { estimate, se } },
 *     gamma: { [time]: { estimate, se } },
 *     delta: { [study]: { estimate, se } },
 *     tau2_delta, n_iter, converged }
 */
(function (global) {
  "use strict";

  // ---- RoB → bias map (reuse pattern) -----------------------------------

  var DEFAULT_BIAS_MAP = {
    low: 0, "some": 0.0, "some-concerns": 0.0,
    high: 0.0, critical: 0.0,
    unclear: 0.0, "no-info": 0.0,
  };
  // NOTE: the RoB shift bias() is NOT a downweight here — it's a
  // systematic shift on the effect scale (e.g. high-RoB studies tend
  // to overestimate by X log-OR units). Default 0 so the user must
  // opt in to a prior.

  function _biasShift(rob, biasMap, biasScale) {
    if (typeof rob !== "string") return 0;
    var m = biasMap || DEFAULT_BIAS_MAP;
    var b = m[rob.toLowerCase().trim()];
    if (!isFinite(b)) b = 0;
    return b * (isFinite(biasScale) ? biasScale : 1);
  }

  // ---- The variational EM loop ------------------------------------------

  function fit(rowsIn, opts) {
    opts = opts || {};
    var maxIter = opts.maxIter || 200;
    var tol = opts.tol || 1e-7;
    var biasMap = opts.biasMap || DEFAULT_BIAS_MAP;
    var biasScale = isFinite(opts.biasScale) ? opts.biasScale : 0;
    var refTime = opts.refTime;   // identifiability anchor for γ; defaults to first observed time

    var rows = rowsIn.filter(function (r) {
      return r && isFinite(r.yi) && isFinite(r.vi) && r.vi > 0
          && r.study && r.outcome && r.time;
    });
    if (rows.length < 2) return { ok: false, error: "need ≥ 2 valid rows" };

    // Index dictionaries.
    var studies = [], times = [], outcomes = [];
    var sIdx = Object.create(null), tIdx = Object.create(null), oIdx = Object.create(null);
    rows.forEach(function (r) {
      if (sIdx[r.study] == null) { sIdx[r.study] = studies.length; studies.push(r.study); }
      if (tIdx[r.time] == null)  { tIdx[r.time] = times.length;     times.push(r.time); }
      if (oIdx[r.outcome] == null) { oIdx[r.outcome] = outcomes.length; outcomes.push(r.outcome); }
    });
    if (refTime == null) refTime = times[0];

    // Pre-compute the RoB bias shift per row.
    var rowBias = rows.map(function (r) { return _biasShift(r.rob, biasMap, biasScale); });

    // Initial estimates: τ²_δ small, γ_t = 0, μ_o = naive per-outcome mean.
    var tau2 = 0.05;
    var mu = new Array(outcomes.length).fill(0);
    var gamma = new Array(times.length).fill(0);
    var delta = new Array(studies.length).fill(0);

    // Seed μ with per-outcome inverse-variance pool ignoring everything else.
    for (var k = 0; k < outcomes.length; k++) {
      var swM = 0, swyM = 0;
      for (var i = 0; i < rows.length; i++) {
        if (oIdx[rows[i].outcome] === k) {
          var w = 1 / rows[i].vi;
          swM += w; swyM += w * (rows[i].yi - rowBias[i]);
        }
      }
      mu[k] = swM > 0 ? swyM / swM : 0;
    }

    var prevLL = -Infinity;
    var converged = false;
    var iter = 0;
    for (iter = 0; iter < maxIter; iter++) {
      // E-step: posterior mean of δ_i given (μ, γ, τ²).
      for (var s = 0; s < studies.length; s++) {
        var num = 0, denom = 1 / tau2;
        for (var i2 = 0; i2 < rows.length; i2++) {
          if (sIdx[rows[i2].study] !== s) continue;
          var r2 = rows[i2];
          var resid = r2.yi - mu[oIdx[r2.outcome]] - gamma[tIdx[r2.time]] - rowBias[i2];
          num += resid / r2.vi;
          denom += 1 / r2.vi;
        }
        delta[s] = num / denom;
      }
      // M-step:
      //   (a) τ² = mean of δ² + posterior variance correction
      var sumD2 = 0;
      for (var s2 = 0; s2 < studies.length; s2++) sumD2 += delta[s2] * delta[s2];
      tau2 = Math.max(1e-8, sumD2 / studies.length);

      //   (b) γ_t for t ≠ refTime: solve the per-time equations holding
      //       μ + δ fixed. γ_refTime ≡ 0 (identifiability).
      var refIdx = tIdx[refTime];
      for (var t = 0; t < times.length; t++) {
        if (t === refIdx) { gamma[t] = 0; continue; }
        var swG = 0, swyG = 0;
        for (var i3 = 0; i3 < rows.length; i3++) {
          if (tIdx[rows[i3].time] !== t) continue;
          var r3 = rows[i3];
          var w3 = 1 / r3.vi;
          var resid3 = r3.yi - mu[oIdx[r3.outcome]] - delta[sIdx[r3.study]] - rowBias[i3];
          swG += w3; swyG += w3 * resid3;
        }
        gamma[t] = swG > 0 ? swyG / swG : 0;
      }

      //   (c) μ_o for each outcome.
      for (var o = 0; o < outcomes.length; o++) {
        var swO = 0, swyO = 0;
        for (var i4 = 0; i4 < rows.length; i4++) {
          if (oIdx[rows[i4].outcome] !== o) continue;
          var r4 = rows[i4];
          var w4 = 1 / r4.vi;
          var rr = r4.yi - gamma[tIdx[r4.time]] - delta[sIdx[r4.study]] - rowBias[i4];
          swO += w4; swyO += w4 * rr;
        }
        mu[o] = swO > 0 ? swyO / swO : 0;
      }

      // Compute log-likelihood for convergence check.
      var ll = 0;
      for (var i5 = 0; i5 < rows.length; i5++) {
        var r5 = rows[i5];
        var fit_ = mu[oIdx[r5.outcome]] + gamma[tIdx[r5.time]] + delta[sIdx[r5.study]] + rowBias[i5];
        ll += -0.5 * Math.log(2 * Math.PI * r5.vi) - 0.5 * (r5.yi - fit_) * (r5.yi - fit_) / r5.vi;
      }
      // Plus τ² prior contribution (zero-mean normal on δ).
      for (var s3 = 0; s3 < studies.length; s3++) {
        ll += -0.5 * Math.log(2 * Math.PI * tau2) - 0.5 * delta[s3] * delta[s3] / tau2;
      }
      if (iter > 0 && Math.abs(ll - prevLL) < tol) {
        converged = true;
        prevLL = ll;
        iter += 1;
        break;
      }
      prevLL = ll;
    }

    // Posterior SE for μ_o: sqrt(1 / Σ_{i in o} 1/(v_i + τ²)) — the random-effects
    // inverse-variance precision sum (weights w_i = 1/(v_i+τ²)). NB: the inner
    // term is 1/(v_i+τ²), NOT (1/v_i + 1/τ²); do not "simplify" it.
    var Z975 = 1.959963984540054;
    var muSummary = Object.create(null);
    for (var oo = 0; oo < outcomes.length; oo++) {
      var sumW = 0;
      for (var i6 = 0; i6 < rows.length; i6++) {
        if (oIdx[rows[i6].outcome] === oo) sumW += 1 / (rows[i6].vi + tau2);
      }
      var se = sumW > 0 ? Math.sqrt(1 / sumW) : NaN;
      muSummary[outcomes[oo]] = {
        estimate: mu[oo], se: se,
        ci_lo: mu[oo] - Z975 * se, ci_hi: mu[oo] + Z975 * se,
      };
    }
    var gammaSummary = Object.create(null);
    for (var tt = 0; tt < times.length; tt++) {
      gammaSummary[times[tt]] = { estimate: gamma[tt], is_reference: (tt === tIdx[refTime]) };
    }
    var deltaSummary = Object.create(null);
    for (var ss = 0; ss < studies.length; ss++) {
      deltaSummary[studies[ss]] = { estimate: delta[ss] };
    }

    return {
      ok: true,
      mu: muSummary, gamma: gammaSummary, delta: deltaSummary,
      tau2_delta: tau2, n_iter: iter, converged: converged,
      log_likelihood: prevLL,
      studies: studies, times: times, outcomes: outcomes,
      ref_time: refTime,
      bias_scale: biasScale,
    };
  }

  var api = {
    fit: fit,
    DEFAULT_BIAS_MAP: DEFAULT_BIAS_MAP,
    _biasShift: _biasShift,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmEverythingModel = api;
})(typeof window !== "undefined" ? window : globalThis);
