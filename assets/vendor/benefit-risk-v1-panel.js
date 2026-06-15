/* benefit-risk-v1-panel.js — probabilistic benefit-risk MCDA + value of
 * information (SMAA / Tervonen; ISPOR benefit-risk task force).
 *
 * Engine: AlmBenefitRisk.analyze (vendored verbatim from allmeta/shared/
 * benefit-risk-v1.js). Maps each criterion onto a [0,1] partial value, takes a
 * weighted sum to a total value per treatment (deterministic MCDA), then
 * propagates each treatment×criterion (mean, SE) by a SEEDED Monte-Carlo SMAA to
 * get rank-acceptabilities and EVPI (the value of resolving the decision
 * uncertainty). Deterministic — a fixed seed makes every run reproduce exactly.
 *
 * AUTO-MOUNT: criteria = the trial's multiple registered outcomes (allOutcomes);
 * treatments = {Intervention, Comparator}; per-(treatment, criterion) performance
 * is that arm's event proportion for the outcome (from the outcome's arm counts)
 * when available, else the outcome's reported mean (relative effect or MD).
 * Criterion weights are EQUAL; the worst/best value-function anchors come from the
 * observed range across treatments. Auto-mounts only when ≥2 outcomes are
 * available across the dashboard's trials; otherwise the manual criteria + value
 * matrix paste-input is shown. The paste-input remains an "or paste your own data"
 * fallback in either case.
 *
 * EXPERIMENTAL — illustrative MCDA. Weights are value judgements, the value
 * functions are linear, EVPI is on the value scale, and NO external statistical
 * package validates this output. Surface as a structured what-if, never as an
 * inferential claim.
 *
 * Paste-input format — two blocks separated by a blank line:
 *   CRITERIA: one per line  `id, type, weight`  (type = benefit|harm)
 *   VALUES:   one per line   `treatment, criterionId, mean[, se]`
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'benefit-risk-v1-panel-expanded';

  // ---- Paste-input parser ----------------------------------------------------
  function parseInput(text) {
    const errors = [], criteria = [], values = [];
    const lines = text.split(/\r?\n/);
    let mode = null;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const up = raw.toUpperCase();
      if (up === 'CRITERIA:' || up === 'CRITERIA') { mode = 'crit'; continue; }
      if (up === 'VALUES:' || up === 'VALUES') { mode = 'val'; continue; }
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (mode === 'crit') {
        if (parts.length < 2) { errors.push('Line ' + (i + 1) + ': criterion needs id, type[, weight]'); continue; }
        const id = parts[0], type = parts[1].toLowerCase();
        if (type !== 'benefit' && type !== 'harm') { errors.push('Line ' + (i + 1) + ': type "' + parts[1] + '" must be benefit|harm'); continue; }
        let w = 1; if (parts.length >= 3 && parts[2] !== '') { w = Number(parts[2]); if (!isFinite(w) || w < 0) { errors.push('Line ' + (i + 1) + ': weight "' + parts[2] + '" must be ≥ 0'); continue; } }
        criteria.push({ id, type, weight: w });
      } else if (mode === 'val') {
        if (parts.length < 3) { errors.push('Line ' + (i + 1) + ': value needs treatment, criterionId, mean[, se]'); continue; }
        const trt = parts[0], cid = parts[1], mean = Number(parts[2]);
        if (!isFinite(mean)) { errors.push('Line ' + (i + 1) + ': mean "' + parts[2] + '" not numeric'); continue; }
        let se; if (parts.length >= 4 && parts[3] !== '') { se = Number(parts[3]); if (!isFinite(se) || se < 0) { errors.push('Line ' + (i + 1) + ': se "' + parts[3] + '" must be ≥ 0'); continue; } }
        values.push({ trt, cid, mean, se });
      } else {
        errors.push('Line ' + (i + 1) + ': add a "CRITERIA:" or "VALUES:" header before this row');
      }
    }
    return { criteria, values, errors };
  }

  // Assemble the engine input {criteria, treatments} from parsed criteria+values.
  function assemble(criteria, values) {
    const trtIds = [];
    values.forEach(v => { if (trtIds.indexOf(v.trt) < 0) trtIds.push(v.trt); });
    const treatments = trtIds.map(id => ({ id, name: id, perf: {} }));
    const byId = Object.create(null); treatments.forEach(t => { byId[t.id] = t; });
    values.forEach(v => { const t = byId[v.trt]; if (t) t.perf[v.cid] = { mean: v.mean, se: v.se }; });
    return { criteria: criteria.map(c => ({ id: c.id, type: c.type, weight: c.weight })), treatments };
  }

  // ---- Result renderer (shared by auto + paste) ------------------------------
  function cell(label, value, sub) {
    return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
      + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
      + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
      + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
  }

  function renderResult(P, resultEl, r, header) {
    const fmt = P.fmt;
    if (!r || !r.ok) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + P.escapeHtml(r && r.error ? r.error : 'MCDA not computable on this input') + '</div>';
      return;
    }
    const top = r.smaa[0];
    const detTop = r.deterministic[0];
    let html = '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">' + (header || '')
      + r.smaa.length + ' treatments · ' + r.weightsNorm.length + ' criteria · ' + r.iterations + ' SMAA iters (seed ' + r.seed + ')</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px;">'
      + cell('Top by P(best)', P.escapeHtml(top.name), 'P(best) = ' + fmt(100 * top.pBest, 1) + '%')
      + cell('Top by mean value', P.escapeHtml(detTop.name), 'value = ' + fmt(detTop.value, 3))
      + cell('EVPI', fmt(r.evpi, 4), 'value of resolving uncertainty (≥0)')
      + '</div>';
    // SMAA rank-acceptability table.
    let rows = '';
    r.smaa.forEach(s => {
      rows += '<tr style="border-top:1px solid #1e293b;color:#e2e8f0;">'
        + '<td style="padding:3px 6px;color:#7dd3fc;">' + P.escapeHtml(s.name) + '</td>'
        + '<td style="padding:3px 6px;font-family:JetBrains Mono,monospace;text-align:right;">' + fmt(100 * s.pBest, 1) + '%</td>'
        + '<td style="padding:3px 6px;font-family:JetBrains Mono,monospace;text-align:right;">' + fmt(s.meanValue, 3) + '</td>'
        + '<td style="padding:3px 6px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(s.valueSE, 3) + '</td></tr>';
    });
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">'
      + '<thead><tr style="color:#94a3b8;text-transform:uppercase;font-size:9.5px;letter-spacing:0.04em;">'
      + '<th style="text-align:left;padding:3px 6px;">Treatment</th><th style="text-align:right;padding:3px 6px;">P(best)</th>'
      + '<th style="text-align:right;padding:3px 6px;">mean value</th><th style="text-align:right;padding:3px 6px;">value SE</th></tr></thead><tbody>'
      + rows + '</tbody></table>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:8px;">'
      + '<strong>Illustrative MCDA, no external validation.</strong> Probabilistic benefit-risk (SMAA; Tervonen 2011, ISPOR benefit-risk task force): '
      + 'criteria are mapped to [0,1] linear partial values, summed under EQUAL weights, and the treatment×criterion uncertainty is propagated by a '
      + 'seeded Monte-Carlo. Weights are value judgements and EVPI is on the value scale — no R/Python package validates this engine. '
      + 'A structured what-if, never an inferential claim.</div>';
    resultEl.innerHTML = html;
  }

  function compute(P, resultEl, text) {
    const parsed = parseInput(text);
    if (parsed.errors.length) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + parsed.errors.length + ' problem(s):<br>' + parsed.errors.map(P.escapeHtml).join('<br>') + '</div>';
      return;
    }
    if (parsed.criteria.length < 1 || (new Set(parsed.values.map(v => v.trt))).size < 2) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ Need ≥1 criterion and ≥2 treatments.</div>';
      return;
    }
    const input = assemble(parsed.criteria, parsed.values);
    let r; try { r = global.AlmBenefitRisk.analyze(input); }
    catch (e) { resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">Computation failed: ' + P.escapeHtml(String(e.message || e)) + '</div>'; return; }
    renderResult(P, resultEl, r, '');
  }

  // ---- AUTO-EXTRACTION from allOutcomes --------------------------------------
  // Heuristic harm-classifier from an outcome's title/label.
  function isHarm(o) {
    const s = ((o.title || '') + ' ' + (o.shortLabel || '')).toLowerCase();
    return /death|mortalit|adverse|harm|\bae\b|toxicit|serious|discontinu|withdraw|hospitali|relapse|event|exacerbat|bleed|infect/.test(s);
  }

  // Collect every distinct outcome (criterion) across the dashboard's trials and,
  // for each, the Intervention vs Comparator performance averaged over trials.
  // Prefers arm event proportions (tE/tN, cE/cN); else the relative effect
  // (intervention=effect, comparator=neutral ref 1) or the MD (intervention=md,
  // comparator=0). Returns { criteria, treatments, nOutcomes } or null.
  function extractFromOutcomes(P, rd) {
    if (!rd) return null;
    const acc = Object.create(null);   // cid -> { type, intv:[], comp:[], title }
    function add(cid, title, type, intv, comp) {
      if (!isFinite(intv) || !isFinite(comp)) return;
      if (!acc[cid]) acc[cid] = { type, intv: [], comp: [], title };
      acc[cid].intv.push(intv); acc[cid].comp.push(comp);
    }
    Object.values(rd).forEach(t => {
      if (!t) return;
      const ao = t.allOutcomes || (t.data && t.data.allOutcomes);
      if (!Array.isArray(ao)) return;
      const tN = Number(t.tN), cN = Number(t.cN);
      ao.forEach(o => {
        if (!o || !o.shortLabel) return;
        const cid = String(o.shortLabel), title = o.title || cid, type = isHarm(o) ? 'harm' : 'benefit';
        const tE = Number(o.tE), cE = Number(o.cE);
        if (isFinite(tE) && isFinite(cE) && tN > 0 && cN > 0) {           // arm event proportions
          add(cid, title, type, tE / tN, cE / cN);
        } else if (isFinite(Number(o.effect))) {                          // relative effect vs neutral ref
          add(cid, title, type, Number(o.effect), 1);
        } else if (isFinite(Number(o.md))) {                              // mean difference vs 0
          add(cid, title, type, Number(o.md), 0);
        }
      });
    });
    const cids = Object.keys(acc).filter(cid => acc[cid].intv.length > 0);
    if (cids.length < 2) return null;                                     // need ≥2 outcomes
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    const seOf = a => { if (a.length < 2) return undefined; const m = mean(a); let v = 0; a.forEach(x => { v += (x - m) * (x - m); }); return Math.sqrt(v / (a.length - 1)) / Math.sqrt(a.length); };
    const criteria = cids.map(cid => ({ id: cid, type: acc[cid].type, weight: 1 }));
    const intv = { id: 'Intervention', name: 'Intervention', perf: {} };
    const comp = { id: 'Comparator', name: 'Comparator', perf: {} };
    cids.forEach(cid => {
      intv.perf[cid] = { mean: mean(acc[cid].intv), se: seOf(acc[cid].intv) };
      comp.perf[cid] = { mean: mean(acc[cid].comp), se: seOf(acc[cid].comp) };
    });
    return { criteria, treatments: [intv, comp], nOutcomes: cids.length };
  }

  function autoAnalyze(P) {
    if (!global.AlmBenefitRisk) return null;
    const rd = P.getRealData();
    const ex = extractFromOutcomes(P, rd);
    if (!ex) return null;
    let r; try { r = global.AlmBenefitRisk.analyze({ criteria: ex.criteria, treatments: ex.treatments }); }
    catch (e) { return null; }
    if (!r || !r.ok || !isFinite(r.evpi)) return null;
    return { r, nOutcomes: ex.nOutcomes };
  }

  // ---- Paste-input node ------------------------------------------------------
  function buildPasteNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Probabilistic <strong>benefit-risk MCDA + EVPI</strong> (SMAA; ISPOR). Two blocks separated by a blank line — '
      + '<code style="color:#7dd3fc;">CRITERIA:</code> then <code style="color:#7dd3fc;">VALUES:</code>. Illustrative; computes only on your input.</div>';
    const fmtHint = document.createElement('div');
    fmtHint.style.cssText = 'font-size:10px;color:#94a3b8;margin-bottom:6px;';
    fmtHint.innerHTML = 'CRITERIA: <code style="color:#7dd3fc;">id, benefit|harm[, weight]</code> · VALUES: <code style="color:#7dd3fc;">treatment, criterionId, mean[, se]</code>';
    wrap.appendChild(fmtHint);
    const ta = document.createElement('textarea');
    ta.rows = 9;
    ta.placeholder = 'CRITERIA:\nefficacy, benefit, 1\nadverse, harm, 1\n\nVALUES:\nDrug A, efficacy, 0.62, 0.05\nDrug A, adverse, 0.18, 0.03\nDrug B, efficacy, 0.50, 0.05\nDrug B, adverse, 0.10, 0.02';
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:8px;resize:vertical;';
    wrap.appendChild(ta);
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin:8px 0;display:flex;gap:8px;';
    const example = document.createElement('button');
    example.type = 'button'; example.textContent = 'Load example';
    example.style.cssText = 'background:#0b1220;color:#94a3b8;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = 'Run benefit-risk MCDA';
    btn.style.cssText = 'background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    btnRow.appendChild(example); btnRow.appendChild(btn);
    wrap.appendChild(btnRow);
    const result = document.createElement('div'); result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Illustrative MCDA, no external validation.</strong> Linear partial value functions on each criterion (benefit higher-better, '
      + 'harm lower-better), equal-or-specified weights, seeded SMAA Monte-Carlo for rank-acceptability + EVPI. Weights are value judgements; '
      + 'no statistical package validates this engine — a structured what-if, not an inferential claim.';
    wrap.appendChild(note);
    const EXAMPLE = 'CRITERIA:\nefficacy, benefit, 1\nadverse, harm, 1\n\nVALUES:\nDrug A, efficacy, 0.62, 0.05\nDrug A, adverse, 0.18, 0.03\nDrug B, efficacy, 0.50, 0.05\nDrug B, adverse, 0.10, 0.02\nDrug C, efficacy, 0.70, 0.06\nDrug C, adverse, 0.30, 0.04';
    example.addEventListener('click', () => { ta.value = EXAMPLE; });
    btn.addEventListener('click', () => compute(P, result, ta.value));
    return wrap;
  }

  function buildPasteDetails(P) {
    const det = document.createElement('details');
    det.style.cssText = 'margin-top:10px;border-top:1px solid #1e293b;padding-top:8px;';
    const sum = document.createElement('summary');
    sum.textContent = 'or paste your own criteria + value matrix';
    sum.style.cssText = 'cursor:pointer;color:#7dd3fc;font-size:11px;';
    det.appendChild(sum);
    det.appendChild(buildPasteNode(P));
    return det;
  }

  function buildAutoNode(P, auto) {
    const wrap = document.createElement('div');
    const intro = document.createElement('div');
    intro.style.cssText = 'font-size:11px;color:#cbd5e1;margin-bottom:8px;';
    intro.innerHTML = 'Auto-derived from the trials\' <strong>' + auto.nOutcomes + ' registered outcomes</strong> as criteria '
      + '(equal weights), Intervention vs Comparator as treatments, with each arm\'s outcome value as the performance.';
    wrap.appendChild(intro);
    const result = document.createElement('div'); wrap.appendChild(result);
    renderResult(P, result, auto.r, '');
    wrap.appendChild(buildPasteDetails(P));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmBenefitRisk) return false;
    if (document.getElementById('benefit-risk-v1-panel')) return true;
    const auto = autoAnalyze(P);
    let summary, bodyNode;
    const EXP_BADGE = 'Benefit-risk MCDA + EVPI <span style="font-size:9px;background:#3a2a0a;color:#fbbf24;border:1px solid #92400e;border-radius:4px;padding:0 4px;margin-left:4px;">Experimental</span>';
    if (auto) {
      const top = auto.r.smaa[0];
      summary = 'Auto MCDA on ' + auto.nOutcomes + ' outcomes: ' + top.name + ' P(best) ' + P.fmt(100 * top.pBest, 0) + '% · EVPI ' + P.fmt(auto.r.evpi, 3) + ' (illustrative)';
      bodyNode = buildAutoNode(P, auto);
    } else {
      summary = 'Probabilistic benefit-risk MCDA + EVPI (SMAA, illustrative) — paste your own criteria + values';
      bodyNode = buildPasteNode(P);
    }
    const panel = P.buildCollapsiblePanel({
      id: 'benefit-risk-v1-panel', badge: EXP_BADGE, summary, bodyNode, storageKey: STORAGE_KEY,
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

  global.BenefitRiskV1Panel = { render, parseInput, assemble, extractFromOutcomes, autoAnalyze };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
