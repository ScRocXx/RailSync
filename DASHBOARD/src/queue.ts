/// <reference path="core.ts" />

/* ============================================================
   (iii) Multi-Departmental Ingestion Feed & Scorer Queue,
   plus the AI block-proposal shortlist that feeds the drawer.
   ============================================================ */

namespace RailSync.Queue {

  /* ------------------------------------------------------- filters */

  export function buildFilters(): void {
    const box = byId('q-filters');
    if (!box) return;
    clear(box);

    box.appendChild(el('span', 'f-lbl', 'Dept'));
    ([['TMS', 'P-Way'], ['TDMS', 'TRD'], ['SMMS', 'S&T']] as [Dept, string][]).forEach(function (d) {
      const b = el('button', 'f-btn' + (S.filters.dept[d[0]] ? ' on' : ''), d[1]);
      b.title = d[0];
      b.addEventListener('click', function () {
        S.filters.dept[d[0]] = !S.filters.dept[d[0]];
        b.classList.toggle('on', S.filters.dept[d[0]]);
        renderQueue();
      });
      box.appendChild(b);
    });

    box.appendChild(el('span', 'f-sep'));
    box.appendChild(el('span', 'f-lbl', 'Urgency'));
    ([['CRITICAL', 'Critical'], ['URGENT', 'Urgent'], ['ROUTINE', 'Routine']] as [Band, string][])
      .forEach(function (d) {
        const b = el('button', 'f-btn' + (S.filters.band[d[0]] ? ' on' : '') +
          (d[0] === 'CRITICAL' ? ' crit' : ''), d[1]);
        b.addEventListener('click', function () {
          S.filters.band[d[0]] = !S.filters.band[d[0]];
          b.classList.toggle('on', S.filters.band[d[0]]);
          renderQueue();
        });
        box.appendChild(b);
      });

    box.appendChild(el('span', 'f-sep'));
    const cb = el('button', 'f-btn' + (S.filters.corridorOnly ? ' on' : ''), 'This corridor only');
    cb.addEventListener('click', function () {
      S.filters.corridorOnly = !S.filters.corridorOnly;
      cb.classList.toggle('on', S.filters.corridorOnly);
      renderQueue();
    });
    box.appendChild(cb);
  }

  function filtered(): Demand[] {
    return D.queue.filter(function (q) {
      if (!S.filters.dept[q.dept]) return false;
      if (!S.filters.band[q.band]) return false;
      if (S.filters.corridorOnly && q.corridor !== S.corridor) return false;
      return true;
    });
  }

  /* ------------------------------------------------------- queue table */

  export function renderQueue(): void {
    const body = byId('q-body');
    if (!body) return;
    clear(body);

    const rows = filtered();
    const count = byId('q-count');
    if (count) count.textContent = rows.length + ' / ' + D.queue.length + ' demands';

    if (!rows.length) {
      const tr0 = el('tr');
      const td0 = el('td', 'empty', 'No demands match the current filters.');
      td0.colSpan = 7;
      tr0.appendChild(td0);
      body.appendChild(tr0);
      return;
    }

    rows.forEach(function (q) {
      const tr = el('tr');
      if (S.selDemand === q.id) tr.className = 'sel';

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

      tr.addEventListener('mousemove', function (e) { tip(demandTip(q), e as MouseEvent); });
      tr.addEventListener('mouseleave', tipOff);
      tr.addEventListener('click', function () {
        S.selDemand = (S.selDemand === q.id) ? null : q.id;
        tipOff();
        renderQueue();
        // Jump to whichever proposal already carries this demand.
        const owner = S.proposals.filter(function (p) {
          return p.items.some(function (i) { return i.id === q.id; }) ||
                 p.added.some(function (a) { return a.id === q.id; });
        })[0];
        if (S.selDemand && owner) bus.emit('openProposal', owner.id);
      });

      body.appendChild(tr);
    });
  }

  /** "Why this score?" — controllers distrust a bare number, so the tooltip
      leads with the physical parameters that produced it, then the component
      totals, then the score. */
  function demandTip(q: Demand): string {
    const head = '<div class="tt-h"><span class="dept-tag dept-' + q.dept + '">' + q.dept +
      '</span>' + esc(q.id) + '</div>';

    const rows: [string, string][] = [
      ['Department', q.deptFull],
      ['Required action', q.action.replace(/_/g, ' ')],
      ['Section', shortCorr(q.corridor) + ' · ' + q.line],
      ['Est. work time', q.durationMin + ' min']
    ];

    const drivers = '<div class="tt-why">Why this score?</div>' +
      q.drivers.map(function (d) {
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

  /* ------------------------------------------------------- proposals */

  /** (vii) Rejection audit — the register of refused blocks and why. */
  export function renderAudit(): void {
    const box = byId('audit-list');
    if (!box) return;
    clear(box);

    const refused = S.proposals.filter(function (p) { return p.status === 'REJECTED'; });
    const sub = byId('audit-sub');
    if (sub) sub.textContent = refused.length + ' refused this shift';

    if (!refused.length) {
      box.appendChild(el('div', 'empty',
        'No blocks refused. A rejection must carry an operational reason code, ' +
        'and it is recorded here with what it leaves outstanding.'));
      return;
    }

    refused.forEach(function (p) {
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

      it.addEventListener('click', function () { bus.emit('openProposal', p.id); });
      it.style.cursor = 'pointer';
      box.appendChild(it);
    });
  }

  export function renderProposals(): void {
    const box = byId('prop-list');
    if (!box) return;
    clear(box);

    const rank: Record<BlockStatus, number> = { PENDING: 0, APPROVED: 1, REJECTED: 2 };
    const list = S.proposals.slice().sort(function (a, b) {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return b.score - a.score;
    });

    const pending = S.proposals.filter(function (p) { return p.status === 'PENDING'; }).length;
    const approved = S.proposals.filter(function (p) { return p.status === 'APPROVED'; }).length;
    const pp = byId('prop-pending');
    if (pp) pp.textContent = pending + ' pending';
    const ps = byId('prop-sub');
    if (ps) ps.textContent = S.proposals.length + ' generated · ' + approved + ' approved';

    list.forEach(function (p) {
      const dur = totalDuration(p);
      const im = p.impact;
      const row = el('div', 'log-item');
      row.style.cursor = 'pointer';
      if (S.selProposal === p.id) row.style.background = 'rgba(245,185,66,.10)';

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
        (p.machines.length ? p.machines.map(function (x) { return x.id; }).join('+') : 'manual gang')));

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

      row.addEventListener('click', function () { bus.emit('openProposal', p.id); });
      box.appendChild(row);
    });
  }
}
