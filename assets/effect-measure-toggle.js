/* RapidMeta — Effect-Measure toggle (P0-1 fix)
 *
 * Ships as a sibling of webr-validator.js; loaded by each *_REVIEW.html with a single
 * <script src="effect-measure-toggle.js" defer></script> tag. Zero cost at page load
 * beyond the 3-KB download; no network calls.
 *
 * Purpose
 * -------
 * The app's native pooler computes OR or RR from 2x2 event counts depending on the
 * `RapidMeta.state.effectMeasure` setting. For binary-outcome trials with high event
 * rates (ACR20, BICLA, clinical remission, IGA 0/1, PASI 90) the published literature
 * reports adjusted OR from logistic regression while the app's AUTO resolver defaults
 * to RR. This causes a scale-mismatch in 8 apps that peer reviewers will flag.
 *
 * Fix: a user-visible toggle (AUTO / OR / RR / HR) above the analysis results card.
 * Clicking a scale sets RapidMeta.state.effectMeasure and re-runs AnalysisEngine.run().
 * No mutation of the app's existing pooling code.
 */
(function () {
  'use strict';

  const SCALES = ['AUTO', 'OR', 'RR', 'HR'];

  // RapidMeta is declared with `const` at module scope in the app's inline script.
  // A tiny RM-BRIDGE inline <script> at end-of-body copies it onto window so
  // CSP-restricted sibling files can reach it without eval. We also keep an
  // eval fallback for environments where the bridge has not run yet.
  function getRM() {
    if (window.RapidMeta) return window.RapidMeta;
    try { return (0, eval)('RapidMeta'); } catch (e) { return null; }
  }
  function getAE() {
    if (window.AnalysisEngine) return window.AnalysisEngine;
    try { return (0, eval)('AnalysisEngine'); } catch (e) { return null; }
  }

  function currentScale() {
    const rm = getRM();
    return (rm && rm.state && rm.state.effectMeasure) || 'AUTO';
  }

  function setScale(s) {
    const rm = getRM();
    if (!rm || !rm.state) return;
    rm.state.effectMeasure = s;
    try { if (typeof rm.save === 'function') rm.save(); } catch (e) {}
    const ae = getAE();
    try { if (ae && typeof ae.run === 'function') ae.run(); } catch (e) {}
    render();
  }

  function currentResolvedScale() {
    try {
      const rm = getRM();
      const r = rm && typeof rm.resolveEffectMeasure === 'function'
        ? rm.resolveEffectMeasure({})
        : null;
      return r ? r.effective : '';
    } catch (e) { return ''; }
  }

  function render() {
    const host = document.getElementById('effect-measure-toggle');
    if (!host) return;
    const cur = currentScale();
    const resolved = currentResolvedScale();
    host.innerHTML =
      '<div class="text-[10px] font-bold uppercase tracking-widest text-sky-300 mb-2 flex items-center flex-wrap gap-2">' +
      '<i class="fa-solid fa-scale-balanced mr-1"></i>Effect measure' +
      '<span class="text-slate-500 font-normal normal-case text-[9px]">(toggle to view the same pool on a different scale)</span>' +
      (cur === 'AUTO' && resolved ? '<span class="text-emerald-300 font-normal normal-case text-[9px]">auto resolved to <b>' + resolved + '</b></span>' : '') +
      '</div>' +
      '<div class="flex flex-wrap gap-2">' +
      SCALES.map(function (s) {
        const isActive = s === cur;
        const classes = isActive
          ? 'text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full bg-sky-500/30 border border-sky-400/60 text-sky-100 shadow-sm'
          : 'text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full bg-slate-800/50 border border-slate-600/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200 transition';
        return '<button type="button" data-emt-scale="' + s + '" class="' + classes + '">' + s + '</button>';
      }).join('') +
      '</div>';
    // Event delegation happens at the document level below; no per-button listeners here.
  }

  function injectUI() {
    if (document.getElementById('effect-measure-toggle')) { render(); return; }
    const analysisTab = document.getElementById('tab-analysis');
    if (!analysisTab) return;
    const card = document.createElement('div');
    card.id = 'effect-measure-toggle';
    card.className = 'mt-4 mb-4 p-3 rounded-lg border border-sky-500/20 bg-sky-500/5';
    // Insert near the top of the analysis tab (before the first results card)
    const firstCard = analysisTab.querySelector('.grid') || analysisTab.firstElementChild;
    if (firstCard && firstCard.parentNode === analysisTab) {
      analysisTab.insertBefore(card, firstCard);
    } else {
      analysisTab.insertBefore(card, analysisTab.firstChild);
    }
    render();
  }

  function tryInject() {
    injectUI();
    let tries = 0;
    const iv = setInterval(function () {
      injectUI();
      if (document.getElementById('effect-measure-toggle') || ++tries > 20) clearInterval(iv);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }

  // Event delegation using CAPTURE phase so the app's inner handlers cannot
  // stopPropagation() on us. Registered once at script load; survives any
  // number of card re-renders.
  document.addEventListener('click', function (e) {
    const btn = e.target.closest && e.target.closest('[data-emt-scale]');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      setScale(btn.getAttribute('data-emt-scale'));
      return;
    }
    // Also re-inject when the user switches into the Analysis tab.
    const anchor = e.target.closest && e.target.closest('[onclick*="switchTab"], [data-tab="analysis"]');
    if (anchor) setTimeout(function () { injectUI(); render(); }, 250);
  }, true); // <-- capture phase

  // MutationObserver: if the app's re-render wipes out our card, re-inject it.
  const mo = new MutationObserver(function () {
    const analysisTab = document.getElementById('tab-analysis');
    if (!analysisTab) return;
    // Only re-inject if the analysis tab is visible and our card has been removed.
    const visible = analysisTab.offsetParent !== null
      || (analysisTab.className || '').indexOf('hidden') === -1;
    if (visible && !document.getElementById('effect-measure-toggle')) injectUI();
  });
  (function armObserver() {
    const host = document.getElementById('tab-analysis');
    if (host) {
      mo.observe(host, { childList: true, subtree: false });
    } else {
      setTimeout(armObserver, 500);
    }
  })();
})();
