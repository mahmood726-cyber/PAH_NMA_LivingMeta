/* multilevel-reml-panel.js — three-level (multilevel) REML meta-analysis.
 *
 * Engine: AlmMultilevelREML.fit (vendored verbatim from
 * allmeta/shared/multilevel-reml.js, verified vs metafor::rma.mv on
 * dat.konstantopoulos2011 to 1e-5). Effects (level 1, variance v) nested in
 * units nested in clusters (level 3); estimates a between-cluster variance σ²₃
 * and a within-cluster variance σ²₂ by REML.
 *
 * The kit's primary data model is one effect per trial (no nesting), so this is
 * a PASTE-INPUT tool: the user supplies clustered rows. It NEVER reads or
 * fabricates data from the dashboard — computes only on explicit user input.
 *
 * Input format (one row per line):  cluster, effect, SE
 *   e.g.  District1, 0.31, 0.07
 * Rows sharing a cluster label form a level-3 group; "SE" is the effect's
 * standard error (v = SE²).
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'multilevel-reml-panel-expanded';

  function parseRows(text) {
    const rows = [], errors = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (parts.length < 3) { errors.push('Line ' + (i + 1) + ': need cluster, effect, SE'); continue; }
      const cluster = parts[0], y = Number(parts[1]), se = Number(parts[2]);
      if (!cluster) { errors.push('Line ' + (i + 1) + ': empty cluster label'); continue; }
      if (!isFinite(y)) { errors.push('Line ' + (i + 1) + ': effect "' + parts[1] + '" not numeric'); continue; }
      if (!isFinite(se) || se <= 0) { errors.push('Line ' + (i + 1) + ': SE "' + parts[2] + '" must be > 0'); continue; }
      rows.push({ cluster, y, v: se * se });
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
    if (parsed.rows.length < 4) { resultEl.innerHTML = '<div style="color:#94a3b8;font-size:11px;">Enter at least 4 rows.</div>'; return; }
    const clusters = new Set(parsed.rows.map(r => r.cluster));
    if (clusters.size < 2) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">'
        + '⚠ Only 1 cluster — a three-level model needs ≥2 cluster labels. With independent effects use the standard random-effects pool.</div>';
      return;
    }
    let f;
    try { f = global.AlmMultilevelREML.fit(parsed.rows); }
    catch (e) { resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">Computation failed: ' + P.escapeHtml(String(e.message || e)) + '</div>'; return; }
    if (!f || !isFinite(f.mu)) { resultEl.innerHTML = '<div style="color:#fca5a5;font-size:11px;">REML did not converge on this input.</div>'; return; }
    const total = f.sigma2Between + f.sigma2Within;
    const pctL3 = total > 0 ? (100 * f.sigma2Between / total) : 0;
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
    }
    const zc = 1.959963984540054;
    resultEl.innerHTML = '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">'
      + f.k + ' effects · ' + f.nClusters + ' clusters · REML logLik = ' + fmt(f.logLik, 3) + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">'
      + cell('Pooled effect μ', fmt(f.mu, 3), '95% CI ' + fmt(f.mu - zc * f.se, 3) + '–' + fmt(f.mu + zc * f.se, 3))
      + cell('SE(μ)', fmt(f.se, 4), 'GLS standard error')
      + cell('σ²₃ between-cluster (L3)', fmt(f.sigma2Between, 4), fmt(pctL3, 0) + '% of total heterogeneity')
      + cell('σ²₂ within-cluster (L2)', fmt(f.sigma2Within, 4), fmt(100 - pctL3, 0) + '% of total')
      + '</div>';
  }

  function buildNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Three-level REML for <strong>nested effects</strong> (effects within units within clusters). '
      + 'Paste rows: <code style="color:#7dd3fc;">cluster, effect, SE</code>. Computes only on your input.</div>';
    const ta = document.createElement('textarea');
    ta.rows = 6;
    ta.placeholder = 'District1, 0.31, 0.07\nDistrict1, 0.22, 0.09\nDistrict2, 0.45, 0.08\nDistrict2, 0.38, 0.10\nDistrict3, 0.12, 0.06';
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:8px;resize:vertical;';
    wrap.appendChild(ta);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Fit three-level REML';
    btn.style.cssText = 'margin:8px 0;background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    wrap.appendChild(btn);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>Three-level REML (metafor::rma.mv ~1|cluster/unit):</strong> partitions heterogeneity into a between-cluster σ²₃ and a '
      + 'within-cluster σ²₂; μ is GLS, variances by REML. Use when effects are nested (multiple effects per study/site/region); ignoring the nesting '
      + 'understates SEs. For independent single-effect studies use the standard random-effects pool instead.';
    wrap.appendChild(note);
    btn.addEventListener('click', () => compute(P, result, ta.value));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmMultilevelREML) return false;
    if (document.getElementById('multilevel-reml-panel')) return true;
    const panel = P.buildCollapsiblePanel({
      id: 'multilevel-reml-panel', badge: 'Three-level REML (nested)',
      summary: 'Multilevel meta-analysis for nested effects — paste-input tool',
      bodyNode: buildNode(P), storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1130));
    else setTimeout(tick, 1130);
  }

  global.MultilevelREMLPanel = { render, parseRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
