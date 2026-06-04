/* Fagan nomogram for DTA — interactive PPV/NPV calculator from
 * pooled LR+ and LR-.
 *
 * Pre-test odds × LR = post-test odds.
 * post-test prob = post-test odds / (1 + post-test odds).
 *
 * Fagan TJ. Letter: Nomogram for Bayes theorem. NEJM 1975;293:257.
 *
 * The panel uses pooled LR+ / LR- from the parent dta-bivariate.js
 * engine output. User can drag the pre-test probability slider to see
 * post-test PPV (positive test) and NPV (negative test) update.
 *
 * Auto-bootstrap; collapsed by default. DTA-only.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'fagan-nomogram-expanded';

  function parseCellsFromText(text) {
    if (!text) return null;
    const stripCommas = s => +String(s).replace(/,/g, '');
    const re = (label) => new RegExp('\\b' + label + '\\s*=\\s*(\\d{1,3}(?:,\\d{3})*|\\d+)', 'i');
    const grab = (label) => { const m = text.match(re(label)); return m ? stripCommas(m[1]) : null; };
    const TP = grab('TP'), FP = grab('FP'), FN = grab('FN'), TN = grab('TN');
    if (TP !== null && FP !== null && FN !== null && TN !== null) return { TP, FP, FN, TN };
    return null;
  }

  function pickDTATrials(rd) {
    const out = [];
    const ss = global._screeningStudies;
    if (Array.isArray(ss)) {
      ss.forEach(s => {
        if (!s || s.decision !== 'included') return;
        const cells = parseCellsFromText(s.rationale || '');
        if (cells && (cells.TP + cells.FN) > 0 && (cells.TN + cells.FP) > 0) {
          out.push({ name: s.studlab || '?', ...cells });
        }
      });
    }
    if (rd && out.length === 0) {
      Object.values(rd).forEach(t => {
        if (!t) return;
        const TP = +t.TP, FP = +t.FP, FN = +t.FN, TN = +t.TN;
        if ([TP,FP,FN,TN].every(v => Number.isFinite(v) && v >= 0) && (TP+FN) > 0 && (TN+FP) > 0) {
          out.push({ name: t.name || '?', TP, FP, FN, TN });
        }
      });
    }
    return out;
  }

  function pooledLRs(trials) {
    // Use engine if available
    const Eng = global.RapidMetaDTA;
    if (Eng && typeof Eng.fit === 'function') {
      try {
        const r = Eng.fit(trials);
        if (r && !r.error && Number.isFinite(+r.lr_pos) && Number.isFinite(+r.lr_neg) && Number.isFinite(+r.pooled_sens) && Number.isFinite(+r.pooled_spec)) {
          return { LRpos: +r.lr_pos, LRneg: +r.lr_neg, Se: +r.pooled_sens, Sp: +r.pooled_spec };
        }
      } catch (e) {}
    }
    // Fallback: independent univariate logit pool from cells
    let totalTP = 0, totalFN = 0, totalTN = 0, totalFP = 0;
    trials.forEach(t => {
      let TP = t.TP, FP = t.FP, FN = t.FN, TN = t.TN;
      if (TP === 0 || FN === 0 || TN === 0 || FP === 0) {
        TP += 0.5; FP += 0.5; FN += 0.5; TN += 0.5;
      }
      totalTP += TP; totalFN += FN; totalTN += TN; totalFP += FP;
    });
    const Se = totalTP / (totalTP + totalFN);
    const Sp = totalTN / (totalTN + totalFP);
    const LRpos = Sp < 1 ? Se / (1 - Sp) : 999;
    const LRneg = Sp > 0 ? (1 - Se) / Sp : 0;
    return { LRpos, LRneg, Se, Sp };
  }

  function buildBody(P, summary) {
    const fmt = P.fmt;
    let html = '';
    const { LRpos, LRneg, Se, Sp } = summary;

    html += '<div style="background:#0e2540;border:1px solid #1e3a5f;color:#cbd5e1;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
          + 'Pooled <strong style="color:#7dd3fc;">LR+ = ' + fmt(LRpos, 2) + '</strong> · '
          + '<strong style="color:#34d399;">LR− = ' + fmt(LRneg, 3) + '</strong>. '
          + 'Drag the pre-test probability slider to see how the post-test probabilities update. '
          + '<em style="color:#94a3b8;">PPV = positive test result; NPV-comp = 1 − negative test result.</em>'
          + '</div>';

    // Interactive controls — uses inline event handlers; the panel manages its own DOM
    html += '<div id="fagan-controls" style="margin-bottom:10px;display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:center;font-size:11px;">'
          + '<label for="fagan-prevalence" style="color:#cbd5e1;">Pre-test probability:</label>'
          + '<input id="fagan-prevalence" type="range" min="1" max="95" value="20" step="1" style="width:100%;" '
          +   'oninput="window.FaganNomogram.updateDisplay(this.value, ' + LRpos + ', ' + LRneg + ');">'
          + '<span id="fagan-prevalence-value" style="font-family:JetBrains Mono,monospace;color:#a78bfa;font-weight:700;font-size:13px;">20%</span>'
          + '<span style="color:#64748b;font-size:10px;">drag slider</span>'
          + '</div>';

    // Computed displays
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px;">';
    function cell(id, label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:8px 10px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div id="' + id + '" style="font-size:16px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    html += cell('fagan-ppv',  'PPV (test +)',  '—', 'P(disease | positive)');
    html += cell('fagan-1mnpv','1 − NPV (test −)', '—', 'P(disease | negative)');
    html += cell('fagan-ppv-shift', 'Δ from prior',  '—', 'PPV − pre-test');
    html += cell('fagan-npv-shift', 'Reduction',     '—', '(pre-test) − P(d | negative)');
    html += '</div>';

    // SVG nomogram (Fagan 1975-style)
    const W = 760, H = 320;
    const margin = { l: 80, r: 80, t: 20, b: 20 };
    const innerH = H - margin.t - margin.b;
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';

    // Three vertical axes: pre-test (left), LR (middle), post-test (right)
    const xL = margin.l, xM = W / 2, xR = W - margin.r;
    svg += '<line x1="' + xL + '" x2="' + xL + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#475569" stroke-width="2" />';
    svg += '<line x1="' + xM + '" x2="' + xM + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#475569" stroke-width="2" />';
    svg += '<line x1="' + xR + '" x2="' + xR + '" y1="' + margin.t + '" y2="' + (H - margin.b) + '" stroke="#475569" stroke-width="2" />';

    // Labels
    svg += '<text x="' + xL + '" y="14" fill="#94a3b8" font-size="10" text-anchor="middle">Pre-test prob</text>';
    svg += '<text x="' + xM + '" y="14" fill="#94a3b8" font-size="10" text-anchor="middle">Likelihood ratio</text>';
    svg += '<text x="' + xR + '" y="14" fill="#94a3b8" font-size="10" text-anchor="middle">Post-test prob</text>';

    // Tick marks: pre-test % (1, 5, 10, 20, 50, 80, 95) on a logit scale
    const ptMarks = [1, 5, 10, 20, 30, 50, 70, 80, 90, 95];
    const ptToY = p => {
      // logit transform: ln(p/(1-p))
      const lo = Math.log(0.01/0.99), hi = Math.log(0.99/0.01);
      const lp = Math.log(p/(100-p));
      return margin.t + (1 - (lp - lo) / (hi - lo)) * innerH;
    };
    ptMarks.forEach(p => {
      const y = ptToY(p);
      svg += '<line x1="' + (xL - 4) + '" x2="' + (xL + 4) + '" y1="' + y + '" y2="' + y + '" stroke="#94a3b8" />';
      svg += '<text x="' + (xL - 8) + '" y="' + y + '" fill="#94a3b8" font-size="9" text-anchor="end" dominant-baseline="central">' + p + '%</text>';
      svg += '<line x1="' + (xR - 4) + '" x2="' + (xR + 4) + '" y1="' + y + '" y2="' + y + '" stroke="#94a3b8" />';
      svg += '<text x="' + (xR + 8) + '" y="' + y + '" fill="#94a3b8" font-size="9" text-anchor="start" dominant-baseline="central">' + p + '%</text>';
    });

    // LR ticks (log scale): 0.001, 0.01, 0.1, 1, 10, 100, 1000
    const lrMarks = [0.001, 0.01, 0.1, 1, 10, 100, 1000];
    const lrToY = lr => {
      const lo = Math.log(1000), hi = Math.log(0.001);
      const ll = Math.log(lr);
      return margin.t + ((ll - lo) / (hi - lo)) * innerH;
    };
    lrMarks.forEach(lr => {
      const y = lrToY(lr);
      svg += '<line x1="' + (xM - 4) + '" x2="' + (xM + 4) + '" y1="' + y + '" y2="' + y + '" stroke="#94a3b8" />';
      svg += '<text x="' + (xM + 8) + '" y="' + y + '" fill="#94a3b8" font-size="9" dominant-baseline="central">' + lr + '</text>';
    });

    // Marker lines for pooled LR+ and LR-
    svg += '<g id="fagan-lrpos-line"></g>';
    svg += '<g id="fagan-lrneg-line"></g>';
    svg += '</svg>';
    html += svg;

    // Method note
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Method:</strong> Bayes\'s theorem on odds form. '
          + '<code>post-test odds = pre-test odds × LR</code>; <code>P = odds/(1+odds)</code>. '
          + 'Pooled LR+ from this review\'s engine: <strong>' + fmt(LRpos, 2) + '</strong> · LR−: <strong>' + fmt(LRneg, 3) + '</strong> '
          + '(pooled Se ' + fmt(Se*100, 1) + '%, Sp ' + fmt(Sp*100, 1) + '%). '
          + 'Fagan TJ. Nomogram for Bayes theorem. <em>NEJM</em> 1975;293:257. '
          + 'Useful for clinicians: visualises how strongly a test result shifts disease probability for a given patient prior.'
          + '</div>';

    return html;
  }

  // Public API for slider
  function updateDisplay(prevPct, LRpos, LRneg) {
    const prev = +prevPct / 100;
    const preOdds = prev / (1 - prev);
    const postOddsPos = preOdds * LRpos;
    const postProbPos = postOddsPos / (1 + postOddsPos);
    const postOddsNeg = preOdds * LRneg;
    const postProbNeg = postOddsNeg / (1 + postOddsNeg);
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('fagan-prevalence-value', prevPct + '%');
    set('fagan-ppv', (postProbPos * 100).toFixed(1) + '%');
    set('fagan-1mnpv', (postProbNeg * 100).toFixed(1) + '%');
    const ppvShift = (postProbPos - prev) * 100;
    const npvDrop = (prev - postProbNeg) * 100;
    set('fagan-ppv-shift', '+' + ppvShift.toFixed(1) + ' pp');
    set('fagan-npv-shift', '−' + npvDrop.toFixed(1) + ' pp');
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const trials = pickDTATrials(P.getRealData());
    if (trials.length < 2) return false;
    const summary = pooledLRs(trials);
    if (!summary) return false;
    const { LRpos, LRneg } = summary;
    const summaryStr = 'LR+ = ' + P.fmt(LRpos, 2) + ' · LR− = ' + P.fmt(LRneg, 3) + ' · interactive PPV/NPV';
    const panel = P.buildCollapsiblePanel({
      id: 'fagan-nomogram-panel', badge: 'Fagan nomogram',
      summary: summaryStr, bodyHtml: buildBody(P, summary), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('fagan-nomogram-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    // Initialise slider display
    setTimeout(() => updateDisplay(20, LRpos, LRneg), 50);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1750));
    } else { setTimeout(tick, 1750); }
  }

  global.FaganNomogram = { render, updateDisplay };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
