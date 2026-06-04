/* q-decomposition.js — Decomposed Cochran's Q for NMA.
 *
 * Reference: Krahn U, Binder H, König J. "A graphical tool for locating
 *   inconsistency in network meta-analyses." BMC Med Res Methodol 2013;
 *   13:35. doi:10.1186/1471-2288-13-35. Implemented in netmeta::decomp.design.
 *
 * Why: total Q in an NMA conflates two distinct things:
 *   - Q_within  = heterogeneity within each design (replication noise across
 *                 trials of the same comparison)
 *   - Q_between = inconsistency between designs (different comparisons
 *                 disagreeing about indirect estimates)
 *
 * Reporting only total Q hides which type is driving the I². For our
 * defensibility argument: high Q_within is acceptable (real heterogeneity
 * across populations) but high Q_between is problematic (the network
 * itself is incoherent).
 *
 * Decomposition (FE weights for diagnostic purposes; tau² is added back
 * later in random-effects pooling):
 *   For each design d with n_d trials:
 *     Q_d = Σ_i w_i (y_i - ȳ_d)²              (within-design Q)
 *   Q_within = Σ_d Q_d
 *   Q_between = Q_total - Q_within
 *
 * Each gets its own df:
 *   df_within  = N - D                  (N trials, D designs)
 *   df_between = D - 1
 *
 * Output: {Q_total, Q_within, Q_between, df_within, df_between, p_within,
 *          p_between, perDesign: [...]}
 *
 * Public API (window.QDecomposition):
 *   compute(realData, cfg, opts) — opts.measure='RR'|'OR'
 *   render(container, result, opts)
 */
(function (global) {
  'use strict';

  // Wilson-Hilferty chi^2 → p approximation. df ≥ 1.
  function chi2_pvalue(x, df) {
    if (x <= 0 || df <= 0) return 1;
    if (!isFinite(x)) return 0;
    const h = 2 / (9 * df);
    const z = (Math.cbrt(x / df) - (1 - h)) / Math.sqrt(h);
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-z * z / 2);
    const cdf = 1 - phi * (0.319381530 * t + -0.356563782 * t * t + 1.781477937 * t * t * t + -1.821255978 * t * t * t * t + 1.330274429 * t * t * t * t * t);
    return z >= 0 ? 1 - cdf : cdf;
  }

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

  function compute(realData, cfg, opts) {
    opts = opts || {};
    const measure = opts.measure || 'RR';
    if (!realData || !cfg) return { error: 'Missing realData or NMA_CONFIG' };

    // Group trials by design (= comparison contrast)
    const designs = [];
    (cfg.comparisons || []).forEach(c => {
      const trials = (c.trials || [])
        .map(nct => realData[nct])
        .filter(Boolean)
        .map(t => {
          const e = trialEffect(t, measure);
          return e ? { name: t.name, yi: e.yi, vi: e.vi } : null;
        })
        .filter(Boolean);
      if (trials.length > 0) {
        designs.push({ t1: c.t1, t2: c.t2, trials });
      }
    });

    if (designs.length === 0) return { error: 'No usable trial data' };

    // Per-design Q (FE weighted mean of trials within design)
    let Q_within = 0;
    let N = 0;
    const perDesign = designs.map(d => {
      const k = d.trials.length;
      N += k;
      if (k < 2) return { t1: d.t1, t2: d.t2, k, Q: 0, df: 0, mu_log: d.trials[0].yi, mu: Math.exp(d.trials[0].yi), p: null, I2: 0 };
      const w = d.trials.map(t => 1 / t.vi);
      const sumW = w.reduce((a, b) => a + b, 0);
      const mu = d.trials.reduce((s, t, i) => s + w[i] * t.yi, 0) / sumW;
      const Q = d.trials.reduce((s, t, i) => s + w[i] * (t.yi - mu) * (t.yi - mu), 0);
      const df = k - 1;
      Q_within += Q;
      return {
        t1: d.t1, t2: d.t2, k, Q, df,
        mu_log: mu, mu: Math.exp(mu),
        p: df > 0 ? chi2_pvalue(Q, df) : null,
        // Per-design I²
        I2: Q > df ? Math.max(0, (Q - df) / Q) * 100 : 0,
      };
    });

    const D = designs.length;
    const df_within = N - D;

    // Q_total: pool ALL trials (ignoring design — what a naive global Q gives)
    const allTrials = designs.flatMap(d => d.trials);
    const wAll = allTrials.map(t => 1 / t.vi);
    const sumWAll = wAll.reduce((a, b) => a + b, 0);
    const muAll = allTrials.reduce((s, t, i) => s + wAll[i] * t.yi, 0) / sumWAll;
    const Q_total = allTrials.reduce((s, t, i) => s + wAll[i] * (t.yi - muAll) * (t.yi - muAll), 0);
    const df_total = N - 1;

    // Q_between = Q_total - Q_within
    const Q_between = Math.max(0, Q_total - Q_within);
    const df_between = D - 1;

    return {
      measure,
      N, D,
      Q_total, df_total,
      Q_within, df_within,
      Q_between, df_between,
      p_total: df_total > 0 ? chi2_pvalue(Q_total, df_total) : null,
      p_within: df_within > 0 ? chi2_pvalue(Q_within, df_within) : null,
      p_between: df_between > 0 ? chi2_pvalue(Q_between, df_between) : null,
      perDesign,
    };
  }

  function fmtP(p) {
    if (p == null) return '—';
    if (p < 0.001) return '<0.001';
    return p.toFixed(3);
  }

  function severity(p, threshold = 0.05) {
    if (p == null) return { color: '#94a3b8', tag: 'n/a' };
    if (p < 0.001) return { color: '#ef4444', tag: 'major' };
    if (p < 0.05) return { color: '#f59e0b', tag: 'some' };
    return { color: '#10b981', tag: 'no concerns' };
  }

  function render(container, result, opts) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    if (result.error) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:8px;">' + result.error + '</div>';
      return;
    }

    let html = '';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">';

    [
      { label: 'Q TOTAL', value: result.Q_total, df: result.df_total, p: result.p_total, hint: 'naive (heterogeneity + inconsistency conflated)' },
      { label: 'Q WITHIN', value: result.Q_within, df: result.df_within, p: result.p_within, hint: 'heterogeneity (across trials within same comparison)' },
      { label: 'Q BETWEEN', value: result.Q_between, df: result.df_between, p: result.p_between, hint: 'inconsistency (across designs in network)' },
    ].forEach(stat => {
      const s = severity(stat.p);
      html += '<div style="background:rgba(0,0,0,0.25);border:1px solid ' + s.color + ';border-radius:8px;padding:10px 14px;flex:1;min-width:170px;">';
      html += '<div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">' + stat.label + '</div>';
      html += '<div style="font-size:18px;color:' + s.color + ';font-weight:800;font-family:ui-monospace;margin:4px 0;">';
      html += stat.value.toFixed(2) + ' <span style="font-size:11px;color:#94a3b8;font-weight:400;">(df=' + stat.df + ')</span>';
      html += '</div>';
      html += '<div style="font-size:11px;color:#cbd5e1;">p=' + fmtP(stat.p) + ' <span style="color:' + s.color + ';">' + s.tag + '</span></div>';
      html += '<div style="font-size:9px;color:#64748b;margin-top:4px;">' + stat.hint + '</div>';
      html += '</div>';
    });
    html += '</div>';

    // Per-design Q breakdown
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
    html += '<thead><tr style="border-bottom:1px solid #334155;">';
    ['Design (comparison)', 'k', 'Q (within-design)', 'df', 'p', 'I²'].forEach(h => {
      html += '<th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;">' + h + '</th>';
    });
    html += '</tr></thead><tbody>';
    result.perDesign.forEach(d => {
      const s = severity(d.p);
      html += '<tr style="border-bottom:1px solid #1e293b;">';
      html += '<td style="padding:6px 8px;">' + d.t1 + ' vs ' + d.t2 + '</td>';
      html += '<td style="padding:6px 8px;">' + d.k + '</td>';
      html += '<td style="padding:6px 8px;font-family:ui-monospace;color:' + s.color + ';">' + d.Q.toFixed(2) + '</td>';
      html += '<td style="padding:6px 8px;">' + d.df + '</td>';
      html += '<td style="padding:6px 8px;font-family:ui-monospace;">' + fmtP(d.p) + '</td>';
      html += '<td style="padding:6px 8px;font-family:ui-monospace;">' + d.I2.toFixed(0) + '%</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10px;color:#64748b;margin-top:8px;">';
    html += 'Krahn-Binder-König 2013 decomposition: Q_total = Q_within + Q_between. Q_within is acceptable heterogeneity ';
    html += '(replication noise within a comparison); Q_between is structural inconsistency between designs.';
    html += '</div>';

    container.innerHTML = html;
  }

  global.QDecomposition = { compute, render };
})(typeof window !== 'undefined' ? window : globalThis);
