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
    // Variance (Hedges 1985)
    const v = ((t.n1 + t.n2) / (t.n1 * t.n2)) + (g * g) / (2 * (t.n1 + t.n2));
    return { yi: g, vi: v * J * J };
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
    const I2 = Q > df ? Math.max(0, (Q - df) / Q) * 100 : 0;
    return {
      yi: yRE, se: seRE,
      ci_low: yRE - 1.96 * seRE,
      ci_high: yRE + 1.96 * seRE,
      k: points.length, tau2, Q, df, I2,
    };
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
    if (mdPool) {
      html += cell('Pooled MD',
        fmt(mdPool.yi, 2),
        '95% CI ' + fmt(mdPool.ci_low, 2) + '–' + fmt(mdPool.ci_high, 2));
      html += cell('I² (MD)', fmt(mdPool.I2, 1) + '%');
      html += cell('τ² (MD)', fmt(mdPool.tau2, 4));
    }
    if (smdPool) {
      html += cell('Pooled SMD (Hedges g)',
        fmt(smdPool.yi, 2),
        '95% CI ' + fmt(smdPool.ci_low, 2) + '–' + fmt(smdPool.ci_high, 2));
      html += cell('I² (SMD)', fmt(smdPool.I2, 1) + '%');
    }
    html += cell('Trials', String(trials.length), 'continuous-outcome');
    html += '</div>';

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
    const mdPool = poolDLRE(mdPoints);
    const smdPool = poolDLRE(smdPoints);

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
