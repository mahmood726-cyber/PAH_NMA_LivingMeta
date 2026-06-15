/* shared/nma-meta-regression.js — network meta-regression with covariate
 * interactions (Cooper et al. 2009; Dias et al. 2018 NICE TSD 3).
 *
 * Extends standard NMA by adding a treatment × covariate interaction
 * for each non-reference treatment. Contrast-level model:
 *
 *   y_i = X_i β + Z_i γ + δ_i + ε_i
 *
 * where
 *   X_i = treatment-contrast incidence row (the standard NMA design)
 *   β   = pooled treatment effects vs reference (p = K_treat − 1)
 *   Z_i = X_i .* (x_i − x̄)  (centred study-level covariate × incidence)
 *   γ   = treatment-specific interaction slopes (also p)
 *   δ_i = between-study heterogeneity ~ N(0, τ²)
 *   ε_i = within-study sampling error N(0, v_i)
 *
 * Estimation: random-effects τ² via Paule-Mandel iteration (matches
 * netmeta::netmetareg default); β, γ via GLS at the converged τ².
 *
 * Returns: per-treatment β̂ at the mean covariate, γ̂ (interaction
 * slope), and predicted β̂(x) at user-supplied covariate values.
 *
 * Reference: Cooper NJ, Sutton AJ, Morris D, Ades AE, Welton NJ 2009,
 * "Addressing between-study heterogeneity and inconsistency in mixed
 * treatment comparisons", Stat Med 28(14):1861-1881. Dias S, Ades AE,
 * Welton NJ, Jansen JP, Sutton AJ 2018, "Network Meta-Analysis for
 * Decision-Making", Wiley §10 (NICE DSU TSD 3).
 */
(function (global) {
  "use strict";

  // ---- Matrix utilities (mini) ------------------------------------------

  function zeros(n, m) {
    var A = new Array(n);
    for (var i = 0; i < n; i++) { A[i] = new Array(m); for (var j = 0; j < m; j++) A[i][j] = 0; }
    return A;
  }
  function identity(n) {
    var I = zeros(n, n);
    for (var i = 0; i < n; i++) I[i][i] = 1;
    return I;
  }
  function inverse(A) {
    var n = A.length;
    var M = new Array(n);
    for (var i = 0; i < n; i++) M[i] = A[i].slice().concat(identity(n)[i]);
    for (var c = 0; c < n; c++) {
      var pivRow = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivRow][c])) pivRow = r;
      if (Math.abs(M[pivRow][c]) < 1e-14) throw new Error("singular");
      if (pivRow !== c) { var tmp = M[c]; M[c] = M[pivRow]; M[pivRow] = tmp; }
      var piv = M[c][c];
      for (var j = 0; j < 2 * n; j++) M[c][j] /= piv;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c) continue;
        var f = M[r2][c];
        if (f === 0) continue;
        for (var j2 = 0; j2 < 2 * n; j2++) M[r2][j2] -= f * M[c][j2];
      }
    }
    var inv = zeros(n, n);
    for (var ii = 0; ii < n; ii++) for (var jj = 0; jj < n; jj++) inv[ii][jj] = M[ii][n + jj];
    return inv;
  }
  function matMul(A, B) {
    var n = A.length, m = B[0].length, k = B.length;
    var C = zeros(n, m);
    for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) {
      var s = 0;
      for (var t = 0; t < k; t++) s += A[i][t] * B[t][j];
      C[i][j] = s;
    }
    return C;
  }
  function matVec(A, v) {
    var n = A.length, m = v.length;
    var out = new Array(n);
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (var j = 0; j < m; j++) s += A[i][j] * v[j];
      out[i] = s;
    }
    return out;
  }

  // ---- GLS at fixed τ² --------------------------------------------------

  function _fitGLS(X, y, v, tau2) {
    var n = y.length, p = X[0].length;
    var sqrtWt = v.map(function (vi) { return 1 / (vi + tau2); });
    // X'WX, X'Wy
    var XtWX = zeros(p, p);
    var XtWy = new Array(p).fill(0);
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < p; j++) {
        XtWy[j] += X[i][j] * sqrtWt[i] * y[i];
        for (var k = 0; k < p; k++) XtWX[j][k] += X[i][j] * sqrtWt[i] * X[i][k];
      }
    }
    var cov = inverse(XtWX);
    var beta = matVec(cov, XtWy);
    // Residual Q
    var Q = 0;
    for (var i2 = 0; i2 < n; i2++) {
      var fit = 0;
      for (var j2 = 0; j2 < p; j2++) fit += X[i2][j2] * beta[j2];
      Q += sqrtWt[i2] * (y[i2] - fit) * (y[i2] - fit);
    }
    return { beta: beta, cov: cov, Q: Q, n: n, p: p };
  }

  // Paule-Mandel τ² via bisection on Q(τ²) = df.
  function _tau2_PM(X, y, v) {
    var n = y.length, p = X[0].length;
    var df = Math.max(1, n - p);
    var fit0 = _fitGLS(X, y, v, 0);
    if (fit0.Q <= df) return 0;
    var lo = 0, hi = Math.max(0.01, fit0.Q / df);
    var Qat = function (t2) { return _fitGLS(X, y, v, t2).Q; };
    for (var g = 0; g < 50 && Qat(hi) > df; g++) hi *= 2;
    for (var iter = 0; iter < 60; iter++) {
      var mid = 0.5 * (lo + hi);
      if (Qat(mid) > df) lo = mid; else hi = mid;
      if (hi - lo < 1e-10) break;
    }
    return 0.5 * (lo + hi);
  }

  // ---- Main fit ---------------------------------------------------------
  //
  // rows: [ { trtA, trtB, yi, sei, covariate } ]
  // treatments: ordered array of treatment labels (first = reference)
  // opts.predictAt: array of covariate values at which to predict β̂
  //
  // Output: { beta_at_mean, gamma, cov, predictions: [{x, perTreatment}], … }

  function fit(rows, treatments, opts) {
    opts = opts || {};
    if (!Array.isArray(rows) || !rows.length) throw new Error("no rows");
    if (!Array.isArray(treatments) || treatments.length < 2) throw new Error("need >= 2 treatments");
    var p = treatments.length - 1;
    var trtIndex = Object.create(null);
    for (var t = 0; t < treatments.length; t++) trtIndex[treatments[t]] = t;

    // Centre the covariate at its mean across rows (Cooper 2009 recommends
    // centring so β represents the effect at the average study).
    var xMean = 0, xN = 0;
    for (var i = 0; i < rows.length; i++) {
      if (Number.isFinite(rows[i].covariate)) { xMean += rows[i].covariate; xN += 1; }
    }
    if (xN === 0) throw new Error("no rows have a finite covariate");
    xMean /= xN;

    // Build the augmented design X_aug (n × 2p): first p cols = treatment
    // incidence, next p cols = (x_i − x̄) × incidence (the interaction).
    var X = [], y = [], v = [];
    for (var i2 = 0; i2 < rows.length; i2++) {
      var r = rows[i2];
      if (!Number.isFinite(r.yi) || !Number.isFinite(r.sei) || r.sei <= 0) continue;
      if (!Number.isFinite(r.covariate)) continue;
      var iA = trtIndex[r.trtA], iB = trtIndex[r.trtB];
      if (iA == null || iB == null) continue;
      var row = new Array(2 * p).fill(0);
      // Standard NMA incidence: +1 at trtB, −1 at trtA (skip reference).
      if (iA > 0) row[iA - 1] = -1;
      if (iB > 0) row[iB - 1] = +1;
      // Interaction columns: same pattern multiplied by (x − x̄).
      var xc = r.covariate - xMean;
      if (iA > 0) row[p + (iA - 1)] = -xc;
      if (iB > 0) row[p + (iB - 1)] = +xc;
      X.push(row); y.push(r.yi); v.push(r.sei * r.sei);
    }
    if (X.length < 2 * p) {
      throw new Error("not enough rows (" + X.length + ") to identify " + (2 * p) + " parameters");
    }

    var tau2 = _tau2_PM(X, y, v);
    var fitFinal = _fitGLS(X, y, v, tau2);
    var beta = fitFinal.beta.slice(0, p);
    var gamma = fitFinal.beta.slice(p);
    var Z975 = 1.959963984540054;

    // Per-treatment β̂(x) prediction at requested covariate values.
    var predAt = Array.isArray(opts.predictAt) ? opts.predictAt : [xMean];
    var predictions = predAt.map(function (x) {
      var xc = x - xMean;
      var perTreatment = {};
      perTreatment[treatments[0]] = { estimate: 0, se: 0, ci_lo: 0, ci_hi: 0 };
      for (var k = 0; k < p; k++) {
        var est = beta[k] + gamma[k] * xc;
        // Variance: Var(β + xc·γ) = Var(β) + xc²·Var(γ) + 2·xc·Cov(β, γ)
        var vEst = fitFinal.cov[k][k]
                 + xc * xc * fitFinal.cov[p + k][p + k]
                 + 2 * xc * fitFinal.cov[k][p + k];
        var se = Math.sqrt(Math.max(0, vEst));
        perTreatment[treatments[k + 1]] = {
          estimate: est, se: se,
          ci_lo: est - Z975 * se, ci_hi: est + Z975 * se,
        };
      }
      return { x: x, perTreatment: perTreatment };
    });

    var betaSummary = {};
    var gammaSummary = {};
    for (var k2 = 0; k2 < p; k2++) {
      var seB = Math.sqrt(Math.max(0, fitFinal.cov[k2][k2]));
      var seG = Math.sqrt(Math.max(0, fitFinal.cov[p + k2][p + k2]));
      betaSummary[treatments[k2 + 1]] = {
        estimate: beta[k2], se: seB,
        ci_lo: beta[k2] - Z975 * seB, ci_hi: beta[k2] + Z975 * seB,
      };
      gammaSummary[treatments[k2 + 1]] = {
        estimate: gamma[k2], se: seG,
        ci_lo: gamma[k2] - Z975 * seG, ci_hi: gamma[k2] + Z975 * seG,
      };
    }

    return {
      ok: true,
      treatments: treatments, reference: treatments[0],
      xMean: xMean, xRange: { min: Math.min.apply(null, predAt), max: Math.max.apply(null, predAt) },
      beta_at_mean: betaSummary,
      gamma: gammaSummary,
      predictions: predictions,
      tau2: tau2, Q: fitFinal.Q,
      n: y.length, p: 2 * p,
    };
  }

  var api = { fit: fit, _fitGLS: _fitGLS, _tau2_PM: _tau2_PM };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmNmaMetaReg = api;
})(typeof window !== "undefined" ? window : globalThis);
