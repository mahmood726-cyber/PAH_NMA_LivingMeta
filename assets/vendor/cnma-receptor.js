/* shared/cnma-receptor.js — additive component-NMA + receptor decomposition
 * ============================================================================
 * Ported from glp1-doseresp-nma/glp1-obesity-mbnma/cnma_incretin.py (`cnma_wls`),
 * which is R-VALIDATED vs netmeta::discomb to 1e-6 with a fail-closed assert and
 * gated on allmeta's existing component-nma oracle (component-nma/tests/fixtures/
 * cnma-oracle.json). This is a VALIDATED module (oracle-backed), NOT Experimental.
 * (Convention note: future *claim-only* ports into allmeta should carry an
 * "Experimental" label; this module is exempt — it ships with an oracle-gated
 * parity spec, shared/tests/cnma-receptor-parity.spec.mjs.)
 *
 * Model: additive contrast CNMA (Welton 2009 / Rücker 2020), common-effect
 * closed form (= netmeta::discomb, inactive="control"). When the network is
 * consistent (tau2=0, as in the cnma-tiny oracle) common == random, so the
 * closed-form additive WLS matches discomb's component effects + SE and the
 * additive Q decomposition exactly. The math mirrors the allmeta component-nma
 * app's inline `invert`/`wls` (same Gauss-Jordan partial-pivot inverse).
 *
 * EXTENSION/DEMO: receptorDecompose() applies the same WLS to the GLP-1 / GIP /
 * glucagon (GCG) incretin-receptor decomposition — decomposing arm-level weight
 * loss into the additive contribution of each receptor agonism and predicting an
 * un-trialled GIP+glucagon agent. Hypothesis-generating: the common-component
 * assumption across molecules is approximate (high Q), GIP/GCG appear in 1-2
 * agents only, so read direction + magnitude, not pharmacological constants.
 *
 * References:
 *  - Welton NJ et al. Am J Epidemiol 2009;169:1158-65.
 *  - Rücker G et al. (additive/interaction CNMA), netmeta::discomb.
 */
(function (global) {
  "use strict";

  // ----- linear algebra (matches component-nma/index.html invert/matMul) -----
  function zeros(n, m) { return Array.from({ length: n }, () => new Array(m).fill(0)); }
  function transpose(A) {
    const n = A.length, m = A[0].length, T = zeros(m, n);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j][i] = A[i][j];
    return T;
  }
  function matMul(A, B) {
    const n = A.length, m = B[0].length, k = B.length, C = zeros(n, m);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) for (let p = 0; p < k; p++) C[i][j] += A[i][p] * B[p][j];
    return C;
  }
  function matVec(A, v) { return A.map((r) => r.reduce((s, x, j) => s + x * v[j], 0)); }
  // Gauss-Jordan with partial pivoting — identical to the app's `invert`.
  function invert(M) {
    const n = M.length;
    const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let i = 0; i < n; i++) {
      let piv = A[i][i];
      if (Math.abs(piv) < 1e-14) {
        for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > 1e-14) { const tmp = A[i]; A[i] = A[k]; A[k] = tmp; piv = A[i][i]; break; }
      }
      if (Math.abs(piv) < 1e-14) throw new Error("singular — components not identifiable from the contrasts");
      for (let j = 0; j < 2 * n; j++) A[i][j] /= piv;
      for (let k = 0; k < n; k++) if (k !== i) {
        const f = A[k][i];
        for (let j = 0; j < 2 * n; j++) A[k][j] -= f * A[i][j];
      }
    }
    return A.map((r) => r.slice(n));
  }

  /**
   * Additive contrast CNMA, common-effect closed form (port of cnma_wls).
   * @param {number[][]} X  studies × components design (rows vs empty control).
   * @param {number[]} TE   contrast effects (study vs control).
   * @param {number[]} seTE contrast standard errors.
   * @returns {{beta:number[], se:number[], Q:number, df:number, cov:number[][]}}
   *   beta = component effects; se = sqrt(diag(cov)); Q = additive WLS residual
   *   deviance; df = nStudies − nComponents.
   */
  function cnmaWls(X, TE, seTE) {
    const k = TE.length, p = X[0].length;
    if (X.length !== k || seTE.length !== k) throw new Error("X / TE / seTE length mismatch");
    const Xt = transpose(X);
    // XtW = X^T diag(1/se^2)   (column-scale Xt by weights)
    const w = seTE.map((s) => 1 / (s * s));
    const XtW = Xt.map((row) => row.map((x, j) => x * w[j]));
    const cov = invert(matMul(XtW, X));        // (X^T W X)^-1
    const beta = matVec(cov, matVec(XtW, TE)); // cov · X^T W · TE
    let Q = 0;
    for (let i = 0; i < k; i++) {
      let fit = 0; for (let j = 0; j < p; j++) fit += X[i][j] * beta[j];
      const r = TE[i] - fit; Q += w[i] * r * r;
    }
    const se = cov.map((row, j) => Math.sqrt(row[j]));
    return { beta, se, Q, df: k - p, cov };
  }

  // Predict any combination's effect (additive sum) + SE from the fitted cov.
  function predict(components, comps, beta, cov) {
    const x = comps.map((c) => (components.indexOf(c) >= 0 ? 1 : 0));
    let est = 0; for (let j = 0; j < comps.length; j++) est += x[j] * beta[j];
    // var = x' cov x
    let v = 0;
    for (let i = 0; i < comps.length; i++) for (let j = 0; j < comps.length; j++) v += x[i] * cov[i][j] * x[j];
    return { est, se: Math.sqrt(Math.max(0, v)) };
  }

  // The cnma-tiny corpus — the EXACT fixture behind allmeta's discomb oracle.
  var CNMA_TINY = {
    comps: ["a", "b", "c"],
    rows: [
      ["a", -0.40, 0.12], ["b", -0.30, 0.15], ["a+b", -0.65, 0.13],
      ["a+c", -0.55, 0.16], ["c", -0.20, 0.18], ["b+c", -0.45, 0.14],
      ["a+b+c", -0.80, 0.20],
    ],
  };

  function _buildTiny() {
    const comps = CNMA_TINY.comps;
    const X = CNMA_TINY.rows.map((r) => comps.map((c) => (r[0].split("+").indexOf(c) >= 0 ? 1 : 0)));
    const TE = CNMA_TINY.rows.map((r) => r[1]);
    const se = CNMA_TINY.rows.map((r) => r[2]);
    return { comps, X, TE, se };
  }

  /**
   * Fail-closed oracle gate: re-fit cnma-tiny and assert component est/se + the
   * additive Q decomposition match the validated netmeta::discomb oracle. Throws
   * (does not return false) when any quantity drifts beyond `tol` — preserving the
   * Python `assert ok` fail-closed behaviour.
   * @param {object} oracle parsed cnma-oracle.json.
   * @param {number} [tol=1e-6]
   * @returns {{ok:true, maxDiff:number}}
   */
  function validateAgainstOracle(oracle, tol) {
    tol = tol == null ? 1e-6 : tol;
    const { comps, X, TE, se } = _buildTiny();
    const { beta, se: sb, Q, df } = cnmaWls(X, TE, se);
    let maxDiff = 0;
    comps.forEach((c, i) => {
      const o = oracle.components[c];
      maxDiff = Math.max(maxDiff, Math.abs(beta[i] - o.est), Math.abs(sb[i] - o.se));
    });
    maxDiff = Math.max(maxDiff, Math.abs(Q - oracle.Q_additive));
    if (!(maxDiff < tol) || df !== oracle.df_additive) {
      throw new Error("CNMA WLS does not match validated discomb oracle (maxDiff=" +
        maxDiff + ", df=" + df + " vs " + oracle.df_additive + ", tol=" + tol + ")");
    }
    return { ok: true, maxDiff: maxDiff };
  }

  // ----- EXTENSION/DEMO: incretin receptor (GLP1/GIP/GCG) decomposition -----
  // Self-contained AACT-derived obesity-population weight-loss effects (pp) so the
  // demo runs offline (values transplanted verbatim from cnma_incretin's inputs).
  var INCRETIN_RX = {
    "semaglutide-sc-weekly": ["GLP1"], "semaglutide-oral": ["GLP1"], "semaglutide-sc-daily": ["GLP1"],
    "orforglipron": ["GLP1"], "tirzepatide": ["GLP1", "GIP"], "mazdutide": ["GLP1", "GCG"],
    "retatrutide": ["GLP1", "GIP", "GCG"],
  };
  // (effect_pp, se_pp) per agent; magnitudes are obesity-population weight-loss
  // percentage-points. Transplanted VERBATIM from the glp1 source's obesity CrIs
  // (eff_obesity; se = (cri_hi − cri_lo)/3.92) so the demo reproduces
  // cnma_incretin.json offline (no transport_v2.json dependency).
  var INCRETIN_EFF = {
    "semaglutide-sc-weekly": [15.8, 0.9438775510], "semaglutide-oral": [11.0, 1.1479591837],
    "semaglutide-sc-daily": [9.6, 1.6326530612], "orforglipron": [11.5, 1.7602040816],
    "tirzepatide": [18.7, 1.25], "mazdutide": [22.5, 2.7551020408],
    "retatrutide": [21.4, 2.0663265306],
  };

  /**
   * Decompose incretin weight loss into additive GLP1 / GIP / GCG receptor
   * contributions and predict an un-trialled GIP+glucagon (no GLP-1) agent.
   * @param {object} [opts] {rx, eff} to override the offline demo data.
   * @returns {{comps:string[], components:object, Q:number, df:number,
   *            triplePredicted:object, tripleObserved:object, gipGcgNoGlp1:object}}
   */
  function receptorDecompose(opts) {
    opts = opts || {};
    const rx = opts.rx || INCRETIN_RX;
    const eff = opts.eff || INCRETIN_EFF;
    const COMP = ["GLP1", "GIP", "GCG"];
    const nodes = Object.keys(rx).filter((n) => eff[n]);
    const X = nodes.map((n) => COMP.map((c) => (rx[n].indexOf(c) >= 0 ? 1 : 0)));
    const TE = nodes.map((n) => eff[n][0]);
    const se = nodes.map((n) => eff[n][1]);
    const { beta, se: sb, Q, df, cov } = cnmaWls(X, TE, se);
    const components = {};
    COMP.forEach((c, i) => {
      components[c] = {
        est: beta[i], se: sb[i],
        ciLo: beta[i] - 1.96 * sb[i], ciHi: beta[i] + 1.96 * sb[i], z: beta[i] / sb[i],
      };
    });
    const triplePredicted = predict(["GLP1", "GIP", "GCG"], COMP, beta, cov);
    const tripleObserved = eff["retatrutide"] ? { est: eff["retatrutide"][0], se: eff["retatrutide"][1] } : null;
    const gipGcgNoGlp1 = predict(["GIP", "GCG"], COMP, beta, cov);
    return { comps: COMP, nodes: nodes, components, Q, df, triplePredicted, tripleObserved, gipGcgNoGlp1 };
  }

  var api = {
    cnmaWls: cnmaWls,
    predict: predict,
    validateAgainstOracle: validateAgainstOracle,
    receptorDecompose: receptorDecompose,
    _: { invert: invert, matMul: matMul, transpose: transpose, buildTiny: _buildTiny,
      CNMA_TINY: CNMA_TINY, INCRETIN_RX: INCRETIN_RX, INCRETIN_EFF: INCRETIN_EFF },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmCnmaReceptor = api;
})(typeof window !== "undefined" ? window : globalThis);
