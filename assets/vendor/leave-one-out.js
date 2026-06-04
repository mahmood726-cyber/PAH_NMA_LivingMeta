/* Leave-one-out sensitivity panel — drop each trial and re-pool log-OR.
 * Flags trials whose removal:
 *   - Flips significance (CI crossed null in opposite direction), OR
 *   - Shifts pooled OR by >10%
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'leave-one-out-expanded';

  function buildBody(P, trials, fullPool) {
    const rows = [];
    let maxShift = 0;
    let flipCount = 0;

    trials.forEach((dropped, i) => {
      const subset = trials.filter((_, j) => j !== i);
      const sub = P.poolRandomLogOR(subset);
      if (!sub) return;
      const shift = Math.abs(sub.OR - fullPool.OR) / fullPool.OR;
      const fullSig = (fullPool.ci_low > 1) || (fullPool.ci_high < 1);
      const subSig = (sub.ci_low > 1) || (sub.ci_high < 1);
      const flips = fullSig !== subSig;
      if (flips) flipCount++;
      maxShift = Math.max(maxShift, shift);
      rows.push({ name: dropped.name, OR: sub.OR, ci_low: sub.ci_low, ci_high: sub.ci_high,
                  shift_pct: 100 * shift, flips, k: sub.k });
    });

    const fmt = P.fmt;
    let html = '';

    // Headline
    let alertTone = '#0b1220', alertBorder = '#1e293b', alertText = '#34d399', alertMsg;
    if (flipCount > 0) {
      alertTone = '#3a0a0a'; alertBorder = '#7f1d1d'; alertText = '#fca5a5';
      alertMsg = '⚠ Sensitivity broken: ' + flipCount + ' trial(s) flip the significance of the pooled estimate when removed.';
    } else if (maxShift >= 0.10) {
      alertTone = '#3a2a0a'; alertBorder = '#92400e'; alertText = '#fbbf24';
      alertMsg = '⚠ Single trial drives ≥10% of the pooled estimate (max shift ' + fmt(maxShift * 100, 1) + '%).';
    } else {
      alertMsg = '✓ Robust: max shift ' + fmt(maxShift * 100, 1) + '% with no significance flips on leave-one-out.';
    }
    html += '<div style="background:' + alertTone + ';border:1px solid ' + alertBorder + ';color:' + alertText + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">' + alertMsg + '</div>';

    // Reference row
    html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">'
          + 'Full pool (k=' + fullPool.k + '): OR ' + fmt(fullPool.OR, 2) + ' [' + fmt(fullPool.ci_low, 2) + '–' + fmt(fullPool.ci_high, 2) + ']</div>';

    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">Trial removed</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">k</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">OR</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">95% CI</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">Δ vs full</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:center;">Flag</th>'
          + '</tr></thead><tbody>';
    rows.forEach(r => {
      const flag = r.flips
        ? '<span style="color:#fca5a5;">flips sig.</span>'
        : (r.shift_pct >= 10 ? '<span style="color:#fbbf24;">drives</span>' : '<span style="color:#64748b;">—</span>');
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + r.name + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + r.k + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(r.OR, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(r.ci_low, 2) + '–' + fmt(r.ci_high, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:' + (r.shift_pct >= 10 ? '#fbbf24' : '#cbd5e1') + ';">' + fmt(r.shift_pct, 1) + '%</td>'
            + '<td style="padding:3px 6px;text-align:center;">' + flag + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
          + 'Method: re-pool log-OR (DerSimonian–Laird random effects) after removing each trial. '
          + '"Flips sig." = removal changes whether the 95% CI crosses OR=1. '
          + '"Drives" = removal shifts pooled OR by ≥10%. '
          + 'Cochrane Handbook v6.5 §10.10.4 sensitivity analysis.'
          + '</div>';

    return { html, alertMsg, flipCount, maxShift };
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 3) return false;  // L1O needs ≥3 trials

    const fullPool = P.poolRandomLogOR(trials);
    if (!fullPool) return false;

    const built = buildBody(P, trials, fullPool);
    const umbrella = P.isNMA && P.isNMA() ? ' [umbrella]' : '';
    let summary;
    if (built.flipCount > 0) {
      summary = '⚠ ' + built.flipCount + ' trial(s) flip significance · max Δ ' + P.fmt(built.maxShift * 100, 1) + '%' + umbrella;
    } else if (built.maxShift >= 0.10) {
      summary = '⚠ max Δ ' + P.fmt(built.maxShift * 100, 1) + '% (driver trial)' + umbrella;
    } else {
      summary = '✓ robust · max Δ ' + P.fmt(built.maxShift * 100, 1) + '%' + umbrella;
    }

    const panel = P.buildCollapsiblePanel({
      id: 'leave-one-out-panel',
      badge: 'Leave-one-out',
      summary,
      bodyHtml: built.html,
      storageKey: STORAGE_KEY,
    });

    const existing = document.getElementById('leave-one-out-panel');
    if (existing) existing.replaceWith(panel);
    else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => {
      if (render()) return;
      if (++tries < 20) setTimeout(tick, 250);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 350));
    } else {
      setTimeout(tick, 350);
    }
  }

  global.LeaveOneOut = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
