/* Stats tab — moves the 9 analysis panels into a new tab in the
 * RapidMeta navigation, after "Scientific Output" / "Network Meta-Analysis".
 *
 * Detected page structure (consistent across all *_REVIEW.html):
 *   <nav class="...flex...">
 *     <button id="btn-tab-protocol" onclick="RapidMeta.switchTab('protocol')">1. Protocol</button>
 *     ...
 *     <button id="btn-tab-report" onclick="RapidMeta.switchTab('report')">6. Scientific Output</button>
 *     <button id="btn-tab-nma" onclick="RapidMeta.switchTab('nma')">5. Network Meta-Analysis</button>
 *   </nav>
 *   <section id="tab-protocol" class="tab-content ... hidden">…</section>
 *   <section id="tab-report" class="tab-content ... hidden">…</section>
 *   <section id="tab-nma" class="tab-content ... hidden">…</section>
 *
 * We add:
 *   <button id="btn-tab-statistics" onclick="RapidMeta.switchTab('statistics')">7. Statistics</button>
 *   <section id="tab-statistics" class="tab-content h-full p-8 overflow-y-auto hidden">…</section>
 *
 * The existing RapidMeta.switchTab implementation already toggles the
 * `hidden` class on every <section class="tab-content"> by id, so adding
 * one more pane Just Works — no override needed.
 *
 * After the tab is wired, the 9 analysis panel divs are reparented into
 * the new section. The legacy floating "Stats Suite" accordion is hidden.
 */
(function (global) {
  'use strict';

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
    'trial-integrity-panel',
    'bayesian-sensitivity-panel',
    'subgroup-interaction-panel',
    'rr-sensitivity-panel',
    'meta-regression-panel',
    'funnel-diagnostics-panel',
    'influence-diagnostics-panel',
    'continuous-outcome-panel',
    'inspect-sr-panel',
    'nma-forest-continuous-panel',
    'single-arm-proportion-panel',
    'dose-response-panel',
    'dta-bivariate-panel',
    'dta-forest-panel',
    'dta-funnel-panel',
    'quadas2-panel',
    'dose-stratified-panel',
    'single-arm-forest-panel',
    'single-arm-influence-panel',
    'nma-league-continuous-panel',
    'nma-sucra-panel',
    'fagan-nomogram-panel',
    'dose-spline-panel',
    'single-arm-cumulative-panel',
    'tau2-qprofile-panel',
    'pi-convention-panel',
    'grade-nma-comparison-panel',
    'prisma-checklist-panel',
    'meta-regression-permutation-panel',
    'grim-benford-panel',
    'r-validation-singlearm-panel',
    'r-validation-continuous-panel',
    'r-validation-nma-panel',
  ];

  function buildTabButton(referenceBtn) {
    const btn = document.createElement('button');
    btn.id = 'btn-tab-statistics';
    btn.className = referenceBtn.className;
    btn.setAttribute('onclick', "RapidMeta.switchTab('statistics')");
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-tab', 'statistics');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('aria-controls', 'tab-statistics');
    btn.innerHTML = '<i class="fa-solid fa-chart-line" style="margin-right:4px;"></i>Statistics';
    return btn;
  }

  function buildTabSection(referenceSection) {
    const sec = document.createElement('section');
    sec.id = 'tab-statistics';
    sec.className = referenceSection ? referenceSection.className : 'tab-content h-full p-8 overflow-y-auto hidden';
    if (sec.className.indexOf('hidden') < 0) sec.className += ' hidden';

    // Top heading inside the pane
    const heading = document.createElement('div');
    heading.style.cssText = 'margin-bottom:16px;';
    heading.innerHTML =
      '<h2 style="font-size:18px;font-weight:700;color:#f1f5f9;margin-bottom:4px;">Advanced Statistical Analyses</h2>' +
      '<p style="font-size:12.5px;color:#94a3b8;line-height:1.5;">' +
      'R metafor cross-validation; reviewer-attestable GRADE Summary of Findings; ' +
      'Number Needed to Treat; leave-one-out / Baujat outlier diagnostics; ' +
      'cumulative meta-analysis; Trial Sequential Analysis; ' +
      'and (NMA only) per-comparison league table + forest plot. ' +
      'Each panel is independently collapsible.' +
      '</p>';
    sec.appendChild(heading);

    // Container the panels will be moved into
    const host = document.createElement('div');
    host.id = 'stats-tab-host';
    host.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    sec.appendChild(host);

    return sec;
  }

  function ensureTab() {
    // Already done?
    if (document.getElementById('btn-tab-statistics') && document.getElementById('tab-statistics')) return true;

    const buttons = Array.from(document.querySelectorAll('button[onclick*="switchTab"]'));
    if (buttons.length === 0) return false;

    const referenceBtn = buttons[buttons.length - 1];
    const nav = referenceBtn.parentElement;
    if (!nav) return false;

    if (!document.getElementById('btn-tab-statistics')) {
      const btn = buildTabButton(referenceBtn);
      nav.appendChild(btn);
    }

    if (!document.getElementById('tab-statistics')) {
      // Reference section: any existing tab-content with same parent
      const referenceSection = document.querySelector('section.tab-content');
      const sec = buildTabSection(referenceSection);
      const parent = referenceSection ? referenceSection.parentNode : document.body;
      // Insert as the last child of the tab-content parent
      const lastSection = parent.querySelector('section.tab-content:last-of-type');
      if (lastSection && lastSection.parentNode === parent) {
        parent.insertBefore(sec, lastSection.nextSibling);
      } else {
        parent.appendChild(sec);
      }
    }

    return true;
  }

  function reparentPanels() {
    const host = document.getElementById('stats-tab-host');
    if (!host) return 0;
    let moved = 0;
    PANEL_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentNode !== host) {
        host.appendChild(el);
        el.style.margin = '4px 0';
        moved++;
      }
    });
    return moved;
  }

  function hideLegacySuite() {
    const suite = document.getElementById('advanced-stats-suite');
    if (suite) suite.style.display = 'none';
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;

    function tick() {
      if (ensureTab()) {
        reparentPanels();
        hideLegacySuite();
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        let n = 0;
        const interval = setInterval(() => {
          tick();
          n++;
          if (n > 30) clearInterval(interval);
        }, 250);
      });
    } else {
      let n = 0;
      const interval = setInterval(() => {
        tick();
        n++;
        if (n > 30) clearInterval(interval);
      }, 250);
    }

    // Catch panels added later (e.g. on attestation re-render)
    const observer = new MutationObserver(() => {
      reparentPanels();
      hideLegacySuite();
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  }

  global.StatsTab = {
    refresh: () => { ensureTab(); reparentPanels(); hideLegacySuite(); },
  };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
