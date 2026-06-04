/* NNT-from-HR panel (survival topic packs).
 *
 * Reads window.RapidMeta.realData; pools log-HR via window.RapidMetaSurvival.fit;
 * converts pooled HR to NNT via Altman 2002 at a baseline-risk slider.
 *
 * Distinct from vendor/nnt-panel.js (which pools risk-difference from binary 2x2).
 * This panel is the right NNT lens for time-to-event meta-analyses.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'hr-nnt-panel-expanded';

  function extractSurvivalTrials(rd) {
    if (!rd) return [];
    var out = [];
    Object.values(rd).forEach(function (t) {
      if (typeof t.HR === 'number' && typeof t.HR_ci_lo === 'number' && typeof t.HR_ci_hi === 'number') {
        out.push({
          studlab: String(t.name || t.studlab || '?'),
          HR: +t.HR,
          HR_ci_lo: +t.HR_ci_lo,
          HR_ci_hi: +t.HR_ci_hi,
          events_ctl: t.events_ctl,
          n_ctl: t.n_ctl
        });
      }
    });
    return out;
  }

  function inferBaselineRisk(trials) {
    // If multiple trials carry events_ctl + n_ctl, take the median crude rate.
    var rates = [];
    trials.forEach(function (t) {
      if (typeof t.events_ctl === 'number' && typeof t.n_ctl === 'number' && t.n_ctl > 0) {
        rates.push(t.events_ctl / t.n_ctl);
      }
    });
    if (rates.length === 0) return 0.10; // 10% fallback
    rates.sort(function (a, b) { return a - b; });
    var mid = Math.floor(rates.length / 2);
    return rates.length % 2 ? rates[mid] : 0.5 * (rates[mid - 1] + rates[mid]);
  }

  function buildBody(P, trials, fit, baselineRisk, nnt, nntCiLo, nntCiHi) {
    var fmt = P.fmt;
    var html = '';

    if (nnt.nnt == null) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
            + '⚠ <strong>NNT undefined</strong> — pooled HR is at or near 1.0, or baseline-risk × HR conversion is degenerate.'
            + '</div>';
    } else {
      var verb = nnt.direction === 'NNTB' ? 'benefit' : 'harm';
      html += '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:9px 10px;margin-bottom:10px;font-size:12px;">'
            + '<strong style="color:#34d399;">' + nnt.direction + ' = ' + Math.ceil(nnt.nnt) + '</strong> '
            + (nntCiLo != null && nntCiHi != null ?
                '<span style="color:#cbd5e1;">(95% CI ' + Math.ceil(nntCiLo) + '–' + Math.ceil(nntCiHi) + ')</span> ' : '')
            + '<span style="color:#94a3b8;">at baseline risk ' + fmt(baselineRisk * 100, 1) + '% — treat ' + Math.ceil(nnt.nnt) + ' to ' + verb + ' 1.</span>'
            + '</div>';
    }

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px;">';
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    html += cell('Pooled HR', fmt(fit.pooled_HR, 2),
                'CI ' + fmt(fit.pooled_HR_ci_lo, 2) + '–' + fmt(fit.pooled_HR_ci_hi, 2));
    html += cell('Baseline risk', fmt(baselineRisk * 100, 1) + '%', trials.length + ' trials');
    html += cell('Tx risk', nnt.tx_risk != null ? fmt(nnt.tx_risk * 100, 1) + '%' : '—');
    html += cell('ARR', nnt.arr != null ? fmt(Math.abs(nnt.arr) * 100, 2) + 'pp' : '—');
    html += '</div>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
          + 'Method: NNT for time-to-event meta-analyses (Altman & Andersen 2002). '
          + 'ARR = R_ctl − (1 − (1 − R_ctl)^HR); NNT = 1/|ARR|. '
          + 'Baseline risk inferred as the median crude control-arm event rate across trials. '
          + 'Confidence bounds derived by applying the formula to the pooled HR CI limits. '
          + 'NNTB = number to benefit, NNTH = number to harm.'
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
    if (trials.length < 2) return false;

    var fit;
    try { fit = SURV.fit(trials); }
    catch (e) {
      console.warn('[hr-nnt-panel] fit failed:', e);
      return false;
    }

    var baseline = inferBaselineRisk(trials);
    var nnt = SURV.nntForHR(fit.pooled_HR, baseline);
    var nntCiLo = null, nntCiHi = null;
    if (fit.pooled_HR_ci_lo > 0 && fit.pooled_HR_ci_hi > 0) {
      var a = SURV.nntForHR(fit.pooled_HR_ci_lo, baseline);
      var b = SURV.nntForHR(fit.pooled_HR_ci_hi, baseline);
      if (a.nnt != null && b.nnt != null && a.direction === b.direction) {
        nntCiLo = Math.min(a.nnt, b.nnt);
        nntCiHi = Math.max(a.nnt, b.nnt);
      }
    }

    var fmt = P.fmt;
    var summary;
    if (nnt.nnt == null) {
      summary = 'NNT undefined · pooled HR ' + fmt(fit.pooled_HR, 2);
    } else {
      summary = nnt.direction + ' ' + Math.ceil(nnt.nnt) +
                (nntCiLo != null ? ' [' + Math.ceil(nntCiLo) + '–' + Math.ceil(nntCiHi) + ']' : '') +
                ' · baseline ' + fmt(baseline * 100, 1) + '% · k=' + trials.length;
    }

    var panel = P.buildCollapsiblePanel({
      id: 'hr-nnt-panel',
      badge: 'NNT (HR)',
      summary: summary,
      bodyHtml: buildBody(P, trials, fit, baseline, nnt, nntCiLo, nntCiHi),
      storageKey: STORAGE_KEY
    });

    var existing = document.getElementById('hr-nnt-panel');
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

  global.HRNNTPanel = { render: render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
