/* GRIM (Granularity-Related Inconsistency of Means) + Benford's first-digit
 * data-integrity check for continuous outcomes.
 *
 * GRIM (Brown & Heathers, SAGE OPMR 2017): given an integer N and a mean M
 * reported to D decimal places, M must equal round(X/N, D) for some integer
 * X in [0, N*max_plausible]. If no such X exists within rounding tolerance,
 * the mean is "GRIM-inconsistent" — either misreported or the underlying
 * scale isn't actually integer-valued.
 *
 * Benford's Law (first significant digit ~ log10(1+1/d)): for log-distributed
 * empirical quantities (sample sizes, doses, biomarker concentrations), the
 * first digit follows Benford's distribution. Strong departure (χ² p<0.01)
 * is a fabrication signal, but small samples are unreliable.
 *
 * Reference: Brown NJL, Heathers JAJ. The GRIM test: a simple technique
 * detects numerous anomalies in the reporting of results in psychology.
 * Soc Psychol Personal Sci 2017;8:363-9.
 *
 * Applies to continuous outcomes only. Auto-bootstrap, collapsed.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'grim-benford-expanded';

  // GRIM check: returns { consistent, expected_X, message }
  // assumes underlying integer scores (Likert, counts) — only flag when
  // values strongly suggest integer scale; quietly pass when scale unclear.
  function grimCheck(mean, n, decimals) {
    if (!(n > 0) || !Number.isFinite(mean) || decimals < 0) return null;
    if (n > 1000) return null; // GRIM is only useful for n where granularity matters
    const tol = Math.pow(10, -decimals) / 2 * 1.0001;
    // Try integer numerators around mean*n
    const target = mean * n;
    const lo = Math.floor(target) - 1;
    const hi = Math.ceil(target) + 1;
    for (let X = lo; X <= hi; X++) {
      const candMean = X / n;
      const rounded = Math.round(candMean * Math.pow(10, decimals)) / Math.pow(10, decimals);
      if (Math.abs(rounded - mean) < tol) return { consistent: true, expected_X: X };
    }
    return { consistent: false, expected_X: null,
             message: 'No integer X in [' + lo + ', ' + hi + '] yields mean ' + mean.toFixed(decimals) + ' for N=' + n };
  }

  function decimalsOf(mean) {
    const s = String(mean);
    if (s.indexOf('.') < 0) return 0;
    return Math.min(6, s.length - s.indexOf('.') - 1);
  }

  function looksIntegerScale(mean) {
    // Heuristic: scale plausibly integer if mean is in [0, 100] and reported
    // to 1-2 decimals. Outside this, GRIM unreliable.
    return mean >= 0 && mean <= 100;
  }

  // First-digit Benford
  function firstDigit(x) {
    const a = Math.abs(x);
    if (!(a > 0 && isFinite(a))) return null;
    let v = a;
    while (v < 1) v *= 10;
    while (v >= 10) v /= 10;
    return Math.floor(v);
  }
  const BENFORD = [
    Math.log10(2), Math.log10(3/2), Math.log10(4/3), Math.log10(5/4),
    Math.log10(6/5), Math.log10(7/6), Math.log10(8/7), Math.log10(9/8), Math.log10(10/9),
  ];
  function chi2Test(observed, expectedFracs, n) {
    let chi2 = 0;
    for (let i = 0; i < observed.length; i++) {
      const e = expectedFracs[i] * n;
      if (e > 0) chi2 += Math.pow(observed[i] - e, 2) / e;
    }
    // 8 df. Wilson–Hilferty for chi² p
    const df = 8;
    if (chi2 <= 0) return 1;
    const z = Math.pow(chi2/df, 1/3) - (1 - 2/(9*df));
    const denom = Math.sqrt(2/(9*df));
    const zScore = z / denom;
    // 1 − Φ(zScore) → upper-tail
    const az = Math.abs(zScore);
    const t = 1 / (1 + 0.2316419 * az);
    const d = 0.3989422804014327 * Math.exp(-0.5 * az * az);
    const upper = d * (0.31938153*t - 0.356563782*t*t + 1.781477937*t*t*t -
                       1.821255978*t*t*t*t + 1.330274429*t*t*t*t*t);
    return zScore >= 0 ? upper : 1 - upper;
  }

  function collectContinuousValues(rd) {
    const grimRows = [];
    const benfordPool = [];
    Object.values(rd || {}).forEach(t => {
      if (!t) return;
      const ao = Array.isArray(t.allOutcomes) ? t.allOutcomes : null;
      const trialName = t.name || '?';
      const tN = +t.tN, cN = +t.cN;
      if (Number.isFinite(tN) && tN > 0) benfordPool.push(tN);
      if (Number.isFinite(cN) && cN > 0) benfordPool.push(cN);
      if (ao) {
        ao.forEach(o => {
          if (!o || o.type !== 'CONTINUOUS') return;
          const tMean = +o.tMean, cMean = +o.cMean;
          if (Number.isFinite(tMean) && Number.isFinite(tN) && tN > 0 && looksIntegerScale(tMean)) {
            const d = decimalsOf(o.tMean);
            const r = grimCheck(tMean, tN, d);
            if (r && !r.consistent) grimRows.push({ trial: trialName, arm: 'T', mean: tMean, N: tN, decimals: d, msg: r.message });
          }
          if (Number.isFinite(cMean) && Number.isFinite(cN) && cN > 0 && looksIntegerScale(cMean)) {
            const d = decimalsOf(o.cMean);
            const r = grimCheck(cMean, cN, d);
            if (r && !r.consistent) grimRows.push({ trial: trialName, arm: 'C', mean: cMean, N: cN, decimals: d, msg: r.message });
          }
          if (Number.isFinite(tMean)) benfordPool.push(Math.abs(tMean));
          if (Number.isFinite(cMean)) benfordPool.push(Math.abs(cMean));
          const tSd = +o.tSD, cSd = +o.cSD;
          if (Number.isFinite(tSd) && tSd > 0) benfordPool.push(tSd);
          if (Number.isFinite(cSd) && cSd > 0) benfordPool.push(cSd);
        });
      }
    });
    return { grimRows, benfordPool };
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const { grimRows, benfordPool } = collectContinuousValues(rd);

    // Need either some continuous data OR enough Benford values to test
    if (benfordPool.length < 8 && grimRows.length === 0) {
      // Not enough data — don't render the panel for binary-only reviews
      return false;
    }

    const counts = new Array(9).fill(0);
    benfordPool.forEach(v => {
      const d = firstDigit(v);
      if (d != null && d >= 1 && d <= 9) counts[d-1]++;
    });
    const nB = counts.reduce((a, b) => a + b, 0);
    const benfordP = nB >= 30 ? chi2Test(counts, BENFORD, nB) : null;

    const grimFlag = grimRows.length > 0;
    const benfordSuspicious = benfordP != null && benfordP < 0.01;
    const flagCount = (grimFlag ? grimRows.length : 0) + (benfordSuspicious ? 1 : 0);

    const summary = 'GRIM ' + (grimFlag ? '⚠ ' + grimRows.length + ' inconsistencies' : '✓ pass') +
                    ' · Benford ' + (benfordP == null ? 'n=' + nB + ' too few' : (benfordSuspicious ? '⚠ p=' + benfordP.toFixed(3) : '✓ p=' + benfordP.toFixed(3)));

    let body = '<div style="font-size:11px;color:#cbd5e1;line-height:1.6;">';
    body += '<div style="color:#7dd3fc;font-size:11px;font-weight:700;margin-top:4px;">GRIM (Granularity-Related Inconsistency of Means)</div>';
    if (grimRows.length === 0) {
      body += '<div style="color:#22c55e;padding:4px 0;">✓ All continuous means consistent with reported N (or scale not plausibly integer)</div>';
    } else {
      body += '<table style="width:100%;border-collapse:collapse;font-family:JetBrains Mono,monospace;font-size:10.5px;margin:6px 0;">';
      body += '<thead><tr style="color:#94a3b8;"><th style="padding:4px 6px;text-align:left;">Trial</th><th style="padding:4px 6px;text-align:left;">Arm</th><th style="padding:4px 6px;text-align:right;">Mean</th><th style="padding:4px 6px;text-align:right;">N</th><th style="padding:4px 6px;text-align:left;">Issue</th></tr></thead><tbody>';
      grimRows.slice(0, 10).forEach(r => {
        body += '<tr style="border-top:1px solid #1e293b;color:#fbbf24;">' +
                '<td style="padding:3px 6px;">' + r.trial + '</td>' +
                '<td style="padding:3px 6px;">' + r.arm + '</td>' +
                '<td style="padding:3px 6px;text-align:right;">' + r.mean.toFixed(r.decimals) + '</td>' +
                '<td style="padding:3px 6px;text-align:right;">' + r.N + '</td>' +
                '<td style="padding:3px 6px;color:#64748b;font-size:10px;">' + r.msg + '</td>' +
                '</tr>';
      });
      if (grimRows.length > 10) body += '<tr><td colspan="5" style="padding:3px 6px;color:#64748b;font-style:italic;">…and ' + (grimRows.length - 10) + ' more</td></tr>';
      body += '</tbody></table>';
    }

    body += '<div style="color:#7dd3fc;font-size:11px;font-weight:700;margin-top:10px;">Benford\'s Law (first digit, all reported numerics)</div>';
    if (nB < 30) {
      body += '<div style="color:#94a3b8;padding:4px 0;">Insufficient data (n=' + nB + ', need ≥30) — Benford test skipped</div>';
    } else {
      // Mini bar chart
      let chart = '<svg viewBox="0 0 600 100" width="100%" style="background:#0b1220;border-radius:6px;margin:6px 0;">';
      const barW = 50;
      let maxBar = Math.max(...counts.map((c, i) => Math.max(c, BENFORD[i] * nB)));
      for (let d = 1; d <= 9; d++) {
        const x = 30 + (d - 1) * 60;
        const obsH = (counts[d-1] / maxBar) * 75;
        const expH = (BENFORD[d-1] * nB / maxBar) * 75;
        chart += '<rect x="' + x + '" y="' + (85 - obsH) + '" width="' + (barW/2 - 1) + '" height="' + obsH + '" fill="#3b82f6" opacity="0.8" />';
        chart += '<rect x="' + (x + barW/2) + '" y="' + (85 - expH) + '" width="' + (barW/2 - 1) + '" height="' + expH + '" fill="#94a3b8" opacity="0.6" />';
        chart += '<text x="' + (x + barW/2 - 1) + '" y="98" fill="#94a3b8" font-size="10" text-anchor="middle">' + d + '</text>';
      }
      chart += '<text x="20" y="14" fill="#3b82f6" font-size="9">■ observed</text>';
      chart += '<text x="100" y="14" fill="#94a3b8" font-size="9">■ expected (Benford)</text>';
      chart += '<text x="595" y="98" fill="#94a3b8" font-size="9" text-anchor="end">first digit</text>';
      chart += '</svg>';
      body += chart;
      body += '<div style="font-family:JetBrains Mono,monospace;font-size:10.5px;color:#cbd5e1;">' +
              'χ² test (8 df) p = ' + (benfordP == null ? '—' : benfordP.toFixed(4)) +
              ' · n = ' + nB + ' values' +
              (benfordSuspicious ? '  <span style="color:#fbbf24;">⚠ deviation from Benford</span>' : '  <span style="color:#22c55e;">✓ consistent with Benford</span>') +
              '</div>';
    }

    body +=
      '<div style="margin-top:10px;font-size:10.5px;color:#64748b;line-height:1.5;">' +
      '<strong>What these flag:</strong> GRIM ⚠ means a reported integer-scale mean × its N can\'t round to the printed value — typically a transcription error, ' +
      'occasionally fabrication. Benford ⚠ means the first-digit distribution of reported numerics is far from log-distributed expectations — useful only with n≥30 ' +
      'and only suggestive on its own. <strong>Limits:</strong> GRIM applies to integer-scale outcomes (Likert, counts); irrelevant for continuous biomarkers measured ' +
      'with arbitrary precision. References: ' +
      '<a href="https://doi.org/10.1177/1948550616673876" style="color:#7dd3fc;text-decoration:none;">Brown & Heathers SPPS 2017</a>; ' +
      '<a href="https://en.wikipedia.org/wiki/Benford%27s_law" style="color:#7dd3fc;text-decoration:none;">Benford 1938</a>.' +
      '</div></div>';

    const panel = P.buildCollapsiblePanel({
      id: 'grim-benford-panel',
      badge: 'GRIM + Benford integrity',
      summary,
      bodyHtml: body,
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('grim-benford-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 2150));
    } else { setTimeout(tick, 2150); }
  }

  global.GrimBenford = { render, grimCheck, BENFORD };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
