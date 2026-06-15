/* nma-dbt.js — design-by-treatment interaction global inconsistency test for
 * NMA (Higgins et al. 2012; = netmeta::decomp.design global Q). Compares the
 * consistency model (basic-parameter contrasts only) against a full-design
 * model that gives each design its own contrast: Q_cons − Q_full ~ χ² on
 * df_cons − df_full.
 *
 * Engine extracted VERBATIM from allmeta/nma-inconsistency/index.html
 * (fitNMA / dbt / chiSqCDF + matrix utils), which verifies vs R's exact
 * pchisq (Numerical-Recipes regularised incomplete gamma, ~1e-14).
 *
 * Complements the kit's existing node-splitting (nma-consistency.js) with the
 * single global inconsistency test. NMA only; needs ≥1 closed loop (designs >
 * basic parameters) or it reports "unidentifiable".
 *
 * API: AlmNmaDBT.dbt(rows, tau2) and .fitNMA(rows, refTrt, tau2) and
 *   .estimateTau2(rows, 'DL'|'PM'|'FE'); rows = [{ A, B, te, se }, ...].
 *   dbt returns { Q, df, p[, note] }.
 */
(function (global) {
  'use strict';

  function zeros(n, m) { return Array.from({ length: n }, function () { return Array(m).fill(0); }); }
  function transpose(A) { return A[0].map(function (_, j) { return A.map(function (r) { return r[j]; }); }); }
  function matMul(A, B) {
    var n = A.length, m = B[0].length, k = B.length, C = zeros(n, m);
    for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) for (var p = 0; p < k; p++) C[i][j] += A[i][p] * B[p][j];
    return C;
  }
  function matVec(A, v) { return A.map(function (r) { return r.reduce(function (s, x, j) { return s + x * v[j]; }, 0); }); }
  function invert(M) {
    var n = M.length;
    var A = M.map(function (r, i) { return r.concat(Array.from({ length: n }, function (_, j) { return i === j ? 1 : 0; })); });
    for (var i = 0; i < n; i++) {
      var piv = A[i][i];
      if (Math.abs(piv) < 1e-14) {
        for (var k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > 1e-14) { var tmp = A[i]; A[i] = A[k]; A[k] = tmp; piv = A[i][i]; break; }
      }
      if (Math.abs(piv) < 1e-14) throw new Error('singular');
      for (var j = 0; j < 2 * n; j++) A[i][j] /= piv;
      for (var k2 = 0; k2 < n; k2++) if (k2 !== i) { var f = A[k2][i]; for (var j2 = 0; j2 < 2 * n; j2++) A[k2][j2] -= f * A[i][j2]; }
    }
    return A.map(function (r) { return r.slice(n); });
  }

  function fitNMA(rows, refTrt, tau2) {
    var t2 = (typeof tau2 === 'number' && isFinite(tau2) && tau2 > 0) ? tau2 : 0;
    var trtSet = new Set();
    rows.forEach(function (r) { trtSet.add(r.A); trtSet.add(r.B); });
    var trts = Array.from(trtSet).sort();
    if (!refTrt || trts.indexOf(refTrt) < 0) refTrt = trts[0];
    trts = [refTrt].concat(trts.filter(function (t) { return t !== refTrt; }));
    var idx = {}; trts.forEach(function (t, i) { idx[t] = i; });
    var nBasic = trts.length - 1;
    var X = zeros(rows.length, nBasic);
    var y = rows.map(function (r) { return r.te; });
    var w = rows.map(function (r) { return 1 / (r.se * r.se + t2); });
    rows.forEach(function (r, i) { var iA = idx[r.A], iB = idx[r.B]; if (iA > 0) X[i][iA - 1] = 1; if (iB > 0) X[i][iB - 1] = -1; });
    var Xt = transpose(X);
    var XtW = Xt.map(function (rx) { return rx.map(function (x, j) { return x * w[j]; }); });
    var XtWX = matMul(XtW, X);
    var XtWy = matVec(XtW, y);
    var cov = invert(XtWX);
    var beta = matVec(cov, XtWy);
    var fit = y.map(function (yi, i) { return X[i].reduce(function (s, x, j) { return s + x * beta[j]; }, 0); });
    var dev = y.map(function (yi, i) { return w[i] * (yi - fit[i]) * (yi - fit[i]); });
    var Q = dev.reduce(function (a, b) { return a + b; }, 0);
    var df = Math.max(0, rows.length - nBasic);
    return { trts: trts, idx: idx, X: X, y: y, w: w, beta: beta, cov: cov, Q: Q, df: df, dev: dev, nBasic: nBasic, refTrt: refTrt, tau2: t2 };
  }

  function tau2_DL(rows) {
    var fit0 = fitNMA(rows, null, 0);
    if (fit0.df <= 0) return 0;
    var X = fit0.X, w = fit0.w, cov = fit0.cov, p = fit0.nBasic, n = fit0.X.length;
    var XtW2X = zeros(p, p);
    for (var i = 0; i < n; i++) {
      var wi2 = w[i] * w[i];
      for (var a = 0; a < p; a++) { var xa = X[i][a]; if (xa === 0) continue; for (var b = 0; b < p; b++) XtW2X[a][b] += xa * wi2 * X[i][b]; }
    }
    var trCW2 = 0;
    for (var a2 = 0; a2 < p; a2++) for (var b2 = 0; b2 < p; b2++) trCW2 += cov[a2][b2] * XtW2X[b2][a2];
    var sumW = w.reduce(function (s, x) { return s + x; }, 0);
    var denom = sumW - trCW2;
    if (denom <= 1e-12) return 0;
    return Math.max(0, (fit0.Q - fit0.df) / denom);
  }
  function tau2_PM(rows) {
    var fit0 = fitNMA(rows, null, 0);
    if (fit0.df <= 0) return 0;
    var Qat = function (t2) { return fitNMA(rows, null, t2).Q; };
    if (Qat(0) <= fit0.df) return 0;
    var lo = 0, hi = Math.max(0.001, fit0.Q / fit0.df);
    for (var g = 0; g < 50 && Qat(hi) > fit0.df; g++) hi *= 2;
    for (var i = 0; i < 60; i++) { var mid = 0.5 * (lo + hi); if (Qat(mid) > fit0.df) lo = mid; else hi = mid; if (hi - lo < 1e-10) break; }
    return 0.5 * (lo + hi);
  }
  function estimateTau2(rows, method) {
    if (method === 'DL') return tau2_DL(rows);
    if (method === 'PM') return tau2_PM(rows);
    return 0;
  }

  function _lngamma(z) {
    var g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - _lngamma(1 - z);
    z -= 1; var x = c[0];
    for (var i = 1; i < g + 2; i++) x += c[i] / (z + i);
    var t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function _gammp(s, x) {
    if (x <= 0) return 0;
    if (x < s + 1) {
      var ap = s, sum = 1 / s, del = sum;
      for (var n = 0; n < 300; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
      return sum * Math.exp(-x + s * Math.log(x) - _lngamma(s));
    }
    var b = x + 1 - s, c = 1e300, d = 1 / b, h = d;
    for (var i = 1; i < 300; i++) {
      var an = -i * (i - s);
      b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; var del2 = d * c; h *= del2; if (Math.abs(del2 - 1) < 1e-15) break;
    }
    return 1 - Math.exp(-x + s * Math.log(x) - _lngamma(s)) * h;
  }
  function chiSqCDF(x, k) { if (k <= 0 || x <= 0) return 0; return _gammp(k / 2, x / 2); }

  function dbt(rows, tau2) {
    var t2 = (typeof tau2 === 'number' && isFinite(tau2) && tau2 > 0) ? tau2 : 0;
    try {
      var cons = fitNMA(rows, null, t2);
      var tagged = rows.map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; o.__design = [r.A, r.B].sort().join('|'); return o; });
      var designs = Array.from(new Set(tagged.map(function (r) { return r.__design; })));
      if (designs.length <= cons.nBasic) return { Q: cons.Q, df: cons.df, p: NaN, note: 'inconsistency model unidentifiable (designs ≤ basic parameters)' };
      var n = tagged.length, nCols = designs.length;
      var X = Array.from({ length: n }, function () { return Array(nCols).fill(0); });
      tagged.forEach(function (r, i) { X[i][designs.indexOf(r.__design)] = 1; });
      tagged.forEach(function (r, i) { var ab = [r.A, r.B].sort(); if (r.A !== ab[0]) X[i][designs.indexOf(r.__design)] = -1; });
      var y = tagged.map(function (r) { return r.te; });
      var w = tagged.map(function (r) { return 1 / (r.se * r.se + t2); });
      var Xt = X[0].map(function (_, j) { return X.map(function (row) { return row[j]; }); });
      var XtW = Xt.map(function (rx) { return rx.map(function (x, j) { return x * w[j]; }); });
      var k = Xt.length;
      var XtWX = Array.from({ length: k }, function () { return Array(k).fill(0); });
      for (var i = 0; i < k; i++) for (var j = 0; j < k; j++) for (var p = 0; p < n; p++) XtWX[i][j] += XtW[i][p] * X[p][j];
      var inv;
      try { inv = invert(XtWX); } catch (_) { return { Q: cons.Q, df: cons.df, p: NaN, note: 'inconsistency model singular' }; }
      if (!inv) return { Q: cons.Q, df: cons.df, p: NaN, note: 'inconsistency model singular' };
      var XtWy = XtW.map(function (row) { return row.reduce(function (s, v, p) { return s + v * y[p]; }, 0); });
      var beta = inv.map(function (row) { return row.reduce(function (s, v, i) { return s + v * XtWy[i]; }, 0); });
      var fit_ = y.map(function (yi, i) { return X[i].reduce(function (s, x, j) { return s + x * beta[j]; }, 0); });
      var Qfull = y.reduce(function (s, yi, i) { return s + w[i] * (yi - fit_[i]) * (yi - fit_[i]); }, 0);
      var dfFull = Math.max(0, n - nCols);
      var dQ = Math.max(0, cons.Q - Qfull);
      var dDf = Math.max(0, cons.df - dfFull);
      var p2 = dDf > 0 ? 1 - chiSqCDF(dQ, dDf) : NaN;
      return { Q: dQ, df: dDf, p: p2 };
    } catch (e) { return { Q: NaN, df: NaN, p: NaN }; }
  }

  var api = { dbt: dbt, fitNMA: fitNMA, estimateTau2: estimateTau2, chiSqCDF: chiSqCDF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AlmNmaDBT = api;
})(typeof window !== 'undefined' ? window : this);
