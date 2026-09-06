/* ============================================================
   BlockDrawer — Block Approval & Recommendation Drawer
   Full domain logic preserved from drawer.ts.
   ============================================================ */

import { store } from '../store/useRailSyncStore.ts';
import {
  D, S, DAY, hhmm, pad2, esc, scoreColor, CLS_COLOR,
  totalDuration, issueOrder, scoreWindow, projectOverrun, mergeImpact,
  byId, clear, el, tip, tipOff, tipRows, toast, logEvent,
} from '../lib/core.ts';
import type {
  LiveProposal, ProposalItem, Demand, ShadowTask,
  Impact, WindowScore, ReasonCode, Band,
} from '../types/index.ts';

let shiftDelta = 0;
let rejectMode = false;

function find(id: string | null): LiveProposal | undefined {
  return store.getState().proposals.filter((p) => p.id === id)[0];
}

export function open(id: string): void {
  store.getState().setSelProposal(id);
  shiftDelta = 0;
  rejectMode = false;
  store.getState().setOverrunMin(0);
  const dw = byId('drawer');
  if (dw) dw.classList.add('on');
  render();
}

export function close(): void {
  store.getState().setSelProposal(null);
  const dw = byId('drawer');
  if (dw) dw.classList.remove('on');
}

/* ---- Building blocks ---- */

function sec(title: string, node: HTMLElement): HTMLElement {
  const s = el('div', 'dw-sec');
  s.appendChild(el('h3', null, title));
  s.appendChild(node);
  return s;
}

function kv(pairs: [string, string | null | undefined][]): HTMLElement {
  const d = el('dl', 'kv');
  pairs.forEach((p) => {
    if (p[1] === null || p[1] === undefined || p[1] === '') return;
    d.appendChild(el('dt', null, p[0]));
    d.appendChild(el('dd', null, p[1]));
  });
  return d;
}

function impactTile(v: string | number, k: string, cls?: string): HTMLElement {
  const d = el('div', 'impact ' + (cls || ''));
  d.appendChild(el('div', 'i-v', String(v)));
  d.appendChild(el('div', 'i-k', k));
  return d;
}

function taskCard(i: ProposalItem | Demand, isShadow: boolean): HTMLElement {
  const c = el('div', 'card');
  const h = el('div', 'card-h');
  h.appendChild(el('span', 'dept-tag dept-' + i.dept, i.dept));
  h.appendChild(el('b', null, i.id));
  const sp = el('span', 'chip ' +
    (i.band === 'CRITICAL' ? 'crit' : i.band === 'URGENT' ? 'urg' : 'rout'),
    i.score !== undefined ? i.score.toFixed(0) : '—');
  sp.style.marginLeft = 'auto';
  h.appendChild(sp);
  c.appendChild(h);

  c.appendChild(el('div', 'card-m',
    i.action.replace(/_/g, ' ') + '  ·  ' + i.chainage + '  ·  ' + i.telemetry +
    '  ·  ' + (i.overdueDays || 0) + 'd overdue'));

  if (i.drivers && i.drivers.length) {
    const dv = el('div', 'drv-row');
    i.drivers.filter((d) => d.pts > 0).forEach((d) => {
      const chip = el('span', 'drv pt-' + d.part);
      chip.appendChild(el('span', 'drv-k', d.k));
      chip.appendChild(el('span', 'drv-v', d.v));
      chip.appendChild(el('span', 'drv-p', '+' + d.pts.toFixed(0)));
      dv.appendChild(chip);
    });
    c.appendChild(dv);
  }

  if (isShadow) {
    const b = el('div', 'card-m', 'Bundled by controller (shadow suggestion)');
    b.style.color = 'var(--violet)';
    c.appendChild(b);
  }
  return c;
}

function fmtHours(h: number): string {
  const m = Math.round(h * 60);
  return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
}

/* ---- Render ---- */

export function render(): void {
  const s = store.getState();
  const p = find(s.selProposal);
  const bd = byId('dw-bd');
  const ft = byId('dw-ft');
  if (!bd || !ft) return;
  if (!p) { clear(bd); clear(ft); return; }

  const dur = totalDuration(p);
  const start = p.start + shiftDelta;
  const im: Impact | WindowScore = shiftDelta ? scoreWindow(p, start, dur) : p.impact;

  const idEl = byId('dw-id');
  if (idEl) idEl.textContent = p.id;
  const st = byId('dw-status');
  if (st) {
    st.textContent = p.status;
    st.className = 'chip ' + (p.status === 'APPROVED' ? 'rout' : p.status === 'REJECTED' ? '' : 'urg');
  }
  const subEl = byId('dw-sub');
  if (subEl) subEl.textContent = p.corridorName + '  ·  ' + p.section + '  ·  ' + p.line;

  clear(bd);

  /* 1. Work time vs granted window */
  bd.appendChild(sec('Block Window', windowBreakdown(p, dur, start)));

  /* 2. Block summary */
  bd.appendChild(sec('Block Summary', kv([
    ['Chainage', 'KM ' + p.loKm.toFixed(2) + ' – ' + p.hiKm.toFixed(2)],
    ['Lines occupied', p.lines.join(' + ')],
    ['Traffic block type', p.machines.length ? 'Corridor block with plant' : 'Manual gang possession'],
    ['Required isolation', p.isolation || '—'],
    ['Isolators to open', p.isolators && p.isolators.length ? p.isolators.join(', ') : '—'],
    ['Disconnection memo', p.memo || '—'],
    ['Interlocked routes', p.routes && p.routes.length ? p.routes.join(', ') : '—'],
  ])));

  /* 3. Tasks + savings */
  const tasks = el('div');
  if (p.savings.savedMin > 0) {
    const cal = el('div', 'callout');
    cal.appendChild(el('div', 'callout-v', '−' + p.savings.savedMin + ' min'));
    cal.appendChild(el('div', 'callout-t',
      'Bundling ' + p.savings.depts.join(' + ') + ' into one possession saves ' +
      p.savings.savedMin + ' minutes of independent line possession (' +
      p.savings.independentMin + ' min as ' + p.savings.tasks +
      ' separate blocks vs ' + p.savings.bundledMin + ' min bundled) — ' +
      'protection, isolation and traffic cost are paid once.'));
    tasks.appendChild(cal);
  }
  p.items.forEach((i) => { tasks.appendChild(taskCard(i, false)); });
  p.added.forEach((a) => {
    const q = D().queue.filter((x) => x.id === a.id)[0];
    if (q) tasks.appendChild(taskCard(q, true));
  });
  bd.appendChild(sec('Bundled Tasks (' + (p.items.length + p.added.length) + ')', tasks));

  /* 4. Machines + HOER */
  bd.appendChild(sec('Allocated Machines', machineList(p, dur)));

  /* 5. Impact */
  bd.appendChild(sec('Impact Metrics', impactBlock(p, im, start, dur)));

  /* 6. Freight regulation */
  if (p.regulation.length) bd.appendChild(sec('Freight Regulation', regulationList(p)));

  /* 7. Overrun */
  bd.appendChild(sec('Overrun Risk (Burst Buffer)', overrunControl(p, start, dur)));

  /* 8. Post-work TSR */
  if (p.postTsr) bd.appendChild(sec('Post-Work Speed Restriction', postTsrBlock(p)));

  /* 9. Shift slot */
  bd.appendChild(sec('Shift Time Slot', shiftControl(p, dur, start, im)));

  /* 10. Shadow bundling */
  if (p.shadow && p.shadow.length) bd.appendChild(sec('Shadow Bundling Suggestions', shadowList(p)));

  /* 11. Control order */
  if (p.order) bd.appendChild(sec('Control Order Issued', orderBlock(p)));

  /* 12. Rejection reason */
  if (p.status === 'REJECTED' && p.rejectedFor) {
    const r = el('div');
    const c = el('div', 'card');
    const h = el('div', 'card-h');
    h.appendChild(el('span', 'chip crit', p.rejectedFor.code));
    h.appendChild(el('b', null, p.rejectedFor.label));
    c.appendChild(h);
    c.appendChild(el('div', 'card-m', p.rejectedFor.detail));
    r.appendChild(c);
    bd.appendChild(sec('Rejection Reason', r));
  }

  renderFooter(p, im, start, dur, ft);
}

/* Window breakdown */
function windowBreakdown(p: LiveProposal, dur: number, start: number): HTMLElement {
  const w = p.window;
  const wrap = el('div');
  const head = el('div', 'win-head');
  const a = el('div');
  a.appendChild(el('div', 'win-k', 'Total block window'));
  a.appendChild(el('div', 'win-v', hhmm(start) + ' – ' + hhmm(start + dur)));
  a.appendChild(el('div', 'win-s', dur + ' min granted'));
  head.appendChild(a);
  const b = el('div');
  b.appendChild(el('div', 'win-k', 'Physical work time'));
  const wv = el('div', 'win-v', w.workMin + ' min');
  wv.style.color = 'var(--green)';
  b.appendChild(wv);
  b.appendChild(el('div', 'win-s', (dur - w.workMin) + ' min overheads'));
  head.appendChild(b);
  wrap.appendChild(head);

  const bar = el('div', 'win-bar');
  const segs: [number, string, string][] = [];
  if (w.protectionMin) segs.push([w.protectionMin / 2, 'seg-prot', 'Protection set ' + (w.protectionMin / 2) + ' min']);
  if (w.earthingMin) segs.push([w.earthingMin / 2, 'seg-earth', 'OHE earthing ' + (w.earthingMin / 2) + ' min']);
  if (w.rampMin) segs.push([w.rampMin / 2, 'seg-ramp', 'Machine ramp in ' + (w.rampMin / 2) + ' min']);
  segs.push([w.workMin, 'seg-work', 'Physical work ' + w.workMin + ' min']);
  if (w.rampMin) segs.push([w.rampMin / 2, 'seg-ramp', 'Machine ramp out ' + (w.rampMin / 2) + ' min']);
  if (w.earthingMin) segs.push([w.earthingMin / 2, 'seg-earth', 'OHE de-earthing ' + (w.earthingMin / 2) + ' min']);
  if (w.protectionMin) segs.push([w.protectionMin / 2, 'seg-prot', 'Protection withdrawn ' + (w.protectionMin / 2) + ' min']);
  segs.forEach((sg) => {
    const n = el('i', sg[1]);
    n.style.width = (100 * sg[0] / dur) + '%';
    n.title = sg[2];
    bar.appendChild(n);
  });
  wrap.appendChild(bar);

  const key = el('div', 'win-key');
  [['seg-prot', 'Protection'], ['seg-earth', 'Earthing'],
   ['seg-ramp', 'Ramp'], ['seg-work', 'Work']].forEach((k) => {
    if (k[0] === 'seg-earth' && !w.earthingMin) return;
    if (k[0] === 'seg-ramp' && !w.rampMin) return;
    const i = el('i');
    i.appendChild(el('b', k[0]));
    i.appendChild(document.createTextNode(k[1]));
    key.appendChild(i);
  });
  wrap.appendChild(key);
  return wrap;
}

/* Machine list + HOER */
function machineList(p: LiveProposal, dur: number): HTMLElement {
  const mc = el('div');
  if (p.machines.length) {
    p.machines.forEach((m) => {
      const c = el('div', 'card');
      const h = el('div', 'card-h');
      h.appendChild(el('b', null, m.id + '  ·  ' + m.model));
      h.appendChild(el('span', 'chip', m.type));
      c.appendChild(h);
      const safe = !m.crewRelief;
      const badge = el('div', 'hoer' + (safe ? ' ok' : ' bad'));
      badge.appendChild(el('span', 'hoer-k', 'Crew duty remaining'));
      badge.appendChild(el('span', 'hoer-v', fmtHours(m.crewRemainingHours)));
      badge.appendChild(el('span', 'hoer-s',
        safe ? 'Safe for this ' + dur + ' min block'
             : 'SHORT for this ' + dur + ' min block — crew change required'));
      c.appendChild(badge);
      c.appendChild(kv([
        ['Stabled at', m.from + (m.siding ? ' · ' + m.siding : '')],
        ['Base depot', m.depot],
        ['Transit to site', m.transitMin + ' min'],
        ['Ramp in / out', m.rampIn + ' / ' + m.rampOut + ' min'],
        ['Report by', m.reportBy],
        ['Engaged', m.engagedHours + ' h siding to siding'],
        ['Crew', m.crew + '  (' + m.dutyHours.toFixed(1) + '/' + m.maxHours + ' h worked)'],
        ['HSD fuel', Math.round(m.fuel) + ' L'],
        ['Task', m.task.replace(/_/g, ' ')],
      ]));
      mc.appendChild(c);
    });
  } else if (!p.plantShortfall || !p.plantShortfall.length) {
    mc.appendChild(el('div', 'mini-note', 'No track machine required — manual gang / S&T staff possession.'));
  }
  if (p.plantShortfall && p.plantShortfall.length) {
    const counts: Record<string, number> = {};
    p.plantShortfall.forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
    const list = Object.keys(counts).map((t) => counts[t] + '× ' + t).join(', ');
    const n = el('div', 'mini-note',
      'Plant shortfall: ' + list + ' could not be sourced for this window.');
    n.style.color = 'var(--amber)';
    mc.appendChild(n);
  }
  return mc;
}

/* Impact */
function impactBlock(p: LiveProposal, im: Impact | WindowScore, start: number, dur: number): HTMLElement {
  const grid = el('div', 'impact-grid');
  grid.appendChild(impactTile(im.paxDelayMin, 'Train delay induced (min)', im.paxDelayMin === 0 ? 'ok' : 'warn'));
  grid.appendChild(impactTile(im.freightLooped, 'Freight regulated to loops', im.freightLooped ? 'warn' : 'ok'));
  grid.appendChild(impactTile(p.items.length + p.added.length, 'Backlog demands cleared', 'ok'));
  grid.appendChild(impactTile(p.impact.overdueDaysCleared, 'Overdue-days retired', 'ok'));
  const wrap = el('div');
  wrap.appendChild(grid);
  if (im.paxDelayMin === 0) {
    wrap.appendChild(el('div', 'mini-note',
      'Window verified clear: no booked path on ' + p.lines.join('/') + ' crosses KM ' +
      p.loKm.toFixed(1) + '–' + p.hiKm.toFixed(1) + ' between ' +
      hhmm(start) + ' and ' + hhmm(start + dur) + '.'));
  } else {
    wrap.appendChild(el('div', 'mini-note', 'Conflicting paths: ' +
      im.conflictTrains.map((t) => t.no).join(', ')));
  }
  return wrap;
}

/* Freight regulation */
function regulationList(p: LiveProposal): HTMLElement {
  const wrap = el('div');
  p.regulation.forEach((rg) => {
    const c = el('div', 'card');
    const h = el('div', 'card-h');
    h.appendChild(el('b', null, rg.rake));
    h.appendChild(el('span', 'chip ' + (rg.fits ? 'rout' : 'crit'),
      rg.fits ? rg.loop + ' loop' : 'NO LOOP'));
    c.appendChild(h);
    c.appendChild(el('div', 'card-m', rg.fits
      ? 'Rake ' + rg.lengthM + ' m stands in ' + rg.loop + ' loop (CSR ' +
        rg.loopCsr + ' m) — ' + Math.round((rg.loopCsr || 0) - (rg.lengthM || 0)) + ' m clearance.'
      : 'Rake ' + rg.lengthM + ' m exceeds the clear standing room of every loop.'));
    wrap.appendChild(c);
  });
  return wrap;
}

/* Overrun burst buffer */
function overrunControl(p: LiveProposal, start: number, dur: number): HTMLElement {
  const s = store.getState();
  const wrap = el('div');
  const row = el('div', 'seg');
  row.style.marginBottom = '8px';
  ([[0, 'On time'], [15, '+15 min'], [30, '+30 min']] as [number, string][])
    .forEach((o) => {
      const b = el('button', s.overrunMin === o[0] ? 'on' : '', o[1]);
      b.addEventListener('click', () => { store.getState().setOverrunMin(o[0]); render(); });
      row.appendChild(b);
    });
  wrap.appendChild(row);
  if (s.overrunMin === 0) {
    wrap.appendChild(el('div', 'mini-note',
      'Simulate an overrun to see which paths take the knock-on.'));
    return wrap;
  }
  const proj = projectOverrun(p, start, dur, s.overrunMin);
  const grid = el('div', 'impact-grid');
  grid.appendChild(impactTile(proj.trains.length, 'Trains taking knock-on', proj.trains.length ? 'warn' : 'ok'));
  grid.appendChild(impactTile(proj.totalDelayMin, 'Cascade delay (min)', proj.totalDelayMin ? 'warn' : 'ok'));
  wrap.appendChild(grid);
  if (!proj.trains.length) {
    const n = el('div', 'mini-note',
      'Hand-back at ' + hhmm(start + dur + s.overrunMin) + ' still clears every booked path.');
    n.style.color = 'var(--green)';
    wrap.appendChild(n);
  } else {
    proj.trains.slice(0, 5).forEach((t) => {
      const c = el('div', 'card');
      const h = el('div', 'card-h');
      h.appendChild(el('span', 'swatch'));
      (h.firstChild as HTMLElement).style.background = CLS_COLOR[t.cls];
      h.appendChild(el('b', null, t.no + ' · ' + t.name));
      const chip = el('span', 'chip crit', '+' + t.delayMin + ' min');
      chip.style.marginLeft = 'auto';
      h.appendChild(chip);
      c.appendChild(h);
      wrap.appendChild(c);
    });
    const n = el('div', 'mini-note',
      'If the gang hands back ' + s.overrunMin + ' min late, ' +
      proj.trains.length + ' path(s) are held, worst case +' + proj.worst + ' min.');
    n.style.color = 'var(--red)';
    wrap.appendChild(n);
  }
  return wrap;
}

/* Post-work TSR */
function postTsrBlock(p: LiveProposal): HTMLElement {
  const t = p.postTsr!;
  const wrap = el('div');
  const cal = el('div', 'callout warn');
  cal.appendChild(el('div', 'callout-v', t.speed + ' km/h'));
  cal.appendChild(el('div', 'callout-t',
    'Post-work TSR: ' + t.speed + ' km/h over ' + t.lengthKm + ' km for ' + t.hours +
    ' h (normal ' + t.normalSpeed + ' km/h) — adds +' + t.addedMinPerTrain + ' min runtime per train.'));
  wrap.appendChild(cal);
  return wrap;
}

/* Control order */
function orderBlock(p: LiveProposal): HTMLElement {
  const o = p.order!;
  const wrap = el('div');
  const pn = el('div', 'pn-row');
  const a = el('div', 'pn');
  a.appendChild(el('span', 'pn-k', 'Private Number — SM'));
  a.appendChild(el('span', 'pn-v', String(o.pnSm)));
  pn.appendChild(a);
  if (o.pnTpc !== null) {
    const b = el('div', 'pn');
    b.appendChild(el('span', 'pn-k', 'Private Number — TPC'));
    b.appendChild(el('span', 'pn-v', String(o.pnTpc)));
    pn.appendChild(b);
  }
  wrap.appendChild(pn);
  const pre = el('pre', 'memo');
  pre.textContent = o.text;
  wrap.appendChild(pre);
  const copy = el('button', 'btn btn-sh', 'Copy control order');
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(o.text).then(
      () => toast('Control order copied to clipboard'),
      () => toast('Select the memo text to copy', 'warn')
    );
  });
  copy.style.marginTop = '7px';
  wrap.appendChild(copy);
  return wrap;
}

/* Shift time slot */
function shiftControl(p: LiveProposal, dur: number, start: number, im: Impact | WindowScore): HTMLElement {
  const sh = el('div');
  const row = el('div', 'shift-row');
  const minus = el('button', 'f-btn', '−15');
  const rng = el('input');
  rng.type = 'range';
  rng.min = '-240'; rng.max = '240'; rng.step = '5';
  rng.value = String(shiftDelta);
  const plus = el('button', 'f-btn', '+15');
  const out = el('span', 'mono', (shiftDelta >= 0 ? '+' : '') + shiftDelta + ' min');
  out.style.cssText = 'width:74px;text-align:right;font-size:11.5px';

  function apply(v: number): void {
    shiftDelta = Math.max(-240, Math.min(240, v));
    if (p.start + shiftDelta < 0) shiftDelta = -p.start;
    if (p.start + shiftDelta + dur > DAY) shiftDelta = DAY - dur - p.start;
    render();
  }
  minus.addEventListener('click', () => apply(shiftDelta - 15));
  plus.addEventListener('click', () => apply(shiftDelta + 15));
  rng.addEventListener('input', () => apply(+rng.value));
  row.appendChild(minus); row.appendChild(rng); row.appendChild(plus); row.appendChild(out);
  sh.appendChild(row);

  const note = el('div', 'recalc');
  if (shiftDelta === 0) {
    note.textContent = 'Optimised slot. Drag to test an alternative window — impact re-scores live.';
  } else {
    const base = p.impact.paxDelayMin;
    const verdict = im.paxDelayMin === base ? 'same traffic cost'
      : im.paxDelayMin < base ? 'better — less delay'
      : 'worse — ' + (im.paxDelayMin - base) + ' min more delay';
    note.textContent = 'Shifted to ' + hhmm(start) + '–' + hhmm(start + dur) + ': ' + verdict + '.';
    note.style.color = im.paxDelayMin > base ? 'var(--red)' : 'var(--green)';
  }
  sh.appendChild(note);
  return sh;
}

/* Shadow bundling */
function shadowList(p: LiveProposal): HTMLElement {
  const shd = el('div');
  p.shadow.forEach((s) => {
    const added = p.added.some((a) => a.id === s.id);
    const it = el('div', 'shadow-item' + (added ? ' added' : ''));
    const g = el('div', 'grow');
    const t1 = el('div', 'log-t');
    t1.appendChild(el('b', null, s.id));
    g.appendChild(t1);
    g.appendChild(el('div', 'log-m',
      s.action.replace(/_/g, ' ') + ' · ' + s.chainage + ' · ' + s.gapKm + ' km away'));
    g.appendChild(el('div', 'log-m', s.note));
    it.appendChild(g);

    const btn = el('button', 'add', added ? 'Added' : '+ Bundle');
    btn.disabled = p.status !== 'PENDING';
    btn.addEventListener('click', () => {
      store.getState().updateProposal(p.id, (pp) => {
        const next = { ...pp };
        if (added) {
          next.added = next.added.filter((a) => a.id !== s.id);
          logEvent('bundle', p.id + ' — shadow task removed', s.id + ' dropped.', p.id);
        } else {
          next.added = [...next.added, s];
          logEvent('bundle', p.id + ' — shadow task bundled',
            s.id + ' folded (+' + s.addMin + ' min).', p.id);
        }
        next.impact = mergeImpact(next, scoreWindow(next, next.start, totalDuration(next)));
        return next;
      });
      render();
    });
    it.appendChild(btn);
    shd.appendChild(it);
  });
  return shd;
}

/* Footer / decisions */
function renderFooter(p: LiveProposal, im: Impact | WindowScore,
                      start: number, dur: number, ft: HTMLElement): void {
  clear(ft);
  if (p.status !== 'PENDING') {
    const reopen = el('button', 'btn', 'Reopen as Pending');
    reopen.addEventListener('click', () => {
      store.getState().updateProposal(p.id, (pp) => {
        const next = { ...pp, status: 'PENDING' as const };
        delete next.rejectedFor;
        return next;
      });
      logEvent('reopen', p.id + ' reopened', 'Returned to pending queue.', p.id);
      render();
    });
    ft.appendChild(reopen);
    return;
  }

  if (rejectMode) {
    const box = el('div', 'reason-box');
    box.appendChild(el('div', 'reason-h', 'Select a reason code — required for the register'));
    p.reasons.forEach((rc) => {
      const b = el('button', 'reason');
      b.appendChild(el('span', 'chip crit', rc.code));
      const g = el('div', 'grow');
      g.appendChild(el('div', 'reason-l', rc.label));
      g.appendChild(el('div', 'reason-d', rc.detail));
      b.appendChild(g);
      b.addEventListener('click', () => doReject(p, rc));
      box.appendChild(b);
    });
    const cancel = el('button', 'btn', 'Cancel');
    cancel.addEventListener('click', () => { rejectMode = false; render(); });
    box.appendChild(cancel);
    ft.appendChild(box);
    ft.classList.add('tall');
    return;
  }

  ft.classList.remove('tall');
  const ok = el('button', 'btn btn-ok',
    shiftDelta ? 'Approve Shifted + Issue Order' : 'Approve + Issue Order');
  ok.addEventListener('click', () => doApprove(p, im, start, dur));
  const no = el('button', 'btn btn-no', 'Reject / Defer');
  no.addEventListener('click', () => { rejectMode = true; render(); });
  ft.appendChild(ok);
  ft.appendChild(no);
  if (shiftDelta) {
    const rs = el('button', 'btn btn-sh', 'Reset');
    rs.addEventListener('click', () => { shiftDelta = 0; render(); });
    ft.appendChild(rs);
  }
}

function doApprove(p: LiveProposal, im: Impact | WindowScore,
                   start: number, dur: number): void {
  store.getState().updateProposal(p.id, (pp) => {
    const next = { ...pp };
    if (shiftDelta) {
      next.start = start;
      logEvent('shift', pp.id + ' slot shifted',
        'Moved ' + (shiftDelta > 0 ? '+' : '') + shiftDelta + ' min.', pp.id);
    }
    next.end = next.start + dur;
    next.impact = mergeImpact(next, im as WindowScore);
    next.status = 'APPROVED';
    next.order = issueOrder(next, next.start, dur);
    return next;
  });
  shiftDelta = 0;

  const pp = find(p.id)!;
  logEvent('approve', pp.id + ' approved — PN ' + pp.order!.pnSm,
    pp.section + ' · ' + pp.lines.join('+') + ' · ' + hhmm(pp.start) + '–' + hhmm(pp.end) +
    ' (' + dur + ' min window, ' + pp.window.workMin + ' min work) · ' +
    (pp.items.length + pp.added.length) + ' task(s) cleared.', pp.id);
  toast('Block ' + pp.id + ' approved — Private Number ' + pp.order!.pnSm);
  render();
}

function doReject(p: LiveProposal, rc: ReasonCode): void {
  store.getState().updateProposal(p.id, (pp) => ({
    ...pp,
    status: 'REJECTED' as const,
    rejectedFor: rc,
  }));
  rejectMode = false;
  logEvent('reject', p.id + ' rejected — [' + rc.code + '] ' + rc.label,
    rc.detail, p.id);
  toast('Block ' + p.id + ' refused — ' + rc.code, 'bad');
  render();
}

/* ---- Wiring ---- */

export function bind(): void {
  const c = byId('dw-close');
  if (c) c.addEventListener('click', close);

  // Subscribe to proposal selection changes
  store.subscribe((state, prev) => {
    if (state.selProposal !== prev.selProposal && state.selProposal) {
      open(state.selProposal);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && store.getState().selProposal) close();
  });
}
