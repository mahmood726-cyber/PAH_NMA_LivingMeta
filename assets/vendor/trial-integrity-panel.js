/* Trial-integrity sensitivity panel.
 *
 * Reads outputs/trial_integrity.json (computed from public AACT data)
 * and reports per-trial pre-registration concordance heuristics:
 *
 *   - retro_registered:   first_posted_date > start_date by >1 month
 *   - results_overdue:    primary_completion >12 months ago, no results
 *                         posted (FDAAA-style)
 *   - status_concern:     overall_status ∈ {Unknown, Suspended, Terminated,
 *                         Withdrawn}
 *
 * Sensitivity analysis: re-pool log-OR excluding flagged trials and
 * report |Δ| against the main pool. Pure additive; never replaces main.
 *
 * Framing (per advanced-stats.md / ROB-ME 2024 Cochrane Ch 13):
 *   - "Pre-registration concordance heuristics" (NEUTRAL language)
 *   - Inline evidence per flag (dates, status verbatim from CT.gov)
 *   - Disclaimer that flags do NOT impugn primary research integrity
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'trial-integrity-panel-expanded';
  const DATA_URL = 'outputs/trial_integrity.json';

  function fmt(v, d) {
    if (v == null || (typeof v === 'number' && !isFinite(v))) return '—';
    if (typeof v !== 'number') v = Number(v);
    if (isNaN(v)) return '—';
    return d == null ? String(v) : v.toFixed(d);
  }

  function buildBody(P, trials, flagsByNct, mainPool, sensPool) {
    const fmtN = P.fmt;
    let html = '';

    // Headline
    const flaggedCount = trials.filter(t => flagsByNct[t.nct]?.any_flag).length;
    const total = trials.length;
    const pct = total > 0 ? (100 * flaggedCount / total) : 0;
    const deltaOR = sensPool && mainPool ? Math.abs(sensPool.OR - mainPool.OR) : null;
    const deltaPct = (deltaOR !== null && mainPool) ? (100 * deltaOR / mainPool.OR) : null;

    let toneCol = '#34d399', toneBg = '#0e3a1f', toneBorder = '#34d399';
    if (flaggedCount > 0 && deltaPct !== null && deltaPct >= 5) {
      toneCol = '#fbbf24'; toneBg = '#3a2a0a'; toneBorder = '#92400e';
    }
    if (flaggedCount > 0 && deltaPct !== null && deltaPct >= 15) {
      toneCol = '#fca5a5'; toneBg = '#3a0a0a'; toneBorder = '#7f1d1d';
    }

    html += '<div style="background:' + toneBg + ';border:1px solid ' + toneBorder + ';color:' + toneCol + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">';
    if (flaggedCount === 0) {
      html += '✓ No concordance flags detected on the ' + total + ' trial(s) with AACT data.';
    } else {
      html += '<strong>' + flaggedCount + ' / ' + total + ' trial(s) carry concordance flag(s)</strong> (' + fmtN(pct, 0) + '%). ';
      if (deltaPct !== null) {
        html += 'Sensitivity pool excluding flagged trials shifts pooled OR by ';
        html += '<strong>' + fmtN(deltaPct, 1) + '%</strong> ';
        html += '(main: ' + fmtN(mainPool.OR, 2) + ' → sensitivity: ' + fmtN(sensPool.OR, 2) + ').';
      } else {
        html += 'Insufficient unflagged trials for a sensitivity re-pool.';
      }
    }
    html += '</div>';

    // Sensitivity pool table
    if (sensPool && mainPool) {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:10px;">';
      function cell(label, value, sub) {
        return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
             + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
             + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
             + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
             + '</div>';
      }
      html += cell('Main pool',
        fmtN(mainPool.OR, 2),
        '95% CI ' + fmtN(mainPool.ci_low, 2) + '–' + fmtN(mainPool.ci_high, 2) + ' · k=' + mainPool.k);
      html += cell('Sensitivity (no flags)',
        fmtN(sensPool.OR, 2),
        '95% CI ' + fmtN(sensPool.ci_low, 2) + '–' + fmtN(sensPool.ci_high, 2) + ' · k=' + sensPool.k);
      html += cell('|Δ| pooled OR',
        fmtN(deltaPct, 1) + '%',
        deltaPct >= 15 ? '⚠ substantial' : (deltaPct >= 5 ? '⚠ modest' : '✓ trivial'));
      html += '</div>';
    }

    // Per-trial table
    html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">'
          + 'Per-trial concordance evidence from CT.gov (via AACT 2026-04-12 snapshot):</div>';
    html += '<div style="overflow-x:auto;"><table style="width:100%;font-size:10.5px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#94a3b8;text-align:left;">'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">Trial · NCT</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">Start</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">First posted</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">Primary completion</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">Results posted</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">Status</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:center;">Flag</th>'
          + '</tr></thead><tbody>';
    trials.forEach(t => {
      const f = flagsByNct[t.nct];
      const flag = f && f.any_flag;
      const reasons = [];
      if (f) {
        if (f.retro_registered) reasons.push('retro ' + (f.retro_months || '?') + 'mo');
        if (f.results_overdue) reasons.push('results overdue ' + (f.results_late_months || '?') + 'mo');
        if (f.status_concern) reasons.push('status: ' + f.overall_status);
      }
      html += '<tr style="border-bottom:1px solid #0b1220;' + (flag ? 'background:#1c1410;' : '') + '">'
            + '<td style="padding:3px 6px;color:#e2e8f0;"><strong>' + (t.name || '?') + '</strong> · <span style="font-family:JetBrains Mono,monospace;color:#94a3b8;font-size:9.5px;">' + t.nct + '</span></td>'
            + '<td style="padding:3px 6px;color:#cbd5e1;font-family:JetBrains Mono,monospace;">' + ((f && f.start_date) || '—') + '</td>'
            + '<td style="padding:3px 6px;color:' + (f && f.retro_registered ? '#fbbf24' : '#cbd5e1') + ';font-family:JetBrains Mono,monospace;">' + ((f && f.first_posted) || '—') + '</td>'
            + '<td style="padding:3px 6px;color:#cbd5e1;font-family:JetBrains Mono,monospace;">' + ((f && f.primary_completion_date) || '—') + '</td>'
            + '<td style="padding:3px 6px;color:' + (f && f.results_overdue ? '#fbbf24' : '#cbd5e1') + ';font-family:JetBrains Mono,monospace;">' + ((f && f.results_first_posted) || '—') + '</td>'
            + '<td style="padding:3px 6px;color:' + (f && f.status_concern ? '#fca5a5' : '#cbd5e1') + ';">' + ((f && f.overall_status) || '—') + '</td>'
            + '<td style="padding:3px 6px;text-align:center;color:' + (flag ? '#fbbf24' : '#34d399') + ';font-size:10px;">' + (flag ? '⚠ ' + reasons.join('; ') : '✓ clean') + '</td>'
            + '</tr>';
    });
    html += '</tbody></table></div>';

    // Footer disclaimer
    html += '<div style="font-size:10.5px;color:#94a3b8;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> "Retro" = first-posted date >1 month after trial start (per AllTrials/FDAAA conventions). '
          + '"Results overdue" = primary_completion >12 months ago, no results posted on CT.gov. '
          + 'All evidence from public AACT 2026-04-12 snapshot; verbatim dates / status shown above. '
          + '<br><strong>Sensitivity</strong> re-pool: same DerSimonian–Laird random effects on log-OR with continuity correction, excluding any-flag trials. '
          + 'Cochrane ROB-ME (Ch 13, 2024) endorses per-trial integrity-flag reporting as part of MA reporting.<br>'
          + '<strong>Disclaimer:</strong> these are <em>concordance heuristics</em>; they do <strong>not</strong> impugn primary research integrity, '
          + 'nor do they constitute a finding of misconduct. They are pre-registration <em>process</em> signals only.'
          + '</div>';

    return html;
  }

  // Pool log-OR via DerSimonian–Laird random effects
  function poolLogOR(P, trials) {
    if (!trials || trials.length < 2) return null;
    return P.poolRandomLogOR(trials);
  }

  function render(flagsData) {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;

    // Map NCTs to our trials
    const nctList = [];
    Object.entries(rd).forEach(([key, t]) => {
      // key may be the NCT directly
      const nct = key.startsWith('NCT') ? key : (t.nct || null);
      if (nct) nctList.push({ nct, name: t.name || nct, raw: t });
    });
    if (nctList.length < 2) return false;

    // Build the trial list for pooling
    const allTrials = P.extractBinaryTrials(rd);
    if (allTrials.length < 2) return false;

    // Match to NCTs (by .name)
    const nameToNct = {};
    nctList.forEach(x => { nameToNct[x.name] = x.nct; });
    allTrials.forEach(t => { t.nct = nameToNct[t.name] || null; });

    const flagsByNct = flagsData || {};
    const flagged = allTrials.filter(t => t.nct && flagsByNct[t.nct]?.any_flag);
    const unflagged = allTrials.filter(t => !(t.nct && flagsByNct[t.nct]?.any_flag));

    const mainPool = poolLogOR(P, allTrials);
    const sensPool = unflagged.length >= 2 ? poolLogOR(P, unflagged) : null;
    if (!mainPool) return false;

    const total = allTrials.length;
    const flagN = flagged.length;
    const summary = flagN === 0
      ? '✓ no concordance flags · ' + total + ' trials all clean'
      : '⚠ ' + flagN + '/' + total + ' flagged · '
        + (sensPool
            ? '|Δ| sensitivity = ' + P.fmt(100 * Math.abs(sensPool.OR - mainPool.OR) / mainPool.OR, 1) + '%'
            : 'too few unflagged for sensitivity');

    const panel = P.buildCollapsiblePanel({
      id: 'trial-integrity-panel',
      badge: 'Trial integrity',
      summary,
      bodyHtml: buildBody(P, allTrials, flagsByNct, mainPool, sensPool),
      storageKey: STORAGE_KEY,
    });

    const existing = document.getElementById('trial-integrity-panel');
    if (existing) existing.replaceWith(panel);
    else P.insertAfterRBadge(panel);
    return true;
  }

  let _flagsData = null;
  function loadFlags() {
    return fetch(DATA_URL, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    function tick() {
      if (!_flagsData) return;
      if (render(_flagsData)) return true;
      return false;
    }

    function startPolling() {
      const iv = setInterval(() => {
        if (tick()) clearInterval(iv);
        tries++;
        if (tries > 30) clearInterval(iv);
      }, 250);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        loadFlags().then(d => { _flagsData = d; setTimeout(startPolling, 700); });
      });
    } else {
      loadFlags().then(d => { _flagsData = d; setTimeout(startPolling, 700); });
    }
  }

  global.TrialIntegrity = { render: () => _flagsData && render(_flagsData) };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
