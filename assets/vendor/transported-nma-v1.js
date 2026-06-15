/* shared/transported-nma-v1.js — population-transported network meta-analysis.
 *
 * Integrated from the nmatransport project. A standard NMA estimates the
 * relative effects in the SOURCE network's case-mix. If the target population
 * (the patients a decision is for) has a different distribution of effect
 * modifiers, those estimates may not transport. This reweights each study so
 * the network's weighted covariate means match a TARGET population profile
 * (Hainmueller entropy balancing), inflates each study's variance by its
 * weight, and refits the random-effects NMA — yielding a target-population
 * league table alongside the source one, plus the effective-sample-size loss
 * that quantifies how much information the transport costs.
 *
 * Entropy balancing (weights): with centred covariates Z_i = X_i − target,
 * w_i ∝ exp(λ'Z_i)/Σ; λ solves Σ w_i Z_i = 0 (weighted means EXACTLY match the
 * target, weights closest to uniform) by Newton on the convex dual
 * F(λ)=log Σ exp(λ'Z_j). Kish effective sample size ESS = 1/Σ w_i² reports the
 * information retained; a low ESS ratio means the transport is an extrapolation.
 *
 * Reuses the audited AlmMultiplicativeNMA WLS network fit (_buildDesign /
 * _fitWLS / _tau2_PM) and AlmMaCore._qt — does NOT re-implement the NMA solver.
 *
 * CAVEATS (surfaced by the app): transport corrects only for the MEASURED
 * modifiers you supply; unmeasured modifiers and effect-modifier interactions
 * are not fixed. Entropy balancing extrapolates if the target lies outside the
 * studies' covariate hull — watch the ESS ratio and the achieved-vs-target gap.
 * The variance-inflation reweighting is an aggregate-data approximation to a
 * proper IPD-NMA, conservative for down-weighted studies.
 *
 * Pure + dual-mode. Browser global: window.AlmTransportedNMA.
 */
(function (global) {
  "use strict";

  function _nma() { return global.AlmMultiplicativeNMA; }

  // standard normal CDF (Abramowitz-Stegun 7.1.26 erf), for P-scores.
  function _phi(x) {
    var t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? 0.5 + 0.5 * y : 0.5 - 0.5 * y;
  }

  /* Entropy-balancing transport weights.
   * studies: [{cov:{name:value,…}}] ; target: {name:mean,…}.
   * Returns normalised weights (sum 1), ESS, achieved vs target moments. */
  function weights(studies, target, opts) {
    opts = opts || {};
    var covNames = Object.keys(target || {});
    if (!Array.isArray(studies) || studies.length < 2) return { ok: false, error: "need ≥2 studies" };
    if (!covNames.length) return { ok: false, error: "target population profile is empty" };
    var n = studies.length, j;

    // centred covariate matrix Z (n × p): X − target
    var Z = [];
    for (var i = 0; i < n; i++) {
      var c = studies[i].cov || {}, row = [];
      for (j = 0; j < covNames.length; j++) {
        var v = c[covNames[j]];
        if (!Number.isFinite(v)) return { ok: false, error: "study " + (i + 1) + " missing covariate '" + covNames[j] + "'" };
        row.push(v - target[covNames[j]]);
      }
      Z.push(row);
    }
    var p = covNames.length;

    // Newton on dual F(λ)=log Σ exp(λ'Z_j); gradient = Σ w_i Z_i, Hessian = weighted cov(Z).
    var lam = new Array(p).fill(0), w = new Array(n).fill(1 / n), iter, converged = false;
    for (iter = 0; iter < 200; iter++) {
      var eta = [], mx = -Infinity;
      for (i = 0; i < n; i++) { var e = 0; for (j = 0; j < p; j++) e += lam[j] * Z[i][j]; eta.push(e); if (e > mx) mx = e; }
      var s = 0; for (i = 0; i < n; i++) { w[i] = Math.exp(eta[i] - mx); s += w[i]; }
      for (i = 0; i < n; i++) w[i] /= s;

      var g = new Array(p).fill(0);                          // gradient = weighted mean of Z
      for (i = 0; i < n; i++) for (j = 0; j < p; j++) g[j] += w[i] * Z[i][j];
      var gnorm = 0; for (j = 0; j < p; j++) gnorm += g[j] * g[j];
      if (Math.sqrt(gnorm) < 1e-10) { converged = true; break; }

      var H = [];                                            // Hessian = weighted cov(Z)
      for (var a = 0; a < p; a++) { H[a] = new Array(p).fill(0); }
      for (i = 0; i < n; i++) for (a = 0; a < p; a++) for (var b = 0; b < p; b++) H[a][b] += w[i] * (Z[i][a] - g[a]) * (Z[i][b] - g[b]);
      var Hi = _nma() ? _nma()._inv ? _nma()._inv(H) : _inv(H) : _inv(H);
      if (!Hi) { converged = false; break; }
      for (a = 0; a < p; a++) { var step = 0; for (b = 0; b < p; b++) step += Hi[a][b] * g[b]; lam[a] -= step; }   // minimise F => move against gradient
    }

    var ss = 0; for (i = 0; i < n; i++) ss += w[i] * w[i];
    var ess = 1 / ss, essRatio = ess / n;
    var achieved = {}, maxImb = 0;
    for (j = 0; j < p; j++) {
      var m = 0; for (i = 0; i < n; i++) m += w[i] * (Z[i][j] + target[covNames[j]]);
      achieved[covNames[j]] = m;
      maxImb = Math.max(maxImb, Math.abs(m - target[covNames[j]]));
    }
    return {
      ok: true, weights: w, ess: ess, essRatio: essRatio, n: n,
      converged: converged, covariates: covNames, target: Object.assign({}, target),
      achieved: achieved, maxImbalance: maxImb
    };
  }

  // local Gauss-Jordan inverse fallback (if the NMA module's _inv is private).
  function _inv(M) {
    var n = M.length, A = M.map(function (r, i) { return r.concat(M.map(function (_, j) { return i === j ? 1 : 0; })); });
    for (var c = 0; c < n; c++) {
      var pr = c; for (var r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[pr][c])) pr = r;
      if (!(Math.abs(A[pr][c]) > 0)) return null;
      var t = A[c]; A[c] = A[pr]; A[pr] = t;
      var pv = A[c][c]; for (var k = 0; k < 2 * n; k++) A[c][k] /= pv;
      for (var r2 = 0; r2 < n; r2++) { if (r2 === c) continue; var f = A[r2][c]; for (var k2 = 0; k2 < 2 * n; k2++) A[r2][k2] -= f * A[c][k2]; }
    }
    return A.map(function (row) { return row.slice(n); });
  }

  /* Reweighted random-effects NMA.
   * rows: [{trtA,trtB,yi,sei,study}] (study = index/label into `w`).
   * w: per-study weights (from weights()); null -> unweighted source NMA.
   * higherIsBetter: P-score direction (default true). */
  function fit(rows, treatments, w, opts) {
    opts = opts || {};
    var NMA = _nma();
    if (!NMA) return { ok: false, error: "AlmMultiplicativeNMA (network solver) not loaded" };
    if (!global.AlmMaCore) return { ok: false, error: "AlmMaCore not loaded" };
    if (!Array.isArray(rows) || !rows.length) return { ok: false, error: "no contrast rows" };

    // variance inflation: low-weight studies get a larger effective SE.
    var rows2 = rows;
    if (w) {
      var mean = w.reduce(function (a, x) { return a + x; }, 0) / w.length;
      rows2 = rows.map(function (r) {
        var wi = (r.study != null && Number.isFinite(w[r.study])) ? w[r.study] : mean;
        var wn = wi / mean;
        return { trtA: r.trtA, trtB: r.trtB, yi: r.yi, sei: r.sei / Math.sqrt(wn + 1e-12) };
      });
    }

    var d, tau2, re;
    try {
      d = NMA._buildDesign(rows2, treatments);
      if (d.y.length < d.p) throw new Error("under-identified: " + d.y.length + " contrasts for " + d.p + " parameters");
      tau2 = NMA._tau2_PM(d.X, d.y, d.v);
      re = NMA._fitWLS(d.X, d.y, d.v, tau2);
    } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }

    var p = d.p, level = opts.level || 0.95, df = Math.max(1, d.y.length - p);
    var tCrit = global.AlmMaCore._qt ? global.AlmMaCore._qt(1 - (1 - level) / 2, df) : 1.959963984540054;

    // effects vs reference (index 0); beta[k] is treatment k+1 vs ref.
    var beta = [0].concat(re.beta);                       // length T, ref = 0
    var cov = function (i, k) {                            // covariance of (beta_i, beta_k); ref has 0 var/cov
      if (i === 0 || k === 0) return 0;
      return re.cov[i - 1][k - 1];
    };
    var effects = {};
    for (var t = 0; t < treatments.length; t++) {
      var se = Math.sqrt(Math.max(0, cov(t, t)));
      effects[treatments[t]] = { vs: treatments[0], estimate: beta[t], se: se, ciLo: beta[t] - tCrit * se, ciHi: beta[t] + tCrit * se };
    }

    // full pairwise league + P-scores (Rücker–Schwarzer 2015).
    var T = treatments.length, league = [], pScore = {};
    var higher = opts.higherIsBetter !== false;
    for (var ii = 0; ii < T; ii++) {
      league[ii] = [];
      var probSum = 0;
      for (var jj = 0; jj < T; jj++) {
        var est = beta[ii] - beta[jj];
        var vdiff = Math.max(0, cov(ii, ii) + cov(jj, jj) - 2 * cov(ii, jj));
        var sed = Math.sqrt(vdiff);
        league[ii][jj] = { estimate: est, se: sed, ciLo: est - tCrit * sed, ciHi: est + tCrit * sed };
        if (jj !== ii) probSum += sed > 0 ? _phi((higher ? est : -est) / sed) : 0.5;
      }
      pScore[treatments[ii]] = T > 1 ? probSum / (T - 1) : 0;
    }

    return {
      ok: true, weighted: !!w, treatments: treatments, reference: treatments[0],
      effects: effects, league: league, pScore: pScore,
      tau2: tau2, Q: re.Q, df: df, level: level, tCrit: tCrit,
      nContrasts: d.y.length, nTreatments: T
    };
  }

  /* Convenience: source (unweighted) + target (transported) league in one call.
   * input: { studies:[{cov}], rows:[{trtA,trtB,yi,sei,study}], treatments, target, level, higherIsBetter } */
  function run(input) {
    input = input || {};
    var wr = weights(input.studies, input.target, input);
    if (!wr.ok) return { ok: false, error: wr.error };
    var source = fit(input.rows, input.treatments, null, input);
    if (!source.ok) return { ok: false, error: "source NMA: " + source.error };
    var transported = fit(input.rows, input.treatments, wr.weights, input);
    if (!transported.ok) return { ok: false, error: "transported NMA: " + transported.error };

    // shift in P-score ranking induced by the transport.
    var shifts = input.treatments.map(function (t) {
      return { treatment: t, source: source.pScore[t], target: transported.pScore[t], delta: transported.pScore[t] - source.pScore[t] };
    });
    var caution = wr.essRatio < 0.5 || wr.maxImbalance > 0.05 || !wr.converged;
    return {
      ok: true, transport: wr, source: source, transported: transported, shifts: shifts,
      caution: caution,
      verdict: !wr.converged
        ? "Entropy balancing did NOT converge — the target may lie outside the studies' covariate hull. Treat the transported league as an unreliable extrapolation."
        : "Effective sample size after transport: " + wr.ess.toFixed(1) + " of " + wr.n + " studies (" + (100 * wr.essRatio).toFixed(0) + "%)."
          + (caution ? " CAUTION: low ESS / residual imbalance — the transport is an extrapolation; read the source league alongside it." : " Target moments matched; the transported league is the population-relevant ranking.")
    };
  }

  var api = { weights: weights, fit: fit, run: run, _phi: _phi, _inv: _inv };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmTransportedNMA = api;
})(typeof window !== "undefined" ? window : globalThis);
