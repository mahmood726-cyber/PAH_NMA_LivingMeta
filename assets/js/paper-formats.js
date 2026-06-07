/* RapidMeta Evidence Paper Studio — export formats (all offline, no libraries).
   - Word (.doc, Word-openable HTML) with embedded figures
   - Markdown (.md), plain text (.txt), HTML (.html)
   - Figures as PNG / JPEG / SVG / TIFF (Plotly.toImage + a tiny TIFF encoder)
   - Submission modes: one combined PDF (the Clean PDF), OR a .zip of the
     manuscript text + each figure file + a figure-legends list (text-separate).
   The store-only ZIP and TIFF encoders are hand-rolled so nothing is fetched. */
(function () {
  "use strict";
  window.PaperStudio = window.PaperStudio || {};
  var PS = window.PaperStudio;

  /* ---------------- download helper ---------------- */
  function dl(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  function txtBlob(s, mime) { return new Blob([s], { type: mime || "text/plain;charset=utf-8" }); }

  /* ---------------- CRC32 + store-only ZIP ---------------- */
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function strU8(s) { return new TextEncoder().encode(s); }
  // files: [{name, data:Uint8Array}]
  function zipStore(files) {
    var chunks = [], central = [], offset = 0;
    function u16(n) { return [n & 255, (n >>> 8) & 255]; }
    function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = strU8(f.name), data = f.data, crc = crc32(data);
      var local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      chunks.push(new Uint8Array(local)); chunks.push(name); chunks.push(data);
      var cen = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
      central.push(new Uint8Array(cen)); central.push(name);
      offset += local.length + name.length + data.length;
    });
    var cstart = offset, csize = 0;
    central.forEach(function (c) { csize += c.length; });
    var end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(csize), u32(cstart), u16(0));
    var all = chunks.concat(central, [new Uint8Array(end)]);
    return new Blob(all, { type: "application/zip" });
  }

  /* ---------------- TIFF encoder (uncompressed RGB) ---------------- */
  function tiffFromCanvas(canvas) {
    var w = canvas.width, h = canvas.height;
    var rgba = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    var px = w * h, body = new Uint8Array(px * 3);
    for (var i = 0, j = 0; i < px; i++) { body[j++] = rgba[i * 4]; body[j++] = rgba[i * 4 + 1]; body[j++] = rgba[i * 4 + 2]; }
    var nTags = 8, headerLen = 8, ifdLen = 2 + nTags * 12 + 4, bps = 6; // BitsPerSample (3×u16)
    var dataOff = headerLen + ifdLen + bps;
    var total = dataOff + body.length;
    var buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
    // little-endian header
    dv.setUint16(0, 0x4949, true); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
    dv.setUint16(8, nTags, true);
    var o = 10;
    function tag(id, type, count, value) { dv.setUint16(o, id, true); dv.setUint16(o + 2, type, true); dv.setUint32(o + 4, count, true); dv.setUint32(o + 8, value, true); o += 12; }
    var bpsOff = headerLen + ifdLen;
    tag(256, 3, 1, w);            // ImageWidth
    tag(257, 3, 1, h);            // ImageLength
    tag(258, 3, 3, bpsOff);       // BitsPerSample -> offset to (8,8,8)
    tag(259, 3, 1, 1);            // Compression = none
    tag(262, 3, 1, 2);            // Photometric = RGB
    tag(273, 4, 1, dataOff);      // StripOffsets
    tag(277, 3, 1, 3);            // SamplesPerPixel
    tag(279, 4, 1, body.length);  // StripByteCounts
    dv.setUint32(o, 0, true);     // next IFD = 0
    dv.setUint16(bpsOff, 8, true); dv.setUint16(bpsOff + 2, 8, true); dv.setUint16(bpsOff + 4, 8, true);
    u8.set(body, dataOff);
    return new Blob([buf], { type: "image/tiff" });
  }

  /* ---------------- figure image export ---------------- */
  // Returns a Promise<Blob> of the figure in the requested format.
  PS.figureBlob = function (figId, format) {
    var f = PS._figs && PS._figs[figId];
    if (!f || !window.Plotly || !f.box) return Promise.reject(new Error("figure not available"));
    format = (format || "png").toLowerCase();
    var W = 1100, H = f.box.layout && f.box.layout.height ? f.box.layout.height * 2 : 700;
    if (format === "svg") return window.Plotly.toImage(f.box, { format: "svg", width: 1100, height: H / 2 }).then(function (uri) { return txtBlob(decodeURIComponent(uri.split(",")[1]), "image/svg+xml"); });
    if (format === "tiff") {
      return window.Plotly.toImage(f.box, { format: "png", width: 1100, height: H / 2, scale: 2 }).then(loadCanvas).then(tiffFromCanvas);
    }
    return window.Plotly.toImage(f.box, { format: format === "jpg" ? "jpeg" : format, width: 1100, height: H / 2, scale: 2 }).then(dataURItoBlob);
  };
  // Decode a data: URL to a Blob without fetch() (fetch can't read data: under file://).
  function dataURItoBlob(uri) {
    var parts = uri.split(","), mime = (parts[0].match(/:(.*?);/) || [, "image/png"])[1];
    var bin = atob(parts[1]), n = bin.length, u8 = new Uint8Array(n);
    while (n--) u8[n] = bin.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }
  function loadCanvas(dataUri) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0); res(c);
      };
      img.onerror = rej; img.src = dataUri;
    });
  }
  PS.exportFigure = function (figId, format) {
    PS.figureBlob(figId, format).then(function (b) { dl("figure-" + figId + "." + (format === "jpg" ? "jpg" : format), b); })
      .catch(function () { if (PS.toast) PS.toast("Could not export that figure — open the Analysis first."); });
  };

  /* ---------------- manuscript model + formatters ---------------- */
  function g(path) { return (PS.getField ? PS.getField(path) : "") || ""; }
  function a() { return PS.state.analysis || {}; }
  function p() { return PS.state.pico || {}; }
  function ciTxt() { var x = a(); return (x.effectEstimate || "—") + " (" + (x.ciLower || "—") + " to " + (x.ciUpper || "—") + ", " + (x.confLevel || "95") + "% CI)"; }

  PS.buildManuscript = function () {
    var x = a(), pic = p(), secs = [];
    secs.push({ h: g("studentText.title") || "Untitled evidence paper", lvl: 1 });
    if (PS.state.meta && PS.state.meta.studentName) secs.push({ para: [PS.state.meta.studentName], lvl: 0 });
    secs.push({ para: ["Clinical question. In " + (pic.population || "[population]") + ", does " + (pic.intervention || "[intervention]") + " compared with " + (pic.comparator || "[comparator]") + " improve " + (pic.primaryOutcome || "[primary outcome]") + "?"] });

    secs.push({ h: "Abstract", lvl: 2 });
    secs.push({ para: [
      "Background. " + g("studentText.abstractBackground"),
      "Objective. " + g("studentText.abstractObjective"),
      "Methods. A rapid systematic review and " + String(x.model || "random-effects").toLowerCase() + " meta-analysis combined " + (x.kStudies || "—") + " studies (" + (x.totalParticipants || "—") + " participants) for " + (pic.primaryOutcome || "the primary outcome") + ".",
      "Results. The combined " + (x.effectMeasure || "effect") + " was " + ciTxt() + ", I² = " + (x.i2 || "—") + "%. Certainty (GRADE): " + (x.certainty || "—") + ".",
      "Conclusion. " + g("studentText.abstractConclusion")
    ].filter(nonblank) });

    secs.push({ h: "Introduction", lvl: 2 });
    secs.push({ para: [g("studentText.introductionClinicalProblem"), g("studentText.introductionInterventionRationale"), g("studentText.introductionWhyReviewNeeded")].filter(nonblank) });

    secs.push({ h: "Methods", lvl: 2 });
    secs.push({ para: [
      "This short evidence paper used a rapid systematic review and meta-analysis workflow. The review question was structured using the PICO framework (Population, Intervention, Comparator, Outcome): the population was " + (pic.population || "[population]") + ", the intervention was " + (pic.intervention || "[intervention]") + ", the comparator was " + (pic.comparator || "[comparator]") + ", and the primary outcome was " + (pic.primaryOutcome || "[primary outcome]") + ".",
      "Treatment effects were summarized using the " + (x.effectMeasure || "chosen effect measure") + ". A " + String(x.model || "random-effects").toLowerCase() + " meta-analysis was performed. Heterogeneity was assessed using I² and τ², and certainty of evidence was summarized using a GRADE-style approach.",
      g("studentText.methodsStudentLimitation")
    ].filter(nonblank) });

    secs.push({ h: "Results", lvl: 2 });
    secs.push({ h: "Primary outcome", lvl: 3 });
    secs.push({ para: ["The pooled " + (x.effectMeasure || "effect") + " for " + (pic.primaryOutcome || "the primary outcome") + " was " + ciTxt() + ".", g("studentText.forestInterpretation")].filter(nonblank) });
    secs.push({ fig: "forest", label: "Forest plot — " + (pic.primaryOutcome || "primary outcome"), caption: g("figures.forestPlot.caption") });
    (PS.state.outcomes || []).forEach(function (oc) {
      secs.push({ h: "Secondary outcome: " + oc.label + (oc.illustrative ? " (illustrative demo data)" : ""), lvl: 3 });
      secs.push({ para: ["For " + oc.label + ", the pooled " + (oc.measure || "effect") + " was " + (oc.est || "—") + " (" + (oc.lci || "—") + " to " + (oc.uci || "—") + ", 95% CI), I² = " + (oc.i2 || "—") + "%.", g("studentText.oc_" + oc.id + "_interp")].filter(nonblank) });
      secs.push({ fig: "oc_" + oc.id, label: "Forest plot — " + oc.label, caption: g("studentText.oc_" + oc.id + "_caption") });
    });
    secs.push({ h: "Heterogeneity", lvl: 3 });
    secs.push({ para: ["Statistical heterogeneity was I² = " + (x.i2 || "—") + "%" + (x.tau2 ? ", τ² = " + x.tau2 : "") + (x.predictionInterval ? "; prediction interval " + x.predictionInterval + "." : "."), g("studentText.heterogeneityInterpretation")].filter(nonblank) });
    secs.push({ h: "Risk of bias", lvl: 3 });
    secs.push({ para: [g("figures.riskOfBias.caption")].filter(nonblank) });
    secs.push({ h: "Certainty of evidence", lvl: 3 });
    secs.push({ para: [g("studentText.certaintyInterpretation"), g("figures.gradeTable.caption")].filter(nonblank) });

    secs.push({ h: "Discussion", lvl: 2 });
    secs.push({ para: [
      g("studentText.discussionPrincipalFinding"), g("studentText.discussionClinicalMeaning"),
      g("studentText.discussionComparison"), g("studentText.discussionStrengths"),
      g("studentText.discussionLimitations"), g("studentText.discussionConclusion")
    ].filter(nonblank) });

    var refs = g("studentText.references");
    if (nonblank(refs)) { secs.push({ h: "References", lvl: 2 }); secs.push({ pre: refs }); }

    return { title: g("studentText.title") || "Evidence paper", sections: secs };
  };
  function nonblank(s) { return s && String(s).replace(/^\w+\.\s*$/, "").trim().length > 2; }

  function toMarkdown(m, withFigRefs) {
    var out = [], fign = 0;
    m.sections.forEach(function (s) {
      if (s.h) out.push("\n" + "#".repeat(s.lvl || 2) + " " + s.h + "\n");
      if (s.para) s.para.forEach(function (par) { out.push(par + "\n"); });
      if (s.pre) out.push("\n" + s.pre + "\n");
      if (s.fig) { fign++; out.push("\n*Figure " + fign + ". " + s.label + (s.caption ? " — " + s.caption : "") + "*\n"); }
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }
  function toPlainText(m) { return toMarkdown(m).replace(/^#+\s*/gm, "").replace(/\*/g, ""); }

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function toHTMLBody(m, figImgs) {
    var out = [], fign = 0;
    m.sections.forEach(function (s) {
      if (s.h) out.push("<h" + (s.lvl || 2) + ">" + esc(s.h) + "</h" + (s.lvl || 2) + ">");
      if (s.para) s.para.forEach(function (par) { out.push("<p>" + esc(par) + "</p>"); });
      if (s.pre) out.push("<pre style='white-space:pre-wrap;font-family:inherit'>" + esc(s.pre) + "</pre>");
      if (s.fig) { fign++; var img = figImgs && figImgs[s.fig]; out.push("<p><strong>Figure " + fign + ". " + esc(s.label) + "</strong></p>"); if (img) out.push("<p><img src='" + img + "' style='max-width:100%'/></p>"); if (s.caption) out.push("<p><em>" + esc(s.caption) + "</em></p>"); }
    });
    return out.join("\n");
  }
  function htmlDoc(m, figImgs) {
    return "<!DOCTYPE html><html><head><meta charset='utf-8'><title>" + esc(m.title) + "</title>" +
      "<style>body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;line-height:1.5;max-width:7in;margin:1in auto;color:#000}h1{font-size:18pt}h2{font-size:14pt;margin-top:18pt}h3{font-size:12pt}</style></head><body>" +
      toHTMLBody(m, figImgs) + "</body></html>";
  }

  // gather embedded figure PNGs (data URLs) for Word/HTML
  function gatherFigImgs(m) {
    var jobs = m.sections.filter(function (s) { return s.fig && PS._figs && PS._figs[s.fig]; });
    return Promise.all(jobs.map(function (s) {
      return window.Plotly.toImage(PS._figs[s.fig].box, { format: "png", width: 1000, height: (PS._figs[s.fig].box.layout.height || 350), scale: 2 })
        .then(function (uri) { return { id: s.fig, uri: uri }; }).catch(function () { return { id: s.fig, uri: null }; });
    })).then(function (arr) { var map = {}; arr.forEach(function (o) { if (o.uri) map[o.id] = o.uri; }); return map; });
  }

  /* ---------------- public exporters ---------------- */
  PS.exportMarkdown = function () { var m = PS.buildManuscript(); dl(slug(m) + ".md", txtBlob(toMarkdown(m), "text/markdown;charset=utf-8")); };
  PS.exportText = function () { var m = PS.buildManuscript(); dl(slug(m) + ".txt", txtBlob(toPlainText(m))); };
  PS.exportHTML = function () { var m = PS.buildManuscript(); gatherFigImgs(m).then(function (imgs) { dl(slug(m) + ".html", txtBlob(htmlDoc(m, imgs), "text/html;charset=utf-8")); }); };
  PS.exportWord = function () {
    var m = PS.buildManuscript();
    gatherFigImgs(m).then(function (imgs) {
      // Word opens HTML with the msword MIME; embedded PNGs travel as data URLs.
      dl(slug(m) + ".doc", new Blob(["﻿", htmlDoc(m, imgs)], { type: "application/msword" }));
      if (PS.toast) PS.toast("Word file downloaded (opens in Microsoft Word).");
    });
  };

  // Submission mode B: manuscript text + each figure as its own file + legends, zipped.
  PS.exportBundle = function (figFormat) {
    figFormat = figFormat || "png";
    var m = PS.buildManuscript();
    var figs = m.sections.filter(function (s) { return s.fig && PS._figs && PS._figs[s.fig]; });
    var legends = [], fign = 0;
    var files = [{ name: "manuscript.md", data: strU8(toMarkdown(m)) }, { name: "manuscript.doc", data: strU8("﻿" + htmlDoc(m, null)) }];
    Promise.all(figs.map(function (s) {
      fign++; var n = fign;
      legends.push("Figure " + n + ". " + s.label + (s.caption ? " — " + s.caption : ""));
      return PS.figureBlob(s.fig, figFormat).then(function (b) { return b.arrayBuffer().then(function (ab) { return { name: "figure-" + n + "." + (figFormat === "jpg" ? "jpg" : figFormat), data: new Uint8Array(ab) }; }); }).catch(function () { return null; });
    })).then(function (figFiles) {
      figFiles.filter(Boolean).forEach(function (f) { files.push(f); });
      files.push({ name: "figure-legends.txt", data: strU8(legends.join("\n\n") + "\n") });
      // include the submittable supplementary checklists if available
      if (PS._supplementaryFiles) PS._supplementaryFiles().forEach(function (s) { files.push({ name: s.name, data: strU8(s.text) }); });
      dl(slug(m) + "-submission.zip", zipStore(files));
      if (PS.toast) PS.toast("Submission bundle downloaded: manuscript + " + figFiles.filter(Boolean).length + " figure(s) + legends.");
    });
  };

  // All figures only, zipped, in the chosen format.
  PS.exportAllFigures = function (figFormat) {
    figFormat = figFormat || "png";
    var ids = Object.keys(PS._figs || {});
    if (!ids.length) { if (PS.toast) PS.toast("No figures to export yet — open the Analysis first."); return; }
    var n = 0;
    Promise.all(ids.map(function (id) { n++; var k = n; return PS.figureBlob(id, figFormat).then(function (b) { return b.arrayBuffer().then(function (ab) { return { name: "figure-" + k + "-" + id + "." + (figFormat === "jpg" ? "jpg" : figFormat), data: new Uint8Array(ab) }; }); }).catch(function () { return null; }); }))
      .then(function (files) { files = files.filter(Boolean); if (!files.length) { if (PS.toast) PS.toast("Figures not ready."); return; } dl("figures-" + figFormat + ".zip", zipStore(files)); });
  };

  function slug(m) { return (m.title || "evidence-paper").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "evidence-paper"; }

  /* ================= FULL TRANSPARENCY APPENDIX =================
     Harvest everything RapidMeta produced so nothing is wasted: all screened
     records with full abstracts + links, the full statistical results, the R
     validation code + output, every chart in the dashboard, and the key tables. */
  function RM() { return window.RapidMeta || {}; }
  function txtOf(sel) { var e = document.querySelector(sel); return e ? (e.innerText || e.textContent || "").trim() : ""; }
  function trialLink(t) {
    return t.sourceUrl || t.ctgovUrl || (t.pmid ? "https://pubmed.ncbi.nlm.nih.gov/" + String(t.pmid).replace(/[^0-9]/g, "") + "/" : (t.doi ? "https://doi.org/" + String(t.doi).replace(/^doi:/i, "") : (/^NCT/i.test(t.id || "") ? "https://clinicaltrials.gov/study/" + t.id : "")));
  }
  function recordsMd() {
    var trials = (RM().state && RM().state.trials) || [];
    var by = {}; trials.forEach(function (t) { var s = (t.status || "search").toLowerCase(); by[s] = (by[s] || 0) + 1; });
    var lines = ["# All screened records — full transparency", "",
      "Total records: " + trials.length + ". By status: " + Object.keys(by).map(function (k) { return k + " = " + by[k]; }).join(", ") + ".",
      "Every record found during the search is listed below with its full abstract (where available) and a link to the source.", ""];
    trials.forEach(function (t, i) {
      var title = (t.data && t.data.name) || t.title || t.id;
      var rm = RM(); var acr = rm.nctAcronyms && rm.nctAcronyms[t.id];
      lines.push("---", "", "### " + (i + 1) + ". " + title + (acr ? " (" + acr + ")" : ""));
      lines.push("- Status: **" + (t.status || "screened") + "**" + (t.reason ? " — reason: " + t.reason : ""));
      lines.push("- Source: " + (t.source || "—") + (t.year ? " · Year: " + t.year : ""));
      if (t.authors) lines.push("- Authors: " + t.authors);
      if (t.journal) lines.push("- Journal: " + t.journal);
      var ids = []; if (/^NCT/i.test(t.id || "")) ids.push("NCT: " + t.id); if (t.pmid) ids.push("PMID: " + t.pmid); if (t.doi) ids.push("DOI: " + t.doi);
      if (ids.length) lines.push("- Identifiers: " + ids.join(" · "));
      var link = trialLink(t); if (link) lines.push("- Link: " + link);
      var abs = t.abstract || (t.data && t.data.abstract) || "";
      lines.push("", abs ? "Abstract: " + abs : "_Abstract not captured for this record._", "");
    });
    return lines.join("\n");
  }
  function statisticsMd() {
    var r = (RM().state && RM().state.results) || null;
    if (!r) return "# Statistical results\n\n_No pooled results were computed in this session (run the Analysis first)._\n";
    var labels = {
      or: "Pooled effect", lci: "CI lower", uci: "CI upper", confLevel: "Confidence level (%)", i2: "I² (%)", tau2: "τ²",
      k: "Studies (k)", n: "Participants", piLCI: "Prediction interval lower", piUCI: "Prediction interval upper",
      qPvalue: "Cochran's Q p-value", eggerP: "Egger's test p-value", hksjLCI: "HKSJ CI lower", hksjUCI: "HKSJ CI upper",
      fragIdx: "Fragility index", fragQuot: "Fragility quotient", trimK0: "Trim-and-fill imputed studies", trimAdjOR: "Trim-and-fill adjusted effect",
      bayesCriLo: "Bayesian CrI lower", bayesCriHi: "Bayesian CrI upper", pORlt1: "P(effect < 1) %", infoFrac: "Information fraction (TSA) %"
    };
    var lines = ["# Statistical results (full)", "", "| Statistic | Value |", "|-----------|-------|"];
    Object.keys(labels).forEach(function (k) { if (r[k] != null && r[k] !== "--" && r[k] !== "") lines.push("| " + labels[k] + " | " + r[k] + " |"); });
    lines.push("", "Per-study data:", "", "| Study | Effect (log) | SE |", "|-------|--------------|----|");
    (r.plotData || []).forEach(function (d) { lines.push("| " + (d.id || d.name || "?") + " | " + (d.logOR != null ? Number(d.logOR).toFixed(4) : (d.md != null ? d.md : "—")) + " | " + (d.se != null ? Number(d.se).toFixed(4) : "—") + " |"); });
    return lines.join("\n");
  }
  function rValidationMd() {
    var code = txtOf("#r-code-text"), out = txtOf("#webrResults"), val = txtOf("#r-validation-results");
    var lines = ["# R validation (reproduce in R)", ""];
    lines.push(code ? "## R code\n\n```r\n" + code + "\n```\n" : "_R code was not generated in this session._\n");
    if (out) lines.push("## R output (WebR)\n\n```\n" + out + "\n```\n");
    if (val && !/Click .Validate/i.test(val)) lines.push("## Validation vs stored baseline\n\n" + val + "\n");
    return lines.join("\n");
  }
  function tableHtml(sel, title) { var e = document.querySelector(sel); var tbl = e && (e.matches("table") ? e : e.closest("table") || e.querySelector("table")); if (!tbl) return ""; return "<h2>" + title + "</h2>" + tbl.outerHTML; }

  // Harvest EVERY rendered chart in the dashboard (not just the paper's).
  PS.harvestAllFigures = function (format) {
    format = (format || "png").toLowerCase();
    var divs = Array.prototype.slice.call(document.querySelectorAll(".js-plotly-plot"));
    var seen = {}, jobs = [];
    divs.forEach(function (gd, i) {
      if (!gd || !gd.data) return;
      var name = (gd.id || (gd.parentElement && gd.parentElement.id) || ("chart-" + i)).replace(/[^a-z0-9_-]/gi, "-");
      if (seen[name]) name += "-" + i; seen[name] = 1;
      var ext = format === "jpg" ? "jpg" : format;
      jobs.push(toImg(gd, format).then(function (data) { return { name: "figures/" + name + "." + ext, data: data }; }).catch(function () { return null; }));
    });
    return Promise.all(jobs).then(function (a) { return a.filter(Boolean); });
  };
  function toImg(gd, format) {
    if (format === "tiff") return window.Plotly.toImage(gd, { format: "png", width: 1100, height: 600, scale: 2 }).then(loadCanvas).then(function (c) { return tiffFromCanvas(c).arrayBuffer(); }).then(function (ab) { return new Uint8Array(ab); });
    if (format === "svg") return window.Plotly.toImage(gd, { format: "svg", width: 1100, height: 600 }).then(function (uri) { return strU8(decodeURIComponent(uri.split(",")[1])); });
    return window.Plotly.toImage(gd, { format: format === "jpg" ? "jpeg" : format, width: 1100, height: 600, scale: 2 }).then(dataURItoBlob).then(function (b) { return b.arrayBuffer(); }).then(function (ab) { return new Uint8Array(ab); });
  }

  // test/diagnostics hook
  PS._transparencyDocs = function () { return { records: recordsMd(), statistics: statisticsMd(), r: rValidationMd() }; };

  PS.exportTransparency = function (figFormat) {
    figFormat = figFormat || "png";
    if (PS.toast) PS.toast("Building full transparency appendix… (harvesting every chart and record)");
    var m = PS.buildManuscript();
    var readme = ["# Transparency appendix", "",
      "This package contains everything the analysis produced, for full transparency:",
      "- `records.md` — every screened study with its full abstract and a link",
      "- `statistics.md` — the complete pooled results and per-study data",
      "- `R-validation.md` — the R code (and output) to reproduce the analysis",
      "- `tables.html` — GRADE Summary of Findings and other tables",
      "- `figures/` — every chart in the dashboard (" + figFormat.toUpperCase() + ")",
      "- `supplementary/` — PRISMA 2020, AMSTAR-2 and the search strategy", "",
      "Generated by RapidMeta Evidence Paper Studio. Verify all extracted values against the source publications."].join("\n");
    var files = [
      { name: "README.md", data: strU8(readme) },
      { name: "records.md", data: strU8(recordsMd()) },
      { name: "statistics.md", data: strU8(statisticsMd()) },
      { name: "R-validation.md", data: strU8(rValidationMd()) }
    ];
    var tables = [tableHtml("#sof-body", "GRADE Summary of Findings"), tableHtml("#grade-profile-container", "GRADE profile")].filter(Boolean).join("\n<hr>\n");
    if (tables) files.push({ name: "tables.html", data: strU8("<!DOCTYPE html><meta charset='utf-8'><body>" + tables + "</body>") });
    if (PS._supplementaryFiles) PS._supplementaryFiles().forEach(function (s) { files.push({ name: s.name, data: strU8(s.text) }); });
    PS.harvestAllFigures(figFormat).then(function (figFiles) {
      figFiles.forEach(function (f) { files.push(f); });
      files.push({ name: "figures/INDEX.txt", data: strU8("Charts exported: " + figFiles.length + "\n" + figFiles.map(function (f) { return f.name; }).join("\n")) });
      dl(slug(m) + "-transparency-appendix.zip", zipStore(files));
      if (PS.toast) PS.toast("Transparency appendix downloaded: " + figFiles.length + " chart(s) + records + R + statistics.");
    });
  };
})();
