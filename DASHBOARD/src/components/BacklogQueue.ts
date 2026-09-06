/* ============================================================
   BacklogQueue — Ingestion Feed, Scorer Queue, Proposals
   ============================================================ */

import { store } from '../store/useRailSyncStore.ts';
import {
  D, S, hhmm, shortCorr, esc, scoreColor, CLS_COLOR,
  totalDuration, issueOrder, scoreWindow, mergeImpact, projectOverrun,
  byId, clear, el, tip, tipOff, tipRows, toast, logEvent,
} from '../lib/core.ts';
import type {
  Dept, Band, Demand, LiveProposal, BlockStatus, ProposalItem, WindowScore,
} from '../types/index.ts';
import {
  doApproveWithMemo, showMemoModal, showRejectModal, showShiftModal,
} from './BlockDrawer.ts';

/* ---- Filters ---- */

export function buildFilters(): void {
  const box = byId('q-filters');
  if (!box) return;
  clear(box);

  box.appendChild(el('span', 'f-lbl', 'Dept'));
  ([['TMS', 'P-Way'], ['TDMS', 'TRD'], ['SMMS', 'S&T']] as [Dept, string][]).forEach((d) => {
    const s = store.getState();
    const b = el('button', 'f-btn' + (s.filters.dept[d[0]] ? ' on' : ''), d[1]);
    b.title = d[0];
    b.addEventListener('click', () => {
      const cur = store.getState().filters;
      const next = { ...cur, dept: { ...cur.dept, [d[0]]: !cur.dept[d[0]] } };
      store.getState().setFilters(next);
      b.classList.toggle('on', next.dept[d[0]]);
      renderQueue();
    });
    box.appendChild(b);
  });

  box.appendChild(el('span', 'f-sep'));
  box.appendChild(el('span', 'f-lbl', 'Urgency'));
  ([['CRITICAL', 'Critical'], ['URGENT', 'Urgent'], ['ROUTINE', 'Routine']] as [Band, string][])
    .forEach((d) => {
      const s = store.getState();
      const b = el('button', 'f-btn' + (s.filters.band[d[0]] ? ' on' : '') +
        (d[0] === 'CRITICAL' ? ' crit' : ''), d[1]);
      b.addEventListener('click', () => {
        const cur = store.getState().filters;
        const next = { ...cur, band: { ...cur.band, [d[0]]: !cur.band[d[0]] } };
        store.getState().setFilters(next);
        b.classList.toggle('on', next.band[d[0]]);
        renderQueue();
      });
      box.appendChild(b);
    });

  box.appendChild(el('span', 'f-sep'));
  const s = store.getState();
  const cb = el('button', 'f-btn' + (s.filters.corridorOnly ? ' on' : ''), 'This corridor only');
  cb.addEventListener('click', () => {
    const cur = store.getState().filters;
    const next = { ...cur, corridorOnly: !cur.corridorOnly };
    store.getState().setFilters(next);
    cb.classList.toggle('on', next.corridorOnly);
    renderQueue();
  });
  box.appendChild(cb);
}

function filtered(): Demand[] {
  const s = store.getState();
  return D().queue.filter((q) => {
    if (!s.filters.dept[q.dept]) return false;
    if (!s.filters.band[q.band]) return false;
    if (s.filters.corridorOnly && q.corridor !== s.corridor) return false;
    return true;
  });
}

/* ---- Queue table ---- */

export function renderQueue(): void {
  const body = byId('q-body');
  if (!body) return;
  clear(body);

  const s = store.getState();
  const rows = filtered();
  const total = D().queue.length;

  const count = byId('q-count');
  if (count) count.textContent = rows.length + ' / ' + total + ' demands';
  const tabCnt = byId('tab-cnt-feed');
  if (tabCnt) tabCnt.textContent = String(total);

  if (!rows.length) {
    const tr0 = el('tr');
    const td0 = el('td', 'empty', 'No demands match the current filters.');
    td0.colSpan = 7;
    tr0.appendChild(td0);
    body.appendChild(tr0);
    return;
  }

  rows.forEach((q) => {
    const tr = el('tr');
    if (s.selDemand === q.id) tr.className = 'sel';

    // 1. Requisition ID
    const c1 = el('td');
    c1.style.minWidth = '130px';
    c1.style.whiteSpace = 'nowrap';
    const s1 = el('span', 'mono', q.id);
    s1.style.fontSize = '12px';
    s1.style.fontWeight = '700';
    c1.appendChild(s1);
    tr.appendChild(c1);

    // 2. Dept tag
    const c2 = el('td');
    c2.style.minWidth = '70px';
    c2.style.whiteSpace = 'nowrap';
    c2.appendChild(el('span', 'dept-tag dept-' + q.dept, q.dept));
    tr.appendChild(c2);

    // 3. Section / Track
    const c3 = el('td');
    c3.style.minWidth = '130px';
    c3.style.whiteSpace = 'nowrap';
    const c3Text = el('div', null, shortCorr(q.corridor));
    c3Text.style.fontWeight = '700';
    c3.appendChild(c3Text);
    const ln = el('div', 'mono', q.line);
    ln.style.cssText = 'font-size:11.5px;color:var(--text-mute)';
    c3.appendChild(ln);
    tr.appendChild(c3);

    // 4. Chainage
    const c4 = el('td', 'mono', q.chainage);
    c4.style.cssText = 'min-width:150px;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums;';
    tr.appendChild(c4);

    // 5. Telemetry
    const c5 = el('td', 'mono', q.telemetry);
    c5.style.cssText = 'min-width:170px;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--text);';
    tr.appendChild(c5);

    // 6. Overdue days
    const c6 = el('td');
    c6.style.minWidth = '65px';
    c6.style.textAlign = 'right';
    c6.style.whiteSpace = 'nowrap';
    const odc = q.overdueDays >= 10 ? 'od-hi' : q.overdueDays >= 4 ? 'od-md' : 'od-lo';
    c6.appendChild(el('span', 'od-pill ' + odc, q.overdueDays ? q.overdueDays + 'd' : '—'));
    tr.appendChild(c6);

    // 7. Urgency Score
    const c7 = el('td');
    c7.style.minWidth = '110px';
    c7.style.whiteSpace = 'nowrap';
    const sc = el('div', 'score-cell');
    const bar = el('div', 'score-bar');
    const fill = el('div', 'score-fill');
    fill.style.width = q.score + '%';
    fill.style.background = scoreColor(q.score);
    bar.appendChild(fill);
    const num = el('div', 'score-num', q.score.toFixed(0));
    num.style.color = scoreColor(q.score);
    sc.appendChild(bar);
    sc.appendChild(num);
    c7.appendChild(sc);
    tr.appendChild(c7);

    tr.addEventListener('mousemove', (e) => { tip(demandTip(q), e as MouseEvent); });
    tr.addEventListener('mouseleave', tipOff);
    tr.addEventListener('click', () => {
      store.getState().setSelDemand(q.id);
      tipOff();
      renderQueue();
      const owner = store.getState().proposals.filter((p) =>
        p.items.some((i) => i.id === q.id) ||
        p.added.some((a) => a.id === q.id)
      )[0];
      if (store.getState().selDemand && owner) store.getState().setSelProposal(owner.id);
    });

    body.appendChild(tr);
  });
}

function demandTip(q: Demand): string {
  const head = '<div class="tt-h"><span class="dept-tag dept-' + q.dept + '">' + q.dept +
    '</span>' + esc(q.id) + '</div>';
  const rows: [string, string][] = [
    ['Department', q.deptFull],
    ['Required action', q.action.replace(/_/g, ' ')],
    ['Section', shortCorr(q.corridor) + ' · ' + q.line],
    ['Est. work time', q.durationMin + ' min'],
  ];
  const drivers = '<div class="tt-why" style="font-size:12px;font-weight:700;margin:6px 0 3px;color:#cbd5e1">Score Breakdown</div>' +
    q.drivers.map((d) => {
      const sign = d.pts > 0 ? '+' + d.pts.toFixed(1) : '—';
      return '<div class="tt-r tt-drv"><span>' + esc(d.k) + '</span>' +
        '<span><b>' + esc(d.v) + '</b> <i class="tt-pts pt-' + d.part + '" style="font-style:normal;font-weight:700;color:var(--amber)">' +
        sign + '</i></span></div>';
    }).join('');
  const p = q.parts;
  const totals =
    '<div class="tt-r tt-sub"><span>condition</span><span>' + p.condition + ' / 40</span></div>' +
    '<div class="tt-r tt-sub"><span>overdue</span><span>' + p.overdue + ' / 25</span></div>' +
    '<div class="tt-r tt-sub"><span>safety</span><span>' + p.safety + ' / 20</span></div>' +
    '<div class="tt-r tt-sub"><span>exposure</span><span>' + p.exposure + ' / 15</span></div>' +
    '<div class="tt-r tt-total" style="font-weight:700;margin-top:4px;border-top:1px solid #334155;padding-top:3px"><span>Urgency score</span><span style="color:' +
    scoreColor(q.score) + '">' + q.score.toFixed(1) + '  ' + q.band + '</span></div>';
  return head + tipRows(rows) +
    '<div class="tt-sec">' + drivers + '</div>' +
    '<div class="tt-sec">' + totals + '</div>';
}

/* ---- Proposals shortlist (Spacious SCADA Cards) ---- */

export function renderProposals(): void {
  const box = byId('prop-list');
  if (!box) return;
  clear(box);

  const s = store.getState();
  const rank: Record<BlockStatus, number> = { PENDING: 0, APPROVED: 1, REJECTED: 2 };
  const list = s.proposals.slice().sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return b.score - a.score;
  });

  const pending = s.proposals.filter((p) => p.status === 'PENDING').length;
  const approved = s.proposals.filter((p) => p.status === 'APPROVED').length;
  const pp = byId('prop-pending');
  if (pp) pp.textContent = pending + ' pending';
  const ps = byId('prop-sub');
  if (ps) ps.textContent = s.proposals.length + ' proposed · ' + approved + ' approved';

  const tabCnt = byId('tab-cnt-blocks');
  if (tabCnt) tabCnt.textContent = String(s.proposals.length);

  list.forEach((p) => {
    const dur = totalDuration(p);
    const im = p.impact;
    const w = p.window;

    const card = el('div', 'prop-card' + (s.selProposal === p.id ? ' sel' : ''));

    // Header: ID + Section + Status Chip + Score
    const hd = el('div', 'prop-card-hd');
    hd.appendChild(el('b', null, p.id));
    hd.appendChild(document.createTextNode('  ·  ' + p.section + ' (' + p.line + ')'));

    const scBadge = el('span', 'chip', p.score.toFixed(0));
    scBadge.style.cssText = 'margin-left:auto;color:' + scoreColor(p.score) + ';border-color:' + scoreColor(p.score);
    hd.appendChild(scBadge);

    card.appendChild(hd);

    // Sub: Time Window, Physical Work Time, Bundled Count
    const sub = el('div', 'prop-card-sub');
    const winSpan = el('span', null, hhmm(p.start) + '–' + hhmm(p.start + dur));
    winSpan.style.color = '#fbbf24';
    winSpan.style.fontWeight = '700';
    sub.appendChild(winSpan);
    sub.appendChild(document.createTextNode(' · Window ' + dur + 'm (Work ' + w.workMin + 'm)'));
    sub.appendChild(document.createTextNode(' · ' + (p.items.length + p.added.length) + ' tasks'));
    const plantText = p.machines.length ? p.machines.map((x) => x.id).join(' + ') : 'Manual gang';
    sub.appendChild(document.createTextNode(' · ' + plantText));
    card.appendChild(sub);

    // Visual Physical Work Breakdown Progress Bar
    const barWrap = el('div');
    barWrap.style.cssText = 'margin:4px 0;';
    const bar = el('div');
    bar.style.cssText = 'display:flex;height:6px;background:#1e2638;overflow:hidden;gap:1px;';

    const segs: [number, string, string][] = [];
    if (w.protectionMin) segs.push([w.protectionMin / 2, '#f59e0b', 'Protection ' + (w.protectionMin / 2) + 'm']);
    if (w.earthingMin) segs.push([w.earthingMin / 2, '#38bdf8', 'Earthing ' + (w.earthingMin / 2) + 'm']);
    if (w.rampMin) segs.push([w.rampMin / 2, '#a78bfa', 'Ramp ' + (w.rampMin / 2) + 'm']);
    segs.push([w.workMin, '#22c55e', 'Work ' + w.workMin + 'm']);
    if (w.rampMin) segs.push([w.rampMin / 2, '#a78bfa', 'Ramp out ' + (w.rampMin / 2) + 'm']);
    if (w.earthingMin) segs.push([w.earthingMin / 2, '#38bdf8', 'De-earthing ' + (w.earthingMin / 2) + 'm']);
    if (w.protectionMin) segs.push([w.protectionMin / 2, '#f59e0b', 'Withdraw ' + (w.protectionMin / 2) + 'm']);

    segs.forEach((sg) => {
      const segEl = el('div');
      segEl.style.width = (100 * sg[0] / dur) + '%';
      segEl.style.background = sg[1];
      segEl.title = sg[2];
      bar.appendChild(segEl);
    });
    barWrap.appendChild(bar);
    card.appendChild(barWrap);

    // Impact Chips
    const chipsRow = el('div', 'prop-chips-row');
    const paxChip = el('span', 'chip ' + (im.paxDelayMin === 0 ? 'rout' : 'crit'),
      im.paxDelayMin === 0 ? '0 min delay' : '+' + im.paxDelayMin + ' min delay');
    chipsRow.appendChild(paxChip);

    if (im.freightLooped) {
      chipsRow.appendChild(el('span', 'chip urg', im.freightLooped + ' freight held'));
    }
    if (p.savings.savedMin > 0) {
      chipsRow.appendChild(el('span', 'chip', '−' + p.savings.savedMin + 'm bundled'));
    }
    if (p.status !== 'PENDING') {
      chipsRow.appendChild(el('span', 'chip ' + (p.status === 'APPROVED' ? 'rout' : 'crit'), p.status));
    }
    card.appendChild(chipsRow);

    // Overrun "Burst Buffer" Risk Projection (if buffer > 0)
    if (s.overrunMin > 0) {
      const proj = projectOverrun(p, p.start, dur, s.overrunMin);
      const bbRow = el('div');
      bbRow.style.cssText = 'padding:5px 8px;font-size:11px;font-family:var(--mono);margin-top:2px;';
      if (proj.totalDelayMin > 0) {
        bbRow.style.background = 'rgba(239, 68, 68, 0.12)';
        bbRow.style.border = '1px solid rgba(239, 68, 68, 0.35)';
        bbRow.style.color = '#f87171';
        bbRow.innerHTML = `<b>▲ OVERRUN RISK (+${s.overrunMin}m buffer):</b> +${proj.totalDelayMin}m added delay across ${proj.trains.length} trains (${proj.trains.map((t) => t.no).join(', ')})`;
      } else {
        bbRow.style.background = 'rgba(34, 197, 94, 0.1)';
        bbRow.style.border = '1px solid rgba(34, 197, 94, 0.3)';
        bbRow.style.color = '#4ade80';
        bbRow.innerHTML = `<b>● OVERRUN BUFFER (+${s.overrunMin}m):</b> 0 min added delay (buffer clear of traffic)`;
      }
      card.appendChild(bbRow);
    }

    // Direct Action CTA Buttons
    const actRow = el('div', 'prop-actions');

    if (p.status === 'PENDING') {
      const btnApprove = el('button', 'btn-sm btn-prop-ok', 'APPROVE + ISSUE MEMO');
      btnApprove.addEventListener('click', (e) => {
        e.stopPropagation();
        doApproveWithMemo(p, dur);
        renderProposals();
      });
      actRow.appendChild(btnApprove);

      const btnShift = el('button', 'btn-sm btn-prop-shift', 'SHIFT SLOT');
      btnShift.addEventListener('click', (e) => {
        e.stopPropagation();
        showShiftModal(p);
      });
      actRow.appendChild(btnShift);

      const btnReject = el('button', 'btn-sm btn-prop-no', 'REJECT / DEFER');
      btnReject.addEventListener('click', (e) => {
        e.stopPropagation();
        showRejectModal(p);
      });
      actRow.appendChild(btnReject);
    } else if (p.status === 'APPROVED') {
      const btnOrder = el('button', 'btn-sm btn-prop-ok',
        `VIEW CONTROL ORDER (PN: ${p.order?.pnSm ?? '48'})`);
      btnOrder.addEventListener('click', (e) => {
        e.stopPropagation();
        showMemoModal(p);
      });
      actRow.appendChild(btnOrder);
    } else if (p.status === 'REJECTED') {
      const rejBadge = el('span', 'chip crit',
        `REJECTED: ${p.rejectedFor?.code ?? 'REFUSED'}`);
      actRow.appendChild(rejBadge);
    }

    card.appendChild(actRow);
    card.addEventListener('click', () => {
      store.getState().setSelProposal(p.id);
    });

    box.appendChild(card);
  });
}

export function bindBurstBuffer(): void {
  const btns = document.querySelectorAll<HTMLElement>('.bb-btn');
  btns.forEach((b) => {
    b.addEventListener('click', () => {
      const extra = +(b.dataset.bb || '0');
      store.getState().setOverrunMin(extra);
      btns.forEach((x) => x.classList.toggle('on', x === b));
      const val = byId('bb-val');
      if (val) val.textContent = '+' + extra + ' MIN BUFFER';
      const desc = byId('bb-desc');
      if (desc) {
        desc.textContent = extra === 0
          ? 'Zero buffer selected: evaluating nominal handback window.'
          : `+${extra} min buffer active: simulating delayed track handback and downstream train precedence conflicts.`;
      }
      renderProposals();
    });
  });
}

/* ---- Rejection audit ---- */

export function renderAudit(): void {
  const box = byId('audit-list');
  if (!box) return;
  clear(box);

  const s = store.getState();
  const refused = s.proposals.filter((p) => p.status === 'REJECTED');

  const sub = byId('audit-sub');
  if (sub) sub.textContent = refused.length + ' refused this shift';
  const tabCnt = byId('tab-cnt-audit');
  if (tabCnt) tabCnt.textContent = String(refused.length);

  if (!refused.length) {
    box.appendChild(el('div', 'empty',
      'No blocks refused. When a block is rejected, it is recorded here with reason code and outstanding backlog impact.'));
    return;
  }

  refused.forEach((p) => {
    const it = el('div', 'log-item');
    const dot = el('div', 'log-dot');
    dot.style.background = 'var(--red)';
    it.appendChild(dot);

    const b = el('div', 'log-body');
    const t = el('div', 'log-t');
    t.appendChild(el('b', null, p.id));
    t.appendChild(document.createTextNode('  ' + p.section + ' · ' + p.line));
    b.appendChild(t);

    if (p.rejectedFor) {
      const code = el('div', 'log-m');
      const chip = el('span', 'chip crit', p.rejectedFor.code);
      code.appendChild(chip);
      code.appendChild(document.createTextNode('  ' + p.rejectedFor.label));
      b.appendChild(code);
      b.appendChild(el('div', 'log-m', p.rejectedFor.detail));
    }
    b.appendChild(el('div', 'log-m',
      (p.items.length + p.added.length) + ' demand(s) returned to backlog · ' +
      p.impact.overdueDaysCleared + ' overdue-days still outstanding'));
    it.appendChild(b);

    it.addEventListener('click', () => { store.getState().setSelProposal(p.id); });
    it.style.cursor = 'pointer';
    box.appendChild(it);
  });
}
