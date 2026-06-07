/* RapidMeta Evidence Paper Studio — PDF export via the browser print path.
   The base RapidMeta app ships no PDF library (its own report uses window.print),
   so we stay 100% offline and mirror that approach. Clean vs Working is driven
   by a body class that the stylesheet honours. */
(function () {
  "use strict";
  window.PaperStudio = window.PaperStudio || {};
  var PS = window.PaperStudio;

  function injectPrintStyle() {
    var existing = document.getElementById("paper-pdf-print-style");
    if (existing) return existing;
    var st = document.createElement("style");
    st.id = "paper-pdf-print-style";
    st.textContent = [
      "@media print {",
      "  body { background:#fff !important; color:#000 !important; }",
      "  body * { visibility: hidden; }",
      "  #tab-paper, #tab-paper * { visibility: visible; }",
      "  #tab-paper { position:absolute; left:0; top:0; width:100%; background:#fff !important; }",
      "  #tab-paper .paper-canvas { box-shadow:none; border-radius:0; max-width:none; margin:0; padding:0 8mm; }",
      "  header, nav, .tab-btn, #stale-banner, #toast-container,",
      "  .paper-toolbar, .paper-sidebar, .learning-drawer, .paper-toast, .no-print { display:none !important; }",
      "  .paper-figure-card, table, figure, .evidence-summary-card, .clinical-question-card, .cover-summary-card {",
      "    break-inside: avoid; page-break-inside: avoid; }",
      "  h1,h2,h3 { break-after: avoid; page-break-after: avoid; }",
      "  a { color:#1e40af; text-decoration:none; }",
      "  @page { margin: 1.4cm; size: A4; }",
      "}"
    ].join("\n");
    document.head.appendChild(st);
    return st;
  }

  PS.downloadPaperPdf = function (opts) {
    opts = opts || {};
    var clean = opts.clean !== false; // default clean

    if (clean) {
      var check = PS.runReadinessCheck ? PS.runReadinessCheck("clean") : { ready: true, issues: [] };
      if (!check.ready) {
        if (PS.showReadinessModal) PS.showReadinessModal(check);
        if (PS.toast) PS.toast("Clean PDF needs the required fields first — see the checklist.");
        return false;
      }
    }

    document.body.classList.toggle("export-clean-pdf", clean);
    document.body.classList.toggle("export-working-pdf", !clean);
    injectPrintStyle();

    // Force the canvas to WRITE mode for BOTH exports. Otherwise a prior "Preview
    // clean paper" leaves paper-mode-preview on, and a Working PDF would silently
    // drop all scaffolding (task labels, learning rows) — defeating its purpose.
    var canvas = document.getElementById("paperCanvas");
    var prevMode = canvas ? (canvas.classList.contains("paper-mode-preview") ? "preview" : "write") : null;
    if (canvas) { canvas.classList.remove("paper-mode-preview"); canvas.classList.add("paper-mode-write"); }

    // Normalize empties so :empty hides them, and hide captions left blank.
    var restore = normalizeEmpties(clean);

    // make sure the paper tab is visible so print can capture it
    var tab = document.getElementById("tab-paper");
    var wasHidden = tab && tab.classList.contains("hidden");
    if (wasHidden) tab.classList.remove("hidden");

    if (PS.toast) PS.toast("Opening the print dialog — choose “Save as PDF”. Suggested name: " +
      (clean ? "rapidmeta-short-evidence-paper.pdf" : "rapidmeta-working-paper.pdf"));

    setTimeout(function () {
      window.print();
      setTimeout(function () {
        document.body.classList.remove("export-clean-pdf", "export-working-pdf");
        if (canvas && prevMode) { canvas.classList.remove("paper-mode-write", "paper-mode-preview"); canvas.classList.add("paper-mode-" + prevMode); }
        restore();
        if (wasHidden && tab) tab.classList.add("hidden");
      }, 400);
    }, 120);
    return true;
  };

  // A typed-then-cleared box keeps a stray <br>/whitespace so :empty won't match,
  // and an untouched caption prints "Caption / interpretation:" with nothing after.
  // Blank such fields' innerHTML (so :empty matches) and hide empty caption rows.
  function normalizeEmpties(clean) {
    var touched = [], hiddenCaps = [];
    document.querySelectorAll('#paperCanvas [data-field]').forEach(function (el) {
      if ((el.textContent || "").trim() === "" && el.innerHTML !== "") { touched.push([el, el.innerHTML]); el.innerHTML = ""; }
      if (clean) {
        var cap = el.closest("figcaption");
        if (cap && (el.textContent || "").trim() === "") { hiddenCaps.push([cap, cap.style.display]); cap.style.display = "none"; }
      }
    });
    return function () {
      touched.forEach(function (p) { p[0].innerHTML = p[1]; });
      hiddenCaps.forEach(function (p) { p[0].style.display = p[1] || ""; });
    };
  }
})();
