/* τ² Q-profile confidence interval (Viechtbauer 2007).
 *
 * Most rigorous CI for between-study variance under the random-effects
 * model. Method:
 *   - Generalised Q statistic Q_gen(τ²) = Σ w_i(τ²) (y_i − ȳ_w(τ²))²
 *     where w_i(τ²) = 1 / (v_i + τ²). Q_gen is monotone decreasing in τ².
 *   - 95% CI for τ² is the set { τ² : χ²_{0.025, k-1} ≤ Q_gen(τ²) ≤ χ²_{0.975, k-1} }.
 *   - Lower bound: τ²_L solves Q_gen(τ²) = χ²_{0.975, k-1}; upper similarly.
 *
 * Reference: Viechtbauer W. Confidence intervals for the amount of
 * heterogeneity in meta-analysis. Stat Med 2007;26:37-52.
 * Cochrane Handbook v6.5 §10.10.4 endorses this for τ² CI.
 *
 * Pure JS. Wilson–Hilferty for χ² quantile, Acklam for normal quantile.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'tau2-qprofile-expanded';

  // Acklam's algorithm: standard normal inverse CDF
  function qNorm(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
               1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
               6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
               -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
               3.754408661907416e+00];
    const pl = 0.02425, ph = 1 - pl;
    let q, r;
    if (p < pl) {
      q = Math.sqrt(-2*Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
             ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    } else if (p <= ph) {
      q = p - 0.5; r = q*q;
      return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
             (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
    } else {
      q = Math.sqrt(-2*Math.log(1-p));
      return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
              ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
  }

  // Wilson–Hilferty approximation: χ² quantile (df ≥ 1)
  function qChi2(p, df) {
    if (df < 1) df = 1;
    const z = qNorm(p);
    const term = 1 - 2/(9*df) + z * Math.sqrt(2/(9*df));
    return df * Math.pow(Math.max(term, 0), 3);
  }

  // Generalised Q at given τ² for trials [{yi, vi}]
  function genQ(tau2, pts) {
    let W = 0, WY = 0;
    pts.forEach(p => { const w = 1/(p.vi + tau2); W += w; WY += w*p.yi; });
    const yw = W > 0 ? WY/W : 0;
    let Q = 0;
    pts.forEach(p => { const w = 1/(p.vi + tau2); Q += w*Math.pow(p.yi - yw, 2); });
    return Q;
  }

  // Bisect: find τ² in [lo, hi] such that genQ(τ²) = target
  function bisect(target, pts, lo, hi, tol) {
    tol = tol || 1e-6;
    let f_lo = genQ(lo, pts) - target;
    let f_hi = genQ(hi, pts) - target;
    if (f_lo * f_hi > 0) return null; // no root in bracket
    for (let i = 0; i < 200; i++) {
      const mid = 0.5*(lo+hi);
      const f_mid = genQ(mid, pts) - target;
      if (Math.abs(f_mid) < tol || (hi - lo) < tol) return mid;
      if (f_lo * f_mid < 0) { hi = mid; f_hi = f_mid; }
      else { lo = mid; f_lo = f_mid; }
    }
    return 0.5*(lo+hi);
  }

  function qProfileCI(pts, alpha) {
    alpha = alpha || 0.05;
    const k = pts.length;
    // Q-profile is poorly defined for k<3 (df=1 → χ²_{0.025,1} is so small
    // that any homogeneous data triggers the degenerate "Q0 < χ²_lo" case
    // and the CI becomes empty). Cochrane Handbook v6.5 §10.10.4 and
    // Viechtbauer 2007 §3.2 both note this.
    if (k < 3) return null;
    const df = k - 1;
    const chi_lo = qChi2(alpha/2, df);     // lower critical
    const chi_hi = qChi2(1 - alpha/2, df); // upper critical

    // Q_gen(τ²) is monotone decreasing. So:
    //   τ²_L solves Q_gen(τ²) = chi_hi (genQ at τ²=0 may already be < chi_hi → τ²_L = 0)
    //   τ²_U solves Q_gen(τ²) = chi_lo
    const Q0 = genQ(0, pts);
    // Degenerate case: data are MORE homogeneous than χ²_{α/2, df} predicts
    // even at τ²=0. The Q-profile CI is empty/undefined.
    if (Q0 <= chi_lo) {
      return { tau2_hat: 0, tau2_L: null, tau2_U: null, k, df, Q0, chi_lo, chi_hi,
               degenerate: 'Q0 ≤ χ²_lo: data more homogeneous than null model' };
    }
    let tau2_L = 0;
    if (Q0 > chi_hi) {
      tau2_L = bisect(chi_hi, pts, 0, 100, 1e-7);
      if (tau2_L == null) tau2_L = 0;
    }
    let tau2_U = 0;
    {
      // Q0 > chi_lo (we returned above otherwise) → upper bound is finite
      let hi = 1;
      while (genQ(hi, pts) > chi_lo && hi < 1e6) hi *= 2;
      tau2_U = bisect(chi_lo, pts, 0, hi, 1e-7) || 0;
    }

    // DL point estimate (matches PanelHelper.poolRandomLogOR)
    let W = 0, WY = 0;
    pts.forEach(p => { const w = 1/p.vi; W += w; WY += w*p.yi; });
    const yFE = WY/W;
    let Q = 0;
    pts.forEach(p => { const w = 1/p.vi; Q += w*Math.pow(p.yi - yFE, 2); });
    const sumW2 = pts.reduce((s, p) => s + Math.pow(1/p.vi, 2), 0);
    const c = W - sumW2/W;
    const tau2_hat = Math.max(0, (Q - df)/c);

    return { tau2_hat, tau2_L, tau2_U, k, df, Q0, chi_lo, chi_hi };
  }

  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    return { yi: Math.log((ai*(n2-ci))/((n1-ai)*ci)),
             vi: 1/ai + 1/(n1-ai) + 1/ci + 1/(n2-ci) };
  }

  function continuousPoints(rd) {
    const out = [];
    Object.values(rd || {}).forEach(t => {
      if (!t) return;
      const ao = Array.isArray(t.allOutcomes) ? t.allOutcomes : null;
      if (ao) {
        const c = ao.find(o => o && o.type === 'CONTINUOUS' &&
                              Number.isFinite(+o.md) && Number.isFinite(+o.se) && +o.se > 0);
        if (c) out.push({ yi: +c.md, vi: Math.pow(+c.se, 2) });
      }
    });
    return out;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;

    // Try binary first, fall back to continuous
    let pts = null, scale = 'log-OR';
    const bin = P.extractBinaryTrials(rd);
    if (bin && bin.length >= 2) {
      pts = bin.map(trialLogOR);
    } else {
      const cont = continuousPoints(rd);
      if (cont.length >= 2) { pts = cont; scale = 'MD'; }
    }
    if (!pts || pts.length < 2) return false;

    const r = qProfileCI(pts, 0.05);
    if (!r) return false; // k<3 → silently skip

    const fmtBound = v => (v == null) ? '—' : P.fmt(v, 4);
    const summary = r.degenerate
      ? 'τ̂² = 0 · CI undefined (' + r.degenerate.split(':')[0] + ') · k=' + r.k
      : 'τ̂² = ' + P.fmt(r.tau2_hat, 4) +
        ' · 95% CI [' + fmtBound(r.tau2_L) + ', ' + fmtBound(r.tau2_U) + '] · k=' + r.k;
    const tau_hat = Math.sqrt(r.tau2_hat);
    const tau_L = r.tau2_L == null ? null : Math.sqrt(r.tau2_L);
    const tau_U = r.tau2_U == null ? null : Math.sqrt(r.tau2_U);

    const body =
      '<div style="font-size:11px;color:#cbd5e1;line-height:1.6;">' +
      '<table style="width:100%;border-collapse:collapse;font-family:JetBrains Mono,monospace;font-size:11px;">' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Scale</td><td style="color:#7dd3fc;">' + scale + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">τ̂² (DL point estimate)</td><td style="color:#7dd3fc;">' + P.fmt(r.tau2_hat, 4) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">95% CI for τ²  (Q-profile)</td><td style="color:' + (r.degenerate ? '#fbbf24' : '#7dd3fc') + ';">[' + fmtBound(r.tau2_L) + ', ' + fmtBound(r.tau2_U) + ']' + (r.degenerate ? '  ⚠ ' + r.degenerate : '') + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">τ̂ (SD of true effects)</td><td style="color:#7dd3fc;">' + P.fmt(tau_hat, 4) + ' (95% CI [' + (tau_L == null ? '—' : P.fmt(tau_L, 4)) + ', ' + (tau_U == null ? '—' : P.fmt(tau_U, 4)) + '])</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">χ² critical values</td><td style="color:#94a3b8;">[' + P.fmt(r.chi_lo, 3) + ', ' + P.fmt(r.chi_hi, 3) + '] (df=' + r.df + ')</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Q at τ²=0</td><td style="color:#94a3b8;">' + P.fmt(r.Q0, 3) + '</td></tr>' +
      '</table>' +
      '<div style="margin-top:8px;font-size:10.5px;color:#64748b;line-height:1.5;">' +
      'Q-profile method (Viechtbauer 2007 <a href="https://doi.org/10.1002/sim.2514" style="color:#7dd3fc;text-decoration:none;">DOI: 10.1002/sim.2514</a>) ' +
      'inverts the generalised Q statistic at the χ² critical values. Endorsed by Cochrane Handbook v6.5 §10.10.4 ' +
      'as the most accurate τ² CI for the random-effects model. χ² quantiles via Wilson–Hilferty. ' +
      '<strong>Interpretation:</strong> if the lower bound is 0, the data are compatible with no between-study heterogeneity.' +
      '</div>' +
      '</div>';

    const panel = P.buildCollapsiblePanel({
      id: 'tau2-qprofile-panel',
      badge: 'τ² Q-profile CI',
      summary,
      bodyHtml: body,
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('tau2-qprofile-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1900));
    } else { setTimeout(tick, 1900); }
  }

  global.Tau2QProfile = { render, qProfileCI, qChi2, qNorm };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
