/* RapidMeta Evidence Paper Studio — core.
   Builds the short-evidence-paper canvas, autofills Methods/Results from the
   live RapidMeta analysis, keeps Introduction/Discussion student-authored,
   embeds figures, autosaves, and drives write/preview modes.
   "RapidMeta fills the evidence. The student writes the meaning." */
(function () {
  "use strict";
  window.PaperStudio = window.PaperStudio || {};
  var PS = window.PaperStudio;
  var STORAGE_KEY = "rapidmeta.paperState";
  var booted = false;

  /* ---------------- state ---------------- */
  PS.state = {
    meta: { appName: "RapidMeta", paperType: "Short Evidence Paper", reviewTitle: "", studentName: "" },
    pico: { population: "", intervention: "", comparator: "", primaryOutcome: "" },
    search: { databases: "ClinicalTrials.gov, PubMed, and OpenAlex", searchDate: "" },
    analysis: {
      effectMeasure: "", model: "Random-effects", kStudies: "", totalParticipants: "",
      effectEstimate: "", ciLower: "", ciUpper: "", confLevel: "95", i2: "", tau2: "",
      predictionInterval: "", certainty: ""
    },
    figures: {
      prisma: { available: false, caption: "" },
      studyCharacteristics: { available: false, caption: "" },
      forestPlot: { available: false, caption: "" },
      riskOfBias: { available: false, caption: "" },
      gradeTable: { available: false, caption: "" },
      funnelPlot: { available: false, caption: "" }
    },
    outcomes: [],        // additional (secondary) outcomes the student writes on
    _seededOutcomes: false,
    style: { methodsLength: "concise", resultsLength: "concise", journal: "generic" },
    studentText: {}
  };

  /* ---------------- helpers ---------------- */
  function setNested(obj, path, val) {
    var parts = path.split("."), cur = obj;
    while (parts.length > 1) { var p = parts.shift(); if (!cur[p] || typeof cur[p] !== "object") cur[p] = {}; cur = cur[p]; }
    cur[parts[0]] = val;
  }
  function getNested(obj, path) {
    return path.split(".").reduce(function (c, k) { return (c == null) ? c : c[k]; }, obj);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  // Attribute-safe: also escape quotes so values can't break out of title="…"/aria-label="…".
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  PS.getField = function (path) {
    var el = document.querySelector('#paperCanvas [data-field="' + path + '"]');
    if (el) return el.innerText.trim();
    var v = getNested(PS.state, path);
    return v == null ? "" : String(v);
  };
  PS.allFieldValues = function () {
    var out = {};
    document.querySelectorAll('#paperCanvas [data-field]').forEach(function (el) { out[el.dataset.field] = el.innerText.trim(); });
    return out;
  };

  /* ---------------- persistence ---------------- */
  PS.save = function () { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(PS.state)); } catch (e) {} };
  PS.restore = function () {
    try { var s = localStorage.getItem(STORAGE_KEY); if (s) deepMerge(PS.state, JSON.parse(s)); } catch (e) {}
  };
  function deepMerge(target, src) {
    Object.keys(src || {}).forEach(function (k) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") return; // prototype-pollution guard
      if (src[k] && typeof src[k] === "object" && !Array.isArray(src[k])) {
        if (!target[k] || typeof target[k] !== "object") target[k] = {};
        deepMerge(target[k], src[k]);
      } else target[k] = src[k];
    });
  }

  /* ---------------- autofill from RapidMeta ---------------- */
  PS.loadRapidMetaData = function () {
    try {
      var RM = window.RapidMeta;
      var proto = (RM && RM.state && RM.state.protocol) || {};
      var a = PS.state.analysis, p = PS.state.pico;
      // PICO — only fill if the student hasn't already overridden it.
      if (!p.population) p.population = proto.pop || "";
      if (!p.intervention) p.intervention = proto.int || "";
      if (!p.comparator) p.comparator = proto.comp || "";
      if (!p.primaryOutcome) p.primaryOutcome = proto.out || "";

      var r = RM && RM.state && RM.state.results;
      if (r) {
        // Effect-measure label. resolveEffectMeasure only knows ratio measures
        // (OR/RR/HR), so for continuous/mean-difference results we must label it
        // ourselves — otherwise a negative MD prints as an impossible "RR -2.40".
        var isCont = !!(r.isContinuous || r.continuous || r.measureType === "MD" || r.measureType === "SMD");
        var label = (RM.emLabel ? RM.emLabel("short") : "") || "";
        if (isCont) label = (r.measureType === "SMD") ? "standardised mean difference" : "mean difference";
        a.effectMeasure = label || a.effectMeasure || "effect";

        a.kStudies = (r.k != null ? r.k : a.kStudies);
        a.totalParticipants = r.n != null ? r.n : a.totalParticipants;
        a.effectEstimate = round2(r.or != null ? r.or : a.effectEstimate);
        a.ciLower = round2(r.lci != null ? r.lci : a.ciLower);
        a.ciUpper = round2(r.uci != null ? r.uci : a.ciUpper);

        // I² may be exposed as lowercase i2 (binary path) or capital I2 (continuous path).
        var i2raw = (r.i2 != null) ? r.i2 : (r.I2 != null ? r.I2 : null);
        if (i2raw != null) { var i2n = Number(i2raw); a.i2 = isFinite(i2n) ? i2n.toFixed(1) : String(i2raw); }

        // confLevel may arrive as a percent (95) or a fraction (0.95).
        if (r.confLevel != null) { var cl = Number(r.confLevel); if (isFinite(cl)) { if (cl <= 1) cl *= 100; a.confLevel = String(Math.round(cl)); } }

        // τ²: render whenever finite, including a genuine 0 (homogeneity ≠ missing).
        if (typeof r.tau2 === "number" && isFinite(r.tau2)) a.tau2 = r.tau2.toFixed(3);

        if (r.piLCI && r.piUCI && r.piLCI !== "--" && r.piUCI !== "--") a.predictionInterval = round2(r.piLCI) + " to " + round2(r.piUCI);
        else if (r.k != null && Number(r.k) < 3) a.predictionInterval = ""; // not estimable; render notes why

        // Belt-and-suspenders: never let a ratio label sit on a negative estimate.
        if (/^(OR|RR|HR)$/i.test(a.effectMeasure) && Number(a.effectEstimate) < 0) a.effectMeasure = "mean difference";
      }
      // Certainty — read the rendered GRADE badge (machine-readable), not free text.
      if (!a.certainty) a.certainty = scrapeCertainty();

      // Best-effort prefill of the registered-protocol link. Blank in the pilot; populated
      // copies can expose RapidMeta.state.protocolUrl or a <meta name="protocol-url">.
      if (!PS.state.studentText.protocolLink) {
        var purl = (RM && RM.state && (RM.state.protocolUrl || (RM.state.protocol && RM.state.protocol.url))) || "";
        if (!purl) { var mt = document.querySelector('meta[name="protocol-url"]'); if (mt) purl = mt.getAttribute("content") || ""; }
        if (/^https?:\/\/\S+$/i.test(purl)) PS.state.studentText.protocolLink = purl;
      }

      // HONESTY CHECK: did the analysis silently DROP included studies from pooling?
      // (e.g. trials included with an HR but no extracted event counts are dropped by the
      // event-based pool, so k < the number of included studies, with no warning.)
      a.droppedStudies = 0; a.droppedNames = "";
      try {
        var trials = (RM && RM.state && RM.state.trials) || [];
        var incl = trials.filter(function (t) {
          var s = String(t.status || "").toLowerCase(); var dd = t.data || {};
          return s === "include" && (Number(dd.tN) > 0 || Number(dd.cN) > 0 || Number(dd.n) > 0);
        });
        var kp = (r && r.k != null) ? Number(r.k) : null;
        if (incl.length && kp != null && incl.length > kp) {
          a.droppedStudies = incl.length - kp;
          // name the likely-dropped trials (zero events in both arms = not poolable as events)
          a.droppedNames = incl.filter(function (t) { var dd = t.data || {}; return (Number(dd.tE) || 0) === 0 && (Number(dd.cE) || 0) === 0; })
            .map(function (t) { return (t.data && t.data.name) || t.id; }).join(", ");
        }
      } catch (e2) {}
    } catch (e) { console.warn("PaperStudio: autofill failed", e); }
  };

  // Round numeric-ish values to 2 dp; pass through non-numeric strings unchanged.
  function round2(v) {
    if (v == null || v === "" || v === "--") return v;
    var n = Number(v);
    return isFinite(n) ? n.toFixed(2) : String(v);
  }

  function scrapeCertainty() {
    // Prefer an explicit hook if the host ever exposes one.
    var hook = document.querySelector("[data-grade-certainty], #grade-final-certainty");
    if (hook) {
      var hv = (hook.getAttribute("data-grade-certainty") || hook.textContent || "").trim();
      if (hv) return titleCaseCertainty(hv);
    }
    // Read the GRADE badge but trust its TEXT, not its class: the host's badge class
    // can default to "very low" (smart-quote bug), so a class-only read prints a
    // confidently-wrong rating. If the badge text carries no certainty word, return
    // blank and let the student fill it in — never a silently-wrong value (review P0-3).
    var scopes = ["#sof-body", "#grade-profile-container", "#grade-container"];
    for (var s = 0; s < scopes.length; s++) {
      var root = document.querySelector(scopes[s]);
      if (!root) continue;
      var badge = root.querySelector(".grade-high, .grade-mod, .grade-low, .grade-vlow, .grade-badge");
      if (badge) { var w = titleCaseCertainty(badge.textContent || ""); if (w) return w; }
    }
    return "";
  }
  function titleCaseCertainty(s) {
    var m = String(s).toUpperCase().match(/VERY LOW|MODERATE|HIGH|LOW/);
    return m ? (m[0].charAt(0) + m[0].slice(1).toLowerCase()) : "";
  }

  /* ---------------- render builders ---------------- */
  function val(path) { var v = getNested(PS.state, path); return (v == null ? "" : esc(v)); }

  // Plain-language section guidance (hidden in the clean PDF). For novice writers.
  function helper(text) { return '<p class="section-help no-clean-pdf"><span class="help-ico" aria-hidden="true">💡</span> ' + text + '</p>'; }
  // A "good vs weak example" hint box for the trickiest sections.
  function example(good, weak) {
    return '<div class="section-example no-clean-pdf"><span class="ex-good">✓ Good:</span> ' + esc(good) +
      '<br><span class="ex-weak">✗ Too vague:</span> ' + esc(weak) + '</div>';
  }

  // A short secular parable that teaches the idea through a concrete image, then the
  // principle — narrative techniques (direct address, a vivid scene, repetition) without
  // any religious content. Collapsible; hidden in the clean PDF and by "Hide tips".
  function story(body) {
    return '<details class="story-card no-clean-pdf"><summary>📖 The idea, as a short story</summary><p>' + body + '</p></details>';
  }
  // A REAL, named, sourced trial case that teaches a method point. Uses direct address and a
  // question-then-answer rhythm, and ALWAYS ends on a number + a memorable method rule (never a
  // ready-made sentence about the student's own data). Collapsed, optional, never exported.
  function caseStudy(headline, body, rule, source) {
    return '<details class="case-card no-clean-pdf"><summary>🔎 A real example: ' + esc(headline) + '</summary>' +
      '<div class="case-body"><p>' + esc(body) + '</p>' +
      (rule ? '<p class="case-rule">' + esc(rule) + '</p>' : '') +
      (source ? '<p class="case-source">Source: ' + esc(source) + '</p>' : '') +
      '</div></details>';
  }

  // First-time "Start here" card. Dismissible; stays dismissed via localStorage.
  function onboardingCard() {
    var off = false; try { off = localStorage.getItem("rapidmeta.paperOnboard") === "off"; } catch (e) {}
    if (off) return "";
    return '<div class="onboard-card no-clean-pdf" role="note">' +
      '<button class="onboard-dismiss" data-action="dismiss-onboard" aria-label="Hide the start-here guide" title="Hide — you can reopen it with the “Start-here guide” button">✕</button>' +
      '<h3>👋 New to writing a paper? Start here</h3>' +
      '<ol>' +
      '<li><strong>Where to start.</strong> Write the sections in this order: <em>Introduction</em> first, then read the <em>Methods</em> and <em>Results</em> we filled in, write each figure caption, then the <em>Discussion</em>. Write the <em>Abstract last</em> — it summarises everything, so it is easiest at the end.</li>' +
      '<li><strong>The numbers are already done.</strong> Grey text (effect sizes, counts, methods) is filled in from your analysis — you do not calculate anything.</li>' +
      '<li><strong>Your job is the yellow boxes.</strong> Each one tells you what to write and gives you a sentence to finish in your own words.</li>' +
      '<li><strong>Stuck on a word?</strong> Click a blue button like “What is a forest plot?” for a 30-second explainer, or open the “Key terms” list below.</li>' +
      '<li><strong>Check as you go.</strong> The “Paper readiness” panel on the left lists what is still missing. Click <em>Check paper</em> any time.</li>' +
      '<li><strong>When you are done</strong>, click the blue <em>⬇ Download my paper (PDF)</em> button — that is the file you hand in (the yellow boxes and tips are hidden, leaving only your writing). On a phone this opens your “Save as PDF” screen — just choose <em>Save</em>. To give your tutor a copy with the tips still showing, open <em>More ▾</em> → <em>Version with tips (for my tutor)</em>.</li>' +
      '</ol>' +
      '<p class="onboard-tip">Tip: write a rough version first — you can always improve it. You cannot “submit” anything here, and your work saves automatically.</p>' +
      '<p class="onboard-privacy">🔒 Your work is saved only in this browser, on this computer (nothing is uploaded). Do not paste identifiable patient details. On a shared or public computer, click <strong>Clear all (shared PC)</strong> before you leave.</p>' +
      '</div>';
  }

  // "Key terms" glossary — reuses the learning cards; each chip opens the drawer.
  function glossaryCard() {
    var order = ["pooling", "effect_size", "confidence_interval", "heterogeneity", "prediction_interval", "risk_of_bias", "grade", "forest_plot", "funnel_plot", "prisma"];
    var chips = order.filter(function (k) { return PS.SYNTHESIS_LESSONS && PS.SYNTHESIS_LESSONS[k]; })
      .map(function (k) { return learnChip(k); }).join(" ");
    if (!chips) return "";
    return '<details class="glossary-card no-clean-pdf"><summary>📖 Key terms — click any to learn it in 30 seconds</summary>' +
      '<div class="glossary-chips">' + chips + '</div></details>';
  }

  // labelled multi-line student box. `help` = one-line how-to, shown as VISIBLE text
  // (.field-help) so it is keyboard/touch/screen-reader reachable — the help-dot is just
  // a decorative marker. `help` always stays visible (it is the core instruction).
  function box(path, label, placeholder, wordTarget, help, starter) {
    // Live counter uses the REAL readiness floor (not a number parsed from the target text),
    // so "x / N words" always matches what the gate enforces.
    var floor = (PS.floorFor ? PS.floorFor(path) : 0) || "";
    return '<div class="student-task-label no-clean-pdf">' + esc(label) +
        (help ? ' <span class="help-dot" aria-hidden="true">?</span>' : '') + '</div>' +
      (help ? '<div class="field-help no-clean-pdf">' + esc(help) + '</div>' : '') +
      (wordTarget ? '<div class="word-target no-clean-pdf">Aim for ' + esc(wordTarget) + ' <span class="live-wc" data-wc-for="' + path + '"></span></div>' : '') +
      '<div class="student-writing-box" contenteditable="true" role="textbox" aria-multiline="true" aria-label="' + escAttr(label) + '"' +
        (floor ? ' data-floor="' + floor + '"' : '') +
        ' data-field="' + path + '" data-placeholder="' + escAttr(placeholder) + '">' + val(path) + '</div>' +
      (starter ? exampleBtn(path, starter) : '');
  }
  // "Use this example to start" — fills an empty box with a CLEAN starter sentence the
  // student then edits. The starter must be gate-safe: NO bracket tokens ([condition]),
  // NO "___", NO TBC/TODO — those are blocking placeholder patterns in the readiness
  // check, so injecting a raw data-placeholder would self-block the Clean PDF. Hidden
  // once the box has any content; always .no-clean-pdf so it never reaches an export.
  function exampleBtn(path, starter) {
    var filled = !!getNested(PS.state, path);
    return '<button type="button" class="use-example no-clean-pdf" data-action="use-example"' +
      ' data-target="' + escAttr(path) + '" data-starter="' + escAttr(starter) + '"' +
      (filled ? ' hidden' : '') + '>✍️ Use this example to start</button>';
  }
  // Refresh the live "12 / 40 words" counters.
  PS.updateWordCounts = function () {
    document.querySelectorAll('#paperCanvas .student-writing-box[data-floor]').forEach(function (el) {
      var span = document.querySelector('.live-wc[data-wc-for="' + el.dataset.field + '"]'); if (!span) return;
      var cnt = (el.innerText || "").trim().split(/\s+/).filter(Boolean).length;
      var floor = Number(el.getAttribute("data-floor"));
      var thin = cnt >= floor && cnt < Math.ceil(floor * 1.4);
      span.textContent = "· " + cnt + " / " + floor + " words" + (thin ? " — a little more detail helps" : "");
      span.classList.toggle("wc-ok", cnt >= floor); span.classList.toggle("wc-low", cnt < floor && cnt > 0); span.classList.toggle("wc-thin", thin);
    });
  };
  // An inline "30-second explainer" chip for the first time a term appears in the prose.
  function learnChip(key) {
    var l = (PS.SYNTHESIS_LESSONS && PS.SYNTHESIS_LESSONS[key]) ? PS.SYNTHESIS_LESSONS[key].label : key;
    return '<button type="button" class="learn-chip" data-learn="' + key + '" aria-haspopup="dialog">' + esc(l) + '</button>';
  }
  // inline editable (title / captions)
  function inlineBox(path, placeholder, tag) {
    tag = tag || "span";
    return '<' + tag + ' class="student-editable" contenteditable="true" role="textbox" aria-label="' + escAttr(placeholder) + '" data-field="' + path + '" data-placeholder="' + escAttr(placeholder) + '">' + val(path) + '</' + tag + '>';
  }
  // auto-filled (read-only) value with a sensible dash fallback
  function auto(path, dash) { var v = getNested(PS.state, path); return (v == null || v === "") ? (dash || "—") : esc(v); }

  function figureCard(num, title, learnKeys, slotId, captionPath, captionPlaceholder) {
    var learn = (learnKeys || []).map(function (k) {
      var l = (PS.SYNTHESIS_LESSONS && PS.SYNTHESIS_LESSONS[k]) ? PS.SYNTHESIS_LESSONS[k].label : k;
      return '<button type="button" data-learn="' + k + '" aria-haspopup="dialog">' + esc(l) + '</button>';
    }).join("");
    return '<figure class="paper-figure-card">' +
      '<div class="figure-card-header"><span class="figure-label">Figure ' + num + '</span><h3>' + esc(title) + '</h3></div>' +
      (learn ? '<div class="figure-learning-row no-clean-pdf">' + learn + '</div>' : '') +
      '<div class="figure-visual" id="' + slotId + '"></div>' +
      '<figcaption><strong>Caption / interpretation:</strong> ' +
      inlineBox(captionPath, captionPlaceholder) + '</figcaption></figure>';
  }

  PS.renderChips = function () {
    var a = PS.state.analysis, p = PS.state.pico;
    var ci = (a.ciLower && a.ciUpper) ? (a.ciLower + "–" + a.ciUpper) : "";
    var chips = [
      ["Population", p.population], ["Intervention", p.intervention], ["Comparator", p.comparator],
      ["Primary outcome", p.primaryOutcome], ["Studies", a.kStudies], ["Participants", a.totalParticipants],
      ["Effect", (a.effectMeasure && a.effectEstimate) ? (a.effectMeasure + " " + a.effectEstimate) : a.effectEstimate],
      ["95% CI", ci], ["I²", a.i2 !== "" ? a.i2 + "%" : ""], ["Certainty", a.certainty]
    ];
    return chips.filter(function (c) { return c[1] != null && c[1] !== ""; })
      .map(function (c) { return '<span class="evidence-chip"><strong>' + esc(c[0]) + ':</strong> ' + esc(c[1]) + '</span>'; }).join("");
  };

  /* ---------------- Methods/Results length + journal style ---------------- */
  var JOURNALS = { generic: "Generic", cochrane: "Cochrane style", jama: "JAMA style", bmj: "BMJ style", plos: "PLOS style", lancet: "Lancet style" };
  var LENGTHS = { concise: "Keep present size", moderate: "Moderately longer", detailed: "Much longer (detailed)" };
  function we(j) { return (j === "cochrane" || j === "plos"); } // first-person plural house styles
  function styleSel(id, label, map, cur) {
    var opts = Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === cur ? " selected" : "") + ">" + esc(map[k]) + "</option>"; }).join("");
    return '<label>' + esc(label) + ' <select data-style="' + id + '">' + opts + '</select></label>';
  }
  function styleControl() {
    var s = PS.state.style;
    return '<div class="style-control no-clean-pdf"><span class="style-control-label">✍️ Methods &amp; Results format:</span>' +
      styleSel("journal", "Journal style", JOURNALS, s.journal) +
      styleSel("methodsLength", "Methods length", LENGTHS, s.methodsLength) +
      styleSel("resultsLength", "Results length", LENGTHS, s.resultsLength) +
      '<span class="style-control-note"><strong>Not sure? Leave on “Generic” + “Keep present size.”</strong> These change only the wording of the grey auto-text — never your own writing and never your marks.</span></div>';
  }
  PS.setStyle = function (id, val) { if (PS.state.style[id] !== undefined) { PS.state.style[id] = val; PS.save(); PS.render(); PS.embedFigures(); } };

  function ctx() {
    var a = PS.state.analysis, p = PS.state.pico;
    return {
      pop: auto("pico.population", "[population]"), int: auto("pico.intervention", "[intervention]"),
      comp: auto("pico.comparator", "[comparator]"), out: auto("pico.primaryOutcome", "[primary outcome]"),
      measure: esc(a.effectMeasure || "chosen effect measure"), model: esc(a.model || "random-effects").toLowerCase(),
      db: esc(PS.state.search.databases || "[databases]"), date: PS.state.search.searchDate ? " on " + esc(PS.state.search.searchDate) : "",
      rob: inlineBox("studentText.methodsRobTool", "RoB 2"), est: auto("analysis.effectEstimate"), i2: auto("analysis.i2"),
      cl: auto("analysis.confLevel", "95"), lci: auto("analysis.ciLower"), uci: auto("analysis.ciUpper"),
      k: auto("analysis.kStudies"), n: auto("analysis.totalParticipants"), certainty: auto("analysis.certainty", "(see GRADE)")
    };
  }

  // Returns an array of {label?, text} paragraphs for the Methods auto-prose.
  function methodsProse() {
    var c = ctx(), len = PS.state.style.methodsLength, j = PS.state.style.journal, W = we(j);
    var verbSearch = W ? "We searched " : "Searches were performed in ";
    var paras = [];
    var pico = "The review question was structured using the PICO framework (Population, Intervention, Comparator, Outcome): the population was " + c.pop + ", the intervention was " + c.int + ", the comparator was " + c.comp + ", and the primary outcome was " + c.out + ".";
    var search = verbSearch + c.db + c.date + ".";
    if (len !== "concise") search += W ? " Two review authors independently screened records and extracted data, resolving disagreements by discussion." : " Records were screened against predefined eligibility criteria, with study selection and data extraction performed in duplicate.";
    if (len === "detailed") search += " Reporting followed the PRISMA 2020 guidance, and the review methods were specified before data collection.";
    var synth = "Treatment effects were summarized using the " + c.measure + ", and a " + c.model + " meta-analysis was performed; heterogeneity was quantified with I² and τ². Risk of bias was assessed using " + c.rob + ", and certainty of evidence using GRADE.";
    if (len !== "concise") synth += " Between-study variance (τ²) was estimated using a random-effects (DerSimonian–Laird) model, and a prediction interval was calculated when at least three studies contributed.";
    if (len === "detailed") synth += " Prespecified sensitivity analyses (such as leave-one-out and fixed-effect re-analysis) and small-study-effect checks (a funnel plot, with Egger's test where at least 10 studies contributed) may be reported. Analyses were performed in the RapidMeta browser engine (validated against R’s metafor). <em class=\"confirm-note no-clean-pdf\">(These statistical details follow common defaults — please confirm they match the settings you actually used, and delete any analysis you did not run.)</em>";
    if (j === "jama") { // structured subheadings
      paras.push({ label: "Data Sources", text: search });
      paras.push({ label: "Study Selection", text: pico });
      paras.push({ label: "Data Extraction and Synthesis", text: synth });
    } else {
      paras.push({ text: pico }); paras.push({ text: search }); paras.push({ text: synth });
    }
    return paras;
  }

  function resultsPrimaryProse() {
    var c = ctx(), len = PS.state.style.resultsLength;
    var t = "The pooled " + c.measure + " for " + c.out + " was " + c.est + " (" + c.lci + " to " + c.uci + ", " + c.cl + "% CI).";
    if (len !== "concise") t += " " + c.k + " studies (" + c.n + " participants) contributed, and statistical heterogeneity was I² = " + c.i2 + "%.";
    if (len === "detailed") t += " The certainty of evidence (GRADE) for this outcome was " + c.certainty + ".";
    return t;
  }
  function abstractResultsProse() {
    var c = ctx(), len = PS.state.style.resultsLength;
    var t = "The combined " + c.measure + " was " + c.est + " (" + c.lci + " to " + c.uci + ", " + c.cl + "% CI), I² = " + c.i2 + "%. Certainty of evidence (GRADE): " + c.certainty + ".";
    if (len === "detailed") t = "Across " + c.k + " studies (" + c.n + " participants), the combined " + c.measure + " was " + c.est + " (" + c.lci + " to " + c.uci + ", " + c.cl + "% CI), with I² = " + c.i2 + "% heterogeneity and " + c.certainty + " GRADE certainty.";
    return t;
  }

  PS.render = function () {
    var a = PS.state.analysis, p = PS.state.pico;
    var emEst = (a.effectMeasure ? a.effectMeasure + " " : "") + auto("analysis.effectEstimate");
    var ciTxt = auto("analysis.ciLower") + " to " + auto("analysis.ciUpper") + " (" + auto("analysis.confLevel", "95") + "% CI)";
    var html = "";

    html += onboardingCard();
    html += glossaryCard();

    /* title block + cover */
    html += '<section class="paper-title-block">';
    html += '<p class="paper-kicker">Short Evidence Paper</p>';
    html += '<div class="student-task-label no-clean-pdf">Title (15–20 words)</div>';
    html += helper("Click the highlighted title to edit it. A strong title says <em>what</em> was studied, <em>in whom</em>, and <em>how</em> (a meta-analysis). Words in [square brackets] are placeholders — replace each one with the real intervention or condition from your analysis.");
    html += '<h1>' + inlineBox("studentText.title", (auto("pico.intervention", "[intervention]")) + " for " + auto("pico.population", "[condition]") + ": a short systematic review and meta-analysis") + '</h1>';
    html += exampleBtn("studentText.title", "The intervention for this condition: a short systematic review and meta-analysis");

    html += '<div class="cover-summary-card">';
    html += '<p><strong>Clinical question.</strong> In ' + auto("pico.population", "[population]") + ', does ' + auto("pico.intervention", "[intervention]") +
      ' compared with ' + auto("pico.comparator", "[comparator]") + ' improve ' + auto("pico.primaryOutcome", "[primary outcome]") + '?</p>';
    html += '<p><strong>Main finding.</strong> ' + box("studentText.coverFinding", "Your one-sentence headline", "After combining the studies, the overall result suggests...", "1 sentence",
      "In one plain sentence, say what the study found and how sure we are. Match the verb to your GRADE certainty: High = “reduces”, Moderate = “probably reduces”, Low = “may reduce”, Very low = “the evidence is very uncertain about whether it reduces”. Avoid the word “proves”.",
      "After combining the studies, the overall result suggests the intervention may improve this outcome, though how sure we can be depends on the certainty of the evidence.") + '</p>';
    html += helper("The “pooled estimate” (or “combined result”) is the single result you get after combining all the studies together. " + learnChip("pooling"));
    html += '<p><strong>Evidence base.</strong> ' + auto("analysis.kStudies") + ' studies · ' + auto("analysis.totalParticipants") + ' participants · ' + esc(a.model) + ' meta-analysis</p>';
    html += '<p><strong>Primary result.</strong> ' + esc(emEst) + ', ' + ciTxt + ' ' + learnChip("confidence_interval") + '</p>';
    html += '<p><strong>Heterogeneity.</strong> I² = ' + auto("analysis.i2") + '%' + (a.tau2 ? ' · τ² = ' + esc(a.tau2) : '') + ' ' + learnChip("heterogeneity") + '</p>';
    html += '<p><strong>Certainty.</strong> ' + auto("analysis.certainty", "(complete from GRADE)") + ' ' + learnChip("grade") + '</p>';
    html += '</div>';
    html += '<div class="evidence-summary-card"><div class="student-task-label no-clean-pdf">Evidence chips (auto)</div>' + PS.renderChips() + '</div>';
    html += helper("Everything in <strong>grey</strong> above is filled in automatically from your analysis — you do not edit it (to change it, edit your analysis, not the paper). You write the <strong>yellow</strong> boxes.");
    html += '</section>';

    /* abstract */
    html += '<h2>Abstract</h2>';
    html += helper("The abstract is a short summary (about 150 words) of the whole paper. Write it <em>last</em>: the Methods and Results sentences here are already filled from your analysis; you add the Background and the Conclusion.");
    html += box("studentText.abstractBackground", "Background", "[Condition] is important because...", "~2-3 sentences",
      "One or two sentences on why this health problem matters — who it affects and what can go wrong for these patients.",
      "This condition affects many people and can lead to serious harm over time. Current treatments help some patients, but important questions about benefit remain, which is why this question matters.");
    html += example("Chronic kidney disease in adults with type 2 diabetes is common and progressive; many patients develop heart failure or die from cardiovascular causes despite standard care.",
      "This disease is very common and serious.");
    html += box("studentText.abstractObjective", "Objective", "This short review aimed to assess whether...", "1 sentence",
      "State the question in one sentence: did the intervention help, for this outcome, in this population?",
      "This short review aimed to assess whether the intervention improves the main outcome compared with the comparator in this population.");
    html += example("We assessed whether finerenone reduces cardiovascular events compared with placebo in adults with CKD and type 2 diabetes.",
      "We looked at whether the drug works.");
    html += '<p><strong>Methods.</strong> A rapid systematic review and ' + esc(a.model).toLowerCase() +
      ' meta-analysis combined ' + auto("analysis.kStudies") + ' studies (' + auto("analysis.totalParticipants") + ' participants) for ' + auto("pico.primaryOutcome", "the primary outcome") + '.</p>';
    html += '<p><strong>Results.</strong> ' + abstractResultsProse() + '</p>';
    html += box("studentText.abstractConclusion", "Conclusion", "In patients with... the findings suggest... however this should be interpreted cautiously because...", "~2-3 sentences",
      "Answer your question in 1–2 sentences, then add a caution. Match the verb to your GRADE certainty and avoid “proves”.",
      "Taken together, the findings suggest the intervention may offer a modest benefit for this outcome. This should be read with caution because the certainty of the evidence is limited and only a small number of studies contributed.");
    html += example("In adults with CKD and type 2 diabetes, finerenone probably reduces cardiovascular events by a modest amount; certainty is moderate, so the size of the benefit remains uncertain.",
      "Finerenone works and reduces heart problems.");

    /* introduction */
    html += '<h2>Introduction</h2>';
    html += helper("The introduction answers “why does this question matter?” Three short paragraphs: the problem, the intervention, and why combining studies helps. Write for a reader who knows medicine but not this exact topic.");
    html += box("studentText.introductionClinicalProblem", "Why this condition matters", "[Condition] is clinically important because... Patients with [condition] are at risk of...", "~3-4 sentences",
      "Describe the condition and its consequences. Use the population shown in the clinical question above.",
      "This condition is clinically important because it is common and tends to worsen over time. Patients affected by it are at risk of serious complications, and their quality of life can decline. Even with current standard treatment, many still experience poor outcomes. This combination of high risk and limited options is what makes better treatment worthwhile and is the reason this review question matters.");
    html += example("Chronic kidney disease in adults with type 2 diabetes is common and tends to get worse over time. Even when patients take the usual treatments, many still go on to develop heart failure or die from cardiovascular causes, and their kidney function keeps declining. This combination of high risk and limited options is why better treatments are needed and why this question matters.",
      "CKD is a serious disease that affects many people.");
    html += box("studentText.introductionInterventionRationale", "Why this intervention might help", auto("pico.intervention", "[Intervention]") + " may improve outcomes by... However, uncertainty remained because...", "~2-3 sentences",
      "Say how the treatment could work, then note what was still unknown before this review.",
      "The intervention may improve outcomes by acting on a mechanism relevant to this condition. Before this review, however, it was unclear how large and how reliable that benefit was across different patients.");
    html += example("Finerenone blocks mineralocorticoid receptors, which may reduce the inflammation and scarring that drive heart and kidney damage; how much that helps across trials was unclear before this review.",
      "The drug might help the heart.");
    html += box("studentText.introductionWhyReviewNeeded", "Why combining studies is useful here", "Combining studies is useful here because... Therefore, this short paper asks whether...", "~2-3 sentences",
      "Explain that combining trials gives a more precise answer than any single trial, then state your question.",
      "Combining the available studies is useful here because each single study on its own is too small to give a precise answer. Pooling them gives a clearer estimate, so this short paper asks whether the intervention improves the main outcome.");
    html += example("No single trial was large enough to settle the question precisely, so pooling the major trials gives a more reliable estimate of whether the drug helps.",
      "Combining studies is useful and important.");

    /* methods */
    html += '<h2>Methods</h2>';
    html += styleControl();
    html += helper("This section is written for you from your analysis. Use the <strong>format selector</strong> above to make it longer or match a journal’s style — it changes only the grey auto-text. A <em>rapid review</em> is a faster, lighter systematic review. You add the eligibility criteria and one honest limitation; the τ² estimator and confidence-interval method are stated for you in the longer formats.");
    // Eligibility is STUDENT-stated, not asserted by the tool (it cannot know your actual design).
    html += '<p><strong>Eligibility.</strong> ' + box("studentText.methodsEligibility", "Eligibility criteria",
      "We included [study design] of " + auto("pico.intervention", "[intervention]") + " versus " + auto("pico.comparator", "[comparator]") + " in " + auto("pico.population", "[population]") + " reporting " + auto("pico.primaryOutcome", "[primary outcome]") + ". We excluded...", "1-2 sentences",
      "State the ACTUAL study designs you included and your main inclusion/exclusion rules — do not leave the default if it is not what you did. The tool cannot know this for you.",
      "We included randomised controlled trials comparing the intervention with the comparator in this population and reporting the main outcome. We excluded studies that were not randomised or did not report the outcome of interest.") + '</p>';
    html += example("We included randomised controlled trials of finerenone versus placebo in adults with CKD and type 2 diabetes that reported cardiovascular events; we excluded non-randomised studies and trials without that outcome.",
      "We included all the relevant studies about the drug.");
    methodsProse().forEach(function (par) { html += '<p>' + (par.label ? '<strong>' + esc(par.label) + '.</strong> ' : '') + par.text + '</p>'; });
    html += box("studentText.methodsStudentLimitation", "One limitation of this rapid workflow", "One limitation of this rapid workflow is...", "1-2 sentences",
      "Name one shortcut a rapid review takes (e.g. fewer databases, faster screening) and say how it could affect the result.",
      "One limitation of this rapid workflow is that the search covered fewer databases than a full systematic review, so a relevant study could have been missed, which may affect the result.");

    /* results */
    html += '<h2>Results</h2>';
    html += helper("Results = <em>what you found</em>, not what it means (that comes in the Discussion). Each figure has a “Caption / interpretation” line right below it — describe what the reader is looking at, plainly.");
    html += renderOutcomeManager();

    html += '<h3>Study selection</h3>';
    html += helper("The PRISMA diagram shows how you went from all search hits down to the included studies. In the caption, give the key numbers.");
    html += figureCard(1, "Study selection flow diagram", ["prisma"], "prismaPaperSlot", "figures.prisma.caption",
      "This figure shows that ___ records were identified, ___ full texts were assessed, and ___ studies were included.");

    html += '<h3>Included studies</h3>';
    html += figureCard(2, "Characteristics of included studies", [], "studyTablePaperSlot", "figures.studyCharacteristics.caption",
      "The included studies were similar because... The most important difference was... This matters because...");

    html += '<h3>Primary outcome</h3>';
    html += helper("This sentence states the pooled result (already filled). Below the forest plot, write what it <em>means</em>: which way it points, how precise it is, and whether the size matters clinically.");
    html += '<p>' + resultsPrimaryProse() + '</p>';
    if (a.droppedStudies) html += '<div class="dropped-warning">⚠️ <strong>' + a.droppedStudies + ' included study(ies) were not combined in the meta-analysis</strong>' +
      (a.droppedNames ? ' (' + esc(a.droppedNames) + ')' : '') + '. The pooled estimate above is based on ' + auto("analysis.kStudies") + ' studies only. The others appear in your review but could not be pooled numerically — most often because their event counts were not extracted (only a hazard ratio is available). Extract their event counts (or pool by hazard ratio), or state clearly in the paper that these studies were not included in the pooled estimate.</div>';
    html += figureCard(3, "Forest plot for the primary outcome", ["forest_plot", "confidence_interval", "effect_size"], "forestPlotPaperSlot", "figures.forestPlot.caption",
      "The overall result points toward... The confidence interval (the range of likely true effects) is narrow/wide, which means... The size of the effect is / is not large enough to matter because...");
    html += box("studentText.forestInterpretation", "Interpret the forest plot", "The overall result points toward... The confidence interval means... This result is / is not clinically important because...", "~3-4 sentences",
      "Cover three separate things. (1) Direction: which treatment looks better? (2) Precision: is the confidence interval narrow (confident) or wide (uncertain)? A confidence interval is the range of effects compatible with your data; whether it crosses the no-effect line (1 for ratios, 0 for differences) is about direction, not precision. (3) Size: even if the effect is real, is it big enough to change care? New to forest plots? Click “What is a forest plot?” above.",
      "The pooled result points toward one of the two groups rather than showing no difference. Because the confidence interval is fairly narrow, the estimate is reasonably precise. Whether an effect of this size is large enough to change care depends on the outcome, so it should be judged against what matters clinically.");
    html += example("The overall result favoured finerenone: its confidence interval stayed entirely below 1 (the no-effect line for a ratio), so a benefit in this direction is statistically supported. The interval was also fairly narrow, which means the result is reasonably precise. Given the moderate GRADE certainty, a reduction of this size would probably be worthwhile for high-risk patients, although the exact size is uncertain.",
      "The result was significant and shows the drug works.");
    html += '<div class="section-example no-clean-pdf"><span class="ex-good">✓ If your CI crosses the line:</span> The estimate pointed toward the intervention, but the confidence interval crossed the no-effect line, so the data are also compatible with no real difference; the result is uncertain rather than clearly positive.</div>';
    html += helper("“How big is clinically big?” — there is no universal threshold for whether an effect matters in practice. If you are not sure, it is completely fine to say the size is uncertain and to flag it for your supervisor; saying so is good scientific judgement, not a weakness. " + learnChip("clinical_importance"));
    html += story("A merchant weighs a sack of grain just once and announces its worth. A wiser one weighs it many times, takes the average, and notes how far the readings spread. The average is your pooled estimate; the spread is your confidence interval. A narrow spread: speak with some confidence. A wide spread: speak softly. And weighing carefully tells you the weight — not whether the grain is worth buying. That last question — is it worth it? — is yours to judge.");
    html += caseStudy("when more data flipped the answer",
      "A wide confidence interval is a warning, not a verdict. Before 2004 the smaller studies left it unclear whether steroids helped severe head injury, and many clinicians assumed they did. Then the CRASH trial randomised over 10,000 patients and found steroids actually increased deaths, with a relative risk of about 1.18. A wide, uncertain estimate had been resolved — and the direction reversed. So when your interval is wide, say so, and hold your conclusion loosely until the data are precise.",
      "Until the interval is narrow, hold your conclusion loosely.",
      "CRASH trial, Lancet 2004.");

    html += renderOutcomeSections();   // one section per secondary outcome

    html += '<h3>Heterogeneity</h3>';
    var kNum = Number(a.kStudies);
    html += '<p>Statistical heterogeneity was I² = ' + auto("analysis.i2") + '%' + ((a.tau2 !== "" && a.tau2 != null) ? ', τ² = ' + esc(a.tau2) : '') +
      (a.predictionInterval ? '. The prediction interval was ' + esc(a.predictionInterval) + '.'
        : (isFinite(kNum) && kNum < 3 ? '. A prediction interval was not estimated (k < 3).' : '.')) + '</p>';
    html += '<div class="figure-learning-row no-clean-pdf"><button type="button" data-learn="heterogeneity" aria-haspopup="dialog">What is heterogeneity?</button>' +
      (a.predictionInterval ? '<button type="button" data-learn="prediction_interval" aria-haspopup="dialog">What is a prediction interval?</button>' : '') + '</div>';
    html += helper("Heterogeneity = how much the studies’ results differ beyond chance. I² estimates the share of that variation that is real difference rather than chance: a high I² means results vary a lot; a low or 0% I² is consistent with agreement, but with only a few studies it can simply mean there were too few to detect a difference — so do not state it as proof the studies agree. τ² is the actual spread of true effects between studies; look at it and the prediction interval too.");
    html += box("studentText.heterogeneityInterpretation", "Interpret the heterogeneity", "The studies’ results varied a little / a lot, which suggests... Combining them still makes sense / is questionable because...", "~2-3 sentences",
      "Is the I² low, moderate or high? If high, why might the studies differ (different patients, doses, follow-up)? Is combining them still reasonable? Remember a low I² with few studies is not proof of agreement.",
      "The results across the studies varied only a little, which suggests they are broadly consistent. With only a few studies this agreement should be read cautiously rather than as proof, but combining them still seems reasonable.");
    html += example("I² was low and τ² close to zero, so the three trials gave broadly consistent results; with only three studies this agreement should be read cautiously rather than as proof.",
      "There was no heterogeneity so the studies all agree.");
    html += story("A traveller crossing a wide land does not trust a single well. She drinks from many. If every well runs sweet, she grows confident the water is good. If some run sweet and some run bitter, she asks why — different ground, different depth — before she trusts any. Your studies are the wells. Agreement across many is reassuring; disagreement is a question to answer, not a flaw to hide. And with only two or three wells, even sweet water proves little — there were simply too few to know.");
    html += caseStudy("when many small trials agreed — and one big trial did not",
      "Should you trust a benefit that keeps appearing across several small trials? In the early 1990s, small trials and an early meta-analysis suggested magnesium lowered deaths after a heart attack. Then one very large, carefully run trial, ISIS-4, enrolled 58,050 patients — and found no benefit at all. The hopeful pattern in the small studies had not survived. For you: a signal repeated across small trials is a question, not an answer, and heterogeneity together with study size tells you how much to trust it.",
      "One large, careful trial can outweigh many small, hopeful ones.",
      "ISIS-4, Lancet 1995; Egger & Davey Smith, BMJ 1995.");

    html += '<h3>Risk of bias</h3>';
    html += helper("Risk of bias asks whether the way a study was run could have distorted its result — separate from whether the study is “good”. Link each concern to <em>how</em> it could change the answer.");
    html += figureCard(4, "Risk-of-bias summary", ["risk_of_bias"], "robPaperSlot", "figures.riskOfBias.caption",
      "The main risk to trustworthiness is... This could affect the result because... Overall, the risk of bias appears...");

    html += '<h3>Certainty of evidence</h3>';
    html += helper("GRADE certainty (High → Moderate → Low → Very low) is how confident we are that the true effect is close to this estimate. It is <em>not</em> the size of the effect. Explain the rating and why it was downgraded.");
    html += figureCard(5, "GRADE summary of findings", ["grade"], "gradePaperSlot", "figures.gradeTable.caption",
      "The certainty of evidence was judged as ___. It was downgraded mainly for ___ (risk of bias / inconsistency / indirectness / imprecision / publication bias) because ___.");
    html += box("studentText.certaintyInterpretation", "Interpret the certainty", "The certainty of evidence was rated as... This was mainly because... This affects how strongly I can word the conclusion because...", "~2-3 sentences",
      "State the GRADE rating, the main reason(s) it is not “High” (one of the five GRADE domains), and what that means for how strongly you can word your conclusion.",
      "The certainty of evidence was rated below the highest level, mainly because of limitations such as the small number of studies or imprecision. This means the conclusion should be worded carefully rather than definitively.");
    html += example("Certainty was Moderate, downgraded for imprecision because only three small trials contributed; the conclusion is therefore worded cautiously rather than definitively.",
      "The evidence was good quality.");
    html += story("Two maps lie before you, both pointing the same way. One was drawn by many careful surveyors who walked every mile; the other sketched in haste by a single hand. You might follow either — but you would trust the careful map further, and you would say so out loud. GRADE certainty is how carefully the map was drawn. It is not where the road leads (that is the effect); it is how much to trust the drawing. Match the strength of your words to the strength of your map.");

    html += '<h3>Are small studies missing? (publication bias — optional)</h3>';
    html += helper("Optional. A funnel plot explores whether small studies are missing, which can be a sign of publication bias — but an uneven (asymmetric) funnel can also come from real differences between studies or from chance, and the plot is unreliable with fewer than about 10 studies. With few studies, describe what you see but do not conclude there is publication bias.");
    html += figureCard(6, "Funnel plot", ["funnel_plot"], "funnelPaperSlot", "figures.funnelPlot.caption",
      "The funnel plot suggests... However, funnel plots are difficult to interpret when...");
    html += caseStudy("the studies that were never published",
      "If only the flattering studies get published, what happens to a meta-analysis? Researchers obtained all 74 antidepressant trials registered with the US drug regulator (the FDA). Almost every positive trial was published; most negative ones were not, or were written up to look positive. When the missing trials were put back in, the apparent benefit shrank by about a third. That gap between what was run and what you can see is exactly what a funnel plot is trying to expose.",
      "The studies you cannot see can change the answer.",
      "Turner et al., New England Journal of Medicine 2008;358:252-260.");

    /* discussion */
    html += '<h2>Discussion</h2>';
    html += helper("The discussion is where you say what it all <em>means</em>. Work through it in order: (1) the main finding, (2) why it matters, (3) how it fits other evidence, (4) strengths, (5) limitations, (6) a careful conclusion. One short paragraph each.");
    html += box("studentText.discussionPrincipalFinding", "Main finding", "The main finding of this short review is...", "1-2 sentences",
      "Restate your main result in plain words — no statistics needed here.",
      "The main finding of this short review is that the intervention appears to affect the outcome in one direction, though the size of that effect should be read alongside how certain the evidence is.");
    html += example("Across the pooled trials, finerenone was associated with fewer cardiovascular events than placebo — a modest but consistent benefit.",
      "The drug works for heart problems.");
    html += box("studentText.discussionClinicalMeaning", "Clinical meaning", "This would matter clinically if... For a doctor or patient it would / might / would not change practice because...", "~2-3 sentences",
      "This matters only if the effect is real and big enough. Look at the estimate AND the certainty, then say whether it would change what a doctor or patient does.",
      "This would matter clinically only if the effect is both real and large enough to notice. Considering the estimate together with the certainty, it may or may not be enough to change what a doctor or patient decides.");
    html += example("If the benefit is real, preventing cardiovascular events in such high-risk patients would matter to doctors and patients; but the moderate certainty means it should inform practice rather than dictate it.",
      "This could be useful for patients.");
    html += box("studentText.discussionComparison", "Comparison with other evidence", "These findings are consistent with / differ from...", "1-2 sentences",
      "Do your results agree with guidelines or other reviews you know of? Say so.",
      "These findings appear broadly consistent with what other reviews and guidelines report, although direct comparison is limited by differences in the patients and outcomes studied.");
    html += example("These results agree with the direction of the individual trial reports and current guideline signals for this drug class.",
      "Other studies found similar things.");
    html += box("studentText.discussionTransportability", "Who the result applies to (generalisability / transportability)", "The pooled effect applies most directly to patients like those in the trials... In a real-world population that is more/less... the effect might be...", "~2-3 sentences",
      "Use the Transportability panel in the Analysis tab. First say how representative the trials are of the real-world patients you care about (the representativeness map: age, sex, BMI, diabetes, etc.). Then, IF you set an effect-modifier slope, report the transported estimate as a SENSITIVITY analysis — never as the primary real-world effect. Be explicit that without individual patient data this is an external-validity check, not a definitive real-world number.",
      "The pooled effect applies most directly to patients similar to those enrolled in the trials. The representativeness map shows the trials were broadly similar to the target population on age, sex and BMI, but under-represented people with diabetes. As a labelled sensitivity analysis, transporting the effect to a more diabetic real-world population shifted it modestly in the expected direction; because this rests on aggregate (not individual-patient) data, it is an external-validity check rather than a definitive real-world estimate.");
    html += example("The trials were reasonably representative of the target population on age, sex and BMI but enrolled fewer people with diabetes; a labelled transportability sensitivity analysis shifted the pooled effect by only a small amount toward a more diabetic population, so the headline result is likely to generalise, with that caveat.",
      "The result applies to everyone.");
    html += box("studentText.discussionStrengths", "Strengths", "A strength of this review is...", "1-2 sentences",
      "What did this review do well — e.g. combining all major trials, large total sample, consistent results?",
      "A strength of this review is that it brings together the main available trials into a single estimate, giving a clearer overall picture than any one study alone.");
    html += example("A strength is that the review pools the major randomised trials into one estimate, giving more precision than any single trial alone.",
      "This review has several strengths.");
    html += box("studentText.discussionLimitations", "Main limitation", "The main limitation is...", "~3-4 sentences",
      "Be honest about the biggest weakness (few studies, risk of bias, short follow-up, indirect population) and how it affects trust in the result.",
      "The main limitation is that only a small number of trials contributed, so the pooled estimate is imprecise and the confidence interval is fairly wide. The included trials may also differ from everyday patients in important ways, which limits how widely the result applies. Finally, as a rapid review the search was lighter than a full systematic review, so a relevant study could have been missed.");
    html += example("The main limitation is that only three trials contributed, so the pooled estimate is imprecise (a fairly wide confidence interval), and this is one reason the certainty of evidence was rated moderate rather than high. The included trials also enrolled relatively few patients with advanced kidney disease, so the finding may not apply well to that group. Finally, as a rapid review, the search was lighter than a full systematic review, so a relevant study could have been missed.",
      "This study has some limitations like all studies do.");
    html += box("studentText.discussionConclusion", "Balanced conclusion", "The safest interpretation is... Future research should...", "~2-3 sentences",
      "Answer the question without overclaiming, matched to your certainty rating, then suggest one useful next study. Avoid “proves” and “definitely”.",
      "The safest interpretation is that the intervention may improve the outcome by a modest amount, but the certainty of the evidence means this is not definitive. The result is most applicable to patients similar to those in the included trials. A larger, well-conducted trial would help confirm whether the benefit holds.");
    html += example("In adults with chronic kidney disease and type 2 diabetes, finerenone probably reduces cardiovascular events by a modest amount compared with placebo, although the certainty of evidence is moderate and the exact size of the benefit remains uncertain. The findings are most applicable to high-risk patients like those in the included trials. A larger trial focusing on people with advanced kidney disease would help confirm whether the benefit holds in that group.",
      "Finerenone works and should be given to all patients.");
    html += story("A witness stands before the court. She is asked only one thing: what did you see? Not what you hoped, not what would please the room — what you saw, and how clearly. If the light was dim, she says so. Your conclusion is your testimony. Report what the evidence shows and how clearly you saw it. “Probably reduces, with moderate certainty” is the testimony of an honest witness. “Proves it works for everyone” is the testimony of one who has already left the room.");

    /* reflection (working only) */
    html += '<h2 class="no-clean-pdf">Reflection (learning log)</h2>';
    html += '<div class="no-clean-pdf">';
    html += helper("This part is for your learning, not the final paper (it stays out of the Clean PDF). You cannot get this part wrong — just answer honestly. Reflecting like this is how you build judgement.");
    html += box("studentText.reflectionLearning", "The most important thing I learned", "The most important thing I learned was...", "1-2 sentences",
      "Write one thing you understand now that you did not before you started.",
      "The most important thing I learned was how much the certainty of the evidence matters, not just the size of the effect, when deciding how strongly to state a conclusion.");
    html += example("I learned that the certainty rating, not just the effect size, decides how strongly I can word a conclusion.",
      "I learned a lot about meta-analysis.");
    html += box("studentText.reflectionMostTrusted", "The evidence I trust most", "The part of the evidence I trust most is...", "1-2 sentences",
      "Name the part of your evidence you believe most, and say why (e.g. many studies, consistent results, low risk of bias).",
      "The part of the evidence I trust most is the pooled estimate for the main outcome, because it draws on the largest trials and their results pointed in a similar direction.");
    html += example("I trust the pooled primary-outcome estimate most, because it draws on the largest trials and they pointed the same way.",
      "I trust the results.");
    html += box("studentText.reflectionLeastConfident", "Where I am least confident", "The part I am least confident about is...", "1-2 sentences",
      "Naming what you are unsure about is a sign of good scientific judgement — it is required, and it is one of the most valuable lines you will write.",
      "The part I am least confident about is whether the result applies to patients who were underrepresented in the trials, because there were few of them and the follow-up was relatively short.");
    html += example("I am least sure whether the benefit holds in people with advanced kidney disease, because few such patients were included and follow-up was short.",
      "I am not confident about some parts of this.");
    html += '</div>';

    /* author transparency (on-screen coaching, working PDF only) */
    html += '<div class="author-transparency working-only no-clean-pdf">' +
      '<strong>Authorship transparency.</strong> Generated from RapidMeta: search summary, methods skeleton, effect estimates, heterogeneity statistics, figures and tables. ' +
      'Student-authored: introduction, figure captions, clinical interpretation, limitations, discussion, and the final conclusion.</div>';

    /* Disclosures — these stay in the Clean PDF (the submittable artifact) */
    html += '<h2>Disclosures</h2>';
    html += helper("These statements stay in the final PDF — journals and integrity policies require them. The first two are written for you; complete funding, competing interests and registration.");
    html += '<p><strong>Use of automated tools.</strong> The structured numerical results, the Methods and Results summary text, the figures, the GRADE certainty summary, and the reference identifiers were generated automatically by the RapidMeta Evidence Paper Studio from the author’s own meta-analysis. The introduction, figure captions, all interpretation, the discussion and the conclusions are the author’s own work. Because the auto-generated sections come from a shared template, their wording may be similar to other papers produced with the same tool.</p>';
    html += '<p><strong>Data availability and provenance.</strong> The analysis was based on data the author extracted from the included trials. Sources searched: ' + esc(PS.state.search.databases || "(state databases)") + (PS.state.search.searchDate ? ', last searched ' + esc(PS.state.search.searchDate) : '') + '. Underlying trial data and the analysis project are available from the author on request.</p>';
    html += '<p><strong>Protocol and registration.</strong> ' + box("studentText.registration", "Protocol / registration", "This review was registered as... / This review was not registered.", "1 sentence", "State the registration (e.g. PROSPERO number) or say it was not registered.",
      "This review was not formally registered before it was carried out.") + '</p>';
    html += '<p class="protocol-link-row"><strong>Protocol link.</strong> ' +
      box("studentText.protocolLink", "Protocol link (optional)", "https://… link to your timestamped or registered protocol", null,
        "If your protocol is published online (for example a timestamped GitHub Pages page, an OSF record, or a PROSPERO registration), paste its web address here so readers can open and verify it. RapidMeta fills this in automatically when it knows the published address.") +
      '<a class="protocol-open no-clean-pdf" id="protocolOpenLink" target="_blank" rel="noopener noreferrer" hidden>↗ Open protocol page</a></p>';
    html += '<p><strong>Funding.</strong> ' + box("studentText.funding", "Funding", "This work received no specific funding. / Funded by...", "1 sentence", "Name any funding source, or state there was none.",
      "This work received no specific funding from any agency.") + '</p>';
    html += '<p><strong>Competing interests.</strong> ' + box("studentText.coi", "Competing interests", "The author declares no competing interests. / The author declares...", "1 sentence", "Declare any competing interests, or state there are none.",
      "The author declares no competing interests.") + '</p>';

    /* references */
    html += '<h2>References</h2>';
    html += helper("List the studies you included. The button below builds them for you from your trials’ stored IDs — then check each one. Number them and keep one per line.");
    html += '<div class="refs-build-row no-clean-pdf">' +
      '<button type="button" data-action="build-refs">Build references from included studies</button>' +
      '<span class="refs-note">These references are a <strong>draft</strong> assembled from data stored in your analysis, and can be incomplete or wrong. ' +
      'Open each PMID/DOI on PubMed or Crossref and confirm the title, authors, journal and year match that paper before submission — a reference that looks complete is not the same as a correct one.</span></div>';
    html += box("studentText.references", "References (one per line; edit freely)", "1. Author. Title. Journal. Year. PMID: …", null,
      "After clicking the button, check each line against PubMed/Crossref and fix anything that does not match.");

    var canvas = document.getElementById("paperCanvas");
    if (canvas) canvas.innerHTML = html;
    PS.updateProtocolLink();
    PS.buildWizard();
  };

  // Show a clickable "Open protocol page" link only when the field holds a real http(s) URL.
  PS.updateProtocolLink = function () {
    var a = document.getElementById("protocolOpenLink");
    if (!a) return;
    var el = document.querySelector('#paperCanvas [data-field="studentText.protocolLink"]');
    var url = (el ? (el.innerText || "") : (getNested(PS.state, "studentText.protocolLink") || "")).trim();
    if (/^https?:\/\/\S+$/i.test(url)) { a.href = url; a.hidden = false; }
    else { a.removeAttribute("href"); a.hidden = true; }
  };

  /* ---------------- references (deterministic; never LLM-generated) ---------------- */
  // Studies the student marked include (confirmed screen decision wins over status).
  function includedTrials() {
    var RM = window.RapidMeta;
    if (!RM || !RM.state || !RM.state.trials) return [];
    return RM.state.trials.filter(function (t) {
      var sr = t.screenReview;
      if (sr && sr.confirmed && /^(include|exclude)$/.test(String(sr.decision))) return sr.decision === "include";
      return String(t.status || "").toLowerCase() === "include";
    });
  }
  function stripDot(s) { return String(s || "").trim().replace(/\.+$/, ""); }
  // Vancouver-ish line assembled ONLY from fields present on the trial object.
  // Absent fields are omitted — never fabricated (no invented journal/volume/author).
  function citationLine(t, RM) {
    var acr = (RM.nctAcronyms && RM.nctAcronyms[t.id]) || "";
    var title = stripDot(t.title || (t.data && t.data.name) || ""); // stored only — never fabricated
    var parts = [];
    if (t.authors && t.authors.trim()) parts.push(stripDot(t.authors) + ".");
    if (title) parts.push(title + ".");
    if (t.journal && t.journal.trim()) parts.push(stripDot(t.journal) + ".");
    if (t.year) parts.push(t.year + ".");
    var ids = [];
    if (acr && acr !== title) ids.push(acr);   // avoid repeating when title already is the acronym
    if (/^NCT\d+/i.test(t.id)) ids.push(t.id);
    if (t.pmid) ids.push("PMID: " + t.pmid);
    if (t.doi) ids.push("doi:" + String(t.doi).replace(/^doi:/i, ""));
    if (ids.length) parts.push(ids.join(". ") + ".");
    return parts.join(" ").trim();
  }
  PS.buildReferences = function () {
    var RM = window.RapidMeta;
    var trials = includedTrials();
    if (!trials.length) { PS.toast("No included studies found — include studies in Screening first."); return; }
    var existing = (PS.getField("studentText.references") || "").trim();
    if (existing && !window.confirm("Replace the current references with " + trials.length + " auto-assembled from your included studies? (You can still edit them.)")) return;
    trials = trials.slice().sort(function (a, b) { return (Number(a.year) || 0) - (Number(b.year) || 0); });
    var lines = trials.map(function (t, i) { return (i + 1) + ". " + citationLine(t, RM); });
    var text = lines.join("\n");
    setNested(PS.state, "studentText.references", text);
    var el = document.querySelector('#paperCanvas [data-field="studentText.references"]');
    if (el) el.innerText = text;
    PS.save(); PS.updateChecklist();
    PS.toast(trials.length + " reference(s) built from included studies — verify each PMID/DOI.");
  };

  /* ---------------- figures ---------------- */
  function missingHTML(msg) {
    return '<div class="missing-visual no-print">' + esc(msg || "Plot not available yet. Open the Analysis Suite and Scientific Output tabs once, then click “Refresh figures”.") + '</div>';
  }

  PS.cloneVisual = function (srcSel, targetSel, figKey, width, height) {
    var src = document.querySelector(srcSel);
    var tgt = document.querySelector(targetSel);
    if (!tgt) return false;
    var hasContent = src && (src.children.length > 0 || (src.innerText || "").trim().length > 0);
    if (!hasContent) { tgt.innerHTML = missingHTML(); markFig(figKey, false); return false; }

    // Plotly graph div → render to a sized PNG (robust even if the source tab is hidden).
    var isPlotly = window.Plotly && (src.classList.contains("js-plotly-plot") || src.querySelector(".js-plotly-plot, svg.main-svg"));
    if (isPlotly) {
      var gd = src.classList.contains("js-plotly-plot") ? src : src.querySelector(".js-plotly-plot");
      try {
        window.Plotly.toImage(gd, { format: "png", width: width || 820, height: height || 420, scale: 2 })
          .then(function (url) {
            var img = new Image(); img.src = url; img.className = "paper-plot-image"; img.alt = "Meta-analysis figure";
            tgt.innerHTML = ""; tgt.appendChild(img); markFig(figKey, true);
          })
          .catch(function () { fallbackClone(src, tgt, figKey); });
        return true;
      } catch (e) { return fallbackClone(src, tgt, figKey); }
    }
    return fallbackClone(src, tgt, figKey);
  };

  function fallbackClone(src, tgt, figKey) {
    var clone = src.cloneNode(true);
    clone.querySelectorAll("button, input, select, .no-paper").forEach(function (el) { el.remove(); });
    clone.removeAttribute("id");
    tgt.innerHTML = ""; tgt.appendChild(clone); markFig(figKey, true);
    return true;
  }

  function markFig(key, available) {
    if (key && PS.state.figures[key]) { PS.state.figures[key].available = !!available; }
  }

  function nonEmpty(sel) { var e = document.querySelector(sel); return e && (e.children.length > 0 || (e.innerText || "").trim().length > 0); }

  // ---- our own forest/funnel (legible, with prediction interval + x-range) ----
  var FIGMAP = { forest: "forestPlot", funnel: "funnelPlot" };
  function num(v) { var n = Number(v); return (v === "" || v == null || !isFinite(n)) ? null : n; }
  // Registry of mounted figures so x-range + export can address any of them.
  PS._figs = PS._figs || {};

  // Mount a forest/funnel into a slot with an x-range control bar. figState holds
  // the persisted {xMin,xMax}; figId addresses it for controls/export.
  PS.mountFig = function (figId, kind, slotId, res, figState, label) {
    var slot = document.getElementById(slotId);
    if (!slot) return false;
    figState = figState || {};
    var v = function (x) { return (x == null || x === "") ? "" : x; };
    slot.innerHTML =
      '<details class="fig-controls-wrap no-clean-pdf"><summary>Adjust plot ▾ <span class="fig-opt">optional</span></summary>' +
      '<div class="fig-controls">' +
      '<span class="fig-controls-label">X-axis range</span>' +
      '<input type="number" step="any" class="fig-x" data-figid="' + figId + '" data-b="min" placeholder="min" value="' + v(figState.xMin) + '" aria-label="x-axis minimum">' +
      '<input type="number" step="any" class="fig-x" data-figid="' + figId + '" data-b="max" placeholder="max" value="' + v(figState.xMax) + '" aria-label="x-axis maximum">' +
      '<button type="button" data-figaction="apply" data-figid="' + figId + '">Apply</button>' +
      '<button type="button" data-figaction="reset" data-figid="' + figId + '">Auto</button>' +
      '<span class="fig-controls-note">Leave on Auto unless the plot looks squashed.</span>' +
      '</div></details>' +
      '<div class="ps-figbox" id="' + slotId + '-box" data-figid="' + figId + '"></div>';
    var box = document.getElementById(slotId + "-box");
    var ok = (kind === "forest" ? PS.renderForest : PS.renderFunnel)(box, res, { xMin: num(figState.xMin), xMax: num(figState.xMax), label: label });
    PS._figs[figId] = { kind: kind, box: box, res: res, figState: figState, label: label || "" };
    return ok;
  };

  // Back-compat wrapper for the primary forest/funnel (figId === kind).
  PS.renderOwnFig = function (kind, slotId, res, label) {
    if (!res || !(kind === "forest" ? PS.renderForest : PS.renderFunnel)) return false;
    var ok = PS.mountFig(kind, kind, slotId, res, PS.state.figures[FIGMAP[kind]], label);
    markFig(FIGMAP[kind], !!ok);
    return ok;
  };

  // Re-render a figure after its x-range inputs change (Plotly.react updates in place).
  PS.applyFigRange = function (figId, reset) {
    var f = PS._figs[figId]; if (!f) return;
    var fs = f.figState;
    if (reset) { fs.xMin = ""; fs.xMax = ""; }
    else {
      var mn = document.querySelector('.fig-x[data-figid="' + figId + '"][data-b="min"]');
      var mx = document.querySelector('.fig-x[data-figid="' + figId + '"][data-b="max"]');
      fs.xMin = mn ? mn.value : ""; fs.xMax = mx ? mx.value : "";
      if (num(fs.xMin) != null && num(fs.xMax) != null && num(fs.xMin) >= num(fs.xMax)) { PS.toast("X-axis min must be less than max."); return; }
    }
    PS.save();
    (f.kind === "forest" ? PS.renderForest : PS.renderFunnel)(f.box, f.res, { xMin: num(fs.xMin), xMax: num(fs.xMax), label: f.label });
    if (reset) { var a = document.querySelector('.fig-x[data-figid="' + figId + '"][data-b="min"]'), b = document.querySelector('.fig-x[data-figid="' + figId + '"][data-b="max"]'); if (a) a.value = ""; if (b) b.value = ""; }
  };

  /* ---------------- outcomes (write on more than the primary) ---------------- */
  // Build a results-like object for a stored outcome so the figure renderer + auto
  // sentence can treat primary and secondary outcomes uniformly.
  function ocResults(oc) {
    return {
      or: oc.est, lci: oc.lci, uci: oc.uci, i2: oc.i2, k: oc.k, n: oc.n,
      piLCI: (oc.piLo != null && oc.piLo !== "") ? oc.piLo : "--",
      piUCI: (oc.piHi != null && oc.piHi !== "") ? oc.piHi : "--",
      confLevel: 95, isContinuous: !!oc.isContinuous, effectMeasure: oc.measure || "effect",
      plotData: oc.plotData || []
    };
  }
  function ocSentence(oc) {
    var m = oc.measure || "effect", ci = (oc.lci && oc.uci) ? (oc.lci + " to " + oc.uci + ", 95% CI") : "";
    return "For " + esc(oc.label || "this outcome") + ", the pooled " + esc(m) + " was " + esc(oc.est || "—") +
      (ci ? " (" + esc(ci) + ")" : "") + (oc.i2 !== "" && oc.i2 != null ? ", I² = " + esc(oc.i2) + "%" : "") + ".";
  }
  // Demo only: seed 1-2 clearly-labelled ILLUSTRATIVE secondary outcomes so the
  // multi-outcome feature is visible out of the box. Real use starts with none.
  function seedDemoOutcomes() {
    if (PS.state._seededOutcomes) return;
    var intv = ((PS.state.pico && PS.state.pico.intervention) || "").toLowerCase();
    if (intv.indexOf("finerenone") === -1) { PS.state._seededOutcomes = true; return; }
    PS.state._seededOutcomes = true;
    if (PS.state.outcomes.length) return;
    function pd(arr) { return arr.map(function (a, i) { return { id: a[0], logOR: Math.log(a[1]), se: a[2] }; }); }
    PS.state.outcomes.push({
      id: "demo1", label: "All-cause mortality", measure: "RR", isContinuous: false, illustrative: true,
      est: "0.90", lci: "0.80", uci: "1.01", i2: "0.0", k: 3, n: "19,027", piLo: "0.78", piHi: "1.04",
      plotData: pd([["FIDELIO-DKD", 0.89, 0.09], ["FIGARO-DKD", 0.92, 0.08], ["FINEARTS-HF", 0.90, 0.08]])
    });
    PS.state.outcomes.push({
      id: "demo2", label: "Kidney disease progression", measure: "RR", isContinuous: false, illustrative: true,
      est: "0.77", lci: "0.67", uci: "0.88", i2: "24.0", k: 2, n: "13,026", piLo: "", piHi: "",
      plotData: pd([["FIDELIO-DKD", 0.75, 0.08], ["FIGARO-DKD", 0.79, 0.09]])
    });
  }
  PS.seedDemoOutcomes = seedDemoOutcomes;

  function nextOcId() { PS.state._ocSeq = (PS.state._ocSeq || 0) + 1; return "o" + PS.state._ocSeq; }

  PS.addOutcome = function () {
    function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }
    var label = val("ocf-label");
    if (!label) { PS.toast("Give the outcome a name first."); return; }
    var measure = val("ocf-measure") || "effect";
    var oc = {
      id: nextOcId(), label: label, measure: measure,
      isContinuous: /mean difference/i.test(measure),
      est: val("ocf-est"), lci: val("ocf-lci"), uci: val("ocf-uci"),
      i2: val("ocf-i2"), k: val("ocf-k"), n: "", piLo: val("ocf-pilo"), piHi: val("ocf-pihi"),
      plotData: []
    };
    PS.state.outcomes.push(oc);
    PS.save(); PS.render(); PS.embedFigures();
    PS.toast("Added outcome “" + label + "”. Now write its interpretation below.");
    var sec = document.getElementById("outcomeSection_" + oc.id); if (sec) sec.scrollIntoView({ block: "start" });
  };
  PS.removeOutcome = function (id) {
    if (!window.confirm("Remove this outcome section and its writing?")) return;
    PS.state.outcomes = PS.state.outcomes.filter(function (o) { return o.id !== id; });
    delete PS.state.studentText["oc_" + id + "_caption"];
    delete PS.state.studentText["oc_" + id + "_interp"];
    PS.save(); PS.render(); PS.embedFigures();
  };

  // The "Outcomes in this paper" manager card (rendered at the top of Results).
  function renderOutcomeManager() {
    var primary = (PS.state.pico && PS.state.pico.primaryOutcome) || "the primary outcome";
    var rows = '<li><strong>Primary:</strong> ' + esc(primary) + '</li>';
    PS.state.outcomes.forEach(function (oc) {
      rows += '<li><strong>Secondary:</strong> ' + esc(oc.label) + (oc.illustrative ? ' <span class="illus-badge">illustrative demo</span>' : '') +
        ' <button type="button" class="oc-remove" data-action="remove-outcome" data-id="' + oc.id + '">remove</button></li>';
    });
    var measures = ["RR", "OR", "HR", "mean difference", "SMD"].map(function (m) { return '<option>' + m + '</option>'; }).join("");
    return '<div class="outcome-manager no-clean-pdf">' +
      '<h4>Outcomes in this paper</h4>' +
      '<ul class="outcome-list">' + rows + '</ul>' +
      '<details class="add-outcome"><summary>+ Add another outcome</summary>' +
      '<div class="add-outcome-form">' +
      '<label>Name <input id="ocf-label" type="text" placeholder="e.g. All-cause mortality"></label>' +
      '<label>Measure <select id="ocf-measure">' + measures + '</select></label>' +
      '<label>Estimate <input id="ocf-est" type="text" placeholder="0.90"></label>' +
      '<label>CI low <input id="ocf-lci" type="text" placeholder="0.80"></label>' +
      '<label>CI high <input id="ocf-uci" type="text" placeholder="1.01"></label>' +
      '<label>I² % <input id="ocf-i2" type="text" placeholder="0"></label>' +
      '<label>k <input id="ocf-k" type="text" placeholder="3"></label>' +
      '<label>PI low <input id="ocf-pilo" type="text" placeholder="(optional)"></label>' +
      '<label>PI high <input id="ocf-pihi" type="text" placeholder="(optional)"></label>' +
      '<button type="button" data-action="add-outcome">Add outcome</button>' +
      '<p class="add-outcome-note">Enter the pooled numbers for this outcome from your analysis. Each added outcome gets its own forest plot, caption and interpretation box below.</p>' +
      '</div></details></div>';
  }

  // A Results subsection per secondary outcome (heading + auto sentence + forest + caption + interpretation).
  function renderOutcomeSections() {
    var html = "";
    PS.state.outcomes.forEach(function (oc) {
      html += '<section id="outcomeSection_' + oc.id + '" class="outcome-section">';
      html += '<h3>Secondary outcome: ' + esc(oc.label) +
        (oc.illustrative ? ' <span class="illus-badge no-clean-pdf">illustrative demo data</span>' : '') + '</h3>';
      if (oc.illustrative) html += helper("These numbers are <strong>illustrative demo data</strong> to show how a secondary outcome works — replace them with your real analysis (or remove this outcome).");
      html += '<p>' + ocSentence(oc) + '</p>';
      html += '<figure class="paper-figure-card"><div class="figure-card-header"><span class="figure-label">Forest</span><h3>' + esc(oc.label) + '</h3></div>' +
        '<div class="figure-learning-row no-clean-pdf"><button type="button" data-learn="forest_plot" aria-haspopup="dialog">What is a forest plot?</button></div>' +
        '<div class="figure-visual" id="outcomeForestSlot_' + oc.id + '"></div>' +
        '<figcaption><strong>Caption / interpretation:</strong> ' + inlineBox("studentText.oc_" + oc.id + "_caption", "The forest plot for " + esc(oc.label) + " shows...") + '</figcaption></figure>';
      html += box("studentText.oc_" + oc.id + "_interp", "Interpret " + esc(oc.label), "For this outcome, the result suggests...", "~2-3 sentences",
        "Same three things as the primary: which way it points, how precise it is, and whether the size matters — for this specific outcome.");
      html += '</section>';
    });
    return html;
  }

  // Mount each outcome's forest plot (called during the figure-embed pass).
  function mountOutcomeFigures() {
    PS.state.outcomes.forEach(function (oc) {
      PS.mountFig("oc_" + oc.id, "forest", "outcomeForestSlot_" + oc.id, ocResults(oc), oc, oc.label);
    });
  }

  // One clone pass. Returns true when the key plot sources are present (so the
  // poll can stop). Slots whose source is still empty keep their placeholder and
  // are retried on the next attempt rather than being locked to "unavailable".
  function clonePass() {
    (nonEmpty("#prisma-flow-container") || !nonEmpty("#prismaFlowContainer"))
      ? PS.cloneVisual("#prisma-flow-container", "#prismaPaperSlot", "prisma", 760, 520)
      : PS.cloneVisual("#prismaFlowContainer", "#prismaPaperSlot", "prisma", 760, 520);
    // Forest + funnel: render OUR OWN legible plots (with prediction interval +
    // x-range) from the computed results, instead of cloning the dark host images.
    // The host nulls state.results when you leave the Analysis tab, so cache the last good
    // one — keeps the paper's figures stable regardless of the host's scoping lifecycle.
    var liveRes = (window.RapidMeta && RapidMeta.state) ? RapidMeta.state.results : null;
    if (liveRes && liveRes.plotData) PS._lastResults = liveRes;
    var res = (liveRes && liveRes.plotData) ? liveRes : (PS._lastResults || liveRes);
    var primaryLabel = (PS.state.pico && PS.state.pico.primaryOutcome) || "primary outcome";
    var forestOk = PS.renderOwnFig("forest", "forestPlotPaperSlot", res, primaryLabel);
    if (!forestOk) ensurePlaceholder("#forestPlotPaperSlot", "forestPlot", "The forest plot appears here once your analysis has results. Open the Analysis Suite, then click “Refresh figures”.");
    var funnelOk = PS.renderOwnFig("funnel", "funnelPaperSlot", res, primaryLabel);
    if (!funnelOk) ensurePlaceholder("#funnelPaperSlot", "funnelPlot", "The funnel plot appears here once your analysis has ≥2 studies with standard errors.");
    mountOutcomeFigures();   // forest per secondary outcome
    var sof = document.querySelector("#sof-body");
    if (sof && sof.closest("table") && nonEmpty("#sof-body")) fallbackClone(sof.closest("table"), document.querySelector("#gradePaperSlot"), "gradeTable");
    else PS.cloneVisual("#grade-profile-container", "#gradePaperSlot", "gradeTable", 820, 300);
    // Risk-of-bias: clone the real host RoB bar chart if present (review fix).
    if (nonEmpty("#plot-rob-bar")) PS.cloneVisual("#plot-rob-bar", "#robPaperSlot", "riskOfBias", 760, 320);
    else ensurePlaceholder("#robPaperSlot", "riskOfBias", "Risk-of-bias summary appears here once you complete the Extraction → RoB step.");
    ensurePlaceholder("#studyTablePaperSlot", "studyCharacteristics", "Add a brief characteristics summary, or paste the included-studies table here.");
    // Done when results exist (our plots render from results), and PRISMA is present.
    return !!res && (nonEmpty("#prisma-flow-container") || nonEmpty("#prismaFlowContainer"));
  }

  // Make the host analysis computable WITHOUT the manual Analysis-tab visit / extraction tick:
  // the host's run() scopes to state.selectedOutcome ?? 'default', and 'default' usually has no
  // event counts, so results stay null. Select an outcome that actually has data so all the
  // plots (forest/funnel/GRADE) render the moment Paper Studio opens.
  PS.ensureAnalysisReady = function () {
    try {
      var RM = window.RapidMeta;
      if (!RM || !RM.state) return;
      var scope = RM.getAnalysisScopeDetails ? RM.getAnalysisScopeDetails() : null;
      var trials = (scope && scope.eligible && scope.eligible.length) ? scope.eligible : (RM.state.trials || []);
      var outcomesOf = function (t) { return (t && t.data && t.data.allOutcomes) || []; };
      var hasData = function (k) { return k && trials.some(function (t) { return outcomesOf(t).some(function (o) { return o.shortLabel === k; }); }); };
      if (!hasData(RM.state.selectedOutcome)) {
        var key = null;
        trials.some(function (t) { var os = outcomesOf(t); if (os.length) { key = os[0].shortLabel; return true; } return false; });
        if (key) RM.state.selectedOutcome = key;
      }
    } catch (e) {}
  };

  // force=true re-runs the host pipeline even if results exist (Refresh button).
  PS.embedFigures = function (force) {
    PS.ensureAnalysisReady();
    var haveResults = !!(window.RapidMeta && RapidMeta.state && RapidMeta.state.results);
    // Compute the analysis + figures up front (missing results, or explicitly forced).
    if (force || !haveResults) {
      PS.__selfRun = true;   // suppress the auto-update hook for our own pipeline runs
      try { if (window.AnalysisEngine && AnalysisEngine.run) AnalysisEngine.run(); } catch (e) {}
      try { if (window.ReportEngine && ReportEngine.generate) ReportEngine.generate(); } catch (e) {}
      try { if (window.PrismaEngine && PrismaEngine.renderToElement) PrismaEngine.renderToElement("prisma-flow-container"); } catch (e) {}
      PS.__selfRun = false;
    }
    var attempt = 0, MAX = 4;
    var captionsBefore = countRequiredCaptions();
    (function poll() {
      var ready = clonePass();
      attempt++;
      if (!ready && attempt < MAX) { setTimeout(poll, 250); return; }
      PS.updateChecklist();
      PS.save();
      // If a figure finished loading and now needs a caption, say so plainly — so the
      // checklist/lock changing doesn't read as "I broke it" (round-3 review, Sam).
      var after = countRequiredCaptions();
      if (after > captionsBefore) PS.toast("A figure finished loading, so its caption was added to your checklist — that’s expected, not an error.");
    })();
  };
  function countRequiredCaptions() {
    var n = 0; ["prisma", "forestPlot", "gradeTable"].forEach(function (k) { if (PS.state.figures[k] && PS.state.figures[k].available) n++; });
    return n;
  }
  // Auto-update: re-clone the figures from the host's (re-computed) results WITHOUT re-running
  // the engines — used when the host analysis is re-run externally (the "living" data changes).
  PS.__softRefresh = function () {
    try {
      var ae = document.activeElement;
      var typing = ae && ae.closest && ae.closest('#paperCanvas [contenteditable="true"]');
      PS.loadRapidMetaData();          // refresh the auto-filled numbers from the new analysis
      if (!typing) PS.render();         // re-render the body (skipped mid-typing to keep focus)
      clonePass();                      // re-render the figures
      PS.updateChecklist();
      PS.toast("Updated from your latest analysis.");
    } catch (e) {}
  };
  // Wrap the host's AnalysisEngine.run ONCE so an external re-run refreshes Paper Studio while
  // it is open. Our own runs set PS.__selfRun, so this never recurses.
  PS.hookLiveUpdate = function () {
    var AE = window.AnalysisEngine;
    if (!AE || typeof AE.run !== "function" || AE.__psLiveHooked) return;
    AE.__psLiveHooked = true;
    var orig = AE.run.bind(AE);
    AE.run = function () {
      var out = orig.apply(this, arguments);
      if (!PS.__selfRun && document.body && document.body.dataset.paperMode) {
        clearTimeout(PS.__liveTimer);
        PS.__liveTimer = setTimeout(PS.__softRefresh, 200);
      }
      return out;
    };
  };

  function ensurePlaceholder(sel, figKey, msg) {
    var el = document.querySelector(sel);
    if (el && !el.children.length && !(el.innerText || "").trim()) { el.innerHTML = missingHTML(msg); markFig(figKey, false); }
  }

  /* ---------------- modes ---------------- */
  PS.setMode = function (mode) {
    var canvas = document.getElementById("paperCanvas");
    if (!canvas) return;
    canvas.classList.remove("paper-mode-write", "paper-mode-preview");
    canvas.classList.add("paper-mode-" + mode);
    document.body.dataset.paperMode = mode;
  };

  /* ---------------- focus mode (Feature A) ---------------- */
  // CSS full-screen (NOT the Fullscreen API): hides the host chrome so Paper Studio fills the
  // screen like a word processor. Esc exits; the toggle stays visible; focus returns on exit.
  PS.setFocusMode = function (on) {
    document.body.classList.toggle("ps-focus-mode", on);
    var btn = document.getElementById("btnFocusMode");
    if (btn) { btn.setAttribute("aria-pressed", on ? "true" : "false"); btn.textContent = on ? "⛶ Exit focus" : "⛶ Focus mode"; }
    PS.toast(on ? "Focus mode on — press Esc or “Exit focus” to leave." : "Focus mode off.");
  };
  PS.toggleFocusMode = function () { PS.setFocusMode(!document.body.classList.contains("ps-focus-mode")); };

  /* ---------------- section navigator (Feature B) ---------------- */
  // The 21 fillable sections, grouped into 7 friendly IMRaD headings. This is the single
  // ordered model the left navigator uses now and the one-section wizard (Feature C) will
  // reuse, so a nav click and a wizard step address the same sections.
  PS.SECTION_NAV = [
    { group: "Title & Abstract", items: [
      { f: "studentText.title", label: "Title" },
      { f: "studentText.coverFinding", label: "Main finding (cover)" },
      { f: "studentText.abstractBackground", label: "Abstract: background" },
      { f: "studentText.abstractConclusion", label: "Abstract: conclusion" } ] },
    { group: "Introduction", items: [
      { f: "studentText.introductionClinicalProblem", label: "Why the condition matters" },
      { f: "studentText.introductionWhyReviewNeeded", label: "Why combine studies" } ] },
    { group: "Methods", items: [
      { f: "studentText.methodsEligibility", label: "Methods: who you included" } ] },
    { group: "Results", items: [
      { f: "figures.prisma.caption", label: "Study-selection (PRISMA) caption" },
      { f: "figures.forestPlot.caption", label: "Forest plot caption" },
      { f: "studentText.forestInterpretation", label: "What the forest plot means" },
      { f: "figures.gradeTable.caption", label: "GRADE table caption" },
      { f: "studentText.heterogeneityInterpretation", label: "What the heterogeneity means" },
      { f: "studentText.certaintyInterpretation", label: "What the certainty means" } ] },
    { group: "Discussion", items: [
      { f: "studentText.discussionPrincipalFinding", label: "Discussion: main finding" },
      { f: "studentText.discussionTransportability", label: "Who the result applies to" },
      { f: "studentText.discussionLimitations", label: "Main limitation" },
      { f: "studentText.discussionConclusion", label: "Balanced conclusion" } ] },
    { group: "Reflection", items: [
      { f: "studentText.reflectionLeastConfident", label: "Where you are least sure" } ] },
    { group: "Disclosures & References", items: [
      { f: "studentText.registration", label: "Protocol / registration" },
      { f: "studentText.funding", label: "Funding" },
      { f: "studentText.coi", label: "Competing interests" },
      { f: "studentText.references", label: "References" } ] }
  ];
  // "Done" = meets the SAME word floor the readiness gate enforces (text+glyph, not colour).
  // NOTE: this will be upgraded to the substantive gate (Phase 2b) so "done" means understood,
  // not merely "filled".
  function navFieldDone(f) {
    var v = (PS.getField ? PS.getField(f) : "") || "";
    var n = v.trim() ? v.trim().split(/\s+/).filter(Boolean).length : 0;
    var floor = (PS.floorFor ? PS.floorFor(f) : 0) || 1;
    return n >= floor;
  }
  PS.buildSectionNav = function () {
    var panel = document.getElementById("paperNavPanel");
    if (!panel) return;
    var total = 0, done = 0, idx = 0;
    var groups = PS.SECTION_NAV.map(function (g) {
      var items = g.items.map(function (it) {
        total++;
        var ok = navFieldDone(it.f); if (ok) done++;
        var first = idx === 0; idx++;
        var state = ok ? "complete" : "to write";
        return '<li role="none"><button type="button" class="nav-item' + (ok ? " nav-done" : "") + '"' +
          ' data-nav-field="' + escAttr(it.f) + '" tabindex="' + (first ? "0" : "-1") + '"' +
          ' aria-label="' + escAttr(it.label + " — " + state) + '">' +
          '<span class="nav-glyph" aria-hidden="true">' + (ok ? "✓" : "○") + '</span>' +
          '<span class="nav-label">' + esc(it.label) + '</span></button></li>';
      }).join("");
      return '<li class="nav-group"><div class="nav-group-title">' + esc(g.group) + '</div><ul role="list">' + items + '</ul></li>';
    }).join("");
    // Default open on desktop, collapsed on phones (a 21-item list on top of a small screen
    // is itself a wall); preserve the user's open/closed choice across refreshes.
    var existing = panel.querySelector(".section-nav-wrap");
    var openAttr = (existing ? existing.open : window.innerWidth > 700) ? " open" : "";
    panel.innerHTML =
      '<nav aria-label="Paper sections" class="section-nav">' +
      '<details' + openAttr + ' class="section-nav-wrap"><summary><span class="nav-h">Sections</span> ' +
      '<span class="nav-progress">' + done + ' of ' + total + ' done</span></summary>' +
      '<button type="button" class="nav-skip" data-action="skip-to-writing">Skip to writing →</button>' +
      '<ul role="list" class="nav-grouplist">' + groups + '</ul></details></nav>';
  };
  // Jump to a section: in wizard mode switch to the step that holds it, then focus its box.
  PS.gotoSection = function (field) {
    var el = document.querySelector('#paperCanvas [data-field="' + field + '"]');
    if (!el) return;
    var step = el.closest(".ps-step");
    if (step && PS.state.ui && PS.state.ui.view === "wizard") {
      var steps = Array.prototype.slice.call(document.querySelectorAll("#paperCanvas .ps-step"));
      var idx = steps.indexOf(step); if (idx >= 0) applyWizard(idx, false);
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    try { el.focus(); } catch (e) {}
    var panel = document.getElementById("paperNavPanel");
    if (panel) panel.querySelectorAll(".nav-item").forEach(function (b) {
      if (b.dataset.navField === field) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
  };

  /* ---------------- one-section wizard (Feature C) ---------------- */
  // After render() flattens the paper into #paperCanvas, group the children into steps cut
  // at each H2/H3 (only Results has H3s, so it sub-splits there -> ~13 hybrid steps). Show
  // one step at a time by default for first-time writers; "Show all" is a persisted toggle.
  function isFirstTimer() { return Object.keys((PS.state && PS.state.studentText) || {}).length === 0; }
  PS.buildWizard = function () {
    var canvas = document.getElementById("paperCanvas");
    if (!canvas) return;
    // render() just reset innerHTML, so children are flat (no prior steps/bars to unwrap).
    var nodes = Array.prototype.slice.call(canvas.childNodes);
    var steps = [], cur = null;
    nodes.forEach(function (node) {
      var hdr = node.nodeType === 1 && (node.tagName === "H2" || node.tagName === "H3");
      if (hdr || !cur) { cur = { title: hdr ? node.textContent.trim() : "Title & overview", nodes: [] }; steps.push(cur); }
      cur.nodes.push(node);
    });
    if (!steps.length) return;
    var ui = PS.state.ui = PS.state.ui || {};
    if (ui.view == null) ui.view = isFirstTimer() ? "wizard" : "all";
    steps.forEach(function (s, i) {
      var wrap = document.createElement("div");
      wrap.className = "ps-step"; wrap.setAttribute("role", "group");
      wrap.dataset.step = i; wrap.setAttribute("aria-label", "Step " + (i + 1) + " of " + steps.length + ": " + s.title);
      s.nodes.forEach(function (n) { wrap.appendChild(n); });   // relocates the node
      canvas.appendChild(wrap);
    });
    PS._wizardTitles = steps.map(function (s) { return s.title; });
    canvas.insertBefore(makeWizardBar(false), canvas.firstChild);   // top bar
    canvas.appendChild(makeWizardBar(true));                        // bottom Back/Next
    canvas.classList.toggle("ps-show-all", ui.view === "all");
    applyWizard(Math.min(Math.max(0, ui.step || 0), steps.length - 1), false);
  };
  function makeWizardBar(bottom) {
    var bar = document.createElement("div");
    bar.className = "ps-wizard-bar no-clean-pdf" + (bottom ? " ps-wizard-bottom" : "");
    bar.innerHTML =
      '<div class="ps-wizard-row">' +
      '<button type="button" class="ps-wiz-btn ps-prev" data-wiz="prev">← Back</button>' +
      (bottom ? '' : '<div class="ps-wizard-mid"><div class="ps-step-label" aria-live="polite"></div>' +
        '<div class="ps-progress-wrap" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="ps-progress-bar"></span></div></div>') +
      '<button type="button" class="ps-wiz-btn ps-next" data-wiz="next">Next →</button></div>' +
      (bottom ? '' : '<button type="button" class="ps-showall" data-wiz="toggle"></button>');
    return bar;
  }
  // Show step i (never hard-locks Next; Back disabled only at step 0). focusHeading=true on
  // Back/Next so keyboard + screen-reader users land on the new section heading.
  function applyWizard(i, focusHeading) {
    var canvas = document.getElementById("paperCanvas"); if (!canvas) return;
    var steps = canvas.querySelectorAll(".ps-step"); if (!steps.length) return;
    i = Math.min(Math.max(0, i), steps.length - 1);
    PS.state.ui = PS.state.ui || {}; PS.state.ui.step = i;
    steps.forEach(function (s, k) { s.classList.toggle("ps-current", k === i); });
    // A Plotly plot rendered while its step was hidden has wrong dimensions; fix on reveal.
    if (window.Plotly) { try { steps[i].querySelectorAll(".js-plotly-plot").forEach(function (gd) { window.Plotly.Plots.resize(gd); }); } catch (e) {} }
    var total = steps.length, title = (PS._wizardTitles && PS._wizardTitles[i]) || "";
    var pct = Math.round(((i + 1) / total) * 100);
    canvas.querySelectorAll(".ps-step-label").forEach(function (l) { l.textContent = "Step " + (i + 1) + " of " + total + " — " + title; });
    canvas.querySelectorAll(".ps-progress-bar").forEach(function (b) { b.style.width = pct + "%"; });
    canvas.querySelectorAll(".ps-progress-wrap").forEach(function (w) { w.setAttribute("aria-valuenow", pct); });
    canvas.querySelectorAll(".ps-prev").forEach(function (b) { b.disabled = (i === 0); });
    canvas.querySelectorAll(".ps-next").forEach(function (b) { b.textContent = (i === total - 1) ? "Finish ✓" : "Next →"; });
    var toggle = canvas.querySelector(".ps-showall");
    if (toggle) toggle.textContent = (PS.state.ui.view === "all") ? "📖 Show one section at a time" : "📋 Show all sections at once";
    if (focusHeading) {
      var h = steps[i].querySelector("h1, h2, h3");
      if (h) { h.setAttribute("tabindex", "-1"); try { h.focus(); } catch (e) {} h.scrollIntoView({ block: "start", behavior: "smooth" }); }
    }
    PS.save();
  }
  PS.wizardNext = function () { applyWizard((PS.state.ui && PS.state.ui.step || 0) + 1, true); };
  PS.wizardPrev = function () { applyWizard((PS.state.ui && PS.state.ui.step || 0) - 1, true); };
  PS.setWizardView = function (view) {
    var canvas = document.getElementById("paperCanvas"); if (!canvas) return;
    PS.state.ui = PS.state.ui || {}; PS.state.ui.view = view;
    canvas.classList.toggle("ps-show-all", view === "all");
    applyWizard(PS.state.ui.step || 0, false);
  };
  PS.toggleWizardView = function () { PS.setWizardView(PS.state.ui && PS.state.ui.view === "all" ? "wizard" : "all"); };

  /* ---------------- checklist / readiness ---------------- */
  PS.updateChecklist = function () {
    var panel = document.getElementById("paperChecklistPanel");
    if (!panel || !PS.runReadinessCheck) return;
    var c = PS.runReadinessCheck("live");
    var level = PS.readinessLevel(c.score);
    // Status carried by TEXT token + glyph (not colour alone) for accessibility.
    var items = c.issues.slice(0, 10).map(function (i) {
      var blocking = i.level === "error";
      return '<div class="checklist-item incomplete" role="listitem">' +
        '<span aria-hidden="true">□</span> <span class="sr-prefix">' + (blocking ? "To do — " : "Suggestion — ") + '</span>' + esc(i.msg) + '</div>';
    }).join("");
    if (!c.issues.length) items = '<div class="checklist-item complete" role="listitem"><span aria-hidden="true">✓</span> Done — all required sections complete</div>';
    var gate = c.blockingCount === 0
      ? '<div class="readiness-gate ready">All sections written — your finished PDF is ready ✓</div>'
      : '<div class="readiness-gate blocked">Almost there — ' + c.blockingCount + ' section(s) still to finish before your finished PDF unlocks</div>';
    panel.innerHTML =
      '<h4>Paper readiness</h4>' +
      '<div class="readiness-score">' + c.score + '%</div>' +
      '<div class="readiness-bar" role="progressbar" aria-valuenow="' + c.score + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + c.score + '%"></span></div>' +
      '<div class="readiness-level">' + esc(level) + '</div>' +
      gate +
      '<div role="list" style="margin-top:.6rem">' + items + '</div>' +
      '<p class="readiness-honesty">This checks that each section is <em>written</em> — it cannot check that your interpretation is <em>correct</em>.</p>' +
      '<button type="button" id="btnTutorCopy" class="tutor-copy-btn" title="Downloads a copy that keeps the prompts and tips visible, for your tutor to mark.">📄 Give my tutor a copy (with tips)</button>';
    var chips = document.getElementById("evidenceChipsPanel");
    if (chips) chips.innerHTML = '<h4>Evidence (auto-filled)</h4>' + PS.renderChips();
    // Show the lock state on the primary download button so it never looks "broken".
    var dlBtn = document.getElementById("btnDownloadCleanPdf");
    if (dlBtn) {
      if (c.blockingCount === 0) { dlBtn.textContent = "⬇ Download my paper (PDF)"; dlBtn.classList.remove("locked"); dlBtn.setAttribute("aria-disabled", "false"); }
      else { dlBtn.textContent = "🔒 Download my paper (" + c.blockingCount + " to finish)"; dlBtn.classList.add("locked"); dlBtn.setAttribute("aria-disabled", "true"); }
    }
    // Refresh the left section navigator's done-states/progress (unless focus is inside it).
    var np = document.getElementById("paperNavPanel");
    if (!(np && np.contains(document.activeElement))) PS.buildSectionNav();
  };

  PS.showReadinessModal = function (check) {
    PS.setMode("write");
    var panel = document.getElementById("paperChecklistPanel");
    if (panel) { panel.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    var errs = check.issues.filter(function (i) { return i.level === "error"; });
    PS.toast((errs.length || "No") + " required item(s) still missing — see the readiness panel.");
    // Briefly highlight the first missing field.
    if (errs[0]) {
      var el = document.querySelector('[data-field="' + errs[0].field + '"]');
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); try { el.focus(); } catch (e) {} }
    }
  };

  /* ---------------- toast ---------------- */
  var toastTimer;
  PS.toast = function (msg) {
    var t = document.getElementById("paperToast");
    if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  };

  /* ---------------- autosave ---------------- */
  var saveTimer, chkTimer;
  function scheduleAutosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      PS.save();
      var d = new Date();
      var hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
      var s = document.getElementById("paperSaveStatus"); if (s) s.textContent = "Autosaved " + hh + ":" + mm;
    }, 500);
  }

  /* ---------------- JSON export / import / reset ---------------- */
  PS.downloadJson = function () {
    PS.save();
    var blob = new Blob([JSON.stringify(PS.state, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = "rapidmeta-paper-data.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };
  PS.uploadJson = function (file) {
    var reader = new FileReader();
    reader.onload = function () {
      try { deepMerge(PS.state, JSON.parse(reader.result)); PS.save(); PS.render(); PS.embedFigures(); PS.toast("Paper data loaded."); }
      catch (e) { PS.toast("Could not read that file."); }
    };
    reader.readAsText(file);
  };
  PS.resetText = function () {
    if (!window.confirm("Reset all student-written text? Auto-filled evidence is kept.")) return;
    PS.state.studentText = {};
    Object.keys(PS.state.figures).forEach(function (k) { PS.state.figures[k].caption = ""; });
    PS.save(); PS.render(); PS.embedFigures(); PS.toast("Student text reset.");
  };
  // Shared-machine safety: wipe everything from this browser (review P1-12).
  PS.clearAll = function () {
    if (!window.confirm("Clear ALL of your writing AND remove it from this computer? This cannot be undone. Download your data first if you want to keep it.")) return;
    PS.state.studentText = {}; PS.state.outcomes = []; PS.state._seededOutcomes = false;
    Object.keys(PS.state.figures).forEach(function (k) { PS.state.figures[k].caption = ""; });
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    PS.render(); PS.embedFigures(); PS.toast("Cleared from this computer.");
  };

  /* ---------------- save robustness (flush + cross-window) ---------------- */
  // Flush the pending debounced save when the page is hidden/closed so the last
  // few keystrokes are never lost (review P1-7).
  function flushSave() { try { clearTimeout(saveTimer); PS.save(); } catch (e) {} }
  window.addEventListener("pagehide", flushSave);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flushSave(); });
  // Another tab/window saved to the same key — warn rather than silently diverge (review P1-6).
  window.addEventListener("storage", function (e) {
    if (e.key === STORAGE_KEY && booted && document.body && document.body.dataset.paperMode) {
      PS.toast("Heads up: this paper was changed in another tab. Reload to see the latest, or keep editing here to overwrite it.");
    }
  });

  /* ---------------- worked example (read-only exemplar) ---------------- */
  // A complete, finished short evidence paper students can read end-to-end. Read-only:
  // it never touches studentText (copying topic-specific prose into a different study
  // would be an integrity risk — the per-box "Use this example" starters cover scaffolding).
  var WORKED_EXAMPLE = [
    ["Title", ["Finerenone for adults with chronic kidney disease and type 2 diabetes: a short systematic review and meta-analysis."]],
    ["Abstract — Background", ["Chronic kidney disease in adults with type 2 diabetes is common and tends to worsen over time. Despite standard treatment, many patients still develop heart failure or die from cardiovascular causes, so better options are needed."]],
    ["Abstract — Objective", ["This short review aimed to assess whether finerenone reduces cardiovascular events compared with placebo in this population."]],
    ["Abstract — Methods", ["A rapid systematic review and random-effects meta-analysis combined three randomised trials (19,027 participants) for the composite cardiovascular outcome."]],
    ["Abstract — Results", ["The pooled risk ratio was 0.86 (0.78 to 0.95, 95% CI), I² = 12%. The certainty of evidence (GRADE) was moderate."]],
    ["Abstract — Conclusion", ["In adults with CKD and type 2 diabetes, finerenone probably reduces cardiovascular events by a modest amount; because certainty is moderate, the exact size of the benefit remains uncertain."]],
    ["Introduction", [
      "Chronic kidney disease in adults with type 2 diabetes is common and progressive. Even with standard care, many patients go on to develop heart failure or die from cardiovascular causes, and kidney function keeps declining.",
      "Finerenone is a non-steroidal mineralocorticoid-receptor antagonist that may reduce cardiovascular and kidney harm. Before this review it was unclear how large and how reliable that benefit was across trials.",
      "No single trial was large enough to settle the question precisely, so this short paper pools the major trials to ask whether finerenone reduces cardiovascular events."
    ]],
    ["Methods", ["We included randomised controlled trials of finerenone versus placebo in adults with CKD and type 2 diabetes that reported cardiovascular events. Treatment effects were summarised using the risk ratio in a random-effects meta-analysis; heterogeneity was quantified with I² and τ², risk of bias with RoB 2, and certainty with GRADE. As a rapid review the search was lighter than a full systematic review, so a relevant study could have been missed."]],
    ["Results — primary outcome", ["The pooled risk ratio for the composite cardiovascular outcome was 0.86 (0.78 to 0.95, 95% CI) across three trials (19,027 participants). The confidence interval stayed below 1, so a benefit in this direction is statistically supported, and it was fairly narrow, indicating reasonable precision."]],
    ["Results — heterogeneity", ["Statistical heterogeneity was low (I² = 12%, τ² ≈ 0.004), so the three trials gave broadly consistent results; with only three studies this agreement should be read cautiously rather than as proof."]],
    ["Results — certainty", ["Certainty of evidence was rated Moderate, downgraded for imprecision because only three trials contributed; the conclusion is therefore worded cautiously rather than definitively."]],
    ["Discussion", ["Across the pooled trials, finerenone was associated with fewer cardiovascular events than placebo — a modest but consistent benefit. Considering the estimate together with the moderate certainty, this could be worthwhile for high-risk patients, though the exact size is uncertain. A strength is that the review brings the main trials into a single estimate; the main limitation is that few trials contributed and the included patients may differ from everyday practice."]],
    ["Conclusion", ["In adults with chronic kidney disease and type 2 diabetes, finerenone probably reduces cardiovascular events by a modest amount compared with placebo, although certainty is moderate and the exact size of the benefit remains uncertain. A larger trial focused on advanced kidney disease would help confirm whether the benefit holds in that group."]]
  ];
  var exampleOpener = null;
  function exampleEsc(e) { if (e.key === "Escape") PS.closeWorkedExample(); }
  PS._buildExampleModal = function () {
    if (document.getElementById("workedExampleModal")) return;
    var sections = WORKED_EXAMPLE.map(function (s) {
      return '<h3>' + esc(s[0]) + '</h3>' + s[1].map(function (p) { return '<p>' + esc(p) + '</p>'; }).join("");
    }).join("");
    var wrap = document.createElement("div");
    wrap.id = "workedExampleModal"; wrap.className = "example-modal"; wrap.hidden = true;
    wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", "Worked example paper, read only");
    wrap.innerHTML =
      '<div class="example-modal-card" role="document">' +
        '<div class="example-modal-head"><strong>📄 Worked example — read only</strong>' +
        '<button id="closeWorkedExample" type="button">Close ✕</button></div>' +
        '<p class="example-modal-note">This is a finished example to learn from. It does <strong>not</strong> change your paper — read it, then write your own in your own words.</p>' +
        '<div class="example-modal-body">' + sections + '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) PS.closeWorkedExample(); });
    document.getElementById("closeWorkedExample").addEventListener("click", PS.closeWorkedExample);
  };
  PS.showWorkedExample = function () {
    PS._buildExampleModal();
    exampleOpener = document.activeElement;
    var m = document.getElementById("workedExampleModal");
    if (m) { m.hidden = false; document.addEventListener("keydown", exampleEsc); }
    var c = document.getElementById("closeWorkedExample"); if (c) try { c.focus(); } catch (e) {}
  };
  PS.closeWorkedExample = function () {
    var m = document.getElementById("workedExampleModal"); if (m) m.hidden = true;
    document.removeEventListener("keydown", exampleEsc);
    if (exampleOpener && exampleOpener.focus) try { exampleOpener.focus(); } catch (e) {}
  };

  /* ---------------- boot / show ---------------- */
  var wired = false;
  // Wire the persistent toolbar + canvas listeners EXACTLY ONCE. The toolbar
  // buttons and #paperCanvas element survive render() (which only swaps innerHTML),
  // so re-binding on every onShow would stack duplicate handlers.
  function wireToolbar() {
    if (wired) return;
    wired = true;
    function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener("click", fn); }
    on("btnWriteMode", function () { PS.setMode("write"); });
    on("btnPreviewMode", function () { var c = PS.runReadinessCheck("preview"); PS.updateChecklist(); PS.setMode("preview"); if (!c.ready) PS.toast("Previewing — " + c.issues.filter(function (i) { return i.level === "error"; }).length + " required item(s) still missing."); });
    on("btnCheckPaper", function () { var c = PS.runReadinessCheck("clean"); PS.updateChecklist(); PS.showReadinessModal(c); });
    on("btnToggleTips", function () {
      var hidden = document.body.classList.toggle("tips-hidden");
      try { localStorage.setItem("rapidmeta.paperTips", hidden ? "off" : "on"); } catch (e) {}
      this.textContent = hidden ? "Show examples & notes" : "Hide examples & notes";
    });
    on("btnStartGuide", function () {
      try { localStorage.removeItem("rapidmeta.paperOnboard"); } catch (e) {}
      PS.render(); PS.embedFigures(); PS.toast("Start-here guide reopened.");
      var c = document.querySelector("#paperCanvas .onboard-card"); if (c) c.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    on("btnFocusMode", function () { PS.toggleFocusMode(); });
    on("btnWorkedExample", function () { PS.showWorkedExample(); });
    on("btnRefreshFigures", function () { PS.embedFigures(true); PS.toast("Refreshing figures from the analysis…"); });
    on("btnDownloadWorkingPdf", function () { PS.downloadPaperPdf({ clean: false }); });
    on("btnDownloadCleanPdf", function () { PS.downloadPaperPdf({ clean: true }); });
    // export menu (Word / text / figures / bundle)
    var dlMenu = document.querySelector(".download-menu");
    if (dlMenu) dlMenu.addEventListener("click", function (e) {
      var b = e.target.closest("[data-export]"); if (!b) return;
      var fmt = (document.getElementById("figFormatSelect") || {}).value || "png";
      var what = b.dataset.export;
      if (what === "clean-pdf") PS.downloadPaperPdf({ clean: true });
      else if (what === "word") PS.exportWord && PS.exportWord();
      else if (what === "html") PS.exportHTML && PS.exportHTML();
      else if (what === "md") PS.exportMarkdown && PS.exportMarkdown();
      else if (what === "txt") PS.exportText && PS.exportText();
      else if (what === "bundle") PS.exportBundle && PS.exportBundle(fmt);
      else if (what === "figures") PS.exportAllFigures && PS.exportAllFigures(fmt);
      else if (what === "prisma" || what === "amstar" || what === "search") PS.exportSupplementary && PS.exportSupplementary(what, false);
      else if (what === "transparency") PS.exportTransparency && PS.exportTransparency(fmt);
      dlMenu.removeAttribute("open");
    });
    on("btnResetPaper", PS.resetText);
    on("btnClearAll", PS.clearAll);
    // Tutor-copy button lives in the re-rendered sidebar → delegate on document.
    document.addEventListener("click", function (e) { if (e.target.closest("#btnTutorCopy")) PS.downloadPaperPdf({ clean: false }); });
    // Esc exits focus mode and returns focus to the toggle (a11y: never trap the user).
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.body.classList.contains("ps-focus-mode")) {
        PS.setFocusMode(false);
        var fb = document.getElementById("btnFocusMode"); if (fb) try { fb.focus(); } catch (ex) {}
      }
    });
    on("btnDownloadJson", PS.downloadJson);
    var up = document.getElementById("paperJsonInput");
    on("btnUploadJson", function () { if (up) up.click(); });
    if (up) up.addEventListener("change", function () { if (up.files && up.files[0]) PS.uploadJson(up.files[0]); up.value = ""; });

    // ---- anchor the position:fixed toolbar menus under their button ----
    // The menus are position:fixed (so they escape #tab-paper's overflow:auto and never
    // clip), but the host's global header + tab-strip push the sticky toolbar down ~230px,
    // so the CSS's hardcoded top:54px floated them to the screen's top-left corner,
    // detached from their button. Position them live from the summary rect instead.
    (function () {
      var menus = [
        { d: document.querySelector(".toolbar-more"), b: document.querySelector(".toolbar-more-body"), side: "left" },
        { d: document.querySelector(".download-menu"), b: document.querySelector(".download-menu-body"), side: "right" }
      ].filter(function (m) { return m.d && m.b; });
      function clearPos(b) { b.style.top = b.style.left = b.style.right = b.style.maxHeight = ""; }
      function anchor(m) {
        // Closed, or phone bottom-sheet (<=640px media query): let the CSS own it.
        if (!m.d.open || window.innerWidth <= 640) { clearPos(m.b); return; }
        var r = m.d.querySelector("summary").getBoundingClientRect();
        m.b.style.top = Math.round(r.bottom + 4) + "px";
        m.b.style.maxHeight = "calc(100vh - " + Math.round(r.bottom + 28) + "px)";
        if (m.side === "right") { m.b.style.left = "auto"; m.b.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px"; }
        else { m.b.style.right = "auto"; m.b.style.left = Math.max(8, Math.round(r.left)) + "px"; }
      }
      menus.forEach(function (m) {
        m.d.addEventListener("toggle", function () {
          anchor(m);
          // Never let both menus sit open and overlap.
          if (m.d.open) menus.forEach(function (o) { if (o !== m && o.d.open) o.d.removeAttribute("open"); });
        });
      });
      function repositionOpen() { menus.forEach(function (m) { if (m.d.open) anchor(m); }); }
      var scroller = document.getElementById("tab-paper");
      if (scroller) scroller.addEventListener("scroll", repositionOpen, { passive: true });
      window.addEventListener("resize", repositionOpen);
    })();

    // ---- left section navigator: click + roving-tabindex keyboard nav (Feature B) ----
    var navPanel = document.getElementById("paperNavPanel");
    if (navPanel) {
      navPanel.addEventListener("click", function (e) {
        if (e.target.closest('[data-action="skip-to-writing"]')) { e.preventDefault(); PS.gotoSection(PS.SECTION_NAV[0].items[0].f); return; }
        var item = e.target.closest(".nav-item");
        if (item) { e.preventDefault(); PS.gotoSection(item.dataset.navField); }
      });
      // Arrow / Home / End move focus among items; only one item is in the tab order.
      navPanel.addEventListener("keydown", function (e) {
        var item = e.target.closest(".nav-item"); if (!item) return;
        var items = Array.prototype.slice.call(navPanel.querySelectorAll(".nav-item"));
        var i = items.indexOf(item), n = null;
        if (e.key === "ArrowDown") n = items[Math.min(items.length - 1, i + 1)];
        else if (e.key === "ArrowUp") n = items[Math.max(0, i - 1)];
        else if (e.key === "Home") n = items[0];
        else if (e.key === "End") n = items[items.length - 1];
        if (n) { e.preventDefault(); items.forEach(function (b) { b.tabIndex = -1; }); n.tabIndex = 0; n.focus(); }
      });
    }

    var canvas = document.getElementById("paperCanvas");
    if (canvas) {
      canvas.addEventListener("input", function (e) {
        var el = e.target.closest("[data-field]");
        if (!el) return;
        setNested(PS.state, el.dataset.field, el.innerText.trim());
        scheduleAutosave();
        if (el.hasAttribute("data-floor")) PS.updateWordCounts();
        // Hide this field's "Use this example" button once it has content (show again if cleared).
        var ueb = document.querySelector('#paperCanvas .use-example[data-target="' + el.dataset.field + '"]');
        if (ueb) ueb.toggleAttribute("hidden", !!el.innerText.trim());
        if (el.dataset.field === "studentText.protocolLink") PS.updateProtocolLink();
        clearTimeout(chkTimer);
        chkTimer = setTimeout(PS.updateChecklist, 600);
      });
      // Methods/Results format selectors (length + journal style).
      canvas.addEventListener("change", function (e) {
        var sel = e.target.closest("[data-style]");
        if (sel) PS.setStyle(sel.dataset.style, sel.value);
      });
      // Delegated actions inside the (re-rendered) canvas — bind once on the stable parent.
      canvas.addEventListener("click", function (e) {
        var wiz = e.target.closest("[data-wiz]");
        if (wiz) {
          e.preventDefault();
          if (wiz.dataset.wiz === "next") PS.wizardNext();
          else if (wiz.dataset.wiz === "prev") PS.wizardPrev();
          else if (wiz.dataset.wiz === "toggle") PS.toggleWizardView();
          return;
        }
        var figBtn = e.target.closest("[data-figaction]");
        if (figBtn) { e.preventDefault(); PS.applyFigRange(figBtn.dataset.figid, figBtn.dataset.figaction === "reset"); return; }
        var act = e.target.closest("[data-action]");
        if (!act) return;
        if (act.dataset.action === "build-refs") { e.preventDefault(); PS.buildReferences(); }
        else if (act.dataset.action === "use-example") {
          e.preventDefault();
          var target = act.dataset.target, starter = act.dataset.starter || "";
          var boxEl = document.querySelector('#paperCanvas [data-field="' + target + '"]');
          if (boxEl) {
            boxEl.innerText = starter;
            setNested(PS.state, target, starter);
            act.setAttribute("hidden", "");
            if (boxEl.hasAttribute("data-floor")) PS.updateWordCounts();
            PS.save(); PS.updateChecklist();
            try { boxEl.focus(); } catch (e2) {}
            PS.toast("Example added — now edit it to fit your study.");
          }
        }
        else if (act.dataset.action === "add-outcome") { e.preventDefault(); PS.addOutcome(); }
        else if (act.dataset.action === "remove-outcome") { e.preventDefault(); PS.removeOutcome(act.dataset.id); }
        else if (act.dataset.action === "dismiss-onboard") {
          e.preventDefault();
          try { localStorage.setItem("rapidmeta.paperOnboard", "off"); } catch (ex) {}
          var card = act.closest(".onboard-card"); if (card) card.remove();
        }
      });
    }
  }

  // Idempotent: safe to call from switchTab('paper'), the button click, reload
  // restore, or keyboard nav — and safe if those fire together.
  PS.onShow = function () {
    if (!booted) { PS.restore(); booted = true; }
    PS.hookLiveUpdate();
    // Compute the analysis BEFORE autofill so the numbers (effect, CI, I², GRADE) populate too,
    // not just the plots — without needing the Analysis tab visit or the extraction tick.
    PS.ensureAnalysisReady();
    if (!(window.RapidMeta && RapidMeta.state && RapidMeta.state.results)) {
      PS.__selfRun = true;
      try { if (window.AnalysisEngine && AnalysisEngine.run) AnalysisEngine.run(); } catch (e) {}
      PS.__selfRun = false;
    }
    PS.loadRapidMetaData();
    seedDemoOutcomes();     // demo only: illustrative secondary outcomes
    PS.render();            // re-render canvas content
    wireToolbar();          // no-op after the first call (listeners persist)
    PS.setMode("write");
    // Restore the student's tips on/off preference.
    var tipsOff = false; try { tipsOff = localStorage.getItem("rapidmeta.paperTips") === "off"; } catch (e) {}
    document.body.classList.toggle("tips-hidden", tipsOff);
    var tb = document.getElementById("btnToggleTips"); if (tb) tb.textContent = tipsOff ? "Show examples & notes" : "Hide examples & notes";
    PS.hookLiveUpdate();   // refresh figures if the host analysis is re-run while open
    PS.embedFigures();
    PS.updateChecklist();
    PS.updateWordCounts();
  };

  // Initialise whenever the Paper Studio tab becomes visible, via ANY path:
  // switchTab() (keyboard nav, reload-restore) primarily; the button click is a
  // belt-and-suspenders fallback. onShow is idempotent so double-firing is fine.
  document.addEventListener("DOMContentLoaded", function () {
    if (window.RapidMeta && typeof RapidMeta.switchTab === "function" && !RapidMeta.__paperStudioHooked) {
      RapidMeta.__paperStudioHooked = true;
      var orig = RapidMeta.switchTab.bind(RapidMeta);
      RapidMeta.switchTab = function (id) {
        var r = orig(id);
        if (id === "paper") { try { PS.onShow(); } catch (e) { console.warn("PaperStudio onShow failed", e); } }
        return r;
      };
      // If the app restored directly onto the paper tab, initialise now.
      if (RapidMeta.state && RapidMeta.state.activeTab === "paper") { try { PS.onShow(); } catch (e) {} }
    }
    var btn = document.getElementById("btn-tab-paper");
    if (btn) btn.addEventListener("click", function () { setTimeout(PS.onShow, 0); });
  });
})();
