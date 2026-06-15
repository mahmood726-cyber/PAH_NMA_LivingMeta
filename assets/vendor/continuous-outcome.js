/* Continuous-outcome pooling — Mean Difference (MD) and Standardised
 * Mean Difference (Hedges' g).
 *
 * Detects trials in window.RapidMeta.realData with continuous outcome
 * fields (mean1/mean2/sd1/sd2 + n1/n2, OR pre-extracted md/smd/se), and
 * pools via DerSimonian–Laird random effects on the chosen scale.
 *
 * If a review is binary-only (no continuous trials), the panel exits
 * silently. If mixed, only the continuous trials are pooled here.
 *
 * Hedges' g uses small-sample correction J = 1 − 3/(4(n1+n2−2) − 1)
 * (Hedges 1981; widely accepted default).
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'continuous-outcome-expanded';

  function pickContinuousTrials(rd) {
    if (!rd) return [];
    const out = [];
    Object.values(rd).forEach(t => {
      if (!t) return;
      // Variant 0 (most common in this corpus): top-level allOutcomes[*]
      //   with type === 'CONTINUOUS' and {md, se}; OR t.data.{md,se}
      let md, se;
      const allOutcomes = t.allOutcomes || (t.data && t.data.allOutcomes);
      if (Array.isArray(allOutcomes)) {
        const cont = allOutcomes.find(o => o && (o.type === 'CONTINUOUS' || o.type === 'continuous')
                                           && typeof o.md === 'number' && typeof o.se === 'number');
        if (cont) { md = cont.md; se = cont.se; }
      }
      if (md === undefined && t.data && typeof t.data.md === 'number' && typeof t.data.se === 'number') {
        md = t.data.md; se = t.data.se;
      }
      if (md !== undefined && se !== undefined && isFinite(md) && isFinite(se) && se > 0) {
        out.push({ name: t.name, kind: 'md_pre', md, se });
        return;
      }
      // Variant 1: top-level md/md_se (rare; some custom builds)
      const hasMD = (typeof t.md === 'number' && typeof t.md_se === 'number');
      const hasSMD = (typeof t.smd === 'number' && typeof t.smd_se === 'number');
      // Variant 2: mean1/mean2/sd1/sd2 + n1/n2 (computed from raw)
      const m1 = +t.mean1, m2 = +t.mean2, sd1 = +t.sd1, sd2 = +t.sd2;
      const n1 = +t.tN || +t.n1, n2 = +t.cN || +t.n2;
      const hasFull = isFinite(m1) && isFinite(m2) && isFinite(sd1) && isFinite(sd2)
                      && isFinite(n1) && isFinite(n2) && n1 > 1 && n2 > 1
                      && sd1 > 0 && sd2 > 0;
      if (hasMD) {
        out.push({ name: t.name, kind: 'md_pre', md: +t.md, se: +t.md_se });
      } else if (hasSMD) {
        out.push({ name: t.name, kind: 'smd_pre', smd: +t.smd, se: +t.smd_se });
      } else if (hasFull) {
        out.push({
          name: t.name, kind: 'full',
          m1, m2, sd1, sd2, n1, n2,
        });
      }
    });
    return out;
  }

  function md(t) {
    if (t.kind === 'md_pre') {
      return { yi: t.md, vi: t.se * t.se };
    }
    // From means/SDs: variance = sd1²/n1 + sd2²/n2
    const yi = t.m1 - t.m2;
    const vi = t.sd1 * t.sd1 / t.n1 + t.sd2 * t.sd2 / t.n2;
    return { yi, vi };
  }

  function smdHedges(t) {
    if (t.kind === 'smd_pre') {
      return { yi: t.smd, vi: t.se * t.se };
    }
    // Pooled SD
    const dfp = t.n1 + t.n2 - 2;
    const sp = Math.sqrt(((t.n1 - 1) * t.sd1 * t.sd1 + (t.n2 - 1) * t.sd2 * t.sd2) / dfp);
    const d = (t.m1 - t.m2) / sp;
    // Hedges' correction
    const J = 1 - 3 / (4 * dfp - 1);
    const g = J * d;
    // Variance of Hedges' g matching metafor escalc(measure="SMD"): the
    // small-sample J correction is ALREADY carried by using the corrected g in
    // the second term, so v itself is the corrected variance. The previous
    // `v * J * J` double-applied J and deflated the variance up to ~8% for small
    // studies (n1=n2=10), making inverse-variance weights too large and CIs too
    // narrow — anticonservative exactly where the correction matters most.
    const v = ((t.n1 + t.n2) / (t.n1 * t.n2)) + (g * g) / (2 * (t.n1 + t.n2));
    return { yi: g, vi: v };
  }

  // ---- Random-effects engine: Paule-Mandel τ² + RE-weighted Knapp-Hartung
  // (floored) + t_{k-1} CI + Cochrane v6.5 prediction interval. Mirrors the
  // bit-exact in-page computeCore binary engine and pairwise-pool.js. Replaces
  // the old DerSimonian-Laird + hardcoded z=1.96 pool, which was anticonservative
  // for small k (DL is biased for k<10; no HKSJ inflation, no t critical value,
  // no prediction interval — CIs came out ~2x too narrow at k≈4).
  // REML τ² via Fisher scoring (Viechtbauer 2005), started from the DL estimate —
  // the exact algorithm used by the bit-exact in-page computeCore engine, and the
  // Cochrane v6.5 / RevMan-2025 default. REML (not PM) is used so the downstream
  // Knapp-Hartung statistic genuinely inflates: under PM the RE-weighted q* is 1
  // by construction (PM sets generalized Q = df), which would make HKSJ a no-op.
  function tau2REML(points) {
    const k = points.length, df = k - 1;
    let W = 0, WY = 0, sW2 = 0;
    points.forEach(p => { const w = 1 / p.vi; W += w; WY += w * p.yi; sW2 += w * w; });
    const muFE = WY / W;
    let Q = 0; points.forEach(p => { const w = 1 / p.vi; Q += w * (p.yi - muFE) * (p.yi - muFE); });
    let tau2 = (Q > df) ? (Q - df) / (W - sW2 / W) : 0;   // DL start
    if (k < 2) return Math.max(0, tau2);
    for (let it = 0; it < 100; it++) {
      const w = points.map(p => 1 / (p.vi + tau2));
      const sW = w.reduce((a, b) => a + b, 0);
      const mu = w.reduce((a, wi, i) => a + wi * points[i].yi, 0) / sW;
      const s2 = w.reduce((a, wi) => a + wi * wi, 0);
      const s3 = w.reduce((a, wi) => a + wi * wi * wi, 0);
      const trP = sW - s2 / sW;
      const yP2y = w.reduce((a, wi, i) => a + wi * wi * Math.pow(points[i].yi - mu, 2), 0);
      const trP2 = s2 - 2 * s3 / sW + s2 * s2 / (sW * sW);
      if (trP2 < 1e-15) break;
      const next = Math.max(0, tau2 + (yP2y - trP) / trP2);
      if (Math.abs(next - tau2) < 1e-10) { tau2 = next; break; }
      tau2 = next;
    }
    return Math.max(0, tau2);
  }
  const T_975 = { 1:12.706,2:4.303,3:3.182,4:2.776,5:2.571,6:2.447,7:2.365,8:2.306,
    9:2.262,10:2.228,11:2.201,12:2.179,13:2.160,14:2.145,15:2.131,16:2.120,17:2.110,
    18:2.101,19:2.093,20:2.086,21:2.080,22:2.074,23:2.069,24:2.064,25:2.060,26:2.056,
    27:2.052,28:2.048,29:2.045,30:2.042 };
  function tCrit975(df) {
    if (df < 1) return NaN;
    if (df > 30) return 1.96;
    return T_975[Math.round(df)] || 1.96;
  }

  function poolRE(points) {
    if (!points || points.length < 2) return null;
    const k = points.length, df = k - 1;
    // Fixed-effect Q / I²
    let W = 0, WY = 0;
    points.forEach(p => { const w = 1 / p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    let Q = 0;
    points.forEach(p => { const w = 1 / p.vi; Q += w * (p.yi - yFE) * (p.yi - yFE); });
    const I2 = Q > df ? Math.max(0, (Q - df) / Q) * 100 : 0;
    // REML τ² (Cochrane v6.5 default; DerSimonian-Laird is biased for k<10).
    const tau2 = tau2REML(points);
    // Random-effects pool
    let W2 = 0, WY2 = 0;
    points.forEach(p => { const w = 1 / (p.vi + tau2); W2 += w; WY2 += w * p.yi; });
    const yRE = WY2 / W2;
    const seMu = Math.sqrt(1 / W2);
    // Knapp-Hartung: RE-weighted q* (NOT fixed-effect Q/df), floored at 1.
    let qStar = 0;
    points.forEach(p => { const w = 1 / (p.vi + tau2); qStar += w * (p.yi - yRE) * (p.yi - yRE); });
    qStar /= df;
    const seH = seMu * Math.sqrt(Math.max(1, qStar));
    const t = tCrit975(df);
    const out = {
      yi: yRE, se: seH,
      ci_low: yRE - t * seH,
      ci_high: yRE + t * seH,
      k, tau2, Q, df, I2,
    };
    // Cochrane v6.5 prediction interval: t_{k-1} × √(τ² + SE_µ²); undefined for k<3.
    if (k >= 3) {
      const seP = Math.sqrt(tau2 + seMu * seMu);
      out.pi_low = yRE - t * seP;
      out.pi_high = yRE + t * seP;
    }
    return out;
  }

  function buildBody(P, trials, mdPool, smdPool) {
    const fmt = P.fmt;
    let html = '';

    // Headline
    html += '<div style="background:#0e3a1f;border:1px solid #34d399;color:#34d399;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
          + '✓ Continuous outcome detected — ' + trials.length + ' trial(s) with usable mean/SD or pre-computed effect data.'
          + '</div>';

    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:10px;">';
    function piText(pool) {
      return (pool.k >= 3 && isFinite(pool.pi_low))
        ? fmt(pool.pi_low, 2) + '–' + fmt(pool.pi_high, 2)
        : 'n/a (k<3)';
    }
    if (mdPool) {
      html += cell('Pooled MD',
        fmt(mdPool.yi, 2),
        '95% CI ' + fmt(mdPool.ci_low, 2) + '–' + fmt(mdPool.ci_high, 2));
      html += cell('95% PI (MD)', piText(mdPool), 't_{k-1} √(τ²+SE²)');
      html += cell('I² (MD)', fmt(mdPool.I2, 1) + '%');
      html += cell('τ² (MD)', fmt(mdPool.tau2, 4));
    }
    if (smdPool) {
      html += cell('Pooled SMD (Hedges g)',
        fmt(smdPool.yi, 2),
        '95% CI ' + fmt(smdPool.ci_low, 2) + '–' + fmt(smdPool.ci_high, 2));
      html += cell('95% PI (SMD)', piText(smdPool), 't_{k-1} √(τ²+SE²)');
      html += cell('I² (SMD)', fmt(smdPool.I2, 1) + '%');
    }
    html += cell('Trials', String(trials.length), 'continuous-outcome');
    html += '</div>';
    html += '<div style="font-size:10px;color:#64748b;margin:-4px 0 10px;">'
          + 'Pooling: REML τ² + Knapp-Hartung (floored) + t<sub>k-1</sub> CI + Cochrane v6.5 prediction interval.'
          + '</div>';

    // Per-trial table
    html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Per-trial effect estimates:</div>';
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;">Trial</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Tx (mean ± SD, N)</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Ctl (mean ± SD, N)</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">MD</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">SMD (g)</th>'
          + '</tr></thead><tbody>';
    trials.forEach(t => {
      const md_t = md(t);
      const smd_t = smdHedges(t);
      const txCol = t.kind === 'full'
        ? fmt(t.m1, 2) + ' ± ' + fmt(t.sd1, 2) + ', N=' + t.n1
        : '—';
      const ctlCol = t.kind === 'full'
        ? fmt(t.m2, 2) + ' ± ' + fmt(t.sd2, 2) + ', N=' + t.n2
        : '—';
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + t.name + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + txCol + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + ctlCol + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(md_t.yi, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(smd_t.yi, 2) + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>MD (mean difference):</strong> on natural scale of the outcome — preferred when all trials share units. '
          + 'Variance = SD₁²/N₁ + SD₂²/N₂.<br>'
          + "<strong>SMD (Hedges' g):</strong> standardised; small-sample correction J = 1 − 3/(4(n₁+n₂−2)−1) (Hedges 1981). "
          + 'Pooled SD assumes equal within-group variances.<br>'
          + 'Cochrane Handbook v6.5 §10.5 — SMD is the default for continuous outcomes when units differ across trials.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = pickContinuousTrials(rd);
    if (trials.length < 2) return false;

    const mdPoints = trials.map(md).filter(p => isFinite(p.yi) && p.vi > 0);
    const smdPoints = trials.map(smdHedges).filter(p => isFinite(p.yi) && p.vi > 0);
    const mdPool = poolRE(mdPoints);
    const smdPool = poolRE(smdPoints);

    if (!mdPool && !smdPool) return false;

    const main = mdPool || smdPool;
    const summary = (mdPool ? 'MD ' : 'SMD ') + P.fmt(main.yi, 2)
                  + ' [' + P.fmt(main.ci_low, 2) + '–' + P.fmt(main.ci_high, 2) + ']'
                  + ' · k=' + main.k
                  + ' · I²=' + P.fmt(main.I2, 0) + '%';

    const panel = P.buildCollapsiblePanel({
      id: 'continuous-outcome-panel',
      badge: 'Continuous',
      summary,
      bodyHtml: buildBody(P, trials, mdPool, smdPool),
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('continuous-outcome-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1050));
    } else {
      setTimeout(tick, 1050);
    }
  }

  global.ContinuousOutcome = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
