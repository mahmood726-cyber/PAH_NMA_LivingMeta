/* Influence diagnostics — Viechtbauer & Cheung 2010 metafor convention.
 *
 * Per-trial:
 *   - studentised residual r_i  (large |r| ⇒ outlier)
 *   - hat / leverage h_i        (large h ⇒ high leverage)
 *   - Cook's distance D_i       (joint outlier × leverage)
 *   - DFFITS                    (effect on fitted value when trial removed)
 *
 * Trials with |r| ≥ 1.96 OR D ≥ 4/k flagged as influential.
 *
 * Beyond Baujat: Baujat shows Q-contribution × influence-on-pooled.
 * Cook's D is a single composite metric reviewers expect from any
 * metafor user.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'influence-diagnostics-expanded';

  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d };
  }

  function poolTau2DL(points) {
    let W = 0, WY = 0;
    points.forEach(p => { const w = 1/p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    let Q = 0;
    points.forEach(p => { const w = 1/p.vi; Q += w * (p.yi - yFE) * (p.yi - yFE); });
    const df = points.length - 1;
    const sumW2 = points.reduce((s, p) => s + Math.pow(1/p.vi, 2), 0);
    const c = W - sumW2 / W;
    return Math.max(0, (Q - df) / c);
  }

  function poolRE(points, tau2) {
    let W = 0, WY = 0;
    points.forEach(p => { const w = 1/(p.vi + tau2); W += w; WY += w * p.yi; });
    const yRE = WY / W;
    return { yRE, W, se: Math.sqrt(1/W) };
  }

  function compute(P, trials) {
    if (!trials || trials.length < 3) return null;
    const points = trials.map(trialLogOR);
    const tau2 = poolTau2DL(points);
    const fullPool = poolRE(points, tau2);
    const W_total = fullPool.W;

    const k = points.length;
    const rows = points.map((p, i) => {
      const w_i = 1 / (p.vi + tau2);
      // Hat (leverage): h_i = w_i / Σw
      const h_i = w_i / W_total;
      // Standardised residual: (y_i - θ̂) / sqrt(v_i + τ² - SE(θ̂)²)
      const var_resid = (p.vi + tau2) - 1 / W_total;
      const r_i = var_resid > 0 ? (p.yi - fullPool.yRE) / Math.sqrt(var_resid) : 0;
      // Studentised: same as standardised when REML/DL with single tau²
      // Cook's D ≈ r_i² * h_i / (1-h_i)²  (per Viechtbauer 2010, eq. 22)
      const D_i = (h_i < 1) ? (r_i * r_i) * h_i / Math.pow(1 - h_i, 2) : 0;
      // DFFITS: r_i * sqrt(h_i / (1-h_i))  (rough; metafor uses leave-one-out version)
      const dffits = (h_i < 1) ? r_i * Math.sqrt(h_i / (1 - h_i)) : 0;
      return {
        name: trials[i].name,
        yi: p.yi, OR_i: Math.exp(p.yi),
        h: h_i, r: r_i, D: D_i, dffits,
        flag_r: Math.abs(r_i) >= 1.96,
        flag_D: D_i >= 4 / k,
      };
    });
    return { rows, fullPool, tau2, k };
  }

  function buildBody(P, info) {
    const fmt = P.fmt;
    const rows = info.rows;
    const flagged = rows.filter(r => r.flag_r || r.flag_D);
    let html = '';

    if (flagged.length === 0) {
      html += '<div style="background:#0e3a1f;border:1px solid #34d399;color:#34d399;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
            + '✓ No outlier or high-influence trials (all |r| < 1.96 and Cook\'s D < ' + fmt(4 / info.k, 3) + ').'
            + '</div>';
    } else {
      const names = flagged.map(f => f.name).slice(0, 5).join(', ');
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
            + '⚠ <strong>' + flagged.length + '</strong> trial(s) flagged: ' + names + '. '
            + 'Inspect for outlier/leverage. Consider sensitivity analysis without flagged trials.'
            + '</div>';
    }

    // Per-trial table
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;">Trial</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">OR</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Std. residual r</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Leverage h</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Cook\'s D</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">DFFITS</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:center;">Flag</th>'
          + '</tr></thead><tbody>';
    rows.forEach(r => {
      const flag = r.flag_r || r.flag_D;
      const reasons = [];
      if (r.flag_r) reasons.push('|r|≥1.96');
      if (r.flag_D) reasons.push('D≥' + fmt(4/info.k, 2));
      html += '<tr style="border-bottom:1px solid #0b1220;' + (flag ? 'background:#1c1410;' : '') + '">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + r.name + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(r.OR_i, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:' + (r.flag_r ? '#fbbf24' : '#cbd5e1') + ';">' + fmt(r.r, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(r.h, 3) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:' + (r.flag_D ? '#fbbf24' : '#cbd5e1') + ';">' + fmt(r.D, 3) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#94a3b8;">' + fmt(r.dffits, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:center;color:' + (flag ? '#fbbf24' : '#34d399') + ';font-size:10px;">' + (flag ? '⚠ ' + reasons.join('; ') : '✓') + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    // Method note
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method (Viechtbauer & Cheung 2010, <em>Res Synth Methods</em>):</strong> '
          + 'leverage h<sub>i</sub> = w<sub>i</sub>/Σw with w<sub>i</sub>=1/(v<sub>i</sub>+τ²); '
          + 'standardised residual r<sub>i</sub> = (y<sub>i</sub>−θ̂)/√(v<sub>i</sub>+τ²−Var(θ̂)); '
          + 'Cook\'s D<sub>i</sub> = r<sub>i</sub>² × h<sub>i</sub>/(1−h<sub>i</sub>)². '
          + '<strong>Thresholds:</strong> |r|≥1.96 (~5% under H₀); D≥4/k (Cook\'s rule of thumb). '
          + 'These are diagnostic — flagged trials are <em>candidates</em> for inspection, not proof of error. '
          + 'Sensitivity re-pool excluding flagged trials available in the leave-one-out panel.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 3) return false;

    const info = compute(P, trials);
    if (!info) return false;

    const flagged = info.rows.filter(r => r.flag_r || r.flag_D);
    const summary = flagged.length === 0
      ? '✓ no outliers/leverage · all |r|<1.96, D<' + P.fmt(4/info.k, 2)
      : '⚠ ' + flagged.length + '/' + info.k + ' flagged · ' + flagged.slice(0, 2).map(f => f.name).join(', ');

    const panel = P.buildCollapsiblePanel({
      id: 'influence-diagnostics-panel',
      badge: 'Influence',
      summary,
      bodyHtml: buildBody(P, info),
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('influence-diagnostics-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1000));
    } else {
      setTimeout(tick, 1000);
    }
  }

  global.InfluenceDiagnostics = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
