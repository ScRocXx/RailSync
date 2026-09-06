/* ============================================================
   Core library — geometry, conflict engine, formatting, DOM
   helpers. Pure functions wherever possible; state is read
   from the store, never mutated here.
   ============================================================ */

import { store } from '../store/useRailSyncStore.ts';
import type {
  Bundle, Train, TrainPosition, RunningTrain, LiveProposal,
  Corridor, TrainClass, RailTempReading, ControlOrder,
  WindowScore, OverrunProjection, ConflictTrain, Impact,
} from '../types/index.ts';

export const DAY = 1440;

/* ---- Accessors (read-through to store) ---- */

export function D(): Bundle {
  return store.getState().data!;
}

export function S() {
  return store.getState();
}

/** Working copies, so controller decisions never mutate the source bundle. */
export function initProposals(): void {
  const data = D();
  if (!data || !data.proposals) return;
  const list: LiveProposal[] = data.proposals.map((p) => {
    const c = JSON.parse(JSON.stringify(p)) as LiveProposal;
    c.origStart = c.start;
    c.added = [];
    return c;
  });
  store.getState().setProposals(list);
}

/* ---- Formatting ---- */

export function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }

export function hhmm(m: number): string {
  m = ((Math.round(m) % DAY) + DAY) % DAY;
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

export function shortCorr(id: string): string { return id.replace('CORR_', ''); }

export function corridorById(id: string): Corridor {
  const data = D();
  for (let i = 0; i < data.corridors.length; i++) {
    if (data.corridors[i].id === id) return data.corridors[i];
  }
  return data.corridors[0];
}

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]
  );
}

export function scoreColor(v: number): string {
  if (v >= 75) return '#ff4d4f';
  if (v >= 55) return '#f5b942';
  return '#2ecc71';
}

export const CLS_COLOR: Record<TrainClass, string> = {
  PREMIUM: '#f5c542', EXPRESS: '#4a9eff', SUBURBAN: '#35c46a', FREIGHT: '#9c8468',
};

/* ---- Geometry ---- */

export function trainAt(t: number, train: Train): TrainPosition | null {
  const p = train.path;
  if (t < p[0][0] || t > p[p.length - 1][0]) return null;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = (b[0] === a[0]) ? 0 : (t - a[0]) / (b[0] - a[0]);
      const km = a[1] + (b[1] - a[1]) * f;
      const dkm = b[1] - a[1], dt = b[0] - a[0];
      const spd = dt > 0 ? Math.abs(dkm / dt) * 60 : 0;
      return { km, speed: spd, moving: spd > 0.5 };
    }
  }
  return null;
}

export function runningAt(t: number, corridorId: string | null): RunningTrain[] {
  const out: RunningTrain[] = [];
  D().trains.forEach((tr) => {
    if (corridorId && tr.corridor !== corridorId) return;
    const pos = trainAt(t, tr);
    if (pos) out.push({ train: tr, pos });
  });
  return out;
}

export function activeBlocks(t: number, corridorId: string | null): LiveProposal[] {
  return S().proposals.filter((p) => {
    if (p.status !== 'APPROVED') return false;
    if (corridorId && p.corridor !== corridorId) return false;
    return t >= p.start && t <= p.end;
  });
}

export function railTemp(t: number, corridorId: string): RailTempReading | null {
  const data = D();
  const wx = data.weather[corridorId] || data.weather[Object.keys(data.weather)[0]];
  if (!wx) return null;
  const m = Math.max(0, Math.min(DAY - 1, Math.round(t)));
  const hr = wx.hours[Math.min(23, Math.floor(m / 60))];
  if (!hr) return null;
  const rail = (wx.curve && wx.curve.length) ? wx.curve[Math.min(wx.curve.length - 1, m)] : hr.rail;
  return {
    rail, amb: hr.amb, dest: hr.dest,
    min: hr.minMax ? hr.minMax[0] : 8,
    max: hr.minMax ? hr.minMax[1] : 48,
    buckle: !!hr.buckle, safeTamp: !!hr.safeTamp,
    wind: hr.wind, rain: hr.rain,
    probe: wx.probe, station: wx.station,
  };
}

export function pathEnters(train: Train, lo: number, hi: number, t0: number, t1: number): boolean {
  const p = train.path;
  for (let i = 0; i < p.length - 1; i++) {
    const ta = p[i][0], ka = p[i][1], tb = p[i + 1][0], kb = p[i + 1][1];
    if (tb === ta) continue;
    const klo = Math.min(ka, kb), khi = Math.max(ka, kb);
    if (khi < lo || klo > hi) continue;
    let s0 = Math.min(ta, tb), s1 = Math.max(ta, tb);
    if (!(klo >= lo && khi <= hi)) {
      const edges: number[] = [];
      [lo, hi].forEach((e) => {
        if (klo <= e && e <= khi && kb !== ka) edges.push(ta + (tb - ta) * (e - ka) / (kb - ka));
      });
      if (edges.length) {
        s0 = Math.max(s0, Math.min(...edges));
        s1 = Math.min(s1, Math.max(...edges));
      }
    }
    if (s0 <= t1 && s1 >= t0) return true;
  }
  return false;
}

export function scoreWindow(p: LiveProposal, start: number, duration: number): WindowScore {
  const end = start + duration;
  const blocked: Train[] = [], looped: Train[] = [];
  D().trains.forEach((t) => {
    if (t.corridor !== p.corridor || p.lines.indexOf(t.line) < 0) return;
    if (!pathEnters(t, p.loKm, p.hiKm, start, end)) return;
    if (t.kind === 'FREIGHT' && t.canLoop) looped.push(t);
    else blocked.push(t);
  });
  let delay = 0;
  blocked.forEach((t) => {
    if (t.entry < end) delay += Math.max(0, Math.round(end - t.entry));
  });
  return {
    paxAffected: blocked.filter((t) => t.kind === 'PASSENGER').length,
    paxDelayMin: delay,
    freightLooped: looped.length,
    freightIds: looped.map((t) => t.no),
    conflictTrains: blocked.slice(0, 6).map((t) => ({ no: t.no, name: t.name, cls: t.cls })),
  };
}

export function projectOverrun(p: LiveProposal, start: number,
                               duration: number, extra: number): OverrunProjection {
  const cleanEnd = start + duration;
  const lateEnd = cleanEnd + extra;
  const hit: OverrunProjection['trains'] = [];
  D().trains.forEach((t) => {
    if (t.corridor !== p.corridor || p.lines.indexOf(t.line) < 0) return;
    if (pathEnters(t, p.loKm, p.hiKm, start, cleanEnd)) return;
    if (!pathEnters(t, p.loKm, p.hiKm, cleanEnd, lateEnd)) return;
    const reach = firstReach(t, p.loKm, p.hiKm);
    const d = reach === null ? extra : Math.max(0, Math.round(lateEnd - reach));
    hit.push({ no: t.no, name: t.name, cls: t.cls, delayMin: Math.min(d, extra) });
  });
  hit.sort((a, b) => b.delayMin - a.delayMin);
  return {
    extraMin: extra,
    trains: hit,
    totalDelayMin: hit.reduce((a, t) => a + t.delayMin, 0),
    worst: hit.length ? hit[0].delayMin : 0,
  };
}

function firstReach(t: Train, lo: number, hi: number): number | null {
  const p = t.path;
  for (let i = 0; i < p.length - 1; i++) {
    const ta = p[i][0], ka = p[i][1], tb = p[i + 1][0], kb = p[i + 1][1];
    const klo = Math.min(ka, kb), khi = Math.max(ka, kb);
    if (khi < lo || klo > hi) continue;
    if (ka >= lo && ka <= hi) return ta;
    if (kb !== ka) {
      const edge = (kb > ka) ? lo : hi;
      if (klo <= edge && edge <= khi) return ta + (tb - ta) * (edge - ka) / (kb - ka);
    }
    return ta;
  }
  return null;
}

/* ---- Private Numbers & Control Order ---- */

let pnSeq = 47;
let pnTpcSeq = 16;

export function issueOrder(p: LiveProposal, start: number, duration: number): ControlOrder {
  const data = D();
  const state = S();
  const pnSm = ++pnSeq;
  const needsTpc = p.window.earthingMin > 0 || !!p.isolation;
  const pnTpc = needsTpc ? ++pnTpcSeq : null;
  const end = start + duration;
  const w = p.window;
  const stations = p.section.split(' - ');
  const L: string[] = [];

  L.push('CONTROL ORDER — ENGINEERING BLOCK AUTHORISATION');
  L.push('');
  L.push('Division      : ' + data.meta.division + ' (' + data.meta.zone + ')');
  L.push('Date          : ' + data.meta.date);
  L.push('Order no.     : ' + p.id);
  L.push('To            : SM/' + (stations[0] || '') +
         (stations[1] ? ', SM/' + stations[1] : ''));
  if (needsTpc) L.push('Copy          : TPC ' + (p.isolation || ''));
  L.push('');
  L.push('Block section : ' + p.section + '   (' + p.lines.join(' + ') + ')');
  L.push('Chainage      : KM ' + p.loKm.toFixed(2) + ' to KM ' + p.hiKm.toFixed(2));
  L.push('Block granted : ' + hhmm(start) + ' to ' + hhmm(end) +
         '   (' + duration + ' min total window)');
  L.push('Physical work : ' + w.workMin + ' min  (' +
         p.items.map((i) => i.action.replace(/_/g, ' ')).join(', ') + ')');
  L.push('Protection    : ' + (w.protectionMin / 2) + ' min set, ' +
         (w.protectionMin / 2) + ' min withdraw');
  if (w.earthingMin) {
    L.push('Earthing      : ' + (w.earthingMin / 2) + ' min earth, ' +
           (w.earthingMin / 2) + ' min de-earth');
  }
  if (p.isolation) {
    L.push('Isolation     : ' + p.isolation +
           (p.isolators.length ? '  — open ' + p.isolators.join(', ') : ''));
  }
  if (p.memo) L.push('Disconn. memo : ' + p.memo);
  if (p.routes.length) L.push('Routes barred : ' + p.routes.join(', '));
  if (p.machines.length) {
    p.machines.forEach((m) => {
      L.push('Machine       : ' + m.id + ' (' + m.type + ') ex ' + m.from +
             ', report by ' + m.reportBy + ', crew ' + m.crew);
    });
  } else {
    L.push('Machine       : NIL — manual gang possession');
  }
  if (p.regulation.length) {
    p.regulation.forEach((rg) => {
      L.push('Regulation    : ' + rg.rake + ' to be stabled in ' +
             (rg.loop ? rg.loop + ' loop (CSR ' + rg.loopCsr + ' m)' : 'NO SUITABLE LOOP'));
    });
  }
  if (p.postTsr) {
    L.push('After work    : impose ' + p.postTsr.speed + ' kmph TSR over ' +
           p.postTsr.lengthKm + ' km for ' + p.postTsr.hours + ' h');
  }
  L.push('');
  L.push('Private Number: SM ' + pnSm + (pnTpc !== null ? '   /   TPC ' + pnTpc : ''));
  L.push('Issued at     : ' + hhmm(state.clock) + '  by Section Controller, ' +
         data.meta.division + ' Division');
  L.push('');
  L.push('Line to be handed back clear of men and material by ' + hhmm(end) + '.');

  return { pnSm, pnTpc, issuedAt: state.clock, text: L.join('\n') };
}

export function totalDuration(p: LiveProposal): number {
  let extra = 0;
  (p.added || []).forEach((a) => { extra += a.addMin; });
  return p.duration + extra;
}

export function mergeImpact(p: LiveProposal, fresh: WindowScore): Impact {
  return {
    paxDelayMin: fresh.paxDelayMin,
    paxAffected: fresh.paxAffected,
    freightLooped: fresh.freightLooped,
    freightIds: fresh.freightIds,
    conflictTrains: fresh.conflictTrains,
    backlogCleared: p.items.length + p.added.length,
    scoreReleased: p.impact.scoreReleased,
    overdueDaysCleared: p.impact.overdueDaysCleared,
  };
}

/* ---- Clock ---- */

let tickHandle: number | null = null;

function tick(): void {
  const s = store.getState();
  store.getState().setClock((s.clock + s.speed / 60) % DAY);
}

export function startClock(): void {
  if (tickHandle !== null) clearInterval(tickHandle);
  tickHandle = setInterval(tick, 1000) as unknown as number;
  store.getState().setPlaying(true);
}

export function stopClock(): void {
  if (tickHandle !== null) { clearInterval(tickHandle); tickHandle = null; }
  store.getState().setPlaying(false);
}

export function toggleClock(): void {
  if (store.getState().playing) stopClock();
  else startClock();
}

export function setPlaying(on: boolean): void {
  if (on) startClock();
  else stopClock();
}

/* ---- DOM helpers ---- */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string | null, txt?: string | null
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt !== undefined && txt !== null) n.textContent = txt;
  return n;
}

export function svgEl(tag: string, attrs?: Record<string, string | number | undefined>): SVGElement {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag) as SVGElement;
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v !== undefined && v !== null) n.setAttribute(k, String(v));
    }
  }
  return n;
}

export function clear(n: Node): void {
  while (n.firstChild) n.removeChild(n.firstChild);
}

export function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/* ---- Tooltip ---- */

let tipEl: HTMLElement | null = null;

export function tip(html: string, ev: MouseEvent): void {
  tipEl = tipEl || document.getElementById('tip');
  if (!tipEl) return;
  tipEl.innerHTML = html;
  tipEl.classList.add('on');
  const r = tipEl.getBoundingClientRect();
  let x = ev.clientX + 15, y = ev.clientY + 15;
  if (x + r.width > window.innerWidth - 10) x = ev.clientX - r.width - 15;
  if (y + r.height > window.innerHeight - 10) y = ev.clientY - r.height - 15;
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
}

export function tipOff(): void {
  tipEl = tipEl || document.getElementById('tip');
  if (tipEl) tipEl.classList.remove('on');
}

export function tipRows(rows: [string, string][]): string {
  return rows.map((r) =>
    '<div class="tt-r"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>'
  ).join('');
}

/* ---- Toast ---- */

export function toast(msg: string, kind?: 'warn' | 'bad'): void {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const t = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
  wrap.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s';
    t.style.opacity = '0';
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
  }, 3200);
}

export function logEvent(kind: import('../types/index.ts').LogKind, title: string, detail: string, ref: string | null): void {
  store.getState().addLog(kind, title, detail, ref, store.getState().clock);
}
