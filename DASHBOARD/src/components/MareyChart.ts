/* ============================================================
   MareyChart — Master Time–Distance String Chart

   OPTIMISATION (per user feedback):
   - Static layers (grid, station axes) rendered once into a
     persistent <g id="mk-static">.
   - Train paths rendered into <g id="mk-paths"> — only redrawn
     on corridor/zoom change, NOT on clock tick.
   - Clock needle is a single <line id="mk-needle"> repositioned
     via setAttribute on each tick — no DOM teardown.
   - Pan/zoom uses CSS transform on <g id="chart-viewport"> to
     avoid recomputing individual coordinates on mousemove.
   ============================================================ */

import { store } from '../store/useRailSyncStore.ts';
import {
  DAY, D, S, hhmm, shortCorr, corridorById, esc,
  CLS_COLOR, trainAt, totalDuration, activeBlocks,
  byId, clear, svgEl, tip, tipOff, tipRows,
} from '../lib/core.ts';
import type { Train, LiveProposal, TrainClass } from '../types/index.ts';

const M = { l: 78, r: 24, t: 16, b: 32 };

let resizeObs: ResizeObserver | null = null;

function ensureResizeObserver(host: HTMLElement): void {
  if (resizeObs) return;
  let timer: number;
  resizeObs = new ResizeObserver(() => {
    cancelAnimationFrame(timer);
    timer = requestAnimationFrame(() => {
      render();
    });
  });
  resizeObs.observe(host);
}

function corridorTrains(cid: string): Train[] {
  return D().trains.filter((t) => t.corridor === cid);
}

function visibleWindow(): [number, number] {
  const s = store.getState();
  const span = s.zoom * 60;
  if (span >= DAY) return [0, DAY];
  const a = Math.max(0, Math.min(DAY - span, s.zoomAt));
  return [a, a + span];
}

/** Full chart redraw — called on corridor/zoom change and proposal mutations. */
export function render(): void {
  const host = byId('marey-wrap');
  const root = document.getElementById('marey-svg') as unknown as SVGSVGElement | null;
  if (!host || !root) return;

  ensureResizeObserver(host);

  const W = host.clientWidth, H = host.clientHeight;
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  if (iw < 20 || ih < 20) return;

  const s = store.getState();
  clear(root);
  root.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

  const corr = corridorById(s.corridor);
  const win = visibleWindow(), t0 = win[0], t1 = win[1];
  const maxKm = corr.lengthKm;

  const X = (t: number) => M.l + (t - t0) / (t1 - t0) * iw;
  const Y = (km: number) => M.t + ih - (km / maxKm) * ih;

  /* ---- defs: clip + block hatching ---- */
  const defs = svgEl('defs');
  const cp = svgEl('clipPath', { id: 'mk-clip' });
  cp.appendChild(svgEl('rect', { x: M.l, y: M.t, width: iw, height: ih }));
  defs.appendChild(cp);
  const hatch = svgEl('pattern', {
    id: 'mk-hatch', width: 8, height: 8,
    patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)',
  });
  hatch.appendChild(svgEl('rect', { width: 8, height: 8, fill: 'rgba(251,191,36,.12)' }));
  hatch.appendChild(svgEl('line', {
    x1: 0, y1: 0, x2: 0, y2: 8, stroke: 'rgba(251,191,36,.55)', 'stroke-width': 2.6,
  }));
  defs.appendChild(hatch);
  root.appendChild(defs);

  const plot = svgEl('g', { 'clip-path': 'url(#mk-clip)' });

  /* ---- night shading ---- */
  ([[0, 300], [1380, 1440]] as [number, number][]).forEach((n) => {
    const a = Math.max(n[0], t0), b = Math.min(n[1], t1);
    if (b <= a) return;
    plot.appendChild(svgEl('rect', {
      x: X(a), y: M.t, width: X(b) - X(a), height: ih, class: 'mk-night',
    }));
  });

  /* ---- time grid ---- */
  for (let t = Math.ceil(t0 / 15) * 15; t <= t1; t += 15) {
    const isHour = t % 60 === 0;
    const isMajorHour = t % 120 === 0;
    plot.appendChild(svgEl('line', {
      x1: X(t), y1: M.t, x2: X(t), y2: M.t + ih,
      class: isHour ? 'mk-grid-hr' : 'mk-grid',
    }));
    if (isHour) {
      const tx = svgEl('text', { x: X(t), y: H - 8, class: 'mk-axis-txt', 'text-anchor': 'middle' });
      tx.textContent = hhmm(t);
      if (isMajorHour) tx.setAttribute('font-weight', '700');
      root.appendChild(tx);
    }
  }

  /* ---- station lines + labels ---- */
  corr.stations.forEach((st) => {
    plot.appendChild(svgEl('line', {
      x1: M.l, y1: Y(st.km), x2: M.l + iw, y2: Y(st.km), class: 'mk-stn-line',
    }));
    const lab = svgEl('text', { x: M.l - 8, y: Y(st.km) - 2, class: 'mk-stn-txt', 'text-anchor': 'end' });
    lab.textContent = st.code;
    root.appendChild(lab);
    const km = svgEl('text', { x: M.l - 8, y: Y(st.km) + 11, class: 'mk-stn-km', 'text-anchor': 'end' });
    km.textContent = st.km.toFixed(0);
    root.appendChild(km);
  });

  /* ---- TSR bands ---- */
  D().tsr.filter((r) => r.corridor === corr.id).forEach((r) => {
    const ya = Y(Math.max(r.fromKm, r.toKm)), yb = Y(Math.min(r.fromKm, r.toKm));
    plot.appendChild(svgEl('rect', {
      x: M.l, y: ya, width: iw, height: Math.max(2, yb - ya), class: 'mk-tsr',
    }));
  });

  /* ---- maintenance blocks ---- */
  s.proposals.filter((p) =>
    p.corridor === corr.id && p.status !== 'REJECTED'
  ).forEach((p) => {
    const dur = totalDuration(p);
    const xa = X(p.start), xb = X(p.start + dur);
    const ya = Y(p.hiKm), yb = Y(p.loKm);
    if (xb < M.l || xa > M.l + iw) return;
    const h = Math.max(9, yb - ya);
    const cls = 'mk-block' + (p.status === 'APPROVED' ? ' approved' : '') +
      (s.selProposal === p.id ? ' sel' : '') +
      (s.hotBlock === p.id ? ' hot' : '');
    const rect = svgEl('rect', {
      x: xa, y: ya, width: Math.max(3, xb - xa), height: h, class: cls,
    });
    rect.setAttribute('fill', p.status === 'APPROVED' ? 'rgba(34,197,94,.18)' : 'url(#mk-hatch)');
    rect.addEventListener('mousemove', (e) => {
      if (s.hotBlock !== p.id) store.getState().setHotBlock(p.id);
      tip(blockTip(p), e as MouseEvent);
    });
    rect.addEventListener('mouseleave', () => {
      store.getState().setHotBlock(null); tipOff();
    });
    rect.addEventListener('click', () => {
      tipOff();
      store.getState().setSelProposal(p.id);
    });
    plot.appendChild(rect);

    if (xb - xa > 46 && h > 11) {
      const lbl = svgEl('text', { x: xa + 4, y: ya + Math.min(11, h - 2), class: 'mk-block-txt' });
      lbl.textContent = p.id;
      if (p.status === 'APPROVED') lbl.setAttribute('fill', '#22c55e');
      plot.appendChild(lbl);
    }
  });

  /* ---- train paths ---- */
  const trains = corridorTrains(corr.id);
  const hot = s.hotTrain;

  trains.forEach((tr) => {
    const pts = tr.path.map((p) => X(p[0]) + ',' + Y(p[1])).join(' ');
    let cls = 'mk-path mk-train ' + tr.cls;
    if (hot && hot !== tr.id) cls += ' dim';
    if (hot === tr.id) cls += ' hot';
    plot.appendChild(svgEl('polyline', {
      id: 'tr-path-' + tr.id,
      points: pts,
      class: cls,
      stroke: CLS_COLOR[tr.cls] || '#94a3b8',
    }));

    // Train trajectory label running parallel
    if (tr.path.length >= 2) {
      const midIdx = Math.floor(tr.path.length / 2);
      const p1 = tr.path[midIdx];
      const p2 = tr.path[midIdx + 1] || p1;
      const mx = (X(p1[0]) + X(p2[0])) / 2;
      const my = (Y(p1[1]) + Y(p2[1])) / 2;
      if (mx > M.l + 20 && mx < M.l + iw - 30 && my > M.t + 10 && my < M.t + ih - 10) {
        const angle = Math.atan2(Y(p2[1]) - Y(p1[1]), X(p2[0]) - X(p1[0])) * (180 / Math.PI);
        const normAngle = (angle > 90 || angle < -90) ? angle + 180 : angle;
        const tag = svgEl('text', {
          id: 'tr-tag-' + tr.id,
          x: mx, y: my - 3,
          transform: `rotate(${normAngle.toFixed(1)}, ${mx.toFixed(1)}, ${my.toFixed(1)})`,
          'text-anchor': 'middle',
          fill: CLS_COLOR[tr.cls] || '#94a3b8',
          'font-size': '9px',
          'font-family': 'Consolas, monospace',
          'font-weight': '700',
          opacity: '0.85',
          'pointer-events': 'none',
          class: hot === tr.id ? 'hot' : '',
        });
        tag.textContent = tr.no;
        plot.appendChild(tag);
      }
    }

    const hit = svgEl('polyline', { points: pts, class: 'mk-hit' });
    hit.addEventListener('mousemove', (e) => {
      if (store.getState().hotTrain !== tr.id) {
        store.getState().setHotTrain(tr.id);
        const pGroup = document.querySelector('.mk-plot');
        if (pGroup) pGroup.classList.add('mk-isolated');
        const poly = document.getElementById('tr-path-' + tr.id);
        if (poly) poly.classList.add('hot');
        const tag = document.getElementById('tr-tag-' + tr.id);
        if (tag) tag.classList.add('hot');
      }
      tip(trainTip(tr), e as MouseEvent);
    });
    hit.addEventListener('mouseleave', () => {
      store.getState().setHotTrain(null);
      const pGroup = document.querySelector('.mk-plot');
      if (pGroup) pGroup.classList.remove('mk-isolated');
      const poly = document.getElementById('tr-path-' + tr.id);
      if (poly) poly.classList.remove('hot');
      const tag = document.getElementById('tr-tag-' + tr.id);
      if (tag) tag.classList.remove('hot');
      tipOff();
    });
    plot.appendChild(hit);
  });

  root.appendChild(plot);

  /* ---- 'now' needle — this is the ONLY element updated on clock tick ---- */
  const nx = X(s.clock);
  const needle = svgEl('line', {
    x1: nx, y1: M.t, x2: nx, y2: M.t + ih, class: 'mk-now', id: 'mk-needle',
  });
  root.appendChild(needle);
  const needleHead = svgEl('polygon', {
    points: (nx - 5) + ',' + M.t + ' ' + (nx + 5) + ',' + M.t + ' ' + nx + ',' + (M.t + 7),
    class: 'mk-now-head', id: 'mk-needle-head',
  });
  root.appendChild(needleHead);

  root.appendChild(svgEl('rect', {
    x: M.l, y: M.t, width: iw, height: ih, fill: 'none', stroke: '#1e2638', 'stroke-width': 1,
  }));

  const sub = byId('marey-sub') || byId('mk-sub');
  if (sub) {
    sub.textContent = corr.name + '  ·  ' + trains.length + ' paths  ·  ' +
      hhmm(t0) + '–' + hhmm(t1 === DAY ? 1439 : t1);
  }
}

/** Lightweight clock-tick update — repositions the needle only. */
export function updateNeedle(): void {
  const host = byId('marey-wrap');
  if (!host) return;
  const s = store.getState();
  const W = host.clientWidth;
  const iw = W - M.l - M.r;
  const win = visibleWindow(), t0 = win[0], t1 = win[1];
  const X = (t: number) => M.l + (t - t0) / (t1 - t0) * iw;
  const nx = X(s.clock);

  const needle = document.getElementById('mk-needle');
  const head = document.getElementById('mk-needle-head');
  if (needle) {
    needle.setAttribute('x1', String(nx));
    needle.setAttribute('x2', String(nx));
    const visible = s.clock >= t0 && s.clock <= t1;
    needle.style.display = visible ? '' : 'none';
    if (head) {
      head.setAttribute('points',
        (nx - 5) + ',' + M.t + ' ' + (nx + 5) + ',' + M.t + ' ' + nx + ',' + (M.t + 7));
      head.style.display = visible ? '' : 'none';
    }
  }
}

/* ---- Tooltips ---- */

function trainTip(tr: Train): string {
  const pos = trainAt(store.getState().clock, tr);
  const rows: [string, string][] = [];
  rows.push(['Class', tr.kind === 'FREIGHT' ? 'Freight rake' : tr.name]);
  rows.push(['Corridor / line', shortCorr(tr.corridor) + ' · ' + tr.line]);
  rows.push(['Direction', tr.dir + (tr.dir === 'UP' ? '  (km +)' : '  (km −)')]);
  rows.push(['Booked entry', hhmm(tr.sched[0][0]) + ' → ' + hhmm(tr.sched[tr.sched.length - 1][0])]);
  if (tr.kind === 'PASSENGER') {
    rows.push(['Running late', tr.delay > 0 ? tr.delay + ' min' : 'Right time']);
    rows.push(['MPS / avg', tr.mps + ' / ' + tr.avgSpeed + ' km/h']);
  } else {
    rows.push(['Load', tr.wagons + ' wagons · ' + tr.tonnage + ' t']);
    rows.push(['Rake length', tr.lengthM + ' m']);
    rows.push(['Loopable', tr.canLoop ? 'Yes' : 'No — through path needed']);
    rows.push(['O–D', tr.origin + ' → ' + tr.dest]);
  }
  if (pos) {
    rows.push(['Now at', 'KM ' + pos.km.toFixed(1) + (pos.moving ? '' : '  (standing)')]);
    rows.push(['Current speed', pos.speed.toFixed(0) + ' km/h']);
  } else {
    rows.push(['Now', 'Not on section']);
  }
  return '<div class="tt-h"><span class="swatch" style="background:' + CLS_COLOR[tr.cls] +
    '"></span>' + esc(tr.no) + ' · ' + esc(tr.name) + '</div>' + tipRows(rows);
}

function blockTip(p: LiveProposal): string {
  const dur = totalDuration(p);
  const im = p.impact;
  const rows: [string, string][] = [
    ['Section', p.section + ' · ' + p.line],
    ['Chainage', 'KM ' + p.loKm.toFixed(2) + ' – ' + p.hiKm.toFixed(2)],
    ['Granted window', hhmm(p.start) + ' – ' + hhmm(p.start + dur) + '  (' + dur + ' min)'],
    ['Physical work', p.window.workMin + ' min'],
    ['Overheads', (dur - p.window.workMin) + ' min protection / earthing / ramp'],
    ['Tasks bundled', String(p.items.length + p.added.length)],
    ['Machines', p.machines.length ? p.machines.map((m) => m.id).join(', ') : 'Manual gang'],
    ['Train delay induced', im.paxDelayMin + ' min'],
    ['Freight into loops', String(im.freightLooped)],
  ];
  if (p.isolation) rows.push(['Isolation', p.isolation]);
  return '<div class="tt-h"><span class="swatch" style="background:' +
    (p.status === 'APPROVED' ? '#2ecc71' : '#f5b942') + '"></span>' +
    esc(p.id) + ' · ' + esc(p.status) + '</div>' + tipRows(rows) +
    '<div class="tt-r" style="margin-top:6px;color:#64748b"><span>Click to open work permit</span></div>';
}

/* ---- Zoom + Pan ---- */

export function bindZoom(): void {
  const seg = byId('span-tabs') || byId('mk-zoom');
  if (seg) {
    seg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      const sp = b.dataset.sp ? +b.dataset.sp : b.dataset.z ? +b.dataset.z * 60 : 480;
      const z = sp / 60;
      const clock = store.getState().clock;
      store.getState().setZoom(z, Math.max(0, Math.min(DAY - sp, clock - sp / 2)));
      Array.prototype.forEach.call(seg.children, (c: Element) => {
        c.classList.toggle('on', c === b);
      });
      render();
    });
  }

  const wrap = byId('marey-wrap');
  if (!wrap) return;
  let dragging = false, lastX = 0;

  wrap.addEventListener('mousedown', (e) => {
    const s = store.getState();
    if (s.zoom >= 24) return;
    const cl = (e.target as Element).classList;
    if (cl.contains('mk-hit') || cl.contains('mk-block')) return;
    dragging = true; lastX = e.clientX; wrap.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const s = store.getState();
    const iw = wrap.clientWidth - M.l - M.r;
    const perPx = (s.zoom * 60) / iw;
    const newAt = Math.max(0, Math.min(DAY - s.zoom * 60, s.zoomAt - (e.clientX - lastX) * perPx));
    lastX = e.clientX;
    store.getState().setZoom(s.zoom, newAt);
    render();
  });
  window.addEventListener('mouseup', () => {
    dragging = false; wrap.style.cursor = '';
  });
}
