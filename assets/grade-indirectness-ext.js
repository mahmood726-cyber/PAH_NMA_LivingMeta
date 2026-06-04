/* RapidMeta — GRADE Pre-Specified Downgrades from Benchmark JSON (P0-2 fix)
 *
 * Ships as a sibling file; loaded by each *_REVIEW.html with one <script src> tag.
 * On first visit to the Analysis tab it fetches PUBLISHED_META_BENCHMARKS.json,
 * looks up the current app's filename, and injects a visible GRADE-downgrade card
 * showing the pre-specified indirectness / surrogate / self-reference flags.
 *
 * Why
 * ---
 * The PUBLISHED_META_BENCHMARKS.json carries 3 flags per app that the peer reviewer
 * cares about:
 *    pool_type          : "same_drug" | "class_level"
 *    surrogate_endpoint : boolean
 *    benchmark_type     : "external_IPD" | "external_aggregate" | "self_reference"
 *
 * Until now these flags lived only in the JSON. The app's visible GRADE card did not
 * show a pre-specified indirectness downgrade for class-level pools or surrogate
 * endpoints, so a reader looking at the Analysis tab saw "Indirectness: NOT SERIOUS"
 * even for a 3-agent class pool like the IL-23 psoriasis review.
 *
 * This shared JS reads the JSON at runtime (same origin, no CORS issue on GitHub
 * Pages) and appends a visible amber card to the Analysis tab with the pre-specified
 * downgrades. Does not mutate the app's existing GRADE renderer.
 */
(function () {
  'use strict';

  let benchmarksCache = null;
  let injected = false;

  async function loadBenchmarks() {
    if (benchmarksCache) return benchmarksCache;
    try {
      const r = await fetch('PUBLISHED_META_BENCHMARKS.json', { cache: 'no-store' });
      if (!r.ok) return null;
      const data = await r.json();
      benchmarksCache = data.benchmarks || {};
      return benchmarksCache;
    } catch (e) { return null; }
  }

  function currentAppKey() {
    const p = window.location.pathname.split('/').pop() || '';
    return decodeURIComponent(p);
  }

  async function inject() {
    if (injected || document.getElementById('grade-ext-card')) return;
    const host = document.getElementById('tab-analysis');
    if (!host) return;
    const bench = await loadBenchmarks();
    if (!bench) return;
    const key = currentAppKey();
    const entry = bench[key];
    if (!entry) return;

    const notes = [];
    if (entry.pool_type === 'class_level') {
      notes.push({
        level: 'serious',
        label: 'Indirectness: SERIOUS',
        sub: 'class-level pool',
        detail: entry.indirectness_note || 'Pool combines multiple distinct active agents under a shared class label. Product-specific inference is preferred.',
      });
    }
    if (entry.surrogate_endpoint) {
      notes.push({
        level: 'serious',
        label: 'Indirectness: SERIOUS',
        sub: 'surrogate endpoint',
        detail: entry.surrogate_note || 'Primary outcome is a regulatory surrogate; additional indirectness downgrade applies for the surrogate -> clinical-outcome step.',
      });
    }
    if (entry.comparator_heterogeneity) {
      notes.push({
        level: 'note',
        label: 'Subgroup pre-specified',
        sub: 'comparator heterogeneity',
        detail: entry.subgroup_prespecified || 'Pool mixes placebo-controlled and active-controlled arms; pre-specified subgroup analysis on comparator type should be reported alongside the primary pool.',
      });
    }
    if (entry.timepoint_heterogeneity) {
      notes.push({
        level: 'note',
        label: 'Timepoint harmonisation',
        sub: 'primary-outcome timepoint differs across trials',
        detail: entry.timepoint_harmonisation_note || 'Primary pool uses the shortest common timepoint; longer timepoints reported as sensitivity.',
      });
    }
    if (entry.benchmark_type === 'self_reference') {
      notes.push({
        level: 'muted',
        label: 'Benchmark type: self-reference',
        sub: 'no external IPD/aggregate MA at protocol freeze',
        detail: "App's own DL random-effects pool is the reference; no external meta-analysis with a matching trial set exists at protocol freeze. This is transparently flagged so the framework-paper validation statistic only credits externally-benchmarked apps.",
      });
    } else if (entry.benchmark_type === 'external_IPD') {
      notes.push({
        level: 'good',
        label: 'Benchmark type: external IPD',
        sub: 'gold-standard cross-validation available',
        detail: 'App pool can be validated against an externally-published individual-patient-data meta-analysis; see PUBLISHED_META_BENCHMARKS.json source field.',
      });
    } else if (entry.benchmark_type === 'external_aggregate') {
      notes.push({
        level: 'good',
        label: 'Benchmark type: external aggregate MA',
        sub: 'cross-validation available',
        detail: 'App pool can be validated against an externally-published aggregate-data meta-analysis; see PUBLISHED_META_BENCHMARKS.json source field.',
      });
    }
    if (notes.length === 0) { injected = true; return; }

    const card = document.createElement('div');
    card.id = 'grade-ext-card';
    card.className = 'mt-4 p-4 rounded-xl border border-amber-500/40 bg-amber-500/5';
    card.innerHTML =
      '<div class="text-[11px] font-bold uppercase tracking-widest text-amber-300 mb-3"><i class="fa-solid fa-list-check mr-2"></i>Pre-specified GRADE downgrades &amp; benchmark type' +
      ' <span class="text-slate-500 font-normal normal-case text-[9px] ml-1">(from PUBLISHED_META_BENCHMARKS.json)</span></div>' +
      notes.map(function (n) {
        const badgeCls = n.level === 'serious'
          ? 'bg-rose-500/20 border-rose-400/40 text-rose-200'
          : (n.level === 'note'
              ? 'bg-amber-500/20 border-amber-400/40 text-amber-200'
              : (n.level === 'good'
                  ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                  : 'bg-slate-500/20 border-slate-400/40 text-slate-300'));
        return '<div class="mb-3 last:mb-0 pb-3 last:pb-0 last:border-0 border-b border-amber-500/10">'
          + '<div class="flex items-center flex-wrap gap-2 mb-1">'
          +   '<span class="inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ' + badgeCls + '">' + n.label + '</span>'
          +   '<span class="text-[10px] text-slate-400 italic">' + n.sub + '</span>'
          + '</div>'
          + '<div class="text-xs text-slate-300 leading-relaxed">' + n.detail + '</div>'
          + '</div>';
      }).join('') +
      '<div class="text-[10px] text-slate-500 mt-3 italic">Flags are pre-registered in the benchmark metadata; authors should reflect these downgrades in the GRADE profile and Summary of Findings table of the submitted manuscript.</div>';
    host.appendChild(card);
    injected = true;
  }

  function tryInject() {
    inject();
    let tries = 0;
    const iv = setInterval(function () {
      inject();
      if (injected || ++tries > 20) clearInterval(iv);
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }

  // Re-inject when the user first opens the Analysis tab
  document.addEventListener('click', function (e) {
    const anchor = e.target.closest('[onclick*="switchTab"], [data-tab="analysis"]');
    if (anchor) setTimeout(function () {
      if (!document.getElementById('grade-ext-card')) { injected = false; inject(); }
    }, 300);
  });
})();
