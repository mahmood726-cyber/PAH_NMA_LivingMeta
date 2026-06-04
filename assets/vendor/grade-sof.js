/* GRADE Summary of Findings (SoF) table.
 *
 * Auto-builds from the topic's primary outcome:
 *   - k trials, total participants
 *   - Anticipated absolute effect: control event rate -> intervention event rate
 *   - Relative effect: pooled OR (95% CI)
 *   - Certainty grade: derived from existing CINeMA/verdict cues, allows user attest
 *
 * Per Brignardello-Petersen GRADE-NMA 2023 + Cochrane Handbook v6.5 ch.14.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'grade-sof-expanded';
  const ATTEST_KEY = 'grade-sof-attest';

  function getOutcomeName() {
    const cfg = global.NMA_CONFIG;
    if (cfg && cfg.protocol && cfg.protocol.out) return cfg.protocol.out;
    const rm = global.RapidMeta;
    if (rm && rm.state && rm.state.protocol && rm.state.protocol.out) return rm.state.protocol.out;
    // Try metadata header
    const h1 = document.querySelector('h1');
    return h1 ? (h1.textContent || '').trim().slice(0, 100) : 'Primary outcome';
  }

  function getInterventionName() {
    const cfg = global.NMA_CONFIG;
    if (cfg && cfg.protocol && cfg.protocol.int) return cfg.protocol.int;
    return 'Intervention';
  }

  function getComparatorName() {
    const cfg = global.NMA_CONFIG;
    if (cfg && cfg.protocol && cfg.protocol.comp) return cfg.protocol.comp;
    return 'Control';
  }

  // Derive an automatic GRADE grade from internal heuristics.
  // Reviewer is expected to verify and attest.
  function autoCertainty(pool, trials) {
    let downgrades = 0;
    const reasons = [];
    // Imprecision: CI width on log scale > 1
    const widthLog = Math.log(pool.ci_high) - Math.log(pool.ci_low);
    if (widthLog > 1.0) { downgrades++; reasons.push('imprecision (wide CI)'); }
    // Inconsistency: real Q-based I² > 50% (Higgins–Thompson StatMed 2002)
    // pool.Q and pool.Qdf are populated by PanelHelper.poolRandomLogOR.
    const I2 = (pool.Q != null && pool.Qdf != null && pool.Q > pool.Qdf)
      ? 100 * (pool.Q - pool.Qdf) / pool.Q
      : 0;
    if (I2 > 50) { downgrades++; reasons.push('inconsistency (I²=' + I2.toFixed(0) + '%)'); }
    // Few trials -> indirectness/imprecision risk
    if (trials.length < 5) { downgrades++; reasons.push('few trials (k<5)'); }
    // We can't auto-grade RoB or publication bias without user input
    let level;
    if (downgrades === 0) level = 'High';
    else if (downgrades === 1) level = 'Moderate';
    else if (downgrades === 2) level = 'Low';
    else level = 'Very low';
    return { level, downgrades, reasons };
  }

  function getAttestation() {
    try {
      const raw = localStorage.getItem(ATTEST_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setAttestation(level, by) {
    const data = { level, by, ts: new Date().toISOString() };
    try { localStorage.setItem(ATTEST_KEY, JSON.stringify(data)); } catch (e) {}
    return data;
  }

  function buildBody(P, trials, pool) {
    const fmt = P.fmt;
    const outcomeName = getOutcomeName();
    const intName = getInterventionName();
    const compName = getComparatorName();

    // Anticipated event rates
    let totalCtlEvents = 0, totalCtlN = 0, totalTxEvents = 0, totalTxN = 0;
    trials.forEach(t => {
      totalCtlEvents += t.ci; totalCtlN += t.n2i;
      totalTxEvents += t.ai; totalTxN += t.n1i;
    });
    const ctlRate = totalCtlEvents / totalCtlN;
    const ctlRatePer1000 = Math.round(ctlRate * 1000);
    // Apply pooled OR to control rate to get intervention rate
    const ctlOdds = ctlRate / (1 - ctlRate);
    const txOdds = ctlOdds * pool.OR;
    const txRate = txOdds / (1 + txOdds);
    const txRatePer1000 = Math.round(txRate * 1000);
    const txLowOdds = ctlOdds * pool.ci_low;
    const txLowRate = txLowOdds / (1 + txLowOdds);
    const txHighOdds = ctlOdds * pool.ci_high;
    const txHighRate = txHighOdds / (1 + txHighOdds);
    const arr = ctlRate - txRate;
    const arrPer1000 = Math.round(arr * 1000);

    const auto = autoCertainty(pool, trials);
    const attest = getAttestation();
    const finalLevel = attest ? attest.level : auto.level;

    let html = '';

    // SoF table proper
    html += '<table style="width:100%;font-size:11.5px;border-collapse:collapse;">';
    html += '<thead><tr style="background:#1e293b;color:#cbd5e1;">'
          + '<th style="padding:8px;text-align:left;border:1px solid #334155;">Outcome / endpoint</th>'
          + '<th style="padding:8px;text-align:left;border:1px solid #334155;">Risk with ' + compName + '</th>'
          + '<th style="padding:8px;text-align:left;border:1px solid #334155;">Risk with ' + intName + '</th>'
          + '<th style="padding:8px;text-align:left;border:1px solid #334155;">Relative effect</th>'
          + '<th style="padding:8px;text-align:left;border:1px solid #334155;">No. of participants</th>'
          + '<th style="padding:8px;text-align:left;border:1px solid #334155;">Certainty</th>'
          + '</tr></thead>';
    html += '<tbody>';
    html += '<tr style="background:#0b1220;">'
          + '<td style="padding:8px;border:1px solid #1e293b;color:#f1f5f9;">' + outcomeName + '<br><span style="font-size:10px;color:#64748b;">Follow-up: per trial</span></td>'
          + '<td style="padding:8px;border:1px solid #1e293b;color:#cbd5e1;font-family:JetBrains Mono,monospace;">' + ctlRatePer1000 + ' / 1000</td>'
          + '<td style="padding:8px;border:1px solid #1e293b;color:#cbd5e1;font-family:JetBrains Mono,monospace;">' + txRatePer1000 + ' / 1000<br>'
            + '<span style="font-size:10px;color:#94a3b8;">(' + Math.round(txLowRate*1000) + ' to ' + Math.round(txHighRate*1000) + ')</span><br>'
            + '<span style="font-size:10px;color:' + (arr > 0 ? '#34d399' : '#fca5a5') + ';">'
            + (arr > 0 ? Math.abs(arrPer1000) + ' fewer per 1000' : Math.abs(arrPer1000) + ' more per 1000')
            + '</span></td>'
          + '<td style="padding:8px;border:1px solid #1e293b;color:#7dd3fc;font-family:JetBrains Mono,monospace;">'
            + 'OR ' + fmt(pool.OR, 2) + '<br>'
            + '<span style="font-size:10px;color:#94a3b8;">(' + fmt(pool.ci_low, 2) + ' to ' + fmt(pool.ci_high, 2) + ')</span></td>'
          + '<td style="padding:8px;border:1px solid #1e293b;color:#cbd5e1;font-family:JetBrains Mono,monospace;">' + (totalTxN + totalCtlN).toLocaleString() + '<br><span style="font-size:10px;color:#94a3b8;">(' + trials.length + ' RCTs)</span></td>'
          + '<td style="padding:8px;border:1px solid #1e293b;">' + certaintyBadge(finalLevel) + (attest ? '<br><span style="font-size:10px;color:#34d399;">attested</span>' : '<br><span style="font-size:10px;color:#fbbf24;">auto-derived</span>') + '</td>'
          + '</tr>';
    html += '</tbody></table>';

    // Auto-grading reasoning
    html += '<div style="margin-top:10px;background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:8px 10px;font-size:11px;">';
    html += '<div style="color:#94a3b8;font-size:10.5px;text-transform:uppercase;letter-spacing:0.05em;">Auto-derivation</div>';
    html += '<div style="color:#cbd5e1;margin-top:4px;">Starting at <strong style="color:#34d399;">High</strong>, downgraded ' + auto.downgrades + ' level(s) — '
          + (auto.reasons.length ? auto.reasons.join('; ') : 'no internal heuristic flagged downgrades')
          + '. Final auto-grade: <strong>' + auto.level + '</strong>.</div>';
    html += '<div style="color:#94a3b8;margin-top:6px;font-size:10.5px;">'
          + 'Note: auto-grade does not assess Risk of Bias (use ROB-2 panel), '
          + 'publication bias (use Doi/LFK + comparison-adjusted funnel), '
          + 'or indirectness against the PICO. The reviewer must verify and attest below.</div>';
    html += '</div>';

    // Attestation buttons
    html += '<div style="margin-top:10px;">';
    html += '<div style="font-size:10.5px;color:#94a3b8;margin-bottom:6px;">Reviewer attestation — set the GRADE certainty after reviewing all evidence streams (RoB, inconsistency, indirectness, imprecision, publication bias):</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
    ['High', 'Moderate', 'Low', 'Very low'].forEach(level => {
      html += '<button onclick="GRADESoF.attest(\'' + level + '\')" style="padding:4px 10px;background:' + (finalLevel === level ? '#1e3a5f' : '#1e293b') + ';border:1px solid ' + (finalLevel === level ? '#7dd3fc' : '#334155') + ';color:' + (finalLevel === level ? '#7dd3fc' : '#cbd5e1') + ';border-radius:4px;font-size:11px;cursor:pointer;">' + level + '</button>';
    });
    html += '</div>';
    if (attest) {
      html += '<div style="margin-top:6px;font-size:10.5px;color:#34d399;">Attested as <strong>' + attest.level + '</strong> on ' + attest.ts.slice(0, 16) + (attest.by ? ' by ' + attest.by : '') + '</div>';
    }
    html += '</div>';

    return html;
  }

  function certaintyBadge(level) {
    const colors = {
      'High': { bg: '#0e3a1f', border: '#34d399', text: '#34d399', symbol: '⊕⊕⊕⊕' },
      'Moderate': { bg: '#1e3a5f', border: '#7dd3fc', text: '#7dd3fc', symbol: '⊕⊕⊕○' },
      'Low': { bg: '#3a2a0a', border: '#fbbf24', text: '#fbbf24', symbol: '⊕⊕○○' },
      'Very low': { bg: '#3a0a0a', border: '#fca5a5', text: '#fca5a5', symbol: '⊕○○○' },
    };
    const c = colors[level] || colors['Very low'];
    return '<div style="display:inline-block;background:' + c.bg + ';border:1px solid ' + c.border + ';color:' + c.text + ';padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;">'
         + c.symbol + ' ' + level + '</div>';
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 2) return false;
    const pool = P.poolRandomLogOR(trials);
    if (!pool) return false;

    const auto = autoCertainty(pool, trials);
    const attest = getAttestation();
    const finalLevel = attest ? attest.level : auto.level;
    const umbrella = P.isNMA && P.isNMA() ? ' [umbrella; per-comparison in NMA Forest]' : '';
    const summary = 'Certainty: ' + finalLevel + ' · k=' + pool.k + ' · OR ' + P.fmt(pool.OR, 2) + ' [' + P.fmt(pool.ci_low, 2) + '–' + P.fmt(pool.ci_high, 2) + ']' + (attest ? ' · attested' : ' · auto') + umbrella;

    const panel = P.buildCollapsiblePanel({
      id: 'grade-sof-panel',
      badge: 'GRADE SoF',
      summary,
      bodyHtml: buildBody(P, trials, pool),
      storageKey: STORAGE_KEY,
    });

    const existing = document.getElementById('grade-sof-panel');
    if (existing) existing.replaceWith(panel);
    else P.insertAfterRBadge(panel);
    return true;
  }

  function attest(level) {
    setAttestation(level, null);
    render();
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => {
      if (render()) return;
      if (++tries < 20) setTimeout(tick, 250);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 400));
    } else {
      setTimeout(tick, 400);
    }
  }

  global.GRADESoF = { render, attest };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
