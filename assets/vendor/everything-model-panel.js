/* everything-model-panel.js — joint outcome × time × RoB hierarchical
 * meta-analysis (the "everything model"), paste-input tool.
 *
 * Engine: AlmEverythingModel.fit (vendored verbatim from allmeta/shared/
 * everything-model.js). Decomposes a longitudinal effect y_{i,t,o} into additive
 * components — an outcome-specific mean μ_o, a study random effect δ_i (shared
 * across time and outcome), a time-period effect γ_t (reference period = 0), and
 * an optional RoB-driven systematic shift — estimated by closed-form variational
 * EM (no MCMC). Returns per-outcome μ̂ + SE, per-period γ̂, study shrinkage δ̂,
 * and the study-level τ²_δ.
 *
 * RESEARCH / EXPERIMENTAL: a unifying frame rather than a single validated method;
 * the RoB→bias shift defaults to 0 (the user must opt in to a bias prior). The kit
 * carries no longitudinal multi-outcome data, so this is a PASTE-INPUT tool. It
 * NEVER reads or fabricates dashboard data — computes only on explicit user input.
 *
 * Input format (one snapshot per line):  study, time, outcome, rob, yi, sei
 *   e.g.  S1, 2018, mortality, low, -0.40, 0.12
 * Each row is a (study, time-period, outcome) snapshot with a risk-of-bias label
 * and an effect + SE. The first time-period seen is the γ reference (γ = 0). Needs
 * ≥2 valid rows. The RoB-bias scale is a separate input (default 0 = no shift).
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'everything-model-panel-expanded';

  function parseRows(text) {
    const rows = [], errors = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (parts.length < 6) { errors.push('Line ' + (i + 1) + ': need study, time, outcome, rob, yi, sei'); continue; }
      const study = parts[0], time = parts[1], outcome = parts[2], rob = parts[3], yi = Number(parts[4]), se = Number(parts[5]);
      if (!study) { errors.push('Line ' + (i + 1) + ': empty study'); continue; }
      if (!time) { errors.push('Line ' + (i + 1) + ': empty time'); continue; }
      if (!outcome) { errors.push('Line ' + (i + 1) + ': empty outcome'); continue; }
      if (!isFinite(yi)) { errors.push('Line ' + (i + 1) + ': yi "' + parts[4] + '" not numeric'); continue; }
      if (!isFinite(se) || se <= 0) { errors.push('Line ' + (i + 1) + ': sei "' + parts[5] + '" must be > 0'); continue; }
      rows.push({ study, time, outcome, rob: rob || 'low', yi, vi: se * se });
    }
    return { rows, errors };
  }

  function compute(P, resultEl, text, biasScaleText) {
    const fmt = P.fmt;
    const parsed = parseRows(text);
    if (parsed.errors.length) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + parsed.errors.length + ' problem(s):<br>' + parsed.errors.map(P.escapeHtml).join('<br>') + '</div>';
      return;
    }
    if (parsed.rows.length < 2) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ Need ≥2 valid rows.</div>';
      return;
    }
    let biasScale = Number(biasScaleText);
    if (!isFinite(biasScale)) biasScale = 0;
    let f;
    try { f = global.AlmEverythingModel.fit(parsed.rows, { biasScale: biasScale }); }
    catch (e) { resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">Computation failed: ' + P.escapeHtml(String(e.message || e)) + '</div>'; return; }
    if (!f || !f.ok) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + P.escapeHtml(f && f.error ? f.error : 'model did not fit on this input') + '</div>';
      return;
    }
    let muTbl = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:4px;">'
      + '<tr style="color:#94a3b8;text-align:left;"><th style="padding:3px 6px;">Outcome</th><th style="padding:3px 6px;">μ̂</th><th style="padding:3px 6px;">SE</th><th style="padding:3px 6px;">95% CI</th></tr>';
    f.outcomes.forEach(o => {
      const m = f.mu[o];
      muTbl += '<tr style="border-top:1px solid #1e293b;color:#e2e8f0;font-family:JetBrains Mono,monospace;">'
        + '<td style="padding:3px 6px;color:#7dd3fc;">' + P.escapeHtml(o) + '</td>'
        + '<td style="padding:3px 6px;">' + fmt(m.estimate, 3) + '</td>'
        + '<td style="padding:3px 6px;">' + fmt(m.se, 3) + '</td>'
        + '<td style="padding:3px 6px;color:#94a3b8;">' + fmt(m.ci_lo, 2) + ' – ' + fmt(m.ci_hi, 2) + '</td></tr>';
    });
    muTbl += '</table>';
    const periods = f.times.map(t => P.escapeHtml(t) + ' γ=' + fmt(f.gamma[t].estimate, 3) + (f.gamma[t].is_reference ? ' (ref)' : '')).join(' · ');
    resultEl.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">'
      + f.studies.length + ' studies · ' + f.times.length + ' periods · ' + f.outcomes.length + ' outcomes · '
      + 'τ²_δ = ' + fmt(f.tau2_delta, 4) + ' · ' + f.n_iter + ' EM iters · ' + (f.converged ? 'converged' : 'NOT converged') + '</div>'
      + muTbl
      + '<div style="font-size:10.5px;color:#94a3b8;margin-top:8px;">Time-period effects: ' + periods + '</div>'
      + '<div style="font-size:10.5px;color:#94a3b8;margin-top:4px;">RoB-bias scale = ' + fmt(f.bias_scale, 2) + ' (0 = no systematic RoB shift applied).</div>';
  }

  function buildNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Joint <strong>outcome × time × RoB</strong> hierarchical model (the "everything model") by variational EM. '
      + '<strong>Requires a time dimension</strong> (a time-period per snapshot) plus outcome + RoB labels — the kit ships no longitudinal multi-outcome '
      + 'data, so this is a paste-input tool. Paste snapshots: <code style="color:#7dd3fc;">study, time, outcome, rob, yi, sei</code>. Computes only on your input.</div>';
    const fmtHint = document.createElement('div');
    fmtHint.style.cssText = 'font-size:10px;color:#94a3b8;margin-bottom:6px;';
    fmtHint.innerHTML = 'format: <code style="color:#7dd3fc;">study, time, outcome, rob, yi, sei</code> — one snapshot per line; first time-period seen is the γ reference (γ=0).';
    wrap.appendChild(fmtHint);
    const ta = document.createElement('textarea');
    ta.rows = 7;
    ta.placeholder = 'S1, 2018, mortality, low, -0.40, 0.12\nS2, 2018, mortality, low, -0.30, 0.14\nS3, 2020, mortality, high, -0.55, 0.16\nS4, 2020, MACE, low, -0.20, 0.18\nS1, 2020, MACE, low, -0.25, 0.20\nS2, 2018, MACE, high, -0.35, 0.15';
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:8px;resize:vertical;';
    wrap.appendChild(ta);
    const ctrl = document.createElement('div');
    ctrl.style.cssText = 'margin:8px 0;display:flex;align-items:center;gap:8px;';
    const lbl = document.createElement('span');
    lbl.textContent = 'RoB-bias scale:';
    lbl.style.cssText = 'font-size:11px;color:#cbd5e1;';
    const biasIn = document.createElement('input');
    biasIn.type = 'number'; biasIn.value = '0'; biasIn.step = '0.05';
    biasIn.style.cssText = 'width:80px;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:5px 8px;';
    ctrl.appendChild(lbl); ctrl.appendChild(biasIn);
    wrap.appendChild(ctrl);
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin:0 0 8px;display:flex;gap:8px;';
    const example = document.createElement('button');
    example.type = 'button';
    example.textContent = 'Load example';
    example.style.cssText = 'background:#0b1220;color:#94a3b8;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Fit everything model';
    btn.style.cssText = 'background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    btnRow.appendChild(example); btnRow.appendChild(btn);
    wrap.appendChild(btnRow);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>The everything model (Higgins-Whitehead hierarchical frame):</strong> y_{i,t,o} = μ_o + δ_i + γ_t + bias(RoB) + ε, fitted by '
      + 'closed-form variational EM. The study random effect δ_i is shared across time and outcome; γ_t is anchored at γ=0 in the reference period; the '
      + 'RoB→bias term is a systematic shift on the effect scale (NOT a downweight), defaulting to 0 so you must opt in to a bias prior. '
      + '<strong>Research / experimental — a unifying frame, not a single validated method;</strong> when there is one period and one outcome it reduces to '
      + 'the random-effects pool. Needs ≥2 valid rows.';
    wrap.appendChild(note);
    const EXAMPLE = 'S1, 2018, mortality, low, -0.40, 0.12\nS2, 2018, mortality, low, -0.30, 0.14\nS3, 2020, mortality, high, -0.55, 0.16\nS4, 2020, MACE, low, -0.20, 0.18\nS1, 2020, MACE, low, -0.25, 0.20\nS2, 2018, MACE, high, -0.35, 0.15';
    example.addEventListener('click', () => { ta.value = EXAMPLE; });
    btn.addEventListener('click', () => compute(P, result, ta.value, biasIn.value));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmEverythingModel) return false;
    if (document.getElementById('everything-model-panel')) return true;
    const panel = P.buildCollapsiblePanel({
      id: 'everything-model-panel', badge: 'Everything model (outcome×time×RoB) <span style="font-size:9px;background:#3a2a0a;color:#fbbf24;border:1px solid #92400e;border-radius:4px;padding:0 4px;margin-left:4px;">Experimental</span>',
      summary: 'Joint outcome×time×RoB hierarchical MA by variational EM — paste-input tool',
      bodyNode: buildNode(P), storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1650));
    else setTimeout(tick, 1650);
  }

  global.EverythingModelPanel = { render, parseRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
