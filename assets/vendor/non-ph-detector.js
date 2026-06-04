/* Non-PH detector panel (survival topic packs).
 *
 * Reads window.RapidMeta.realData. Flags non-proportional hazards if any
 * trial reports Schoenfeld p<0.05 OR curve_crosses=true. Surfaces fraction
 * flagged and minimum Schoenfeld p.
 *
 * Pairs with the RMST panel — when this flag fires, the manuscript narrative
 * should accompany the pooled HR with a pooled RMST-difference (Cochrane v6.5
 * §10.10.4).
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'non-ph-detector-expanded';

  function extractSurvivalTrials(rd) {
    if (!rd) return [];
    var out = [];
    Object.values(rd).forEach(function (t) {
      if (typeof t.HR === 'number' && isFinite(t.HR)) {
        out.push({
          studlab: String(t.name || t.studlab || '?'),
          HR: +t.HR,
          schoenfeld_p: typeof t.schoenfeld_p === 'number' ? +t.schoenfeld_p : null,
          curve_crosses: t.curve_crosses === true
        });
      }
    });
    return out;
  }

  function buildBody(P, trials, nph) {
    var fmt = P.fmt;
    var html = '';

    if (!nph.flag) {
      html += '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:9px 10px;margin-bottom:10px;font-size:12px;">'
            + '<strong style="color:#34d399;">PH assumption supported</strong> '
            + '<span style="color:#94a3b8;">— no trial reports Schoenfeld p&lt;0.05 or visible curve crossing. '
            + 'Pooled HR is interpretable as a constant effect over follow-up.</span>'
            + '</div>';
    } else {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
            + '⚠ <strong>Non-PH flagged</strong> — ' + nph.n_flagged + ' / ' + trials.length + ' trials ('
            + fmt(nph.fraction_flagged * 100, 0) + '%) violate PH. '
            + 'Pool the pooled HR is a time-averaged effect; report RMST-difference as a co-primary if available.'
            + '</div>';
    }

    if (nph.schoenfeld_p_min != null) {
      html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">'
            + 'Minimum reported Schoenfeld p = ' + fmt(nph.schoenfeld_p_min, 3)
            + '</div>';
    }

    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">Trial</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">HR</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">Schoenfeld p</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:center;">Curve crosses</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:center;">PH</th>'
          + '</tr></thead><tbody>';
    trials.forEach(function (t) {
      var hit = (t.schoenfeld_p != null && t.schoenfeld_p < 0.05) || t.curve_crosses;
      var phCell = hit ? '<span style="color:#fbbf24;">⚠</span>' : '<span style="color:#34d399;">✓</span>';
      var schoenfeldCell = t.schoenfeld_p != null ? fmt(t.schoenfeld_p, 3) : '<span style="color:#475569;">—</span>';
      var crossCell = t.curve_crosses === true ? '<span style="color:#fbbf24;">yes</span>' : '<span style="color:#475569;">no</span>';
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + t.studlab + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(t.HR, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + schoenfeldCell + '</td>'
            + '<td style="padding:3px 6px;text-align:center;font-family:JetBrains Mono,monospace;">' + crossCell + '</td>'
            + '<td style="padding:3px 6px;text-align:center;">' + phCell + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
          + 'Method: Two-criterion non-PH flag (Cochrane v6.5 §10.10.4). '
          + 'A trial is flagged if (a) the reported Schoenfeld residuals test p&lt;0.05 OR '
          + '(b) the authors explicitly describe visible curve crossing or time-varying effects. '
          + 'When the aggregate fraction exceeds zero, the pooled HR should be paired with a pooled '
          + 'RMST-difference (Karrison 2018, Royston-Parmar 2013) to avoid misrepresenting a '
          + 'time-varying treatment effect as a single number.'
          + '</div>';

    return html;
  }

  function render() {
    var P = global.PanelHelper;
    var SURV = global.RapidMetaSurvival;
    if (!P || !SURV) return false;
    var rd = P.getRealData();
    if (!rd) return false;
    var trials = extractSurvivalTrials(rd);
    if (trials.length < 1) return false;

    var nph = SURV.nonPHDetect(trials);
    var fmt = P.fmt;
    var summary;
    if (nph.flag) {
      summary = '⚠ Non-PH in ' + nph.n_flagged + '/' + trials.length + ' trials (' + fmt(nph.fraction_flagged * 100, 0) + '%) · min Schoenfeld p=' + (nph.schoenfeld_p_min != null ? fmt(nph.schoenfeld_p_min, 3) : '—');
    } else {
      summary = 'PH supported · k=' + trials.length + ' · min Schoenfeld p=' + (nph.schoenfeld_p_min != null ? fmt(nph.schoenfeld_p_min, 3) : '—');
    }

    var panel = P.buildCollapsiblePanel({
      id: 'non-ph-detector-panel',
      badge: 'Non-PH',
      summary: summary,
      bodyHtml: buildBody(P, trials, nph),
      storageKey: STORAGE_KEY
    });

    var existing = document.getElementById('non-ph-detector-panel');
    if (existing) existing.replaceWith(panel);
    else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    var tries = 0;
    var tick = function () {
      if (render()) return;
      if (++tries < 20) setTimeout(tick, 250);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 300); });
    } else {
      setTimeout(tick, 300);
    }
  }

  global.NonPHDetectorPanel = { render: render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
