/* evalue-panel.js — E-value sensitivity to unmeasured confounding (VanderWeele & Ding 2017).
 *
 * Engine: AlmEValue.eValues (evalue.js, vendored verbatim from allmeta/shared;
 * verified vs the EValue R package to ~1e-6 — RR=2.0 [1.5,2.7] → E=3.414214,
 * CI 2.366025; OR=2.0 common → E=2.179580, CI 1.749392). The E-value is the
 * minimum strength of association (on the risk-ratio scale) that an unmeasured
 * confounder would need with BOTH the treatment and the outcome to fully explain
 * away the observed effect (point), or to shift the CI bound nearest the null to 1.
 *
 * AUTO-MOUNTS on the binary effect set: pools the trials to a random-effects OR
 * (the kit's PanelHelper RE-OR), maps the OR (common-outcome √OR per
 * VanderWeele-Ding) to an approximate RR, and reports the point and CI E-values.
 * An established robustness measure (Ann Intern Med 2017) — neutral badge, a
 * complement to the RE primary that quantifies confounding-robustness, especially
 * for observational pools (advanced-stats.md "Observational IV trap").
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'evalue-panel-expanded';

  function buildBody(P, ev, pooled) {
    const fmt = P.fmt;
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
    }
    const robust = ev.point >= 2;
    const tone = robust ? '#34d399' : '#fbbf24';
    const bg = robust ? '#0e3a1f' : '#3a2a0a';
    const bd = robust ? '#34d399' : '#92400e';
    const verdict = robust
      ? '✓ E-value = ' + fmt(ev.point, 2) + ' — an unmeasured confounder would need a risk-ratio association of ≥' + fmt(ev.point, 2)
        + ' with BOTH treatment and outcome to explain away the pooled effect; weaker confounding cannot.'
      : '⚠ E-value = ' + fmt(ev.point, 2) + ' — only a modest unmeasured confounder (RR ≈ ' + fmt(ev.point, 2)
        + ' on both arms) is needed to explain away the effect; the pooled estimate is confounding-fragile.';
    let html = '<div style="background:' + bg + ';border:1px solid ' + bd + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">' + verdict + '</div>';
    html += '<div style="background:#1e1b16;border:1px solid #92400e;color:#fbbf24;padding:7px 10px;border-radius:6px;margin-bottom:10px;font-size:10.5px;line-height:1.45;">⚠ Interpret only for OBSERVATIONAL evidence. If these are <strong>randomised</strong> trials, randomisation already balances unmeasured confounders, so the E-value is not informative about this pool — ignore it unless the included studies are non-randomised.</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;">';
    html += cell('E-value (point)', fmt(ev.point, 2), 'min confounder RR for the estimate');
    html += cell('E-value (CI bound)', fmt(ev.ci, 2), ev.ci <= 1.0001 ? 'CI crosses the null' : 'to shift the near-null bound to 1');
    html += cell('Pooled OR', fmt(pooled.OR, 2), '95% CI ' + fmt(pooled.ci_low, 2) + '–' + fmt(pooled.ci_high, 2));
    html += cell('Approx. RR (√OR)', fmt(ev.rr.point, 3), 'common-outcome map (VanderWeele-Ding)');
    html += '</div>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
      + '<strong>E-value (VanderWeele &amp; Ding 2017, Ann Intern Med 167:268-274):</strong> the minimum association '
      + '(risk-ratio scale) an unmeasured confounder would need with both the treatment and the outcome to fully explain '
      + 'away the observed effect (point), or to move the CI bound nearest the null to 1. Larger = more robust to '
      + 'unmeasured confounding. The pooled OR is mapped to an approximate RR via the common-outcome √OR rule; for a rare '
      + 'outcome OR≈RR. A robustness complement to the RE primary — most informative for observational pools.</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmEValue) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 2) return false;
    const pooled = P.poolRandomLogOR(trials);
    if (!pooled || !isFinite(pooled.OR)) return false;
    let ev;
    try { ev = global.AlmEValue.eValues('OR', pooled.OR, pooled.ci_low, pooled.ci_high, { rare: false }); }
    catch (e) { return false; }
    if (!ev || !isFinite(ev.point)) return false;

    const summary = 'E-value=' + P.fmt(ev.point, 2) + ' (point) · ' + P.fmt(ev.ci, 2)
      + ' (CI) · pooled OR ' + P.fmt(pooled.OR, 2);
    const panel = P.buildCollapsiblePanel({
      id: 'evalue-panel', badge: 'E-value (confounding)',
      summary, bodyHtml: buildBody(P, ev, pooled), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('evalue-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1190));
    else setTimeout(tick, 1190);
  }

  global.EValuePanel = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
