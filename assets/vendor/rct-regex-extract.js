/* rct-regex-extract.js — browser-native, offline effect-estimate extractor.
 *
 * A self-contained JavaScript port of the core pattern FAMILIES from the Python
 * `rct-extractor-v2` engine (src/core/extractor.py), generalized: instead of 180+
 * literal regexes, one robust pattern per measure family captures the shared shape
 *   <measure keyword> ... VALUE ( 95% CI LOW to HIGH )
 * across the JAMA / NEJM / Lancet reporting styles (incl. Lancet middle-dot decimals).
 *
 * Why this exists: allmeta's rct-extractor front-end POSTs to the rct-extractor-v2
 * FastAPI server for extraction and falls back to *demo* data when that server is
 * offline. This module lets the browser do REAL extraction with no backend, so the
 * PDF/text extractor works fully offline (GitHub Pages, file://).
 *
 * Anti-fabrication guards (RapidMeta Paper Studio integrity pattern + v2 spirit):
 *   - ratio measures must be > 0; degenerate/inverted CIs (low >= high) are rejected;
 *   - the point estimate must lie within [low, high] (else the match is spurious);
 *   - 4-digit years (1900-2099) are never taken as an estimate;
 *   - the number↔CI gap may not leap over another number (no cross-clause capture).
 * Nothing is emitted at "confidently wrong" — a failed guard drops the candidate.
 *
 * API:  RctRegexExtract.extract(text) -> [{
 *          effect_type, point_estimate, ci:{lower,upper}, ci_level, p_value,
 *          standard_error:null, confidence, automation_tier:"browser-regex",
 *          source_text }]
 */
(function (global) {
  "use strict";

  // A number: integer or decimal, accepting the Lancet middle dot (·) as a decimal point.
  var N = "(\\d+(?:[.\\u00B7]\\d+)?)";
  function num(s) { return s == null ? null : parseFloat(String(s).replace(/·/g, ".")); }

  // Measure families, most-specific first (SMD before MD, IRR before RR/rate ratio).
  // `kw` matches the spelled-out name OR a bracketed/standalone abbreviation.
  var MEASURES = [
    { type: "SMD", ratio: false, kw: "standardi[sz]ed\\s+mean\\s+difference|\\bSMD\\b" },
    { type: "MD",  ratio: false, kw: "mean\\s+difference|weighted\\s+mean\\s+difference|\\bMD\\b|\\bWMD\\b" },
    { type: "IRR", ratio: true,  kw: "incidence\\s+rate\\s+ratio|\\bIRR\\b" },
    { type: "HR",  ratio: true,  kw: "hazard\\s+ratio|\\baHR\\b|\\bHR\\b" },
    { type: "OR",  ratio: true,  kw: "odds\\s+ratio|\\baOR\\b|\\bOR\\b" },
    { type: "RR",  ratio: true,  kw: "risk\\s+ratio|relative\\s+risk|rate\\s+ratio|\\bRR\\b|\\baRR\\b" },
    { type: "RD",  ratio: false, kw: "risk\\s+difference|absolute\\s+risk\\s+(?:reduction|difference)|\\bARR\\b|\\bRD\\b" }
  ];

  // After the keyword: an optional connector + VALUE, then within a short window a
  // "95% CI" (or "confidence interval") and LOW (to|-|–) HIGH. The gap classes are
  // digit-free so a capture cannot leap over an intervening number (leap-over guard).
  function buildRe(kw) {
    return new RegExp(
      "(?:" + kw + ")" +                    // measure keyword (grouped so alternation binds)
      "[^\\d\\n.]{0,40}?" +                  // connector (was / , / ; / : / ( / =), no digit, no sentence end
      N +                                    // (1) point estimate
      "[^\\d\\n]{0,30}?" +                   // up to the CI label, no intervening number
      "(9[05]|99)\\s*%?\\s*(?:CI|confidence\\s+interval)" + // (2) CI level
      "[^\\d\\n]{0,12}?" +                   // "[CI]," / ", " / " " etc.
      N +                                    // (3) lower
      "\\s*(?:to|[-\\u2013\\u2014]|,)\\s*" +
      N,                                     // (4) upper
      "gi"
    );
  }
  var COMPILED = MEASURES.map(function (m) { return { m: m, re: buildRe(m.kw) }; });

  // p-value near a match: "P<0.001", "P = 0.02", "p=0·03".
  var P_RE = /\bp\s*([<>=])\s*(\d+(?:[.·]\d+)?)/i;

  function pValueNear(text, idx) {
    var window = text.slice(idx, idx + 220);
    var m = P_RE.exec(window);
    if (!m) return null;
    var v = num(m[2]);
    return (m[1] === "<") ? v : v; // store the reported number; the operator is in source_text
  }

  function inYearRange(v) { return v >= 1900 && v <= 2099 && Number.isInteger(v); }

  function extract(text) {
    if (!text || typeof text !== "string") return [];
    var out = [], seen = {};
    COMPILED.forEach(function (c) {
      var re = c.re, m;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        var est = num(m[1]), level = parseInt(m[2], 10) / 100, lo = num(m[3]), hi = num(m[4]);
        if (est == null || lo == null || hi == null) continue;
        // ---- anti-fabrication guards ----
        if (inYearRange(est)) continue;                       // a year is not an estimate
        if (!(lo < hi)) continue;                             // degenerate / inverted CI
        if (c.m.ratio && est <= 0) continue;                  // ratio must be > 0
        // estimate must sit inside its own interval (allow tiny rounding slack)
        var slack = (hi - lo) * 0.05 + 1e-9;
        if (est < lo - slack || est > hi + slack) continue;
        var start = m.index, snippet = text.slice(start, Math.min(text.length, start + 160)).replace(/\s+/g, " ").trim();
        // dedupe identical (type, estimate, lo, hi)
        var key = c.m.type + "|" + est + "|" + lo + "|" + hi;
        if (seen[key]) continue; seen[key] = 1;
        // confidence: a fully-spelled measure name + a well-formed CI scores higher
        var named = /[a-z]{4}/i.test(m[0].slice(0, 12));
        out.push({
          effect_type: c.m.type,
          point_estimate: est,
          ci: { lower: lo, upper: hi },
          ci_level: level,
          p_value: pValueNear(text, start),
          standard_error: null,
          confidence: named ? 0.9 : 0.75,
          automation_tier: "browser-regex",
          source_text: snippet
        });
      }
    });
    // If the same span produced several measures (e.g. both "RR" and a stray "OR"
    // abbreviation), prefer the highest-confidence per (estimate, lo, hi) triple.
    return dedupeByValue(out);
  }

  function dedupeByValue(rows) {
    var best = {};
    rows.forEach(function (r) {
      var k = r.point_estimate + "|" + r.ci.lower + "|" + r.ci.upper;
      if (!best[k] || r.confidence > best[k].confidence) best[k] = r;
    });
    return Object.keys(best).map(function (k) { return best[k]; });
  }

  var api = { extract: extract };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.RctRegexExtract = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
