/* experimental-ma.js — EXPERIMENTAL meta-analysis estimators ported from the
 * user's own method repos. These are research methods, NOT established/validated
 * pooling — surface them only behind an explicit "experimental" label.
 *
 *   GRMA       — Grey Relational Meta-Analysis with a redescending (Tukey-bisquare)
 *                effect guard. Robust, outlier-downweighting point estimate.
 *                Ported from grma/grey_meta_v8.py (GRMA._core), verified to 1e-6.
 *   conformalPI— distribution-free conformal prediction interval for the next
 *                study's effect (guaranteed marginal coverage, no normality
 *                assumption). Ported from conformal-ma/pipeline.py, verified to 1e-6.
 *
 * All operate on standard arrays: yi (effects, analysis scale), vi (variances) or
 * sei (standard errors). Pure closed-form — no solver, no network.
 */
(function (global) {
  "use strict";

  // numpy-compatible linear-interpolation quantile (q in [0,1]).
  function quantile(arr, q) {
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var n = a.length; if (n === 1) return a[0];
    var idx = q * (n - 1), lo = Math.floor(idx), frac = idx - lo;
    if (lo + 1 >= n) return a[n - 1];
    return a[lo] + (a[lo + 1] - a[lo]) * frac;
  }
  function median(arr) { return quantile(arr, 0.5); }
  function clip01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  // ---- GRMA: grey-relational robust pool with Tukey-bisquare effect guard ----
  function grma(yi, vi, opts) {
    opts = opts || {};
    var zeta = opts.zeta || 0.5, precCap = opts.precCap || 1e6, tukeyC = opts.tukeyC || 4.685;
    var n = yi.length;
    if (n < 2) return null;
    var prec = vi.map(function (v) { return Math.min(1 / v, precCap); });
    var logPrec = prec.map(function (p) { return Math.log(p + 1); });
    function fit(x) { var lo = quantile(x, 0.05), hi = quantile(x, 0.95), rng = hi - lo; return [lo, rng >= 1e-12 ? rng : 1.0]; }
    var fe = fit(yi), fp = fit(logPrec);
    var effLo = fe[0], effRng = fe[1], preLo = fp[0], preRng = fp[1];
    var xEff = yi.map(function (y) { return clip01((y - effLo) / effRng); });
    var xPre = logPrec.map(function (p) { return clip01((p - preLo) / preRng); });
    var aY = median(yi), aP = Math.max.apply(null, prec);
    var aEff = clip01((aY - effLo) / effRng), aPre = clip01((Math.log(aP + 1) - preLo) / preRng);
    var dE = xEff.map(function (x) { return Math.abs(x - aEff); });
    var dP = xPre.map(function (x) { return Math.abs(x - aPre); });
    var all = dE.concat(dP), dMin = Math.min.apply(null, all), dMax = Math.max.apply(null, all);
    var grade;
    if (dMax < 1e-15) { grade = yi.map(function () { return 1; }); }
    else {
      grade = dE.map(function (de, i) {
        var ge = (dMin + zeta * dMax) / (de + zeta * dMax);
        var gp = (dMin + zeta * dMax) / (dP[i] + zeta * dMax);
        return (ge + gp) / 2;
      });
    }
    var mad = median(yi.map(function (y) { return Math.abs(y - aY); })); if (mad < 1e-12) mad = 1e-12;
    var raw = grade.map(function (g, i) {
      var u = Math.abs(yi[i] - aY) / mad;
      var h = u < tukeyC ? Math.pow(1 - Math.pow(u / tukeyC, 2), 2) : 0;
      return g * h;
    });
    var sw = raw.reduce(function (a, b) { return a + b; }, 0);
    var w = sw >= 1e-15 ? raw.map(function (r) { return r / sw; }) : raw.map(function () { return 1 / n; });
    var est = w.reduce(function (acc, wi, i) { return acc + wi * yi[i]; }, 0);
    return { estimate: est, weights: w };
  }

  // ---- Conformal prediction interval (distribution-free) ----
  function conformalPI(yi, sei, alpha) {
    alpha = alpha || 0.05;
    var k = yi.length;
    if (k < 4) return null;
    function dl(ys, ss, dfAdjust) {
      var wi = ss.map(function (s) { return 1 / (s * s); });
      var sw = wi.reduce(function (a, b) { return a + b; }, 0);
      var tfe = ys.reduce(function (a, y, i) { return a + wi[i] * y; }, 0) / sw;
      var Q = ys.reduce(function (a, y, i) { return a + wi[i] * (y - tfe) * (y - tfe); }, 0);
      var sw2 = wi.reduce(function (a, b) { return a + b * b; }, 0);
      var C = sw - sw2 / sw;
      var tau2 = C > 0 ? Math.max(0, (Q - dfAdjust) / C) : 0;
      var ws = ss.map(function (s) { return 1 / (s * s + tau2); });
      var sws = ws.reduce(function (a, b) { return a + b; }, 0);
      var theta = ys.reduce(function (a, y, i) { return a + ws[i] * y; }, 0) / sws;
      return { theta: theta, tau2: tau2 };
    }
    var scores = [];
    for (var i = 0; i < k; i++) {
      var yl = yi.filter(function (_, j) { return j !== i; });
      var sl = sei.filter(function (_, j) { return j !== i; });
      var loo = dl(yl, sl, k - 2);   // df = (k-1) - 1
      scores.push(Math.abs(yi[i] - loo.theta) / Math.sqrt(sei[i] * sei[i] + loo.tau2));
    }
    var ql = Math.min(Math.ceil((1 - alpha) * (k + 1)) / k, 1.0);
    var thr = quantile(scores, ql);
    var full = dl(yi, sei, k - 1);
    var seNew = median(sei), sp = Math.sqrt(seNew * seNew + full.tau2);
    return { theta: full.theta, lo: full.theta - thr * sp, hi: full.theta + thr * sp, threshold: thr, tau2: full.tau2 };
  }

  // ---- Student-t CDF (regularized incomplete beta, Numerical Recipes) ----
  function _gammaln(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
    var ser = 1.000000000190015;
    for (var j = 0; j < 6; j++) { y++; ser += c[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function _betacf(a, b, x) {
    var FPMIN = 1e-300, EPS = 3e-12, qab = a + b, qap = a + 1, qam = a - 1;
    var c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; var h = d;
    for (var m = 1; m <= 300; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; var del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function _betai(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var bt = Math.exp(_gammaln(a + b) - _gammaln(a) - _gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * _betacf(a, b, x) / a : 1 - bt * _betacf(b, a, 1 - x) / b;
  }
  function tcdf(t, df) {
    var p = 0.5 * _betai(df / 2, 0.5, df / (df + t * t));
    return t > 0 ? 1 - p : p;
  }

  // ---- Spec-collapse: honestly combine S analysis specifications of ONE dataset.
  // Mixture-of-scaled-t (df=k-1); CI from the mixture quantiles (law of total
  // variance) so it is NEVER narrower than a single spec — unlike naive IV-RE
  // pooling, which collapses the CI by ~S. Ported from spec_collapse/aggregators.py. ----
  function specCollapse(specs, cl) {
    cl = cl || 0.95;
    var n = specs.length; if (n < 2) return null;
    var p = specs.map(function () { return 1 / n; });
    var th = specs.map(function (s) { return s.theta; });
    var sd = specs.map(function (s) { return Math.sqrt(s.var); });
    var dfs = specs.map(function (s) { return Math.max(1, (s.k | 0) - 1); });
    var mean = 0; for (var i = 0; i < n; i++) mean += p[i] * th[i];
    var within = 0, between = 0;
    for (i = 0; i < n; i++) {
      var df = dfs[i], scale = df > 2 ? df / (df - 2) : 1.0;
      within += p[i] * specs[i].var * scale;
      between += p[i] * (th[i] - mean) * (th[i] - mean);
    }
    var alpha = (1 - cl) / 2;
    function mixcdf(x) { var s = 0; for (var j = 0; j < n; j++) s += p[j] * tcdf((x - th[j]) / sd[j], dfs[j]); return s; }
    var maxsd = Math.max.apply(null, sd), tmin = Math.min.apply(null, th), tmax = Math.max.apply(null, th);
    var pad = maxsd * 400 + 10, lo0 = tmin - pad, hi0 = tmax + pad;
    function solve(target) {
      var a = lo0, b = hi0;
      for (var it = 0; it < 200; it++) {
        var mid = (a + b) / 2, f = mixcdf(mid) - target;
        if (Math.abs(f) < 1e-12 || (b - a) < 1e-10) return mid;
        if (f < 0) a = mid; else b = mid;
      }
      return (a + b) / 2;
    }
    var lo = solve(alpha), hi = solve(1 - alpha);
    return { theta: mean, withinVar: within, betweenVar: between, totalVar: within + between,
      ciLo: lo, ciHi: hi, verdict: (lo > 0 || hi < 0) ? "robust" : "fragile", k: n };
  }

  // ---- Inverse Student-t (quantile) via bisection on tcdf, self-contained ----
  function tinv(p, df) {
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    var lo = -1e6, hi = 1e6;
    for (var it = 0; it < 200; it++) {
      var mid = (lo + hi) / 2, f = tcdf(mid, df) - p;
      if (Math.abs(f) < 1e-13 || (hi - lo) < 1e-12) return mid;
      if (f < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---- Benchmark-superior estimators ----
  // Closed-form methods that BEAT DerSimonian-Laird in the author's 299-method /
  // 12-scenario / 1000-sim benchmark (experimental-meta-analysis). All share a DL
  // tau^2 base, then differ in the weighting / interval rule. Ported verbatim from
  // core_framework.py + methods/experimental_methods_part2.py, verified to 1e-6.
  // Like every method here they are EXPERIMENTAL — surface behind the explicit label.
  function dlBase(yi, vi) {
    var k = yi.length;
    var wi = vi.map(function (v) { return 1 / v; });
    var swi = wi.reduce(function (a, b) { return a + b; }, 0);
    var muFe = yi.reduce(function (a, y, i) { return a + wi[i] * y; }, 0) / swi;
    var Q = yi.reduce(function (a, y, i) { return a + wi[i] * (y - muFe) * (y - muFe); }, 0);
    var swi2 = wi.reduce(function (a, b) { return a + b * b; }, 0);
    var c = swi - swi2 / swi;
    var tau2 = c > 0 ? Math.max(0, (Q - (k - 1)) / c) : 0;
    var wiRe = vi.map(function (v) { return 1 / (v + tau2); });
    var swiRe = wiRe.reduce(function (a, b) { return a + b; }, 0);
    var muRe = yi.reduce(function (a, y, i) { return a + wiRe[i] * y; }, 0) / swiRe;
    return { k: k, tau2: tau2, wiRe: wiRe, swiRe: swiRe, muRe: muRe, Q: Q };
  }
  // #1 winner (75% win rate): modified Knapp-Hartung with optional q-adj truncation.
  function knappHartungMod(yi, vi, truncate) {
    var b = dlBase(yi, vi), k = b.k; if (k < 2) return null;
    var qAdj = yi.reduce(function (a, y, i) { return a + b.wiRe[i] * (y - b.muRe) * (y - b.muRe); }, 0) / (k - 1);
    if (truncate) qAdj = Math.max(1.0, qAdj);
    var se = Math.sqrt(qAdj / b.swiRe), t = tinv(0.975, k - 1);
    return { estimate: b.muRe, se: se, ciLo: b.muRe - t * se, ciHi: b.muRe + t * se, tau2: b.tau2 };
  }
  // Satterthwaite-df interval on the RE pool (small-sample df approximation).
  function satterthwaiteDF(yi, vi) {
    var b = dlBase(yi, vi), k = b.k; if (k < 2) return null;
    var se = Math.sqrt(1 / b.swiRe);
    var tv = vi.map(function (v) { return v + b.tau2; });
    var s1 = tv.reduce(function (a, x) { return a + x; }, 0);
    var s2 = tv.reduce(function (a, x) { return a + x * x; }, 0);
    var df = Math.max(1, Math.min(k - 1, (s1 * s1) / s2));
    var t = tinv(0.975, df);
    return { estimate: b.muRe, se: se, ciLo: b.muRe - t * se, ciHi: b.muRe + t * se, tau2: b.tau2, df: df };
  }
  // Enhanced inverse-variance: shrink each variance toward the median before pooling.
  function ivPlus(yi, vi, reg) {
    reg = reg == null ? 0.1 : reg;
    var b = dlBase(yi, vi); if (b.k < 1) return null;
    var medV = median(vi);
    var wiRe = vi.map(function (v) { return 1 / (v + reg * medV + b.tau2); });
    var swiRe = wiRe.reduce(function (a, x) { return a + x; }, 0);
    var mu = yi.reduce(function (a, y, i) { return a + wiRe[i] * y; }, 0) / swiRe;
    var se = Math.sqrt(1 / swiRe), z = 1.959963984540054;
    return { estimate: mu, se: se, ciLo: mu - z * se, ciHi: mu + z * se, tau2: b.tau2 };
  }
  // Ridge-regularized pool: shrink the point estimate toward 0.
  function ridge(yi, vi, lambda) {
    lambda = lambda == null ? 0.01 : lambda;
    var b = dlBase(yi, vi); if (b.k < 1) return null;
    var mu = (yi.reduce(function (a, y, i) { return a + b.wiRe[i] * y; }, 0)) / (b.swiRe + lambda * b.k);
    var se = Math.sqrt(1 / b.swiRe), z = 1.959963984540054;
    return { estimate: mu, se: se, ciLo: mu - z * se, ciHi: mu + z * se, tau2: b.tau2 };
  }
  // Tikhonov-regularized pool with a Gaussian prior (priorMean, priorPrecision).
  function tikhonov(yi, vi, priorMean, priorPrec) {
    priorMean = priorMean == null ? 0.0 : priorMean; priorPrec = priorPrec == null ? 0.1 : priorPrec;
    var b = dlBase(yi, vi); if (b.k < 1) return null;
    var swYi = yi.reduce(function (a, y, i) { return a + b.wiRe[i] * y; }, 0);
    var mu = (swYi + priorPrec * priorMean) / (b.swiRe + priorPrec);
    var se = Math.sqrt(1 / (b.swiRe + priorPrec)), z = 1.959963984540054;
    return { estimate: mu, se: se, ciLo: mu - z * se, ciHi: mu + z * se, tau2: b.tau2 };
  }
  // Quality-effects pool: precision-proxied quality weights raised to `power`.
  function qualityEffects(yi, vi, power) {
    power = power == null ? 0.5 : power;
    var b = dlBase(yi, vi); if (b.k < 1) return null;
    var prec = vi.map(function (v) { return 1 / v; }), maxPrec = Math.max.apply(null, prec);
    var qual = prec.map(function (p) { return Math.pow(p / maxPrec, power); });
    var wiRe = qual.map(function (q, i) { return q / (vi[i] + b.tau2); });
    var swiRe = wiRe.reduce(function (a, x) { return a + x; }, 0);
    var mu = yi.reduce(function (a, y, i) { return a + wiRe[i] * y; }, 0) / swiRe;
    var se = Math.sqrt(1 / swiRe), z = 1.959963984540054;
    return { estimate: mu, se: se, ciLo: mu - z * se, ciHi: mu + z * se, tau2: b.tau2 };
  }
  // Sample-size-weighted pool (precision used as the size proxy when n is absent).
  function sampleSizeWeighted(yi, vi, power, ni) {
    power = power == null ? 0.5 : power;
    var b = dlBase(yi, vi); if (b.k < 1) return null;
    var sizes = ni && ni.length === yi.length ? ni : vi.map(function (v) { return 1 / v; });
    var meanN = sizes.reduce(function (a, x) { return a + x; }, 0) / sizes.length;
    var scaled = sizes.map(function (n) { return Math.pow(n / meanN, power); });
    var wiRe = scaled.map(function (s, i) { return s / (vi[i] + b.tau2); });
    var swiRe = wiRe.reduce(function (a, x) { return a + x; }, 0);
    var mu = yi.reduce(function (a, y, i) { return a + wiRe[i] * y; }, 0) / swiRe;
    var se = Math.sqrt(1 / swiRe), z = 1.959963984540054;
    return { estimate: mu, se: se, ciLo: mu - z * se, ciHi: mu + z * se, tau2: b.tau2 };
  }

  // ---- Benchmark-superior estimators, batch 2: adaptive weighting + regularised
  // pools. Same 299-method benchmark, same DL-tau^2 base; all deterministic (no
  // optimiser, no RNG) so they port exactly. Verified to 1e-6 vs the Python source.
  // Softmax-weighted pool: precision/temperature through a softmax (low temp -> the
  // single most precise study dominates; high temp -> toward uniform).
  function softmaxWeighted(yi, vi, temperature) {
    temperature = temperature == null ? 1.0 : temperature;
    var b = dlBase(yi, vi); if (b.k < 1) return null;
    var prec = vi.map(function (v) { return 1 / (v + b.tau2); });
    var logw = prec.map(function (p) { return p / temperature; });
    var mx = Math.max.apply(null, logw);
    var w = logw.map(function (l) { return Math.exp(l - mx); });
    var sw = w.reduce(function (a, x) { return a + x; }, 0);
    w = w.map(function (x) { return x / sw; });
    var mu = yi.reduce(function (a, y, i) { return a + w[i] * y; }, 0);
    var se = Math.sqrt(w.reduce(function (a, wi, i) { return a + wi * wi * (vi[i] + b.tau2); }, 0));
    var z = 1.959963984540054;
    return { estimate: mu, se: se, ciLo: mu - z * se, ciHi: mu + z * se, tau2: b.tau2 };
  }
  // LASSO-regularised pool: soft-thresholded coordinate descent toward 0 (sparsity).
  function lassoReg(yi, vi, lambda) {
    lambda = lambda == null ? 0.1 : lambda;
    var b = dlBase(yi, vi); if (b.k < 1) return null;
    var wi = vi.map(function (v) { return 1 / v; });
    var swi = wi.reduce(function (a, x) { return a + x; }, 0);
    var muFe = yi.reduce(function (a, y, i) { return a + wi[i] * y; }, 0) / swi;
    var mu = muFe, hess = b.swiRe;
    for (var it = 0; it < 100; it++) {
      var grad = yi.reduce(function (a, y, i) { return a + b.wiRe[i] * (mu - y); }, 0);
      var muUn = mu - grad / hess, t = lambda / hess;
      var muNew = Math.sign(muUn) * Math.max(0, Math.abs(muUn) - t);
      if (Math.abs(muNew - mu) < 1e-8) break;   // match Python: don't assign on convergence
      mu = muNew;
    }
    var se = Math.sqrt(1 / b.swiRe), z = 1.959963984540054;
    return { estimate: mu, se: se, ciLo: mu - z * se, ciHi: mu + z * se, tau2: b.tau2 };
  }
  // Group-LASSO pool: group studies by precision quartile, weighted-average the
  // group means, then soft-threshold the combined effect.
  function groupLasso(yi, vi, lambda) {
    lambda = lambda == null ? 0.1 : lambda;
    var b = dlBase(yi, vi); if (b.k < 1) return null;
    var prec = b.wiRe;   // 1/(vi+tau2)
    var bins = [quantile(prec, 0.25), quantile(prec, 0.5), quantile(prec, 0.75)];
    function digitize(x) { var g = 0; for (var j = 0; j < bins.length; j++) if (x >= bins[j]) g++; return g; }
    var gMeans = [], gWeights = [];
    for (var g = 0; g < 4; g++) {
      var sw = 0, swy = 0, any = false;
      for (var i = 0; i < yi.length; i++) if (digitize(prec[i]) === g) { sw += b.wiRe[i]; swy += b.wiRe[i] * yi[i]; any = true; }
      if (any) { gMeans.push(swy / sw); gWeights.push(sw); }
    }
    var totW = gWeights.reduce(function (a, x) { return a + x; }, 0);
    var muGl = 0; for (var m = 0; m < gMeans.length; m++) muGl += (gWeights[m] / totW) * gMeans[m];
    var pen = lambda / (b.swiRe + 1e-10);
    muGl = Math.abs(muGl) > pen ? Math.sign(muGl) * (Math.abs(muGl) - pen) : 0.0;
    var se = Math.sqrt(1 / b.swiRe), z = 1.959963984540054;
    return { estimate: muGl, se: se, ciLo: muGl - z * se, ciHi: muGl + z * se, tau2: b.tau2 };
  }
  // Elastic-net pool: closed-form minimiser of 0.5*Σwᵢ(yᵢ-μ)² + αλ|μ| + ½(1-α)λμ²
  // (the convex objective the Python source solves with a 1-D bounded optimiser).
  function elasticNet(yi, vi, lambda, alpha) {
    lambda = lambda == null ? 0.1 : lambda; alpha = alpha == null ? 0.5 : alpha;
    var b = dlBase(yi, vi); if (b.k < 1) return null;
    var S = b.swiRe, Sy = yi.reduce(function (a, y, i) { return a + b.wiRe[i] * y; }, 0);
    var st = Math.sign(Sy) * Math.max(0, Math.abs(Sy) - alpha * lambda);
    var mu = st / (S + (1 - alpha) * lambda);
    var se = Math.sqrt(1 / S), z = 1.959963984540054;
    return { estimate: mu, se: se, ciLo: mu - z * se, ciHi: mu + z * se, tau2: b.tau2 };
  }

  // ---- Benchmark-superior estimators, batch 3: deterministic iterative pools.
  // Gradient boosting on the pooled residual, and a sequential Bayesian filter
  // with an adaptive tau^2 — both fully deterministic, ported verbatim, 1e-6.
  // Gradient-boosting pool: start at the fixed-effect mean, then add a shrunken
  // (learning-rate) step toward the precision-weighted residual each round.
  function boosting(yi, vi, nRounds, lr) {
    nRounds = nRounds == null ? 20 : nRounds; lr = lr == null ? 0.2 : lr;
    var b = dlBase(yi, vi); if (b.k < 1) return null;
    var wi = vi.map(function (v) { return 1 / v; });
    var swi = wi.reduce(function (a, x) { return a + x; }, 0);
    var mu = yi.reduce(function (a, y, i) { return a + wi[i] * y; }, 0) / swi;   // FE start
    for (var r = 0; r < nRounds; r++) {
      var inc = yi.reduce(function (a, y, i) { return a + b.wiRe[i] * (y - mu); }, 0) / b.swiRe;
      mu = mu + lr * inc;
    }
    var se = Math.sqrt(1 / b.swiRe), z = 1.959963984540054;
    return { estimate: mu, se: se, ciLo: mu - z * se, ciHi: mu + z * se, tau2: b.tau2 };
  }
  // Sequential-adaptive pool: process studies most-precise first, Bayesian-update
  // the mean and grow tau^2 by the learning-rate times the excess prediction error,
  // then re-pool all studies under the final tau^2.
  function sequentialAdaptive(yi, vi, lr) {
    lr = lr == null ? 0.05 : lr;
    var k = yi.length; if (k < 1) return null;
    var idx = yi.map(function (_, i) { return i; }).sort(function (a, c) { return (1 / vi[c]) - (1 / vi[a]); });
    var ys = idx.map(function (i) { return yi[i]; }), vs = idx.map(function (i) { return vi[i]; });
    var mu = ys[0], tau2 = 0.0, cumW = 1 / vs[0];
    for (var i = 1; i < k; i++) {
      var priorVar = 1 / cumW + tau2, likVar = vs[i];
      var postVar = 1 / (1 / priorVar + 1 / likVar);
      var muNew = postVar * (mu / priorVar + ys[i] / likVar);
      var predErr = (ys[i] - mu) * (ys[i] - mu), expVar = priorVar + likVar;
      tau2 = tau2 + lr * Math.max(0, predErr - expVar);
      mu = muNew;
      cumW += 1 / (vs[i] + tau2);
    }
    var wiRe = vi.map(function (v) { return 1 / (v + tau2); });
    var swiRe = wiRe.reduce(function (a, x) { return a + x; }, 0);
    var muFinal = yi.reduce(function (a, y, i) { return a + wiRe[i] * y; }, 0) / swiRe;
    var se = Math.sqrt(1 / swiRe), z = 1.959963984540054;
    return { estimate: muFinal, se: se, ciLo: muFinal - z * se, ciHi: muFinal + z * se, tau2: tau2 };
  }

  // ---- Benchmark-superior estimators, batch 4: Gaussian-copula pool.
  // Normal-score each study's effect (standardised residual from the FE mean over
  // the total SD), measure lag-1 dependence (rho) among the scores, and inflate the
  // RE standard error by 1/sqrt(1 - |rho|/2). The point estimate is the RE mean
  // (the dependence factor is a scalar, so it cancels in the weighted mean). The
  // norm.cdf->clip[0.001,0.999]->norm.ppf round-trip is the identity except at the
  // tails, so it reduces EXACTLY to clipping the standardised residual at
  // +-norm.ppf(0.999) — no normal-CDF/quantile needed. Verified to 1e-6.
  function gaussianCopula(yi, vi) {
    var b = dlBase(yi, vi); if (b.k < 1) return null;
    var wi = vi.map(function (v) { return 1 / v; });
    var swi = wi.reduce(function (a, x) { return a + x; }, 0);
    var muFe = yi.reduce(function (a, y, i) { return a + wi[i] * y; }, 0) / swi;
    var CLIP = 3.090232306167813;   // +-norm.ppf(0.999)
    var zsc = yi.map(function (y, i) {
      var r = (y - muFe) / Math.sqrt(vi[i] + b.tau2);
      return r < -CLIP ? -CLIP : (r > CLIP ? CLIP : r);
    });
    var rho = 0;
    if (b.k > 1) {
      var a = zsc.slice(0, -1), c = zsc.slice(1), n = a.length, ma = 0, mc = 0;
      for (var i = 0; i < n; i++) { ma += a[i]; mc += c[i]; } ma /= n; mc /= n;
      var sac = 0, saa = 0, scc = 0;
      for (i = 0; i < n; i++) { var da = a[i] - ma, dc = c[i] - mc; sac += da * dc; saa += da * da; scc += dc * dc; }
      rho = (saa > 0 && scc > 0) ? sac / Math.sqrt(saa * scc) : 0;
    }
    var depAdj = 1 - Math.abs(rho) * 0.5;
    var mu = b.muRe, se = Math.sqrt(1 / (b.swiRe * depAdj)), z = 1.959963984540054;
    return { estimate: mu, se: se, ciLo: mu - z * se, ciHi: mu + z * se, tau2: b.tau2, rho: rho };
  }

  // ---- Bias signals (browser-computable subset of MAFI's asymmetry cluster) ----
  // Classic Egger (1997): OLS of the standard normal deviate (yi/sei) on precision
  // (1/sei); the intercept's t-test (df=k-2) is the small-study-asymmetry test.
  function egger(yi, sei) {
    var k = yi.length; if (k < 3) return null;
    var x = sei.map(function (s) { return 1 / s; });       // precision
    var y = yi.map(function (v, i) { return v / sei[i]; }); // SND
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < k; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; }
    var denom = k * sxx - sx * sx; if (Math.abs(denom) < 1e-300) return null;
    var b1 = (k * sxy - sx * sy) / denom, b0 = (sy - b1 * sx) / k;
    var sse = 0; for (i = 0; i < k; i++) { var r = y[i] - (b0 + b1 * x[i]); sse += r * r; }
    var df = k - 2, mse = sse / df, se0 = Math.sqrt(mse * sxx / denom);
    var t = b0 / se0, p = 2 * (1 - tcdf(Math.abs(t), df));
    return { intercept: b0, se: se0, t: t, df: df, p: p };
  }
  // Precision–effect correlation: corr(yi, 1/sei).
  function precisionEffectCor(yi, sei) {
    var k = yi.length, x = sei.map(function (s) { return 1 / s; });
    var mx = 0, my = 0; for (var i = 0; i < k; i++) { mx += x[i]; my += yi[i]; } mx /= k; my /= k;
    var sxy = 0, sxx = 0, syy = 0;
    for (i = 0; i < k; i++) { var dx = x[i] - mx, dy = yi[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    if (sxx < 1e-300 || syy < 1e-300) return 0;
    return sxy / Math.sqrt(sxx * syy);
  }

  var api = { grma: grma, conformalPI: conformalPI, specCollapse: specCollapse, egger: egger, precisionEffectCor: precisionEffectCor,
    knappHartungMod: knappHartungMod, satterthwaiteDF: satterthwaiteDF, ivPlus: ivPlus, ridge: ridge, tikhonov: tikhonov,
    qualityEffects: qualityEffects, sampleSizeWeighted: sampleSizeWeighted,
    softmaxWeighted: softmaxWeighted, lassoReg: lassoReg, groupLasso: groupLasso, elasticNet: elasticNet,
    boosting: boosting, sequentialAdaptive: sequentialAdaptive, gaussianCopula: gaussianCopula,
    tcdf: tcdf, tinv: tinv, _quantile: quantile };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.ExperimentalMA = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
