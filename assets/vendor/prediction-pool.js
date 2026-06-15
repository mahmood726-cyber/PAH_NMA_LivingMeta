/* Prediction-model meta-analysis panel.
 *
 * For reviews where each row in realData carries per-validation-cohort
 * prediction-model performance metrics — C-statistic + (optional) calibration
 * intercept, calibration slope, O/E ratio, Brier score, and PROBAST domain
 * risk-of-bias — pools the four canonical metrics across cohorts via the
 * RapidMetaPrediction engine.
 *
 * Methodology — delegates to the engine; see rapidmeta-prediction-engine-v1.js:
 *   - logit-C pool with Paule-Mandel (empirical-Bayes) τ² + HKSJ CI (Cochrane v6.5 floor,
 *     t_{k-1}); back-transform via inverse logit
 *   - Calibration intercept on raw scale (Paule-Mandel + HKSJ)
 *   - Calibration slope on raw scale (Paule-Mandel + HKSJ)
 *   - O/E ratio on log scale (Paule-Mandel + HKSJ), back-transform via exp
 *   - PROBAST per-domain RoB rollup (Wolff 2019 manual)
 *   - Derivation-vs-external-validation subgroup split with Q_between
 *
 * Detection (any of):
 *   - realData[*].C (C-statistic / AUC)
 *   - realData[*].AUC (alternative naming)
 *   - realData[*].allOutcomes[*].type === 'PREDICTION' or 'DISCRIMINATION'
 *
 * Auto-bootstrap; collapsed by default. Self-skips silently when no
 * prediction-model data detected.
 *
 * References: Snell et al. 2018 BMC Med Res Methodol (IPD MA for prediction
 * models); Debray et al. 2017 BMJ tutorial; Wolff et al. 2019 PROBAST manual;
 * Royston & Sauerbrei 2013 (O/E ratio variance).
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'prediction-pool-expanded';

  function pickPredictionCohorts(rd) {
    const out = [];
    if (!rd) return out;
    Object.values(rd).forEach(t => {
      if (!t) return;
      // Variant 1: top-level C / AUC
      let C = +t.C;
      if (!isFinite(C)) C = +t.AUC;
      if (!isFinite(C)) C = +t.c_statistic;
      if (!isFinite(C) || C <= 0 || C >= 1) {
        // Variant 2: allOutcomes carries a prediction outcome
        const ao = t.allOutcomes || (t.data && t.data.allOutcomes);
        if (Array.isArray(ao)) {
          const pp = ao.find(o => o && (o.type === 'PREDICTION' || o.type === 'DISCRIMINATION')
                                       && isFinite(+o.C || +o.AUC));
          if (pp) {
            C = +pp.C; if (!isFinite(C)) C = +pp.AUC;
            const row = {
              studlab: t.name || pp.studlab || '?',
              C: C,
              C_se: isFinite(+pp.C_se) ? +pp.C_se : (isFinite(+pp.AUC_se) ? +pp.AUC_se : undefined),
              n_events: isFinite(+pp.n_events) ? +pp.n_events : undefined,
              n_nonevents: isFinite(+pp.n_nonevents) ? +pp.n_nonevents : undefined,
              n_total: isFinite(+pp.n_total) ? +pp.n_total : undefined,
              calib_int: isFinite(+pp.calib_int) ? +pp.calib_int : undefined,
              calib_int_se: isFinite(+pp.calib_int_se) ? +pp.calib_int_se : undefined,
              calib_slope: isFinite(+pp.calib_slope) ? +pp.calib_slope : undefined,
              calib_slope_se: isFinite(+pp.calib_slope_se) ? +pp.calib_slope_se : undefined,
              OE: isFinite(+pp.OE) ? +pp.OE : undefined,
              OE_se_log: isFinite(+pp.OE_se_log) ? +pp.OE_se_log : undefined,
              n_observed: isFinite(+pp.n_observed) ? +pp.n_observed : undefined,
              brier: isFinite(+pp.brier) ? +pp.brier : undefined,
              brier_se: isFinite(+pp.brier_se) ? +pp.brier_se : undefined,
              cohort_type: pp.cohort_type || t.cohort_type || 'external',
              probast: pp.probast || t.probast
            };
            out.push(row);
          }
        }
        return;
      }
      out.push({
        studlab: t.name || t.studlab || '?',
        C: C,
        C_se: isFinite(+t.C_se) ? +t.C_se : (isFinite(+t.AUC_se) ? +t.AUC_se : undefined),
        n_events: isFinite(+t.n_events) ? +t.n_events : undefined,
        n_nonevents: isFinite(+t.n_nonevents) ? +t.n_nonevents : undefined,
        n_total: isFinite(+t.n_total) ? +t.n_total : undefined,
        calib_int: isFinite(+t.calib_int) ? +t.calib_int : undefined,
        calib_int_se: isFinite(+t.calib_int_se) ? +t.calib_int_se : undefined,
        calib_slope: isFinite(+t.calib_slope) ? +t.calib_slope : undefined,
        calib_slope_se: isFinite(+t.calib_slope_se) ? +t.calib_slope_se : undefined,
        OE: isFinite(+t.OE) ? +t.OE : undefined,
        OE_se_log: isFinite(+t.OE_se_log) ? +t.OE_se_log : undefined,
        n_observed: isFinite(+t.n_observed) ? +t.n_observed : undefined,
        brier: isFinite(+t.brier) ? +t.brier : undefined,
        brier_se: isFinite(+t.brier_se) ? +t.brier_se : undefined,
        cohort_type: t.cohort_type || 'external',
        probast: t.probast
      });
    });
    return out;
  }

  function tryEnginePool(cohorts) {
    const Eng = global.RapidMetaPrediction;
    if (!Eng || typeof Eng.fit !== 'function') return null;
    try { return Eng.fit(cohorts); } catch (e) { return null; }
  }

  function fmt(v, d) {
    if (v == null || (typeof v === 'number' && !isFinite(v))) return '—';
    if (typeof v !== 'number') v = Number(v);
    if (isNaN(v)) return '—';
    return d == null ? String(v) : v.toFixed(d);
  }

  // PROBAST chip strip
  function probastChip(level, count, total) {
    const colors = {
      low:     { bg: '#0e3a1f', border: '#34d399', text: '#a7f3d0' },
      high:    { bg: '#3a0a0a', border: '#f87171', text: '#fecaca' },
      unclear: { bg: '#3a2a0a', border: '#fbbf24', text: '#fde68a' }
    };
    const c = colors[level] || colors.unclear;
    return '<span style="display:inline-flex;align-items:center;gap:6px;background:' + c.bg
         + ';border:1px solid ' + c.border + ';color:' + c.text + ';padding:3px 10px;'
         + 'border-radius:9999px;font-size:11px;font-weight:600;letter-spacing:0.02em;">'
         + level.toUpperCase() + ' <span style="color:#94a3b8;font-weight:400;">'
         + count + '/' + total + '</span></span>';
  }

  function buildPROBAST(probast, fmt) {
    let html = '<div style="font-size:11.5px;color:#94a3b8;margin-top:14px;margin-bottom:6px;font-weight:600;">'
             + 'PROBAST risk-of-bias rollup (Wolff 2019)</div>';
    // Per-domain stacked chips
    const domains = ['participants', 'predictors', 'outcome', 'analysis'];
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;"><th style="padding:4px 8px;">Domain</th><th style="padding:4px 8px;">low</th><th style="padding:4px 8px;">high</th><th style="padding:4px 8px;">unclear</th></tr></thead><tbody>';
    domains.forEach(d => {
      const dd = probast.domains[d];
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:4px 8px;color:#e2e8f0;font-weight:500;text-transform:capitalize;">' + d + '</td>'
            + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#34d399;">' + dd.low + '</td>'
            + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#f87171;">' + dd.high + '</td>'
            + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#fbbf24;">' + dd.unclear + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';
    // Overall summary
    const o = probast.overall;
    html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">';
    if (o.low) html += probastChip('low', o.low, probast.n_cohorts);
    if (o.high) html += probastChip('high', o.high, probast.n_cohorts);
    if (o.unclear) html += probastChip('unclear', o.unclear, probast.n_cohorts);
    html += '</div>';
    return html;
  }

  // Forest-row SVG renderer for a single metric.
  // metric = 'discrimination' | 'calib_int' | 'calib_slope' | 'OE' | 'brier'
  function buildForest(rows, opts) {
    if (!rows || rows.length === 0) return '';
    const W = opts.width || 720;
    const rowH = 22;
    const headH = 28, footH = 40;
    const H = headH + rowH * rows.length + footH;
    const padL = 220, padR = 110;
    const plotW = W - padL - padR;
    const refLine = opts.refLine != null ? +opts.refLine : null;
    const logScale = !!opts.logScale;

    // Range
    let pts = [];
    rows.forEach(r => {
      if (isFinite(r.point)) pts.push(r.point);
      if (isFinite(r.ci_lo)) pts.push(r.ci_lo);
      if (isFinite(r.ci_hi)) pts.push(r.ci_hi);
      if (isFinite(r.pi_lo)) pts.push(r.pi_lo);
      if (isFinite(r.pi_hi)) pts.push(r.pi_hi);
    });
    if (refLine != null) pts.push(refLine);
    let lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    if (logScale) {
      lo = Math.max(0.01, lo * 0.9); hi = hi * 1.1;
    } else {
      const pad = (hi - lo) * 0.15 || 0.05;
      lo -= pad; hi += pad;
    }
    const xL = logScale ? Math.log(lo) : lo;
    const xH = logScale ? Math.log(hi) : hi;
    const xScale = v => padL + (((logScale ? Math.log(v) : v) - xL) / (xH - xL || 1)) * plotW;

    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" '
            + 'style="background:transparent;font-family:Inter,system-ui,sans-serif;margin-top:6px;">';
    // Header
    svg += '<text x="8" y="20" fill="#94a3b8" font-size="11" font-weight="600">Cohort</text>';
    svg += '<text x="' + (padL + plotW/2) + '" y="20" fill="#94a3b8" font-size="11" font-weight="600" text-anchor="middle">' + (opts.title || '') + '</text>';
    svg += '<text x="' + (W - 8) + '" y="20" fill="#94a3b8" font-size="11" font-weight="600" text-anchor="end">' + (opts.unitLabel || 'point (95% CI)') + '</text>';
    // Reference line
    if (refLine != null && refLine >= lo && refLine <= hi) {
      const xR = xScale(refLine);
      svg += '<line x1="' + xR + '" y1="' + (headH - 4) + '" x2="' + xR + '" y2="' + (H - footH) + '" stroke="#475569" stroke-dasharray="3,3" />';
      svg += '<text x="' + (xR + 4) + '" y="' + (headH - 6) + '" fill="#94a3b8" font-size="9">ref ' + fmt(refLine, 2) + '</text>';
    }
    // Rows
    rows.forEach((r, i) => {
      const y = headH + rowH * (i + 1) - rowH/2;
      // Cohort label
      const lbl = (r.studlab && r.studlab.length > 28) ? r.studlab.slice(0, 26) + '…' : r.studlab;
      const fillColor = r.is_pooled ? '#22d3ee' : (r.cohort_type === 'derivation' ? '#fbbf24' : '#60a5fa');
      svg += '<text x="8" y="' + (y + 4) + '" fill="' + (r.is_pooled ? '#22d3ee' : '#e2e8f0')
           + '" font-size="11"' + (r.is_pooled ? ' font-weight="700"' : '') + '>' + lbl + '</text>';
      if (r.cohort_type === 'derivation' && !r.is_pooled) {
        svg += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" fill="#fbbf24" font-size="9" text-anchor="end">DERIV</text>';
      }
      // CI line
      if (isFinite(r.ci_lo) && isFinite(r.ci_hi)) {
        svg += '<line x1="' + xScale(r.ci_lo) + '" x2="' + xScale(r.ci_hi) + '" y1="' + y + '" y2="' + y
             + '" stroke="' + fillColor + '" stroke-width="1.6" />';
      }
      // Point: diamond for pooled, square for cohort
      if (isFinite(r.point)) {
        if (r.is_pooled) {
          const xC = xScale(r.point);
          const xLP = isFinite(r.ci_lo) ? xScale(r.ci_lo) : xC - 6;
          const xRP = isFinite(r.ci_hi) ? xScale(r.ci_hi) : xC + 6;
          svg += '<polygon points="' + xLP + ',' + y + ' ' + xC + ',' + (y - 7) + ' '
               + xRP + ',' + y + ' ' + xC + ',' + (y + 7) + '" fill="#22d3ee" stroke="#0891b2" stroke-width="1" />';
        } else {
          const sz = 8;
          svg += '<rect x="' + (xScale(r.point) - sz/2) + '" y="' + (y - sz/2) + '" width="' + sz + '" height="' + sz
               + '" fill="' + fillColor + '" />';
        }
      }
      // PI bracket for pooled row
      if (r.is_pooled && isFinite(r.pi_lo) && isFinite(r.pi_hi)) {
        svg += '<line x1="' + xScale(r.pi_lo) + '" x2="' + xScale(r.pi_hi) + '" y1="' + (y + 12) + '" y2="' + (y + 12)
             + '" stroke="#f97316" stroke-width="1.6" stroke-dasharray="4,2" />';
        svg += '<text x="' + (padL + plotW + 8) + '" y="' + (y + 16) + '" fill="#f97316" font-size="9">PI ' + fmt(r.pi_lo, 2) + '–' + fmt(r.pi_hi, 2) + '</text>';
      }
      // Right-side value column
      let txt = fmt(r.point, opts.digits != null ? opts.digits : 3);
      if (isFinite(r.ci_lo) && isFinite(r.ci_hi)) {
        txt += ' (' + fmt(r.ci_lo, opts.digits != null ? opts.digits : 3) + '–' + fmt(r.ci_hi, opts.digits != null ? opts.digits : 3) + ')';
      }
      svg += '<text x="' + (W - 8) + '" y="' + (y + 4) + '" fill="' + (r.is_pooled ? '#22d3ee' : '#94a3b8') + '" font-size="10" text-anchor="end"'
           + (r.is_pooled ? ' font-weight="700"' : '') + '>' + txt + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  function buildBody(P, cohorts, eng) {
    const F = global.RapidMetaPrediction.forest(eng);
    let html = '';
    // Headline metric strip
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    const Cp = eng.C_pool;
    const Ip = eng.calib_int_pool;
    const Sp = eng.calib_slope_pool;
    const Op = eng.OE_pool;
    const Bp = eng.brier_pool;

    html += '<div style="background:#0e2640;border:1px solid #1e3a5f;color:#e2e8f0;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;line-height:1.55;">'
          + '<strong>Pooled prediction-model performance.</strong> Across <strong>' + eng.k + '</strong> validation cohorts: '
          + (Cp ? 'C ' + fmt(Cp.C_pool, 3) + ' (95% CI ' + fmt(Cp.C_ci_lo, 3) + '–' + fmt(Cp.C_ci_hi, 3) + ')' : 'C —')
          + (Ip ? ', calibration intercept ' + fmt(Ip.mu, 2) + ' (95% CI ' + fmt(Ip.ci_lo, 2) + '–' + fmt(Ip.ci_hi, 2) + ')' : '')
          + (Sp ? ', slope ' + fmt(Sp.mu, 2) + ' (95% CI ' + fmt(Sp.ci_lo, 2) + '–' + fmt(Sp.ci_hi, 2) + ')' : '')
          + (Op ? ', O/E ' + fmt(Op.OE_pool, 2) + ' (95% CI ' + fmt(Op.OE_ci_lo, 2) + '–' + fmt(Op.OE_ci_hi, 2) + ')' : '')
          + '.</div>';

    if (eng.coverage_warning) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:6px 10px;border-radius:6px;margin-bottom:10px;font-size:11px;">'
            + '⚠ <strong>Coverage advisory (k = ' + eng.k + ' &lt; 5).</strong> '
            + 'Snell 2018 recommends k ≥ 5 external validations for stable τ²; treat heterogeneity estimates as imprecise.'
            + '</div>';
    }

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px;">';
    if (Cp) {
      html += cell('Pooled C', fmt(Cp.C_pool, 3),
        '95% CI ' + fmt(Cp.C_ci_lo, 3) + '–' + fmt(Cp.C_ci_hi, 3)
        + (Cp.pi_defined ? ' · PI ' + fmt(Cp.C_pi_lo, 3) + '–' + fmt(Cp.C_pi_hi, 3) : ''));
      html += cell('τ² (logit-C)', fmt(Cp.tau2, 4),
        'I² ' + fmt(Cp.I2, 0) + '% · k=' + Cp.k);
    }
    if (Ip) {
      html += cell('Calib intercept', fmt(Ip.mu, 2),
        '95% CI ' + fmt(Ip.ci_lo, 2) + '–' + fmt(Ip.ci_hi, 2) + ' · k=' + Ip.k);
    }
    if (Sp) {
      html += cell('Calib slope', fmt(Sp.mu, 2),
        '95% CI ' + fmt(Sp.ci_lo, 2) + '–' + fmt(Sp.ci_hi, 2) + ' · k=' + Sp.k);
    }
    if (Op) {
      html += cell('O/E ratio', fmt(Op.OE_pool, 2),
        '95% CI ' + fmt(Op.OE_ci_lo, 2) + '–' + fmt(Op.OE_ci_hi, 2) + ' · k=' + Op.k);
    }
    if (Bp) {
      html += cell('Brier', fmt(Bp.mu, 3),
        '95% CI ' + fmt(Bp.ci_lo, 3) + '–' + fmt(Bp.ci_hi, 3) + ' · k=' + Bp.k);
    }
    html += '</div>';

    // Forests
    if (F.discrimination.length > 0) {
      html += '<div style="font-size:11px;color:#94a3b8;margin:14px 0 4px;font-weight:600;">Discrimination — C-statistic forest (logit-pooled, Paule-Mandel + HKSJ)</div>';
      html += buildForest(F.discrimination, { title: 'C-statistic', unitLabel: 'C (95% CI)', refLine: 0.5, digits: 3 });
    }
    if (F.calib_int.length > 0) {
      html += '<div style="font-size:11px;color:#94a3b8;margin:14px 0 4px;font-weight:600;">Calibration-in-the-large — intercept forest</div>';
      html += buildForest(F.calib_int, { title: 'Calibration intercept', unitLabel: 'α (95% CI)', refLine: 0, digits: 2 });
    }
    if (F.calib_slope.length > 0) {
      html += '<div style="font-size:11px;color:#94a3b8;margin:14px 0 4px;font-weight:600;">Calibration slope forest</div>';
      html += buildForest(F.calib_slope, { title: 'Calibration slope', unitLabel: 'β (95% CI)', refLine: 1, digits: 2 });
    }
    if (F.OE.length > 0) {
      html += '<div style="font-size:11px;color:#94a3b8;margin:14px 0 4px;font-weight:600;">O/E ratio forest (log-pooled)</div>';
      html += buildForest(F.OE, { title: 'O/E ratio', unitLabel: 'O/E (95% CI)', refLine: 1, logScale: true, digits: 2 });
    }
    if (F.brier.length > 0) {
      html += '<div style="font-size:11px;color:#94a3b8;margin:14px 0 4px;font-weight:600;">Brier score forest</div>';
      html += buildForest(F.brier, { title: 'Brier score', unitLabel: 'Brier (95% CI)', digits: 3 });
    }

    // PROBAST
    html += buildPROBAST(eng.probast, fmt);

    // Derivation-vs-external split
    if (eng.dev_vs_external) {
      const dv = eng.dev_vs_external;
      html += '<div style="font-size:11.5px;color:#94a3b8;margin-top:14px;margin-bottom:6px;font-weight:600;">'
            + 'Derivation vs external-validation pool (logit-C scale)</div>';
      html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
      html += '<thead><tr style="color:#64748b;text-align:left;">'
            + '<th style="padding:4px 8px;">Bucket</th>'
            + '<th style="padding:4px 8px;text-align:right;">k</th>'
            + '<th style="padding:4px 8px;text-align:right;">Pooled C</th>'
            + '<th style="padding:4px 8px;text-align:right;">95% CI</th>'
            + '<th style="padding:4px 8px;text-align:right;">τ²</th>'
            + '<th style="padding:4px 8px;text-align:right;">I²</th>'
            + '</tr></thead><tbody>';
      function row(label, b) {
        if (!b) {
          return '<tr><td style="padding:4px 8px;color:#94a3b8;">' + label + '</td>'
               + '<td colspan="5" style="padding:4px 8px;color:#64748b;text-align:right;">no data</td></tr>';
        }
        return '<tr style="border-bottom:1px solid #0b1220;">'
             + '<td style="padding:4px 8px;color:#e2e8f0;">' + label + '</td>'
             + '<td style="padding:4px 8px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + b.k + '</td>'
             + '<td style="padding:4px 8px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(b.C_pool, 3) + '</td>'
             + '<td style="padding:4px 8px;text-align:right;font-family:JetBrains Mono,monospace;color:#94a3b8;">' + fmt(b.C_ci_lo, 3) + '–' + fmt(b.C_ci_hi, 3) + '</td>'
             + '<td style="padding:4px 8px;text-align:right;font-family:JetBrains Mono,monospace;color:#94a3b8;">' + fmt(b.tau2, 4) + '</td>'
             + '<td style="padding:4px 8px;text-align:right;font-family:JetBrains Mono,monospace;color:#94a3b8;">' + fmt(b.I2, 0) + '%</td>'
             + '</tr>';
      }
      html += row('Derivation cohort(s)', dv.derivation);
      html += row('External validation', dv.external);
      html += '</tbody></table>';
      if (dv.Q_between != null && isFinite(dv.Q_between)) {
        html += '<div style="font-size:10.5px;color:#64748b;margin-top:6px;">'
              + '<strong>Subgroup contrast:</strong> Q<sub>between</sub> = ' + fmt(dv.Q_between, 2)
              + ' (df ' + dv.df_between + '), p = ' + fmt(dv.p_between, 3) + '. '
              + dv.note + '</div>';
      }
    }

    // Method note
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:10px;line-height:1.55;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> per-cohort C-statistic pooled on logit scale via Paule-Mandel (empirical-Bayes) τ² with HKSJ small-sample CI (Cochrane v6.5 floor max(1, Q/(k-1)), t<sub>k-1</sub>). Hanley-McNeil 1982 variance used when SE not reported. '
          + 'Calibration intercept and slope pooled on raw scale; O/E ratio on log scale; Brier score on raw scale (all Paule-Mandel + HKSJ). Prediction intervals (Cochrane v6.5, t<sub>k-1</sub>) shown for k ≥ 3. '
          + 'PROBAST rollup per Wolff 2019 manual. References: Snell et al. 2018 BMC Med Res Methodol; Debray et al. 2017 BMJ tutorial; Royston & Sauerbrei 2013.'
          + '</div>';
    return html;
  }

  function buildPanelSummary(eng) {
    const Cp = eng.C_pool;
    if (!Cp) return 'No discrimination data';
    const fmt2 = (v, d) => (v == null || !isFinite(v)) ? '—' : (+v).toFixed(d);
    let s = 'Pooled C ' + fmt2(Cp.C_pool, 3)
          + ' (' + fmt2(Cp.C_ci_lo, 3) + '–' + fmt2(Cp.C_ci_hi, 3) + ')'
          + ' · k=' + eng.k;
    if (eng.OE_pool) s += ' · O/E ' + fmt2(eng.OE_pool.OE_pool, 2);
    if (eng.calib_slope_pool) s += ' · slope ' + fmt2(eng.calib_slope_pool.mu, 2);
    return s;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    const cohorts = pickPredictionCohorts(rd);
    if (cohorts.length < 1) return false;
    // Need C-statistic to be useful — if every row missing, skip
    if (!cohorts.some(c => isFinite(+c.C))) return false;

    const eng = tryEnginePool(cohorts);
    if (!eng) return false;

    const summary = buildPanelSummary(eng);
    const panel = P.buildCollapsiblePanel({
      id: 'prediction-pool-panel',
      badge: 'PREDICTION',
      summary,
      bodyHtml: buildBody(P, cohorts, eng),
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('prediction-pool-panel');
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

  global.PredictionPool = { render, __test__: { pickPredictionCohorts, buildForest, buildPROBAST, buildPanelSummary } };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
