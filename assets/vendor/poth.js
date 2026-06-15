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
 *   POTH = 1     → perfectly precise hierarchy (SUCRAs maximally spread)
 *   POTH = 0     → fully indeterminate (all SUCRA = 0.5)
 *   POTH < 0.5   → hierarchy is non-informative; do not write
 *                  "X ranks best" in conclusions.
 *
 * HEADLINE metric — the CANONICAL Wigle definition (CRAN `poth`-verified, the
 * closed-form S²/S²max variance ratio computed from the SUCRA values):
 *   S2(n)    = (1/n) Σ_i (SUCRA_i − 0.5)²        (SUCRAs centred at 0.5)
 *   S2max(n) = (n+1) / (12 (n−1))                (max, SUCRAs evenly spread)
 *   POTH(n)  = S2(n) / S2max(n)                   0 ≤ POTH ≤ 1
 * This is what advanced-stats's "POTH<0.5 ⇒ non-informative" rule refers to.
 * Delegated to the verbatim-vendored `AlmPOTH` (alm-poth.js); an identical
 * inline closed form is the fallback if AlmPOTH isn't loaded — the formula is
 * a mathematical identity, so the two paths cannot disagree.
 *
 * SECONDARY diagnostic — rank-entropy precision (NOT Wigle's POTH; a related
 * but distinct valid metric): 1 − (mean_t H(p_t)) / log(K), where H(p_t) is the
 * Shannon entropy of treatment t's rank-probability vector. Reported alongside
 * the headline as a per-treatment "how spread is each treatment's rank" view.
 *
 * Inputs:
 *   rankogram: array of {treatment, rankProbs: [p_rank1, p_rank2, ...]}
 *     where rankProbs[i] = P(treatment ranks i+1).
 *
 * Public API (window.POTH):
 *   compute(rankogram) → {poth (canonical), sucra, s2, s2max, verdict, color,
 *                         rankEntropyPrecision, perTreatmentEntropy, ...}
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

  // SUCRA_i from a treatment's rank-probability vector (Salanti cumulative
  // form): SUCRA = (1/(n-1)) Σ_{r<n-1} (cumulative prob of rank ≤ r). Matches
  // the (J-meanRank)/(J-1) form used elsewhere in the kit (algebraic identity).
  function sucraFromRankProbVec(p) {
    const n = p.length;
    if (n < 2) return 0;
    let cum = 0, acc = 0;
    for (let r = 0; r < n - 1; r++) { cum += p[r]; acc += cum; }
    return acc / (n - 1);
  }

  // Canonical Wigle POTH closed form from SUCRA values in [0,1]. Delegates to
  // the verbatim-vendored AlmPOTH (alm-poth.js, CRAN poth-verified) when loaded;
  // the inline path is the identical S²/S²max identity as a load-order-proof
  // fallback. Returns {poth, s2, s2max, meanSucra} or null for n<2.
  function canonicalPOTH(sucras) {
    if (global.AlmPOTH && typeof global.AlmPOTH.poth === 'function') {
      return global.AlmPOTH.poth(sucras);
    }
    const s = (sucras || []).filter(v => typeof v === 'number' && isFinite(v));
    const n = s.length;
    if (n < 2) return null;
    let sumSq = 0, sum = 0;
    for (let i = 0; i < n; i++) { sumSq += (s[i] - 0.5) * (s[i] - 0.5); sum += s[i]; }
    const s2 = sumSq / n;
    const s2max = (n + 1) / (12 * (n - 1));
    let val = s2 / s2max;
    if (val < 0) val = 0; if (val > 1) val = 1;
    return { poth: val, n, s2, s2max, meanSucra: sum / n };
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

    // Per-treatment normalised rank-prob vectors (guards percentages / stale rows).
    const normProbs = valid.map(t => {
      const s = t.rankProbs.reduce((a, b) => a + b, 0);
      return s > 0 ? t.rankProbs.map(x => x / s) : t.rankProbs;
    });

    // HEADLINE: canonical Wigle POTH = S²/S²max from the SUCRA values.
    const sucras = normProbs.map(sucraFromRankProbVec);
    const canon = canonicalPOTH(sucras) || { poth: 0, s2: 0, s2max: 0, meanSucra: 0.5 };
    const poth = canon.poth;

    // SECONDARY: rank-entropy precision (distinct metric, per-treatment view).
    const maxH = Math.log(K);
    const perTreatmentEntropy = valid.map((t, i) => {
      const H = shannonEntropy(normProbs[i]);
      return {
        treatment: t.treatment,
        sucra: sucras[i],
        entropy: H,
        normalizedEntropy: maxH > 0 ? H / maxH : 0
      };
    });
    const meanH = perTreatmentEntropy.reduce((s, t) => s + t.entropy, 0) / K;
    const rankEntropyPrecision = maxH > 0 ? 1 - meanH / maxH : 0;

    let verdict, color;
    if (poth >= 0.75) { verdict = 'Highly informative hierarchy'; color = '#10b981'; }
    else if (poth >= 0.5) { verdict = 'Moderately informative'; color = '#3b82f6'; }
    else if (poth >= 0.25) { verdict = 'Low precision — interpret rankings cautiously'; color = '#f59e0b'; }
    else { verdict = 'Hierarchy non-informative — do NOT claim any treatment ranks best'; color = '#ef4444'; }

    return {
      poth, verdict, color, K,
      sucra: sucras,
      s2: canon.s2, s2max: canon.s2max, meanSucra: canon.meanSucra,
      rankEntropyPrecision, perTreatmentEntropy,
      meanEntropy: meanH, maxEntropy: maxH
    };
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
    html += '<span style="font-size:11px;color:#94a3b8;">K=' + result.K + ' treatments · canonical S²/S²max = '
         + (result.s2 != null ? result.s2.toFixed(4) : '—') + ' / ' + (result.s2max != null ? result.s2max.toFixed(4) : '—');
    if (typeof result.rankEntropyPrecision === 'number') {
      html += ' · rank-entropy precision = ' + result.rankEntropyPrecision.toFixed(3) + ' (secondary)';
    }
    html += '</span>';
    if (fromSucra) {
      html += '<br><span style="font-size:10px;color:#fbbf24;">⚠ Estimated from SUCRA (Gaussian approximation); MCMC rankograms preferred.</span>';
    }
    html += '</div></div>';

    // Secondary diagnostic — per-treatment rank entropy (NOT the Wigle POTH).
    html += '<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;margin:2px 0 4px;">Secondary: per-treatment rank entropy</div>';
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

  const api = { compute, fromSUCRA, render, canonicalPOTH, sucraFromRankProbVec };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.POTH = api;
})(typeof window !== 'undefined' ? window : globalThis);
