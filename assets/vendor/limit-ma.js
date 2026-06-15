/* limit-ma.js — Rücker et al. (2011) limit meta-analysis.
 *
 * Engine extracted VERBATIM from allmeta/limit-ma/index.html (the inline
 * limitMA/radialReg/dl/pool functions), which is verified vs
 * metasens::limitmeta(method.adjust='beta0') — see allmeta limit-ma/tests
 * (limit-oracle.json): on the limit-tiny fixture the adjusted estimate
 * TE.adjust=0.411998010092, seTE.adjust=0.088792115893, beta_r=0.204805826788,
 * G²=0.313520932541.
 *
 * The small-study-effect-adjusted ("limit") estimate is what the pooled effect
 * would converge to if all studies were infinitely precise: it shrinks each
 * study toward the radial-regression line and re-pools. A SENSITIVITY analysis
 * (advanced-stats.md) — reported alongside, never instead of, the RE primary.
 *
 * API: AlmLimitMA.limitMA(rows) where rows = [{ te, se }, ...] (effect + SE on
 * the analysis scale). Returns { limit, seLimit, slope, alpha_r, beta_r,
 * te_limit, Q, Q_small, Q_resid, G_squared, tau2 }.
 */
(function (global) {
  'use strict';

  function pool(rows, tau2) {
    tau2 = tau2 === undefined ? 0 : tau2;
    var w = rows.map(function (r) { return 1 / (r.se * r.se + tau2); });
    var sw = w.reduce(function (a, b) { return a + b; }, 0);
    var mean = rows.reduce(function (acc, r, i) { return acc + w[i] * r.te; }, 0) / sw;
    var seMean = Math.sqrt(1 / sw);
    var Q = rows.reduce(function (acc, r, i) { return acc + w[i] * (r.te - mean) * (r.te - mean); }, 0);
    return { mean: mean, seMean: seMean, sw: sw, Q: Q };
  }

  function dl(rows) {
    var w0 = rows.map(function (r) { return 1 / (r.se * r.se); });
    var sw = w0.reduce(function (a, b) { return a + b; }, 0);
    var muFE = rows.reduce(function (a, r, i) { return a + w0[i] * r.te; }, 0) / sw;
    var Q = rows.reduce(function (a, r, i) { return a + w0[i] * (r.te - muFE) * (r.te - muFE); }, 0);
    var df = rows.length - 1;
    var sumW2 = w0.reduce(function (a, b) { return a + b * b; }, 0);
    var tau2 = Math.max(0, (Q - df) / (sw - sumW2 / sw));
    return { tau2: tau2, muFE: muFE };
  }

  function _mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
  function _varS(a) {
    var m = _mean(a), n = a.length;
    return a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (n - 1);
  }

  // Faithful port of metasens:::radialregression(TE, seTE, k):
  // OLS of (TE/seTE) on (1/seTE) in the Galbraith/radial plot.
  function radialReg(te, se, k) {
    var x = se.map(function (s) { return 1 / s; });
    var y = te.map(function (t, i) { return t / se[i]; });
    var xb = _mean(x), yb = _mean(y);
    var Sxx = 0, Sxy = 0;
    for (var i = 0; i < k; i++) {
      Sxx += (x[i] - xb) * (x[i] - xb);
      Sxy += (x[i] - xb) * (y[i] - yb);
    }
    var slope = Sxy / Sxx;
    var intercept = yb - slope * xb;
    var sse = 0, sst = 0;
    for (var j = 0; j < k; j++) {
      var fit = intercept + slope * x[j];
      sse += (y[j] - fit) * (y[j] - fit);
      sst += (y[j] - yb) * (y[j] - yb);
    }
    var sigma = Math.sqrt(sse / (k - 2));
    var rsq = 1 - sse / sst;
    var invSe = se.map(function (s) { return 1 / s; });
    var seSlope = 1 / Math.sqrt(_varS(invSe)) / Math.sqrt(k - 1);
    var seInt = seSlope * _mean(se.map(function (s) { return 1 / (s * s); }));
    return { intercept: intercept, slope: slope, sigma: sigma,
             r_squared: rsq, se_slope: seSlope, se_intercept: seInt };
  }

  // Rücker et al. (2011) limit meta-analysis — metasens::limitmeta(method.adjust='beta0').
  function limitMA(rows) {
    if (!rows || rows.length < 3) return null;
    var k = rows.length;
    var te = rows.map(function (r) { return r.te; });
    var se = rows.map(function (r) { return r.se; });
    var d = dl(rows);
    var tau2 = d.tau2, tau = Math.sqrt(tau2);

    var wRandom = rows.map(function (r) { return 1 / (r.se * r.se + tau2); });
    var seTau = wRandom.map(function (w) { return Math.sqrt(1 / w); });

    var regF = radialReg(te, se, k);
    var regR = radialReg(te, seTau, k);
    var alphaR = regR.intercept;
    var betaR = regR.slope;

    var teLimit = te.map(function (t, i) {
      return betaR + Math.sqrt(tau2 / (seTau[i] * seTau[i])) * (t - betaR);
    });
    var regL = radialReg(teLimit, se.slice(), k);

    var TEadjust = betaR + tau * alphaR;
    var sqrtW = wRandom.map(Math.sqrt);
    var vsw = _varS(sqrtW);
    var varBeta = 1 / vsw / (k - 1);
    var varAlpha = _mean(wRandom) / vsw / (k - 1);
    var covAB = -_mean(sqrtW) / vsw / (k - 1);
    var seAdjust = Math.sqrt(varBeta + tau2 * varAlpha + 2 * tau * covAB);

    var Q = pool(rows, 0).Q;
    var Qresid = regF.sigma * regF.sigma * (k - 2);
    var Qsmall = Q - Qresid;
    var Gsquared = 1 - regL.r_squared;

    return {
      limit: TEadjust, seLimit: seAdjust, slope: betaR,
      alpha_r: alphaR, beta_r: betaR, te_limit: teLimit,
      Q: Q, Q_small: Qsmall, Q_resid: Qresid, G_squared: Gsquared, tau2: tau2,
    };
  }

  var api = { limitMA: limitMA, pool: pool, dl: dl, radialReg: radialReg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AlmLimitMA = api;
})(typeof window !== 'undefined' ? window : this);
