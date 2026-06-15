/* robma-panel.js — robust Bayesian model-averaging (RoBMA-style) sensitivity panel.
 *
 * Engine: AlmRoBMA.analysis (robma.js, vendored verbatim from allmeta/shared;
 * marginal likelihoods verified vs R integrate() to ~1e-6; reproduces the
 * robma-parity oracle: BF_effect=6.738859, BF_hetero=2.698955). Model-averages
 * over the four effect×heterogeneity models (μ present/absent × τ present/absent)
 * by Gauss-Legendre/adaptive-Simpson quadrature — deterministic, NO MCMC.
 *
 * Reports inclusion Bayes factors for (a) whether an effect exists and (b)
 * whether heterogeneity exists, plus the model-averaged effect — a Bayesian
 * dimension the kit's grid-based bayesian-sensitivity panel lacks. Directly
 * addresses the multiverse / IV-RE-collapse gotchas in advanced-stats.
 *
 * EXPERIMENTAL — this is RoBMA's effect/heterogeneity sub-ensemble only; the full
 * package adds publication-bias (weight-function / PET-PEESE) models via MCMC.
 * SENSITIVITY only; binary outcomes (log-OR), k≥2. Surface beside the RE primary,
 * never as the headline.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'robma-panel-expanded';

  function logORrows(trials) {
    return trials.map(t => {
      let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
      if (ai === 0 || ci === 0 || ai === n1 || ci === n2) { ai += 0.5; ci += 0.5; n1 += 1; n2 += 1; }
      const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
      return { te: Math.log((a * d) / (b * c)), se: Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d) };
    });
  }

  // Jeffreys' evidence categories for a Bayes factor.
  function jeffreys(bf) {
    if (!isFinite(bf) || bf <= 0) return 'undefined';
    const x = bf >= 1 ? bf : 1 / bf;
    const dir = bf >= 1 ? '' : 'against ';
    let s;
    if (x < 3) s = 'anecdotal'; else if (x < 10) s = 'moderate'; else if (x < 30) s = 'strong';
    else if (x < 100) s = 'very strong'; else s = 'extreme';
    return s + ' ' + dir + 'evidence';
  }

  function buildBody(P, r) {
    const fmt = P.fmt;
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
        + '<div style="font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
        + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
        + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '') + '</div>';
    }
    const maOR = Math.exp(r.muMA);
    const strongEffect = r.bfEffect >= 3;
    const tone = strongEffect ? '#34d399' : '#fbbf24';
    const bg = strongEffect ? '#0e3a1f' : '#3a2a0a';
    const bd = strongEffect ? '#34d399' : '#92400e';
    const verdict = strongEffect
      ? '✓ BF₁₀ = ' + fmt(r.bfEffect, 2) + ' — ' + jeffreys(r.bfEffect) + ' that a non-zero effect exists (model-averaged across the effect×heterogeneity ensemble).'
      : '⚠ BF₁₀ = ' + fmt(r.bfEffect, 2) + ' — only ' + jeffreys(r.bfEffect) + ' for an effect; the data do not strongly favour a non-zero effect.';
    let html = '<div style="background:' + bg + ';border:1px solid ' + bd + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">' + verdict + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px;">';
    html += cell('BF effect (BF₁₀)', fmt(r.bfEffect, 2), jeffreys(r.bfEffect));
    html += cell('BF heterogeneity', fmt(r.bfHetero, 2), jeffreys(r.bfHetero));
    html += cell('P(effect exists)', fmt(100 * r.pInclEffect, 1) + '%', 'inclusion prob.');
    html += cell('P(heterogeneity)', fmt(100 * r.pInclHetero, 1) + '%', 'inclusion prob.');
    html += cell('Model-averaged OR', fmt(maOR, 2), 'over all 4 models');
    html += '</div>';
    // posterior model-probability table
    const pp = r.postProb;
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
    html += '<thead><tr style="border-bottom:1px solid #334155;color:#94a3b8;font-weight:600;">'
      + '<th style="text-align:left;padding:3px 6px;">Model</th>'
      + '<th style="text-align:left;padding:3px 6px;">Effect μ</th>'
      + '<th style="text-align:left;padding:3px 6px;">Heterogeneity τ</th>'
      + '<th style="text-align:right;padding:3px 6px;">Posterior prob.</th></tr></thead><tbody>';
    [['H0FE', 'absent', 'absent'], ['H1FE', 'present', 'absent'], ['H0RE', 'absent', 'present'], ['H1RE', 'present', 'present']].forEach(m => {
      html += '<tr style="border-bottom:1px solid #1e293b;">'
        + '<td style="padding:3px 6px;font-family:JetBrains Mono,monospace;">' + m[0] + '</td>'
        + '<td style="padding:3px 6px;">' + m[1] + '</td>'
        + '<td style="padding:3px 6px;">' + m[2] + '</td>'
        + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#a78bfa;">' + fmt(100 * pp[m[0]], 1) + '%</td></tr>';
    });
    html += '</tbody></table>';
    html += '<div style="font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:8px;">'
      + '<strong>RoBMA-style model-averaging (Maier, Bartoš &amp; Wagenmakers 2023):</strong> averages over the four '
      + 'effect×heterogeneity models, giving inclusion Bayes factors for whether an effect and whether heterogeneity '
      + 'exist — evidence <em>for the null</em> is possible (unlike a p-value). <strong>Experimental:</strong> this is the '
      + 'deterministic effect/heterogeneity sub-ensemble (no MCMC); the full RoBMA package adds publication-bias models. '
      + 'A Bayesian SENSITIVITY view — report beside the RE primary, not instead of it.</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmRoBMA) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 2) return false;
    const rows = logORrows(trials);
    let r;
    try { r = global.AlmRoBMA.analysis(rows.map(x => x.te), rows.map(x => x.se)); } catch (e) { return false; }
    if (!r || !isFinite(r.bfEffect) || !isFinite(r.muMA)) return false;

    const summary = 'BF₁₀=' + P.fmt(r.bfEffect, 2) + ' (effect) · BF=' + P.fmt(r.bfHetero, 2)
      + ' (heterogeneity) · MA OR ' + P.fmt(Math.exp(r.muMA), 2);
    const panel = P.buildCollapsiblePanel({
      id: 'robma-panel', badge: 'Robust Bayesian MA <span style="font-size:9px;background:#3a2a0a;color:#fbbf24;border:1px solid #92400e;border-radius:4px;padding:0 4px;margin-left:4px;">Experimental</span>',
      summary, bodyHtml: buildBody(P, r), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('robma-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1160));
    else setTimeout(tick, 1160);
  }

  global.RoBMAPanel = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
