/* ============================================================
   FleetTracker — Mobile Plant & Crew HOER Tracker
   De-cluttered SCADA machine cards + detailed inspector modal.
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

  /* ---- DE-CLUTTERED MACHINE CARDS (Blueprint requirement) ---- */
  const grid = el('div', 'asset-grid');
  data.machines.forEach((m) => {
    const duty = dutyFor(m.id);
    const engaged = duty.reduce((a, d) => a + d.m.engagedHours, 0);
    const remaining = Math.max(0, m.maxHours - m.dutyHours - engaged);
    const relief = duty.some((d) => d.m.crewRelief);
    const pct = 100 * (m.dutyHours + engaged) / m.maxHours;

    const c = el('div', 'asset-card' + (relief ? ' at-risk' : ''));
    c.style.cursor = 'pointer';

    // 1. Machine ID & Status Badge
    const hh = el('div');
    hh.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
    const idEl = el('h4', null, m.id);
    idEl.style.fontSize = '14px';
    hh.appendChild(idEl);
    const typeSpan = el('span', 'mono', m.type);
    typeSpan.style.cssText = 'font-size:12px;color:var(--text-mute);font-weight:600;';
    hh.appendChild(typeSpan);

    const fitChip = el('span', 'chip ' + (m.fitness === 'FIT' ? 'rout' : 'crit'), m.fitness);
    fitChip.style.marginLeft = 'auto';
    hh.appendChild(fitChip);
    c.appendChild(hh);

    // 2. Base Depot
    const baseInfo = el('div', 'meta');
    baseInfo.style.cssText = 'font-size:12px;color:var(--text-dim);margin-bottom:8px;';
    baseInfo.textContent = 'Base: ' + m.depot + ' Depot · Stabled: ' + m.station + (m.siding ? ' (' + m.siding + ')' : '');
    c.appendChild(baseInfo);

    // 3. Remaining Crew Duty Bar & Status Badge
    const badge = el('div', 'hoer' + (relief ? ' bad' : pct > 85 ? ' warn' : ' ok'));
    badge.appendChild(el('span', 'hoer-k', 'Crew Duty Remaining'));
    badge.appendChild(el('span', 'hoer-v', fmtHours(remaining)));
    badge.appendChild(el('span', 'hoer-s',
      relief ? 'RED LINE — booked block outruns crew'
        : duty.length ? 'Safe for ' + duty.length + ' booked block(s)'
        : 'Safe · Uncommitted'));
    c.appendChild(badge);

    const g = el('div', 'gauge');
    const i = el('i');
    i.style.width = Math.min(100, pct) + '%';
    i.style.background = pct > 95 ? 'var(--red)' : pct > 80 ? 'var(--amber)' : 'var(--green)';
    g.appendChild(i);
    c.appendChild(g);

    // Worked hours indicator
    const workedRow = el('div', 'asset-row');
    workedRow.style.cssText = 'font-size:12px;margin-top:6px;';
    workedRow.appendChild(el('span', null, 'Duty Used / Limit'));
    workedRow.appendChild(el('span', 'mono', (m.dutyHours + engaged).toFixed(1) + ' / ' + m.maxHours + ' h'));
    c.appendChild(workedRow);

    // Details Action Button
    const btnInspect = el('button', 'btn-sm btn-prop-inspect');
    btnInspect.style.cssText = 'width:100%;margin-top:10px;font-size:12px;';
    btnInspect.textContent = 'Plant Specs & Overhaul History →';
    btnInspect.addEventListener('click', (e) => {
      e.stopPropagation();
      openPlantModal(m, duty, remaining, engaged);
    });
    c.appendChild(btnInspect);

    c.addEventListener('click', () => {
      openPlantModal(m, duty, remaining, engaged);
    });

    grid.appendChild(c);
  });
  host.appendChild(grid);

  host.appendChild(el('div', 'mini-note',
    'Under Indian Railways HOER rules, track machine crews cannot exceed ' + data.machines[0].maxHours +
    ' continuous duty hours. A red line warning indicates a scheduled block exceeds current crew duty, requiring relief or window rescheduling.'));

  bindModalEvents();
}

/** Opens the interactive Plant Specs & Overhaul History modal */
function openPlantModal(m: Machine, duty: { p: LiveProposal; m: MachineAlloc }[], remaining: number, engaged: number): void {
  const modal = byId('fleet-modal');
  const idEl = byId('fm-id');
  const fitEl = byId('fm-fit');
  const subEl = byId('fm-sub');
  const bdEl = byId('fm-bd');
  if (!modal || !idEl || !fitEl || !subEl || !bdEl) return;

  idEl.textContent = m.id + ' — ' + m.model + ' (' + m.type + ')';
  fitEl.textContent = m.fitness;
  fitEl.className = 'chip ' + (m.fitness === 'FIT' ? 'rout' : 'crit');
  subEl.textContent = 'Base Depot: ' + m.depot + ' · Current Location: ' + m.station + (m.siding ? ' · ' + m.siding : '');

  clear(bdEl);

  // Section 1: Crew HOER State
  const s1 = el('div', 'dw-sec');
  s1.appendChild(el('h3', null, 'Crew & HOER Duty'));
  const kv1 = el('dl', 'kv');
  kv1.appendChild(kvRow('Crew ID', m.crewId));
  kv1.appendChild(kvRow('Rest / Readiness', m.rest));
  kv1.appendChild(kvRow('Continuous Duty', m.dutyHours.toFixed(1) + ' hours worked'));
  kv1.appendChild(kvRow('Committed Blocks', engaged.toFixed(1) + ' hours booked'));
  kv1.appendChild(kvRow('Remaining Permissible', fmtHours(remaining) + ' of ' + m.maxHours + ' h maximum'));
  s1.appendChild(kv1);
  bdEl.appendChild(s1);

  // Section 2: Consumables & Condition
  const s2 = el('div', 'dw-sec');
  s2.appendChild(el('h3', null, 'Plant Health & Consumables'));
  const kv2 = el('dl', 'kv');
  kv2.appendChild(kvRow('HSD Fuel Capacity', Math.round(m.fuel) + ' Litres'));
  kv2.appendChild(kvRow('Tamping Tine Wear', m.tineWear.toFixed(1) + '% (Limit 70%)'));
  kv2.appendChild(kvRow('Free Runout', m.freeRunout ? 'Permitted' : 'Not Permitted'));
  kv2.appendChild(kvRow('Transit / Working Speed', m.transitSpeed + ' / ' + m.workingSpeed + ' km/h'));
  s2.appendChild(kv2);
  bdEl.appendChild(s2);

  // Section 3: Maintenance & Overhaul Schedules
  const s3 = el('div', 'dw-sec');
  s3.appendChild(el('h3', null, 'Periodic Overhaul Schedules'));
  const kv3 = el('dl', 'kv');
  kv3.appendChild(kvRow('Intermediate Overhaul (IOH)', m.iohDue));
  kv3.appendChild(kvRow('Periodic Overhaul (POH)', m.pohDue));
  s3.appendChild(kv3);
  bdEl.appendChild(s3);

  // Section 4: Today's Booked Diagram
  if (duty.length) {
    const s4 = el('div', 'dw-sec');
    s4.appendChild(el('h3', null, 'Committed Blocks Today (' + duty.length + ')'));
    duty.forEach((d) => {
      const line = el('div', 'duty' + (d.m.crewRelief ? ' bad' : ''));
      line.appendChild(el('span', 'mono', hhmm(d.p.start) + '–' + hhmm(d.p.end)));
      line.appendChild(el('span', 'grow', d.p.id + ' · ' + d.p.section));
      line.appendChild(el('span', 'mono', d.m.engagedHours + 'h'));
      line.style.cursor = 'pointer';
      line.addEventListener('click', () => {
        closePlantModal();
        store.getState().setSelProposal(d.p.id);
      });
      s4.appendChild(line);
    });
    bdEl.appendChild(s4);
  }

  modal.classList.add('on');
}

function closePlantModal(): void {
  const modal = byId('fleet-modal');
  if (modal) modal.classList.remove('on');
}

let modalBound = false;
function bindModalEvents(): void {
  if (modalBound) return;
  modalBound = true;
  const modal = byId('fleet-modal');
  const closeBtn = byId('fm-close');
  if (closeBtn) closeBtn.addEventListener('click', closePlantModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closePlantModal();
    });
  }
}

function kvRow(k: string, v: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const dt = el('dt', null, k);
  const dd = el('dd', null, v);
  frag.appendChild(dt);
  frag.appendChild(dd);
  return frag;
}

function fmtHours(h: number): string {
  const m = Math.round(h * 60);
  return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
}
