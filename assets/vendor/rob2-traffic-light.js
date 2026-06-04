/* rob2-traffic-light.js — Cochrane RoB-2 traffic-light visualization.
 *
 * Reads each trial's `rob:` array (5 domains: D1 Randomization, D2
 * Deviations from intended, D3 Missing outcome data, D4 Measurement
 * of outcome, D5 Selection of reported result).
 *
 * Renders:
 *   - Per-trial row of 5 colored circles (low=green, some=amber,
 *     high=red, unclear=gray)
 *   - Stacked bar % chart across all trials per domain
 *   - "Stub fill needed" warning if all trials are uniformly all-low
 *     (RoB-2 review hasn't been done; placeholder values).
 *
 * Public API (window.Rob2TrafficLight):
 *   compute() — { trials: [], domainSummary: [] }
 *   render(container)
 */
(function (global) {
  'use strict';

  const DOMAINS = [
    { key: 'D1', label: 'Randomization' },
    { key: 'D2', label: 'Deviations' },
    { key: 'D3', label: 'Missing outcomes' },
    { key: 'D4', label: 'Outcome measurement' },
    { key: 'D5', label: 'Selective reporting' },
  ];

  function colorFor(rating) {
    const r = (rating || '').toLowerCase();
    if (r === 'low') return '#10b981';
    if (r === 'some' || r === 'some concerns') return '#f59e0b';
    if (r === 'high') return '#ef4444';
    return '#6b7280';
  }

  function compute() {
    const rd = (global.RapidMeta && global.RapidMeta.realData) || {};
    const trials = Object.entries(rd).map(([nct, t]) => ({
      nct,
      name: t.name || nct,
      rob: Array.isArray(t.rob) ? t.rob : [],
    })).filter(t => t.rob.length === 5);
    // Domain summary
    const domainSummary = DOMAINS.map((d, i) => {
      const counts = { low: 0, some: 0, high: 0, unclear: 0 };
      trials.forEach(t => {
        const r = (t.rob[i] || '').toLowerCase();
        if (r === 'low') counts.low++;
        else if (r === 'some' || r === 'some concerns') counts.some++;
        else if (r === 'high') counts.high++;
        else counts.unclear++;
      });
      return { ...d, counts };
    });
    // Detect all-low stub: ALL trials have ALL 5 domains 'low'
    const allLowStub = trials.length > 0 && trials.every(t => t.rob.every(r => (r || '').toLowerCase() === 'low'));
    return { trials, domainSummary, allLowStub };
  }

  function render(container) {
    if (typeof container === 'string') {
      container = container.charAt(0) === '#'
        ? document.getElementById(container.slice(1))
        : document.querySelector(container);
    }
    if (!container) return;
    const r = compute();
    let html = '';
    if (!r.trials.length) {
      html = '<div style="color:#94a3b8;font-size:11px;padding:8px;">No trials with RoB-2 arrays.</div>';
      container.innerHTML = html;
      return;
    }
    if (r.allLowStub) {
      html += '<div style="background:rgba(245,158,11,0.12);border:1px solid #f59e0b;border-radius:6px;padding:10px;font-size:11px;color:#fde68a;margin-bottom:10px;">';
      html += '<strong>⚠ Stub-only RoB:</strong> all ' + r.trials.length + ' trials show ALL 5 domains as "low" — this is a default placeholder, not a per-trial RoB-2 assessment. ';
      html += 'Cochrane requires per-trial domain-by-domain reasoning. Edit each trial\'s <code>rob:</code> array to reflect the actual paper\'s RoB-2 assessment.';
      html += '</div>';
    }

    // Per-domain stacked bar
    html += '<h5 style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:6px;">Per-domain summary (n=' + r.trials.length + ')</h5>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;margin-bottom:14px;">';
    r.domainSummary.forEach(d => {
      const total = d.counts.low + d.counts.some + d.counts.high + d.counts.unclear;
      const pct = k => total ? (100 * d.counts[k] / total) : 0;
      html += '<tr><td style="padding:4px 8px;width:30px;color:#94a3b8;font-family:ui-monospace;">' + d.key + '</td>';
      html += '<td style="padding:4px 8px;width:140px;">' + d.label + '</td>';
      html += '<td style="padding:4px 8px;">';
      html += '<div style="display:flex;height:14px;border-radius:3px;overflow:hidden;">';
      ['low', 'some', 'high', 'unclear'].forEach(k => {
        if (d.counts[k]) {
          html += '<div title="' + k + ': ' + d.counts[k] + '" style="background:' + colorFor(k) + ';width:' + pct(k) + '%;"></div>';
        }
      });
      html += '</div>';
      html += '</td>';
      html += '<td style="padding:4px 8px;width:120px;font-family:ui-monospace;font-size:10px;color:#64748b;text-align:right;">';
      html += d.counts.low + 'L · ' + d.counts.some + 'S · ' + d.counts.high + 'H · ' + d.counts.unclear + 'U';
      html += '</td>';
      html += '</tr>';
    });
    html += '</table>';

    // Per-trial traffic light
    html += '<h5 style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:6px;">Per-trial RoB-2 grid</h5>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cbd5e1;">';
    html += '<thead><tr style="border-bottom:1px solid #334155;">';
    html += '<th style="text-align:left;padding:4px 8px;color:#94a3b8;font-weight:600;font-size:10px;">Trial</th>';
    DOMAINS.forEach(d => {
      html += '<th style="padding:4px 8px;color:#94a3b8;font-weight:600;font-size:10px;text-align:center;width:50px;">' + d.key + '</th>';
    });
    html += '</tr></thead><tbody>';
    r.trials.forEach(t => {
      html += '<tr style="border-bottom:1px solid #1e293b;">';
      html += '<td style="padding:4px 8px;">' + t.name + '</td>';
      t.rob.forEach(rating => {
        const c = colorFor(rating);
        html += '<td style="padding:4px 8px;text-align:center;">';
        html += '<span title="' + (rating || 'unclear') + '" style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + c + ';"></span>';
        html += '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10px;color:#64748b;margin-top:8px;">';
    html += 'Cochrane RoB-2: D1 Randomization · D2 Deviations from intended intervention · D3 Missing outcome data · D4 Measurement of the outcome · D5 Selection of reported result. ';
    html += 'Green=low · Amber=some concerns · Red=high · Gray=unclear/missing.';
    html += '</div>';

    container.innerHTML = html;
  }

  global.Rob2TrafficLight = { compute, render };
})(typeof window !== 'undefined' ? window : globalThis);
