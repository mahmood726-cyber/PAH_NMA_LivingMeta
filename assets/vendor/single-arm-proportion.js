/* Single-arm / proportion meta-analysis panel.
 *
 * For reviews where outcomes are pooled within one arm (no comparator):
 * adverse-event rates, prevalence, single-arm Phase II trials, surgical
 * complication rates, post-marketing safety pools, etc.
 *
 * Cochrane Handbook v6.5 §10.3.2.
 *
 * Detection (any of):
 *   - realData[*].singleArm === true
 *   - realData[*].allOutcomes[*].type === 'PROPORTION' (or 'SINGLE_ARM')
 *   - realData[*] has tE+tN with cE/cN missing/null/undefined (single-arm
 *     extraction shape used in some safety reviews)
 *   - realData[*].events + realData[*].n (explicit field pair)
 *
 * Methodology — both reported, side-by-side, sensitivity-aware:
 *
 *   1. Logit transformation (default, Cochrane-recommended)
 *        y_i  = ln( p_i / (1 - p_i) )
 *        v_i  = 1/e_i + 1/(n_i - e_i)
 *        +0.5 continuity correction when e_i==0 or e_i==n_i
 *      DerSimonian–Laird random-effects pool, back-transform to proportion
 *
 *   2. Freeman–Tukey double-arcsine sensitivity (handles 0%/100% natively)
 *        y_i  = ½( arcsin√(e_i/(n_i+1)) + arcsin√((e_i+1)/(n_i+1)) )
 *        v_i  ≈ 1/(4(n_i+½))
 *      Same DL pool on the FT scale, back-transform via inverse-FT
 *      (Schwarzer 2019 caveat noted in panel disclaimer)
 *
 * Auto-bootstrap; collapsed by default. Self-skips when no single-arm
 * data detected.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'single-arm-proportion-expanded';

  function pickSingleArmTrials(rd) {
    if (!rd) return [];
    const out = [];
    Object.values(rd).forEach(t => {
      if (!t) return;
      // Variant 1: explicit singleArm flag
      // Variant 2: allOutcomes carries type === 'PROPORTION' or 'SINGLE_ARM'
      // Variant 3: events + n field pair
      // Variant 4: tE + tN present, cE/cN missing (no comparator at all)
      let e, n;
      const ao = t.allOutcomes;
      if (Array.isArray(ao)) {
        const prop = ao.find(o => o && (o.type === 'PROPORTION' || o.type === 'SINGLE_ARM')
                                     && Number.isFinite(+o.events) && Number.isFinite(+o.n) && +o.n > 0);
        if (prop) { e = +prop.events; n = +prop.n; }
      }
      if (e === undefined && t.singleArm === true && Number.isFinite(+t.events) && Number.isFinite(+t.n) && +t.n > 0) {
        e = +t.events; n = +t.n;
      }
      if (e === undefined && Number.isFinite(+t.events) && Number.isFinite(+t.n) && +t.n > 0
          && (t.cN == null || t.cN === '' || +t.cN === 0)
          && (t.cE == null || t.cE === '' || +t.cE === 0)) {
        e = +t.events; n = +t.n;
      }
      if (e === undefined && Number.isFinite(+t.tE) && Number.isFinite(+t.tN) && +t.tN > 0
          && (t.cN === undefined || t.cN === null || t.cN === '' || +t.cN === 0)
          && (t.cE === undefined || t.cE === null || t.cE === '' || +t.cE === 0)) {
        e = +t.tE; n = +t.tN;
      }
      if (e === undefined || n === undefined) return;
      if (e < 0 || n <= 0 || e > n) return;
      out.push({ name: t.name || '?', e, n });
    });
    return out;
  }

  // Logit transform with +0.5 continuity correction
  function logitPoint(t) {
    let e = t.e, n = t.n;
    if (e === 0 || e === n) { e += 0.5; n += 1; }
    const p = e / n;
    const yi = Math.log(p / (1 - p));
    const vi = 1 / e + 1 / (n - e);
    return { yi, vi };
  }

  function freemanTukeyPoint(t) {
    const { e, n } = t;
    const yi = 0.5 * (Math.asin(Math.sqrt(e / (n + 1))) + Math.asin(Math.sqrt((e + 1) / (n + 1))));
    const vi = 1 / (4 * (n + 0.5));
    return { yi, vi };
  }

  function poolDLRE(points) {
    if (!points || points.length < 2) return null;
    let W = 0, WY = 0;
    points.forEach(p => { const w = 1 / p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    let Q = 0;
    points.forEach(p => { const w = 1 / p.vi; Q += w * Math.pow(p.yi - yFE, 2); });
    const df = points.length - 1;
    const sumW2 = points.reduce((s, p) => s + Math.pow(1 / p.vi, 2), 0);
    const c = W - sumW2 / W;
    const tau2 = Math.max(0, (Q - df) / c);
    let W2 = 0, WY2 = 0;
    points.forEach(p => { const w = 1 / (p.vi + tau2); W2 += w; WY2 += w * p.yi; });
    const yRE = WY2 / W2;
    const seRE = Math.sqrt(1 / W2);
    const I2 = Q > df ? 100 * (Q - df) / Q : 0;
    return {
      yi: yRE, se: seRE,
      ci_low: yRE - 1.96 * seRE,
      ci_high: yRE + 1.96 * seRE,
      k: points.length, tau2, Q, df, I2,
    };
  }

  // Inverse-logit
  function invLogit(y) { return Math.exp(y) / (1 + Math.exp(y)); }
  // Inverse Freeman-Tukey: harmonic-mean-N approximation (Miller 1978)
  function invFreemanTukey(y, harmonicN) {
    // p = (1/2) * (1 - sgn(cos(2y)) * sqrt(1 - (sin(2y) + (sin(2y) − 1/sin(2y))/N)^2))
    // Simpler/practical: use Miller's formula
    if (harmonicN <= 0) return Math.pow(Math.sin(y), 2);
    const sin2y = Math.sin(2 * y);
    const term = sin2y + (sin2y - 1 / Math.max(1e-9, sin2y)) / harmonicN;
    const inside = Math.max(-1, Math.min(1, term));
    const sgn = Math.cos(2 * y) >= 0 ? 1 : -1;
    return 0.5 * (1 - sgn * Math.sqrt(Math.max(0, 1 - inside * inside)));
  }
  // Simple/robust inverse-FT for back-transformation: sin^2(y) when no harmonic info
  function invFreemanTukeyApprox(y) { return Math.pow(Math.sin(y), 2); }

  function buildBody(P, trials, logitPool, ftPool) {
    const fmt = P.fmt;
    const harmonicN = trials.length / trials.reduce((s, t) => s + 1 / t.n, 0);

    // Back-transformed proportions
    const logitProp = invLogit(logitPool.yi);
    const logitLow  = invLogit(logitPool.ci_low);
    const logitHigh = invLogit(logitPool.ci_high);
    const ftProp  = invFreemanTukey(ftPool.yi, harmonicN);
    const ftLow   = invFreemanTukey(ftPool.ci_low, harmonicN);
    const ftHigh  = invFreemanTukey(ftPool.ci_high, harmonicN);

    let html = '';

    // Headline
    const headline = '<strong>Pooled proportion (logit-RE):</strong> '
                   + fmt(logitProp * 100, 1) + '% [' + fmt(logitLow * 100, 1) + '–' + fmt(logitHigh * 100, 1) + '%], k=' + logitPool.k
                   + ' · I²=' + fmt(logitPool.I2, 0) + '%';
    html += '<div style="background:#0e3a1f;border:1px solid #34d399;color:#e2e8f0;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
          + '✓ Single-arm proportion MA detected — ' + headline + '</div>';

    // Small-k advisory: DL+logit unreliable below ~5 trials
    if (logitPool.k <= 5) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-size:11px;">'
            + '⚠ Small-sample advisory: k=' + logitPool.k + ' (≤5). DerSimonian–Laird + logit can have undercoverage at this scale; '
            + 'a binomial-normal generalised linear mixed model (GLMM) via `metafor::rma.glmm(measure="PLO")` in R is typically preferred. '
            + 'Treat the CI as approximate and consider GLMM as a confirmatory sensitivity.'
            + '</div>';
    }
    // Extreme-proportions advisory (Schwarzer 2019)
    const extremeCount = trials.filter(t => t.e === 0 || t.e === t.n).length;
    if (extremeCount >= 1) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-size:11px;">'
            + '⚠ ' + extremeCount + ' trial' + (extremeCount > 1 ? 's' : '') + ' with extreme proportion (0% or 100%). '
            + 'Logit pool used +0.5 continuity correction; Freeman–Tukey shown as sensitivity. Schwarzer 2019 caveat applies.'
            + '</div>';
    }

    // Side-by-side cells
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:10px;">';
    html += cell('Logit pool',
      fmt(logitProp * 100, 1) + '%',
      '95% CI ' + fmt(logitLow * 100, 1) + '–' + fmt(logitHigh * 100, 1) + '%');
    html += cell('Freeman–Tukey (sens.)',
      fmt(ftProp * 100, 1) + '%',
      '95% CI ' + fmt(ftLow * 100, 1) + '–' + fmt(ftHigh * 100, 1) + '%');
    html += cell('Trials (k)', String(logitPool.k));
    html += cell('I² (logit)', fmt(logitPool.I2, 0) + '%');
    html += cell('τ² (logit)', fmt(logitPool.tau2, 4));
    html += cell('Total events / N',
      String(trials.reduce((s, t) => s + t.e, 0)) + ' / ' + trials.reduce((s, t) => s + t.n, 0).toLocaleString());
    html += '</div>';

    // Discrepancy flag
    const deltaPct = Math.abs(logitProp - ftProp) * 100;
    if (deltaPct > 2) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-size:11px;">'
            + '⚠ Logit and Freeman–Tukey pooled proportions differ by ' + fmt(deltaPct, 1) + ' pp. '
            + 'Schwarzer 2019 caveat: when many trials carry 0% or 100% events the FT back-transform can be biased — interpret with care.'
            + '</div>';
    }

    // Per-trial table
    html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Per-trial proportion estimates:</div>';
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;">Trial</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Events / N</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Proportion (%)</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">95% CI (Wilson)</th>'
          + '</tr></thead><tbody>';
    trials.forEach(t => {
      const p = t.e / t.n;
      // Wilson CI
      const z = 1.96;
      const denom = 1 + z * z / t.n;
      const center = (p + z * z / (2 * t.n)) / denom;
      const halfw = z * Math.sqrt(p * (1 - p) / t.n + z * z / (4 * t.n * t.n)) / denom;
      const wLow = Math.max(0, center - halfw);
      const wHigh = Math.min(1, center + halfw);
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + t.name + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + t.e + ' / ' + t.n + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(p * 100, 1) + '%</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(wLow * 100, 1) + '–' + fmt(wHigh * 100, 1) + '%</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    // Method note
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> proportions pooled on (1) logit scale with +0.5 continuity correction for zero/full-event trials, and (2) Freeman–Tukey double-arcsine as sensitivity. '
          + 'DerSimonian–Laird random effects on the transformed scale; back-transform with inverse-logit and Miller-1978-corrected inverse-FT respectively. '
          + 'Cochrane Handbook v6.5 §10.3.2; Schwarzer et al. <em>Res Synth Methods</em> 2019;10:476–83 (caveat on FT back-transform when extreme proportions are present). '
          + 'Sensitivity-only — never replaces a comparator-based pool when one exists.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = pickSingleArmTrials(rd);
    if (trials.length < 2) return false;  // Self-skip silently

    const logitPoints = trials.map(logitPoint);
    const ftPoints = trials.map(freemanTukeyPoint);
    const logitPool = poolDLRE(logitPoints);
    const ftPool = poolDLRE(ftPoints);
    if (!logitPool || !ftPool) return false;

    const harmonicN = trials.length / trials.reduce((s, t) => s + 1 / t.n, 0);
    const logitProp = invLogit(logitPool.yi);
    const summary = 'Pooled ' + P.fmt(logitProp * 100, 1) + '%'
                  + ' [' + P.fmt(invLogit(logitPool.ci_low) * 100, 1)
                  + '–' + P.fmt(invLogit(logitPool.ci_high) * 100, 1)
                  + '%] · k=' + logitPool.k
                  + ' · I²=' + P.fmt(logitPool.I2, 0) + '%';

    const panel = P.buildCollapsiblePanel({
      id: 'single-arm-proportion-panel',
      badge: 'Single-arm pool',
      summary,
      bodyHtml: buildBody(P, trials, logitPool, ftPool),
      storageKey: STORAGE_KEY,
    });

    const existing = document.getElementById('single-arm-proportion-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1200));
    } else {
      setTimeout(tick, 1200);
    }
  }

  global.SingleArmProportion = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
