/* transportability-v1-panel.js — transport a pooled effect to a target population
 * via one effect-modifier (paste-input tool).
 *
 * Engine: AlmTransport.transport (transportability-v1.js, vendored verbatim from
 * allmeta/shared). Standard meta-analysis answers "what was the average effect
 * ACROSS the trials"; transportability answers "what effect should we expect in
 * OUR population" when an effect modifier (baseline risk, mean age, % diabetic,
 * baseline BMI…) differs between the trials and the target. It fits a
 * random-effects meta-regression on the modifier (τ² Paule-Mandel; CI
 * Knapp-Hartung t_{k-2} with the HKSJ q=max(1,RSS/df) floor) and PREDICTS the
 * mean effect at the target's modifier value, propagating uncertainty.
 *
 * No mainstream review tool offers transport — it is a frontier generalisability
 * method and is strongly assumption-laden, so the panel also reports an
 * unmeasured-modifier sensitivity. The kit carries no per-population modifier
 * value, so this is a PASTE-INPUT tool: the user supplies trial rows AND the
 * target modifier x*. It NEVER reads or fabricates data from the dashboard.
 *
 * Input format (one row per line):  label, effect, SE, modifier
 *   e.g.  STEP-1, -12.4, 0.6, 37.9
 * Effects are on the ANALYSIS scale (log for ratios). Target x* is a separate box.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'transportability-v1-panel-expanded';

  function parseRows(text) {
    const rows = [], errors = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (parts.length < 4) { errors.push('Line ' + (i + 1) + ': need label, effect, SE, modifier'); continue; }
      const label = parts[0], est = Number(parts[1]), se = Number(parts[2]), x = Number(parts[3]);
      if (!label) { errors.push('Line ' + (i + 1) + ': empty label'); continue; }
      if (!isFinite(est)) { errors.push('Line ' + (i + 1) + ': effect "' + parts[1] + '" not numeric'); continue; }
      if (!isFinite(se) || se <= 0) { errors.push('Line ' + (i + 1) + ': SE "' + parts[2] + '" must be > 0'); continue; }
      if (!isFinite(x)) { errors.push('Line ' + (i + 1) + ': modifier "' + parts[3] + '" not numeric'); continue; }
      rows.push({ label, est, se, x });
    }
    return { rows, errors };
  }

  function compute(P, resultEl, text, targetText) {
    const fmt = P.fmt;
    const parsed = parseRows(text);
    if (parsed.errors.length) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + parsed.errors.length + ' problem(s):<br>' + parsed.errors.map(P.escapeHtml).join('<br>') + '</div>';
      return;
    }
    const target = Number(targetText);
    if (!isFinite(target)) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ Enter a numeric target modifier value (x*).</div>';
      return;
    }
    let r;
    try { r = global.AlmTransport.transport({ studies: parsed.rows, target }); }
    catch (e) { resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">Computation failed: ' + P.escapeHtml(String(e.message || e)) + '</div>'; return; }
    if (!r || !r.ok) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + P.escapeHtml(r && r.error ? r.error : 'transport not identifiable on this input') + '</div>';
      return;
    }
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
    }
    const t = r.transported, a = r.atTrialMean, s = r.slope;
    resultEl.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">'
      + r.k + ' studies · τ²(PM) = ' + fmt(r.tau2, 3) + ' · HKSJ q = ' + fmt(r.q, 2) + ' · t-df = ' + r.df + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">'
      + cell('Transported to x*=' + fmt(target, 2), fmt(t.est, 3), '95% CI ' + fmt(t.ciLo, 3) + ' – ' + fmt(t.ciHi, 3))
      + cell('At trial mean x̄=' + fmt(r.trialMean, 2), fmt(a.est, 3), '95% CI ' + fmt(a.ciLo, 3) + ' – ' + fmt(a.ciHi, 3))
      + cell('Modifier slope', fmt(s.est, 3), 'p = ' + fmt(s.p, 3) + (s.p < 0.05 ? ' (effect modification)' : ' (NS)'))
      + cell('Transport shift', fmt(r.shift, 3), 'β·(x*−x̄)')
      + '</div>'
      + '<div style="font-size:10.5px;color:#94a3b8;margin-top:8px;">'
      + (r.sensitivity.significant
        ? '<strong>Unmeasured-modifier sensitivity:</strong> a residual shift of ' + fmt(r.sensitivity.biasToNull, 3) + ' on the analysis scale would move the transported CI to the null.'
        : '<strong>Unmeasured-modifier sensitivity:</strong> the transported CI already crosses the null, so no residual shift is required to nullify it.')
      + '</div>';
  }

  function buildNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Transport the pooled effect to <strong>your target population</strong> via one effect-modifier. '
      + 'Paste rows: <code style="color:#7dd3fc;">label, effect, SE, modifier</code>, then a target modifier value x*. Computes only on your input.</div>';
    const ta = document.createElement('textarea');
    ta.rows = 6;
    ta.placeholder = 'STEP-1, -12.4, 0.6, 37.9\nSURMOUNT-1, -17.8, 0.7, 38.0\nSCALE, -5.4, 0.5, 38.3\nPIONEER, -4.2, 0.6, 32.9\nAWARD, -3.0, 0.7, 33.5';
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:8px;resize:vertical;';
    wrap.appendChild(ta);
    const targetWrap = document.createElement('div');
    targetWrap.style.cssText = 'margin:8px 0;display:flex;align-items:center;gap:8px;';
    const targetLabel = document.createElement('span');
    targetLabel.textContent = 'Target modifier x*:';
    targetLabel.style.cssText = 'font-size:11px;color:#cbd5e1;';
    const targetInput = document.createElement('input');
    targetInput.type = 'text';
    targetInput.placeholder = 'e.g. 31';
    targetInput.style.cssText = 'width:90px;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:5px 8px;';
    targetWrap.appendChild(targetLabel); targetWrap.appendChild(targetInput);
    wrap.appendChild(targetWrap);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Transport to target';
    btn.style.cssText = 'margin:0 0 8px;background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    wrap.appendChild(btn);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Transportability (aggregate one-covariate ML-NMR idea):</strong> fits a random-effects meta-regression on the modifier '
      + '(τ² Paule-Mandel; Knapp-Hartung t_{k-2} CI with HKSJ q-floor) and predicts the effect at the target population’s modifier value. '
      + '<strong>Experimental & assumption-laden:</strong> assumes the modifier captures the relevant trial-vs-target difference and that the linear '
      + 'effect-modification holds at x* — surface the transport assumptions, never the transported point alone. Needs ≥3 studies with a varying modifier.';
    wrap.appendChild(note);
    btn.addEventListener('click', () => compute(P, result, ta.value, targetInput.value));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmTransport) return false;
    if (document.getElementById('transportability-v1-panel')) return true;
    const panel = P.buildCollapsiblePanel({
      id: 'transportability-v1-panel', badge: 'Transportability <span style="font-size:9px;background:#3a2a0a;color:#fbbf24;border:1px solid #92400e;border-radius:4px;padding:0 4px;margin-left:4px;">Experimental</span>',
      summary: 'Transport the pooled effect to a target population via one effect-modifier — paste-input tool',
      bodyNode: buildNode(P), storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1250));
    else setTimeout(tick, 1250);
  }

  global.TransportabilityV1Panel = { render, parseRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
