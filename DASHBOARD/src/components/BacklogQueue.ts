/* ============================================================
   BacklogQueue — Ingestion Feed, Scorer Queue, Proposals
   ============================================================ */

import { store } from '../store/useRailSyncStore.ts';
import {
  D, S, hhmm, shortCorr, esc, scoreColor, CLS_COLOR,
  totalDuration,
  byId, clear, el, tip, tipOff, tipRows,
} from '../lib/core.ts';
import type {
  Dept, Band, Demand, LiveProposal, BlockStatus, ProposalItem,
} from '../types/index.ts';

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
  const count = byId('q-count');
  if (count) count.textContent = rows.length + ' / ' + D().queue.length + ' demands';

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

    const c1 = el('td');
    c1.appendChild(el('span', 'mono', q.id));
    c1.style.whiteSpace = 'nowrap';
    tr.appendChild(c1);

    const c2 = el('td');
    c2.appendChild(el('span', 'dept-tag dept-' + q.dept, q.dept));
    tr.appendChild(c2);

    const c3 = el('td', null, shortCorr(q.corridor));
    const ln = el('div', 'mono', q.line);
    ln.style.cssText = 'font-size:9.5px;color:var(--text-mute)';
    c3.appendChild(ln);
    tr.appendChild(c3);

    const c4 = el('td', 'mono', q.chainage);
    c4.style.cssText = 'font-size:10.5px;white-space:nowrap';
    tr.appendChild(c4);

    const c5 = el('td', 'mono', q.telemetry);
    c5.style.cssText = 'font-size:10.5px;white-space:nowrap';
    tr.appendChild(c5);

    const c6 = el('td');
    c6.style.textAlign = 'right';
    const odc = q.overdueDays >= 10 ? 'od-hi' : q.overdueDays >= 4 ? 'od-md' : 'od-lo';
    c6.appendChild(el('span', 'od-pill ' + odc, q.overdueDays ? q.overdueDays + 'd' : '—'));
    tr.appendChild(c6);

    const c7 = el('td');
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
  const drivers = '<div class="tt-why">Why this score?</div>' +
    q.drivers.map((d) => {
      const sign = d.pts > 0 ? '+' + d.pts.toFixed(1) : '—';
      return '<div class="tt-r tt-drv"><span>' + esc(d.k) + '</span>' +
        '<span><b>' + esc(d.v) + '</b><i class="tt-pts pt-' + d.part + '">' +
        sign + '</i></span></div>';
    }).join('');
  const p = q.parts;
  const totals =
    '<div class="tt-r tt-sub"><span>condition</span><span>' + p.condition + ' / 40</span></div>' +
    '<div class="tt-r tt-sub"><span>overdue</span><span>' + p.overdue + ' / 25</span></div>' +
    '<div class="tt-r tt-sub"><span>safety</span><span>' + p.safety + ' / 20</span></div>' +
    '<div class="tt-r tt-sub"><span>exposure</span><span>' + p.exposure + ' / 15</span></div>' +
    '<div class="tt-r tt-total"><span>Urgency score</span><span style="color:' +
    scoreColor(q.score) + '">' + q.score.toFixed(1) + '  ' + q.band + '</span></div>';
  return head + tipRows(rows) +
    '<div class="tt-sec">' + drivers + '</div>' +
    '<div class="tt-sec">' + totals + '</div>';
}

/* ---- Proposals shortlist ---- */

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
  if (ps) ps.textContent = s.proposals.length + ' generated · ' + approved + ' approved';

  list.forEach((p) => {
    const dur = totalDuration(p);
    const im = p.impact;
    const row = el('div', 'log-item');
    row.style.cursor = 'pointer';
    if (s.selProposal === p.id) row.style.background = 'rgba(245,158,11,.10)';

    const dot = el('div', 'log-dot');
    dot.style.background = p.status === 'APPROVED' ? 'var(--green)'
      : p.status === 'REJECTED' ? 'var(--text-mute)' : scoreColor(p.score);
    row.appendChild(dot);

    const b = el('div', 'log-body');
    const t = el('div', 'log-t');
    t.appendChild(el('b', null, p.id));
    t.appendChild(document.createTextNode('  ' + p.section + ' · ' + p.line));
    b.appendChild(t);

    b.appendChild(el('div', 'log-m',
      hhmm(p.start) + '–' + hhmm(p.start + dur) + ' · window ' + dur +
      ' min / work ' + p.window.workMin + ' min · ' +
      (p.items.length + p.added.length) + ' task(s) · ' +
      (p.machines.length ? p.machines.map((x) => x.id).join('+') : 'manual gang')));

    const m2 = el('div', 'log-m');
    m2.style.marginTop = '4px';
    m2.appendChild(el('span', 'chip ' + (im.paxDelayMin === 0 ? 'rout' : 'crit'),
      im.paxDelayMin === 0 ? '0 min delay' : im.paxDelayMin + ' min delay'));
    if (im.freightLooped) {
      const d2 = el('span', 'chip urg', im.freightLooped + ' freight looped');
      d2.style.marginLeft = '4px';
      m2.appendChild(d2);
    }
    if (p.savings.savedMin > 0) {
      const d4 = el('span', 'chip', '−' + p.savings.savedMin + ' min bundled');
      d4.style.marginLeft = '4px';
      m2.appendChild(d4);
    }
    if (p.status !== 'PENDING') {
      const d3 = el('span', 'chip' + (p.status === 'APPROVED' ? ' rout' : ''), p.status);
      d3.style.marginLeft = '4px';
      m2.appendChild(d3);
    }
    b.appendChild(m2);
    row.appendChild(b);

    const sc = el('div', 'log-time', p.score.toFixed(0));
    sc.style.cssText += ';font-size:14px;font-weight:700;color:' + scoreColor(p.score);
    row.appendChild(sc);

    row.addEventListener('click', () => { store.getState().setSelProposal(p.id); });
    box.appendChild(row);
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

  if (!refused.length) {
    box.appendChild(el('div', 'empty',
      'No blocks refused. A rejection must carry an operational reason code, ' +
      'and it is recorded here with what it leaves outstanding.'));
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
      (p.items.length + p.added.length) + ' demand(s) back to backlog · ' +
      p.impact.overdueDaysCleared + ' overdue-days still outstanding'));
    it.appendChild(b);

    it.addEventListener('click', () => { store.getState().setSelProposal(p.id); });
    it.style.cursor = 'pointer';
    box.appendChild(it);
  });
}
