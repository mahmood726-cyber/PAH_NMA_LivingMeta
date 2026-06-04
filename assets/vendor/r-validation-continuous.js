/* R metafor cross-validation badge for continuous-outcome (MD/SMD) reviews. */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'r-validation-continuous-expanded';
  const PANEL_ID = 'r-validation-continuous-panel';

  // P1-6 fix: HTML-escape every R-sourced string before innerHTML concat.
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }


  function getReviewStem() {
    const path = global.location && global.location.pathname || '';
    return (path.split('/').pop() || '').replace(/\.html$/, '');
  }

  function fmtN(x, d) { return Number.isFinite(x) ? x.toFixed(d == null ? 3 : d) : '—'; }

  function buildBadge(r) {
    const summary = '✓ R metafor MD pool ' + fmtN(r.pool, 3) +
                    ' [' + fmtN(r.lci, 3) + ', ' + fmtN(r.uci, 3) + '] · k=' + r.k +
                    ' · τ²=' + fmtN(r.tau2, 4) + ' · I²=' + fmtN(r.I2, 0) + '%';
    const body =
      '<div style="font-size:11px;color:#cbd5e1;line-height:1.6;">' +
      '<table style="width:100%;border-collapse:collapse;font-family:JetBrains Mono,monospace;font-size:11px;">' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Engine</td><td style="color:#7dd3fc;">' + escapeHtml(r.engine) + ' · metafor ' + escapeHtml(r.metafor_version) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Trials (k)</td><td style="color:#7dd3fc;">' + r.k + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Scale</td><td style="color:#7dd3fc;">' + (r.scale || 'MD') + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">REML+HKSJ pool</td><td style="color:#7dd3fc;">' + fmtN(r.pool, 3) + ' [' + fmtN(r.lci, 3) + ', ' + fmtN(r.uci, 3) + ']</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Prediction interval (Cochrane v6.5)</td><td style="color:#7dd3fc;">[' + fmtN(r.PI_lci, 3) + ', ' + fmtN(r.PI_uci, 3) + ']</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">τ² · τ</td><td style="color:#7dd3fc;">' + fmtN(r.tau2, 4) + ' · ' + fmtN(r.tau, 4) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">I² · H²</td><td style="color:#7dd3fc;">' + fmtN(r.I2, 0) + '% · ' + fmtN(r.H2, 2) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Q · p</td><td style="color:#7dd3fc;">' + fmtN(r.Q, 2) + ' · ' + fmtN(r.Qp, 4) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">z · p (overall)</td><td style="color:#7dd3fc;">' + fmtN(r.zval, 2) + ' · ' + fmtN(r.pval, 4) + '</td></tr>' +
      '</table>' +
      '<div style="margin-top:8px;font-size:10.5px;color:#94a3b8;line-height:1.5;">' +
      'External cross-validation against R 4.5.2 + <a href="https://cran.r-project.org/package=metafor" target="_blank" rel="noopener noreferrer" style="color:#7dd3fc;text-decoration:none;">metafor</a>, ' +
      'rma(yi, vi, method="REML", test="knha"). Prediction interval uses Cochrane v6.5 t_{k-1} convention. ' +
      'Source: <code style="color:#94a3b8;word-break:break-all;">outputs/r_validation/continuous/' + escapeHtml(r.review) + '.json</code>.' +
      '<div style="margin-top:4px;font-size:10px;color:#94a3b8;">PRISMA 2020 items 13d (synthesis methods) + 13e (heterogeneity) + 13f (sensitivity) supported.</div><div style="margin-top:6px;padding:4px 8px;background:#1e1f3a;border-left:2px solid #fbbf24;font-size:10px;color:#fbbf24;">⚠ Computational validation only — not a GRADE certainty rating. RoB-2, indirectness, imprecision, inconsistency, and publication bias require separate assessment.</div></div></div>';
    return { summary, body };
  }

  function render(r) {
    const P = global.PanelHelper;
    if (!P) return false;
    const built = buildBadge(r);
    const panel = P.buildCollapsiblePanel({
      id: PANEL_ID,
      badge: 'R metafor (continuous)',
      summary: built.summary,
      bodyHtml: built.body,
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    const stem = getReviewStem();
    fetch('outputs/r_validation/continuous/' + stem + '.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(r => {
        if (!r || !r.fit_ok) return;
        // P1-21 fix: retry up to 6s for PanelHelper to become available.
        let tries = 0;
        const tick = () => {
          if (global.PanelHelper) { render(r); return; }
          if (++tries < 20) setTimeout(tick, 300);
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 800));
        } else { setTimeout(tick, 800); }
      })
      .catch(err => { console.warn('[R-validation] fetch failed:', err); });
  }

  global.RValidationContinuous = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
