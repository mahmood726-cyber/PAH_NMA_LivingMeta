/* gosh.js — GOSH (Graphical Display of Study Heterogeneity; Olkin, Dahabreh,
 * Trikalinos 2012). Fits the meta-analysis on every non-empty subset of studies
 * and returns the cloud of (estimate, I²) points; multimodality / distinct
 * clusters in the cloud reveal influential studies or subgroups that drive
 * heterogeneity.
 *
 * Engine extracted VERBATIM from allmeta/gosh/index.html (pool / allSubsets /
 * sampledSubsets). Full enumeration for k≤15 (2^k−1 subsets); a seeded
 * xoshiro128** random sample for k>15 (advanced-stats.md "GOSH: random sampling
 * for k>15"), so results are reproducible.
 *
 * API: AlmGOSH.gosh(rows, { model:'RE'|'FE', maxEnum:15, nSample:5000 })
 *   rows = [{ te, se }, ...]. Returns { subsets:[{mu,I2,k}], nSubsets,
 *   enumerated, full:{mu,I2,k}, muMin, muMax }.
 */
(function (global) {
  'use strict';

  function pool(rows, model) {
    var w = rows.map(function (r) { return 1 / (r.se * r.se); });
    var sw = w.reduce(function (a, b) { return a + b; }, 0);
    var muFE = rows.reduce(function (a, r, i) { return a + w[i] * r.te; }, 0) / sw;
    var Q = rows.reduce(function (a, r, i) { return a + w[i] * (r.te - muFE) * (r.te - muFE); }, 0);
    var df = rows.length - 1;
    var I2 = (df > 0 && Q > df) ? 100 * (Q - df) / Q : 0;
    if (model === 'FE' || rows.length < 2) {
      return { mu: muFE, se: Math.sqrt(1 / sw), Q: Q, I2: I2, k: rows.length };
    }
    var swSq = w.reduce(function (a, b) { return a + b * b; }, 0);
    var tau2 = df > 0 ? Math.max(0, (Q - df) / (sw - swSq / sw)) : 0;
    var wRE = rows.map(function (r) { return 1 / (r.se * r.se + tau2); });
    var swRE = wRE.reduce(function (a, b) { return a + b; }, 0);
    var mu = rows.reduce(function (a, r, i) { return a + wRE[i] * r.te; }, 0) / swRE;
    return { mu: mu, se: Math.sqrt(1 / swRE), Q: Q, I2: I2, tau2: tau2, k: rows.length };
  }

  function allSubsets(rows, model) {
    var k = rows.length, total = (1 << k) - 1, results = [];
    for (var m = 1; m <= total; m++) {
      var subset = [];
      for (var i = 0; i < k; i++) { if (m & (1 << i)) subset.push(rows[i]); }
      if (subset.length < 2) continue;
      var p = pool(subset, model);
      results.push({ mu: p.mu, I2: p.I2, k: subset.length });
    }
    return results;
  }

  function sampledSubsets(rows, nSample, model) {
    var k = rows.length, results = [];
    var s = [0xdeadbeef, 0x12345678, 0xabcdef01, 0x87654321];
    function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }
    function next() {
      var t = s[1] << 9;
      var r = s[0] * 5; r = rotl(r, 7) * 9;
      s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
      s[2] ^= t; s[3] = rotl(s[3], 11);
      return (r >>> 0) / 0x100000000;
    }
    for (var i = 0; i < nSample; i++) {
      var size = 2 + Math.floor(next() * (k - 1));
      var idx = [];
      for (var j = 0; j < k; j++) idx.push(j);
      for (var j2 = 0; j2 < size; j2++) {
        var r2 = j2 + Math.floor(next() * (k - j2));
        var tmp = idx[j2]; idx[j2] = idx[r2]; idx[r2] = tmp;
      }
      var subset = [];
      for (var j3 = 0; j3 < size; j3++) subset.push(rows[idx[j3]]);
      var p = pool(subset, model);
      results.push({ mu: p.mu, I2: p.I2, k: subset.length });
    }
    return results;
  }

  function gosh(rows, opts) {
    opts = opts || {};
    if (!rows || rows.length < 3) return null;
    var model = opts.model || 'RE';
    var maxEnum = opts.maxEnum || 15;
    var nSample = opts.nSample || 5000;
    var enumerated = rows.length <= maxEnum;
    var subsets = enumerated ? allSubsets(rows, model) : sampledSubsets(rows, nSample, model);
    if (!subsets.length) return null;
    var full = pool(rows, model);
    var muMin = Infinity, muMax = -Infinity;
    subsets.forEach(function (s2) { if (s2.mu < muMin) muMin = s2.mu; if (s2.mu > muMax) muMax = s2.mu; });
    return {
      subsets: subsets, nSubsets: subsets.length, enumerated: enumerated,
      full: { mu: full.mu, I2: full.I2, k: full.k }, muMin: muMin, muMax: muMax,
    };
  }

  var api = { gosh: gosh, pool: pool, allSubsets: allSubsets, sampledSubsets: sampledSubsets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AlmGOSH = api;
})(typeof window !== 'undefined' ? window : this);
