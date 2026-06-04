/* R metafor cross-validation badge for single-arm proportion reviews.
 *
 * Fetches outputs/r_validation/singlearm/<REVIEW>.json (written by
 * scripts/r_validate_singlearm.py running R 4.5.2 + metafor 4.8.0) and
 * compares the pooled proportion to whatever the in-page single-arm
 * panel computed.
 *
 * Auto-bootstrap. Self-skips if the JSON file isn't present.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'r-validation-singlearm-expanded';
  const PANEL_ID = 'r-validation-singlearm-panel';

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

  function getEnginePool() {
    // single-arm-proportion.js stores its last fit on global.SingleArmProportion.lastFit
    const engine = global.SingleArmProportion;
    if (engine && engine.lastFit) {
      return {
        prop: engine.lastFit.prop,   // 0-1 scale
        method: engine.lastFit.method,
        k: engine.lastFit.k,
      };
    }
    // DOM fallback — parse "pooled: X.X% [Y.Y%, Z.Z%]"
    const el = document.getElementById('single-arm-proportion-panel');
    if (!el) return null;
    const txt = el.innerText || '';
    const m = txt.match(/Logit-RE\s*([0-9]+\.[0-9]+)%/);
    if (m) return { prop: parseFloat(m[1])/100, method: 'logit-RE-DL', k: null };
    return null;
  }

  function pctFmt(x, d) {
    if (!Number.isFinite(x)) return '—';
    return (x * 100).toFixed(d == null ? 1 : d) + '%';
  }

  function buildBadge(r, engine) {
    const lp = r.logit_pool || {};
    const ft = r.freeman_tukey_pool || {};
    const rProp = lp.pool;
    const rLci = lp.lci, rUci = lp.uci;
    const rI2 = lp.I2 || 0;
    const rTau2 = lp.tau2 || 0;

    let verdict = '⚠ R-validated (engine pool not detected on page)';
    let cmpRow = '';
    if (engine && Number.isFinite(engine.prop) && Number.isFinite(rProp)) {
      const d = Math.abs(engine.prop - rProp);
      // P0-4 + P1-13 fix: only award ✓ for tight match AND k ≥ 3 (HKSJ
      // t_{k-1} at k=2 has multiplier 12.706 — trivially matches anything).
      const baseline = (engine.prop + rProp) / 2;
      const tight_abs = 0.01;                // 1pp absolute
      const tight_rel = 0.20 * baseline;     // 20% relative
      const tight_tol = Math.min(tight_abs, Math.max(0.005, tight_rel));
      const k_ok = (r.k || 0) >= 3;
      if (d < tight_tol && k_ok) {
        verdict = '✓ R metafor cross-validated · Δ ' + (d * 100).toFixed(2) + 'pp · within tight tolerance';
      } else if (d < tight_tol && !k_ok) {
        verdict = '⚠ k=' + r.k + ' (HKSJ t_{k-1} CI uninformative — ✓ not awarded)';
      } else if (d < 0.03) {
        verdict = '⚠ R-engine method-spread Δ ' + (d * 100).toFixed(1) + 'pp · likely PFT-vs-logit or REML-vs-DL drift';
      } else {
        verdict = '⚠ R-engine diverges (Δ ' + (d * 100).toFixed(1) + 'pp)';
      }
      cmpRow =
        '<tr><td style="padding:3px 8px;color:#94a3b8;">Engine vs R logit pool</td>' +
        '<td style="color:#7dd3fc;">' + pctFmt(engine.prop, 1) + ' vs ' + pctFmt(rProp, 1) +
        ' <span style="color:#94a3b8;">(Δ ' + pctFmt(d, 2) + ')</span></td></tr>';
      // P1-10 fix: also surface Δ against PFT pool (preferred for sparse/extreme p̂).
      if (ft.pool != null && Number.isFinite(ft.pool)) {
        const dFT = Math.abs(engine.prop - ft.pool);
        cmpRow +=
          '<tr><td style="padding:3px 8px;color:#94a3b8;">Engine vs R Freeman-Tukey pool</td>' +
          '<td style="color:#7dd3fc;">' + pctFmt(engine.prop, 1) + ' vs ' + pctFmt(ft.pool, 1) +
          ' <span style="color:#94a3b8;">(Δ ' + pctFmt(dFT, 2) + ')</span></td></tr>';
      }
    }

    const summary = verdict + ' · ' + pctFmt(rProp, 1) +
                    ' [' + pctFmt(rLci, 1) + ', ' + pctFmt(rUci, 1) + '] · k=' + r.k +
                    ' · I²=' + (rI2 || 0).toFixed(0) + '%';

    const body =
      '<div style="font-size:11px;color:#cbd5e1;line-height:1.6;">' +
      '<table style="width:100%;border-collapse:collapse;font-family:JetBrains Mono,monospace;font-size:11px;">' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Engine</td><td style="color:#7dd3fc;">' + escapeHtml(r.engine) + ' · metafor ' + escapeHtml(r.metafor_version) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Trials (k)</td><td style="color:#7dd3fc;">' + r.k + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">Logit-RE pool (REML+HKSJ)</td><td style="color:#7dd3fc;">' + pctFmt(rProp, 1) + ' [' + pctFmt(rLci, 1) + ', ' + pctFmt(rUci, 1) + ']</td></tr>' +
      (ft.pool != null ?
       '<tr><td style="padding:3px 8px;color:#94a3b8;">Freeman-Tukey pool (REML+HKSJ)</td><td style="color:#7dd3fc;">' + pctFmt(ft.pool, 1) + ' [' + pctFmt(ft.lci, 1) + ', ' + pctFmt(ft.uci, 1) + ']</td></tr>' : '') +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">τ² (logit scale)</td><td style="color:#7dd3fc;">' + (rTau2 || 0).toFixed(4) + '</td></tr>' +
      '<tr><td style="padding:3px 8px;color:#94a3b8;">I²</td><td style="color:#7dd3fc;">' + (rI2 || 0).toFixed(0) + '%</td></tr>' +
      cmpRow +
      '</table>' +
      '<div style="margin-top:8px;font-size:10.5px;color:#94a3b8;line-height:1.5;">' +
      'External cross-validation against R 4.5.2 + ' +
      '<a href="https://cran.r-project.org/package=metafor" target="_blank" rel="noopener noreferrer" style="color:#7dd3fc;text-decoration:none;">metafor</a> ' +
      '(measure="PLO" for logit; measure="PFT" for Freeman-Tukey double-arcsine), REML estimator with Hartung-Knapp-Sidik-Jonkman small-sample correction. ' +
      'Source: <code style="color:#94a3b8;word-break:break-all;">outputs/r_validation/singlearm/' + escapeHtml(r.review) + '.json</code>.' +
      '<div style="margin-top:4px;font-size:10px;color:#94a3b8;">PRISMA 2020 items 13d (synthesis methods) + 13e (heterogeneity) + 13f (sensitivity) supported.</div><div style="margin-top:6px;padding:4px 8px;background:#1e1f3a;border-left:2px solid #fbbf24;font-size:10px;color:#fbbf24;">⚠ Computational validation only — not a GRADE certainty rating. RoB-2, indirectness, imprecision, inconsistency, and publication bias require separate assessment.</div></div></div>';

    return { summary, body };
  }

  function render(r, engine) {
    const P = global.PanelHelper;
    if (!P) return false;
    const built = buildBadge(r, engine);
    const panel = P.buildCollapsiblePanel({
      id: PANEL_ID,
      badge: 'R metafor (single-arm)',
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
    // Only attempt fetch if the corresponding JSON file might exist —
    // we let fetch fail silently on non-single-arm reviews.
    const url = 'outputs/r_validation/singlearm/' + stem + '.json';
    fetch(url, { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(r => {
        if (!r || !r.fit_ok) return;
        let tries = 0;
        const tick = () => {
          const engine = getEnginePool();
          if (engine || tries > 20) { render(r, engine); return; }
          tries++;
          setTimeout(tick, 300);
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 800));
        } else { setTimeout(tick, 800); }
      })
      .catch(err => { console.warn('[R-validation] fetch failed:', err); });
  }

  global.RValidationSingleArm = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
