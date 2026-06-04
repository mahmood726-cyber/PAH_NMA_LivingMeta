/* R netmeta cross-validation badge for binary-outcome NMA reviews. */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'r-validation-nma-expanded';
  const PANEL_ID = 'r-validation-nma-panel';

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

  function fmtN(x, d) { return Number.isFinite(x) ? x.toFixed(d == null ? 2 : d) : '—'; }

  function buildBadge(r) {
    // P1-6 fix: every R-JSON-sourced string is HTML-escaped before innerHTML.
    const ref = escapeHtml(r.reference || '(unset)');
    let rowsHtml = '';
    const pooled = r.pooled || {};
    const treatments = Object.keys(pooled);
    treatments.sort().forEach(tr => {
      const p = pooled[tr];
      rowsHtml +=
        '<tr style="border-top:1px solid #1e293b;">' +
        '<td style="padding:3px 8px;color:#cbd5e1;">' + escapeHtml(tr) + '</td>' +
        '<td style="padding:3px 8px;text-align:right;color:#7dd3fc;">' + fmtN(p.OR, 2) +
        ' [' + fmtN(p.lci, 2) + ', ' + fmtN(p.uci, 2) + ']</td>' +
        '</tr>';
    });

    let psHtml = '';
    if (r.pscores) {
      const entries = Object.entries(r.pscores).sort((a, b) => b[1] - a[1]);
      psHtml = '<div style="margin-top:10px;color:#94a3b8;font-size:10.5px;text-transform:uppercase;letter-spacing:0.05em;">P-scores (netmeta SUCRA-equivalent)</div>' +
        '<table style="width:100%;border-collapse:collapse;font-family:JetBrains Mono,monospace;font-size:11px;">' +
        entries.map(([tr, ps]) =>
          '<tr><td style="padding:2px 8px;color:#cbd5e1;">' + escapeHtml(tr) + '</td>' +
          '<td style="padding:2px 8px;text-align:right;color:#7dd3fc;">' + fmtN(ps, 3) + '</td></tr>'
        ).join('') + '</table>';
    }

    const summary = '✓ R netmeta · ' + r.n_treatments + ' treatments · ' +
                    r.k_comparisons + ' contrasts · τ²=' + fmtN(r.tau2, 4) +
                    ' · I²=' + fmtN(r.I2, 0) + '%';

    const body =
      '<div style="font-size:11px;color:#cbd5e1;line-height:1.55;">' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-family:JetBrains Mono,monospace;font-size:11px;margin-bottom:10px;"><caption style="position:absolute;left:-9999px;">NMA cross-validation metadata</caption>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Engine</td><td style="color:#7dd3fc;">' + escapeHtml(r.engine) + ' · netmeta ' + escapeHtml(r.netmeta_version) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Treatments</td><td style="color:#7dd3fc;">' + r.n_treatments + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Direct contrasts</td><td style="color:#7dd3fc;">' + r.k_comparisons + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Reference</td><td style="color:#7dd3fc;">' + ref + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">τ² (REML)</td><td style="color:#7dd3fc;">' + fmtN(r.tau2, 4) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Q · df · p</td><td style="color:#7dd3fc;">' + fmtN(r.Q, 2) + ' · ' + fmtN(r.Qdf, 0) + ' · ' + fmtN(r.Qp, 3) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">I²</td><td style="color:#7dd3fc;">' + fmtN(r.I2, 0) + '%</td></tr>' +
      '</table>' +
      '<div style="color:#94a3b8;font-size:10.5px;text-transform:uppercase;letter-spacing:0.05em;">RE-model OR vs ' + ref + '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-family:JetBrains Mono,monospace;font-size:11px;">' +
      '<thead><tr style="color:#94a3b8;"><th scope="col" style="padding:4px 8px;text-align:left;">Treatment</th>' +
      '<th scope="col" style="padding:4px 8px;text-align:right;">OR (95% CI)</th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody></table>' +
      psHtml +
      '<div style="margin-top:8px;font-size:10.5px;color:#94a3b8;line-height:1.5;">' +
      'External cross-validation against R 4.5.2 + <a href="https://cran.r-project.org/package=netmeta" target="_blank" rel="noopener noreferrer" style="color:#7dd3fc;text-decoration:none;">netmeta</a> ' +
      '(Rücker & Schwarzer frequentist NMA, REML). Source: <code style="color:#94a3b8;word-break:break-all;">outputs/r_validation/nma/' + escapeHtml(r.review) + '.json</code>.' +
      '<div style="margin-top:4px;font-size:10px;color:#94a3b8;">PRISMA 2020 items 13d (synthesis methods) + 13e (heterogeneity) + 13f (sensitivity) supported.</div><div style="margin-top:6px;padding:4px 8px;background:#1e1f3a;border-left:2px solid #fbbf24;font-size:10px;color:#fbbf24;">⚠ Computational validation only — not a GRADE certainty rating. RoB-2, indirectness, imprecision, inconsistency, and publication bias require separate assessment.</div></div></div>';
    return { summary, body };
  }

  function render(r) {
    const P = global.PanelHelper;
    if (!P) return false;
    const built = buildBadge(r);
    const panel = P.buildCollapsiblePanel({
      id: PANEL_ID,
      badge: 'R netmeta (NMA)',
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
    fetch('outputs/r_validation/nma/' + stem + '.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(r => {
        if (!r || !r.fit_ok) return;
        // P1-21 fix: retry pattern.
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

  global.RValidationNMA = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
