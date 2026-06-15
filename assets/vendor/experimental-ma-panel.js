/* experimental-ma-panel.js — GRMA robust pool + distribution-free conformal PI.
 *
 * Engine: ExperimentalMA.grma / .conformalPI (experimental-ma.js, vendored
 * verbatim from allmeta/shared; both verified to 1e-6 vs their Python sources).
 * Reproduces the experimental-ma-parity oracle on the 6-study fixture:
 * GRMA estimate = -0.12826963, conformal PI theta = -0.13796647 (lo -0.35241823,
 * hi 0.07648528).
 *
 * GRMA (Grey Relational MA) is a robust, outlier-downweighting point estimate
 * with a redescending Tukey-bisquare effect guard. The conformal prediction
 * interval is DISTRIBUTION-FREE: guaranteed marginal coverage for the next
 * study's effect with NO normality assumption — unlike the Cochrane t-based PI.
 *
 * EXPERIMENTAL — these are research-grade estimators (the user's own method
 * repos), surfaced behind an explicit Experimental badge. SENSITIVITY only;
 * binary outcomes (log-OR), GRMA k>=2, conformal PI k>=4. Surface beside the RE
 * primary, never as the headline.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'experimental-ma-panel-expanded';

  function logORrows(trials) {
    return trials.map(t => {
      let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
      if (ai === 0 || ci === 0 || ai === n1 || ci === n2) { ai += 0.5; ci += 0.5; n1 += 1; n2 += 1; }
      const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
      return { te: Math.log((a * d) / (b * c)), se: Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d) };
    });
  }

  function buildBody(P, grma, conf, kVal) {
    const fmt = P.fmt;
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
    }
    const grmaOR = Math.exp(grma.estimate);
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;">';
    html += cell('GRMA robust OR', fmt(grmaOR, 2), 'log-OR ' + fmt(grma.estimate, 3));
    if (conf) {
      html += cell('Conformal PI (OR)', fmt(Math.exp(conf.lo), 2) + ' – ' + fmt(Math.exp(conf.hi), 2), 'distribution-free, next study');
      html += cell('Conformal centre', fmt(Math.exp(conf.theta), 2), 'DL pool log-OR ' + fmt(conf.theta, 3));
      html += cell('PI threshold', fmt(conf.threshold, 2), 'conformal score quantile');
    }
    html += '</div>';
    if (!conf) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11px;">'
        + '⚠ Conformal prediction interval needs k≥4 studies; only the GRMA robust pool is shown for k=' + kVal + '.</div>';
    }
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:8px;">'
      + '<strong>GRMA (Grey Relational Meta-Analysis):</strong> a robust pool that downweights outliers via grey-relational grades '
      + 'and a redescending Tukey-bisquare guard — less sensitive to a single aberrant trial than DL. '
      + '<strong>Conformal prediction interval:</strong> a DISTRIBUTION-FREE interval for the next study’s effect with guaranteed '
      + 'marginal coverage, making NO normality assumption (unlike the Cochrane t-based prediction interval). '
      + '<strong>Experimental:</strong> research-grade estimators — a robustness SENSITIVITY view, report beside the RE primary, not instead of it.</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.ExperimentalMA) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 2) return false;
    const rows = logORrows(trials);
    const yi = rows.map(x => x.te), sei = rows.map(x => x.se), vi = sei.map(s => s * s);
    let grma, conf;
    try {
      grma = global.ExperimentalMA.grma(yi, vi);
      conf = global.ExperimentalMA.conformalPI(yi, sei, 0.05); // null when k<4
    } catch (e) { return false; }
    if (!grma || !isFinite(grma.estimate)) return false;

    const summary = 'GRMA robust OR ' + P.fmt(Math.exp(grma.estimate), 2)
      + (conf ? ' · conformal PI ' + P.fmt(Math.exp(conf.lo), 2) + '–' + P.fmt(Math.exp(conf.hi), 2) + ' (distribution-free)' : ' · conformal PI needs k≥4');
    const panel = P.buildCollapsiblePanel({
      id: 'experimental-ma-panel', badge: 'Robust pool + conformal PI <span style="font-size:9px;background:#3a2a0a;color:#fbbf24;border:1px solid #92400e;border-radius:4px;padding:0 4px;margin-left:4px;">Experimental</span>',
      summary, bodyHtml: buildBody(P, grma, conf, trials.length), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('experimental-ma-panel');
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

  global.ExperimentalMAPanel = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
