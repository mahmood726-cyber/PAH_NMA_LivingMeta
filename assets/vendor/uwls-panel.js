/* uwls-panel.js — UWLS / multiplicative-heterogeneity pool as a sensitivity
 * alternative to the random-effects (additive-τ²) primary.
 *
 * Engine: AlmUWLS.uwls (vendored verbatim from allmeta/shared/uwls.js, verified
 * vs R lm(yi~1, weights=1/vi)). Point estimate = fixed-effect IV mean; SE =
 * FE-SE × √φ with φ = Q/(k−1); t_{k−1} CI (via the AlmMaCore shim).
 *
 * Why surface it (advanced-stats.md "Observational IV trap"): for observational
 * meta-analyses, inverse-variance random-effects weights amplify SE-manipulation
 * by primary modellers (Stanley 2025) — UWLS / multiplicative heterogeneity is
 * the recommended primary there, with additive RE as the sensitivity. We show it
 * as a SENSITIVITY comparison, not a replacement, and label it so.
 *
 * Auto-bootstrap; collapsed by default. Binary outcomes (log-OR scale).
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'uwls-panel-expanded';

  function logORpoints(trials) {
    return trials.map(t => {
      let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
      if (ai === 0 || ci === 0 || ai === n1 || ci === n2) { ai += 0.5; ci += 0.5; n1 += 1; n2 += 1; }
      const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
      return { yi: Math.log((a * d) / (b * c)), vi: 1 / a + 1 / b + 1 / c + 1 / d };
    });
  }

  function buildBody(P, uw, re) {
    const fmt = P.fmt;
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
        + '</div>';
    }
    let html = '';
    const widerRatio = (re && uw.se > 0) ? (uw.se / re.se) : null;
    const note = uw.phi > 1.5
      ? '⚠ φ = ' + fmt(uw.phi, 2) + ' (substantial overdispersion); UWLS widens the CI vs random-effects.'
      : 'φ = ' + fmt(uw.phi, 2) + ' (modest overdispersion); UWLS ≈ random-effects here.';
    html += '<div style="background:#1a2436;border:1px solid #334155;color:#cbd5e1;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
      + '<strong>Sensitivity only.</strong> ' + note + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-bottom:12px;">';
    html += cell('UWLS OR (multiplicative)',
      fmt(Math.exp(uw.mu), 2),
      't' + uw.df + ' 95% CI ' + fmt(Math.exp(uw.ciLo), 2) + '–' + fmt(Math.exp(uw.ciHi), 2));
    if (re) {
      html += cell('Random-effects OR (additive τ²)',
        fmt(re.OR, 2),
        '95% CI ' + fmt(re.ci_low, 2) + '–' + fmt(re.ci_high, 2));
    }
    html += cell('Overdispersion φ = Q/(k−1)', fmt(uw.phi, 3), 'Q = ' + fmt(uw.Q, 2) + ', k = ' + uw.k);
    if (widerRatio) html += cell('UWLS SE ÷ RE SE', fmt(widerRatio, 2) + '×', widerRatio > 1 ? 'UWLS more conservative' : 'UWLS narrower');
    html += '</div>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
      + '<strong>UWLS (Stanley & Doucouliagos 2015):</strong> point estimate equals the fixed-effect inverse-variance mean; '
      + 'the SE is inflated by a single multiplicative factor √φ (φ = Q/(k−1)) rather than by adding a between-study variance τ². '
      + 'Equivalent to lm(y ~ 1, weights = 1/v) with t<sub>k−1</sub> intervals. For observational syntheses, advanced-stats.md '
      + 'prefers UWLS/sample-size weighting as primary (IV-RE only as sensitivity) because RE weights amplify SE-manipulation by primary modellers. '
      + 'Here it is the sensitivity check against the RE primary.</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmUWLS) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 2) return false;
    const pts = logORpoints(trials);
    const uw = global.AlmUWLS.uwls(pts.map(p => p.yi), pts.map(p => p.vi), { level: 0.95 });
    if (!uw) return false;
    const re = P.poolRandomLogOR(trials);

    const summary = 'UWLS OR ' + P.fmt(Math.exp(uw.mu), 2)
      + ' [' + P.fmt(Math.exp(uw.ciLo), 2) + '–' + P.fmt(Math.exp(uw.ciHi), 2) + '] · φ=' + P.fmt(uw.phi, 2);
    const panel = P.buildCollapsiblePanel({
      id: 'uwls-panel', badge: 'UWLS (multiplicative)', summary,
      bodyHtml: buildBody(P, uw, re), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('uwls-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 980));
    else setTimeout(tick, 980);
  }

  global.UWLSPanel = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
