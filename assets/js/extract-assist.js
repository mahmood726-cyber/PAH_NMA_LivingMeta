/* extract-assist.js — offline "paste-to-extract" helper for the Extraction tab.
 *
 * Self-mounts a tool into #tab-extract that turns pasted abstract / results text
 * into structured effect estimates (RR / OR / HR + 95% CI) using the R-validated
 * regex extractor vendored from allmeta (window.RctRegexExtract). 100% offline,
 * no network, no LLM. Strong anti-fabrication guards in the engine (a year is not
 * an estimate; the point must sit inside its own CI; inverted/degenerate CIs are
 * dropped). The reviewer copies the extracted numbers into the data-entry fields —
 * the tool never auto-writes trial data, keeping extraction human-checked.
 */
(function (global) {
  'use strict';
  var MOUNT_ID = 'extract-assist-card';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function run(textarea, out) {
    var eng = global.RctRegexExtract;
    if (!eng || typeof eng.extract !== 'function') { out.innerHTML = '<div style="color:#fca5a5;">Extractor engine not loaded.</div>'; return; }
    var rows = [];
    try { rows = eng.extract(textarea.value || '') || []; } catch (e) { rows = []; }
    if (!rows.length) {
      out.innerHTML = '<div style="color:#94a3b8;font-size:12px;">No effect estimates found. Paste a sentence like “hazard ratio 0.87 (95% CI 0.76–0.98)”. Counts/2×2 tables are entered by hand below.</div>';
      return;
    }
    // Sort by confidence desc.
    rows.sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); });
    var h = '<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin:8px 0 6px;">' + rows.length + ' estimate(s) found — verify against the source, then copy into the fields below</div>';
    h += '<table style="width:100%;font-size:12px;border-collapse:collapse;color:#e2e8f0;">';
    h += '<thead><tr style="color:#94a3b8;text-align:left;"><th style="padding:3px 6px;">Measure</th><th style="padding:3px 6px;">Estimate</th><th style="padding:3px 6px;">95% CI</th><th style="padding:3px 6px;">p</th><th style="padding:3px 6px;">conf.</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var lvl = r.ci_level && r.ci_level !== 0.95 ? Math.round(r.ci_level * 100) + '%' : '';
      h += '<tr style="border-top:1px solid #1e293b;">'
        + '<td style="padding:3px 6px;font-weight:700;color:#7dd3fc;">' + esc(r.effect_type) + '</td>'
        + '<td style="padding:3px 6px;font-family:monospace;">' + esc(r.point_estimate) + '</td>'
        + '<td style="padding:3px 6px;font-family:monospace;">' + esc(r.ci.lower) + ' – ' + esc(r.ci.upper) + (lvl ? ' <span style="color:#94a3b8;">(' + lvl + ')</span>' : '') + '</td>'
        + '<td style="padding:3px 6px;font-family:monospace;color:#94a3b8;">' + (r.p_value != null ? esc(r.p_value) : '—') + '</td>'
        + '<td style="padding:3px 6px;color:' + ((r.confidence || 0) >= 0.9 ? '#34d399' : '#fbbf24') + ';">' + Math.round((r.confidence || 0) * 100) + '%</td>'
        + '</tr>';
      if (r.source_text) h += '<tr><td colspan="5" style="padding:0 6px 4px;font-size:10.5px;color:#64748b;font-style:italic;">“…' + esc(r.source_text) + '…”</td></tr>';
    });
    h += '</tbody></table>';
    h += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;border-top:1px solid #1e293b;padding-top:6px;">'
      + 'Regex extraction (allmeta RctRegexExtract) with anti-fabrication guards — a found number is never auto-entered; confirm it against the source and type it into the matching field. For a ratio measure use it as <code>publishedHR / hrLCI / hrUCI</code> (or RR/OR per the estimand).</div>';
    out.innerHTML = h;
  }

  function buildCard() {
    var card = document.createElement('div');
    card.id = MOUNT_ID;
    card.style.cssText = 'background:rgba(15,23,42,0.6);border:1px solid #334155;border-radius:18px;padding:18px 20px;color:#e2e8f0;';
    card.innerHTML =
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#22d3ee;margin-bottom:6px;">'
      + '<i class="fa-solid fa-wand-magic-sparkles" style="margin-right:6px;"></i>Quick extract from pasted text (offline)</div>'
      + '<div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">Paste an abstract or results sentence; the tool surfaces the reported effect estimates + CIs for you to verify and copy in. No data leaves the browser.</div>'
      + '<textarea id="ea-input" rows="3" placeholder="e.g. The hazard ratio for the primary outcome was 0.87 (95% CI, 0.76 to 0.98)." style="width:100%;background:#0b1220;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-size:13px;padding:8px 10px;resize:vertical;"></textarea>'
      + '<div style="margin-top:8px;"><button id="ea-run" type="button" style="background:#0891b2;color:#fff;border:none;border-radius:8px;padding:7px 16px;font-size:13px;font-weight:700;cursor:pointer;">Extract estimates</button></div>'
      + '<div id="ea-out" style="margin-top:8px;"></div>';
    return card;
  }

  function mount() {
    if (document.getElementById(MOUNT_ID)) return true;
    var tab = document.getElementById('tab-extract');
    if (!tab) return false;
    var host = tab.querySelector('.max-w-5xl') || tab;
    var card = buildCard();
    host.insertBefore(card, host.firstChild);
    var input = card.querySelector('#ea-input'), out = card.querySelector('#ea-out');
    card.querySelector('#ea-run').addEventListener('click', function () { run(input, out); });
    return true;
  }

  function boot() {
    if (mount()) return;
    var tries = 0;
    var iv = setInterval(function () { if (mount() || ++tries > 40) clearInterval(iv); }, 300);
  }
  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.ExtractAssist = { mount: mount, run: run };
})(typeof window !== 'undefined' ? window : this);
