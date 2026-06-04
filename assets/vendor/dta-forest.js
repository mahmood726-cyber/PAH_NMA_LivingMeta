/* DTA twin forest plot — sensitivity & specificity side-by-side per study,
 * with summary diamond and 95% Wilson per-trial CIs.
 *
 * Companion to dta-bivariate.js. Reuses the same parseCellsFromText
 * detection (legacy _screeningStudies + standard realData TP/FP/FN/TN).
 *
 * Auto-bootstrap; collapsed by default. Self-skips silently when no
 * DTA data detected.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'dta-forest-expanded';

  function parseCellsFromText(text) {
    if (!text) return null;
    const stripCommas = s => +String(s).replace(/,/g, '');
    const re = (label) => new RegExp('\\b' + label + '\\s*=\\s*(\\d{1,3}(?:,\\d{3})*|\\d+)', 'i');
    const grab = (label) => { const m = text.match(re(label)); return m ? stripCommas(m[1]) : null; };
    const TP = grab('TP'), FP = grab('FP'), FN = grab('FN'), TN = grab('TN');
    if (TP !== null && FP !== null && FN !== null && TN !== null) return { TP, FP, FN, TN };
    const sm = text.match(/Sens\s*[≈~]?\s*(\d+(?:\.\d+)?)\s*%/i);
    const spm = text.match(/Spec\s*[≈~]?\s*(\d+(?:\.\d+)?)\s*%/i);
    const nPosM = text.match(/(\d+)\s*(?:culture[\s-]?positive|TB[+\s]?\+?|disease[d\s]?\+?|positive)/i);
    const nNegM = text.match(/(\d+)\s*(?:culture[\s-]?negative|TB[\s-]?[−-]?|disease[d\s]?[−-]?|negative)/i);
    if (sm && spm && nPosM && nNegM) {
      const sens = +sm[1] / 100, spec = +spm[1] / 100;
      const nPos = +nPosM[1], nNeg = +nNegM[1];
      const _TP = Math.round(sens * nPos), _FN = nPos - _TP;
      const _TN = Math.round(spec * nNeg), _FP = nNeg - _TN;
      if (_TP >= 0 && _FN >= 0 && _TN >= 0 && _FP >= 0) return { TP: _TP, FP: _FP, FN: _FN, TN: _TN };
    }
    const slotM = text.match(/(\d+)\s*\/\s*(\d+)\s*(?:and|;|\.|,)\s*(\d+)\s*\/\s*(\d+)/);
    if (slotM) {
      const tp = +slotM[1], dPos = +slotM[2], tn = +slotM[3], dNeg = +slotM[4];
      if (tp <= dPos && tn <= dNeg && dPos > 0 && dNeg > 0) {
        return { TP: tp, FP: dNeg - tn, FN: dPos - tp, TN: tn };
      }
    }
    return null;
  }

  function pickDTATrials(rd) {
    const out = [];
    const ss = global._screeningStudies;
    if (Array.isArray(ss)) {
      ss.forEach(s => {
        if (!s || s.decision !== 'included') return;
        const cells = parseCellsFromText(s.rationale || '');
        if (!cells) return;
        if ((cells.TP + cells.FN) > 0 && (cells.TN + cells.FP) > 0) {
          out.push({ name: s.studlab || '?', ...cells });
        }
      });
      if (out.length >= 2) return out;
    }
    if (!rd) return out;
    Object.values(rd).forEach(t => {
      if (!t) return;
      const TP = +t.TP, FP = +t.FP, FN = +t.FN, TN = +t.TN;
      if ([TP, FP, FN, TN].every(v => Number.isFinite(v) && v >= 0)
          && (TP + FN) > 0 && (TN + FP) > 0) {
        out.push({ name: t.name || '?', TP, FP, FN, TN });
      }
    });
    return out;
  }

  // Wilson CI for a proportion
  function wilson(x, n) {
    const p = x / n, z = 1.96, denom = 1 + z*z/n;
    const center = (p + z*z/(2*n)) / denom;
    const halfw = z * Math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / denom;
    return { lo: Math.max(0, center - halfw), hi: Math.min(1, center + halfw) };
  }

  function buildForest(trials) {
    // Two side-by-side forests: Se on left, Sp on right
    const W = 760, rowH = 22, H = 70 + rowH * trials.length + 30; // +30 for summary
    const nameCol = 200;
    const eachW = (W - nameCol - 30) / 2;  // half-width minus separator
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="background:#0b1220;border-radius:6px;font-family:Inter,system-ui,sans-serif;">';
    // Headers
    svg += '<text x="6" y="20" fill="#94a3b8" font-size="10.5" font-weight="600">Trial</text>';
    svg += '<text x="' + (nameCol + eachW/2) + '" y="20" fill="#7dd3fc" font-size="11" text-anchor="middle" font-weight="600">Sensitivity (Se)</text>';
    svg += '<text x="' + (nameCol + eachW + 30 + eachW/2) + '" y="20" fill="#34d399" font-size="11" text-anchor="middle" font-weight="600">Specificity (Sp)</text>';
    // Tick labels at 0, 50%, 100%
    [0, 0.5, 1.0].forEach(p => {
      const xSe = nameCol + p * eachW;
      const xSp = nameCol + eachW + 30 + p * eachW;
      svg += '<line x1="' + xSe + '" x2="' + xSe + '" y1="32" y2="' + (H - 30) + '" stroke="#1e293b" stroke-dasharray="2,3" />';
      svg += '<line x1="' + xSp + '" x2="' + xSp + '" y1="32" y2="' + (H - 30) + '" stroke="#1e293b" stroke-dasharray="2,3" />';
      svg += '<text x="' + xSe + '" y="' + (H - 14) + '" fill="#94a3b8" font-size="9.5" text-anchor="middle">' + (p*100).toFixed(0) + '%</text>';
      svg += '<text x="' + xSp + '" y="' + (H - 14) + '" fill="#94a3b8" font-size="9.5" text-anchor="middle">' + (p*100).toFixed(0) + '%</text>';
    });

    let totalTP = 0, totalFN = 0, totalTN = 0, totalFP = 0;
    trials.forEach((t, i) => {
      const y = 40 + rowH * i;
      const { TP, FP, FN, TN } = t;
      totalTP += TP; totalFN += FN; totalTN += TN; totalFP += FP;
      const se = TP / (TP + FN), sp = TN / (TN + FP);
      const seCI = wilson(TP, TP + FN);
      const spCI = wilson(TN, TN + FP);
      // Trial label
      svg += '<text x="6" y="' + (y + 4) + '" fill="#cbd5e1" font-size="10.5">' + (t.name || '?').slice(0, 28) + '</text>';
      // Se forest segment
      const xSeC = nameCol + se * eachW;
      const xSeL = nameCol + seCI.lo * eachW;
      const xSeH = nameCol + seCI.hi * eachW;
      svg += '<line x1="' + xSeL + '" x2="' + xSeH + '" y1="' + y + '" y2="' + y + '" stroke="#7dd3fc" stroke-width="1.5" />';
      svg += '<rect x="' + (xSeC - 3) + '" y="' + (y - 3) + '" width="6" height="6" fill="#7dd3fc" stroke="#0b1220" stroke-width="0.5" />';
      // Sp forest segment
      const xSpStart = nameCol + eachW + 30;
      const xSpC = xSpStart + sp * eachW;
      const xSpL = xSpStart + spCI.lo * eachW;
      const xSpH = xSpStart + spCI.hi * eachW;
      svg += '<line x1="' + xSpL + '" x2="' + xSpH + '" y1="' + y + '" y2="' + y + '" stroke="#34d399" stroke-width="1.5" />';
      svg += '<rect x="' + (xSpC - 3) + '" y="' + (y - 3) + '" width="6" height="6" fill="#34d399" stroke="#0b1220" stroke-width="0.5" />';
    });
    // Summary diamonds (Wilson on totals — rough fixed-effect)
    const summY = 40 + rowH * trials.length + 8;
    const sumSe = totalTP / (totalTP + totalFN);
    const sumSp = totalTN / (totalTN + totalFP);
    const sumSeCI = wilson(totalTP, totalTP + totalFN);
    const sumSpCI = wilson(totalTN, totalTN + totalFP);
    const xSeC = nameCol + sumSe * eachW;
    const xSeL = nameCol + sumSeCI.lo * eachW;
    const xSeH = nameCol + sumSeCI.hi * eachW;
    const xSpStart = nameCol + eachW + 30;
    const xSpC = xSpStart + sumSp * eachW;
    const xSpL = xSpStart + sumSpCI.lo * eachW;
    const xSpH = xSpStart + sumSpCI.hi * eachW;
    svg += '<text x="6" y="' + (summY + 4) + '" fill="#fbbf24" font-size="10.5" font-weight="600">Summary (FE pool)</text>';
    svg += '<polygon points="' + xSeL + ',' + summY + ' ' + xSeC + ',' + (summY-5) + ' ' + xSeH + ',' + summY + ' ' + xSeC + ',' + (summY+5) + '" fill="#fbbf24" stroke="#0b1220" stroke-width="0.5" />';
    svg += '<polygon points="' + xSpL + ',' + summY + ' ' + xSpC + ',' + (summY-5) + ' ' + xSpH + ',' + summY + ' ' + xSpC + ',' + (summY+5) + '" fill="#fbbf24" stroke="#0b1220" stroke-width="0.5" />';
    svg += '</svg>';
    return svg;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const trials = pickDTATrials(P.getRealData());
    if (trials.length < 2) return false;
    const sumTP = trials.reduce((s,t) => s + t.TP, 0);
    const sumFN = trials.reduce((s,t) => s + t.FN, 0);
    const sumTN = trials.reduce((s,t) => s + t.TN, 0);
    const sumFP = trials.reduce((s,t) => s + t.FP, 0);
    const sumSe = sumTP / (sumTP + sumFN);
    const sumSp = sumTN / (sumTN + sumFP);
    const summary = 'k=' + trials.length + ' · summary FE Se ' + P.fmt(sumSe*100, 1) + '%, Sp ' + P.fmt(sumSp*100, 1) + '%';
    const svg = buildForest(trials);
    const note = '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
               + 'Twin forest: per-study Sensitivity (cyan) and Specificity (green) with 95% Wilson CIs. '
               + 'Summary (gold diamond) is a fixed-effect pool of cells; the bivariate random-effects pool with τ²<sub>Se</sub>, τ²<sub>Sp</sub>, and ρ '
               + 'lives in the parent <em>DTA</em> panel above. Cochrane DTA Handbook ch.10.'
               + '</div>';
    const panel = P.buildCollapsiblePanel({
      id: 'dta-forest-panel', badge: 'DTA Forest', summary, bodyHtml: svg + note, storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('dta-forest-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1350));
    } else { setTimeout(tick, 1350); }
  }

  global.DTAForest = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
