/* ============================================================
   TelemetryRibbon — Visual SVG Analytics Charts & SCADA Matrices
   Real visual SVG charts: Punctuality Donut, 24-hr Diurnal Rail
   Temp Area Chart with Tamping Envelope & Buckling Zone,
   Backlog Donut, TSR Delay Bar Chart, and CRIS PN Logbook.
   ============================================================ */

import { store } from '../store/useRailSyncStore.ts';
import {
  D, S, hhmm, shortCorr, esc, scoreColor, CLS_COLOR, railTemp, pad2, totalDuration,
  byId, clear, el, toast,
} from '../lib/core.ts';
import type { TrainClass, LogKind, LiveProposal } from '../types/index.ts';

const CORR_LABEL: Record<string, string> = {
  CORR_NORTH: 'North · DLI–PNP', CORR_EAST: 'East · GZB–MTC',
  CORR_SOUTH: 'South · NZM–PWL', CORR_WEST: 'West · DLI–ROK',
};

interface Panel { root: HTMLElement; body: HTMLElement; }

function panel(title: string, sub?: string): Panel {
  const root = el('div', 'chart-card');
  const h = el('div', 'chart-hd');
  h.appendChild(el('div', null, title));
  if (sub) {
    const s = el('span', 'ws-meta', sub);
    s.style.marginLeft = 'auto';
    h.appendChild(s);
  }
  root.appendChild(h);
  const body = el('div', 'chart-bd');
  body.style.padding = '12px';
  root.appendChild(body);
  return { root, body };
}

function punctColor(p: number): string {
  return p >= 90 ? '#22c55e' : p >= 75 ? '#f59e0b' : '#ef4444';
}

/* ============================================================ REAL SVG CHARTS */

/** 1. Punctuality Radial Donut Gauge (SVG) */
function createPunctualityDonut(pct: number, onTime: number, total: number): HTMLElement {
  const wrap = el('div');
  wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:24px;width:100%;';

  const r = 58;
  const circ = 2 * Math.PI * r;
  const onTimeOffset = (pct / 100) * circ;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '160');
  svg.setAttribute('height', '160');
  svg.setAttribute('viewBox', '0 0 160 160');

  // Background ring
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  bg.setAttribute('cx', '80'); bg.setAttribute('cy', '80'); bg.setAttribute('r', String(r));
  bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', '#e2e8f0');
  bg.setAttribute('stroke-width', '16');
  svg.appendChild(bg);

  // Delayed ring
  const del = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  del.setAttribute('cx', '80'); del.setAttribute('cy', '80'); del.setAttribute('r', String(r));
  del.setAttribute('fill', 'none'); del.setAttribute('stroke', '#ef4444');
  del.setAttribute('stroke-width', '16');
  del.setAttribute('transform', 'rotate(-90 80 80)');
  svg.appendChild(del);

  // On-time arc
  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  arc.setAttribute('cx', '80'); arc.setAttribute('cy', '80'); arc.setAttribute('r', String(r));
  arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', '#22c55e');
  arc.setAttribute('stroke-width', '16');
  arc.setAttribute('stroke-dasharray', `${onTimeOffset.toFixed(1)} ${circ.toFixed(1)}`);
  arc.setAttribute('transform', 'rotate(-90 80 80)');
  svg.appendChild(arc);

  // Center text
  const valText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  valText.setAttribute('x', '80'); valText.setAttribute('y', '76');
  valText.setAttribute('text-anchor', 'middle'); valText.setAttribute('fill', '#0f172a');
  valText.setAttribute('font-family', 'var(--mono)'); valText.setAttribute('font-size', '22px');
  valText.setAttribute('font-weight', '800');
  valText.textContent = pct.toFixed(1) + '%';
  svg.appendChild(valText);

  const subText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  subText.setAttribute('x', '80'); subText.setAttribute('y', '94');
  subText.setAttribute('text-anchor', 'middle'); subText.setAttribute('fill', '#64748b');
  subText.setAttribute('font-family', 'var(--mono)'); subText.setAttribute('font-size', '10px');
  subText.setAttribute('letter-spacing', '0.08em');
  subText.textContent = 'ON-TIME RTIS';
  svg.appendChild(subText);

  wrap.appendChild(svg);

  // Breakdown Legend
  const legend = el('div');
  legend.style.cssText = 'display:flex;flex-direction:column;gap:8px;font-family:var(--mono);';
  legend.innerHTML = `
    <div style="font-size:11px;color:#64748b;font-weight:700">TRAFFIC ADHERENCE</div>
    <div style="display:flex;align-items:center;gap:8px;font-size:12px">
      <span style="width:10px;height:10px;background:#22c55e;display:inline-block"></span>
      <span>Right Time: <b>${onTime}</b> trains (${pct.toFixed(1)}%)</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;font-size:12px">
      <span style="width:10px;height:10px;background:#ef4444;display:inline-block"></span>
      <span>Delayed (>15m): <b>${total - onTime}</b> trains (${(100 - pct).toFixed(1)}%)</span>
    </div>
    <div style="font-size:11px;color:#64748b;margin-top:4px">Section threshold: 15 min tolerance</div>
  `;
  wrap.appendChild(legend);

  return wrap;
}

/** 2. 24-Hour Diurnal Rail Temp Area Chart (SVG) */
function createDiurnalTempChart(clockMin: number): HTMLElement {
  const host = el('div');
  host.style.cssText = 'width:100%;position:relative;';

  const W = 620, H = 190;
  const padL = 45, padR = 20, padT = 20, padB = 30;
  const pw = W - padL - padR, ph = H - padT - padB;

  const minTemp = 10, maxTemp = 75;
  const Td = 45; // Design destressing temperature
  const tampLo = Td - 30; // 15 C
  const tampHi = Td + 10; // 55 C
  const buckleDanger = 60; // 60 C

  const X = (m: number) => padL + (m / 1440) * pw;
  const Y = (c: number) => padT + ph - ((c - minTemp) / (maxTemp - minTemp)) * ph;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '190');
  svg.style.display = 'block';

  // 1. Safe Tamping Envelope Band (Green Shading)
  const yTampLo = Y(tampLo), yTampHi = Y(tampHi);
  const tampBand = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  tampBand.setAttribute('x', String(padL));
  tampBand.setAttribute('y', String(yTampHi));
  tampBand.setAttribute('width', String(pw));
  tampBand.setAttribute('height', String(yTampLo - yTampHi));
  tampBand.setAttribute('fill', 'rgba(34, 197, 94, 0.12)');
  tampBand.setAttribute('stroke', 'rgba(34, 197, 94, 0.3)');
  tampBand.setAttribute('stroke-dasharray', '4,3');
  svg.appendChild(tampBand);

  const tampLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  tampLbl.setAttribute('x', String(padL + 6));
  tampLbl.setAttribute('y', String(yTampHi + 12));
  tampLbl.setAttribute('fill', '#22c55e');
  tampLbl.setAttribute('font-size', '9.5px');
  tampLbl.setAttribute('font-family', 'var(--mono)');
  tampLbl.setAttribute('font-weight', '700');
  tampLbl.textContent = 'SAFE TAMPING ENVELOPE [Td-30°C to Td+10°C]';
  svg.appendChild(tampLbl);

  // 2. Buckling Danger Zone (Red Shading)
  const yBuckle = Y(buckleDanger);
  const buckleBand = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  buckleBand.setAttribute('x', String(padL));
  buckleBand.setAttribute('y', String(padT));
  buckleBand.setAttribute('width', String(pw));
  buckleBand.setAttribute('height', String(Math.max(0, yBuckle - padT)));
  buckleBand.setAttribute('fill', 'rgba(239, 68, 68, 0.15)');
  buckleBand.setAttribute('stroke', 'rgba(239, 68, 68, 0.4)');
  buckleBand.setAttribute('stroke-dasharray', '3,3');
  svg.appendChild(buckleBand);

  const buckleLbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  buckleLbl.setAttribute('x', String(padL + pw - 6));
  buckleLbl.setAttribute('y', String(yBuckle - 4));
  buckleLbl.setAttribute('text-anchor', 'end');
  buckleLbl.setAttribute('fill', '#f87171');
  buckleLbl.setAttribute('font-size', '9.5px');
  buckleLbl.setAttribute('font-family', 'var(--mono)');
  buckleLbl.setAttribute('font-weight', '700');
  buckleLbl.textContent = 'CRITICAL BUCKLING DANGER ZONE (>60°C)';
  svg.appendChild(buckleLbl);

  // Grid lines & labels
  for (let c = 20; c <= 70; c += 10) {
    const y = Y(c);
    const gl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    gl.setAttribute('x1', String(padL)); gl.setAttribute('y1', String(y));
    gl.setAttribute('x2', String(padL + pw)); gl.setAttribute('y2', String(y));
    gl.setAttribute('stroke', '#e2e8f0'); gl.setAttribute('stroke-width', '1');
    svg.appendChild(gl);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', String(padL - 6)); txt.setAttribute('y', String(y + 3));
    txt.setAttribute('text-anchor', 'end'); txt.setAttribute('fill', '#64748b');
    txt.setAttribute('font-size', '10px'); txt.setAttribute('font-family', 'var(--mono)');
    txt.textContent = c + '°C';
    svg.appendChild(txt);
  }

  // Time ticks
  for (let h = 0; h <= 24; h += 4) {
    const m = h * 60;
    const x = X(m);
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', String(x)); txt.setAttribute('y', String(H - 8));
    txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('fill', '#64748b');
    txt.setAttribute('font-size', '10px'); txt.setAttribute('font-family', 'var(--mono)');
    txt.textContent = pad2(h % 24) + ':00';
    svg.appendChild(txt);
  }

  // Ambient Ta curve
  const ambientPts: string[] = [];
  const railPts: string[] = [];
  for (let m = 0; m <= 1440; m += 20) {
    const ta = 24 + 12 * Math.sin((Math.PI * (m - 360)) / 720);
    const sun = m >= 360 && m <= 1080 ? Math.sin((Math.PI * (m - 360)) / 720) : 0;
    const tr = ta + 22 * sun;
    ambientPts.push(`${X(m).toFixed(1)},${Y(ta).toFixed(1)}`);
    railPts.push(`${X(m).toFixed(1)},${Y(tr).toFixed(1)}`);
  }

  // Draw Ta
  const pathTa = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  pathTa.setAttribute('points', ambientPts.join(' '));
  pathTa.setAttribute('fill', 'none'); pathTa.setAttribute('stroke', '#38bdf8');
  pathTa.setAttribute('stroke-width', '1.6');
  svg.appendChild(pathTa);

  // Draw Tr
  const pathTr = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  pathTr.setAttribute('points', railPts.join(' '));
  pathTr.setAttribute('fill', 'none'); pathTr.setAttribute('stroke', '#f59e0b');
  pathTr.setAttribute('stroke-width', '2.2');
  svg.appendChild(pathTr);

  // Current clock needle
  const nx = X(clockMin);
  const needle = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  needle.setAttribute('x1', String(nx)); needle.setAttribute('y1', String(padT));
  needle.setAttribute('x2', String(nx)); needle.setAttribute('y2', String(padT + ph));
  needle.setAttribute('stroke', '#0f172a'); needle.setAttribute('stroke-width', '1.8');
  needle.setAttribute('stroke-dasharray', '3,2');
  svg.appendChild(needle);

  // Read current temp
  const curTa = 24 + 12 * Math.sin((Math.PI * (clockMin - 360)) / 720);
  const curSun = clockMin >= 360 && clockMin <= 1080 ? Math.sin((Math.PI * (clockMin - 360)) / 720) : 0;
  const curTr = curTa + 22 * curSun;
  const isSafe = curTr >= tampLo && curTr <= tampHi;

  const tagX = Math.min(padL + pw - 90, Math.max(padL + 10, nx + 6));
  const tag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  tag.setAttribute('x', String(tagX));
  tag.setAttribute('y', String(padT + 16));
  tag.setAttribute('fill', isSafe ? '#22c55e' : '#f87171');
  tag.setAttribute('font-size', '10.5px');
  tag.setAttribute('font-family', 'var(--mono)');
  tag.setAttribute('font-weight', '800');
  tag.textContent = `NOW: Tr ${curTr.toFixed(1)}°C · ${isSafe ? 'SAFE TO TAMP' : 'UNSAFE'}`;
  svg.appendChild(tag);

  host.appendChild(svg);

  // Sub-bar legend
  const foot = el('div');
  foot.style.cssText = 'display:flex;justify-content:space-between;padding:6px 8px 0;font-size:11px;font-family:var(--mono);color:#64748b;border-top:1px solid #e2e8f0;';
  foot.innerHTML = `
    <div style="display:flex;gap:12px">
      <span><b style="color:#f59e0b">―</b> Rail Temp Tr</span>
      <span><b style="color:#38bdf8">―</b> Ambient Temp Ta</span>
      <span><b style="color:#22c55e">■</b> Safe Window (${tampLo}°C–${tampHi}°C)</span>
    </div>
    <div style="color:${isSafe ? '#22c55e' : '#f87171'};font-weight:700">
      ${isSafe ? '● TAMPING ENVELOPE PERMITTED' : '▲ OUTSIDE SAFE TAMPING ENVELOPE'}
    </div>
  `;
  host.appendChild(foot);

  return host;
}

/** 3. Departmental Maintenance Backlog Donut Chart (SVG) */
function createBacklogDonut(): HTMLElement {
  const wrap = el('div');
  wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:24px;width:100%;';

  const q = D().queue;
  const tms = q.filter((x) => x.dept === 'TMS').length;
  const tdms = q.filter((x) => x.dept === 'TDMS').length;
  const smms = q.filter((x) => x.dept === 'SMMS').length;
  const total = q.length || 1;

  const r = 58;
  const circ = 2 * Math.PI * r;

  const tmsArc = (tms / total) * circ;
  const tdmsArc = (tdms / total) * circ;
  const smmsArc = (smms / total) * circ;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '160'); svg.setAttribute('height', '160');
  svg.setAttribute('viewBox', '0 0 160 160');

  // Background
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  bg.setAttribute('cx', '80'); bg.setAttribute('cy', '80'); bg.setAttribute('r', String(r));
  bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', '#e2e8f0');
  bg.setAttribute('stroke-width', '16');
  svg.appendChild(bg);

  // TMS arc (Green)
  const a1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  a1.setAttribute('cx', '80'); a1.setAttribute('cy', '80'); a1.setAttribute('r', String(r));
  a1.setAttribute('fill', 'none'); a1.setAttribute('stroke', '#22c55e');
  a1.setAttribute('stroke-width', '16');
  a1.setAttribute('stroke-dasharray', `${tmsArc.toFixed(1)} ${circ.toFixed(1)}`);
  a1.setAttribute('transform', 'rotate(-90 80 80)');
  svg.appendChild(a1);

  // TDMS arc (Blue)
  const a2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  a2.setAttribute('cx', '80'); a2.setAttribute('cy', '80'); a2.setAttribute('r', String(r));
  a2.setAttribute('fill', 'none'); a2.setAttribute('stroke', '#38bdf8');
  a2.setAttribute('stroke-width', '16');
  a2.setAttribute('stroke-dasharray', `${tdmsArc.toFixed(1)} ${circ.toFixed(1)}`);
  a2.setAttribute('stroke-dashoffset', String(-tmsArc));
  a2.setAttribute('transform', 'rotate(-90 80 80)');
  svg.appendChild(a2);

  // SMMS arc (Violet)
  const a3 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  a3.setAttribute('cx', '80'); a3.setAttribute('cy', '80'); a3.setAttribute('r', String(r));
  a3.setAttribute('fill', 'none'); a3.setAttribute('stroke', '#a78bfa');
  a3.setAttribute('stroke-width', '16');
  a3.setAttribute('stroke-dasharray', `${smmsArc.toFixed(1)} ${circ.toFixed(1)}`);
  a3.setAttribute('stroke-dashoffset', String(-(tmsArc + tdmsArc)));
  a3.setAttribute('transform', 'rotate(-90 80 80)');
  svg.appendChild(a3);

  // Center text
  const valText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  valText.setAttribute('x', '80'); valText.setAttribute('y', '76');
  valText.setAttribute('text-anchor', 'middle'); valText.setAttribute('fill', '#0f172a');
  valText.setAttribute('font-family', 'var(--mono)'); valText.setAttribute('font-size', '22px');
  valText.setAttribute('font-weight', '800');
  valText.textContent = String(q.length);
  svg.appendChild(valText);

  const subText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  subText.setAttribute('x', '80'); subText.setAttribute('y', '94');
  subText.setAttribute('text-anchor', 'middle'); subText.setAttribute('fill', '#64748b');
  subText.setAttribute('font-family', 'var(--mono)'); subText.setAttribute('font-size', '10px');
  subText.setAttribute('letter-spacing', '0.08em');
  subText.textContent = 'REQUISITIONS';
  svg.appendChild(subText);

  wrap.appendChild(svg);

  // Department Breakdown Legend
  const legend = el('div');
  legend.style.cssText = 'display:flex;flex-direction:column;gap:6px;font-family:var(--mono);';
  legend.innerHTML = `
    <div style="font-size:11px;color:#64748b;font-weight:700">DEPARTMENTAL SPLIT</div>
    <div style="display:flex;align-items:center;gap:8px;font-size:12px">
      <span style="width:10px;height:10px;background:#22c55e;display:inline-block"></span>
      <span>TMS (P-Way): <b>${tms}</b> (${(100 * tms / total).toFixed(0)}%)</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;font-size:12px">
      <span style="width:10px;height:10px;background:#38bdf8;display:inline-block"></span>
      <span>TDMS (TRD Catenary): <b>${tdms}</b> (${(100 * tdms / total).toFixed(0)}%)</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;font-size:12px">
      <span style="width:10px;height:10px;background:#a78bfa;display:inline-block"></span>
      <span>SMMS (S&amp;T Signals): <b>${smms}</b> (${(100 * smms / total).toFixed(0)}%)</span>
    </div>
    <div style="font-size:11px;color:#f59e0b;margin-top:4px">Total Block Hours Needed: ~${(q.length * 1.8).toFixed(0)} hrs</div>
  `;
  wrap.appendChild(legend);

  return wrap;
}

/** 4. Active TSR Speed Restriction Impact Bar Chart (SVG) */
function createTsrImpactChart(): HTMLElement {
  const host = el('div');
  host.style.cssText = 'width:100%;';

  const tsrs = D().tsr.slice(0, 5).sort((a, b) => b.lossMin - a.lossMin);
  const maxLoss = Math.max(...tsrs.map((t) => t.lossMin), 15);

  const container = el('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:8px;font-family:var(--mono);';

  tsrs.forEach((t) => {
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:11.5px;';

    const lbl = el('div');
    lbl.style.cssText = 'width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    lbl.innerHTML = `<b>${t.no}</b> · ${t.from}–${t.to} (${t.speed} km/h)`;
    row.appendChild(lbl);

    const barWrap = el('div');
    barWrap.style.cssText = 'flex:1;background:#e2e8f0;height:16px;position:relative;display:flex;align-items:center;';
    const bar = el('div');
    const widthPct = (t.lossMin / maxLoss) * 100;
    bar.style.cssText = `height:100%;width:${widthPct.toFixed(1)}%;background:${t.lossMin > 10 ? '#ef4444' : '#f59e0b'};transition:width 0.3s;`;
    barWrap.appendChild(bar);
    row.appendChild(barWrap);

    const val = el('div');
    val.style.cssText = 'width:80px;text-align:right;font-weight:700;color:#0f172a;';
    val.textContent = `+${t.lossMin.toFixed(1)} min`;
    row.appendChild(val);

    container.appendChild(row);
  });

  host.appendChild(container);
  return host;
}

/* ============================================================ RENDER REPORTS (WORKSPACE 5) */

export function renderReports(): void {
  const g = byId('rep-grid');
  if (!g) return;
  clear(g);
  const s = store.getState();
  const m = D().metrics;

  /* 1. Division Punctuality Donut Gauge (Visual SVG) */
  const p1 = panel('Division Punctuality Index (RTIS Donut Gauge)', 'Real-time GPS punctuality actuals');
  p1.root.classList.add('span2');
  p1.body.appendChild(createPunctualityDonut(m.punctuality, m.trainsOnTime, m.trainsRun));
  g.appendChild(p1.root);

  /* 2. Departmental Maintenance Backlog Donut (Visual SVG) */
  const p2 = panel('Departmental Maintenance Backlog Split', 'Requisitions by P-Way, TRD, and S&T');
  p2.root.classList.add('span2');
  p2.body.appendChild(createBacklogDonut());
  g.appendChild(p2.root);

  /* 3. 24-Hour Diurnal Rail Thermometry Chart (Visual SVG) */
  const p3 = panel('24-Hour Diurnal Rail Thermometry & Safe Tamping Window', 'Continuous probe network Tr vs Ta');
  p3.root.classList.add('span4');
  p3.body.appendChild(createDiurnalTempChart(s.clock));
  g.appendChild(p3.root);

  /* 4. Active TSR Speed Restriction Impact Bar Chart (Visual SVG) */
  const p4 = panel('Active TSR Delay Impact Ranking (Minutes Lost)', 'Ranked by delay induced per passenger train');
  p4.root.classList.add('span4');
  p4.body.appendChild(createTsrImpactChart());
  g.appendChild(p4.root);
}

/* ============================================================ RENDER LOGS (WORKSPACE 6) */

const LOG_COLOR: Record<LogKind, string> = {
  approve: '#22c55e', reject: '#ef4444', shift: '#f59e0b',
  bundle: '#8b5cf6', reopen: '#38bdf8', system: '#94a3b8',
};

export function renderLogs(): void {
  const root = byId('log-root');
  if (!root) return;
  clear(root);

  const s = store.getState();
  const approved = s.proposals.filter((p) => p.status === 'APPROVED');
  const rejected = s.proposals.filter((p) => p.status === 'REJECTED');
  const logEvents = s.log;

  const sub = byId('audit-sub');
  if (sub) {
    sub.textContent = `${approved.length} Control Orders Issued · ${rejected.length} Refusals · ${logEvents.length} Events`;
  }

  // Section 1: Official Control Orders & Private Numbers
  const pOrders = panel('OFFICIAL CONTROL ORDERS ISSUED (PRIVATE NUMBERS)', `${approved.length} granted blocks`);
  pOrders.root.style.marginBottom = '12px';

  if (!approved.length) {
    pOrders.body.appendChild(el('div', 'empty', 'No maintenance blocks approved yet in this shift.'));
  } else {
    approved.forEach((p) => {
      const dur = totalDuration(p);
      const card = el('div', 'prop-card');
      card.style.cssText = 'background:#ffffff;border:1px solid #cbd5e1;padding:12px;margin-bottom:8px;';

      const hd = el('div', 'prop-card-hd');
      hd.innerHTML = `
        <span style="color:#22c55e;font-weight:800">● ORDER NO: ${p.id}</span>
        <span>· Section: <b>${p.section}</b> (${p.lines.join('+')})</span>
        <span class="chip rout" style="margin-left:auto">PN-SM: ${p.order?.pnSm ?? '48'}</span>
        ${p.order?.pnTpc ? `<span class="chip rout">PN-TPC: ${p.order.pnTpc}</span>` : ''}
      `;
      card.appendChild(hd);

      const meta = el('div', 'prop-card-sub');
      meta.textContent = `Window: ${hhmm(p.start)}–${hhmm(p.end)} (${dur} min window, ${p.window.workMin}m physical work) · KM ${p.loKm.toFixed(2)}–${p.hiKm.toFixed(2)}`;
      card.appendChild(meta);

      if (p.order?.text) {
        const pre = el('pre', 'memo');
        pre.style.maxHeight = '140px';
        pre.textContent = p.order.text;
        card.appendChild(pre);

        const copyBtn = el('button', 'btn btn-sh', '⎘ Copy Telegram Order');
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(p.order!.text).then(() => {
            toast('Control Order ' + p.id + ' copied to clipboard');
          });
        };
        copyBtn.style.marginTop = '6px';
        card.appendChild(copyBtn);
      }

      pOrders.body.appendChild(card);
    });
  }
  root.appendChild(pOrders.root);

  // Section 2: Structured Rejection Register
  if (rejected.length) {
    const pRej = panel('STRUCTURED REJECTION & DEFERRAL REGISTER', `${rejected.length} refusals recorded`);
    pRej.root.style.marginBottom = '12px';

    rejected.forEach((p) => {
      const card = el('div', 'prop-card');
      card.style.cssText = 'background:#fff5f5;border:1px solid #fecaca;padding:12px;margin-bottom:8px;';

      const hd = el('div', 'prop-card-hd');
      hd.innerHTML = `
        <span style="color:#ef4444;font-weight:800">▲ REFUSED: ${p.id}</span>
        <span>· Section: <b>${p.section}</b> (${p.lines.join('+')})</span>
        <span class="chip crit" style="margin-left:auto">${p.rejectedFor?.code ?? 'REFUSED'}</span>
      `;
      card.appendChild(hd);

      const body = el('div', 'prop-card-sub');
      body.innerHTML = `
        <div><b>Reason:</b> ${p.rejectedFor?.label ?? 'Operational constraint'}</div>
        <div style="color:#475569;margin-top:2px">${p.rejectedFor?.detail ?? 'No additional remarks'}</div>
        <div style="color:#b45309;margin-top:4px">${p.items.length + p.added.length} demands returned to backlog</div>
      `;
      card.appendChild(body);

      pRej.body.appendChild(card);
    });

    root.appendChild(pRej.root);
  }

  // Section 3: General Shift Event Log
  const pEvents = panel('CRIS OPERATIONAL SHIFT EVENT TIMELINE', `${logEvents.length} events logged`);
  logEvents.slice().reverse().forEach((item) => {
    const row = el('div', 'log-item');
    const dot = el('div', 'log-dot');
    dot.style.background = LOG_COLOR[item.kind] || '#64748b';
    row.appendChild(dot);

    const body = el('div', 'log-body');
    const t = el('div', 'log-t', item.title);
    body.appendChild(t);
    const m = el('div', 'log-m', item.detail);
    body.appendChild(m);
    row.appendChild(body);

    const time = el('div', 'log-time', hhmm(item.at));
    row.appendChild(time);

    pEvents.body.appendChild(row);
  });
  root.appendChild(pEvents.root);
}
