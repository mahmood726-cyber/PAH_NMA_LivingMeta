/* RapidMeta Evidence Paper Studio — submittable supplementary materials.
   Generates PRISMA 2020, AMSTAR-2 and a search-strategy supplement as
   downloadable files (Markdown + Word-openable .doc). Items the tool can fill
   from the analysis are pre-filled; the rest are left for the student. Offline. */
(function () {
  "use strict";
  window.PaperStudio = window.PaperStudio || {};
  var PS = window.PaperStudio;

  function dl(name, text, mime) {
    var blob = new Blob([mime === "application/msword" ? "﻿" + text : text], { type: (mime || "text/plain") + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  function g(path) { return (PS.getField ? PS.getField(path) : "") || ""; }

  // PRISMA 2020 — 27-item checklist (section, no., item).
  var PRISMA = [
    ["TITLE", "1", "Identify the report as a systematic review."],
    ["ABSTRACT", "2", "See the PRISMA 2020 for Abstracts checklist."],
    ["INTRODUCTION", "3", "Rationale: describe the rationale for the review in the context of existing knowledge."],
    ["INTRODUCTION", "4", "Objectives: provide an explicit statement of the objective(s) or question(s) the review addresses."],
    ["METHODS", "5", "Eligibility criteria: specify the inclusion and exclusion criteria and how studies were grouped for syntheses."],
    ["METHODS", "6", "Information sources: specify all databases, registers, websites, etc.; specify the date each was last searched."],
    ["METHODS", "7", "Search strategy: present the full search strategy for all databases, registers and websites."],
    ["METHODS", "8", "Selection process: specify the methods used to decide whether a study met the inclusion criteria."],
    ["METHODS", "9", "Data collection process: specify the methods used to collect data from reports."],
    ["METHODS", "10", "Data items: list and define all outcomes and all other variables for which data were sought."],
    ["METHODS", "11", "Study risk of bias assessment: specify the methods used to assess risk of bias, including the tool(s)."],
    ["METHODS", "12", "Effect measures: specify for each outcome the effect measure(s) used in the synthesis or presentation."],
    ["METHODS", "13", "Synthesis methods: describe processes to decide which studies were eligible for each synthesis; methods to prepare/synthesise data, including the model and heterogeneity assessment."],
    ["METHODS", "14", "Reporting bias assessment: describe methods to assess risk of bias due to missing results."],
    ["METHODS", "15", "Certainty assessment: describe methods used to assess certainty (confidence) in the body of evidence (e.g. GRADE)."],
    ["RESULTS", "16", "Study selection: describe results of the search and selection (ideally a flow diagram)."],
    ["RESULTS", "17", "Study characteristics: cite each included study and present its characteristics."],
    ["RESULTS", "18", "Risk of bias in studies: present assessments of risk of bias for each included study."],
    ["RESULTS", "19", "Results of individual studies: present each study's summary statistics and effect estimate (ideally a forest plot)."],
    ["RESULTS", "20", "Results of syntheses: present results of each synthesis, including summary estimate, precision and heterogeneity."],
    ["RESULTS", "21", "Reporting biases: present assessments of risk of bias due to missing results."],
    ["RESULTS", "22", "Certainty of evidence: present assessments of certainty for each outcome."],
    ["DISCUSSION", "23", "Discussion: general interpretation, limitations, and implications."],
    ["OTHER", "24", "Registration and protocol: registration name/number or statement that the review was not registered."],
    ["OTHER", "25", "Support: describe sources of financial or non-financial support and the role of funders."],
    ["OTHER", "26", "Competing interests: declare any competing interests."],
    ["OTHER", "27", "Availability of data, code and other materials: report which materials are publicly available and where."]
  ];

  // AMSTAR-2 — 16 items.
  var AMSTAR2 = [
    "Did the research questions and inclusion criteria include the components of PICO?",
    "Did the report contain an explicit statement that the review methods were established prior to the conduct of the review (protocol/registration)?",
    "Did the review authors explain their selection of the study designs for inclusion?",
    "Did the review authors use a comprehensive literature search strategy?",
    "Did the review authors perform study selection in duplicate?",
    "Did the review authors perform data extraction in duplicate?",
    "Did the review authors provide a list of excluded studies and justify the exclusions?",
    "Did the review authors describe the included studies in adequate detail?",
    "Did the review authors use a satisfactory technique for assessing the risk of bias (RoB) in individual studies?",
    "Did the review authors report on the sources of funding for the studies included in the review?",
    "If meta-analysis was performed, did the review authors use appropriate methods for statistical combination of results?",
    "If meta-analysis was performed, did the review authors assess the potential impact of RoB in individual studies on the results?",
    "Did the review authors account for RoB in individual studies when interpreting/discussing the results?",
    "Did the review authors provide a satisfactory explanation for, and discussion of, any heterogeneity observed?",
    "If they performed quantitative synthesis did the review authors carry out an adequate investigation of publication bias (small study bias) and discuss its likely impact?",
    "Did the review authors report any potential sources of conflict of interest, including any funding they received for conducting the review?"
  ];

  function prismaText() {
    var lines = ["# PRISMA 2020 checklist", "", "Paper: " + (g("studentText.title") || "(untitled)"),
      "Complete the 'Location' column with the page/section where each item is reported.", "",
      "| # | Section | Item | Location in manuscript |", "|---|---------|------|------------------------|"];
    var loc = {
      "4": "Introduction (objective)", "5": "Methods", "6": "Methods (information sources)",
      "13": "Methods (synthesis)", "15": "Methods (certainty / GRADE)", "16": "Results — Study selection (PRISMA flow)",
      "19": "Results — forest plots", "20": "Results", "22": "Results — Certainty of evidence", "23": "Discussion"
    };
    PRISMA.forEach(function (r) { lines.push("| " + r[1] + " | " + r[0] + " | " + r[2].replace(/\|/g, "/") + " | " + (loc[r[1]] || "____") + " |"); });
    lines.push("", "Reference: Page MJ, et al. The PRISMA 2020 statement. BMJ 2021;372:n71.");
    return lines.join("\n");
  }
  function amstarText() {
    var lines = ["# AMSTAR-2 appraisal", "", "Paper: " + (g("studentText.title") || "(untitled)"),
      "Rate each item: Yes / Partial Yes / No. Items 2, 4, 7, 9, 11, 13, 15 are critical domains.", ""];
    AMSTAR2.forEach(function (q, i) { lines.push((i + 1) + ". " + q + "  \n   Rating: ______"); });
    lines.push("", "Reference: Shea BJ, et al. AMSTAR 2. BMJ 2017;358:j4008.");
    return lines.join("\n");
  }
  function searchText() {
    var s = PS.state.search || {}, pic = PS.state.pico || {};
    return ["# Search strategy (supplement)", "", "Paper: " + (g("studentText.title") || "(untitled)"), "",
      "Databases searched: " + (s.databases || "____"),
      "Date last searched: " + (s.searchDate || "____"),
      "", "Population: " + (pic.population || "____"),
      "Intervention: " + (pic.intervention || "____"),
      "Comparator: " + (pic.comparator || "____"),
      "Primary outcome: " + (pic.primaryOutcome || "____"),
      "", "Example search concept blocks (edit to your exact strategy):",
      "1. " + (pic.intervention || "[intervention]") + " OR synonyms",
      "2. " + (pic.population || "[condition]") + " OR synonyms",
      "3. Randomized controlled trial filter",
      "4. 1 AND 2 AND 3",
      "", "Record the full line-by-line strategy for each database here."].join("\n");
  }

  function mdToHtmlDoc(title, md) {
    var body = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/^# (.*)$/gm, "<h1>$1</h1>").replace(/^\| (.*)\|$/gm, function (m) { return "<div>" + m + "</div>"; })
      .replace(/\n/g, "<br>");
    return "<!DOCTYPE html><html><head><meta charset='utf-8'><title>" + title + "</title></head><body style='font-family:Georgia,serif;font-size:12pt'>" + body + "</body></html>";
  }

  PS.exportSupplementary = function (which, asWord) {
    var map = { prisma: ["PRISMA-2020-checklist", prismaText], amstar: ["AMSTAR-2-appraisal", amstarText], search: ["search-strategy", searchText] };
    var e = map[which]; if (!e) return;
    var text = e[1]();
    if (asWord) dl(e[0] + ".doc", mdToHtmlDoc(e[0], text), "application/msword");
    else dl(e[0] + ".md", text, "text/markdown");
    if (PS.toast) PS.toast(e[0] + " downloaded.");
  };
  // expose text builders so the submission bundle can include them
  PS._supplementaryFiles = function () {
    return [
      { name: "supplementary/PRISMA-2020-checklist.md", text: prismaText() },
      { name: "supplementary/AMSTAR-2-appraisal.md", text: amstarText() },
      { name: "supplementary/search-strategy.md", text: searchText() }
    ];
  };
})();
