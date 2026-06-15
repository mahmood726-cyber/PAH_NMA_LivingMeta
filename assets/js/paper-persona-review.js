/* paper-persona-review.js — Multi-persona peer review for the Evidence Paper Studio.
 *
 * Simulates the four reviewers a meta-analysis actually faces at a journal and
 * runs each one's real critique checklist against THIS paper's text + the
 * dashboard's analysis state. 100% offline, deterministic, no LLM — every
 * finding is a concrete, sourced "how journals criticise meta-analyses" rule
 * evaluated against PS.state / PS.getField, so the critique is specific to the
 * user's manuscript, not generic boilerplate.
 *
 * Personas: Methodologist (PRISMA / search / RoB), Statistician (heterogeneity /
 * model / small-study bias / PI), Clinical reviewer (PICO / applicability /
 * GRADE), Editor (reporting / overclaiming / transparency).
 *
 * Public: window.PaperPersonaReview.run()  — opens the review modal.
 */
(function (global) {
  'use strict';

  var PS = function () { return global.PaperStudio || global.PS || null; };

  // ---- data access (all guarded; empty string when unavailable) -------------
  function field(path) { var ps = PS(); return (ps && ps.getField ? ps.getField(path) : '') || ''; }
  function ana() { var ps = PS(); return (ps && ps.state && ps.state.analysis) || {}; }
  function pico() { var ps = PS(); return (ps && ps.state && ps.state.pico) || {}; }
  function outcomes() { var ps = PS(); return (ps && ps.state && ps.state.outcomes) || []; }
  function has(s) { return s && String(s).replace(/^\w+\.\s*$/, '').trim().length > 3; }
  function num(v) { var n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; }
  function lc(s) { return String(s || '').toLowerCase(); }

  // Does the combined manuscript text mention any of these terms?
  function corpus() {
    var ps = PS();
    var all = (ps && ps.allFieldValues) ? ps.allFieldValues() : {};
    var parts = [];
    for (var k in all) { if (Object.prototype.hasOwnProperty.call(all, k)) parts.push(String(all[k] || '')); }
    return lc(parts.join('  •  '));
  }
  function mentions(text, terms) {
    for (var i = 0; i < terms.length; i++) { if (text.indexOf(terms[i]) !== -1) return true; }
    return false;
  }

  // Is the headline CI compatible with "no effect"? (ratio measures null=1, diff null=0)
  function ciCrossesNull() {
    var x = ana(); var lo = num(x.ciLower), hi = num(x.ciUpper);
    if (lo === null || hi === null) return null;
    var measure = lc(x.effectMeasure);
    var nullVal = /\b(rr|or|hr|ratio|rom)\b/.test(measure) ? 1 : 0;
    return (lo <= nullVal && hi >= nullVal);
  }

  // ---- finding constructor --------------------------------------------------
  // severity: 'must' (reject/major-revision trigger), 'consider' (minor), 'ok' (strength)
  function F(severity, criticism, detail, fix) {
    return { severity: severity, criticism: criticism, detail: detail, fix: fix };
  }

  // ===========================================================================
  // PERSONA CHECKLISTS — each is "the complaint a reviewer of that kind makes",
  // evaluated against the real paper. Return an array of findings.
  // ===========================================================================

  function methodologist() {
    var t = corpus(), out = [];
    // Protocol / registration
    if (mentions(t, ['prospero', 'registered', 'registration', 'protocol was', 'pre-registered', 'preregister', 'osf.io']))
      out.push(F('ok', 'Protocol / registration', 'A protocol or registration is referenced — reviewers look for this first.'));
    else
      out.push(F('must', 'No protocol / PROSPERO registration', 'Editors increasingly desk-reject unregistered systematic reviews, and reviewers treat a missing protocol as a sign of post-hoc, outcome-switched analysis.', 'Register on PROSPERO (or OSF) and state the ID in Methods; note any deviations from protocol.'));
    // Search strategy
    if (mentions(t, ['medline', 'pubmed', 'embase', 'cochrane central', 'web of science', 'scopus', 'searched', 'search strategy', 'clinicaltrials.gov']))
      out.push(F('ok', 'Search described', 'Named databases / search approach present.'));
    else
      out.push(F('must', 'Search strategy not described', 'The #1 methods criticism: which databases, dates, and terms? An unreproducible search makes the review uninterpretable.', 'List every database + platform, the last search date, and supply the full strategy (at least one database verbatim) in a supplement.'));
    // Date of search / currency
    if (!mentions(t, ['search date', 'searched up to', 'last search', 'as of', 'through ' ]) && !/\b20\d\d\b/.test(t))
      out.push(F('consider', 'Search currency unclear', 'Reviewers ask "is this still current?" — a search > 12–24 months old invites an "out of date" critique.', 'State the last-search date; if old, justify or update.'));
    // Eligibility
    if (mentions(t, ['eligibility', 'inclusion criteria', 'exclusion criteria', 'pico', 'population', 'included studies if']))
      out.push(F('ok', 'Eligibility criteria', 'Inclusion/exclusion or PICO eligibility is stated.'));
    else
      out.push(F('consider', 'Eligibility criteria thin', 'Without explicit inclusion/exclusion rules, reviewers suspect cherry-picking.', 'State PICO-framed eligibility and any design/language/date limits.'));
    // Duplicate screening
    if (!mentions(t, ['two reviewers', 'independently', 'duplicate', 'in duplicate', 'second reviewer', 'dual']))
      out.push(F('consider', 'Single-reviewer screening risk', 'Reviewers expect duplicate, independent screening + extraction; solo screening is a recognised bias source.', 'State that two reviewers screened/extracted independently with disagreements resolved by discussion, or acknowledge as a limitation.'));
    // Risk of bias tool
    if (mentions(t, ['risk of bias', 'rob 2', 'rob2', 'robins', 'newcastle', 'quadas', 'amstar', 'cochrane risk']))
      out.push(F('ok', 'Risk-of-bias assessment', 'A named RoB tool is referenced.'));
    else
      out.push(F('must', 'No named risk-of-bias tool', 'A meta-analysis without a formal RoB assessment (RoB 2 for RCTs, ROBINS-I for NRS, QUADAS-2 for DTA) reads as uncritical.', 'Assess every included study with the appropriate tool and present a traffic-light figure.'));
    // PRISMA flow
    if (!mentions(t, ['prisma', 'flow diagram', 'records identified', 'records screened', 'studies included']))
      out.push(F('consider', 'PRISMA flow not evident', 'Reviewers want the records-identified → included counts to audit the search.', 'Include a PRISMA 2020 flow diagram and cite the checklist.'));
    return out;
  }

  function statistician() {
    var x = ana(), out = [];
    var i2 = num(x.i2), k = num(x.kStudies), tau2 = num(x.tau2);
    var t = corpus();
    var model = lc(x.model);

    // Heterogeneity magnitude + exploration
    if (i2 !== null && i2 >= 75) {
      out.push(F('must', 'Substantial heterogeneity (I² ≥ 75%) under-explored',
        'A pooled estimate over I²=' + Math.round(i2) + '% is the classic "apples and oranges" critique — reviewers ask why a single number is reported at all.',
        'Report τ² and a prediction interval, pre-specified subgroup/meta-regression for the heterogeneity source, and temper the headline claim; consider not pooling.'));
    } else if (i2 !== null) {
      out.push(F('ok', 'Heterogeneity reported', 'I² = ' + Math.round(i2) + '% is stated.'));
    } else {
      out.push(F('must', 'Heterogeneity not quantified', 'Reviewers require I² AND τ² — I² alone hides the absolute between-study variance.', 'Report I² with its CI and τ².'));
    }
    // I2 reported without tau2
    if (i2 !== null && tau2 === null)
      out.push(F('consider', 'I² without τ²', 'I² is a proportion, not an amount; reviewers note that low-k I² is imprecise and want τ² + its CI.', 'Add τ² (and a Q-profile CI) alongside I².'));
    // Small-k random-effects → HKSJ
    if (k !== null && k < 10 && /random/.test(model))
      out.push(F('consider', 'Small k with DerSimonian–Laird?', 'With k=' + k + ' (<10), DL underestimates uncertainty; a Wald CI on few studies is anticonservative — a standard statistical-reviewer flag.', 'Use REML/Paule-Mandel τ² with the Hartung-Knapp-Sidik-Jonkman (t_{k-1}) variance correction. (The dashboard engine already does this.)'));
    // Prediction interval
    if (k !== null && k >= 3 && !has(x.predictionInterval) && !mentions(t, ['prediction interval']))
      out.push(F('must', 'No prediction interval', 'For a random-effects model with heterogeneity, the CI of the mean is not where a future study will land — reviewers increasingly require the 95% prediction interval (IntHout 2016).', 'Report the t_{k-1} prediction interval and interpret it (does it cross the null?).'));
    // Small-study / publication bias
    if (k !== null && k >= 10 && !mentions(t, ['funnel', 'egger', 'publication bias', 'small-study', 'small study', 'peters', 'trim and fill', 'pet-peese']))
      out.push(F('must', 'Publication / small-study bias not assessed', 'With k=' + k + ' (≥10), reviewers expect a funnel plot + a formal small-study test; its absence reads as avoidance.', 'Add a contour-enhanced funnel + Egger (or Peters for binary), reported as a sensitivity analysis (never as the primary result).'));
    else if (k !== null && k < 10 && mentions(t, ['egger', 'funnel']))
      out.push(F('consider', 'Funnel/Egger with k<10', 'Funnel asymmetry tests are underpowered and unreliable below ~10 studies — a reviewer will say so.', 'Note the low power; do not interpret asymmetry tests at k<10 (use ROB-ME reasoning instead).'));
    // Fixed effect with heterogeneity
    if (/fixed/.test(model) && i2 !== null && i2 >= 50)
      out.push(F('must', 'Fixed-effect model despite heterogeneity', 'A fixed-effect pool at I²=' + Math.round(i2) + '% assumes one true effect — reviewers reject this when heterogeneity is present.', 'Use a random-effects model (or justify a common-effect assumption explicitly).'));
    // Overclaiming vs CI
    var crosses = ciCrossesNull();
    if (crosses === true && mentions(lc(field('studentText.abstractConclusion') + ' ' + field('studentText.discussionConclusion') + ' ' + field('studentText.discussionPrincipalFinding')), ['significant', 'effective', 'reduces', 'increases', 'benefit', 'superior']))
      out.push(F('must', 'Conclusion claims an effect a non-significant CI does not support', 'The headline CI includes the null, yet the conclusion asserts benefit/effect — the "spin" critique editors specifically watch for.', 'Reword to "no statistically significant difference" / "the evidence is uncertain"; match the verb to the certainty.'));
    // Unit-of-analysis / multi-arm
    if (outcomes().length === 0 && !mentions(t, ['unit of analysis', 'multi-arm', 'multiple arms', 'shared control', 'cluster']))
      out.push(F('consider', 'Unit-of-analysis issues unaddressed', 'Reviewers probe double-counting from multi-arm trials, multiple time points, or cluster designs.', 'State how multi-arm/cluster/multiple-outcome correlation was handled (e.g., shared-control covariance).'));
    return out;
  }

  function clinical() {
    var p = pico(), x = ana(), out = [], t = corpus();
    // PICO completeness
    var picoMissing = [];
    if (!has(p.population)) picoMissing.push('population');
    if (!has(p.intervention)) picoMissing.push('intervention');
    if (!has(p.comparator)) picoMissing.push('comparator');
    if (!has(p.primaryOutcome)) picoMissing.push('primary outcome');
    if (picoMissing.length)
      out.push(F('must', 'PICO incomplete (' + picoMissing.join(', ') + ')', 'A clinical reviewer cannot judge applicability without a fully specified PICO.', 'Specify population, intervention, comparator and a single named primary outcome.'));
    else
      out.push(F('ok', 'PICO specified', 'Population, intervention, comparator and primary outcome are all present.'));
    // Surrogate vs patient-important outcome
    var po = lc(p.primaryOutcome);
    if (po && /\b(level|score|biomarker|hba1c|ldl|blood pressure|egfr|surrogate|change in|reduction in)\b/.test(po) && !/\b(death|mortali|stroke|infarct|hospitali|fracture|event|failure|quality of life)\b/.test(po))
      out.push(F('consider', 'Primary outcome may be a surrogate', 'Reviewers downgrade reviews whose primary outcome is a lab/imaging surrogate rather than a patient-important endpoint.', 'Justify the surrogate or elevate a patient-important outcome (mortality, events, QoL); note indirectness in GRADE.'));
    // Clinical combinability
    if (!mentions(t, ['clinical heterogeneity', 'combinab', 'transitivity', 'similar enough', 'too different', 'clinically diverse', 'pooled across']))
      out.push(F('consider', 'Clinical combinability not discussed', 'Even with low statistical heterogeneity, reviewers ask whether the populations/interventions are clinically similar enough to pool.', 'Add a sentence justifying clinical combinability (or flagging where pooling stretches it).'));
    // Magnitude vs MCID
    if (!mentions(t, ['minimal important', 'mcid', 'clinically meaningful', 'clinically important', 'absolute risk', 'nnt', 'number needed']))
      out.push(F('consider', 'Effect not interpreted against clinical importance', 'A statistically significant pooled effect that is clinically trivial is a common reviewer complaint.', 'Interpret the effect against an MCID and present an absolute measure (risk difference / NNT), not just the relative effect.'));
    // GRADE / certainty
    if (has(x.certainty) || mentions(t, ['grade', 'certainty of evidence', 'quality of evidence', 'confidence in']))
      out.push(F('ok', 'Certainty of evidence', 'A GRADE/certainty judgement is present.'));
    else
      out.push(F('must', 'No certainty (GRADE) assessment', 'Clinical readers and guideline panels need a certainty rating; its absence is a major-revision trigger.', 'Add a GRADE Summary-of-Findings table rating certainty per outcome.'));
    // Applicability
    if (!mentions(t, ['applicab', 'generalis', 'generaliz', 'external validity', 'real-world', 'who do these results apply']))
      out.push(F('consider', 'Applicability / generalisability not addressed', 'Reviewers ask "to whom do these results apply?" — trial populations often differ from practice.', 'Add an applicability paragraph (settings, populations, doses the evidence does and does not cover).'));
    return out;
  }

  function editor() {
    var out = [], t = corpus();
    // Structured abstract completeness
    var absParts = ['abstractBackground', 'abstractObjective', 'abstractConclusion'];
    var absMissing = absParts.filter(function (k) { return !has(field('studentText.' + k)); });
    if (absMissing.length)
      out.push(F('consider', 'Structured abstract incomplete', 'Editors scan the structured abstract first; missing background/objective/results/conclusion looks unfinished.', 'Complete every structured-abstract heading; ensure the abstract result matches the body number exactly.'));
    else
      out.push(F('ok', 'Structured abstract', 'Background, objective and conclusion are present.'));
    // Overclaiming / proof language
    var concl = lc(field('studentText.abstractConclusion') + ' ' + field('studentText.discussionConclusion'));
    if (/\b(prove|proves|proven|definitive|conclusive|established beyond)\b/.test(concl))
      out.push(F('must', 'Overclaiming ("proves"/"definitive")', 'Editors flag absolute-certainty language as spin; meta-analysis supports, it does not prove.', 'Replace with calibrated verbs matched to certainty (High "reduces" → Very low "the evidence is very uncertain").'));
    // Limitations
    if (has(field('studentText.discussionLimitations')) || mentions(t, ['limitation']))
      out.push(F('ok', 'Limitations stated', 'A limitations discussion is present.'));
    else
      out.push(F('must', 'No limitations section', 'A review without an honest limitations paragraph is a near-automatic revision request.', 'Add limitations: study RoB, heterogeneity, small k, publication bias, surrogate outcomes, search constraints.'));
    // Spin: positive framing of a null result
    var crosses = ciCrossesNull();
    if (crosses === true && /\b(promising|favourable|favorable|trend toward|tendency|encouraging|may benefit)\b/.test(concl))
      out.push(F('consider', 'Possible spin on a null result', 'Editors specifically watch for positive spin when the primary result is non-significant.', 'Frame the null result plainly; reserve "promising" for pre-specified, significant findings.'));
    // Data / code availability
    if (!mentions(t, ['data availab', 'available on request', 'supplementary data', 'github', 'osf', 'reproduc', 'open data', 'code availab']))
      out.push(F('consider', 'No data/code availability statement', 'Journals now expect a data-availability statement and shareable analysis data.', 'Add a data-availability statement; share the extraction sheet + analysis script.'));
    // Conflicts / funding
    if (!mentions(t, ['conflict of interest', 'competing interest', 'no conflict', 'funding', 'no funding', 'declare']))
      out.push(F('consider', 'No conflicts / funding statement', 'A missing COI/funding declaration is a routine editorial-office bounce.', 'Add funding source and a competing-interests declaration.'));
    // Novelty / justification
    if (!mentions(t, ['no previous', 'previous review', 'existing review', 'updates', 'first to', 'why this review', 'gap', 'unlike prior']))
      out.push(F('consider', 'Justification vs existing reviews missing', 'Editors ask "why another review?" — overlap with existing syntheses without justification invites rejection.', 'State how this review differs from / updates prior syntheses (new trials, new method, unresolved question).'));
    return out;
  }

  var PERSONAS = [
    { key: 'methodologist', name: 'Methodologist', lens: 'PRISMA · search · risk of bias', icon: '⚖️', run: methodologist },
    { key: 'statistician', name: 'Statistician', lens: 'heterogeneity · model · small-study bias', icon: 'Σ', run: statistician },
    { key: 'clinical', name: 'Clinical reviewer', lens: 'PICO · applicability · GRADE', icon: '⚕️', run: clinical },
    { key: 'editor', name: 'Editor', lens: 'reporting · over-claiming · transparency', icon: '✎', run: editor }
  ];

  // ---- scoring + verdict ----------------------------------------------------
  function summarise(reports) {
    var must = 0, consider = 0, ok = 0;
    reports.forEach(function (r) { r.findings.forEach(function (f) {
      if (f.severity === 'must') must++; else if (f.severity === 'consider') consider++; else ok++;
    }); });
    var verdict, color;
    if (must === 0 && consider <= 2) { verdict = 'Ready to submit'; color = '#054f16'; }
    else if (must === 0) { verdict = 'Minor revisions'; color = '#0a972a'; }
    else if (must <= 3) { verdict = 'Major revisions'; color = '#b8893b'; }
    else { verdict = 'Reject / not ready'; color = '#9c2b27'; }
    return { must: must, consider: consider, ok: ok, verdict: verdict, color: color };
  }

  // ---- render ---------------------------------------------------------------
  var SEV = {
    must: { label: 'Must fix', color: '#9c2b27', bg: '#f7eceb' },
    consider: { label: 'Consider', color: '#9a6b14', bg: '#fbf3e2' },
    ok: { label: 'Strength', color: '#0a722a', bg: '#eaf6ec' }
  };
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function render(reports, sum) {
    var host = document.getElementById('ppr-modal');
    if (!host) { host = document.createElement('div'); host.id = 'ppr-modal'; host.className = 'example-modal'; document.body.appendChild(host); }
    var h = '';
    h += '<div class="example-modal-card" style="max-width:820px;">';
    h += '<div class="example-modal-head"><strong>Multi-persona peer review</strong>'
       + '<button type="button" onclick="document.getElementById(\'ppr-modal\').setAttribute(\'hidden\',\'\')">Close</button></div>';
    h += '<div class="example-modal-note" style="background:' + sum.color + '14;border-color:' + sum.color + '55;color:' + sum.color + ';">'
       + '<strong>Verdict: ' + sum.verdict + '</strong> &nbsp;—&nbsp; ' + sum.must + ' must-fix, ' + sum.consider + ' to consider, ' + sum.ok + ' strengths. '
       + 'Each item is a real way journals criticise meta-analyses, checked against your paper + analysis.</div>';
    reports.forEach(function (r) {
      h += '<div style="margin:1.1rem 0 0.2rem;border-top:1px solid #e5e7eb;padding-top:0.7rem;">';
      h += '<div style="font-weight:800;color:#054f16;font-size:1rem;">' + r.icon + ' ' + esc(r.name)
         + ' <span style="font-weight:500;color:#6f6f6a;font-size:0.8rem;">— ' + esc(r.lens) + '</span></div>';
      // sort: must, consider, ok
      var order = { must: 0, consider: 1, ok: 2 };
      r.findings.slice().sort(function (a, b) { return order[a.severity] - order[b.severity]; }).forEach(function (f) {
        var s = SEV[f.severity];
        h += '<div style="margin:0.45rem 0;padding:0.5rem 0.7rem;border-left:3px solid ' + s.color + ';background:' + s.bg + ';border-radius:0 6px 6px 0;">';
        h += '<div style="font-size:0.78rem;font-weight:800;color:' + s.color + ';text-transform:uppercase;letter-spacing:0.04em;">' + s.label + '</div>';
        h += '<div style="font-weight:700;color:#1d1d1b;font-size:0.92rem;margin-top:0.1rem;">' + esc(f.criticism) + '</div>';
        if (f.detail) h += '<div style="font-size:0.85rem;color:#39413a;margin-top:0.15rem;line-height:1.45;">' + esc(f.detail) + '</div>';
        if (f.fix) h += '<div style="font-size:0.85rem;color:#054f16;margin-top:0.2rem;line-height:1.45;"><strong>Fix:</strong> ' + esc(f.fix) + '</div>';
        h += '</div>';
      });
      h += '</div>';
    });
    h += '<div style="font-size:0.74rem;color:#6f6f6a;margin-top:1rem;border-top:1px solid #e5e7eb;padding-top:0.6rem;">'
       + 'Deterministic, offline review — these are heuristic checks of common reviewer/editor criticisms, not a guarantee of acceptance. Address must-fix items before submission.</div>';
    h += '</div>';
    host.innerHTML = h;
    host.removeAttribute('hidden');
  }

  function run() {
    if (!PS()) { if (global.alert) global.alert('Open the Paper Studio tab first.'); return; }
    var reports = PERSONAS.map(function (p) {
      var findings;
      try { findings = p.run() || []; } catch (e) { findings = [F('consider', p.name + ' review unavailable', String(e && e.message || e), 'Fill in more of the paper, then re-run.')]; }
      return { key: p.key, name: p.name, lens: p.lens, icon: p.icon, findings: findings };
    });
    render(reports, summarise(reports));
  }

  // ---- toolbar button injection --------------------------------------------
  function injectButton() {
    if (document.getElementById('btnPersonaReview')) return true;
    var bar = document.querySelector('.paper-toolbar');
    if (!bar) return false;
    var btn = document.createElement('button');
    btn.id = 'btnPersonaReview';
    btn.type = 'button';
    btn.textContent = '⚖️ Peer review';
    btn.title = 'Run a multi-persona peer review (methodologist, statistician, clinician, editor)';
    btn.addEventListener('click', run);
    // place after the title (before the download/more menus) when possible
    var anchor = bar.querySelector('.ps-save-status') || bar.querySelector('.download-menu') || null;
    if (anchor) bar.insertBefore(btn, anchor); else bar.appendChild(btn);
    return true;
  }

  // Journal-style toggle: Synthēsis (pretty default) ↔ Plain (for journals that
  // require unstyled manuscripts). The Word/Markdown/plain EXPORTERS are always
  // plain regardless — this only restyles the on-screen paper + the print/PDF.
  function injectThemeToggle() {
    if (document.getElementById('btnPaperTheme')) return true;
    var bar = document.querySelector('.paper-toolbar');
    if (!bar) return false;
    var canvas = document.getElementById('paperCanvas');
    var btn = document.createElement('button');
    btn.id = 'btnPaperTheme';
    btn.type = 'button';
    function label() { return (canvas && canvas.classList.contains('paper-synthesis')) ? '🅢 Synthēsis style' : '🅟 Plain style'; }
    btn.textContent = label();
    btn.title = 'Switch the paper between Synthēsis-journal style and plain style';
    btn.addEventListener('click', function () {
      if (canvas) canvas.classList.toggle('paper-synthesis');
      btn.textContent = label();
    });
    var anchor = bar.querySelector('.ps-save-status') || bar.querySelector('.download-menu') || null;
    if (anchor) bar.insertBefore(btn, anchor); else bar.appendChild(btn);
    return true;
  }

  function boot() {
    var a = injectButton(), b = injectThemeToggle();
    if (a && b) return;
    // toolbar may mount after the paper tab is first shown; retry briefly + on tab show
    var tries = 0;
    var iv = setInterval(function () {
      var done = injectButton() & injectThemeToggle();
      if (done || ++tries > 40) clearInterval(iv);
    }, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.PaperPersonaReview = { run: run, personas: PERSONAS };
})(typeof window !== 'undefined' ? window : this);
