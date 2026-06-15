/* limit-ma-panel.js — Rücker (2011) limit meta-analysis as a small-study-effect
 * sensitivity panel.
 *
 * Engine: AlmLimitMA.limitMA (extracted verbatim from allmeta/limit-ma, verified
 * vs metasens::limitmeta to 1e-12). Reports the limit-adjusted ("shrunken")
 * estimate — what the pooled effect converges to as studies become infinitely
 * precise — alongside the RE primary, plus the slope (small-study-effect
 * direction) and G² (proportion of heterogeneity from small-study effects).
 *
 * SENSITIVITY only (advanced-stats.md); binary outcomes (log-OR), k≥3.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'limit-ma-panel-expanded';

  function logORrows(trials) {
    return trials.map(t => {
      let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
      if (ai === 0 || ci === 0 || ai === n1 || ci === n2) { ai += 0.5; ci += 0.5; n1 += 1; n2 += 1; }
      const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
      return { te: Math.log((a * d) / (b * c)), se: Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d) };
    });
  }

  function buildBody(P, r, re) {
    const fmt = P.fmt;
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
    }
    const adjOR = Math.exp(r.limit), reOR = re ? re.OR : null;
    const zc = 1.959963984540054;
    const strong = r.G_squared > 0.5 && Math.abs(r.beta_r) > 0;
    const tone = strong ? '#fbbf24' : '#34d399';
    const bg = strong ? '#3a2a0a' : '#0e3a1f';
    const bd = strong ? '#92400e' : '#34d399';
    const verdict = strong
      ? '⚠ G² = ' + fmt(100 * r.G_squared, 0) + '% of heterogeneity attributable to small-study effects; the limit estimate (OR ' + fmt(adjOR, 2) + ') differs from RE.'
      : '✓ Limited small-study-effect signal (G² = ' + fmt(100 * r.G_squared, 0) + '%).';
    let html = '<div style="background:' + bg + ';border:1px solid ' + bd + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">' + verdict + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:12px;">';
    html += cell('Limit-adjusted OR', fmt(adjOR, 2), '95% CI ' + fmt(Math.exp(r.limit - zc * r.seLimit), 2) + '–' + fmt(Math.exp(r.limit + zc * r.seLimit), 2));
    if (reOR) html += cell('Random-effects OR', fmt(reOR, 2), '95% CI ' + fmt(re.ci_low, 2) + '–' + fmt(re.ci_high, 2));
    html += cell('Radial slope β', fmt(r.beta_r, 3), r.beta_r > 0 ? 'small-study effect present' : 'no positive slope');
    html += cell('G² (small-study share)', fmt(r.G_squared, 3), 'Q_small = ' + fmt(r.Q_small, 2) + ' / Q = ' + fmt(r.Q, 2));
    html += '</div>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
      + '<strong>Limit meta-analysis (Rücker 2011, metasens::limitmeta):</strong> shrinks each study toward the radial-regression line and '
      + 're-pools, giving the effect the synthesis would converge to with infinitely precise studies. The β slope gives the small-study-effect '
      + 'direction; G² the share of heterogeneity it explains. A bias-adjusted SENSITIVITY estimate — report beside the RE primary, not instead of it.</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmLimitMA) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 3) return false;
    const rows = logORrows(trials);
    let r;
    try { r = global.AlmLimitMA.limitMA(rows); } catch (e) { return false; }
    if (!r || !isFinite(r.limit) || !isFinite(r.seLimit)) return false;
    const re = P.poolRandomLogOR(trials);

    const summary = 'limit OR ' + P.fmt(Math.exp(r.limit), 2)
      + (re ? ' vs RE ' + P.fmt(re.OR, 2) : '') + ' · G²=' + P.fmt(r.G_squared, 2) + ' · β=' + P.fmt(r.beta_r, 2);
    const panel = P.buildCollapsiblePanel({
      id: 'limit-ma-panel', badge: 'Limit meta-analysis', summary,
      bodyHtml: buildBody(P, r, re), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('limit-ma-panel');
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

  global.LimitMAPanel = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
