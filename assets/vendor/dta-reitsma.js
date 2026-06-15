/* dta-reitsma.js — full bivariate Reitsma DTA engine (R-verified) + the
 * RapidMetaDTA adapter that dta-bivariate.js already consumes.
 *
 * The dta-bivariate.js panel pools sensitivity and specificity INDEPENDENTLY by
 * DerSimonian-Laird with the between-study correlation fixed at ρ=0 (a documented
 * simplification). This module provides the proper bivariate maximum-likelihood
 * fit (Reitsma 2005 / Harbord) — joint (logit-Se, logit-FPR) with a full
 * between-study covariance Σ (so ρ is ESTIMATED, not assumed 0) — which the panel
 * picks up automatically via window.RapidMetaDTA. It self-skips for k<4 (the
 * bivariate model has 5 parameters), where the panel keeps its DL fallback.
 *
 * The numerical engine below is vendored VERBATIM from the portfolio's
 * R-validated allmeta/shared/dta-bivariate.js, which is bit-checked against
 * mada::reitsma(method="ml") (AuditC data). Do not edit the engine math; the
 * RapidMetaDTA adapter at the bottom maps its output to the panel's field names.
 */
(function (global) {
  "use strict";

  function _logit(p) { return Math.log(p / (1 - p)); }
  function _expit(x) { return 1 / (1 + Math.exp(-x)); }
  function _inv2(M) { var det = M[0][0] * M[1][1] - M[0][1] * M[1][0]; return { det: det, inv: [[M[1][1] / det, -M[0][1] / det], [-M[1][0] / det, M[0][0] / det]] }; }

  function _prep(rows) {
    // rows: {tp, fp, fn, tn}. y=(logitTPR, logitFPR), within-study S diag.
    // Continuity correction (mada correction.control="all"): if ANY study has a
    // zero cell, add 0.5 to ALL studies' cells.
    var anyZero = rows.some(function (r) { return r.tp === 0 || r.fp === 0 || r.fn === 0 || r.tn === 0; });
    return rows.map(function (r) {
      var c = anyZero ? 0.5 : 0;
      var tp = r.tp + c, fp = r.fp + c, fn = r.fn + c, tn = r.tn + c;
      return { y: [Math.log(tp / fn), Math.log(fp / tn)], S: [1 / tp + 1 / fn, 1 / fp + 1 / tn] };
    });
  }

  function _profile(studies, Sigma) {
    var A = [[0, 0], [0, 0]], bvec = [0, 0], k = studies.length, Vinvs = [], dets = [];
    for (var i = 0; i < k; i++) {
      var s = studies[i];
      var V = [[Sigma[0][0] + s.S[0], Sigma[0][1]], [Sigma[1][0], Sigma[1][1] + s.S[1]]];
      var iv = _inv2(V); if (!(iv.det > 0)) return { negLL: 1e12 };
      Vinvs.push(iv.inv); dets.push(iv.det);
      A[0][0] += iv.inv[0][0]; A[0][1] += iv.inv[0][1]; A[1][0] += iv.inv[1][0]; A[1][1] += iv.inv[1][1];
      bvec[0] += iv.inv[0][0] * s.y[0] + iv.inv[0][1] * s.y[1];
      bvec[1] += iv.inv[1][0] * s.y[0] + iv.inv[1][1] * s.y[1];
    }
    var iA = _inv2(A); if (!(iA.det > 0)) return { negLL: 1e12 };
    var mu = [iA.inv[0][0] * bvec[0] + iA.inv[0][1] * bvec[1], iA.inv[1][0] * bvec[0] + iA.inv[1][1] * bvec[1]];
    var ll = 0;
    for (var j = 0; j < k; j++) {
      var d0 = studies[j].y[0] - mu[0], d1 = studies[j].y[1] - mu[1], iv2 = Vinvs[j];
      var quad = d0 * (iv2[0][0] * d0 + iv2[0][1] * d1) + d1 * (iv2[1][0] * d0 + iv2[1][1] * d1);
      ll += -Math.log(2 * Math.PI) - 0.5 * Math.log(dets[j]) - 0.5 * quad;
    }
    return { mu: mu, negLL: -ll, Vinvs: Vinvs };
  }

  function _nelderMead(f, x0, step, maxit) {
    var n = x0.length, simplex = [x0.slice()], i, j;
    for (i = 0; i < n; i++) { var p = x0.slice(); p[i] += step; simplex.push(p); }
    var fv = simplex.map(f);
    function order() { var idx = fv.map(function (v, i2) { return i2; }).sort(function (a, b) { return fv[a] - fv[b]; }); simplex = idx.map(function (i2) { return simplex[i2]; }); fv = idx.map(function (i2) { return fv[i2]; }); }
    for (var it = 0; it < (maxit || 4000); it++) {
      order(); if (Math.abs(fv[n] - fv[0]) < 1e-12) break;
      var c = new Array(n).fill(0); for (i = 0; i < n; i++) for (j = 0; j < n; j++) c[j] += simplex[i][j] / n;
      var xr = c.map(function (cc, j2) { return cc + (cc - simplex[n][j2]); }), fr = f(xr);
      if (fr < fv[0]) { var xe = c.map(function (cc, j2) { return cc + 2 * (xr[j2] - cc); }), fe = f(xe); if (fe < fr) { simplex[n] = xe; fv[n] = fe; } else { simplex[n] = xr; fv[n] = fr; } }
      else if (fr < fv[n - 1]) { simplex[n] = xr; fv[n] = fr; }
      else { var xc = c.map(function (cc, j2) { return cc + 0.5 * (simplex[n][j2] - cc); }), fc = f(xc);
        if (fc < fv[n]) { simplex[n] = xc; fv[n] = fc; }
        else { for (var s2 = 1; s2 <= n; s2++) { simplex[s2] = simplex[0].map(function (x0v, j2) { return x0v + 0.5 * (simplex[s2][j2] - x0v); }); fv[s2] = f(simplex[s2]); } } }
    }
    order(); return { x: simplex[0], f: fv[0] };
  }

  function fit(rows) {
    var studies = _prep(rows), k = studies.length;
    var v1 = [], v2 = []; studies.forEach(function (s) { v1.push(s.y[0]); v2.push(s.y[1]); });
    function vr(a) { var m = a.reduce(function (x, y) { return x + y; }, 0) / a.length; return a.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / (a.length - 1); }
    var s1 = Math.sqrt(Math.max(0.1, vr(v1) * 0.5)), s2 = Math.sqrt(Math.max(0.1, vr(v2) * 0.5));
    var obj = function (p) {
      var l11 = Math.exp(p[0]), l21 = p[1], l22 = Math.exp(p[2]);
      var Sigma = [[l11 * l11, l11 * l21], [l11 * l21, l21 * l21 + l22 * l22]];
      return _profile(studies, Sigma).negLL;
    };
    var start = [Math.log(s1), 0, Math.log(s2)];
    var opt = _nelderMead(obj, start, 0.4, 6000);
    opt = _nelderMead(obj, opt.x, 0.05, 6000);
    var l11 = Math.exp(opt.x[0]), l21 = opt.x[1], l22 = Math.exp(opt.x[2]);
    var Sigma = [[l11 * l11, l11 * l21], [l11 * l21, l21 * l21 + l22 * l22]];
    var pr = _profile(studies, Sigma), mu = pr.mu;
    var A = [[0, 0], [0, 0]];
    studies.forEach(function (s, i) { var iv = pr.Vinvs[i]; A[0][0] += iv[0][0]; A[0][1] += iv[0][1]; A[1][0] += iv[1][0]; A[1][1] += iv[1][1]; });
    var covMu = _inv2(A).inv;
    var Se = _expit(mu[0]), FPR = _expit(mu[1]), Sp = 1 - FPR;
    var z = 1.959963984540054;
    function ciLogit(m, v) { var s = Math.sqrt(v); return [_expit(m - z * s), _expit(m + z * s)]; }
    var seCI = ciLogit(mu[0], covMu[0][0]), fprCI = ciLogit(mu[1], covMu[1][1]);
    var lrPos = Se / FPR, lrNeg = (1 - Se) / Sp;
    var srocSlope = Sigma[0][1] / Sigma[1][1];
    var srocIntercept = mu[0] - srocSlope * mu[1];
    return {
      k: k, muLogitSe: mu[0], muLogitFPR: mu[1], Sigma: Sigma, negLL: pr.negLL, covMu: covMu,
      sens: Se, spec: Sp, sensCI: seCI, specCI: [1 - fprCI[1], 1 - fprCI[0]],
      lrPos: lrPos, lrNeg: lrNeg, dor: lrPos / lrNeg, srocSlope: srocSlope, srocIntercept: srocIntercept,
    };
  }

  function srocCurve(f, n) {
    n = n || 50; var pts = [];
    for (var i = 0; i <= n; i++) { var fpr = 0.001 + 0.998 * i / n; var lt = f.srocIntercept + f.srocSlope * _logit(fpr); pts.push({ fpr: fpr, tpr: _expit(lt) }); }
    return pts;
  }

  function thresholdSpearman(rows) {
    var st = _prep(rows), n = st.length;
    function rank(a) { var idx = a.map(function (v, i) { return { v: v, i: i }; }).sort(function (p, q) { return p.v - q.v; }); var r = new Array(n), j = 0; while (j < n) { var t = j; while (t + 1 < n && idx[t + 1].v === idx[j].v) t++; var rk = (j + t) / 2 + 1; for (var m = j; m <= t; m++) r[idx[m].i] = rk; j = t + 1; } return r; }
    var r1 = rank(st.map(function (s) { return s.y[0]; })), r2 = rank(st.map(function (s) { return s.y[1]; }));
    var mb = (n + 1) / 2, sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { var dx = r1[i] - mb, dy = r2[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0;
  }

  // ---- RapidMetaDTA adapter — the exact shape dta-bivariate.js consumes -------
  // fit(trials) where trials = [{name, TP, FP, FN, TN}]. Returns null for k<4 so
  // the panel falls back to its independent-DL pool (bivariate needs >=4 studies).
  function adapterFit(trials) {
    if (!Array.isArray(trials) || trials.length < 4) return null;
    var rows = trials.map(function (t) { return { tp: +t.TP, fp: +t.FP, fn: +t.FN, tn: +t.TN }; });
    if (rows.some(function (r) { return !isFinite(r.tp) || !isFinite(r.fp) || !isFinite(r.fn) || !isFinite(r.tn); })) return null;
    var r;
    try { r = fit(rows); } catch (e) { return null; }
    if (!r || !isFinite(r.sens) || !isFinite(r.spec) || !isFinite(r.negLL)) return null;
    // DOR CI exactly from the bivariate covariance: log DOR = μ_logitSe − μ_logitFPR,
    // var = covMu00 + covMu11 − 2·covMu01.
    var z = 1.959963984540054;
    var logDOR = r.muLogitSe - r.muLogitFPR;
    var varLogDOR = r.covMu[0][0] + r.covMu[1][1] - 2 * r.covMu[0][1];
    var dorLo = null, dorHi = null;
    if (varLogDOR > 0) { var sd = Math.sqrt(varLogDOR); dorLo = Math.exp(logDOR - z * sd); dorHi = Math.exp(logDOR + z * sd); }
    var sd00 = r.Sigma[0][0], sd11 = r.Sigma[1][1];
    // Report the conventional Se–Sp between-study correlation (= −corr(logitSe, logitFPR)).
    var rhoSeSp = (sd00 > 0 && sd11 > 0) ? -r.Sigma[0][1] / Math.sqrt(sd00 * sd11) : 0;
    var spear = thresholdSpearman(rows);
    return {
      k: r.k,
      pooled_sens: r.sens, pooled_spec: r.spec,
      pooled_sens_ci_lb: r.sensCI[0], pooled_sens_ci_ub: r.sensCI[1],
      pooled_spec_ci_lb: r.specCI[0], pooled_spec_ci_ub: r.specCI[1],
      dor: r.dor, dor_ci_lb: dorLo, dor_ci_ub: dorHi,
      lr_pos: r.lrPos, lr_neg: r.lrNeg,
      tau2_sens: sd00, tau2_spec: sd11, rho: rhoSeSp,
      estimator: 'Reitsma bivariate ML', converged: true, fallback: 'reitsma_full',
      threshold_effect: Math.abs(spear) > 0.6, threshold_effect_spearman: spear,
      _raw: r,
    };
  }
  function adapterSroc(eng) {
    if (!eng || !eng._raw) return null;
    return srocCurve(eng._raw, 50);
  }

  var rapidMeta = { fit: adapterFit, sroc: adapterSroc };
  // Do not clobber a host-supplied engine if one is already present.
  if (!global.RapidMetaDTA) global.RapidMetaDTA = rapidMeta;
  global.AlmDTABivariate = { fit: fit, srocCurve: srocCurve, thresholdSpearman: thresholdSpearman, _logit: _logit, _expit: _expit };
})(typeof window !== "undefined" ? window : globalThis);
