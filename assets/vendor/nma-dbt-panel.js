/* nma-dbt-panel.js — design-by-treatment interaction global inconsistency test
 * for NMA (Higgins 2012). The single global test that complements the kit's
 * per-comparison node-splitting (nma-consistency.js).
 *
 * Engine: AlmNmaDBT.dbt / fitNMA (extracted verbatim from
 * allmeta/nma-inconsistency; fitNMA matches netmeta consistency Q/TE exactly,
 * chiSqCDF matches R pchisq). Builds per-trial contrast rows from NMA_CONFIG
 * (log-RR), estimates τ² (DL) for an RE-weighted test, and reports Q_inc, df, p.
 *
 * NMA dashboards only — self-skips on pairwise dashboards and reports cleanly
 * when the network has no closed loop (test unidentifiable).
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'nma-dbt-panel-expanded';

  // Per-trial contrast rows {A,B,te,se} on the log-RR scale from NMA_CONFIG.
  function buildRows(cfg, rd) {
    const rows = [];
    (cfg.comparisons || []).forEach(cmp => {
      (cmp.trials || []).forEach(nct => {
        const t = rd[nct];
        if (!t) return;
        let tE = +t.tE, tN = +t.tN, cE = +t.cE, cN = +t.cN;
        if (!(isFinite(tE) && isFinite(tN) && isFinite(cE) && isFinite(cN) && tN > 0 && cN > 0)) return;
        if (tE === 0 || cE === 0 || tE === tN || cE === cN) { tE += 0.5; tN += 1; cE += 0.5; cN += 1; }
        const te = Math.log((tE / tN) / (cE / cN));
        const v = 1 / tE - 1 / tN + 1 / cE - 1 / cN;
        if (!(v > 0)) return;
        rows.push({ A: cmp.t1, B: cmp.t2, te: te, se: Math.sqrt(v) });
      });
    });
    return rows;
  }

  function buildBody(P, fe, re, tau2) {
    const fmt = P.fmt;
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
    }
    if (fe && fe.note) {
      return '<div style="background:#1a2436;border:1px solid #334155;color:#cbd5e1;padding:8px 10px;border-radius:6px;font-size:11.5px;">'
        + 'Global inconsistency test not identifiable: ' + P.escapeHtml(fe.note) + ' A star network (every comparison shares a common reference, no closed loop) has no inconsistency to test.</div>';
    }
    const sig = isFinite(fe.p) && fe.p < 0.05;
    const tone = sig ? '#fca5a5' : '#34d399';
    const bg = sig ? '#3a0a0a' : '#0e3a1f';
    const bd = sig ? '#7f1d1d' : '#34d399';
    const verdict = sig
      ? '⚠ Global inconsistency detected (FE p=' + fmt(fe.p, 3) + '): direct and indirect evidence disagree somewhere in the network. Interpret the NMA with caution and inspect node-splitting.'
      : '✓ No global inconsistency (FE p=' + fmt(fe.p, 3) + '): direct and indirect evidence are compatible across the network.';
    let html = '<div style="background:' + bg + ';border:1px solid ' + bd + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">' + verdict + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;">';
    html += cell('Q_inc (fixed-effect)', fmt(fe.Q, 3), 'df = ' + fe.df + ', χ² p = ' + fmt(fe.p, 3));
    if (re) html += cell('Q_inc (random-effects)', fmt(re.Q, 3), 'df = ' + re.df + ', p = ' + fmt(re.p, 3) + ' · τ²(DL)=' + fmt(tau2, 4));
    html += '</div>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
      + '<strong>Design-by-treatment interaction model (Higgins et al. 2012):</strong> compares the consistency model (basic contrasts only) with a full model that '
      + 'gives each design its own contrast; Q_cons − Q_full ~ χ² tests whether ANY inconsistency exists in the network — the single global complement to per-loop '
      + 'node-splitting. p&lt;0.05 ⇒ inconsistency present somewhere; follow up with node-splitting to localise it. The RE column uses DL τ²-inflated weights.</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmNmaDBT) return false;
    if (!P.isNMA || !P.isNMA()) return false;
    const cfg = global.NMA_CONFIG;
    const rd = P.getRealData();
    if (!cfg || !rd || !cfg.treatments || cfg.treatments.length < 2) return false;
    const rows = buildRows(cfg, rd);
    if (rows.length < 3) return false;
    let fe, re, tau2;
    try {
      fe = global.AlmNmaDBT.dbt(rows, 0);
      tau2 = global.AlmNmaDBT.estimateTau2(rows, 'DL');
      re = tau2 > 0 ? global.AlmNmaDBT.dbt(rows, tau2) : null;
    } catch (e) { return false; }
    if (!fe) return false;

    const summary = fe.note
      ? 'global inconsistency: not identifiable (star network)'
      : 'global inconsistency Q=' + P.fmt(fe.Q, 2) + ' df=' + fe.df + ' · p=' + P.fmt(fe.p, 3) + (isFinite(fe.p) && fe.p < 0.05 ? ' ⚠' : ' ✓');
    const panel = P.buildCollapsiblePanel({
      id: 'nma-dbt-panel', badge: 'Design-by-treatment', summary,
      bodyHtml: buildBody(P, fe, re, tau2), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('nma-dbt-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1220));
    else setTimeout(tick, 1220);
  }

  global.NmaDBTPanel = { render, buildRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
