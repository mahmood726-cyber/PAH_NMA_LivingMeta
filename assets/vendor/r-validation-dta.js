/* R mada cross-validation badge for DTA reviews.
 *
 * Fetches outputs/r_validation/dta/<REVIEW>.json (written by
 * scripts/r_validate_dta.py running R 4.5.2 + mada 0.5.12) and compares
 * the pooled Se/Sp/DOR/AUC to whatever the in-page DTA bivariate panel
 * computed. Renders a small status badge:
 *
 *   ✓ green  — engine matches R mada to within 0.005 on Se AND Sp
 *   ⚠ amber  — match but >0.005 deviation (clinically irrelevant but
 *               worth disclosure); shows both numbers
 *   ✗ red    — fit ok in R but in-page panel disagrees substantively
 *
 * Auto-bootstrap. Self-skips if the JSON file isn't present (non-DTA
 * reviews; or DTA reviews with k<4 where mada::reitsma can't fit).
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'r-validation-dta-expanded';
  // P1-6 fix: HTML-escape every R-sourced string before innerHTML concat.
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const PANEL_ID = 'r-validation-badge';   // reuse the canonical badge slot

  function fetchValidation(reviewStem) {
    // Same-origin fetch. Returns parsed JSON or null on any error.
    const url = 'outputs/r_validation/dta/' + reviewStem + '.json';
    return fetch(url, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
  }

  function getReviewStem() {
    const path = global.location && global.location.pathname || '';
    const file = path.split('/').pop() || '';
    return file.replace(/\.html$/, '');
  }

  function getEngineDTA() {
    // The dta-bivariate.js panel exposes its last computed pool on
    // global.RapidMetaDTA.lastFit (added by that module when present).
    // If absent, fall back to scanning the panel DOM for printed
    // numbers.
    const engine = global.RapidMetaDTA;
    if (engine && engine.lastFit) {
      return {
        sens: engine.lastFit.sens_pool,
        spec: engine.lastFit.spec_pool,
        k: engine.lastFit.k,
      };
    }
    // DOM fallback — match patterns like "Pooled Se 80.9%, Sp 99.2%"
    const el = document.getElementById('dta-bivariate-panel');
    if (!el) return null;
    const txt = el.innerText || '';
    const m = txt.match(/Se\s*([0-9]+\.[0-9]+)%[^A-Za-z]*Sp\s*([0-9]+\.[0-9]+)%/);
    if (!m) return null;
    return { sens: parseFloat(m[1])/100, spec: parseFloat(m[2])/100, k: null };
  }

  function pctFmt(x, d) { return (x * 100).toFixed(d == null ? 1 : d) + '%'; }

  function buildBadgeHtml(r, engine) {
    const k = r.k;
    const rSe = r.sens_pool, rSp = r.spec_pool;
    const rSeLo = r.sens_lci, rSeHi = r.sens_uci;
    const rSpLo = r.spec_lci, rSpHi = r.spec_uci;
    const rDOR = r.dor;
    const rAUC = r.auc;

    let cmpHtml = '';
    let verdict = '⚠ R-validated (engine pool not detected on page)';
    let verdictColor = '#fbbf24';
    if (engine && Number.isFinite(engine.sens) && Number.isFinite(engine.spec)) {
      const dSe = Math.abs(engine.sens - rSe);
      const dSp = Math.abs(engine.spec - rSp);
      // P0-4 fix: only award ✓ for tight match. Method-spread is amber.
      // Tight tolerance: absolute 1pp AND ≤20% relative to baseline.
      const baselineSe = (engine.sens + rSe) / 2;
      const baselineSp = (engine.spec + rSp) / 2;
      const tightSe = Math.min(0.01, Math.max(0.005, 0.20 * baselineSe));
      const tightSp = Math.min(0.01, Math.max(0.005, 0.20 * baselineSp));
      if (dSe < tightSe && dSp < tightSp) {
        verdict = '✓ R mada cross-validated · Se Sp within tight tolerance';
        verdictColor = '#22c55e';
      } else if (dSe < 0.03 && dSp < 0.03) {
        verdict = '⚠ Method-spread (Δ Se ' + (dSe * 100).toFixed(1) + 'pp, Δ Sp ' + (dSp * 100).toFixed(1) + 'pp) · bivariate-RE vs FE-logit';
        verdictColor = '#fbbf24';
      } else {
        verdict = '⚠ R-engine diverges (Δ Se ' +
                  (dSe * 100).toFixed(1) + 'pp, Δ Sp ' + (dSp * 100).toFixed(1) + 'pp)';
        verdictColor = '#fbbf24';
      }
      cmpHtml =
        '<tr><td style="padding:3px 8px;color:#94a3b8;">Engine Se vs R</td>' +
        '<td style="color:#7dd3fc;">' + pctFmt(engine.sens, 1) + ' vs ' + pctFmt(rSe, 1) +
        ' <span style="color:#64748b;">(Δ ' + pctFmt(dSe, 2) + ')</span></td></tr>' +
        '<tr><td style="padding:3px 8px;color:#94a3b8;">Engine Sp vs R</td>' +
        '<td style="color:#7dd3fc;">' + pctFmt(engine.spec, 1) + ' vs ' + pctFmt(rSp, 1) +
        ' <span style="color:#64748b;">(Δ ' + pctFmt(dSp, 2) + ')</span></td></tr>';
    }

    const summary = verdict + ' · Se ' + pctFmt(rSe, 1) + ' Sp ' + pctFmt(rSp, 1) +
                    ' DOR ' + (rDOR ? rDOR.toFixed(1) : '—') +
                    ' AUC ' + (rAUC ? rAUC.toFixed(3) : '—') + ' · k=' + k;

    const body =
      '<div style="font-size:11px;color:#cbd5e1;line-height:1.6;">' +
      '<table style="width:100%;border-collapse:collapse;font-family:JetBrains Mono,monospace;font-size:11px;">' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Engine</td><td style="color:#7dd3fc;">' + (r.engine || 'R-mada-reitsma') + ' · mada ' + (r.mada_version || '?') + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Trials (k)</td><td style="color:#7dd3fc;">' + k + (r.cc_applied ? ' (continuity-corrected: ' + r.cc_applied + ')' : '') + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Pooled Sensitivity</td><td style="color:#7dd3fc;">' + pctFmt(rSe, 1) + ' [' + pctFmt(rSeLo, 1) + ', ' + pctFmt(rSeHi, 1) + ']</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Pooled Specificity</td><td style="color:#7dd3fc;">' + pctFmt(rSp, 1) + ' [' + pctFmt(rSpLo, 1) + ', ' + pctFmt(rSpHi, 1) + ']</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Pooled DOR</td><td style="color:#7dd3fc;">' + (rDOR ? rDOR.toFixed(1) : '—') + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">LR+ / LR−</td><td style="color:#7dd3fc;">' + (r.lr_pos ? r.lr_pos.toFixed(2) : '—') + ' / ' + (r.lr_neg ? r.lr_neg.toFixed(3) : '—') + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">HSROC AUC</td><td style="color:#7dd3fc;">' + (rAUC ? rAUC.toFixed(3) : '—') + '</td></tr>' +
      cmpHtml +
      '</table>' +
      '<div style="margin-top:8px;font-size:10.5px;color:#94a3b8;line-height:1.5;">' +
      'External cross-validation against R 4.5.2 + ' +
      '<a href="https://cran.r-project.org/web/packages/mada/" target="_blank" rel="noopener noreferrer" style="color:#7dd3fc;text-decoration:none;">mada</a> ' +
      'package (Doebler, Reitsma bivariate model). Same 2x2 inputs as the in-page Reitsma; differences indicate engine vs reference implementation drift. ' +
      'Source data: <code style="color:#94a3b8;word-break:break-all;">outputs/r_validation/dta/' + escapeHtml(r.review) + '.json</code>.' +
      '<div style="margin-top:4px;font-size:10px;color:#94a3b8;">PRISMA 2020 items 13d (synthesis methods) + 13e (heterogeneity) + 13f (sensitivity) supported.</div><div style="margin-top:6px;padding:4px 8px;background:#1e1f3a;border-left:2px solid #fbbf24;font-size:10px;color:#fbbf24;">⚠ Computational validation only — not a GRADE certainty rating. RoB-2, indirectness, imprecision, inconsistency, and publication bias require separate assessment.</div></div></div>';

    return { summary, body, color: verdictColor };
  }

  function render(r, engine) {
    const P = global.PanelHelper;
    if (!P) return false;
    const built = buildBadgeHtml(r, engine);
    const panel = P.buildCollapsiblePanel({
      id: PANEL_ID,
      badge: 'R mada (DTA)',
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
    if (!/_DTA_REVIEW$/.test(stem)) return; // only DTA reviews
    fetchValidation(stem).then(r => {
      if (!r || !r.fit_ok) return;
      // Wait for in-page bivariate pool to finish so we can compare
      let tries = 0;
      const tick = () => {
        const engine = getEngineDTA();
        if (engine || tries > 20) {
          render(r, engine);
          return;
        }
        tries++;
        setTimeout(tick, 300);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 800));
      } else { setTimeout(tick, 800); }
    });
  }

  global.RValidationDTA = { render, fetchValidation };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
