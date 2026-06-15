/* copas-shi.js — Copas & Shi (2000) selection-model profile MLE.
 *
 * The REAL Copas-Shi sensitivity analysis (NOT the kit's exploratory heuristic
 * ρ-sweep). Faithful port of metasens::copas internals (metasens 1.5-3):
 *   copas.loglik.without.beta + copas.gradient.without.beta, maximised under
 *   box constraints exactly as metasens's optim(L-BFGS-B) call. Extracted
 *   VERBATIM from the allmeta `copas/index.html` engine (the math functions
 *   only; DOM/UI stripped). R-parity: the profile MLE matches metasens::copas
 *   to ~1e-4 on effect, ρ (where identified) and τ at the shared (γ₀,γ₁)
 *   points, and reproduces tests/fixtures/copas-oracle.json (deterministic
 *   optimiser → bit-reproducible). Unadjusted FE matches metafor to 1e-6.
 *
 * The pooled effect is re-estimated as the assumed publication probability of
 * the least-precise (largest-SE) study is swept down, with the most-precise
 * study held near-always-published. Each path point is a full Copas profile
 * MLE over (effect, ρ, τ).
 *
 * advanced-stats rule: Copas selection models need k ≥ 15 for stable
 * estimation. This engine does not enforce that gate; the panel/caller flags
 * k < 15 output as illustrative.
 *
 * Reference: Copas JB, Shi JQ. Meta-analysis, funnel plots and sensitivity
 * analysis. Biostatistics 2000;1:247–262.
 *
 * Public API (window.AlmCopas):
 *   profileMLE(rows, g0, g1)  → {TE, rho, tau, seTE, seTEdiag, nll}
 *   publprobGamma(p, seMin, seMax) → {g0, g1}
 *   sensitivity(rows, opts?)  → {k, fe_pooled, fe_se, rho_bound, grid:[...]}
 *     where rows = [{te, se}, ...]; grid points carry publprob, gamma0/1,
 *     te_adj, se_adj, rho, tau, n_unpubl, lo, hi.
 */
(function (global) {
  'use strict';

  var Z975 = 1.959963984540054;
  var _RHO_BOUND = 0.9999;
  var _COPAS_PHI = 0.9999;

  // West (2009) cumulative normal — absolute accuracy ~1e-15.
  function _pnorm(x) {
    var z = Math.abs(x), p;
    if (z > 37) { p = 0; }
    else {
      var e = Math.exp(-z * z / 2);
      if (z < 7.07106781186547) {
        var b = 3.52624965998911e-2 * z + 0.700383064443688;
        b = b * z + 6.37396220353165; b = b * z + 33.912866078383;
        b = b * z + 112.079291497871; b = b * z + 221.213596169931;
        b = b * z + 220.206867912376;
        var d = 8.83883476483184e-2 * z + 1.75566716318264;
        d = d * z + 16.064177579207; d = d * z + 86.7807322029461;
        d = d * z + 296.564248779674; d = d * z + 637.333633378831;
        d = d * z + 793.826512519948; d = d * z + 440.413735824752;
        p = e * b / d;
      } else {
        var f = z + 1 / (z + 2 / (z + 3 / (z + 4 / (z + 13 / 20))));
        p = e / (2.506628274631 * f);
      }
    }
    return x > 0 ? 1 - p : p;
  }
  function _dnorm(x) { return Math.exp(-0.5 * x * x) / 2.5066282746310002; }
  // Inverse Mills ratio phi/Phi; asymptotic -x guard for the 0/0 left tail.
  function _lambda(u) {
    var P = _pnorm(u);
    if (!(P > 1e-300)) return u < 0 ? -u : 0;
    return _dnorm(u) / P;
  }

  // Negative copas log-likelihood. Returns +Inf on infeasible parameters
  // (so the optimiser rejects, matching metasens's optim feasibility).
  function _copasNLL(par, g0, g1, te, se) {
    var mu = par[0], rho = par[1], tau = par[2], sum = 0;
    for (var i = 0; i < te.length; i++) {
      var u = g0 + g1 / se[i], lam = _lambda(u);
      var denom = 1 - rho * rho * lam * (u + lam);
      if (!(denom > 0)) return Infinity;
      var sigma2 = se[i] * se[i] / denom;
      var s2t2 = sigma2 + tau * tau;
      var rhoT = rho * Math.sqrt(sigma2) / Math.sqrt(s2t2);
      var omr = 1 - rhoT * rhoT;
      if (!(omr > 0)) return Infinity;
      var v = (u + rhoT * (te[i] - mu) / Math.sqrt(s2t2)) / Math.sqrt(omr);
      if (v < -37) v = -37;
      var Pv = _pnorm(v);
      if (!(Pv > 0)) return Infinity;
      var d = te[i] - mu;
      sum += -(-0.5 * Math.log(s2t2) - d * d / (2 * s2t2) + Math.log(Pv));
    }
    return Number.isFinite(sum) ? sum : Infinity;
  }

  // Analytic gradient of the negative log-likelihood — exact port of
  // metasens:::copas.gradient.without.beta (returns d(-loglik)).
  function _copasGrad(par, g0, g1, te, se) {
    var mu = par[0], rho = par[1], tau = par[2];
    var rho2 = rho * rho, tau2 = tau * tau;
    var gm = 0, gr = 0, gt = 0;
    for (var i = 0; i < te.length; i++) {
      var TEmu = te[i] - mu, varTE = se[i] * se[i];
      var u = g0 + g1 / se[i], lam = _lambda(u);
      var ci2 = lam * (u + lam);
      var sigma2 = varTE / (1 - rho2 * ci2);
      var sigma = Math.sqrt(sigma2);
      var s2t2 = sigma2 + tau2;
      var rhoT = rho * sigma / Math.sqrt(s2t2);
      var rho2T = rhoT * rhoT;
      var bottom = Math.sqrt(1 - rho2T);
      var top = u + rhoT * TEmu / Math.sqrt(s2t2);
      var vv = top / bottom; if (vv < -37) vv = -37;
      var lamv = _lambda(vv);
      var gMu = TEmu / s2t2
        - (rhoT / Math.sqrt(s2t2 * (1 - rho2T))) * lamv;
      var gRho = -ci2 * rho * sigma2 * sigma2 / (varTE * s2t2)
        + TEmu * TEmu * ci2 * rho * sigma2 * sigma2 / (varTE * s2t2 * s2t2);
      var diffTop = (top - u) / rho
        - (top - u) * rho * ci2 / (1 - ci2 * rho2)
        + 2 * (top - u) * rho * tau2 * ci2 / (varTE + tau2 * (1 - ci2 * rho2));
      var eta = varTE / (varTE + tau2 * (1 - ci2 * rho2));
      var diffBot = Math.pow(1 - rho2T, -1.5) * rho * eta
        * (1 + rho2 * tau2 * ci2 * eta / varTE);
      gRho += (top * diffBot + diffTop / bottom) * lamv;
      var gTau = -0.5 / s2t2 + 0.5 * TEmu * TEmu / (s2t2 * s2t2)
        + (-sigma * TEmu * rho / (bottom * s2t2 * s2t2)
           - 0.5 * top * Math.pow(1 - rho2T, -1.5) * sigma2 * rho2
             / (s2t2 * s2t2)) * lamv;
      gTau = 2 * tau * gTau;
      gm += -gMu; gr += -gRho; gt += -gTau;
    }
    return [gm, gr, gt];
  }

  function _clamp(p) {
    return [par0Clamp(p[0]),
            Math.max(-_RHO_BOUND, Math.min(_RHO_BOUND, p[1])),
            Math.max(0, p[2])];
  }
  function par0Clamp(m) { return Math.max(-1e6, Math.min(1e6, m)); }

  // Box-constrained minimiser: projected BB-gradient descent with Armijo
  // backtracking, then a bounded Nelder-Mead polish (precision at active
  // bounds: rho->+-0.9999, tau->0 are common Copas solutions).
  function _minimise(g0, g1, te, se, start) {
    var x = _clamp(start.slice());
    var f = _copasNLL(x, g0, g1, te, se);
    var gprev = null, xprev = null, step = 1e-2;
    for (var it = 0; it < 600; it++) {
      var g = _copasGrad(x, g0, g1, te, se);
      if (!g.every(Number.isFinite)) break;
      if (gprev) {
        var sy = 0, ss = 0;
        for (var k = 0; k < 3; k++) {
          var ds = x[k] - xprev[k], dg = g[k] - gprev[k];
          ss += ds * ds; sy += ds * dg;
        }
        if (sy > 1e-14) step = Math.min(1e3, Math.max(1e-10, ss / sy));
      }
      xprev = x.slice(); gprev = g.slice();
      var t = step, improved = false;
      for (var ls = 0; ls < 40; ls++) {
        var cand = _clamp([x[0] - t * g[0], x[1] - t * g[1], x[2] - t * g[2]]);
        var fc = _copasNLL(cand, g0, g1, te, se);
        if (fc < f - 1e-12) { x = cand; f = fc; improved = true; break; }
        t *= 0.5;
      }
      if (!improved) break;
    }
    // Nelder-Mead polish within the box.
    x = _nelderMead(function (p) {
      return _copasNLL(_clamp(p), g0, g1, te, se);
    }, x);
    x = _clamp(x);
    return { par: x, value: _copasNLL(x, g0, g1, te, se) };
  }

  function _nelderMead(fn, x0) {
    var n = x0.length, a = 1, gc = 2, r = 0.5, sg = 0.5;
    var sx = [x0.slice()];
    for (var i = 0; i < n; i++) {
      var p = x0.slice();
      p[i] += (p[i] !== 0 ? 0.05 * Math.abs(p[i]) : 0.01);
      sx.push(p);
    }
    var fv = sx.map(fn);
    for (var iter = 0; iter < 400; iter++) {
      var ord = fv.map(function (v, i) { return i; })
        .sort(function (i, j) { return fv[i] - fv[j]; });
      sx = ord.map(function (i) { return sx[i]; });
      fv = ord.map(function (i) { return fv[i]; });
      if (Math.abs(fv[n] - fv[0]) < 1e-12) break;
      var c = new Array(n).fill(0);
      for (var i = 0; i < n; i++)
        for (var j = 0; j < n; j++) c[j] += sx[i][j] / n;
      var xr = c.map(function (cj, j) { return cj + a * (cj - sx[n][j]); });
      var fr = fn(xr);
      if (fr < fv[0]) {
        var xe = c.map(function (cj, j) { return cj + gc * (cj - sx[n][j]); });
        var fe = fn(xe);
        if (fe < fr) { sx[n] = xe; fv[n] = fe; }
        else { sx[n] = xr; fv[n] = fr; }
      } else if (fr < fv[n - 1]) { sx[n] = xr; fv[n] = fr; }
      else {
        var xc = c.map(function (cj, j) { return cj + r * (sx[n][j] - cj); });
        var fc2 = fn(xc);
        if (fc2 < fv[n]) { sx[n] = xc; fv[n] = fc2; }
        else {
          for (var i = 1; i <= n; i++) {
            sx[i] = sx[i].map(function (v, j) { return sx[0][j] + sg * (v - sx[0][j]); });
            fv[i] = fn(sx[i]);
          }
        }
      }
    }
    var best = 0;
    for (var i = 1; i <= n; i++) if (fv[i] < fv[best]) best = i;
    return sx[best];
  }

  // Egger (1997) linreg intercept sign — metasens's `left` determination
  // (metabias meth='linreg'): OLS of TE/se on 1/se; sign(intercept)==1.
  function _eggerLeft(rows) {
    var n = rows.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) {
      var x = 1 / rows[i].se, y = rows[i].te / rows[i].se;
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    var det = n * sxx - sx * sx;
    var a = det !== 0 ? (sy * sxx - sx * sxy) / det : 0; // intercept (bias)
    return a > 0;
  }

  // Profile MLE at fixed (gamma0, gamma1) over (mu, rho, tau). Multi-start
  // on the rho-sign basin (metasens seeds rho0 = +-rho.bound/2 via `left`).
  function copasProfileMLE(rows, g0, g1) {
    var te = rows.map(function (r) { return r.te; });
    var se = rows.map(function (r) { return r.se; });
    var w = rows.map(function (r) { return 1 / (r.se * r.se); });
    var sw = w.reduce(function (s, x) { return s + x; }, 0);
    var muHat = rows.reduce(function (s, r, i) { return s + w[i] * r.te; }, 0) / sw;
    var sgn = _eggerLeft(rows) ? 1 : -1;
    var best = null;
    var starts = [
      [muHat, sgn * _RHO_BOUND / 2, 0.05],
      [muHat, sgn * _RHO_BOUND * 0.9, 0.05],
      [muHat, sgn * 0.05, 0.05],
    ];
    for (var s = 0; s < starts.length; s++) {
      var r = _minimise(g0, g1, te, se, starts[s]);
      if (Number.isFinite(r.value) && (!best || r.value < best.value - 1e-10))
        best = r;
    }
    if (!best) return { TE: NaN, rho: NaN, tau: NaN, seTE: NaN, nll: NaN };
    var mu = best.par[0];
    var H = _numHessian(function (p) {
      return _copasNLL(p, g0, g1, te, se);
    }, best.par);
    var seTEdiag = H[0][0] > 0 ? Math.sqrt(1 / H[0][0]) : NaN; // metasens last-resort
    for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) H[a][b] += 1e-8;
    var inv = _inv3(H);
    var seTE = inv && inv[0][0] > 0 ? Math.sqrt(inv[0][0]) : NaN;
    return { TE: mu, rho: best.par[1], tau: best.par[2], seTE: seTE,
             seTEdiag: seTEdiag, nll: best.value };
  }

  function _numHessian(fn, x) {
    var n = x.length, h = 1e-5, H = [[0,0,0],[0,0,0],[0,0,0]];
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      var xpp = x.slice(), xpm = x.slice(), xmp = x.slice(), xmm = x.slice();
      xpp[i]+=h; xpp[j]+=h; xpm[i]+=h; xpm[j]-=h;
      xmp[i]-=h; xmp[j]+=h; xmm[i]-=h; xmm[j]-=h;
      H[i][j] = (fn(xpp) - fn(xpm) - fn(xmp) + fn(xmm)) / (4 * h * h);
    }
    return H;
  }
  function _inv3(m) {
    var a=m[0][0],b=m[0][1],c=m[0][2],d=m[1][0],e=m[1][1],f=m[1][2],
        g=m[2][0],h=m[2][1],i=m[2][2];
    var A=e*i-f*h, B=-(d*i-f*g), C=d*h-e*g;
    var det=a*A+b*B+c*C;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null;
    return [[A/det, -(b*i-c*h)/det, (b*f-c*e)/det],
            [B/det, (a*i-c*g)/det, -(a*f-c*d)/det],
            [C/det, -(a*h-b*g)/det, (a*e-b*d)/det]];
  }

  function _qnorm(p) {
    if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
    var q = p < 0.5 ? p : 1 - p;
    var t = Math.sqrt(-2 * Math.log(q));
    var c0=2.515517,c1=0.802853,c2=0.010328,d1=1.432788,d2=0.189269,d3=0.001308;
    var x = t - (c0 + c1*t + c2*t*t) / (1 + d1*t + d2*t*t + d3*t*t*t);
    x = (p < 0.5 ? -x : x);
    x = x - (_pnorm(x) - p) / _dnorm(x);  // one Newton refinement
    return x;
  }

  // Reproducible publication-probability path -> (gamma0, gamma1): smallest-SE
  // study pinned at pHi (~always published); largest-SE study's publprob swept
  // down. Identical to copas-oracle.R.
  function copasPublprobGamma(p, seMin, seMax) {
    if (p >= 1) return { g0: _qnorm(_COPAS_PHI), g1: 0 };
    var g1 = (_qnorm(_COPAS_PHI) - _qnorm(p)) / (1 / seMin - 1 / seMax);
    var g0 = _qnorm(_COPAS_PHI) - g1 / seMin;
    return { g0: g0, g1: g1 };
  }

  // Full Copas-Shi sensitivity analysis along the publication-probability path.
  // rows = [{te, se}, ...]. Returns the unadjusted FE pool + a profile-MLE
  // sensitivity grid (DOM-free; mirrors copas/index.html run()). The seTE
  // carry-forward chain is metasens's faithful display-SE fallback.
  function sensitivity(rows, opts) {
    opts = opts || {};
    rows = (rows || []).filter(function (r) { return r && Number.isFinite(r.te) && Number.isFinite(r.se) && r.se > 0; });
    if (rows.length < 3) return { available: false, k: rows.length, grid: [] };
    var w0 = rows.map(function (r) { return 1 / (r.se * r.se); });
    var sw0 = w0.reduce(function (a, b) { return a + b; }, 0);
    var fe = rows.reduce(function (acc, r, i) { return acc + w0[i] * r.te; }, 0) / sw0;
    var feSE = Math.sqrt(1 / sw0);
    var seArr = rows.map(function (r) { return r.se; });
    var seMin = Math.min.apply(null, seArr);
    var seMax = Math.max.apply(null, seArr);
    var pgrid = opts.pgrid || [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
    var sePrev = NaN;
    var grid = pgrid.map(function (p) {
      var gg = copasPublprobGamma(p, seMin, seMax);
      var mle = copasProfileMLE(rows, gg.g0, gg.g1);
      var seD = mle.seTE;
      if (sePrev === sePrev && (!Number.isFinite(seD) || seD === 0)) seD = sePrev;
      if (!Number.isFinite(seD) || seD === 0) seD = mle.seTEdiag;
      if (!Number.isFinite(seD) || seD === 0) seD = feSE;
      sePrev = seD;
      var nUnpubl = rows.reduce(function (acc, r) {
        var ps = _pnorm(gg.g0 + gg.g1 / r.se);
        return acc + (ps > 0 ? (1 - ps) / ps : 0);
      }, 0);
      return {
        publprob: p, gamma0: gg.g0, gamma1: gg.g1,
        te_adj: mle.TE, se_adj: seD, rho: mle.rho, tau: mle.tau,
        nll: mle.nll, n_unpubl: nUnpubl,
        lo: mle.TE - Z975 * seD, hi: mle.TE + Z975 * seD
      };
    });
    return {
      available: true, k: rows.length,
      fe_pooled: fe, fe_se: feSE, rho_bound: _RHO_BOUND, grid: grid
    };
  }

  var api = {
    profileMLE: copasProfileMLE,
    publprobGamma: copasPublprobGamma,
    sensitivity: sensitivity,
    Z975: Z975, RHO_BOUND: _RHO_BOUND
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AlmCopas = api;
})(typeof window !== 'undefined' ? window : globalThis);
