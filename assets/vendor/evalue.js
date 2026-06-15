/* shared/evalue.js — E-value (VanderWeele & Ding 2017).
 *
 * Sensitivity of an observational pooled estimate to unmeasured confounding: the minimum
 * strength of association (on the risk-ratio scale) that an unmeasured confounder would
 * need with BOTH treatment and outcome to fully explain away the observed effect (point),
 * or to shift the CI bound closest to the null to 1.
 *
 * E-value(RR) = RR + √(RR·(RR−1)) for RR ≥ 1 (use 1/RR for RR < 1). The CI E-value uses
 * the bound nearest the null (lower if RR>1, upper if RR<1); = 1 if that bound crosses 1.
 * Non-RR measures are mapped to an approximate RR (VanderWeele-Ding / Chinn):
 *   OR  → √OR (common outcome) or OR (rare);
 *   HR  → (1−0.5^√HR)/(1−0.5^√(1/HR)) (common) or HR (rare);
 *   SMD/d (continuous) → exp(0.91·d).
 *
 * Verified vs the EValue R package (evalues.RR/OR/HR) to ~1e-6:
 *   RR=2.0 [1.5,2.7] → E=3.414214 (CI 2.366025); OR=2.0 common → E=2.179580 (CI 1.749392);
 *   HR=1.6 common → E=2.112944 (CI 1.525531); RR=0.6 [0.4,0.9] → E=2.720759 (CI 1.462475).
 *
 * Reference: VanderWeele TJ, Ding P (2017), Ann Intern Med 167(4):268-274.
 */
(function (global) {
  "use strict";

  function _e(rr) {
    if (!(rr > 0)) return NaN;
    var r = rr >= 1 ? rr : 1 / rr;
    return r + Math.sqrt(r * (r - 1));
  }
  // Map any supported measure to an approximate risk ratio.
  function approxRR(measure, est, rare) {
    measure = (measure || "RR").toUpperCase();
    if (!isFinite(est)) return NaN;
    // SMD/d are on the DIFFERENCE scale — any sign is valid (negative = protective).
    // Chinn 2000: d → exp(0.91·d). (Only valid for a STANDARDISED difference.)
    if (measure === "SMD" || measure === "D") return Math.exp(0.91 * est);
    if (!(est > 0)) return NaN; // ratio measures (RR/OR/HR) must be positive
    if (measure === "RR") return est;
    if (measure === "OR") return rare ? est : Math.sqrt(est);
    if (measure === "HR") return rare ? est : (1 - Math.pow(0.5, Math.sqrt(est))) / (1 - Math.pow(0.5, Math.sqrt(1 / est)));
    return est;
  }

  // eValues(measure, point, lo, hi, {rare}) → { rr:{point,lo,hi}, point, ci }.
  // `ci` is the E-value for the CI bound nearest the null (1 if the CI crosses the null).
  function eValues(measure, point, lo, hi, opts) {
    opts = opts || {};
    var rare = !!opts.rare;
    var rr = approxRR(measure, point, rare);
    var rrLo = (lo != null && isFinite(lo)) ? approxRR(measure, lo, rare) : null;
    var rrHi = (hi != null && isFinite(hi)) ? approxRR(measure, hi, rare) : null;
    var ePoint = _e(rr);
    var eCI = 1;
    if (rr >= 1) { // effect above null → the lower CI bound is nearest the null
      if (rrLo != null) eCI = (rrLo <= 1) ? 1 : _e(rrLo);
    } else {       // effect below null → the upper CI bound is nearest the null
      if (rrHi != null) eCI = (rrHi >= 1) ? 1 : _e(rrHi);
    }
    return { rr: { point: rr, lo: rrLo, hi: rrHi }, point: ePoint, ci: eCI };
  }

  var api = { eValues: eValues, approxRR: approxRR, eValue: _e };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.AlmEValue = api;
})(typeof window !== "undefined" ? window : globalThis);
