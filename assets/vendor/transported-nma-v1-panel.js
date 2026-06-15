/* transported-nma-v1-panel.js — population-transported network meta-analysis via
 * entropy balancing (paste-input tool).
 *
 * Engine: AlmTransportedNMA.run (vendored verbatim from allmeta/shared/
 * transported-nma-v1.js). A standard NMA estimates relative effects in the SOURCE
 * network's case-mix; if the TARGET population has a different distribution of an
 * effect modifier, those estimates may not transport. This reweights each study
 * (Hainmueller entropy balancing) so the network's weighted covariate mean matches
 * a target value, inflates each study's variance by its weight, and refits the
 * random-effects NMA — yielding a target-population league alongside the source
 * one plus the effective-sample-size (ESS) cost of the transport.
 *
 * EXPERIMENTAL & assumption-laden: corrects only for the MEASURED modifier you
 * supply; unmeasured modifiers and effect-modifier interactions are not fixed; the
 * variance-inflation reweighting is an aggregate-data approximation to IPD-NMA.
 * Watch the ESS ratio — a low ESS means the target lies outside the studies' hull
 * (extrapolation). The kit carries no per-study covariate, so this is a PASTE-INPUT
 * tool. It NEVER reads or fabricates dashboard data — computes only on your input.
 *
 * Input format (one contrast/study per line):  trtA, trtB, yi, sei, modifier
 *   e.g.  A, B, -0.40, 0.12, 60
 * Each row is one study contributing a contrast (trtA vs trtB) and that study's
 * effect-modifier value. The first treatment seen is the network reference. The
 * target modifier value is a separate box. Needs ≥2 studies and ≥ as many
 * contrasts as (treatments − 1).
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'transported-nma-v1-panel-expanded';

  function parseRows(text) {
    const rows = [], errors = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (parts.length < 5) { errors.push('Line ' + (i + 1) + ': need trtA, trtB, yi, sei, modifier'); continue; }
      const a = parts[0], b = parts[1], yi = Number(parts[2]), sei = Number(parts[3]), x = Number(parts[4]);
      if (!a || !b) { errors.push('Line ' + (i + 1) + ': empty treatment label'); continue; }
      if (a === b) { errors.push('Line ' + (i + 1) + ': trtA and trtB must differ'); continue; }
      if (!isFinite(yi)) { errors.push('Line ' + (i + 1) + ': yi "' + parts[2] + '" not numeric'); continue; }
      if (!isFinite(sei) || sei <= 0) { errors.push('Line ' + (i + 1) + ': sei "' + parts[3] + '" must be > 0'); continue; }
      if (!isFinite(x)) { errors.push('Line ' + (i + 1) + ': modifier "' + parts[4] + '" not numeric'); continue; }
      rows.push({ trtA: a, trtB: b, yi: yi, sei: sei, x: x });
    }
    return { rows, errors };
  }

  function _build(rows) {
    const treatments = [];
    rows.forEach(r => { [r.trtA, r.trtB].forEach(t => { if (treatments.indexOf(t) < 0) treatments.push(t); }); });
    const studies = rows.map(r => ({ cov: { x: r.x } }));
    const netRows = rows.map((r, i) => ({ trtA: r.trtA, trtB: r.trtB, yi: r.yi, sei: r.sei, study: i }));
    return { treatments, studies, netRows };
  }

  function compute(P, resultEl, text, targetText) {
    const fmt = P.fmt;
    const parsed = parseRows(text);
    if (parsed.errors.length) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + parsed.errors.length + ' problem(s):<br>' + parsed.errors.map(P.escapeHtml).join('<br>') + '</div>';
      return;
    }
    if (parsed.rows.length < 2) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ Need ≥2 studies for transport.</div>';
      return;
    }
    const target = Number(targetText);
    if (!isFinite(target)) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ Enter a numeric target modifier value.</div>';
      return;
    }
    const built = _build(parsed.rows);
    let r;
    try { r = global.AlmTransportedNMA.run({ studies: built.studies, rows: built.netRows, treatments: built.treatments, target: { x: target } }); }
    catch (e) { resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">Computation failed: ' + P.escapeHtml(String(e.message || e)) + '</div>'; return; }
    if (!r || !r.ok) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + P.escapeHtml(r && r.error ? r.error : 'transport not identifiable on this input') + '</div>';
      return;
    }
    const ref = r.source.reference;
    let tbl = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:4px;">'
      + '<tr style="color:#94a3b8;text-align:left;"><th style="padding:3px 6px;">vs ' + P.escapeHtml(ref) + '</th><th style="padding:3px 6px;">Source</th><th style="padding:3px 6px;">Transported</th><th style="padding:3px 6px;">ΔP-score</th></tr>';
    built.treatments.forEach(t => {
      if (t === ref) return;
      const se = r.source.effects[t], te = r.transported.effects[t];
      const shift = r.shifts.find(s => s.treatment === t);
      tbl += '<tr style="border-top:1px solid #1e293b;color:#e2e8f0;font-family:JetBrains Mono,monospace;">'
        + '<td style="padding:3px 6px;color:#7dd3fc;">' + P.escapeHtml(t) + '</td>'
        + '<td style="padding:3px 6px;">' + fmt(se.estimate, 3) + ' [' + fmt(se.ciLo, 2) + ',' + fmt(se.ciHi, 2) + ']</td>'
        + '<td style="padding:3px 6px;">' + fmt(te.estimate, 3) + ' [' + fmt(te.ciLo, 2) + ',' + fmt(te.ciHi, 2) + ']</td>'
        + '<td style="padding:3px 6px;color:#94a3b8;">' + (shift ? (shift.delta >= 0 ? '+' : '') + fmt(shift.delta, 3) : '–') + '</td></tr>';
    });
    tbl += '</table>';
    resultEl.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">'
      + r.transport.n + ' studies · ' + built.treatments.length + ' treatments · target modifier = ' + fmt(target, 2)
      + ' · ESS ' + fmt(r.transport.ess, 1) + '/' + r.transport.n + ' (' + fmt(100 * r.transport.essRatio, 0) + '%)</div>'
      + tbl
      + '<div style="font-size:10.5px;color:' + (r.caution ? '#fbbf24' : '#94a3b8') + ';margin-top:8px;line-height:1.5;">'
      + (r.caution ? '<strong>CAUTION:</strong> ' : '') + P.escapeHtml(r.verdict) + '</div>';
  }

  function buildNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Transport an <strong>NMA league</strong> to your target population via entropy balancing on one effect-modifier. '
      + '<strong>Requires target-population covariates</strong> (a per-study modifier value + a target value) — not in the kit\'s effect set, so this is a '
      + 'paste-input tool. Paste contrasts: <code style="color:#7dd3fc;">trtA, trtB, yi, sei, modifier</code>, then a target modifier value. Computes only on your input.</div>';
    const fmtHint = document.createElement('div');
    fmtHint.style.cssText = 'font-size:10px;color:#94a3b8;margin-bottom:6px;';
    fmtHint.innerHTML = 'format: <code style="color:#7dd3fc;">trtA, trtB, yi, sei, modifier</code> — one study/contrast per line; first treatment seen is the reference.';
    wrap.appendChild(fmtHint);
    const ta = document.createElement('textarea');
    ta.rows = 6;
    ta.placeholder = 'A, B, -0.40, 0.12, 60\nA, C, -0.55, 0.16, 55\nB, C, -0.20, 0.18, 65\nA, B, -0.30, 0.14, 50';
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:8px;resize:vertical;';
    wrap.appendChild(ta);
    const targetWrap = document.createElement('div');
    targetWrap.style.cssText = 'margin:8px 0;display:flex;align-items:center;gap:8px;';
    const targetLabel = document.createElement('span');
    targetLabel.textContent = 'Target modifier:';
    targetLabel.style.cssText = 'font-size:11px;color:#cbd5e1;';
    const targetInput = document.createElement('input');
    targetInput.type = 'text';
    targetInput.placeholder = 'e.g. 57.5';
    targetInput.style.cssText = 'width:90px;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:5px 8px;';
    targetWrap.appendChild(targetLabel); targetWrap.appendChild(targetInput);
    wrap.appendChild(targetWrap);
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin:0 0 8px;display:flex;gap:8px;';
    const example = document.createElement('button');
    example.type = 'button';
    example.textContent = 'Load example';
    example.style.cssText = 'background:#0b1220;color:#94a3b8;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Transport league';
    btn.style.cssText = 'background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    btnRow.appendChild(example); btnRow.appendChild(btn);
    wrap.appendChild(btnRow);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Population-transported NMA (entropy balancing; nmatransport):</strong> reweights each study so the network’s weighted '
      + 'modifier mean exactly matches the target (Hainmueller dual-Newton), inflates each study’s variance by its weight, and refits the RE-NMA on the '
      + 'audited multiplicative-NMA WLS solver. <strong>Experimental & assumption-laden:</strong> corrects only the MEASURED modifier; watch the ESS '
      + 'ratio (a low ESS = extrapolation beyond the covariate hull) and read the source league alongside the transported one. When the target equals the '
      + 'source mean the weights are uniform and the transported league equals the source league. Needs ≥2 studies.';
    wrap.appendChild(note);
    const EXAMPLE = 'A, B, -0.40, 0.12, 60\nA, C, -0.55, 0.16, 55\nB, C, -0.20, 0.18, 65\nA, B, -0.30, 0.14, 50';
    example.addEventListener('click', () => { ta.value = EXAMPLE; targetInput.value = '57.5'; });
    btn.addEventListener('click', () => compute(P, result, ta.value, targetInput.value));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmTransportedNMA) return false;
    if (document.getElementById('transported-nma-v1-panel')) return true;
    const panel = P.buildCollapsiblePanel({
      id: 'transported-nma-v1-panel', badge: 'Transported NMA <span style="font-size:9px;background:#3a2a0a;color:#fbbf24;border:1px solid #92400e;border-radius:4px;padding:0 4px;margin-left:4px;">Experimental</span>',
      summary: 'Transport an NMA league to a target population via entropy balancing — paste-input tool',
      bodyNode: buildNode(P), storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1500));
    else setTimeout(tick, 1500);
  }

  global.TransportedNMAV1Panel = { render, parseRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
