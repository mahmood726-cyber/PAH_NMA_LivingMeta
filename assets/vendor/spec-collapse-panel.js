/* spec-collapse-panel.js — correct inference for multiverse / many-analyst
 * meta-analysis (Spec-Collapse Atlas; weighted-likelihood aggregator).
 *
 * Engine: AlmSpecCollapse.buildSpecs / .weightedLikelihood / .naiveIvre (vendored
 * verbatim from allmeta/shared/spec-collapse.js; cross-checked vs the Python
 * engine tests/test_spec_collapse.py, validated vs metafor across 473 Cochrane
 * reviews).
 *
 * A multiverse MA runs MANY analytic specifications on ONE dataset. Inverse-
 * variance pooling those spec estimates as if they were independent studies
 * collapses the CI by ~the number of specs and MANUFACTURES robustness — the
 * cardinal sin (advanced-stats: "never IV-RE-pool many-analyst / multiverse
 * results"). The correct summary is the weighted-likelihood interval (a
 * t-mixture of the per-spec likelihoods), whose variance by the law of total
 * variance is within + between — never narrower than a single spec.
 *
 * AUTO-MOUNT: the dashboard's own effect set IS the dataset. The panel maps the
 * binary trials to per-study {est, se} log-OR rows, runs AlmSpecCollapse.buildSpecs
 * to GENERATE the full 36-spec multiverse (3 τ² estimators × 2 CI methods × 3
 * outlier rules × {raw, trim-fill}) on THIS data, then reports the corrected
 * weighted-likelihood summary against the naive IV-RE pool — showing how far the
 * naive CI collapses below the truth. Auto-mounts when k≥3. NEUTRAL surface — a
 * specification-robustness diagnostic. The paste-input (your own spec curve)
 * remains available as an "or paste your own data" fallback.
 *
 * Paste-input format (one spec per line):  estimate, se[, k]
 *   e.g.  -0.40, 0.1732, 8
 * "estimate" and "se" are one specification's pooled effect and its SE; the
 * optional "k" (number of primary studies, default 8) sets the t-mixture df.
 * Needs ≥2 specs.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'spec-collapse-panel-expanded';

  function parseRows(text) {
    const rows = [], errors = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (parts.length < 2) { errors.push('Line ' + (i + 1) + ': need estimate, se[, k]'); continue; }
      const est = Number(parts[0]), se = Number(parts[1]);
      let k = 8;
      if (parts.length >= 3 && parts[2] !== '') {
        k = Number(parts[2]);
        if (!isFinite(k) || k < 2 || Math.floor(k) !== k) { errors.push('Line ' + (i + 1) + ': k "' + parts[2] + '" must be an integer ≥ 2'); continue; }
      }
      if (!isFinite(est)) { errors.push('Line ' + (i + 1) + ': estimate "' + parts[0] + '" not numeric'); continue; }
      if (!isFinite(se) || se <= 0) { errors.push('Line ' + (i + 1) + ': se "' + parts[1] + '" must be > 0'); continue; }
      rows.push({ theta: est, var: se * se, k: k });
    }
    return { rows, errors };
  }

  // Per-study log-OR + se from the dashboard's binary trials, in the {est, se}
  // shape that AlmSpecCollapse.buildSpecs expects for its `studies` argument.
  function studyRows(trials) {
    return trials.map(t => {
      let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
      if (ai === 0 || ci === 0 || ai === n1 || ci === n2) { ai += 0.5; ci += 0.5; n1 += 1; n2 += 1; }
      const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
      return { est: Math.log((a * d) / (b * c)), se: Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d) };
    });
  }

  function cell(P, label, value, sub, tone) {
    const border = tone === 'bad' ? '#7f1d1d' : (tone === 'good' ? '#14532d' : '#1e293b');
    return '<div style="background:#0b1220;border:1px solid ' + border + ';border-radius:6px;padding:6px 8px;">'
      + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
      + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
      + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
  }

  // Render a weighted-likelihood (wl) vs naive IV-RE (nv) comparison into an
  // element, given the number of specs/sources. `header` prefixes the meta line.
  function renderResult(P, resultEl, wl, nv, nSpecs, header) {
    const fmt = P.fmt;
    const collapse = wl.var > 0 ? Math.sqrt(wl.var / nv.var) : NaN;
    const flip = nv.verdict === 'robust' && wl.verdict === 'fragile';
    resultEl.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">'
      + (header || '') + nSpecs + ' specifications · weighted-likelihood (correct) vs naive IV-RE pool (collapses)</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;">'
      + cell(P, 'Weighted-likelihood θ', fmt(wl.theta, 3), '95% CI ' + fmt(wl.ciLo, 3) + ' – ' + fmt(wl.ciHi, 3) + ' (' + wl.verdict + ')', wl.verdict === 'fragile' ? null : 'good')
      + cell(P, 'Total variance', fmt(wl.var, 4), 'within ' + fmt(wl.within, 4) + ' + between ' + fmt(wl.between, 4))
      + cell(P, 'Naive IV-RE pool θ', fmt(nv.theta, 3), '95% CI ' + fmt(nv.ciLo, 3) + ' – ' + fmt(nv.ciHi, 3) + ' (' + nv.verdict + ')', 'bad')
      + cell(P, 'CI collapse factor', isFinite(collapse) ? fmt(collapse, 1) + '×' : 'n/a', 'naive CI is ~this much too narrow', 'bad')
      + '</div>'
      + '<div style="font-size:10.5px;color:' + (flip ? '#fbbf24' : '#94a3b8') + ';margin-top:8px;line-height:1.5;">'
      + (flip
        ? '<strong>False robustness detected:</strong> the naive IV-RE pool reads <em>robust</em> but the correct weighted-likelihood interval is <em>fragile</em> — the apparent robustness is an artefact of pooling specs from one dataset.'
        : '<strong>Use the weighted-likelihood interval.</strong> The naive IV-RE pool is shown only to expose how far it collapses — never report it as the multiverse summary.')
      + '</div>';
  }

  function compute(P, resultEl, text) {
    const parsed = parseRows(text);
    if (parsed.errors.length) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + parsed.errors.length + ' problem(s):<br>' + parsed.errors.map(P.escapeHtml).join('<br>') + '</div>';
      return;
    }
    if (parsed.rows.length < 2) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">'
        + '⚠ Enter ≥2 specifications — a multiverse summary needs more than one spec.</div>';
      return;
    }
    let wl, nv;
    try {
      wl = global.AlmSpecCollapse.weightedLikelihood(parsed.rows);
      nv = global.AlmSpecCollapse.naiveIvre(parsed.rows);
    } catch (e) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">Computation failed: ' + P.escapeHtml(String(e.message || e)) + '</div>';
      return;
    }
    if (!wl || !isFinite(wl.ciLo) || !isFinite(wl.ciHi)) { resultEl.innerHTML = '<div style="color:#fca5a5;font-size:11px;">Weighted-likelihood interval did not invert on this input.</div>'; return; }
    renderResult(P, resultEl, wl, nv, parsed.rows.length, '');
  }

  // ---- AUTO-EXTRACTION: build the multiverse from THIS dashboard's data -------
  // Returns { specs, wl, nv, k } on success, or null when the precondition fails
  // (k<3, missing AlmMaCore/AlmTrimFill, or a non-invertible interval).
  function autoAggregate(P) {
    if (!global.AlmMaCore || !global.AlmTrimFill) return null; // buildSpecs deps
    const rd = P.getRealData();
    if (!rd) return null;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 3) return null;            // k >= 3
    const studies = studyRows(trials);
    let specs, wl, nv;
    try {
      specs = global.AlmSpecCollapse.buildSpecs(studies);
      if (!specs || specs.length < 2) return null;
      wl = global.AlmSpecCollapse.weightedLikelihood(specs);
      nv = global.AlmSpecCollapse.naiveIvre(specs);
    } catch (e) { return null; }
    if (!wl || !isFinite(wl.ciLo) || !isFinite(wl.ciHi) || !nv || !isFinite(nv.ciLo)) return null;
    return { specs, wl, nv, k: trials.length };
  }

  function buildPasteNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Multiverse / many-analyst summary — the <strong>weighted-likelihood</strong> aggregator that does NOT collapse the CI. '
      + 'Paste your spec curve: <code style="color:#7dd3fc;">estimate, se[, k]</code> (one specification per line). Computes only on your input.</div>';
    const fmtHint = document.createElement('div');
    fmtHint.style.cssText = 'font-size:10px;color:#94a3b8;margin-bottom:6px;';
    fmtHint.innerHTML = 'format: <code style="color:#7dd3fc;">estimate, se[, k]</code> — one spec per line; k (primary studies, default 8) sets the t-mixture df. ≥2 specs.';
    wrap.appendChild(fmtHint);
    const ta = document.createElement('textarea');
    ta.rows = 6;
    ta.placeholder = '-0.40, 0.1732, 8\n-0.25, 0.2236, 8\n-0.55, 0.2828, 6\n-0.18, 0.1414, 8';
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:8px;resize:vertical;';
    wrap.appendChild(ta);
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin:8px 0;display:flex;gap:8px;';
    const example = document.createElement('button');
    example.type = 'button';
    example.textContent = 'Load example';
    example.style.cssText = 'background:#0b1220;color:#94a3b8;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Aggregate multiverse';
    btn.style.cssText = 'background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    btnRow.appendChild(example); btnRow.appendChild(btn);
    wrap.appendChild(btnRow);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Weighted-likelihood multiverse aggregator (Spec-Collapse Atlas, validated vs metafor across 473 Cochrane reviews):</strong> '
      + 'the spec estimates come from ONE dataset, so they are NOT independent — IV-RE pooling them collapses the variance by ~the number of specs and '
      + 'manufactures robustness. The weighted-likelihood interval is a t-mixture of the per-spec likelihoods; its variance = within + between '
      + '(law of total variance) and is never narrower than a single spec. The naive pool is shown only to expose the collapse. '
      + 'Report the weighted-likelihood interval, never the naive pool. Needs ≥2 specs.';
    wrap.appendChild(note);
    // The python-anchor SPECS (theta,var,k) rendered as (estimate, se=sqrt(var), k):
    //   var 0.03->se 0.17320508, 0.05->0.2236068, 0.08->0.28284271, 0.02->0.14142136
    const EXAMPLE = '-0.40, 0.17320508, 8\n-0.25, 0.2236068, 8\n-0.55, 0.28284271, 6\n-0.18, 0.14142136, 8';
    example.addEventListener('click', () => { ta.value = EXAMPLE; });
    btn.addEventListener('click', () => compute(P, result, ta.value));
    return wrap;
  }

  function buildPasteDetails(P) {
    const det = document.createElement('details');
    det.style.cssText = 'margin-top:10px;border-top:1px solid #1e293b;padding-top:8px;';
    const sum = document.createElement('summary');
    sum.textContent = 'or paste your own spec curve (estimate, se[, k])';
    sum.style.cssText = 'cursor:pointer;color:#7dd3fc;font-size:11px;';
    det.appendChild(sum);
    det.appendChild(buildPasteNode(P));
    return det;
  }

  function buildAutoNode(P, auto) {
    const wrap = document.createElement('div');
    const intro = document.createElement('div');
    intro.style.cssText = 'font-size:11px;color:#cbd5e1;margin-bottom:8px;';
    intro.innerHTML = 'Auto-generated multiverse on this dashboard\'s <strong>' + auto.k + ' trials</strong> (log-OR): '
      + auto.specs.length + ' specifications across τ²-estimator × CI-method × outlier-rule × trim-fill. '
      + 'The corrected weighted-likelihood summary vs the naive IV-RE pool exposes the CI collapse.';
    wrap.appendChild(intro);
    const result = document.createElement('div');
    wrap.appendChild(result);
    renderResult(P, result, auto.wl, auto.nv, auto.specs.length, '');
    wrap.appendChild(buildPasteDetails(P));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmSpecCollapse) return false;
    if (document.getElementById('spec-collapse-panel')) return true;
    const auto = autoAggregate(P);
    let summary, bodyNode;
    if (auto) {
      const collapse = auto.wl.var > 0 ? Math.sqrt(auto.wl.var / auto.nv.var) : NaN;
      summary = 'Auto multiverse on ' + auto.k + ' trials (' + auto.specs.length + ' specs): naive CI collapses '
        + (isFinite(collapse) ? P.fmt(collapse, 1) + '×' : 'n/a') + ' vs weighted-likelihood';
      bodyNode = buildAutoNode(P, auto);
    } else {
      summary = 'Weighted-likelihood summary for multiverse / many-analyst MA (no CI collapse) — paste your own data';
      bodyNode = buildPasteNode(P);
    }
    const panel = P.buildCollapsiblePanel({
      id: 'spec-collapse-panel', badge: 'Multiverse spec-collapse aggregator',
      summary, bodyNode, storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1450));
    else setTimeout(tick, 1450);
  }

  global.SpecCollapsePanel = { render, parseRows, studyRows, autoAggregate };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
