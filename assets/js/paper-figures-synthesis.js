/* paper-figures-synthesis.js — Synthēsis-journal-styled figures for Paper Studio.
 *
 * Bespoke offline SVG (no Plotly) reproducing the premium typeset look of the
 * Synthēsis metapaper PDF: forest-green weight-proportional squares, raw event
 * counts beneath each study, STUDY / OR (95% CI) / WEIGHT columns, a maroon
 * pooled diamond, a red 95%-prediction-interval bracket, a dotted no-effect
 * line, a log x-axis, and the signature hand-drawn curved-arrow annotation
 * callout. This is the DEFAULT forest renderer whenever the Synthēsis theme is
 * active; the writer can edit the callout text, toggle it, and set the x-range.
 * paper-figures.js (Plotly) remains the fallback for the plain/other themes.
 *
 * Palette matched to paper-synthesis.css:
 *   green #2f7d34 (markers) · brand green #054f16 · maroon #9c2b27 (pooled)
 *   ink #1d1d1b · grey #6f6f6a · rule #d6d8d1 · rose band rgba(156,43,39,.10)
 *
 * Pure string-building — no DOM needed to GENERATE the SVG (testable in node);
 * render*() helpers inject it into an element.
 */
(function () {
  "use strict";
  window.PaperStudio = window.PaperStudio || {};
  var PS = window.PaperStudio;

  var C = {
    green: "#2f7d34", greenDk: "#054f16", maroon: "#9c2b27", ink: "#1d1d1b",
    inkSoft: "#39413a", grey: "#6f6f6a", rule: "#d6d8d1", rose: "rgba(156,43,39,0.10)",
    serif: "Palatino Linotype, Palatino, Book Antiqua, Georgia, serif",
    sans: "Segoe UI, Helvetica Neue, Arial, sans-serif"
  };

  // --- minimal inverse-normal (Acklam) for CI bounds at the chosen level ---
  function normInv(p) {
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var pl = 0.02425, ph = 1 - pl, q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p <= ph) { q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  function num(v) { var n = Number(v); return (v === "" || v == null || !isFinite(n)) ? null : n; }
  function zFor(res) { var cl = Number(res && res.confLevel); if (!isFinite(cl) || cl <= 0) cl = 95; if (cl > 1) cl /= 100; return normInv(1 - (1 - cl) / 2); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function f2(x) { return (Math.round(x * 100) / 100).toFixed(2); }

  // Per-study natural-scale points, counts sub-label, and RE weight.
  function studyRows(res) {
    var z = zFor(res), cont = !!res.isContinuous, pd = res.plotData || [];
    var tau2 = num(res.tau2) || 0;
    var rows = [];
    pd.forEach(function (d) {
      var se = num(d.se); if (se == null || se <= 0) return;
      var center = cont ? num(d.md != null ? d.md : d.logOR) : num(d.logOR);
      if (center == null) return;
      var eff, lo, hi;
      if (cont) { eff = center; lo = center - z * se; hi = center + z * se; }
      else { eff = Math.exp(center); lo = Math.exp(center - z * se); hi = Math.exp(center + z * se); }
      var vi = num(d.vi) != null ? num(d.vi) : se * se;
      var w = 1 / (vi + tau2);
      var sub = "";
      var tE = num(d.tE), tN = num(d.tN), cE = num(d.cE), cN = num(d.cN);
      if (tN != null && tN > 0 && cN != null && cN > 0) sub = tE + "/" + tN + " vs " + cE + "/" + cN;
      rows.push({ name: d.id || d.name || "Study", sub: sub, eff: eff, lo: lo, hi: hi, w: w });
    });
    var sw = rows.reduce(function (a, r) { return a + r.w; }, 0) || 1;
    rows.forEach(function (r) { r.wp = r.w / sw; });
    return rows;
  }

  function niceTicks(lo, hi, cont) {
    if (cont) {
      // linear: ~6 round ticks
      var span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span / 5)));
      var err = (span / 5) / step;
      if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
      var t = [], start = Math.ceil(lo / step) * step;
      for (var v = start; v <= hi + 1e-9; v += step) t.push(v);
      return t;
    }
    var cand = [0.1, 0.2, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50];
    return cand.filter(function (v) { return v >= lo * 0.999 && v <= hi * 1.001; });
  }

  /* Build the Synthēsis forest plot as an SVG string.
   * res: results-like {plotData, isContinuous, confLevel, or, lci, uci,
   *      piLCI, piUCI, k, effectMeasure, tau2}
   * opts: {xMin, xMax, label, annotation (string|false to hide), width} */
  PS.synthesisForestSVG = function (res, opts) {
    opts = opts || {};
    var cont = !!res.isContinuous;
    var rows = studyRows(res);
    var pEff = num(res.or), pLo = num(res.lci), pHi = num(res.uci);
    if (!rows.length && pEff == null) return "";
    var piLo = (res.piLCI != null && res.piLCI !== "--") ? num(res.piLCI) : null;
    var piHi = (res.piUCI != null && res.piUCI !== "--") ? num(res.piUCI) : null;
    var nullX = cont ? 0 : 1;
    var measure = res.effectMeasure || (cont ? "Mean difference" : "Odds ratio");

    // ---- geometry ----
    var W = num(opts.width) || 760;
    var labelR = 188;            // right edge of the study-label column
    var plotL = 212, plotR = W - 232;
    var orX = plotR + 26, wtX = W - 16;
    var rowH = 46, topPad = 44;
    var nStudy = rows.length;
    var yStudy0 = topPad + 18;
    var pooledY = yStudy0 + nStudy * rowH + 18;
    var piY = pooledY + 30;
    var axisY = (piLo != null ? piY : pooledY) + 40;
    var H = axisY + 52;

    // ---- x scale (log for ratio, linear for MD) ----
    var allLo = rows.map(function (r) { return r.lo; }).concat(pLo != null ? [pLo] : [], piLo != null ? [piLo] : []);
    var allHi = rows.map(function (r) { return r.hi; }).concat(pHi != null ? [pHi] : [], piHi != null ? [piHi] : []);
    var dataLo = Math.min.apply(null, allLo.concat([nullX]));
    var dataHi = Math.max.apply(null, allHi.concat([nullX]));
    var domLo = num(opts.xMin), domHi = num(opts.xMax);
    if (domLo == null || domHi == null || domLo >= domHi) {
      if (cont) { var pad = (dataHi - dataLo) * 0.12 || 1; domLo = dataLo - pad; domHi = dataHi + pad; }
      else { domLo = Math.min(nullX, dataLo) * 0.92; domHi = dataHi * 1.08; if (domLo <= 0) domLo = dataLo * 0.92; }
    }
    var tx = cont
      ? function (v) { return plotL + (v - domLo) / (domHi - domLo) * (plotR - plotL); }
      : function (v) { return plotL + (Math.log(v) - Math.log(domLo)) / (Math.log(domHi) - Math.log(domLo)) * (plotR - plotL); };

    var S = [];
    S.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + C.sans + '" width="100%" style="max-width:' + W + 'px;height:auto;background:#fff">');
    // defs: arrowhead for the annotation callout
    S.push('<defs><marker id="synArrow" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="' + C.maroon + '"/></marker></defs>');

    // ---- column headers ----
    var hdr = 'font-size="10" letter-spacing="0.10em" fill="' + C.grey + '"';
    S.push('<text x="0" y="' + topPad + '" ' + hdr + '>STUDY</text>');
    S.push('<text x="' + orX + '" y="' + topPad + '" ' + hdr + '>' + (cont ? "MD" : "OR") + ' (95% CI)</text>');
    S.push('<text x="' + wtX + '" y="' + topPad + '" text-anchor="end" ' + hdr + '>WEIGHT</text>');

    // ---- no-effect dotted line ----
    var xNull = tx(nullX);
    S.push('<line x1="' + xNull.toFixed(1) + '" y1="' + (topPad + 6) + '" x2="' + xNull.toFixed(1) + '" y2="' + (axisY) + '" stroke="' + C.grey + '" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"/>');

    // ---- per-study rows ----
    var maxWp = Math.max.apply(null, rows.map(function (r) { return r.wp; }).concat([1e-6]));
    rows.forEach(function (r, i) {
      var yc = yStudy0 + i * rowH + rowH / 2 - 6;
      // label + counts
      S.push('<text x="' + labelR + '" y="' + (yc + 1) + '" text-anchor="end" font-size="12.5" font-weight="700" fill="' + C.ink + '">' + esc(r.name) + '</text>');
      if (r.sub) S.push('<text x="' + labelR + '" y="' + (yc + 15) + '" text-anchor="end" font-size="10" fill="' + C.grey + '">' + esc(r.sub) + '</text>');
      // CI line
      var xl = tx(r.lo), xh = tx(r.hi), xe = tx(r.eff);
      S.push('<line x1="' + xl.toFixed(1) + '" y1="' + yc + '" x2="' + xh.toFixed(1) + '" y2="' + yc + '" stroke="' + C.grey + '" stroke-width="1.3"/>');
      // weight-proportional square (area ∝ weight)
      var side = Math.max(6, 20 * Math.sqrt(r.wp / maxWp));
      S.push('<rect x="' + (xe - side / 2).toFixed(1) + '" y="' + (yc - side / 2).toFixed(1) + '" width="' + side.toFixed(1) + '" height="' + side.toFixed(1) + '" fill="' + C.green + '"/>');
      // right columns
      var ci = f2(r.eff) + ' (' + f2(r.lo) + '–' + f2(r.hi) + ')';
      S.push('<text x="' + orX + '" y="' + (yc + 1) + '" font-size="11.5" fill="' + C.ink + '">' + ci + '</text>');
      S.push('<text x="' + wtX + '" y="' + (yc + 1) + '" text-anchor="end" font-size="11" fill="' + C.grey + '">' + Math.round(r.wp * 100) + '%</text>');
    });

    // ---- pooled diamond ----
    if (pEff != null && pLo != null && pHi != null) {
      S.push('<text x="' + labelR + '" y="' + (pooledY + 1) + '" text-anchor="end" font-size="12.5" font-weight="700" fill="' + C.maroon + '">Pooled estimate</text>');
      S.push('<text x="' + labelR + '" y="' + (pooledY + 15) + '" text-anchor="end" font-size="9.5" fill="' + C.grey + '">random effects · ' + (num(res.k) || rows.length) + ' trials</text>');
      var dxl = tx(pLo), dxr = tx(pHi), dxe = tx(pEff), dh = 8;
      S.push('<polygon points="' + dxl.toFixed(1) + ',' + pooledY + ' ' + dxe.toFixed(1) + ',' + (pooledY - dh) + ' ' + dxr.toFixed(1) + ',' + pooledY + ' ' + dxe.toFixed(1) + ',' + (pooledY + dh) + '" fill="' + C.maroon + '"/>');
      S.push('<text x="' + orX + '" y="' + (pooledY + 1) + '" font-size="12.5" font-weight="700" fill="' + C.maroon + '">' + f2(pEff) + ' (' + f2(pLo) + '–' + f2(pHi) + ')</text>');
    }

    // ---- prediction-interval bracket ----
    if (piLo != null && piHi != null && pEff != null) {
      var bl = tx(piLo), br = tx(piHi);
      S.push('<line x1="' + bl.toFixed(1) + '" y1="' + piY + '" x2="' + br.toFixed(1) + '" y2="' + piY + '" stroke="' + C.maroon + '" stroke-width="1.4"/>');
      S.push('<line x1="' + bl.toFixed(1) + '" y1="' + (piY - 4) + '" x2="' + bl.toFixed(1) + '" y2="' + (piY + 4) + '" stroke="' + C.maroon + '" stroke-width="1.4"/>');
      S.push('<line x1="' + br.toFixed(1) + '" y1="' + (piY - 4) + '" x2="' + br.toFixed(1) + '" y2="' + (piY + 4) + '" stroke="' + C.maroon + '" stroke-width="1.4"/>');
      S.push('<text x="' + (br + 8).toFixed(1) + '" y="' + (piY + 3) + '" font-size="10.5" font-style="italic" fill="' + C.maroon + '">95% prediction interval ' + f2(piLo) + '–' + f2(piHi) + '</text>');
    }

    // ---- x-axis ----
    S.push('<line x1="' + plotL + '" y1="' + axisY + '" x2="' + plotR + '" y2="' + axisY + '" stroke="' + C.inkSoft + '" stroke-width="1"/>');
    niceTicks(domLo, domHi, cont).forEach(function (v) {
      var x = tx(v);
      if (x < plotL - 1 || x > plotR + 1) return;
      S.push('<line x1="' + x.toFixed(1) + '" y1="' + axisY + '" x2="' + x.toFixed(1) + '" y2="' + (axisY + 4) + '" stroke="' + C.inkSoft + '" stroke-width="1"/>');
      S.push('<text x="' + x.toFixed(1) + '" y="' + (axisY + 16) + '" text-anchor="middle" font-size="10.5" fill="' + C.inkSoft + '">' + (cont ? (Math.round(v * 100) / 100) : v) + '</text>');
    });
    S.push('<text x="' + ((plotL + plotR) / 2).toFixed(1) + '" y="' + (axisY + 34) + '" text-anchor="middle" font-size="11" fill="' + C.inkSoft + '">' + esc(measure) + (cont ? '' : ' (log scale)') + '</text>');

    // ---- annotation callout (default-on, editable) — placed in CLEAR space ----
    var ann = opts.annotation;
    if (ann !== false && pEff != null) {
      if (ann == null || ann === true) ann = PS.defaultForestAnnotation(res);
      if (ann) {
        // The note sits at the POOLED-ROW height, where the only mark is the
        // diamond — so the usable space is left/right of the diamond, not of the
        // study CIs (which live on other rows). Place it in the side that fits;
        // if the effect sits near the null (diamond central, neither side wide
        // enough) fall back to a clean italic note in the top band above the
        // column headers — so it NEVER overlaps the data.
        var dxL = tx(pLo != null ? pLo : pEff), dxR = tx(pHi != null ? pHi : pEff);
        var leftClear = dxL - plotL, rightClear = plotR - dxR;
        var ANNW = 140;
        var _annText = function (lns, ax, ay) {
          S.push('<text x="' + ax + '" y="' + ay + '" font-size="10.5" font-style="italic" fill="' + C.inkSoft + '">');
          lns.forEach(function (ln, j) { S.push('<tspan x="' + ax + '" dy="' + (j === 0 ? 0 : 13) + '">' + esc(ln) + '</tspan>'); });
          S.push('</text>');
        };
        var _annArrow = function (sx, sy, ex, ey) {
          S.push('<path d="M' + sx.toFixed(0) + ',' + sy.toFixed(0) + ' Q' + ((sx + ex) / 2).toFixed(0) + ',' + ((sy + ey) / 2 + 6).toFixed(0) + ' ' + ex.toFixed(0) + ',' + ey.toFixed(0) + '" fill="none" stroke="' + C.maroon + '" stroke-width="1.1" marker-end="url(#synArrow)" opacity="0.85"/>');
        };
        if (leftClear >= ANNW) {                       // prefer the left wedge (PDF style)
          var lnsL = wrapText(ann, 26), axL = plotL + 4, bhL = lnsL.length * 13;
          var ayL = pooledY - bhL - 6; if (ayL < yStudy0 + 8) ayL = yStudy0 + 8;
          _annText(lnsL, axL, ayL);
          _annArrow(Math.min(axL + 140, dxL - 30), ayL + bhL - 6, dxL - 4, pooledY);
        } else if (rightClear >= ANNW) {
          var lnsR = wrapText(ann, 26), axR = dxR + 14, bhR = lnsR.length * 13;
          var ayR = pooledY - bhR - 6; if (ayR < yStudy0 + 8) ayR = yStudy0 + 8;
          _annText(lnsR, axR, ayR);
          _annArrow(axR - 4, ayR + bhR - 6, dxR + 4, pooledY);
        } else {
          _annText(wrapText(ann, 64), plotL, 12);   // centred data → top-band note, no arrow
        }
      }
    }

    S.push('</svg>');
    return S.join("");
  };

  // The default narrative callout, in the PDF's voice. The "all trials point the
  // same way" clause is only emitted when the per-study point estimates are
  // ACTUALLY unanimous (every study on the same side of the null) — never assumed.
  PS.defaultForestAnnotation = function (res) {
    var pEff = num(res.or), pLo = num(res.lci), pHi = num(res.uci);
    if (pEff == null) return "";
    var cont = !!res.isContinuous, nullX = cont ? 0 : 1;
    var measure = cont ? "mean difference" : "odds ratio";
    var excludes = (pLo != null && pHi != null) && (pLo > nullX || pHi < nullX);
    var rows = studyRows(res), k = rows.length || num(res.k);
    var sides = rows.map(function (r) { return r.eff > nullX ? 1 : (r.eff < nullX ? -1 : 0); });
    var unanimous = rows.length >= 2 && sides.every(function (x) { return x !== 0 && x === sides[0]; });
    var s = "Pooled " + measure + " " + f2(pEff);
    if (pLo != null && pHi != null) s += " (95% CI " + f2(pLo) + "–" + f2(pHi) + ")";
    s += "; ";
    if (k && unanimous) s += "all " + k + " trials point the same way and the ";
    else if (rows.length >= 2) s += "the trials do not all point the same way, and the ";
    s += "interval " + (excludes ? "excludes" : "includes") + " no effect.";
    return s;
  };

  function wrapText(s, n) {
    var words = String(s).split(/\s+/), lines = [], cur = "";
    words.forEach(function (w) {
      if ((cur + " " + w).trim().length > n) { if (cur) lines.push(cur); cur = w; }
      else cur = (cur ? cur + " " : "") + w;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  // DOM render helper.
  PS.renderForestSynthesis = function (el, res, opts) {
    if (!el || !res) return false;
    var svg = PS.synthesisForestSVG(res, opts);
    if (!svg) return false;
    el.innerHTML = svg;
    return true;
  };

  // ===================================================================
  //  Shared helpers for the sensitivity / diagnostic figures
  // ===================================================================

  // SVG header + arrowhead def, shared by every figure.
  function svgOpen(W, H) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + C.sans + '" width="100%" style="max-width:' + W + 'px;height:auto;background:#fff">'
      + '<defs><marker id="synArrow" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="' + C.maroon + '"/></marker></defs>';
  }

  // The italic callout text + curved maroon arrow to a target point.
  function callout(S, text, ax, ay, maxChars, tgtX, tgtY) {
    if (!text) return;
    var lines = wrapText(text, maxChars || 30);
    S.push('<text x="' + ax + '" y="' + ay + '" font-size="10.5" font-style="italic" fill="' + C.inkSoft + '">');
    lines.forEach(function (ln, j) { S.push('<tspan x="' + ax + '" dy="' + (j === 0 ? 0 : 13) + '">' + esc(ln) + '</tspan>'); });
    S.push('</text>');
    if (tgtX != null && tgtY != null) {
      var sy = ay + (lines.length - 1) * 13 + 6, sx = ax + Math.min(150, maxChars * 5.4);
      S.push('<path d="M' + sx.toFixed(0) + ',' + sy.toFixed(0) + ' Q' + ((sx + tgtX) / 2).toFixed(0) + ',' + ((sy + tgtY) / 2 + 8).toFixed(0) + ' ' + tgtX.toFixed(0) + ',' + tgtY.toFixed(0) + '" fill="none" stroke="' + C.maroon + '" stroke-width="1.1" marker-end="url(#synArrow)" opacity="0.85"/>');
    }
  }

  // Compact DerSimonian-Laird random-effects pool of [{y, v}] on the given
  // (log or linear) scale — for the leave-one-out / cumulative re-pools.
  function reDL(items) {
    var k = items.length; if (!k) return null;
    var sw = 0, swy = 0, sw2 = 0;
    items.forEach(function (d) { var w = 1 / d.v; sw += w; swy += w * d.y; sw2 += w * w; });
    var muF = swy / sw;
    var Q = items.reduce(function (a, d) { return a + (1 / d.v) * (d.y - muF) * (d.y - muF); }, 0);
    var Cc = sw - sw2 / sw;
    var tau2 = (k > 1 && Cc > 0) ? Math.max(0, (Q - (k - 1)) / Cc) : 0;
    var rw = 0, rwy = 0;
    items.forEach(function (d) { var w = 1 / (d.v + tau2); rw += w; rwy += w * d.y; });
    return { est: rwy / rw, se: Math.sqrt(1 / rw), tau2: tau2, k: k };
  }

  // Map plotData → [{name, year, y(logOR or md), v}] on the analysis scale.
  function scaleItems(res) {
    var cont = !!res.isContinuous;
    return (res.plotData || []).map(function (d) {
      var se = num(d.se), c = cont ? num(d.md != null ? d.md : d.logOR) : num(d.logOR);
      if (se == null || se <= 0 || c == null) return null;
      return { name: d.id || d.name || "Study", year: num(d.year), y: c, v: num(d.vi) != null ? num(d.vi) : se * se };
    }).filter(Boolean);
  }

  function ratioTicks(lo, hi) {
    return [0.1, 0.2, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20].filter(function (v) { return v >= lo * 0.999 && v <= hi * 1.001; });
  }

  // A vertical "estimate column" figure (leave-one-out, cumulative): a list of
  // rows each with an effect + CI, a dashed reference line + rose band for the
  // all-trials estimate, a log/linear x-axis, and a callout. cfg: {colHeader,
  // axisLabel, refLabel, annotation}.
  function estimateColumnSVG(rows, ref, res, cfg, opts) {
    opts = opts || {}; cfg = cfg || {};
    var cont = !!res.isContinuous, nullX = cont ? 0 : 1;
    if (!rows.length || ref == null) return "";
    var W = num(opts.width) || 760, plotL = 230, plotR = W - 150, orX = plotR + 20;
    var rowH = 40, topPad = 44, y0 = topPad + 16;
    var axisY = y0 + rows.length * rowH + 14, H = axisY + 50;
    var allLo = rows.map(function (r) { return r.lo; }).concat([ref.lo, nullX]);
    var allHi = rows.map(function (r) { return r.hi; }).concat([ref.hi, nullX]);
    var domLo = num(opts.xMin), domHi = num(opts.xMax);
    if (domLo == null || domHi == null || domLo >= domHi) {
      var dlo = Math.min.apply(null, allLo), dhi = Math.max.apply(null, allHi);
      if (cont) { var pad = (dhi - dlo) * 0.12 || 1; domLo = dlo - pad; domHi = dhi + pad; }
      else { domLo = Math.min(nullX, dlo) * 0.94; domHi = dhi * 1.06; if (domLo <= 0) domLo = dlo * 0.94; }
    }
    var tx = cont ? function (v) { return plotL + (v - domLo) / (domHi - domLo) * (plotR - plotL); }
      : function (v) { return plotL + (Math.log(v) - Math.log(domLo)) / (Math.log(domHi) - Math.log(domLo)) * (plotR - plotL); };
    var S = [svgOpen(W, H)];
    var hdr = 'font-size="10" letter-spacing="0.10em" fill="' + C.grey + '"';
    S.push('<text x="0" y="' + topPad + '" ' + hdr + '>' + esc(cfg.colHeader || 'ANALYSIS') + '</text>');
    S.push('<text x="' + orX + '" y="' + topPad + '" ' + hdr + '>' + (cont ? 'MD' : 'OR') + ' (95% CI)</text>');
    // rose reference band + dashed all-trials line
    var bl = tx(ref.lo), br = tx(ref.hi), bm = tx(ref.est);
    S.push('<rect x="' + bl.toFixed(1) + '" y="' + (topPad + 4) + '" width="' + (br - bl).toFixed(1) + '" height="' + (axisY - topPad - 4) + '" fill="' + C.maroon + '" fill-opacity="0.10"/>');
    S.push('<line x1="' + bm.toFixed(1) + '" y1="' + (topPad + 4) + '" x2="' + bm.toFixed(1) + '" y2="' + axisY + '" stroke="' + C.maroon + '" stroke-width="1" stroke-dasharray="3 3"/>');
    S.push('<text x="' + (bm + 4).toFixed(1) + '" y="' + (axisY - 4) + '" font-size="9.5" font-style="italic" fill="' + C.maroon + '">' + esc(cfg.refLabel || 'all trials') + '</text>');
    rows.forEach(function (r, i) {
      var yc = y0 + i * rowH + rowH / 2;
      S.push('<text x="' + (plotL - 16) + '" y="' + (yc + 1) + '" text-anchor="end" font-size="11.5" fill="' + C.ink + '">' + esc(r.label) + '</text>');
      S.push('<line x1="' + tx(r.lo).toFixed(1) + '" y1="' + yc + '" x2="' + tx(r.hi).toFixed(1) + '" y2="' + yc + '" stroke="' + C.grey + '" stroke-width="1.2"/>');
      S.push('<circle cx="' + tx(r.eff).toFixed(1) + '" cy="' + yc + '" r="4.5" fill="' + C.green + '"/>');
      S.push('<text x="' + orX + '" y="' + (yc + 1) + '" font-size="11.5" fill="' + C.ink + '">' + f2(r.eff) + ' (' + f2(r.lo) + '–' + f2(r.hi) + ')</text>');
    });
    S.push('<line x1="' + plotL + '" y1="' + axisY + '" x2="' + plotR + '" y2="' + axisY + '" stroke="' + C.inkSoft + '" stroke-width="1"/>');
    (cont ? niceTicks(domLo, domHi, true) : ratioTicks(domLo, domHi)).forEach(function (v) {
      var x = tx(v); if (x < plotL - 1 || x > plotR + 1) return;
      S.push('<line x1="' + x.toFixed(1) + '" y1="' + axisY + '" x2="' + x.toFixed(1) + '" y2="' + (axisY + 4) + '" stroke="' + C.inkSoft + '"/>');
      S.push('<text x="' + x.toFixed(1) + '" y="' + (axisY + 16) + '" text-anchor="middle" font-size="10.5" fill="' + C.inkSoft + '">' + (cont ? Math.round(v * 100) / 100 : v) + '</text>');
    });
    S.push('<text x="' + ((plotL + plotR) / 2).toFixed(1) + '" y="' + (axisY + 34) + '" text-anchor="middle" font-size="11" fill="' + C.inkSoft + '">' + esc(cfg.axisLabel) + '</text>');
    var ann = opts.annotation; if (ann == null || ann === true) ann = cfg.annotation;
    if (ann) callout(S, ann, plotL + 6, topPad + 22, 30, bm, y0 + 8);
    S.push('</svg>');
    return S.join("");
  }

  // ---- L'Abbé plot (per-arm event proportions) ----
  PS.synthesisLabbeSVG = function (res, opts) {
    opts = opts || {};
    var pd = (res.plotData || []).map(function (d) {
      var tE = num(d.tE), tN = num(d.tN), cE = num(d.cE), cN = num(d.cN);
      if (tN == null || tN <= 0 || cN == null || cN <= 0) return null;
      return { name: d.id || d.name || "Study", pc: cE / cN, pt: tE / tN, n: tN + cN };
    }).filter(Boolean);
    if (pd.length < 1) return "";
    var OR = num(res.or);
    var W = num(opts.width) || 620, H = 470, pad = 56;
    var plotL = pad + 24, plotR = W - 20, plotT = 24, plotB = H - pad;
    var maxP = Math.min(1, Math.max.apply(null, pd.map(function (d) { return Math.max(d.pt, d.pc); }).concat([0.6])) * 1.15);
    var tx = function (p) { return plotL + (p / maxP) * (plotR - plotL); };
    var ty = function (p) { return plotB - (p / maxP) * (plotB - plotT); };
    var maxN = Math.max.apply(null, pd.map(function (d) { return d.n; }));
    var S = [svgOpen(W, H)];
    // axes
    S.push('<line x1="' + plotL + '" y1="' + plotB + '" x2="' + plotR + '" y2="' + plotB + '" stroke="' + C.inkSoft + '"/>');
    S.push('<line x1="' + plotL + '" y1="' + plotT + '" x2="' + plotL + '" y2="' + plotB + '" stroke="' + C.inkSoft + '"/>');
    var ticks = []; for (var t = 0.2; t < maxP - 0.01; t += 0.1) ticks.push(Math.round(t * 10) / 10);
    ticks.forEach(function (v) {
      S.push('<text x="' + tx(v).toFixed(1) + '" y="' + (plotB + 16) + '" text-anchor="middle" font-size="10" fill="' + C.inkSoft + '">' + v + '</text>');
      S.push('<text x="' + (plotL - 8) + '" y="' + (ty(v) + 3).toFixed(1) + '" text-anchor="end" font-size="10" fill="' + C.inkSoft + '">' + v + '</text>');
    });
    S.push('<text x="' + ((plotL + plotR) / 2).toFixed(1) + '" y="' + (H - 14) + '" text-anchor="middle" font-size="11" fill="' + C.inkSoft + '">Event proportion — comparator arm</text>');
    S.push('<text x="16" y="' + ((plotT + plotB) / 2).toFixed(1) + '" font-size="11" fill="' + C.inkSoft + '" transform="rotate(-90 16 ' + ((plotT + plotB) / 2).toFixed(1) + ')" text-anchor="middle">Event proportion — treatment arm</text>');
    // diagonal line of no effect
    S.push('<line x1="' + tx(0) + '" y1="' + ty(0) + '" x2="' + tx(maxP) + '" y2="' + ty(maxP) + '" stroke="' + C.grey + '" stroke-width="1" stroke-dasharray="2 3"/>');
    S.push('<text x="' + tx(maxP * 0.84).toFixed(1) + '" y="' + (ty(maxP * 0.84) - 6).toFixed(1) + '" font-size="9.5" fill="' + C.grey + '" transform="rotate(-45 ' + tx(maxP * 0.84).toFixed(1) + ' ' + ty(maxP * 0.84).toFixed(1) + ')">line of no effect (y = x)</text>');
    // red curve implied by pooled OR: pt = OR*pc/(1-pc+OR*pc)
    if (OR != null) {
      var path = []; for (var pc = 0; pc <= maxP + 0.001; pc += maxP / 60) { var ptv = OR * pc / (1 - pc + OR * pc); if (ptv <= maxP) path.push((path.length ? 'L' : 'M') + tx(pc).toFixed(1) + ',' + ty(ptv).toFixed(1)); }
      S.push('<path d="' + path.join(' ') + '" fill="none" stroke="' + C.maroon + '" stroke-width="1.4"/>');
      S.push('<text x="' + tx(maxP * 0.30).toFixed(1) + '" y="' + ty(OR * (maxP * 0.30) / (1 - maxP * 0.30 + OR * maxP * 0.30)) + '" font-size="9.5" font-style="italic" fill="' + C.maroon + '" dy="-4">implied by pooled OR ' + f2(OR) + '</text>');
    }
    // bubbles
    pd.forEach(function (d) {
      var r = 5 + 11 * Math.sqrt(d.n / maxN);
      S.push('<circle cx="' + tx(d.pc).toFixed(1) + '" cy="' + ty(d.pt).toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + C.green + '" fill-opacity="0.85"/>');
      S.push('<text x="' + (tx(d.pc) + r + 3).toFixed(1) + '" y="' + (ty(d.pt) + 3).toFixed(1) + '" font-size="9.5" fill="' + C.ink + '">' + esc(d.name) + '</text>');
    });
    var ann = opts.annotation; if (ann == null || ann === true) ann = PS.defaultLabbeAnnotation(res, pd);
    if (ann) callout(S, ann, plotR - 200, plotB - 70, 30);
    S.push('</svg>');
    return S.join("");
  };
  PS.defaultLabbeAnnotation = function (res, pd) {
    var OR = num(res.or); if (OR == null) return "";
    var above = pd.filter(function (d) { return d.pt > d.pc; }).length, all = pd.length;
    if (OR > 1 && above === all) return "Every trial lies above the line of no effect: the event was more common in the treatment arm in all " + all + ".";
    if (OR < 1 && above === 0) return "Every trial lies below the line of no effect: the event was less common in the treatment arm in all " + all + ".";
    return "Each bubble is one trial (area ∝ total sample size); position relative to the diagonal shows the per-arm contrast.";
  };

  // ---- Risk-of-bias (RoB 2) traffic-light grid ----
  PS.synthesisRobSVG = function (res, opts) {
    opts = opts || {};
    var doms = opts.domains || ["D1 Randomisation", "D2 Deviations", "D3 Missing data", "D4 Measurement", "D5 Selective reporting"];
    var studies = (res.plotData || []).map(function (d) {
      return { name: d.id || d.name || "Study", rob: Array.isArray(d.rob) ? d.rob : null };
    }).filter(function (s) { return s.rob; });
    if (!studies.length) return "";
    var W = num(opts.width) || 720, labelW = 150, colW = 78, cols = doms.length + 1;
    var gridL = labelW, rowH = 46, topPad = 64, y0 = topPad + 8;
    var H = y0 + studies.length * rowH + 56;
    function judge(v) {
      v = String(v || "").toLowerCase();
      if (v.indexOf("high") >= 0) return { col: C.maroon, sym: "×" };
      if (v.indexOf("some") >= 0 || v.indexOf("unclear") >= 0 || v.indexOf("moderate") >= 0) return { col: "#d9a235", sym: "−" };
      return { col: C.green, sym: "+" };
    }
    function worst(rob) {
      var rank = { "+": 0, "−": 1, "×": 2 }, w = "+";
      rob.forEach(function (v) { var j = judge(v).sym; if (rank[j] > rank[w]) w = j; });
      return w === "×" ? { col: C.maroon, sym: "×" } : w === "−" ? { col: "#d9a235", sym: "−" } : { col: C.green, sym: "+" };
    }
    var S = [svgOpen(W, H)];
    var heads = doms.concat(["Overall"]);
    heads.forEach(function (h, c) {
      var cx = gridL + c * colW + colW / 2;
      var parts = wrapText(h, 11);
      S.push('<text x="' + cx.toFixed(1) + '" y="' + (topPad - 22) + '" text-anchor="middle" font-size="9.5" fill="' + C.grey + '">');
      parts.forEach(function (p, j) { S.push('<tspan x="' + cx.toFixed(1) + '" dy="' + (j === 0 ? 0 : 11) + '">' + esc(p) + '</tspan>'); });
      S.push('</text>');
    });
    studies.forEach(function (s, r) {
      var cy = y0 + r * rowH + rowH / 2;
      S.push('<text x="' + (gridL - 14) + '" y="' + (cy + 3) + '" text-anchor="end" font-size="11.5" fill="' + C.ink + '">' + esc(s.name) + '</text>');
      heads.forEach(function (h, c) {
        var j = c < doms.length ? judge(s.rob[c]) : worst(s.rob);
        var cx = gridL + c * colW + colW / 2;
        S.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy + '" r="11" fill="' + j.col + '"/>');
        S.push('<text x="' + cx.toFixed(1) + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">' + j.sym + '</text>');
      });
    });
    // legend
    var ly = H - 24, lx = gridL;
    [["Low", C.green, "+"], ["Some concerns", "#d9a235", "−"], ["High", C.maroon, "×"]].forEach(function (g) {
      S.push('<circle cx="' + (lx + 8) + '" cy="' + ly + '" r="8" fill="' + g[1] + '"/>');
      S.push('<text x="' + (lx + 8) + '" y="' + (ly + 3) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">' + g[2] + '</text>');
      S.push('<text x="' + (lx + 22) + '" y="' + (ly + 4) + '" font-size="10.5" fill="' + C.inkSoft + '">' + g[0] + '</text>');
      lx += 40 + g[0].length * 6.6;
    });
    S.push('</svg>');
    return S.join("");
  };

  // ---- Leave-one-out sensitivity ----
  PS.synthesisLeaveOneOutSVG = function (res, opts) {
    opts = opts || {};
    var items = scaleItems(res), cont = !!res.isContinuous, z = zFor(res);
    if (items.length < 3) return "";
    var rows = items.map(function (_, i) {
      var sub = items.filter(function (__, j) { return j !== i; });
      var p = reDL(sub);
      var eff = cont ? p.est : Math.exp(p.est), lo = cont ? p.est - z * p.se : Math.exp(p.est - z * p.se), hi = cont ? p.est + z * p.se : Math.exp(p.est + z * p.se);
      return { label: "Omitting " + items[i].name, eff: eff, lo: lo, hi: hi };
    });
    var ref = refFromRes(res, items, cont, z);
    var rng = rows.map(function (r) { return r.eff; });
    var lo2 = f2(Math.min.apply(null, rng)), hi2 = f2(Math.max.apply(null, rng));
    var cfg = {
      colHeader: "ANALYSIS", axisLabel: (cont ? "Re-pooled MD" : "Re-pooled OR") + " with one trial removed" + (cont ? "" : " (log scale)"),
      refLabel: "all trials " + f2(ref.est),
      annotation: "Omitting any single trial leaves the pooled estimate between " + lo2 + " and " + hi2 + "; no single trial drives the result."
    };
    return estimateColumnSVG(rows, ref, res, cfg, opts);
  };

  // ---- Cumulative meta-analysis (by year) ----
  PS.synthesisCumulativeSVG = function (res, opts) {
    opts = opts || {};
    var items = scaleItems(res), cont = !!res.isContinuous, z = zFor(res);
    if (items.length < 2) return "";
    var ordered = items.slice().sort(function (a, b) { return (a.year || 0) - (b.year || 0); });
    var rows = ordered.map(function (it, i) {
      var p = reDL(ordered.slice(0, i + 1));
      var eff = cont ? p.est : Math.exp(p.est), lo = cont ? p.est - z * p.se : Math.exp(p.est - z * p.se), hi = cont ? p.est + z * p.se : Math.exp(p.est + z * p.se);
      return { label: "+ " + it.name + (it.year ? " (" + it.year + ")" : ""), eff: eff, lo: lo, hi: hi };
    });
    var ref = refFromRes(res, items, cont, z);
    var cfg = {
      colHeader: "ADDED", axisLabel: (cont ? "Cumulative MD" : "Cumulative OR") + " as trials accrue" + (cont ? "" : " (log scale)"),
      refLabel: "current " + f2(ref.est),
      annotation: "As trials accrued the cumulative estimate settled at " + f2(ref.est) + "; the interval narrowed at every step."
    };
    return estimateColumnSVG(rows, ref, res, cfg, opts);
  };

  function refFromRes(res, items, cont, z) {
    var o = num(res.or), lo = num(res.lci), hi = num(res.uci);
    if (o != null && lo != null && hi != null) return { est: o, lo: lo, hi: hi };
    var p = reDL(items);
    return { est: cont ? p.est : Math.exp(p.est), lo: cont ? p.est - z * p.se : Math.exp(p.est - z * p.se), hi: cont ? p.est + z * p.se : Math.exp(p.est + z * p.se) };
  }

  // ---- Funnel plot ----
  PS.synthesisFunnelSVG = function (res, opts) {
    opts = opts || {};
    var cont = !!res.isContinuous, pd = res.plotData || [];
    var pts = pd.map(function (d) {
      var se = num(d.se), c = cont ? num(d.md != null ? d.md : d.logOR) : num(d.logOR);
      if (se == null || se <= 0 || c == null) return null;
      return { eff: cont ? c : Math.exp(c), se: se, lc: c, name: d.id || d.name || "Study" };
    }).filter(Boolean);
    if (pts.length < 2) return "";
    var pooled = num(res.or), logC = pooled != null ? (cont ? pooled : Math.log(pooled)) : null;
    var W = num(opts.width) || 600, H = 430, padL = 64, padR = 24, padT = 24, padB = 56;
    var plotL = padL, plotR = W - padR, plotT = padT, plotB = H - padB;
    var maxSE = Math.max.apply(null, pts.map(function (p) { return p.se; })) * 1.08;
    var z2 = 1.959964;
    var loB = [], hiB = [];
    if (logC != null) { loB = [logC - z2 * maxSE]; hiB = [logC + z2 * maxSE]; }
    var allEff = pts.map(function (p) { return cont ? p.lc : p.lc; }).concat(loB, hiB, logC != null ? [logC] : []);
    var domLo = Math.min.apply(null, allEff), domHi = Math.max.apply(null, allEff), spanv = (domHi - domLo) || 1;
    domLo -= spanv * 0.08; domHi += spanv * 0.08;
    var tx = function (lc) { return plotL + (lc - domLo) / (domHi - domLo) * (plotR - plotL); };
    var ty = function (se) { return plotT + (se / maxSE) * (plotB - plotT); };
    var S = [svgOpen(W, H)];
    // axes
    S.push('<line x1="' + plotL + '" y1="' + plotT + '" x2="' + plotL + '" y2="' + plotB + '" stroke="' + C.inkSoft + '"/>');
    S.push('<line x1="' + plotL + '" y1="' + plotB + '" x2="' + plotR + '" y2="' + plotB + '" stroke="' + C.inkSoft + '"/>');
    // pseudo-95% CI funnel (rose) + pooled vertical
    if (logC != null) {
      var apexX = tx(logC), apexY = plotT, blx = tx(logC - z2 * maxSE), brx = tx(logC + z2 * maxSE), baseY = ty(maxSE);
      S.push('<polygon points="' + apexX.toFixed(1) + ',' + apexY + ' ' + blx.toFixed(1) + ',' + baseY.toFixed(1) + ' ' + brx.toFixed(1) + ',' + baseY.toFixed(1) + '" fill="' + C.maroon + '" fill-opacity="0.08" stroke="' + C.maroon + '" stroke-opacity="0.35" stroke-dasharray="2 3"/>');
      S.push('<line x1="' + apexX.toFixed(1) + '" y1="' + plotT + '" x2="' + apexX.toFixed(1) + '" y2="' + plotB + '" stroke="' + C.maroon + '" stroke-width="1" stroke-dasharray="3 3"/>');
    }
    // ticks
    var axTicks = cont ? niceTicks(domLo, domHi, true) : ratioTicks(Math.exp(domLo), Math.exp(domHi)).map(function (v) { return Math.log(v); });
    axTicks.forEach(function (lc) {
      var x = tx(lc); if (x < plotL - 1 || x > plotR + 1) return;
      S.push('<line x1="' + x.toFixed(1) + '" y1="' + plotB + '" x2="' + x.toFixed(1) + '" y2="' + (plotB + 4) + '" stroke="' + C.inkSoft + '"/>');
      S.push('<text x="' + x.toFixed(1) + '" y="' + (plotB + 16) + '" text-anchor="middle" font-size="10" fill="' + C.inkSoft + '">' + (cont ? Math.round(lc * 100) / 100 : (Math.round(Math.exp(lc) * 100) / 100)) + '</text>');
    });
    [0, maxSE / 2, maxSE].forEach(function (se) {
      S.push('<text x="' + (plotL - 8) + '" y="' + (ty(se) + 3).toFixed(1) + '" text-anchor="end" font-size="10" fill="' + C.inkSoft + '">' + (Math.round(se * 100) / 100) + '</text>');
    });
    S.push('<text x="' + ((plotL + plotR) / 2).toFixed(1) + '" y="' + (H - 14) + '" text-anchor="middle" font-size="11" fill="' + C.inkSoft + '">' + esc(res.effectMeasure || (cont ? "Mean difference" : "Odds ratio")) + (cont ? "" : " (log scale)") + '</text>');
    S.push('<text x="16" y="' + ((plotT + plotB) / 2).toFixed(1) + '" font-size="11" fill="' + C.inkSoft + '" transform="rotate(-90 16 ' + ((plotT + plotB) / 2).toFixed(1) + ')" text-anchor="middle">Standard error</text>');
    // points
    pts.forEach(function (p) { S.push('<circle cx="' + tx(p.lc).toFixed(1) + '" cy="' + ty(p.se).toFixed(1) + '" r="5" fill="' + C.green + '" fill-opacity="0.85"/>'); });
    var ann = opts.annotation; if (ann == null || ann === true) ann = PS.defaultFunnelAnnotation(res, pts.length);
    if (ann) callout(S, ann, plotR - 210, plotT + 24, 30);
    S.push('</svg>');
    return S.join("");
  };
  PS.defaultFunnelAnnotation = function (res, k) {
    if (k < 10) return "With only " + k + " trials formal tests for small-study effects (Egger) are underpowered; the plot is shown for completeness, not for inference.";
    return "Asymmetry suggests possible small-study effects; interpret alongside the formal tests.";
  };

  // Dispatch by kind → SVG string. Unknown kind returns "".
  PS.synthesisFigureSVG = function (kind, res, opts) {
    switch (kind) {
      case "forest": return PS.synthesisForestSVG(res, opts);
      case "labbe": return PS.synthesisLabbeSVG(res, opts);
      case "rob": return PS.synthesisRobSVG(res, opts);
      case "leaveOneOut": return PS.synthesisLeaveOneOutSVG(res, opts);
      case "cumulative": return PS.synthesisCumulativeSVG(res, opts);
      case "funnel": return PS.synthesisFunnelSVG(res, opts);
      default: return "";
    }
  };
  PS.renderSynthesisFigure = function (kind, el, res, opts) {
    if (!el || !res) return false;
    var svg = PS.synthesisFigureSVG(kind, res, opts);
    if (!svg) return false;
    el.innerHTML = svg; return true;
  };

  // True when the Synthēsis theme is the active paper skin (it is the default).
  PS.isSynthesisTheme = function () {
    if (typeof document === "undefined") return false;
    var c = document.getElementById("paperCanvas");
    return !!(c && c.classList && c.classList.contains("paper-synthesis"));
  };
})();
