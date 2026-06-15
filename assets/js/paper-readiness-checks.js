/* RapidMeta Evidence Paper Studio — readiness checker.
   The Clean-PDF gate must certify MEANING, not mere presence: a required field
   only "passes" when it is non-empty AND meets a word floor. Unresolved
   placeholders are blocking. Overclaim/generic phrasing are advisory warnings
   (we never auto-block on linguistics) but are surfaced with the matched span. */
(function () {
  "use strict";
  window.PaperStudio = window.PaperStudio || {};
  var PS = window.PaperStudio;

  // [fieldPath, label, minWords]  — passes only when wordCount >= minWords.
  var REQUIRED_STUDENT_FIELDS = [
    ["studentText.title", "Title", 4],
    ["studentText.coverFinding", "Cover: main finding", 8],
    ["studentText.abstractBackground", "Abstract background", 12],
    ["studentText.abstractConclusion", "Abstract conclusion", 20],
    ["studentText.introductionClinicalProblem", "Introduction: clinical problem", 50],
    ["studentText.introductionWhyReviewNeeded", "Introduction: why the review was needed", 20],
    ["studentText.methodsEligibility", "Methods: eligibility criteria (state your real design)", 10],
    ["studentText.forestInterpretation", "Forest plot interpretation", 40],
    ["studentText.heterogeneityInterpretation", "Heterogeneity interpretation", 15],
    // Certainty / GRADE is OPTIONAL — not every rapid review grades the evidence,
    // so it no longer blocks the finished paper (it is still offered as a section).
    ["studentText.discussionPrincipalFinding", "Discussion: principal finding", 15],
    ["studentText.discussionLimitations", "Main limitation", 50],
    ["studentText.discussionConclusion", "Balanced conclusion", 40],
    ["studentText.reflectionLeastConfident", "Reflection: where you are least confident", 12],
    ["studentText.registration", "Disclosure: protocol/registration", 3],
    ["studentText.funding", "Disclosure: funding", 3],
    ["studentText.coi", "Disclosure: competing interests", 3],
    ["studentText.references", "References (build them, then verify each)", 3]
  ];

  // Overclaiming in these fields BLOCKS the Clean PDF (editor-in-chief ask), not just warns.
  var BLOCKING_OVERCLAIM_FIELDS = {
    "studentText.coverFinding": 1, "studentText.abstractConclusion": 1, "studentText.discussionConclusion": 1
  };

  // figure caption field -> [path, label, figures-state-key, minWords]
  var REQUIRED_FIGURE_CAPTIONS = [
    ["figures.prisma.caption", "PRISMA caption", "prisma", 8],
    ["figures.forestPlot.caption", "Forest plot caption", "forestPlot", 8]
    // GRADE table caption is optional (GRADE itself is optional) — not required.
  ];

  // Blocking: literal scaffold tokens / unfilled blanks left in the text.
  var PLACEHOLDER_PATTERNS = [
    /\[population\]/i, /\[intervention\]/i, /\[comparator\]/i, /\[primary outcome\]/i,
    /\[condition\]/i, /_{3,}/, /\bTBC\b/i, /\bTODO\b/i, /lorem/i
  ];

  // Advisory only (warn). Word-boundary matched so "cures" ≠ "secures".
  var OVERCLAIM_PHRASES = [
    "proves", "proven", "definitely proves", "confirms beyond doubt", "should always be used",
    "is completely safe", "completely safe", "no uncertainty", "cures", "eliminates risk",
    "guarantees", "all patients should", "safe and effective", "significantly better",
    "clearly superior", "is highly effective", "miracle", "breakthrough"
  ];
  // ("is effective" and "standard of care" removed — they match normal neutral
  //  phrasing like "assess whether X is effective" / "compared with standard of
  //  care", which were being BLOCKED in the conclusion/abstract fields.)
  var GENERIC_PHRASES = [
    "more research is needed", "this is very important", "this study has limitations",
    "the results are significant", "in conclusion, this study shows"
  ];

  // The single source of truth for a field's word floor (used by the live counter too,
  // so the displayed "x / N words" always matches the gate).
  PS.floorFor = function (path) {
    for (var i = 0; i < REQUIRED_STUDENT_FIELDS.length; i++) if (REQUIRED_STUDENT_FIELDS[i][0] === path) return REQUIRED_STUDENT_FIELDS[i][2] || 0;
    var caps = { "figures.prisma.caption": 8, "figures.forestPlot.caption": 8, "figures.gradeTable.caption": 8 };
    return caps[path] || 0;
  };
  function wc(s) { return String(s || "").trim().split(/\s+/).filter(Boolean).length; }
  function reAlt(arr) { return new RegExp("\\b(" + arr.join("|").replace(/ /g, "\\s+") + ")\\b", "ig"); }

  /* ---- substantive-gate helpers (Phase 2b): comprehension, not mere presence ---- */
  // Normalised string + Levenshtein ratio, to detect an essentially-unedited example starter.
  function normTxt(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?"'’“”]+$/, "").trim(); }
  function lev(a, b) {
    var m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }
  function similarity(a, b) { a = normTxt(a); b = normTxt(b); if (!a || !b) return 0; if (a === b) return 1; return 1 - lev(a, b) / Math.max(a.length, b.length); }
  // The example starter offered for a field (read from the live "Use this example" button).
  function starterFor(path) {
    var el = document.querySelector('#paperCanvas .use-example[data-target="' + path + '"]');
    return el ? (el.getAttribute("data-starter") || "") : "";
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  var OVERCLAIM_RE = reAlt(OVERCLAIM_PHRASES);
  var GENERIC_RE = reAlt(GENERIC_PHRASES);

  PS.runReadinessCheck = function (mode) {
    mode = mode || "clean";
    var issues = [];
    var total = 0, passed = 0;
    var get = PS.getField;

    // 1. required student fields — non-empty AND meets word floor (blocking).
    REQUIRED_STUDENT_FIELDS.forEach(function (f) {
      total++;
      var v = (get(f[0]) || "").trim();
      var min = f[2] || 1;
      if (!v) { issues.push({ level: "error", field: f[0], msg: "Missing: " + f[1] }); }
      else if (wc(v) < min) { issues.push({ level: "error", field: f[0], msg: "Too short (" + wc(v) + "/" + min + " words): " + f[1] }); }
      else passed++;
    });

    // 2. required captions when the figure is available (blocking).
    REQUIRED_FIGURE_CAPTIONS.forEach(function (t) {
      var fig = (PS.state.figures && PS.state.figures[t[2]]) || {};
      if (!fig.available) return;
      total++;
      var v = (get(t[0]) || "").trim();
      if (!v) issues.push({ level: "error", field: t[0], msg: "Missing: " + t[1] });
      else if (wc(v) < (t[3] || 1)) issues.push({ level: "error", field: t[0], msg: "Too short: " + t[1] });
      else passed++;
    });

    // 2b. each ADDED outcome needs its own interpretation + caption.
    var outcomes = (PS.state && PS.state.outcomes) || [];
    outcomes.forEach(function (oc) {
      // Illustrative demo outcomes are advisory only — they must NOT block a real
      // student's clean PDF or inflate the "sections to finish" count (round-2 review).
      var lvl = oc.illustrative ? "warn" : "error";
      if (oc.illustrative) {
        issues.push({ level: "warn", field: "studentText.oc_" + oc.id + "_interp", msg: oc.label + " is illustrative demo data — replace it with your real analysis or remove this outcome (it does not block your PDF)." });
        return;
      }
      total++;
      var iv = (get("studentText.oc_" + oc.id + "_interp") || "").trim();
      if (!iv) issues.push({ level: lvl, field: "studentText.oc_" + oc.id + "_interp", msg: "Missing: interpretation of " + oc.label });
      else if (wc(iv) < 15) issues.push({ level: lvl, field: "studentText.oc_" + oc.id + "_interp", msg: "Too short: interpretation of " + oc.label });
      else passed++;
      total++;
      var cv = (get("studentText.oc_" + oc.id + "_caption") || "").trim();
      if (!cv) issues.push({ level: lvl, field: "studentText.oc_" + oc.id + "_caption", msg: "Missing: caption for " + oc.label });
      else passed++;
    });

    // 2c. did the analysis silently drop included studies from pooling? (advisory)
    if (PS.state.analysis && PS.state.analysis.droppedStudies) {
      issues.push({ level: "warn", field: "studentText.forestInterpretation",
        msg: PS.state.analysis.droppedStudies + " included study(ies) were NOT pooled (e.g. event counts not extracted) — extract their data or say so in the paper." });
    }

    // 3. scan every field: placeholders (blocking) + overclaim/generic (advisory).
    var all = PS.allFieldValues ? PS.allFieldValues() : {};
    Object.keys(all).forEach(function (path) {
      var txt = all[path] || "";
      if (!txt.trim()) return;
      PLACEHOLDER_PATTERNS.forEach(function (re) {
        if (re.test(txt)) issues.push({ level: "error", field: path, msg: "Unresolved placeholder/blank in: " + shortName(path) });
      });
      var m, hitO = [];
      OVERCLAIM_RE.lastIndex = 0;
      while ((m = OVERCLAIM_RE.exec(txt))) { hitO.push(m[1]); if (hitO.length > 3) break; }
      if (hitO.length) {
        var blocking = !!BLOCKING_OVERCLAIM_FIELDS[path];
        issues.push({ level: blocking ? "error" : "warn", field: path,
          msg: (blocking ? "Overclaim must be fixed before a clean PDF" : "Possible overclaim") + " in " + shortName(path) + ' ("' + hitO.join('", "') + '"). Prefer "suggests", "may", "was associated with", "is compatible with".' });
      }
      var hitG = [];
      GENERIC_RE.lastIndex = 0;
      while ((m = GENERIC_RE.exec(txt))) { hitG.push(m[1]); if (hitG.length > 2) break; }
      if (hitG.length) issues.push({ level: "warn", field: path, msg: 'Generic phrasing in ' + shortName(path) + ' ("' + hitG.join('", "') + '"). Add the specific outcome, population, or effect size.' });
    });

    // 4. SUBSTANTIVE GATE (Phase 2b) — teach, do not templatise.
    // 4a. Anti-duplication: an essentially-unedited example starter is not your own writing.
    REQUIRED_STUDENT_FIELDS.forEach(function (f) {
      var v = (get(f[0]) || "").trim(); if (!v) return;
      var st = starterFor(f[0]); if (!st) return;
      if (similarity(v, st) >= 0.9) {
        issues.push({ level: "error", field: f[0], msg: "Write it in your own words — \"" + f[1] + "\" is still almost identical to the example. Change it to describe YOUR study." });
      }
    });
    // 4b. Significance vs the no-effect line: cannot claim "significant" when the CI crosses null.
    var a = (PS.state && PS.state.analysis) || {};
    var lci = num(a.ciLower), uci = num(a.ciUpper);
    var isRatio = /^(or|rr|hr)$|odds|risk ratio|hazard/i.test(String(a.effectMeasure || ""));
    var nullVal = isRatio ? 1 : 0;
    if (lci != null && uci != null && lci < nullVal && uci > nullVal) {
      var SIG = /\b(statistically\s+significant|significantly|significant|p\s*[<=]\s*0?\.0?5)\b/i;
      ["studentText.coverFinding", "studentText.abstractConclusion", "studentText.forestInterpretation", "studentText.discussionPrincipalFinding", "studentText.discussionConclusion"].forEach(function (fp) {
        if (SIG.test(get(fp) || "")) issues.push({ level: "error", field: fp, msg: "Your confidence interval crosses the no-effect line (" + nullVal + "), so the result is not statistically significant — reword it (for example: the data are also compatible with no difference)." });
      });
    }

    // de-dup identical messages
    var seen = {}, dd = [];
    issues.forEach(function (i) { var k = i.level + "|" + i.msg; if (!seen[k]) { seen[k] = 1; dd.push(i); } });

    var blocking = dd.filter(function (i) { return i.level === "error"; });
    return {
      mode: mode,
      ready: blocking.length === 0,
      issues: dd,
      blockingCount: blocking.length,
      passedChecks: passed,
      totalChecks: total || 1,
      score: Math.round((passed / (total || 1)) * 100)
    };
  };

  function shortName(path) { return path.split(".").pop(); }

  PS.readinessLevel = function (score) {
    if (score >= 90) return "Ready for clean PDF";
    if (score >= 70) return "Nearly ready";
    if (score >= 40) return "Needs interpretation";
    return "Draft started";
  };
})();
