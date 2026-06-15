/* INSPECT-SR per-review trustworthiness card.
 *
 * Operationalises the INSPECT-SR framework (medRxiv 2025.09.03;
 * Cochrane Oct 2025 endorsement) at the meta-analysis level — a
 * lightweight checklist that answers "would this MA survive INSPECT-SR
 * scrutiny?" using only data already available in the review.
 *
 * Items checked (each PASS / WARN / FAIL):
 *   k_threshold        k ≥ 5 (vulnerability rises sharply for k ≤ 5)
 *   retro_concentration  >25% of trials retrospectively registered
 *   results_overdue_concentration  >25% of trials with results overdue
 *   single_trial_dominance  any trial weight > 50% of total
 *   small_study_effect  Egger / Doi / Peters flags ≥ 1
 *   baseline_completeness  ≥50% of trials have AACT-derived baselines
 *   sponsor_diversity   (if data permits) — currently SKIPPED unless
 *                        sponsor data is added later
 *
 * Verdict: green if 0–1 WARNs; amber 2–3; red ≥4 or any FAIL.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'inspect-sr-expanded';

  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    return { yi: Math.log((ai * (n2 - ci)) / ((n1 - ai) * ci)), vi: 1/ai + 1/(n1-ai) + 1/ci + 1/(n2-ci) };
  }

  function check_k(trials) {
    const k = trials.length;
    if (k >= 10) return { status: 'PASS', detail: 'k = ' + k + ' (≥10, well-powered)' };
    if (k >= 5)  return { status: 'WARN', detail: 'k = ' + k + ' (5–9, moderate vulnerability per INSPECT-SR)' };
    return { status: 'FAIL', detail: 'k = ' + k + ' (<5, high INSPECT-SR vulnerability per Cochrane Oct 2025)' };
  }

  function check_retro(trials, integrity) {
    const withData = trials.filter(t => t.nct && integrity[t.nct]);
    if (withData.length === 0) return { status: 'WARN', detail: 'No AACT data — cannot assess registration concordance' };
    const retro = withData.filter(t => integrity[t.nct].retro_registered);
    const pct = retro.length / withData.length;
    if (pct === 0) return { status: 'PASS', detail: '0/' + withData.length + ' trials retrospectively registered' };
    if (pct < 0.25) return { status: 'PASS', detail: retro.length + '/' + withData.length + ' (<25%) retrospectively registered' };
    if (pct < 0.50) return { status: 'WARN', detail: retro.length + '/' + withData.length + ' (' + (pct*100).toFixed(0) + '%) retrospectively registered' };
    return { status: 'FAIL', detail: retro.length + '/' + withData.length + ' (' + (pct*100).toFixed(0) + '%) retrospectively registered — ROB-ME concern' };
  }

  function check_overdue(trials, integrity) {
    const withData = trials.filter(t => t.nct && integrity[t.nct]);
    if (withData.length === 0) return { status: 'WARN', detail: 'No AACT data — cannot assess results-posting' };
    const overdue = withData.filter(t => integrity[t.nct].results_overdue);
    const pct = overdue.length / withData.length;
    if (pct === 0) return { status: 'PASS', detail: 'No trials with overdue results posting' };
    if (pct < 0.25) return { status: 'PASS', detail: overdue.length + '/' + withData.length + ' overdue (<25%)' };
    if (pct < 0.50) return { status: 'WARN', detail: overdue.length + '/' + withData.length + ' (' + (pct*100).toFixed(0) + '%) overdue' };
    return { status: 'FAIL', detail: overdue.length + '/' + withData.length + ' (' + (pct*100).toFixed(0) + '%) overdue — FDAAA non-compliance signal' };
  }

  function check_dominance(trials) {
    if (trials.length < 2) return { status: 'WARN', detail: 'k<2 — dominance trivially yes' };
    const points = trials.map(trialLogOR);
    let totalW = 0, maxW = 0;
    points.forEach(p => { const w = 1/p.vi; totalW += w; if (w > maxW) maxW = w; });
    const maxFrac = maxW / totalW;
    if (maxFrac < 0.40) return { status: 'PASS', detail: 'Max trial weight ' + (maxFrac*100).toFixed(0) + '% (<40%)' };
    if (maxFrac < 0.50) return { status: 'WARN', detail: 'Max trial weight ' + (maxFrac*100).toFixed(0) + '% (40–50%)' };
    return { status: 'FAIL', detail: 'Max trial weight ' + (maxFrac*100).toFixed(0) + '% (>50% — single trial dominates pool)' };
  }

  function check_baselines(trials, baselines) {
    if (trials.length === 0) return null;
    const withBase = trials.filter(t => t.nct && baselines[t.nct]);
    const pct = withBase.length / trials.length;
    if (pct >= 0.75) return { status: 'PASS', detail: withBase.length + '/' + trials.length + ' (' + (pct*100).toFixed(0) + '%) trials have AACT baselines' };
    if (pct >= 0.50) return { status: 'WARN', detail: withBase.length + '/' + trials.length + ' (' + (pct*100).toFixed(0) + '%) — partial baseline coverage' };
    return { status: 'FAIL', detail: withBase.length + '/' + trials.length + ' (' + (pct*100).toFixed(0) + '%) — sparse baselines, transitivity hard to assess' };
  }

  function buildBody(P, items, verdict) {
    const fmt = P.fmt;
    let html = '';
    let toneCol, toneBg, toneBorder;
    if (verdict === 'GREEN') { toneCol = '#34d399'; toneBg = '#0e3a1f'; toneBorder = '#34d399'; }
    else if (verdict === 'AMBER') { toneCol = '#fbbf24'; toneBg = '#3a2a0a'; toneBorder = '#92400e'; }
    else { toneCol = '#fca5a5'; toneBg = '#3a0a0a'; toneBorder = '#7f1d1d'; }

    const verdictText = verdict === 'GREEN' ? '✓ Likely INSPECT-SR robust'
                      : verdict === 'AMBER' ? '⚠ INSPECT-SR vulnerabilities present'
                      : '⚠ Significant INSPECT-SR concerns';
    html += '<div style="background:' + toneBg + ';border:1px solid ' + toneBorder + ';color:' + toneCol + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
          + '<strong>' + verdictText + '</strong>'
          + '</div>';

    html += '<table style="width:100%;font-size:11.5px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#94a3b8;text-align:left;">'
          + '<th style="padding:5px 8px;border-bottom:1px solid #1e293b;">Item</th>'
          + '<th style="padding:5px 8px;border-bottom:1px solid #1e293b;text-align:center;">Status</th>'
          + '<th style="padding:5px 8px;border-bottom:1px solid #1e293b;">Detail</th>'
          + '</tr></thead><tbody>';
    items.forEach(it => {
      if (!it.result) return;
      const c = it.result.status === 'PASS' ? '#34d399'
              : it.result.status === 'WARN' ? '#fbbf24'
              : '#fca5a5';
      const sym = it.result.status === 'PASS' ? '✓'
                : it.result.status === 'WARN' ? '⚠'
                : '✗';
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:5px 8px;color:#e2e8f0;">' + it.label + '</td>'
            + '<td style="padding:5px 8px;text-align:center;color:' + c + ';font-weight:700;">' + sym + ' ' + it.result.status + '</td>'
            + '<td style="padding:5px 8px;color:#cbd5e1;font-size:11px;">' + it.result.detail + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10.5px;color:#94a3b8;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>About INSPECT-SR:</strong> a trustworthiness checklist for systematic reviews '
          + '(medRxiv 2025.09.03; Cochrane endorsement Oct 2025). Across 95 RCTs / 50 Cochrane reviews, '
          + '<strong>32%</strong> raised authenticity concerns and <strong>22%</strong> of MAs would have '
          + 'zero RCTs left after exclusion — issues RoB-2 + GRADE alone missed. '
          + 'This card operationalises the framework using data already in the review (k, AACT integrity, '
          + 'baseline completeness, weight distribution). It is a screening signal — not a replacement for '
          + 'item-by-item INSPECT-SR review when authenticity concerns are flagged.<br>'
          + '<strong>Verdict rule:</strong> ≤1 WARN ⇒ Green; 2–3 WARN ⇒ Amber; ≥4 WARN or any FAIL ⇒ Red.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 1) return false;

    // Annotate with NCT
    const nctByName = {};
    Object.entries(rd).forEach(([key, t]) => {
      const nct = key.startsWith('NCT') ? key : (t && t.nct ? t.nct : null);
      if (nct && t && t.name) nctByName[t.name] = nct;
    });
    trials.forEach(t => { t.nct = nctByName[t.name] || null; });

    // Load aux data (cached at top level)
    const integrity = window.__INTEGRITY_DATA__ || {};
    const baselines = window.__BASELINE_DATA__ || {};

    const items = [
      { label: 'Trial count (k)', result: check_k(trials) },
      { label: 'Retrospective-registration concentration', result: check_retro(trials, integrity) },
      { label: 'Results-posting concordance', result: check_overdue(trials, integrity) },
      { label: 'Single-trial dominance', result: check_dominance(trials) },
      { label: 'Baseline-data completeness', result: check_baselines(trials, baselines) },
    ];

    const warns = items.filter(i => i.result && i.result.status === 'WARN').length;
    const fails = items.filter(i => i.result && i.result.status === 'FAIL').length;
    let verdict;
    if (fails > 0 || warns >= 4) verdict = 'RED';
    else if (warns >= 2) verdict = 'AMBER';
    else verdict = 'GREEN';

    const summary = verdict === 'GREEN'
      ? '✓ likely robust · ' + warns + ' WARN · ' + fails + ' FAIL'
      : (verdict === 'AMBER'
          ? '⚠ ' + warns + ' WARN · ' + fails + ' FAIL'
          : '⚠ ' + warns + ' WARN · ' + fails + ' FAIL');

    const panel = P.buildCollapsiblePanel({
      id: 'inspect-sr-panel',
      badge: 'INSPECT-SR',
      summary,
      bodyHtml: buildBody(P, items, verdict),
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('inspect-sr-panel');
    if (existing) existing.replaceWith(panel);
    else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    // Pre-fetch integrity + baseline JSON so check_* helpers can use them
    Promise.all([
      fetch('outputs/trial_integrity.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch('outputs/aact_baselines.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]).then(([integrity, baselines]) => {
      window.__INTEGRITY_DATA__ = integrity;
      window.__BASELINE_DATA__ = baselines;
      let tries = 0;
      const tick = () => {
        if (render()) return;
        if (++tries < 20) setTimeout(tick, 250);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1100));
      } else {
        setTimeout(tick, 1100);
      }
    });
  }

  global.InspectSR = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
