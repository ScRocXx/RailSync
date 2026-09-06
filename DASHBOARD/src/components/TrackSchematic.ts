/* ============================================================
   TrackSchematic — CRIS / Alstom Centralized Traffic Control (CTC)
   Mimic Display: Running lines, turnouts, platform loops, signals,
   maintenance siding plant, and Station Interlocking Matrix.
   ============================================================ */

import { store } from '../store/useRailSyncStore.ts';
import {
  D, S, hhmm, shortCorr, corridorById, esc,
  CLS_COLOR, trainAt, runningAt, activeBlocks,
  byId, clear, el, svgEl, tip, tipOff, tipRows,
} from '../lib/core.ts';
import type {
  Corridor, Station, BlockSection, Machine, Train,
  LiveProposal, Regulation, RunningTrain,
} from '../types/index.ts';

const M = { l: 48, r: 36, t: 26, b: 38 };
const SECTOR: Record<string, string> = {
  CORR_NORTH: 'North', CORR_EAST: 'East', CORR_SOUTH: 'South', CORR_WEST: 'West',
};

let netResizeObs: ResizeObserver | null = null;

function ensureNetResizeObserver(host: HTMLElement): void {
  if (netResizeObs) return;
  let timer: number;
  netResizeObs = new ResizeObserver(() => {
    cancelAnimationFrame(timer);
    timer = requestAnimationFrame(() => {
      render();
    });
  });
  netResizeObs.observe(host);
}

function depotsOn(corr: Corridor): Record<string, Machine[]> {
  const by: Record<string, Machine[]> = {};
  D().machines.forEach((m) => {
    if (m.corridor !== corr.id) return;
    (by[m.station] = by[m.station] || []).push(m);
  });
  return by;
}

function kmOf(corr: Corridor, code: string): number {
  for (let i = 0; i < corr.stations.length; i++) {
    if (corr.stations[i].code === code) return corr.stations[i].km;
  }
  return 0;
}

function regulatedNow(t: number, corr: Corridor): Record<string, Regulation[]> {
  const by: Record<string, Regulation[]> = {};
  activeBlocks(t, corr.id).forEach((p) => {
    p.regulation.forEach((rg) => {
      if (!rg.loop) return;
      (by[rg.loop] = by[rg.loop] || []).push(rg);
    });
  });
  return by;
}

export function render(): void {
  const host = byId('net-wrap');
  const root = document.getElementById('net-svg') as unknown as SVGSVGElement | null;
  if (!host || !root) return;

  ensureNetResizeObserver(host);

  const W = host.clientWidth, H = host.clientHeight;
  const iw = W - M.l - M.r;
  if (iw < 20 || H < 60) return;

  const s = store.getState();
  clear(root);
  root.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

  const corr = corridorById(s.corridor);
  const lines = corr.lines;
  const maxKm = corr.lengthKm;
  const avail = H - M.t - M.b;

  // Responsive lane spacing
  const laneCount = lines.length + 2; // Running lines + Station Platform Loops + Sidings
  const laneH = Math.max(26, Math.min(50, avail / laneCount));
  const top = M.t + Math.max(0, (avail - laneCount * laneH) / 2);
  const t = s.clock;

  const X = (km: number) => M.l + (km / maxKm) * iw;
  const laneY = (i: number) => top + i * laneH + laneH / 2;
  const loopY = laneY(lines.length);
  const sidingY = laneY(lines.length + 1);

  // Cross-hatch pattern for maintenance possession blocks
  const defs = svgEl('defs');
  const hatch = svgEl('pattern', {
    id: 'nw-hatch', width: 8, height: 8,
    patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
  });
  hatch.appendChild(svgEl('rect', { width: 8, height: 8, fill: '#fef3c7' }));
  hatch.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: '#d97706', 'stroke-width': 3 }));
  defs.appendChild(hatch);
  root.appendChild(defs);

  const blocks = activeBlocks(t, corr.id);
  const running = runningAt(t, corr.id);
  const held = regulatedNow(t, corr);
  const depots = depotsOn(corr);
  const hotBlock = s.hotBlock
    ? s.proposals.filter((p) => p.id === s.hotBlock)[0]
    : null;

  /* ---- 1. Running Lines & Track Circuits ---- */
  lines.forEach((ln, li) => {
    const y = laneY(li);
    const lbl = svgEl('text', { x: 4, y: y + 3, class: 'nw-line-lbl' });
    lbl.textContent = ln.replace('_MAIN', '').replace('_LINE', '');
    root.appendChild(lbl);
    root.appendChild(svgEl('line', { x1: M.l, y1: y, x2: M.l + iw, y2: y, class: 'nw-bed' }));

    corr.sections.forEach((sec) => {
      if (sec.lines.indexOf(ln) < 0) return;
      const a = kmOf(corr, sec.from), b = kmOf(corr, sec.to);
      const lo = Math.min(a, b), hi = Math.max(a, b);

      const blocked = blocks.some((p) =>
        p.lines.indexOf(ln) >= 0 && p.hiKm >= lo && p.loKm <= hi
      );
      const occupied = !blocked && running.some((r) =>
        r.train.line === ln && r.pos.km >= lo - 0.4 && r.pos.km <= hi + 0.4
      );

      const lit = !!hotBlock && hotBlock.corridor === corr.id &&
        hotBlock.lines.indexOf(ln) >= 0 && hotBlock.hiKm >= lo && hotBlock.loKm <= hi;
      if (lit) {
        root.appendChild(svgEl('line', {
          x1: X(lo), y1: y, x2: X(hi), y2: y, class: 'nw-sync',
        }));
      }

      const seg = svgEl('line', {
        x1: X(lo), y1: y, x2: X(hi), y2: y,
        class: 'nw-track ' + (blocked ? 'blocked' : occupied ? 'occupied' : 'clear'),
      });
      if (blocked) seg.setAttribute('stroke', 'url(#nw-hatch)');
      seg.addEventListener('mousemove', (e) => {
        tip(sectionTip(corr, sec, ln, blocked, occupied, running, blocks), e as MouseEvent);
      });
      seg.addEventListener('mouseleave', tipOff);
      root.appendChild(seg);

      // Railway Signal Head at section entry
      const sigX = X(lo) + 3;
      const sigAspectCol = blocked ? '#f59e0b' : occupied ? '#ef4444' : '#22c55e';
      const sigGroup = svgEl('g', { transform: `translate(${sigX}, ${y - 9})` });
      sigGroup.appendChild(svgEl('line', { x1: 0, y1: 9, x2: 0, y2: 0, class: 'nw-sig-post' }));
      sigGroup.appendChild(svgEl('circle', { cx: 0, cy: -2, r: 3.5, class: 'nw-sig-head' }));
      sigGroup.appendChild(svgEl('circle', { cx: 0, cy: -2, r: 2.2, fill: sigAspectCol }));
      root.appendChild(sigGroup);
    });
  });

  /* ---- 2. Station Platform Loops & Crossovers ---- */
  const loopLbl = svgEl('text', { x: 4, y: loopY + 3, class: 'nw-line-lbl' });
  loopLbl.textContent = 'LOOP';
  root.appendChild(loopLbl);

  corr.stations.forEach((st) => {
    const x = X(st.km);
    const halfW = Math.max(14, Math.min(32, iw / (corr.stations.length * 2.2)));

    if (st.loop) {
      const occupiedLoop = (held[st.code] || []).length > 0;
      const lastLineY = laneY(lines.length - 1);

      // Angled 45-degree turnout switches connecting to running line
      root.appendChild(svgEl('path', {
        d: `M${x - halfW - 6},${lastLineY} L${x - halfW},${loopY} L${x + halfW},${loopY} L${x + halfW + 6},${lastLineY}`,
        class: 'nw-loop' + (occupiedLoop ? ' held' : ''),
      }));

      // моно CSR stamp (Clear Standing Room)
      const csr = svgEl('text', { x, y: loopY - 4, class: 'nw-csr', 'text-anchor': 'middle' });
      csr.textContent = `[${st.loopCsr}m]`;
      root.appendChild(csr);

      const hit = svgEl('rect', { x: x - halfW, y: loopY - 6, width: halfW * 2, height: 12, fill: 'transparent' });
      (hit as unknown as HTMLElement).style.cursor = 'pointer';
      hit.addEventListener('mousemove', (e) => { tip(loopTip(st, held[st.code] || []), e as MouseEvent); });
      hit.addEventListener('mouseleave', tipOff);
      root.appendChild(hit);

      // Freight rake stabled in loop
      (held[st.code] || []).forEach((_rg, i) => {
        root.appendChild(svgEl('rect', {
          x: x - halfW + 2 + i * 4, y: loopY - 3, width: halfW * 2 - 4, height: 6,
          fill: CLS_COLOR.FREIGHT, stroke: '#020617', 'stroke-width': 0.8,
        }));
      });
    }

    // Physical Maintenance Sidings & Plant Stabling
    const stMachines = depots[st.code] || [];
    if (st.sidings.length || stMachines.length) {
      const sidingStartX = x - halfW;
      const sidingEndX = x + halfW + 12;

      // Spur line from loop down to siding
      root.appendChild(svgEl('path', {
        d: `M${x - halfW},${loopY} L${sidingStartX + 4},${sidingY} L${sidingEndX},${sidingY}`,
        class: 'nw-siding',
      }));

      // Render Machine Chips directly on the siding track
      stMachines.forEach((m, mi) => {
        const mx = x - halfW + 16 + mi * 44;
        const mg = svgEl('g', { transform: `translate(${mx}, ${sidingY - 6})` });
        const fit = m.fitness === 'FIT';
        mg.appendChild(svgEl('rect', {
          width: 40, height: 12, fill: fit ? '#065f46' : '#7f1d1d',
          stroke: fit ? '#059669' : '#dc2626', 'stroke-width': 1,
        }));
        const mt = svgEl('text', {
          x: 20, y: 8.5, fill: '#f1f5f9', 'font-size': '9.5px',
          'font-family': 'Consolas, monospace', 'font-weight': '700', 'text-anchor': 'middle',
        });
        mt.textContent = m.id;
        mg.appendChild(mt);
        (mg as unknown as HTMLElement).style.cursor = 'pointer';
        mg.addEventListener('click', () => {
          const fleetBtn = document.querySelector<HTMLElement>('#ws-tabs button[data-ws="fleet"]');
          if (fleetBtn) fleetBtn.click();
        });
        mg.addEventListener('mousemove', (e) => {
          tip(`<div class="tt-h"><span class="swatch" style="background:${fit ? '#22c55e' : '#ef4444'}"></span>${m.id} (${m.type}) @ ${st.code}</div><div class="tt-r"><span>Base Depot</span><span>${m.depot}</span></div><div class="tt-r"><span>Status</span><span>${m.fitness}</span></div><div class="tt-r"><span>Crew Duty</span><span>${m.dutyHours.toFixed(1)} / ${m.maxHours} h</span></div>`, e as MouseEvent);
        });
        mg.addEventListener('mouseleave', tipOff);
        root.appendChild(mg);
      });
    }
  });

  /* ---- 3. Stations & Chainage Markers ---- */
  const yTop = laneY(0) - 10;
  const yBot = sidingY + 14;

  corr.stations.forEach((st) => {
    const x = X(st.km);
    root.appendChild(svgEl('line', {
      x1: x, y1: yTop, x2: x, y2: yBot - 4, stroke: '#e2e8f0', 'stroke-width': 1,
    }));

    const c = svgEl('circle', {
      cx: x, cy: yTop - 4, r: 3.5, class: 'nw-stn' + (st.loop ? ' loop' : ''),
    });
    c.addEventListener('mousemove', (e) => { tip(stationTip(st, depots[st.code]), e as MouseEvent); });
    c.addEventListener('mouseleave', tipOff);
    root.appendChild(c);

    const lb = svgEl('text', { x, y: yBot + 8, class: 'nw-stn-txt', 'text-anchor': 'middle' });
    lb.textContent = st.code;
    root.appendChild(lb);
    const km = svgEl('text', { x, y: yBot + 18, class: 'nw-km-txt', 'text-anchor': 'middle' });
    km.textContent = st.km.toFixed(0);
    root.appendChild(km);
  });

  /* ---- 4. Live Train Markers ---- */
  running.forEach((r) => {
    let li = lines.indexOf(r.train.line);
    if (li < 0) li = 0;
    const y = laneY(li);
    const x = X(r.pos.km);
    const up = r.train.dir === 'UP';
    const g = svgEl('g', { class: 'nw-train' });

    if (s.hotTrain === r.train.id) {
      g.appendChild(svgEl('circle', { cx: x, cy: y, r: 10, class: 'nw-sync-ring' }));
    }

    const pts = up
      ? [[x - 6, y - 4], [x + 6, y], [x - 6, y + 4]]
      : [[x + 6, y - 4], [x - 6, y], [x + 6, y + 4]];
    g.appendChild(svgEl('polygon', {
      points: pts.map((p) => p[0] + ',' + p[1]).join(' '),
      fill: CLS_COLOR[r.train.cls], class: 'nw-train-body',
      stroke: '#020617', 'stroke-width': 1,
    }));
    if (!r.pos.moving) {
      g.appendChild(svgEl('circle', { cx: x, cy: y - 8, r: 2.2, fill: '#ef4444' }));
    }
    g.addEventListener('mousemove', (e) => {
      if (store.getState().hotTrain !== r.train.id) store.getState().setHotTrain(r.train.id);
      tip(runTrainTip(r), e as MouseEvent);
    });
    g.addEventListener('mouseleave', () => {
      store.getState().setHotTrain(null); tipOff();
    });
    root.appendChild(g);
  });

  const hdr = svgEl('text', { x: M.l, y: 14, class: 'nw-km-txt' });
  hdr.textContent = corr.name + '  ·  ' + maxKm.toFixed(0) + ' km  ·  MPS ' + corr.maxSpeed +
    ' km/h  ·  ' + running.length + ' on section  ·  ' + blocks.length + ' block(s) in force';
  root.appendChild(hdr);

  // If in Corridor Track Map (ws-map), populate Station Interlocking Matrix
  renderStationInterlockingMatrix(corr, depots, held, running, blocks);
}

/* ---- Station Yard Interlocking Matrix (CRIS CTC Table) ---- */

function renderStationInterlockingMatrix(
  corr: Corridor,
  depots: Record<string, Machine[]>,
  held: Record<string, Regulation[]>,
  running: RunningTrain[],
  blocks: LiveProposal[]
): void {
  const box = byId('ctc-yard-matrix');
  if (!box) return;
  clear(box);

  const t = el('table', 'scada-sheet');
  t.innerHTML = `
    <thead>
      <tr>
        <th style="min-width:130px">Station &amp; Code</th>
        <th style="min-width:60px">KM</th>
        <th style="min-width:120px">Interlocking Standard</th>
        <th style="min-width:160px">Platform Loops &amp; CSR</th>
        <th style="min-width:140px">SMMS Points Health</th>
        <th style="min-width:110px">Signal Aspects</th>
        <th style="min-width:160px">Stabled Track Machines</th>
        <th style="min-width:110px">TSR Speed Loss</th>
      </tr>
    </thead>
  `;
  const tb = el('tbody');

  corr.stations.forEach((st) => {
    const tr = el('tr');

    // 1. Station
    const c1 = el('td', 'mono');
    c1.innerHTML = `<b>${st.code}</b> · <span style="color:#64748b">${st.name}</span>`;
    tr.appendChild(c1);

    // 2. KM
    tr.appendChild(el('td', 'mono', st.km.toFixed(1)));

    // 3. Interlocking
    const c3 = el('td', 'mono', st.platforms > 2 ? 'EI (Dual VDU)' : 'Panel Interlocking');
    tr.appendChild(c3);

    // 4. Loops & CSR
    const c4 = el('td', 'mono');
    const isHeld = (held[st.code] || []).length > 0;
    if (st.loop) {
      if (isHeld) {
        c4.innerHTML = `<span style="color:#ef4444;font-weight:700">HELD</span> (BOXN 58W · ${st.loopCsr}m)`;
      } else {
        c4.innerHTML = `<span style="color:#22c55e">CLEAR</span> · CSR ${st.loopCsr}m`;
      }
    } else {
      c4.innerHTML = '<span style="color:#64748b">— (Through Main)</span>';
    }
    tr.appendChild(c4);

    // 5. SMMS Points Health
    const c5 = el('td', 'mono');
    c5.innerHTML = `Throw: <b>3.8s</b> · <b>2.6A</b> [PASS]`;
    tr.appendChild(c5);

    // 6. Signal Aspects
    const c6 = el('td', 'mono');
    c6.innerHTML = `<span style="color:#22c55e">● GREEN</span> / <span style="color:#22c55e">● GREEN</span>`;
    tr.appendChild(c6);

    // 7. Stabled Machines
    const c7 = el('td', 'mono');
    const ms = depots[st.code] || [];
    if (ms.length) {
      c7.innerHTML = ms.map((m) =>
        `<span class="chip ${m.fitness === 'FIT' ? 'rout' : 'crit'}" style="margin-right:3px">${m.id} (${m.type})</span>`
      ).join('');
    } else {
      c7.innerHTML = '<span style="color:#64748b">—</span>';
    }
    tr.appendChild(c7);

    // 8. TSR Speed Loss
    const tsrs = D().tsr.filter((ts) => ts.corridor === corr.id && ts.from === st.code);
    const c8 = el('td', 'mono');
    if (tsrs.length) {
      c8.innerHTML = `<span style="color:#f59e0b;font-weight:700">${tsrs[0].speed} km/h (+${tsrs[0].lossMin}m)</span>`;
    } else {
      c8.innerHTML = '<span style="color:#22c55e">NORMAL</span>';
    }
    tr.appendChild(c8);

    tb.appendChild(tr);
  });

  t.appendChild(tb);
  box.appendChild(t);
}

/* ---- Tooltips ---- */

function sectionTip(
  corr: Corridor, sec: BlockSection, ln: string,
  blocked: boolean, occupied: boolean,
  running: RunningTrain[], blocks: LiveProposal[]
): string {
  const a = kmOf(corr, sec.from), b = kmOf(corr, sec.to);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const on = running.filter((r) =>
    r.train.line === ln && r.pos.km >= lo - 0.4 && r.pos.km <= hi + 0.4
  );
  const blk = blocks.filter((p) =>
    p.lines.indexOf(ln) >= 0 && p.hiKm >= lo && p.loKm <= hi
  );
  const state = blocked ? 'MAINTENANCE BLOCK' : occupied ? 'OCCUPIED' : 'CLEAR';
  const col = blocked ? '#f59e0b' : occupied ? '#ef4444' : '#22c55e';

  const rows: [string, string][] = [
    ['Block section', sec.id],
    ['Line', ln],
    ['Chainage', 'KM ' + lo.toFixed(1) + ' – ' + hi.toFixed(1) + '  (' + sec.km + ' km)'],
  ];
  on.forEach((r) => { rows.push(['On section', r.train.no + ' @ KM ' + r.pos.km.toFixed(1)]); });
  blk.forEach((p) => { rows.push(['Block in force', p.id + '  ' + hhmm(p.start) + '–' + hhmm(p.end)]); });

  return '<div class="tt-h"><span class="swatch" style="background:' + col + '"></span>' +
    esc(sec.from) + ' – ' + esc(sec.to) + ' · ' + state + '</div>' + tipRows(rows);
}

function loopTip(st: Station, held: Regulation[]): string {
  const s = store.getState();
  const rows: [string, string][] = [
    ['Clear standing room', st.loopCsr + ' m'],
    ['Platforms', String(st.platforms)],
    ['Sidings', st.sidings.length ? st.sidings.join(', ') : '—'],
  ];
  if (held.length) {
    held.forEach((h) => { rows.push(['Holding', h.rake + '  (' + h.lengthM + ' m)']); });
  } else {
    rows.push(['Status', 'Empty']);
  }
  return '<div class="tt-h"><span class="swatch" style="background:#38bdf8"></span>' +
    esc(st.code) + ' Loop Line</div>' + tipRows(rows);
}

function stationTip(st: Station, dm: Machine[] | undefined): string {
  const rows: [string, string][] = [
    ['Chainage', 'KM ' + st.km.toFixed(1)],
    ['Platforms', String(st.platforms)],
    ['Platform loop', st.loop ? 'Yes · CSR ' + st.loopCsr + ' m' : 'No'],
    ['Crossovers', st.crossovers.length ? st.crossovers.join(', ') : '—'],
    ['Sidings', st.sidings.length ? st.sidings.join(', ') : '—'],
  ];
  if (dm && dm.length) rows.push(['Machines stabled', String(dm.length)]);
  return '<div class="tt-h">' + esc(st.code) + ' · ' + esc(st.name) + '</div>' + tipRows(rows);
}

function runTrainTip(r: RunningTrain): string {
  const tr = r.train;
  const rows: [string, string][] = [
    ['Type', tr.kind === 'FREIGHT' ? 'Freight · ' + tr.name : tr.name],
    ['Line / direction', tr.line + ' · ' + tr.dir],
    ['Position', 'KM ' + r.pos.km.toFixed(2)],
    ['Speed', r.pos.speed.toFixed(0) + ' km/h' + (r.pos.moving ? '' : '  (standing)')],
    ['MPS', tr.mps + ' km/h'],
  ];
  if (tr.kind === 'PASSENGER') {
    rows.push(['Delay', tr.delay > 0 ? tr.delay + ' min late' : 'Right time']);
  } else {
    rows.push(['Load', tr.wagons + ' wagons · ' + tr.tonnage + ' t']);
    rows.push(['Rake length', tr.lengthM + ' m']);
  }
  return '<div class="tt-h"><span class="swatch" style="background:' + CLS_COLOR[tr.cls] +
    '"></span>' + esc(tr.no) + '</div>' + tipRows(rows);
}

/* ---- Corridor tabs ---- */

export function bindTabs(): void {
  const boxes = [byId('corr-tabs'), byId('ctc-corr-tabs')].filter(Boolean) as HTMLElement[];
  if (!boxes.length) return;

  boxes.forEach((box) => {
    clear(box);
    D().corridors.forEach((c) => {
      const label = (SECTOR[c.id] || shortCorr(c.id)) + ' · ' +
        c.stations[0].code + '–' + c.stations[c.stations.length - 1].code;
      const s = store.getState();
      const b = el('button', c.id === s.corridor ? 'on' : '', label);
      b.dataset.c = c.id;
      b.addEventListener('click', () => {
        store.getState().setCorridor(c.id);
        boxes.forEach((bx) => {
          Array.prototype.forEach.call(bx.children, (n: HTMLElement) => {
            n.classList.toggle('on', n.dataset.c === c.id);
          });
        });
      });
      box.appendChild(b);
    });
  });
}
