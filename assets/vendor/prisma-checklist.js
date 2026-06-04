/* PRISMA 2020 27-item checklist completeness.
 *
 * Reference: Page MJ et al. The PRISMA 2020 statement: an updated guideline
 * for reporting systematic reviews. BMJ 2021;372:n71.
 *
 * Each item: ✓ if engine detects evidence, ⚠ if reviewer attestation needed,
 *            ✗ if explicitly absent.
 *
 * Detection rules are conservative: an item is only ✓ when there's a
 * structural feature that proves it (a tab, a panel id, a populated array).
 * Soft items (registration, COI, funding) are ⚠ — reviewers MUST verify.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'prisma-checklist-expanded';

  const ITEMS = [
    // Title (1)
    { n: 1, sec: 'Title', text: 'Identify report as a systematic review',
      check: () => has(document.title, /(systematic|meta-analysis|review|NMA)/i) },
    // Abstract (2)
    { n: 2, sec: 'Abstract', text: 'Structured abstract',
      check: () => qs('section[id*="abstract"], div[id*="abstract"]') ? '✓' : '⚠' },
    // Introduction (3-4)
    { n: 3, sec: 'Introduction', text: 'Rationale',
      check: () => qs('#tab-protocol, [id*="background"], [id*="rationale"]') ? '✓' : '⚠' },
    { n: 4, sec: 'Introduction', text: 'Objectives (PICO)',
      check: () => detectPICO() },
    // Methods (5-15)
    { n: 5, sec: 'Methods', text: 'Eligibility criteria',
      check: () => qs('#tab-protocol, [id*="eligibility"], [id*="picos"], [id*="inclusion"]') ? '✓' : '⚠' },
    { n: 6, sec: 'Methods', text: 'Information sources',
      check: () => detectInfoSources() },
    { n: 7, sec: 'Methods', text: 'Search strategy',
      check: () => detectSearchStrategy() },
    { n: 8, sec: 'Methods', text: 'Selection process',
      check: () => qs('#tab-screening, #tab-prisma, [id*="prisma-flow"], [id*="selection"]') ? '✓' : '⚠' },
    { n: 9, sec: 'Methods', text: 'Data collection process',
      check: () => qs('#tab-extraction, [id*="extraction"]') ? '✓' : '⚠' },
    { n: 10, sec: 'Methods', text: 'Data items (outcomes & sources)',
      check: () => detectDataItems() },
    { n: 11, sec: 'Methods', text: 'Study risk of bias assessment',
      check: () => qs('[id*="rob"], [id*="risk-of-bias"], [id*="quadas"], [id*="cochrane-rob"]') ? '✓' : '⚠' },
    { n: 12, sec: 'Methods', text: 'Effect measures (OR, RR, MD, HR)',
      check: () => detectEffectMeasure() },
    { n: 13, sec: 'Methods', text: 'Synthesis methods',
      check: () => qs('#r-validation-badge, [id*="forest"], [id*="meta-analysis"]') ? '✓' : '⚠' },
    { n: 14, sec: 'Methods', text: 'Reporting bias assessment',
      check: () => qs('[id*="funnel"], [id*="egger"], [id*="publication-bias"]') ? '✓' : '⚠' },
    { n: 15, sec: 'Methods', text: 'Certainty assessment (GRADE)',
      check: () => qs('#grade-sof-panel, [id*="grade"]') ? '✓' : '⚠' },
    // Results (16-22)
    { n: 16, sec: 'Results', text: 'Study selection (PRISMA flow)',
      check: () => qs('#tab-prisma, [id*="prisma-flow"], [id*="prisma-diagram"]') ? '✓' : '⚠' },
    { n: 17, sec: 'Results', text: 'Study characteristics',
      check: () => qs('#tab-extraction, [id*="characteristics"], [id*="trials-table"]') ? '✓' : '⚠' },
    { n: 18, sec: 'Results', text: 'Risk of bias of studies',
      check: () => qs('[id*="rob-summary"], [id*="rob-traffic"], [id*="rob-table"]') ? '✓' : '⚠' },
    { n: 19, sec: 'Results', text: 'Results of individual studies',
      check: () => qs('[id*="forest"], [id*="study-results"]') ? '✓' : '⚠' },
    { n: 20, sec: 'Results', text: 'Results of syntheses (pooled effects)',
      check: () => qs('#r-validation-badge, [id*="forest"]') ? '✓' : '⚠' },
    { n: 21, sec: 'Results', text: 'Reporting biases',
      check: () => qs('[id*="funnel"], [id*="egger"]') ? '✓' : '⚠' },
    { n: 22, sec: 'Results', text: 'Certainty of evidence',
      check: () => qs('#grade-sof-panel, #grade-nma-comparison-panel') ? '✓' : '⚠' },
    // Discussion (23)
    { n: 23, sec: 'Discussion', text: 'Discussion / interpretation',
      check: () => qs('#tab-report, [id*="discussion"], [id*="conclusion"]') ? '✓' : '⚠' },
    // Other (24-27)
    { n: 24, sec: 'Other', text: 'Registration & protocol',
      check: () => '⚠ (verify PROSPERO/OSF registration)' },
    { n: 25, sec: 'Other', text: 'Support & funding',
      check: () => '⚠ (verify funding statement)' },
    { n: 26, sec: 'Other', text: 'Competing interests',
      check: () => '⚠ (verify COI declarations)' },
    { n: 27, sec: 'Other', text: 'Availability of data, code, materials',
      check: () => '⚠ (verify data/code availability)' },
  ];

  function qs(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
  function has(s, re) { return s && re.test(s) ? '✓' : '⚠'; }

  function detectPICO() {
    const rm = global.RapidMeta;
    if (rm && rm.state && rm.state.protocol) {
      const p = rm.state.protocol;
      if (p.pop || p.intervention || p.out) return '✓';
    }
    return qs('[id*="pico"], [id*="picos"]') ? '✓' : '⚠';
  }
  function detectInfoSources() {
    const text = document.body ? document.body.innerText : '';
    return /\b(PubMed|MEDLINE|EMBASE|CENTRAL|Cochrane|Web of Science|Scopus)\b/i.test(text) ? '✓' : '⚠';
  }
  function detectSearchStrategy() {
    return qs('[id*="search"], [id*="query"], [id*="strategy"]') ? '✓' : '⚠';
  }
  function detectDataItems() {
    const rd = global.PanelHelper && global.PanelHelper.getRealData ? global.PanelHelper.getRealData() : null;
    if (!rd) return '⚠';
    const trials = Object.values(rd);
    if (trials.length === 0) return '⚠';
    const t = trials[0];
    return (t.tE !== undefined || t.cE !== undefined || (t.allOutcomes && t.allOutcomes.length)) ? '✓' : '⚠';
  }
  function detectEffectMeasure() {
    const text = document.body ? document.body.innerText : '';
    return /\b(OR|RR|HR|MD|SMD|RD|odds ratio|risk ratio|hazard ratio|mean difference)\b/.test(text) ? '✓' : '⚠';
  }

  function score(items) {
    let pass = 0, warn = 0, fail = 0;
    items.forEach(it => {
      const r = it._result;
      if (r === '✓' || (typeof r === 'string' && r.startsWith('✓'))) pass++;
      else if (r === '✗' || (typeof r === 'string' && r.startsWith('✗'))) fail++;
      else warn++;
    });
    return { pass, warn, fail };
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;

    ITEMS.forEach(it => { try { it._result = it.check(); } catch (e) { it._result = '⚠'; } });
    const sc = score(ITEMS);
    const total = ITEMS.length;

    const summary = sc.pass + '/' + total + ' auto-verified · ' +
                    sc.warn + ' need attestation' + (sc.fail ? ' · ' + sc.fail + ' missing' : '');

    let body = '<div style="font-size:11px;color:#cbd5e1;line-height:1.5;">';
    body += '<div style="display:flex;gap:18px;margin-bottom:8px;font-family:JetBrains Mono,monospace;font-size:11.5px;">' +
            '<span style="color:#22c55e;">✓ ' + sc.pass + ' verified</span>' +
            '<span style="color:#fbbf24;">⚠ ' + sc.warn + ' attestation</span>' +
            (sc.fail ? '<span style="color:#ef4444;">✗ ' + sc.fail + ' missing</span>' : '') +
            '</div>';
    let lastSec = '';
    ITEMS.forEach(it => {
      if (it.sec !== lastSec) {
        body += '<div style="color:#7dd3fc;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin:6px 0 2px 0;">' + it.sec + '</div>';
        lastSec = it.sec;
      }
      const raw = it._result;
      const isPass = raw === '✓' || (typeof raw === 'string' && raw.startsWith('✓'));
      const isFail = raw === '✗' || (typeof raw === 'string' && raw.startsWith('✗'));
      const colour = isPass ? '#22c55e' : (isFail ? '#ef4444' : '#fbbf24');
      const glyph = isPass ? '✓' : (isFail ? '✗' : '⚠');
      const detail = (typeof raw === 'string' && raw.length > 1) ? raw.replace(/^[✓⚠✗]\s?/, '') : '';
      body += '<div style="display:flex;gap:8px;padding:2px 0;">' +
              '<span style="color:' + colour + ';font-weight:700;width:18px;flex:0 0 18px;text-align:center;">' + glyph + '</span>' +
              '<span style="color:#94a3b8;width:24px;flex:0 0 24px;font-family:JetBrains Mono,monospace;font-size:10.5px;">' + it.n + '</span>' +
              '<span style="color:#cbd5e1;flex:1;">' + it.text + (detail ? ' <span style="color:#64748b;font-size:10px;">— ' + detail + '</span>' : '') + '</span>' +
              '</div>';
    });
    body +=
      '<div style="margin-top:10px;font-size:10.5px;color:#64748b;line-height:1.5;">' +
      'Heuristic: ✓ = page contains structural feature attesting the item; ⚠ = reviewer must attest manually; ' +
      '✗ = engine confirms absent. Items 24–27 are ALWAYS ⚠ — these are author-supplied metadata. ' +
      'Reference: <a href="https://doi.org/10.1136/bmj.n71" style="color:#7dd3fc;text-decoration:none;">Page MJ et al. BMJ 2021;372:n71</a>.' +
      '</div></div>';

    const panel = P.buildCollapsiblePanel({
      id: 'prisma-checklist-panel',
      badge: 'PRISMA 2020 (27-item)',
      summary,
      bodyHtml: body,
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('prisma-checklist-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 2050));
    } else { setTimeout(tick, 2050); }
  }

  global.PRISMAChecklist = { render, ITEMS };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
