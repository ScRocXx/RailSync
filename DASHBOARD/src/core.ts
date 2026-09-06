/// <reference path="types.ts" />

/* ============================================================
   Shared state, division clock, and the geometry helpers every
   panel builds on. Panels read from S and redraw on bus events.
   ============================================================ */

namespace RailSync {

  export const DAY = 1440;

  export const D: Bundle = (window as any).RAILSYNC_DATA;

  export const S: AppState = {
    clock: 0,
    playing: false,
    speed: 1,
    corridor: D ? D.corridors[0].id : '',
    zoom: 24,
    zoomAt: 0,
    filters: {
      dept: { TMS: true, TDMS: true, SMMS: true },
      band: { CRITICAL: true, URGENT: true, ROUTINE: true },
      corridorOnly: false
    },
    selDemand: null,
    selProposal: null,
    hotTrain: null,
    hotBlock: null,
    workspace: 'chart',
    panelTab: 'feed',
    overrunMin: 0,
    proposals: [],
    log: []
  };

  /** Working copies, so controller decisions never mutate the source bundle. */
  export function initProposals(): void {
    D.proposals.forEach(function (p) {
      const c = JSON.parse(JSON.stringify(p)) as LiveProposal;
      c.origStart = c.start;
      c.added = [];
      S.proposals.push(c);
    });
  }

  /* ------------------------------------------------------- event bus */

  type Handler = (arg?: any) => void;
  const handlers: Record<string, Handler[]> = {};

  export const bus = {
    on(key: string, fn: Handler): void {
      (handlers[key] = handlers[key] || []).push(fn);
    },
    emit(key: string, arg?: any): void {
      (handlers[key] || []).forEach(function (f) { f(arg); });
    }
  };

  /* ------------------------------------------------------- formatting */

  export function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }

  export function hhmm(m: number): string {
    m = ((Math.round(m) % DAY) + DAY) % DAY;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  export function shortCorr(id: string): string { return id.replace('CORR_', ''); }

  export function corridorById(id: string): Corridor {
    for (let i = 0; i < D.corridors.length; i++) {
      if (D.corridors[i].id === id) return D.corridors[i];
    }
    return D.corridors[0];
  }

  export function esc(s: unknown): string {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c];
    });
  }

  export function scoreColor(v: number): string {
    if (v >= 75) return '#ff4d4f';
    if (v >= 55) return '#f5b942';
    return '#2ecc71';
  }

  export const CLS_COLOR: Record<TrainClass, string> = {
    PREMIUM: '#f5c542', EXPRESS: '#4a9eff', SUBURBAN: '#35c46a', FREIGHT: '#9c8468'
  };

  /* ------------------------------------------------------- geometry */

  /** Chainage of a train at division time t, or null when it is off-section. */
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
        return { km: km, speed: spd, moving: spd > 0.5 };
      }
    }
    return null;
  }

  export function runningAt(t: number, corridorId: string | null): RunningTrain[] {
    const out: RunningTrain[] = [];
    D.trains.forEach(function (tr) {
      if (corridorId && tr.corridor !== corridorId) return;
      const pos = trainAt(t, tr);
      if (pos) out.push({ train: tr, pos: pos });
    });
    return out;
  }

  /** Blocks actually in force at time t. A pending proposal has not been
      granted, so it does not occupy track. */
  export function activeBlocks(t: number, corridorId: string | null): LiveProposal[] {
    return S.proposals.filter(function (p) {
      if (p.status !== 'APPROVED') return false;
      if (corridorId && p.corridor !== corridorId) return false;
      return t >= p.start && t <= p.end;
    });
  }

  export function railTemp(t: number, corridorId: string): RailTempReading | null {
    const wx = D.weather[corridorId] || D.weather[Object.keys(D.weather)[0]];
    if (!wx) return null;
    const m = Math.max(0, Math.min(DAY - 1, Math.round(t)));
    const hr = wx.hours[Math.min(23, Math.floor(m / 60))];
    if (!hr) return null;
    const rail = (wx.curve && wx.curve.length) ? wx.curve[Math.min(wx.curve.length - 1, m)] : hr.rail;
    return {
      rail: rail, amb: hr.amb, dest: hr.dest,
      min: hr.minMax ? hr.minMax[0] : 8,
      max: hr.minMax ? hr.minMax[1] : 48,
      buckle: !!hr.buckle, safeTamp: !!hr.safeTamp,
      wind: hr.wind, rain: hr.rain,
      probe: wx.probe, station: wx.station
    };
  }

  /** Does a train path cross [lo,hi] km during [t0,t1]?
      Mirrors the Python conflict engine so on-screen re-scoring after a
      slot shift agrees with the pre-computed plan. */
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
        [lo, hi].forEach(function (e) {
          if (klo <= e && e <= khi && kb !== ka) edges.push(ta + (tb - ta) * (e - ka) / (kb - ka));
        });
        if (edges.length) {
          s0 = Math.max(s0, Math.min.apply(null, edges));
          s1 = Math.min(s1, Math.max.apply(null, edges));
        }
      }
      if (s0 <= t1 && s1 >= t0) return true;
    }
    return false;
  }

  /** Re-evaluate a proposal's traffic cost — used when the controller drags
      the slot or folds extra work into the possession. */
  export function scoreWindow(p: LiveProposal, start: number, duration: number): WindowScore {
    const end = start + duration;
    const blocked: Train[] = [], looped: Train[] = [];
    D.trains.forEach(function (t) {
      if (t.corridor !== p.corridor || p.lines.indexOf(t.line) < 0) return;
      if (!pathEnters(t, p.loKm, p.hiKm, start, end)) return;
      if (t.kind === 'FREIGHT' && t.canLoop) looped.push(t);
      else blocked.push(t);
    });
    let delay = 0;
    blocked.forEach(function (t) {
      if (t.entry < end) delay += Math.max(0, Math.round(end - t.entry));
    });
    return {
      paxAffected: blocked.filter(function (t) { return t.kind === 'PASSENGER'; }).length,
      paxDelayMin: delay,
      freightLooped: looped.length,
      freightIds: looped.map(function (t) { return t.no; }),
      conflictTrains: blocked.slice(0, 6).map(function (t) {
        return { no: t.no, name: t.name, cls: t.cls };
      })
    };
  }

  /** Project the knock-on delay if the gang overruns the block.

      Track machines break down and gangs take longer to pack up; a 120-minute
      block spilling to 140 is routine. Anything whose path would then be
      inside the possession takes the overrun as a hold. */
  export function projectOverrun(p: LiveProposal, start: number,
                                 duration: number, extra: number): OverrunProjection {
    const cleanEnd = start + duration;
    const lateEnd = cleanEnd + extra;
    const hit: OverrunProjection['trains'] = [];
    D.trains.forEach(function (t) {
      if (t.corridor !== p.corridor || p.lines.indexOf(t.line) < 0) return;
      // already blocked by the booked window — not a knock-on
      if (pathEnters(t, p.loKm, p.hiKm, start, cleanEnd)) return;
      if (!pathEnters(t, p.loKm, p.hiKm, cleanEnd, lateEnd)) return;
      // held until the line is handed back
      const reach = firstReach(t, p.loKm, p.hiKm);
      const delay = reach === null ? extra : Math.max(0, Math.round(lateEnd - reach));
      hit.push({ no: t.no, name: t.name, cls: t.cls, delayMin: Math.min(delay, extra) });
    });
    hit.sort(function (a, b) { return b.delayMin - a.delayMin; });
    return {
      extraMin: extra,
      trains: hit,
      totalDelayMin: hit.reduce(function (a, t) { return a + t.delayMin; }, 0),
      worst: hit.length ? hit[0].delayMin : 0
    };
  }

  /** Division time at which a train first reaches the blocked chainage. */
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

  /* --------------------------------------------- private numbers + memo */

  // Private Numbers are issued in sequence through the shift and quoted back
  // over the control phone to authenticate the order.
  let pnSeq = 47;
  let pnTpcSeq = 16;

  export function issueOrder(p: LiveProposal, start: number, duration: number): ControlOrder {
    const pnSm = ++pnSeq;
    const needsTpc = p.window.earthingMin > 0 || !!p.isolation;
    const pnTpc = needsTpc ? ++pnTpcSeq : null;
    const end = start + duration;
    const w = p.window;
    const stations = p.section.split(' - ');
    const L: string[] = [];

    L.push('CONTROL ORDER — ENGINEERING BLOCK AUTHORISATION');
    L.push('');
    L.push('Division      : ' + D.meta.division + ' (' + D.meta.zone + ')');
    L.push('Date          : ' + D.meta.date);
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
           p.items.map(function (i) { return i.action.replace(/_/g, ' '); }).join(', ') + ')');
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
      p.machines.forEach(function (m) {
        L.push('Machine       : ' + m.id + ' (' + m.type + ') ex ' + m.from +
               ', report by ' + m.reportBy + ', crew ' + m.crew);
      });
    } else {
      L.push('Machine       : NIL — manual gang possession');
    }
    if (p.regulation.length) {
      p.regulation.forEach(function (rg) {
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
    L.push('Issued at     : ' + hhmm(S.clock) + '  by Section Controller, ' +
           D.meta.division + ' Division');
    L.push('');
    L.push('Line to be handed back clear of men and material by ' + hhmm(end) + '.');

    return { pnSm: pnSm, pnTpc: pnTpc, issuedAt: S.clock, text: L.join('\n') };
  }

  export function totalDuration(p: LiveProposal): number {
    let extra = 0;
    (p.added || []).forEach(function (a) { extra += a.addMin; });
    return p.duration + extra;
  }

  /* ------------------------------------------------------- clock */

  let tickHandle: number | null = null;

  function tick(): void {
    S.clock = (S.clock + S.speed / 60) % DAY;   // per second of wall time
    bus.emit('clock');
  }

  export function setPlaying(on: boolean): void {
    S.playing = on;
    if (tickHandle !== null) { clearInterval(tickHandle); tickHandle = null; }
    if (on) tickHandle = setInterval(tick, 1000) as unknown as number;
    bus.emit('clockstate');
  }

  /* ------------------------------------------------------- DOM helpers */

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

  /* ------------------------------------------------------- tooltip */

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

  /** Build tooltip body rows from [label, value] pairs. */
  export function tipRows(rows: [string, string][]): string {
    return rows.map(function (r) {
      return '<div class="tt-r"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>';
    }).join('');
  }

  /* ------------------------------------------------------- feedback */

  export function toast(msg: string, kind?: 'warn' | 'bad'): void {
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;
    const t = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 3200);
  }

  export function logEvent(kind: LogKind, title: string, detail: string, ref: string | null): void {
    S.log.unshift({ kind: kind, title: title, detail: detail, ref: ref, at: S.clock, wall: new Date() });
    bus.emit('log');
  }
}
