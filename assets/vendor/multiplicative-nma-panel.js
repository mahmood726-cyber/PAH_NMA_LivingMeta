/* multiplicative-nma-panel.js — multiplicative-heterogeneity NMA (network UWLS)
 * as a sensitivity alternative to additive random-effects NMA.
 *
 * Engine: AlmMultiplicativeNMA.fit (vendored verbatim from
 * allmeta/shared/multiplicative-nma.js, verified vs netmeta common-effect TE/Q).
 * Inflates the fixed-effect NMA covariance by a single φ = Q/(n−p) instead of
 * adding τ²; relative-effect points equal the FE-NMA estimates, every SE is
 * SE_FE × √φ, with t_{n−p} CIs.
 *
 * Why surface it (advanced-stats.md "NMA multiplicative fallback"): if a funnel /
 * Egger check suggests small-study effects, or the network has a small-study
 * outlier, fit multiplicative heterogeneity alongside additive RE and switch to
 * it when AIC favours by ≥2. This panel reports the AIC comparison + the φ-scaled
 * SEs. NMA dashboards only — self-skips on pairwise dashboards.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'multiplicative-nma-panel-expanded';

  // Per-trial contrast rows {trtA,trtB,yi,sei} on the log-RR scale (kit's NMA
  // default), built from NMA_CONFIG.comparisons -> realData, mirroring how
  // nma-consistency.js reconstructs direct evidence.
  function buildRows(cfg, rd) {
    const rows = [];
    (cfg.comparisons || []).forEach(cmp => {
      (cmp.trials || []).forEach(nct => {
        const t = rd[nct];
        if (!t) return;
        let tE = +t.tE, tN = +t.tN, cE = +t.cE, cN = +t.cN;
        if (!(isFinite(tE) && isFinite(tN) && isFinite(cE) && isFinite(cN) && tN > 0 && cN > 0)) return;
        if (tE === 0 || cE === 0 || tE === tN || cE === cN) { tE += 0.5; tN += 1; cE += 0.5; cN += 1; }
        const logRR = Math.log((tE / tN) / (cE / cN));
        const v = 1 / tE - 1 / tN + 1 / cE - 1 / cN;
        if (!(v > 0)) return;
        rows.push({ trtA: cmp.t1, trtB: cmp.t2, yi: logRR, sei: Math.sqrt(v) });
      });
    });
    return rows;
  }

  function buildBody(P, r) {
    const fmt = P.fmt;
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
        + '</div>';
    }
    const preferMult = r.prefer === 'multiplicative';
    const tone = preferMult ? '#fbbf24' : '#34d399';
    const toneBg = preferMult ? '#3a2a0a' : '#0e3a1f';
    const toneBorder = preferMult ? '#92400e' : '#34d399';
    const verdict = preferMult
      ? '⚠ AIC favours the multiplicative model by ' + fmt(r.aicDiff, 1) + ' — small-study effects / overdispersion; prefer the φ-inflated SEs below.'
      : (r.prefer === 'additive'
        ? '✓ AIC favours the additive RE model by ' + fmt(-r.aicDiff, 1) + ' — the standard RE-NMA SEs are adequate.'
        : '≈ AIC comparable (Δ ' + fmt(r.aicDiff, 1) + '); models agree.');
    let html = '<div style="background:' + toneBg + ';border:1px solid ' + toneBorder + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">' + verdict + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;">';
    html += cell('Overdispersion φ = Q/(n−p)', fmt(r.phi, 3), 'Q = ' + fmt(r.Q, 2) + ', df = ' + r.df);
    html += cell('Additive AIC', fmt(r.additive.aic, 1), 'τ² RE-NMA');
    html += cell('Multiplicative AIC', fmt(r.multiplicative.aic, 1), 'φ-inflated');
    html += '</div>';
    // Per-treatment effects table (vs reference), φ-inflated SE + t CI.
    let rowsHtml = '';
    Object.keys(r.effects).forEach(t => {
      const e = r.effects[t];
      if (e.estimate === 0 && e.se === 0) return; // reference
      rowsHtml += '<tr>'
        + '<td style="padding:4px 8px;color:#cbd5e1;">' + P.escapeHtml(t) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#f1f5f9;text-align:right;">' + fmt(Math.exp(e.estimate), 2) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(e.seFE, 3) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(e.se, 3) + '</td>'
        + (e.ciLo != null ? '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(Math.exp(e.ciLo), 2) + '–' + fmt(Math.exp(e.ciHi), 2) + '</td>' : '<td></td>')
        + '</tr>';
    });
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">'
      + '<thead><tr style="color:#94a3b8;text-transform:uppercase;font-size:9.5px;letter-spacing:0.04em;">'
      + '<th style="text-align:left;padding:4px 8px;">vs ref</th><th style="text-align:right;padding:4px 8px;">RR</th>'
      + '<th style="text-align:right;padding:4px 8px;">SE(FE)</th><th style="text-align:right;padding:4px 8px;">SE(mult)</th>'
      + '<th style="text-align:right;padding:4px 8px;">95% CI (mult)</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
      + '<strong>Multiplicative NMA (network UWLS):</strong> the fixed-effect network covariance scaled by φ = Q/(n−p) — relative effects unchanged, '
      + 'SEs × √φ, t<sub>n−p</sub> CIs. The network generalisation of UWLS. Use as the heterogeneity model when small-study effects are suspected; '
      + 'switch from additive RE only when AIC favours by ≥2 (advanced-stats.md). Sensitivity alongside the RE-NMA primary, not a replacement.</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmMultiplicativeNMA) return false;
    if (!P.isNMA || !P.isNMA()) return false; // pairwise dashboard -> skip
    const cfg = global.NMA_CONFIG;
    const rd = P.getRealData();
    if (!cfg || !rd || !cfg.treatments || cfg.treatments.length < 2) return false;
    const rows = buildRows(cfg, rd);
    if (rows.length < cfg.treatments.length) return false; // need n > p for df>0
    let r;
    try { r = global.AlmMultiplicativeNMA.fit(rows, cfg.treatments); }
    catch (e) { return false; }
    if (!r || !r.ok || !isFinite(r.phi)) return false;

    const summary = 'φ=' + P.fmt(r.phi, 2) + ' · prefer ' + r.prefer
      + ' (ΔAIC ' + P.fmt(r.aicDiff, 1) + ') · ' + r.df + ' df';
    const panel = P.buildCollapsiblePanel({
      id: 'multiplicative-nma-panel', badge: 'Multiplicative NMA', summary,
      bodyHtml: buildBody(P, r), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('multiplicative-nma-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1100));
    else setTimeout(tick, 1100);
  }

  global.MultiplicativeNMAPanel = { render, buildRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
