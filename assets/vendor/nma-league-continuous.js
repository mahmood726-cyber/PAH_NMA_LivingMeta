/* NMA league table for continuous outcomes — analogue of nma-league-table.js
 * for NMAs whose primary outcome is on the MD scale.
 *
 * Per direct comparison (T_i, T_j), pools log-MD via DerSimonian-Laird
 * random effects from each trial's CONTINUOUS allOutcomes entry (md+se)
 * OR — fallback — from a type='PRIMARY' outcome whose shortLabel matches
 * a continuous-instrument allowlist (CDR-SB, MMSE, ppFEV1, BCVA, KCCQ,
 * SF36, EQ-5D, ETDRS, HADS, PHQ, GAD, MADRS, YBOCS, SLEDAI, UPDRS) with
 * pubHR/pubHR_LCI/pubHR_UCI carrying the MD point + 95% CI.
 *
 * Auto-bootstrap; collapsed by default. NMA-only.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'nma-league-continuous-expanded';

  const CONT_LABEL_RE = /^(CDR_?SB|CDR-?SB|MMSE|ADAS|PPF[Ee]V1|FEV1|BCVA|KCCQ|SF36|EQ5D|EQ-?5D|ETDRS|HADS|PHQ|GAD|HRSD|MADRS|YBOCS|SLEDAI|UPDRS|MD|change|score)/i;

  function pickContinuous(t) {
    if (!t) return null;
    const ao = t.allOutcomes || (t.data && t.data.allOutcomes);
    if (!Array.isArray(ao)) return null;
    let cont = ao.find(o => o && (o.type === 'CONTINUOUS' || o.type === 'continuous')
                                  && typeof o.md === 'number' && typeof o.se === 'number' && o.se > 0);
    if (cont) return { md: cont.md, se: cont.se };
    cont = ao.find(o => o && o.type === 'PRIMARY'
                            && CONT_LABEL_RE.test(String(o.shortLabel || o.title || ''))
                            && typeof o.pubHR === 'number'
                            && typeof o.pubHR_LCI === 'number'
                            && typeof o.pubHR_UCI === 'number'
                            && o.pubHR_UCI > o.pubHR_LCI);
    if (cont) {
      const md = cont.pubHR;
      const se = (cont.pubHR_UCI - cont.pubHR_LCI) / 3.92;
      if (se > 0 && isFinite(se)) return { md, se };
    }
    return null;
  }

  function poolDLRE(points) {
    if (!points || points.length === 0) return null;
    if (points.length === 1) {
      const p = points[0];
      return { md: p.yi, se: Math.sqrt(p.vi),
               ci_low: p.yi - 1.96*Math.sqrt(p.vi),
               ci_high: p.yi + 1.96*Math.sqrt(p.vi),
               k: 1, tau2: 0 };
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
      md: yRE, se: seRE,
      ci_low: yRE - 1.96*seRE,
      ci_high: yRE + 1.96*seRE,
      k: points.length, tau2,
    };
  }

  function buildBody(P, treatments, matrix) {
    const fmt = P.fmt;
    const N = treatments.length;
    let html = '';
    html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;line-height:1.5;">'
          + 'Continuous-outcome league table. Upper triangle: pooled mean difference (MD) with 95% CI for each direct comparison (row vs column). '
          + 'Lower triangle: k (number of direct trials). DerSimonian–Laird random-effects pool of direct comparisons only.'
          + '</div>';
    html += '<div style="overflow-x:auto;"><table style="border-collapse:collapse;font-size:11px;font-family:JetBrains Mono,monospace;">';
    html += '<thead><tr><th style="padding:4px 8px;background:#1e293b;color:#cbd5e1;border:1px solid #334155;">vs →</th>';
    treatments.forEach(t => {
      html += '<th style="padding:4px 8px;background:#1e293b;color:#cbd5e1;border:1px solid #334155;text-align:center;font-size:10.5px;">' + t + '</th>';
    });
    html += '</tr></thead><tbody>';
    let totalCells = 0;
    for (let i = 0; i < N; i++) {
      html += '<tr><th style="padding:4px 8px;background:#1e293b;color:#cbd5e1;border:1px solid #334155;text-align:left;font-size:10.5px;">' + treatments[i] + '</th>';
      for (let j = 0; j < N; j++) {
        if (i === j) {
          html += '<td style="padding:4px 8px;border:1px solid #1e293b;background:#0b1220;color:#475569;text-align:center;">—</td>';
          continue;
        }
        if (i < j) {
          const cell = matrix[i][j];
          if (cell) {
            totalCells++;
            const sig = (cell.ci_low > 0) || (cell.ci_high < 0);
            const color = sig ? '#7dd3fc' : '#cbd5e1';
            html += '<td style="padding:4px 8px;border:1px solid #1e293b;background:#0b1220;color:' + color + ';text-align:center;white-space:nowrap;">'
                  + fmt(cell.md, 2) + ' [' + fmt(cell.ci_low, 2) + '–' + fmt(cell.ci_high, 2) + ']</td>';
          } else {
            html += '<td style="padding:4px 8px;border:1px solid #1e293b;background:#0b1220;color:#475569;text-align:center;">—</td>';
          }
        } else {
          const cell = matrix[j][i];
          html += '<td style="padding:4px 8px;border:1px solid #1e293b;background:#0b1220;color:#94a3b8;text-align:center;">' + (cell ? 'k=' + cell.k : '—') + '</td>';
        }
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
          + 'Highlighted cells (cyan) = 95% CI excludes MD=0. Direct evidence only; for indirect / consistency see node-splitting + contribution-matrix widgets. '
          + 'Cochrane Handbook v6.5 §10.5; Salanti BMJ 2014 league-table convention.'
          + '</div>';
    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const cfg = global.NMA_CONFIG;
    if (!cfg || !cfg.treatments || cfg.treatments.length < 2) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const treatments = cfg.treatments;
    const N = treatments.length;
    const matrix = Array.from({length: N}, () => Array(N).fill(null));

    const comparisons = cfg.comparisons || [];
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
        const cont = pickContinuous(t);
        if (!cont) return;
        const flip = (comp.t1 !== treatments[ii]);
        const yi = flip ? -cont.md : cont.md;
        points.push({ yi, vi: cont.se * cont.se });
      });
      const pool = poolDLRE(points);
      if (pool) { matrix[ii][jj] = pool; totalCells++; }
    });

    if (totalCells === 0) return false;

    const summary = treatments.length + ' treatments · ' + totalCells + ' direct continuous comparisons';
    const panel = P.buildCollapsiblePanel({
      id: 'nma-league-continuous-panel', badge: 'NMA League (cont)',
      summary, bodyHtml: buildBody(P, treatments, matrix), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('nma-league-continuous-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1650));
    } else { setTimeout(tick, 1650); }
  }

  global.NMALeagueContinuous = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
