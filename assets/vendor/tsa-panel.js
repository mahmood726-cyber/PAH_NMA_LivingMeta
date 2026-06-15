/* Trial Sequential Analysis (TSA) panel.
 *
 * Reports:
 *   - Required Information Size (RIS) for the pooled effect under
 *     two-sided α=0.05, β=0.20, with diversity-adjusted heterogeneity correction
 *     (Wetterslev–Thorlund D² ≈ tau²/(σ² + tau²) on the log-OR scale)
 *   - Cumulative z under O'Brien-Fleming alpha-spending boundaries
 *     z_k = z_{α/2} / sqrt(t_k), where t_k = N_accumulated / RIS
 *   - "Conclusive at α=0.05?" verdict — z_cum > boundary or below futility
 *
 * Reference: Wetterslev J, Thorlund K, Brok J, Gluud C. J Clin Epidemiol 2008.
 *            Cochrane Handbook v6.5 — TSA is a sensitivity analysis.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'tsa-panel-expanded';

  // Inverse standard normal (Acklam approximation)
  function qnorm(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pLow = 0.02425, pHigh = 1 - pLow;
    let q, r;
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
    if (p <= pHigh) {
      q = p - 0.5; r = q*q;
      return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }

  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d, n: t.n1i + t.n2i, year: t.year };
  }

  function computeTSA(trials, pool, alpha, beta) {
    if (trials.length < 3) return null;
    const z_a = qnorm(1 - alpha / 2);
    const z_b = qnorm(1 - beta);

    // Use pooled control event rate as P_C
    let totalCtlE = 0, totalCtlN = 0;
    trials.forEach(t => { totalCtlE += t.ci; totalCtlN += t.n2i; });
    const PC = totalCtlE / totalCtlN;
    if (!(PC > 0 && PC < 1)) return null;

    // Anticipated relative risk reduction from observed pooled OR
    const OR = pool.OR;
    const PT_odds = (PC / (1 - PC)) * OR;
    const PT = PT_odds / (1 + PT_odds);
    const RRR = (PC - PT) / PC; // relative risk reduction (signed)
    if (Math.abs(RRR) < 0.001) return null;

    // Standard sample size formula for proportion difference:
    // N per arm = ( (z_a + z_b)² × (PT*(1-PT) + PC*(1-PC)) ) / (PC - PT)²
    const numer = Math.pow(z_a + z_b, 2) * (PT * (1 - PT) + PC * (1 - PC));
    const denom = Math.pow(PC - PT, 2);
    const N_per_arm = numer / denom;
    const N_naive = 2 * N_per_arm;

    // Diversity D² adjustment: D² = (sum(w_i)*(W_RE)) ratio replaced by
    // approximation D² ≈ tau² / (tau² + s²), where s² = median sampling variance
    const points = trials.map(trialLogOR);
    const medV = (() => {
      const arr = points.map(p => p.vi).sort((a, b) => a - b);
      return arr[Math.floor(arr.length / 2)];
    })();
    const D2 = pool.tau2 > 0 ? pool.tau2 / (pool.tau2 + medV) : 0;
    const N_adj = N_naive / (1 - D2);

    // Cumulative z over trial sequence (sorted by year; if no year, by order)
    const sorted = points.slice();
    if (sorted.every(p => p.year)) sorted.sort((a, b) => a.year - b.year);
    let cumW = 0, cumWY = 0, cumN = 0;
    const cumPoints = [];
    sorted.forEach(p => {
      const w = 1 / p.vi;
      cumW += w; cumWY += w * p.yi; cumN += p.n;
      const yCum = cumWY / cumW;
      const seCum = Math.sqrt(1 / cumW);
      const zCum = yCum / seCum;
      const t_k = cumN / N_adj;
      const boundary = t_k > 0 ? z_a / Math.sqrt(Math.min(1, t_k)) : Infinity;
      cumPoints.push({ year: p.year, n_cum: cumN, z: zCum, t_k, boundary });
    });

    const last = cumPoints[cumPoints.length - 1];
    let verdict;
    if (Math.abs(last.z) >= last.boundary && last.t_k > 0.05) {
      verdict = 'conclusive (boundary crossed)';
    } else if (last.t_k >= 1.0) {
      verdict = 'inconclusive — RIS reached, no boundary crossing';
    } else {
      verdict = 'pending — accrued ' + Math.round(100 * last.t_k) + '% of RIS';
    }

    return { z_a, z_b, PC, PT, RRR, N_adj, N_naive, D2, cumPoints, verdict };
  }

  function buildSVG(P, tsa) {
    const W = 720, H = 320, margin = { l: 70, r: 30, t: 30, b: 50 };
    const innerW = W - margin.l - margin.r, innerH = H - margin.t - margin.b;

    const xMax = 1.0;
    const yAbsMax = Math.max(4, ...tsa.cumPoints.map(p => Math.abs(p.z)), tsa.cumPoints[0]?.boundary || 4);

    const x = v => margin.l + (Math.min(v, 1) / xMax) * innerW;
    const y = v => margin.t + innerH / 2 - (v / yAbsMax) * (innerH / 2);

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';

    // Axes
    svg += '<line x1="' + margin.l + '" x2="' + (W - margin.r) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="#475569" />';
    svg += '<line x1="' + margin.l + '" x2="' + margin.l + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#475569" />';

    // Boundary curves: z_a/sqrt(t)
    const segs = [];
    for (let i = 1; i <= 100; i++) {
      const t = i / 100;
      const b = tsa.z_a / Math.sqrt(t);
      const px = x(t), py = y(b), pyN = y(-b);
      segs.push({ px, py, pyN });
    }
    let dUp = '', dLo = '';
    segs.forEach((s, i) => {
      dUp += (i === 0 ? 'M' : 'L') + s.px + ',' + s.py;
      dLo += (i === 0 ? 'M' : 'L') + s.px + ',' + s.pyN;
    });
    svg += '<path d="' + dUp + '" stroke="#fbbf24" stroke-width="1.5" fill="none" />';
    svg += '<path d="' + dLo + '" stroke="#fbbf24" stroke-width="1.5" fill="none" />';
    svg += '<text x="' + (W - margin.r - 6) + '" y="' + y(tsa.z_a) + '" fill="#fbbf24" font-size="10" text-anchor="end" dominant-baseline="text-after-edge">α=0.05 monitoring</text>';

    // RIS line at t=1
    const xRIS = x(1);
    svg += '<line x1="' + xRIS + '" x2="' + xRIS + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#475569" stroke-dasharray="3,3" />';
    svg += '<text x="' + xRIS + '" y="' + (margin.t - 6) + '" fill="#94a3b8" font-size="10" text-anchor="middle">RIS</text>';

    // Cumulative z line
    let zPath = '';
    tsa.cumPoints.forEach((p, i) => {
      const px = x(p.t_k), py = y(p.z);
      zPath += (i === 0 ? 'M' : 'L') + px + ',' + py;
    });
    svg += '<path d="' + zPath + '" stroke="#7dd3fc" stroke-width="2" fill="none" />';
    tsa.cumPoints.forEach(p => {
      svg += '<circle cx="' + x(p.t_k) + '" cy="' + y(p.z) + '" r="3" fill="#7dd3fc"><title>' + (p.year || '?') + ': z=' + p.z.toFixed(2) + ', t=' + (p.t_k * 100).toFixed(0) + '%</title></circle>';
    });

    // Y-axis labels at -3,-2,0,2,3
    [-yAbsMax, -2, 0, 2, yAbsMax].forEach(v => {
      const py = y(v);
      svg += '<text x="' + (margin.l - 6) + '" y="' + py + '" fill="#94a3b8" font-size="10" text-anchor="end" dominant-baseline="central">' + v.toFixed(1) + '</text>';
    });
    // X-axis percent
    [0.25, 0.5, 0.75, 1.0].forEach(t => {
      svg += '<text x="' + x(t) + '" y="' + (H - margin.b + 14) + '" fill="#94a3b8" font-size="10" text-anchor="middle">' + (t * 100) + '%</text>';
    });

    svg += '<text x="' + (margin.l + innerW / 2) + '" y="' + (H - margin.b + 36) + '" fill="#cbd5e1" font-size="10.5" text-anchor="middle">Information accrued (N / RIS)</text>';
    svg += '<text transform="translate(' + (margin.l - 50) + ',' + (margin.t + innerH / 2) + ') rotate(-90)" fill="#cbd5e1" font-size="10.5" text-anchor="middle">Cumulative z</text>';

    svg += '</svg>';
    return svg;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 3) return false;

    const pool = P.poolRandomLogOR(trials);
    if (!pool) return false;

    const tsa = computeTSA(trials, pool, 0.05, 0.20);
    if (!tsa) return false;

    const svg = buildSVG(P, tsa);

    const accrued_pct_raw = (tsa.cumPoints[tsa.cumPoints.length-1].t_k) * 100;
    const accrued_pct = Math.min(100, Math.round(accrued_pct_raw));
    const accrued_label = accrued_pct_raw >= 100 ? '≥100%' : accrued_pct + '%';
    const umbrella = P.isNMA && P.isNMA() ? ' [umbrella]' : '';
    const summary = tsa.verdict + ' · accrued ' + accrued_label + ' of RIS (' + Math.round(tsa.N_adj).toLocaleString() + ')' + umbrella;

    const stats = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px;">';
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    let statsHtml = stats
      + cell('Required Info Size', Math.round(tsa.N_adj).toLocaleString(), 'D²-adjusted')
      + cell('Naïve N (no D²)', Math.round(tsa.N_naive).toLocaleString())
      + cell('Diversity D²', P.fmt(tsa.D2 * 100, 1) + '%', 'tau² / (tau²+s²)')
      + cell('Control rate', P.fmt(tsa.PC * 100, 2) + '%', 'observed pooled')
      + cell('Anticipated tx rate', P.fmt(tsa.PT * 100, 2) + '%', 'from pooled OR')
      + cell('Accrued', accrued_label, String(trials.length) + ' trial' + (trials.length>1?'s':'') + ' · raw ' + Math.round(accrued_pct_raw) + '%')
      + '</div>';

    const note = '<div style="font-size:10.5px;color:#94a3b8;margin-top:8px;line-height:1.5;">'
               + 'O\'Brien–Fleming alpha-spending; α=0.05, β=0.20. Boundary z = z<sub>α/2</sub>/√t. '
               + 'Diversity-adjusted RIS: N<sub>naïve</sub>/(1−D²) where D² ≈ τ²/(τ²+s̄²). '
               + 'Conclusive ⇔ |z<sub>cum</sub>| ≥ boundary <em>and</em> t > 0.05. '
               + 'Wetterslev/Thorlund/Brok/Gluud, <em>J Clin Epidemiol</em> 2008. '
               + 'Sensitivity only — does not replace pooled effect estimation.'
               + '</div>';

    const panel = P.buildCollapsiblePanel({
      id: 'tsa-panel',
      badge: 'TSA',
      summary,
      bodyHtml: statsHtml + svg + note,
      storageKey: STORAGE_KEY,
    });

    const existing = document.getElementById('tsa-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 550));
    } else {
      setTimeout(tick, 550);
    }
  }

  global.TSAPanel = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
