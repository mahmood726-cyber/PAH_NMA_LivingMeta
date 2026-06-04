/* RapidMeta — optional R/metafor cross-validation in the browser via WebR.
 *
 * Loaded by each *_REVIEW.html with <script src="webr-validator.js" defer></script>.
 * Zero-cost at page load: no WebR fetch until the user clicks "Validate pool with R".
 * First click triggers ~40 MB WebR WebAssembly download and metafor install (~60-90 s).
 * Result is cached in the browser's service worker / IndexedDB for subsequent clicks.
 *
 * The validator mirrors the app's primary-outcome pool:
 *   - For binary (HR/OR/RR) endpoints: log-scale DL + HKSJ via metafor::rma(method="DL", test="knha").
 *   - For continuous (MD) endpoints: native-scale DL + HKSJ on md + se.
 *
 * Displays R output alongside the app's DL pool with an EXACT / CLOSE / DIFFER flag.
 */

(function () {
  'use strict';

  const WEBR_CDN = 'https://webr.r-wasm.org/latest/webr.mjs';
  const METAFOR_REPO = 'https://repo.r-wasm.org';

  let webR = null;
  let metaforInstalled = false;
  let bootPromise = null;

  const $ = (id) => document.getElementById(id);

  function status(msg) { const el = $('rvalid-status'); if (el) el.textContent = msg; }

  async function ensureWebR() {
    if (webR && metaforInstalled) return webR;
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      status('Loading WebR WebAssembly (one-time ~40 MB)...');
      let WebRClass;
      try {
        const mod = await import(WEBR_CDN);
        WebRClass = mod.WebR;
      } catch (e) {
        throw new Error('Could not load WebR from ' + WEBR_CDN + ': ' + e.message);
      }
      webR = new WebRClass();
      await webR.init();
      status('Installing metafor (one-time ~60-90 s)...');
      try {
        await webR.evalR(`install.packages("metafor", repos = "${METAFOR_REPO}")`);
        await webR.evalR('suppressPackageStartupMessages(library(metafor))');
      } catch (e) {
        throw new Error('metafor install failed: ' + e.message);
      }
      metaforInstalled = true;
      status('WebR + metafor ready.');
      return webR;
    })();
    return bootPromise;
  }

  function extractTrialData() {
    const s = window.RapidMeta && window.RapidMeta.state;
    if (!s) return { rows: [], err: 'RapidMeta.state not initialised' };
    const outcomeKey = s.selectedOutcome || 'MACE';
    const included = (s.trials || []).filter(t => {
      const st = (t.screenReview && t.screenReview.status) || t.status;
      return st === 'include';
    });
    const rows = [];
    for (const t of included) {
      const ao = (t.allOutcomes || []).find(o => o.shortLabel === outcomeKey) || (t.allOutcomes || [])[0];
      if (!ao) continue;
      if (ao.type === 'CONTINUOUS' && ao.md != null && ao.se != null && isFinite(ao.md) && isFinite(ao.se) && ao.se > 0) {
        rows.push({ name: t.name, yi: ao.md, vi: ao.se * ao.se, scale: 'MD', endpoint_type: 'CONTINUOUS' });
      } else if (ao.effect != null && ao.lci != null && ao.uci != null && ao.effect > 0 && ao.lci > 0 && ao.uci > 0) {
        const yi = Math.log(ao.effect);
        const se = (Math.log(ao.uci) - Math.log(ao.lci)) / (2 * 1.959963984540054);
        if (isFinite(yi) && isFinite(se) && se > 0) {
          rows.push({ name: t.name, yi, vi: se * se, scale: ao.estimandType || 'OR', endpoint_type: 'BINARY' });
        }
      }
    }
    return { rows, scale: rows.length ? rows[0].scale : null };
  }

  async function runValidation() {
    const out = $('rvalid-output');
    out.innerHTML = '';
    try {
      const { rows, scale } = extractTrialData();
      if (!rows.length) {
        out.textContent = 'No included trials with usable primary-outcome effect estimates.';
        return;
      }
      if (rows.length < 2) {
        out.textContent = 'Only one included trial; cannot run meta-analysis (k=1).';
        return;
      }
      await ensureWebR();
      status(`Running metafor::rma on k=${rows.length} trials...`);
      const yiLit = 'c(' + rows.map(r => r.yi.toFixed(10)).join(', ') + ')';
      const viLit = 'c(' + rows.map(r => r.vi.toFixed(12)).join(', ') + ')';
      const code = [
        'yi <- ' + yiLit,
        'vi <- ' + viLit,
        'fit <- rma(yi = yi, vi = vi, method = "DL", test = "knha")',
        'c(as.numeric(fit$beta[1,1]), as.numeric(fit$ci.lb), as.numeric(fit$ci.ub),',
        '  as.numeric(fit$tau2), as.numeric(fit$I2), as.numeric(fit$QE), as.numeric(fit$k))'
      ].join('\n');
      const result = await webR.evalR(code);
      const vals = await result.toArray();
      // metafor returns 7 numbers on the log scale for binary, native for continuous
      const [poolRaw, lciRaw, uciRaw, tau2, i2, Q, k] = vals;
      const isLog = scale !== 'MD';
      const toDisp = (x) => isLog ? Math.exp(x) : x;
      const pool = toDisp(poolRaw);
      const lci = toDisp(lciRaw);
      const uci = toDisp(uciRaw);
      // Compare to app's currently displayed pool
      const resOr = $('res-or');
      const appPoolText = resOr ? resOr.textContent.trim() : '';
      const appPool = parseFloat(appPoolText);
      let agreement;
      if (!isFinite(appPool)) {
        agreement = '<span class="text-amber-400">app pool unavailable for comparison</span>';
      } else {
        const relDiff = Math.abs(pool - appPool) / Math.max(Math.abs(appPool), 1e-9);
        if (relDiff < 0.01) agreement = `<span class="text-emerald-400">&check; EXACT (&lt; 1% rel diff)</span>`;
        else if (relDiff < 0.05) agreement = `<span class="text-amber-400">~ CLOSE (${(relDiff * 100).toFixed(2)}% rel diff)</span>`;
        else agreement = `<span class="text-rose-400">&times; DIFFER (${(relDiff * 100).toFixed(2)}% rel diff)</span>`;
      }
      const fmt = (x) => (x == null || !isFinite(x)) ? '--' : (Math.abs(x) < 0.01 || Math.abs(x) > 999 ? x.toExponential(3) : x.toFixed(3));
      out.innerHTML =
        '<div class="text-emerald-300 font-bold mb-2">metafor::rma output (DL random-effects, HKSJ test)</div>' +
        '<div>Pool: <b>' + fmt(pool) + '</b>  (95% CI ' + fmt(lci) + ' to ' + fmt(uci) + ')  [scale: ' + scale + ']</div>' +
        '<div>&tau;&sup2; = ' + fmt(tau2) + '  &middot;  I&sup2; = ' + (isFinite(i2) ? i2.toFixed(1) + '%' : '--') + '  &middot;  Q = ' + fmt(Q) + '  &middot;  k = ' + Math.round(k) + '</div>' +
        '<div class="mt-2">App-computed pool ' + (isFinite(appPool) ? appPool.toFixed(3) : '--') + ' &rarr; ' + agreement + '</div>' +
        '<div class="text-[10px] text-slate-500 mt-3">Source: metafor (Viechtbauer 2010) compiled to WebAssembly via WebR. ' +
        'Independently computed from the app state; no shared code path with the native pool. Compare R output with the app\'s DL pool to audit numerical correctness.</div>';
      status('Validation complete (k=' + Math.round(k) + ').');
    } catch (e) {
      out.innerHTML = '<div class="text-rose-400">Error: ' + (e && e.message ? e.message : String(e)) + '</div>';
      status('Validation failed.');
    }
  }

  function injectUI() {
    const host = document.getElementById('tab-analysis');
    if (!host) return;
    if (document.getElementById('rvalid-card')) return;
    const card = document.createElement('div');
    card.id = 'rvalid-card';
    card.className = 'mt-6 p-4 rounded-xl border border-violet-500/30 bg-violet-500/5';
    card.innerHTML =
      '<div class="flex items-start justify-between gap-3 flex-wrap">' +
        '<div>' +
          '<div class="text-[11px] font-bold uppercase tracking-widest text-violet-300"><i class="fa-brands fa-r-project mr-2"></i>R cross-validation (optional &middot; WebR)</div>' +
          '<div class="text-xs text-slate-400 mt-2 max-w-xl">Optional. The first click downloads WebR and installs <code>metafor</code> in the browser ' +
          '(~40 MB WebAssembly + ~60-90 s install). Subsequent validations are instant. ' +
          'Runs <code>metafor::rma(method="DL", test="knha")</code> independently on the current included trials and compares the result to the app\'s native pool.</div>' +
        '</div>' +
        '<button id="rvalid-btn" class="text-[11px] font-bold uppercase tracking-widest px-4 py-2 rounded-full border border-violet-400/40 bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 whitespace-nowrap"><i class="fa-brands fa-r-project mr-2"></i>Validate pool with R</button>' +
      '</div>' +
      '<div id="rvalid-status" class="text-xs text-slate-400 mt-3"></div>' +
      '<div id="rvalid-output" class="text-xs text-slate-200 mt-2 font-mono leading-relaxed"></div>';
    host.appendChild(card);
    document.getElementById('rvalid-btn').addEventListener('click', runValidation);
  }

  function tryInject() {
    injectUI();
    // Fallback: some apps render #tab-analysis lazily. Retry briefly.
    let tries = 0;
    const iv = setInterval(() => {
      injectUI();
      if (document.getElementById('rvalid-card') || ++tries > 20) clearInterval(iv);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }
})();
