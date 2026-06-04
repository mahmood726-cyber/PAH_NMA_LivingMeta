/* Subgroup interaction test — Cochrane Handbook v6.5 §10.11.4.
 *
 * Splits trials by year-band (pre-2015 vs ≥2015) and by sample-size
 * (above vs below median total N), pools log-OR within each subgroup,
 * and computes a between-subgroup Q-statistic with χ² test for the
 * subgroup × treatment interaction (Borenstein 2009; Higgins/Thompson
 * StatMed 2002).
 *
 * Reports: per-subgroup pooled OR (95% CI), Q_between, df, p-value.
 * Flags significant interaction (p < 0.05) as a yellow alert — calls
 * for stratified interpretation.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'subgroup-interaction-expanded';

  // Chi-square CDF approximation via regularised gamma (Wilson–Hilferty)
  function chi2CDF(x, df) {
    if (x <= 0) return 0;
    if (df <= 0) return 0;
    // Wilson–Hilferty cube-root normal approximation
    const z = (Math.cbrt(x / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
    return normalCDF(z);
  }
  function normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804 * Math.exp(-z * z / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    p = z > 0 ? 1 - p : p;
    return p;
  }

  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d };
  }

  function poolGroup(points) {
    if (!points || points.length === 0) return null;
    let W = 0, WY = 0;
    points.forEach(p => { const w = 1/p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    let Q = 0;
    points.forEach(p => { const w = 1/p.vi; Q += w * (p.yi - yFE) * (p.yi - yFE); });
    const df = points.length - 1;
    const sumW2 = points.reduce((s, p) => s + Math.pow(1/p.vi, 2), 0);
    const c = W - sumW2 / W;
    const tau2 = points.length > 1 ? Math.max(0, (Q - df) / c) : 0;
    let W2 = 0, WY2 = 0;
    points.forEach(p => { const w = 1/(p.vi + tau2); W2 += w; WY2 += w * p.yi; });
    const yRE = WY2 / W2;
    const seRE = Math.sqrt(1/W2);
    return {
      yi: yRE, se: seRE, OR: Math.exp(yRE),
      ci_low: Math.exp(yRE - 1.96 * seRE),
      ci_high: Math.exp(yRE + 1.96 * seRE),
      Q, df, tau2, W: W, k: points.length,
    };
  }

  function subgroupTest(groups) {
    // groups: { label: pool }
    const labels = Object.keys(groups);
    const valid = labels.filter(l => groups[l] && groups[l].k > 0);
    if (valid.length < 2) return null;
    // Q_between = Σ_j W_j * (θ_j − θ̄)²
    // where W_j is the inverse of the random-effects variance of each subgroup pool
    let totalW = 0, totalWY = 0;
    valid.forEach(l => {
      const g = groups[l];
      const w = 1 / (g.se * g.se);
      totalW += w;
      totalWY += w * g.yi;
    });
    const yPooled = totalWY / totalW;
    let Qb = 0;
    valid.forEach(l => {
      const g = groups[l];
      const w = 1 / (g.se * g.se);
      Qb += w * (g.yi - yPooled) * (g.yi - yPooled);
    });
    const df = valid.length - 1;
    const p = 1 - chi2CDF(Qb, df);
    return { Qb, df, p, k_groups: valid.length };
  }

  function buildBody(P, results) {
    const fmt = P.fmt;
    let html = '';

    // Headline alerts for any significant interaction
    const sig = results.filter(r => r.test && r.test.p < 0.05);
    if (sig.length > 0) {
      const names = sig.map(s => s.label).join(', ');
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
            + '⚠ Significant interaction in: <strong>' + names + '</strong> — interpret pooled estimate cautiously across subgroups.'
            + '</div>';
    } else if (results.some(r => r.test)) {
      html += '<div style="background:#0e3a1f;border:1px solid #34d399;color:#34d399;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
            + '✓ No significant subgroup × treatment interaction (p ≥ 0.05) on tested splits.'
            + '</div>';
    } else {
      html += '<div style="background:#0b1220;border:1px solid #1e293b;color:#94a3b8;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
            + 'Insufficient subgroup data for interaction test (need ≥2 trials per subgroup).'
            + '</div>';
    }

    results.forEach(r => {
      html += '<div style="margin-bottom:14px;">';
      html += '<div style="font-size:11.5px;color:#cbd5e1;font-weight:600;margin-bottom:4px;">'
            + 'Split by ' + r.label + (r.test
              ? ' — Q<sub>between</sub> = ' + fmt(r.test.Qb, 2)
                + ' (df=' + r.test.df + ', p=' + fmt(r.test.p, 3) + ')'
              : ' — insufficient data')
            + '</div>';
      // Per-subgroup table
      html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
      html += '<thead><tr style="color:#64748b;text-align:left;">'
            + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;">Subgroup</th>'
            + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">k</th>'
            + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Pooled OR</th>'
            + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">95% CI</th>'
            + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">τ²</th>'
            + '</tr></thead><tbody>';
      Object.entries(r.groups).forEach(([gLabel, pool]) => {
        if (!pool || pool.k === 0) {
          html += '<tr><td style="padding:3px 6px;color:#94a3b8;">' + gLabel + '</td>'
                + '<td style="padding:3px 6px;text-align:right;color:#475569;">0</td>'
                + '<td colspan="3" style="padding:3px 6px;text-align:right;color:#475569;font-style:italic;">no trials</td></tr>';
          return;
        }
        const sig = (pool.ci_low > 1) || (pool.ci_high < 1);
        const color = sig ? '#7dd3fc' : '#cbd5e1';
        html += '<tr style="border-bottom:1px solid #0b1220;">'
              + '<td style="padding:3px 6px;color:#e2e8f0;">' + gLabel + '</td>'
              + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + pool.k + '</td>'
              + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:' + color + ';">' + fmt(pool.OR, 2) + '</td>'
              + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(pool.ci_low, 2) + '–' + fmt(pool.ci_high, 2) + '</td>'
              + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#94a3b8;">' + fmt(pool.tau2, 3) + '</td>'
              + '</tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
    });

    // Method note
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> within each subgroup, log-OR pooled via DerSimonian–Laird random effects. '
          + 'Q<sub>between</sub> = Σ w<sub>j</sub>(θ̂<sub>j</sub> − θ̂<sub>pooled</sub>)² with w<sub>j</sub> = 1/Var(θ̂<sub>j</sub>); '
          + 'tested as χ² on (J−1) df. <strong>Interpretation:</strong> p < 0.05 indicates the treatment effect '
          + 'differs significantly between subgroups — pooled estimate may mask real heterogeneity. '
          + 'Cochrane Handbook v6.5 §10.11.4; Borenstein <em>Introduction to Meta-Analysis</em> 2009.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 4) return false;

    // Pull year per trial from realData
    const byName = {};
    Object.values(rd).forEach(t => {
      if (t && t.name) byName[t.name] = t;
    });
    trials.forEach(t => {
      const r = byName[t.name];
      t.year = r && r.year ? +r.year : null;
      t.totalN = (t.n1i || 0) + (t.n2i || 0);
    });

    function points(filter) {
      return trials.filter(filter).map(trialLogOR);
    }

    const results = [];

    // Split by year (pre-2015 vs ≥2015)
    const hasYears = trials.filter(t => t.year).length;
    if (hasYears >= 2) {
      const groups = {
        'Pre-2015': poolGroup(points(t => t.year && t.year < 2015)),
        '≥2015':    poolGroup(points(t => t.year && t.year >= 2015)),
      };
      results.push({
        label: 'enrolment year',
        groups,
        test: subgroupTest(groups),
      });
    }

    // Split by total N (above vs below median)
    const allN = trials.map(t => t.totalN).filter(n => n > 0).sort((a,b) => a-b);
    if (allN.length >= 4) {
      const median = allN[Math.floor(allN.length / 2)];
      const smallKey = 'Small (N<' + median + ')';
      const largeKey = 'Large (N≥' + median + ')';
      const groups = {};
      groups[smallKey] = poolGroup(points(t => t.totalN < median));
      groups[largeKey] = poolGroup(points(t => t.totalN >= median));
      results.push({
        label: 'sample size (median split)',
        groups,
        test: subgroupTest(groups),
      });
    }

    if (results.length === 0) return false;

    // Summary line — most informative test
    const sigTest = results.find(r => r.test && r.test.p < 0.05);
    const summary = sigTest
      ? '⚠ ' + sigTest.label + ' interaction p=' + P.fmt(sigTest.test.p, 3)
      : '✓ no significant interaction across ' + results.length + ' splits';

    const panel = P.buildCollapsiblePanel({
      id: 'subgroup-interaction-panel',
      badge: 'Subgroup',
      summary,
      bodyHtml: buildBody(P, results),
      storageKey: STORAGE_KEY,
    });

    const existing = document.getElementById('subgroup-interaction-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 800));
    } else {
      setTimeout(tick, 800);
    }
  }

  global.SubgroupInteraction = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
