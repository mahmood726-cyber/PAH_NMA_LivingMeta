/* Per-drug stratified dose-response meta-regression.
 *
 * Companion to dose-response.js. When trials span multiple drug classes
 * (cross-class case), the parent panel correctly suppresses a meaningful
 * pooled slope. THIS panel splits trials by drug stem and fits a
 * separate dose-response within each drug — recovering interpretable
 * slopes that the cross-class pool obscures.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'dose-stratified-expanded';

  function parseDose(text) {
    if (!text) return null;
    const re = /(\d+(?:\.\d+)?)\s*(mg|μg|µg|mcg|g)\b/i;
    const m = text.match(re);
    if (!m) return null;
    let v = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === 'g') v *= 1000;
    else if (unit === 'μg' || unit === 'µg' || unit === 'mcg') v /= 1000;
    return v > 0 ? v : null;
  }

  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d };
  }

  function normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804 * Math.exp(-z * z / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  function metaRegLinear(yi, vi, x) {
    const k = yi.length;
    if (k < 3) return null;
    let W0 = 0, WY0 = 0;
    for (let i = 0; i < k; i++) { const w = 1/vi[i]; W0 += w; WY0 += w * yi[i]; }
    const yFE = WY0 / W0;
    let Q0 = 0;
    for (let i = 0; i < k; i++) Q0 += (1/vi[i]) * Math.pow(yi[i] - yFE, 2);
    const sumW2 = vi.reduce((s, v) => s + Math.pow(1/v, 2), 0);
    const c0 = W0 - sumW2 / W0;
    const tau2 = Math.max(0, (Q0 - (k - 1)) / c0);
    const w = vi.map(v => 1 / (v + tau2));
    let Sw = 0, Swx = 0, Swy = 0, Swxx = 0, Swxy = 0;
    for (let i = 0; i < k; i++) {
      Sw += w[i]; Swx += w[i]*x[i]; Swy += w[i]*yi[i];
      Swxx += w[i]*x[i]*x[i]; Swxy += w[i]*x[i]*yi[i];
    }
    const xbar = Swx / Sw, ybar = Swy / Sw;
    const Sxx = Swxx - Sw * xbar * xbar;
    const Sxy = Swxy - Sw * xbar * ybar;
    if (Sxx === 0) return null;
    const beta = Sxy / Sxx;
    const alpha = ybar - beta * xbar;
    const se_beta = Math.sqrt(1 / Sxx);
    const z = beta / se_beta;
    const p = 2 * (1 - normalCDF(Math.abs(z)));
    return { alpha, beta, se_beta, z, p, k, tau2 };
  }

  function buildBody(P, byStem) {
    const fmt = P.fmt;
    let html = '';
    const stems = Object.keys(byStem).filter(s => byStem[s].length >= 2).sort();

    if (stems.length === 0) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;font-size:11.5px;">'
            + 'No drug stem in this review has ≥2 trials with parseable doses — per-drug regression undefined.'
            + '</div>';
      return html;
    }

    html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;line-height:1.5;">'
          + 'Per-drug-stem fit splits trials by the first word of each trial\'s group field, then runs an independent meta-regression of log-OR on log-dose within each drug. '
          + 'Useful when the parent panel (dose-response.js) correctly flags the overall pool as cross-class but a single drug has its own multi-dose evidence.'
          + '</div>';

    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">Drug stem</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">k</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">Doses (mg)</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">β̂ (per log-mg)</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">p</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">OR per doubling</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:left;">Verdict</th>'
          + '</tr></thead><tbody>';

    let nSig = 0, totalFit = 0;
    stems.forEach(stem => {
      const trials = byStem[stem];
      const yi = trials.map(t => t.yi), vi = trials.map(t => t.vi), x = trials.map(t => Math.log(t.dose));
      const uniqueDoses = new Set(trials.map(t => t.dose));
      const dosesStr = Array.from(uniqueDoses).sort((a, b) => a - b)
                        .map(d => d < 1 ? d.toFixed(2) : (d < 10 ? d.toFixed(1) : d.toFixed(0)))
                        .join(', ');
      if (uniqueDoses.size < 2 || trials.length < 3) {
        html += '<tr style="border-bottom:1px solid #0b1220;">'
              + '<td style="padding:3px 6px;color:#e2e8f0;text-transform:capitalize;">' + stem + '</td>'
              + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + trials.length + '</td>'
              + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + dosesStr + '</td>'
              + '<td colspan="4" style="padding:3px 6px;color:#475569;">'
              + (trials.length < 3 ? 'k<3' : 'no dose variation')
              + ' — regression undefined</td></tr>';
        return;
      }
      const mr = metaRegLinear(yi, vi, x);
      if (!mr) {
        html += '<tr><td colspan="7" style="padding:3px 6px;color:#475569;">' + stem + ' — regression failed</td></tr>';
        return;
      }
      totalFit++;
      const orPerDoubling = Math.exp(mr.beta * Math.log(2));
      const sig = mr.p < 0.05;
      if (sig) nSig++;
      const verdict = sig
        ? '<span style="color:#fbbf24;">⚠ significant</span>'
        : '<span style="color:#34d399;">✓ no slope</span>';
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;text-transform:capitalize;font-weight:600;">' + stem + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + trials.length + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;font-size:10px;">' + dosesStr + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:' + (sig ? '#fbbf24' : '#cbd5e1') + ';">' + fmt(mr.beta, 3) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:' + (sig ? '#fbbf24' : '#cbd5e1') + ';">' + fmt(mr.p, 3) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + fmt(orPerDoubling, 2) + '</td>'
            + '<td style="padding:3px 6px;font-size:10.5px;">' + verdict + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> trials grouped by drug stem (first word of group field). Within each stem with ≥3 trials and ≥2 unique doses, '
          + 'fit β̂ via DerSimonian–Laird two-stage weighted regression on log-dose. '
          + 'OR per doubling = exp(β̂ × ln 2). Greenland & Longnecker 1992 single-agent dose-response. '
          + 'Defends against the cross-class category-error suppression in the parent panel.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 3) return false;

    const byName = {};
    Object.values(rd).forEach(t => { if (t && t.name) byName[t.name] = t; });

    // Group by drug stem
    const byStem = {};
    trials.forEach(t => {
      const raw = byName[t.name] || {};
      const candidate = (t.name || '') + ' ' + (raw.group || '');
      const dose = parseDose(candidate);
      if (dose == null) return;
      const stem = ((raw.group || '').toLowerCase().split(/\s|\/|,|-|\(|\+/)[0]) || 'unknown';
      if (!byStem[stem]) byStem[stem] = [];
      const lo = trialLogOR(t);
      byStem[stem].push({ name: t.name, dose, yi: lo.yi, vi: lo.vi });
    });

    // Need at least one drug with ≥3 trials and ≥2 doses
    const stemsWithFit = Object.keys(byStem).filter(s => {
      const tr = byStem[s];
      const u = new Set(tr.map(t => t.dose));
      return tr.length >= 3 && u.size >= 2;
    });
    if (stemsWithFit.length === 0) return false;

    let nSig = 0;
    stemsWithFit.forEach(stem => {
      const tr = byStem[stem];
      const mr = metaRegLinear(tr.map(t => t.yi), tr.map(t => t.vi), tr.map(t => Math.log(t.dose)));
      if (mr && mr.p < 0.05) nSig++;
    });
    const summary = stemsWithFit.length + ' drug stem(s) with within-drug fit · '
                  + nSig + ' show significant dose-response (p<0.05)';

    const panel = P.buildCollapsiblePanel({
      id: 'dose-stratified-panel', badge: 'Per-drug dose-response', summary,
      bodyHtml: buildBody(P, byStem), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('dose-stratified-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1500));
    } else { setTimeout(tick, 1500); }
  }

  global.DoseStratified = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
