/* RMST-difference pool panel (survival topic packs).
 *
 * Reads window.RapidMeta.realData; extracts trials with km_curve; pools
 * RMST-difference at tau* via window.RapidMetaSurvival.poolRMSTDiff.
 *
 * Auto-bootstrap; collapsed by default. No-op if engine missing or <1 trials
 * carry km_curve.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'rmst-pool-expanded';

  function extractTrialsWithKM(rd) {
    if (!rd) return [];
    var out = [];
    Object.values(rd).forEach(function (t) {
      if (Array.isArray(t.km_curve) && t.km_curve.length >= 2 &&
          isFinite(+t.km_curve[0].surv_trt) && isFinite(+t.km_curve[0].surv_ctl)) {
        out.push({
          studlab: String(t.name || t.studlab || '?'),
          km_curve: t.km_curve
        });
      }
    });
    return out;
  }

  function defaultTau(trials) {
    // Use the minimum last-knot across trials as the conservative default
    var taus = trials.map(function (t) {
      return t.km_curve[t.km_curve.length - 1].t_months;
    });
    return Math.min.apply(null, taus);
  }

  function buildBody(P, trials, pool, tau) {
    var fmt = P.fmt;
    var html = '';

    if (!pool || pool.k === 0) {
      return '<div style="color:#fbbf24;font-size:11.5px;">No trials supplied reconstructed KM curves; RMST pool unavailable.</div>';
    }

    var sig = (pool.ci_lo > 0) || (pool.ci_hi < 0);
    var color = sig ? '#34d399' : '#94a3b8';
    var direction = pool.pooled_diff > 0 ? 'trt favoured' : (pool.pooled_diff < 0 ? 'ctl favoured' : 'null');

    html += '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:9px 10px;margin-bottom:10px;font-size:12px;">'
          + '<strong style="color:' + color + ';">Pooled RMST difference: ' + fmt(pool.pooled_diff, 2) + ' months</strong> '
          + '<span style="color:#cbd5e1;">(95% CI ' + fmt(pool.ci_lo, 2) + ' to ' + fmt(pool.ci_hi, 2) + ')</span> '
          + '<span style="color:#94a3b8;">at τ* = ' + fmt(tau, 0) + ' mo · k=' + pool.k + ' · ' + direction + '</span>'
          + '</div>';

    if (pool.tau2 != null) {
      html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">'
            + 'τ² = ' + fmt(pool.tau2, 4)
            + (pool.I2 != null ? ' · I² = ' + fmt(pool.I2, 0) + '%' : '')
            + (pool.fallback ? ' · <span style="color:#fbbf24;">fallback: ' + pool.fallback + '</span>' : '')
            + '</div>';
    }

    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">Trial</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">RMST trt (mo)</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">RMST ctl (mo)</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">Diff (mo)</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">SE</th>'
          + '</tr></thead><tbody>';
    pool.per_study.forEach(function (p) {
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + p.studlab + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(p.rmst_trt, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(p.rmst_ctl, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(p.rmst_diff, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#94a3b8;">' + fmt(p.se, 3) + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
          + 'Method: Per-trial RMST computed by trapezoid integration of the supplied KM survival to τ*. '
          + 'RMST-difference SE approximated using Greenwood-style finite-difference. '
          + 'Differences pooled via inverse-variance random-effects (REML if k≥5, fixed-effect if k&lt;5). '
          + 'RMST is the recommended summary when proportional-hazards is in doubt (Cochrane v6.5 §10.10).'
          + '</div>';

    return html;
  }

  function render() {
    var P = global.PanelHelper;
    var SURV = global.RapidMetaSurvival;
    if (!P || !SURV) return false;
    var rd = P.getRealData();
    if (!rd) return false;
    var trials = extractTrialsWithKM(rd);
    if (trials.length < 1) return false;

    var tau = defaultTau(trials);
    var pool;
    try { pool = SURV.poolRMSTDiff(trials, tau); }
    catch (e) {
      console.warn('[rmst-pool] poolRMSTDiff failed:', e);
      return false;
    }
    if (!pool) return false;

    var fmt = P.fmt;
    var summary = 'ΔRMST = ' + fmt(pool.pooled_diff, 2) + ' mo · 95% CI ' + fmt(pool.ci_lo, 2) + ' to ' + fmt(pool.ci_hi, 2) + ' · k=' + pool.k + ' · τ*=' + fmt(tau, 0) + 'mo';

    var panel = P.buildCollapsiblePanel({
      id: 'rmst-pool-panel',
      badge: 'RMST',
      summary: summary,
      bodyHtml: buildBody(P, trials, pool, tau),
      storageKey: STORAGE_KEY
    });

    var existing = document.getElementById('rmst-pool-panel');
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

  global.RMSTPanel = { render: render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
