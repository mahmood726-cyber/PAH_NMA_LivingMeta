/* shared/multivariate-ma.js — multivariate / multiple-outcome meta-analysis (mvmeta),
 * matching metafor::rma.mv(yi, V, mods=~outcome-1, random=~outcome|study, struct="UN").
 *
 * Each study reports an m-vector of effect sizes y_i (one per outcome) with a KNOWN m×m
 * within-study covariance S_i. The model is
 *     y_i ~ N(μ, S_i + G),   G = unstructured m×m between-study covariance,
 * so the m outcome means μ are estimated jointly, borrowing strength across the
 * correlated outcomes. Fit by REML: μ is GLS given G; G is found by Nelder-Mead on its
 * Cholesky factor (guaranteeing positive-definiteness). μ SEs from (Σ W_i)⁻¹.
 *
 * fit(studies) — studies: [{ y:[m], S:[[m×m]] }, …] (balanced: every study has all m
 *   outcomes). Returns { mu, muSE, muVcov, G, rho, logLik, m, k }.
 * Verified vs metafor::rma.mv on dat.berkey1998 (multivariate-ma-parity.spec.mjs).
 * No external dependency; no network.
 */
(function (global) {
  "use strict";

  function _matInv(M) {
    var n = M.length, A = M.map(function (r, i) { return r.concat(r.map(function (_, j) { return i === j ? 1 : 0; })); }), c, r, j;
    for (c = 0; c < n; c++) {
      var p = c; for (r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      var t = A[c]; A[c] = A[p]; A[p] = t; var d = A[c][c]; if (Math.abs(d) < 1e-300) return null;
      for (j = 0; j < 2 * n; j++) A[c][j] /= d;
      for (r = 0; r < n; r++) { if (r === c) continue; var f = A[r][c]; for (j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
    }
    return A.map(function (row) { return row.slice(n); });
  }
  function _logdet(M) {
    var n = M.length, A = M.map(function (r) { return r.slice(); }), ld = 0, c, r, j;
    for (c = 0; c < n; c++) {
      var p = c; for (r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (p !== c) { var t = A[c]; A[c] = A[p]; A[p] = t; }
      var d = A[c][c]; if (Math.abs(d) < 1e-300) return -Infinity; ld += Math.log(Math.abs(d));
      for (r = c + 1; r < n; r++) { var f = A[r][c] / d; for (j = c; j < n; j++) A[r][j] -= f * A[c][j]; }
    }
    return ld;
  }
  function _matVec(M, v) { return M.map(function (row) { return row.reduce(function (a, x, j) { return a + x * v[j]; }, 0); }); }
  function _add(A, B) { return A.map(function (row, i) { return row.map(function (v, j) { return v + B[i][j]; }); }); }

  function _nelderMead(f, x0, step, maxit) {
    var n = x0.length, simplex = [x0.slice()], fv = [f(x0)], i, j;
    for (i = 0; i < n; i++) { var pt = x0.slice(); pt[i] += step; simplex.push(pt); fv.push(f(pt)); }
    function order() { var idx = fv.map(function (v, k) { return k; }).sort(function (a, b) { return fv[a] - fv[b]; }); simplex = idx.map(function (k) { return simplex[k]; }); fv = idx.map(function (k) { return fv[k]; }); }
    for (var it = 0; it < (maxit || 1000); it++) {
      order();
      var c = new Array(n).fill(0); for (i = 0; i < n; i++) for (j = 0; j < n; j++) c[j] += simplex[i][j] / n;
      var xr = c.map(function (cc, k) { return cc + (cc - simplex[n][k]); }), fr = f(xr);
      if (fr < fv[0]) { var xe = c.map(function (cc, k) { return cc + 2 * (xr[k] - cc); }), fe = f(xe); if (fe < fr) { simplex[n] = xe; fv[n] = fe; } else { simplex[n] = xr; fv[n] = fr; } }
      else if (fr < fv[n - 1]) { simplex[n] = xr; fv[n] = fr; }
      else { var xc = c.map(function (cc, k) { return cc + 0.5 * (simplex[n][k] - cc); }), fc = f(xc);
        if (fc < fv[n]) { simplex[n] = xc; fv[n] = fc; }
        else { for (var s2 = 1; s2 <= n; s2++) { simplex[s2] = simplex[0].map(function (x0v, k) { return x0v + 0.5 * (simplex[s2][k] - x0v); }); fv[s2] = f(simplex[s2]); } } }
    }
    order(); return { x: simplex[0], f: fv[0] };
  }

  // Build a symmetric PD m×m matrix from its lower-Cholesky params (length m(m+1)/2).
  function _fromChol(x, m) {
    var L = [], t = 0, i, j, d;
    for (i = 0; i < m; i++) { L.push(new Array(m).fill(0)); for (j = 0; j <= i; j++) L[i][j] = x[t++]; }
    var P = [];
    for (i = 0; i < m; i++) { P.push(new Array(m).fill(0)); for (j = 0; j < m; j++) { var s = 0; for (d = 0; d <= Math.min(i, j); d++) s += L[i][d] * L[j][d]; P[i][j] = s; } }
    return P;
  }

  // GLS μ and Σ W_i given G; also returns the REML pieces.
  function _profile(studies, G) {
    var m = G.length, k = studies.length, sumW = [], sumWy = new Array(m).fill(0), i, a, b, Ws = [], lpieces = 0;
    for (a = 0; a < m; a++) sumW.push(new Array(m).fill(0));
    for (i = 0; i < k; i++) {
      var V = _add(studies[i].S, G), ld = _logdet(V), W = _matInv(V);
      if (!W || ld === -Infinity) return null;
      Ws.push(W); lpieces += ld;
      var Wy = _matVec(W, studies[i].y);
      for (a = 0; a < m; a++) { sumWy[a] += Wy[a]; for (b = 0; b < m; b++) sumW[a][b] += W[a][b]; }
    }
    var sumWinv = _matInv(sumW); if (!sumWinv) return null;
    var mu = _matVec(sumWinv, sumWy);
    return { mu: mu, sumW: sumW, sumWinv: sumWinv, Ws: Ws, logdetV: lpieces };
  }

  function fit(studies, opts) {
    opts = opts || {};
    // Fail closed: with k<2 the between-study covariance G is unidentifiable
    // (ybar≡y, so the warm-start divides by k-1=0 → NaN that silently
    // propagates to mu=[null,null]). Throw rather than return a degenerate
    // but schema-valid result a caller can't distinguish from a real fit.
    if (!Array.isArray(studies) || studies.length < 2) {
      throw new Error("multivariate MA requires k>=2 studies (between-study covariance G is unidentifiable with k<2)");
    }
    var k = studies.length, m = studies[0].y.length, i, a, b;
    // warm-start G: diag = max(0, between-study var − mean within var), off-diag 0.
    var ybar = new Array(m).fill(0); studies.forEach(function (s) { for (a = 0; a < m; a++) ybar[a] += s.y[a] / k; });
    var G0 = []; for (a = 0; a < m; a++) G0.push(new Array(m).fill(0));
    studies.forEach(function (s) { for (a = 0; a < m; a++) for (b = 0; b < m; b++) G0[a][b] += (s.y[a] - ybar[a]) * (s.y[b] - ybar[b]) / (k - 1) - s.S[a][b] / k; });
    for (a = 0; a < m; a++) if (!(G0[a][a] > 0)) G0[a][a] = 0.01;
    // chol of G0 (diag floored)
    var L0 = []; for (a = 0; a < m; a++) { L0.push(new Array(m).fill(0)); for (b = 0; b <= a; b++) { var s = G0[a][b]; for (var d = 0; d < b; d++) s -= L0[a][d] * L0[b][d]; L0[a][b] = (a === b) ? Math.sqrt(Math.max(1e-6, s)) : s / L0[b][b]; } }
    var x0 = []; for (a = 0; a < m; a++) for (b = 0; b <= a; b++) x0.push(L0[a][b]);

    var obj = function (x) {
      var G = _fromChol(x, m), pr = _profile(studies, G);
      if (!pr) return 1e12;
      var ll = pr.logdetV + _logdet(pr.sumW);
      for (var ii = 0; ii < k; ii++) { var dv = studies[ii].y.map(function (v, j) { return v - pr.mu[j]; }); ll += dv.reduce(function (acc, dj, j) { return acc + dj * _matVec(pr.Ws[ii], dv)[j]; }, 0); }
      return 0.5 * ll;
    };
    var opt = _nelderMead(obj, x0, 0.05, 2000);
    opt = _nelderMead(obj, opt.x, 0.005, 1000);
    var G = _fromChol(opt.x, m), pr = _profile(studies, G);
    var muSE = pr.sumWinv.map(function (row, j) { return Math.sqrt(Math.max(0, row[j])); });
    // REML constant: -((k-m)/2)·m? metafor's logLik includes the full constant; we report
    // the comparable value: ll = -0.5(Σ logdetV + (y−μ)'W(y−μ) + logdet ΣW) − ((N−p)/2)log(2π)
    // REML logLik: −½[(N−p)log2π + log|V| + quad + log|X'V⁻¹X|] + ½log|X'X|.
    // X is the outcome-indicator design ⇒ X'X = diag(study-count per outcome) = diag(k)
    // for balanced data, so ½log|X'X| = (m/2)·log(k).
    var N = k * m, p = m;
    var logLik = -opt.f - 0.5 * (N - p) * Math.log(2 * Math.PI) + 0.5 * m * Math.log(k);
    var rho = (m === 2) ? G[0][1] / Math.sqrt(G[0][0] * G[1][1]) : null;
    return { mu: pr.mu, muSE: muSE, muVcov: pr.sumWinv, G: G, rho: rho, logLik: logLik, m: m, k: k };
  }

  var api = { fit: fit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmMultivariate = api;
})(typeof window !== "undefined" ? window : globalThis);
