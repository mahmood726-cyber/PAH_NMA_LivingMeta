/* cross-network-synthesis-panel.js — combine RCT, IPD and observational evidence
 * under a bias-corrected synthesis (paste-input tool).
 *
 * Engine: AlmCrossNetwork.fit (vendored verbatim from allmeta/shared/
 * cross-network-synthesis.js). Three evidence streams enter per contrast: RCTs
 * (the anchor; design-bias δ = 0), IPD trial-level summaries, and observational
 * studies (which typically deviate from the RCT truth). Per contrast the engine
 * pools the RCTs (DL τ²), estimates each non-RCT stream's design-bias offset δ and
 * its between-study bias variance σ²_bias by method of moments on residuals vs the
 * anchor, then forms a bias-CORRECTED synthesis: each non-RCT observation enters at
 * yᵢ − δ with variance vᵢ + τ²_RCT + σ²_bias.
 *
 * The kit carries no multi-design evidence list, so this is a PASTE-INPUT tool. It
 * NEVER reads or fabricates dashboard data — computes only on explicit user input.
 *
 * Input format (one estimate per line):  contrast, design, yi, sei
 *   e.g.  A_vs_B, rct, -0.40, 0.12
 * "design" is one of rct | ipd | obs (case-insensitive). Each contrast needs ≥1
 * RCT row to anchor the synthesis; without it the contrast falls back to a naive
 * pool (flagged in a warning). Effects are on the analysis scale (log for ratios).
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'cross-network-synthesis-panel-expanded';
  const DESIGNS = { rct: 1, ipd: 1, obs: 1 };

  function parseRows(text) {
    const rows = [], errors = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (parts.length < 4) { errors.push('Line ' + (i + 1) + ': need contrast, design, yi, sei'); continue; }
      const contrast = parts[0], design = (parts[1] || '').toLowerCase(), yi = Number(parts[2]), se = Number(parts[3]);
      if (!contrast) { errors.push('Line ' + (i + 1) + ': empty contrast'); continue; }
      if (!DESIGNS[design]) { errors.push('Line ' + (i + 1) + ': design "' + parts[1] + '" must be rct, ipd or obs'); continue; }
      if (!isFinite(yi)) { errors.push('Line ' + (i + 1) + ': yi "' + parts[2] + '" not numeric'); continue; }
      if (!isFinite(se) || se <= 0) { errors.push('Line ' + (i + 1) + ': sei "' + parts[3] + '" must be > 0'); continue; }
      rows.push({ contrast, design, yi, vi: se * se });
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
    if (!parsed.rows.length) { resultEl.innerHTML = '<div style="color:#94a3b8;font-size:11px;">Enter at least one estimate.</div>'; return; }
    let f;
    try { f = global.AlmCrossNetwork.fit(parsed.rows); }
    catch (e) { resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">Computation failed: ' + P.escapeHtml(String(e.message || e)) + '</div>'; return; }
    if (!f || !f.ok) { resultEl.innerHTML = '<div style="color:#fca5a5;font-size:11px;">Synthesis failed on this input.</div>'; return; }
    let tbl = '<table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-top:4px;">'
      + '<tr style="color:#94a3b8;text-align:left;"><th style="padding:3px 5px;">Contrast</th><th style="padding:3px 5px;">RCT anchor</th>'
      + '<th style="padding:3px 5px;">Synthesis [95% CI]</th><th style="padding:3px 5px;">δ_IPD</th><th style="padding:3px 5px;">δ_obs</th><th style="padding:3px 5px;">k (r/i/o)</th></tr>';
    Object.keys(f.contrasts).forEach(cn => {
      const c = f.contrasts[cn];
      tbl += '<tr style="border-top:1px solid #1e293b;color:#e2e8f0;font-family:JetBrains Mono,monospace;">'
        + '<td style="padding:3px 5px;color:#7dd3fc;">' + P.escapeHtml(cn) + '</td>'
        + '<td style="padding:3px 5px;">' + (isFinite(c.mu_anchor) ? fmt(c.mu_anchor, 3) : '–') + '</td>'
        + '<td style="padding:3px 5px;">' + (isFinite(c.mu_synthesis) ? fmt(c.mu_synthesis, 3) + ' [' + fmt(c.ci_lo, 2) + ',' + fmt(c.ci_hi, 2) + ']' : '–') + '</td>'
        + '<td style="padding:3px 5px;color:#94a3b8;">' + (c.k_ipd ? fmt(c.delta_ipd, 3) : '–') + '</td>'
        + '<td style="padding:3px 5px;color:#94a3b8;">' + (c.k_obs ? fmt(c.delta_obs, 3) : '–') + '</td>'
        + '<td style="padding:3px 5px;color:#94a3b8;">' + c.k_rct + '/' + c.k_ipd + '/' + c.k_obs + '</td></tr>';
    });
    tbl += '</table>';
    let warn = '';
    if (f.warnings && f.warnings.length) {
      warn = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:6px 8px;border-radius:6px;font-size:10.5px;margin-top:6px;">⚠ '
        + f.warnings.map(P.escapeHtml).join('<br>') + '</div>';
    }
    resultEl.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">'
      + f.n_contrasts + ' contrast(s) · ' + f.n_rows + ' estimates · RCT-anchored bias-corrected synthesis</div>'
      + tbl + warn
      + '<div style="font-size:10.5px;color:#94a3b8;margin-top:6px;">δ is each non-RCT stream’s estimated design-bias vs the RCT anchor; the synthesis enters those streams at yᵢ − δ with an inflated variance. With RCT rows only the synthesis equals the anchor.</div>';
  }

  function buildNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Combine <strong>RCT + IPD + observational</strong> evidence under a bias-corrected synthesis (GetReal / Efthimiou 2017). '
      + '<strong>Requires IPD and/or observational evidence streams</strong> alongside the RCT anchor — the kit ships only the RCT effect set, so this is a '
      + 'paste-input tool. Paste estimates: <code style="color:#7dd3fc;">contrast, design, yi, sei</code> (design = rct | ipd | obs). Computes only on your input.</div>';
    const fmtHint = document.createElement('div');
    fmtHint.style.cssText = 'font-size:10px;color:#94a3b8;margin-bottom:6px;';
    fmtHint.innerHTML = 'format: <code style="color:#7dd3fc;">contrast, design, yi, sei</code> — design is rct, ipd or obs; each contrast needs ≥1 rct row to anchor.';
    wrap.appendChild(fmtHint);
    const ta = document.createElement('textarea');
    ta.rows = 7;
    ta.placeholder = 'A_vs_B, rct, -0.40, 0.12\nA_vs_B, rct, -0.30, 0.14\nA_vs_B, ipd, -0.38, 0.10\nA_vs_B, obs, -0.60, 0.10\nA_vs_B, obs, -0.55, 0.11';
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
    btn.textContent = 'Synthesise evidence';
    btn.style.cssText = 'background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    btnRow.appendChild(example); btnRow.appendChild(btn);
    wrap.appendChild(btnRow);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Cross-design network synthesis (Welton 2009; Efthimiou GetReal 2017):</strong> RCTs anchor the truth (design-bias δ = 0); each '
      + 'IPD / observational stream gets a design-bias offset δ and a between-study bias variance σ²_bias estimated by method of moments on its residuals '
      + 'vs the anchor. The bias-corrected synthesis enters each non-RCT observation at yᵢ − δ with variance vᵢ + τ²_RCT + σ²_bias — wider than a naive pool '
      + 'because it accounts for the bias uncertainty. With RCT rows only, the synthesis equals the RCT anchor. Each contrast needs an RCT anchor.';
    wrap.appendChild(note);
    const EXAMPLE = 'A_vs_B, rct, -0.40, 0.12\nA_vs_B, rct, -0.30, 0.14\nA_vs_B, ipd, -0.38, 0.10\nA_vs_B, obs, -0.60, 0.10\nA_vs_B, obs, -0.55, 0.11';
    example.addEventListener('click', () => { ta.value = EXAMPLE; });
    btn.addEventListener('click', () => compute(P, result, ta.value));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmCrossNetwork) return false;
    if (document.getElementById('cross-network-synthesis-panel')) return true;
    const panel = P.buildCollapsiblePanel({
      id: 'cross-network-synthesis-panel', badge: 'Cross-design evidence synthesis <span style="font-size:9px;background:#3a2a0a;color:#fbbf24;border:1px solid #92400e;border-radius:4px;padding:0 4px;margin-left:4px;">Experimental</span>',
      summary: 'Bias-corrected synthesis of RCT + IPD + observational evidence (GetReal) — requires IPD + observational streams; paste-input tool',
      bodyNode: buildNode(P), storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1600));
    else setTimeout(tick, 1600);
  }

  global.CrossNetworkSynthesisPanel = { render, parseRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
