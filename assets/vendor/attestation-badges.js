/* attestation-badges.js — surface dual-screening + dual-extraction +
 * review-lock attestation as visible header badges next to the verdict.
 *
 * Reads existing schema (no new state):
 *   RapidMeta.state.trials[*].screenReview.confirmed
 *   RapidMeta.state.trials[*].screenReview.dualConfirmed (or two reviewer IDs)
 *   RapidMeta.state.trials[*].data.extractionSignoff.confirmed
 *   RapidMeta.state.trials[*].data.extractionSignoff.reviewer_a / reviewer_b
 *   RapidMeta.state.reviewLock.owner
 *
 * Renders three badges:
 *   1. SCREENED  — green if all included trials have screenReview.confirmed
 *                  by ≥2 reviewers; amber if single-reviewer; gray if none
 *   2. EXTRACTED — green if all trials have dual extractionSignoff;
 *                  amber if single; gray if none
 *   3. FROZEN    — green if reviewLock is set with timestamp; gray if not
 *
 * Public API:
 *   AttestationBadges.compute() → {screened, extracted, frozen, summary}
 *   AttestationBadges.render(container)
 */
(function (global) {
  'use strict';

  function safeNum(x) { return typeof x === 'number' ? x : 0; }

  function compute() {
    const state = (global.RapidMeta && global.RapidMeta.state) || {};
    const trials = Array.isArray(state.trials) ? state.trials : [];
    // Only count trials that are 'include' (or have screenReview confirmed include)
    const included = trials.filter(t => {
      const decision = (t && t.screenReview && t.screenReview.decision) || '';
      return decision === 'include' || (t && t.status === 'include') || (t && t.included);
    });
    const totalTrials = included.length || trials.length;

    // Screening
    let screenedSingle = 0, screenedDual = 0;
    trials.forEach(t => {
      const sr = (t && t.screenReview) || {};
      if (sr.confirmed) {
        const dual = sr.dualConfirmed || (sr.reviewer_a && sr.reviewer_b) ||
                     (Array.isArray(sr.reviewers) && sr.reviewers.length >= 2);
        if (dual) screenedDual++;
        else screenedSingle++;
      }
    });

    // Extraction
    let extractedSingle = 0, extractedDual = 0;
    trials.forEach(t => {
      const es = (t && t.data && t.data.extractionSignoff) || {};
      if (es.confirmed) {
        const dual = es.dualConfirmed || (es.reviewer_a && es.reviewer_b) ||
                     (Array.isArray(es.reviewers) && es.reviewers.length >= 2);
        if (dual) extractedDual++;
        else extractedSingle++;
      }
    });

    // Frozen
    const lock = state.reviewLock || {};
    const frozen = Boolean(lock.owner && lock.ts);

    // Tier per badge
    function tier(dual, single, total) {
      if (total === 0) return { tier: 'NONE', label: 'NO TRIALS', color: '#6b7280' };
      if (dual >= total) return { tier: 'DUAL', label: 'DUAL ✓', color: '#10b981' };
      if (dual + single >= total && dual > 0) return { tier: 'PARTIAL', label: 'PARTIAL', color: '#f59e0b' };
      if (single >= total) return { tier: 'SINGLE', label: 'SINGLE', color: '#f59e0b' };
      return { tier: 'NONE', label: 'NOT DONE', color: '#6b7280' };
    }

    // Living update — last run from RapidMeta.state.livingUpdates[]
    const updates = Array.isArray(state.livingUpdates) ? state.livingUpdates : [];
    const lastUpdate = updates.length ? updates[updates.length - 1] : null;
    const livingBadge = lastUpdate
      ? {
          tier: 'LIVING',
          color: '#22d3ee',
          label: 'LIVING ✓',
          sub: lastUpdate.ts ? lastUpdate.ts.slice(0, 10) : '',
          reviewerId: lastUpdate.reviewerId || '',
        }
      : { tier: 'NEVER', color: '#6b7280', label: 'NEVER', sub: 'Run living update' };

    return {
      totalTrials,
      screening: tier(screenedDual, screenedSingle, totalTrials),
      extraction: tier(extractedDual, extractedSingle, totalTrials),
      frozen: { tier: frozen ? 'FROZEN' : 'OPEN', color: frozen ? '#10b981' : '#6b7280',
                 label: frozen ? 'FROZEN ✓' : 'OPEN' },
      living: livingBadge,
      counts: { screenedSingle, screenedDual, extractedSingle, extractedDual,
                lockOwner: lock.owner || '', lockTs: lock.ts || '',
                livingRuns: updates.length, lastUpdateTs: lastUpdate ? lastUpdate.ts : '' },
    };
  }

  function makeBadge(label, tier, sub) {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'min-width:90px;background:rgba(0,0,0,0.25);border:1px solid ' + tier.color + ';border-radius:8px;' +
      'padding:6px 10px;font-family:ui-sans-serif,system-ui,sans-serif;';
    const top = document.createElement('div');
    top.style.cssText = 'font-size:10px;font-weight:700;color:' + tier.color + ';letter-spacing:0.06em;text-transform:uppercase;';
    top.textContent = label;
    const mid = document.createElement('div');
    mid.style.cssText = 'font-size:11px;color:' + tier.color + ';font-weight:600;margin-top:2px;';
    mid.textContent = tier.label;
    div.appendChild(top);
    div.appendChild(mid);
    if (sub) {
      const s = document.createElement('div');
      s.style.cssText = 'font-size:9px;color:#94a3b8;margin-top:2px;';
      s.textContent = sub;
      div.appendChild(s);
    }
    return div;
  }

  function render(container) {
    if (typeof container === 'string') {
      container = container.charAt(0) === '#'
        ? document.getElementById(container.slice(1))
        : document.getElementById(container) || document.querySelector(container);
    }
    if (!container) return;
    const r = compute();
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:stretch;margin:8px 0;';
    wrap.appendChild(makeBadge('Screened', r.screening,
      r.counts.screenedDual + '/' + r.totalTrials + ' dual'));
    wrap.appendChild(makeBadge('Extracted', r.extraction,
      r.counts.extractedDual + '/' + r.totalTrials + ' dual'));
    wrap.appendChild(makeBadge('Lock', r.frozen,
      r.frozen.tier === 'FROZEN' ? r.counts.lockOwner : '—'));
    wrap.appendChild(makeBadge('Living', r.living,
      r.living.tier === 'LIVING' ? (r.living.sub + ' ' + (r.living.reviewerId || '')) : '—'));
    container.appendChild(wrap);
  }

  /**
   * Render with auto-retry — RapidMeta.state.trials populates after init()
   * via localStorage restore, which can lag DOMContentLoaded by 100-500ms.
   * Retry every 500ms for up to 5s if totalTrials reads 0.
   */
  function renderWithRetry(container, attempts) {
    attempts = attempts || 0;
    render(container);
    if (attempts < 10) {
      const r = compute();
      if (r.totalTrials === 0) {
        setTimeout(function () { renderWithRetry(container, attempts + 1); }, 500);
      }
    }
  }

  global.AttestationBadges = { compute, render, renderWithRetry };

  // Auto-bind: when DOM ready, re-render once RapidMeta.state.trials populates.
  // (Belt-and-braces with the codemod-injected render call.)
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  ready(function () {
    var c = document.getElementById('attestationBadgesContainer');
    if (c) renderWithRetry(c);
  });
})(typeof window !== 'undefined' ? window : globalThis);
