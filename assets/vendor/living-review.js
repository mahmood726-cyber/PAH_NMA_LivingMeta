/* living-review.js — user-triggered living-update workflow.
 *
 * No schedule. User clicks "Run Living Update", we fetch new PubMed
 * results for the topic's search query, auto-screen via regex, and
 * present each new candidate for user attest/correct/remove.
 *
 * Workflow:
 *   1. User clicks button. Modal appears with editable PubMed query
 *      (defaulted from existing Search Strategy section).
 *   2. On submit: esearch.fcgi for matching PMIDs (filter publication
 *      type = Randomized Controlled Trial; restrict to last 24 mo by
 *      default).
 *   3. Subtract PMIDs already present in realData.
 *   4. efetch.fcgi for new PMIDs to get title + abstract + DataBankList.
 *   5. Auto-screen via regex: include if title contains drug keyword AND
 *      condition keyword; otherwise mark "review needed".
 *   6. For each remaining candidate, render attest card with:
 *        - Title, abstract excerpt (first 600 chars), DataBankList NCT
 *        - Auto-extracted values (sample size, HR, CI) where regex finds
 *        - 4 actions: ACCEPT / REJECT / SKIP / REMOVE-EXISTING
 *   7. On ACCEPT, save to RapidMeta.state.livingUpdates[] with
 *      timestamp + reviewer + action + pmid + nct + extracted values.
 *      DO NOT auto-add to realData — flag as pending full extraction.
 *   8. Badge updates to show "LIVING / {date} / {reviewerId}".
 *
 * Public API (window.LivingReview):
 *   open()        — show the modal
 *   getRunLog()   — returns RapidMeta.state.livingUpdates
 *   getLastRun()  — returns most-recent ts + reviewerId
 */
(function (global) {
  'use strict';

  const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

  function getState() {
    if (!global.RapidMeta) return null;
    if (!global.RapidMeta.state) return null;
    if (!Array.isArray(global.RapidMeta.state.livingUpdates)) {
      global.RapidMeta.state.livingUpdates = [];
    }
    return global.RapidMeta.state;
  }

  function saveState() {
    try {
      if (global.RapidMeta && global.RapidMeta.save) global.RapidMeta.save();
    } catch (e) {}
  }

  function existingPmids() {
    const out = new Set();
    const rd = global.RapidMeta && global.RapidMeta.realData;
    if (rd) {
      Object.values(rd).forEach(t => {
        if (t && t.pmid) out.add(String(t.pmid));
      });
    }
    const trials = (global.RapidMeta && global.RapidMeta.state && global.RapidMeta.state.trials) || [];
    trials.forEach(t => {
      if (t && t.pmid) out.add(String(t.pmid));
      if (t && t.data && t.data.pmid) out.add(String(t.data.pmid));
    });
    return out;
  }

  function defaultQuery() {
    // Pull from existing search-box if present
    const box = document.querySelector('input[type="search"], #search-query, textarea[placeholder*="search"]');
    if (box && box.value) return box.value;
    // Fall back to filename keywords
    const root = location.pathname.split('/').pop().replace('_REVIEW.html', '').replace('_NMA', '');
    const parts = root.split('_').filter(p => p.length > 2);
    return parts.join(' AND ') + ' AND randomized';
  }

  function getReviewerId() {
    return (global.RapidMeta && global.RapidMeta.state && global.RapidMeta.state.reviewerId) || '';
  }

  // ----- PubMed eutils -----

  async function esearch(query, retmax) {
    const url = EUTILS + '/esearch.fcgi?db=pubmed&term=' + encodeURIComponent(query) +
      '&retmax=' + (retmax || 50) + '&retmode=json&sort=date';
    const r = await fetch(url);
    if (!r.ok) throw new Error('esearch failed: ' + r.status);
    const j = await r.json();
    return (j.esearchresult && j.esearchresult.idlist) || [];
  }

  async function efetch(pmids) {
    if (!pmids.length) return [];
    const url = EUTILS + '/efetch.fcgi?db=pubmed&id=' + pmids.join(',') + '&retmode=xml';
    const r = await fetch(url);
    if (!r.ok) throw new Error('efetch failed: ' + r.status);
    const xml = await r.text();
    return parsePubmedXml(xml);
  }

  function parsePubmedXml(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const articles = doc.querySelectorAll('PubmedArticle');
    const out = [];
    articles.forEach(art => {
      const pmid = art.querySelector('PMID') ? art.querySelector('PMID').textContent : '';
      const title = art.querySelector('ArticleTitle') ? art.querySelector('ArticleTitle').textContent : '';
      // Year
      let year = '';
      const ye = art.querySelector('PubDate Year, ArticleDate Year');
      if (ye) year = ye.textContent;
      // Abstract
      const abstractEls = art.querySelectorAll('Abstract AbstractText');
      const abstractText = Array.from(abstractEls).map(e => {
        const label = e.getAttribute('Label');
        return (label ? label + ': ' : '') + e.textContent;
      }).join('\n');
      // PubTypes
      const pubtypes = Array.from(art.querySelectorAll('PublicationType')).map(e => e.textContent);
      // DataBankList NCTs
      const ncts = [];
      art.querySelectorAll('DataBank').forEach(db => {
        const name = db.querySelector('DataBankName');
        if (name && /clinicaltrials/i.test(name.textContent || '')) {
          db.querySelectorAll('AccessionNumber').forEach(an => {
            if (an.textContent) ncts.push(an.textContent.trim());
          });
        }
      });
      // Journal
      const journal = art.querySelector('Journal Title');
      out.push({
        pmid, title, year, abstract: abstractText, pubtypes, ncts,
        journal: journal ? journal.textContent : ''
      });
    });
    return out;
  }

  // ----- Auto-screen + auto-extract regex -----

  function autoScreen(article, includeKws, excludeKws) {
    const t = (article.title + ' ' + article.abstract).toLowerCase();
    // Must be RCT-shaped
    const isRCT = article.pubtypes.some(pt => /randomized|rct|clinical trial/i.test(pt));
    const hasInclude = includeKws.length === 0 ||
      includeKws.some(k => t.includes(k.toLowerCase()));
    const hasExclude = excludeKws.some(k => t.includes(k.toLowerCase()));
    if (!isRCT) return { decision: 'review', reason: 'not flagged as RCT' };
    if (!hasInclude) return { decision: 'review', reason: 'no include keyword in title/abstract' };
    if (hasExclude) return { decision: 'exclude', reason: 'excluded keyword present' };
    return { decision: 'include', reason: 'auto-included' };
  }

  function autoExtract(article) {
    const text = article.title + ' ' + article.abstract;
    const out = {};
    // Sample size: "N=NNN" or "n=NNN" or "n = NNN patients"
    const nMatch = text.match(/[nN]\s*=\s*(\d{2,5})/);
    if (nMatch) out.totalN = parseInt(nMatch[1], 10);
    // HR
    const hrMatch = text.match(/(?:hazard ratio|HR)\D*(\d+\.\d{1,2})\D{0,30}(\d+\.\d{1,2})\s*(?:to|-|–)\s*(\d+\.\d{1,2})/i);
    if (hrMatch) {
      out.hr = parseFloat(hrMatch[1]);
      out.hrLCI = parseFloat(hrMatch[2]);
      out.hrUCI = parseFloat(hrMatch[3]);
    }
    // RR / OR
    const rrMatch = text.match(/(?:risk ratio|relative risk|RR|odds ratio|OR)\D*(\d+\.\d{1,2})\D{0,30}(\d+\.\d{1,2})\s*(?:to|-|–)\s*(\d+\.\d{1,2})/i);
    if (rrMatch && !out.hr) {
      out.rr = parseFloat(rrMatch[1]);
      out.rrLCI = parseFloat(rrMatch[2]);
      out.rrUCI = parseFloat(rrMatch[3]);
    }
    // Event counts: "X events ... Y events"
    const eventMatch = text.match(/(\d{1,4})\s+\([\d.]+%\)\s+(?:events?|patients?|cases?)\s+(?:in|on|with|on the|in the)\s+\w+\s+(?:arm|group)?[\s\S]{1,80}?(\d{1,4})\s+\([\d.]+%\)/i);
    if (eventMatch) {
      out.tE = parseInt(eventMatch[1], 10);
      out.cE = parseInt(eventMatch[2], 10);
    }
    return out;
  }

  function inferIncludeKeywords() {
    // Use page title + nctAcronyms drug names + filename
    const kws = [];
    const nctAcr = (global.RapidMeta && global.RapidMeta.nctAcronyms) || {};
    Object.values(nctAcr).forEach(v => {
      if (typeof v === 'string') kws.push(v);
    });
    // Drug names from realData group fields
    const rd = global.RapidMeta && global.RapidMeta.realData;
    if (rd) {
      Object.values(rd).forEach(t => {
        if (t && typeof t.group === 'string') {
          const m = t.group.match(/[A-Za-z]{6,}/g) || [];
          m.slice(0, 2).forEach(w => {
            if (!/(trial|study|phase|patient|treatment|randomized|placebo|control)/i.test(w)) {
              kws.push(w);
            }
          });
        }
      });
    }
    // Dedupe
    return Array.from(new Set(kws.map(k => k.toLowerCase()))).slice(0, 20);
  }

  // ----- UI: modal + per-candidate card -----

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k]);
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e[k.toLowerCase()] = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(c => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function open() {
    if (document.getElementById('lr-overlay')) return;
    const overlay = el('div', {
      id: 'lr-overlay',
      style: {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.85)',
        zIndex: '9999', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '24px',
        fontFamily: 'ui-sans-serif,system-ui,sans-serif',
      }
    });

    const panel = el('div', {
      style: {
        background: '#0f172a', border: '1px solid #475569', borderRadius: '12px',
        padding: '20px', width: '100%', maxWidth: '900px',
        maxHeight: '90vh', overflow: 'auto', color: '#e2e8f0',
      }
    });
    overlay.appendChild(panel);

    panel.appendChild(el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }
    }, [
      el('h3', { style: { fontSize: '16px', fontWeight: '700', color: '#22d3ee' } }, ['Living Update — User-Triggered Re-Search']),
      el('button', {
        style: { background: 'transparent', color: '#94a3b8', border: '1px solid #475569', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' },
        onclick: () => overlay.remove()
      }, ['Close ✕']),
    ]));

    const reviewerId = getReviewerId();
    if (!reviewerId) {
      panel.appendChild(el('div', {
        style: { background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', borderRadius: '6px', padding: '10px', marginBottom: '12px', fontSize: '12px', color: '#fca5a5' }
      }, ['⚠ Set Reviewer ID in the page header before running a living update — required for attestation provenance.']));
    }

    panel.appendChild(el('label', { style: { fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' } }, ['PubMed search query']));
    const queryBox = el('textarea', {
      id: 'lr-query',
      rows: '3',
      style: { width: '100%', background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '6px', padding: '8px', marginTop: '4px', fontSize: '12px', fontFamily: 'ui-monospace,monospace' }
    });
    queryBox.value = defaultQuery();
    panel.appendChild(queryBox);

    panel.appendChild(el('div', { style: { display: 'flex', gap: '12px', marginTop: '8px', fontSize: '11px', color: '#94a3b8' } }, [
      el('label', {}, [
        el('input', { type: 'checkbox', id: 'lr-rct-only', checked: 'checked', style: { marginRight: '4px' } }),
        'RCT only',
      ]),
      el('label', {}, [
        el('input', { type: 'checkbox', id: 'lr-recent-only', checked: 'checked', style: { marginRight: '4px' } }),
        'Last 24 months only',
      ]),
    ]));

    const goBtn = el('button', {
      id: 'lr-go',
      style: {
        marginTop: '12px', background: '#0891b2', color: '#fff',
        border: 'none', borderRadius: '6px', padding: '8px 16px',
        cursor: 'pointer', fontWeight: '600', fontSize: '12px'
      },
    }, ['Run search →']);

    const status = el('span', { id: 'lr-status', style: { marginLeft: '12px', fontSize: '11px', color: '#94a3b8' } });

    panel.appendChild(el('div', {}, [goBtn, status]));

    const results = el('div', { id: 'lr-results', style: { marginTop: '16px' } });
    panel.appendChild(results);

    goBtn.onclick = () => runSearch(queryBox.value, results, status);

    document.body.appendChild(overlay);
  }

  async function runSearch(rawQuery, container, status) {
    container.innerHTML = '';
    status.textContent = 'Running esearch...';
    let query = rawQuery;
    const rctOnly = document.getElementById('lr-rct-only').checked;
    const recentOnly = document.getElementById('lr-recent-only').checked;
    if (rctOnly) query += ' AND randomized controlled trial[Publication Type]';
    if (recentOnly) {
      const yr = new Date().getFullYear();
      query += ' AND ' + (yr - 2) + ':' + yr + '[dp]';
    }

    let pmids;
    try {
      pmids = await esearch(query, 50);
    } catch (e) {
      status.textContent = 'esearch error: ' + e.message;
      return;
    }
    if (!pmids.length) {
      status.textContent = 'No hits.';
      return;
    }
    const have = existingPmids();
    const newPmids = pmids.filter(p => !have.has(String(p)));
    status.textContent = pmids.length + ' total hits, ' + newPmids.length + ' new (not in current data).';
    if (!newPmids.length) {
      container.appendChild(el('div', {
        style: { padding: '14px', color: '#10b981', fontSize: '12px' }
      }, ['✓ All search hits already in your trials list. Nothing new to attest.']));
      // Record empty run for audit trail
      const state = getState();
      if (state) {
        state.livingUpdates.push({
          ts: new Date().toISOString(),
          reviewerId: getReviewerId(),
          query: rawQuery,
          totalHits: pmids.length,
          newHits: 0,
          accepted: 0, rejected: 0,
        });
        saveState();
      }
      return;
    }
    status.textContent = 'Fetching abstracts for ' + newPmids.length + ' new...';
    let articles;
    try {
      articles = await efetch(newPmids);
    } catch (e) {
      status.textContent = 'efetch error: ' + e.message;
      return;
    }
    status.textContent = 'Auto-screening + auto-extracting...';

    const includeKws = inferIncludeKeywords();
    const cards = articles.map(a => {
      const screen = autoScreen(a, includeKws, []);
      const extracted = autoExtract(a);
      return { article: a, screen, extracted, decision: null };
    });

    // Render summary + cards
    const auto = { include: 0, exclude: 0, review: 0 };
    cards.forEach(c => auto[c.screen.decision]++);
    container.appendChild(el('div', {
      style: { background: 'rgba(96,165,250,0.10)', border: '1px solid #60a5fa', borderRadius: '6px', padding: '10px', marginBottom: '12px', fontSize: '12px' }
    }, [
      'Auto-screen: ' + auto.include + ' include, ' + auto.exclude + ' exclude, ' + auto.review + ' needs review. ' +
      'Each candidate below requires your attestation before saving.'
    ]));

    cards.forEach((c, i) => {
      container.appendChild(renderCard(c, i));
    });

    const finishBtn = el('button', {
      style: {
        marginTop: '14px', background: '#10b981', color: '#fff',
        border: 'none', borderRadius: '6px', padding: '10px 16px',
        cursor: 'pointer', fontWeight: '700', fontSize: '12px',
      },
      onclick: () => commitAll(cards, rawQuery, pmids.length, status, container)
    }, ['Save attestations ✓']);
    container.appendChild(finishBtn);
    status.textContent = 'Decide each then click Save.';
  }

  function renderCard(c, i) {
    const a = c.article;
    const screenColor = c.screen.decision === 'include' ? '#10b981' : c.screen.decision === 'exclude' ? '#ef4444' : '#f59e0b';
    const card = el('div', {
      'data-card-i': String(i),
      style: {
        background: '#1e293b', border: '1px solid #334155', borderRadius: '8px',
        padding: '12px', marginBottom: '10px', fontSize: '12px',
      }
    });
    card.appendChild(el('div', { style: { color: screenColor, fontWeight: '700', marginBottom: '4px' } },
      ['AUTO: ' + c.screen.decision.toUpperCase() + ' (' + c.screen.reason + ')']));
    card.appendChild(el('div', { style: { fontWeight: '600', color: '#cbd5e1', marginBottom: '4px' } }, [a.title]));
    card.appendChild(el('div', { style: { color: '#94a3b8', fontSize: '11px', marginBottom: '6px' } },
      [a.journal + ' · ' + a.year + ' · PMID ' + a.pmid + (a.ncts.length ? ' · NCT ' + a.ncts.join(',') : '')]));
    if (a.abstract) {
      const exc = el('details', { style: { marginBottom: '6px' } });
      exc.appendChild(el('summary', { style: { fontSize: '11px', color: '#22d3ee', cursor: 'pointer' } }, ['Abstract']));
      exc.appendChild(el('div', { style: { fontSize: '11px', color: '#cbd5e1', marginTop: '4px', lineHeight: '1.5', whiteSpace: 'pre-wrap' } }, [a.abstract.slice(0, 1500)]));
      card.appendChild(exc);
    }
    if (Object.keys(c.extracted).length) {
      card.appendChild(el('div', { style: { background: 'rgba(34,211,238,0.10)', border: '1px solid #22d3ee', borderRadius: '4px', padding: '6px', fontSize: '11px', marginBottom: '6px' } },
        ['Auto-extracted: ' + JSON.stringify(c.extracted)]));
    }
    const btnRow = el('div', { style: { display: 'flex', gap: '6px' } });
    [
      ['ACCEPT include', 'accept_include', '#10b981'],
      ['REJECT exclude', 'reject_exclude', '#ef4444'],
      ['SKIP', 'skip', '#94a3b8'],
    ].forEach(([label, action, color]) => {
      btnRow.appendChild(el('button', {
        style: {
          background: 'transparent', color, border: '1px solid ' + color,
          borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', fontSize: '11px',
        },
        onclick: () => { c.decision = action; card.style.opacity = '0.5'; }
      }, [label]));
    });
    card.appendChild(btnRow);
    return card;
  }

  function commitAll(cards, query, totalHits, status, container) {
    const state = getState();
    if (!state) {
      status.textContent = 'No RapidMeta state — cannot save.';
      return;
    }
    const ts = new Date().toISOString();
    const reviewer = getReviewerId();
    let accepted = 0, rejected = 0, skipped = 0;
    const log = [];
    cards.forEach(c => {
      const decision = c.decision || 'skip';
      if (decision === 'accept_include') accepted++;
      else if (decision === 'reject_exclude') rejected++;
      else skipped++;
      log.push({
        pmid: c.article.pmid,
        ncts: c.article.ncts,
        title: c.article.title,
        year: c.article.year,
        decision,
        autoScreen: c.screen.decision,
        extracted: c.extracted,
      });
    });
    state.livingUpdates.push({
      ts, reviewerId: reviewer, query,
      totalHits, newHits: cards.length,
      accepted, rejected, skipped,
      log,
    });
    saveState();
    status.textContent = 'Saved. ' + accepted + ' accepted, ' + rejected + ' rejected, ' + skipped + ' skipped.';
    container.innerHTML = '<div style="color:#10b981;font-size:12px;padding:14px;">✓ Living update saved at ' + ts + ' by ' + (reviewer || '(no reviewer ID)') + '. Close this dialog and the LIVING badge will refresh.</div>';
    // Re-render attestation badges if available
    if (global.AttestationBadges && global.AttestationBadges.renderWithRetry) {
      const c = document.getElementById('attestationBadgesContainer');
      if (c) global.AttestationBadges.renderWithRetry(c);
    }
  }

  function getRunLog() {
    const s = getState();
    return s ? s.livingUpdates : [];
  }

  function getLastRun() {
    const log = getRunLog();
    return log.length ? log[log.length - 1] : null;
  }

  global.LivingReview = { open, getRunLog, getLastRun };
})(typeof window !== 'undefined' ? window : globalThis);
