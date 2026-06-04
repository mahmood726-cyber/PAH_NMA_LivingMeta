/* Shared helpers for the new analysis panels (NNT, leave-one-out, GRADE-SoF,
 * cumulative MA, Baujat, TSA). Pure JS, zero deps.
 *
 * Public API on global.PanelHelper:
 *   getRealData()       -> object | null
 *   extractBinaryTrials(rd) -> [{ name, ai, n1i, ci, n2i }, ...]
 *   poolRandomLogOR(trials) -> { logOR, se, OR, ci_low, ci_high, k, tau2, Q, Qdf }
 *   poolRandomRD(trials)    -> { rd, se, ci_low, ci_high, k, tau2 }
 *   buildCollapsiblePanel({ id, badge, summary, bodyHtml, storageKey })
 *     Returns a DOM node ready to insert. Default collapsed; click toggles;
 *     state persists via localStorage.
 *   insertAfterRBadge(node) — appends a panel after the R metafor badge,
 *     creating it at the start of <body> if the badge is missing.
 *   fmt(v, digits)
 */
(function (global) {
  'use strict';

  function getRealData() {
    const rm = global.RapidMeta;
    if (!rm) return null;
    return rm.realData || (rm.state && rm.state.realData) || null;
  }

  function fmt(v, d) {
    if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '—';
    if (typeof v !== 'number') v = Number(v);
    if (isNaN(v)) return '—';
    return d == null ? String(v) : v.toFixed(d);
  }

  // P1-6 fix: HTML-escape helper. All R-JSON-sourced strings rendered
  // inside innerHTML go through this. Five-char escape (&<>"').
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function extractBinaryTrials(rd) {
    if (!rd) return [];
    const out = [];
    Object.values(rd).forEach(t => {
      const ai = +t.tE, n1i = +t.tN, ci = +t.cE, n2i = +t.cN;
      if (isFinite(ai) && isFinite(n1i) && isFinite(ci) && isFinite(n2i) &&
          n1i > 0 && n2i > 0 && ai >= 0 && ci >= 0 && ai <= n1i && ci <= n2i) {
        out.push({ name: String(t.name || '?'), ai, n1i, ci, n2i,
                   year: t.year || null });
      }
    });
    return out;
  }

  // log-OR with continuity correction when any cell == 0
  function trialLogOR(t) {
    let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    const yi = Math.log((a * d) / (b * c));
    const vi = 1 / a + 1 / b + 1 / c + 1 / d;
    return { yi, vi };
  }

  function poolRandomLogOR(trials) {
    if (!trials || trials.length < 2) return null;
    const pts = trials.map(trialLogOR);
    // Fixed-effect first (for τ²)
    let W = 0, WY = 0;
    pts.forEach(p => { const w = 1 / p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    let Q = 0;
    pts.forEach(p => { const w = 1 / p.vi; Q += w * (p.yi - yFE) * (p.yi - yFE); });
    const df = pts.length - 1;
    const sumW2 = pts.reduce((s, p) => s + Math.pow(1 / p.vi, 2), 0);
    const c = W - sumW2 / W;
    const tau2 = Math.max(0, (Q - df) / c);
    let W2 = 0, WY2 = 0;
    pts.forEach(p => { const w = 1 / (p.vi + tau2); W2 += w; WY2 += w * p.yi; });
    const yRE = WY2 / W2;
    const seRE = Math.sqrt(1 / W2);
    return {
      logOR: yRE, se: seRE, OR: Math.exp(yRE),
      ci_low: Math.exp(yRE - 1.96 * seRE),
      ci_high: Math.exp(yRE + 1.96 * seRE),
      k: pts.length, tau2, Q, Qdf: df,
    };
  }

  function poolRandomRD(trials) {
    if (!trials || trials.length < 2) return null;
    const pts = trials.map(t => {
      const pt = t.ai / t.n1i, pc = t.ci / t.n2i;
      const yi = pt - pc;
      let vi = pt * (1 - pt) / t.n1i + pc * (1 - pc) / t.n2i;
      if (vi <= 0) vi = 1 / (t.n1i + t.n2i);
      return { yi, vi };
    });
    let W = 0, WY = 0;
    pts.forEach(p => { const w = 1 / p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    let Q = 0;
    pts.forEach(p => { const w = 1 / p.vi; Q += w * (p.yi - yFE) * (p.yi - yFE); });
    const df = pts.length - 1;
    const sumW2 = pts.reduce((s, p) => s + Math.pow(1 / p.vi, 2), 0);
    const c = W - sumW2 / W;
    const tau2 = Math.max(0, (Q - df) / c);
    let W2 = 0, WY2 = 0;
    pts.forEach(p => { const w = 1 / (p.vi + tau2); W2 += w; WY2 += w * p.yi; });
    const yRE = WY2 / W2;
    const seRE = Math.sqrt(1 / W2);
    return {
      rd: yRE, se: seRE,
      ci_low: yRE - 1.96 * seRE,
      ci_high: yRE + 1.96 * seRE,
      k: pts.length, tau2,
    };
  }

  function buildCollapsiblePanel(opts) {
    const wrap = document.createElement('div');
    if (opts.id) wrap.id = opts.id;
    wrap.style.cssText = [
      'background:#0f172a',
      'border:1px solid #1e3a5f',
      'border-radius:8px',
      'padding:6px 10px',
      'margin:8px 0',
      'font-family:Inter,system-ui,sans-serif',
      'font-size:12px',
      'color:#e2e8f0',
      'box-shadow:0 0 0 1px rgba(59,130,246,0.06)',
    ].join(';');

    let expanded = false;
    if (opts.storageKey) {
      try { expanded = localStorage.getItem(opts.storageKey) === '1'; } catch (e) {}
    }

    // P0-10/P0-11 fix: keyboard-accessible toggle. Real <button> with
    // role="button" (implicit), tabindex=0 (implicit), Enter/Space activation
    // (implicit), aria-expanded/aria-controls for screen readers.
    const head = document.createElement('button');
    head.type = 'button';
    head.style.cssText = 'all:unset;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer;user-select:none;width:100%;box-sizing:border-box;';
    head.title = 'Toggle details';
    const bodyId = (opts.id || ('panel-' + Math.random().toString(36).slice(2, 8))) + '-body';
    head.setAttribute('aria-expanded', String(expanded));
    head.setAttribute('aria-controls', bodyId);
    head.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">' +
        '<span class="ph-arrow" aria-hidden="true" style="display:inline-block;width:14px;color:#7dd3fc;font-size:10px;transition:transform 0.15s;transform:rotate(' + (expanded ? 90 : 0) + 'deg);">▶</span>' +
        '<span style="background:#1e3a5f;color:#7dd3fc;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:0.04em;flex:0 0 auto;">' + (opts.badge || 'Panel') + '</span>' +
        '<span title="' + escapeHtml(opts.summary || '') + '" style="color:#cbd5e1;font-family:JetBrains Mono,monospace;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">' + (opts.summary || '') + '</span>' +
      '</div>';
    wrap.appendChild(head);

    const body = document.createElement('div');
    body.id = bodyId;
    body.style.cssText = 'display:' + (expanded ? 'block' : 'none') + ';margin-top:8px;padding-top:8px;border-top:1px solid #1e293b;';
    if (opts.bodyHtml) body.innerHTML = opts.bodyHtml;
    if (opts.bodyNode) body.appendChild(opts.bodyNode);
    wrap.appendChild(body);

    head.addEventListener('click', () => {
      const isOpen = body.style.display === 'block';
      body.style.display = isOpen ? 'none' : 'block';
      const arrow = head.querySelector('.ph-arrow');
      if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
      head.setAttribute('aria-expanded', String(!isOpen));
      if (opts.storageKey) {
        try { localStorage.setItem(opts.storageKey, isOpen ? '0' : '1'); } catch (e) {}
      }
    });

    return wrap;
  }

  function insertAfterRBadge(node) {
    const badge = document.getElementById('r-validation-badge');
    if (badge && badge.parentNode) {
      badge.parentNode.insertBefore(node, badge.nextSibling);
      return true;
    }
    // Fallback: after first h1 or top of body
    const target = document.querySelector('h1') || document.body.firstElementChild;
    if (target && target.parentNode) {
      target.parentNode.insertBefore(node, target.nextSibling);
      return true;
    }
    document.body.insertBefore(node, document.body.firstChild);
    return true;
  }

  function isNMA() {
    return !!(global.NMA_CONFIG && global.NMA_CONFIG.treatments && global.NMA_CONFIG.treatments.length >= 2);
  }

  global.PanelHelper = {
    getRealData, fmt, escapeHtml, extractBinaryTrials,
    poolRandomLogOR, poolRandomRD,
    buildCollapsiblePanel, insertAfterRBadge, isNMA,
  };
})(typeof window !== 'undefined' ? window : this);
