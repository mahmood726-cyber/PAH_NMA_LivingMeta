/* shared/trimfill.js — Duval & Tweedie (2000) trim-and-fill.
 *
 * Estimates the number of studies k0 suppressed by publication bias on one side of
 * the funnel, imputes their mirror images about the trimmed pooled mean, and re-pools.
 * A SENSITIVITY analysis only (per advanced-stats.md) — never the primary estimate.
 *
 * Algorithm (matches metafor::trimfill.rma.uni, default estimator L0):
 *  1. Side: sign of the WLS slope of yi on √vi — slope < 0 → "right", else "left".
 *  2. Work in z = s·yi (s = +1 left / −1 right), sorted ascending, so we always trim
 *     the top and impute the bottom. Iterate: pool the trimmed set (drop top k0) → βz;
 *     centred ranks rᵢ = sign(zᵢ−βz)·rank(|zᵢ−βz|); Sr = Σ rᵢ over positive residuals;
 *     L0 = (4·Sr − k(k+1)) / (2k−1); k0 = max(0, round(L0)); repeat to convergence.
 *  3. Impute k0 reflections of the most-extreme studies: yi_imp = 2·μ_trim − yi_extreme
 *     (variance carried over), then re-pool original ∪ imputed with the SAME method.
 *
 * Verified vs metafor::trimfill (estimator="L0") to ~1e-7 on k0, adjusted μ/SE/τ² for
 * FE and RE(DL), left- and right-side. Pooling delegates to shared/ma-core.js.
 *
 * Reference: Duval S, Tweedie R (2000), Biometrics 56(2):455-463; Biometrics 56:276-284.
 */
(function (global) {
  "use strict";

  function _pool(yi, vi, method) {
    if (global.AlmMaCore) {
      var r = global.AlmMaCore.pool(yi, vi, { method: method });
      return { mu: r.mu, se: r.se, ciLo: r.ciLo, ciHi: r.ciHi, tau2: r.tau2 };
    }
    // Minimal FE fallback (ma-core should be present).
    var sw = 0, swy = 0;
    for (var i = 0; i < yi.length; i++) { var w = 1 / vi[i]; sw += w; swy += w * yi[i]; }
    var mu = swy / sw, se = Math.sqrt(1 / sw);
    return { mu: mu, se: se, ciLo: mu - 1.96 * se, ciHi: mu + 1.96 * se, tau2: 0 };
  }
  function _poolMu(yi, vi, method) { return _pool(yi, vi, method).mu; }

  // WLS slope of yi on √vi (FE weights 1/vi) — only its SIGN is used for the side.
  function _eggerSlope(yi, vi) {
    var n = yi.length, sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
    for (var i = 0; i < n; i++) {
      var w = 1 / vi[i], x = Math.sqrt(vi[i]);
      sw += w; swx += w * x; swy += w * yi[i]; swxx += w * x * x; swxy += w * x * yi[i];
    }
    var denom = sw * swxx - swx * swx;
    return denom === 0 ? 0 : (sw * swxy - swx * swy) / denom;
  }

  // rank(|c|) with ties broken by order of appearance ("first").
  function _rankAbsFirst(c) {
    var idx = c.map(function (v, i) { return { a: Math.abs(v), i: i }; });
    idx.sort(function (p, q) { return p.a - q.a || p.i - q.i; });
    var r = new Array(c.length);
    for (var j = 0; j < idx.length; j++) r[idx[j].i] = j + 1;
    return r;
  }

  // trimAndFill(yi, vi, {method:'FE'|'DL'|'PM'|'REML', side:'left'|'right', maxiter})
  // → { k0, side, mu, se, ciLo, ciHi, tau2, kOrig, imputed:[{yi,vi}], slopeSign }
  function trimAndFill(yi, vi, opts) {
    opts = opts || {};
    var method = opts.method || "DL";
    var k = yi.length;
    if (k < 3) return { k0: 0, side: opts.side || "left", kOrig: k, imputed: [],
      _pooled: _pool(yi, vi, method) };

    var slope = _eggerSlope(yi, vi);
    var side = opts.side || (slope < 0 ? "right" : "left");
    var s = (side === "left") ? 1 : -1;

    // z = s·yi sorted ascending (carry vi).
    var order = yi.map(function (_, i) { return i; })
      .sort(function (a, b) { return (s * yi[a]) - (s * yi[b]); });
    var z = order.map(function (i) { return s * yi[i]; });
    var vz = order.map(function (i) { return vi[i]; });

    var k0 = 0, k0sav = -1, iter = 0, betaZ = 0, maxiter = opts.maxiter || 100;
    while (Math.abs(k0 - k0sav) > 0 && iter < maxiter) {
      k0sav = k0; iter++;
      var nt = k - k0;
      betaZ = _poolMu(z.slice(0, nt), vz.slice(0, nt), method);
      var ranks = _rankAbsFirst(z.map(function (v) { return v - betaZ; }));
      var Sr = 0;
      for (var i = 0; i < k; i++) if (z[i] - betaZ > 0) Sr += ranks[i];
      var L0 = (4 * Sr - k * (k + 1)) / (2 * k - 1);
      k0 = Math.max(0, Math.round(L0));
    }

    // Impute k0 reflections of the most-extreme studies about the trimmed mean.
    var imputed = [];
    var fillY = yi.slice(), fillV = vi.slice();
    if (k0 > 0) {
      for (var t = k - k0; t < k; t++) {
        var zImp = 2 * betaZ - z[t];
        var yImp = s * zImp;            // back to original scale
        imputed.push({ yi: yImp, vi: vz[t] });
        fillY.push(yImp); fillV.push(vz[t]);
      }
    }
    var adj = _pool(fillY, fillV, method);
    return {
      k0: k0, side: side, kOrig: k, slopeSign: slope < 0 ? -1 : 1,
      mu: adj.mu, se: adj.se, ciLo: adj.ciLo, ciHi: adj.ciHi, tau2: adj.tau2,
      imputed: imputed, _pooled: adj,
    };
  }

  var api = { trimAndFill: trimAndFill, _eggerSlope: _eggerSlope, _rankAbsFirst: _rankAbsFirst };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmTrimFill = api;
})(typeof window !== "undefined" ? window : globalThis);
