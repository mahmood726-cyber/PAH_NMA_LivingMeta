/* verdict-badge.js — render the per-topic data-integrity verdict badge.
 *
 * Reads `window.__verdict` (a JSON object inlined into each review HTML by
 * scripts/inject_verdict_badge.py) and renders a banner showing:
 *   - Verdict tier:  STABLE / MODERATE / EXPOSED / UNCERTAIN
 *   - Issue counts (P0 + P1 + P2)
 *   - Expandable list of reasons + which gates contributed
 *
 * Public API:
 *   VerdictBadge.render(container)   — renders into a DOM node or selector
 *
 * No external dependencies. Plain SVG + Tailwind classes consistent with
 * the rest of the RapidMeta UI.
 */
(function (global) {
  'use strict';

  const TIERS = {
    STABLE:    { label: 'STABLE',    bg: '#064e3b', fg: '#6ee7b7', border: '#10b981', icon: '●', desc: 'All data-integrity gates pass.' },
    MODERATE:  { label: 'MODERATE',  bg: '#78350f', fg: '#fcd34d', border: '#f59e0b', icon: '◐', desc: 'One topic-level issue or one P0 defect.' },
    EXPOSED:   { label: 'EXPOSED',   bg: '#7f1d1d', fg: '#fca5a5', border: '#ef4444', icon: '◯', desc: 'Two or more P0 defects, or PI gap + a fragile trial.' },
    UNCERTAIN: { label: 'UNCERTAIN', bg: '#1f2937', fg: '#9ca3af', border: '#6b7280', icon: '?', desc: 'Insufficient data — gates could not run.' },
  };

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'style' && typeof attrs[k] === 'object') {
        Object.assign(e.style, attrs[k]);
      } else if (k === 'onclick') {
        e.onclick = attrs[k];
      } else {
        e.setAttribute(k, attrs[k]);
      }
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function render(container) {
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) return;
    const data = global.__verdict;
    if (!data) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:11px;padding:8px;">No verdict data inlined.</div>';
      return;
    }
    const tier = TIERS[data.verdict] || TIERS.UNCERTAIN;
    const counts = data.counts || {};
    const reasons = data.reasons || [];

    const card = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '16px',
        background: tier.bg, border: '1px solid ' + tier.border,
        borderLeft: '4px solid ' + tier.border,
        borderRadius: '12px', padding: '14px 18px', margin: '8px 0',
        fontFamily: 'ui-sans-serif,system-ui,sans-serif'
      }
    });

    const badge = el('div', {
      style: {
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minWidth: '88px', minHeight: '54px',
        background: 'rgba(0,0,0,0.25)', borderRadius: '8px',
        padding: '6px 12px'
      }
    }, [
      el('div', { style: { fontSize: '18px', color: tier.fg, fontWeight: '800', letterSpacing: '0.05em' } }, [tier.icon + ' ' + tier.label]),
      el('div', { style: { fontSize: '9px', color: tier.fg, opacity: '0.7', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.1em' } }, ['data-integrity'])
    ]);

    const meta = el('div', { style: { flex: '1', minWidth: '0' } });
    const title = el('div', { style: { fontSize: '11px', color: tier.fg, fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' } }, [
      'Data-integrity verdict — ' + (counts.n_trials_seen || 0) + ' trials, ' + (data.p0_total || 0) + ' P0 defect(s)'
    ]);
    const sub = el('div', { style: { fontSize: '11px', color: '#cbd5e1', lineHeight: '1.5' } }, [tier.desc]);
    meta.appendChild(title);
    meta.appendChild(sub);

    if (reasons.length) {
      const detailsBtn = el('button', {
        style: {
          marginTop: '6px', background: 'rgba(0,0,0,0.3)', color: tier.fg,
          border: '1px solid ' + tier.border, borderRadius: '6px',
          padding: '4px 10px', fontSize: '10px', fontWeight: '600',
          cursor: 'pointer', letterSpacing: '0.05em'
        }
      }, ['Show ' + reasons.length + ' contributing finding(s) ▾']);

      const list = el('ul', {
        style: {
          display: 'none', marginTop: '8px', paddingLeft: '18px', fontSize: '11px',
          color: '#e2e8f0', lineHeight: '1.6'
        }
      });
      reasons.forEach(function (r) {
        list.appendChild(el('li', { style: { listStyle: 'disc' } }, [r]));
      });
      detailsBtn.onclick = function () {
        const open = list.style.display !== 'none';
        list.style.display = open ? 'none' : 'block';
        detailsBtn.textContent = open
          ? 'Show ' + reasons.length + ' contributing finding(s) ▾'
          : 'Hide contributing findings ▴';
      };

      meta.appendChild(detailsBtn);
      meta.appendChild(list);
    }

    card.appendChild(badge);
    card.appendChild(meta);

    container.innerHTML = '';
    container.appendChild(card);
  }

  global.VerdictBadge = { render };
})(typeof window !== 'undefined' ? window : globalThis);
