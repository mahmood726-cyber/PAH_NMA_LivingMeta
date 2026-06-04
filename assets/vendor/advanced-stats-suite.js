/* Advanced Statistics Suite — master accordion that consolidates all 9
 * analysis panels (R metafor, NNT, leave-one-out, GRADE-SoF, cumulative MA,
 * Baujat, TSA, NMA League, NMA Forest) into a single ~31 px collapsed row.
 *
 * Reduces vertical screen real estate consumed at the top of every review,
 * keeping RapidMeta tabs (screening, extraction, analysis, output) visible
 * without scrolling.
 *
 * Mechanism:
 *   1. Creates suite container right where the R metafor badge currently lives
 *   2. Re-parents the 9 individual panel divs into the suite body as they
 *      render
 *   3. Inline summary in the suite header refreshes as panels populate,
 *      surfacing top-3 most informative one-liners
 *   4. Master collapse persists in localStorage
 *
 * Each individual panel keeps its own collapse state — clicking the master
 * just shows/hides the whole stack.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'advanced-stats-suite-expanded';

  const PANEL_IDS = [
    'r-validation-badge',
    'nnt-panel',
    'leave-one-out-panel',
    'grade-sof-panel',
    'cumulative-ma-panel',
    'baujat-plot-panel',
    'tsa-panel',
    'nma-league-table-panel',
    'nma-forest-all-treatments-panel',
  ];

  function isExpanded() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
  }
  function setExpanded(v) {
    try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch (e) {}
  }

  function ensureSuite() {
    let suite = document.getElementById('advanced-stats-suite');
    if (suite) return suite;

    suite = document.createElement('div');
    suite.id = 'advanced-stats-suite';
    suite.style.cssText = [
      'background:#0f172a',
      'border:1px solid #334155',
      'border-radius:10px',
      'padding:6px 10px',
      'margin:10px 0',
      'font-family:Inter,system-ui,sans-serif',
      'font-size:12px',
      'color:#e2e8f0',
      'box-shadow:0 0 0 1px rgba(99,102,241,0.06)',
    ].join(';');

    const expanded = isExpanded();

    const head = document.createElement('div');
    head.id = 'advanced-stats-suite-head';
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer;user-select:none;';
    head.title = 'Click to ' + (expanded ? 'collapse' : 'expand') + ' analysis suite';
    head.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">' +
        '<span class="suite-arrow" style="display:inline-block;width:14px;color:#a78bfa;font-size:10px;transition:transform 0.15s;transform:rotate(' + (expanded ? 90 : 0) + 'deg);">▶</span>' +
        '<span style="background:#312e81;color:#c4b5fd;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:0.04em;flex:0 0 auto;">Stats Suite</span>' +
        '<span class="suite-count" style="color:#94a3b8;font-size:11px;flex:0 0 auto;">…</span>' +
        '<span class="suite-summary" style="color:#cbd5e1;font-family:JetBrains Mono,monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">loading…</span>' +
      '</div>';
    suite.appendChild(head);

    const body = document.createElement('div');
    body.id = 'advanced-stats-suite-body';
    body.style.cssText = 'display:' + (expanded ? 'block' : 'none') + ';margin-top:8px;padding-top:8px;border-top:1px solid #1e293b;';
    suite.appendChild(body);

    head.addEventListener('click', () => {
      const isOpen = body.style.display === 'block';
      body.style.display = isOpen ? 'none' : 'block';
      const arrow = head.querySelector('.suite-arrow');
      if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
      head.title = 'Click to ' + (isOpen ? 'expand' : 'collapse') + ' analysis suite';
      setExpanded(!isOpen);
    });

    // Insert at the natural badge spot — try after first H1, else top of body
    const target = document.querySelector('h1') || document.body.firstElementChild;
    if (target && target.parentNode) {
      target.parentNode.insertBefore(suite, target.nextSibling);
    } else {
      document.body.insertBefore(suite, document.body.firstChild);
    }
    return suite;
  }

  function reparentPanels() {
    const suite = ensureSuite();
    const body = document.getElementById('advanced-stats-suite-body');
    let moved = 0;
    PANEL_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentNode !== body) {
        body.appendChild(el);
        // Tighten the panel's own padding/margin since it's now nested
        el.style.margin = '6px 0';
        moved++;
      }
    });
    return moved;
  }

  function refreshSummary() {
    const suite = document.getElementById('advanced-stats-suite');
    if (!suite) return;
    const head = suite.querySelector('#advanced-stats-suite-head');
    if (!head) return;

    const body = document.getElementById('advanced-stats-suite-body');
    const count = body ? body.children.length : 0;

    // Build summary from priority order
    const bits = [];
    function pickSummary(id) {
      const el = document.getElementById(id);
      if (!el) return null;
      const inner = el.querySelector('div');
      if (!inner) return null;
      const text = (inner.innerText || '').replace(/[\r\n]+/g, ' ').trim();
      return text || null;
    }
    // Pull headline from R metafor first, then critical alerts
    const rText = pickSummary('r-validation-badge');
    if (rText) {
      const m = rText.match(/OR [\d.]+ \[[\d.]+–[\d.]+\][^·]*· k=\d+/);
      if (m) bits.push(m[0].trim());
    }
    // Critical alerts: leave-one-out flips, baujat outliers, TSA conclusive
    const alerts = [];
    const looText = pickSummary('leave-one-out-panel') || '';
    if (/flip significance/.test(looText)) alerts.push('⚠ L1O flip');
    else if (/driver trial/.test(looText)) alerts.push('⚠ L1O driver');
    const baujatText = pickSummary('baujat-plot-panel') || '';
    if (/outlier candidate/.test(baujatText)) alerts.push('⚠ Baujat outlier');
    const tsaText = pickSummary('tsa-panel') || '';
    if (/conclusive/.test(tsaText)) alerts.push('TSA ✓');
    else if (/inconclusive/.test(tsaText)) alerts.push('TSA inconclusive');
    bits.push(...alerts);

    const summaryEl = head.querySelector('.suite-summary');
    const countEl = head.querySelector('.suite-count');
    if (summaryEl) summaryEl.textContent = bits.length ? bits.join(' · ') : '(panels loading)';
    if (countEl) countEl.textContent = '(' + count + ')';
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;

    function tick() {
      reparentPanels();
      refreshSummary();
    }

    // Initial setup early — create the container so panels can land in it
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        ensureSuite();
        // Re-sweep over time as panels stream in
        let n = 0;
        const interval = setInterval(() => {
          tick();
          n++;
          if (n > 30) clearInterval(interval);
        }, 250);
      });
    } else {
      ensureSuite();
      let n = 0;
      const interval = setInterval(() => {
        tick();
        n++;
        if (n > 30) clearInterval(interval);
      }, 250);
    }

    // Observe future panel changes (e.g. GRADE-SoF re-renders on attest)
    const observer = new MutationObserver(() => {
      reparentPanels();
      refreshSummary();
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: false });
  }

  global.AdvancedStatsSuite = {
    refresh: () => { reparentPanels(); refreshSummary(); },
    expand: () => {
      const body = document.getElementById('advanced-stats-suite-body');
      if (body) {
        body.style.display = 'block';
        const arrow = document.querySelector('#advanced-stats-suite-head .suite-arrow');
        if (arrow) arrow.style.transform = 'rotate(90deg)';
        setExpanded(true);
      }
    },
    collapse: () => {
      const body = document.getElementById('advanced-stats-suite-body');
      if (body) {
        body.style.display = 'none';
        const arrow = document.querySelector('#advanced-stats-suite-head .suite-arrow');
        if (arrow) arrow.style.transform = 'rotate(0deg)';
        setExpanded(false);
      }
    },
  };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
