/* shared/multiplicative-nma.js — multiplicative-heterogeneity network
 * meta-analysis (the network generalisation of UWLS).
 *
 * Standard random-effects NMA ADDS a between-study variance τ² to every
 * contrast's sampling variance. The multiplicative model instead INFLATES all
 * sampling variances by a single overdispersion factor φ. As in the pairwise
 * case (shared/uwls.js, Stanley & Doucouliagos 2015):
 *
 *   • the relative-effect point estimates EQUAL the fixed-effect (common-effect)
 *     NMA estimates — φ does not move them;
 *   • the covariance matrix is the fixed-effect covariance × φ, so every SE is
 *     the fixed-effect SE × √φ;
 *   • φ = Q / (n − p), the residual-deviance / df ratio (UNFLOORED — like
 *     lm(); under-dispersion φ<1 is allowed and simply narrows the CIs);
 *   • confidence intervals use t_{n−p}.
 *
 * Why ship it (advanced-stats.md "NMA multiplicative fallback"): if a funnel /
 * Egger check suggests small-study effects, or the network has ≥1 small-study
 * outlier, the additive RE model can over-shrink and mis-state precision. Fit
 * the multiplicative model ALONGSIDE additive RE and prefer it when AIC favours
 * it by ≥2 (Doi et al.; the multiplicative-vs-additive selection of
 * arXiv:2601.11735). For OBSERVATIONAL networks, inverse-variance RE weights
 * amplify SE-manipulation by primary modellers (Stanley 2025) — the
 * multiplicative / UWLS estimator is the recommended primary there.
 *
 * SCOPE / BOUNDARY: contrast-based core for networks of TWO-ARM trials, where
 * the supplied contrasts are independent. Multi-arm trials induce within-trial
 * correlation between contrasts (shared-arm covariance) that this core does NOT
 * model; feed multi-arm trials as a single chosen contrast each, or use a
 * full multi-arm engine. With two-arm contrasts the fixed-effect fit and Q are
 * bit-identical to netmeta's common-effect model (see tests/test_multiplicative_nma.py).
 *
 * Verified vs R netmeta::netmeta (common-effect TE, Q) + the √φ inflation:
 *   SE_mult[i] = netmeta$seTE.common[i] * sqrt(netmeta$Q / netmeta$df.Q).
 *
 * Reference: Stanley TD, Doucouliagos H. Stat Med 2015;34(13):2116-2127
 * doi:10.1002/sim.6481 (multiplicative model). Network selection per
 * arXiv:2601.11735. Contrast-based NMA: Dias et al. 2018 (NICE DSU TSD 2/3).
 */
(function (global) {
  "use strict";

  // ---- mini matrix utilities (same conventions as nma-meta-regression.js) ----
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
    var n = A.length, M = new Array(n), i;
    for (i = 0; i < n; i++) M[i] = A[i].slice().concat(identity(n)[i]);
    for (var c = 0; c < n; c++) {
      var pivRow = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivRow][c])) pivRow = r;
      if (Math.abs(M[pivRow][c]) < 1e-14) throw new Error("singular network design (is the network connected?)");
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
  function matVec(A, v) {
    var n = A.length, m = v.length, out = new Array(n);
    for (var i = 0; i < n; i++) { var s = 0; for (var j = 0; j < m; j++) s += A[i][j] * v[j]; out[i] = s; }
    return out;
  }

  // Build the contrast incidence design and fit weighted least squares at a
  // given between-study variance tau2 (tau2=0 => fixed/common effect).
  // rows: [{ trtA, trtB, yi, sei }]; treatments[0] is the reference.
  function _fitWLS(X, y, v, tau2) {
    var n = y.length, p = X[0].length, i, j, k;
    var w = new Array(n);
    for (i = 0; i < n; i++) w[i] = 1 / (v[i] + tau2);
    var XtWX = zeros(p, p), XtWy = new Array(p).fill(0);
    for (i = 0; i < n; i++) for (j = 0; j < p; j++) {
      XtWy[j] += X[i][j] * w[i] * y[i];
      for (k = 0; k < p; k++) XtWX[j][k] += X[i][j] * w[i] * X[i][k];
    }
    var cov = inverse(XtWX);
    var beta = matVec(cov, XtWy);
    var Q = 0;
    for (i = 0; i < n; i++) {
      var fit = 0; for (j = 0; j < p; j++) fit += X[i][j] * beta[j];
      Q += w[i] * (y[i] - fit) * (y[i] - fit);
    }
    return { beta: beta, cov: cov, Q: Q, w: w, n: n, p: p };
  }

  // Paule–Mandel τ² for the additive RE comparison: solve Q(τ²) = df.
  function _tau2_PM(X, y, v) {
    var n = y.length, p = X[0].length, df = Math.max(1, n - p);
    var Qat = function (t2) { return _fitWLS(X, y, v, t2).Q; };
    if (Qat(0) <= df) return 0;
    var lo = 0, hi = Math.max(0.01, Qat(0) / df);
    for (var g = 0; g < 60 && Qat(hi) > df; g++) hi *= 2;
    for (var it = 0; it < 80; it++) {
      var mid = 0.5 * (lo + hi);
      if (Qat(mid) > df) lo = mid; else hi = mid;
      if (hi - lo < 1e-12) break;
    }
    return 0.5 * (lo + hi);
  }

  // Profile Gaussian log-likelihood at (beta, dispersion) for AIC. For the
  // additive model the per-row variance is v_i + tau2; for the multiplicative
  // model it is phiML * v_i with the ML phiML = Q_FE / n (NB: /n, the ML scale,
  // not the /(n−p) moment φ used for the reported SEs).
  function _logLik(X, y, v, beta, varOf) {
    var n = y.length, p = beta.length, i, j, ll = 0, TWO_PI = 2 * Math.PI;
    for (i = 0; i < n; i++) {
      var fit = 0; for (j = 0; j < p; j++) fit += X[i][j] * beta[j];
      var vi = varOf(i);
      ll += -0.5 * (Math.log(TWO_PI * vi) + (y[i] - fit) * (y[i] - fit) / vi);
    }
    return ll;
  }

  function _buildDesign(rows, treatments) {
    var p = treatments.length - 1, idx = Object.create(null), t;
    for (t = 0; t < treatments.length; t++) idx[treatments[t]] = t;
    var X = [], y = [], v = [], used = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!Number.isFinite(r.yi) || !Number.isFinite(r.sei) || r.sei <= 0) continue;
      var iA = idx[r.trtA], iB = idx[r.trtB];
      if (iA == null || iB == null || iA === iB) continue;
      var row = new Array(p).fill(0);
      if (iA > 0) row[iA - 1] = -1;   // standard contrast incidence: −1 ref-side
      if (iB > 0) row[iB - 1] = +1;   //                              +1 active-side
      X.push(row); y.push(r.yi); v.push(r.sei * r.sei); used.push(r);
    }
    return { X: X, y: y, v: v, used: used, p: p, idx: idx };
  }

  // Main entry. rows: [{trtA,trtB,yi,sei}], treatments: ordered (ref first).
  // opts.level (0.95). Returns the multiplicative fit + the additive-RE
  // comparison + AIC verdict, or { ok:false, error }.
  function fit(rows, treatments, opts) {
    opts = opts || {};
    try {
      if (!Array.isArray(rows) || !rows.length) throw new Error("no contrast rows");
      if (!Array.isArray(treatments) || treatments.length < 2) throw new Error("need >= 2 treatments");
      var d = _buildDesign(rows, treatments), p = d.p, n = d.y.length;
      if (n < p) throw new Error("under-identified: " + n + " contrasts for " + p + " basic parameters");

      // --- fixed-effect / common-effect fit (shared by both models) ---
      var fe = _fitWLS(d.X, d.y, d.v, 0);
      var df = Math.max(0, n - p);
      var phi = df > 0 ? fe.Q / df : 1;          // multiplicative overdispersion (moment, unfloored)
      var level = opts.level || 0.95;
      var tCrit = (global.AlmMaCore && global.AlmMaCore._qt && df > 0)
        ? global.AlmMaCore._qt(1 - (1 - level) / 2, df) : 1.959963984540054;

      // Per-treatment relative effects vs reference (multiplicative SEs).
      var effects = {};
      effects[treatments[0]] = { vs: treatments[0], estimate: 0, seFE: 0, se: 0, ciLo: 0, ciHi: 0 };
      for (var kk = 0; kk < p; kk++) {
        var est = fe.beta[kk];
        var seFE = Math.sqrt(Math.max(0, fe.cov[kk][kk]));
        var se = seFE * Math.sqrt(phi);
        effects[treatments[kk + 1]] = {
          vs: treatments[0], estimate: est, seFE: seFE, se: se,
          ciLo: est - tCrit * se, ciHi: est + tCrit * se,
        };
      }

      // --- additive RE comparison (Paule–Mandel τ²) ---
      var tau2 = _tau2_PM(d.X, d.y, d.v);
      var re = _fitWLS(d.X, d.y, d.v, tau2);

      // --- AIC: additive vs multiplicative (both ML, +1 dispersion param) ---
      var llAdd = _logLik(d.X, d.y, d.v, re.beta, function (i) { return d.v[i] + tau2; });
      var phiML = n > 0 ? fe.Q / n : 1;          // ML overdispersion for the likelihood
      var llMult = _logLik(d.X, d.y, d.v, fe.beta, function (i) { return phiML * d.v[i]; });
      var aicAdd = -2 * llAdd + 2 * (p + 1);
      var aicMult = -2 * llMult + 2 * (p + 1);
      var dAIC = aicAdd - aicMult;               // >0 => multiplicative preferred
      var prefer = dAIC >= 2 ? "multiplicative" : (dAIC <= -2 ? "additive" : "comparable");

      return {
        ok: true,
        model: "multiplicative",
        treatments: treatments, reference: treatments[0],
        effects: effects,
        Q: fe.Q, df: df, phi: phi, I2: df > 0 ? Math.max(0, (fe.Q - df) / fe.Q) : 0,
        n: n, p: p, level: level, tCrit: tCrit,
        additive: { tau2: tau2, aic: aicAdd, logLik: llAdd },
        multiplicative: { phi: phi, phiML: phiML, aic: aicMult, logLik: llMult },
        aicDiff: dAIC, prefer: prefer,
      };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  var api = { fit: fit, _fitWLS: _fitWLS, _tau2_PM: _tau2_PM, _buildDesign: _buildDesign };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmMultiplicativeNMA = api;
})(typeof window !== "undefined" ? window : globalThis);
