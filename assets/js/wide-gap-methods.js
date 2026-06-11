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

  var WideGap = { CNMA: CNMA, RegPubBias: RegPubBias, BenefitRisk: BenefitRisk, TSAPipeline: TSAPipeline, NMALeague: NMALeague, GradeEtD: GradeEtD,
    renderAll: function () { [CNMA, RegPubBias, BenefitRisk, TSAPipeline, NMALeague, GradeEtD].forEach(function (m) { try { m.render(); } catch (e) {} }); } };
  window.WideGapMethods = WideGap;

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
