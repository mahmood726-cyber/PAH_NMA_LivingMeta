/* Prediction-interval convention badge — Cochrane Handbook v6.5 §10.10.4.3.
 *
 * Cochrane mandates: PI = ŷ ± t_{k-1, α/2} × √(τ̂² + SÊ²).
 * IntHout 2016 used t_{k-2}; the rules file mandates t_{k-1} (Cochrane v6.5 /
 * RevMan-2025 bit-reproducibility convention).
 *
 * HKSJ floor: replace SÊ² × max(1, Q/(k-1)) when Q < k-1 to prevent CI
 * collapse below the DL random-effects width.
 *
 * This panel computes both for the primary pool and shows whether the
 * floor was triggered (an explicit reviewer-attestable fact).
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'pi-convention-expanded';

  // t_{0.975, df} table (Hill-1970 derived). Index 1..30; >30 → asymptotic.
  const T_975 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
    8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145,
    15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
    21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060, 26: 2.056,
    27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
  };
  function tCrit975(df) {
    if (df < 1) return Infinity;
    if (df <= 30) return T_975[df];
    // Cornish–Fisher: z + (z³+z)/(4 df)
    const z = 1.959963984540054;
    return z + (z*z*z + z)/(4*df);
  }

  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    return { yi: Math.log((ai*(n2-ci))/((n1-ai)*ci)),
             vi: 1/ai + 1/(n1-ai) + 1/ci + 1/(n2-ci) };
  }

  function computePool(pts) {
    let W = 0, WY = 0;
    pts.forEach(p => { const w = 1/p.vi; W += w; WY += w*p.yi; });
    const yFE = WY/W;
    let Q = 0;
    pts.forEach(p => { const w = 1/p.vi; Q += w*Math.pow(p.yi - yFE, 2); });
    const k = pts.length;
    const df = k - 1;
    const sumW2 = pts.reduce((s, p) => s + Math.pow(1/p.vi, 2), 0);
    const c = W - sumW2/W;
    const tau2 = Math.max(0, (Q - df)/c);
    let W2 = 0, WY2 = 0;
    pts.forEach(p => { const w = 1/(p.vi + tau2); W2 += w; WY2 += w*p.yi; });
    const yRE = WY2/W2;
    const seRE = Math.sqrt(1/W2);
    return { yRE, seRE, tau2, Q, df, k };
  }

  function continuousPoints(rd) {
    const out = [];
    Object.values(rd || {}).forEach(t => {
      const ao = Array.isArray(t.allOutcomes) ? t.allOutcomes : null;
      if (!ao) return;
      const c = ao.find(o => o && o.type === 'CONTINUOUS' &&
                            Number.isFinite(+o.md) && Number.isFinite(+o.se) && +o.se > 0);
      if (c) out.push({ yi: +c.md, vi: Math.pow(+c.se, 2) });
    });
    return out;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;

    let pts = null, scale = 'log-OR', backTransform = true;
    const bin = P.extractBinaryTrials(rd);
    if (bin && bin.length >= 2) {
      pts = bin.map(trialLogOR);
    } else {
      const cont = continuousPoints(rd);
      if (cont.length >= 2) { pts = cont; scale = 'MD'; backTransform = false; }
    }
    if (!pts || pts.length < 2) return false;

    // PI is undefined for k<3 under the Cochrane v6.5 t_{k-1} convention
    // (df = k − 1 = 1 → t_{0.975, 1} = 12.7, but the variance estimate of τ̂²
    // collapses with one degree of freedom and the PI is not interpretable).
    // Render the panel with an explicit message instead of silently
    // producing a misleading interval.
    if (pts.length < 3) {
      const undefBody =
        '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 12px;border-radius:6px;font-size:11.5px;line-height:1.5;">'
        + '⚠ <strong>Prediction interval undefined for k = ' + pts.length + '.</strong> '
        + 'Cochrane Handbook v6.5 §10.10.4.3 recommends k ≥ 3 for the t_{k−1} PI; with k = 2, df = 1 and the τ̂² estimate is not stable. '
        + 'Report only the random-effects mean (and HKSJ CI) until additional studies accrue.'
        + '</div>';
      const panel = P.buildCollapsiblePanel({
        id: 'pi-convention-panel',
        badge: 'PI convention (Cochrane v6.5)',
        summary: 'PI undefined for k<3 (k=' + pts.length + ')',
        bodyHtml: undefBody,
        storageKey: STORAGE_KEY,
      });
      const existing = document.getElementById('pi-convention-panel');
      if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
      return true;
    }

    const pool = computePool(pts);
    const t_crit = tCrit975(pool.df);

    // PI under Cochrane v6.5 t_{k-1} convention
    const pi_se = Math.sqrt(pool.tau2 + pool.seRE * pool.seRE);
    const pi_lo = pool.yRE - t_crit * pi_se;
    const pi_hi = pool.yRE + t_crit * pi_se;

    // HKSJ floor check
    const Q_over_df = pool.df > 0 ? pool.Q / pool.df : 0;
    const hksj_factor = Math.max(1, Q_over_df);
    const floor_triggered = pool.Q < pool.df;
    const hksj_se = pool.seRE * Math.sqrt(hksj_factor);
    const hksj_lo = pool.yRE - t_crit * hksj_se;
    const hksj_hi = pool.yRE + t_crit * hksj_se;

    const fmtOnScale = (v) => backTransform ? Math.exp(v).toFixed(2) : v.toFixed(3);
    const piStr = '[' + fmtOnScale(pi_lo) + ', ' + fmtOnScale(pi_hi) + ']';

    const summary = 'PI ' + piStr + ' · t_{k-1}=' + t_crit.toFixed(3) +
                    ' · HKSJ floor ' + (floor_triggered ? '⚠ active' : 'inactive');

    const body =
      '<div style="font-size:11px;color:#cbd5e1;line-height:1.6;">' +
      '<table style="width:100%;border-collapse:collapse;font-family:JetBrains Mono,monospace;font-size:11px;">' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Scale</td><td style="color:#7dd3fc;">' + scale + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">k (studies)</td><td style="color:#7dd3fc;">' + pool.k + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">df = k − 1</td><td style="color:#7dd3fc;">' + pool.df + '  <span style="color:#64748b;">(Cochrane v6.5 §10.10.4.3 convention)</span></td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">t_{0.975, df}</td><td style="color:#7dd3fc;">' + t_crit.toFixed(3) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">τ̂²</td><td style="color:#7dd3fc;">' + P.fmt(pool.tau2, 4) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">SE_RE (DL)</td><td style="color:#7dd3fc;">' + P.fmt(pool.seRE, 4) + '</td></tr>' +
      '<tr><td colspan="2" style="padding:6px 0 2px 8px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;">Prediction interval</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">PI = ŷ ± t × √(τ̂²+SÊ²)</td><td style="color:#7dd3fc;">' + piStr + '</td></tr>' +
      '<tr><td colspan="2" style="padding:6px 0 2px 8px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;">HKSJ confidence interval</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Q / (k−1)</td><td style="color:#7dd3fc;">' + P.fmt(Q_over_df, 3) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Inflation factor max(1, Q/df)</td><td style="color:' + (floor_triggered ? '#fbbf24' : '#7dd3fc') + ';">' + P.fmt(hksj_factor, 3) +
        (floor_triggered ? '  <span style="color:#fbbf24;">⚠ floor ACTIVE (Q&lt;df)</span>' : '') + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">HKSJ 95% CI</td><td style="color:#7dd3fc;">[' + fmtOnScale(hksj_lo) + ', ' + fmtOnScale(hksj_hi) + ']</td></tr>' +
      '</table>' +
      '<div style="margin-top:8px;font-size:10.5px;color:#64748b;line-height:1.5;">' +
      '<strong>Why this matters:</strong> Cochrane Handbook v6.5 (Nov 2024) §10.10.4.3 specifies t_{k−1} for the prediction interval, ' +
      'while IntHout/Higgins/Tudur Smith 2016 used t_{k−2}. Both are defensible but they differ. This engine reports t_{k−1} for ' +
      'RevMan-2025 bit-reproducibility. The HKSJ floor max(1, Q/(k−1)) prevents the CI narrowing below the DL random-effects width ' +
      'when Q&lt;df (Hartung 2008, Knapp 2003). When the floor is <em>active</em>, the HKSJ CI is intentionally widened. ' +
      'See <code>~/.claude/rules/advanced-stats.md</code> for the full convention rule.' +
      '</div>' +
      '</div>';

    const panel = P.buildCollapsiblePanel({
      id: 'pi-convention-panel',
      badge: 'PI convention (Cochrane v6.5)',
      summary,
      bodyHtml: body,
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('pi-convention-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1950));
    } else { setTimeout(tick, 1950); }
  }

  global.PIConvention = { render, tCrit975 };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
