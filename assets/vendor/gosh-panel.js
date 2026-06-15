/* gosh-panel.js — GOSH (Graphical display Of Study Heterogeneity) diagnostic.
 *
 * Engine: AlmGOSH.gosh (extracted verbatim from allmeta/gosh). Re-fits the pool
 * on every subset of studies (full enumeration k≤15; seeded random sample for
 * k>15) and plots the cloud of (estimate, I²) points. A multimodal cloud or
 * distinct clusters reveal influential studies / subgroups driving heterogeneity.
 *
 * Renders a compact inline canvas scatter (estimate on x, I² on y) with the
 * full-sample point highlighted, plus the estimate range. Binary outcomes
 * (log-OR), k≥3. Sensitivity / diagnostic.
 */
(function (global) {
  'use strict';
  const STORAGE_KEY = 'gosh-panel-expanded';

  function logORrows(trials) {
    return trials.map(t => {
      let ai = t.ai, ci = t.ci, n1 = t.n1i, n2 = t.n2i;
      if (ai === 0 || ci === 0 || ai === n1 || ci === n2) { ai += 0.5; ci += 0.5; n1 += 1; n2 += 1; }
      const a = ai, b = n1 - ai, c = ci, d = n2 - ci;
      return { te: Math.log((a * d) / (b * c)), se: Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d) };
    });
  }

  // Simple modality hint: largest gap in the sorted subset means, relative to the
  // overall spread. A large relative gap suggests ≥2 clusters (subgroups).
  function modalityHint(subsets) {
    const mus = subsets.map(s => s.mu).sort((a, b) => a - b);
    if (mus.length < 4) return { bimodalish: false, maxGap: 0 };
    const span = mus[mus.length - 1] - mus[0];
    let maxGap = 0;
    for (let i = 1; i < mus.length; i++) maxGap = Math.max(maxGap, mus[i] - mus[i - 1]);
    return { bimodalish: span > 0 && maxGap / span > 0.25, maxGap: maxGap };
  }

  function drawScatter(canvas, res) {
    if (!canvas || !canvas.getContext) return; // node stub / no canvas support
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height, pad = 28;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, W, H);
    const xs = res.subsets.map(s => s.mu);
    const xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
    const xr = (xMax - xMin) || 1;
    const sx = v => pad + (v - xMin) / xr * (W - 2 * pad);
    const sy = i2 => H - pad - (i2 / 100) * (H - 2 * pad);
    // axes
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad); ctx.moveTo(pad, pad); ctx.lineTo(pad, H - pad); ctx.stroke();
    // points
    ctx.fillStyle = 'rgba(125,211,252,0.35)';
    for (let i = 0; i < res.subsets.length; i++) {
      const s = res.subsets[i];
      ctx.beginPath(); ctx.arc(sx(s.mu), sy(s.I2), 1.6, 0, 2 * Math.PI); ctx.fill();
    }
    // full-sample point
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.arc(sx(res.full.mu), sy(res.full.I2), 4, 0, 2 * Math.PI); ctx.fill();
    // labels
    ctx.fillStyle = '#94a3b8'; ctx.font = '9px monospace';
    ctx.fillText('I²→', 4, pad + 8);
    ctx.fillText('estimate (logOR) →', W - 130, H - 8);
  }

  function buildNode(P, res) {
    const fmt = P.fmt;
    const wrap = document.createElement('div');
    const mh = modalityHint(res.subsets);
    const tone = mh.bimodalish ? '#fbbf24' : '#34d399';
    const bg = mh.bimodalish ? '#3a2a0a' : '#0e3a1f';
    const bd = mh.bimodalish ? '#92400e' : '#34d399';
    const verdict = mh.bimodalish
      ? '⚠ The subset cloud looks clustered (large gap in subset estimates) — possible subgroups / influential studies driving heterogeneity. Inspect the scatter.'
      : '✓ The subset cloud is contiguous — no obvious distinct clusters.';
    const head = document.createElement('div');
    head.style.cssText = 'background:' + bg + ';border:1px solid ' + bd + ';color:' + tone + ';padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;';
    head.textContent = verdict;
    wrap.appendChild(head);

    const stats = document.createElement('div');
    stats.style.cssText = 'font-size:11px;color:#94a3b8;margin-bottom:8px;';
    stats.innerHTML = res.nSubsets.toLocaleString() + ' subsets ' + (res.enumerated ? '(full enumeration)' : '(random sample, k&gt;15)')
      + ' · estimate range OR ' + fmt(Math.exp(res.muMin), 2) + '–' + fmt(Math.exp(res.muMax), 2)
      + ' · full-sample OR ' + fmt(Math.exp(res.full.mu), 2) + ' (I²=' + fmt(res.full.I2, 0) + '%)';
    wrap.appendChild(stats);

    const canvas = document.createElement('canvas');
    canvas.width = 360; canvas.height = 200;
    canvas.style.cssText = 'width:100%;max-width:360px;height:auto;border:1px solid #1e293b;border-radius:6px;background:#0b1220;';
    wrap.appendChild(canvas);
    drawScatter(canvas, res);

    const note = document.createElement('div');
    note.style.cssText = 'font-size:10.5px;color:#94a3b8;line-height:1.5;border-top:1px solid #1e293b;padding-top:8px;margin-top:10px;';
    note.innerHTML = '<strong>GOSH (Olkin-Dahabreh-Trikalinos 2012):</strong> each point is the pooled estimate (x) and I² (y) of one subset of studies. '
      + 'A single contiguous cloud is reassuring; ≥2 separated clusters indicate the overall estimate is a blend of distinct subpopulations or that one study flips the result. '
      + 'The amber point is the full-sample estimate. k≤15 enumerates all 2ᵏ−1 subsets; k&gt;15 uses a reproducible (seeded) random sample (advanced-stats.md).';
    wrap.appendChild(note);
    return wrap;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P || !global.AlmGOSH) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 3 || trials.length > 100) return false;
    const rows = logORrows(trials);
    let res;
    try { res = global.AlmGOSH.gosh(rows, { model: 'RE' }); } catch (e) { return false; }
    if (!res || !res.subsets.length) return false;

    const mh = modalityHint(res.subsets);
    const summary = res.nSubsets.toLocaleString() + ' subsets · OR ' + P.fmt(Math.exp(res.muMin), 2) + '–' + P.fmt(Math.exp(res.muMax), 2)
      + (mh.bimodalish ? ' · ⚠ clustered' : ' · ✓ contiguous');
    const panel = P.buildCollapsiblePanel({
      id: 'gosh-panel', badge: 'GOSH heterogeneity', summary,
      bodyNode: buildNode(P, res), storageKey: STORAGE_KEY,
    });
    const existing = document.getElementById('gosh-panel');
    if (existing) existing.replaceWith(panel); else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => { if (render()) return; if (++tries < 20) setTimeout(tick, 250); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1190));
    else setTimeout(tick, 1190);
  }

  global.GOSHPanel = { render, modalityHint };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
