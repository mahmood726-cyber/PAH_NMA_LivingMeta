/* Diagnostic Test Accuracy (DTA) meta-analysis panel.
 *
 * For reviews where trials report 2×2 diagnostic-test data (TP, FP, FN,
 * TN against a reference standard), pools sensitivity and specificity
 * across studies and produces a summary diagnostic odds ratio (DOR).
 *
 * Methodology — pragmatic implementation:
 *   - Logit transformation of Se and (1-Sp) with continuity correction
 *   - DerSimonian-Laird random-effects pool independently on each scale
 *     (rho fixed at 0 — defensible per advanced-stats.md when k<5 or
 *     bivariate optimisation fails to converge)
 *   - Back-transform pooled estimates to proportion scale
 *   - DOR = Se×Sp / ((1−Se)×(1−Sp))
 *
 * Full bivariate Reitsma–Chu–Cole model (with within-study correlation
 * and between-study Σ matrix) requires `mada::reitsma()` in R; flagged
 * in the panel disclaimer for studies that need the full HSROC.
 *
 * Detection (any of):
 *   - realData[*].TP/FP/FN/TN explicit fields
 *   - realData[*].allOutcomes[*].type === 'DTA' or 'DIAGNOSTIC' with
 *     {tp, fp, fn, tn}
 *   - realData[*].sens + .spec + .n (Se/Sp pre-computed plus N for
 *     reconstruction)
 *
 * Auto-bootstrap; collapsed by default. Self-skips silently when no
 * DTA data detected.
 *
 * Cochrane Handbook v6.5 ch.20 (DTA reviews); Reitsma 2005 JCE;
 * Chu & Cole 2006 JCE; Macaskill et al. Cochrane DTA Handbook 2010.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'dta-bivariate-expanded';

  // Order-flexible cell parsing: extract each of TP/FP/FN/TN independently
  // from free-text rationale fields. Fall back to "Sens X% / Spec Y% on N+/M−"
  // back-computation when 2×2 not present verbatim.
  function parseCellsFromText(text) {
    if (!text) return null;
    // Accept thousand-separator commas: "FP=1,832" → 1832. Strip commas
    // before Number().
    const stripCommas = s => +String(s).replace(/,/g, '');
    const re = (label) => new RegExp('\\b' + label + '\\s*=\\s*(\\d{1,3}(?:,\\d{3})*|\\d+)', 'i');
    const grab = (label) => {
      const m = text.match(re(label));
      return m ? stripCommas(m[1]) : null;
    };
    const TP = grab('TP'), FP = grab('FP'), FN = grab('FN'), TN = grab('TN');
    if (TP !== null && FP !== null && FN !== null && TN !== null) {
      return { TP, FP, FN, TN };
    }
    // Variant A: "Sens 88% / Spec 96% on 462 culture-positive + 977 culture-negative"
    const sm = text.match(/Sens\s*[≈~]?\s*(\d+(?:\.\d+)?)\s*%/i);
    const spm = text.match(/Spec\s*[≈~]?\s*(\d+(?:\.\d+)?)\s*%/i);
    const nPosM = text.match(/(\d+)\s*(?:culture[\s-]?positive|TB[+\s]?\+?|disease[d\s]?\+?|positive)/i);
    const nNegM = text.match(/(\d+)\s*(?:culture[\s-]?negative|TB[\s-]?[−-]?|disease[d\s]?[−-]?|negative)/i);
    if (sm && spm && nPosM && nNegM) {
      const sens = +sm[1] / 100;
      const spec = +spm[1] / 100;
      const nPos = +nPosM[1], nNeg = +nNegM[1];
      const _TP = Math.round(sens * nPos);
      const _FN = nPos - _TP;
      const _TN = Math.round(spec * nNeg);
      const _FP = nNeg - _TN;
      if (_TP >= 0 && _FN >= 0 && _TN >= 0 && _FP >= 0) {
        return { TP: _TP, FP: _FP, FN: _FN, TN: _TN };
      }
    }
    // Variant B: slot-positional "raw counts X/Y and Z/W" — first pair
    // (TP/diseased+) and second pair (TN/healthy−). Used by some
    // GENEXPERT pediatric studies.
    const slotM = text.match(/(\d+)\s*\/\s*(\d+)\s*(?:and|;|\.|,)\s*(\d+)\s*\/\s*(\d+)/);
    if (slotM) {
      const tp = +slotM[1], dPos = +slotM[2];
      const tn = +slotM[3], dNeg = +slotM[4];
      if (tp <= dPos && tn <= dNeg && dPos > 0 && dNeg > 0) {
        return { TP: tp, FP: dNeg - tn, FN: dPos - tp, TN: tn };
      }
    }
    return null;
  }

  function pickDTATrials(rd) {
    const out = [];

    // Path A: legacy DTA reviews — _screeningStudies array with rationale text
    const screeningStudies = global._screeningStudies;
    if (Array.isArray(screeningStudies)) {
      screeningStudies.forEach(s => {
        if (!s || s.decision !== 'included') return;
        const cells = parseCellsFromText(s.rationale || '');
        if (!cells) return;
        const { TP, FP, FN, TN } = cells;
        if ((TP + FN) > 0 && (TN + FP) > 0) {
          out.push({ name: s.studlab || s.title || '?', TP, FP, FN, TN });
        }
      });
      if (out.length >= 2) return out;
    }

    // Path B: standard RapidMeta realData shape
    if (!rd) return out;
    Object.values(rd).forEach(t => {
      if (!t) return;
      // Variant 1: explicit TP/FP/FN/TN at top level
      const TP = +t.TP, FP = +t.FP, FN = +t.FN, TN = +t.TN;
      if ([TP, FP, FN, TN].every(v => Number.isFinite(v) && v >= 0)
          && (TP + FN) > 0 && (TN + FP) > 0) {
        out.push({ name: t.name || '?', TP, FP, FN, TN });
        return;
      }
      // Variant 2: allOutcomes carries a DTA outcome
      const ao = t.allOutcomes || (t.data && t.data.allOutcomes);
      if (Array.isArray(ao)) {
        const dta = ao.find(o => o && (o.type === 'DTA' || o.type === 'DIAGNOSTIC')
                                    && Number.isFinite(+o.tp) && Number.isFinite(+o.fp)
                                    && Number.isFinite(+o.fn) && Number.isFinite(+o.tn));
        if (dta) {
          const _TP = +dta.tp, _FP = +dta.fp, _FN = +dta.fn, _TN = +dta.tn;
          if ((_TP + _FN) > 0 && (_TN + _FP) > 0) {
            out.push({ name: t.name || '?', TP: _TP, FP: _FP, FN: _FN, TN: _TN });
            return;
          }
        }
      }
      // Variant 3: pre-computed sens, spec, n
      if (Number.isFinite(+t.sens) && Number.isFinite(+t.spec) && Number.isFinite(+t.diseased) && Number.isFinite(+t.healthy)) {
        const tp = Math.round(+t.sens * +t.diseased);
        const fn = +t.diseased - tp;
        const tn = Math.round(+t.spec * +t.healthy);
        const fp = +t.healthy - tn;
        if (tp >= 0 && fn >= 0 && tn >= 0 && fp >= 0 && +t.diseased > 0 && +t.healthy > 0) {
          out.push({ name: t.name || '?', TP: tp, FP: fp, FN: fn, TN: tn });
        }
      }
    });
    return out;
  }

  // If the host page exposes a full RapidMetaDTA engine (legacy DTA
  // reviews ship one with bivariate fitting + HSROC reparameterisation +
  // threshold-effect detection), use its richer output instead of our
  // independent-univariate fallback.
  function tryEnginePool(trials) {
    const Eng = global.RapidMetaDTA;
    if (!Eng || typeof Eng.fit !== 'function') return null;
    try {
      const r = Eng.fit(trials);
      if (!r || r.error) return null;
      return r;
    } catch (e) {
      return null;
    }
  }

  function logit(p) { return Math.log(p / (1 - p)); }
  function invLogit(y) { return Math.exp(y) / (1 + Math.exp(y)); }

  // Spearman rank correlation — for threshold-effect detection per
  // Cochrane DTA Handbook §10. |ρ| > 0.6 signals threshold heterogeneity
  // and means a single (Se, Sp) point is misleading; SROC should be reported.
  function spearmanRho(xs, ys) {
    if (xs.length !== ys.length || xs.length < 3) return null;
    const rank = (arr) => {
      const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
      const r = new Array(arr.length);
      // Average ranks for ties
      let i = 0;
      while (i < idx.length) {
        let j = i;
        while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
        const avg = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
        i = j + 1;
      }
      return r;
    };
    const rx = rank(xs), ry = rank(ys);
    const n = xs.length;
    const meanX = (n + 1) / 2, meanY = (n + 1) / 2;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const a = rx[i] - meanX, b = ry[i] - meanY;
      num += a * b; dx += a * a; dy += b * b;
    }
    if (dx === 0 || dy === 0) return null;
    return num / Math.sqrt(dx * dy);
  }

  function trialSensSpec(t) {
    let TP = t.TP, FN = t.FN, TN = t.TN, FP = t.FP;
    // Continuity correction for any zero cell
    if (TP === 0 || FN === 0 || TN === 0 || FP === 0) {
      TP += 0.5; FN += 0.5; TN += 0.5; FP += 0.5;
    }
    const se = TP / (TP + FN);
    const sp = TN / (TN + FP);
    return {
      Se: se, Sp: sp,
      logitSe: logit(se),
      logitSp: logit(sp),
      varLogitSe: 1/TP + 1/FN,
      varLogitSp: 1/TN + 1/FP,
      LRpos: se / (1 - sp),
      LRneg: (1 - se) / sp,
      DORtrial: (TP * TN) / (FP * FN),
    };
  }

  function poolDLRE(yi, vi) {
    if (yi.length < 2) return null;
    let W = 0, WY = 0;
    for (let i = 0; i < yi.length; i++) { const w = 1 / vi[i]; W += w; WY += w * yi[i]; }
    const yFE = WY / W;
    let Q = 0;
    for (let i = 0; i < yi.length; i++) Q += (1 / vi[i]) * Math.pow(yi[i] - yFE, 2);
    const df = yi.length - 1;
    const sumW2 = vi.reduce((s, v) => s + Math.pow(1/v, 2), 0);
    const c = W - sumW2 / W;
    const tau2 = Math.max(0, (Q - df) / c);
    let W2 = 0, WY2 = 0;
    for (let i = 0; i < yi.length; i++) {
      const w = 1 / (vi[i] + tau2);
      W2 += w; WY2 += w * yi[i];
    }
    const yRE = WY2 / W2;
    const seRE = Math.sqrt(1/W2);
    return {
      mean: yRE, se: seRE,
      ci_low: yRE - 1.96 * seRE,
      ci_high: yRE + 1.96 * seRE,
      tau2, Q, df, k: yi.length,
    };
  }

  function buildROC(P, trials, summary) {
    const W = 720, H = 380, margin = { l: 60, r: 30, t: 30, b: 50 };
    const innerW = W - margin.l - margin.r, innerH = H - margin.t - margin.b;
    const x = v => margin.l + v * innerW;       // 1-Sp on [0, 1]
    const y = v => margin.t + (1 - v) * innerH; // Se on [0, 1]

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    // Diagonal "no-discrimination" line
    svg += '<line x1="' + x(0) + '" y1="' + y(0) + '" x2="' + x(1) + '" y2="' + y(1) + '" stroke="#475569" stroke-dasharray="3,3" />';
    // Axes
    svg += '<line x1="' + margin.l + '" x2="' + (W - margin.r) + '" y1="' + (H - margin.b) + '" y2="' + (H - margin.b) + '" stroke="#475569" />';
    svg += '<line x1="' + margin.l + '" x2="' + margin.l + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#475569" />';

    // Tick labels
    [0, 0.25, 0.5, 0.75, 1.0].forEach(t => {
      svg += '<line x1="' + x(t) + '" x2="' + x(t) + '" y1="' + (H - margin.b) + '" y2="' + (H - margin.b + 4) + '" stroke="#94a3b8" />';
      svg += '<text x="' + x(t) + '" y="' + (H - margin.b + 16) + '" fill="#94a3b8" font-size="10" text-anchor="middle">' + t.toFixed(2) + '</text>';
      svg += '<line x1="' + (margin.l - 4) + '" x2="' + margin.l + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="#94a3b8" />';
      svg += '<text x="' + (margin.l - 8) + '" y="' + y(t) + '" fill="#94a3b8" font-size="10" text-anchor="end" dominant-baseline="central">' + t.toFixed(2) + '</text>';
    });
    svg += '<text x="' + (margin.l + innerW/2) + '" y="' + (H - margin.b + 36) + '" fill="#cbd5e1" font-size="11" text-anchor="middle">1 − Specificity (FPR)</text>';
    svg += '<text transform="translate(' + (margin.l - 38) + ',' + (margin.t + innerH/2) + ') rotate(-90)" fill="#cbd5e1" font-size="11" text-anchor="middle">Sensitivity (TPR)</text>';
    // Header
    svg += '<text x="' + margin.l + '" y="' + (margin.t - 8) + '" fill="#cbd5e1" font-size="11" font-weight="600">ROC space — per-trial points + summary</text>';

    // Per-trial points
    trials.forEach(t => {
      const fpr = 1 - t.Sp;
      const ssize = t.TP + t.FN + t.TN + t.FP;
      const r = 3 + 5 * Math.sqrt(ssize / 1000);
      svg += '<circle cx="' + x(fpr) + '" cy="' + y(t.Se) + '" r="' + Math.min(r, 12) + '" fill="#7dd3fc" fill-opacity="0.55" stroke="#0b1220" stroke-width="1"><title>' + t.name + ': Se=' + (t.Se*100).toFixed(1) + '%, Sp=' + (t.Sp*100).toFixed(1) + '%</title></circle>';
    });

    // Summary point + axis-aligned 95% confidence rectangle (rho=0)
    const sFpr = 1 - summary.Sp;
    svg += '<rect x="' + x(1 - summary.Sp_ci_high) + '" y="' + y(summary.Se_ci_high) + '" width="' + (x(1 - summary.Sp_ci_low) - x(1 - summary.Sp_ci_high)) + '" height="' + (y(summary.Se_ci_low) - y(summary.Se_ci_high)) + '" fill="#fbbf24" fill-opacity="0.12" stroke="#fbbf24" stroke-dasharray="3,3" stroke-width="1" />';
    svg += '<rect x="' + (x(sFpr) - 6) + '" y="' + (y(summary.Se) - 6) + '" width="12" height="12" transform="rotate(45 ' + x(sFpr) + ' ' + y(summary.Se) + ')" fill="#fbbf24" stroke="#0b1220" stroke-width="1.5" />';
    svg += '<text x="' + (x(sFpr) + 14) + '" y="' + y(summary.Se) + '" fill="#fbbf24" font-size="10" font-weight="600" dominant-baseline="central">summary</text>';

    svg += '</svg>';
    return svg;
  }

  function buildBody(P, trials, sePool, spPool, dorPool) {
    const fmt = P.fmt;
    const Se = invLogit(sePool.mean);
    const Sp = invLogit(spPool.mean);
    const Se_ci_low = invLogit(sePool.ci_low);
    const Se_ci_high = invLogit(sePool.ci_high);
    const Sp_ci_low = invLogit(spPool.ci_low);
    const Sp_ci_high = invLogit(spPool.ci_high);
    const DOR = Math.exp(dorPool.mean);
    const DOR_ci_low = Math.exp(dorPool.ci_low);
    const DOR_ci_high = Math.exp(dorPool.ci_high);

    let html = '';

    // Small-k advisory — bivariate convergence often fails for k<5; we use the
    // independent-univariate fallback (rho fixed at 0). Per advanced-stats.md.
    if (sePool.k < 5) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-size:11px;">'
            + '⚠ <strong>Small-k advisory (k=' + sePool.k + ').</strong> Bivariate Reitsma 2005 commonly fails to converge at k&lt;5; this panel falls back to '
            + '<em>independent-univariate logit pooling with ρ fixed at 0</em>. CIs may be over-narrow (within-study correlation ignored). '
            + 'Verify with <code>mada::reitsma()</code> in R; see Cochrane DTA Handbook §10.'
            + '</div>';
    }

    // Threshold-effect detection in independent-univariate path (Cochrane DTA §10).
    // Compute Spearman ρ on logit(Se) vs logit(1−Sp); |ρ| > 0.6 ⇒ threshold heterogeneity.
    const ssAll = trials.map(trialSensSpec);
    const xLogitSe = ssAll.map(s => s.logitSe);
    const xLogit1mSp = ssAll.map(s => Math.log((1 - s.Sp) / s.Sp));  // = -logit(Sp)
    const rhoThresh = spearmanRho(xLogitSe, xLogit1mSp);
    if (rhoThresh != null && Math.abs(rhoThresh) > 0.6) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-size:11px;">'
            + '⚠ <strong>Threshold effect suspected</strong> (Spearman ρ(logit Se, logit 1−Sp) = ' + fmt(rhoThresh, 2) + ', |ρ|&gt;0.6). '
            + 'Cochrane DTA Handbook §10: report the SROC curve rather than a single pooled (Se, Sp) point — pooled values can be misleading when the diagnostic threshold varies across studies.'
            + '</div>';
    }

    // Headline
    html += '<div style="background:#0e3a1f;border:1px solid #34d399;color:#e2e8f0;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
          + '<strong>Pooled DTA:</strong> Sensitivity ' + fmt(Se*100, 1) + '% [' + fmt(Se_ci_low*100, 1) + '–' + fmt(Se_ci_high*100, 1) + '%], '
          + 'Specificity ' + fmt(Sp*100, 1) + '% [' + fmt(Sp_ci_low*100, 1) + '–' + fmt(Sp_ci_high*100, 1) + '%], '
          + 'DOR ' + fmt(DOR, 1) + ' [' + fmt(DOR_ci_low, 1) + '–' + fmt(DOR_ci_high, 1) + ']. k = ' + sePool.k + '.'
          + '</div>';

    // Cells
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:10px;">';
    html += cell('Pooled Se', fmt(Se*100, 1) + '%',
      '95% CI ' + fmt(Se_ci_low*100, 1) + '–' + fmt(Se_ci_high*100, 1) + '%');
    html += cell('Pooled Sp', fmt(Sp*100, 1) + '%',
      '95% CI ' + fmt(Sp_ci_low*100, 1) + '–' + fmt(Sp_ci_high*100, 1) + '%');
    html += cell('DOR', fmt(DOR, 1),
      '95% CI ' + fmt(DOR_ci_low, 1) + '–' + fmt(DOR_ci_high, 1));
    html += cell('Trials (k)', String(sePool.k));
    html += cell('τ² (logit-Se)', fmt(sePool.tau2, 4));
    html += cell('τ² (logit-Sp)', fmt(spPool.tau2, 4));
    html += '</div>';

    // ROC plot
    html += buildROC(P, trials.map(t => Object.assign({}, t, trialSensSpec(t))), {
      Se, Sp, Se_ci_low, Se_ci_high, Sp_ci_low, Sp_ci_high
    });

    // Per-trial table
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:10px;margin-bottom:4px;">Per-trial 2×2 cells + diagnostic ratios:</div>';
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;">Trial</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">TP / FN</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">FP / TN</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Se</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Sp</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">LR+</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">LR−</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">DOR</th>'
          + '</tr></thead><tbody>';
    trials.forEach(t => {
      const ss = trialSensSpec(t);
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + t.name + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + t.TP + ' / ' + t.FN + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + t.FP + ' / ' + t.TN + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(ss.Se*100, 1) + '%</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(ss.Sp*100, 1) + '%</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(ss.LRpos, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(ss.LRneg, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(ss.DORtrial, 1) + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    // Method note
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> per-trial sensitivity = TP/(TP+FN), specificity = TN/(TN+FP), with +0.5 continuity correction for any zero cell. '
          + 'Logit-Se and logit-Sp pooled <strong>independently</strong> (rho fixed at 0) via DerSimonian-Laird random effects; '
          + 'DOR pool is logit-Se + logit-Sp on the log scale. '
          + 'Cochrane DTA Handbook (Macaskill 2010) recommends the full bivariate Reitsma 2005 model when k≥4 and convergence permits — '
          + '`mada::reitsma()` in R provides HSROC curves with within-study correlation. '
          + 'This panel is a screening summary; for publication of a DTA review, run the full bivariate model in R as a sensitivity check. '
          + 'Cochrane Handbook v6.5 ch.20.'
          + '</div>';

    return html;
  }

  function buildBodyFromEngine(P, trials, eng) {
    const fmt = P.fmt;
    let html = '';

    // Headline
    const Se = +eng.pooled_sens, Sp = +eng.pooled_spec;
    const SeLo = +eng.pooled_sens_ci_lb, SeHi = +eng.pooled_sens_ci_ub;
    const SpLo = +eng.pooled_spec_ci_lb, SpHi = +eng.pooled_spec_ci_ub;
    html += '<div style="background:#0e3a1f;border:1px solid #34d399;color:#e2e8f0;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
          + '<strong>Pooled DTA (full bivariate ' + (eng.estimator || 'REML') + '):</strong> '
          + 'Sensitivity ' + fmt(Se*100, 1) + '% [' + fmt(SeLo*100, 1) + '–' + fmt(SeHi*100, 1) + '%], '
          + 'Specificity ' + fmt(Sp*100, 1) + '% [' + fmt(SpLo*100, 1) + '–' + fmt(SpHi*100, 1) + '%], '
          + 'DOR ' + fmt(+eng.dor, 1)
          + (eng.dor_ci_lb ? ' [' + fmt(+eng.dor_ci_lb, 1) + '–' + fmt(+eng.dor_ci_ub, 1) + ']' : '')
          + '. k = ' + eng.k + '.'
          + '</div>';

    // Threshold-effect / coverage warnings from engine
    if (eng.threshold_effect) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-size:11px;">'
            + '⚠ <strong>Threshold effect suspected</strong> '
            + (eng.threshold_effect_spearman != null ? '(Spearman ρ(logit Se, logit 1−Sp) = ' + fmt(+eng.threshold_effect_spearman, 2) + ')' : '')
            + '. Cochrane DTA Handbook §10: report the SROC curve rather than a single pooled (Se, Sp) point — pooled values may be misleading when threshold varies across studies.'
            + '</div>';
    }
    if (eng.coverage_warning || (eng.fallback && eng.fallback !== 'reitsma_full')) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-size:11px;">'
            + '⚠ Engine fell back to <code>' + (eng.fallback || 'simplified') + '</code> '
            + (eng.iterations === 0 ? '(non-iterative path; possibly k<4 or convergence failure)' : '')
            + '. Treat CI widths as conservative; consider <code>mada::reitsma()</code> in R for verification.'
            + '</div>';
    }

    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px;">';
    html += cell('Pooled Se', fmt(Se*100, 1) + '%', '95% CI ' + fmt(SeLo*100, 1) + '–' + fmt(SeHi*100, 1) + '%');
    html += cell('Pooled Sp', fmt(Sp*100, 1) + '%', '95% CI ' + fmt(SpLo*100, 1) + '–' + fmt(SpHi*100, 1) + '%');
    html += cell('DOR', fmt(+eng.dor, 1),
      eng.dor_ci_lb ? '95% CI ' + fmt(+eng.dor_ci_lb, 1) + '–' + fmt(+eng.dor_ci_ub, 1) : '');
    html += cell('LR+', fmt(+eng.lr_pos, 2));
    html += cell('LR−', fmt(+eng.lr_neg, 3));
    html += cell('Trials (k)', String(eng.k),
      'estimator: ' + (eng.estimator || 'REML') + (eng.converged === false ? ' · ✗ not converged' : ''));
    html += cell('τ² (logit-Se)', fmt(+eng.tau2_sens, 4));
    html += cell('τ² (logit-Sp)', fmt(+eng.tau2_spec, 4));
    html += cell('ρ (between-study)', fmt(+eng.rho, 3));
    html += '</div>';

    // ROC plot — use trial-level Se/Sp from engine's per_study or recompute from cells
    const points = trials.map((t, i) => {
      const ss = trialSensSpec(t);
      return { name: t.name, Se: ss.Se, Sp: ss.Sp, TP: t.TP, FP: t.FP, FN: t.FN, TN: t.TN };
    });
    const summary = {
      Se, Sp,
      Se_ci_low: SeLo, Se_ci_high: SeHi,
      Sp_ci_low: SpLo, Sp_ci_high: SpHi,
    };
    let svg = buildROC(P, points, summary);

    // Overlay HSROC curve if engine provides one
    let curvePoints = null;
    try {
      const Eng = global.RapidMetaDTA;
      if (Eng && typeof Eng.sroc === 'function') {
        curvePoints = Eng.sroc(eng);  // engine should return [{fpr, tpr}, ...]
      }
    } catch (e) { /* ignore */ }
    if (Array.isArray(curvePoints) && curvePoints.length > 1) {
      // Inject path into the SVG just before </svg>
      const W = 720, margin = { l: 60, r: 30, t: 30, b: 50 };
      const innerW = W - margin.l - margin.r;
      const xPx = v => margin.l + v * innerW;
      const yPx = v => margin.t + (1 - v) * (380 - margin.t - 50);
      let d = '';
      curvePoints.forEach((p, i) => {
        if (typeof p.fpr !== 'number' || typeof p.tpr !== 'number') return;
        d += (i === 0 ? 'M' : 'L') + xPx(p.fpr).toFixed(1) + ',' + yPx(p.tpr).toFixed(1) + ' ';
      });
      if (d) {
        svg = svg.replace('</svg>',
          '<path d="' + d + '" stroke="#fbbf24" stroke-width="2" fill="none" stroke-dasharray="0" />'
          + '<text x="' + (W - 35) + '" y="50" fill="#fbbf24" font-size="10" text-anchor="end">SROC curve</text>'
          + '</svg>');
      }
    }
    html += svg;

    // Per-trial table
    html += '<div style="font-size:11px;color:#94a3b8;margin-top:10px;margin-bottom:4px;">Per-trial 2×2 cells + diagnostic ratios:</div>';
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;">Trial</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">TP / FN</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">FP / TN</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Se</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">Sp</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">LR+</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">LR−</th>'
          + '<th style="padding:3px 6px;border-bottom:1px solid #1e293b;text-align:right;">DOR</th>'
          + '</tr></thead><tbody>';
    trials.forEach(t => {
      const ss = trialSensSpec(t);
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + t.name + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + t.TP + ' / ' + t.FN + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + t.FP + ' / ' + t.TN + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(ss.Se*100, 1) + '%</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(ss.Sp*100, 1) + '%</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(ss.LRpos, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(ss.LRneg, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(ss.DORtrial, 1) + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> full bivariate model fit by the host review\'s <code>RapidMetaDTA</code> engine '
          + '(Reitsma 2005 / Chu-Cole 2006 with HKSJ small-sample CI adjustment, threshold-effect detection by Spearman ρ on logit-Se/logit-(1−Sp), '
          + 'and HSROC reparameterisation per Harbord-Whiting 2007). '
          + 'Engine status: ' + (eng.estimator || 'REML') + (eng.fallback ? ' (fallback: ' + eng.fallback + ')' : '') + '. '
          + 'Cochrane DTA Handbook (Macaskill 2010); Cochrane Handbook v6.5 ch.20.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    const trials = pickDTATrials(rd);
    if (trials.length < 2) return false;

    // Try engine first (legacy DTA reviews)
    const enginePool = tryEnginePool(trials);
    if (enginePool) {
      const Se = +enginePool.pooled_sens, Sp = +enginePool.pooled_spec;
      const summary = 'Pooled Se ' + P.fmt(Se*100, 1) + '%, Sp ' + P.fmt(Sp*100, 1) + '%, DOR ' + P.fmt(+enginePool.dor, 1) + ' · k=' + enginePool.k
                    + (enginePool.threshold_effect ? ' · ⚠ threshold effect' : '');
      const panel = P.buildCollapsiblePanel({
        id: 'dta-bivariate-panel',
        badge: 'DTA',
        summary,
        bodyHtml: buildBodyFromEngine(P, trials, enginePool),
        storageKey: STORAGE_KEY,
      });
      const existing = document.getElementById('dta-bivariate-panel');
      if (existing) existing.replaceWith(panel);
      else P.insertAfterRBadge(panel);
      return true;
    }

    // Fallback: independent-univariate logit pool
    const ss = trials.map(trialSensSpec);
    const sePool = poolDLRE(ss.map(s => s.logitSe), ss.map(s => s.varLogitSe));
    const spPool = poolDLRE(ss.map(s => s.logitSp), ss.map(s => s.varLogitSp));
    if (!sePool || !spPool) return false;

    const dorYi = ss.map(s => s.logitSe + s.logitSp);
    const dorVi = ss.map(s => s.varLogitSe + s.varLogitSp);
    const dorPool = poolDLRE(dorYi, dorVi);
    if (!dorPool) return false;

    const Se = invLogit(sePool.mean);
    const Sp = invLogit(spPool.mean);
    const summary = 'Pooled Se ' + P.fmt(Se*100, 1) + '%, Sp ' + P.fmt(Sp*100, 1) + '%, DOR ' + P.fmt(Math.exp(dorPool.mean), 1) + ' · k=' + sePool.k + ' · independent-univariate';

    const panel = P.buildCollapsiblePanel({
      id: 'dta-bivariate-panel',
      badge: 'DTA',
      summary,
      bodyHtml: buildBody(P, trials, sePool, spPool, dorPool),
      storageKey: STORAGE_KEY,
    });

    const existing = document.getElementById('dta-bivariate-panel');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1300));
    } else {
      setTimeout(tick, 1300);
    }
  }

  global.DTABivariate = { render, __test__: { spearmanRho, trialSensSpec, poolDLRE, logit, invLogit } };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
