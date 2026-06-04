/* outcome-switching.js — COMPare-style outcome-switching audit per trial.
 *
 * Reference: Goldacre B et al. "COMPare: a prospective cohort study
 *   correcting and monitoring 58 misreported trials in real time."
 *   Trials 2019;20:118 (PMID 30760329).
 * Found 87% of trials in top-5 journals had outcome discrepancies.
 *
 * For each trial in realData with both:
 *   - claimed primary endpoint (in `group:` or `allOutcomes[0].title`)
 *   - AACT-registered primary outcome (from outputs/aact_outcome_concordance.csv)
 * compare side-by-side and classify:
 *   MATCH         — same outcome, same time-point
 *   TIMEPOINT     — same outcome, different time
 *   ENDPOINT_DRIFT — different outcome
 *   NOT_REGISTERED — no AACT entry (FDAAA flag)
 *
 * Renders a per-trial table in the Extraction tab.
 *
 * Public API (window.OutcomeSwitching):
 *   compute(aactCsv) — pass parsed CSV rows
 *   render(container, opts)
 */
(function (global) {
  'use strict';

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const head = lines[0].split(',');
    return lines.slice(1).map(line => {
      const fields = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = !inQ;
        else if (ch === ',' && !inQ) { fields.push(cur); cur = ''; }
        else cur += ch;
      }
      fields.push(cur);
      const o = {};
      head.forEach((h, i) => o[h] = fields[i] || '');
      return o;
    });
  }

  async function loadAactCsv() {
    try {
      const r = await fetch('outputs/aact_outcome_concordance.csv');
      if (!r.ok) return [];
      const text = await r.text();
      return parseCsv(text);
    } catch (e) {
      return [];
    }
  }

  function classify(ourTitle, aactType, aactValue, ourEffect) {
    if (!aactType || aactValue === '' || aactValue == null) {
      return { tier: 'NOT_REGISTERED', color: '#ef4444',
               label: 'No AACT primary results posted (FDAAA risk)' };
    }
    const lt = (ourTitle || '').toLowerCase();
    const at = (aactType || '').toLowerCase();
    // Fuzzy semantic match on outcome type
    const sameType = (
      (lt.includes('mace') && (at.includes('hazard') || at.includes('odds') || at.includes('risk'))) ||
      (lt.includes('survival') && at.includes('hazard')) ||
      (lt.includes('mortality') && at.includes('hazard')) ||
      (lt.includes('progression') && at.includes('hazard')) ||
      (lt.includes('responder') && (at.includes('proportion') || at.includes('odds') || at.includes('risk'))) ||
      (lt.includes('change from baseline') && at.includes('mean')) ||
      (lt.includes('mean difference') && at.includes('mean'))
    );
    if (!sameType) {
      return { tier: 'ENDPOINT_DRIFT', color: '#f59e0b',
               label: 'AACT registered different outcome type' };
    }
    // If endpoints align broadly but values differ by >2-fold → flag
    const ourNum = parseFloat(ourEffect);
    const aactNum = parseFloat(aactValue);
    if (isFinite(ourNum) && isFinite(aactNum) && ourNum !== 0 && aactNum !== 0) {
      const ratio = Math.max(Math.abs(ourNum / aactNum), Math.abs(aactNum / ourNum));
      if (ratio > 2.5) {
        return { tier: 'TIMEPOINT', color: '#f59e0b',
                 label: 'Likely different timepoint or analysis cutoff' };
      }
    }
    return { tier: 'MATCH', color: '#10b981', label: 'Match' };
  }

  async function compute(filename) {
    const rd = (global.RapidMeta && global.RapidMeta.realData) || {};
    const aact = await loadAactCsv();
    const aactByNct = {};
    aact.forEach(r => {
      if (r.file === filename && r.nct) aactByNct[r.nct] = r;
    });
    const out = [];
    Object.entries(rd).forEach(([nct, t]) => {
      const ourTitle = (t.allOutcomes && t.allOutcomes[0] && t.allOutcomes[0].title) ||
                       t.group || t.name || '';
      const ourEffect = t.publishedHR;
      const aactRec = aactByNct[nct];
      const klass = classify(
        ourTitle,
        aactRec ? aactRec.aact_param_type : null,
        aactRec ? aactRec.aact_value : null,
        ourEffect
      );
      out.push({
        nct, name: t.name, ourTitle: ourTitle.slice(0, 80),
        ourEffect: ourEffect != null ? String(ourEffect) : '—',
        aactType: aactRec ? aactRec.aact_param_type : '',
        aactValue: aactRec ? aactRec.aact_value : '',
        ...klass,
      });
    });
    return out;
  }

  async function render(container) {
    if (typeof container === 'string') {
      container = container.charAt(0) === '#'
        ? document.getElementById(container.slice(1))
        : document.querySelector(container);
    }
    if (!container) return;
    const filename = location.pathname.split('/').pop();
    const rows = await compute(filename);
    if (!rows.length) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:11px;padding:8px;">No realData / AACT comparison available.</div>';
      return;
    }
    const counts = {};
    rows.forEach(r => counts[r.tier] = (counts[r.tier] || 0) + 1);
    let html = '';
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;font-size:11px;">';
    [
      ['MATCH', '#10b981'], ['TIMEPOINT', '#f59e0b'],
      ['ENDPOINT_DRIFT', '#f59e0b'], ['NOT_REGISTERED', '#ef4444']
    ].forEach(([k, c]) => {
      html += '<div style="background:rgba(0,0,0,0.25);border:1px solid ' + c + ';border-radius:6px;padding:6px 12px;">' +
        '<span style="color:' + c + ';font-weight:700;">' + (counts[k] || 0) + '</span> <span style="color:#94a3b8;">' + k + '</span></div>';
    });
    html += '</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
    html += '<thead><tr style="border-bottom:1px solid #334155;">';
    ['Trial', 'Our endpoint', 'Our effect', 'AACT type', 'AACT value', 'Verdict'].forEach(h => {
      html += '<th style="text-align:left;padding:6px 8px;color:#94a3b8;font-weight:600;font-size:10px;">' + h + '</th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr style="border-bottom:1px solid #1e293b;">';
      html += '<td style="padding:6px 8px;">' + (r.name || r.nct) + '</td>';
      html += '<td style="padding:6px 8px;">' + r.ourTitle + '</td>';
      html += '<td style="padding:6px 8px;font-family:ui-monospace;">' + r.ourEffect + '</td>';
      html += '<td style="padding:6px 8px;">' + (r.aactType || '—') + '</td>';
      html += '<td style="padding:6px 8px;font-family:ui-monospace;">' + (r.aactValue || '—') + '</td>';
      html += '<td style="padding:6px 8px;color:' + r.color + ';font-weight:600;">' + r.tier + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '<div style="font-size:10px;color:#64748b;margin-top:6px;">';
    html += 'COMPare-style audit (Goldacre 2019 <em>Trials</em> 20:118). ENDPOINT_DRIFT = different outcome type registered vs reported (potential outcome-switching). NOT_REGISTERED = FDAAA non-compliance candidate. MATCH = registered outcome aligns with reported.';
    html += '</div>';
    container.innerHTML = html;
  }

  global.OutcomeSwitching = { compute, render };
})(typeof window !== 'undefined' ? window : globalThis);
