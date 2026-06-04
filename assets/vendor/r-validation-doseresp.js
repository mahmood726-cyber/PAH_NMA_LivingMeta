/* vendor/r-validation-doseresp.js — v0.2.0 (2026-05-13)
 *
 * Collapsible R-parity badge for the dose-response engine. Compares
 * window.RapidMetaDoseResp output against R dosresmeta + lme4::glmer
 * precomputed values loaded from outputs/r_validation/doseresp/<REVIEW>.json.
 *
 * Mount with: <div id="r-parity-doseresp" data-review="gl1992_alcohol_bc"></div>
 * Then call: RValidationDoseresp.render('r-parity-doseresp', engineResults, rResults);
 *
 * engineResults must include: { linear: <fitLinear-output>, rcs: <fitRCS-output>, one_stage: <fitOneStage-output> }
 * rResults is the parsed JSON from outputs/r_validation/doseresp/<REVIEW>.json.
 *
 * v0.2.0 (Round 2C): non-linearity Wald p row is now threshold-driven (0.05),
 *   not always-amber. Engine v0.3.0's full multivariate REML closes the v0.1/v0.2
 *   diagonal-PM divergence to R mixmeta (|Δ| ≈ 0.0006 on GL-1992).
 */
(function (root) {
  'use strict';

  // Threshold matrix per spec §6 (Round 2C: nonlinearity_p added at 0.05 —
  // observed engine-vs-R divergence on GL-1992 ≈ 0.0006, ~80× headroom)
  var THRESHOLDS = {
    linear_slope: 0.01,
    linear_tau2: 0.0001,
    rcs_coef_0: 0.01,
    rcs_coef_1: 0.01,
    nonlinearity_p: 0.05,
  };

  // P1-6 fix: HTML-escape every R-sourced string before innerHTML concat.
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(x, dp) {
    if (x == null || !isFinite(x)) return 'n/a';
    return (+x).toFixed(dp == null ? 4 : dp);
  }

  function row(label, engineVal, rVal, threshold, opts) {
    opts = opts || {};
    var delta = (isFinite(engineVal) && isFinite(rVal)) ? Math.abs(engineVal - rVal) : null;
    var withinTol = (threshold != null && delta != null && delta < threshold);
    var status = opts.alwaysAmber ? 'amber' : (withinTol ? 'green' : 'amber');
    var note = opts.note || '';
    return {
      isGreen: status === 'green',
      html: (
        '<tr class="rv-row rv-row-' + status + '">' +
        '<td class="rv-label">' + label + '</td>' +
        '<td class="rv-engine">' + fmt(engineVal) + '</td>' +
        '<td class="rv-r">' + fmt(rVal) + '</td>' +
        '<td class="rv-delta">' + (delta != null ? fmt(delta) : 'n/a') + '</td>' +
        '<td class="rv-note">' + note + '</td>' +
        '</tr>'
      )
    };
  }

  function render(mountId, engineResults, rResults) {
    var mount = document.getElementById(mountId);
    if (!mount) { console.warn('RValidationDoseresp: mount #' + mountId + ' not found'); return; }
    if (!engineResults || !rResults) {
      mount.innerHTML = '<div class="rv-banner rv-banner-error">Badge data unavailable</div>';
      return;
    }

    var eng = engineResults, r = rResults;

    var rows = [];
    rows.push(row(
      'Linear pooled log-slope',
      eng.linear && eng.linear.pooled_slope_log,
      r.linear && r.linear.pooled_slope_log,
      THRESHOLDS.linear_slope
    ));
    rows.push(row(
      'Linear τ²',
      eng.linear && eng.linear.tau2,
      r.linear && r.linear.tau2,
      THRESHOLDS.linear_tau2
    ));
    rows.push(row(
      'RCS spline_coefs[0] (linear component)',
      eng.rcs && eng.rcs.rcs && eng.rcs.rcs.spline_coefs && eng.rcs.rcs.spline_coefs[0],
      r.rcs && r.rcs.spline_coefs && r.rcs.spline_coefs[0],
      THRESHOLDS.rcs_coef_0
    ));
    rows.push(row(
      'RCS spline_coefs[1] (non-linear component)',
      eng.rcs && eng.rcs.rcs && eng.rcs.rcs.spline_coefs && eng.rcs.rcs.spline_coefs[1],
      r.rcs && r.rcs.spline_coefs && r.rcs.spline_coefs[1],
      THRESHOLDS.rcs_coef_1
    ));
    rows.push(row(
      'RCS non-linearity Wald p',
      eng.rcs && eng.rcs.rcs && eng.rcs.rcs.nonlinearity_wald_p,
      r.rcs && r.rcs.nonlinearity_wald_p,
      THRESHOLDS.nonlinearity_p,
      { note: 'Engine v0.3.0 uses full multivariate REML; matches R within |Δ| < 0.05' }
    ));

    // Round 2C: all 5 rows are threshold-driven. Engine v0.3.0's full multivariate
    // REML (via Nelder-Mead on Cholesky params of τ²) closes the v0.1/v0.2 diagonal-PM
    // divergence — non-linearity-p row turns green when engine and R agree within ±0.05.
    // P2-11: allGreen reads structural isGreen flag, not HTML string content.
    var allGreen = rows.every(function (r) { return r.isGreen; });
    var headerStatus = allGreen ? 'green' : 'amber';

    var html = '' +
      '<div class="rv-badge rv-badge-' + headerStatus + '">' +
      '  <details open>' +
      '    <summary>R-parity badge — engine vs R (' + (r.dosresmeta_version ? 'dosresmeta ' + escapeHtml(r.dosresmeta_version) : 'R dosresmeta') + (r.one_stage && r.one_stage.lme4_version ? ', lme4 ' + escapeHtml(r.one_stage.lme4_version) : '') + ')</summary>' +
      '    <table class="rv-table">' +
      '      <caption>R-parity comparison: engine vs R validator (5 threshold-driven rows)</caption>' +
      '      <thead><tr><th>Metric</th><th>Engine</th><th>R</th><th>|Δ|</th><th>Note</th></tr></thead>' +
      '      <tbody>' + rows.map(function (r) { return r.html; }).join('') + '</tbody>' +
      '    </table>' +
      '  </details>' +
      '</div>';

    mount.innerHTML = html;
  }

  root.RValidationDoseresp = { render: render, THRESHOLDS: THRESHOLDS };
})(typeof window !== 'undefined' ? window : globalThis);
