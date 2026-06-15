/* shared/selmodel.js — Vevea-Hedges (1995) step-function selection model.
 *
 * Publication-bias model that estimates the unadjusted mean μ, between-study τ², and
 * selection weights δ for p-value intervals, by ML on the weighted (selected) density.
 * The modern complement to trim-and-fill / PET-PEESE / Copas: instead of imputing or
 * regressing, it models the probability that a study is published as a step function of
 * its one-sided p-value.
 *
 * Step-function likelihood (one-sided, alternative="greater"; matches metafor::selmodel
 * type="stepfun"): for study i with effect yᵢ, sampling variance vᵢ, the test p-value is
 * pᵢ = 1 − Φ(yᵢ/√vᵢ). With cutpoints `steps` (ascending p), interval j carries weight δⱼ
 * (δ₁ = 1 for the most-significant interval). With ηᵢ² = vᵢ + τ²:
 *     ℓᵢ = log δ_{j(i)} + log φ(yᵢ; μ, ηᵢ²) − log Aᵢ,
 *     Aᵢ = Σⱼ δⱼ · P(p(Y) ∈ interval j | Y ~ N(μ, ηᵢ²))
 * where each p-cutpoint a maps to the y-boundary √vᵢ · Φ⁻¹(1−a). Maximise Σℓᵢ over
 * (μ, τ², δ₂…) by Nelder-Mead; SE from the inverse numerical Hessian; LRT vs the
 * unadjusted ML (δ all = 1).
 *
 * Verified vs metafor::selmodel(rma(method="ML"), type="stepfun", steps=0.025):
 *   μ=0.59722923 se=0.11093960 τ²=0.02598154 δ₂=0.599915 LRT χ²=0.326738 → ~1e-4.
 *
 * Reference: Vevea JL, Hedges LV (1995), Psychometrika 60:419-435.
 */
(function (global) {
  "use strict";

  function _erf(x) {
    var t = 1 / (1 + 0.3275911 * Math.abs(x));
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }
  function _Phi(z) { return 0.5 * (1 + _erf(z / Math.SQRT2)); }
  // Acklam inverse-normal (for the p-cutpoint → y-boundary map).
  function _qnorm(p) {
    if (global.AlmMaCore && global.AlmMaCore._qnorm) return global.AlmMaCore._qnorm(p);
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pl = 0.02425, q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // Negative log-likelihood of the step model. delta = [1, δ2, δ3, ...] (length = #intervals).
  function _negLL(yi, vi, steps, mu, tau2, delta) {
    if (tau2 < 0) return 1e12;
    var nbnd = steps.length; // y-boundaries per study at each p-cutpoint
    var ll = 0, k = yi.length;
    var zc = steps.map(function (a) { return _qnorm(1 - a); }); // p=a ↔ y=√v·z_a
    for (var i = 0; i < k; i++) {
      var sv = Math.sqrt(vi[i]), eta2 = vi[i] + tau2, eta = Math.sqrt(eta2);
      // which interval does this study's p fall in? p_i = 1-Φ(y/√v); interval j (1-based)
      var pi = 1 - _Phi(yi[i] / sv);
      var j = 0; while (j < nbnd && pi >= steps[j]) j++; // j = # of cutpoints below p_i = interval index
      var wj = delta[j];
      if (wj <= 0) return 1e12;
      // normaliser A_i = Σ_j δ_j P(Y in y-interval j); y-boundaries (descending p ↔ ascending y)
      // p-interval m (1-based 0..nbnd): y in (b_{m}, b_{m-1}] with b at √v·z_{cut}
      var A = 0;
      // Build cumulative Φ at each boundary y = sv*zc[t]: P(Y<=y)=Φ((y-μ)/η)
      // interval 0 (p in [0, steps[0])): y > sv*zc[0]  → prob = 1 - Φ((sv*zc[0]-μ)/η)
      // interval m (1..nbnd-1): sv*zc[m] < y <= sv*zc[m-1]
      // interval nbnd (p in [steps[nbnd-1],1]): y <= sv*zc[nbnd-1]
      var prevPhi = 1; // Φ at +∞
      for (var m = 0; m <= nbnd; m++) {
        var curPhi = (m < nbnd) ? _Phi((sv * zc[m] - mu) / eta) : 0; // Φ at -∞ = 0
        A += delta[m] * (prevPhi - curPhi);
        prevPhi = curPhi;
      }
      if (A <= 0) return 1e12;
      var logphi = -0.5 * Math.log(2 * Math.PI * eta2) - (yi[i] - mu) * (yi[i] - mu) / (2 * eta2);
      ll += Math.log(wj) + logphi - Math.log(A);
    }
    return -ll;
  }

  // Nelder-Mead on a function of an n-vector.
  function _nelderMead(f, x0, opts) {
    opts = opts || {};
    var n = x0.length, alpha = 1, gamma = 2, rho = 0.5, sigma = 0.5;
    var step = opts.step || 0.25, maxit = opts.maxit || 4000, tol = opts.tol || 1e-12;
    var simplex = [x0.slice()];
    for (var i = 0; i < n; i++) { var p = x0.slice(); p[i] += (p[i] !== 0 ? step * Math.abs(p[i]) : step); simplex.push(p); }
    var fv = simplex.map(f);
    function order() { var idx = fv.map(function (v, i) { return i; }).sort(function (a, b) { return fv[a] - fv[b]; }); simplex = idx.map(function (i) { return simplex[i]; }); fv = idx.map(function (i) { return fv[i]; }); }
    for (var it = 0; it < maxit; it++) {
      order();
      if (Math.abs(fv[n] - fv[0]) < tol) break;
      var cen = new Array(n).fill(0);
      for (var a = 0; a < n; a++) for (var j = 0; j < n; j++) cen[j] += simplex[a][j] / n;
      var xr = cen.map(function (c, j) { return c + alpha * (c - simplex[n][j]); }); var fr = f(xr);
      if (fr < fv[0]) {
        var xe = cen.map(function (c, j) { return c + gamma * (xr[j] - c); }); var fe = f(xe);
        if (fe < fr) { simplex[n] = xe; fv[n] = fe; } else { simplex[n] = xr; fv[n] = fr; }
      } else if (fr < fv[n - 1]) { simplex[n] = xr; fv[n] = fr; }
      else {
        var xc = cen.map(function (c, j) { return c + rho * (simplex[n][j] - c); }); var fc = f(xc);
        if (fc < fv[n]) { simplex[n] = xc; fv[n] = fc; }
        else { for (var s = 1; s <= n; s++) { simplex[s] = simplex[0].map(function (x0v, j) { return x0v + sigma * (simplex[s][j] - x0v); }); fv[s] = f(simplex[s]); } }
      }
    }
    order();
    return { x: simplex[0], f: fv[0] };
  }

  // Fit. opts: { steps:[0.025], method:'ML' (τ² estimator for the unadjusted ref) }.
  // Returns { mu, se, tau2, delta:[1,...], LRT, LRTdf, LRTp, unadjusted:{mu,tau2} }.
  function fit(yi, vi, opts) {
    opts = opts || {};
    var steps = (opts.steps || [0.025]).slice().sort(function (a, b) { return a - b; });
    var nInt = steps.length + 1, nDelta = nInt - 1; // δ_2..δ_nInt estimated
    // Unadjusted ML start (μ, τ²) via ma-core REML/ML pool (use ML-ish: PM≈ML start ok).
    var start = global.AlmMaCore ? global.AlmMaCore.pool(yi, vi, { method: opts.method || "REML" })
      : { mu: yi.reduce(function (a, b) { return a + b; }, 0) / yi.length, tau2: 0 };
    var mu0 = start.mu, t20 = Math.max(1e-6, start.tau2);
    // Parameterise: [μ, log τ², log δ_2 ...]. Objective in that space.
    function unpack(x) {
      var mu = x[0], tau2 = Math.exp(x[1]);
      var delta = [1]; for (var d = 0; d < nDelta; d++) delta.push(Math.exp(x[2 + d]));
      return { mu: mu, tau2: tau2, delta: delta };
    }
    function obj(x) { var u = unpack(x); return _negLL(yi, vi, steps, u.mu, u.tau2, u.delta); }
    var x0 = [mu0, Math.log(t20)]; for (var d = 0; d < nDelta; d++) x0.push(0);
    var opt = _nelderMead(obj, x0, { step: 0.3, maxit: 6000 });
    // polish with a tighter restart
    opt = _nelderMead(obj, opt.x, { step: 0.05, maxit: 6000 });
    var u = unpack(opt.x);

    // SE(μ): numerical Hessian of negLL in NATURAL params (μ, τ², δ_2..) at the optimum.
    var theta = [u.mu, u.tau2].concat(u.delta.slice(1));
    function nllNat(th) {
      var dl = [1]; for (var d = 0; d < nDelta; d++) dl.push(th[2 + d]);
      return _negLL(yi, vi, steps, th[0], th[1], dl);
    }
    var H = _hessian(nllNat, theta);
    var cov = _inv(H);
    var se = (cov && cov[0][0] > 0) ? Math.sqrt(cov[0][0]) : NaN;

    // LRT vs unadjusted (all δ = 1): 2(ll_sel - ll_unadj) ... metafor reports
    // LRT = 2*(logLik(sel) - logLik(unadj-under-same-μ,τ²-free)). Compute unadjusted ML ll.
    var llSel = -opt.f;
    var unadj = _fitUnadjusted(yi, vi, mu0, t20);
    var LRT = 2 * (llSel - unadj.ll);
    return {
      mu: u.mu, se: se, tau2: u.tau2, delta: u.delta,
      LRT: LRT, LRTdf: nDelta, LRTp: 1 - _chi2cdf(Math.max(0, LRT), nDelta),
      unadjusted: { mu: unadj.mu, tau2: unadj.tau2 },
    };
  }

  // Unadjusted normal-normal ML (δ all = 1): just the RE marginal likelihood maximum.
  function _fitUnadjusted(yi, vi, mu0, t20) {
    function nll(x) {
      var mu = x[0], tau2 = Math.exp(x[1]), ll = 0;
      for (var i = 0; i < yi.length; i++) { var e2 = vi[i] + tau2; ll += -0.5 * Math.log(2 * Math.PI * e2) - (yi[i] - mu) * (yi[i] - mu) / (2 * e2); }
      return -ll;
    }
    var o = _nelderMead(nll, [mu0, Math.log(t20)], { step: 0.2, maxit: 4000 });
    return { mu: o.x[0], tau2: Math.exp(o.x[1]), ll: -o.f };
  }

  function _hessian(f, x) {
    var n = x.length, h = x.map(function (v) { return Math.max(1e-4, Math.abs(v) * 1e-3); });
    var H = []; for (var i = 0; i < n; i++) H.push(new Array(n).fill(0));
    for (var i2 = 0; i2 < n; i2++) for (var j = i2; j < n; j++) {
      var xpp = x.slice(), xpm = x.slice(), xmp = x.slice(), xmm = x.slice();
      xpp[i2] += h[i2]; xpp[j] += h[j]; xpm[i2] += h[i2]; xpm[j] -= h[j];
      xmp[i2] -= h[i2]; xmp[j] += h[j]; xmm[i2] -= h[i2]; xmm[j] -= h[j];
      var v = (f(xpp) - f(xpm) - f(xmp) + f(xmm)) / (4 * h[i2] * h[j]);
      H[i2][j] = v; H[j][i2] = v;
    }
    return H;
  }
  function _inv(A) {
    var n = A.length, M = A.map(function (r, i) { return r.slice().concat(Array.from({ length: n }, function (_, j) { return i === j ? 1 : 0; })); });
    for (var c = 0; c < n; c++) {
      var piv = c; for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-14) return null;
      var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      var d = M[c][c]; for (var j = 0; j < 2 * n; j++) M[c][j] /= d;
      for (var r2 = 0; r2 < n; r2++) { if (r2 === c) continue; var f = M[r2][c]; for (var j2 = 0; j2 < 2 * n; j2++) M[r2][j2] -= f * M[c][j2]; }
    }
    return M.map(function (r) { return r.slice(n); });
  }
  function _chi2cdf(x, df) {
    if (x <= 0) return 0;
    // lower regularised incomplete gamma P(df/2, x/2) via series/CF
    var a = df / 2, xx = x / 2;
    function lng(z) { var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 1.208650973866179e-3, -5.395239384953e-6]; var y = z, t = z + 5.5; t -= (z + 0.5) * Math.log(t); var s = 1.000000000190015; for (var j = 0; j < 6; j++) { y++; s += c[j] / y; } return -t + Math.log(2.5066282746310005 * s / z); }
    if (xx < a + 1) { var sum = 1 / a, term = sum; for (var n = 1; n < 300; n++) { term *= xx / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-14) break; } return sum * Math.exp(-xx + a * Math.log(xx) - lng(a)); }
    var b = xx + 1 - a, c2 = 1e300, dd = 1 / b, hh = dd; for (var i = 1; i < 300; i++) { var an = -i * (i - a); b += 2; dd = an * dd + b; if (Math.abs(dd) < 1e-300) dd = 1e-300; c2 = b + an / c2; if (Math.abs(c2) < 1e-300) c2 = 1e-300; dd = 1 / dd; var del = dd * c2; hh *= del; if (Math.abs(del - 1) < 1e-14) break; }
    return 1 - Math.exp(-xx + a * Math.log(xx) - lng(a)) * hh;
  }

  var api = { fit: fit, _negLL: _negLL, _Phi: _Phi, _nelderMead: _nelderMead };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmSelModel = api;
})(typeof window !== "undefined" ? window : globalThis);
