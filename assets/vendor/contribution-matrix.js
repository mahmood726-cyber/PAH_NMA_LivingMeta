/* contribution-matrix.js — per-comparison contribution of each direct
 * comparison to each network estimate (PRISMA-NMA "streams of evidence").
 *
 * Reference: Papakonstantinou T, Nikolakopoulou A, Rücker G, Chaimani A,
 *   Schwarzer G, Egger M, Salanti G. "Estimating the contribution of
 *   studies in network meta-analysis: paths, flows and streams."
 *   F1000Research 2018;7:610. doi:10.12688/f1000research.14770.3.
 *   Implemented in netmeta::netcontrib + cinemar::nma_contribution.
 *
 * Why: when you say a network estimate of A vs B has 70% direct evidence
 * and 30% indirect via C, you NEED the contribution to weight CINeMA
 * within-study bias correctly (high direct evidence + high RoB direct
 * trials → low certainty; the same overall RoB with mostly indirect
 * evidence is more nuanced).
 *
 * Approach: for a star network with N drug-vs-reference comparisons, the
 * indirect path from drug_i vs drug_j goes via reference. Contributions:
 *   - Direct comparison drug_i vs drug_j: 100% from those trials (if any)
 *   - Indirect drug_i vs drug_j: split between the i-vs-ref edge and the
 *     j-vs-ref edge, weighted by their precision.
 *
 * For closed-loop networks the algorithm gets more complex; a full hat-
 * matrix computation is needed. v1 implementation handles stars (which
 * is our entire fleet) and emits a note for non-star networks.
 *
 * Public API (window.ContributionMatrix):
 *   compute(realData, cfg, opts) — opts.measure='RR'|'OR'
 *   render(container, result)
 */
(function (global) {
  'use strict';

  function trialEffect(t, measure) {
    if (!t || t.tE == null || t.tN == null || t.cE == null || t.cN == null) return null;
    if (t.tN <= 0 || t.cN <= 0) return null;
    if (t.tE > t.tN || t.cE > t.cN || t.tE < 0 || t.cE < 0) return null;
    if (t.tE === 0 && t.cE === 0) return null;
    let tEa = t.tE, tNa = t.tN, cEa = t.cE, cNa = t.cN;
    if (tEa === 0 || cEa === 0 || tEa === tNa || cEa === cNa) {
      tEa += 0.5; tNa += 1; cEa += 0.5; cNa += 1;
    }
    if (measure === 'OR') {
      const a = tEa, b = tNa - tEa, c = cEa, d = cNa - cEa;
      return { yi: Math.log((a * d) / (b * c)), vi: 1 / a + 1 / b + 1 / c + 1 / d };
    }
    return {
      yi: Math.log((tEa / tNa) / (cEa / cNa)),
      vi: 1 / tEa - 1 / tNa + 1 / cEa - 1 / cNa,
    };
  }

  function poolDL(trials) {
    if (!trials.length) return null;
    const w = trials.map(t => 1 / t.vi);
    const sumW = w.reduce((a, b) => a + b, 0);
    const muFE = trials.reduce((s, t, i) => s + w[i] * t.yi, 0) / sumW;
    const Q = trials.reduce((s, t, i) => s + w[i] * (t.yi - muFE) * (t.yi - muFE), 0);
    const df = trials.length - 1;
    let tau2 = 0;
    if (Q > df && df > 0) {
      const C = sumW - w.reduce((s, x) => s + x * x, 0) / sumW;
      tau2 = Math.max(0, (Q - df) / C);
    }
    const wRE = trials.map(t => 1 / (t.vi + tau2));
    const sumWRE = wRE.reduce((a, b) => a + b, 0);
    const mu = trials.reduce((s, t, i) => s + wRE[i] * t.yi, 0) / sumWRE;
    return { mu, var_mu: 1 / sumWRE, tau2, k: trials.length, weights: wRE.map(x => x / sumWRE) };
  }

  function compute(realData, cfg, opts) {
    opts = opts || {};
    const measure = opts.measure || 'RR';
    if (!realData || !cfg) return { error: 'Missing realData or NMA_CONFIG' };

    const treatments = cfg.treatments || [];
    const comparisons = cfg.comparisons || [];

    // Detect reference (highest-degree node)
    const deg = {};
    comparisons.forEach(c => {
      deg[c.t1] = (deg[c.t1] || 0) + 1;
      deg[c.t2] = (deg[c.t2] || 0) + 1;
    });
    let ref = null, maxDeg = 0;
    Object.keys(deg).forEach(t => {
      if (deg[t] > maxDeg) { maxDeg = deg[t]; ref = t; }
    });

    const isStar = comparisons.every(c => c.t1 === ref || c.t2 === ref);
    if (!isStar) {
      return {
        error: 'Closed-loop networks require full hat-matrix contribution computation; v1 supports star networks only',
        isStar: false,
        reference: ref,
      };
    }

    // Pool each direct edge (drug vs ref)
    const edgeFits = {};
    const directOnly = [];
    comparisons.forEach(c => {
      const drug = c.t1 === ref ? c.t2 : c.t1;
      const trials = (c.trials || [])
        .map(nct => realData[nct])
        .filter(Boolean)
        .map(t => trialEffect(t, measure))
        .filter(Boolean);
      if (trials.length === 0) return;
      const pool = poolDL(trials);
      if (!pool) return;
      // Direction: standardize as drug - ref. The c.t1 vs c.t2 sign matters.
      const sign = c.t1 === drug ? 1 : -1;
      edgeFits[drug] = {
        drug,
        k: pool.k,
        mu: sign * pool.mu, // drug vs ref
        var_mu: pool.var_mu,
        precision: 1 / pool.var_mu,
      };
      directOnly.push({ a: drug, b: ref, percentDirect: 100, percentIndirect: 0, paths: [drug + '↔' + ref] });
    });

    // For every pair of non-ref drugs, compute contribution split for the
    // indirect comparison (drug_i vs drug_j via ref).
    const drugs = Object.keys(edgeFits);
    const indirectComparisons = [];
    for (let i = 0; i < drugs.length; i++) {
      for (let j = i + 1; j < drugs.length; j++) {
        const a = drugs[i], b = drugs[j];
        const ea = edgeFits[a], eb = edgeFits[b];
        const totalVar = ea.var_mu + eb.var_mu;
        // Indirect estimate: ea.mu - eb.mu (a vs b)
        const ind_mu = ea.mu - eb.mu;
        // Contribution: precision-share via inverse-variance.
        // Each leg's contribution to the total variance is var_leg / totalVar.
        // (Equivalent to weight allocation of 1/(var_a+var_b).)
        const cA = ea.var_mu / totalVar;
        const cB = eb.var_mu / totalVar;
        indirectComparisons.push({
          a, b,
          ind_mu_log: ind_mu,
          ind_mu: Math.exp(ind_mu),
          ind_se: Math.sqrt(totalVar),
          contributions: [
            { edge: a + ' vs ' + ref, percent: cA * 100, k: ea.k },
            { edge: b + ' vs ' + ref, percent: cB * 100, k: eb.k },
          ],
        });
      }
    }

    return {
      measure,
      isStar: true,
      reference: ref,
      edges: Object.values(edgeFits).map(e => ({
        edge: e.drug + ' vs ' + ref,
        k: e.k,
        mu: Math.exp(e.mu),
        precision: e.precision,
      })),
      directComparisons: directOnly,
      indirectComparisons,
    };
  }

  function fmt(x, d) { return x == null || !isFinite(x) ? '—' : x.toFixed(d != null ? d : 2); }

  function render(container, result) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    if (result.error) {
      let h = '<div style="color:#fbbf24;font-size:12px;padding:8px;">' + result.error;
      if (result.reference) h += ' (detected reference: ' + result.reference + ')';
      h += '</div>';
      container.innerHTML = h;
      return;
    }

    let html = '';
    html += '<div style="font-size:12px;color:#cbd5e1;margin-bottom:10px;">Star network with reference: <code style="color:#22d3ee;">' + result.reference + '</code>. ';
    html += result.directComparisons.length + ' direct edges, ' + result.indirectComparisons.length + ' indirect (drug-vs-drug) comparisons.</div>';

    // Direct edges table
    html += '<h5 style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin:14px 0 6px 0;">Direct edges</h5>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
    html += '<thead><tr style="border-bottom:1px solid #334155;">';
    ['Edge', 'k', 'Pooled effect', 'Precision (1/var)'].forEach(h => {
      html += '<th style="text-align:left;padding:4px 8px;color:#94a3b8;font-weight:600;font-size:10px;">' + h + '</th>';
    });
    html += '</tr></thead><tbody>';
    result.edges.forEach(e => {
      html += '<tr style="border-bottom:1px solid #1e293b;">';
      html += '<td style="padding:4px 8px;">' + e.edge + '</td>';
      html += '<td style="padding:4px 8px;">' + e.k + '</td>';
      html += '<td style="padding:4px 8px;font-family:ui-monospace;">' + fmt(e.mu, 2) + '</td>';
      html += '<td style="padding:4px 8px;font-family:ui-monospace;">' + fmt(e.precision, 2) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';

    // Indirect comparisons + contribution split
    if (result.indirectComparisons.length > 0) {
      html += '<h5 style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin:18px 0 6px 0;">Indirect (drug-vs-drug) comparisons — contribution split</h5>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
      html += '<thead><tr style="border-bottom:1px solid #334155;">';
      ['Comparison', 'Indirect estimate', 'Contribution split'].forEach(h => {
        html += '<th style="text-align:left;padding:4px 8px;color:#94a3b8;font-weight:600;font-size:10px;">' + h + '</th>';
      });
      html += '</tr></thead><tbody>';
      result.indirectComparisons.slice(0, 30).forEach(c => {
        html += '<tr style="border-bottom:1px solid #1e293b;">';
        html += '<td style="padding:6px 8px;">' + c.a + ' vs ' + c.b + '</td>';
        html += '<td style="padding:6px 8px;font-family:ui-monospace;">' + fmt(c.ind_mu, 2) + ' [' +
                fmt(Math.exp(c.ind_mu_log - 1.96 * c.ind_se), 2) + '–' +
                fmt(Math.exp(c.ind_mu_log + 1.96 * c.ind_se), 2) + ']</td>';
        html += '<td style="padding:6px 8px;">';
        c.contributions.forEach(x => {
          const pct = x.percent.toFixed(0);
          html += '<div style="display:flex;align-items:center;gap:6px;font-size:10px;margin-bottom:2px;">';
          html += '<span style="min-width:140px;color:#94a3b8;">' + x.edge + '</span>';
          html += '<div style="flex:1;background:#1e293b;height:6px;border-radius:3px;overflow:hidden;max-width:120px;">';
          html += '<div style="width:' + pct + '%;height:100%;background:#22d3ee;"></div>';
          html += '</div>';
          html += '<span style="font-family:ui-monospace;min-width:32px;text-align:right;">' + pct + '%</span>';
          html += '<span style="color:#64748b;font-size:9px;">(k=' + x.k + ')</span>';
          html += '</div>';
        });
        html += '</td>';
        html += '</tr>';
      });
      if (result.indirectComparisons.length > 30) {
        html += '<tr><td colspan="3" style="padding:8px;text-align:center;color:#64748b;font-style:italic;">' +
                '… and ' + (result.indirectComparisons.length - 30) + ' more</td></tr>';
      }
      html += '</tbody></table>';
    }

    html += '<div style="font-size:10px;color:#64748b;margin-top:10px;">';
    html += 'Papakonstantinou et al. 2018 streams-of-evidence: each indirect (drug_i vs drug_j) inherits its uncertainty ';
    html += 'from both direct legs through the reference. Contribution % = inverse-variance share. ';
    html += 'Use this to weight per-edge RoB when rolling up to CINeMA within-study bias judgement.';
    html += '</div>';

    container.innerHTML = html;
  }

  global.ContributionMatrix = { compute, render };
})(typeof window !== 'undefined' ? window : globalThis);
