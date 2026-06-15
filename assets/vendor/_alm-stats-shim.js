/* _alm-stats-shim.js — tiny statistics shim that satisfies the optional
 * `global.AlmMaCore` / `global.AlmStats` dependencies of the vendored allmeta
 * engines (uwls.js, rve.js, selmodel.js). Without it those engines fall back to
 * a z=1.96 critical value; with it they use the correct Student-t quantile
 * (advanced-stats.md: "HKSJ df — use qt not qnorm; t matters when k<30").
 *
 * Pure JS, zero deps. The t-CDF/quantile reuse the R-validated incomplete-beta
 * already proven bit-exact vs R qt in funnel-diagnostics.js. Must load BEFORE
 * uwls.js / rve.js / selmodel.js.
 */
(function (global) {
  'use strict';
  if (global.AlmMaCore && global.AlmStats) return; // don't clobber a real ma-core

  function _lnGamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 1.208650973866179e-3, -5.395239384953e-6];
    var y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
    var s = 1.000000000190015;
    for (var j = 0; j < 6; j++) { y++; s += c[j] / y; }
    return -t + Math.log(2.5066282746310005 * s / x);
  }
  function _betacf(a, b, x) {
    var F = 1e-300, c = 1, d = 1 - (a + b) * x / (a + 1);
    if (Math.abs(d) < F) d = F; d = 1 / d; var h = d;
    for (var m = 1; m <= 300; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((a - 1 + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < F) d = F; c = 1 + aa / c; if (Math.abs(c) < F) c = F;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + 1 + m2));
      d = 1 + aa * d; if (Math.abs(d) < F) d = F; c = 1 + aa / c; if (Math.abs(c) < F) c = F;
      d = 1 / d; var del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break;
    }
    return h;
  }
  function _betai(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var bt = Math.exp(_lnGamma(a + b) - _lnGamma(a) - _lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * _betacf(a, b, x) / a : 1 - bt * _betacf(b, a, 1 - x) / b;
  }
  // Student-t lower CDF P(T<=t | df).
  function tcdf(t, df) {
    if (!(df > 0)) return 0.5 * (1 + _erf(t / Math.SQRT2));
    var x = df / (df + t * t), ib = 0.5 * _betai(df / 2, 0.5, x);
    return t >= 0 ? 1 - ib : ib;
  }
  // Student-t quantile via bisection on tcdf.
  function qt(p, df) {
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    if (!(df > 0)) return _qnorm(p);
    var lo = -1000, hi = 1000;
    for (var i = 0; i < 200; i++) { var m = 0.5 * (lo + hi); if (tcdf(m, df) < p) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
  }
  function _erf(x) {
    var t = 1 / (1 + 0.3275911 * Math.abs(x));
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }
  // Acklam inverse-normal.
  function _qnorm(p) {
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
  // Pool used by trimfill.js (FE + DL) and as the selmodel ML start. Honors
  // opts.method: 'FE' -> τ²=0 (fixed effect); anything else -> DerSimonian-Laird
  // random effects. z-based CIs (metafor's default for FE and DL).
  function pool(yi, vi, opts) {
    opts = opts || {};
    var method = opts.method || 'DL';
    var k = yi.length, i, w, sw = 0, swy = 0;
    for (i = 0; i < k; i++) { w = 1 / vi[i]; sw += w; swy += w * yi[i]; }
    var muFE = swy / sw, Q = 0;
    for (i = 0; i < k; i++) Q += (yi[i] - muFE) * (yi[i] - muFE) / vi[i];
    var sw2 = 0; for (i = 0; i < k; i++) sw2 += 1 / (vi[i] * vi[i]);
    var c = sw - sw2 / sw, df = k - 1;
    var tau2 = (method === 'FE') ? 0 : (c > 0 ? Math.max(0, (Q - df) / c) : 0);
    var sw3 = 0, swy3 = 0;
    for (i = 0; i < k; i++) { w = 1 / (vi[i] + tau2); sw3 += w; swy3 += w * yi[i]; }
    var mu = swy3 / sw3, se = Math.sqrt(1 / sw3);
    return { mu: mu, tau2: tau2, se: se, ciLo: mu - 1.959963984540054 * se, ciHi: mu + 1.959963984540054 * se, Q: Q, k: k };
  }

  global.AlmMaCore = global.AlmMaCore || { _qt: qt, _qnorm: _qnorm, pool: pool };
  global.AlmStats = global.AlmStats || { qt: qt, pt: tcdf };
})(typeof window !== 'undefined' ? window : this);
