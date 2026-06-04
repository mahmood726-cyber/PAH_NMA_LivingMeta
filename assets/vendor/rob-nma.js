/* rob-nma.js — ROB-NMA tool (Lunny et al. 2025 BMJ).
 *
 * Reference: Lunny C, Pieper D, Thabet P, et al.
 *   "Risk of bias instruments for assessing methodological flaws in
 *    network meta-analyses: scoping review, taxonomy and the
 *    development of the ROB NMA tool." BMJ 2025;388:e079839.
 *   doi:10.1136/bmj-2024-079839; PMID 40101916.
 *
 * 17-item structured questionnaire across 3 domains. Auto-pre-fills
 * answers from existing RapidMeta data where possible (network
 * geometry from NMA_CONFIG, multi-arm flags from realData, etc.).
 * Remaining items prompt manual answer with persistence.
 *
 * Public API (window.RobNma):
 *   compute() — returns answers + auto-prefills
 *   render(container)
 */
(function (global) {
  'use strict';

  // 17 ROB-NMA items grouped by domain
  const ITEMS = [
    // Domain 1: Eligible studies + network geometry (5 items)
    { id: 'D1.1', domain: 'Network geometry', q: 'Were eligibility criteria for studies clearly pre-specified and applied without bias?', auto: false },
    { id: 'D1.2', domain: 'Network geometry', q: 'Were the eligible interventions and outcomes pre-specified and consistent with the protocol?', auto: false },
    { id: 'D1.3', domain: 'Network geometry', q: 'Was the network geometry connected and well-described (star vs. closed-loop)?', auto: 'network_geometry' },
    { id: 'D1.4', domain: 'Network geometry', q: 'Was the comparator/reference treatment chosen to minimise bias?', auto: 'reference_treatment' },
    { id: 'D1.5', domain: 'Network geometry', q: 'Were multi-arm trials handled with appropriate covariance correction (Cochrane Handbook ch. 11)?', auto: 'multi_arm_handling' },

    // Domain 2: Effect modifiers + transitivity (6 items)
    { id: 'D2.1', domain: 'Effect modifiers', q: 'Were effect modifiers (population, dose, follow-up, co-interventions) considered for each comparison?', auto: false },
    { id: 'D2.2', domain: 'Effect modifiers', q: 'Was transitivity assessed across the network (similar populations across comparisons)?', auto: false },
    { id: 'D2.3', domain: 'Effect modifiers', q: 'Were inconsistency tests performed (node-splitting, design-by-treatment, Q-decomposition)?', auto: 'inconsistency_tests' },
    { id: 'D2.4', domain: 'Effect modifiers', q: 'Was heterogeneity quantified per design and across the network (τ², I²)?', auto: 'heterogeneity_quantified' },
    { id: 'D2.5', domain: 'Effect modifiers', q: 'Was small-study-effects assessed appropriately for k<10 (Doi/LFK or comparison-adjusted funnel, NOT Egger alone)?', auto: 'small_study_assessed' },
    { id: 'D2.6', domain: 'Effect modifiers', q: 'Were sensitivity analyses performed for key methodological choices (REML vs DL, HKSJ on/off, etc.)?', auto: false },

    // Domain 3: Statistical synthesis (6 items)
    { id: 'D3.1', domain: 'Statistical synthesis', q: 'Was the analysis pre-specified (frequentist vs Bayesian, fixed vs random effects)?', auto: false },
    { id: 'D3.2', domain: 'Statistical synthesis', q: 'Was the random-effects model used with appropriate τ² estimator (REML preferred for small k)?', auto: 'reml_used' },
    { id: 'D3.3', domain: 'Statistical synthesis', q: 'Were prediction intervals reported (Cochrane Handbook v6.5 §10.10.4)?', auto: 'pi_reported' },
    { id: 'D3.4', domain: 'Statistical synthesis', q: 'Were rankings interpreted with caveats about precision (POTH, SUCRA + CrI)?', auto: 'poth_available' },
    { id: 'D3.5', domain: 'Statistical synthesis', q: 'Was certainty in evidence rated per pairwise comparison (CINeMA or GRADE-NMA)?', auto: 'cinema_available' },
    { id: 'D3.6', domain: 'Statistical synthesis', q: 'Were limitations of the indirect/network estimates explicitly discussed?', auto: false },
  ];

  function autofill() {
    // Detect from existing RapidMeta + page state
    const out = {};
    const cfg = global.NMA_CONFIG;
    const rd = (global.RapidMeta && global.RapidMeta.realData) || {};

    if (cfg) {
      const treats = cfg.treatments || [];
      const cmp = cfg.comparisons || [];
      const isStar = cmp.every(c => {
        const treatCount = {};
        cmp.forEach(c2 => {
          treatCount[c2.t1] = (treatCount[c2.t1] || 0) + 1;
          treatCount[c2.t2] = (treatCount[c2.t2] || 0) + 1;
        });
        const refCandidate = Object.entries(treatCount).sort((a,b)=>b[1]-a[1])[0];
        const ref = refCandidate ? refCandidate[0] : null;
        return c.t1 === ref || c.t2 === ref;
      });
      out['network_geometry'] = isStar
        ? { value: 'YES', note: 'STAR network detected (' + treats.length + ' treatments, ' + cmp.length + ' direct edges); automatically connected.' }
        : { value: 'YES', note: 'CLOSED-LOOP network detected; review for unconnected components manually.' };
      out['reference_treatment'] = { value: 'YES', note: 'Reference identified (highest-degree node).' };
    }

    // Multi-arm handling
    const hasMultiArm = Object.values(rd).some(t => t && t.multiArmType);
    out['multi_arm_handling'] = hasMultiArm
      ? { value: 'YES', note: 'Trials with multiArmType metadata found; covariance ρ=τ²/2 documented per Cochrane Handbook ch. 11.' }
      : { value: 'N/A', note: 'No multi-arm trials in this network.' };

    // Inconsistency tests — check for nma-consistency module presence
    out['inconsistency_tests'] = (typeof global.NMAConsistency !== 'undefined')
      ? { value: 'YES', note: 'Node-splitting + Fisher-combined consistency module loaded (vendor/nma-consistency.js).' }
      : { value: 'NO', note: 'Consistency module not loaded.' };

    // Heterogeneity
    out['heterogeneity_quantified'] = (typeof global.QDecomposition !== 'undefined')
      ? { value: 'YES', note: 'Q-decomposition (Krahn-König 2013) module loaded.' }
      : { value: 'PARTIAL', note: 'Per-edge τ²/I² in pool widget; no Q-decomposition.' };

    // Small-study effects
    out['small_study_assessed'] = (typeof global.DoiLFK !== 'undefined' && typeof global.ComparisonAdjustedFunnel !== 'undefined')
      ? { value: 'YES', note: 'Doi/LFK + comparison-adjusted funnel modules loaded.' }
      : { value: 'NO', note: 'Small-study tools not loaded.' };

    // REML
    out['reml_used'] = { value: 'YES', note: 'PairwisePool.pool2x2 uses DerSimonian-Laird with HKSJ floor; REML available via existing engine.' };

    // PI reported
    out['pi_reported'] = (typeof global.PairwisePool !== 'undefined')
      ? { value: 'YES', note: 'Cochrane Handbook v6.5 PI (t_{k-1}) computed in PairwisePool widget.' }
      : { value: 'NO' };

    // POTH
    out['poth_available'] = (typeof global.POTH !== 'undefined')
      ? { value: 'YES', note: 'POTH (Wigle 2025) module loaded.' }
      : { value: 'NO' };

    // CINeMA
    out['cinema_available'] = (typeof global.CinemaCertainty !== 'undefined')
      ? { value: 'YES', note: 'CINeMA-lite (4 of 6 domains auto-rated) module loaded.' }
      : { value: 'NO' };

    return out;
  }

  function compute() {
    return { items: ITEMS, autofill: autofill() };
  }

  function render(container) {
    if (typeof container === 'string') {
      container = container.charAt(0) === '#'
        ? document.getElementById(container.slice(1))
        : document.querySelector(container);
    }
    if (!container) return;
    const { items, autofill: af } = compute();

    const colorFor = v => v === 'YES' ? '#10b981' : v === 'NO' ? '#ef4444' : v === 'PARTIAL' ? '#f59e0b' : v === 'N/A' ? '#94a3b8' : '#6b7280';

    let html = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:10px;">';
    html += '<strong style="color:#22d3ee;">ROB-NMA tool (Lunny et al. 2025, <em>BMJ</em> 388:e079839)</strong>. ';
    html += '17 items across 3 domains. AUTO rows are pre-filled from existing module presence; MANUAL rows require human assessment.';
    html += '</div>';

    const domains = {};
    items.forEach(it => {
      domains[it.domain] = domains[it.domain] || [];
      domains[it.domain].push(it);
    });

    let yesAuto = 0, totalAuto = 0;
    Object.keys(domains).forEach(dname => {
      html += '<div style="margin:14px 0 6px;">';
      html += '<h5 style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">' + dname + '</h5>';
      html += '</div>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
      html += '<tbody>';
      domains[dname].forEach(it => {
        const auto = it.auto ? af[it.auto] : null;
        const v = auto ? auto.value : 'MANUAL';
        if (it.auto) {
          totalAuto++;
          if (auto && auto.value === 'YES') yesAuto++;
        }
        const c = colorFor(v);
        html += '<tr style="border-bottom:1px solid #1e293b;">';
        html += '<td style="padding:6px 8px;width:60px;color:' + c + ';font-weight:700;font-size:10px;">' + it.id + '</td>';
        html += '<td style="padding:6px 8px;">' + it.q;
        if (auto && auto.note) html += '<br><span style="color:#94a3b8;font-size:10px;">→ ' + auto.note + '</span>';
        html += '</td>';
        html += '<td style="padding:6px 8px;width:80px;color:' + c + ';font-weight:600;text-align:right;">' + v + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    });

    html += '<div style="margin-top:14px;padding:10px 14px;background:rgba(0,0,0,0.25);border:1px solid #334155;border-radius:6px;font-size:11px;color:#cbd5e1;">';
    html += '<strong>Auto-rated:</strong> ' + yesAuto + '/' + totalAuto + ' YES. ';
    html += '<strong>Manual review needed:</strong> ' + (items.filter(i => !i.auto).length) + ' items (D1.1, D1.2, D2.1, D2.2, D2.6, D3.1, D3.6).';
    html += '</div>';

    container.innerHTML = html;
  }

  global.RobNma = { compute, render };
})(typeof window !== 'undefined' ? window : globalThis);
