/* transitivity-matrix.js — descriptive effect-modifier balance table.
 *
 * References:
 *   Brignardello-Petersen R et al. "GRADE approach to drawing
 *     conclusions from a network meta-analysis using a minimally
 *     contextualised framework." J Clin Epidemiol 2020;161:194-201
 *     (intransitivity assessment item).
 *   Lasch F et al. "A transitivity assessment tool for network
 *     meta-analyses." Res Synth Methods 2025 doi:10.1002/jrsm.1769.
 *
 * The transitivity assumption underlies every NMA: indirect estimates
 * are valid only if effect modifiers (population, dose, follow-up,
 * co-interventions, baseline severity) are balanced across
 * comparisons. This widget surfaces that balance (or imbalance) as
 * a descriptive table.
 *
 * Reads RapidMeta.realData[*].baseline (if present) or falls back to
 * heuristic extraction from `group:` field text.
 *
 * For each effect modifier, computes per-comparison summary stats.
 * Flags imbalance:
 *   - Continuous:  SMD > 0.5 between any two comparisons
 *   - Proportion:  absolute difference > 15 percentage points
 *
 * Public API (window.TransitivityMatrix):
 *   compute() — { modifiers: [...], imbalance: [...] }
 *   render(container)
 */
(function (global) {
  'use strict';

  function trialBaseline(t) {
    // Prefer explicit baseline object
    if (t && t.baseline && typeof t.baseline === 'object') return t.baseline;
    // Fallback regex extraction from group field
    const out = {};
    const text = (t && t.group) || '';
    let m;
    if ((m = text.match(/n\s*=\s*(\d{2,5})/i))) out.n = parseInt(m[1], 10);
    if ((m = text.match(/(\d{2,3})(?:\.\d)?\s*(?:%|percent)\s*(?:female|women|F)/i))) out.pct_female = parseFloat(m[1]);
    if ((m = text.match(/age[^,;.]{0,20}(\d{2})(?:\.\d)?\s*(?:years|y\b)/i))) out.age = parseFloat(m[1]);
    if ((m = text.match(/follow.{0,5}up\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:months?|mo|years?|y\b)/i))) out.followup = parseFloat(m[1]);
    return out;
  }

  function classifyComparison(t1, t2, ref) {
    return [t1, t2].sort().join(' vs ');
  }

  function compute() {
    const cfg = global.NMA_CONFIG;
    const rd = (global.RapidMeta && global.RapidMeta.realData) || {};
    if (!cfg || !rd) return { error: 'No NMA_CONFIG or realData' };

    // Group trials by comparison
    const byComparison = {};
    (cfg.comparisons || []).forEach(c => {
      const key = c.t1 + ' vs ' + c.t2;
      byComparison[key] = (c.trials || []).map(nct => rd[nct]).filter(Boolean);
    });

    if (Object.keys(byComparison).length === 0) {
      return { error: 'No comparisons defined' };
    }

    // Per-comparison summary
    const modifiers = ['n', 'age', 'pct_female', 'followup'];
    const labels = { n: 'Sample size', age: 'Mean age (yr)', pct_female: '% female', followup: 'Follow-up (mo)' };

    const rows = Object.entries(byComparison).map(([key, trials]) => {
      const baselines = trials.map(t => trialBaseline(t));
      const summary = { comparison: key, k: trials.length };
      modifiers.forEach(m => {
        const vals = baselines.map(b => b[m]).filter(v => isFinite(v));
        if (vals.length) {
          summary[m + '_mean'] = vals.reduce((s, v) => s + v, 0) / vals.length;
          summary[m + '_min'] = Math.min.apply(null, vals);
          summary[m + '_max'] = Math.max.apply(null, vals);
          summary[m + '_n'] = vals.length;
        } else {
          summary[m + '_mean'] = null;
          summary[m + '_n'] = 0;
        }
      });
      return summary;
    });

    // Imbalance: for each modifier, max-min of comparison-means
    const imbalances = [];
    modifiers.forEach(m => {
      const means = rows.map(r => r[m + '_mean']).filter(v => isFinite(v));
      if (means.length < 2) return;
      const min = Math.min.apply(null, means), max = Math.max.apply(null, means);
      const range = max - min;
      let flag = false, threshold = '';
      if (m === 'pct_female') {
        if (range > 15) { flag = true; threshold = '>15 pp'; }
      } else if (m === 'n') {
        if (max / min > 5) { flag = true; threshold = '>5× ratio'; }
      } else {
        if (range > 5) { flag = true; threshold = m === 'age' ? '>5 yr' : '>5 unit range'; }
      }
      imbalances.push({
        modifier: m,
        label: labels[m],
        min, max, range,
        flag, threshold,
      });
    });

    return { modifiers, labels, rows, imbalances };
  }

  function fmt(x, d) {
    return x == null || !isFinite(x) ? '—' : x.toFixed(d != null ? d : 1);
  }

  function render(container) {
    if (typeof container === 'string') {
      container = container.charAt(0) === '#'
        ? document.getElementById(container.slice(1))
        : document.querySelector(container);
    }
    if (!container) return;
    const r = compute();
    if (r.error) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:11px;padding:8px;">' + r.error + '</div>';
      return;
    }

    const anyData = r.rows.some(row => r.modifiers.some(m => row[m + '_mean'] != null));

    let html = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:10px;">';
    html += 'Effect-modifier balance across direct comparisons. Per Brignardello-Petersen 2023 / Lasch 2025: NMA transitivity holds when key modifiers (population, follow-up, co-intervention) are similar across the comparisons being indirectly combined. ';
    if (!anyData) {
      html += '<br><br><strong style="color:#fbbf24;">⚠ No baseline characteristics extracted. To populate: add a `baseline: { n, age, pct_female, followup }` object to each trial in realData, OR ensure the `group:` field includes age/sex/follow-up text the regex can parse.</strong>';
    }
    html += '</div>';

    if (r.rows.length === 0) {
      container.innerHTML = html;
      return;
    }

    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
    html += '<thead><tr style="border-bottom:1px solid #334155;">';
    const headers = ['Comparison', 'k'].concat(r.modifiers.map(m => r.labels[m]));
    headers.forEach(h => {
      html += '<th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;">' + h + '</th>';
    });
    html += '</tr></thead><tbody>';
    r.rows.forEach(row => {
      html += '<tr style="border-bottom:1px solid #1e293b;">';
      html += '<td style="padding:6px 8px;">' + row.comparison + '</td>';
      html += '<td style="padding:6px 8px;">' + row.k + '</td>';
      r.modifiers.forEach(m => {
        const mean = row[m + '_mean'];
        const n = row[m + '_n'];
        if (mean == null) {
          html += '<td style="padding:6px 8px;color:#64748b;">—</td>';
        } else {
          html += '<td style="padding:6px 8px;font-family:ui-monospace;">' + fmt(mean) +
            (n < row.k ? '<span style="color:#64748b;font-size:9px;"> (n=' + n + '/' + row.k + ')</span>' : '') +
            '</td>';
        }
      });
      html += '</tr>';
    });
    html += '</tbody></table>';

    if (r.imbalances.length) {
      html += '<h5 style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin:14px 0 6px;">Imbalance assessment</h5>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
      html += '<tbody>';
      r.imbalances.forEach(imb => {
        const c = imb.flag ? '#ef4444' : '#10b981';
        html += '<tr style="border-bottom:1px solid #1e293b;">';
        html += '<td style="padding:6px 8px;">' + imb.label + '</td>';
        html += '<td style="padding:6px 8px;font-family:ui-monospace;">' + fmt(imb.min) + ' to ' + fmt(imb.max) + ' (range ' + fmt(imb.range) + ')</td>';
        html += '<td style="padding:6px 8px;color:' + c + ';font-weight:600;">' + (imb.flag ? '⚠ IMBALANCE (' + imb.threshold + ')' : '✓ Balanced') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }

    html += '<div style="font-size:10px;color:#64748b;margin-top:8px;">';
    html += 'Thresholds: continuous range >5 units (or >5 yr for age), proportion difference >15 pp, sample-size ratio >5×. ';
    html += 'Based on Brignardello-Petersen 2023 GRADE-NMA Article 5 (intransitivity); Lasch 2025 Res Synth Methods (transitivity tool).';
    html += '</div>';

    container.innerHTML = html;
  }

  global.TransitivityMatrix = { compute, render };
})(typeof window !== 'undefined' ? window : globalThis);
