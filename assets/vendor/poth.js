/* poth.js — Precision Of Treatment Hierarchy (POTH) index.
 *
 * Reference: Wigle A, Béliveau A, et al. "Precision of Treatment Hierarchy:
 *   a metric for quantifying uncertainty in network meta-analysis." Stat
 *   Med 2025 doi:10.1002/sim.70176; arXiv:2501.11596. R package `poth`.
 *
 * Why: SUCRA gives a ranking but says nothing about whether the ranking is
 * INFORMATIVE. With wide CrIs and overlapping rankings, SUCRA can put two
 * treatments at "rank 1 vs rank 2" with negligible probabilistic
 * separation. POTH ∈ [0, 1] summarizes that separation in one number:
 *   POTH = 1     → perfectly precise hierarchy (all rankings near 0 or 1)
 *   POTH = 0     → fully indeterminate (every treatment uniformly ranked)
 *   POTH < 0.5   → hierarchy is non-informative; do not write
 *                  "X ranks best" in conclusions.
 *
 * Definition: POTH = 1 - (mean_t  H(p_t)) / log(K)
 *   where p_t is the rank-probability vector for treatment t (vector of
 *   length K), H(p_t) = -Σ p_{t,r} log(p_{t,r}) is its Shannon entropy,
 *   and log(K) is the maximum entropy (uniform).
 *
 * Inputs:
 *   rankogram: array of {treatment, rankProbs: [p_rank1, p_rank2, ...]}
 *     where rankProbs[i] = P(treatment ranks i+1).
 *
 * Public API (window.POTH):
 *   compute(rankogram) → {poth, perTreatmentEntropy, verdict, color}
 *   render(container, result, opts)
 *
 * If a SUCRA-only output is available (no full rankogram), we estimate
 * the rank-probability vector from SUCRA + uniform spread; this is a
 * coarse approximation flagged in the output.
 */
(function (global) {
  'use strict';

  function shannonEntropy(p) {
    let H = 0;
    for (let i = 0; i < p.length; i++) {
      const pi = p[i];
      if (pi > 0) H -= pi * Math.log(pi);
    }
    return H;
  }

  /**
   * Compute POTH from a rankogram.
   *
   * @param {Array<{treatment: string, rankProbs: number[]}>} rankogram
   * @returns {{poth: number, perTreatmentEntropy: Array, verdict: string, color: string, K: number}}
   */
  function compute(rankogram) {
    const valid = (rankogram || []).filter(t =>
      t && Array.isArray(t.rankProbs) && t.rankProbs.length > 0
    );
    if (valid.length === 0) return { error: 'No rankogram provided' };
    const K = valid.length;
    if (K < 2) return { error: 'POTH requires at least 2 treatments' };

    const maxH = Math.log(K);
    const perTreatmentEntropy = valid.map(t => {
      // Normalize rankProbs to sum=1 (in case they're percentages or stale)
      const s = t.rankProbs.reduce((a, b) => a + b, 0);
      const p = s > 0 ? t.rankProbs.map(x => x / s) : t.rankProbs;
      const H = shannonEntropy(p);
      return { treatment: t.treatment, entropy: H, normalizedEntropy: maxH > 0 ? H / maxH : 0 };
    });
    const meanH = perTreatmentEntropy.reduce((s, t) => s + t.entropy, 0) / K;
    const poth = maxH > 0 ? 1 - meanH / maxH : 0;

    let verdict, color;
    if (poth >= 0.75) { verdict = 'Highly informative hierarchy'; color = '#10b981'; }
    else if (poth >= 0.5) { verdict = 'Moderately informative'; color = '#3b82f6'; }
    else if (poth >= 0.25) { verdict = 'Low precision — interpret rankings cautiously'; color = '#f59e0b'; }
    else { verdict = 'Hierarchy non-informative — do NOT claim any treatment ranks best'; color = '#ef4444'; }

    return { poth, perTreatmentEntropy, verdict, color, K, meanEntropy: meanH, maxEntropy: maxH };
  }

  /**
   * Build an approximate rankogram from SUCRA values when full rank-probs
   * aren't available. SUCRA_t = mean rank position from best to worst.
   * Approximation: place a Gaussian centered at rank K*(1-SUCRA) with
   * SD ≈ K/4. This is COARSE; full MCMC rankograms preferred. Flagged
   * in the verdict.
   */
  function fromSUCRA(treatments) {
    const K = treatments.length;
    if (K < 2) return [];
    const rankogram = treatments.map(t => {
      const sucra = Math.min(1, Math.max(0, t.sucra || t.SUCRA || 0));
      const meanRank = K * (1 - sucra) + 0.5; // 1..K
      const sd = K / 4;
      const probs = [];
      for (let r = 1; r <= K; r++) {
        // Gaussian density at integer rank, then normalize
        const z = (r - meanRank) / sd;
        probs.push(Math.exp(-0.5 * z * z));
      }
      const total = probs.reduce((s, p) => s + p, 0);
      return { treatment: t.treatment || t.name, rankProbs: probs.map(p => p / total) };
    });
    return rankogram;
  }

  function render(container, result, opts) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    if (result.error) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:8px;">' + result.error + '</div>';
      return;
    }
    opts = opts || {};
    const fromSucra = opts.fromSucra === true;
    let html = '';
    html += '<div style="display:flex;gap:14px;align-items:center;margin-bottom:10px;">';
    html += '<div style="background:rgba(0,0,0,0.25);border:1px solid ' + result.color + ';border-radius:8px;padding:10px 16px;">';
    html += '<div style="color:' + result.color + ';font-weight:800;font-size:18px;">POTH = ' + result.poth.toFixed(3) + '</div>';
    html += '<div style="color:#94a3b8;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;">precision of hierarchy</div>';
    html += '</div>';
    html += '<div style="flex:1;font-size:12px;color:#cbd5e1;">';
    html += '<strong style="color:' + result.color + ';">' + result.verdict + '</strong><br>';
    html += '<span style="font-size:11px;color:#94a3b8;">K=' + result.K + ' treatments · mean H=' + result.meanEntropy.toFixed(3) + ' · max H=' + result.maxEntropy.toFixed(3) + '</span>';
    if (fromSucra) {
      html += '<br><span style="font-size:10px;color:#fbbf24;">⚠ Estimated from SUCRA (Gaussian approximation); MCMC rankograms preferred.</span>';
    }
    html += '</div></div>';

    // Per-treatment entropy bars
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
    html += '<thead><tr style="border-bottom:1px solid #334155;">';
    html += '<th style="text-align:left;padding:4px 8px;color:#94a3b8;font-weight:600;">Treatment</th>';
    html += '<th style="text-align:left;padding:4px 8px;color:#94a3b8;font-weight:600;">Normalised entropy (0=precise, 1=uniform)</th>';
    html += '</tr></thead><tbody>';
    result.perTreatmentEntropy
      .slice()
      .sort((a, b) => a.normalizedEntropy - b.normalizedEntropy)
      .forEach(t => {
        const bar = Math.round(t.normalizedEntropy * 100);
        html += '<tr style="border-bottom:1px solid #1e293b;">';
        html += '<td style="padding:4px 8px;">' + (t.treatment || '—') + '</td>';
        html += '<td style="padding:4px 8px;">';
        html += '<div style="display:flex;align-items:center;gap:8px;">';
        html += '<div style="flex:1;background:#1e293b;height:8px;border-radius:4px;overflow:hidden;max-width:280px;">';
        html += '<div style="width:' + bar + '%;height:100%;background:' + (bar < 30 ? '#10b981' : bar < 70 ? '#f59e0b' : '#ef4444') + ';"></div>';
        html += '</div>';
        html += '<span style="font-family:ui-monospace;font-size:10px;color:#94a3b8;min-width:38px;">' + t.normalizedEntropy.toFixed(2) + '</span>';
        html += '</div>';
        html += '</td>';
        html += '</tr>';
      });
    html += '</tbody></table>';

    container.innerHTML = html;
  }

  global.POTH = { compute, fromSUCRA, render };
})(typeof window !== 'undefined' ? window : globalThis);
