/* personalised-te-panel.js — personalised treatment effects via empirical-Bayes
 * shrinkage of subgroup estimates (PATH Statement; Kent et al. 2018).
 *
 * Engine: AlmPersonalisedTE.fit (vendored verbatim from
 * allmeta/shared/personalised-te.js, verified vs metafor::blup: the shrunk POINT
 * estimates match BLUP exactly — μ=-0.4936426, σ²_between=0.0233495, blup
 * young=-0.3467833, old=-0.5280389, biomarker+=-0.6061057 — with a conservative
 * Morris-1983 SE ≥ the metafor plug-in se). Each subgroup's pooled effect is
 * pulled toward the overall pooled effect by an amount inversely proportional to
 * its evidence (James-Stein / empirical Bayes).
 *
 * The kit's primary data model is one effect per trial with no subgroup labels,
 * so this is a PASTE-INPUT tool (like multilevel-reml / rve): the user supplies
 * subgroup-level rows. It NEVER reads or fabricates data from the dashboard.
 *
 * Input format (one row per line):  study, subgroup, effect, SE
 *   e.g.  STAMPEDE, young, -0.30, 0.14
 * Rows sharing a subgroup label are pooled (DL) then shrunk toward the overall.
 * An established HTE method (PATH Statement, Ann Intern Med 2018) -> neutral.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'personalised-te-panel-expanded';

  function parseRows(text) {
    const rows = [], errors = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (parts.length < 4) { errors.push('Line ' + (i + 1) + ': need study, subgroup, effect, SE'); continue; }
      const study = parts[0], subgroup = parts[1], y = Number(parts[2]), se = Number(parts[3]);
      if (!study) { errors.push('Line ' + (i + 1) + ': empty study label'); continue; }
      if (!subgroup) { errors.push('Line ' + (i + 1) + ': empty subgroup label'); continue; }
      if (!isFinite(y)) { errors.push('Line ' + (i + 1) + ': effect "' + parts[2] + '" not numeric'); continue; }
      if (!isFinite(se) || se <= 0) { errors.push('Line ' + (i + 1) + ': SE "' + parts[3] + '" must be > 0'); continue; }
      rows.push({ study, subgroup, yi: y, vi: se * se });
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
    if (parsed.rows.length < 2) { resultEl.innerHTML = '<div style="color:#94a3b8;font-size:11px;">Enter at least 2 rows.</div>'; return; }
    const subgroups = new Set(parsed.rows.map(r => r.subgroup));
    if (subgroups.size < 2) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">'
        + '⚠ Only 1 subgroup — shrinkage across subgroups needs ≥2 subgroup labels. With one subgroup use the standard random-effects pool.</div>';
      return;
    }
    let r;
    try { r = global.AlmPersonalisedTE.fit(parsed.rows); }
    catch (e) { resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">Computation failed: ' + P.escapeHtml(String(e.message || e)) + '</div>'; return; }
    if (!r || !r.ok) { resultEl.innerHTML = '<div style="color:#fca5a5;font-size:11px;">' + P.escapeHtml((r && r.error) || 'fit failed') + '</div>'; return; }

    let rowsHtml = '';
    Object.keys(r.subgroups).forEach(name => {
      const s = r.subgroups[name];
      const pull = Math.abs(s.yi_pooled - s.theta_shrunk);
      rowsHtml += '<tr>'
        + '<td style="padding:4px 8px;color:#cbd5e1;">' + P.escapeHtml(name) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(s.yi_pooled, 3) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#f1f5f9;text-align:right;">' + fmt(s.theta_shrunk, 3) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(s.ci_lo, 3) + '–' + fmt(s.ci_hi, 3) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:' + (s.shrinkage_weight < 0.5 ? '#fbbf24' : '#94a3b8') + ';text-align:right;">' + fmt(100 * s.shrinkage_weight, 0) + '%</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + s.k + '</td>'
        + '</tr>';
    });
    const zc = 1.959963984540054;
    resultEl.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">'
      + r.n_rows + ' rows · ' + r.n_subgroups + ' subgroups · overall μ = ' + fmt(r.overall.mu, 3)
      + ' (95% CI ' + fmt(r.overall.ci_lo, 3) + '–' + fmt(r.overall.ci_hi, 3) + ') · σ²_between = ' + fmt(r.sigma2_between, 4) + '</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">'
      + '<thead><tr style="color:#94a3b8;text-transform:uppercase;font-size:9.5px;letter-spacing:0.04em;">'
      + '<th style="text-align:left;padding:4px 8px;">subgroup</th><th style="text-align:right;padding:4px 8px;">raw pool</th>'
      + '<th style="text-align:right;padding:4px 8px;">EB-shrunk</th><th style="text-align:right;padding:4px 8px;">95% CI</th>'
      + '<th style="text-align:right;padding:4px 8px;">weight</th><th style="text-align:right;padding:4px 8px;">k</th></tr></thead><tbody>'
      + rowsHtml + '</tbody></table>'
      + '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
      + '<strong>Empirical-Bayes shrinkage (PATH Statement; Kent 2018):</strong> each subgroup is pooled (DL) then pulled toward the overall '
      + 'effect by weight σ²_between/(σ²_between+se²) — a low weight means a noisy subgroup heavily borrowed from the overall. The EB-shrunk '
      + 'estimate matches metafor::blup; the SE is the conservative Morris-1983 variance (≥ the plug-in BLUP se). A personalised-effect view — '
      + 'report alongside the overall pooled effect, not as a single headline.</div>';
  }

  function buildNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Personalised treatment effects by <strong>subgroup</strong> via empirical-Bayes shrinkage. '
      + 'Paste rows: <code style="color:#7dd3fc;">study, subgroup, effect, SE</code>. Computes only on your input.</div>';
    const ta = document.createElement('textarea');
    ta.rows = 6;
    ta.placeholder = 'STAMPEDE, young, -0.30, 0.14\nLATITUDE, young, -0.25, 0.16\nSTAMPEDE, old, -0.55, 0.15\nLATITUDE, old, -0.50, 0.16\nPROfound, biomarker+, -0.65, 0.17';
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:8px;resize:vertical;';
    wrap.appendChild(ta);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Shrink subgroup effects';
    btn.style.cssText = 'margin:8px 0;background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    wrap.appendChild(btn);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Personalised treatment-effect synthesis:</strong> within each subgroup the studies are pooled (inverse-variance, DL τ²), then the '
      + 'subgroup pools are shrunk toward the overall effect (James-Stein / empirical Bayes). Use when subgroup-specific effects are reported and you want a '
      + 'noise-corrected per-subgroup estimate; naively trusting one subgroup is noisy, ignoring the subgroup is biased. Requires ≥2 subgroups.';
    wrap.appendChild(note);
    btn.addEventListener('click', () => compute(P, result, ta.value));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmPersonalisedTE) return false;
    if (document.getElementById('personalised-te-panel')) return true;
    const panel = P.buildCollapsiblePanel({
      id: 'personalised-te-panel', badge: 'Personalised TE (subgroups)',
      summary: 'Empirical-Bayes shrinkage of subgroup effects — paste-input tool',
      bodyNode: buildNode(P), storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1260));
    else setTimeout(tick, 1260);
  }

  global.PersonalisedTEPanel = { render, parseRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
