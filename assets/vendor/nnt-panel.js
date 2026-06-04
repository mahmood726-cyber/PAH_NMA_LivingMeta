/* Number Needed to Treat (NNT) panel — for binary outcomes only.
 *
 * Pools risk difference (DL random-effects) across all trials in
 * window.RapidMeta.realData. NNT = 1/|RD|; CI from 1/|RD-CI|.
 * If RD CI crosses 0, marks "NNT undefined (CI includes no-effect)".
 *
 * Per-trial NNT also shown for transparency.
 *
 * Auto-bootstrap; collapsed by default.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'nnt-panel-expanded';

  function nntFromRD(rd, ci_low, ci_high) {
    if (Math.abs(rd) < 1e-9) return { nnt: null, label: 'no benefit' };
    const nnt = 1 / Math.abs(rd);
    let nntLow = null, nntHigh = null, crossesZero = false;
    if (ci_low * ci_high > 0) {
      const a = 1 / Math.abs(ci_low), b = 1 / Math.abs(ci_high);
      nntLow = Math.min(a, b);
      nntHigh = Math.max(a, b);
    } else {
      crossesZero = true;
    }
    const direction = rd < 0 ? 'NNTB' : 'NNTH'; // benefit if RD<0 (treatment lowers event)
    return { nnt, nntLow, nntHigh, crossesZero, direction };
  }

  function buildBody(P, trials, pool, info) {
    const fmt = P.fmt;
    let html = '';

    // Headline
    if (info.crossesZero || info.nnt === null || !isFinite(info.nnt)) {
      html += '<div style="background:#3a2a0a;border:1px solid #92400e;color:#fbbf24;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-size:11.5px;">'
            + '⚠ <strong>NNT undefined</strong> — pooled RD 95% CI '
            + '(' + fmt(pool.ci_low * 100, 1) + ' to ' + fmt(pool.ci_high * 100, 1) + '%) crosses zero or pooled RD is null. '
            + 'No firm benefit/harm conclusion at α=0.05.'
            + '</div>';
    } else {
      const verb = info.direction === 'NNTB' ? 'benefit' : 'harm';
      html += '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:9px 10px;margin-bottom:10px;font-size:12px;">'
            + '<strong style="color:#34d399;">' + info.direction + ' = ' + Math.ceil(info.nnt) + '</strong> '
            + '<span style="color:#cbd5e1;">(95% CI ' + Math.ceil(info.nntLow) + '–' + Math.ceil(info.nntHigh) + ')</span> '
            + '<span style="color:#94a3b8;">— treat ' + Math.ceil(info.nnt) + ' patients to ' + verb + ' 1.</span>'
            + '</div>';
    }

    // Pooled RD details
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px;">';
    function cell(label, value, sub) {
      return '<div style="background:#0b1220;border:1px solid #1e293b;border-radius:6px;padding:6px 8px;">'
           + '<div style="font-size:9.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">' + label + '</div>'
           + '<div style="font-size:13px;color:#f1f5f9;font-weight:700;font-family:JetBrains Mono,monospace;margin-top:2px;">' + value + '</div>'
           + (sub ? '<div style="font-size:10px;color:#94a3b8;margin-top:1px;">' + sub + '</div>' : '')
           + '</div>';
    }
    html += cell('Pooled RD', fmt(pool.rd * 100, 2) + '%', '95% CI ' + fmt(pool.ci_low * 100, 2) + '–' + fmt(pool.ci_high * 100, 2) + '%');
    html += cell('Trials (k)', String(pool.k));
    html += cell('τ²', fmt(pool.tau2, 4));
    html += '</div>';

    // Per-trial NNT table
    html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Per-trial risk difference and trial-level NNT (uncorrected):</div>';
    html += '<table style="width:100%;font-size:11px;border-collapse:collapse;">';
    html += '<thead><tr style="color:#64748b;text-align:left;">'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;">Trial</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">Tx events / N</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">Ctl events / N</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">RD (%)</th>'
          + '<th style="padding:4px 6px;border-bottom:1px solid #1e293b;text-align:right;">NNT</th>'
          + '</tr></thead><tbody>';
    trials.forEach(t => {
      const pt = t.ai / t.n1i, pc = t.ci / t.n2i;
      const tRD = pt - pc;
      const tnnt = Math.abs(tRD) > 1e-9 ? Math.ceil(1 / Math.abs(tRD)) : '—';
      const dir = tRD < 0 ? 'NNTB' : (tRD > 0 ? 'NNTH' : '—');
      const nntCell = tnnt === '—' ? '—' : (dir + ' ' + tnnt);
      html += '<tr style="border-bottom:1px solid #0b1220;">'
            + '<td style="padding:3px 6px;color:#e2e8f0;">' + t.name + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + t.ai + '/' + t.n1i + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + t.ci + '/' + t.n2i + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#cbd5e1;">' + fmt(tRD * 100, 2) + '</td>'
            + '<td style="padding:3px 6px;text-align:right;font-family:JetBrains Mono,monospace;color:#7dd3fc;">' + nntCell + '</td>'
            + '</tr>';
    });
    html += '</tbody></table>';

    html += '<div style="font-size:10.5px;color:#64748b;margin-top:8px;line-height:1.5;">'
          + 'Method: NNT = 1 / |pooled RD| where RD pooled via DerSimonian–Laird random effects. '
          + 'NNTB = number needed to treat for one to benefit; NNTH = for one to be harmed. '
          + 'CI computed by inverting the RD 95% CI bounds (Altman 1998). '
          + 'When RD 95% CI crosses zero, NNT is mathematically undefined and not reported as a point estimate.'
          + '</div>';

    return html;
  }

  function render() {
    const P = global.PanelHelper;
    if (!P) return false;
    const rd = P.getRealData();
    if (!rd) return false;
    const trials = P.extractBinaryTrials(rd);
    if (trials.length < 2) return false;

    const pool = P.poolRandomRD(trials);
    if (!pool) return false;
    const info = nntFromRD(pool.rd, pool.ci_low, pool.ci_high);

    const umbrella = P.isNMA && P.isNMA() ? ' [umbrella, drug-class vs ref]' : '';
    let summary;
    if (info.crossesZero || info.nnt === null || !isFinite(info.nnt)) {
      summary = 'NNT undefined (no significant effect) · pooled RD ' + P.fmt(pool.rd * 100, 1) + '% · k=' + pool.k + umbrella;
    } else {
      summary = info.direction + ' ' + Math.ceil(info.nnt) + ' [' + Math.ceil(info.nntLow) + '–' + Math.ceil(info.nntHigh) + '] · k=' + pool.k + umbrella;
    }

    const panel = P.buildCollapsiblePanel({
      id: 'nnt-panel',
      badge: 'NNT',
      summary,
      bodyHtml: buildBody(P, trials, pool, info),
      storageKey: STORAGE_KEY,
    });

    // Replace existing panel if present, else insert
    const existing = document.getElementById('nnt-panel');
    if (existing) existing.replaceWith(panel);
    else P.insertAfterRBadge(panel);
    return true;
  }

  function bootstrap() {
    if (typeof document === 'undefined') return;
    let tries = 0;
    const tick = () => {
      if (render()) return;
      if (++tries < 20) setTimeout(tick, 250);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 300));
    } else {
      setTimeout(tick, 300);
    }
  }

  global.NNTPanel = { render };
  bootstrap();
})(typeof window !== 'undefined' ? window : this);
