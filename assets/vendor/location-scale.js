/* shared/location-scale.js — location-scale meta-regression (Viechtbauer & López-López
 * 2022), matching metafor::rma(yi, vi, mods=~X, scale=~Z, link="log", method="ML").
 *
 * Standard meta-regression assumes a single residual heterogeneity τ². The location-scale
 * model lets τ² ITSELF depend on moderators through a log link:
 *     location:  E[y_i] = x_iᵀβ
 *     scale:     log τ²_i = z_iᵀα   ⇒   τ²_i = exp(z_iᵀα)
 * so weights w_i = 1/(v_i + τ²_i). Given α, β is the GLS estimate; α is found by ML
 * (Nelder-Mead on the profile log-likelihood). Location SEs come from (XᵀWX)⁻¹; scale
 * SEs from the numeric Hessian of the profile log-likelihood at the optimum (as metafor).
 *
 * fit(yi, vi, X, Z) — X/Z are k×p / k×q design matrices INCLUDING the intercept column.
 *   Returns { beta, betaSE, alpha, alphaSE, tau2: [...], logLik, k }.
 * Reduces to standard ML rma when Z is intercept-only (τ² = exp(α₀)).
 * No external dependency; no network.
 */
(function (global) {
  "use strict";
  var LOG2PI = Math.log(2 * Math.PI);

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
  function _matVec(M, v) { return M.map(function (row) { return row.reduce(function (a, x, j) { return a + x * v[j]; }, 0); }); }

  // GLS location fit at given per-study τ²: β = (XᵀWX)⁻¹ XᵀWy, vcov = (XᵀWX)⁻¹.
  function _gls(y, X, tau2) {
    var k = y.length, p = X[0].length, XtWX = [], XtWy = new Array(p).fill(0), i, a, b;
    for (a = 0; a < p; a++) { XtWX.push(new Array(p).fill(0)); }
    for (i = 0; i < k; i++) {
      var w = 1 / (tau2[i] + 1e-300 + _viShared[i]);
      for (a = 0; a < p; a++) { XtWy[a] += w * X[i][a] * y[i]; for (b = 0; b < p; b++) XtWX[a][b] += w * X[i][a] * X[i][b]; }
    }
    var inv = _matInv(XtWX); if (!inv) return null;
    return { beta: _matVec(inv, XtWy), vcov: inv };
  }

  var _viShared = null; // set per fit() call (avoids threading vi through _gls)

  function _tau2(Z, alpha) { return Z.map(function (z) { return Math.exp(z.reduce(function (s, zj, j) { return s + zj * alpha[j]; }, 0)); }); }

  // ML profile negative log-likelihood at scale coefficients α (β profiled out by GLS).
  function _negLL(y, X, Z, alpha) {
    var k = y.length, tau2 = _tau2(Z, alpha), g = _gls(y, X, tau2);
    if (!g) return 1e12;
    var ll = -0.5 * k * LOG2PI, i;
    for (i = 0; i < k; i++) {
      var s2 = _viShared[i] + tau2[i], e = y[i] - X[i].reduce(function (acc, x, j) { return acc + x * g.beta[j]; }, 0);
      ll += -0.5 * Math.log(s2) - 0.5 * e * e / s2;
    }
    return -ll;
  }

  function _nelderMead(f, x0, step, maxit) {
    var n = x0.length, simplex = [x0.slice()], fv = [f(x0)], i, j;
    for (i = 0; i < n; i++) { var pt = x0.slice(); pt[i] += step; simplex.push(pt); fv.push(f(pt)); }
    function order() { var idx = fv.map(function (v, k) { return k; }).sort(function (a, b) { return fv[a] - fv[b]; }); simplex = idx.map(function (k) { return simplex[k]; }); fv = idx.map(function (k) { return fv[k]; }); }
    for (var it = 0; it < (maxit || 800); it++) {
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

  // Numeric Hessian (central differences) of a scalar function at x.
  function _hessian(f, x, h) {
    var n = x.length, H = [], i, j;
    for (i = 0; i < n; i++) H.push(new Array(n).fill(0));
    var f0 = f(x);
    for (i = 0; i < n; i++) {
      for (j = i; j < n; j++) {
        var hp = (Math.abs(x[i]) + 1) * h, hq = (Math.abs(x[j]) + 1) * h, v;
        if (i === j) {
          var xp = x.slice(); xp[i] += hp; var xm = x.slice(); xm[i] -= hp;
          v = (f(xp) - 2 * f0 + f(xm)) / (hp * hp);
        } else {
          var xpp = x.slice(); xpp[i] += hp; xpp[j] += hq;
          var xpm = x.slice(); xpm[i] += hp; xpm[j] -= hq;
          var xmp = x.slice(); xmp[i] -= hp; xmp[j] += hq;
          var xmm = x.slice(); xmm[i] -= hp; xmm[j] -= hq;
          v = (f(xpp) - f(xpm) - f(xmp) + f(xmm)) / (4 * hp * hq);
        }
        H[i][j] = v; H[j][i] = v;
      }
    }
    return H;
  }

  function fit(yi, vi, X, Z, opts) {
    opts = opts || {};
    var k = yi.length, q = Z[0].length, i, j;
    _viShared = vi;
    // Standardise the non-intercept scale columns so the optimiser is well-scaled
    // (a scale slope multiplying a covariate ranging in the tens must be tiny). We
    // optimise in standardised space then map α and its vcov back exactly (linear).
    var mean = new Array(q).fill(0), sd = new Array(q).fill(1), isIntercept = new Array(q).fill(false);
    for (j = 0; j < q; j++) {
      var col = Z.map(function (z) { return z[j]; }), mu = col.reduce(function (a, b) { return a + b; }, 0) / k;
      var vr = col.reduce(function (a, b) { return a + (b - mu) * (b - mu); }, 0) / k;
      if (vr < 1e-12) { isIntercept[j] = true; mean[j] = 0; sd[j] = 1; } // constant column (intercept)
      else { mean[j] = mu; sd[j] = Math.sqrt(vr); }
    }
    var Zs = Z.map(function (z) { return z.map(function (v, jj) { return isIntercept[jj] ? v : (v - mean[jj]) / sd[jj]; }); });
    // warm-start α (std space): intercept col = log(DL-ish τ²), others 0.
    var sw = 0, swy = 0; for (i = 0; i < k; i++) { var w0 = 1 / vi[i]; sw += w0; swy += w0 * yi[i]; }
    var mu0 = swy / sw, Q = 0; for (i = 0; i < k; i++) Q += (1 / vi[i]) * (yi[i] - mu0) * (yi[i] - mu0);
    var t0 = Math.max(1e-3, (Q - (k - 1)) / sw);
    var a0 = new Array(q).fill(0); for (j = 0; j < q; j++) if (isIntercept[j]) a0[j] = Math.log(t0);
    var obj = function (al) { return _negLL(yi, X, Zs, al); };
    var opt = _nelderMead(obj, a0, 0.4, 1500);
    opt = _nelderMead(obj, opt.x, 0.05, 1000);
    opt = _nelderMead(obj, opt.x, 0.005, 600);
    var as = opt.x; // α in standardised space
    // Jacobian A: α_orig = A·α_std.  For an intercept column j0 and standardised slope
    // columns j: η = α_s[j0] + Σ_j α_s[j]·(z_j−mean_j)/sd_j
    //            = (α_s[j0] − Σ_j α_s[j]·mean_j/sd_j) + Σ_j (α_s[j]/sd_j)·z_j
    var interceptIdx = isIntercept.indexOf(true);
    var A = []; for (i = 0; i < q; i++) { A.push(new Array(q).fill(0)); }
    for (j = 0; j < q; j++) {
      if (isIntercept[j]) { A[j][j] = 1; }
      else { A[j][j] = 1 / sd[j]; if (interceptIdx >= 0) A[interceptIdx][j] += -mean[j] / sd[j]; }
    }
    var alpha = _matVec(A, as);
    var Hs = _hessian(obj, as, 1e-4), HsInv = _matInv(Hs);
    // vcov_orig = A · Hs⁻¹ · Aᵀ
    var alphaSE = alpha.map(function () { return NaN; }), vcovA = null;
    if (HsInv) {
      var AH = A.map(function (row) { return _matVec(HsInv, row); }); // A·Hs⁻¹ (rows)
      vcovA = AH.map(function (row, a2) { return A.map(function (rowB) { return row.reduce(function (s, x, c) { return s + x * rowB[c]; }, 0); }); });
      alphaSE = vcovA.map(function (row, jj) { return Math.sqrt(Math.max(0, row[jj])); });
    }
    var tau2 = _tau2(Z, alpha), g = _gls(yi, X, tau2);
    var betaSE = g.vcov.map(function (row, jj) { return Math.sqrt(Math.max(0, row[jj])); });
    return { beta: g.beta, betaSE: betaSE, betaVcov: g.vcov, alpha: alpha, alphaSE: alphaSE, alphaVcov: vcovA, tau2: tau2, logLik: -opt.f, k: k, q: q };
  }

  var api = { fit: fit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmLocationScale = api;
})(typeof window !== "undefined" ? window : globalThis);
