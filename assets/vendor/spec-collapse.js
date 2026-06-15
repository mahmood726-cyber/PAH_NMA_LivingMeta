/* shared/spec-collapse.js — correct inference for multiverse / many-analyst MA.
 *
 * A multiverse meta-analysis runs many analytic specifications on ONE dataset.
 * Summarising the spec-curve by inverse-variance pooling the spec estimates
 * (as if independent studies) collapses the CI by ~the number of specs and
 * manufactures robustness (advanced-stats.md: "never IV-RE-pool many-analyst /
 * multiverse results"). This module supplies the corrected weighted-likelihood
 * interval (a t-mixture of the per-spec likelihoods) whose variance, by the law
 * of total variance, is mean-within + between-spec — never narrower than a
 * single spec.
 *
 * Faithful JS port of spec-collapse-atlas/spec_collapse/aggregators.py (the
 * weighted-likelihood aggregator externally validated vs metafor across 473
 * Cochrane reviews). Per-spec pooling and trim-and-fill delegate to the audited
 * shared/ma-core.js and shared/trimfill.js. Cross-checked against the Python
 * engine in tests/test_spec_collapse.py.
 *
 * Reference: Spec-Collapse Atlas (2026); Wagenmakers-style likelihood
 * combination; IntHout/IQWiG multiverse cautions.
 */
(function (global) {
  "use strict";

  // --- self-contained Student-t CDF (Numerical Recipes betai), so the mixture
  // --- quantile inversion needs no external stats lib (ma-core exposes _qt but
  // --- not the CDF). Matches scipy.stats.t.cdf to ~1e-10.
  function _lnGamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 1.208650973866179e-3, -5.395239384953e-6];
    var y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
    var s = 1.000000000190015;
    for (var j = 0; j < 6; j++) { y++; s += c[j] / y; }
    return -t + Math.log(2.5066282746310005 * s / x);
  }
  function _betacf(a, b, x) {
    var FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; var h = d;
    for (var m = 1; m <= 300; m++) {
      var m2 = 2 * m;
      var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; var del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return h;
  }
  function _betai(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var bt = Math.exp(_lnGamma(a + b) - _lnGamma(a) - _lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * _betacf(a, b, x) / a : 1 - bt * _betacf(b, a, 1 - x) / b;
  }
  function _tcdf(t, df) {
    var x = df / (df + t * t), ib = 0.5 * _betai(df / 2, 0.5, x);
    return t >= 0 ? 1 - ib : ib;
  }
  function _qnorm(p) { return global.AlmMaCore._qnorm(p); }
  function _qt(p, df) { return global.AlmMaCore._qt(p, df); }

  function _pool(yi, vi, est, knha) {
    return global.AlmMaCore.pool(yi, vi, { method: est, knha: !!knha });
  }

  // One specification -> {theta, var, k, ciLo, ciHi, significant, ...labels}.
  function _spec(yi, vi, est, knha, labels) {
    var r = _pool(yi, vi, est, knha);
    return {
      estimator: est, ci_method: knha ? "HKSJ" : "z",
      outlier: labels.outlier, trimfill: labels.trimfill,
      theta: r.mu, var: r.se * r.se, k: yi.length,
      ciLo: r.ciLo, ciHi: r.ciHi,
      significant: (r.ciLo > 0 || r.ciHi < 0),
    };
  }

  // Outlier rules: keep all; drop the single largest standardized residual;
  // drop the least-precise (largest-SE) study. Never drop below k=3.
  function _subset(studies, rule) {
    if (rule === "none" || studies.length <= 3) return studies.slice();
    if (rule === "drop-imprecise") {
      var mi = 0; for (var i = 1; i < studies.length; i++) if (studies[i].se > studies[mi].se) mi = i;
      return studies.filter(function (_, i) { return i !== mi; });
    }
    // drop-resid
    var yi = studies.map(function (s) { return s.est; });
    var vi = studies.map(function (s) { return s.se * s.se; });
    var mu = global.AlmMaCore.pool(yi, vi, { method: "DL" }).mu;
    var mj = 0, mr = -1;
    for (var j = 0; j < studies.length; j++) {
      var res = Math.abs(studies[j].est - mu) / studies[j].se;
      if (res > mr) { mr = res; mj = j; }
    }
    return studies.filter(function (_, k) { return k !== mj; });
  }

  // The 36-spec grid: 3 tau2 estimators x 2 CI methods x 3 outlier rules x {raw, trim-fill}.
  function buildSpecs(studies) {
    var ests = ["DL", "PM", "REML"], cis = [false, true], rules = ["none", "drop-resid", "drop-imprecise"];
    var specs = [];
    ests.forEach(function (est) {
      cis.forEach(function (knha) {
        rules.forEach(function (rule) {
          var sub = _subset(studies, rule);
          var yi = sub.map(function (s) { return s.est; });
          var vi = sub.map(function (s) { return s.se * s.se; });
          specs.push(_spec(yi, vi, est, knha, { outlier: rule, trimfill: false }));
          // trim-and-fill: augment with imputed points, then pool under this spec.
          var tf = global.AlmTrimFill.trimAndFill(yi, vi, { method: est });
          var fy = yi.slice(), fv = vi.slice();
          (tf.imputed || []).forEach(function (p) { fy.push(p.yi); fv.push(p.vi); });
          specs.push(_spec(fy, fv, est, knha, { outlier: rule, trimfill: true }));
        });
      });
    });
    return specs;
  }

  // (1) naive concordance — % of specs significant (the "100% concordance" number).
  function naiveConcordance(specs) {
    var nsig = specs.filter(function (s) { return s.significant; }).length;
    var frac = specs.length ? nsig / specs.length : 0;
    return { method: "naive_concordance", pctSig: 100 * frac, nSpecs: specs.length,
             verdict: frac >= 0.95 ? "robust" : "fragile" };
  }

  // (2) naive IV-RE pool — variance 1/Σ(1/V) collapses by ~S (the cardinal sin).
  function naiveIvre(specs, cl) {
    cl = cl || 0.95;
    var sinv = 0, num = 0;
    specs.forEach(function (s) { sinv += 1 / s.var; num += s.theta / s.var; });
    var theta = num / sinv, v = 1 / sinv;
    var z = _qnorm(0.5 + cl / 2), half = z * Math.sqrt(v);
    var lo = theta - half, hi = theta + half;
    return { method: "naive_ivre_pool", theta: theta, var: v, ciLo: lo, ciHi: hi,
             verdict: (lo > 0 || hi < 0) ? "robust" : "fragile" };
  }

  function _weights(specs, scheme) {
    if (!scheme || scheme === "uniform") return null;
    var w;
    if (scheme === "reml_only") w = specs.map(function (s) { return s.estimator === "REML" ? 1 : 0; });
    else if (scheme === "hksj_only") w = specs.map(function (s) { return s.ci_method === "HKSJ" ? 1 : 0; });
    else return null;
    var sw = w.reduce(function (a, b) { return a + b; }, 0);
    return sw > 0 ? w : null;
  }

  // (3) weighted-likelihood — t-mixture; variance = within + between (total variance).
  function weightedLikelihood(specs, cl, weights) {
    cl = cl || 0.95;
    var n = specs.length;
    var p = weights ? (function () { var sw = weights.reduce(function (a, b) { return a + b; }, 0); return weights.map(function (w) { return w / sw; }); })()
                    : specs.map(function () { return 1 / n; });
    var thetas = specs.map(function (s) { return s.theta; });
    var sds = specs.map(function (s) { return Math.sqrt(s.var); });
    var dfs = specs.map(function (s) { return Math.max(1, (s.k || 2) - 1); });

    var mean = 0; for (var i = 0; i < n; i++) mean += p[i] * thetas[i];
    var within = 0;
    for (i = 0; i < n; i++) { var df = dfs[i]; var scale = (df > 2) ? df / (df - 2) : 1.0; within += p[i] * specs[i].var * scale; }
    var between = 0; for (i = 0; i < n; i++) between += p[i] * (thetas[i] - mean) * (thetas[i] - mean);
    var totalVar = within + between;

    var comps = specs.map(function (s, j) { return { theta: thetas[j], sd: sds[j], df: dfs[j] }; });
    function mixCdf(x) { var c = 0; for (var j = 0; j < n; j++) { if (p[j] <= 0) continue; c += p[j] * _tcdf((x - comps[j].theta) / comps[j].sd, comps[j].df); } return c; }
    // bracket from the widest component, then bisect (mixCdf is monotone).
    var loB = Infinity, hiB = -Infinity;
    for (i = 0; i < n; i++) { var spread = sds[i] * _qt(0.999, dfs[i]); loB = Math.min(loB, thetas[i] - 2 * spread); hiB = Math.max(hiB, thetas[i] + 2 * spread); }
    var alpha = (1 - cl) / 2;
    function invert(target) { var lo = loB, hi = hiB; for (var it = 0; it < 200; it++) { var m = (lo + hi) / 2; if (mixCdf(m) < target) lo = m; else hi = m; } return (lo + hi) / 2; }
    var ciLo = invert(alpha), ciHi = invert(1 - alpha);
    return { method: "weighted_likelihood", theta: mean, var: totalVar, within: within, between: between,
             ciLo: ciLo, ciHi: ciHi, verdict: (ciLo > 0 || ciHi < 0) ? "robust" : "fragile" };
  }

  function analyze(studies, opts) {
    opts = opts || {};
    var cl = opts.cl || 0.95;
    var specs = buildSpecs(studies);
    var weights = _weights(specs, opts.scheme || "uniform");
    return {
      specs: specs,
      concordance: naiveConcordance(specs),
      naive: naiveIvre(specs, cl),
      weighted: weightedLikelihood(specs, cl, weights),
    };
  }

  var api = { analyze: analyze, buildSpecs: buildSpecs,
              naiveConcordance: naiveConcordance, naiveIvre: naiveIvre, weightedLikelihood: weightedLikelihood,
              _tcdf: _tcdf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmSpecCollapse = api;
})(typeof window !== "undefined" ? window : globalThis);
