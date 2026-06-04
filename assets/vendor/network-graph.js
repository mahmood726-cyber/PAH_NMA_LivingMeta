/* Standard NMA network plot — pure SVG, zero deps.
 * Nodes = treatments (sized by total enrolled N on that arm).
 * Edges = DIRECT head-to-head comparisons only, thickness ~ sqrt(k trials).
 * Salanti & Cipriani 2009 / RevMan / netmeta-package convention.
 *
 * Auto-bootstraps. Looks for global `NMA_CONFIG` and `realData`.
 * Renders into the first matching container:
 *   #standard-network-graph (preferred)
 *   #nma-network-plot       (sibling — appended to its parent)
 *
 * Usage (manual):
 *   NetworkGraph.render('#my-container', { treatments, comparisons, realData });
 *
 * Public API:
 *   NetworkGraph.render(selector, config)
 */
(function (global) {
  'use strict';

  const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
                   '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#a855f7'];

  function buildEdgesFromConfig(cfg) {
    // cfg.comparisons: [{ t1, t2, trials: [nctIds...] }, ...]
    const edges = [];
    (cfg.comparisons || []).forEach(c => {
      if (!c.t1 || !c.t2) return;
      const k = (c.trials || []).length;
      if (k === 0) return;
      edges.push({ t1: c.t1, t2: c.t2, k });
    });
    return edges;
  }

  function inferEdgesFromRealData(realData, treatments) {
    // Fallback: derive from realData[*].t/c labels
    const counts = {};
    Object.values(realData || {}).forEach(t => {
      const a = t.t || t.treatment;
      const b = t.c || t.comparator;
      if (!a || !b || a === b) return;
      const key = [a, b].sort().join(' :: ');
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).map(([k, v]) => {
      const [t1, t2] = k.split(' :: ');
      return { t1, t2, k: v };
    });
  }

  function computeNodeSizes(treatments, realData, cfg) {
    const nMap = {};
    treatments.forEach(t => { nMap[t] = 0; });
    Object.values(realData || {}).forEach(trial => {
      const t = trial.t || trial.treatment;
      const c = trial.c || trial.comparator;
      const tN = +trial.tN || 0;
      const cN = +trial.cN || 0;
      if (t && nMap[t] !== undefined) nMap[t] += tN;
      if (c && nMap[c] !== undefined) nMap[c] += cN;
    });
    return nMap;
  }

  function render(selector, config) {
    const el = (typeof selector === 'string')
      ? document.querySelector(selector)
      : selector;
    if (!el) return false;

    const treatments = (config.treatments || []).slice();
    if (treatments.length < 2) {
      el.innerHTML = '<div style="padding:14px;color:#94a3b8;font-size:12px;">' +
        'Network graph: needs ≥2 treatments.</div>';
      return false;
    }

    let edges = (config.comparisons && config.comparisons.length)
      ? buildEdgesFromConfig(config)
      : inferEdgesFromRealData(config.realData, treatments);
    edges = edges.filter(e => treatments.indexOf(e.t1) >= 0 &&
                              treatments.indexOf(e.t2) >= 0);

    const nMap = computeNodeSizes(treatments, config.realData, config);

    // Layout — circle
    const W = 600, H = 460, cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.34;
    const angleStep = (2 * Math.PI) / treatments.length;
    const positions = {};
    treatments.forEach((t, i) => {
      const a = i * angleStep - Math.PI / 2;
      positions[t] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
    });

    // Node radius: sqrt(N) scaled, clamped
    const nVals = Object.values(nMap);
    const nMax = Math.max(1, ...nVals);
    function nodeR(n) {
      const base = 16;
      const extra = 22 * Math.sqrt((n || 0) / nMax);
      return Math.max(base, base + extra);
    }

    // Edge stroke width: sqrt(k) scaled
    const kMax = Math.max(1, ...edges.map(e => e.k));
    function edgeW(k) {
      return 1 + 6 * Math.sqrt(k / kMax);
    }

    // SVG
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('style', 'max-width:760px;background:#0f172a;border-radius:8px;');

    // Edges first (behind nodes)
    edges.forEach(e => {
      const p1 = positions[e.t1], p2 = positions[e.t2];
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
      line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
      line.setAttribute('stroke', '#64748b');
      line.setAttribute('stroke-width', edgeW(e.k));
      line.setAttribute('stroke-opacity', '0.7');
      const title = document.createElementNS(svgNS, 'title');
      title.textContent = `${e.t1} vs ${e.t2}: k=${e.k} trial${e.k > 1 ? 's' : ''}`;
      line.appendChild(title);
      svg.appendChild(line);

      // Edge label (k value) at midpoint
      if (e.k >= 1) {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const lbl = document.createElementNS(svgNS, 'text');
        lbl.setAttribute('x', mx);
        lbl.setAttribute('y', my);
        lbl.setAttribute('fill', '#cbd5e1');
        lbl.setAttribute('font-size', '10');
        lbl.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('dominant-baseline', 'central');
        lbl.style.pointerEvents = 'none';
        // small chip background
        const chip = document.createElementNS(svgNS, 'rect');
        chip.setAttribute('x', mx - 9);
        chip.setAttribute('y', my - 8);
        chip.setAttribute('width', 18);
        chip.setAttribute('height', 16);
        chip.setAttribute('rx', 8);
        chip.setAttribute('fill', '#1e293b');
        chip.setAttribute('stroke', '#475569');
        chip.setAttribute('stroke-width', '1');
        svg.appendChild(chip);
        lbl.textContent = e.k;
        svg.appendChild(lbl);
      }
    });

    // Nodes
    treatments.forEach((t, i) => {
      const p = positions[t];
      const r = nodeR(nMap[t]);
      const colour = (t.toLowerCase().indexOf('placebo') >= 0 ||
                      t.toLowerCase().indexOf('control') >= 0)
        ? '#475569' : PALETTE[i % PALETTE.length];

      const g = document.createElementNS(svgNS, 'g');

      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', p.x);
      circle.setAttribute('cy', p.y);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', colour);
      circle.setAttribute('fill-opacity', '0.85');
      circle.setAttribute('stroke', '#0f172a');
      circle.setAttribute('stroke-width', '2');

      const title = document.createElementNS(svgNS, 'title');
      title.textContent = `${t}\nTotal N: ${nMap[t]}`;
      circle.appendChild(title);
      g.appendChild(circle);

      // Inside-circle N label
      const nLbl = document.createElementNS(svgNS, 'text');
      nLbl.setAttribute('x', p.x);
      nLbl.setAttribute('y', p.y);
      nLbl.setAttribute('fill', '#fff');
      nLbl.setAttribute('font-size', '11');
      nLbl.setAttribute('font-weight', '700');
      nLbl.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      nLbl.setAttribute('text-anchor', 'middle');
      nLbl.setAttribute('dominant-baseline', 'central');
      nLbl.style.pointerEvents = 'none';
      nLbl.textContent = nMap[t] >= 1000
        ? (nMap[t] / 1000).toFixed(1) + 'k'
        : (nMap[t] || '?');
      g.appendChild(nLbl);

      // Outside label (treatment name)
      const labelOffsetR = r + 10;
      const a = i * angleStep - Math.PI / 2;
      const lx = p.x + labelOffsetR * Math.cos(a);
      const ly = p.y + labelOffsetR * Math.sin(a);
      const tLbl = document.createElementNS(svgNS, 'text');
      tLbl.setAttribute('x', lx);
      tLbl.setAttribute('y', ly);
      tLbl.setAttribute('fill', '#f1f5f9');
      tLbl.setAttribute('font-size', '12');
      tLbl.setAttribute('font-weight', '600');
      tLbl.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      const cosA = Math.cos(a);
      tLbl.setAttribute('text-anchor', cosA > 0.2 ? 'start' : (cosA < -0.2 ? 'end' : 'middle'));
      tLbl.setAttribute('dominant-baseline', Math.sin(a) > 0.2 ? 'hanging' : (Math.sin(a) < -0.2 ? 'auto' : 'central'));
      tLbl.style.pointerEvents = 'none';
      tLbl.textContent = t;
      g.appendChild(tLbl);

      svg.appendChild(g);
    });

    // Render
    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:8px 0;';
    const header = document.createElement('div');
    header.style.cssText = 'font-size:11px;color:#94a3b8;margin-bottom:6px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;';
    header.innerHTML = '<span><strong style="color:#e2e8f0;">Standard network graph</strong> — direct comparisons only (Salanti 2009)</span>' +
      '<span>Node area ∝ enrolled N · Edge width ∝ √k · k = trials</span>';
    wrap.appendChild(header);
    wrap.appendChild(svg);

    // Stats line
    const directK = edges.length;
    const totalPairs = treatments.length * (treatments.length - 1) / 2;
    const stats = document.createElement('div');
    stats.style.cssText = 'font-size:11px;color:#64748b;margin-top:6px;';
    stats.textContent =
      `${treatments.length} treatments · ${directK} direct edge${directK !== 1 ? 's' : ''} · ` +
      `${totalPairs - directK} indirect-only pair${(totalPairs - directK) !== 1 ? 's' : ''}` +
      (directK === totalPairs ? ' · fully connected' : '');
    wrap.appendChild(stats);

    el.appendChild(wrap);
    return true;
  }

  function autoBootstrap() {
    if (typeof document === 'undefined') return;

    function tryRender() {
      const cfg = global.NMA_CONFIG;
      if (!cfg || !cfg.treatments || cfg.treatments.length < 2) return false;

      let host = document.getElementById('standard-network-graph');
      if (!host) {
        const existing = document.getElementById('nma-network-plot');
        if (!existing) return false;
        // Insert a sibling container after existing
        host = document.createElement('div');
        host.id = 'standard-network-graph';
        host.style.cssText = 'margin-top:18px;';
        existing.parentNode.insertBefore(host, existing.nextSibling);
        // Insert section divider/heading
        const sep = document.createElement('div');
        sep.style.cssText = 'margin:10px 0 4px 0;font-size:12px;color:#94a3b8;border-top:1px dashed #334155;padding-top:10px;';
        sep.textContent = '↓ Standard interconnected-node view';
        existing.parentNode.insertBefore(sep, host);
      }

      return render(host, {
        treatments: cfg.treatments,
        comparisons: cfg.comparisons,
        realData: global.realData
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tryRender, 200));
    } else {
      // Retry — realData/NMA_CONFIG may load late
      let tries = 0;
      const tick = () => {
        if (tryRender()) return;
        if (++tries < 20) setTimeout(tick, 250);
      };
      setTimeout(tick, 100);
    }
  }

  global.NetworkGraph = { render, autoBootstrap };
  autoBootstrap();
})(typeof window !== 'undefined' ? window : this);
