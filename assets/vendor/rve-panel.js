/* rve-panel.js — Robust Variance Estimation (CR2; Hedges-Tipton-Johnson 2010)
 * for DEPENDENT effect sizes (multiple outcomes / time-points / arms per study).
 *
 * Engine: AlmRVE.fitCORR / .summary (vendored verbatim from allmeta/shared/rve.js,
 * verified vs robumeta::robu CORR model, small=TRUE, to ≤1e-5).
 *
 * The kit's primary data model is one effect per trial, where RVE collapses to
 * ordinary inverse-variance. RVE only adds value when effects are CLUSTERED, so
 * this is a PASTE-INPUT tool: the user supplies their own clustered rows and the
 * panel computes the cluster-robust intercept (and optional moderator) with
 * CR2 small-sample correction + Satterthwaite df. It NEVER reads or fabricates
 * data from the dashboard — it computes only on explicit user input.
 *
 * Input format (one row per line):  study, effect, SE [, moderator]
 *   e.g.   Smith2019, 0.42, 0.11
 *          Smith2019, 0.55, 0.13, 1
 * "SE" is the standard error of the effect (vi = SE²). The moderator column is
 * optional; if any row has it, a single moderator slope is added to the model.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'rve-panel-expanded';

  function parseRows(text) {
    const rows = [];
    const errors = [];
    let hasMod = false;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      const parts = raw.split(/[,\t]/).map(s => s.trim());
      if (parts.length < 3) { errors.push('Line ' + (i + 1) + ': need at least study, effect, SE'); continue; }
      const cluster = parts[0];
      const yi = Number(parts[1]);
      const se = Number(parts[2]);
      const mod = parts.length >= 4 && parts[3] !== '' ? Number(parts[3]) : null;
      if (!cluster) { errors.push('Line ' + (i + 1) + ': empty study label'); continue; }
      if (!isFinite(yi)) { errors.push('Line ' + (i + 1) + ': effect "' + parts[1] + '" is not numeric'); continue; }
      if (!isFinite(se) || se <= 0) { errors.push('Line ' + (i + 1) + ': SE "' + parts[2] + '" must be a positive number'); continue; }
      if (mod !== null && !isFinite(mod)) { errors.push('Line ' + (i + 1) + ': moderator "' + parts[3] + '" is not numeric'); continue; }
      rows.push({ cluster, yi, vi: se * se, mod });
      if (mod !== null) hasMod = true;
    }
    // Build design matrix X. Intercept always; moderator if any row carries one.
    rows.forEach(r => { r.X = hasMod ? [1, r.mod === null ? 0 : r.mod] : [1]; });
    return { rows, errors, hasMod };
  }

  function compute(P, resultEl, text) {
    const fmt = P.fmt;
    const parsed = parseRows(text);
    if (parsed.errors.length) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">'
        + '⚠ ' + parsed.errors.length + ' problem(s):<br>' + parsed.errors.map(P.escapeHtml).join('<br>') + '</div>';
      return;
    }
    if (parsed.rows.length < 3) {
      resultEl.innerHTML = '<div style="color:#94a3b8;font-size:11px;">Enter at least 3 rows.</div>';
      return;
    }
    const clusters = new Set(parsed.rows.map(r => r.cluster));
    if (clusters.size < 2) {
      resultEl.innerHTML = '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11px;">'
        + '⚠ Only 1 cluster — RVE needs ≥2 distinct study labels to estimate a cluster-robust SE. With independent single-effect studies use the standard random-effects pool instead.</div>';
      return;
    }
    let fit, summ;
    try {
      fit = global.AlmRVE.fitCORR(parsed.rows, { rho: 0.8, method: 'CR2' });
      summ = global.AlmRVE.summary(fit);
    } catch (e) {
      resultEl.innerHTML = '<div style="background:#3a0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 10px;border-radius:6px;font-size:11px;">Computation failed: ' + P.escapeHtml(String(e.message || e)) + '</div>';
      return;
    }
    const labels = parsed.hasMod ? ['Intercept', 'Moderator'] : ['Pooled effect'];
    let rowsHtml = '';
    summ.forEach((s, j) => {
      rowsHtml += '<tr>'
        + '<td style="padding:4px 8px;color:#cbd5e1;">' + labels[j] + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#f1f5f9;text-align:right;">' + fmt(s.estimate, 3) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(s.se, 3) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(s.ci_lo, 3) + ', ' + fmt(s.ci_hi, 3) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(s.df, 1) + '</td>'
        + '<td style="padding:4px 8px;font-family:JetBrains Mono,monospace;color:#94a3b8;text-align:right;">' + fmt(s.p, 3) + '</td>'
        + '</tr>';
    });
    resultEl.innerHTML =
      '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">'
      + fit.m_clusters + ' clusters · ' + fit.k_total + ' effects · τ²(HTJ) = ' + fmt(fit.tau2, 4) + ' · ρ = ' + fmt(fit.rho, 2) + ' · CR2 + Satterthwaite df</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:11px;">'
      + '<thead><tr style="color:#94a3b8;text-transform:uppercase;font-size:9.5px;letter-spacing:0.04em;">'
      + '<th style="text-align:left;padding:4px 8px;">Term</th><th style="text-align:right;padding:4px 8px;">Est</th>'
      + '<th style="text-align:right;padding:4px 8px;">Robust SE</th><th style="text-align:right;padding:4px 8px;">95% CI</th>'
      + '<th style="text-align:right;padding:4px 8px;">df</th><th style="text-align:right;padding:4px 8px;">p</th></tr></thead>'
      + '<tbody>' + rowsHtml + '</tbody></table>';
  }

  function buildNode(P) {
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">'
      + 'Cluster-robust pooling for <strong>dependent effects</strong> (multiple outcomes / arms / time-points per study). '
      + 'Paste rows: <code style="color:#7dd3fc;">study, effect, SE</code> (optional 4th column = moderator). Computes only on your input.</div>';
    const ta = document.createElement('textarea');
    ta.rows = 6;
    ta.placeholder = 'Smith2019, 0.42, 0.11\nSmith2019, 0.55, 0.13\nJones2020, 0.30, 0.09\nJones2020, 0.38, 0.10\nLee2021, 0.22, 0.08';
    ta.style.cssText = 'width:100%;box-sizing:border-box;background:#0b1220;border:1px solid #1e293b;border-radius:6px;color:#e2e8f0;font-family:JetBrains Mono,monospace;font-size:11px;padding:8px;resize:vertical;';
    wrap.appendChild(ta);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Compute CR2 robust estimate';
    btn.style.cssText = 'margin:8px 0;background:#1e3a5f;color:#7dd3fc;border:1px solid #334155;border-radius:6px;padding:6px 12px;font-size:11px;cursor:pointer;font-weight:600;';
    wrap.appendChild(btn);
    const result = document.createElement('div');
    result.style.cssText = 'margin-top:6px;';
    wrap.appendChild(result);
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>RVE CORR model (Hedges-Tipton-Johnson 2010; CR2: Tipton 2015):</strong> a cluster-robust sandwich SE that stays valid '
      + 'even when the within-study working correlation ρ is misspecified, with the CR2 bias reduction and per-coefficient Satterthwaite df '
      + 'for correct small-sample coverage. Use when effects are nested within studies; for independent single-effect trials it reduces to ordinary '
      + 'inverse-variance pooling — use the standard panel there instead. SE/CI use t with the Satterthwaite df.';
    wrap.appendChild(note);
    btn.addEventListener('click', () => compute(P, result, ta.value));
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmRVE) return false;
    if (document.getElementById('rve-panel')) return true;
    const panel = P.buildCollapsiblePanel({
      id: 'rve-panel', badge: 'RVE / CR2 (dependent effects)',
      summary: 'Cluster-robust pooling for multiple effects per study — paste-input tool',
      bodyNode: buildNode(P), storageKey: STORAGE_KEY,
    });
    P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1070));
    else setTimeout(tick, 1070);
  }

  global.RVEPanel = { render, parseRows };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
