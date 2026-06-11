/*
 * wide-gap-methods.js — RapidMeta OPTIONAL registry-native panels.
 * ----------------------------------------------------------------------------
 * Four self-contained, offline, dormant-until-data panels that exploit
 * structured registry data ordinary meta-analysis discards. Ported from the
 * validated glp1-obesity-mbnma engines (WIDE_GAP_METHODS.md):
 *   1. Component NMA            — additive receptor/component decomposition
 *                                 (Welton 2009 / Rücker 2020; closed-form WLS
 *                                 validated to 1e-9 vs netmeta::discomb).
 *   2. Registry pub-bias        — posted-but-unpublished "ghost" trial as
 *                                 GROUND TRUTH; flags when a trim-fill
 *                                 correction would be spurious.
 *   3. Joint benefit-risk       — bivariate efficacy-vs-AE frontier; marks
 *                                 dominated options.
 *   4. TSA pipeline note        — augments the TSA chip with the live
 *                                 still-enrolling trial count (research-
 *                                 prioritisation signal).
 *
 * Each activates ONLY when the trials carry the relevant optional field; with
 * none present every panel stays hidden and inert, so existing dashboards are
 * unaffected. Self-hooks TransportabilityEngine.render (runs every analysis).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  function esc(s) { return (typeof window.escapeHtml === 'function' ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s)); }
  function num(x) { var v = parseFloat(x); return isFinite(v) ? v : null; }
  var Z = 1.959963985;

  // ---------- linear algebra (CNMA) ----------
  function zeros(r, c) { var o = []; for (var i = 0; i < r; i++) { o.push(new Array(c).fill(0)); } return o; }
  function transpose(M) { return M[0].map(function (_, j) { return M.map(function (r) { return r[j]; }); }); }
  function matMul(A, B) { var r = A.length, c = B[0].length, n = B.length, O = zeros(r, c); for (var i = 0; i < r; i++) for (var j = 0; j < c; j++) { var s = 0; for (var k = 0; k < n; k++) s += A[i][k] * B[k][j]; O[i][j] = s; } return O; }
  function matVec(A, v) { return A.map(function (row) { return row.reduce(function (s, x, j) { return s + x * v[j]; }, 0); }); }
  function invert(M) {
    var n = M.length, A = M.map(function (r, i) { return r.concat(Array.from({ length: n }, function (_, j) { return i === j ? 1 : 0; })); });
    for (var i = 0; i < n; i++) {
      var p = A[i][i], pr = i;
      for (var r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(p)) { p = A[r][i]; pr = r; }
      var tmp = A[i]; A[i] = A[pr]; A[pr] = tmp;
      var piv = A[i][i]; if (!isFinite(piv) || Math.abs(piv) < 1e-15) throw new Error('singular design (collinear components)');
      for (var j = 0; j < 2 * n; j++) A[i][j] /= piv;
      for (var r2 = 0; r2 < n; r2++) { if (r2 === i) continue; var f = A[r2][i]; for (var j2 = 0; j2 < 2 * n; j2++) A[r2][j2] -= f * A[i][j2]; }
    }
    return A.map(function (r) { return r.slice(n); });
  }
  // additive contrast CNMA (common + RE via tau2); rows: {A:[comp...], B:[comp...], te, se}
  function cnmaFit(rows) {
    var cs = {};
    rows.forEach(function (r) { (r.A || []).forEach(function (c) { cs[c] = 1; }); (r.B || []).forEach(function (c) { cs[c] = 1; }); });
    var comps = Object.keys(cs).sort(), p = comps.length;
    var X = zeros(rows.length, p);
    rows.forEach(function (r, i) { (r.A || []).forEach(function (c) { X[i][comps.indexOf(c)] += 1; }); (r.B || []).forEach(function (c) { X[i][comps.indexOf(c)] -= 1; }); });
    var y = rows.map(function (r) { return r.te; }), w = rows.map(function (r) { return 1 / (r.se * r.se); }), Xt = transpose(X);
    function wls(W) { var XtW = Xt.map(function (row) { return row.map(function (x, j) { return x * W[j]; }); }); var cov = invert(matMul(XtW, X)); var beta = matVec(cov, matVec(XtW, y)); return { beta: beta, cov: cov }; }
    var b0 = wls(w).beta;
    var res = y.map(function (yi, i) { return yi - X[i].reduce(function (s, x, j) { return s + x * b0[j]; }, 0); });
    var Q = res.reduce(function (s, r, i) { return s + w[i] * r * r; }, 0), df = Math.max(1, rows.length - p);
    var sumW = w.reduce(function (a, b) { return a + b; }, 0), sumW2 = w.reduce(function (a, b) { return a + b * b; }, 0);
    var tau2 = Math.max(0, (Q - df) / (sumW - sumW2 / sumW));
    var r2 = wls(rows.map(function (r) { return 1 / (r.se * r.se + tau2); }));
    return { comps: comps, beta: r2.beta, cov: r2.cov, tau2: tau2, Q: Q, df: df };
  }
  window.WideGapCNMA = { fit: cnmaFit };  // exposed for tests

  function pmPool(y, v) {  // Paule-Mandel RE pool
    y = y.map(Number); v = v.map(Number); var tau2 = 0, k = y.length, w, mu;
    for (var it = 0; it < 500; it++) {
      w = v.map(function (vi) { return 1 / (vi + tau2); });
      var sw = w.reduce(function (a, b) { return a + b; }, 0);
      mu = y.reduce(function (s, yi, i) { return s + w[i] * yi; }, 0) / sw;
      var Q = y.reduce(function (s, yi, i) { return s + w[i] * (yi - mu) * (yi - mu); }, 0);
      var diff = Q - (k - 1); if (Math.abs(diff) < 1e-8) break;
      var deriv = y.reduce(function (s, yi, i) { return s + w[i] * w[i] * (yi - mu) * (yi - mu); }, 0);
      tau2 = Math.max(0, tau2 + diff / Math.max(deriv, 1e-12));
    }
    w = v.map(function (vi) { return 1 / (vi + tau2); });
    var sw = w.reduce(function (a, b) { return a + b; }, 0);
    mu = y.reduce(function (s, yi, i) { return s + w[i] * yi; }, 0) / sw;
    return { mu: mu, se: Math.sqrt(1 / sw), tau2: tau2 };
  }

  function trialsInc() {
    var RM = window.RapidMeta; if (!RM || !RM.state || !RM.state.trials) return [];
    return RM.state.trials.filter(function (t) {
      var inc = (typeof window.isIncludeLikeForAnalysis === 'function') ? window.isIncludeLikeForAnalysis(t, RM.realData) : true;
      return inc && t.data;
    });
  }

  // ============================================================ 1. Component NMA
  var CNMA = {
    rows: function () {
      // each trial may carry data.components = [comp...] and a poolable effect (data.cnmaTE/cnmaSE),
      // else fall back to publishedHR (log scale) when present.
      var out = [];
      trialsInc().forEach(function (t) {
        var comps = t.data.components;
        if (!Array.isArray(comps) || comps.length === 0) return;
        var te = num(t.data.cnmaTE), se = num(t.data.cnmaSE);
        if (te === null && num(t.data.publishedHR) !== null && num(t.data.hrLCI) !== null && num(t.data.hrUCI) !== null) {
          te = Math.log(num(t.data.publishedHR)); se = (Math.log(num(t.data.hrUCI)) - Math.log(num(t.data.hrLCI))) / (2 * Z);
        }
        if (te === null || se === null || !(se > 0)) return;
        out.push({ A: comps.slice(), B: [], te: te, se: se, name: t.name || t.nct });
      });
      return out;
    },
    has: function () { var r = this.rows(); var cs = {}; r.forEach(function (x) { x.A.forEach(function (c) { cs[c] = 1; }); }); return r.length >= 2 && Object.keys(cs).length >= 1 && r.length > Object.keys(cs).length - 1; },
    render: function () {
      var sec = document.getElementById('cnma-section'), c = document.getElementById('cnma-container');
      if (!sec || !c) return;
      if (!this.has()) { sec.classList.add('hidden'); return; }
      var rows = this.rows(), f;
      try { f = cnmaFit(rows); } catch (e) { sec.classList.remove('hidden'); c.innerHTML = '<div class="text-rose-300 text-xs">Component NMA unavailable: ' + esc(e.message) + '</div>'; return; }
      sec.classList.remove('hidden');
      var comp = f.comps.map(function (cc, i) { var e = f.beta[i], se = Math.sqrt(f.cov[i][i]); return '<tr class="border-b border-slate-800/60"><td class="p-2 font-mono">' + esc(cc) + '</td><td class="p-2 font-mono text-teal-300">' + e.toFixed(3) + '</td><td class="p-2 font-mono opacity-70">' + se.toFixed(3) + '</td><td class="p-2 font-mono text-[10px]">[' + (e - Z * se).toFixed(3) + ', ' + (e + Z * se).toFixed(3) + ']</td></tr>'; }).join('');
      var het = f.Q > f.df ? 'substantial (common-component assumption strained)' : 'modest';
      c.innerHTML =
        '<span class="text-[9px] uppercase tracking-widest px-3 py-1 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">Component NMA &middot; additive decomposition &middot; validated vs netmeta::discomb (1e-9)</span>' +
        '<div class="overflow-x-auto mt-3"><table class="w-full text-left text-[11px]"><thead class="bg-slate-950/60 text-[9px] uppercase font-bold tracking-widest opacity-60"><tr><th class="p-2">Component</th><th class="p-2">Effect</th><th class="p-2">SE</th><th class="p-2">95% CI</th></tr></thead><tbody>' + comp + '</tbody></table></div>' +
        '<div class="mt-2 text-[9px] opacity-60">Additive contrast CNMA (Welton 2009 / R&uuml;cker 2020): decomposes each intervention into its components, so an un-trialled combination can be predicted from observed parts. Fit: Q=' + f.Q.toFixed(1) + ', df=' + f.df + ' &rarr; heterogeneity ' + het + (f.tau2 > 0 ? ', &tau;&sup2;=' + f.tau2.toFixed(3) : '') + '. <b>Honest:</b> the common-component-across-molecules assumption is approximate; read direction + magnitude, not pharmacological constants.</div>';
    }
  };

  // ============================================================ 2. Registry pub-bias
  var RegPubBias = {
    // a node may carry data.ghostTrials = [{loss/te}] and the panel re-pools published vs +ghost.
    // simplest portable form: read a precomputed object on RapidMeta.state.registryPubBias OR
    // any trial.data.registryGhost flag with effects in plotData.
    has: function () { var RM = window.RapidMeta; return !!(RM && RM.state && RM.state.registryPubBias && Array.isArray(RM.state.registryPubBias.published)); },
    render: function () {
      var el = document.getElementById('chip-registry-pubbias');
      if (!el) return;
      if (!this.has()) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      var d = window.RapidMeta.state.registryPubBias;
      var pub = pmPool(d.published.map(function (x) { return x.te; }), d.published.map(function (x) { return x.v; }));
      var all = d.published.concat(d.ghosts || []);
      var comp = pmPool(all.map(function (x) { return x.te; }), all.map(function (x) { return x.v; }));
      var shift = comp.mu - pub.mu;
      var spurious = (d.eggerP != null && d.eggerP < 0.10 && Math.abs(shift) < 0.5);
      el.title = 'Registry-aware publication bias: ' + (d.ghosts ? d.ghosts.length : 0) + ' observed ghost trial(s). Measured shift vs published-only = ' + shift.toFixed(2) +
        (spurious ? '. Egger flags asymmetry (p=' + d.eggerP + ') but the OBSERVED ghost is only ' + shift.toFixed(2) + ' from the pooled mean -> a trim-fill correction would be SPURIOUS (small-study heterogeneity, not suppression).' : '. The registry measures the missing-trial contribution directly.');
      el.innerHTML = '<i class="fa-solid fa-ghost" style="font-size:10px"></i> Registry bias: ' + (spurious ? 'spurious-flag' : (shift >= 0 ? '+' : '') + shift.toFixed(2));
    }
  };

  // ============================================================ 3. Joint benefit-risk frontier
  var BenefitRisk = {
    points: function () {
      // trials/nodes may carry data.benefit (efficacy, higher=better) + data.risk (AE rate, lower=better)
      var out = [];
      trialsInc().forEach(function (t) {
        var b = num(t.data.benefit), r = num(t.data.risk);
        if (b === null || r === null) return;
        out.push({ name: t.name || t.nct, b: b, r: r });
      });
      return out;
    },
    has: function () { return this.points().length >= 2; },
    render: function () {
      var sec = document.getElementById('benefitrisk-section'), c = document.getElementById('benefitrisk-container');
      if (!sec || !c) return;
      if (!this.has()) { sec.classList.add('hidden'); return; }
      sec.classList.remove('hidden');
      var pts = this.points();
      // Pareto frontier: a point is dominated if another has >= benefit AND <= risk (strictly better on one).
      pts.forEach(function (p) {
        p.dominated = pts.some(function (q) { return q !== p && q.b >= p.b && q.r <= p.r && (q.b > p.b || q.r < p.r); });
      });
      var rows = pts.slice().sort(function (a, b) { return b.b - a.b; }).map(function (p) {
        return '<tr class="border-b border-slate-800/60"><td class="p-2 font-semibold">' + esc(p.name) + '</td><td class="p-2 font-mono text-emerald-300">' + p.b.toFixed(2) + '</td><td class="p-2 font-mono text-rose-300">' + p.r.toFixed(2) + '</td><td class="p-2 text-center">' + (p.dominated ? '<span class="text-[9px] uppercase px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-400/30">dominated</span>' : '<span class="text-[9px] uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-400/30">on frontier</span>') + '</td></tr>';
      }).join('');
      c.innerHTML =
        '<span class="text-[9px] uppercase tracking-widest px-3 py-1 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">Benefit-risk frontier &middot; efficacy vs adverse-event trade-off</span>' +
        '<div class="overflow-x-auto mt-3"><table class="w-full text-left text-[11px]"><thead class="bg-slate-950/60 text-[9px] uppercase font-bold tracking-widest opacity-60"><tr><th class="p-2">Option</th><th class="p-2">Benefit</th><th class="p-2">Risk (AE)</th><th class="p-2 text-center">Frontier</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="mt-2 text-[9px] opacity-60">Bivariate benefit-vs-risk (multivariate-MA concept): a dominated option is worse on both axes than some alternative. An efficacy-only ranking hides this trade-off. Read with the side-effect the patient cares about.</div>';
    }
  };

  // ============================================================ 4. TSA pipeline note
  var TSAPipeline = {
    has: function () { var RM = window.RapidMeta; return !!(RM && RM.state && RM.state.pipelineTrials); },
    render: function () {
      if (!this.has()) return;
      var el = document.getElementById('chip-tsa-status');
      if (!el) return;
      var p = window.RapidMeta.state.pipelineTrials;
      var n = num(p.count), pts = num(p.patients);
      if (n === null) return;
      var note = ' (+' + n + ' still enrolling' + (pts !== null ? ' ~' + pts.toLocaleString() + ' pts' : '') + ')';
      if (el.textContent.indexOf('still enrolling') < 0) el.innerHTML += '<span class="opacity-70 text-[9px]">' + esc(note) + '</span>';
      el.title = (el.title || '') + ' | Registry pipeline: ' + n + ' active/recruiting trials' + (pts !== null ? ' (~' + pts.toLocaleString() + ' patients)' : '') + ' — even when current evidence is conclusive (TSA), the live pipeline is a research-prioritisation signal.';
    }
  };

  // ============================================================ 5. NMA league + per-comparison certainty
  // Computable GRADE/CINeMA-style certainty per pairwise contrast in a placebo-anchored (star) network.
  // Exposes what a naked SUCRA ranking hides: the highest-RANKED agents can have the WEAKEST evidence (k=1).
  var NMALeague = {
    // nodes from RapidMeta.state.leagueNodes = [{name, effect, lo, hi, k}] (effect higher=better),
    // OR derive from trials carrying data.nmaNode {name, effect, lo, hi}.
    nodes: function () {
      var RM = window.RapidMeta;
      if (RM && RM.state && Array.isArray(RM.state.leagueNodes) && RM.state.leagueNodes.length >= 2) {
        return RM.state.leagueNodes.map(function (n) { return { name: n.name, e: num(n.effect), lo: num(n.lo), hi: num(n.hi), k: num(n.k) }; })
          .filter(function (n) { return n.e !== null; });
      }
      var by = {};
      trialsInc().forEach(function (t) {
        var nd = t.data.nmaNode;
        if (!nd || num(nd.effect) === null) return;
        var key = nd.name || t.name;
        if (!by[key]) by[key] = { name: key, e: num(nd.effect), lo: num(nd.lo), hi: num(nd.hi), k: 0 };
        by[key].k += 1;
      });
      return Object.keys(by).map(function (k) { return by[k]; });
    },
    has: function () { return this.nodes().length >= 2; },
    // certainty rule (ported from nma_league.py): baseline indirect(-1) + crosses-null(-1) + k=1(-1)
    cellCertainty: function (ki, kj, crossesNull) {
      var down = 1, notes = ['indirect (star; no incoherence check)'];
      if (crossesNull) { down += 1; notes.push('imprecision: CrI crosses null'); }
      if (ki === 1 || kj === 1) { down += 1; notes.push('k=1 node INSUFFICIENT'); }
      return { level: ['High', 'Moderate', 'Low', 'Very low'][Math.min(down, 3)], note: notes.join('; ') };
    },
    render: function () {
      var sec = document.getElementById('nmaleague-section'), c = document.getElementById('nmaleague-container');
      if (!sec || !c) return;
      if (!this.has()) { sec.classList.add('hidden'); return; }
      sec.classList.remove('hidden');
      var ns = this.nodes().slice().sort(function (a, b) { return b.e - a.e; });  // best first
      var cdist = { High: 0, Moderate: 0, Low: 0, 'Very low': 0 };
      var rows = ns.map(function (ni, ia) {
        var cells = ns.map(function (nj, ib) {
          if (ia === ib) return '<td class="p-2 font-mono text-center text-slate-500">' + (ni.e != null ? ni.e.toFixed(1) : '--') + '<br><span class="text-[8px]">k=' + (ni.k != null ? ni.k : '?') + '</span></td>';
          var diff = ni.e - nj.e;
          // contrast CrI via independent-marginal combine (conservative; matches glp1 fallback)
          var se_i = (ni.hi != null && ni.lo != null) ? (ni.hi - ni.lo) / (2 * Z) : null;
          var se_j = (nj.hi != null && nj.lo != null) ? (nj.hi - nj.lo) / (2 * Z) : null;
          var crosses = false, criTxt = '';
          if (se_i != null && se_j != null) {
            var se = Math.sqrt(se_i * se_i + se_j * se_j);
            var lo = diff - Z * se, hi = diff + Z * se;
            crosses = lo < 0 && 0 < hi;
            criTxt = '<br><span class="text-[8px] opacity-60">[' + lo.toFixed(1) + ', ' + hi.toFixed(1) + ']</span>';
          } else { crosses = true; }
          var cert = NMALeague.cellCertainty(ni.k === null ? 2 : ni.k, nj.k === null ? 2 : nj.k, crosses);
          if (ib > ia) { cdist[cert.level] = (cdist[cert.level] || 0) + 1; }  // count upper triangle once
          var col = { High: 'text-emerald-300', Moderate: 'text-teal-300', Low: 'text-amber-300', 'Very low': 'text-rose-300' }[cert.level];
          if (ib > ia) return '<td class="p-2 text-center text-[10px] ' + col + '" title="' + esc(cert.note) + '">' + esc(cert.level) + '</td>';
          return '<td class="p-2 font-mono text-center text-[10px]' + (diff >= 0 ? ' text-teal-300' : ' text-slate-400') + '">' + (diff >= 0 ? '+' : '') + diff.toFixed(1) + criTxt + '</td>';
        }).join('');
        return '<tr class="border-b border-slate-800/60"><td class="p-2 font-semibold whitespace-nowrap">' + esc(ni.name) + (ni.k === 1 ? ' <span class="text-[8px] text-rose-300">k=1</span>' : '') + '</td>' + cells + '</tr>';
      }).join('');
      var head = '<th class="p-2"></th>' + ns.map(function (n) { return '<th class="p-2 text-[9px] uppercase">' + esc(String(n.name).slice(0, 10)) + '</th>'; }).join('');
      // headline: is the top-ranked node also the weakest-evidence?
      var topWeak = ns[0] && ns[0].k === 1;
      c.innerHTML =
        '<span class="text-[9px] uppercase tracking-widest px-3 py-1 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">League + per-comparison certainty &middot; lower=effect, upper=GRADE/CINeMA certainty</span>' +
        (topWeak ? '<div class="mt-2 text-[10px] text-amber-300/90"><b>Certainty caveat:</b> the highest-<i>ranked</i> agent (' + esc(ns[0].name) + ') rests on a <b>single trial (k=1)</b> &mdash; weak evidence a SUCRA ranking alone would hide.</div>' : '') +
        '<div class="overflow-x-auto mt-3"><table class="w-full text-left text-[11px]"><thead class="bg-slate-950/60 font-bold tracking-widest opacity-60"><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="mt-2 text-[9px] opacity-60">Per-cell certainty (DRAFT): baseline indirect star-network (&minus;1; no incoherence check) + imprecision if the contrast CrI crosses null (&minus;1) + k=1 node INSUFFICIENT (&minus;1). Distribution: ' +
        Object.keys(cdist).map(function (k) { return cdist[k] + ' ' + k; }).join(', ') + '. RoB / values are the panel’s. The only certainty a ranking owes a panel is per-comparison, not a single SUCRA number.</div>';
    }
  };

  // ============================================================ 6. GRADE Evidence-to-Decision scaffold
  // Pre-fills the COMPUTABLE EtD criteria (traceable) + flags JUDGEMENT criteria for the panel.
  // Never autonomous; carries the hard guardrails. Consumes RapidMeta.state.gradeEtD when supplied.
  var GradeEtD = {
    has: function () { var RM = window.RapidMeta; return !!(RM && RM.state && RM.state.gradeEtD && RM.state.gradeEtD.comparison); },
    render: function () {
      var sec = document.getElementById('grade-etd-section'), c = document.getElementById('grade-etd-container');
      if (!sec || !c) return;
      if (!this.has()) { sec.classList.add('hidden'); return; }
      sec.classList.remove('hidden');
      var d = window.RapidMeta.state.gradeEtD;
      var certainty = d.certainty || 'Low';
      var cc = { High: 'text-emerald-300', Moderate: 'text-teal-300', Low: 'text-amber-300', 'Very low': 'text-rose-300' }[certainty] || 'text-amber-300';
      // computable criteria pre-filled; judgement criteria flagged PANEL INPUT
      var criteria = [
        ['Problem / priority', d.problem || 'PANEL INPUT', d.problem ? 'computed/established' : 'human'],
        ['Desirable effects', d.desirable || 'PANEL INPUT', d.desirable ? 'data' : 'human'],
        ['Undesirable effects', d.undesirable || 'PANEL INPUT', d.undesirable ? 'data' : 'human'],
        ['Certainty of evidence', certainty + (d.certaintyNote ? ' (' + d.certaintyNote + ')' : ''), 'this analysis'],
        ['Values / preferences', 'PANEL INPUT', 'human'],
        ['Resources / cost', 'PANEL INPUT', 'human'],
        ['Equity / acceptability / feasibility', 'PANEL INPUT', 'human']
      ];
      var rows = criteria.map(function (r) {
        var human = r[2] === 'human';
        return '<tr class="border-b border-slate-800/60"><td class="p-2 font-semibold">' + esc(r[0]) + '</td><td class="p-2 ' + (human ? 'text-amber-300/90' : '') + '">' + esc(r[1]) + '</td><td class="p-2 text-[9px] opacity-60">' + esc(r[2]) + '</td></tr>';
      }).join('');
      var draft = (certainty === 'High' || certainty === 'Moderate')
        ? 'CONDITIONAL recommendation (panel to confirm)' : 'CONDITIONAL (weak) — benefit uncertain at ' + certainty + ' certainty (panel to confirm)';
      c.innerHTML =
        '<span class="text-[9px] uppercase tracking-widest px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">Evidence-to-Decision scaffold &middot; DRAFT &middot; never autonomous</span>' +
        '<div class="mt-2 text-[11px]">Question: <b>' + esc(d.comparison) + '</b> &mdash; certainty <b class="' + cc + '">' + esc(certainty) + '</b></div>' +
        '<div class="overflow-x-auto mt-3"><table class="w-full text-left text-[11px]"><thead class="bg-slate-950/60 text-[9px] uppercase font-bold tracking-widest opacity-60"><tr><th class="p-2">EtD criterion</th><th class="p-2">Judgement</th><th class="p-2">Source</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="mt-2 text-[11px] p-3 rounded-2xl bg-slate-900/50 border border-slate-800"><b class="text-amber-300">Draft recommendation:</b> ' + esc(draft) + '.</div>' +
        '<div class="mt-2 text-[9px] opacity-60 leading-relaxed"><b>Guardrails.</b> Decision-support scaffold, not a guideline: computable criteria are pre-filled and traceable; the panel completes risk-of-bias, values, resources, equity. ' +
        (d.surrogateBlocked ? 'A surrogate-outcome claim is BLOCKED (the surrogate is not validated for the hard outcome). ' : '') +
        'k=1 nodes are INSUFFICIENT for a recommendation. Never autonomous &mdash; the panel decides.</div>';
    }
  };

  // ============================================================ 7. Related reviews (interlink)
  // Turns standalone dashboards into a navigable evidence network: links sibling
  // reviews on the same condition. Reads window.RM_RELATED (stamped per dashboard)
  // OR RapidMeta.state.relatedReviews. Inert when none. Renders once (static links),
  // independent of the analysis cycle.
  var RelatedReviews = {
    list: function () {
      var r = window.RM_RELATED || (window.RapidMeta && window.RapidMeta.state && window.RapidMeta.state.relatedReviews);
      return Array.isArray(r) ? r.filter(function (x) { return x && x.url; }) : [];
    },
    rendered: false,
    render: function () {
      if (this.rendered) return;
      var sec = document.getElementById('related-reviews-section'), c = document.getElementById('related-reviews-container');
      if (!sec || !c) return;
      var items = this.list();
      if (items.length === 0) { sec.classList.add('hidden'); return; }
      this.rendered = true;
      sec.classList.remove('hidden');
      var cards = items.slice(0, 12).map(function (x) {
        var label = esc(x.title || x.drug || x.url);
        return '<a href="' + esc(x.url) + '" class="block px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-sky-500/50 hover:bg-slate-900 transition-all text-[11px]" title="' + esc(x.condition || '') + '">' +
          '<span class="text-sky-300 font-semibold">' + esc(x.drug || label) + '</span>' + (x.title && x.drug && x.title !== x.drug ? '<span class="opacity-60"> &middot; ' + esc(String(x.title).replace(/^RapidMeta[^|]*\|\s*/, '').slice(0, 48)) + '</span>' : '') + '</a>';
      }).join('');
      c.innerHTML =
        '<span class="text-[9px] uppercase tracking-widest px-3 py-1 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">Related reviews &middot; same condition &middot; interlinked evidence network</span>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">' + cards + '</div>' +
        '<div class="mt-2 text-[9px] opacity-60">Sibling reviews on the same condition from the RapidMeta / LivingMeta portfolio. Links are relative; open in the same Pages site. Generated from the portfolio reviews-index.</div>';
    }
  };

  // ============================================================ 8. Unified Decision View
  // Consolidates whatever wide-gap evidence is present into ONE panel-ready summary
  // (port of glp1 dashboard.py "renders what is present"). Activates when ANY of
  // GRADE-EtD / league / benefit-risk / CNMA has data; otherwise hidden. Pulls from
  // the same state the individual panels use — no new computation.
  var DecisionView = {
    has: function () {
      return GradeEtD.has() || NMALeague.has() || BenefitRisk.has() || CNMA.has();
    },
    render: function () {
      var sec = document.getElementById('decision-view-section'), c = document.getElementById('decision-view-container');
      if (!sec || !c) return;
      if (!this.has()) { sec.classList.add('hidden'); return; }
      sec.classList.remove('hidden');
      var RM = window.RapidMeta, parts = [];
      // certainty (from GRADE-EtD if supplied)
      var etd = RM && RM.state && RM.state.gradeEtD;
      if (etd && etd.comparison) {
        var cert = etd.certainty || 'Low';
        var cc = { High: 'text-emerald-300', Moderate: 'text-teal-300', Low: 'text-amber-300', 'Very low': 'text-rose-300' }[cert] || 'text-amber-300';
        parts.push('<div class="p-3 rounded-2xl bg-slate-900/60 border border-slate-800"><div class="text-[9px] uppercase tracking-widest opacity-60 mb-1">Recommendation</div>' +
          '<div class="text-[12px]"><b>' + esc(etd.comparison) + '</b></div><div class="text-[11px] mt-1">Certainty <b class="' + cc + '">' + esc(cert) + '</b> &rarr; ' +
          ((cert === 'High' || cert === 'Moderate') ? 'Conditional recommendation' : 'Conditional (weak) — benefit uncertain') + ' <span class="opacity-60">(panel confirms)</span></div></div>');
      }
      // league headline (highest-ranked = weakest-evidence flag)
      if (NMALeague.has()) {
        var ns = NMALeague.nodes().slice().sort(function (a, b) { return b.e - a.e; });
        if (ns[0]) {
          parts.push('<div class="p-3 rounded-2xl bg-slate-900/60 border border-slate-800"><div class="text-[9px] uppercase tracking-widest opacity-60 mb-1">Top-ranked</div>' +
            '<div class="text-[12px]"><b>' + esc(ns[0].name) + '</b> (' + (ns[0].e != null ? ns[0].e.toFixed(1) : '?') + ')</div>' +
            (ns[0].k === 1 ? '<div class="text-[10px] text-amber-300 mt-1">but k=1 &mdash; weakest evidence; a ranking alone would hide this</div>' : '<div class="text-[10px] opacity-60 mt-1">see league table for per-comparison certainty</div>') + '</div>');
        }
      }
      // benefit-risk frontier summary
      if (BenefitRisk.has()) {
        var pts = BenefitRisk.points();
        pts.forEach(function (p) { p.dominated = pts.some(function (q) { return q !== p && q.b >= p.b && q.r <= p.r && (q.b > p.b || q.r < p.r); }); });
        var dom = pts.filter(function (p) { return p.dominated; }).map(function (p) { return p.name; });
        parts.push('<div class="p-3 rounded-2xl bg-slate-900/60 border border-slate-800"><div class="text-[9px] uppercase tracking-widest opacity-60 mb-1">Benefit-risk</div>' +
          '<div class="text-[11px]">' + (pts.length - dom.length) + ' option(s) on the frontier' + (dom.length ? '; <span class="text-rose-300">' + dom.length + ' dominated</span> (' + esc(dom.slice(0, 3).join(', ')) + ')' : '') + '</div></div>');
      }
      // CNMA / mechanism
      if (CNMA.has()) {
        parts.push('<div class="p-3 rounded-2xl bg-slate-900/60 border border-slate-800"><div class="text-[9px] uppercase tracking-widest opacity-60 mb-1">Mechanism</div>' +
          '<div class="text-[11px]">Component NMA available &mdash; effect decomposed into components (see panel); enables prediction of un-trialled combinations.</div></div>');
      }
      c.innerHTML =
        '<span class="text-[9px] uppercase tracking-widest px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Decision view &middot; consolidated evidence &middot; DRAFT (panel confirms)</span>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">' + parts.join('') + '</div>' +
        '<div class="mt-2 text-[9px] opacity-60">One panel-ready summary that renders whatever wide-gap evidence is present (GRADE/EtD, league certainty, benefit-risk, mechanism). Decision-support scaffold, not a guideline; risk-of-bias and values are the panel’s.</div>';
    }
  };

  // ============================================================ 9. Benford digit forensics
  // First-digit screen of the analysis's own values (effect sizes / weights) — a
  // data-integrity check on the numbers already present. Activates when >=30 usable
  // values are available. Ported from benfordma (Nigrini MAD bands).
  function firstDigit(x) { if (x == null || !isFinite(x) || x === 0) return null; x = Math.abs(x); while (x < 1) x *= 10; while (x >= 10) x /= 10; return Math.floor(x); }
  function benfordExp() { var p = []; for (var d = 1; d <= 9; d++) p.push(Math.log10(1 + 1 / d)); return p; }
  var Benford = {
    // ONE coherent value stream only. Benford's law applies to counts that span
    // several orders of magnitude (sample sizes, event counts) — NOT to effect
    // sizes, odds ratios, weights, or proportions (bounded / clustered near 1),
    // which would manufacture false (non)conformity. We therefore screen the
    // per-arm participant + event COUNTS only (tN,cN,tE,cE), or an explicit
    // state.benfordValues stream the host provides. Field used is named in the UI.
    field: 'per-arm participant & event counts (N, events)',
    values: function () {
      if (window.RapidMeta && Array.isArray(window.RapidMeta.state.benfordValues)) {
        // host-supplied single stream takes precedence; label it generically
        var ov = window.RapidMeta.state.benfordValues.map(num).filter(function (n) { return n !== null && n !== 0; });
        if (ov.length) { this.field = 'host-supplied values'; return ov; }
      }
      var r = window.RapidMeta && window.RapidMeta.state && window.RapidMeta.state.results;
      var out = [];
      if (r && Array.isArray(r.plotData)) r.plotData.forEach(function (d) {
        // counts only — homogeneous, multi-order-of-magnitude quantities
        [d.tN, d.cN, d.tE, d.cE].forEach(function (v) { var n = num(v); if (n !== null && n > 0) out.push(n); });
      });
      this.field = 'per-arm participant & event counts (N, events)';
      return out;
    },
    has: function () {
      var n = 0;
      this.values().forEach(function (v) { var d = firstDigit(v); if (d >= 1 && d <= 9) n++; });
      return n >= 30;
    },
    render: function () {
      var sec = document.getElementById('benford-section'), c = document.getElementById('benford-container');
      if (!sec || !c) return;
      if (!this.has()) { sec.classList.add('hidden'); return; }
      sec.classList.remove('hidden');
      var obs = new Array(9).fill(0), n = 0;
      this.values().forEach(function (v) { var d = firstDigit(v); if (d >= 1 && d <= 9) { obs[d - 1]++; n++; } });
      var exp = benfordExp(), chi = 0, mad = 0;
      for (var i = 0; i < 9; i++) { var e = exp[i] * n; chi += (obs[i] - e) * (obs[i] - e) / e; mad += Math.abs(obs[i] / n - exp[i]); }
      mad /= 9;
      // Nigrini first-digit MAD bands
      var verdict = mad < 0.006 ? 'Close conformity' : mad < 0.012 ? 'Acceptable conformity' : mad < 0.015 ? 'Marginal' : 'Nonconformity';
      var vcol = mad < 0.012 ? 'text-emerald-300' : mad < 0.015 ? 'text-amber-300' : 'text-rose-300';
      var bars = obs.map(function (o, i) {
        var op = 100 * o / n, ep = 100 * exp[i];
        return '<tr class="border-b border-slate-800/60"><td class="p-1 font-mono text-center">' + (i + 1) + '</td><td class="p-1 font-mono text-right">' + op.toFixed(1) + '%</td><td class="p-1 font-mono text-right opacity-60">' + ep.toFixed(1) + '%</td>' +
          '<td class="p-1"><div class="h-2 rounded bg-sky-500/40" style="width:' + Math.min(100, op * 2.5) + '%"></div></td></tr>';
      }).join('');
      c.innerHTML =
        '<span class="text-[9px] uppercase tracking-widest px-3 py-1 rounded-full bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30">Benford first-digit forensics &middot; data-integrity screen</span>' +
        '<div class="flex flex-wrap gap-4 mt-3 text-[11px]"><div>n=' + n + ' values</div><div>MAD=' + mad.toFixed(4) + ' &rarr; <b class="' + vcol + '">' + verdict + '</b></div><div>&chi;&sup2;(8)=' + chi.toFixed(1) + '</div></div>' +
        '<div class="overflow-x-auto mt-3"><table class="w-full text-left text-[10px]"><thead class="bg-slate-950/60 text-[9px] uppercase opacity-60"><tr><th class="p-1">Digit</th><th class="p-1 text-right">Observed</th><th class="p-1 text-right">Benford</th><th class="p-1">Observed</th></tr></thead><tbody>' + bars + '</tbody></table></div>' +
        '<div class="mt-2 text-[9px] opacity-60">First-digit distribution of <b>' + esc(this.field) + '</b> vs Benford&rsquo;s law (Nigrini MAD bands). Restricted to ONE homogeneous, multi-order-of-magnitude value stream (counts) &mdash; effect sizes/ORs/weights are deliberately excluded because they violate Benford&rsquo;s assumptions. A screen for data irregularities, NOT proof of fraud; nonconformity has many benign causes. Ported from benfordma.</div>';
    }
  };

  // ============================================================ 10. Umbrella CCA overlap
  // Corrected Covered Area for an umbrella review (reviews x primary studies).
  // Activates on state.umbrellaMatrix = [[studyIds...], ...] (one array per review).
  var UmbrellaCCA = {
    reviews: function () { var m = window.RapidMeta && window.RapidMeta.state && window.RapidMeta.state.umbrellaMatrix; return Array.isArray(m) ? m.filter(function (r) { return Array.isArray(r); }) : []; },
    has: function () { return this.reviews().length >= 2; },
    render: function () {
      var sec = document.getElementById('umbrella-section'), c = document.getElementById('umbrella-container');
      if (!sec || !c) return;
      if (!this.has()) { sec.classList.add('hidden'); return; }
      sec.classList.remove('hidden');
      var revs = this.reviews(), cc = revs.length;
      var sets = revs.map(function (r) { var s = {}; r.forEach(function (id) { s[id] = 1; }); return s; });
      var all = {}; sets.forEach(function (s) { Object.keys(s).forEach(function (id) { all[id] = 1; }); });
      var rr = Object.keys(all).length, nTotal = 0; sets.forEach(function (s) { nTotal += Object.keys(s).length; });
      var denom = rr * cc - rr, cca = denom > 0 ? (nTotal - rr) / denom : 0; cca = Math.max(0, Math.min(1, cca));
      // Pielou/Hennessey groove bands (Pieper 2014)
      var groove = cca <= 0.05 ? 'Slight' : cca <= 0.10 ? 'Moderate' : cca <= 0.15 ? 'High' : 'Very high';
      var gcol = cca <= 0.10 ? 'text-emerald-300' : cca <= 0.15 ? 'text-amber-300' : 'text-rose-300';
      c.innerHTML =
        '<span class="text-[9px] uppercase tracking-widest px-3 py-1 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30">Umbrella overlap &middot; Corrected Covered Area (CCA)</span>' +
        '<div class="flex flex-wrap gap-5 mt-3 text-[12px]"><div>Reviews: <b>' + cc + '</b></div><div>Unique studies: <b>' + rr + '</b></div><div>Total citations: <b>' + nTotal + '</b></div><div>CCA = <b class="' + gcol + '">' + (cca * 100).toFixed(1) + '%</b> (' + groove + ' overlap)</div></div>' +
        '<div class="mt-2 text-[9px] opacity-60">CCA = (N &minus; r) / (r&middot;c &minus; r), N=total citations, r=unique studies, c=reviews (Pieper 2014). Groove bands: &le;5% slight, &le;10% moderate, &le;15% high, &gt;15% very high. High overlap means the included reviews share primary studies &mdash; pooling them double-counts evidence. Ported from umbrellareview.</div>';
    }
  };

  // ============================================================ 11. GRMA (grey relational MA)
  // Grey relational meta-analysis robustness companion (validated vs the R engine to 1e-4).
  // Activates on the analysis effect set (state.results.plotData with logOR/vi) or state.grmaData.
  function _quantile(s, p) { var a = s.slice().sort(function (x, y) { return x - y; }); var i = p * (a.length - 1), lo = Math.floor(i), h = i - lo; return a[lo] + (a[lo + 1] !== undefined ? h * (a[lo + 1] - a[lo]) : 0); }
  function grmaPool(yi, vi, zeta) {
    zeta = zeta || 0.5; var n = yi.length; if (n < 3) return null;
    var prec = vi.map(function (v) { return Math.min(1 / v, 1e6); });
    var logprec = prec.map(function (p) { return Math.log(p + 1); });
    function rmm(x) { var q1 = _quantile(x, 0.05), q9 = _quantile(x, 0.95), rng = q9 - q1; if (rng < 1e-12) rng = 1; return { lo: q1, rng: rng }; }
    function nv(v, f) { return Math.min(Math.max((v - f.lo) / f.rng, 0), 1); }
    var fe = rmm(yi), fp = rmm(logprec);
    var xe = yi.map(function (v) { return nv(v, fe); }), xp = logprec.map(function (v) { return nv(v, fp); });
    var ay = _quantile(yi, 0.5), ap = Math.max.apply(null, prec);
    var ae = nv(ay, fe), ap2 = nv(Math.log(ap + 1), fp);
    var de = xe.map(function (v) { return Math.abs(v - ae); }), dp = xp.map(function (v) { return Math.abs(v - ap2); });
    var all = de.concat(dp), dmin = Math.min.apply(null, all), dmax = Math.max.apply(null, all);
    var grade; if (dmax < 1e-15) grade = new Array(n).fill(1);
    else grade = de.map(function (d, i) { var ge = (dmin + zeta * dmax) / (d + zeta * dmax), gp = (dmin + zeta * dmax) / (dp[i] + zeta * dmax); return (ge + gp) / 2; });
    var devs = yi.map(function (v) { return Math.abs(v - ay); }); var mady = _quantile(devs, 0.5); if (mady < 1e-12) mady = 1e-12;
    var tc = 4.685; var raw = grade.map(function (g, i) { var u = Math.abs(yi[i] - ay) / mady; var h = u < tc ? Math.pow(1 - Math.pow(u / tc, 2), 2) : 0; return g * h; });
    var sw = raw.reduce(function (a, b) { return a + b; }, 0); var w = sw < 1e-15 ? raw.map(function () { return 1 / n; }) : raw.map(function (r) { return r / sw; });
    return { est: yi.reduce(function (s, y, i) { return s + w[i] * y; }, 0), wMax: Math.max.apply(null, w), w: w };
  }
  var GRMA = {
    data: function () {
      if (window.RapidMeta && window.RapidMeta.state && Array.isArray(window.RapidMeta.state.grmaData)) {
        var g = window.RapidMeta.state.grmaData.map(function (d) { return { y: num(d.yi != null ? d.yi : d.logOR), v: num(d.vi) }; }).filter(function (d) { return d.y !== null && d.v !== null && d.v > 0; });
        return { yi: g.map(function (d) { return d.y; }), vi: g.map(function (d) { return d.v; }) };
      }
      var r = window.RapidMeta && window.RapidMeta.state && window.RapidMeta.state.results;
      if (r && Array.isArray(r.plotData)) {
        var rows = r.plotData.map(function (d) { return { y: num(d.logOR != null ? d.logOR : d.yi), v: num(d.vi) }; }).filter(function (d) { return d.y !== null && d.v !== null && d.v > 0; });
        return { yi: rows.map(function (d) { return d.y; }), vi: rows.map(function (d) { return d.v; }) };
      }
      return { yi: [], vi: [] };
    },
    has: function () { return this.data().yi.length >= 3; },
    render: function () {
      var sec = document.getElementById('grma-section'), c = document.getElementById('grma-container');
      if (!sec || !c) return;
      if (!this.has()) { sec.classList.add('hidden'); return; }
      var d = this.data(), g = grmaPool(d.yi, d.vi);
      if (!g) { sec.classList.add('hidden'); return; }
      sec.classList.remove('hidden');
      var r = window.RapidMeta.state.results;
      var ivEst = num(r && (r.pLogOR != null ? r.pLogOR : r.pOR));
      var cont = r && r.isContinuous;
      var show = function (x) { return cont ? x.toFixed(2) : Math.exp(x).toFixed(2); };
      c.innerHTML =
        '<span class="text-[9px] uppercase tracking-widest px-3 py-1 rounded-full bg-lime-500/15 text-lime-300 border border-lime-500/30">Grey Relational MA &middot; robustness companion (validated vs R, 1e-4)</span>' +
        '<div class="flex flex-wrap gap-5 mt-3 text-[12px]"><div>GRMA pooled: <b class="text-lime-300">' + show(g.est) + '</b>' + (cont ? '' : ' (back-transformed)') + '</div>' +
        (ivEst !== null ? '<div>vs IV/RE pooled: <b>' + show(ivEst) + '</b></div>' : '') +
        '<div>max weight: <b>' + (100 * g.wMax).toFixed(0) + '%</b> on a single study</div></div>' +
        '<div class="mt-2 text-[9px] opacity-60">Grey relational MA (non-parametric, outlier-robust): weights each study by its grey relational grade to a robust anchor + a Tukey-bisquare effect guard. A robustness companion to IV/RE pooling &mdash; agreement supports the primary estimate; divergence flags outlier-sensitivity. k&ge;3 required. Ported from grma (R-validated).</div>';
    }
  };

  var WideGap = { CNMA: CNMA, RegPubBias: RegPubBias, BenefitRisk: BenefitRisk, TSAPipeline: TSAPipeline, NMALeague: NMALeague, GradeEtD: GradeEtD, RelatedReviews: RelatedReviews, DecisionView: DecisionView, Benford: Benford, UmbrellaCCA: UmbrellaCCA, GRMA: GRMA,
    renderAll: function () { [CNMA, RegPubBias, BenefitRisk, TSAPipeline, NMALeague, GradeEtD, RelatedReviews, DecisionView, Benford, UmbrellaCCA, GRMA].forEach(function (m) { try { m.render(); } catch (e) {} }); } };
  window.WideGapMethods = WideGap;
  // Related reviews don't depend on analysis — render on DOM ready too.
  if (document.readyState !== 'loading') { try { RelatedReviews.render(); } catch (e) {} }
  else document.addEventListener('DOMContentLoaded', function () { try { RelatedReviews.render(); } catch (e) {} });

  function installHook() {
    if (window.__wideGapHooked) return true;
    var TE = window.TransportabilityEngine;
    if (TE && typeof TE.render === 'function') {
      var orig = TE.render.bind(TE);
      TE.render = function () { var r = orig.apply(this, arguments); try { WideGap.renderAll(); } catch (e) {} return r; };
      window.__wideGapHooked = true;
      try { WideGap.renderAll(); } catch (e) {}
      return true;
    }
    return false;
  }
  if (!installHook()) { var tries = 0; var iv = setInterval(function () { if (installHook() || ++tries > 50) clearInterval(iv); }, 100); }
})();
