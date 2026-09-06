/* ============================================================
   FleetTracker — Mobile Plant & Crew HOER Tracker
   ============================================================ */

import { store } from '../store/useRailSyncStore.ts';
import {
  D, S, hhmm, pad2,
  byId, clear, el,
} from '../lib/core.ts';
import type { Machine, LiveProposal, MachineAlloc } from '../types/index.ts';

let host: HTMLElement | null = null;

/** Blocks this machine is committed to today, in order. */
function dutyFor(id: string): { p: LiveProposal; m: MachineAlloc }[] {
  const out: { p: LiveProposal; m: MachineAlloc }[] = [];
  store.getState().proposals.forEach((p) => {
    if (p.status === 'REJECTED') return;
    p.machines.forEach((m) => {
      if (m.id === id) out.push({ p, m });
    });
  });
  out.sort((a, b) => a.p.start - b.p.start);
  return out;
}

export function render(): void {
  host = host || byId('fleet-root');
  if (!host) return;
  clear(host);

  const data = D();
  const proposals = store.getState().proposals;

  const fit = data.machines.filter((m) => m.fitness === 'FIT').length;
  const committed = data.machines.filter((m) => dutyFor(m.id).length > 0).length;
  const atRisk = proposals.filter((p) =>
    p.status !== 'REJECTED' && p.machines.some((m) => m.crewRelief)
  ).length;

  const hd = el('div', 'panel-hd');
  hd.appendChild(el('h2', null, 'Fleet & Crew HOER Tracker'));
  hd.appendChild(el('span', 'sub', fit + ' fit of ' + data.machines.length +
    ' · ' + committed + ' committed today · ' + atRisk + ' block(s) need a crew change'));
  host.appendChild(hd);

  /* ---- depot roll-up: where the plant is stabled ---- */
  const byDepot: Record<string, Machine[]> = {};
  data.machines.forEach((m) => {
    (byDepot[m.depot] = byDepot[m.depot] || []).push(m);
  });

  const depotRow = el('div', 'depot-row');
  Object.keys(byDepot).sort().forEach((dep) => {
    const ms = byDepot[dep];
    const card = el('div', 'depot-card');
    const h = el('div', 'depot-h');
    h.appendChild(el('b', null, dep));
    h.appendChild(el('span', 'chip',
      ms.filter((m) => m.fitness === 'FIT').length + '/' + ms.length + ' fit'));
    card.appendChild(h);
    ms.forEach((m) => {
      const r = el('div', 'depot-m');
      const dot = el('i');
      dot.style.background = m.fitness === 'FIT' ? 'var(--green)' : 'var(--red)';
      r.appendChild(dot);
      r.appendChild(el('span', null, m.id));
      r.appendChild(el('span', 'grow', ''));
      r.appendChild(el('span', 'mono', m.type));
      card.appendChild(r);
    });
    depotRow.appendChild(card);
  });
  host.appendChild(depotRow);

  /* ---- machine cards with the HOER red line ---- */
  const grid = el('div', 'asset-grid');
  data.machines.forEach((m) => {
    const duty = dutyFor(m.id);
    const engaged = duty.reduce((a, d) => a + d.m.engagedHours, 0);
    const remaining = Math.max(0, m.maxHours - m.dutyHours - engaged);
    const relief = duty.some((d) => d.m.crewRelief);

    const c = el('div', 'asset-card' + (relief ? ' at-risk' : ''));
    const hh = el('div');
    hh.style.cssText = 'display:flex;align-items:center;gap:7px';
    hh.appendChild(el('h4', null, m.id));
    const fitChip = el('span', 'chip ' + (m.fitness === 'FIT' ? 'rout' : 'crit'), m.fitness);
    fitChip.style.marginLeft = 'auto';
    hh.appendChild(fitChip);
    c.appendChild(hh);
    c.appendChild(el('div', 'meta', m.model + ' · ' + m.type + ' · base ' + m.depot));

    /* HOER red line */
    const pct = 100 * (m.dutyHours + engaged) / m.maxHours;
    const badge = el('div', 'hoer' + (relief ? ' bad' : pct > 85 ? ' warn' : ' ok'));
    badge.appendChild(el('span', 'hoer-k', 'Crew duty remaining'));
    badge.appendChild(el('span', 'hoer-v', fmtHours(remaining)));
    badge.appendChild(el('span', 'hoer-s',
      relief ? 'RED LINE — a booked block outruns this crew'
        : duty.length ? 'Safe for ' + duty.length + ' booked block(s)'
        : 'Uncommitted'));
    c.appendChild(badge);

    const g = el('div', 'gauge');
    const i = el('i');
    i.style.width = Math.min(100, pct) + '%';
    i.style.background = pct > 95 ? 'var(--red)' : pct > 80 ? 'var(--amber)' : 'var(--green)';
    g.appendChild(i);
    c.appendChild(g);
    c.appendChild(row('Worked / booked', m.dutyHours.toFixed(1) + ' + ' +
      engaged.toFixed(1) + ' of ' + m.maxHours + ' h'));
    c.appendChild(row('Crew', m.crewId + ' · ' + m.rest));

    /* location + condition */
    c.appendChild(row('Stabled', m.station + (m.siding ? ' · ' + m.siding : '')));
    c.appendChild(row('Free runout', m.freeRunout ? 'Yes' : 'No'));
    c.appendChild(row('Tine wear', m.tineWear.toFixed(1) + '%'));
    c.appendChild(gauge(m.tineWear, m.tineWear > 70 ? 'var(--red)'
      : m.tineWear > 40 ? 'var(--amber)' : 'var(--green)'));
    c.appendChild(row('HSD fuel', Math.round(m.fuel) + ' L'));
    c.appendChild(row('IOH / POH due', m.iohDue + ' / ' + m.pohDue));
    c.appendChild(row('Transit / working', m.transitSpeed + ' / ' + m.workingSpeed + ' km/h'));

    /* today's diagram */
    if (duty.length) {
      c.appendChild(el('div', 'duty-h', 'Booked today'));
      duty.forEach((d) => {
        const line = el('div', 'duty' + (d.m.crewRelief ? ' bad' : ''));
        line.appendChild(el('span', 'mono', hhmm(d.p.start) + '–' + hhmm(d.p.end)));
        line.appendChild(el('span', 'grow', d.p.id + ' · ' + d.p.section));
        line.appendChild(el('span', 'mono', d.m.engagedHours + 'h'));
        line.style.cursor = 'pointer';
        line.addEventListener('click', () => { store.getState().setSelProposal(d.p.id); });
        c.appendChild(line);
      });
    }
    grid.appendChild(c);
  });
  host.appendChild(grid);

  host.appendChild(el('div', 'mini-note',
    'Under HOER a track machine crew cannot work beyond ' + data.machines[0].maxHours +
    ' continuous hours. A machine shown at the red line is booked to a block that ' +
    'outruns its crew — arrange relief at site or shorten the possession, or the ' +
    'machine is stranded on the running line.'));
}

function fmtHours(h: number): string {
  const m = Math.round(h * 60);
  return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
}

function row(k: string, v: string): HTMLElement {
  const r = el('div', 'asset-row');
  r.appendChild(el('span', null, k));
  r.appendChild(el('span', null, v));
  return r;
}

function gauge(pct: number, color: string): HTMLElement {
  const g = el('div', 'gauge');
  const i = el('i');
  i.style.width = Math.max(0, Math.min(100, pct)) + '%';
  i.style.background = color;
  g.appendChild(i);
  return g;
}
