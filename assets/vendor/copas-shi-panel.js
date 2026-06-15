/* copas-shi-panel.js — Copas & Shi (2000) selection-model profile MLE as a
 * publication-bias sensitivity panel.
 *
 * Engine: AlmCopas.sensitivity (copas-shi.js, extracted verbatim from
 * allmeta/copas and validated vs metasens::copas to ~1e-4 on effect/ρ/τ;
 * reproduces copas-oracle.json). This is the REAL Copas-Shi MLE — distinct
 * from, and the validated replacement for, the kit's exploratory heuristic
 * Copas ρ-sweep (chart #13). Each row is a full profile MLE over (effect, ρ, τ)
 * along a reproducible publication-probability path: the largest-SE study's
 * assumed publication probability is swept down while the most-precise study is
 * held ~always-published.
 *
 * SENSITIVITY only (advanced-stats.md); binary outcomes (log-OR), k≥3. Copas
 * needs k ≥ 15 for stable estimation — k<15 output is flagged illustrative.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'copas-shi-panel-expanded';
  const Z = 1.959963984540054;

  function logORrows(trials) {
    return trials.map(t => {
      let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
      if (ai === 0 || ci === 0 || ai === n1 || ci === n2) { ai += 0.5; ci += 0.5; n1 += 1; n2 += 1; }
      const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
      return { te: Math.log((a * d) / (b * c)), se: Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d) };
    });
  }

  function buildBody(P, res, fe_OR) {
    const fmt = P.fmt;
    const grid = res.grid;
    const unadjOR = Math.exp(res.fe_pooled);
    // Most-adjusted point = lowest publprob (most pessimistic selection).
    const lastOR = Math.exp(grid[grid.length - 1].te_adj);
    const shiftPct = Math.abs(lastOR - unadjOR) / unadjOR * 100;
    const sensitive = shiftPct > 10;
    const tone = sensitive ? '#fbbf24' : '#34d399';
    const bg = sensitive ? '#3a2a0a' : '#0e3a1f';
    const bd = sensitive ? '#92400e' : '#34d399';
    const verdict = sensitive
      ? '⚠ Under a pessimistic selection model (30% of largest-SE studies unpublished) the adjusted OR moves to '
        + fmt(lastOR, 2) + ' (' + fmt(shiftPct, 0) + '% from the unadjusted ' + fmt(unadjOR, 2) + ') — finding is sensitive to publication bias.'
      : '✓ Adjusted OR stays near the unadjusted ' + fmt(unadjOR, 2) + ' across the selection path (max shift '
        + fmt(shiftPct, 0) + '%) — robust to Copas-modelled publication bias.';

    let html = '<div style="background:' + bg + ';border:1px solid ' + bd + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">' + verdict + '</div>';

    if (res.k < 15) {
      html += '<div style="background:#1e1b16;border:1px solid #92400e;color:#fbbf24;padding:6px 9px;border-radius:6px;margin-bottom:10px;font-size:10.5px;">'
        + 'k = ' + res.k + ' — Copas selection models need k ≥ 15 for stable estimation (advanced-stats.md). Treat this sensitivity curve as illustrative, not inferential.</div>';
    }

    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
    html += '<thead><tr style="border-bottom:1px solid #334155;color:#94a3b8;font-weight:600;">'
      + '<th style="text-align:left;padding:4px 8px;">Publ. prob (largest-SE)</th>'
      + '<th style="text-align:right;padding:4px 8px;">Adjusted OR</th>'
      + '<th style="text-align:right;padding:4px 8px;">95% CI</th>'
      + '<th style="text-align:right;padding:4px 8px;">ρ</th>'
      + '<th style="text-align:right;padding:4px 8px;">Est. unpubl.</th></tr></thead><tbody>';
    grid.forEach(g => {
      const or = Math.exp(g.te_adj), lo = Math.exp(g.lo), hi = Math.exp(g.hi);
      html += '<tr style="border-bottom:1px solid #1e293b;">'
        + '<td style="padding:4px 8px;">' + fmt(g.publprob, 2) + '</td>'
        + '<td style="padding:4px 8px;text-align:right;font-family:JetBrains Mono,monospace;color:#f1f5f9;font-weight:600;">' + fmt(or, 2) + '</td>'
        + '<td style="padding:4px 8px;text-align:right;font-family:JetBrains Mono,monospace;">' + fmt(lo, 2) + '–' + fmt(hi, 2) + '</td>'
        + '<td style="padding:4px 8px;text-align:right;font-family:JetBrains Mono,monospace;">' + (isFinite(g.rho) ? fmt(g.rho, 2) : '—') + '</td>'
        + '<td style="padding:4px 8px;text-align:right;font-family:JetBrains Mono,monospace;">' + fmt(g.n_unpubl, 1) + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:8px;">'
      + '<strong>Copas–Shi profile MLE (metasens::copas):</strong> the full selection-model maximum likelihood, '
      + 'not the kit\'s exploratory heuristic ρ-sweep (chart #13). Each row maximises the Copas log-likelihood over '
      + '(effect, ρ, τ) at a fixed publication-probability path point; ρ is the correlation between a study\'s effect and '
      + 'its probability of being published. A bias-adjusted SENSITIVITY estimate — report beside the primary, not instead of it.</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmCopas) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 3) return false;
    const rows = logORrows(trials);
    let res;
    try { res = global.AlmCopas.sensitivity(rows); } catch (e) { return false; }
    if (!res || !res.available || !res.grid.length || !isFinite(res.fe_pooled)) return false;

    const unadjOR = Math.exp(res.fe_pooled);
    const lastOR = Math.exp(res.grid[res.grid.length - 1].te_adj);
    const summary = 'Copas-adjusted OR ' + P.fmt(unadjOR, 2) + ' → ' + P.fmt(lastOR, 2)
      + ' across publ-prob path (k=' + res.k + ')';
    const panel = P.buildCollapsiblePanel({
      id: 'copas-shi-panel', badge: 'Copas–Shi selection MLE', summary,
      bodyHtml: buildBody(P, res, unadjOR), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('copas-shi-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1160));
    else setTimeout(tick, 1160);
  }

  global.CopasShiPanel = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
