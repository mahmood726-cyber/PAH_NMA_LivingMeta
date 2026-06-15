/* shared/multilevel-reml.js — three-level (multilevel) meta-analysis by REML, matching
 * metafor::rma.mv(yi, vi, random = ~ 1 | cluster/unit, method="REML").
 *
 * Effect sizes (level 1, sampling variance v_i) are nested in units (level 2) nested in
 * clusters (level 3). The marginal covariance is block-diagonal by cluster c:
 *     Σ_c = σ²₃·1·1ᵀ + diag(σ²₂ + v_i),
 * i.e. a level-3 (between-cluster) variance σ²₃ shared by all rows in a cluster, plus a
 * level-2 (within-cluster, between-unit) variance σ²₂. μ is GLS; (σ²₂, σ²₃) by REML
 * (Nelder-Mead on √variance, kept ≥0). Each cluster block is inverted in closed form via
 * Sherman-Morrison (the σ²₃ term is rank-1), so it scales to large clusters.
 *
 * fit(rows) — rows: [{ cluster, y, v }, …]. Returns
 *   { mu, se, sigma2Between (level 3), sigma2Within (level 2), logLik, k, nClusters }.
 * Verified vs metafor on dat.konstantopoulos2011 (multilevel-reml-parity.spec.mjs).
 * No external dependency; no network.
 */
(function (global) {
  "use strict";
  var LOG2PI = Math.log(2 * Math.PI);

  function _byCluster(rows) {
    var map = {}, order = [];
    rows.forEach(function (r) { var c = String(r.cluster); if (!map[c]) { map[c] = []; order.push(c); } map[c].push({ y: +r.y, v: +r.v }); });
    return order.map(function (c) { return map[c]; });
  }

  // For a cluster block with D_i = σ²₂ + v_i and σ²₃ on the rank-1 term, returns the
  // Sherman-Morrison pieces: S1=Σ1/D, Sy=Σy/D, Syy=Σy²/D, logdetD=ΣlogD, denom=1+σ²₃·S1.
  function _block(grp, s2w, s2b) {
    var S1 = 0, Sy = 0, Syy = 0, logdetD = 0, i;
    for (i = 0; i < grp.length; i++) { var D = s2w + grp[i].v; if (D <= 0) D = 1e-12; var d = 1 / D; S1 += d; Sy += grp[i].y * d; Syy += grp[i].y * grp[i].y * d; logdetD += Math.log(D); }
    var denom = 1 + s2b * S1;
    return { S1: S1, Sy: Sy, Syy: Syy, logdetD: logdetD, denom: denom, logdet: logdetD + Math.log(denom) };
  }

  // GLS μ across clusters given (σ²₂, σ²₃).
  function _mu(blocks, s2b) {
    var num = 0, den = 0;
    blocks.forEach(function (b) { num += b.Sy / b.denom; den += b.S1 / b.denom; });
    return { mu: num / den, infoMu: den }; // 1'V⁻¹1 summed = den
  }

  // (y−μ)'Σ_c⁻¹(y−μ) for one block, μ scalar. Using Σ⁻¹ = diag(1/D) − σ²₃ d dᵀ/denom:
  //   q = Σ(y−μ)²/D − σ²₃·[Σ(y−μ)/D]² / denom.  Expand with S1,Sy,Syy.
  function _quad(b, mu, s2b) {
    var r1 = b.Sy - mu * b.S1;            // Σ(y−μ)/D
    var rss = b.Syy - 2 * mu * b.Sy + mu * mu * b.S1; // Σ(y−μ)²/D
    return rss - s2b * r1 * r1 / b.denom;
  }

  function _nelderMead(f, x0, step, maxit) {
    var n = x0.length, simplex = [x0.slice()], fv = [f(x0)], i, j;
    for (i = 0; i < n; i++) { var pt = x0.slice(); pt[i] += step; simplex.push(pt); fv.push(f(pt)); }
    function order() { var idx = fv.map(function (v, k) { return k; }).sort(function (a, b) { return fv[a] - fv[b]; }); simplex = idx.map(function (k) { return simplex[k]; }); fv = idx.map(function (k) { return fv[k]; }); }
    for (var it = 0; it < (maxit || 1200); it++) {
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

  function _negLL(clusters, s2w, s2b) {
    var blocks = clusters.map(function (g) { return _block(g, s2w, s2b); });
    var g = _mu(blocks, s2b), mu = g.mu, ll = 0;
    blocks.forEach(function (b) { ll += b.logdet + _quad(b, mu, s2b); });
    ll += Math.log(g.infoMu); // log|X'V⁻¹X| with X=1 ⇒ log(Σ 1'V⁻¹1)
    return { negLL: 0.5 * ll, mu: mu, infoMu: g.infoMu };
  }

  function fit(rows, opts) {
    opts = opts || {};
    var clusters = _byCluster(rows), k = rows.length, nC = clusters.length;
    // warm start: total heterogeneity ~ DL, split half/half between levels.
    var sw = 0, swy = 0, i; for (i = 0; i < k; i++) { var w = 1 / rows[i].v; sw += w; swy += w * rows[i].y; }
    var mu0 = swy / sw, Q = 0; for (i = 0; i < k; i++) Q += (1 / rows[i].v) * (rows[i].y - mu0) * (rows[i].y - mu0);
    var t0 = Math.max(0.01, (Q - (k - 1)) / sw);
    // parameterise by sqrt(variance) to keep ≥ 0.
    var obj = function (p) { return _negLL(clusters, p[0] * p[0], p[1] * p[1]).negLL; };
    var start = [Math.sqrt(t0 / 2), Math.sqrt(t0 / 2)];
    var opt = _nelderMead(obj, start, Math.sqrt(t0) / 2 || 0.1, 1500);
    opt = _nelderMead(obj, opt.x, 0.01, 1000);
    var s2w = opt.x[0] * opt.x[0], s2b = opt.x[1] * opt.x[1];
    var fin = _negLL(clusters, s2w, s2b);
    var se = Math.sqrt(1 / fin.infoMu);
    var N = k, p = 1;
    // REML logLik: −½[(N−p)log2π + log|V| + RSS + log|X'V⁻¹X|] + ½log|X'X|, X=1 ⇒ |X'X|=N.
    var logLik = -fin.negLL - 0.5 * (N - p) * LOG2PI + 0.5 * Math.log(N);
    return { mu: fin.mu, se: se, sigma2Between: s2b, sigma2Within: s2w, logLik: logLik, k: k, nClusters: nC,
      ciLo: fin.mu - 1.959963984540054 * se, ciHi: fin.mu + 1.959963984540054 * se };
  }

  var api = { fit: fit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmMultilevelREML = api;
})(typeof window !== "undefined" ? window : globalThis);
