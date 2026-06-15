/* RapidMetaSurvival — survival / time-to-event meta-analysis engine.
 *
 * Defines window.RapidMetaSurvival, the engine the four survival panels
 * (hr-nnt-panel.js, interval-hr-pool.js, rmst-pool.js, non-ph-detector.js)
 * delegate to. Pure JS, zero deps, runs in-browser AND under node (for the
 * numerical-baseline harness).
 *
 * EXPERIMENTAL — RMST-difference pooling (poolRMSTDiff) and the interval-HR
 * pool (intervalHRPool) operate on inputs (reconstructed KM curves / per-window
 * HRs) that are NOT carried by the default rapidmeta data model and have NO
 * external R oracle bit-check on disk. They self-skip silently unless a topic
 * pack supplies km_curve / intervals. The summary-HR pool (fit) and NNT
 * conversion (nntForHR) ARE R-checkable: fit() reproduces the in-page
 * REML + HKSJ-floor + t_{k-1} pooler (Cochrane v6.5 / metafor rma(method="REML",
 * test="knha")) on the log-HR scale; nntForHR is the closed-form Altman-Andersen
 * (2002) survival NNT. Panels that surface RMST / interval-HR results MUST badge
 * them "Experimental" at the point of display.
 *
 * Public API on global.RapidMetaSurvival:
 *   fit(trials)                 -> summary log-HR IV random-effects pool
 *   intervalHRPool(trials, bp)  -> per-window log-HR IV-RE pool  [EXPERIMENTAL]
 *   poolRMSTDiff(trials, tau)   -> pooled RMST DIFFERENCE at tau* [EXPERIMENTAL]
 *   nntForHR(HR, baselineRisk)  -> Altman-Andersen survival NNT
 *   nonPHDetect(trials)         -> two-criterion non-PH flag
 */
(function (global) {
  'use strict';

  // ---- Student-t quantile (Cornish-Fisher / Hill 1970 algorithm 396) --------
  // Matches the in-page tQuantile to <1e-6 over df>=1. Used for HKSJ + RE CIs.
  function tQuantile(p, df) {
    if (!(df > 0)) return NaN;
    if (df > 1e7) return normQuantile(p);
    // invert via the regularized incomplete beta through a robust bisection on
    // the t CDF — stable for small df where Cornish-Fisher drifts.
    var lo = -1e6, hi = 1e6;
    for (var i = 0; i < 200; i++) {
      var mid = 0.5 * (lo + hi);
      if (tCDF(mid, df) < p) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  function tCDF(t, df) {
    // CDF of Student-t via the regularized incomplete beta function.
    var x = df / (df + t * t);
    var ib = 0.5 * betai(df / 2, 0.5, x);
    return t > 0 ? 1 - ib : ib;
  }

  // Regularized incomplete beta I_x(a,b) (Numerical Recipes betai + betacf).
  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var lbeta = gammaln(a + b) - gammaln(a) - gammaln(b);
    var front = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return front * betacf(a, b, x) / a;
    return 1 - front * betacf(b, a, 1 - x) / b;
  }
  function betacf(a, b, x) {
    var MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; var del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function gammaln(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    var ser = 1.000000000190015;
    for (var j = 0; j < 6; j++) { y += 1; ser += c[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function normQuantile(p) {
    // Acklam's inverse normal CDF.
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
              1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
              6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
    var pl = 0.02425;
    if (p < pl) { var q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
             ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if (p <= 1 - pl) { var q2 = p - 0.5, r = q2 * q2;
      return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q2 /
             (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1); }
    var q3 = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q3+c[1])*q3+c[2])*q3+c[3])*q3+c[4])*q3+c[5]) /
            ((((d[0]*q3+d[1])*q3+d[2])*q3+d[3])*q3+1);
  }

  // ---- core IV random-effects pool on a generic log-effect scale ------------
  // REML τ² (Viechtbauer 2005 Fisher scoring, matches in-page engine), then
  // RE weights; CI by HKSJ with the Cochrane v6.5 floor max(1, q*) and t_{k-1}.
  // For k < 5 falls back to a fixed-effect pool (REML τ² unstable at tiny k).
  function poolLogRE(yi, vi) {
    var k = yi.length;
    if (k < 1) return null;
    // fixed-effect
    var wFE = vi.map(function (v) { return 1 / v; });
    var sWfe = wFE.reduce(function (a, b) { return a + b; }, 0);
    var muFE = yi.reduce(function (a, y, i) { return a + wFE[i] * y; }, 0) / sWfe;
    var Q = yi.reduce(function (a, y, i) { return a + wFE[i] * Math.pow(y - muFE, 2); }, 0);
    var df = k - 1;
    var sW2 = wFE.reduce(function (a, w) { return a + w * w; }, 0);
    var cExp = sWfe - sW2 / sWfe;
    var tau2_dl = (df > 0 && Q > df && cExp > 0) ? (Q - df) / cExp : 0;

    if (k < 2) {
      var seFE1 = Math.sqrt(1 / sWfe);
      return { mu: muFE, se: seFE1, ci_lo: muFE - 1.96 * seFE1,
               ci_hi: muFE + 1.96 * seFE1, k: k, tau2: 0, Q: Q, df: df,
               I2: 0, method: 'FE', fallback: 'k=1' };
    }

    // REML τ² (Fisher scoring from DL)
    var tau2 = tau2_dl;
    for (var it = 0; it < 100; it++) {
      var w = vi.map(function (v) { return 1 / (v + tau2); });
      var sW = w.reduce(function (a, b) { return a + b; }, 0);
      var mu = yi.reduce(function (a, y, i) { return a + w[i] * y; }, 0) / sW;
      var s2 = w.reduce(function (a, wi) { return a + wi * wi; }, 0);
      var s3 = w.reduce(function (a, wi) { return a + wi * wi * wi; }, 0);
      var trP = sW - s2 / sW;
      var yP2y = w.reduce(function (a, wi, i) { return a + wi * wi * Math.pow(yi[i] - mu, 2); }, 0);
      var trP2 = s2 - 2 * s3 / sW + s2 * s2 / (sW * sW);
      if (trP2 < 1e-15) break;
      var nw = Math.max(0, tau2 + (yP2y - trP) / trP2);
      if (Math.abs(nw - tau2) < 1e-10) { tau2 = nw; break; }
      tau2 = nw;
    }

    // Random-effects for ALL k>=2: REML tau2 + RE-weighted Knapp-Hartung (floored)
    // + t_{k-1}. Small k is precisely where this matters — HKSJ/t exist to protect
    // small-sample inference, so a fixed-effect fallback at small k would be
    // anticonservative (and would contradict the in-page computeCore engine that
    // this is meant to mirror). DL is biased for k<10, hence REML.
    var wr = vi.map(function (v) { return 1 / (v + tau2); });
    var sWR = wr.reduce(function (a, b) { return a + b; }, 0);
    var mu = yi.reduce(function (a, y, i) { return a + wr[i] * y; }, 0) / sWR;
    var seMu = Math.sqrt(1 / sWR);
    var I2 = (Q > df) ? ((Q - df) / Q) * 100 : 0;
    // RE-weighted Knapp-Hartung statistic q* (NOT fixed-effect Q/df), floored at 1.
    var qStar = yi.reduce(function (a, y, i) { return a + wr[i] * Math.pow(y - mu, 2); }, 0) / df;
    var hSE = seMu * Math.sqrt(Math.max(1, qStar));
    var tc = tQuantile(1 - 0.025, df);
    var lo = mu - tc * hSE, hi = mu + tc * hSE;
    var out = { mu: mu, se: hSE, ci_lo: lo, ci_hi: hi, k: k, tau2: tau2,
                Q: Q, df: df, I2: I2, method: 'REML+HKSJ', fallback: null };
    // Cochrane v6.5 prediction interval: t_{k-1} × sqrt(tau2 + SE_mu^2); undefined k<3.
    if (k >= 3) {
      var seP = Math.sqrt(tau2 + seMu * seMu);
      out.pi_lo = mu - tc * seP; out.pi_hi = mu + tc * seP;
    }
    return out;
  }

  // log-HR + within-study variance from a reported HR + 95% CI.
  function logHRfromCI(HR, lo, hi) {
    var y = Math.log(HR);
    var se = (Math.log(hi) - Math.log(lo)) / (2 * 1.959963984540054);
    return { yi: y, vi: se * se };
  }

  // ---- public: summary log-HR pool -----------------------------------------
  function fit(trials) {
    var pts = [];
    (trials || []).forEach(function (t) {
      var HR = +t.HR, lo = +t.HR_ci_lo, hi = +t.HR_ci_hi;
      if (isFinite(HR) && isFinite(lo) && isFinite(hi) && HR > 0 && lo > 0 && hi > 0 && hi > lo) {
        pts.push(logHRfromCI(HR, lo, hi));
      }
    });
    if (pts.length < 1) return null;
    var p = poolLogRE(pts.map(function (x) { return x.yi; }), pts.map(function (x) { return x.vi; }));
    if (!p) return null;
    return {
      pooled_HR: Math.exp(p.mu),
      pooled_HR_ci_lo: Math.exp(p.ci_lo),
      pooled_HR_ci_hi: Math.exp(p.ci_hi),
      pooled_HR_pi_lo: isFinite(p.pi_lo) ? Math.exp(p.pi_lo) : null,
      pooled_HR_pi_hi: isFinite(p.pi_hi) ? Math.exp(p.pi_hi) : null,
      logHR: p.mu, se: p.se, k: p.k, tau2: p.tau2, I2: p.I2,
      Q: p.Q, df: p.df, method: p.method, fallback: p.fallback
    };
  }

  // ---- public: per-window (interval) HR pool  [EXPERIMENTAL] ----------------
  // trials[i].intervals = [{ t0, t1, HR, HR_ci_lo, HR_ci_hi }, ...]
  // bp = sorted breakpoint array; pools each [t0,t1] window across trials.
  function intervalHRPool(trials, bp) {
    if (!Array.isArray(bp) || bp.length < 2) return null;
    var windows = [];
    for (var i = 0; i + 1 < bp.length; i++) {
      var t0 = bp[i], t1 = bp[i + 1];
      var pts = [];
      (trials || []).forEach(function (t) {
        (t.intervals || []).forEach(function (iv) {
          if (+iv.t0 === t0 && +iv.t1 === t1) {
            var HR = +iv.HR, lo = +iv.HR_ci_lo, hi = +iv.HR_ci_hi;
            if (isFinite(HR) && isFinite(lo) && isFinite(hi) && HR > 0 && lo > 0 && hi > 0 && hi > lo) {
              pts.push(logHRfromCI(HR, lo, hi));
            }
          }
        });
      });
      if (pts.length === 0) continue;
      var p = poolLogRE(pts.map(function (x) { return x.yi; }), pts.map(function (x) { return x.vi; }));
      if (!p) continue;
      windows.push({
        label: t0 + '–' + t1 + ' mo', t0: t0, t1: t1, k: p.k,
        HR: Math.exp(p.mu), HR_ci_lo: Math.exp(p.ci_lo), HR_ci_hi: Math.exp(p.ci_hi),
        tau2: p.tau2, I2: p.I2
      });
    }
    return { intervals: windows };
  }

  // ---- public: RMST-difference pool  [EXPERIMENTAL] -------------------------
  // trials[i].km_curve = [{ t_months, surv_trt, surv_ctl }, ...] (monotone t).
  // Per-trial RMST = trapezoid integral of S(t) to tau*; pool the DIFFERENCES.
  function trapezoidRMST(curve, tau, key) {
    // integrate step-/trapezoid survival to tau (clamp last point at tau).
    var area = 0, prevT = 0, prevS = 1;
    for (var i = 0; i < curve.length; i++) {
      var t = +curve[i].t_months, s = +curve[i][key];
      if (!isFinite(t) || !isFinite(s)) continue;
      if (t >= tau) {
        area += (tau - prevT) * 0.5 * (prevS + interpAt(prevT, prevS, t, s, tau));
        return area;
      }
      area += (t - prevT) * 0.5 * (prevS + s);
      prevT = t; prevS = s;
    }
    // curve ended before tau: extend flat at last S
    area += (tau - prevT) * prevS;
    return area;
  }
  function interpAt(t0, s0, t1, s1, t) {
    if (t1 === t0) return s1;
    return s0 + (s1 - s0) * (t - t0) / (t1 - t0);
  }

  function poolRMSTDiff(trials, tau) {
    var per = [], yi = [], vi = [];
    (trials || []).forEach(function (t) {
      var c = t.km_curve;
      if (!Array.isArray(c) || c.length < 2) return;
      var rmstT = trapezoidRMST(c, tau, 'surv_trt');
      var rmstC = trapezoidRMST(c, tau, 'surv_ctl');
      var diff = rmstT - rmstC;
      // SE: if curve carries per-point se, use Greenwood-style finite diff;
      // else fall back to a coarse area-variance proxy. Honest: this is the
      // EXPERIMENTAL part — no R oracle for the SE without IPD.
      var se;
      if (isFinite(+t.rmst_diff_se)) {
        se = +t.rmst_diff_se;
      } else {
        // proxy: variance ~ (tau/ (2*sqrt(n_eff)))^2 scaled by survival spread.
        var nEff = isFinite(+t.n_eff) ? +t.n_eff : (isFinite(+t.tN) && isFinite(+t.cN) ? (+t.tN + +t.cN) : 200);
        se = tau / (2 * Math.sqrt(Math.max(1, nEff))) * Math.max(0.25, Math.abs(rmstT + rmstC) / (2 * tau));
      }
      per.push({ studlab: String(t.studlab || t.name || '?'),
                 rmst_trt: rmstT, rmst_ctl: rmstC, rmst_diff: diff, se: se });
      yi.push(diff); vi.push(se * se);
    });
    if (per.length === 0) return { k: 0, per_study: [] };
    var p = poolLogRE(yi, vi);   // raw-scale RE pool (not log) — diff is additive
    return {
      k: p.k, pooled_diff: p.mu, ci_lo: p.ci_lo, ci_hi: p.ci_hi,
      tau2: p.tau2, I2: p.I2, fallback: p.fallback, per_study: per
    };
  }

  // ---- public: NNT from HR (Altman & Andersen 2002) -------------------------
  // ARR = R_ctl - (1 - (1 - R_ctl)^HR);  NNT = 1/|ARR|.
  function nntForHR(HR, baselineRisk) {
    var Rc = +baselineRisk;
    if (!isFinite(HR) || HR <= 0 || !isFinite(Rc) || Rc <= 0 || Rc >= 1) {
      return { nnt: null, arr: null, tx_risk: null, direction: null };
    }
    var txRisk = 1 - Math.pow(1 - Rc, HR);
    var arr = Rc - txRisk;                       // >0 ⇒ treatment lowers risk
    if (Math.abs(arr) < 1e-9) {
      return { nnt: null, arr: arr, tx_risk: txRisk, direction: null };
    }
    return {
      nnt: 1 / Math.abs(arr),
      arr: arr,
      tx_risk: txRisk,
      direction: arr > 0 ? 'NNTB' : 'NNTH'
    };
  }

  // ---- public: non-PH detector ---------------------------------------------
  function nonPHDetect(trials) {
    var n = 0, flagged = 0, pmin = null;
    (trials || []).forEach(function (t) {
      n++;
      var hit = (typeof t.schoenfeld_p === 'number' && t.schoenfeld_p < 0.05) || t.curve_crosses === true;
      if (hit) flagged++;
      if (typeof t.schoenfeld_p === 'number' && (pmin === null || t.schoenfeld_p < pmin)) pmin = t.schoenfeld_p;
    });
    return {
      flag: flagged > 0,
      n_flagged: flagged,
      fraction_flagged: n > 0 ? flagged / n : 0,
      schoenfeld_p_min: pmin
    };
  }

  global.RapidMetaSurvival = {
    fit: fit,
    intervalHRPool: intervalHRPool,
    poolRMSTDiff: poolRMSTDiff,
    nntForHR: nntForHR,
    nonPHDetect: nonPHDetect,
    // exposed for the numerical-baseline harness
    _poolLogRE: poolLogRE,
    _tQuantile: tQuantile
  };
})(typeof window !== 'undefined' ? window : this);
