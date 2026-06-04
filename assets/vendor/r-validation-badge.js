/* R metafor validation badge — fetches outputs/r_validation/<topic>.json and
 * renders a compact panel showing the local-R-validated pooled estimate.
 *
 * Auto-bootstraps. Topic inferred from filename (FOO_REVIEW.html -> FOO).
 * If JS engine pooled value can be detected on page (window.__POOLED_OR__),
 * also computes |Δ| and shows ✓/⚠ vs R.
 *
 * Container preference: #r-validation-badge, else creates a panel near top.
 *
 * Public API: RValidationBadge.render(topicSlug, container)
 */
(function (global) {
  'use strict';

  function topicFromUrl() {
    if (typeof location === 'undefined') return null;
    const m = location.pathname.match(/\/([^\/]+)_REVIEW\.html?(?:$|[?#])/i);
    if (m) return m[1];
    const m2 = location.pathname.match(/([^\/\\]+?)_REVIEW\.html?$/i);
    return m2 ? m2[1] : null;
  }

  function fmt(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (typeof digits === 'number') return Number(v).toFixed(digits);
    return Number(v).toPrecision(3);
  }

  const STORAGE_KEY = 'r-validation-badge-expanded';

  function isExpanded() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
  }
  function setExpanded(val) {
    try { localStorage.setItem(STORAGE_KEY, val ? '1' : '0'); } catch (e) {}
  }

  function buildPanel(topic, data, jsCompare) {
    const wrap = document.createElement('div');
    wrap.className = 'r-validation-badge-panel';
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

    // Build a tight one-line summary string for the header
    const summary = data.error
      ? 'skipped: ' + data.error + ' (k=' + (data.k || '?') + ')'
      : ('OR ' + fmt(data.pooled_OR, 2)
         + ' [' + fmt(data.ci_low_OR, 2) + '–' + fmt(data.ci_high_OR, 2) + ']'
         + ' · k=' + (data.k || '?')
         + ' · I²=' + fmt(data.I2, 1) + '%'
         + ' · τ²=' + fmt(data.tau2, 3));

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer;user-select:none;';
    head.title = 'Click to ' + (isExpanded() ? 'collapse' : 'expand') + ' R metafor validation';
    head.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">' +
        '<span aria-label="toggle" style="display:inline-block;width:14px;color:#7dd3fc;font-size:10px;transition:transform 0.15s;transform:rotate(' + (isExpanded() ? 90 : 0) + 'deg);">▶</span>' +
        '<span style="background:#1e3a5f;color:#7dd3fc;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:0.04em;flex:0 0 auto;">R metafor</span>' +
        '<span style="color:#94a3b8;font-size:11px;flex:0 0 auto;white-space:nowrap;">' + topic + '</span>' +
        '<span style="color:#cbd5e1;font-family:JetBrains Mono,monospace;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + summary + '</span>' +
      '</div>' +
      '<a href="outputs/r_validation/' + topic + '.json" target="_blank" onclick="event.stopPropagation()" style="color:#7dd3fc;font-size:10.5px;text-decoration:none;flex:0 0 auto;">raw JSON ↗</a>';
    wrap.appendChild(head);

    // Body — hidden by default
    const body = document.createElement('div');
    body.style.cssText = 'display:' + (isExpanded() ? 'block' : 'none') + ';margin-top:8px;padding-top:8px;border-top:1px solid #1e293b;';

    if (data.error) {
      const err = document.createElement('div');
      err.style.cssText = 'color:#fbbf24;font-size:11.5px;';
      err.textContent = 'R validation skipped: ' + data.error + ' (k=' + (data.k || '?') + ')';
      body.appendChild(err);
      wrap.appendChild(body);

      head.addEventListener('click', () => {
        const expanded = body.style.display === 'block';
        body.style.display = expanded ? 'none' : 'block';
        const arrow = head.querySelector('span[aria-label="toggle"]');
        if (arrow) arrow.style.transform = expanded ? 'rotate(0deg)' : 'rotate(90deg)';
        setExpanded(!expanded);
      });
      return wrap;
    }

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;';

    function cell(label, value, sub) {
      const c = document.createElement('div');
      c.style.cssText = 'background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;';
      c.innerHTML =
        '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>' +
        '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>' +
        (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '');
      return c;
    }

    grid.appendChild(cell('Pooled OR',
      fmt(data.pooled_OR, 2),
      '95% CI ' + fmt(data.ci_low_OR, 2) + '–' + fmt(data.ci_high_OR, 2)));
    grid.appendChild(cell('Trials (k)', String(data.k || '?')));
    grid.appendChild(cell('I²', fmt(data.I2, 1) + '%'));
    grid.appendChild(cell('τ²', fmt(data.tau2, 3)));
    grid.appendChild(cell('Q (df ' + (data.Qdf || '?') + ')',
      fmt(data.Q, 2),
      'p=' + fmt(data.Qp, 3)));
    grid.appendChild(cell('PI (95%)',
      fmt(data.PI_low_OR, 2) + '–' + fmt(data.PI_high_OR, 2),
      data.pi_df_convention || 't_{k-1}'));

    body.appendChild(grid);

    // Method line + JS comparison
    const meth = document.createElement('div');
    meth.style.cssText = 'margin-top:7px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:10.5px;color:#94a3b8;';
    let cmp = '';
    if (jsCompare && jsCompare.pooled_OR && data.pooled_OR) {
      const delta = Math.abs(jsCompare.pooled_OR - data.pooled_OR);
      const pass = delta < 0.01;
      cmp = '<span style="color:' + (pass ? '#34d399' : '#fbbf24') + ';">' +
        (pass ? '✓' : '⚠') + ' JS engine match: |Δ|=' + delta.toFixed(4) + '</span>';
    }
    meth.innerHTML =
      '<span>method: ' + (data.method || '?') +
      (data.hksj_floor_applied ? ' (HKSJ floor applied)' : '') + '</span>' +
      cmp;
    body.appendChild(meth);

    wrap.appendChild(body);

    // Toggle handler
    head.addEventListener('click', () => {
      const expanded = body.style.display === 'block';
      body.style.display = expanded ? 'none' : 'block';
      const arrow = head.querySelector('span[aria-label="toggle"]');
      if (arrow) arrow.style.transform = expanded ? 'rotate(0deg)' : 'rotate(90deg)';
      head.title = 'Click to ' + (expanded ? 'expand' : 'collapse') + ' R metafor validation';
      setExpanded(!expanded);
    });

    return wrap;
  }

  function render(topic, container, jsCompare) {
    const url = 'outputs/r_validation/' + topic + '.json';
    return fetch(url, { cache: 'no-cache' })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(data => {
        const panel = buildPanel(topic, data, jsCompare);
        if (container) {
          container.innerHTML = '';
          container.appendChild(panel);
        }
        return panel;
      })
      .catch(err => {
        console.warn('[r-validation-badge] no JSON for ' + topic, err);
      });
  }

  function autoBootstrap() {
    if (typeof document === 'undefined') return;

    function go() {
      const topic = topicFromUrl();
      if (!topic) return;

      let host = document.getElementById('r-validation-badge');
      if (!host) {
        host = document.createElement('div');
        host.id = 'r-validation-badge';
        // Insert after the first H1 / page-header, else top of body
        const target =
          document.querySelector('header') ||
          document.querySelector('h1') ||
          document.body.firstElementChild;
        if (target && target.parentNode) {
          target.parentNode.insertBefore(host, target.nextSibling);
        } else {
          document.body.insertBefore(host, document.body.firstChild);
        }
      }

      // Try to auto-discover JS engine pooled value if exposed
      const jsCompare = (typeof global.__POOLED_OR__ === 'number')
        ? { pooled_OR: global.__POOLED_OR__ }
        : null;

      render(topic, host, jsCompare);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(go, 300));
    } else {
      setTimeout(go, 300);
    }
  }

  global.RValidationBadge = { render, topicFromUrl };
  autoBootstrap();
})(typeof window !== 'undefined' ? window : this);
