/* cnma-receptor-panel.js — additive component network meta-analysis (CNMA;
 * Welton 2009 / Rücker, netmeta::discomb), paste-input tool.
 *
 * Engine: AlmCnmaReceptor.cnmaWls (vendored verbatim from
 * allmeta/shared/cnma-receptor.js, oracle-gated vs netmeta::discomb to 1e-6 on
 * the cnma-tiny fixture). Standard NMA estimates a separate effect for every
 * treatment; an additive CNMA decomposes each treatment into the sum of its
 * COMPONENTS' effects (β), so combinations that were never directly trialled can
 * be predicted from their parts. β = (XᵀWX)⁻¹XᵀW·TE; Q is the additive WLS
 * residual deviance.
 *
 * The kit carries no component design, so this is a PASTE-INPUT tool. It NEVER
 * reads or fabricates dashboard data — computes only on explicit user input.
 *
 * Input format (one contrast per line):  combo, TE, seTE
 *   e.g.  a+b, -0.65, 0.13
 * "combo" is the treatment vs the (component-empty) control, written as a
 * "+"-joined list of the components it contains. The component SET is inferred
 * from the union of names across rows — the treatments→components matrix. A
 * single component is just its own name ("a, -0.40, 0.12"). Needs at least as
 * many contrast rows as distinct components (k ≥ p) for identifiability.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'cnma-receptor-panel-expanded';

  function parseRows(text) {
    const rows = [], errors = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (parts.length < 3) { errors.push('Line ' + (i + 1) + ': need combo, TE, seTE'); continue; }
      const combo = parts[0], te = Number(parts[1]), se = Number(parts[2]);
      if (!combo) { errors.push('Line ' + (i + 1) + ': empty combo'); continue; }
      const comps = combo.split('+').map(s => s.trim()).filter(Boolean);
      if (!comps.length) { errors.push('Line ' + (i + 1) + ': combo "' + parts[0] + '" has no components'); continue; }
      if (!isFinite(te)) { errors.push('Line ' + (i + 1) + ': TE "' + parts[1] + '" not numeric'); continue; }
      if (!isFinite(se) || se <= 0) { errors.push('Line ' + (i + 1) + ': seTE "' + parts[2] + '" must be > 0'); continue; }
      rows.push({ combo, comps, te, se });
    }
    return { rows, errors };
  }

  function _components(rows) {
    const seen = [];
    rows.forEach(r => r.comps.forEach(c => { if (seen.indexOf(c) < 0) seen.push(c); }));
    return seen;
  }

  function compute(P, resultEl, text) {
    const fmt = P.fmt;
    const parsed = parseRows(text);
    if (parsed.errors.length) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">⚠ '
        + parsed.errors.length + ' problem(s):<br>' + parsed.errors.map(P.escapeHtml).join('<br>') + '</div>';
      return;
    }
    const comps = _components(parsed.rows);
    if (parsed.rows.length < comps.length) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">'
        + '⚠ ' + parsed.rows.length + ' contrasts but ' + comps.length + ' components (' + P.escapeHtml(comps.join(', '))
        + ') — need k ≥ p contrasts to identify all component effects.</div>';
      return;
    }
    const X = parsed.rows.map(r => comps.map(c => (r.comps.indexOf(c) >= 0 ? 1 : 0)));
    const TE = parsed.rows.map(r => r.te);
    const se = parsed.rows.map(r => r.se);
    let f;
    try { f = global.AlmCnmaReceptor.cnmaWls(X, TE, se); }
    catch (e) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">'
        + P.escapeHtml(String(e.message || e)) + '</div>';
      return;
    }
    if (!f || !f.beta.every(isFinite)) { resultEl.innerHTML = '<div style="color:#fca5a5;font-size:11px;">WLS failed on this input.</div>'; return; }
    const zc = 1.959963984540054;
    let body = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:4px;">'
      + '<tr style="color:#94a3b8;text-align:left;"><th style="padding:3px 6px;">Component</th><th style="padding:3px 6px;">Effect β</th><th style="padding:3px 6px;">SE</th><th style="padding:3px 6px;">95% CI</th></tr>';
    comps.forEach((c, j) => {
      body += '<tr style="border-top:1px solid #1e293b;color:#e2e8f0;font-family:JetBrains Mono,monospace;">'
        + '<td style="padding:3px 6px;color:#7dd3fc;">' + P.escapeHtml(c) + '</td>'
        + '<td style="padding:3px 6px;">' + fmt(f.beta[j], 3) + '</td>'
        + '<td style="padding:3px 6px;">' + fmt(f.se[j], 3) + '</td>'
        + '<td style="padding:3px 6px;color:#94a3b8;">' + fmt(f.beta[j] - zc * f.se[j], 3) + ' – ' + fmt(f.beta[j] + zc * f.se[j], 3) + '</td></tr>';
    });
    body += '</table>';
    // full-combination prediction (all components additively)
    let predNote = '';
    try {
      const all = global.AlmCnmaReceptor.predict(comps, comps, f.beta, f.cov);
      predNote = '<div style="font-size:10.5px;color:#94a3b8;margin-top:6px;">Predicted all-components combination ('
        + P.escapeHtml(comps.join('+')) + '): <strong>' + fmt(all.est, 3) + '</strong> (SE ' + fmt(all.se, 3) + ').</div>';
    } catch (e) { /* prediction optional */ }
    const qNote = f.Q > f.df
      ? '<span style="color:#fbbf24;">Q = ' + fmt(f.Q, 3) + ' > df = ' + f.df + ' → component additivity is approximate (between-treatment heterogeneity).</span>'
      : '<span>Q = ' + fmt(f.Q, 3) + ' ≤ df = ' + f.df + ' → consistent with strict additivity.</span>';
    resultEl.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">'
      + parsed.rows.length + ' contrasts · ' + comps.length + ' components · additive common-effect CNMA</div>'
      + body + predNote
      + '<div style="font-size:10.5px;color:#94a3b8;margin-top:6px;">' + qNote + '</div>';
  }

  function buildNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Additive <strong>component NMA</strong> — decompose treatments into their components’ effects (Rücker discomb). '
      + '<strong>Requires a component map</strong> (which components each treatment contains) — not derivable from the kit\'s effect set, so this is a '
      + 'paste-input tool. Paste contrasts vs control: <code style="color:#7dd3fc;">combo, TE, seTE</code> where combo is a "+"-joined component list. Computes only on your input.</div>';
    const fmtHint = document.createElement('div');
    fmtHint.style.cssText = 'font-size:10px;color:#94a3b8;margin-bottom:6px;';
    fmtHint.innerHTML = 'format: <code style="color:#7dd3fc;">combo, TE, seTE</code> — e.g. <code style="color:#7dd3fc;">a+b, -0.65, 0.13</code>. Components inferred from the "+"-joined labels (the treatments→components matrix). Need k ≥ p rows.';
    wrap.appendChild(fmtHint);
    const ta = document.createElement('textarea');
    ta.rows = 7;
    ta.placeholder = 'a, -0.40, 0.12\nb, -0.30, 0.15\na+b, -0.65, 0.13\na+c, -0.55, 0.16\nc, -0.20, 0.18\nb+c, -0.45, 0.14\na+b+c, -0.80, 0.20';
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
    btn.textContent = 'Fit additive CNMA';
    btn.style.cssText = 'background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    btnRow.appendChild(example); btnRow.appendChild(btn);
    wrap.appendChild(btnRow);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Additive component NMA (Welton 2009; Rücker netmeta::discomb):</strong> each treatment is the additive sum of its '
      + 'component effects β, fitted by weighted least squares (β = (XᵀWX)⁻¹XᵀW·TE; W = 1/seTE²). Lets you predict combinations that were never '
      + 'directly trialled from their parts. The additive Q measures how well strict additivity fits — Q ≫ df flags component interactions / '
      + 'between-treatment heterogeneity, so read direction + magnitude, not pharmacological constants. Common-effect closed form (= discomb when τ²=0).';
    wrap.appendChild(note);
    // cnma-tiny worked example (the engine's own netmeta::discomb oracle).
    const EXAMPLE = 'a, -0.40, 0.12\nb, -0.30, 0.15\na+b, -0.65, 0.13\na+c, -0.55, 0.16\nc, -0.20, 0.18\nb+c, -0.45, 0.14\na+b+c, -0.80, 0.20';
    example.addEventListener('click', () => { ta.value = EXAMPLE; });
    btn.addEventListener('click', () => compute(P, result, ta.value));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmCnmaReceptor) return false;
    if (document.getElementById('cnma-receptor-panel')) return true;
    const panel = P.buildCollapsiblePanel({
      id: 'cnma-receptor-panel', badge: 'Additive component NMA (CNMA) <span style="font-size:9px;background:#3a2a0a;color:#fbbf24;border:1px solid #92400e;border-radius:4px;padding:0 4px;margin-left:4px;">Experimental</span>',
      summary: 'Decompose treatments into additive component effects (Rücker discomb) — requires a component map; paste-input tool',
      bodyNode: buildNode(P), storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1400));
    else setTimeout(tick, 1400);
  }

  global.CnmaReceptorPanel = { render, parseRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
