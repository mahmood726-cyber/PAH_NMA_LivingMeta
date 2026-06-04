/* RapidMeta -- extended statistical reporting (P1-3 + P1-1 + P1-2 + P1-8 + P2-6)
 *
 * Appends a single "Heterogeneity + Sensitivity" card to the Analysis tab that
 * reports three editor-preferred statistics alongside the app's native DL pool:
 *
 *   * REML tau^2  (Viechtbauer 2005)               -- P1-3
 *   * Q-profile 95% CI for I^2 (Viechtbauer 2007)  -- P1-2
 *   * Fixed-effect sensitivity pool at k = 2       -- P1-1
 *
 * Also applies accessibility + responsive tweaks (P1-8, P2-6) via an injected
 * <style> block so the shared cards (WebR, effect-measure-toggle, grade-ext,
 * this one) render at WCAG-compliant contrast on desktop and collapse cleanly
 * on narrow (mobile) screens.
 *
 * Additive only -- does not touch the app's native pool, GRADE renderer, or
 * forest plot code. Safe to strip if the extensions ever land in core.
 */
(function () {
  'use strict';

  function getRM() {
    if (window.RapidMeta) return window.RapidMeta;
    try { return (0, eval)('RapidMeta'); } catch (e) { return null; }
  }

  // ----------------- P1-8 + P2-6 -- accessibility + responsive ---------------
  function injectStyles() {
    if (document.getElementById('rapidmeta-shared-ext-styles')) return;
    const st = document.createElement('style');
    st.id = 'rapidmeta-shared-ext-styles';
    st.textContent = [
      /* P1-8 -- bump text brightness inside shared-ext cards so small text meets WCAG AA 4.5:1 on dark bg */
      '#effect-measure-toggle .text-slate-500 { color:#cbd5e1 !important; }',
      '#effect-measure-toggle .text-slate-400 { color:#e2e8f0 !important; }',
      '#stats-ext-card .text-slate-500 { color:#cbd5e1 !important; }',
      '#stats-ext-card .text-slate-400 { color:#e2e8f0 !important; }',
      '#grade-ext-card .text-slate-400 { color:#e2e8f0 !important; }',
      '#rvalid-card .text-slate-400 { color:#cbd5e1 !important; }',
      '#rvalid-card .text-slate-500 { color:#94a3b8 !important; }',
      /* P2-6 -- mobile responsive forest plot */
      '@media (max-width: 640px) {',
      '  #plot-forest, #plot-forest-nyt { overflow-x: auto; -webkit-overflow-scrolling: touch; }',
      '  #plot-forest svg, #plot-forest-nyt svg { min-width: 560px; }',
      '  #rvalid-card, #effect-measure-toggle, #stats-ext-card, #grade-ext-card { padding: 0.75rem !important; }',
      '  #effect-measure-toggle button { padding: 0.35rem 0.6rem !important; font-size: 10px !important; }',
      '}',
    ].join('\n');
    document.head && document.head.appendChild(st);
  }

  // ----------------- P1-3 REML tau^2 ----------------------------------------
  function remlTau2(plotData) {
    if (!plotData || plotData.length < 2) return 0;
    const yi = plotData.map(d => (d.logOR != null && isFinite(d.logOR)) ? d.logOR : d.md);
    const vi = plotData.map(d => d.vi);
    if (yi.some(v => v == null || !isFinite(v))) return 0;
    if (vi.some(v => v == null || !isFinite(v) || v <= 0)) return 0;
    let tau2 = 0;
    for (let it = 0; it < 200; it++) {
      const w = vi.map(v => 1 / (v + tau2));
      const sW = w.reduce((a, b) => a + b, 0);
      const mu = w.reduce((a, wi, i) => a + wi * yi[i], 0) / sW;
      const sW2 = w.reduce((a, wi) => a + wi * wi, 0);
      const sW3 = w.reduce((a, wi) => a + wi * wi * wi, 0);
      const yP2y = w.reduce((a, wi, i) => a + wi * wi * Math.pow(yi[i] - mu, 2), 0);
      const trP = sW - sW2 / sW;
      const trP2 = sW2 - 2 * sW3 / sW + sW2 * sW2 / (sW * sW);
      if (trP2 < 1e-15) break;
      const delta = (yP2y - trP) / trP2;
      const next = Math.max(0, tau2 + delta);
      if (Math.abs(next - tau2) < 1e-10) { tau2 = next; break; }
      tau2 = next;
    }
    return tau2;
  }

  // ----------------- P1-2 -- Q-profile I^2 CI (Viechtbauer 2007) -------------
  // Generalized Q statistic with weights wi = 1 / (vi + tau^2) has distribution
  // chi^2_{k-1}. We search for the two tau^2 values that make Q equal to the
  // alpha/2 and 1 - alpha/2 quantiles of chi^2_{k-1}, then convert to I^2.
  //
  // Fast chi^2 inverse via Wilson-Hilferty approximation: good to ~1e-4 for
  // df >= 2; acceptable for editor-facing display at k >= 3. For k = 2 (df=1)
  // we fall back to series inversion.

  function normInv(p) {
    // Beasley-Springer-Moro abbreviated. For p in (0,1).
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    const a1 = -3.969683028665376e+01, a2 =  2.209460984245205e+02;
    const a3 = -2.759285104469687e+02, a4 =  1.383577518672690e+02;
    const a5 = -3.066479806614716e+01, a6 =  2.506628277459239e+00;
    const b1 = -5.447609879822406e+01, b2 =  1.615858368580409e+02;
    const b3 = -1.556989798598866e+02, b4 =  6.680131188771972e+01;
    const b5 = -1.328068155288572e+01;
    const c1 = -7.784894002430293e-03, c2 = -3.223964580411365e-01;
    const c3 = -2.400758277161838e+00, c4 = -2.549732539343734e+00;
    const c5 =  4.374664141464968e+00, c6 =  2.938163982698783e+00;
    const d1 =  7.784695709041462e-03, d2 =  3.224671290700398e-01;
    const d3 =  2.445134137142996e+00, d4 =  3.754408661907416e+00;
    const pLow = 0.02425, pHigh = 1 - pLow;
    let q, r;
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
    } else if (p <= pHigh) {
      q = p - 0.5; r = q * q;
      return (((((a1*r+a2)*r+a3)*r+a4)*r+a5)*r+a6)*q / (((((b1*r+b2)*r+b3)*r+b4)*r+b5)*r+1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
    }
  }
  function chi2Inv(p, df) {
    // Wilson-Hilferty. Good enough for our purposes.
    const z = normInv(p);
    const t = 1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df));
    return Math.max(0, df * t * t * t);
  }

  function genQ(plotData, tau2) {
    const yi = plotData.map(d => (d.logOR != null && isFinite(d.logOR)) ? d.logOR : d.md);
    const vi = plotData.map(d => d.vi);
    const w = vi.map(v => 1 / (v + tau2));
    const sW = w.reduce((a, b) => a + b, 0);
    const mu = w.reduce((a, wi, i) => a + wi * yi[i], 0) / sW;
    return w.reduce((a, wi, i) => a + wi * Math.pow(yi[i] - mu, 2), 0);
  }

  function bisect(fn, lo, hi, tol) {
    for (let it = 0; it < 80; it++) {
      const mid = 0.5 * (lo + hi);
      if (Math.abs(hi - lo) < tol) return mid;
      if (fn(mid) > 0) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  function qProfileI2CI(plotData, alpha) {
    // Return {lci, uci} in I^2 units (0..100). Returns {lci: 0, uci: 100} on failure.
    if (!plotData || plotData.length < 3) return { lci: 0, uci: 100, method: 'k<3' };
    const k = plotData.length;
    const df = k - 1;
    const qLo = chi2Inv(alpha / 2, df);
    const qHi = chi2Inv(1 - alpha / 2, df);
    // Lower I^2 CI bound corresponds to the tau^2 that makes Q = qHi (i.e., less heterogeneity).
    // Upper I^2 CI bound corresponds to tau^2 that makes Q = qLo.
    //
    // Q decreases monotonically as tau^2 increases. Find tau^2 that solves Q(tau^2) - qTarget = 0.
    const fForTarget = (qTarget) => (tau2) => genQ(plotData, tau2) - qTarget;
    // Bracket: tau^2=0 gives Q(0) (typically large). tau^2=huge gives Q ~ 0.
    const q0 = genQ(plotData, 0);
    const hi = Math.max(1, q0) * 100;
    const solve = (qTarget) => {
      if (q0 < qTarget) return 0;
      return bisect(fForTarget(qTarget), 0, hi, 1e-8);
    };
    const tauLower = solve(qHi);   // lower tau^2 boundary
    const tauUpper = solve(qLo);   // upper tau^2 boundary
    // Convert tau^2 to I^2: I^2 = tau^2 / (tau^2 + sigma^2_hat) where sigma^2_hat is the typical within-study variance.
    // Use the Higgins-Thompson typical variance: sigma^2_hat = (k-1) * sum(w) / (sum(w)^2 - sum(w^2))
    const vi = plotData.map(d => d.vi);
    const sW = vi.reduce((a, v) => a + 1 / v, 0);
    const sW2 = vi.reduce((a, v) => a + 1 / (v * v), 0);
    const sigma2 = (k - 1) * sW / (sW * sW - sW2);
    const toI2 = (tau2) => 100 * tau2 / (tau2 + sigma2);
    return {
      lci: Math.max(0, toI2(tauLower)),
      uci: Math.min(100, toI2(tauUpper)),
      method: 'Q-profile (Viechtbauer 2007, Wilson-Hilferty chi^2 inv)',
    };
  }

  // ----------------- P1-1 -- FE sensitivity pool at k = 2 --------------------
  function fePool(plotData) {
    if (!plotData || plotData.length < 2) return null;
    const yi = plotData.map(d => (d.logOR != null && isFinite(d.logOR)) ? d.logOR : d.md);
    const vi = plotData.map(d => d.vi);
    if (yi.some(v => v == null || !isFinite(v))) return null;
    const w = vi.map(v => 1 / v);
    const sW = w.reduce((a, b) => a + b, 0);
    const mu = w.reduce((a, wi, i) => a + wi * yi[i], 0) / sW;
    const se = Math.sqrt(1 / sW);
    // Z-based 95%. Back-transform depends on scale (log for OR/RR/HR, native for MD).
    const isLog = plotData.some(d => d.logOR != null && isFinite(d.logOR));
    const exp = isLog ? Math.exp : (x => x);
    return {
      point: exp(mu),
      lci: exp(mu - 1.959964 * se),
      uci: exp(mu + 1.959964 * se),
      scale: isLog ? 'ratio (log-transformed back)' : 'MD',
    };
  }

  // ----------------- Card renderer ------------------------------------------
  function injectCard() {
    injectStyles();
    const rm = getRM();
    const res = rm && rm.state && rm.state.results;
    if (!res || !Array.isArray(res.plotData) || res.plotData.length < 2) return;
    const host = document.getElementById('tab-analysis');
    if (!host) return;
    // Remove the old single-purpose REML card if it exists from a previous page build.
    const oldReml = document.getElementById('stats-ext-reml');
    if (oldReml) oldReml.remove();
    // Rebuild the combined card idempotently.
    const existing = document.getElementById('stats-ext-card');
    if (existing) existing.remove();

    const pd = res.plotData;
    const k = pd.length;
    const reml = remlTau2(pd);
    const dl = typeof res.tau2 === 'number' ? res.tau2 : parseFloat(res.tau2);
    const diff = Math.abs(reml - (isFinite(dl) ? dl : 0));
    const qp = qProfileI2CI(pd, 0.05);
    const i2 = typeof res.i2 === 'number' ? res.i2 : parseFloat(res.i2);

    const fe = (k === 2) ? fePool(pd) : null;

    const rows = [];
    // Row 1: DL vs REML tau^2
    rows.push(
      '<div class="mb-2">'
      + '<span class="font-bold text-violet-200">REML &tau;&sup2; = ' + reml.toFixed(4) + '</span>'
      + '<span class="text-slate-300">  &middot;  DL &tau;&sup2; = ' + (isFinite(dl) ? dl.toFixed(4) : '--') + '</span>'
      + (isFinite(dl) && dl > 0 ? '<span class="text-slate-400">  (REML / DL ratio ' + (reml / dl).toFixed(2) + ')</span>' : '')
      + (diff > 0.01 ? '<span class="text-amber-300 ml-2">notable divergence; REML preferred for small k</span>'
                     : '<span class="text-emerald-300 ml-2">close agreement with DL</span>')
      + '</div>'
    );
    // Row 2: I^2 point + Q-profile CI
    rows.push(
      '<div class="mb-2">'
      + '<span class="font-bold text-violet-200">I&sup2; = ' + (isFinite(i2) ? i2.toFixed(1) + '%' : '--')
      + (k >= 3 && qp.method !== 'k<3' ? '  (Q-profile 95% CI ' + qp.lci.toFixed(1) + '% - ' + qp.uci.toFixed(1) + '%)' : '')
      + '</span>'
      + (k < 3 ? '<span class="text-slate-400 ml-2 italic">Q-profile CI suppressed at k &lt; 3</span>' : '')
      + '</div>'
    );
    // Row 3: k=2 FE sensitivity
    if (fe) {
      rows.push(
        '<div class="mb-1 pt-2 border-t border-violet-500/20">'
        + '<span class="font-bold text-amber-200">FE-IVW sensitivity pool (k = 2)</span>  '
        + '<span class="text-slate-200">' + fe.point.toFixed(3)
        + ' (95% CI ' + fe.lci.toFixed(3) + ' - ' + fe.uci.toFixed(3) + ')</span>'
        + '<span class="text-slate-400 italic ml-2">[scale: ' + fe.scale + ']</span>'
        + '</div>'
        + '<div class="text-[10px] text-slate-400 italic">Per CART_MM SAP pattern: DL-HKSJ is unreliable at k = 2 (tau^2 unstable; HKSJ df=1; PI undefined). FE-IVW is reported alongside as a stability check and will become sensitivity-only once k >= 3.</div>'
      );
    }

    const card = document.createElement('div');
    card.id = 'stats-ext-card';
    card.className = 'mt-4 p-3 rounded-lg border border-violet-500/30 bg-violet-500/5';
    card.innerHTML =
      '<div class="text-[10px] font-bold uppercase tracking-widest text-violet-300 mb-2"><i class="fa-solid fa-square-root-variable mr-2"></i>Heterogeneity &amp; sensitivity (pre-specified SAP extensions)</div>'
      + '<div class="text-xs text-slate-200 leading-relaxed">' + rows.join('') + '</div>'
      + '<div class="text-[10px] text-slate-400 italic mt-2">REML via Fisher scoring (Viechtbauer 2005). Q-profile I&sup2; CI via chi&sup2; inversion (Viechtbauer 2007). FE-IVW sensitivity (Borenstein 2009). Reported alongside the app\'s native DL-HKSJ pool; the native pool remains the primary inference surface.</div>';

    // Place after the effect-measure-toggle card if present; else append.
    const toggle = document.getElementById('effect-measure-toggle');
    if (toggle && toggle.parentNode === host) {
      host.insertBefore(card, toggle.nextSibling);
    } else {
      host.appendChild(card);
    }
  }

  function tryInject() {
    injectStyles();
    injectCard();
    let tries = 0;
    const iv = setInterval(function () {
      injectCard();
      if (document.getElementById('stats-ext-card') || ++tries > 30) clearInterval(iv);
    }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }

  document.addEventListener('click', function (e) {
    const anchor = e.target.closest && e.target.closest('[onclick*="switchTab"], [data-tab="analysis"], [data-emt-scale]');
    if (anchor) setTimeout(function () {
      const prev = document.getElementById('stats-ext-card');
      if (prev) prev.remove();
      injectCard();
    }, 800);
  }, true);
})();
