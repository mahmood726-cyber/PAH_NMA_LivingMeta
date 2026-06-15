/* bma-tau-panel.js — Bayesian model-averaging across τ² priors (sensitivity).
 *
 * Engine: AlmBMA.fit / .defaultModels (bma-tau.js, vendored verbatim from
 * allmeta/shared). The τ² prior is a known driver of posterior sensitivity in
 * small-k random-effects MA (Friede et al. 2017; Röver 2020). Rather than commit
 * to one prior, this integrates the posterior for the pooled effect μ over a
 * model space where each model differs ONLY in its τ² prior, weighting models by
 * their marginal likelihood (Laplace-approximated, Simpson grid over τ²).
 *
 * Reproduces the bma-tau-weights oracle on the 5-study fixture: halfNormal(0.5)
 * carries the largest weight, uniform(5) a small one (ratio ~7.34), BMA μ ~ -0.361.
 *
 * Surfaces a model-averaged pooled effect that is HONEST about prior choice — the
 * CrI accounts for both within- and between-prior variance (law of total
 * variance). A Bayesian SENSITIVITY view; binary outcomes (log-OR), k>=2. Report
 * beside the RE primary, never as the headline.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'bma-tau-panel-expanded';

  function logORrows(trials) {
    return trials.map(t => {
      let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
      if (ai === 0 || ci === 0 || ai === n1 || ci === n2) { ai += 0.5; ci += 0.5; n1 += 1; n2 += 1; }
      const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
      return { te: Math.log((a * d) / (b * c)), se: Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d) };
    });
  }

  function buildBody(P, r) {
    const fmt = P.fmt;
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
    }
    const maOR = Math.exp(r.muHat);
    const orLo = Math.exp(r.ci_lo), orHi = Math.exp(r.ci_hi);
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;">';
    html += cell('BMA pooled OR', fmt(maOR, 2), 'log-OR ' + fmt(r.muHat, 3));
    html += cell('95% CrI (OR)', fmt(orLo, 2) + ' – ' + fmt(orHi, 2), 'across all τ² priors');
    html += cell('BMA posterior SE', fmt(r.sePost, 3), 'incl. between-prior variance');
    html += '</div>';
    // per-prior weight table
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
    html += '<thead><tr style="border-bottom:1px solid #334155;color:#94a3b8;font-weight:600;">'
      + '<th style="text-align:left;padding:3px 6px;">τ² prior model</th>'
      + '<th style="text-align:right;padding:3px 6px;">μ (log-OR)</th>'
      + '<th style="text-align:right;padding:3px 6px;">τ² mode</th>'
      + '<th style="text-align:right;padding:3px 6px;">BMA weight</th></tr></thead><tbody>';
    r.perModel.forEach(m => {
      html += '<tr style="border-bottom:1px solid #1e293b;">'
        + '<td style="padding:3px 6px;font-family:JetBrains Mono,monospace;">' + P.escapeHtml(m.name) + '</td>'
        + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;">' + fmt(m.muHat, 3) + '</td>'
        + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#94a3b8;">' + fmt(m.tau2_mode, 3) + '</td>'
        + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#a78bfa;">' + fmt(100 * m.weight, 1) + '%</td></tr>';
    });
    html += '</tbody></table>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:8px;">'
      + '<strong>BMA across τ² priors (Friede, Röver, Wandel &amp; Neuenschwander 2017):</strong> the τ² prior is a known driver of '
      + 'posterior sensitivity in small-k random-effects MA. Instead of committing to one prior, this averages the pooled effect over a '
      + 'panel of priors weighted by marginal likelihood, so the CrI honestly absorbs the between-prior variance the standard RE pool ignores. '
      + 'A Bayesian SENSITIVITY view — report beside the RE primary, not instead of it.</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmBMA) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 2) return false;
    const rows = logORrows(trials);
    const yi = rows.map(x => x.te), vi = rows.map(x => x.se * x.se);
    let r;
    try { r = global.AlmBMA.fit(yi, vi, global.AlmBMA.defaultModels()); } catch (e) { return false; }
    if (!r || !r.ok || !isFinite(r.muHat) || !isFinite(r.sePost)) return false;

    const summary = 'BMA pooled OR ' + P.fmt(Math.exp(r.muHat), 2)
      + ' (95% CrI ' + P.fmt(Math.exp(r.ci_lo), 2) + '–' + P.fmt(Math.exp(r.ci_hi), 2) + ') · averaged over ' + r.perModel.length + ' τ² priors';
    const panel = P.buildCollapsiblePanel({
      id: 'bma-tau-panel', badge: 'BMA over τ² priors <span style="font-size:9px;background:#3a2a0a;color:#fbbf24;border:1px solid #92400e;border-radius:4px;padding:0 4px;margin-left:4px;">Experimental</span>',
      summary, bodyHtml: buildBody(P, r), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('bma-tau-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1220));
    else setTimeout(tick, 1220);
  }

  global.BMATauPanel = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
