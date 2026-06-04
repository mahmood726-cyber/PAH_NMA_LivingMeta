/* Risk-Ratio sensitivity panel — Cochrane Handbook v6.5 §10.4.2 +
 * arXiv 2505.20168 (Stanley 2025 Nat Comm).
 *
 * For binary outcomes, OR and RR can disagree on the causal contrast
 * when baseline-risk variation is large (SD across studies > 0.1).
 * Cochrane explicitly recommends RR-as-sensitivity in that regime.
 *
 * Reports:
 *   - Pooled RR (DL random effects) with 95% CI
 *   - Pooled OR for direct comparison (re-uses helper)
 *   - Baseline-risk SD across trials
 *   - Verdict: "RR/OR concordant" if same direction & |Δ| < 10%
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'rr-sensitivity-expanded';

  function trialLogRR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const pt = ai / n1, pc = ci / n2;
    const yi = Math.log(pt / pc);
    const vi = (1 - pt) / ai + (1 - pc) / ci;
    return { yi, vi, baseline_p: pc };
  }

  function poolDLRE(points) {
    if (!points || points.length < 2) return null;
    let W = 0, WY = 0;
    points.forEach(p => { const w = 1/p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    let Q = 0;
    points.forEach(p => { const w = 1/p.vi; Q += w * (p.yi - yFE) * (p.yi - yFE); });
    const df = points.length - 1;
    const sumW2 = points.reduce((s, p) => s + Math.pow(1/p.vi, 2), 0);
    const c = W - sumW2 / W;
    const tau2 = Math.max(0, (Q - df) / c);
    let W2 = 0, WY2 = 0;
    points.forEach(p => { const w = 1/(p.vi + tau2); W2 += w; WY2 += w * p.yi; });
    const yRE = WY2 / W2;
    const seRE = Math.sqrt(1/W2);
    return {
      yi: yRE, se: seRE, ratio: Math.exp(yRE),
      ci_low: Math.exp(yRE - 1.96 * seRE),
      ci_high: Math.exp(yRE + 1.96 * seRE),
      k: points.length, tau2,
    };
  }

  function buildBody(P, trials, rrPool, orPool, baselineSD) {
    const fmt = P.fmt;
    let html = '';

    // Headline verdict
    let tone = '#34d399', toneBg = '#0e3a1f', toneBorder = '#34d399', verdict;
    const sameSign = (rrPool.ratio - 1) * (orPool.OR - 1) >= 0;
    const ratioDelta = Math.abs(rrPool.ratio - orPool.OR);
    const ratioPctDelta = 100 * ratioDelta / orPool.OR;
    if (!sameSign) {
      tone = '#fca5a5'; toneBg = '#3a0a0a'; toneBorder = '#7f1d1d';
      verdict = '⚠ RR and OR disagree on direction — collapsibility-driven sign change. Inspect pooled effect carefully.';
    } else if (baselineSD > 0.1) {
      tone = '#fbbf24'; toneBg = '#3a2a0a'; toneBorder = '#92400e';
      verdict = '⚠ Baseline-risk SD = ' + fmt(baselineSD, 2) + ' (>0.1). Cochrane v6.5 §10.4.2 recommends reporting RR alongside OR. |Δ| = ' + fmt(ratioPctDelta, 1) + '%.';
    } else if (ratioPctDelta > 15) {
      tone = '#fbbf24'; toneBg = '#3a2a0a'; toneBorder = '#92400e';
      verdict = '⚠ RR and OR magnitudes diverge (|Δ| = ' + fmt(ratioPctDelta, 1) + '%) despite low baseline-SD. Investigate.';
    } else {
      verdict = '✓ RR and OR concordant — same direction, |Δ| = ' + fmt(ratioPctDelta, 1) + '%, baseline-SD = ' + fmt(baselineSD, 2) + '.';
    }
    html += '<div style="background:' + toneBg + ';border:1px solid ' + toneBorder + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
          + verdict + '</div>';

    // Side-by-side cells
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:10px;">';
    html += cell('Pooled RR', fmt(rrPool.ratio, 2), '95% CI ' + fmt(rrPool.ci_low, 2) + '–' + fmt(rrPool.ci_high, 2) + ' · k=' + rrPool.k);
    html += cell('Pooled OR (primary)', fmt(orPool.OR, 2), '95% CI ' + fmt(orPool.ci_low, 2) + '–' + fmt(orPool.ci_high, 2));
    html += cell('|RR − OR|', fmt(ratioDelta, 2), fmt(ratioPctDelta, 1) + '%');
    html += cell('Baseline-risk SD', fmt(baselineSD, 3), 'across ' + trials.length + ' control arms');
    html += cell('τ² (RR)', fmt(rrPool.tau2, 4));
    html += '</div>';

    // Per-trial RR table
    html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Per-trial baseline risk and risk ratio:</div>';
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;">Trial</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Tx events / N</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Ctl events / N</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Baseline risk</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">RR</th>'
          + '</tr></thead><tbody>';
    trials.forEach(t => {
      const pt = t.ai / t.n1i, pc = t.ci / t.n2i;
      const trr = pc > 0 ? pt / pc : null;
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + t.name + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + t.ai + '/' + t.n1i + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + t.ci + '/' + t.n2i + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(pc * 100, 1) + '%</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(trr, 2) + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    // Method note
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> log-RR pooled via DerSimonian–Laird random effects on the multiplicative scale, '
          + 'continuity correction (+0.5) only for zero-cell trials. '
          + '<strong>Why both?</strong> OR is non-collapsible: under non-trivial baseline-risk variation across studies, '
          + 'pooled OR can flip sign vs. average causal RR (arXiv 2505.20168, Stanley 2025). '
          + 'Cochrane Handbook v6.5 §10.4.2: "When baseline risks vary substantially, sensitivity analysis using RR is recommended." '
          + 'Sensitivity only — does not replace primary OR estimate.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 2) return false;

    const points = trials.map(trialLogRR);
    const rrPool = poolDLRE(points);
    if (!rrPool) return false;
    const orPool = P.poolRandomLogOR(trials);
    if (!orPool) return false;

    // Baseline risk SD
    const baselines = points.map(p => p.baseline_p);
    const baseMean = baselines.reduce((s, x) => s + x, 0) / baselines.length;
    const baseVar = baselines.reduce((s, x) => s + (x - baseMean) * (x - baseMean), 0) / Math.max(1, baselines.length - 1);
    const baselineSD = Math.sqrt(baseVar);

    const sameSign = (rrPool.ratio - 1) * (orPool.OR - 1) >= 0;
    const summary = (sameSign ? '✓ ' : '⚠ ')
      + 'RR ' + P.fmt(rrPool.ratio, 2) + ' [' + P.fmt(rrPool.ci_low, 2) + '–' + P.fmt(rrPool.ci_high, 2) + ']'
      + ' vs OR ' + P.fmt(orPool.OR, 2)
      + (baselineSD > 0.1 ? ' · baseline-SD ' + P.fmt(baselineSD, 2) + ' (>0.1)' : '');

    const panel = P.buildCollapsiblePanel({
      id: 'rr-sensitivity-panel',
      badge: 'RR sensitivity',
      summary,
      bodyHtml: buildBody(P, trials, rrPool, orPool, baselineSD),
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('rr-sensitivity-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 850));
    } else {
      setTimeout(tick, 850);
    }
  }

  global.RRSensitivity = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
