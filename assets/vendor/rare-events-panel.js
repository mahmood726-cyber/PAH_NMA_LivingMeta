/* rare-events-panel.js — binomial-normal GLMM for rare-event OR, the
 * recommended alternative to the +0.5 continuity correction (which biases the
 * pooled OR toward the null when events are sparse — advanced-stats.md
 * "Zero cells").
 *
 * Engine: AlmRareEventsGLMM (vendored verbatim from allmeta/shared/rare-events-glmm.js,
 * verified vs metafor::rma.glmm). Two fits are shown:
 *   - CM.EL (conditional exact, Fisher noncentral hypergeometric): conditions on
 *     each study's event margin, so 0-event arms need NO continuity correction at all.
 *   - Standard +0.5 DL random-effects OR (PanelHelper.poolRandomLogOR) for contrast.
 *
 * Only mounts when ≥1 study has a zero cell (where the correction actually
 * bites) and k≥2. Binary outcomes.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'rare-events-panel-expanded';

  function hasZeroCell(trials) {
    return trials.some(t => t.ai === 0 || t.ci === 0 || t.ai === t.n1i || t.ci === t.n2i);
  }

  function buildBody(P, glmm, re, nZero) {
    const fmt = P.fmt;
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
        + '</div>';
    }
    let html = '<div style="background:#1a2436;border:1px solid #334155;color:#cbd5e1;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
      + '<strong>' + nZero + ' study(ies) with a zero cell.</strong> The GLMM handles these natively; '
      + 'the +0.5 correction (shown for contrast) pulls the OR toward 1.</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:12px;">';
    html += cell('GLMM OR (CM.EL, exact)',
      fmt(glmm.OR, 2),
      '95% CI ' + fmt(glmm.OR_lo, 2) + '–' + fmt(glmm.OR_hi, 2) + ' · no continuity corr.');
    if (re) {
      const towardNull = Math.abs(Math.log(re.OR)) < Math.abs(Math.log(glmm.OR));
      html += cell('+0.5-corrected RE OR',
        fmt(re.OR, 2),
        '95% CI ' + fmt(re.ci_low, 2) + '–' + fmt(re.ci_high, 2) + (towardNull ? ' · biased toward 1' : ''));
    }
    html += cell('τ² (GLMM)', fmt(glmm.tau2, 4), 'between-study heterogeneity');
    html += cell('Zero-cell studies', String(glmm.n_zero_cell_studies), 'of k = ' + glmm.k);
    html += '</div>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
      + '<strong>CM.EL (Stijnen et al. 2010):</strong> the conditional-exact binomial-normal GLMM. Conditioning on each study’s '
      + 'total event count eliminates the nuisance baseline rate entirely, so zero-event arms contribute with no +0.5 fudge. '
      + 'The treatment-arm count follows Fisher’s noncentral hypergeometric law with OR ψ=exp(θ+u), u~N(0,τ²), integrated by '
      + 'adaptive Gauss-Hermite quadrature. This is the preferred rare-event estimator; the +0.5-corrected DL pool is shown only to '
      + 'expose the toward-the-null bias the correction introduces.</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmRareEventsGLMM) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 2) return false;
    const nZero = trials.filter(t => t.ai === 0 || t.ci === 0 || t.ai === t.n1i || t.ci === t.n2i).length;
    if (nZero === 0) return false; // GLMM only adds value when a correction would otherwise bite

    const rows = trials.map(t => ({ events_T: t.ai, n_T: t.n1i, events_C: t.ci, n_C: t.n2i }));
    let glmm = global.AlmRareEventsGLMM.fitConditionalExact(rows);
    if (!glmm || !glmm.ok) glmm = global.AlmRareEventsGLMM.fit(rows); // CM.EL → conditional approx fallback
    if (!glmm || !glmm.ok || !isFinite(glmm.OR)) return false;
    const re = P.poolRandomLogOR(trials);

    const summary = 'GLMM OR ' + P.fmt(glmm.OR, 2)
      + ' [' + P.fmt(glmm.OR_lo, 2) + '–' + P.fmt(glmm.OR_hi, 2) + ']'
      + (re ? ' vs +0.5 ' + P.fmt(re.OR, 2) : '') + ' · ' + nZero + ' zero-cell';
    const panel = P.buildCollapsiblePanel({
      id: 'rare-events-panel', badge: 'Rare-events GLMM', summary,
      bodyHtml: buildBody(P, glmm, re, nZero), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('rare-events-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1040));
    else setTimeout(tick, 1040);
  }

  global.RareEventsPanel = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
