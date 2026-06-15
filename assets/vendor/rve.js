/* shared/rve.js — Robust Variance Estimation (Hedges, Tipton, Johnson 2010)
 *
 * Closes a methodological gap vs robumeta / clubSandwich: when effect sizes
 * are dependent (multiple outcomes per study, multi-arm trials, repeated
 * measures), inverse-variance pooling underestimates SEs. RVE uses a
 * cluster-robust sandwich with a small-sample correction so β̂ has correct
 * coverage even when the working correlation ρ is misspecified.
 *
 * CORR (correlated effects working model): each cluster's effects share a
 * constant working correlation ρ, with per-effect weight
 *   w_ij = 1 / (k_j · (v̄_j + τ²))
 * where k_j is the cluster size and v̄_j the cluster's mean sampling variance.
 *
 * τ² is the Hedges-Tipton-Johnson moment estimator for the CORR model (NOT a
 * plain DerSimonian-Laird across rows — that ignores the clustering): a
 * first-pass FE fit gives residuals, then
 *   τ² = max(0, (Qe − N + termA)/denom + ρ · termB/denom).
 *
 * Small-sample correction (default CR2, Tipton 2015 / Pustejovsky-Tipton 2018):
 * because the CORR weights are constant within a cluster, W_j = w_j·I, so the
 * within-cluster annihilator block ImHii_j = I − w_j·X_j Q X_jᵀ is SYMMETRIC
 * and A_j = ImHii_j^(−1/2) is a true symmetric inverse-square-root (eigenvalues
 * < 1e-10 zeroed, exactly as robumeta). Degrees of freedom are per-coefficient
 * Satterthwaite. CR1 (a single scalar correction, anticonservative at small m)
 * remains available via opts.method = "CR1".
 *
 * Verified vs robumeta::robu(modelweights="CORR", small=TRUE) to ≤1e-5 on every
 * reported quantity (τ², β̂, CR2 SE, Satterthwaite df) across a homogeneous
 * (τ²=0) and a heterogeneous (τ²>0) dataset; see rve-meta-cr2-parity.spec.mjs.
 *
 * Reference: Hedges, Tipton & Johnson (2010), Research Synth Methods 1(1):39-65;
 * Tipton (2015), Psych Methods 20(3):375-393; Pustejovsky & Tipton (2018),
 * J Bus Econ Stat 36(4):672-683. R package robumeta (Fisher, Tipton, Zhipeng).
 */
(function (global) {
  "use strict";

  // ----- Matrix utilities (mini, no external deps) -----------------------

  function zeros(n, m) {
    var out = new Array(n);
    for (var i = 0; i < n; i++) { out[i] = new Array(m); for (var j = 0; j < m; j++) out[i][j] = 0; }
    return out;
  }
  function identity(n) {
    var I = zeros(n, n);
    for (var i = 0; i < n; i++) I[i][i] = 1;
    return I;
  }
  function transpose(A) {
    var n = A.length, m = A[0].length;
    var T = zeros(m, n);
    for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) T[j][i] = A[i][j];
    return T;
  }
  function matMul(A, B) {
    var n = A.length, m = B[0].length, k = B.length;
    var C = zeros(n, m);
    for (var i = 0; i < n; i++)
      for (var j = 0; j < m; j++) {
        var s = 0;
        for (var t = 0; t < k; t++) s += A[i][t] * B[t][j];
        C[i][j] = s;
      }
    return C;
  }
  function matVec(A, v) {
    var n = A.length, m = v.length;
    var out = new Array(n);
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (var j = 0; j < m; j++) s += A[i][j] * v[j];
      out[i] = s;
    }
    return out;
  }
  function trace(A) { var s = 0; for (var i = 0; i < A.length; i++) s += A[i][i]; return s; }

  // Gauss-Jordan inverse; small p ≤ ~20 is fine for meta-regression designs.
  function invert(A) {
    var n = A.length;
    var M = new Array(n);
    for (var i = 0; i < n; i++) M[i] = A[i].slice().concat(identity(n)[i]);
    for (var c = 0; c < n; c++) {
      var pivRow = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivRow][c])) pivRow = r;
      if (Math.abs(M[pivRow][c]) < 1e-12) throw new Error("RVE: singular X'WX");
      if (pivRow !== c) { var tmp = M[c]; M[c] = M[pivRow]; M[pivRow] = tmp; }
      var piv = M[c][c];
      for (var j = 0; j < 2 * n; j++) M[c][j] /= piv;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c) continue;
        var f = M[r2][c];
        if (f === 0) continue;
        for (var j2 = 0; j2 < 2 * n; j2++) M[r2][j2] -= f * M[c][j2];
      }
    }
    var inv = zeros(n, n);
    for (var ii = 0; ii < n; ii++) for (var jj = 0; jj < n; jj++) inv[ii][jj] = M[ii][n + jj];
    return inv;
  }

  // Symmetric eigendecomposition via cyclic Jacobi rotations (Numerical Recipes
  // formulation). n is small (per-cluster k_j, typically ≤ ~20). Returns
  // { values: [...], vectors } where vectors[i][c] is component i of eigvec c.
  function symEig(Ain) {
    var n = Ain.length;
    var A = Ain.map(function (r) { return r.slice(); });
    var V = identity(n);
    for (var sweep = 0; sweep < 100; sweep++) {
      var off = 0;
      for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
      if (off < 1e-30) break;
      for (var pp = 0; pp < n; pp++) {
        for (var qq = pp + 1; qq < n; qq++) {
          var apq = A[pp][qq];
          if (Math.abs(apq) < 1e-300) continue;
          var theta = (A[qq][qq] - A[pp][pp]) / (2 * apq);
          var tt = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          var cc = 1 / Math.sqrt(tt * tt + 1), ss = tt * cc;
          // Apply Givens rotation G' A G (rows/cols pp,qq).
          for (var r = 0; r < n; r++) {
            var arp = A[r][pp], arq = A[r][qq];
            A[r][pp] = cc * arp - ss * arq;
            A[r][qq] = ss * arp + cc * arq;
          }
          for (var c = 0; c < n; c++) {
            var apc = A[pp][c], aqc = A[qq][c];
            A[pp][c] = cc * apc - ss * aqc;
            A[qq][c] = ss * apc + cc * aqc;
          }
          for (var v = 0; v < n; v++) {
            var vrp = V[v][pp], vrq = V[v][qq];
            V[v][pp] = cc * vrp - ss * vrq;
            V[v][qq] = ss * vrp + cc * vrq;
          }
        }
      }
    }
    var vals = new Array(n);
    for (var d = 0; d < n; d++) vals[d] = A[d][d];
    return { values: vals, vectors: V };
  }

  // Symmetric inverse square root: V diag(λ^{-1/2}) Vᵀ, with λ < 1e-10 → 0
  // (matches robumeta's eigenval thresholding for rank-deficient leverage blocks).
  function invSqrtSym(A) {
    var n = A.length, eig = symEig(A), V = eig.vectors;
    var d = eig.values.map(function (l) { return l < 1e-10 ? 0 : 1 / Math.sqrt(l); });
    var out = zeros(n, n);
    for (var i = 0; i < n; i++)
      for (var j = 0; j < n; j++) {
        var s = 0;
        for (var c = 0; c < n; c++) s += V[i][c] * d[c] * V[j][c];
        out[i][j] = s;
      }
    return out;
  }

  // ----- CORR-model fit ---------------------------------------------------
  //
  // Input rows: { cluster, yi, vi, X: [...predictors including intercept] }
  // opts: { rho (0–1, default 0.8), tau2 (override), method ("CR2" default | "CR1") }
  //
  // Returns: { beta, cov_robust, se_robust, df (per-coefficient array),
  //   m_clusters, k_total, p, tau2, rho, method, weights }

  function fitCORR(rows, opts) {
    opts = opts || {};
    var rho = (typeof opts.rho === "number" && opts.rho >= 0 && opts.rho <= 1) ? opts.rho : 0.8;
    var method = (opts.method === "CR1") ? "CR1" : "CR2";
    var k = rows.length;
    if (!k) throw new Error("RVE: no rows");
    var p = rows[0].X.length; // includes intercept (robumeta's p+1)

    // Group by cluster (preserves first-seen order).
    var clusterOrder = [];
    var byCluster = Object.create(null);
    for (var i = 0; i < k; i++) {
      var c = String(rows[i].cluster);
      if (!byCluster[c]) { byCluster[c] = []; clusterOrder.push(c); }
      byCluster[c].push(i);
    }
    var m = clusterOrder.length; // N in robumeta (number of studies/clusters)

    // Per-cluster size k_j and mean sampling variance v̄_j.
    var clKj = {}, clVbar = {};
    for (var ci = 0; ci < m; ci++) {
      var key = clusterOrder[ci], idx = byCluster[key], sv = 0;
      for (var a = 0; a < idx.length; a++) sv += rows[idx[a]].vi;
      clKj[key] = idx.length; clVbar[key] = sv / idx.length;
    }

    var X = rows.map(function (r) { return r.X.slice(); });
    var y = rows.map(function (r) { return r.yi; });

    // Weighted IV fit for a per-row weight vector. Returns {M=(X'WX)^{-1}, beta}.
    function fitW(weights) {
      var XtW = transpose(X).map(function (col) { return col.map(function (v2, i2) { return v2 * weights[i2]; }); });
      var XtWX = matMul(XtW, X);
      var Minv = invert(XtWX);
      return { M: Minv, beta: matVec(Minv, matVec(XtW, y)) };
    }
    function residuals(beta) {
      var e = new Array(k);
      for (var i2 = 0; i2 < k; i2++) { var fi = 0; for (var j = 0; j < p; j++) fi += X[i2][j] * beta[j]; e[i2] = y[i2] - fi; }
      return e;
    }
    function clusterWeights(tau2) {
      var w = new Array(k);
      for (var ci2 = 0; ci2 < m; ci2++) {
        var key2 = clusterOrder[ci2], idx2 = byCluster[key2];
        var wj = 1 / (clKj[key2] * (clVbar[key2] + tau2));
        for (var a2 = 0; a2 < idx2.length; a2++) w[idx2[a2]] = wj;
      }
      return w;
    }

    // ---- τ² via the HTJ CORR moment estimator (unless overridden) --------
    var tau2;
    if (typeof opts.tau2 === "number" && opts.tau2 >= 0) {
      tau2 = opts.tau2;
    } else {
      // First-pass FE weights w_ij = 1/(k_j · v̄_j); residuals from that fit.
      var wFE = clusterWeights(0);
      var f0 = fitW(wFE);
      var e0 = residuals(f0.beta);
      var Qe = 0, sumW = 0;
      for (var i3 = 0; i3 < k; i3++) { Qe += wFE[i3] * e0[i3] * e0[i3]; sumW += wFE[i3]; }
      // Within W_j = w_j·I and J_j = ones(k_j): build the three trace terms.
      //   sumXWJWX_j = w_j² (Σ_a X_a)(Σ_a X_a)ᵀ
      //   Matrx_WKXX_j = (w_j/k_j) Σ_a X_a X_aᵀ
      //   Matrx_wk_XJX_XX_j = (w_j/k_j)[ (Σ X)(Σ X)ᵀ − Σ X_a X_aᵀ ]
      var sumXWJWX = zeros(p, p), MWKXX = zeros(p, p), MwkXJ = zeros(p, p);
      for (var cj = 0; cj < m; cj++) {
        var keyj = clusterOrder[cj], idxj = byCluster[keyj], wj0 = wFE[idxj[0]], kj0 = idxj.length;
        var cs = new Array(p); for (var jj = 0; jj < p; jj++) { var s2 = 0; for (var aa = 0; aa < idxj.length; aa++) s2 += X[idxj[aa]][jj]; cs[jj] = s2; }
        for (var rr = 0; rr < p; rr++) for (var c2 = 0; c2 < p; c2++) {
          var xtx = 0; for (var ab = 0; ab < idxj.length; ab++) xtx += X[idxj[ab]][rr] * X[idxj[ab]][c2];
          sumXWJWX[rr][c2] += wj0 * wj0 * cs[rr] * cs[c2];
          MWKXX[rr][c2] += (wj0 / kj0) * xtx;
          MwkXJ[rr][c2] += (wj0 / kj0) * (cs[rr] * cs[c2] - xtx);
        }
      }
      var denom = sumW - trace(matMul(f0.M, sumXWJWX));
      var termA = trace(matMul(f0.M, MWKXX));
      var termB = trace(matMul(f0.M, MwkXJ));
      var term1 = (Qe - m + termA) / denom;
      var term2 = termB / denom;
      tau2 = Math.max(0, term1 + rho * term2);
    }

    // ---- Re-weighted fit with the RVE weights ----------------------------
    var weights = clusterWeights(tau2);
    var fit = fitW(weights);
    var beta = fit.beta, Q = fit.M; // Q = bread = (X'WX)^{-1}
    var resid = residuals(beta);

    var cov, dfArr;
    if (method === "CR1") {
      // CR0 meat Σ_c u_c u_cᵀ with u_c = X_cᵀ W_c r_c, then scalar CR1 factor.
      var meat1 = zeros(p, p);
      for (var cc1 = 0; cc1 < m; cc1++) {
        var idxC1 = byCluster[clusterOrder[cc1]];
        var u = new Array(p);
        for (var j3 = 0; j3 < p; j3++) { var su = 0; for (var a3 = 0; a3 < idxC1.length; a3++) { var r4 = idxC1[a3]; su += X[r4][j3] * weights[r4] * resid[r4]; } u[j3] = su; }
        for (var i4 = 0; i4 < p; i4++) for (var j4 = 0; j4 < p; j4++) meat1[i4][j4] += u[i4] * u[j4];
      }
      var cr1 = (m > 1) ? (m / (m - 1)) * ((k - 1) / Math.max(1, k - p)) : 1;
      for (var ii2 = 0; ii2 < p; ii2++) for (var jj2 = 0; jj2 < p; jj2++) meat1[ii2][jj2] *= cr1;
      cov = matMul(matMul(Q, meat1), Q);
      var df1 = Math.max(1, m - p);
      dfArr = []; for (var z = 0; z < p; z++) dfArr.push(df1);
    } else {
      // ---- CR2 bias-reduced sandwich -------------------------------------
      // Per cluster: A_j = (I − w_j X_j Q X_jᵀ)^{-1/2}, g_j = w_j X_jᵀ A_j e_j,
      // meat = Σ_j g_j g_jᵀ, cov = Q meat Q.
      var XQ = matMul(X, Q); // k × p  (row α = X_α Q)
      var meat = zeros(p, p);
      var Alist = [], idxList = [];
      for (var cc = 0; cc < m; cc++) {
        var idxC = byCluster[clusterOrder[cc]], kj = idxC.length, wj = weights[idxC[0]];
        // ImHii = I − w_j X_j Q X_jᵀ  (k_j × k_j, symmetric)
        var ImHii = zeros(kj, kj);
        for (var a4 = 0; a4 < kj; a4++) for (var b4 = 0; b4 < kj; b4++) {
          var dot = 0; for (var l = 0; l < p; l++) dot += XQ[idxC[a4]][l] * X[idxC[b4]][l];
          ImHii[a4][b4] = (a4 === b4 ? 1 : 0) - wj * dot;
        }
        var Aj = invSqrtSym(ImHii);
        Alist.push(Aj); idxList.push(idxC);
        // g_j = w_j X_jᵀ A_j e_j
        var Ae = new Array(kj);
        for (var a5 = 0; a5 < kj; a5++) { var sA = 0; for (var b5 = 0; b5 < kj; b5++) sA += Aj[a5][b5] * resid[idxC[b5]]; Ae[a5] = sA; }
        var g = new Array(p);
        for (var j5 = 0; j5 < p; j5++) { var sg = 0; for (var a6 = 0; a6 < kj; a6++) sg += X[idxC[a6]][j5] * Ae[a6]; g[j5] = wj * sg; }
        for (var i6 = 0; i6 < p; i6++) for (var j6 = 0; j6 < p; j6++) meat[i6][j6] += g[i6] * g[j6];
      }
      cov = matMul(matMul(Q, meat), Q);

      // ---- Satterthwaite df per coefficient ------------------------------
      // Full ImH (k×k): ImH[α][γ] = δ − (X_α Q X_γᵀ) w_γ.
      var ImH = zeros(k, k);
      for (var aF = 0; aF < k; aF++) for (var gF = 0; gF < k; gF++) {
        var dt = 0; for (var lF = 0; lF < p; lF++) dt += XQ[aF][lF] * X[gF][lF];
        ImH[aF][gF] = (aF === gF ? 1 : 0) - dt * weights[gF];
      }
      var sqrtW = weights.map(function (wv) { return Math.sqrt(wv); });
      dfArr = [];
      for (var ic = 0; ic < p; ic++) {
        // v_{j} (length k): v_j[γ] = (1/√w_γ) Σ_{α∈j} ImH[α][γ] · P_j[α][ic],
        //   P_j = w_j A_j X_j Q.
        var vList = [];
        for (var cj2 = 0; cj2 < m; cj2++) {
          var idxC2 = idxList[cj2], Aj2 = Alist[cj2], kj2 = idxC2.length, wj2 = weights[idxC2[0]];
          // P_j[:,ic] (length k_j) = w_j · A_j · (X_j Q)[:,ic]
          var Pcol = new Array(kj2);
          for (var a7 = 0; a7 < kj2; a7++) { var sp = 0; for (var b7 = 0; b7 < kj2; b7++) sp += Aj2[a7][b7] * XQ[idxC2[b7]][ic]; Pcol[a7] = wj2 * sp; }
          var v = new Array(k);
          for (var gC = 0; gC < k; gC++) {
            var sv = 0; for (var a8 = 0; a8 < kj2; a8++) sv += ImH[idxC2[a8]][gC] * Pcol[a8];
            v[gC] = sv / sqrtW[gC];
          }
          vList.push(v);
        }
        // dfs = (Σ_j v_j·v_j)² / Σ_{j,j'} (v_j·v_{j'})²
        var traceB = 0, sumSq = 0;
        for (var jA = 0; jA < m; jA++) {
          for (var jB = 0; jB < m; jB++) {
            var dotv = 0; for (var gD = 0; gD < k; gD++) dotv += vList[jA][gD] * vList[jB][gD];
            sumSq += dotv * dotv;
            if (jA === jB) traceB += dotv;
          }
        }
        dfArr.push(sumSq > 0 ? (traceB * traceB) / sumSq : Math.max(1, m - p));
      }
    }

    var se = new Array(p);
    for (var i7 = 0; i7 < p; i7++) se[i7] = Math.sqrt(Math.max(0, cov[i7][i7]));

    return {
      beta: beta, cov_robust: cov, se_robust: se,
      df: dfArr, m_clusters: m, k_total: k, p: p,
      tau2: tau2, rho: rho, method: method, weights: weights,
    };
  }

  // Plain DL across all rows (ignores clustering) — retained for callers that
  // want a quick τ² approximation; the CORR fit uses the HTJ estimator above.
  function tau2_DL_simple(yi, vi) {
    var k = yi.length;
    var w = vi.map(function (v) { return 1 / v; });
    var sw = w.reduce(function (a, b) { return a + b; }, 0);
    var muFE = w.reduce(function (a, b, i) { return a + b * yi[i]; }, 0) / sw;
    var Q = 0;
    for (var i = 0; i < k; i++) Q += w[i] * (yi[i] - muFE) * (yi[i] - muFE);
    var sw2 = w.reduce(function (a, b) { return a + b * b; }, 0);
    var denom = sw - sw2 / sw;
    if (denom <= 1e-12) return 0;
    return Math.max(0, (Q - (k - 1)) / denom);
  }

  // ----- Inference --------------------------------------------------------

  function summary(fit, opts) {
    opts = opts || {};
    var qt = (global.AlmStats && global.AlmStats.qt) ? global.AlmStats.qt : null;
    var out = [];
    for (var j = 0; j < fit.p; j++) {
      var dfj = Array.isArray(fit.df) ? fit.df[j] : fit.df;
      var crit = qt ? qt(0.975, dfj) : 1.96;
      var est = fit.beta[j];
      var sej = fit.se_robust[j];
      var tval = sej > 0 ? est / sej : 0;
      var pval;
      if (global.AlmStats && global.AlmStats.pt) {
        pval = 2 * (1 - global.AlmStats.pt(Math.abs(tval), dfj));
      } else {
        pval = 2 * (1 - 0.5 * (1 + _erfApprox(Math.abs(tval) / Math.SQRT2)));
      }
      out.push({ coef_index: j, estimate: est, se: sej, t: tval, df: dfj, ci_lo: est - crit * sej, ci_hi: est + crit * sej, p: pval });
    }
    return out;
  }
  function _erfApprox(x) {
    var t = 1 / (1 + 0.3275911 * Math.abs(x));
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }

  var api = {
    fitCORR: fitCORR,
    summary: summary,
    tau2_DL_simple: tau2_DL_simple,
    _invert: invert,
    _matMul: matMul,
    _symEig: symEig,
    _invSqrtSym: invSqrtSym,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmRVE = api;
})(typeof window !== "undefined" ? window : globalThis);
