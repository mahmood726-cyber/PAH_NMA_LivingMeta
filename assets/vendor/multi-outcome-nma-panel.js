/* multi-outcome-nma-panel.js — multivariate NMA over two correlated outcomes
 * (Achana et al. 2014).
 *
 * Engine: AlmMultiOutcomeNMA.fit (vendored verbatim from allmeta/shared/
 * multi-outcome-nma.js). A standard NMA analyses one outcome at a time; when two
 * outcomes are correlated, jointly modelling them borrows strength across the
 * outcomes (and across the multi-arm structure). The combined random-effects
 * covariance is Σ_RE^outcomes ⊗ G_arm (G_arm = 1 on the diagonal, ½ off — the
 * multi-arm contrast structure); Σ_RE^outcomes is seeded by per-outcome DL + the
 * sample correlation of residuals, then β is solved by GLS.
 *
 * AUTO-MOUNT: requires an NMA dashboard (NMA_CONFIG) AND ≥2 outcomes. The panel
 * builds per-study contrast rows from NMA_CONFIG.comparisons → realData, taking
 * outcome 1 from each trial's primary log-OR and outcome 2 from a second registered
 * outcome (allOutcomes), and fits the joint model with an ASSUMED within-study
 * cross-outcome correlation (default 0.5, editable). Auto-mounts only when both
 * preconditions hold; otherwise the manual paste-input is shown. The paste-input
 * remains an "or paste your own data" fallback.
 *
 * EXPERIMENTAL (no R oracle) — a non-iterative analytic approximation; for complex
 * multi-arm × multi-outcome networks use a full Bayesian WinBUGS fit.
 *
 * Paste-input format (one contrast per line):  study, trtA, trtB, y1, se1, y2, se2
 *   e.g.  S1, A, B, -0.40, 0.12, -0.50, 0.15
 * Rows sharing a study id are treated as a multi-arm study. NA for an unreported
 * outcome on a row. Needs ≥2 treatments.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'multi-outcome-nma-panel-expanded';
  const DEFAULT_RHO = 0.5;

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
      if (parts.length < 7) { errors.push('Line ' + (i + 1) + ': need study, trtA, trtB, y1, se1, y2, se2'); continue; }
      const study = parts[0], a = parts[1], b = parts[2];
      const y1 = _num(parts[3]), s1 = _num(parts[4]), y2 = _num(parts[5]), s2 = _num(parts[6]);
      if (!study) { errors.push('Line ' + (i + 1) + ': empty study id'); continue; }
      if (!a || !b) { errors.push('Line ' + (i + 1) + ': empty treatment label'); continue; }
      if (a === b) { errors.push('Line ' + (i + 1) + ': trtA and trtB must differ'); continue; }
      const has1 = isFinite(y1) && isFinite(s1), has2 = isFinite(y2) && isFinite(s2);
      if (!has1 && !has2) { errors.push('Line ' + (i + 1) + ': no complete (y, se) pair for either outcome'); continue; }
      if (isFinite(s1) && s1 <= 0) { errors.push('Line ' + (i + 1) + ': se1 must be > 0'); continue; }
      if (isFinite(s2) && s2 <= 0) { errors.push('Line ' + (i + 1) + ': se2 must be > 0'); continue; }
      rows.push({ study, trtA: a, trtB: b, o1: has1 ? { yi: y1, sei: s1 } : null, o2: has2 ? { yi: y2, sei: s2 } : null });
    }
    return { rows, errors };
  }

  function _build(rows) {
    const treatments = [];
    rows.forEach(r => { [r.trtA, r.trtB].forEach(t => { if (treatments.indexOf(t) < 0) treatments.push(t); }); });
    const byStudy = Object.create(null), order = [];
    rows.forEach(r => { if (!byStudy[r.study]) { byStudy[r.study] = []; order.push(r.study); } byStudy[r.study].push(r); });
    const studies = order.map(id => ({
      id,
      contrasts: byStudy[id].map(r => ({
        trtA: r.trtA, trtB: r.trtB,
        outcomes: [r.o1 || { yi: NaN, sei: NaN }, r.o2 || { yi: NaN, sei: NaN }],
      })),
    }));
    return { treatments, studies };
  }

  // ---- Result renderer (shared) ----------------------------------------------
  function renderFit(P, resultEl, f, header) {
    const fmt = P.fmt;
    if (!f || !f.ok) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + P.escapeHtml(f && f.error ? f.error : 'multi-outcome NMA not identifiable on this input') + '</div>';
      return;
    }
    const ref = f.reference;
    function leagueTable(o) {
      let t = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:4px;">'
        + '<tr style="color:#94a3b8;text-align:left;"><th style="padding:3px 6px;">vs ' + P.escapeHtml(ref) + '</th><th style="padding:3px 6px;">Effect</th><th style="padding:3px 6px;">SE</th><th style="padding:3px 6px;">95% CI</th></tr>';
      f.treatments.forEach(tr => {
        if (tr === ref) return;
        const e = f.effects[o][tr];
        t += '<tr style="border-top:1px solid #1e293b;color:#e2e8f0;font-family:JetBrains Mono,monospace;">'
          + '<td style="padding:3px 6px;color:#7dd3fc;">' + P.escapeHtml(tr) + '</td>'
          + '<td style="padding:3px 6px;">' + fmt(e.estimate, 3) + '</td>'
          + '<td style="padding:3px 6px;">' + fmt(e.se, 3) + '</td>'
          + '<td style="padding:3px 6px;color:#94a3b8;">' + fmt(e.ci_lo, 2) + ' – ' + fmt(e.ci_hi, 2) + '</td></tr>';
      });
      return t + '</table>';
    }
    const sig = f.Sigma_RE_outcomes;
    const tau1 = Math.sqrt(Math.max(0, sig[0][0])), tau2 = Math.sqrt(Math.max(0, sig[1][1]));
    const rho = (tau1 > 0 && tau2 > 0) ? sig[0][1] / (tau1 * tau2) : 0;
    resultEl.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">' + (header || '')
      + f.n_studies + ' studies · ' + f.n_contrasts + ' contrasts · ' + f.treatments.length + ' treatments · '
      + 'between-study τ = (' + fmt(tau1, 3) + ', ' + fmt(tau2, 3) + ') · outcome ρ = ' + fmt(rho, 3) + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin:6px 0 2px;">Outcome 1 league</div>' + leagueTable(0)
      + '<div style="font-size:10px;color:#94a3b8;margin:8px 0 2px;">Outcome 2 league</div>' + leagueTable(1);
  }

  function compute(P, resultEl, text, rhoWithin) {
    const parsed = parseRows(text);
    if (parsed.errors.length) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + parsed.errors.length + ' problem(s):<br>' + parsed.errors.map(P.escapeHtml).join('<br>') + '</div>';
      return;
    }
    const built = _build(parsed.rows);
    if (built.treatments.length < 2) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ Need ≥2 treatments in the network.</div>';
      return;
    }
    let f;
    try { f = global.AlmMultiOutcomeNMA.fit(built.studies, built.treatments, { K: 2, rhoWithin: isFinite(rhoWithin) ? rhoWithin : DEFAULT_RHO }); }
    catch (e) { resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ ' + P.escapeHtml(String(e.message || e)) + '</div>'; return; }
    renderFit(P, resultEl, f, '');
  }

  // ---- AUTO-EXTRACTION from NMA_CONFIG + allOutcomes -------------------------
  // Outcome-2 (yi, sei) from a registered non-primary outcome of a trial.
  function outcome2(t) {
    const ao = t.allOutcomes || (t.data && t.data.allOutcomes);
    if (!Array.isArray(ao)) return null;
    for (let i = 0; i < ao.length; i++) {
      const o = ao[i];
      if (!o) continue;
      const tE = Number(o.tE), cE = Number(o.cE), tN = Number(t.tN), cN = Number(t.cN);
      if (isFinite(tE) && isFinite(cE) && tN > 0 && cN > 0 && tE >= 0 && cE >= 0) {  // binary arm counts -> logOR
        let a = tE, c = cE, n1 = tN, n2 = cN;
        if (a === 0 || c === 0 || a === n1 || c === n2) { a += 0.5; c += 0.5; n1 += 1; n2 += 1; }
        const b = n1 - a, d = n2 - c;
        return { yi: Math.log((a * d) / (b * c)), sei: Math.sqrt(1 / a + 1 / (n1 - a) + 1 / c + 1 / (n2 - c)) };
      }
      const eff = Number(o.effect), lci = Number(o.lci), uci = Number(o.uci);
      if (isFinite(eff) && eff > 0 && isFinite(lci) && isFinite(uci) && lci > 0 && uci > 0) { // ratio effect -> log scale
        return { yi: Math.log(eff), sei: (Math.log(uci) - Math.log(lci)) / (2 * 1.959963984540054) };
      }
      const md = Number(o.md), se = Number(o.se);
      if (isFinite(md) && isFinite(se) && se > 0) return { yi: md, sei: se };  // MD
    }
    return null;
  }

  // Outcome-1 (yi, sei) from the trial's primary binary contrast (logOR).
  function outcome1(t) {
    let tE = Number(t.tE), tN = Number(t.tN), cE = Number(t.cE), cN = Number(t.cN);
    if (!(isFinite(tE) && isFinite(tN) && isFinite(cE) && isFinite(cN) && tN > 0 && cN > 0)) return null;
    if (tE === 0 || cE === 0 || tE === tN || cE === cN) { tE += 0.5; tN += 1; cE += 0.5; cN += 1; }
    const a = tE, b = tN - tE, c = cE, d = cN - cE;
    if (!(a > 0 && b > 0 && c > 0 && d > 0)) return null;
    return { yi: Math.log((a * d) / (b * c)), sei: Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d) };
  }

  // Build engine `studies` from NMA_CONFIG.comparisons. Returns { studies,
  // treatments } or null when <2 trials carry BOTH outcomes.
  function buildAutoStudies(cfg, rd) {
    const studies = [], treatments = (cfg.treatments || []).slice();
    let nBoth = 0;
    (cfg.comparisons || []).forEach(cmp => {
      (cmp.trials || []).forEach(nct => {
        const t = rd[nct];
        if (!t) return;
        const o1 = outcome1(t), o2 = outcome2(t);
        if (!o1 && !o2) return;
        if (o1 && o2) nBoth++;
        studies.push({
          id: nct,
          contrasts: [{ trtA: cmp.t1, trtB: cmp.t2, outcomes: [o1 || { yi: NaN, sei: NaN }, o2 || { yi: NaN, sei: NaN }] }],
        });
      });
    });
    if (nBoth < 2 || treatments.length < 2 || studies.length < 2) return null;
    return { studies, treatments };
  }

  function autoFit(P, rhoWithin) {
    if (!P.isNMA || !P.isNMA()) return null;       // NMA dashboard required
    const cfg = global.NMA_CONFIG, rd = P.getRealData();
    if (!cfg || !rd) return null;
    const built = buildAutoStudies(cfg, rd);
    if (!built) return null;                        // need ≥2 outcomes across ≥2 trials
    let f;
    try { f = global.AlmMultiOutcomeNMA.fit(built.studies, built.treatments, { K: 2, rhoWithin: isFinite(rhoWithin) ? rhoWithin : DEFAULT_RHO }); }
    catch (e) { return null; }
    if (!f || !f.ok) return null;
    return { f, built };
  }

  // ---- Paste-input node ------------------------------------------------------
  function buildPasteNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Multivariate NMA over <strong>two correlated outcomes</strong> (Achana 2014) — joint modelling borrows strength across outcomes. '
      + 'Paste contrasts: <code style="color:#7dd3fc;">study, trtA, trtB, y1, se1, y2, se2</code>. Computes only on your input.</div>';
    const fmtHint = document.createElement('div');
    fmtHint.style.cssText = 'font-size:10px;color:#94a3b8;margin-bottom:6px;';
    fmtHint.innerHTML = 'format: <code style="color:#7dd3fc;">study, trtA, trtB, y1, se1, y2, se2</code> — one contrast per line; rows sharing a study id form a multi-arm study; NA for an unreported outcome.';
    wrap.appendChild(fmtHint);
    const ta = document.createElement('textarea');
    ta.rows = 6;
    ta.placeholder = 'S1, A, B, -0.40, 0.12, -0.50, 0.15\nS2, A, C, -0.55, 0.16, -0.62, 0.18\nS3, B, C, -0.20, 0.18, -0.25, 0.20\nS4, A, B, -0.30, 0.14, -0.38, 0.16';
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:8px;resize:vertical;';
    wrap.appendChild(ta);
    // assumed within-study cross-outcome correlation input
    const rhoRow = document.createElement('div');
    rhoRow.style.cssText = 'margin:8px 0;font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:6px;';
    rhoRow.innerHTML = 'Assumed within-study cross-outcome ρ: ';
    const rhoIn = document.createElement('input');
    rhoIn.type = 'number'; rhoIn.value = String(DEFAULT_RHO); rhoIn.step = '0.05'; rhoIn.min = '-0.95'; rhoIn.max = '0.95';
    rhoIn.style.cssText = 'width:70px;background:#0b1220;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:3px 6px;';
    rhoRow.appendChild(rhoIn);
    wrap.appendChild(rhoRow);
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin:8px 0;display:flex;gap:8px;';
    const example = document.createElement('button');
    example.type = 'button'; example.textContent = 'Load example';
    example.style.cssText = 'background:#0b1220;color:#94a3b8;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = 'Fit multi-outcome NMA';
    btn.style.cssText = 'background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    btnRow.appendChild(example); btnRow.appendChild(btn);
    wrap.appendChild(btnRow);
    const result = document.createElement('div'); result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Multi-outcome NMA (Achana 2014 §3.2) — Experimental, no R oracle:</strong> the combined random-effects covariance is '
      + 'Σ_RE^outcomes ⊗ G_arm, where G_arm carries the multi-arm shared-control ½ off-diagonal and Σ_RE^outcomes the between-study correlation across '
      + 'the two outcomes; β is solved by GLS. Σ_RE^outcomes is seeded by per-outcome DL + the sample correlation of residuals (a non-iterative analytic '
      + 'approximation; for complex multi-arm × multi-outcome networks use a full Bayesian WinBUGS fit). The within-study cross-outcome correlation is an '
      + 'ASSUMPTION (default 0.5). When the outcome correlation vanishes each outcome\'s league reduces to the single-outcome NMA. Needs a connected '
      + 'network of ≥2 treatments.';
    wrap.appendChild(note);
    const EXAMPLE = 'S1, A, B, -0.40, 0.12, -0.50, 0.15\nS2, A, C, -0.55, 0.16, -0.62, 0.18\nS3, B, C, -0.20, 0.18, -0.25, 0.20\nS4, A, B, -0.30, 0.14, -0.38, 0.16';
    example.addEventListener('click', () => { ta.value = EXAMPLE; });
    btn.addEventListener('click', () => compute(P, result, ta.value, Number(rhoIn.value)));
    return wrap;
  }

  function buildPasteDetails(P) {
    const det = document.createElement('details');
    det.style.cssText = 'margin-top:10px;border-top:1px solid #1e293b;padding-top:8px;';
    const sum = document.createElement('summary');
    sum.textContent = 'or paste your own (study, trtA, trtB, y1, se1, y2, se2) data';
    sum.style.cssText = 'cursor:pointer;color:#7dd3fc;font-size:11px;';
    det.appendChild(sum);
    det.appendChild(buildPasteNode(P));
    return det;
  }

  function buildAutoNode(P, auto) {
    const wrap = document.createElement('div');
    const intro = document.createElement('div');
    intro.style.cssText = 'font-size:11px;color:#cbd5e1;margin-bottom:8px;';
    intro.innerHTML = 'Auto-derived from the NMA network: outcome 1 = each trial\'s primary log-OR, outcome 2 = a second registered '
      + 'outcome, jointly modelled with an assumed within-study cross-outcome ρ.';
    wrap.appendChild(intro);
    // editable rho input drives a re-fit.
    const rhoRow = document.createElement('div');
    rhoRow.style.cssText = 'margin:6px 0;font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:6px;';
    rhoRow.innerHTML = 'Assumed within-study cross-outcome ρ: ';
    const rhoIn = document.createElement('input');
    rhoIn.type = 'number'; rhoIn.value = String(DEFAULT_RHO); rhoIn.step = '0.05'; rhoIn.min = '-0.95'; rhoIn.max = '0.95';
    rhoIn.style.cssText = 'width:70px;background:#0b1220;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:3px 6px;';
    rhoRow.appendChild(rhoIn);
    wrap.appendChild(rhoRow);
    const result = document.createElement('div'); wrap.appendChild(result);
    renderFit(P, result, auto.f, '');
    rhoIn.addEventListener('change', () => {
      const re = autoFit(P, Number(rhoIn.value));
      if (re) renderFit(P, result, re.f, '');
    });
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Multi-outcome NMA (Achana 2014) — Experimental, no R oracle.</strong> Joint Σ_RE^outcomes ⊗ G_arm covariance; the '
      + 'within-study cross-outcome correlation is an ASSUMPTION (default 0.5, editable above). A non-iterative analytic approximation — '
      + 'for complex multi-arm × multi-outcome networks use a full Bayesian fit.';
    wrap.appendChild(note);
    wrap.appendChild(buildPasteDetails(P));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmMultiOutcomeNMA) return false;
    if (document.getElementById('multi-outcome-nma-panel')) return true;
    const auto = autoFit(P, DEFAULT_RHO);
    let summary, bodyNode;
    const EXP_BADGE = 'Multi-outcome NMA (Achana) <span style="font-size:9px;background:#3a2a0a;color:#fbbf24;border:1px solid #92400e;border-radius:4px;padding:0 4px;margin-left:4px;">Experimental</span>';
    if (auto) {
      summary = 'Auto multi-outcome NMA on ' + auto.f.n_studies + ' studies / ' + auto.f.treatments.length + ' treatments (assumed ρ ' + DEFAULT_RHO + ')';
      bodyNode = buildAutoNode(P, auto);
    } else {
      summary = 'Multivariate NMA over two correlated outcomes (Achana 2014) — paste your own data';
      bodyNode = buildPasteNode(P);
    }
    const panel = P.buildCollapsiblePanel({
      id: 'multi-outcome-nma-panel', badge: EXP_BADGE, summary, bodyNode, storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1550));
    else setTimeout(tick, 1550);
  }

  global.MultiOutcomeNMAPanel = { render, parseRows, outcome1, outcome2, buildAutoStudies, autoFit };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
