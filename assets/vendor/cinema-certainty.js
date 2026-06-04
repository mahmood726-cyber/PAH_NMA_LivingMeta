/* cinema-certainty.js — Auto-CINeMA per-pairwise certainty rating.
 *
 * CINeMA (Confidence In Network Meta-Analysis): community-standard 6-domain
 * framework for rating certainty in NMA pairwise estimates (Nikolakopoulou
 * 2020, PLOS Med). Mirrors the NMA Pro v8 cinemaResults engine.
 *
 * Six domains:
 *   1. Within-study bias (RoB-2)         — MANUAL (we don't auto-fill;
 *                                          render shows blank for human)
 *   2. Reporting bias                    — AUTO (Doi/LFK + Egger if k≥4)
 *   3. Indirectness                      — MANUAL (transitivity judgment)
 *   4. Imprecision                       — AUTO (CrI width on log scale)
 *   5. Heterogeneity                     — AUTO (I² + τ²)
 *   6. Incoherence (NMA-only)            — AUTO (node-split p)
 *
 * Each domain rates: no concerns / some concerns / major concerns.
 * Overall certainty derived by stepping down from "high":
 *   no major concerns         → HIGH
 *   1 some / 0 major          → MODERATE
 *   2 some, or 1 major        → LOW
 *   ≥3 some or ≥2 major       → VERY LOW
 *
 * Public API (window.CinemaCertainty):
 *   rateEdge(edge_pool, opts) → {domains: {...}, overall: 'HIGH'|...}
 *   render(container, edges_with_ratings)
 */
(function (global) {
  'use strict';

  function rateImprecision(mu, ci_lo, ci_hi) {
    // Width of 95% CI on log scale
    if (!isFinite(ci_lo) || !isFinite(ci_hi) || ci_lo <= 0 || ci_hi <= 0) {
      return { rating: 'unclear', note: 'CI not estimable' };
    }
    const log_width = Math.log(ci_hi) - Math.log(ci_lo);
    if (log_width < 0.5) return { rating: 'no concerns', note: 'log-CI width < 0.5' };
    if (log_width < 1.0) return { rating: 'some concerns', note: 'log-CI width 0.5–1.0' };
    return { rating: 'major concerns', note: 'log-CI width ≥ 1.0' };
  }

  function rateHeterogeneity(I2, tau2) {
    if (I2 == null) return { rating: 'unclear', note: 'I² not estimable' };
    if (I2 < 25) return { rating: 'no concerns', note: 'I²=' + I2.toFixed(0) + '%' };
    if (I2 < 50) return { rating: 'no concerns', note: 'I²=' + I2.toFixed(0) + '%' };
    if (I2 < 75) return { rating: 'some concerns', note: 'I²=' + I2.toFixed(0) + '% (moderate)' };
    return { rating: 'major concerns', note: 'I²=' + I2.toFixed(0) + '% (high)' };
  }

  function rateIncoherence(splitP, isStar) {
    if (isStar) return { rating: 'no test', note: 'star network — no closed loop' };
    if (splitP == null) return { rating: 'no test', note: 'no node-split available' };
    if (splitP > 0.10) return { rating: 'no concerns', note: 'split p=' + splitP.toFixed(2) };
    if (splitP > 0.05) return { rating: 'some concerns', note: 'split p=' + splitP.toFixed(2) };
    return { rating: 'major concerns', note: 'split p=' + splitP.toFixed(3) };
  }

  function rateReportingBias(lfk, eggerP, k) {
    if (k < 4) return { rating: 'unclear', note: 'k<4 — bias tests undefined' };
    // Prefer LFK for k<10
    if (lfk != null) {
      const aLFK = Math.abs(lfk);
      if (aLFK < 1) return { rating: 'no concerns', note: '|LFK|=' + aLFK.toFixed(2) };
      if (aLFK < 2) return { rating: 'some concerns', note: '|LFK|=' + aLFK.toFixed(2) };
      return { rating: 'major concerns', note: '|LFK|=' + aLFK.toFixed(2) };
    }
    if (eggerP != null) {
      if (eggerP > 0.10) return { rating: 'no concerns', note: 'Egger p=' + eggerP.toFixed(2) };
      return { rating: 'some concerns', note: 'Egger p=' + eggerP.toFixed(2) };
    }
    return { rating: 'unclear', note: 'no bias test' };
  }

  function deriveOverall(domains) {
    const ratings = Object.values(domains).map(d => d.rating);
    const major = ratings.filter(r => r === 'major concerns').length;
    const some = ratings.filter(r => r === 'some concerns').length;
    if (major >= 2 || some >= 3) return 'VERY LOW';
    if (major === 1 || some >= 2) return 'LOW';
    if (some === 1) return 'MODERATE';
    return 'HIGH';
  }

  function rateEdge(edge_pool, opts) {
    opts = opts || {};
    const domains = {
      within_study: { rating: 'manual', note: 'requires per-trial RoB-2 review' },
      reporting_bias: rateReportingBias(opts.lfk, opts.eggerP, edge_pool ? edge_pool.k : 0),
      indirectness: { rating: 'manual', note: 'requires PICO transitivity review' },
      imprecision: edge_pool
        ? rateImprecision(edge_pool.mu, edge_pool.ci_lo, edge_pool.ci_hi)
        : { rating: 'unclear', note: 'no estimate' },
      heterogeneity: edge_pool
        ? rateHeterogeneity(edge_pool.I2, edge_pool.tau2)
        : { rating: 'unclear', note: 'no estimate' },
      incoherence: rateIncoherence(opts.splitP, opts.isStar),
    };
    return { domains, overall: deriveOverall(domains) };
  }

  function render(container, edges, opts) {
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    if (!edges || !edges.length) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:8px;">No edges to rate.</div>';
      return;
    }
    opts = opts || {};

    const tierColor = {
      'HIGH': '#10b981',
      'MODERATE': '#3b82f6',
      'LOW': '#f59e0b',
      'VERY LOW': '#ef4444',
    };
    const concernColor = {
      'no concerns': '#10b981',
      'some concerns': '#f59e0b',
      'major concerns': '#ef4444',
      'manual': '#94a3b8',
      'unclear': '#94a3b8',
      'no test': '#94a3b8',
    };

    let html = '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
    html += '<thead><tr style="border-bottom:1px solid #334155;">';
    ['Edge', 'WSB*', 'Reporting bias', 'Indirect.*', 'Imprecision', 'Heterogeneity', 'Incoherence', 'Certainty']
      .forEach(h => {
        html += '<th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;">' + h + '</th>';
      });
    html += '</tr></thead><tbody>';

    edges.forEach(e => {
      const r = e.rating;
      const ov = r.overall;
      const ovColor = tierColor[ov] || '#94a3b8';
      html += '<tr style="border-bottom:1px solid #1e293b;">';
      html += '<td style="padding:6px 8px;">' + (e.label || (e.t1 + ' vs ' + e.t2)) + '</td>';
      ['within_study', 'reporting_bias', 'indirectness', 'imprecision', 'heterogeneity', 'incoherence']
        .forEach(d => {
          const dom = r.domains[d];
          const c = concernColor[dom.rating] || '#94a3b8';
          html += '<td style="padding:6px 8px;color:' + c + ';" title="' + dom.note.replace(/"/g, '&quot;') + '">';
          html += dom.rating === 'manual' ? '—' : (dom.rating === 'no concerns' ? '○' : dom.rating === 'some concerns' ? '◐' : dom.rating === 'major concerns' ? '●' : '?');
          html += '</td>';
        });
      html += '<td style="padding:6px 8px;font-weight:700;color:' + ovColor + ';">' + ov + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '<div style="font-size:10px;color:#64748b;margin-top:8px;">';
    html += '* WSB (within-study bias) and Indirectness require manual review of RoB-2 per trial and PICO transitivity. ';
    html += 'Auto-rated domains: reporting bias (LFK/Egger), imprecision (log-CI width), heterogeneity (I²), incoherence (node-split p). ';
    html += 'Hover over each cell for the underlying value. Overall certainty steps down from HIGH per CINeMA rules: ';
    html += '0 issues=HIGH, 1 some=MODERATE, 2 some or 1 major=LOW, ≥3 some or ≥2 major=VERY LOW.';
    html += '</div>';

    container.innerHTML = html;
  }

  global.CinemaCertainty = { rateEdge, render };
})(typeof window !== 'undefined' ? window : globalThis);
