/* Permutation test for meta-regression slope.
 *
 * Wald-z p-values for meta-regression coefficients are anti-conservative
 * when k is small (Higgins & Thompson, Stat Med 2004;23:1663-82). This
 * panel re-tests the year-as-moderator slope using a permutation null:
 * permute the moderator labels 1000 times, recompute β̂ each time,
 * report p_perm = #(|β̂_perm| ≥ |β̂_obs|) / 1000.
 *
 * Output: observed slope, Wald-z p, permutation p side-by-side with
 *         a small histogram of the null distribution.
 *
 * Auto-bootstrap. Skips when k < 4 or there's no year heterogeneity.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'meta-regression-permutation-expanded';
  const N_PERM = 1000;

  function trialLogOR(t) {
    let ai = +t.tE, ci = +t.cE, n1 = +t.tN, n2 = +t.cN;
    if (!(n1 > 0 && n2 > 0 && ai >= 0 && ci >= 0 && ai <= n1 && ci <= n2)) return null;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const yi = Math.log((ai*(n2-ci))/((n1-ai)*ci));
    const vi = 1/ai + 1/(n1-ai) + 1/ci + 1/(n2-ci);
    const year = +t.year;
    return Number.isFinite(year) ? { yi, vi, x: year } : null;
  }

  // Weighted least-squares slope: β̂ = Σ w(x-x̄)(y-ȳ) / Σ w(x-x̄)²
  // SE under DL random effects: weights 1/(v_i + τ²)
  function wls(pts, tau2) {
    let W = 0, WX = 0, WY = 0;
    pts.forEach(p => { const w = 1/(p.vi + tau2); W += w; WX += w*p.x; WY += w*p.yi; });
    const xbar = WX/W, ybar = WY/W;
    let Sxx = 0, Sxy = 0;
    pts.forEach(p => {
      const w = 1/(p.vi + tau2);
      Sxx += w * (p.x - xbar) * (p.x - xbar);
      Sxy += w * (p.x - xbar) * (p.yi - ybar);
    });
    const beta = Sxx > 0 ? Sxy / Sxx : 0;
    const seBeta = Sxx > 0 ? Math.sqrt(1 / Sxx) : Infinity;
    return { beta, seBeta };
  }

  function dlTau2(pts) {
    let W = 0, WY = 0;
    pts.forEach(p => { const w = 1/p.vi; W += w; WY += w*p.yi; });
    const yFE = WY/W;
    let Q = 0;
    pts.forEach(p => { const w = 1/p.vi; Q += w*Math.pow(p.yi - yFE, 2); });
    const df = pts.length - 1;
    const sumW2 = pts.reduce((s, p) => s + Math.pow(1/p.vi, 2), 0);
    const c = W - sumW2/W;
    return Math.max(0, (Q - df)/c);
  }

  // Mulberry32 (deterministic; seeded so reviewers can reproduce)
  function rng(seed) {
    let t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function permute(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pNorm2sided(z) {
    // 2-sided Wald-z p
    const az = Math.abs(z);
    // Abramowitz & Stegun 26.2.17
    const t = 1 / (1 + 0.2316419 * az);
    const d = 0.3989422804014327 * Math.exp(-0.5 * az * az);
    const cdf = 1 - d * (0.31938153*t - 0.356563782*t*t +
                          1.781477937*t*t*t - 1.821255978*t*t*t*t +
                          1.330274429*t*t*t*t*t);
    return 2 * (1 - cdf);
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;

    const pts = [];
    Object.values(rd).forEach(t => {
      const lo = trialLogOR(t);
      if (lo) pts.push(lo);
    });
    if (pts.length < 4) return false;

    // Need year variation
    const years = pts.map(p => p.x);
    const yMin = Math.min(...years), yMax = Math.max(...years);
    if (yMax - yMin < 2) return false;

    // Centre x for numerical stability
    const xbar = years.reduce((a, b) => a + b, 0) / years.length;
    const centred = pts.map(p => ({ yi: p.yi, vi: p.vi, x: p.x - xbar }));

    const tau2 = dlTau2(centred);
    const obs = wls(centred, tau2);
    const z = obs.beta / obs.seBeta;
    const p_wald = isFinite(z) ? pNorm2sided(z) : 1;

    // Permutation: hold yi and vi together, permute the x labels
    const ys = centred.map(p => p.yi);
    const vs = centred.map(p => p.vi);
    const xs = centred.map(p => p.x);
    const rand = rng(20260506);
    let count_extreme = 0;
    const null_betas = new Array(N_PERM);
    const obsAbs = Math.abs(obs.beta);
    for (let i = 0; i < N_PERM; i++) {
      const xp = permute(xs, rand);
      const ptsP = ys.map((y, j) => ({ yi: y, vi: vs[j], x: xp[j] }));
      const r = wls(ptsP, tau2);
      null_betas[i] = r.beta;
      if (Math.abs(r.beta) >= obsAbs) count_extreme++;
    }
    const p_perm = (count_extreme + 1) / (N_PERM + 1);

    // Histogram (20 bins, symmetric around 0)
    const allBetas = null_betas.slice();
    const absMax = Math.max(...allBetas.map(Math.abs), obsAbs) * 1.05;
    const nBins = 20;
    const bins = new Array(nBins).fill(0);
    null_betas.forEach(b => {
      const idx = Math.min(nBins - 1, Math.max(0, Math.floor(((b + absMax) / (2 * absMax)) * nBins)));
      bins[idx]++;
    });
    const maxBin = Math.max(...bins);

    const W = 700, H = 130, padL = 50, padR = 12, padT = 6, padB = 24;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    bins.forEach((c, i) => {
      const x = padL + (i / nBins) * innerW;
      const w = (innerW / nBins) - 1;
      const h = c > 0 ? (c / maxBin) * innerH : 0;
      svg += '<rect x="' + x + '" y="' + (padT + innerH - h) + '" width="' + w + '" height="' + h + '" fill="#3b82f6" opacity="0.6" />';
    });
    // Observed β̂ as red vertical line
    const obsX = padL + ((obs.beta + absMax) / (2 * absMax)) * innerW;
    svg += '<line x1="' + obsX + '" x2="' + obsX + '" y1="' + padT + '" y2="' + (padT + innerH) + '" stroke="#ef4444" stroke-width="2" />';
    svg += '<text x="' + obsX + '" y="' + (padT + 12) + '" fill="#ef4444" font-size="10" text-anchor="middle">β̂ obs</text>';
    // Axis
    svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (padT + innerH) + '" y2="' + (padT + innerH) + '" stroke="#475569" />';
    svg += '<text x="' + padL + '" y="' + (H - 4) + '" fill="#94a3b8" font-size="10">' + (-absMax).toFixed(2) + '</text>';
    svg += '<text x="' + (W - padR) + '" y="' + (H - 4) + '" fill="#94a3b8" font-size="10" text-anchor="end">' + absMax.toFixed(2) + '</text>';
    svg += '<text x="' + (padL + innerW/2) + '" y="' + (H - 4) + '" fill="#94a3b8" font-size="10" text-anchor="middle">β̂ permuted (year shuffled)</text>';
    svg += '</svg>';

    const summary = 'β̂=' + obs.beta.toFixed(4) + ' · Wald p=' + p_wald.toFixed(3) +
                    ' · permutation p=' + p_perm.toFixed(3) + ' · k=' + pts.length;

    const body =
      '<div style="font-size:11px;color:#cbd5e1;line-height:1.6;">' +
      '<table style="width:100%;border-collapse:collapse;font-family:JetBrains Mono,monospace;font-size:11px;margin-bottom:8px;">' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Moderator</td><td style="color:#7dd3fc;">Trial year (centred at ' + xbar.toFixed(0) + ')</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">k (trials with year)</td><td style="color:#7dd3fc;">' + pts.length + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Year span</td><td style="color:#7dd3fc;">' + yMin + ' – ' + yMax + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">τ̂² (residual, DL)</td><td style="color:#7dd3fc;">' + tau2.toFixed(4) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Observed β̂</td><td style="color:#7dd3fc;">' + obs.beta.toFixed(4) + ' (SE ' + obs.seBeta.toFixed(4) + ')</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Wald-z p (asymptotic)</td><td style="color:#7dd3fc;">' + p_wald.toFixed(4) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Permutation p (1000 perm)</td><td style="color:' + (p_perm < 0.05 ? '#22c55e' : '#7dd3fc') + ';">' + p_perm.toFixed(4) +
      ' &nbsp;<span style="color:#64748b;">(' + count_extreme + '/' + N_PERM + ' shuffles ≥ |β̂|)</span></td></tr>' +
      '</table>' +
      svg +
      '<div style="margin-top:8px;font-size:10.5px;color:#64748b;line-height:1.5;">' +
      'Wald p uses the asymptotic Z reference; permutation p uses an exact, distribution-free reference. ' +
      'When k is small the Wald p is anti-conservative (rejects too easily). ' +
      'A large gap between the two is itself diagnostic. ' +
      '<a href="https://doi.org/10.1002/sim.1186" style="color:#7dd3fc;text-decoration:none;">Higgins & Thompson Stat Med 2004</a>. ' +
      'Seed pinned (mulberry32, 20260506) for bit-reproducibility.' +
      '</div></div>';

    const panel = P.buildCollapsiblePanel({
      id: 'meta-regression-permutation-panel',
      badge: 'Permutation test (year)',
      summary,
      bodyHtml: body,
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('meta-regression-permutation-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 2100));
    } else { setTimeout(tick, 2100); }
  }

  global.MetaRegPermutation = { render, __test__: { rng, permute } };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
