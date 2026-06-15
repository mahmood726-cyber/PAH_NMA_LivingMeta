/* Interval-HR pool panel (survival topic packs).
 *
 * Reads window.RapidMeta.realData; for trials carrying t.intervals (per-window
 * HRs), pools each window's HR via window.RapidMetaSurvival.intervalHRPool.
 *
 * No-op if engine missing or no trials have intervals.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'interval-hr-pool-expanded';

  function extractTrialsWithIntervals(rd) {
    if (!rd) return [];
    var out = [];
    Object.values(rd).forEach(function (t) {
      if (Array.isArray(t.intervals) && t.intervals.length > 0) {
        out.push({
          studlab: String(t.name || t.studlab || '?'),
          HR: +t.HR,
          HR_ci_lo: +t.HR_ci_lo,
          HR_ci_hi: +t.HR_ci_hi,
          intervals: t.intervals
        });
      }
    });
    return out;
  }

  function defaultBreakpoints(trials) {
    var seen = {};
    trials.forEach(function (t) {
      t.intervals.forEach(function (iv) {
        seen[iv.t0] = true; seen[iv.t1] = true;
      });
    });
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  }

  function buildBody(P, trials, pool) {
    var fmt = P.fmt;
    var html = '';

    if (!pool || !pool.intervals || pool.intervals.length === 0) {
      return '<div style="color:#fbbf24;font-size:11.5px;">No matching intervals across trials.</div>';
    }

    // Inspect whether the windows differ — if early HR > late HR substantially, surface the crossover
    var hrSpread = null;
    if (pool.intervals.length >= 2) {
      var first = pool.intervals[0].HR;
      var last = pool.intervals[pool.intervals.length - 1].HR;
      hrSpread = first - last;
    }
    if (hrSpread != null && Math.abs(hrSpread) > 0.15) {
      var sign = hrSpread > 0 ? 'late' : 'early';
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
            + '⚠ <strong>Interval-HR spread = ' + fmt(Math.abs(hrSpread), 2) + '</strong> (' + sign + ' window favours treatment) — '
            + 'consistent with non-proportional hazards; the pooled overall HR averages across these.'
            + '</div>';
    }

    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">Window</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">k</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">Pooled HR</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">95% CI</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">τ²</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">I²</th>'
          + '</tr></thead><tbody>';
    pool.intervals.forEach(function (iv) {
      var ciStr = '[' + fmt(iv.HR_ci_lo, 2) + ', ' + fmt(iv.HR_ci_hi, 2) + ']';
      var sigColor = (iv.HR_ci_hi < 1) ? '#34d399' : (iv.HR_ci_lo > 1 ? '#f87171' : '#cbd5e1');
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + iv.label + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + iv.k + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:' + sigColor + ';font-weight:600;">' + fmt(iv.HR, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + ciStr + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#94a3b8;">' + (iv.tau2 != null ? fmt(iv.tau2, 3) : '—') + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#94a3b8;">' + (iv.I2 != null ? fmt(iv.I2, 0) + '%' : '—') + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
          + 'Method: For each prespecified time window [t₀, t₁], pool the trial-reported within-window HRs '
          + 'via inverse-variance random-effects (REML if k≥5, fixed-effect if k&lt;5). '
          + 'A pooled HR that visibly differs between early and late windows is direct evidence of non-PH.'
          + '</div>';

    return html;
  }

  function render() {
    var P = global.PanelHelper;
    var SURV = global.RapidMetaSurvival;
    if (!P || !SURV) return false;
    var rd = P.getRealData();
    if (!rd) return false;
    var trials = extractTrialsWithIntervals(rd);
    if (trials.length < 1) return false;

    var bp = defaultBreakpoints(trials);
    if (bp.length < 2) return false;

    var pool;
    try { pool = SURV.intervalHRPool(trials, bp); }
    catch (e) {
      console.warn('[interval-hr-pool] failed:', e);
      return false;
    }
    if (!pool) return false;

    var fmt = P.fmt;
    var summary = 'Interval HRs across ' + pool.intervals.length + ' windows · '
                + pool.intervals.map(function (iv) {
                    return iv.label + '=' + fmt(iv.HR, 2);
                  }).join(' · ');

    var panel = P.buildCollapsiblePanel({
      id: 'interval-hr-pool-panel',
      badge: 'Interval HR · Experimental',
      summary: summary,
      bodyHtml: buildBody(P, trials, pool),
      storageKey: STORAGE_KEY
    });

    var existing = document.getElementById('interval-hr-pool-panel');
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

  global.IntervalHRPoolPanel = { render: render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
