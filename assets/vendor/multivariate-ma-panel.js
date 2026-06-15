/* multivariate-ma-panel.js — multivariate / multiple-outcome meta-analysis (mvmeta).
 *
 * Engine: AlmMultivariate.fit (multivariate-ma.js, vendored verbatim from
 * allmeta/shared; verified vs metafor::rma.mv on dat.berkey1998 to 1e-5). Each
 * study reports TWO correlated outcomes y=(y1,y2) with a KNOWN within-study
 * covariance S; the model y_i ~ N(μ, S_i + G) estimates the two outcome means
 * jointly, borrowing strength across the correlated outcomes (unstructured
 * between-study G by Cholesky-parameterised Nelder-Mead REML; μ by GLS).
 *
 * The kit's primary data model is one outcome per trial, so this is a PASTE-INPUT
 * tool: the user supplies their own two-outcome rows with the within-study
 * covariance. It NEVER reads or fabricates data from the dashboard — it computes
 * only on explicit user input.
 *
 * Input format (one study per line):  label, y1, y2, var1, var2, cov12
 *   e.g.  Trial1, -0.32, 0.47, 0.0030, 0.0075, 0.0030
 * y1/y2 are the two outcome effects (analysis scale); var1/var2 their within-study
 * variances; cov12 the within-study covariance between them. Needs >=2 studies.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'multivariate-ma-panel-expanded';

  function parseRows(text) {
    const rows = [], errors = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (parts.length < 6) { errors.push('Line ' + (i + 1) + ': need label, y1, y2, var1, var2, cov12'); continue; }
      const label = parts[0];
      const y1 = Number(parts[1]), y2 = Number(parts[2]);
      const v1 = Number(parts[3]), v2 = Number(parts[4]), c12 = Number(parts[5]);
      if (!label) { errors.push('Line ' + (i + 1) + ': empty label'); continue; }
      if (![y1, y2, v1, v2, c12].every(isFinite)) { errors.push('Line ' + (i + 1) + ': non-numeric value'); continue; }
      if (v1 <= 0 || v2 <= 0) { errors.push('Line ' + (i + 1) + ': var1/var2 must be > 0'); continue; }
      if (c12 * c12 > v1 * v2) { errors.push('Line ' + (i + 1) + ': |cov12| exceeds sqrt(var1·var2) (not a valid covariance)'); continue; }
      rows.push({ label, y: [y1, y2], S: [[v1, c12], [c12, v2]] });
    }
    return { rows, errors };
  }

  function compute(P, resultEl, text) {
    const fmt = P.fmt;
    const parsed = parseRows(text);
    if (parsed.errors.length) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + parsed.errors.length + ' problem(s):<br>' + parsed.errors.map(P.escapeHtml).join('<br>') + '</div>';
      return;
    }
    if (parsed.rows.length < 2) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">'
        + '⚠ Multivariate MA needs ≥2 studies — the between-study covariance G is unidentifiable with one study.</div>';
      return;
    }
    let f;
    try { f = global.AlmMultivariate.fit(parsed.rows); }
    catch (e) { resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ ' + P.escapeHtml(String(e.message || e)) + '</div>'; return; }
    if (!f || !isFinite(f.mu[0]) || !isFinite(f.mu[1])) { resultEl.innerHTML = '<div style="color:#fca5a5;font-size:11px;">REML did not converge on this input.</div>'; return; }
    const zc = 1.959963984540054;
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
    }
    resultEl.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">'
      + f.k + ' studies · ' + f.m + ' outcomes · joint REML · between-study ρ = ' + fmt(f.rho, 3) + ' · logLik = ' + fmt(f.logLik, 3) + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">'
      + cell('Outcome 1 mean μ₁', fmt(f.mu[0], 3), '95% CI ' + fmt(f.mu[0] - zc * f.muSE[0], 3) + ' – ' + fmt(f.mu[0] + zc * f.muSE[0], 3))
      + cell('Outcome 2 mean μ₂', fmt(f.mu[1], 3), '95% CI ' + fmt(f.mu[1] - zc * f.muSE[1], 3) + ' – ' + fmt(f.mu[1] + zc * f.muSE[1], 3))
      + cell('SE(μ₁), SE(μ₂)', fmt(f.muSE[0], 4) + ', ' + fmt(f.muSE[1], 4), 'from (Σ Wᵢ)⁻¹')
      + cell('Between-study τ²₁, τ²₂', fmt(f.G[0][0], 4) + ', ' + fmt(f.G[1][1], 4), 'G diagonal')
      + cell('Between-study ρ', fmt(f.rho, 3), 'outcome correlation')
      + '</div>';
  }

  function buildNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Joint meta-analysis of <strong>two correlated outcomes</strong> per study (e.g. systolic + diastolic BP, two endpoints). '
      + 'Paste rows: <code style="color:#7dd3fc;">label, y1, y2, var1, var2, cov12</code>. Computes only on your input.</div>';
    const ta = document.createElement('textarea');
    ta.rows = 6;
    ta.placeholder = 'Trial1, -0.32, 0.47, 0.0030, 0.0075, 0.0030\nTrial2, -0.60, 0.20, 0.0009, 0.0057, 0.0009\nTrial3, -0.12, 0.40, 0.0007, 0.0021, 0.0007\nTrial4, -0.31, 0.26, 0.0009, 0.0029, 0.0009\nTrial5, -0.39, 0.56, 0.0072, 0.0148, 0.0072';
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:8px;resize:vertical;';
    wrap.appendChild(ta);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Fit multivariate (joint) MA';
    btn.style.cssText = 'margin:8px 0;background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    wrap.appendChild(btn);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Multivariate MA (metafor::rma.mv, unstructured G):</strong> estimates the two outcome means jointly under '
      + 'yᵢ ~ N(μ, Sᵢ + G), borrowing strength across the correlated outcomes — μ by GLS, the unstructured between-study covariance G by '
      + 'Cholesky-parameterised REML (Nelder-Mead). Use when each study reports the SAME two correlated endpoints; for a single outcome use the '
      + 'standard random-effects pool. Verified vs metafor::rma.mv on dat.berkey1998 to 1e-5. Needs ≥2 studies (G unidentifiable with k<2).';
    wrap.appendChild(note);
    btn.addEventListener('click', () => compute(P, result, ta.value));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmMultivariate) return false;
    if (document.getElementById('multivariate-ma-panel')) return true;
    const panel = P.buildCollapsiblePanel({
      id: 'multivariate-ma-panel', badge: 'Multivariate MA (multiple outcomes)',
      summary: 'Joint meta-analysis of two correlated outcomes per study — paste-input tool',
      bodyNode: buildNode(P), storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1280));
    else setTimeout(tick, 1280);
  }

  global.MultivariateMAPanel = { render, parseRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
