/*
 * registry-ipd engine — Registry-Native Pseudo-IPD Reconstructor (ct.gov / AACT only)
 * ----------------------------------------------------------------------------------
 * Reconstructs PSEUDO individual-patient time-to-event data from ClinicalTrials.gov /
 * AACT *summary* fields only. There is NO Kaplan-Meier curve and NO true IPD in AACT;
 * the input is exact registry-reported anchors (KM-estimate points, number-at-risk,
 * median, hazard ratio). The edge over digitization tools is ZERO digitization error
 * and full provenance — NOT universal superiority. See README for the scoped claim.
 *
 * Single UMD module (Node + browser). Sections:
 *   1. small numeric utilities (PAVA, RNG, hashing, quantile)
 *   2. survival primitives (KM from IPD, median, RMST, 1-Wasserstein)
 *   3. Cox PH single-covariate (Breslow ties) for the self-audit HR check
 *   4. Tier A — two methods: Guyot inverse-KM (constant censoring) AND censoring-informed
 *      anchor-exact (RESOLVE-IPD CEN-KM style); best-of selected by min 1-Wasserstein to anchors
 *   5. Tier B — parametric (exponential) with seeded bootstrap envelope
 *   6. tiering + self-audit checks (C1..C9) + Bronze/Silver/Gold badge
 *   7. top-level reconstruct()
 *
 * Reference: Guyot P. et al. (2012) BMC Med Res Methodol 12:9.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.RIPD = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ============================================================ 1. utilities

  // Pool-Adjacent-Violators enforcing a NON-INCREASING sequence (isotonic, decreasing).
  // Returns {y, adjusted, maxAdj} where adjusted counts how many points moved.
  function pavaDecreasing(s) {
    const n = s.length;
    const y = s.slice();
    // Work on the negated series to reuse increasing-PAVA logic.
    const v = y.map(x => -x);
    const w = new Array(n).fill(1);
    const val = v.slice();
    const blockW = w.slice();
    const blockStart = []; const blockVal = []; const blockWt = [];
    for (let i = 0; i < n; i++) {
      let cv = val[i], cw = blockW[i], cs = i;
      while (blockVal.length > 0 && blockVal[blockVal.length - 1] >= cv) {
        const pv = blockVal.pop(), pw = blockWt.pop(); cs = blockStart.pop();
        cv = (pv * pw + cv * cw) / (pw + cw); cw = pw + cw;
      }
      blockVal.push(cv); blockWt.push(cw); blockStart.push(cs);
    }
    // expand blocks back
    let idx = n; const out = new Array(n);
    for (let b = blockVal.length - 1; b >= 0; b--) {
      const start = blockStart[b];
      for (let k = start; k < idx; k++) out[k] = -blockVal[b];
      idx = start;
    }
    let adjusted = 0, maxAdj = 0;
    for (let i = 0; i < n; i++) {
      const dlt = Math.abs(out[i] - s[i]);
      if (dlt > 1e-12) { adjusted++; if (dlt > maxAdj) maxAdj = dlt; }
    }
    return { y: out, adjusted, maxAdj };
  }

  // mulberry32 — small, fast, fully deterministic seeded PRNG.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // deterministic 32-bit string hash (so seed = hash(nct_id) is reproducible)
  function hashStr(str) {
    let h = 2166136261 >>> 0;
    str = String(str == null ? '' : str);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function quantileSorted(sorted, p) {
    if (sorted.length === 0) return NaN;
    if (sorted.length === 1) return sorted[0];
    const idx = p * (sorted.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  // ====================================================== 2. survival primitives

  // Kaplan-Meier estimate from pseudo-IPD rows [{time,status}] (status 1=event,0=censor).
  // Returns step points: [{t, S, nRisk, d, c}] with S right-continuous after event times.
  function kmFromIPD(ipd) {
    if (!ipd.length) return [];
    const rows = ipd.slice().sort((a, b) => a.time - b.time || a.status - b.status);
    const times = [...new Set(rows.map(r => r.time))].sort((a, b) => a - b);
    let nRisk = rows.length, S = 1;
    const steps = [];
    for (const t of times) {
      const atT = rows.filter(r => Math.abs(r.time - t) < 1e-12);
      const d = atT.filter(r => r.status === 1).length;
      const c = atT.filter(r => r.status === 0).length;
      if (d > 0) S *= (1 - d / nRisk);
      steps.push({ t, S, nRisk, d, c });
      nRisk -= (d + c);
    }
    return steps;
  }

  // Median survival from KM steps = smallest event time with S <= 0.5 (null if not reached).
  // With {interpolate:true}, linearly interpolate the 0.5-crossing between the bracketing points —
  // important for COARSE registry curves, whose step median otherwise snaps up to the next posted
  // timepoint (validated: external same-endpoint median error 40% -> 6% with interpolation).
  function medianFromKM(steps, opts) {
    let pt = 0, ps = 1;
    for (const s of steps) {
      if (s.S <= 0.5 + 1e-12) {
        if (opts && opts.interpolate && ps > 0.5 && ps - s.S > 1e-12)
          return pt + (ps - 0.5) / (ps - s.S) * (s.t - pt);
        return s.t;
      }
      pt = s.t; ps = s.S;
    }
    return null;
  }

  // Restricted mean survival time to horizon tau (area under the KM step function).
  function rmst(steps, tau) {
    if (!steps.length) return 0;
    let area = 0, prevT = 0, prevS = 1;
    for (const s of steps) {
      const t = Math.min(s.t, tau);
      if (t > prevT) area += prevS * (t - prevT);
      prevT = s.t; prevS = s.S;
      if (s.t >= tau) return area;
    }
    if (tau > prevT) area += prevS * (tau - prevT);
    return area;
  }

  // Evaluate a KM step function (from kmFromIPD) at arbitrary time t (right-continuous).
  function evalKM(steps, t) {
    let S = 1;
    for (const s of steps) { if (s.t <= t + 1e-12) S = s.S; else break; }
    return S;
  }

  // 1-Wasserstein (L1) distance between two survival curves over [0,tau].
  function wasserstein1(stepsA, stepsB, tau, grid) {
    grid = grid || 400;
    let acc = 0; const dt = tau / grid;
    for (let i = 0; i < grid; i++) {
      const t = (i + 0.5) * dt;
      acc += Math.abs(evalKM(stepsA, t) - evalKM(stepsB, t)) * dt;
    }
    return acc;
  }

  // ====================================================== 3. Cox PH (single covariate)

  // Cox partial-likelihood for ONE binary covariate x (1=experimental, 0=control),
  // Breslow ties, Newton-Raphson. Optional ridge penalty stabilises near-separation.
  // rows: [{time, status, x}]. Returns {beta, hr, iters, separated, penalized}.
  function coxLogHR(rows, opts) {
    opts = opts || {};
    const ridge = opts.ridge || 0;
    const data = rows.slice().sort((a, b) => b.time - a.time); // descending => cumulative risk set
    const nEventExp = rows.filter(r => r.status === 1 && r.x === 1).length;
    const nEventCtl = rows.filter(r => r.status === 1 && r.x === 0).length;
    const separated = nEventExp === 0 || nEventCtl === 0;
    const lam = ridge || (separated ? 1.0 : 0); // auto-ridge under separation
    // unique event times
    const evTimes = [...new Set(rows.filter(r => r.status === 1).map(r => r.time))].sort((a, b) => a - b);
    let beta = 0, iters = 0;
    for (; iters < 100; iters++) {
      let U = 0, I = 0;
      for (const et of evTimes) {
        const risk = rows.filter(r => r.time >= et - 1e-12);
        const ev = rows.filter(r => r.status === 1 && Math.abs(r.time - et) < 1e-12);
        let S0 = 0, S1 = 0;
        for (const r of risk) { const e = Math.exp(beta * r.x); S0 += e; S1 += r.x * e; }
        const dt = ev.length;
        const sumX = ev.reduce((a, r) => a + r.x, 0);
        const p = S0 > 0 ? S1 / S0 : 0;
        U += sumX - dt * p;            // x^2 = x for binary
        I += dt * (p - p * p);
      }
      U -= lam * beta;                 // ridge gradient
      I += lam;
      if (I <= 1e-12) break;
      const step = U / I;
      beta += step;
      if (Math.abs(step) < 1e-8) { iters++; break; }
      if (!isFinite(beta)) { beta = Math.sign(U) * 5; break; }
    }
    return { beta, hr: Math.exp(beta), iters, separated, penalized: lam > 0 };
  }

  // ====================================================== 4. Tier A — Guyot inverse-KM

  // Map number-at-risk report times to clicked-point indices (lower/upper brackets).
  function buildRiskIndices(tS, tRisk) {
    const nt = tS.length, lower = [], upper = [];
    for (let i = 0; i < tRisk.length; i++) {
      let k = 0; while (k < nt && tS[k] < tRisk[i] - 1e-9) k++;
      lower[i] = Math.min(k, nt - 1);
    }
    for (let i = 0; i < tRisk.length; i++) {
      upper[i] = (i < tRisk.length - 1) ? Math.max(lower[i + 1] - 1, lower[i]) : nt - 1;
    }
    return { lower, upper };
  }

  // Faithful port of Guyot et al. KM.reconstruct. Produces per-clicked-point deaths d[]
  // and censors cen[]. totEvents (optional) anchors the final interval.
  function guyotCore(tS, S, tRisk, nRisk, totEvents) {
    const { lower, upper } = buildRiskIndices(tS, tRisk);
    const nInt = nRisk.length, nt = tS.length;
    const nCensor = new Array(nInt).fill(0);
    const nhat = new Array(nt + 1).fill(nRisk[0] + 1);
    const cen = new Array(nt).fill(0);
    const d = new Array(nt).fill(0);
    const KMhat = new Array(nt).fill(1);
    const lastI = new Array(nInt).fill(0);
    let sumdL = 0;

    function distributeCensor(i, m) {
      for (let k = lower[i]; k <= upper[i]; k++) cen[k] = 0;
      if (m <= 0) return;
      const a = tS[lower[i]], b = tS[Math.min(lower[i + 1], nt - 1)];
      const span = (b - a) || 1;
      for (let j = 0; j < m; j++) {
        const ct = a + span * (j + 0.5) / m;
        let kk = lower[i];
        while (kk < upper[i] && tS[kk + 1] <= ct + 1e-12) kk++;
        cen[kk]++;
      }
    }

    for (let i = 0; i < nInt - 1; i++) {
      // first approximation of number censored on interval i
      const sLo = S[lower[i]] || 1e-12;
      nCensor[i] = Math.round(nRisk[i] * (S[lower[i + 1]] / sLo) - nRisk[i + 1]);
      let guard = 0;
      while ((nhat[lower[i + 1]] > nRisk[i + 1]) ||
             (nhat[lower[i + 1]] < nRisk[i + 1] && nCensor[i] > 0)) {
        if (guard++ > 5000) break;
        if (nCensor[i] <= 0) { for (let k = lower[i]; k <= upper[i]; k++) cen[k] = 0; nCensor[i] = 0; }
        else distributeCensor(i, nCensor[i]);
        nhat[lower[i]] = nRisk[i];
        let last = lastI[i];
        for (let k = lower[i]; k <= upper[i]; k++) {
          if (i === 0 && k === lower[i]) { d[k] = 0; KMhat[k] = 1; }
          else {
            const ref = KMhat[last] || 1e-12;
            d[k] = Math.round(nhat[k] * (1 - S[k] / ref));
            if (d[k] < 0) d[k] = 0; if (d[k] > nhat[k]) d[k] = nhat[k];
          }
          KMhat[k] = (KMhat[last] || 1) * (1 - d[k] / (nhat[k] || 1));
          nhat[k + 1] = nhat[k] - d[k] - cen[k];
          if (nhat[k + 1] < 0) nhat[k + 1] = 0;
          if (d[k] !== 0) last = k;
        }
        nCensor[i] = nCensor[i] + (nhat[lower[i + 1]] - nRisk[i + 1]);
        lastI[i + 1] = last;
      }
      for (let k = lower[i]; k <= upper[i]; k++) sumdL += d[k];
    }

    // ---- final interval: anchor on totEvents if available ----
    const i = nInt - 1;
    if (nt - 1 >= lower[i]) {
      nhat[lower[i]] = nRisk[i];
      let last = lastI[i];
      for (let k = lower[i]; k < nt; k++) {
        if (i === 0 && k === lower[i]) { d[k] = 0; KMhat[k] = 1; nhat[k + 1] = nhat[k] - cen[k]; continue; }
        const ref = KMhat[last] || 1e-12;
        d[k] = Math.round(nhat[k] * (1 - S[k] / ref));
        if (d[k] < 0) d[k] = 0; if (d[k] > nhat[k]) d[k] = nhat[k];
        KMhat[k] = ref * (1 - d[k] / (nhat[k] || 1));
        // remaining at-risk after last clicked point are censored
        cen[k] = (k === nt - 1) ? Math.max(0, nhat[k] - d[k]) : 0;
        nhat[k + 1] = nhat[k] - d[k] - cen[k];
        if (nhat[k + 1] < 0) nhat[k + 1] = 0;
        if (d[k] !== 0) last = k;
      }
    }

    return { d, cen, lower, upper, nhat };
  }

  // Conserving normalization + expansion. A forward capacity walk fixes the population
  // at EXACTLY N (every patient leaves the risk set once), then reconcile to totEvents by
  // SWAPPING censor<->event (never adding bodies). Remaining at-risk are tail-censored.
  function normalizeAndExpand(tS, d, cen, N, totEvents, followUp, flags) {
    const nt = tS.length;
    const D = d.slice(), C = cen.slice();
    let n = N;
    for (let k = 0; k < nt; k++) {
      if (D[k] < 0) D[k] = 0; if (D[k] > n) D[k] = n;
      if (C[k] < 0) C[k] = 0; if (C[k] > n - D[k]) C[k] = n - D[k];
      n = n - D[k] - C[k];
    }
    let tailC = Math.max(0, n);                 // remaining at-risk -> administrative censor
    const tailT = (followUp != null) ? followUp : tS[nt - 1];
    if (totEvents != null) {
      let delta = totEvents - D.reduce((a, b) => a + b, 0);
      // Distribute the correction PROPORTIONAL to the curve's death profile d[k] (never at t=0),
      // so reconciling to the registry total preserves KM anchor fidelity instead of piling
      // events at the earliest censor. Guyot's constant-censoring assumption systematically
      // mis-splits death/censor when censoring is non-uniform; the registry total fixes the count.
      if (delta > 0) {
        let guard = 0;
        while (delta > 0 && guard++ < 1000) {
          const wsum = D.reduce((a, d, k) => a + (k > 0 && C[k] > 0 ? d : 0), 0);
          if (wsum <= 0) break;
          let moved = 0;
          for (let k = 1; k < nt && delta > 0; k++) {
            if (C[k] <= 0) continue;
            const want = Math.max(1, Math.round(delta * D[k] / wsum));
            const take = Math.min(want, C[k], delta);
            C[k] -= take; D[k] += take; delta -= take; moved += take;
          }
          if (moved === 0) break;
        }
        // any residual: spill to the latest available censor, then the administrative tail
        for (let k = nt - 1; k >= 1 && delta > 0; k--) { const take = Math.min(C[k], delta); C[k] -= take; D[k] += take; delta -= take; }
        while (delta > 0 && tailC > 0) { tailC--; D[nt - 1]++; delta--; }
      } else if (delta < 0) {
        let need = -delta;
        const dsum = D.reduce((a, d, k) => a + (k > 0 ? d : 0), 0);
        for (let k = nt - 1; k >= 1 && need > 0; k--) {
          const want = dsum > 0 ? Math.min(D[k], Math.round((-delta) * D[k] / dsum)) : D[k];
          const take = Math.min(want, D[k], need);
          D[k] -= take; C[k] += take; need -= take;
        }
        for (let k = nt - 1; k >= 1 && need > 0; k--) { const take = Math.min(D[k], need); D[k] -= take; C[k] += take; need -= take; }
        delta = -need;
      }
      if (delta !== 0) flags.push('event_reconciliation_residual:' + delta);
    }
    const ipd = [];
    for (let k = 0; k < nt; k++) {
      for (let j = 0; j < D[k]; j++) ipd.push({ time: tS[k], status: 1 });
      for (let j = 0; j < C[k]; j++) ipd.push({ time: tS[k], status: 0 });
    }
    for (let j = 0; j < tailC; j++) ipd.push({ time: tailT, status: 0 });
    return ipd; // exactly N rows by construction
  }

  function reconstructArmGuyot(arm, flags) {
    let pts = arm.km_points.slice().filter(p => isFinite(p.t) && isFinite(p.S)).sort((a, b) => a.t - b.t);
    // ensure origin
    if (pts.length === 0 || pts[0].t > 1e-9 || pts[0].S < 1 - 1e-9) {
      if (!(Math.abs(pts[0] && pts[0].t) < 1e-9)) pts = [{ t: 0, S: 1 }].concat(pts);
    }
    const tS = pts.map(p => p.t);
    let Svec = pts.map(p => Math.min(1, Math.max(0, p.S)));
    const pav = pavaDecreasing(Svec);
    if (pav.adjusted > 0) flags.push(`monotonicity_adjusted:${pav.adjusted}(max${pav.maxAdj.toFixed(3)})`);
    Svec = pav.y;

    const nar = arm.nar_points.slice().filter(p => isFinite(p.t) && isFinite(p.n)).sort((a, b) => a.t - b.t);
    const tRisk = nar.map(p => p.t);
    const nRisk = nar.map(p => Math.round(p.n));
    // ensure a risk anchor at the first clicked time
    if (tRisk.length === 0 || tRisk[0] > tS[0] + 1e-9) { tRisk.unshift(tS[0]); nRisk.unshift(arm.N || nRisk[0] || 1); }

    const core = guyotCore(tS, Svec, tRisk, nRisk, arm.total_events);
    const N = arm.N != null ? arm.N : nRisk[0];
    const ipd = normalizeAndExpand(tS, core.d, core.cen, N, arm.total_events, arm.follow_up_max, flags);
    return { ipd, tS, Svec, tRisk, nRisk };
  }

  // Censoring-informed / anchor-EXACT reconstruction (RESOLVE-IPD CEN-KM style, 2025).
  // Deaths are taken DIRECTLY from the registry curve with at-risk held constant within each
  // interval; censoring is placed only at NAR-anchor boundaries. The reconstructed KM therefore
  // passes through every registry anchor exactly (≈0 Wasserstein) — correct when censoring is
  // administrative (concentrated at the cutoff), which Guyot's constant-censoring assumption
  // mishandles. The two methods are complementary; reconstruct() picks the better fit per trial.
  function reconstructArmAnchorExact(arm, flags) {
    let pts = arm.km_points.slice().filter(p => isFinite(p.t) && isFinite(p.S)).sort((a, b) => a.t - b.t);
    if (pts.length === 0 || pts[0].t > 1e-9 || pts[0].S < 1 - 1e-9) {
      if (!(pts[0] && Math.abs(pts[0].t) < 1e-9)) pts = [{ t: 0, S: 1 }].concat(pts);
    }
    const tS = pts.map(p => p.t);
    let Svec = pavaDecreasing(pts.map(p => Math.min(1, Math.max(0, p.S)))).y;
    const nt = tS.length;
    const nar = arm.nar_points.slice().filter(p => isFinite(p.t) && isFinite(p.n)).sort((a, b) => a.t - b.t);
    const N = arm.N != null ? arm.N : (nar[0] ? Math.round(nar[0].n) : 1);
    // map each NAR time to the nearest curve-anchor index at or after it
    const narTarget = {};
    for (const p of nar) {
      let k = 0; while (k < nt && tS[k] < p.t - 1e-9) k++;
      narTarget[Math.min(k, nt - 1)] = Math.round(p.n);
    }
    const D = new Array(nt).fill(0), C = new Array(nt).fill(0);
    let n = N;
    for (let k = 1; k < nt; k++) {
      const ratio = Svec[k - 1] > 0 ? Svec[k] / Svec[k - 1] : 1;   // conditional survival from the curve
      let d = Math.round(n * (1 - ratio));
      if (d < 0) d = 0; if (d > n) d = n;
      D[k] = d; let after = n - d;
      if (narTarget[k] != null) { const c = Math.max(0, after - narTarget[k]); C[k] = c; after -= c; }
      n = after;
    }
    const ipd = normalizeAndExpand(tS, D, C, N, arm.total_events, arm.follow_up_max, flags);
    return { ipd, tS, Svec };
  }

  // Titman (2026) quadratic-programming reconstruction, adapted to the structured-registry regime.
  // On the cumulative-hazard scale the posted curve fixes the per-interval hazards h_k, so events are
  // d_k = h_k·n_k and the at-risk recursion n_{k+1} = n_k(1-h_k) - c_k is LINEAR in the unknown
  // censoring counts c_k; the registry total-event count E is a LINEAR constraint E = Σ h_k n_k. The
  // remaining censoring degree of freedom is resolved by the convex QP  min ½‖c‖²  s.t. E(c)=E, c≥0,
  // whose minimum-norm non-negative solution is closed-form: c_k = max(0, λ A_k), A_k = ∂E/∂c_k,
  // λ = (E - E0)/Σ A_k², E0 = N(1 - S_K). With NAR/marked censoring this is exact; here it best-fits
  // the curve under the event-count constraint. Beats anchor-exact under heavy administrative censoring
  // (validate/titman_qp.js). Degrades to curve-only when no total_events is posted.
  function reconstructArmQP(arm, flags) {
    let pts = arm.km_points.slice().filter(p => isFinite(p.t) && isFinite(p.S)).sort((a, b) => a.t - b.t);
    if (!(pts[0] && Math.abs(pts[0].t) < 1e-9)) pts = [{ t: 0, S: 1 }].concat(pts);
    const tS = pts.map(p => p.t);
    const Svec = pavaDecreasing(pts.map(p => Math.min(1, Math.max(0, p.S)))).y;
    const nt = tS.length;
    const N = arm.N != null ? arm.N : 1;
    const h = [0];                                   // h[k] = discrete hazard over interval ending at tS[k]
    for (let k = 1; k < nt; k++) h[k] = Math.min(0.999, Math.max(0, Svec[k - 1] > 0 ? 1 - Svec[k] / Svec[k - 1] : 0));
    // curve-only at-risk n0 and event ceiling E0 = N(1 - S_K)
    const n0 = new Array(nt + 1); n0[1] = N;
    for (let k = 1; k < nt; k++) n0[k + 1] = n0[k] * (1 - h[k]);
    let E0 = 0; for (let k = 1; k < nt; k++) E0 += h[k] * n0[k];
    // sensitivities A_k = ∂E/∂c_k = -Σ_{m>k} h_m Π_{l=k+1}^{m-1}(1-h_l)  (≤ 0, constant)
    const A = new Array(nt).fill(0);
    for (let k = 1; k < nt; k++) {
      let a = 0;
      for (let m = k + 1; m < nt; m++) { let prod = 1; for (let l = k + 1; l <= m - 1; l++) prod *= (1 - h[l]); a += h[m] * prod; }
      A[k] = -a;
    }
    let sumA2 = 0; for (let k = 1; k < nt; k++) sumA2 += A[k] * A[k]; if (sumA2 <= 0) sumA2 = 1;
    const E = arm.total_events;
    const Etarget = (E != null && E > 0) ? Math.min(E, E0) : E0;
    const lambda = (Etarget - E0) / sumA2;            // ≤ 0
    const c = new Array(nt).fill(0);
    for (let k = 1; k < nt; k++) c[k] = Math.max(0, lambda * A[k]);
    // Realise pseudo-IPD directly: d_k events SPREAD across interval (tS[k-1], tS[k]] and c_k censored
    // at the interval end tS[k]. Spreading (not piling at the anchor) is what makes the at-risk sets —
    // and hence the Cox HR — correct; placing every event at the anchor time biases the HR.
    const ipd = [];
    let n = N;
    for (let k = 1; k < nt; k++) {
      const dk = Math.min(Math.round(h[k] * n), n);
      const t0 = tS[k - 1], t1 = tS[k];
      for (let i = 0; i < dk; i++) ipd.push({ time: t0 + (t1 - t0) * (i + 0.5) / Math.max(1, dk), status: 1 });
      const ck = Math.min(Math.round(c[k]), n - dk);
      for (let i = 0; i < ck; i++) ipd.push({ time: t1, status: 0 });
      n -= dk + ck;
    }
    const tailT = arm.follow_up_max != null ? arm.follow_up_max : tS[nt - 1];
    for (let i = 0; i < Math.max(0, Math.round(n)); i++) ipd.push({ time: tailT, status: 0 });
    return { ipd, tS, Svec };
  }

  // right-continuous survival step from sparse registry anchors
  function anchorStepFn(km_points) {
    const p = km_points.slice().sort((a, b) => a.t - b.t);
    return function (t) { let S = 1; for (const q of p) { if (q.t <= t + 1e-9) S = q.S; else break; } return S; };
  }
  // 1-Wasserstein (L1 area) between a reconstruction's KM and the registry anchor step
  function armAnchorWasserstein(arm, ipd) {
    if (!arm.km_points || !arm.km_points.length) return 0;
    const km = kmFromIPD(ipd), aStep = anchorStepFn(arm.km_points);
    const tau = Math.max.apply(null, arm.km_points.map(p => p.t)) || 1;
    const grid = 240, dt = tau / grid; let acc = 0;
    for (let i = 0; i < grid; i++) { const t = (i + 0.5) * dt; acc += Math.abs(evalKM(km, t) - aStep(t)) * dt; }
    return acc;
  }

  function armReconByMethod(arm, method, flags) {
    return method === 'anchor-exact' ? reconstructArmAnchorExact(arm, flags) : reconstructArmGuyot(arm, flags);
  }

  // HR-CALIBRATION: make the reconstructed pseudo-IPD reproduce the registry-reported HR by
  // 1-D-solving the experimental arm's censoring level (total_events). More events in the
  // experimental arm => it looks worse => higher HR, so beta is monotincreasing in total_events;
  // bisection converges. Anchors are preserved (total_events only re-splits death/censor), so the
  // result stays consistent with BOTH the reported curve and the published effect — the right
  // object for downstream IPD meta-analysis. Not a validation of recovery (it imposes the HR).
  function calibrateHR(trial, result, flags) {
    const hr = trial.hr; if (!hr || hr.value == null) return;
    if (result.expIdx == null || result.ctlIdx == null) return;
    const expSpec = trial.arms[result.expIdx];
    const ctlIpd = result.arms[result.ctlIdx].ipd;
    const N = expSpec.N; if (!N) return;
    const target = Math.log(hr.value);
    const betaFor = (te) => {
      const a2 = Object.assign({}, expSpec, { total_events: te });
      const ipd = armReconByMethod(a2, result.method, []).ipd;
      return coxLogHR(ipd.map(r => ({ time: r.time, status: r.status, x: 1 }))
        .concat(ctlIpd.map(r => ({ time: r.time, status: r.status, x: 0 })))).beta;
    };
    let lo = Math.max(1, Math.round(0.03 * N)), hi = N;
    const blo = betaFor(lo), bhi = betaFor(hi);
    let teStar;
    if (target <= blo) teStar = lo; else if (target >= bhi) teStar = hi;
    else {
      for (let it = 0; it < 30 && hi - lo > 1; it++) {
        const mid = Math.round((lo + hi) / 2);
        if (betaFor(mid) < target) lo = mid; else hi = mid;
      }
      teStar = hi;
    }
    const a2 = Object.assign({}, expSpec, { total_events: teStar });
    result.arms[result.expIdx].ipd = armReconByMethod(a2, result.method, flags).ipd;
    const achieved = Math.exp(betaFor(teStar));
    result.calibrated = { target_hr: hr.value, achieved_hr: +achieved.toFixed(4), exp_total_events: teStar };
    flags.push('hr_calibrated:te=' + teStar + ',hr=' + achieved.toFixed(3));
  }

  // ====================================================== 5. Tier B — parametric

  // Calibrate a per-arm survival model and emit pseudo-IPD. Exponential by default;
  // Weibull when shape is identifiable from (median, events, follow-up).
  function parametricArm(params, rng) {
    const { N, median, lambda, cutoff, shape, targetEvents } = params;
    const k = shape || 1;
    const b = median / Math.pow(Math.log(2), 1 / k);  // scale from median
    const lam = (k === 1) ? (lambda != null ? lambda : Math.log(2) / median) : null;
    const T = [];
    for (let i = 0; i < N; i++) {
      const u = Math.max(1e-12, rng());
      T.push(k === 1 ? -Math.log(u) / lam : b * Math.pow(-Math.log(u), 1 / k));
    }
    // Condition on the registry-reported event count: set the admin cutoff to the
    // order statistic between the E-th and (E+1)-th smallest latent time => EXACTLY
    // E observed events. Falls back to a fixed cutoff when targetEvents is absent.
    let C = cutoff;
    if (targetEvents != null && targetEvents >= 0 && targetEvents <= N) {
      if (targetEvents === 0) C = -1;                 // all censored
      else if (targetEvents === N) C = Infinity;
      else { const s = T.slice().sort((a, b) => a - b); C = (s[targetEvents - 1] + s[targetEvents]) / 2; }
    }
    const ipd = [];
    for (let i = 0; i < N; i++) {
      const ev = T[i] <= C;
      ipd.push({ time: ev ? T[i] : Math.min(T[i], isFinite(C) ? Math.max(C, 0) : T[i]), status: ev ? 1 : 0 });
    }
    return ipd;
  }

  // Solve admin cutoff C so expected events match total_events for exponential.
  function solveCutoffExp(lambda, N, totEvents) {
    if (totEvents == null || N == null) return null;
    const frac = totEvents / N;
    if (frac <= 0 || frac >= 1) return null;
    return -Math.log(1 - frac) / lambda;
  }

  function logCItoSD(point, lo, hi, oneSided) {
    if (lo != null && hi != null && lo > 0 && hi > 0) return (Math.log(hi) - Math.log(lo)) / (2 * 1.959964);
    const bound = (hi != null && hi > 0) ? hi : (lo != null && lo > 0 ? lo : null);
    if (bound != null && point > 0) return Math.abs(Math.log(bound) - Math.log(point)) / 1.644854; // one-sided
    return 0;
  }

  function reconstructTierB(trial, flags, opts) {
    opts = opts || {};
    const B = opts.bootstrap == null ? 1000 : opts.bootstrap;
    const seed = hashStr(trial.nct_id) ^ 0x9e3779b9;
    const arms = trial.arms;
    const ctlIdx = arms.findIndex(a => a.role === 'comparator');
    const expIdx = arms.findIndex(a => a.role === 'experimental');
    const ci = ctlIdx >= 0 ? ctlIdx : 0;
    const ei = expIdx >= 0 ? expIdx : 1;
    const hr = trial.hr || {};

    function buildOnce(rng, medianMul, hrMul) {
      const out = [];
      const cMed = arms[ci].median.value * (medianMul[ci] || 1);
      const cLam = Math.log(2) / cMed;
      const cCut = arms[ci].follow_up_max || (cMed * 3);
      out[ci] = { ipd: parametricArm({ N: arms[ci].N, median: cMed, lambda: cLam, cutoff: cCut, targetEvents: arms[ci].total_events }, rng), lambda: cLam };
      // experimental: PH anchor on HR if available, else its own median
      let eLam, primary;
      if (hr.value) { eLam = cLam * hr.value * (hrMul || 1); primary = 'hr'; }
      else { const eMed = arms[ei].median.value * (medianMul[ei] || 1); eLam = Math.log(2) / eMed; primary = 'median'; }
      const eMedEff = Math.log(2) / eLam;
      const eCut = arms[ei].follow_up_max || (eMedEff * 3);
      out[ei] = { ipd: parametricArm({ N: arms[ei].N, median: eMedEff, lambda: eLam, cutoff: eCut, targetEvents: arms[ei].total_events }, rng), lambda: eLam, primary };
      return out;
    }

    // central (unperturbed) draw
    const rng0 = mulberry32(seed);
    const central = buildOnce(rng0, {}, 1);
    if (central[ei].primary === 'hr' && arms[ei].median && arms[ei].median.value) {
      const medRatio = arms[ci].median.value / arms[ei].median.value;
      if (Math.abs(Math.log(medRatio) - Math.log(hr.value)) > Math.log(1.15))
        flags.push('hr_median_inconsistent');
    }
    flags.push('assumption:parametric_exponential');

    // bootstrap envelope
    const medSDc = arms[ci].median ? logCItoSD(arms[ci].median.value, arms[ci].median.ci_low, arms[ci].median.ci_high) : 0;
    const hrSD = logCItoSD(hr.value, hr.ci_low, hr.ci_high, hr.one_sided);
    const meds = [], lhrs = [], rmsts = [];
    let bseed = seed;
    for (let b = 0; b < B; b++) {
      bseed = (bseed + 0x6D2B79F5) >>> 0;
      const rng = mulberry32(bseed);
      const mm = {}; mm[ci] = Math.exp(gauss(rng) * medSDc);
      const hm = Math.exp(gauss(rng) * hrSD);
      const draw = buildOnce(rng, mm, hm);
      const kmE = kmFromIPD(draw[ei].ipd), kmC = kmFromIPD(draw[ci].ipd);
      const me = medianFromKM(kmE); if (me != null) meds.push(me);
      const cox = coxLogHR(draw[ei].ipd.map(r => ({ ...r, x: 1 })).concat(draw[ci].ipd.map(r => ({ ...r, x: 0 }))));
      lhrs.push(cox.beta);
      const tau = Math.min(maxTime(draw[ei].ipd), maxTime(draw[ci].ipd));
      rmsts.push(rmst(kmE, tau) - rmst(kmC, tau));
    }
    meds.sort((a, b) => a - b); lhrs.sort((a, b) => a - b); rmsts.sort((a, b) => a - b);
    const envelope = {
      median_exp: [quantileSorted(meds, 0.025), quantileSorted(meds, 0.975)],
      logHR: [quantileSorted(lhrs, 0.025), quantileSorted(lhrs, 0.975)],
      rmst_diff: [quantileSorted(rmsts, 0.025), quantileSorted(rmsts, 0.975)],
      bootstrap: B
    };
    const armsOut = arms.map((a, i) => ({ arm_id: a.arm_id, label: a.label, role: a.role, ipd: central[i].ipd }));
    return { arms: armsOut, envelope, expIdx: ei, ctlIdx: ci };
  }

  function gauss(rng) { // Box-Muller
    let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function maxTime(ipd) { return ipd.reduce((m, r) => Math.max(m, r.time), 0); }

  // ============================================ 5b. Royston–Parmar flexible parametric (spline)

  // We have EXACT registry (t,S) anchors, so the RP model log H(t) = s(log t; gamma) is fit by
  // ordinary least squares on (x=log t, y=log(-log S)) — no IPD/MLE needed. Restricted cubic
  // spline basis (Royston & Parmar 2002). Yields a smooth, monotone, extrapolatable S(t):
  // S(t) = exp(-exp(eta(log t))).
  function rcsBasis(x, knots) {
    const m = knots.length, kmin = knots[0], kmax = knots[m - 1];
    const cube = (z) => (z > 0 ? z * z * z : 0);
    const out = [x];
    for (let j = 1; j < m - 1; j++) {
      const kj = knots[j], lam = (kmax - kj) / (kmax - kmin);
      out.push(cube(x - kj) - lam * cube(x - kmin) - (1 - lam) * cube(x - kmax));
    }
    return out; // length m-1
  }
  function gaussSolve(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat(b[i]));
    for (let col = 0; col < n; col++) {
      let piv = col; for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
      const d = M[col][col] || 1e-12;
      for (let r = 0; r < n; r++) { if (r === col) continue; const f = M[r][col] / d; for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]; }
    }
    return M.map((r, i) => r[n] / (r[i] || 1e-12));
  }
  function olsSolve(X, y) {
    const p = X[0].length, A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
    for (let i = 0; i < X.length; i++) for (let j = 0; j < p; j++) { b[j] += X[i][j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += X[i][j] * X[i][k]; }
    for (let j = 0; j < p; j++) A[j][j] += 1e-8; // ridge for stability
    return gaussSolve(A, b);
  }
  function fitRoystonParmar(km_points) {
    const pts = km_points.filter(p => p.t > 0 && p.S > 1e-6 && p.S < 1 - 1e-9).sort((a, b) => a.t - b.t);
    if (pts.length < 3) return null;
    const xs = pts.map(p => Math.log(p.t));
    const ys = pts.map(p => Math.log(-Math.log(p.S)));         // complementary log-log
    const n = pts.length, ndf = n >= 8 ? 3 : n >= 5 ? 2 : 1;   // spline df scales with anchor count
    const knots = [xs[0]];
    for (let j = 1; j < ndf; j++) knots.push(quantileSorted(xs, j / ndf));
    knots.push(xs[xs.length - 1]);
    const X = xs.map(x => [1].concat(rcsBasis(x, knots)));
    const gamma = olsSolve(X, ys);
    const predict = (t) => {
      if (t <= 0) return 1;
      const eta = [1].concat(rcsBasis(Math.log(t), knots)).reduce((s, bb, i) => s + bb * gamma[i], 0);
      return Math.min(1, Math.max(0, Math.exp(-Math.exp(eta))));
    };
    return { predict, gamma, knots, df: ndf };
  }
  // Replace coarse anchors with a dense, monotone RP-smoothed set (optionally extrapolated to tau).
  function densifyWithRP(trial, flags, extrapolateTo) {
    const t2 = JSON.parse(JSON.stringify(trial));
    let applied = false;
    for (const a of t2.arms) {
      if (!a.km_points || a.km_points.length < 3) continue;
      const rp = fitRoystonParmar(a.km_points);
      if (!rp) continue;
      const ts = a.km_points.map(p => p.t).filter(x => x > 0);
      const tmin = Math.min.apply(null, ts), tmax = extrapolateTo || Math.max.apply(null, ts);
      const G = 24, dense = [{ t: 0, S: 1 }];
      let prev = 1;
      for (let i = 1; i <= G; i++) {
        const t = tmin + (tmax - tmin) * i / G;
        let S = Math.min(prev, rp.predict(t));   // enforce monotone non-increasing
        prev = S; dense.push({ t: +t.toFixed(4), S: +S.toFixed(6) });
      }
      a.km_points = dense; applied = true;
    }
    if (applied && flags) flags.push('smoothed:rp');
    return t2;
  }

  // ====================================================== 6. tiering + self-audit

  function classifyTier(trial) {
    const arms = trial.arms || [];
    if (!arms.length) return 'C';
    let tier = 'A';
    for (const a of arms) {
      const kmN = (a.km_points || []).length;
      // Tier A = KM curve at >=3 timepoints + a population N. NAR is OPTIONAL (AACT has ~0
      // structured number-at-risk); without it, reconstruction uses N + total events and censors
      // to the tail (IPDfromKM "no number-at-risk" mode). total_events optional but improves fidelity.
      const hasA = kmN >= 3 && a.N != null;
      const hasB = a.median && a.median.value != null && a.N != null &&
        (a.total_events != null || a.follow_up_max != null);
      let t = hasA ? 'A' : (hasB ? 'B' : 'C');
      // trial HR required for Tier B coupling
      if (t === 'B' && !(trial.hr && trial.hr.value != null)) t = 'C';
      tier = minTier(tier, t);
    }
    return tier;
  }
  function minTier(a, b) { const r = { A: 3, B: 2, C: 1 }; return r[a] <= r[b] ? a : b; }

  // Self-audit: compare reconstructed pseudo-IPD back to registry anchors.
  function selfAudit(trial, result) {
    const checks = {};
    const arms = trial.arms;
    const recByRole = {};
    result.arms.forEach(a => { recByRole[a.role] = a; });

    // C1 total-event match
    let c1ok = true, c1detail = [];
    for (const a of arms) {
      const rec = result.arms.find(x => x.arm_id === a.arm_id);
      if (!rec || a.total_events == null) continue;
      const re = rec.ipd.filter(r => r.status === 1).length;
      const tol = result.tier === 'A' ? 0 : Math.max(1, Math.round(0.01 * a.total_events));
      const ok = Math.abs(re - a.total_events) <= tol;
      c1ok = c1ok && ok; c1detail.push({ arm: a.arm_id, recon: re, reg: a.total_events });
    }
    checks.C1_total_events = { pass: c1ok, detail: c1detail };

    // C2 anchor survival fidelity (Tier A only)
    let c2ok = true, c2max = 0;
    if (result.tier === 'A') {
      for (const a of arms) {
        const rec = result.arms.find(x => x.arm_id === a.arm_id);
        if (!rec) continue;
        const km = kmFromIPD(rec.ipd);
        for (const p of (a.km_points || [])) {
          const diff = Math.abs(evalKM(km, p.t) - p.S);
          if (diff > c2max) c2max = diff;
        }
      }
      c2ok = c2max <= 1e-3 + 1e-9;
    }
    checks.C2_anchor_fidelity = { pass: c2ok, maxDiff: c2max, applies: result.tier === 'A' };

    // C3 median within 5%
    let c3ok = true, c3detail = [];
    for (const a of arms) {
      const rec = result.arms.find(x => x.arm_id === a.arm_id);
      if (!rec || !a.median || a.median.value == null) continue;
      const rm = medianFromKM(kmFromIPD(rec.ipd));
      if (rm == null) { c3ok = false; c3detail.push({ arm: a.arm_id, recon: null, reg: a.median.value }); continue; }
      const ok = Math.abs(rm - a.median.value) / a.median.value <= 0.05;
      c3ok = c3ok && ok; c3detail.push({ arm: a.arm_id, recon: rm, reg: a.median.value });
    }
    checks.C3_median = { pass: c3ok, detail: c3detail };

    // C4 reconstructed HR vs registry HR (within 10% on HR scale AND inside CI)
    let c4 = { pass: true, applies: false };
    if (trial.hr && trial.hr.value != null && result.expIdx != null) {
      const ei = result.arms[result.expIdx], ci = result.arms[result.ctlIdx];
      if (ei && ci) {
        const rows = ei.ipd.map(r => ({ time: r.time, status: r.status, x: 1 }))
          .concat(ci.ipd.map(r => ({ time: r.time, status: r.status, x: 0 })));
        const cox = coxLogHR(rows);
        const within = Math.abs(Math.log(cox.hr) - Math.log(trial.hr.value)) <= Math.log(1.10);
        const inCI = (trial.hr.ci_low == null || trial.hr.ci_high == null) ? true :
          (cox.hr >= trial.hr.ci_low - 1e-9 && cox.hr <= trial.hr.ci_high + 1e-9);
        c4 = { pass: within && inCI, applies: true, recon_hr: cox.hr, reg_hr: trial.hr.value, within, inCI, separated: cox.separated };
      }
    }
    checks.C4_hr = c4;

    // C5 monotonicity (hard)
    let c5ok = true;
    for (const rec of result.arms) {
      const km = kmFromIPD(rec.ipd); let prev = 1;
      for (const s of km) { if (s.S > prev + 1e-9) { c5ok = false; break; } prev = s.S; }
    }
    checks.C5_monotonic = { pass: c5ok, hard: true };

    // C6 NAR consistency within +/-1 (Tier A)
    let c6ok = true;
    const anyNar = arms.some(a => (a.nar_points || []).length > 0);
    if (result.tier === 'A' && anyNar) {
      for (const a of arms) {
        const rec = result.arms.find(x => x.arm_id === a.arm_id);
        if (!rec) continue;
        const km = kmFromIPD(rec.ipd);
        for (const np of (a.nar_points || [])) {
          // n at risk just before time np.t
          let nr = rec.ipd.length, consumed = 0;
          for (const s of km) { if (s.t < np.t - 1e-9) consumed += s.d + s.c; else break; }
          nr = rec.ipd.length - consumed;
          if (Math.abs(nr - np.n) > 1) { c6ok = false; }
        }
      }
    }
    checks.C6_nar = { pass: c6ok, applies: result.tier === 'A' && anyNar };

    // C7 population conservation (hard)
    let c7ok = true;
    for (const a of arms) {
      const rec = result.arms.find(x => x.arm_id === a.arm_id);
      if (!rec || a.N == null) continue;
      if (rec.ipd.length !== a.N) c7ok = false;
    }
    checks.C7_conservation = { pass: c7ok, hard: true };

    // C8 no event after follow-up cutoff
    let c8ok = true;
    for (const a of arms) {
      const rec = result.arms.find(x => x.arm_id === a.arm_id);
      if (!rec || a.follow_up_max == null) continue;
      if (rec.ipd.some(r => r.status === 1 && r.time > a.follow_up_max + 1e-6)) c8ok = false;
    }
    checks.C8_followup = { pass: c8ok };

    // C9 HR direction integrity (hard): the reconstructed HR direction must not CONTRADICT the
    // registry's favored arm. Only fails on a clear contradiction (both registry and reconstructed
    // HR confidently off 1.0) so near-null/ambiguous effects don't trip it. The HR is never inverted.
    let c9ok = true, c9detail = null;
    if (trial.hr && trial.hr.favors_arm_id != null) {
      const fav = arms.find(a => a.arm_id === trial.hr.favors_arm_id);
      if (!fav) { c9ok = false; c9detail = 'favors_arm_id does not resolve to an arm'; }
      else if (checks.C4_hr.applies && checks.C4_hr.recon_hr != null && result.expIdx != null) {
        const regDir = Math.log(trial.hr.value);              // <0 ⇒ favours experimental
        const recDir = Math.log(checks.C4_hr.recon_hr);       // exp-vs-ctl
        const favExp = trial.hr.favors_arm_id === arms[result.expIdx].arm_id;
        const confident = Math.abs(regDir) > Math.log(1.10) && Math.abs(recDir) > Math.log(1.10);
        if (confident && (recDir < 0) !== favExp) { c9ok = false; c9detail = 'reconstructed HR direction contradicts the registry favored arm'; }
      }
    }
    checks.C9_direction = { pass: c9ok, hard: true, detail: c9detail };

    const hardFail = !checks.C5_monotonic.pass || !checks.C7_conservation.pass || !checks.C9_direction.pass;
    let badge = 'none';
    if (!hardFail && result.tier !== 'C') {
      const soft = [checks.C1_total_events.pass, checks.C2_anchor_fidelity.pass || !checks.C2_anchor_fidelity.applies,
      checks.C3_median.pass, (checks.C4_hr.pass || !checks.C4_hr.applies),
      checks.C6_nar.pass || !checks.C6_nar.applies];
      const allSoft = soft.every(Boolean);
      if (result.tier === 'A' && allSoft) badge = 'gold';
      else if (result.tier === 'A') badge = 'silver';
      else if (result.tier === 'B' && checks.C1_total_events.pass && checks.C3_median.pass && checks.C4_hr.pass) badge = 'silver';
      else if (result.tier === 'B' && checks.C3_median.pass) badge = 'bronze';
    }
    return { checks, badge, hardFail };
  }

  // ====================================================== 7. top-level reconstruct

  function reconstruct(trial, opts) {
    opts = opts || {};
    // opt-in: ignore registry total_events (pure curve-only) — used to compare against the
    // censoring-informed reconstruction for the agreement gate.
    if (opts.ignoreTotalEvents) {
      trial = JSON.parse(JSON.stringify(trial));
      (trial.arms || []).forEach(a => { a.total_events = null; });
    }
    const flags = [];
    // optional Royston–Parmar smoothing of coarse Tier-A curves before reconstruction
    if (opts.smooth === 'rp') trial = densifyWithRP(trial, flags, opts.extrapolateTo);
    const tier = classifyTier(trial);

    if (tier === 'C') {
      return {
        nct_id: trial.nct_id, tier: 'C', ipd: null, arms: null,
        verdict: 'insufficient_registry_data',
        available: trial.hr && trial.hr.value != null ? ['hr'] : [],
        flags, audit: { badge: 'none', checks: {} }, exportable: false
      };
    }

    // HR direction guard — resolve reference, NEVER invert (only swap labels)
    if (trial.hr && trial.hr.value != null && trial.hr.favors_arm_id == null) {
      flags.push('hr_reference_ambiguous');
    }

    let result;
    if (tier === 'A') {
      // Best-of ensemble: run Guyot (constant-censoring) and anchor-exact (censoring-informed),
      // select the method with the lower total 1-Wasserstein to the registry anchors per trial.
      // When the registry posts a total-event count, the Titman QP is the validated-best censoring-
      // informed reconstruction — use it directly. The anchor-Wasserstein best-of CANNOT select it,
      // because censoring is invisible to the anchors (it does not change the KM at the posted points),
      // so a method that fits anchors equally well but mis-places censoring would be chosen instead.
      // Without an event count, fall back to the curve-only best-of (Guyot vs anchor-exact).
      const hasEvents = trial.arms.length > 0 && trial.arms.every(a => a.total_events != null && a.total_events > 0);
      const METHODS = (opts.method === 'guyot') ? { guyot: reconstructArmGuyot }
        : (opts.method === 'anchor-exact') ? { 'anchor-exact': reconstructArmAnchorExact }
          : (opts.method === 'qp') ? { qp: reconstructArmQP }
            : (hasEvents) ? { qp: reconstructArmQP }
              : { guyot: reconstructArmGuyot, 'anchor-exact': reconstructArmAnchorExact };
      let best = null;
      for (const name in METHODS) {
        const f2 = [], arms = []; let w = 0;
        for (const a of trial.arms) {
          const r = METHODS[name](a, f2);
          arms.push({ arm_id: a.arm_id, label: a.label, role: a.role, ipd: r.ipd });
          w += armAnchorWasserstein(a, r.ipd);
        }
        if (!best || w < best.w) best = { name, arms, w, f2 };
      }
      flags.push('method:' + best.name);
      flags.push('wasserstein_to_anchors:' + best.w.toFixed(4));
      best.f2.forEach(x => flags.push(x));
      const ei = trial.arms.findIndex(a => a.role === 'experimental');
      const ci = trial.arms.findIndex(a => a.role === 'comparator');
      result = { tier, arms: best.arms, method: best.name, wasserstein: best.w,
        expIdx: ei >= 0 ? ei : null, ctlIdx: ci >= 0 ? ci : null, envelope: null };
    } else {
      const b = reconstructTierB(trial, flags, opts);
      result = { tier, arms: b.arms, expIdx: b.expIdx, ctlIdx: b.ctlIdx, envelope: b.envelope };
    }

    if (opts.calibrateHR && tier === 'A') calibrateHR(trial, result, flags);

    const audit = selfAudit(trial, result);
    return {
      nct_id: trial.nct_id, tier, arms: result.arms, envelope: result.envelope,
      method: result.method || null, wasserstein_to_anchors: result.wasserstein != null ? result.wasserstein : null,
      calibrated: result.calibrated || null,
      flags, audit, exportable: audit.badge !== 'none'
    };
  }

  // ============================================ 7b. Competing risks (Aalen–Johansen)
  //
  // When the endpoint is cause-specific (e.g. time-to-progression with death as a COMPETING event),
  // treating 1-KM as the cumulative incidence is biased: censoring a competing event assumes the
  // patient could still have the event of interest, which they cannot. The Aalen–Johansen estimator
  // gives the correct cause-specific CIF. ipd rows carry cause ∈ {0 censor, 1 event-of-interest,
  // 2 competing}. Invariant: CIF1(t)+CIF2(t)+S(t) = 1 at every step.
  function cifAalenJohansen(ipd) {
    const rows = ipd.slice().sort((a, b) => a.time - b.time);
    const times = [...new Set(rows.map(r => r.time))].sort((a, b) => a - b);
    let n = rows.length, S = 1, cif1 = 0, cif2 = 0;
    const out = [];
    for (const t of times) {
      const at = rows.filter(r => Math.abs(r.time - t) < 1e-12);
      const d1 = at.filter(r => r.cause === 1).length;
      const d2 = at.filter(r => r.cause === 2).length;
      const c = at.filter(r => !(r.cause > 0)).length;
      if (n > 0) { cif1 += S * (d1 / n); cif2 += S * (d2 / n); S *= (1 - (d1 + d2) / n); }
      out.push({ t, cif1, cif2, S });
      n -= (d1 + d2 + c);
    }
    return out;
  }
  // Naive cause-1 cumulative incidence = 1 - KM treating the competing event as censoring (biased high).
  function cifNaive1(ipd) {
    const km = kmFromIPD(ipd.map(r => ({ time: r.time, status: r.cause === 1 ? 1 : 0 })));
    return km.map(s => ({ t: s.t, cif1: 1 - s.S }));
  }
  // Reconstruct cause-labeled pseudo-IPD: event-of-interest from the curve, then relabel
  // `competing_events` of the censored rows as the competing cause (cause 2), spread over time.
  function reconstructCompetingRisks(trial, opts) {
    opts = opts || {};
    const base = reconstruct(trial, opts);
    if (!base.arms) return base;
    base.arms.forEach((arm, idx) => {
      const spec = trial.arms[idx];
      const comp = spec.competing_events != null ? spec.competing_events : (opts.competing && opts.competing[arm.arm_id]);
      const ipd = arm.ipd.map(r => ({ time: r.time, cause: r.status === 1 ? 1 : 0 }));
      if (comp && comp > 0) {
        const censIdx = ipd.map((r, i) => r.cause === 0 ? i : -1).filter(i => i >= 0).sort((a, b) => ipd[a].time - ipd[b].time);
        const k = Math.min(comp, censIdx.length);
        for (let j = 0; j < k; j++) ipd[censIdx[Math.floor(j * censIdx.length / k)]].cause = 2; // spread across time
      }
      arm.ipd_cr = ipd;
      arm.cif = cifAalenJohansen(ipd);
    });
    base.competing_risks = true;
    return base;
  }

  // ============================================ 7c. Multi-constraint joint reconstruction
  //
  // "Use all the registry data at once": reconstruct pseudo-IPD consistent with the curve AND the
  // total-event count (censoring-informed, carried on trial.arms[].total_events) AND the registry HR
  // (calibration) simultaneously, and report which constraints are jointly satisfied. (The
  // maximum-entropy stance over what the registry leaves open is the ensemble in §8.)
  function reconstructJoint(trial, opts) {
    opts = opts || {};
    const r = reconstruct(trial, Object.assign({ calibrateHR: !!(trial.hr && trial.hr.value != null) }, opts));
    const sat = {};
    if (r.arms) {
      let mx = 0;
      for (const a of trial.arms) {
        const rec = r.arms.find(x => x.arm_id === a.arm_id);
        if (!rec || !(a.km_points || []).length) continue;
        const km = kmFromIPD(rec.ipd);
        for (const p of a.km_points) mx = Math.max(mx, Math.abs(evalKM(km, p.t) - p.S));
      }
      sat.curve_anchor_sup_err = +mx.toFixed(4);
      sat.events = trial.arms.map(a => {
        const rec = r.arms.find(x => x.arm_id === a.arm_id);
        return { arm: a.arm_id, registry: a.total_events != null ? a.total_events : null,
          recon: rec ? rec.ipd.filter(x => x.status === 1).length : null };
      });
      if (r.calibrated) sat.hr = { target: r.calibrated.target_hr, achieved: r.calibrated.achieved_hr };
    }
    r.joint_constraints = sat;
    return r;
  }

  // ============================================ 7d. Fractional-polynomial time-varying HR (non-PH)
  //
  // A single Cox HR is misleading under non-proportional hazards. On the reconstructed two-arm
  // pseudo-IPD we estimate a PIECEWISE rate-ratio HR(t) (piecewise-exponential), then fit a
  // first-order fractional polynomial logHR(t)=β0+β1·t^p (Royston/Jansen style) and test PH
  // (β1≈0). Pool across trials with inverse-variance weights for a time-varying network/meta effect.
  function piecewiseHR(expIpd, ctlIpd, breaks) {
    if (!breaks) {
      const ev = expIpd.concat(ctlIpd).filter(r => r.status === 1).map(r => r.time).sort((a, b) => a - b);
      if (ev.length < 6) breaks = [ev[Math.floor(ev.length / 2)] || 1];
      else breaks = [ev[Math.floor(ev.length / 3)], ev[Math.floor(2 * ev.length / 3)]];
    }
    const bounds = [0].concat(breaks, [Infinity]);
    const out = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const lo = bounds[i], hi = bounds[i + 1];
      const tally = (ipd) => {
        let d = 0, pt = 0;
        for (const r of ipd) {
          if (r.time > lo) { pt += Math.min(r.time, hi) - lo; if (r.status === 1 && r.time <= hi) d++; }
        }
        return { d, pt };
      };
      const e = tally(expIpd), c = tally(ctlIpd);
      if (e.pt <= 0 || c.pt <= 0) continue;
      const rateE = (e.d + 0.5) / e.pt, rateC = (c.d + 0.5) / c.pt; // Anscombe-style continuity
      const logHR = Math.log(rateE / rateC);
      const se = Math.sqrt(1 / (e.d + 0.5) + 1 / (c.d + 0.5));
      out.push({ t_mid: isFinite(hi) ? (lo + hi) / 2 : lo, lo, hi: isFinite(hi) ? hi : null, logHR, hr: Math.exp(logHR), se, d_exp: e.d, d_ctl: c.d });
    }
    return out;
  }
  function fractionalPolyHR(pieces) {
    // weighted FP1 fit logHR = b0 + b1 * t^p over piece midpoints; choose best p; PH test on b1.
    const pts = pieces.filter(p => isFinite(p.logHR) && p.se > 0);
    if (pts.length < 2) return null;
    const powers = [-2, -1, -0.5, 0, 0.5, 1, 2];
    let best = null;
    for (const p of powers) {
      const fx = (t) => p === 0 ? Math.log(t || 1e-6) : Math.pow(t || 1e-6, p);
      let Sw = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
      for (const pt of pts) { const w = 1 / (pt.se * pt.se), x = fx(pt.t_mid), y = pt.logHR; Sw += w; Sx += w * x; Sy += w * y; Sxx += w * x * x; Sxy += w * x * y; }
      const det = Sw * Sxx - Sx * Sx; if (Math.abs(det) < 1e-12) continue;
      const b1 = (Sw * Sxy - Sx * Sy) / det, b0 = (Sy - b1 * Sx) / Sw;
      let rss = 0; for (const pt of pts) { const r = pt.logHR - (b0 + b1 * fx(pt.t_mid)); rss += r * r / (pt.se * pt.se); }
      const seB1 = Math.sqrt(Sw / det);
      if (!best || rss < best.rss) best = { power: p, b0, b1, rss, z_b1: b1 / seB1 };
    }
    if (best) best.nonproportional = Math.abs(best.z_b1) > 1.96; // β1 significantly ≠ 0 ⇒ NPH
    return best;
  }
  function poolTimeVaryingHR(perTrialPieces) {
    // inverse-variance pool of logHR within matched time windows across trials
    const byWin = {};
    perTrialPieces.forEach(pieces => pieces.forEach((p, i) => { (byWin[i] = byWin[i] || []).push(p); }));
    return Object.keys(byWin).map(i => {
      const ps = byWin[i];
      let Sw = 0, Swy = 0; ps.forEach(p => { const w = 1 / (p.se * p.se); Sw += w; Swy += w * p.logHR; });
      const lhr = Swy / Sw, se = Math.sqrt(1 / Sw);
      return { window: +i, k: ps.length, hr: +Math.exp(lhr).toFixed(3), ci: [+Math.exp(lhr - 1.96 * se).toFixed(3), +Math.exp(lhr + 1.96 * se).toFixed(3)] };
    });
  }

  // ============================================ 8. Multiple-imputation uncertainty (Tier A)
  //
  // Registry constraints do NOT uniquely determine the IPD: the censoring level/timing and the
  // reconstruction method are under-identified. We sample those free degrees of freedom (a
  // maximum-entropy / multiple-imputation stance — least-committal over what the registry doesn't
  // pin down) to produce an ensemble of plausible pseudo-IPD datasets, then report point estimates
  // with CREDIBLE INTERVALS (percentile of the imputation distribution). This turns single-number
  // outputs into honest uncertainty — the gap the validation exposed. Seeded => reproducible.
  function clamp01(x) { return Math.min(1, Math.max(0, x)); }
  function reconstructEnsemble(trial, opts) {
    opts = opts || {};
    const M = opts.M || 200;
    const tier = classifyTier(trial);
    if (tier !== 'A') {
      const r = reconstruct(trial, opts);
      return { tier, point: r, ensemble: null, note: 'ensemble uncertainty is implemented for Tier A' };
    }
    const seed0 = (hashStr(trial.nct_id || '') ^ 0x1234abcd) >>> 0;
    const med = {}, rmstA = {}, lhr = [];
    trial.arms.forEach(a => { med[a.arm_id] = []; rmstA[a.arm_id] = []; });
    const tau = Math.min.apply(null, trial.arms.filter(a => (a.km_points || []).length)
      .map(a => a.km_points[a.km_points.length - 1].t)) || 1;
    const ei = trial.arms.findIndex(a => a.role === 'experimental');
    const ci = trial.arms.findIndex(a => a.role === 'comparator');
    // The dominant under-identified DOF is the CENSORING LEVEL. Anchor it to the curve-only event
    // count E0 (≈ no intermediate censoring, the maximum plausible events) and the registry-reported
    // total_events when present; impute total_events across [floor, E0] so the ensemble spans the
    // genuine curve-only↔heavily-censored range (this is what calibrates the HR interval).
    const e0 = {};
    { const cr = reconstruct(trial, { ignoreTotalEvents: true });
      if (cr.arms) cr.arms.forEach(a => { e0[a.arm_id] = a.ipd.filter(x => x.status === 1).length; }); }
    for (let m = 0; m < M; m++) {
      const rng = mulberry32((seed0 + Math.imul(m + 1, 2654435761)) >>> 0);
      const t2 = JSON.parse(JSON.stringify(trial));
      for (const a of t2.arms) {
        // (i) registry rounding on the KM anchors (~±0.005); PAVA inside reconstruct re-monotonises
        a.km_points = a.km_points.map(p => ({ t: p.t, S: clamp01(p.S + (rng() - 0.5) * 0.01) }));
        // (ii) censoring-level uncertainty — the dominant HR driver. Sample events across the full
        // plausible band [0.55*E0, E0]; if the registry reports a count, widen a band around it too.
        const E0 = e0[a.arm_id];
        if (E0 != null && E0 > 0) {
          const reg = a.total_events;
          const lo = Math.round(0.55 * E0), hiB = E0;
          let e = Math.round(lo + rng() * (hiB - lo));
          if (reg != null) { // mixture: half the draws hug the registry count (±15%), half span the band
            e = rng() < 0.5 ? Math.max(0, Math.round(reg * (1 + (rng() - 0.5) * 0.30))) : e;
          }
          a.total_events = Math.min(a.N != null ? a.N : e, Math.max(1, e));
        }
      }
      // (iii) model uncertainty: Guyot vs anchor-exact
      const method = rng() < 0.5 ? 'guyot' : 'anchor-exact';
      let r; try { r = reconstruct(t2, { method }); } catch { continue; }
      if (!r.arms) continue;
      for (const a of r.arms) {
        const km = kmFromIPD(a.ipd);
        const mm = medianFromKM(km, { interpolate: true });
        if (mm != null) med[a.arm_id].push(mm);
        rmstA[a.arm_id].push(rmst(km, tau));
      }
      if (ei >= 0 && ci >= 0) {
        const e = r.arms[ei], c = r.arms[ci];
        lhr.push(coxLogHR(e.ipd.map(x => ({ time: x.time, status: x.status, x: 1 }))
          .concat(c.ipd.map(x => ({ time: x.time, status: x.status, x: 0 })))).beta);
      }
    }
    const q = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return quantileSorted(s, p); };
    const ciOf = (arr) => arr.length ? { est: +q(arr, 0.5).toFixed(4), lo: +q(arr, 0.025).toFixed(4), hi: +q(arr, 0.975).toFixed(4), n: arr.length } : null;
    const point = reconstruct(trial, opts);  // central estimate (no jitter)
    const medianCI = {}; const rmstCI = {};
    trial.arms.forEach(a => { medianCI[a.arm_id] = ciOf(med[a.arm_id]); rmstCI[a.arm_id] = ciOf(rmstA[a.arm_id]); });
    const hrCI = lhr.length ? { est: +Math.exp(q(lhr, 0.5)).toFixed(4), lo: +Math.exp(q(lhr, 0.025)).toFixed(4), hi: +Math.exp(q(lhr, 0.975)).toFixed(4), n: lhr.length } : null;
    return { tier, M, point, ensemble: { hr: hrCI, median: medianCI, rmst: rmstCI, tau: +tau.toFixed(2) } };
  }

  return {
    reconstruct, reconstructEnsemble, reconstructCompetingRisks, reconstructJoint,
    piecewiseHR, fractionalPolyHR, poolTimeVaryingHR, classifyTier,
    // expose internals for tests
    _: {
      pavaDecreasing, mulberry32, hashStr, quantileSorted,
      kmFromIPD, medianFromKM, rmst, evalKM, wasserstein1,
      coxLogHR, guyotCore, buildRiskIndices, normalizeAndExpand,
      reconstructArmGuyot, reconstructArmAnchorExact, reconstructArmQP, armAnchorWasserstein, anchorStepFn,
      reconstructTierB, selfAudit, parametricArm, solveCutoffExp,
      fitRoystonParmar, rcsBasis, densifyWithRP, cifAalenJohansen, cifNaive1
    }
  };
}));

/* ===================================================================
 * PseudoIPDEngine — OPTIONAL survival / pseudo-IPD panel (self-registering).
 * Bundled with the vendored registry-ipd engine (window.RIPD, above).
 * Activates ONLY when included trials carry registry KM anchors
 * (trial.data.kmAnchors). With no anchors it stays hidden and inert, so
 * existing dashboards are unaffected. It self-hooks into the analysis cycle
 * by wrapping TransportabilityEngine.render (which already runs on every
 * analysis) — no inline dashboard edits needed beyond the panel container.
 * Fail-closed; pseudo-IPD never true IPD; Tier C refused; HR never inverted.
 * =================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  function esc(s) { return (typeof window.escapeHtml === 'function' ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s)); }

  var PseudoIPDEngine = {
    _trialsWithAnchors: function () {
      var out = [];
      var RM = window.RapidMeta;
      if (!RM || !RM.state || !RM.state.trials) return out;
      RM.state.trials.forEach(function (t) {
        var inc = (typeof window.isIncludeLikeForAnalysis === 'function') ? window.isIncludeLikeForAnalysis(t, RM.realData) : true;
        if (!inc || !t.data) return;
        var a = t.data.kmAnchors || t.data.survival || null;
        if (a && Array.isArray(a.arms) && a.arms.length >= 1 && a.arms.some(function (x) { return Array.isArray(x.km_points) && x.km_points.length >= 3; })) {
          out.push({ trial: t, anchors: a });
        }
      });
      return out;
    },
    hasData: function () { return typeof window.RIPD !== 'undefined' && this._trialsWithAnchors().length > 0; },
    render: function () {
      var section = document.getElementById('pseudo-ipd-section');
      var container = document.getElementById('pseudo-ipd-container');
      if (!section || !container) return;
      if (typeof window.RIPD === 'undefined' || !this.hasData()) { section.classList.add('hidden'); return; }
      section.classList.remove('hidden');
      var RIPD = window.RIPD, H = RIPD._;
      var self = this;
      var rows = this._trialsWithAnchors().map(function (o) {
        var trial = o.trial, anchors = o.anchors;
        var tname = esc(trial.name || trial.nct || 'trial');
        var r;
        try { r = RIPD.reconstruct(anchors); } catch (e) {
          return '<tr class="border-b border-slate-800/60"><td class="p-3 font-semibold">' + tname + '</td><td class="p-3 text-rose-300" colspan="5">reconstruction error (fail-closed): ' + esc(e.message) + '</td></tr>';
        }
        var badge = (r.audit && r.audit.badge) || 'none';
        var bc = { gold: 'text-amber-300 border-amber-400/40 bg-amber-400/10', silver: 'text-slate-200 border-slate-400/40 bg-slate-400/10', bronze: 'text-orange-300 border-orange-400/40 bg-orange-400/10', none: 'text-rose-300 border-rose-400/40 bg-rose-400/10' }[badge] || 'text-rose-300';
        var armCells = (r.arms || []).map(function (a) {
          var km = H.kmFromIPD(a.ipd);
          var med = H.medianFromKM(km);
          var fu = a.ipd && a.ipd.length ? Math.max.apply(null, a.ipd.map(function (x) { return x.time; })) : 0;
          var rm = a.ipd && a.ipd.length ? H.rmst(km, fu) : null;
          var lbl = esc((a.label || a.arm_id || '').toString().slice(0, 26));
          return '<div class="text-[10px] leading-tight mb-1"><span class="opacity-70">' + lbl + ':</span> median ' + (med == null ? 'NR' : med.toFixed(1)) + ', RMST@' + fu.toFixed(0) + ' ' + (rm == null ? '--' : rm.toFixed(1)) + ' (n=' + (a.ipd ? a.ipd.length : 0) + ')</div>';
        }).join('');
        return '<tr class="border-b border-slate-800/60 align-top">' +
          '<td class="p-3 font-semibold">' + tname + '</td>' +
          '<td class="p-3 font-mono text-center">' + esc(r.tier) + '</td>' +
          '<td class="p-3 font-mono text-[10px]">' + esc(r.method || '--') + '</td>' +
          '<td class="p-3">' + armCells + '</td>' +
          '<td class="p-3 text-center"><span class="text-[9px] uppercase tracking-widest px-2 py-1 rounded-full border ' + bc + '">' + esc(badge) + '</span></td>' +
          '<td class="p-3 text-center font-mono text-[10px] ' + (r.exportable ? 'text-emerald-300' : 'text-rose-300') + '">' + (r.exportable ? 'exportable' : 'blocked') + '</td></tr>';
      }).join('');
      container.innerHTML =
        '<span class="text-[9px] uppercase tracking-widest px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">Pseudo-IPD &middot; reconstructed from registry KM anchors &middot; never true IPD</span>' +
        '<div class="overflow-x-auto mt-3"><table class="w-full text-left text-[11px]">' +
        '<thead class="bg-slate-950/60 text-[9px] uppercase font-bold tracking-widest opacity-60"><tr>' +
        '<th class="p-3">Trial</th><th class="p-3 text-center">Tier</th><th class="p-3">Method</th>' +
        '<th class="p-3">Reconstructed arms (median / RMST)</th><th class="p-3 text-center">Self-audit</th><th class="p-3 text-center">Export</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
        '<div class="text-[9px] opacity-55 leading-relaxed border-t border-slate-800 mt-4 pt-3">' +
        '<b>Method &amp; honest scope.</b> Pseudo-IPD reconstructed from ClinicalTrials.gov/AACT structured KM anchors ' +
        '(Titman-2026 QP / Guyot / anchor-exact, tier-selected) using the vendored offline registry-ipd engine. Output is ' +
        '<b>pseudo-IPD, never true IPD</b>; Tier C (HR-only) is refused; the HR is never inverted (only arm labels resolved); ' +
        'any hard-check failure blocks export (badge &ldquo;none&rdquo;). RMST/median are curve-derived (better-behaved under ' +
        'non-proportional hazards) but their external accuracy is not independently validated &mdash; use as a triangulation ' +
        'input. References: Guyot 2012; Titman 2026; RESOLVE-IPD 2025.</div>';
    }
  };
  window.PseudoIPDEngine = PseudoIPDEngine;

  // Self-hook: render after each analysis without editing the dashboard's inline
  // JS. TransportabilityEngine.render already runs every analysis; wrap it once.
  function installHook() {
    if (window.__pseudoIpdHooked) return true;
    var TE = window.TransportabilityEngine;
    if (TE && typeof TE.render === 'function') {
      var orig = TE.render.bind(TE);
      TE.render = function () {
        var r = orig.apply(this, arguments);
        try { PseudoIPDEngine.render(); } catch (e) {}
        return r;
      };
      window.__pseudoIpdHooked = true;
      try { PseudoIPDEngine.render(); } catch (e) {}
      return true;
    }
    return false;
  }
  if (!installHook()) {
    // TransportabilityEngine may not be defined yet (script order); retry briefly.
    var tries = 0;
    var iv = setInterval(function () { if (installHook() || ++tries > 50) clearInterval(iv); }, 100);
  }
})();
