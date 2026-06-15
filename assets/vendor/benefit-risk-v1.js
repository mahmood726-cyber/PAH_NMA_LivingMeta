/* shared/benefit-risk-v1.js — probabilistic benefit-risk MCDA + value of
 * information for a network/pairwise evidence set.
 *
 * Integrated idea from the glp1-obesity-mbnma workbook's benefit-risk arm,
 * generalised to the standard ISPOR / Tervonen-SMAA framework:
 *   1. Partial value functions map each criterion (benefit or harm) onto [0,1].
 *   2. Deterministic MCDA: total value = Σ weight_c · value_c(performance).
 *   3. SMAA: propagate each treatment×criterion uncertainty (mean,SE) by Monte
 *      Carlo → rank-acceptability (P(best), full rank distribution).
 *   4. EVPI: E[max_t V_t] − max_t E[V_t] — the value of resolving the decision
 *      uncertainty (is more research worth it?).
 *
 * No mainstream SR tool ships benefit-risk MCDA + VOI. Weights are value
 * judgements, the value functions are linear, and EVPI is on the value scale —
 * the app must surface those caveats. Deterministic (seeded PRNG) so runs
 * reproduce. Pure + dual-mode. Browser global: window.AlmBenefitRisk.
 */
(function (global) {
  "use strict";

  // seeded PRNG (mulberry32) + standard normal (Box-Muller) — deterministic.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // Linear partial value: value 0 at `worst`, 1 at `best`. For a benefit
  // best>worst; for a harm best<worst — the same formula handles both.
  function partialValue(x, worst, best) {
    if (best === worst) return 0.5;
    return clamp01((x - worst) / (best - worst));
  }

  // Resolve each criterion's (worst,best) endpoints: explicit if given, else
  // from the treatments' means oriented by type ('benefit' higher better).
  function _ranges(criteria, treatments) {
    return criteria.map(function (c) {
      var w = c.worst, b = c.best;
      if (!(isFinite(w) && isFinite(b))) {
        var vals = treatments.map(function (t) { return (t.perf[c.id] || {}).mean; }).filter(isFinite);
        var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
        if (lo === hi) { lo -= 0.5; hi += 0.5; }
        if (c.type === "harm") { w = hi; b = lo; } else { w = lo; b = hi; }
      }
      return { id: c.id, worst: w, best: b };
    });
  }
  function _normWeights(criteria) {
    var s = criteria.reduce(function (a, c) { return a + (isFinite(c.weight) ? Math.max(0, c.weight) : 0); }, 0);
    if (!(s > 0)) return criteria.map(function () { return 1 / criteria.length; });
    return criteria.map(function (c) { return Math.max(0, c.weight || 0) / s; });
  }

  function totalValue(treatment, criteria, ranges, weights, samplePerf) {
    var v = 0;
    for (var i = 0; i < criteria.length; i++) {
      var p = (samplePerf || treatment.perf)[criteria[i].id] || {};
      var x = p.mean; if (!isFinite(x)) x = (treatment.perf[criteria[i].id] || {}).mean;
      v += weights[i] * partialValue(x, ranges[i].worst, ranges[i].best);
    }
    return v;
  }

  function analyze(input) {
    input = input || {};
    var criteria = input.criteria || [];
    var treatments = input.treatments || [];
    var iters = (input.iterations != null && input.iterations >= 1) ? input.iterations : 10000;
    var seed = input.seed != null ? input.seed : 12345;
    if (criteria.length < 1 || treatments.length < 2) return { ok: false, error: "need ≥1 criterion and ≥2 treatments" };

    var ranges = _ranges(criteria, treatments);
    var weights = _normWeights(criteria);

    // deterministic MCDA (at the mean performance)
    var det = treatments.map(function (t) { return { id: t.id, name: t.name || t.id, value: totalValue(t, criteria, ranges, weights, null) }; });
    det.slice().sort(function (a, b) { return b.value - a.value; }).forEach(function (d, i) { d.rank = i + 1; });
    var detSorted = det.slice().sort(function (a, b) { return b.value - a.value; });

    // SMAA + EVPI via Monte Carlo
    var rng = mulberry32(seed);
    var K = treatments.length;
    var winCount = new Array(K).fill(0);
    var rankCount = treatments.map(function () { return new Array(K).fill(0); });
    var sumV = new Array(K).fill(0), sumV2 = new Array(K).fill(0);
    var sumPerfect = 0;
    for (var it = 0; it < iters; it++) {
      var vals = new Array(K);
      for (var k = 0; k < K; k++) {
        var sp = {};
        for (var c = 0; c < criteria.length; c++) {
          var perf = treatments[k].perf[criteria[c].id] || {};
          var m = perf.mean, se = perf.se;
          sp[criteria[c].id] = { mean: isFinite(se) && se > 0 ? m + se * normal(rng) : m };
        }
        vals[k] = totalValue(treatments[k], criteria, ranges, weights, sp);
        sumV[k] += vals[k]; sumV2[k] += vals[k] * vals[k];
      }
      // best this iteration
      var bi = 0; for (var j = 1; j < K; j++) if (vals[j] > vals[bi]) bi = j;
      winCount[bi]++;
      sumPerfect += vals[bi];
      // ranks (1 = best)
      var order = vals.map(function (v, idx) { return { v: v, idx: idx }; }).sort(function (a, b) { return b.v - a.v; });
      order.forEach(function (o, r) { rankCount[o.idx][r]++; });
    }
    var meanV = sumV.map(function (s) { return s / iters; });
    var smaa = treatments.map(function (t, k) {
      return {
        id: t.id, name: t.name || t.id,
        pBest: winCount[k] / iters,
        meanValue: meanV[k],
        valueSE: Math.sqrt(Math.max(0, sumV2[k] / iters - meanV[k] * meanV[k])),
        rankAcceptability: rankCount[k].map(function (r) { return r / iters; })
      };
    }).sort(function (a, b) { return b.pBest - a.pBest; });

    var maxMeanV = Math.max.apply(null, meanV);
    var evpi = sumPerfect / iters - maxMeanV;   // E[max V] − max E[V] ≥ 0

    return {
      ok: true, iterations: iters, seed: seed,
      weightsNorm: criteria.map(function (c, i) { return { id: c.id, weight: weights[i] }; }),
      ranges: ranges,
      deterministic: detSorted,
      smaa: smaa,
      evpi: Math.max(0, evpi)
    };
  }

  var api = { analyze: analyze, partialValue: partialValue, _mulberry32: mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmBenefitRisk = api;
})(typeof window !== "undefined" ? window : globalThis);
