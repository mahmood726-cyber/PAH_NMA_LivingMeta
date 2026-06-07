/* RapidMeta Evidence Paper Studio — figure renderer.
   Draws our OWN forest and funnel plots with the bundled Plotly, on a white,
   print-legible theme (the cloned host plots were dark-on-white and unreadable).
   Forest shows per-study CIs + a pooled diamond + a PREDICTION INTERVAL bar.
   Both accept an adjustable x-range. Works for ratio measures (log axis, null=1)
   and continuous mean-difference measures (linear axis, null=0). */
(function () {
  "use strict";
  window.PaperStudio = window.PaperStudio || {};
  var PS = window.PaperStudio;

  // Inverse normal CDF (Acklam) — for study CI bounds at the chosen confidence level.
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
  function zFor(res) { var cl = Number(res && res.confLevel); if (!isFinite(cl) || cl <= 0) cl = 95; if (cl > 1) cl /= 100; return normInv(1 - (1 - cl) / 2); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }

  var LIGHT = {
    paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff",
    font: { color: "#1f2933", family: "Inter, system-ui, sans-serif", size: 12 },
    margin: { l: 150, r: 30, t: 30, b: 48 }
  };
  var OPTS = { displayModeBar: false, responsive: true };

  // Build per-study natural-scale points and CI bounds.
  function studyPoints(res) {
    var z = zFor(res), cont = !!res.isContinuous, pd = res.plotData || [];
    var rows = [];
    pd.forEach(function (d) {
      var se = num(d.se); if (se == null) return;
      var center = cont ? num(d.md != null ? d.md : d.logOR) : num(d.logOR);
      if (center == null) return;
      var lo, hi, eff;
      if (cont) { eff = center; lo = center - z * se; hi = center + z * se; }
      else { eff = Math.exp(center); lo = Math.exp(center - z * se); hi = Math.exp(center + z * se); }
      rows.push({ name: d.id || d.name || "Study", eff: eff, lo: lo, hi: hi });
    });
    return rows;
  }

  // res: results-like {plotData, isContinuous, confLevel, or, lci, uci, piLCI, piUCI, k, effectMeasure}
  // opts: {xMin, xMax, label}
  PS.renderForest = function (el, res, opts) {
    opts = opts || {};
    if (!window.Plotly || !el || !res) return false;
    var cont = !!res.isContinuous;
    var rows = studyPoints(res);
    // Pooled-only is allowed (e.g. a manually-added outcome with no per-study rows).
    if (!rows.length && num(res.or) == null) return false;

    var names = rows.map(function (r) { return r.name; });
    var pooledEff = num(res.or), pLo = num(res.lci), pHi = num(res.uci);
    var piLo = (res.piLCI && res.piLCI !== "--") ? num(res.piLCI) : null;
    var piHi = (res.piUCI && res.piUCI !== "--") ? num(res.piUCI) : null;

    // y categories: studies (top→bottom), then a gap, pooled, then PI label
    var yStudies = names.slice();
    var yPooled = "◆ Pooled (95% CI)";
    var yPI = piLo != null ? "Prediction interval" : null;
    var yCats = yStudies.concat([yPooled]); if (yPI) yCats.push(yPI);

    var traces = [];
    // per-study points + CI error bars
    traces.push({
      x: rows.map(function (r) { return r.eff; }), y: yStudies, mode: "markers", type: "scatter",
      marker: { size: 9, color: "#1e293b", symbol: "square" },
      error_x: {
        type: "data", symmetric: false, visible: true, color: "#64748b", thickness: 1.4, width: 4,
        array: rows.map(function (r) { return r.hi - r.eff; }),
        arrayminus: rows.map(function (r) { return r.eff - r.lo; })
      },
      hovertemplate: "%{y}: %{x:.2f}<extra></extra>", name: "Studies", showlegend: false
    });
    // prediction interval bar (drawn first/behind, lighter & wider)
    if (piLo != null && piHi != null && pooledEff != null) {
      traces.push({
        x: [pooledEff], y: [yPI], mode: "markers", type: "scatter",
        marker: { size: 1, color: "#93c5fd" },
        error_x: { type: "data", symmetric: false, visible: true, color: "#93c5fd", thickness: 6, width: 0, array: [piHi - pooledEff], arrayminus: [pooledEff - piLo] },
        hovertemplate: "Prediction interval: " + piLo.toFixed(2) + " to " + piHi.toFixed(2) + "<extra></extra>", showlegend: false
      });
    }
    // pooled diamond + CI
    if (pooledEff != null && pLo != null && pHi != null) {
      traces.push({
        x: [pooledEff], y: [yPooled], mode: "markers", type: "scatter",
        marker: { size: 16, color: "#2454a6", symbol: "diamond" },
        error_x: { type: "data", symmetric: false, visible: true, color: "#2454a6", thickness: 2, width: 6, array: [pHi - pooledEff], arrayminus: [pooledEff - pLo] },
        hovertemplate: "Pooled: " + pooledEff.toFixed(2) + " (" + pLo.toFixed(2) + " to " + pHi.toFixed(2) + ")<extra></extra>", showlegend: false
      });
    }

    var nullX = cont ? 0 : 1;
    var measure = res.effectMeasure || (cont ? "mean difference" : "effect");
    var layout = Object.assign({}, LIGHT, {
      title: { text: opts.label ? "Forest plot — " + opts.label : "Forest plot", font: { size: 13 } },
      xaxis: {
        title: { text: measure + " (95% CI)" }, type: cont ? "linear" : "log",
        zeroline: false, gridcolor: "#e5e7eb", linecolor: "#94a3b8",
        tickfont: { color: "#1f2933" }
      },
      yaxis: { type: "category", categoryarray: yCats.slice().reverse(), autorange: true, tickfont: { color: "#1f2933" }, automargin: true },
      shapes: [{ type: "line", x0: nullX, x1: nullX, y0: 0, y1: 1, yref: "paper", line: { color: "#94a3b8", dash: "dash", width: 1 } }],
      height: Math.max(240, 70 + yCats.length * 34)
    });
    applyXRange(layout.xaxis, opts, cont);
    window.Plotly.react(el, traces, layout, OPTS);
    return true;
  };

  PS.renderFunnel = function (el, res, opts) {
    opts = opts || {};
    if (!window.Plotly || !el || !res || !(res.plotData && res.plotData.length)) return false;
    var cont = !!res.isContinuous, pd = res.plotData;
    var xs = [], ys = [], txt = [];
    pd.forEach(function (d) {
      var se = num(d.se); if (se == null || se <= 0) return;
      var center = cont ? num(d.md != null ? d.md : d.logOR) : num(d.logOR);
      if (center == null) return;
      xs.push(cont ? center : Math.exp(center)); ys.push(se); txt.push(d.id || d.name || "Study");
    });
    if (xs.length < 2) return false;
    var pooledEff = num(res.or) != null ? Number(res.or) : null;
    var traces = [{
      x: xs, y: ys, text: txt, mode: "markers", type: "scatter",
      marker: { size: 9, color: "#2454a6", opacity: 0.8 }, hovertemplate: "%{text}: %{x:.2f}, SE %{y:.3f}<extra></extra>", showlegend: false
    }];
    var maxSE = Math.max.apply(null, ys);
    var layout = Object.assign({}, LIGHT, {
      title: { text: opts.label ? "Funnel plot — " + opts.label : "Funnel plot", font: { size: 13 } },
      xaxis: { title: { text: (res.effectMeasure || "effect") + (cont ? "" : " (log scale)") }, type: cont ? "linear" : "log", gridcolor: "#e5e7eb", linecolor: "#94a3b8" },
      yaxis: { title: { text: "Standard error" }, autorange: "reversed", gridcolor: "#e5e7eb", linecolor: "#94a3b8" },
      shapes: pooledEff != null ? [{ type: "line", x0: pooledEff, x1: pooledEff, y0: 0, y1: maxSE, line: { color: "#94a3b8", dash: "dash", width: 1 } }] : [],
      height: 360
    });
    applyXRange(layout.xaxis, opts, cont);
    window.Plotly.react(el, traces, layout, OPTS);
    return true;
  };

  function applyXRange(xaxis, opts, cont) {
    var lo = num(opts.xMin), hi = num(opts.xMax);
    if (lo == null || hi == null || lo >= hi) return;
    if (cont) xaxis.range = [lo, hi];
    else if (lo > 0 && hi > 0) xaxis.range = [Math.log10(lo), Math.log10(hi)]; // log axis wants log10
    xaxis.autorange = false;
  }
})();
