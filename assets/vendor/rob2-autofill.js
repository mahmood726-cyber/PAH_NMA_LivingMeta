/* rob2-autofill.js — regex-based auto-fill for Cochrane RoB-2.
 *
 * Same pattern as living-review.js: auto-screen + auto-extract +
 * user attest/correct/skip. Combines PubMed abstract (efetch) +
 * trial's group field + outcome-switching audit data + AACT design
 * fields if available.
 *
 * RoB-2 5 domains:
 *   D1: Randomization process
 *   D2: Deviations from intended interventions
 *   D3: Missing outcome data
 *   D4: Measurement of the outcome
 *   D5: Selection of the reported result
 *
 * Heuristic: regex over title+abstract+group looking for canonical
 * RoB-2 signals. Confidence flagged so user knows which need manual
 * confirmation.
 *
 * Public API (window.Rob2Autofill):
 *   inferOne(article, trial)    — infer 5 domains for one trial
 *   open()                      — modal with per-trial cards
 *   getStored(nct)              — get attested rob from state
 */
(function (global) {
  'use strict';

  const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

  // ---------------------- regex inference ----------------------

  function inferD1(text) {
    // D1: Randomization
    const t = text.toLowerCase();
    if (/computer.{0,15}(generated|random)|central(ized|ised)\s+(allocation|randomi[sz]ation)|interactive\s+web\s+response|automated\s+random/i.test(t)) {
      return { rating: 'low', confidence: 'high', reason: 'computer-generated / centralized randomization' };
    }
    if (/block\s+random|stratified\s+random|permuted.{0,5}block|allocation\s+sequence\s+(was|were)\s+(generated|concealed)/i.test(t)) {
      return { rating: 'low', confidence: 'medium', reason: 'block / stratified / concealed-allocation language' };
    }
    if (/random(ly)?\s+(allocated|assigned|placed)/i.test(t)) {
      return { rating: 'low', confidence: 'medium', reason: 'randomized terminology in abstract' };
    }
    if (/alternating\s+(allocation|assignment)|investigator.{0,5}(chose|allocated)|nonrandom|quasi.random|by\s+(date|day|alternat)/i.test(t)) {
      return { rating: 'high', confidence: 'high', reason: 'non-random allocation language' };
    }
    return { rating: 'some', confidence: 'low', reason: 'no explicit randomization method described' };
  }

  function inferD2(text) {
    // D2: Deviations from intended interventions (blinding, adherence)
    const t = text.toLowerCase();
    if (/double.{0,5}(blind|mask|dummy)|investigator.{0,10}blinded|placebo.controlled|sham.controlled/i.test(t)) {
      return { rating: 'low', confidence: 'high', reason: 'double-blind / placebo-controlled' };
    }
    if (/single.{0,5}(blind|mask)|outcome.assessor.{0,10}blind|blinded\s+outcome\s+assessment/i.test(t)) {
      return { rating: 'low', confidence: 'medium', reason: 'single-blind with blinded outcome assessor' };
    }
    if (/open.{0,2}label|unblinded/i.test(t)) {
      // Soften to LOW if outcome adjudication mentioned (PROBE design)
      if (/blinded\s+(adjudication|outcome|endpoint)|adjudicated\s+by/i.test(t)) {
        return { rating: 'low', confidence: 'medium', reason: 'open-label PROBE design with blinded endpoint adjudication' };
      }
      return { rating: 'some', confidence: 'medium', reason: 'open-label trial' };
    }
    return { rating: 'some', confidence: 'low', reason: 'no explicit blinding terminology' };
  }

  function inferD3(text, trial) {
    // D3: Missing outcome data
    const t = text.toLowerCase();
    if (/intention[\s-]to[\s-]treat|\bITT\b|all\s+(randomized|randomised)\s+(patients|participants)\s+were\s+included/i.test(t)) {
      return { rating: 'low', confidence: 'high', reason: 'ITT analysis' };
    }
    // Dropout-rate detection
    const dr = t.match(/(?:lost\s+to\s+follow.up|withdrew|discontinued)\D{0,20}(\d+(?:\.\d+)?)\s*%/);
    if (dr) {
      const pct = parseFloat(dr[1]);
      if (pct < 5) return { rating: 'low', confidence: 'high', reason: 'dropout <5%' };
      if (pct < 15) return { rating: 'some', confidence: 'medium', reason: 'dropout ' + pct + '%' };
      return { rating: 'high', confidence: 'medium', reason: 'dropout >' + pct + '% (>15%)' };
    }
    if (/modified.{0,5}intention|mITT|per.protocol/i.test(t)) {
      return { rating: 'some', confidence: 'medium', reason: 'modified ITT or per-protocol-only analysis' };
    }
    return { rating: 'low', confidence: 'low', reason: 'default — no missing-data concerns identified' };
  }

  function inferD4(text, trial) {
    // D4: Outcome measurement
    const t = text.toLowerCase();
    if (/(adjudicat|independent\s+committee|clinical\s+events?\s+committee|blinded\s+outcome\s+assess|core\s+lab|centralized\s+outcome)/i.test(t)) {
      return { rating: 'low', confidence: 'high', reason: 'adjudicated by independent / blinded committee' };
    }
    // Hard endpoints
    const hardKws = /(all-cause\s+mortality|cardiovascular\s+mortality|stroke|myocardial\s+infarction|hospitali[sz]ation\s+for\s+heart\s+failure|MACE|major\s+adverse|3-?point\s+MACE)/i;
    if (hardKws.test(t)) {
      return { rating: 'low', confidence: 'medium', reason: 'hard / objective primary endpoint' };
    }
    // Subjective endpoints flagged
    const softKws = /(quality\s+of\s+life|patient.reported|self-rated|symptom\s+score|VAS|HAQ|FACT|EQ-5D|SF-36)/i;
    if (softKws.test(t)) {
      // Look for blinding around the soft endpoint
      if (/blinded.{0,30}(assessor|outcome|measurement)/i.test(t)) {
        return { rating: 'low', confidence: 'medium', reason: 'subjective endpoint with blinded assessment' };
      }
      return { rating: 'some', confidence: 'medium', reason: 'subjective / patient-reported endpoint' };
    }
    return { rating: 'low', confidence: 'low', reason: 'default — endpoint type not clearly subjective' };
  }

  function inferD5(text, trial, outcomeSwitchingFlag) {
    // D5: Selective reporting
    if (outcomeSwitchingFlag === 'ENDPOINT_DRIFT' || outcomeSwitchingFlag === 'TIMEPOINT') {
      return { rating: 'high', confidence: 'high', reason: 'AACT-vs-paper outcome drift detected (COMPare audit)' };
    }
    if (outcomeSwitchingFlag === 'NOT_REGISTERED') {
      return { rating: 'some', confidence: 'medium', reason: 'no AACT primary results posted (FDAAA risk)' };
    }
    if (outcomeSwitchingFlag === 'MATCH') {
      return { rating: 'low', confidence: 'high', reason: 'AACT-registered primary matches reported primary' };
    }
    const t = text.toLowerCase();
    if (/pre.specified\s+primary|registered\s+(at|on)\s+clinicaltrials/i.test(t)) {
      return { rating: 'low', confidence: 'medium', reason: 'pre-specified primary outcome documented' };
    }
    return { rating: 'low', confidence: 'low', reason: 'default — no selective-reporting signal' };
  }

  function inferOne(article, trial, outcomeSwitchingFlag) {
    const text = (article ? (article.title + ' ' + article.abstract) : '') + ' ' +
                 (trial && trial.group ? trial.group : '');
    return {
      D1: inferD1(text),
      D2: inferD2(text),
      D3: inferD3(text, trial),
      D4: inferD4(text, trial),
      D5: inferD5(text, trial, outcomeSwitchingFlag),
    };
  }

  // ---------------------- PubMed fetching ----------------------

  async function efetchOne(pmid) {
    if (!pmid) return null;
    try {
      const r = await fetch(EUTILS + '/efetch.fcgi?db=pubmed&id=' + pmid + '&retmode=xml');
      if (!r.ok) return null;
      const xml = await r.text();
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const art = doc.querySelector('PubmedArticle');
      if (!art) return null;
      const title = art.querySelector('ArticleTitle') ? art.querySelector('ArticleTitle').textContent : '';
      const abstractEls = art.querySelectorAll('Abstract AbstractText');
      const abstract = Array.from(abstractEls).map(e => e.textContent).join(' ');
      return { pmid, title, abstract };
    } catch (e) { return null; }
  }

  // ---------------------- UI ----------------------

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

  function colorForRating(r) {
    return r === 'low' ? '#10b981' : r === 'some' ? '#f59e0b' : r === 'high' ? '#ef4444' : '#6b7280';
  }

  async function open() {
    if (document.getElementById('rob2-autofill-overlay')) return;
    const rd = (global.RapidMeta && global.RapidMeta.realData) || {};
    const trials = Object.entries(rd).map(([nct, t]) => ({ nct, ...t }));
    if (!trials.length) {
      alert('No realData trials.');
      return;
    }

    const overlay = el('div', {
      id: 'rob2-autofill-overlay',
      style: {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.85)',
        zIndex: '9999', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '20px',
        fontFamily: 'ui-sans-serif,system-ui,sans-serif',
      }
    });
    const panel = el('div', {
      style: {
        background: '#0f172a', border: '1px solid #475569', borderRadius: '12px',
        padding: '20px', width: '100%', maxWidth: '1100px',
        maxHeight: '92vh', overflow: 'auto', color: '#e2e8f0',
      }
    });
    overlay.appendChild(panel);

    panel.appendChild(el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }
    }, [
      el('h3', { style: { fontSize: '15px', fontWeight: '700', color: '#22d3ee' } },
        ['RoB-2 Auto-Fill — regex over PubMed abstracts + user attestation']),
      el('button', {
        style: { background: 'transparent', color: '#94a3b8', border: '1px solid #475569', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' },
        onclick: () => overlay.remove()
      }, ['Close ✕']),
    ]));

    panel.appendChild(el('div', {
      style: { fontSize: '11px', color: '#94a3b8', marginBottom: '14px', lineHeight: '1.5' }
    }, [
      'For each of ' + trials.length + ' trials, fetch PubMed abstract via efetch, run RoB-2 regex inference for the 5 domains, present per-trial proposal. ',
      'Inference confidence flagged per domain; LOW-confidence domains need your manual review. ',
      'Click ACCEPT to apply auto-fill. Click CORRECT to override per-domain. SKIP leaves the trial unchanged.',
    ]));

    const status = el('div', { id: 'rob2-status', style: { fontSize: '11px', color: '#cbd5e1', marginBottom: '10px' } }, ['Click "Fetch + Infer" to start.']);
    panel.appendChild(status);

    const goBtn = el('button', {
      style: { background: '#0891b2', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 14px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' },
    }, ['Fetch + Infer all (' + trials.length + ' trials)']);
    panel.appendChild(goBtn);

    const cardsWrap = el('div', { id: 'rob2-cards', style: { marginTop: '14px' } });
    panel.appendChild(cardsWrap);

    document.body.appendChild(overlay);

    goBtn.onclick = async () => {
      goBtn.disabled = true;
      cardsWrap.innerHTML = '';
      const cards = [];
      for (let i = 0; i < trials.length; i++) {
        const t = trials[i];
        status.textContent = 'Fetching ' + (i + 1) + '/' + trials.length + ': ' + t.name;
        const article = t.pmid ? await efetchOne(t.pmid) : null;
        // Outcome-switching flag — try to read from previously-rendered result
        let osFlag = null;
        try {
          const osTable = document.querySelector('#osAudit table');
          if (osTable) {
            const rows = osTable.querySelectorAll('tbody tr');
            rows.forEach(tr => {
              const tds = tr.querySelectorAll('td');
              if (tds.length >= 6 && tds[0].textContent.trim().includes(t.nct)) {
                osFlag = tds[5].textContent.trim();
              }
            });
          }
        } catch (e) {}
        const inferred = inferOne(article, t, osFlag);
        const card = renderCard(t, article, inferred);
        cards.push({ trial: t, inferred, card, decision: null });
        cardsWrap.appendChild(card.element);
        // Brief delay to be polite to PubMed
        await new Promise(r => setTimeout(r, 400));
      }
      status.textContent = 'Done. Review each card and click Save Attestations below.';
      goBtn.disabled = false;
      const saveBtn = el('button', {
        style: { marginTop: '14px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px 16px', cursor: 'pointer', fontWeight: '700', fontSize: '12px' },
        onclick: () => commit(cards, status, cardsWrap)
      }, ['Save attestations ✓']);
      cardsWrap.appendChild(saveBtn);
    };
  }

  function renderCard(t, article, inferred) {
    const ratings = { ...inferred };  // mutable per-domain rating
    const card = el('div', {
      style: {
        background: '#1e293b', border: '1px solid #334155', borderRadius: '8px',
        padding: '12px', marginBottom: '10px', fontSize: '12px',
      }
    });
    card.appendChild(el('div', {
      style: { fontWeight: '700', color: '#cbd5e1', marginBottom: '4px' }
    }, [t.name + ' · ' + t.nct + (t.pmid ? ' · PMID ' + t.pmid : '')]));
    if (article) {
      card.appendChild(el('div', { style: { fontSize: '11px', color: '#94a3b8', marginBottom: '6px' } }, [article.title]));
    } else if (t.pmid) {
      card.appendChild(el('div', { style: { fontSize: '11px', color: '#fbbf24', marginBottom: '6px' } }, ['(no abstract — PubMed efetch failed; relying on group field only)']));
    }
    // 5 domain rows
    ['D1', 'D2', 'D3', 'D4', 'D5'].forEach(d => {
      const init = inferred[d];
      const row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '11px' } });
      const labelMap = {
        D1: 'D1 Randomization',
        D2: 'D2 Deviations',
        D3: 'D3 Missing data',
        D4: 'D4 Measurement',
        D5: 'D5 Selective reporting',
      };
      row.appendChild(el('div', { style: { width: '160px', color: '#94a3b8' } }, [labelMap[d]]));
      // Rating buttons
      ['low', 'some', 'high'].forEach(r => {
        const btn = el('button', {
          style: {
            padding: '2px 8px', fontSize: '10px', cursor: 'pointer',
            borderRadius: '4px',
            border: '1px solid ' + colorForRating(r),
            background: ratings[d].rating === r ? colorForRating(r) : 'transparent',
            color: ratings[d].rating === r ? '#fff' : colorForRating(r),
            fontWeight: '600',
          },
          'data-domain': d,
          'data-rating': r,
          onclick: function () {
            ratings[d].rating = r;
            ratings[d].userOverride = true;
            // Update visual state
            card.querySelectorAll('button[data-domain="' + d + '"]').forEach(b => {
              const rb = b.getAttribute('data-rating');
              const sel = rb === r;
              b.style.background = sel ? colorForRating(rb) : 'transparent';
              b.style.color = sel ? '#fff' : colorForRating(rb);
            });
          }
        }, [r.toUpperCase()]);
        row.appendChild(btn);
      });
      const conf = ratings[d].confidence;
      row.appendChild(el('div', {
        style: {
          fontSize: '9px', color: conf === 'high' ? '#10b981' : conf === 'medium' ? '#f59e0b' : '#94a3b8',
          width: '60px', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.04em',
        }
      }, [conf]));
      row.appendChild(el('div', { style: { color: '#94a3b8', fontSize: '10px', flex: '1', fontStyle: 'italic' } }, [ratings[d].reason]));
      card.appendChild(row);
    });

    return { element: card, ratings };
  }

  function commit(cards, status, container) {
    const state = global.RapidMeta && global.RapidMeta.state;
    if (!state) { status.textContent = 'No RapidMeta state — cannot save.'; return; }
    if (!Array.isArray(state.rob2Attestations)) state.rob2Attestations = [];
    const ts = new Date().toISOString();
    const reviewer = state.reviewerId || '';
    let saved = 0;
    cards.forEach(c => {
      // Read current ratings from the card
      const r = ['D1','D2','D3','D4','D5'].map(d => c.inferred[d].rating);
      // Update realData[nct].rob in-place
      const rd = global.RapidMeta && global.RapidMeta.realData;
      if (rd && rd[c.trial.nct]) {
        rd[c.trial.nct].rob = r;
        rd[c.trial.nct].rob_attested = { ts, reviewer, source: 'auto-fill+attest' };
        saved++;
      }
      state.rob2Attestations.push({
        ts, reviewer, nct: c.trial.nct,
        ratings: r,
        reasoning: ['D1','D2','D3','D4','D5'].map(d => c.inferred[d].reason),
        confidence: ['D1','D2','D3','D4','D5'].map(d => c.inferred[d].confidence),
      });
    });
    if (global.RapidMeta && global.RapidMeta.save) global.RapidMeta.save();
    status.textContent = '✓ Saved RoB-2 attestations for ' + saved + ' trials at ' + ts + '.';
    container.innerHTML = '<div style="color:#10b981;font-size:13px;padding:14px;">Saved. Re-render the RoB-2 traffic-light widget to see updated ratings.</div>';
    // Auto-refresh traffic light
    if (global.Rob2TrafficLight && global.Rob2TrafficLight.render) {
      const c = document.getElementById('rob2Widget');
      if (c) global.Rob2TrafficLight.render(c);
    }
  }

  function getStored(nct) {
    const rd = global.RapidMeta && global.RapidMeta.realData;
    return rd && rd[nct] ? rd[nct].rob_attested : null;
  }

  global.Rob2Autofill = { inferOne, open, getStored };
})(typeof window !== 'undefined' ? window : globalThis);
