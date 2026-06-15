/* nma-meta-regression-panel.js — network meta-regression with a treatment ×
 * covariate interaction (Cooper et al. 2009; Dias et al. 2018 NICE TSD 3).
 *
 * Engine: AlmNmaMetaReg.fit (vendored verbatim from
 * allmeta/shared/nma-meta-regression.js, verified vs netmeta::netmetareg
 * assumption="independent"; reproduces nma-meta-reg-parity.spec.mjs — d[B]=
 * +0.3775860, d[C]=+0.4106535 at covariate=0, slopes -0.0009636/+0.0012448,
 * differing only by the documented sign + centring conventions). Extends the
 * standard NMA with a treatment-specific interaction slope per non-reference
 * treatment, estimating τ² by Paule-Mandel and β, γ by GLS at the converged τ².
 *
 * NMA-conditional panel (like multiplicative-nma / nma-dbt): builds per-trial
 * log-RR contrast rows from NMA_CONFIG and uses the per-study publication YEAR as
 * the covariate (the kit's standard study-level moderator). Reports per-treatment
 * effects at the mean year, the interaction slope per treatment, and predicted
 * effects at the earliest/latest year. An established method (NICE TSD 3) ->
 * neutral badge. Self-skips on pairwise dashboards or when years don't vary.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'nma-meta-regression-panel-expanded';

  // Per-trial contrast rows {trtA,trtB,yi,sei,covariate} on the log-RR scale,
  // covariate = trial year (mirrors how nma-dbt-panel reconstructs contrasts).
  function buildRows(cfg, rd) {
    const rows = [];
    (cfg.comparisons || []).forEach(cmp => {
      (cmp.trials || []).forEach(nct => {
        const t = rd[nct];
        if (!t) return;
        let tE = +t.tE, tN = +t.tN, cE = +t.cE, cN = +t.cN;
        if (!(isFinite(tE) && isFinite(tN) && isFinite(cE) && isFinite(cN) && tN > 0 && cN > 0)) return;
        const year = +t.year;
        if (!isFinite(year)) return;
        if (tE === 0 || cE === 0 || tE === tN || cE === cN) { tE += 0.5; tN += 1; cE += 0.5; cN += 1; }
        const yi = Math.log((tE / tN) / (cE / cN));
        const v = 1 / tE - 1 / tN + 1 / cE - 1 / cN;
        if (!(v > 0)) return;
        rows.push({ trtA: cmp.t1, trtB: cmp.t2, yi: yi, sei: Math.sqrt(v), covariate: year });
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
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
    }
    // Any interaction slope whose 95% CI excludes 0 => effect modification by year.
    let anyMod = false;
    Object.keys(r.gamma).forEach(t => { const g = r.gamma[t]; if (g.ci_lo > 0 || g.ci_hi < 0) anyMod = true; });
    const tone = anyMod ? '#fbbf24' : '#34d399';
    const bg = anyMod ? '#3a2a0a' : '#0e3a1f';
    const bd = anyMod ? '#92400e' : '#34d399';
    const verdict = anyMod
      ? '⚠ Effect modification by year detected — at least one treatment × year interaction slope has a 95% CI excluding 0; the network treatment effects depend on study year, so a single pooled NMA estimate may mislead.'
      : '✓ No effect modification by year — every treatment × year interaction CI includes 0; the NMA treatment effects are stable across study year.';
    let html = '<div style="background:' + bg + ';border:1px solid ' + bd + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">' + verdict + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;">';
    html += cell('Reference', P.escapeHtml(r.reference), 'effects are vs this treatment');
    html += cell('Mean covariate (year)', fmt(r.xMean, 1), 'β reported at this year');
    html += cell('τ² (Paule-Mandel)', fmt(r.tau2, 4), 'residual heterogeneity · Q=' + fmt(r.Q, 2));
    html += '</div>';
    // Per-treatment table: RR at the mean year, interaction slope (per year), CI.
    let rowsHtml = '';
    r.treatments.slice(1).forEach(t => {
      const b = r.beta_at_mean[t], g = r.gamma[t];
      const modSig = (g.ci_lo > 0 || g.ci_hi < 0);
      rowsHtml += '<tr>'
        + '<td style="padding:4px 8px;color:#cbd5e1;">' + P.escapeHtml(t) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#f1f5f9;text-align:right;">' + fmt(Math.exp(b.estimate), 2) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(Math.exp(b.ci_lo), 2) + '–' + fmt(Math.exp(b.ci_hi), 2) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:' + (modSig ? '#fbbf24' : '#94a3b8') + ';text-align:right;">' + fmt(g.estimate, 4) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(g.ci_lo, 4) + '–' + fmt(g.ci_hi, 4) + '</td>'
        + '</tr>';
    });
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">'
      + '<thead><tr style="color:#94a3b8;text-transform:uppercase;font-size:9.5px;letter-spacing:0.04em;">'
      + '<th style="text-align:left;padding:4px 8px;">vs ref</th><th style="text-align:right;padding:4px 8px;">RR @ mean yr</th>'
      + '<th style="text-align:right;padding:4px 8px;">95% CI</th><th style="text-align:right;padding:4px 8px;">slope (logRR/yr)</th>'
      + '<th style="text-align:right;padding:4px 8px;">slope 95% CI</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
      + '<strong>Network meta-regression (Cooper et al. 2009; NICE DSU TSD 3):</strong> adds a treatment × covariate interaction '
      + '(here study year, centred at the mean) to the standard NMA, so each treatment effect is allowed to drift with the covariate. '
      + 'τ² by Paule-Mandel, β/γ by GLS — matches netmeta::netmetareg(assumption="independent"). A slope CI excluding 0 flags effect '
      + 'modification: the relative effect depends on year, so a single pooled NMA estimate averages over heterogeneous designs. '
      + 'Sensitivity alongside the consistency NMA, not a replacement.</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmNmaMetaReg) return false;
    if (!P.isNMA || !P.isNMA()) return false; // pairwise dashboard -> skip
    const cfg = global.NMA_CONFIG;
    const rd = P.getRealData();
    if (!cfg || !rd || !cfg.treatments || cfg.treatments.length < 2) return false;
    const rows = buildRows(cfg, rd);
    // Need n >= 2p (= 2*(K-1)) contrast rows with a finite year, and year variation.
    const p2 = 2 * (cfg.treatments.length - 1);
    if (rows.length < p2) return false;
    const years = rows.map(r => r.covariate);
    if (Math.max.apply(null, years) - Math.min.apply(null, years) < 1e-9) return false; // no covariate variation
    let r;
    try {
      r = global.AlmNmaMetaReg.fit(rows, cfg.treatments, {
        predictAt: [Math.min.apply(null, years), Math.max.apply(null, years)],
      });
    } catch (e) { return false; }
    if (!r || !r.ok || !isFinite(r.tau2)) return false;

    const t1 = r.treatments[1];
    const summary = 'network meta-regression on year · ref ' + r.reference
      + ' · RR(' + t1 + ')=' + P.fmt(Math.exp(r.beta_at_mean[t1].estimate), 2)
      + ' @ ' + P.fmt(r.xMean, 0) + ' · τ²=' + P.fmt(r.tau2, 3);
    const panel = P.buildCollapsiblePanel({
      id: 'nma-meta-regression-panel', badge: 'Network meta-regression', summary,
      bodyHtml: buildBody(P, r), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('nma-meta-regression-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1240));
    else setTimeout(tick, 1240);
  }

  global.NmaMetaRegPanel = { render, buildRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
