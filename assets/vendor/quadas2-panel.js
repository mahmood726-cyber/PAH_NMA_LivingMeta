/* QUADAS-2 Risk-of-Bias panel for DTA reviews.
 *
 * Whiting PF et al. QUADAS-2: a revised tool for the quality assessment
 * of diagnostic accuracy studies. Ann Intern Med 2011;155:529–36.
 *
 * Four domains × two judgments (Risk of bias / Applicability concerns):
 *   1. Patient selection
 *   2. Index test
 *   3. Reference standard
 *   4. Flow and timing
 *
 * Auto-derivation per study from the rationale text + study metadata,
 * with reviewer-attest buttons (Low / High / Unclear) per domain.
 *
 * Auto-bootstrap; collapsed by default. Self-skips when no DTA studies
 * detected.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'quadas2-expanded';
  const ATTEST_KEY = 'quadas2-attest';

  const DOMAINS = [
    { id: 'selection', label: 'Patient selection',
      rob_q: 'Could the selection of patients have introduced bias?',
      app_q: 'Are there concerns that the included patients do not match the review question?' },
    { id: 'index',     label: 'Index test',
      rob_q: 'Could the conduct or interpretation of the index test have introduced bias?',
      app_q: 'Are there concerns that the index test, its conduct, or interpretation differ from the review question?' },
    { id: 'reference', label: 'Reference standard',
      rob_q: 'Could the reference standard, its conduct, or its interpretation have introduced bias?',
      app_q: 'Are there concerns that the target condition as defined by the reference standard does not match the review question?' },
    { id: 'flow',      label: 'Flow and timing',
      rob_q: 'Could the patient flow have introduced bias?',
      app_q: '— (n/a — flow has no applicability domain in QUADAS-2)' },
  ];

  function pickDTAStudies() {
    const ss = global._screeningStudies;
    if (Array.isArray(ss)) {
      return ss.filter(s => s && s.decision === 'included').map(s => ({
        name: s.studlab || '?',
        rationale: s.rationale || '',
        ref_std: s.ref_std || '',
        country: s.country || '',
        year: s.year || null,
      }));
    }
    return [];
  }

  // Heuristic auto-grade per domain. "Low" if rationale + metadata
  // strongly support; "Unclear" by default; "High" only when explicit
  // red flag in rationale.
  function autoGrade(study) {
    const text = (study.rationale + ' ' + study.ref_std).toLowerCase();
    const grades = {};
    // Selection
    if (/consecutive|prospective.*enroll|random sampl/.test(text)) grades.selection_rob = 'Low';
    else if (/case[\s-]?control|retrospective.*selected/.test(text)) grades.selection_rob = 'High';
    else grades.selection_rob = 'Unclear';
    grades.selection_app = 'Unclear';  // Always reviewer-judged
    // Index test
    if (/blinded.*interpret|blinded reading|masked reader/.test(text)) grades.index_rob = 'Low';
    else if (/unblinded|knew.*result|pre[\s-]?specified|not[\s-]?blinded/.test(text)) grades.index_rob = 'High';
    else grades.index_rob = 'Unclear';
    grades.index_app = 'Unclear';
    // Reference standard
    if (/lab(?:oratory)? RT[\s-]?PCR|culture.*gold|histopathology|MGIT|composite reference/.test(text)) grades.reference_rob = 'Low';
    else if (/clinical[\s-]?diagnosis|imaging.*reference|self[\s-]?report/.test(text)) grades.reference_rob = 'High';
    else grades.reference_rob = 'Unclear';
    grades.reference_app = 'Unclear';
    // Flow
    if (/all patients (?:received|underwent) (?:both )?the reference|same reference standard/.test(text)) grades.flow_rob = 'Low';
    else if (/excluded.*reference|differential[\s-]?verification|partial[\s-]?verification/.test(text)) grades.flow_rob = 'High';
    else grades.flow_rob = 'Unclear';
    return grades;
  }

  function getAttestation() {
    try { return JSON.parse(localStorage.getItem(ATTEST_KEY) || '{}'); } catch (e) { return {}; }
  }
  function setAttestation(studyName, key, level) {
    const all = getAttestation();
    all[studyName] = all[studyName] || {};
    all[studyName][key] = { level, ts: new Date().toISOString() };
    try { localStorage.setItem(ATTEST_KEY, JSON.stringify(all)); } catch (e) {}
  }

  function gradeColor(level) {
    if (level === 'Low') return { bg: '#0e3a1f', border: '#34d399', text: '#34d399', symbol: '+' };
    if (level === 'High') return { bg: '#3a0a0a', border: '#fca5a5', text: '#fca5a5', symbol: '−' };
    return { bg: '#3a2a0a', border: '#fbbf24', text: '#fbbf24', symbol: '?' };
  }

  function buildBody(P, studies) {
    const attest = getAttestation();
    let html = '';

    // Headline summary across all studies × all domains
    let lowN = 0, highN = 0, unclearN = 0;
    studies.forEach(s => {
      const auto = autoGrade(s);
      DOMAINS.forEach(d => {
        const robKey = d.id + '_rob';
        const attestRow = attest[s.name] || {};
        const finalLevel = attestRow[robKey]?.level || auto[robKey];
        if (finalLevel === 'Low') lowN++;
        else if (finalLevel === 'High') highN++;
        else unclearN++;
      });
    });
    const totalCells = studies.length * DOMAINS.length;
    let toneCol, toneBg, toneBorder, verdict;
    if (highN === 0) {
      toneCol = '#34d399'; toneBg = '#0e3a1f'; toneBorder = '#34d399';
      verdict = '✓ No "High" risk-of-bias domain across ' + studies.length + ' studies. ' + lowN + '/' + totalCells + ' Low; ' + unclearN + ' Unclear.';
    } else if (highN / totalCells > 0.25) {
      toneCol = '#fca5a5'; toneBg = '#3a0a0a'; toneBorder = '#7f1d1d';
      verdict = '⚠ ' + highN + '/' + totalCells + ' (' + Math.round(100*highN/totalCells) + '%) domain×study cells judged High RoB.';
    } else {
      toneCol = '#fbbf24'; toneBg = '#3a2a0a'; toneBorder = '#92400e';
      verdict = '⚠ ' + highN + '/' + totalCells + ' cells High RoB; ' + unclearN + ' Unclear (need reviewer attest).';
    }
    html += '<div style="background:' + toneBg + ';border:1px solid ' + toneBorder + ';color:' + toneCol + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
          + verdict + '</div>';

    // Traffic-light grid
    html += '<div style="overflow-x:auto;"><table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="background:#1e293b;color:#cbd5e1;">'
          + '<th style="padding:5px 8px;border:1px solid #334155;text-align:left;">Study</th>';
    DOMAINS.forEach(d => {
      html += '<th style="padding:5px 8px;border:1px solid #334155;text-align:center;font-size:10px;">' + d.label + ' (RoB)</th>';
    });
    DOMAINS.slice(0, 3).forEach(d => {
      html += '<th style="padding:5px 8px;border:1px solid #334155;text-align:center;font-size:10px;">' + d.label + ' (App)</th>';
    });
    html += '</tr></thead><tbody>';

    studies.forEach(s => {
      const auto = autoGrade(s);
      const attestRow = attest[s.name] || {};
      html += '<tr style="border-bottom:1px solid #1e293b;">';
      html += '<td style="padding:5px 8px;border:1px solid #1e293b;color:#e2e8f0;">' + s.name + '</td>';
      DOMAINS.forEach(d => {
        const key = d.id + '_rob';
        const finalLevel = attestRow[key]?.level || auto[key];
        const c = gradeColor(finalLevel);
        const isAttested = !!attestRow[key];
        html += '<td style="padding:3px 4px;border:1px solid #1e293b;text-align:center;background:' + c.bg + ';">'
              + '<span style="color:' + c.text + ';font-weight:700;font-size:13px;">' + c.symbol + '</span>'
              + '<div style="font-size:8.5px;color:' + c.text + ';">' + (isAttested ? 'attested' : 'auto') + '</div>'
              + '</td>';
      });
      DOMAINS.slice(0, 3).forEach(d => {
        const key = d.id + '_app';
        const finalLevel = attestRow[key]?.level || auto[key];
        const c = gradeColor(finalLevel);
        html += '<td style="padding:3px 4px;border:1px solid #1e293b;text-align:center;background:' + c.bg + ';">'
              + '<span style="color:' + c.text + ';font-weight:700;font-size:13px;">' + c.symbol + '</span>'
              + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // Method note + legend
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;">'
          + '<strong>Legend:</strong> '
          + '<span style="color:#34d399;font-weight:700;">+</span> Low risk · '
          + '<span style="color:#fca5a5;font-weight:700;">−</span> High risk · '
          + '<span style="color:#fbbf24;font-weight:700;">?</span> Unclear<br>'
          + 'Auto-grade is heuristic from rationale + reference-standard fields. Reviewer must verify and attest. '
          + 'Click any RoB cell to attest (planned in v0.2 — currently auto-only). '
          + 'QUADAS-2 (Whiting et al. <em>Ann Intern Med</em> 2011;155:529–36) is the standard RoB tool for diagnostic-accuracy reviews; '
          + '4 domains × {RoB, Applicability} except flow-and-timing which has no applicability question.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const studies = pickDTAStudies();
    if (studies.length < 2) return false;
    const attest = getAttestation();
    let lowN = 0, highN = 0, unclearN = 0;
    studies.forEach(s => {
      const auto = autoGrade(s);
      DOMAINS.forEach(d => {
        const k = d.id + '_rob';
        const lvl = (attest[s.name] || {})[k]?.level || auto[k];
        if (lvl === 'Low') lowN++; else if (lvl === 'High') highN++; else unclearN++;
      });
    });
    const totalCells = studies.length * DOMAINS.length;
    const summary = 'k=' + studies.length + ' · ' + lowN + ' Low / ' + highN + ' High / ' + unclearN + ' Unclear (RoB cells of ' + totalCells + ')';
    const panel = P.buildCollapsiblePanel({
      id: 'quadas2-panel', badge: 'QUADAS-2 RoB', summary,
      bodyHtml: buildBody(P, studies), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('quadas2-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1450));
    } else { setTimeout(tick, 1450); }
  }

  global.QUADAS2 = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
