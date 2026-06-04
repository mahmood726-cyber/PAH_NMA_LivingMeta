/* GRADE per-comparison certainty for NMA (Brignardello-Petersen 2023).
 *
 * Reference: Brignardello-Petersen R, Florez ID, Izcovich A, et al. GRADE
 * approach to drawing conclusions from a network meta-analysis using a
 * minimally contextualised framework. BMJ 2020;371:m3900.
 *
 * For each pairwise comparison in the NMA, start at HIGH and downgrade for:
 *   – Imprecision: 95% CrI/CI crosses null (1 for OR/RR; 0 for RD/MD).
 *   – Sparse direct evidence: k_direct < 2 → −1 imprecision.
 *   – Inconsistency: τ² above moderate threshold (>0.04 for log-OR ≈ I²>50%).
 *   – Indirectness: marked manual when comparison is indirect-only.
 *   – Reporting bias: starts at "manual" — reviewers must assess.
 *
 * Output: one row per comparison with rating ⊕⊕⊕⊕ HIGH / ⊕⊕⊕⊖ MODERATE /
 *         ⊕⊕⊖⊖ LOW / ⊕⊖⊖⊖ VERY LOW.
 *
 * NMA-only. Auto-bootstrap, collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'grade-nma-comparison-expanded';
  const TAU2_HI = 0.16;   // log-OR — corresponds to substantial heterogeneity
  const TAU2_MOD = 0.04;  // log-OR — moderate

  function ratingDots(downgrades) {
    const lvl = Math.max(0, 4 - downgrades);
    const filled = '⊕'.repeat(lvl);
    const empty = '⊖'.repeat(4 - lvl);
    const labels = { 4: 'HIGH', 3: 'MODERATE', 2: 'LOW', 1: 'VERY LOW', 0: 'VERY LOW' };
    const colours = { 4: '#22c55e', 3: '#3b82f6', 2: '#f59e0b', 1: '#ef4444', 0: '#ef4444' };
    return { glyph: filled + empty, label: labels[lvl], colour: colours[lvl] };
  }

  function trialLogOR(t) {
    let ai = +t.tE, ci = +t.cE, n1 = +t.tN, n2 = +t.cN;
    if (!(n1 > 0 && n2 > 0 && ai >= 0 && ci >= 0 && ai <= n1 && ci <= n2)) return null;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    return { yi: Math.log((ai*(n2-ci))/((n1-ai)*ci)),
             vi: 1/ai + 1/(n1-ai) + 1/ci + 1/(n2-ci) };
  }

  function poolPair(pts) {
    if (pts.length === 0) return null;
    if (pts.length === 1) {
      const p = pts[0];
      return { yi: p.yi, se: Math.sqrt(p.vi),
               ci_lo: p.yi - 1.96*Math.sqrt(p.vi),
               ci_hi: p.yi + 1.96*Math.sqrt(p.vi),
               k: 1, tau2: 0 };
    }
    let W = 0, WY = 0;
    pts.forEach(p => { const w = 1/p.vi; W += w; WY += w*p.yi; });
    const yFE = WY/W;
    let Q = 0;
    pts.forEach(p => { const w = 1/p.vi; Q += w*Math.pow(p.yi - yFE, 2); });
    const df = pts.length - 1;
    const sumW2 = pts.reduce((s, p) => s + Math.pow(1/p.vi, 2), 0);
    const c = W - sumW2/W;
    const tau2 = Math.max(0, (Q - df)/c);
    let W2 = 0, WY2 = 0;
    pts.forEach(p => { const w = 1/(p.vi + tau2); W2 += w; WY2 += w*p.yi; });
    const yRE = WY2/W2;
    const seRE = Math.sqrt(1/W2);
    return { yi: yRE, se: seRE,
             ci_lo: yRE - 1.96*seRE, ci_hi: yRE + 1.96*seRE,
             k: pts.length, tau2 };
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !P.isNMA()) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const cfg = global.NMA_CONFIG;
    if (!cfg || !cfg.treatments || cfg.treatments.length < 2) return false;

    // Use cfg.comparisons (preferred — already enumerates direct contrasts).
    // Fallback: derive from per-trial arm labels (rare on this engine).
    const pairs = new Map();
    if (Array.isArray(cfg.comparisons) && cfg.comparisons.length > 0) {
      cfg.comparisons.forEach(comp => {
        if (!comp || !comp.t1 || !comp.t2) return;
        const [a, b] = [comp.t1, comp.t2].sort();
        const key = a + ' || ' + b;
        if (!pairs.has(key)) pairs.set(key, { a, b, trials: [] });
        (comp.trials || []).forEach(ref => {
          const t = (typeof ref === 'string' && rd[ref]) ? rd[ref] : ref;
          const lo = t ? trialLogOR(t) : null;
          if (!lo) return;
          // Orient for "a vs b" — flip sign if comp's t1 is the "b" of sorted pair
          const oriented = (comp.t1 === a)
            ? { yi: lo.yi, vi: lo.vi }
            : { yi: -lo.yi, vi: lo.vi };
          pairs.get(key).trials.push(oriented);
        });
      });
    } else {
      // Fallback: per-trial arm labels
      Object.values(rd).forEach(t => {
        const tArm = t.tArm || t.tArm_norm || t.t || t.treatment;
        const cArm = t.cArm || t.cArm_norm || t.c || t.comparator;
        if (!tArm || !cArm) return;
        const lo = trialLogOR(t);
        if (!lo) return;
        const [a, b] = [tArm, cArm].sort();
        const key = a + ' || ' + b;
        if (!pairs.has(key)) pairs.set(key, { a, b, trials: [] });
        const oriented = (tArm === a)
          ? { yi: lo.yi, vi: lo.vi }
          : { yi: -lo.yi, vi: lo.vi };
        pairs.get(key).trials.push(oriented);
      });
    }

    // Drop pairs with no usable trials
    const keysToDelete = [];
    pairs.forEach((p, k) => { if (p.trials.length === 0) keysToDelete.push(k); });
    keysToDelete.forEach(k => pairs.delete(k));

    if (pairs.size === 0) return false;

    const rows = [];
    pairs.forEach((p, key) => {
      const pool = poolPair(p.trials);
      if (!pool) return;
      let downgrades = 0;
      const reasons = [];

      // Imprecision: CI crosses null (log-OR null = 0)
      if (pool.ci_lo < 0 && pool.ci_hi > 0) { downgrades++; reasons.push('CI crosses null'); }
      // Sparse direct evidence
      if (pool.k < 2) { downgrades++; reasons.push('k_direct=' + pool.k); }
      // Inconsistency proxy: τ²
      if (pool.tau2 >= TAU2_HI) { downgrades += 2; reasons.push('τ²=' + pool.tau2.toFixed(3) + ' (high)'); }
      else if (pool.tau2 >= TAU2_MOD) { downgrades++; reasons.push('τ²=' + pool.tau2.toFixed(3) + ' (mod)'); }

      // Cap downgrades at 3 (we never go below VERY LOW)
      const r = ratingDots(Math.min(3, downgrades));
      rows.push({
        a: p.a, b: p.b, k: pool.k,
        OR: Math.exp(pool.yi),
        ci_lo: Math.exp(pool.ci_lo), ci_hi: Math.exp(pool.ci_hi),
        tau2: pool.tau2,
        rating: r.label, glyph: r.glyph, colour: r.colour,
        reasons: reasons.length ? reasons.join('; ') : '—',
      });
    });

    if (rows.length === 0) return false;
    rows.sort((x, y) => (y.k - x.k) || (x.a + x.b).localeCompare(y.a + y.b));

    const summary = rows.length + ' direct comparison' + (rows.length === 1 ? '' : 's') + ' rated';

    let body = '<div style="font-size:11px;color:#cbd5e1;line-height:1.55;">';
    body += '<table style="width:100%;border-collapse:collapse;font-family:JetBrains Mono,monospace;font-size:10.5px;">';
    body += '<thead><tr style="background:#0b1220;color:#94a3b8;">' +
            '<th style="padding:5px 8px;text-align:left;">Comparison (a vs b)</th>' +
            '<th style="padding:5px 8px;text-align:right;">k</th>' +
            '<th style="padding:5px 8px;text-align:right;">OR (95% CI)</th>' +
            '<th style="padding:5px 8px;text-align:right;">τ²</th>' +
            '<th style="padding:5px 8px;text-align:left;">Certainty</th>' +
            '<th style="padding:5px 8px;text-align:left;color:#64748b;">Downgrades</th>' +
            '</tr></thead><tbody>';
    rows.forEach(r => {
      body += '<tr style="border-top:1px solid #1e293b;">' +
              '<td style="padding:4px 8px;color:#cbd5e1;">' + r.a + ' vs ' + r.b + '</td>' +
              '<td style="padding:4px 8px;text-align:right;color:#7dd3fc;">' + r.k + '</td>' +
              '<td style="padding:4px 8px;text-align:right;color:#7dd3fc;">' +
              r.OR.toFixed(2) + ' [' + r.ci_lo.toFixed(2) + ', ' + r.ci_hi.toFixed(2) + ']</td>' +
              '<td style="padding:4px 8px;text-align:right;color:#94a3b8;">' + r.tau2.toFixed(3) + '</td>' +
              '<td style="padding:4px 8px;color:' + r.colour + ';font-weight:600;">' +
              r.glyph + ' ' + r.rating + '</td>' +
              '<td style="padding:4px 8px;color:#64748b;font-size:10px;">' + r.reasons + '</td>' +
              '</tr>';
    });
    body += '</tbody></table>';
    body +=
      '<div style="margin-top:10px;font-size:10.5px;color:#64748b;line-height:1.5;">' +
      '<strong>Method (Brignardello-Petersen et al. BMJ 2020;371:m3900):</strong> ' +
      'minimum-contextualised framework — start each direct comparison at HIGH, downgrade by domain. ' +
      'This panel auto-flags <em>imprecision</em> (95% CI crosses null), ' +
      '<em>sparse direct evidence</em> (k<2), and <em>inconsistency</em> via τ² thresholds (mod ≥ 0.04, high ≥ 0.16 for log-OR). ' +
      '<em>Indirectness</em>, <em>RoB</em>, and <em>publication bias</em> require the GRADE-SoF panel + reviewer judgement. ' +
      'Indirect-only contrasts (no head-to-head trial) are not shown — those need network-level loop inconsistency tests (node-splitting).' +
      '</div></div>';

    const panel = P.buildCollapsiblePanel({
      id: 'grade-nma-comparison-panel',
      badge: 'GRADE-NMA per comparison',
      summary,
      bodyHtml: body,
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('grade-nma-comparison-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 2000));
    } else { setTimeout(tick, 2000); }
  }

  global.GradeNMAComparison = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
