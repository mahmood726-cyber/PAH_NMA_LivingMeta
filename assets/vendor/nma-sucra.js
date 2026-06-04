/* SUCRA + cumulative-ranking-probability panel for NMAs.
 *
 * Salanti G, Ades AE, Ioannidis JP. Graphical methods and numerical
 * summaries for presenting results from multiple-treatment meta-
 * analysis: an overview and tutorial. J Clin Epidemiol 2011;64:163–71.
 *
 * SUCRA_T = (mean rank − 1) / (J − 1) when smaller is better,
 *         = (J − mean rank) / (J − 1) when bigger is better.
 *
 * Implementation: Monte Carlo from per-treatment vs reference
 * (logOR or MD) point + SE. For each MC iteration we draw a sample
 * from each treatment's marginal posterior and rank them; SUCRA is
 * the average proportion of treatments each one beats.
 *
 * Direction:
 *   - For OR < 1 = better (most binary outcomes like mortality, AEs):
 *     small log-OR ⇒ best ⇒ rank 1
 *   - For MD: configurable; default "smaller is better" if outcome
 *     shortLabel matches an "increase = harm" instrument.
 *
 * NMA-only. Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'nma-sucra-expanded';
  const N_MC = 5000;

  function getCfg() { return global.NMA_CONFIG || null; }

  // ---- Effect extraction (binary OR, then continuous MD fallback) ----
  function trialLogOR(t) {
    let ai = +t.tE, ci = +t.cE, n1 = +t.tN, n2 = +t.cN;
    if (!Number.isFinite(ai) || !Number.isFinite(ci) || !Number.isFinite(n1) || !Number.isFinite(n2) || n1 <= 0 || n2 <= 0) return null;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d };
  }

  const CONT_LABEL_RE = /^(CDR_?SB|CDR-?SB|MMSE|ADAS|PPF[Ee]V1|FEV1|BCVA|KCCQ|SF36|EQ5D|EQ-?5D|ETDRS|HADS|PHQ|GAD|HRSD|MADRS|YBOCS|SLEDAI|UPDRS|MD|change|score)/i;

  function trialContinuous(t) {
    const ao = t.allOutcomes;
    if (!Array.isArray(ao)) return null;
    let cont = ao.find(o => o && (o.type === 'CONTINUOUS' || o.type === 'continuous')
                                 && typeof o.md === 'number' && typeof o.se === 'number' && o.se > 0);
    if (cont) return { yi: cont.md, vi: cont.se * cont.se };
    cont = ao.find(o => o && o.type === 'PRIMARY'
                          && CONT_LABEL_RE.test(String(o.shortLabel || o.title || ''))
                          && typeof o.pubHR === 'number'
                          && typeof o.pubHR_LCI === 'number'
                          && typeof o.pubHR_UCI === 'number'
                          && o.pubHR_UCI > o.pubHR_LCI);
    if (cont) {
      const md = cont.pubHR;
      const se = (cont.pubHR_UCI - cont.pubHR_LCI) / 3.92;
      if (se > 0 && isFinite(se)) return { yi: md, vi: se * se };
    }
    return null;
  }

  // Pool log-effect via DerSimonian-Laird random effects
  function poolDLRE(points) {
    if (!points || points.length === 0) return null;
    if (points.length === 1) {
      return { mean: points[0].yi, se: Math.sqrt(points[0].vi), k: 1, tau2: 0 };
    }
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
    return { mean: WY2 / W2, se: Math.sqrt(1/W2), k: points.length, tau2 };
  }

  // Box-Muller normal sample
  function rnorm() {
    const u = Math.max(1e-12, Math.random()), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function pickReference(cfg, treatments) {
    if (cfg && cfg.protocol && cfg.protocol.comp) {
      const t = treatments.find(t =>
        cfg.protocol.comp.toLowerCase().includes(t.toLowerCase()) ||
        t.toLowerCase().includes('placebo') || t.toLowerCase().includes('control'));
      if (t) return t;
    }
    const placebo = treatments.find(t => t.toLowerCase().includes('placebo'));
    if (placebo) return placebo;
    const ctrl = treatments.find(t => t.toLowerCase().includes('control'));
    if (ctrl) return ctrl;
    if (cfg && cfg.comparisons) {
      const cnt = {};
      cfg.comparisons.forEach(c => {
        cnt[c.t1] = (cnt[c.t1] || 0) + 1;
        cnt[c.t2] = (cnt[c.t2] || 0) + 1;
      });
      let best = null, bestN = 0;
      Object.entries(cnt).forEach(([t, n]) => { if (n > bestN) { bestN = n; best = t; } });
      if (best && treatments.indexOf(best) >= 0) return best;
    }
    return treatments[treatments.length - 1];
  }

  function buildBars(rows, betterDirection) {
    const W = 720, rowH = 22, H = 60 + rowH * rows.length;
    const labelCol = 200, axCol = W - labelCol - 40;
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    svg += '<text x="6" y="18" fill="#94a3b8" font-size="10" font-weight="600">Treatment</text>';
    svg += '<text x="' + (labelCol + axCol/2) + '" y="18" fill="#a78bfa" font-size="11" text-anchor="middle" font-weight="600">SUCRA (' + (betterDirection === 'lower' ? '↓ better' : '↑ better') + ')</text>';
    [0, 25, 50, 75, 100].forEach(p => {
      const xp = labelCol + (p/100) * axCol;
      svg += '<line x1="' + xp + '" x2="' + xp + '" y1="32" y2="' + (H - 16) + '" stroke="#1e293b" stroke-dasharray="2,3" />';
      svg += '<text x="' + xp + '" y="' + (H - 4) + '" fill="#94a3b8" font-size="10" text-anchor="middle">' + p + '</text>';
    });

    // Sort by SUCRA descending
    const sorted = rows.slice().sort((a, b) => b.sucra - a.sucra);
    sorted.forEach((r, i) => {
      const y = 36 + rowH * i;
      svg += '<text x="6" y="' + (y + 4) + '" fill="#cbd5e1" font-size="10.5">' + r.treatment.slice(0, 30) + '</text>';
      const barW = (r.sucra / 100) * axCol;
      const barX = labelCol;
      svg += '<rect x="' + barX + '" y="' + (y - 7) + '" width="' + barW + '" height="14" fill="#a78bfa" fill-opacity="0.7" />';
      svg += '<text x="' + (barX + barW + 6) + '" y="' + (y + 4) + '" fill="#cbd5e1" font-size="10.5" font-family="JetBrains Mono,monospace">' + r.sucra.toFixed(1) + ' · MR=' + r.meanRank.toFixed(2) + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const cfg = getCfg();
    if (!cfg || !cfg.treatments || cfg.treatments.length < 2) return false;
    const rd = P.getRealData();
    if (!rd) return false;

    const treatments = cfg.treatments;
    const reference = pickReference(cfg, treatments);

    // For each treatment, pool effect vs reference (log-OR or MD).
    // If neither is computable, skip the treatment.
    const others = treatments.filter(t => t !== reference);
    const tr = []; // [{ name, mean, se, scale }]
    let scale = null;
    others.forEach(T => {
      const points = [];
      let pickedScale = null;
      (cfg.comparisons || []).forEach(c => {
        if ((c.t1 === T && c.t2 === reference) || (c.t1 === reference && c.t2 === T)) {
          (c.trials || []).forEach(nctRef => {
            const t = (typeof nctRef === 'string' && rd[nctRef]) ? rd[nctRef] : nctRef;
            if (!t) return;
            const flip = (c.t1 === reference);
            // Try binary first, then continuous
            const lo = trialLogOR(t);
            if (lo) {
              points.push({ yi: flip ? -lo.yi : lo.yi, vi: lo.vi });
              pickedScale = pickedScale || 'OR';
              return;
            }
            const cont = trialContinuous(t);
            if (cont) {
              points.push({ yi: flip ? -cont.yi : cont.yi, vi: cont.vi });
              pickedScale = pickedScale || 'MD';
            }
          });
        }
      });
      const pool = poolDLRE(points);
      if (!pool || pool.k === 0) return;
      tr.push({ name: T, mean: pool.mean, se: pool.se });
      scale = scale || pickedScale;
    });
    if (tr.length < 2) return false;
    if (!scale) scale = 'OR';

    // Reference is at logOR=0 / MD=0 with se=0 (anchor point)
    tr.unshift({ name: reference, mean: 0, se: 0 });

    // Outcome-direction detection from PICO. Protocol may live at
    //   NMA_CONFIG.protocol (some reviews) OR RapidMeta.state.protocol.
    //   Also accept NMA_CONFIG.outcome / .outcome_label (terser variants).
    //   "smaller is better" (OR<1) when outcome describes: death, mortality,
    //     adverse event, harm, failure, recurrence, progression, hospitalisation
    //   "larger is better" (OR>1) when outcome describes: response, remission,
    //     achievement, success, recovery, ACR, complete response, sustained
    const protoFromState = (global.RapidMeta && global.RapidMeta.state && global.RapidMeta.state.protocol) || null;
    const outText = String(
      (cfg.protocol && cfg.protocol.out) ||
      (protoFromState && protoFromState.out) ||
      cfg.outcome_label || cfg.outcome || ''
    ).toLowerCase();
    const harmKW = /(death|mortali|adverse|harm|failure|recurren|progress|hospitali|relapse|toxic|safety)/;
    const benefitKW = /(respon|remission|achiev|success|recover|attain|complete|sustained|improvement|cure)/;
    let betterDirection = 'lower';  // default: harm (OR<1 = better)
    if (benefitKW.test(outText) && !harmKW.test(outText)) betterDirection = 'higher';
    const J = tr.length;

    // Monte Carlo: rank in each iteration
    const rankSums = tr.map(() => 0);
    const beatCounts = tr.map(() => 0);
    for (let it = 0; it < N_MC; it++) {
      const draws = tr.map(x => x.mean + x.se * rnorm());
      // Rank: smaller value = rank 1 (better)
      const indexed = draws.map((v, i) => ({ v, i }));
      indexed.sort((a, b) => betterDirection === 'lower' ? a.v - b.v : b.v - a.v);
      indexed.forEach((x, rank) => { rankSums[x.i] += (rank + 1); });
      // Beat-counts (treatments worse than this one)
      indexed.forEach((x, rank) => { beatCounts[x.i] += (J - 1 - rank); });
    }

    const rows = tr.map((x, i) => {
      const meanRank = rankSums[i] / N_MC;
      // SUCRA = (J - meanRank) / (J - 1) when smaller is better (mean rank 1 is best ⇒ SUCRA=1)
      const sucra = ((J - meanRank) / (J - 1)) * 100;
      const pBest = beatCounts[i] / (N_MC * (J - 1)) * 100; // approx prob of being best
      return { treatment: x.name, mean: x.mean, se: x.se, meanRank, sucra, pBest };
    });

    // Top-ranked = highest SUCRA
    const sorted = rows.slice().sort((a, b) => b.sucra - a.sucra);
    const top = sorted[0];
    const summary = scale + ' scale · ' + J + ' treatments · top: ' + top.treatment + ' (SUCRA ' + P.fmt(top.sucra, 1) + '%, MR=' + P.fmt(top.meanRank, 2) + ')';

    // Build body
    let html = '';
    const dirText = betterDirection === 'higher' ? 'larger value = better (response/remission outcome detected)' : 'smaller value = better (harm/mortality outcome assumed)';
    html += '<div style="background:#0e2540;border:1px solid #312e81;color:#c4b5fd;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
          + '<strong>Top-ranked:</strong> ' + top.treatment + ' — SUCRA ' + P.fmt(top.sucra, 1) + '% (mean rank ' + P.fmt(top.meanRank, 2) + ' of ' + J + '). '
          + 'Reference: <code>' + reference + '</code>. Scale: <code>' + scale + '</code>. <em>Direction:</em> ' + dirText + '.'
          + '</div>';
    html += buildBars(rows, betterDirection);

    // Per-treatment table
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:10px;margin-bottom:4px;">Per-treatment ranking summaries:</div>';
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;">Treatment</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Effect ' + (scale === 'OR' ? '(OR)' : '(MD)') + '</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">95% CI</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Mean rank</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">SUCRA</th>'
          + '</tr></thead><tbody>';
    sorted.forEach(r => {
      const eff = scale === 'OR' ? Math.exp(r.mean) : r.mean;
      const lo  = scale === 'OR' ? Math.exp(r.mean - 1.96 * r.se) : r.mean - 1.96 * r.se;
      const hi  = scale === 'OR' ? Math.exp(r.mean + 1.96 * r.se) : r.mean + 1.96 * r.se;
      const isRef = r.treatment === reference;
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;' + (isRef ? 'font-style:italic;' : '') + '">' + r.treatment + (isRef ? ' (ref)' : '') + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + (isRef ? '1.00' : P.fmt(eff, 2)) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + (isRef ? '—' : P.fmt(lo, 2) + '–' + P.fmt(hi, 2)) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + P.fmt(r.meanRank, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#a78bfa;font-weight:600;">' + P.fmt(r.sucra, 1) + '%</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> for each non-reference treatment, pool the trial-level log-OR (or MD) vs reference via DerSimonian-Laird random effects. '
          + 'Then ' + N_MC.toLocaleString() + ' Monte Carlo draws — sample each treatment from N(μ̂, σ̂²), rank, average ⇒ mean rank. '
          + 'SUCRA = (J − mean rank) / (J − 1) × 100 (Salanti J Clin Epidemiol 2011). '
          + '<strong>Caveats:</strong> per advanced-stats.md / Wigle 2025 — SUCRA alone is unreliable when ranks are uncertain; should be paired with the POTH (Probability of Top-K Hierarchy) ranking-uncertainty index. '
          + 'Direction defaults to "smaller is better"; for outcomes where larger is better, interpret SUCRA as ranking against worst.'
          + '</div>';

    const panel = P.buildCollapsiblePanel({
      id: 'nma-sucra-panel', badge: 'SUCRA', summary,
      bodyHtml: html, storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('nma-sucra-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1700));
    } else { setTimeout(tick, 1700); }
  }

  global.NMASUCRA = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
