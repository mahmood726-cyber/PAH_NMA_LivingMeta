/* RapidMeta Evidence Paper Studio — learning links + drawer.
   Short "how to read this" cards that link out to the Synthesis course.
   Course URLs are placeholders; edit SYNTHESIS_BASE_URL / per-lesson url. */
(function () {
  "use strict";
  window.PaperStudio = window.PaperStudio || {};
  var PS = window.PaperStudio;

  // Synthesis Course Collection (live, multilingual, slide-based courses).
  // Each topic deep-links to the most relevant whole course via its `url`.
  // Slides are in-app state (no URL anchor), so we link to the course file.
  PS.SYNTHESIS_BASE_URL = PS.SYNTHESIS_BASE_URL || "https://mahmood726-cyber.github.io/synthesis-courses/";
  var C = PS.SYNTHESIS_BASE_URL;

  PS.SYNTHESIS_LESSONS = {
    forest_plot: {
      label: "What is a forest plot?",
      short: "A forest plot shows the result of each study and the pooled estimate. Focus on the direction of effect, the confidence intervals, and how consistent the studies are.",
      commonMistake: "Do not only write 'significant' or 'not significant'. Explain the size, the uncertainty, and the clinical meaning of the effect.",
      url: C + "meta-analysis-methods-course.html"
    },
    heterogeneity: {
      label: "What is heterogeneity?",
      short: "Studies rarely give exactly the same answer. Heterogeneity describes how much they differ. I² is roughly the percentage of that difference that looks like genuine variation rather than random chance: near 0% the studies mostly agree, near 100% they vary a lot. With only a few studies, a low I² can simply mean there were too few to detect a difference.",
      commonMistake: "Do not say high heterogeneity makes the review useless, and do not treat I²=0% as proof the studies agree. Explain why studies may differ, and look at τ² and the prediction interval too.",
      url: C + "meta-analysis-methods-course.html"
    },
    confidence_interval: {
      label: "What is a confidence interval?",
      short: "A confidence interval is the range of effect sizes that are compatible with your data. Narrow intervals are more precise; wide intervals are less precise. Whether it crosses the no-effect line (1 for ratios, 0 for differences) tells you about direction, not precision.",
      commonMistake: "Do not treat the point estimate as the only result — the interval is part of the result. And do not read a CI that crosses the no-effect line as proof the treatment does nothing; it just means the data are compatible with a range that includes no effect.",
      url: C + "meta-analysis-methods-course.html"
    },
    effect_size: {
      label: "What is an effect size?",
      short: "An effect size summarises how large the difference is between groups. Interpretation depends on whether it is a risk ratio, odds ratio, hazard ratio, mean difference, or standardised mean difference.",
      commonMistake: "Do not compare different effect measures as if they mean the same thing. And a statistically significant effect is not proof the treatment works — always pair the size with the GRADE certainty.",
      url: C + "meta-analysis-methods-course.html"
    },
    risk_of_bias: {
      label: "What is risk of bias?",
      short: "Risk of bias asks whether the study methods may systematically distort the estimated effect.",
      commonMistake: "Do not call this 'study quality' in a vague way. Link each bias domain to how it could affect the result.",
      url: C + "risk-of-bias-mastery-course.html"
    },
    grade: {
      label: "What is GRADE certainty?",
      short: "GRADE describes how confident we are that the estimated effect is close to the true effect. Evidence can be downgraded for bias, inconsistency, indirectness, imprecision, or publication bias.",
      commonMistake: "Do not confuse certainty of evidence with size of effect.",
      url: C + "grade-certainty-course.html"
    },
    funnel_plot: {
      label: "What is a funnel plot?",
      short: "A funnel plot helps explore whether small studies are missing, which can be a sign of publication bias. It is unreliable when there are few studies.",
      commonMistake: "Do not read asymmetry as proof of publication bias — it can also come from real differences between studies, study quality, or chance. And do not over-interpret funnel plots with fewer than about 10 studies.",
      url: C + "publication-bias-detective.html"
    },
    prisma: {
      label: "What is a PRISMA flow diagram?",
      short: "A PRISMA flow diagram shows how records moved from search results to included studies.",
      commonMistake: "Do not hide exclusions. The flow diagram is part of review transparency.",
      url: C + "meta-analysis-methods-course.html"
    },
    clinical_importance: {
      label: "How big is “clinically big”?",
      short: "There is no universal cut-off for when an effect matters in practice. Ask: would this change the choice a doctor or patient makes? A small relative change can matter a lot for a common, serious outcome, and a large relative change can matter little for a rare or mild one. If you are unsure, say the size is uncertain and flag it for your supervisor — that is honest, not weak.",
      commonMistake: "Do not call a statistically significant result “clinically important” by default. Significance is about chance; clinical importance is about whether the size of the effect changes care.",
      url: C + "meta-analysis-methods-course.html"
    },
    pooling: {
      label: "What does “pooled” mean?",
      short: "“Pooling” means combining the results of all the included studies into one overall estimate. The “pooled estimate” is that single combined result — it carries more weight than any one study because it uses all the data together.",
      commonMistake: "Do not treat the pooled estimate as a fact that applies identically to every patient or setting — it is an average across studies that themselves varied.",
      url: C + "meta-analysis-methods-course.html"
    },
    prediction_interval: {
      label: "What is a prediction interval?",
      short: "A prediction interval estimates where the effect of a future similar study might lie. Whenever the studies vary, it is wider than the confidence interval, because it also accounts for that real variation. It needs at least a few studies (about 3 or more) to be meaningful.",
      commonMistake: "Do not treat the pooled effect as if every setting will have the same result.",
      url: C + "advanced-meta-analysis-course.html"
    }
  };

  PS.openLearningDrawer = function (key, opener) {
    var lesson = PS.SYNTHESIS_LESSONS[key];
    if (!lesson) return;
    var t = document.getElementById("learningTitle");
    var s = document.getElementById("learningShort");
    var m = document.getElementById("learningMistake");
    var link = document.getElementById("learningCourseLink");
    if (t) t.textContent = lesson.label;
    if (s) s.textContent = lesson.short;
    if (m) m.textContent = lesson.commonMistake;
    if (link) {
      // Use an explicit per-lesson deep-link if provided, else the Synthēsis home.
      // We do NOT auto-append lesson.slug — those course pages are not confirmed,
      // so a fabricated path would 404. Set lesson.url when the real page exists.
      link.href = lesson.url || PS.SYNTHESIS_BASE_URL;
      link.textContent = "Open full Synthēsis lesson";
    }
    var drawer = document.getElementById("learningDrawer");
    if (!drawer) return;
    lastOpener = opener || document.activeElement; // remember who opened it
    setBackgroundInert(true);                     // hide the app from AT + Tab
    drawer.hidden = false;
    var close = document.getElementById("closeLearningDrawer");
    if (close) { try { close.focus(); } catch (e) {} }
  };

  PS.closeLearningDrawer = function () {
    var drawer = document.getElementById("learningDrawer");
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    setBackgroundInert(false);
    // Return focus to the opener if it is still visible; otherwise don't strand focus.
    if (lastOpener && lastOpener.focus && lastOpener.offsetParent !== null) { try { lastOpener.focus(); } catch (e) {} }
    lastOpener = null;
  };

  var lastOpener = null;
  function appMain() { return document.querySelector("main") || document.body; }
  function setBackgroundInert(on) {
    var m = appMain();
    if (!m) return;
    if (on) { m.setAttribute("aria-hidden", "true"); try { m.inert = true; } catch (e) {} }
    else { m.removeAttribute("aria-hidden"); try { m.inert = false; } catch (e) {} }
  }
  function drawerOpen() { var d = document.getElementById("learningDrawer"); return d && !d.hidden; }
  function focusables(d) {
    return Array.prototype.slice.call(d.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return el.offsetParent !== null; });
  }

  // Event delegation for any [data-learn] button + close button + Escape.
  document.addEventListener("click", function (event) {
    var closeBtn = event.target.closest("#closeLearningDrawer");
    if (closeBtn) { PS.closeLearningDrawer(); return; }
    var btn = event.target.closest("[data-learn]");
    if (btn) { event.preventDefault(); PS.openLearningDrawer(btn.dataset.learn, btn); }
  });
  document.addEventListener("keydown", function (e) {
    if (!drawerOpen()) return;
    if (e.key === "Escape") { PS.closeLearningDrawer(); return; }
    if (e.key === "Tab") {                        // trap focus inside the drawer
      var d = document.getElementById("learningDrawer");
      var f = focusables(d);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
})();
