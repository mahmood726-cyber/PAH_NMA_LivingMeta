/* NMA league table — treatment × treatment matrix of pairwise effects.
 *
 * For each pair (T_i, T_j) directly compared in trials:
 *   - Pool log-OR (DerSimonian–Laird random effects)
 *   - Display OR (95% CI) in the upper triangle (i row, j col, i<j)
 *   - Show k (trials) in the lower triangle
 *
 * Cells without direct evidence shown as "—" (indirect-only requires
 * a network meta-analysis fit, which we link out to via the existing
 * NMA result widgets).
 *
 * NMA-only — exits silently if window.NMA_CONFIG.treatments missing.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'nma-league-table-expanded';

  function getNMACfg() {
    return global.NMA_CONFIG || (global.RapidMeta && global.RapidMeta.state && global.RapidMeta.state.protocol) || null;
  }

  function trialLogOR(t) {
    let ai = +t.tE, ci = +t.cE, n1 = +t.tN, n2 = +t.cN;
    if (!isFinite(ai) || !isFinite(ci) || !isFinite(n1) || !isFinite(n2) || n1 <= 0 || n2 <= 0) return null;
    if (ai === 0 || ci === 0 || ai === n1 || ci === n2) {
      ai += 0.5; ci += 0.5; n1 += 1; n2 += 1;
    }
    const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
    return { yi: Math.log((a*d)/(b*c)), vi: 1/a + 1/b + 1/c + 1/d };
  }

  function poolDLRE(points) {
    if (!points || points.length === 0) return null;
    if (points.length === 1) {
      const p = points[0];
      return { OR: Math.exp(p.yi), ci_low: Math.exp(p.yi - 1.96 * Math.sqrt(p.vi)), ci_high: Math.exp(p.yi + 1.96 * Math.sqrt(p.vi)), k: 1, tau2: 0 };
    }
    let W = 0, WY = 0;
    points.forEach(p => { const w = 1/p.vi; W += w; WY += w * p.yi; });
    const yFE = WY / W;
    let Q = 0;
    points.forEach(p => { const w = 1/p.vi; Q += w * Math.pow(p.yi - yFE, 2); });
    const df = points.length - 1;
    const sumW2 = points.reduce((s, p) => s + Math.pow(1/p.vi, 2), 0);
    const c = W - sumW2 / W;
    const tau2 = Math.max(0, (Q - df) / c);
    let W2 = 0, WY2 = 0;
    points.forEach(p => { const w = 1/(p.vi + tau2); W2 += w; WY2 += w * p.yi; });
    const yRE = WY2 / W2;
    const seRE = Math.sqrt(1/W2);
    return {
      OR: Math.exp(yRE),
      ci_low: Math.exp(yRE - 1.96 * seRE),
      ci_high: Math.exp(yRE + 1.96 * seRE),
      k: points.length, tau2,
    };
  }

  function buildBody(P, treatments, matrix, cfg) {
    const fmt = P.fmt;
    const N = treatments.length;
    let html = '';

    html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;line-height:1.5;">'
          + 'Upper triangle: pooled OR (95% CI) — row vs column. '
          + 'Lower triangle: k (number of direct trials). '
          + 'Effects on the natural OR scale. Random-effects DL pool of direct comparisons only; '
          + 'indirect comparisons available via the consistency / contribution-matrix widgets.'
          + '</div>';

    html += '<div style="overflow-x:auto;"><table style="border-collapse:collapse;font-size:11px;font-family:JetBrains Mono,monospace;">';
    html += '<thead><tr><th style="padding:4px 8px;background:#1e293b;color:#cbd5e1;border:1px solid #334155;">vs →</th>';
    treatments.forEach(t => {
      html += '<th style="padding:4px 8px;background:#1e293b;color:#cbd5e1;border:1px solid #334155;text-align:center;font-size:10.5px;">' + t + '</th>';
    });
    html += '</tr></thead><tbody>';

    for (let i = 0; i < N; i++) {
      html += '<tr>';
      html += '<th style="padding:4px 8px;background:#1e293b;color:#cbd5e1;border:1px solid #334155;text-align:left;font-size:10.5px;">' + treatments[i] + '</th>';
      for (let j = 0; j < N; j++) {
        if (i === j) {
          html += '<td style="padding:4px 8px;border:1px solid #1e293b;background:#0b1220;color:#475569;text-align:center;">—</td>';
          continue;
        }
        if (i < j) {
          const cell = matrix[i][j];
          if (cell) {
            const sig = (cell.ci_low > 1) || (cell.ci_high < 1);
            const color = sig ? '#7dd3fc' : '#cbd5e1';
            html += '<td style="padding:4px 8px;border:1px solid #1e293b;background:#0b1220;color:' + color + ';text-align:center;white-space:nowrap;">'
                  + fmt(cell.OR, 2) + ' [' + fmt(cell.ci_low, 2) + '–' + fmt(cell.ci_high, 2) + ']</td>';
          } else {
            html += '<td style="padding:4px 8px;border:1px solid #1e293b;background:#0b1220;color:#475569;text-align:center;">—</td>';
          }
        } else {
          // i > j: lower triangle = k
          const cell = matrix[j][i];
          if (cell) {
            html += '<td style="padding:4px 8px;border:1px solid #1e293b;background:#0b1220;color:#94a3b8;text-align:center;">k=' + cell.k + '</td>';
          } else {
            html += '<td style="padding:4px 8px;border:1px solid #1e293b;background:#0b1220;color:#475569;text-align:center;">—</td>';
          }
        }
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
          + 'Highlighted cells (cyan) = 95% CI excludes OR=1. '
          + 'Salanti G et al. <em>BMJ</em> 2014 — league tables are a recommended NMA presentation. '
          + 'Direct evidence only; for indirect estimates see node-splitting + contribution-matrix widgets.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const cfg = getNMACfg();
    if (!cfg || !cfg.treatments || cfg.treatments.length < 2) return false;
    const rd = P.getRealData();
    if (!rd) return false;

    const treatments = cfg.treatments;
    const N = treatments.length;
    const matrix = Array.from({length: N}, () => Array(N).fill(null));

    // Build per-comparison pools from cfg.comparisons (preferred) or by inferring from realData
    let comparisons = cfg.comparisons || [];
    if (!comparisons.length && rd) {
      // Derive: group trials by (t1,t2) from t/c labels
      const groups = {};
      Object.entries(rd).forEach(([nct, t]) => {
        const a = t.t || t.treatment, b = t.c || t.comparator;
        if (!a || !b) return;
        const key = [a, b].sort().join(' :: ');
        groups[key] = groups[key] || { t1: a, t2: b, trials: [] };
        groups[key].trials.push(nct);
      });
      comparisons = Object.values(groups);
    }

    let totalCells = 0;
    comparisons.forEach(comp => {
      const i = treatments.indexOf(comp.t1);
      const j = treatments.indexOf(comp.t2);
      if (i < 0 || j < 0) return;
      const ii = Math.min(i, j), jj = Math.max(i, j);
      const points = [];
      (comp.trials || []).forEach(nctRef => {
        const t = (typeof nctRef === 'string' && rd[nctRef]) ? rd[nctRef] : nctRef;
        if (!t) return;
        // Determine sign: if comp.t1 === treatments[ii] then point as-is; else flip
        const flip = (comp.t1 !== treatments[ii]);
        const lo = trialLogOR(t);
        if (!lo) return;
        if (flip) lo.yi = -lo.yi;
        points.push(lo);
      });
      const pool = poolDLRE(points);
      if (pool) { matrix[ii][jj] = pool; totalCells++; }
    });

    if (totalCells === 0) return false;

    const summary = treatments.length + ' treatments · ' + totalCells + ' direct comparisons in matrix';

    const panel = P.buildCollapsiblePanel({
      id: 'nma-league-table-panel',
      badge: 'NMA League',
      summary,
      bodyHtml: buildBody(P, treatments, matrix, cfg),
      storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('nma-league-table-panel');
    if (existing) existing.replaceWith(panel);
    else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => {
      if (render()) return;
      if (++tries < 20) setTimeout(tick, 250);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 600));
    } else {
      setTimeout(tick, 600);
    }
  }

  global.NMALeagueTable = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
