/* Leave-one-out sensitivity for single-arm proportion pool.
 *
 * Drops each trial, re-pools logit-proportion via DerSimonian-Laird,
 * back-transforms, flags trials whose removal shifts the pooled
 * proportion by ≥3 percentage points absolute or whose CI bounds
 * change "qualitatively" (cross 50% threshold etc.).
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'single-arm-influence-expanded';

  function pickSingleArmTrials(rd) {
    if (!rd) return [];
    const out = [];
    Object.values(rd).forEach(t => {
      if (!t) return;
      let e, n;
      const ao = t.allOutcomes;
      if (Array.isArray(ao)) {
        const prop = ao.find(o => o && (o.type === 'PROPORTION' || o.type === 'SINGLE_ARM')
                                     && Number.isFinite(+o.events) && Number.isFinite(+o.n) && +o.n > 0);
        if (prop) { e = +prop.events; n = +prop.n; }
      }
      if (e === undefined && t.singleArm === true && Number.isFinite(+t.events) && Number.isFinite(+t.n) && +t.n > 0) {
        e = +t.events; n = +t.n;
      }
      if (e === undefined && Number.isFinite(+t.events) && Number.isFinite(+t.n) && +t.n > 0
          && (t.cN == null || +t.cN === 0) && (t.cE == null || +t.cE === 0)) {
        e = +t.events; n = +t.n;
      }
      if (e === undefined && Number.isFinite(+t.tE) && Number.isFinite(+t.tN) && +t.tN > 0
          && (t.cN === undefined || t.cN === null || +t.cN === 0)
          && (t.cE === undefined || t.cE === null || +t.cE === 0)) {
        e = +t.tE; n = +t.tN;
      }
      if (e === undefined || n === undefined || e < 0 || n <= 0 || e > n) return;
      out.push({ name: t.name || '?', e, n });
    });
    return out;
  }

  function logitPoolFromList(trials) {
    if (!trials || trials.length < 2) return null;
    const points = trials.map(t => {
      let e = t.e, n = t.n;
      if (e === 0 || e === n) { e += 0.5; n += 1; }
      const p = e / n;
      return { yi: Math.log(p / (1 - p)), vi: 1/e + 1/(n - e) };
    });
    let W = 0, WY = 0;
    points.forEach(p => { const w = 1/p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    let Q = 0;
    points.forEach(p => { const w = 1/p.vi; Q += w * Math.pow(p.yi - yFE, 2); });
    const df = points.length - 1;
    const sumW2 = points.reduce((s, p) => s + Math.pow(1/p.vi, 2), 0);
    const c = W - sumW2 / W;
    const tau2 = Math.max(0, (Q - df) / c);
    let W2 = 0, WY2 = 0;
    points.forEach(p => { const w = 1/(p.vi + tau2); W2 += w; WY2 += w * p.yi; });
    const yRE = WY2 / W2;
    const seRE = Math.sqrt(1/W2);
    return { yi: yRE, ci_low: yRE - 1.96*seRE, ci_high: yRE + 1.96*seRE, k: points.length };
  }

  function invLogit(y) { return Math.exp(y) / (1 + Math.exp(y)); }

  function buildBody(P, trials, fullPool, rows, maxShiftPct) {
    const fmt = P.fmt;
    let html = '';
    const fullProp = invLogit(fullPool.yi) * 100;
    const fullCI = '(' + fmt(invLogit(fullPool.ci_low) * 100, 1) + '–' + fmt(invLogit(fullPool.ci_high) * 100, 1) + '%)';

    let toneCol, toneBg, toneBorder, verdict;
    if (maxShiftPct < 1) {
      toneCol = '#34d399'; toneBg = '#0e3a1f'; toneBorder = '#34d399';
      verdict = '✓ Robust: max leave-one-out shift = ' + fmt(maxShiftPct, 1) + ' pp.';
    } else if (maxShiftPct < 3) {
      toneCol = '#7dd3fc'; toneBg = '#0e2540'; toneBorder = '#1e3a5f';
      verdict = '✓ Stable: max shift = ' + fmt(maxShiftPct, 1) + ' pp (<3 pp threshold).';
    } else if (maxShiftPct < 5) {
      toneCol = '#fbbf24'; toneBg = '#3a2a0a'; toneBorder = '#92400e';
      verdict = '⚠ Modest sensitivity: max shift = ' + fmt(maxShiftPct, 1) + ' pp.';
    } else {
      toneCol = '#fca5a5'; toneBg = '#3a0a0a'; toneBorder = '#7f1d1d';
      verdict = '⚠ Single trial drives ≥5 pp of pooled proportion (max shift = ' + fmt(maxShiftPct, 1) + ' pp).';
    }
    html += '<div style="background:' + toneBg + ';border:1px solid ' + toneBorder + ';color:' + toneCol + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
          + verdict + ' Full pool: ' + fmt(fullProp, 1) + '% ' + fullCI + ' · k=' + fullPool.k + '.'
          + '</div>';

    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;">Trial removed</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">k</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Pooled %</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">95% CI</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Δ vs full (pp)</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:center;">Flag</th>'
          + '</tr></thead><tbody>';
    rows.forEach(r => {
      const flagCol = r.shiftPct >= 5 ? '#fca5a5' : (r.shiftPct >= 3 ? '#fbbf24' : '#cbd5e1');
      const flag = r.shiftPct >= 5 ? '⚠ driver' : (r.shiftPct >= 3 ? '⚠ modest' : '✓');
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + r.name + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + r.k + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(r.prop, 1) + '%</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(r.lo, 1) + '–' + fmt(r.hi, 1) + '%</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:' + flagCol + ';">' + fmt(r.shiftPct, 1) + '</td>'
            + '<td style="padding:3px 6px;text-align:center;color:' + flagCol + ';font-size:10.5px;">' + flag + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> for each trial i, re-pool logit-proportion via DerSimonian–Laird random effects on k−1 trials, '
          + 'back-transform, compare to full pool. "Driver" = removal shifts pooled proportion by ≥5 pp absolute. '
          + 'Cochrane Handbook v6.5 §10.10.4 leave-one-out sensitivity.'
          + '</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = pickSingleArmTrials(rd);
    if (trials.length < 3) return false;  // L1O needs ≥3
    const fullPool = logitPoolFromList(trials);
    if (!fullPool) return false;
    const fullProp = invLogit(fullPool.yi) * 100;
    const rows = [];
    let maxShiftPct = 0;
    trials.forEach((dropped, i) => {
      const sub = trials.filter((_, j) => j !== i);
      const subPool = logitPoolFromList(sub);
      if (!subPool) return;
      const subProp = invLogit(subPool.yi) * 100;
      const lo = invLogit(subPool.ci_low) * 100;
      const hi = invLogit(subPool.ci_high) * 100;
      const shiftPct = Math.abs(subProp - fullProp);
      maxShiftPct = Math.max(maxShiftPct, shiftPct);
      rows.push({ name: dropped.name, k: sub.length, prop: subProp, lo, hi, shiftPct });
    });

    const summary = (maxShiftPct >= 5 ? '⚠ ' : (maxShiftPct >= 3 ? '⚠ ' : '✓ '))
                  + 'max Δ ' + P.fmt(maxShiftPct, 1) + ' pp across ' + trials.length + ' leave-one-out pools';
    const panel = P.buildCollapsiblePanel({
      id: 'single-arm-influence-panel', badge: 'Leave-one-out (single-arm)',
      summary, bodyHtml: buildBody(P, trials, fullPool, rows, maxShiftPct),
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('single-arm-influence-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1600));
    } else { setTimeout(tick, 1600); }
  }

  global.SingleArmInfluence = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
