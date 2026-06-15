/* multi-outcome-ma-panel.js — bivariate (multi-outcome) random-effects MA when
 * the WITHIN-study correlation is unknown (Riley et al. 2007; Jackson 2011).
 *
 * Engine: AlmMultiOutcome.fitBivariate (vendored verbatim from
 * allmeta/shared/multi-outcome-ma.js, verified vs metafor::rma.mv(~out-1, V,
 * random=~out|study, struct="UN"): on the 8-study example μ=[-0.27367058,
 * -0.37536381], se=[0.04523136, 0.05280141]; on a heterogeneous case μ/se/τ/ρ
 * all match metafor). Estimates the between-study Σ_RE (τ²₁, τ²₂, ρ_between) by a
 * REML grid + coordinate descent, given a SINGLE assumed within-study correlation.
 *
 * COMPLEMENTS the kit's multivariate-ma panel: that one needs the full KNOWN
 * within-study covariance per study; this one only needs the two SEs plus one
 * assumed ρ_within (Riley's recommendation when the within-study correlation
 * isn't reported — the common real-world case) AND handles studies that report
 * only ONE of the two outcomes (borrowing-of-strength). PASTE-INPUT tool — never
 * reads or fabricates dashboard data.
 *
 * Input format (one study per line):  label, y1, se1, y2, se2
 *   e.g.  Trial1, -0.30, 0.12, -0.40, 0.15
 * Leave a cell blank or "NA" for an unreported outcome. The assumed within-study
 * correlation ρ_within is set below (default 0.5). Needs >=2 studies.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'multi-outcome-ma-panel-expanded';

  function _num(s) {
    if (s == null) return NaN;
    const t = String(s).trim();
    if (t === '' || t.toLowerCase() === 'na' || t.toLowerCase() === 'nan') return NaN;
    return Number(t);
  }

  function parseRows(text) {
    const rows = [], errors = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (parts.length < 5) { errors.push('Line ' + (i + 1) + ': need label, y1, se1, y2, se2'); continue; }
      const label = parts[0];
      const y1 = _num(parts[1]), s1 = _num(parts[2]), y2 = _num(parts[3]), s2 = _num(parts[4]);
      if (!label) { errors.push('Line ' + (i + 1) + ': empty label'); continue; }
      const has1 = isFinite(y1) && isFinite(s1), has2 = isFinite(y2) && isFinite(s2);
      if (!has1 && !has2) { errors.push('Line ' + (i + 1) + ': no complete (y, se) pair for either outcome'); continue; }
      if (isFinite(s1) && s1 <= 0) { errors.push('Line ' + (i + 1) + ': se1 must be > 0'); continue; }
      if (isFinite(s2) && s2 <= 0) { errors.push('Line ' + (i + 1) + ': se2 must be > 0'); continue; }
      rows.push({ label, y: [has1 ? y1 : NaN, has2 ? y2 : NaN], se: [has1 ? s1 : NaN, has2 ? s2 : NaN] });
    }
    return { rows, errors };
  }

  function compute(P, resultEl, text, rhoWithin) {
    const fmt = P.fmt;
    const parsed = parseRows(text);
    if (parsed.errors.length) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + parsed.errors.length + ' problem(s):<br>' + parsed.errors.map(P.escapeHtml).join('<br>') + '</div>';
      return;
    }
    if (parsed.rows.length < 2) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">'
        + '⚠ Bivariate MA needs ≥2 studies — the between-study Σ_RE is unidentifiable with one study.</div>';
      return;
    }
    let f;
    try { f = global.AlmMultiOutcome.fitBivariate(parsed.rows, { rhoWithin: rhoWithin }); }
    catch (e) { resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ ' + P.escapeHtml(String(e.message || e)) + '</div>'; return; }
    if (!f || !f.ok || !isFinite(f.mu[0]) || !isFinite(f.mu[1])) { resultEl.innerHTML = '<div style="color:#fca5a5;font-size:11px;">REML did not converge on this input.</div>'; return; }
    const zc = 1.959963984540054;
    const se = [Math.sqrt(Math.max(0, f.cov[0][0])), Math.sqrt(Math.max(0, f.cov[1][1]))];
    const tau = [Math.sqrt(Math.max(0, f.Sigma_RE[0][0])), Math.sqrt(Math.max(0, f.Sigma_RE[1][1]))];
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
    }
    resultEl.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">'
      + f.k + ' studies · bivariate REML · assumed ρ_within = ' + fmt(rhoWithin, 2) + ' · between-study ρ = ' + fmt(f.rho_between, 3) + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">'
      + cell('Outcome 1 mean μ₁', fmt(f.mu[0], 3), '95% CI ' + fmt(f.mu[0] - zc * se[0], 3) + ' – ' + fmt(f.mu[0] + zc * se[0], 3))
      + cell('Outcome 2 mean μ₂', fmt(f.mu[1], 3), '95% CI ' + fmt(f.mu[1] - zc * se[1], 3) + ' – ' + fmt(f.mu[1] + zc * se[1], 3))
      + cell('SE(μ₁), SE(μ₂)', fmt(se[0], 4) + ', ' + fmt(se[1], 4), 'joint GLS standard errors')
      + cell('Between-study τ₁, τ₂', fmt(tau[0], 3) + ', ' + fmt(tau[1], 3), 'Σ_RE diagonal SDs')
      + cell('Between-study ρ', fmt(f.rho_between, 3), 'outcome correlation')
      + '</div>';
  }

  function buildNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Bivariate MA of <strong>two outcomes</strong> when the <strong>within-study correlation is unknown</strong> (Riley 2007). '
      + 'Paste rows: <code style="color:#7dd3fc;">label, y1, se1, y2, se2</code> (blank or NA for an unreported outcome). Computes only on your input.</div>';
    const ctrl = document.createElement('div');
    ctrl.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px;color:#94a3b8;';
    ctrl.innerHTML = '<label for="moma-rho">Assumed within-study ρ:</label>';
    const rhoIn = document.createElement('input');
    rhoIn.type = 'number'; rhoIn.id = 'moma-rho'; rhoIn.value = '0.5'; rhoIn.step = '0.1'; rhoIn.min = '-0.99'; rhoIn.max = '0.99';
    rhoIn.style.cssText = 'width:70px;background:#0b1220;border:1px solid #1e293b;border-radius:4px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:3px 6px;';
    ctrl.appendChild(rhoIn);
    const ta = document.createElement('textarea');
    ta.rows = 6;
    ta.placeholder = 'Trial1, -0.30, 0.12, -0.40, 0.15\nTrial2, -0.22, 0.10, -0.35, 0.12\nTrial3, -0.45, 0.18, -0.55, 0.20\nTrial4, -0.18, 0.09, -0.28, 0.11\nTrial5, -0.50, 0.20, NA, NA';
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:8px;resize:vertical;';
    wrap.appendChild(ctrl);
    wrap.appendChild(ta);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Fit bivariate MA';
    btn.style.cssText = 'margin:8px 0;background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    wrap.appendChild(btn);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Bivariate MA, unknown within-study ρ (Riley 2007; metafor::rma.mv UN):</strong> pools two outcomes jointly under '
      + 'yᵢ ~ N(μ, Vᵢ + Σ_RE), where Vᵢ is built from each study’s two SEs and a SINGLE assumed within-study correlation. Borrows strength '
      + 'across the correlated outcomes — and recovers a pooled estimate for studies that report only ONE outcome. Unlike the multivariate-MA panel '
      + '(which needs the full known within-study covariance), this is for the common case where the within-study correlation is unreported. Try a '
      + 'few ρ_within values as a sensitivity check. Needs ≥2 studies.';
    wrap.appendChild(note);
    btn.addEventListener('click', () => {
      let rho = Number(rhoIn.value);
      if (!isFinite(rho) || rho <= -1 || rho >= 1) rho = 0.5;
      compute(P, result, ta.value, rho);
    });
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmMultiOutcome) return false;
    if (document.getElementById('multi-outcome-ma-panel')) return true;
    const panel = P.buildCollapsiblePanel({
      id: 'multi-outcome-ma-panel', badge: 'Bivariate MA (unknown ρ_within)',
      summary: 'Joint two-outcome MA when within-study correlation is unknown — paste-input tool',
      bodyNode: buildNode(P), storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1300));
    else setTimeout(tick, 1300);
  }

  global.MultiOutcomeMAPanel = { render, parseRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
