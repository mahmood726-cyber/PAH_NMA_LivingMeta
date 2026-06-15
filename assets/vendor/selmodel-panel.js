/* selmodel-panel.js — Vevea-Hedges (1995) step-function selection model as a
 * publication-bias sensitivity panel (complements Egger/trim-and-fill/PET-PEESE).
 *
 * Engine: AlmSelModel.fit (vendored verbatim from allmeta/shared/selmodel.js,
 * bit-checked vs metafor::selmodel type="stepfun"). Instead of imputing missing
 * studies (trim-and-fill) or regressing on precision (Egger/PET-PEESE), it models
 * the probability that a study is published as a step function of its one-sided
 * p-value, and re-estimates the mean under that selection.
 *
 * Reports the selection-adjusted OR vs the unadjusted RE OR, the estimated
 * selection weight δ₂ (relative publication odds of non-significant studies),
 * and the LRT for selection. SENSITIVITY ONLY; needs k≥4. Binary (log-OR).
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'selmodel-panel-expanded';

  function logORpoints(trials) {
    return trials.map(t => {
      let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
      if (ai === 0 || ci === 0 || ai === n1 || ci === n2) { ai += 0.5; ci += 0.5; n1 += 1; n2 += 1; }
      const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
      return { yi: Math.log((a * d) / (b * c)), vi: 1 / a + 1 / b + 1 / c + 1 / d };
    });
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
    const adjOR = Math.exp(r.mu), unadjOR = Math.exp(r.unadjusted.mu);
    const shift = unadjOR !== 0 ? (adjOR / unadjOR) : null;
    const sig = isFinite(r.LRTp) && r.LRTp < 0.10;
    let tone, toneBg, toneBorder, verdict;
    if (sig) {
      tone = '#fbbf24'; toneBg = '#3a2a0a'; toneBorder = '#92400e';
      verdict = '⚠ Selection detected (LRT p=' + fmt(r.LRTp, 3) + '). Adjusted OR ' + fmt(adjOR, 2)
        + ' vs unadjusted ' + fmt(unadjOR, 2) + ' — treat the unadjusted pool with caution.';
    } else {
      tone = '#34d399'; toneBg = '#0e3a1f'; toneBorder = '#34d399';
      verdict = '✓ No strong evidence of p-value-based selection (LRT p=' + fmt(r.LRTp, 3) + ').';
    }
    let html = '<div style="background:' + toneBg + ';border:1px solid ' + toneBorder + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">' + verdict + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-bottom:12px;">';
    html += cell('Selection-adjusted OR', fmt(adjOR, 2), '±SE(logOR) ' + fmt(r.se, 3));
    html += cell('Unadjusted RE OR', fmt(unadjOR, 2), 'τ² = ' + fmt(r.unadjusted.tau2, 4));
    html += cell('δ₂ (relative pub. odds, p≥0.025)', fmt(r.delta[1], 3), r.delta[1] < 1 ? 'non-sig under-published' : '≈ no selection');
    html += cell('LRT for selection', 'χ²=' + fmt(r.LRT, 2), 'df=' + r.LRTdf + ', p=' + fmt(r.LRTp, 3));
    if (shift) html += cell('Adjusted ÷ unadjusted OR', fmt(shift, 2) + '×', shift < 1 ? 'effect attenuates' : 'effect grows');
    html += '</div>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
      + '<strong>Vevea-Hedges step model (1995):</strong> maximum-likelihood fit of the unadjusted mean μ, between-study τ², '
      + 'and a selection weight δ for the p≥0.025 interval (δ₁≡1 for significant studies). δ₂&lt;1 means non-significant studies are '
      + 'less likely to be published; the adjusted OR removes that selection. The LRT compares the selection fit to the unadjusted ML. '
      + 'Single-cutpoint (0.025), one-sided. SENSITIVITY only and low-powered at small k — corroborate with Egger / trim-and-fill / PET-PEESE, '
      + 'never headline the adjusted estimate (advanced-stats.md).</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmSelModel) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 4) return false; // selection model is unstable below k=4
    const pts = logORpoints(trials);
    let r;
    try { r = global.AlmSelModel.fit(pts.map(p => p.yi), pts.map(p => p.vi), { steps: [0.025] }); }
    catch (e) { return false; }
    if (!r || !isFinite(r.mu) || !isFinite(r.se)) return false;

    const sig = isFinite(r.LRTp) && r.LRTp < 0.10;
    const summary = (sig ? '⚠ selection (p=' + P.fmt(r.LRTp, 3) + ')' : '✓ no selection (p=' + P.fmt(r.LRTp, 3) + ')')
      + ' · adj OR ' + P.fmt(Math.exp(r.mu), 2) + ' vs ' + P.fmt(Math.exp(r.unadjusted.mu), 2);
    const panel = P.buildCollapsiblePanel({
      id: 'selmodel-panel', badge: 'Vevea-Hedges selection', summary,
      bodyHtml: buildBody(P, r), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('selmodel-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1010));
    else setTimeout(tick, 1010);
  }

  global.SelModelPanel = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
