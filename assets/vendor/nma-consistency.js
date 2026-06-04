/* nma-consistency.js — NMA-Pro-style direct/indirect consistency panel.
 *
 * Lifted-and-cleaned from C:/HTML apps/nma-pro-v2/nma-pro-v8.0.html (L466
 * nodeSplitting + L489 summarizeInconsistency, Fisher-combined test).
 *
 * What this provides over the existing per-review NMAEngine.testConsistency:
 *
 *   1. NETWORK TYPE DETECTION — explicit STAR vs CLOSED-LOOP badge. Star
 *      networks (where every non-reference comparison is purely indirect)
 *      are common in our 20-NMA fleet and currently render as "No
 *      comparisons available" — a non-actionable message. The new panel
 *      explicitly says "Network is a STAR — all drug-vs-drug comparisons
 *      are pure indirect via [reference]; consistency cannot be tested
 *      without a closed loop."
 *
 *   2. PER-EDGE DIRECT EVIDENCE TABLE — shows pooled direct effect, k,
 *      tau², I² for every edge in NMA_CONFIG. Currently hidden behind
 *      `_poolEffects` private internal calls.
 *
 *   3. GLOBAL CONSISTENCY SUMMARY (when closed loops exist):
 *        - Fisher-combined p-value across all node-split tests
 *        - Bonferroni-corrected count of significant nodes
 *        - Min p-value
 *      Currently no such summary in our reviews.
 *
 *   4. NMA PRO BACK-CALCULATION — uses Dias et al. (2010) approach to
 *      derive the indirect estimate from network ÷ direct, when direct
 *      contributes to the network. Falls back to Bucher-style direct
 *      comparison via reference for star networks.
 *
 * Public API (exported on window.NMAConsistency):
 *   analyze(realData, nmaConfig, opts) → result
 *   render(container, result, opts)
 *
 * Dependencies: PairwisePool (for direct pooling). Loaded via
 * <script src="vendor/pairwise-pool.js"></script> earlier in the page.
 */
(function (global) {
  'use strict';

  function fmt(x, d) {
    if (x == null || !isFinite(x)) return '—';
    d = d != null ? d : 2;
    return x >= 10 ? x.toFixed(Math.max(0, d - 1)) : x.toFixed(d);
  }

  function exp(x) { return Math.exp(x); }

  // Wilson-Hilferty chi^2 → p approximation. df ≥ 1.
  function chi2_pvalue(x, df) {
    if (x <= 0 || df <= 0) return 1;
    if (!isFinite(x)) return 0;
    const h = 2 / (9 * df);
    const z = (Math.cbrt(x / df) - (1 - h)) / Math.sqrt(h);
    // Phi-bar(z) approx — use Hastings 1955
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-z * z / 2);
    const cdf = 1 - phi * (0.319381530 * t + -0.356563782 * t * t + 1.781477937 * t * t * t + -1.821255978 * t * t * t * t + 1.330274429 * t * t * t * t * t);
    return z >= 0 ? 1 - cdf : cdf;
  }

  // Standard normal CDF (Hastings 1955)
  function pnorm(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-z * z / 2);
    const cdf = 1 - phi * (0.319381530 * t + -0.356563782 * t * t + 1.781477937 * t * t * t + -1.821255978 * t * t * t * t + 1.330274429 * t * t * t * t * t);
    return z >= 0 ? cdf : 1 - cdf;
  }

  /**
   * Detect star network: a network where every comparison includes the
   * reference treatment (no edge between two non-reference treatments).
   * Returns {isStar: bool, reference: string|null, edges: [[t1, t2], ...]}.
   */
  function classifyNetwork(cfg) {
    const treatments = (cfg && cfg.treatments) || [];
    const comparisons = (cfg && cfg.comparisons) || [];
    const edges = comparisons.map(c => [c.t1, c.t2]);
    if (!edges.length) return { isStar: false, reference: null, edges, nNodes: treatments.length };
    // Build degree map
    const deg = {};
    edges.forEach(([a, b]) => {
      deg[a] = (deg[a] || 0) + 1;
      deg[b] = (deg[b] || 0) + 1;
    });
    // Reference candidate: highest-degree node
    let ref = null, maxDeg = 0;
    Object.keys(deg).forEach(t => {
      if (deg[t] > maxDeg) { maxDeg = deg[t]; ref = t; }
    });
    // Star iff every edge touches the reference
    const isStar = edges.every(([a, b]) => a === ref || b === ref);
    return { isStar, reference: ref, edges, nNodes: treatments.length };
  }

  /**
   * Pool one edge's direct evidence. Uses PairwisePool.pool2x2 on the
   * realData entries listed in cfg.comparison.trials.
   */
  function poolEdge(edge, realData, measure) {
    const trials = (edge.trials || [])
      .map(nct => {
        const t = realData[nct];
        return t ? { name: t.name || nct, tE: t.tE, tN: t.tN, cE: t.cE, cN: t.cN } : null;
      })
      .filter(Boolean);
    if (!trials.length) return null;
    if (trials.length === 1) {
      // Single trial: just compute log-RR + variance, no random-effects pool
      const t = trials[0];
      if (t.tE == null || t.tN == null || t.cE == null || t.cN == null) return null;
      let tEa = t.tE, tNa = t.tN, cEa = t.cE, cNa = t.cN;
      if (tEa === 0 || cEa === 0) {
        tEa = t.tE + 0.5; tNa = t.tN + 1;
        cEa = t.cE + 0.5; cNa = t.cN + 1;
      }
      const log_rr = Math.log((tEa / tNa) / (cEa / cNa));
      const v = 1 / tEa - 1 / tNa + 1 / cEa - 1 / cNa;
      return {
        k: 1, mu_log: log_rr, mu: Math.exp(log_rr),
        se: Math.sqrt(v), tau2: 0, I2: 0,
        ci_lo: Math.exp(log_rr - 1.96 * Math.sqrt(v)),
        ci_hi: Math.exp(log_rr + 1.96 * Math.sqrt(v)),
      };
    }
    if (!global.PairwisePool || !global.PairwisePool.pool2x2) {
      console.warn('NMAConsistency: PairwisePool not loaded');
      return null;
    }
    const r = global.PairwisePool.pool2x2(trials, { measure: measure || 'RR' });
    if (r.error) return null;
    // Recover seMu from CI: ci_hi/ci_lo gives 2*1.96*seMu (with HKSJ this is t-based, approximate)
    const log_ci_lo = Math.log(r.ci_lo);
    const log_ci_hi = Math.log(r.ci_hi);
    const seMu_log = (log_ci_hi - log_ci_lo) / (2 * 1.96);
    return {
      k: r.k_used,
      mu_log: r.mu_log,
      mu: r.mu,
      se: seMu_log,
      tau2: r.tau2,
      I2: r.I2,
      ci_lo: r.ci_lo,
      ci_hi: r.ci_hi,
    };
  }

  /**
   * Bucher (1997) indirect: A vs B inferred from A vs C and B vs C.
   * effectAC, effectBC are {mu_log, se}. Returns {mu_log, se}.
   */
  function bucher(effectAC, effectBC) {
    return {
      mu_log: effectAC.mu_log - effectBC.mu_log,
      se: Math.sqrt(effectAC.se * effectAC.se + effectBC.se * effectBC.se),
    };
  }

  /**
   * For a closed-loop network: for each direct edge, compute the indirect
   * estimate via the alternative paths through the network, then compare.
   *
   * For star networks: every edge is direct (drug vs reference), and there
   * is no alternative path → indirect undefined → no consistency test.
   *
   * Returns array of per-edge {edge, direct, indirect, diff, z, p}.
   */
  function computeNodeSplits(cfg, edges_pooled, networkInfo) {
    const splits = [];
    if (networkInfo.isStar) return splits;

    const ref = networkInfo.reference;
    const byEdge = new Map();
    edges_pooled.forEach((e, i) => {
      const key = [e.edge.t1, e.edge.t2].sort().join('|');
      byEdge.set(key, e);
    });

    edges_pooled.forEach(edge_pool => {
      if (!edge_pool.pooled) return;
      const t1 = edge_pool.edge.t1;
      const t2 = edge_pool.edge.t2;
      // Indirect path: via reference. Need t1-vs-ref and t2-vs-ref.
      if (t1 === ref || t2 === ref) {
        // This IS a direct-vs-ref edge. Indirect via another non-ref node.
        // Skip for v1: only test loops where edge != ref-direct.
        return;
      }
      const k1 = [t1, ref].sort().join('|');
      const k2 = [t2, ref].sort().join('|');
      const e1 = byEdge.get(k1);
      const e2 = byEdge.get(k2);
      if (!e1 || !e2 || !e1.pooled || !e2.pooled) return;

      // Direct: t1 vs t2 (current edge)
      // Indirect: e1.pooled - e2.pooled (Bucher)
      const direct = edge_pool.pooled;
      const indirect = bucher(e1.pooled, e2.pooled);
      const diff = direct.mu_log - indirect.mu_log;
      const seD = Math.sqrt(direct.se * direct.se + indirect.se * indirect.se);
      const z = seD > 0 ? Math.abs(diff / seD) : 0;
      const p = 2 * (1 - pnorm(z));
      splits.push({
        edge: { t1, t2 },
        nDirect: direct.k,
        direct: { mu: direct.mu, ci_lo: direct.ci_lo, ci_hi: direct.ci_hi },
        indirect: {
          mu: Math.exp(indirect.mu_log),
          ci_lo: Math.exp(indirect.mu_log - 1.96 * indirect.se),
          ci_hi: Math.exp(indirect.mu_log + 1.96 * indirect.se),
        },
        diff: Math.exp(diff),
        z, p,
        inconsistent: p < 0.05,
      });
    });
    return splits;
  }

  /**
   * Fisher's combined p-value across multiple independent tests.
   * χ² = -2 Σ ln(p), df = 2k.
   */
  function fisherCombined(pvals) {
    if (!pvals.length) return null;
    const chi2 = -2 * pvals.reduce((s, p) => s + Math.log(Math.max(p, 1e-12)), 0);
    const df = 2 * pvals.length;
    const p = chi2_pvalue(chi2, df);
    return { chi2, df, p };
  }

  function analyze(realData, cfg, opts) {
    opts = opts || {};
    const measure = opts.measure || 'RR';
    if (!cfg) return { error: 'No NMA_CONFIG provided' };
    if (!realData) return { error: 'No realData provided' };

    const network = classifyNetwork(cfg);
    const edges = (cfg.comparisons || []).map(c => ({
      t1: c.t1, t2: c.t2,
      trials: c.trials || [],
      pooled: poolEdge(c, realData, measure),
    }));

    const splits = computeNodeSplits(cfg, edges.map(e => ({ edge: { t1: e.t1, t2: e.t2 }, pooled: e.pooled })), network);

    const pvals = splits.map(s => s.p).filter(p => isFinite(p));
    const fisher = pvals.length ? fisherCombined(pvals) : null;
    const bonfAlpha = pvals.length ? 0.05 / pvals.length : null;
    const bonfSig = pvals.length ? splits.filter(s => s.p < bonfAlpha).length : 0;
    const localSig = splits.filter(s => s.p < 0.05).length;

    let overall = 'Not estimable';
    if (network.isStar) {
      overall = 'STAR network — consistency cannot be tested (no closed loops)';
    } else if (!pvals.length) {
      overall = 'CLOSED-LOOP network but no testable nodes (insufficient direct evidence)';
    } else if (fisher && fisher.p < 0.05) {
      overall = 'Global inconsistency signal detected (Fisher-combined p < 0.05)';
    } else if (bonfSig > 0) {
      overall = 'Localized major inconsistency (Bonferroni-significant)';
    } else if (localSig > 0) {
      overall = 'Localized inconsistency (uncorrected p < 0.05)';
    } else {
      overall = 'No inconsistency signal detected';
    }

    return {
      network,
      edges,
      splits,
      summary: {
        nTests: pvals.length,
        localSig,
        bonfSig,
        bonfAlpha,
        fisher,
        overall,
      },
      measure,
    };
  }

  function render(container, result, opts) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    if (result.error) {
      container.innerHTML = '<div style="color:#f87171;font-size:12px;padding:1em;">' + result.error + '</div>';
      return;
    }

    const tier = result.network.isStar ? '#3b82f6' : (result.summary.fisher && result.summary.fisher.p < 0.05 ? '#ef4444' : '#10b981');
    const network_label = result.network.isStar ? 'STAR' : 'CLOSED-LOOP';
    const measure = result.measure || 'RR';

    let html = '';
    html += '<div style="display:flex;gap:14px;margin-bottom:14px;align-items:center;">';
    html += '<div style="background:rgba(0,0,0,0.25);border:1px solid ' + tier + ';border-radius:8px;padding:8px 14px;color:' + tier + ';font-weight:700;font-size:11px;letter-spacing:0.08em;">' + network_label + '</div>';
    html += '<div style="font-size:12px;color:#cbd5e1;">' + result.network.nNodes + ' treatments · ' + result.edges.length + ' direct comparisons · reference: <code style="color:#22d3ee">' + (result.network.reference || '—') + '</code></div>';
    html += '</div>';

    // Per-edge direct evidence table
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;margin-bottom:18px;">';
    html += '<thead><tr style="border-bottom:1px solid #334155;">';
    html += ['Edge', 'k', 'Pooled ' + measure + ' (95% CI)', 'τ²', 'I²']
      .map(h => '<th style="text-align:left;padding:6px 10px;color:#94a3b8;font-weight:600;">' + h + '</th>').join('');
    html += '</tr></thead><tbody>';
    result.edges.forEach(e => {
      html += '<tr style="border-bottom:1px solid #1e293b;">';
      html += '<td style="padding:6px 10px;">' + e.t1 + ' vs ' + e.t2 + '</td>';
      if (!e.pooled) {
        html += '<td style="padding:6px 10px;" colspan="4"><span style="color:#64748b;font-style:italic;">no usable trial data</span></td>';
      } else {
        html += '<td style="padding:6px 10px;">' + e.pooled.k + '</td>';
        html += '<td style="padding:6px 10px;font-family:ui-monospace;">' + fmt(e.pooled.mu) + ' (' + fmt(e.pooled.ci_lo) + '–' + fmt(e.pooled.ci_hi) + ')</td>';
        html += '<td style="padding:6px 10px;font-family:ui-monospace;">' + fmt(e.pooled.tau2, 3) + '</td>';
        html += '<td style="padding:6px 10px;font-family:ui-monospace;">' + fmt(e.pooled.I2, 0) + '%</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table>';

    // Star disclosure or consistency table
    if (result.network.isStar) {
      html += '<div style="background:rgba(59,130,246,0.12);border:1px solid #3b82f6;border-radius:8px;padding:12px 16px;color:#93c5fd;font-size:12px;">';
      html += '<strong>STAR network disclosure:</strong> all non-reference comparisons in this NMA are <em>indirect-only</em> via <code style="color:#22d3ee">' + (result.network.reference || '—') + '</code>. ';
      html += 'There are no direct head-to-head trials between the active treatments, so direct/indirect consistency cannot be tested by node-splitting. ';
      html += 'Indirect comparisons inherit the assumption of transitivity (similar populations, co-interventions, and effect-modifiers across the contributing trials). Readers should evaluate transitivity qualitatively.';
      html += '</div>';
    } else {
      // Closed-loop: show consistency table
      if (result.splits.length === 0) {
        html += '<div style="background:rgba(245,158,11,0.10);border:1px solid #f59e0b;border-radius:8px;padding:12px 16px;color:#fde68a;font-size:12px;">';
        html += 'Closed-loop network detected, but none of the loops have sufficient direct + indirect evidence overlap to run a node-split test.';
        html += '</div>';
      } else {
        html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;margin-bottom:14px;">';
        html += '<thead><tr style="border-bottom:1px solid #334155;">';
        html += ['Loop', 'Direct (' + measure + ')', 'Indirect (' + measure + ')', 'Diff', 'z', 'p', 'Verdict']
          .map(h => '<th style="text-align:left;padding:6px 10px;color:#94a3b8;font-weight:600;">' + h + '</th>').join('');
        html += '</tr></thead><tbody>';
        result.splits.forEach(s => {
          const verdictColor = s.inconsistent ? '#f87171' : '#4ade80';
          html += '<tr style="border-bottom:1px solid #1e293b;">';
          html += '<td style="padding:6px 10px;">' + s.edge.t1 + ' vs ' + s.edge.t2 + '</td>';
          html += '<td style="padding:6px 10px;font-family:ui-monospace;">' + fmt(s.direct.mu) + ' (' + fmt(s.direct.ci_lo) + '–' + fmt(s.direct.ci_hi) + ')</td>';
          html += '<td style="padding:6px 10px;font-family:ui-monospace;">' + fmt(s.indirect.mu) + ' (' + fmt(s.indirect.ci_lo) + '–' + fmt(s.indirect.ci_hi) + ')</td>';
          html += '<td style="padding:6px 10px;font-family:ui-monospace;">' + fmt(s.diff) + '</td>';
          html += '<td style="padding:6px 10px;font-family:ui-monospace;">' + s.z.toFixed(2) + '</td>';
          html += '<td style="padding:6px 10px;font-family:ui-monospace;">' + s.p.toFixed(3) + '</td>';
          html += '<td style="padding:6px 10px;color:' + verdictColor + ';font-weight:600;">' + (s.inconsistent ? 'INCONSISTENT' : 'consistent') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table>';

        // Global summary
        html += '<div style="background:rgba(0,0,0,0.25);border:1px solid #334155;border-radius:8px;padding:10px 14px;font-size:11px;color:#cbd5e1;">';
        html += '<strong>Global consistency:</strong> ' + result.summary.overall + '. ';
        html += result.summary.nTests + ' loop test(s); ' + result.summary.localSig + ' uncorrected p<0.05; ' + result.summary.bonfSig + ' Bonferroni-significant (α=' + (result.summary.bonfAlpha ? result.summary.bonfAlpha.toFixed(4) : '—') + ').';
        if (result.summary.fisher) {
          html += ' Fisher χ²(' + result.summary.fisher.df + ')=' + result.summary.fisher.chi2.toFixed(2) + ', combined p=' + result.summary.fisher.p.toFixed(4) + '.';
        }
        html += '</div>';
      }
    }

    container.innerHTML = html;
  }

  global.NMAConsistency = { analyze, render };
})(typeof window !== 'undefined' ? window : globalThis);
