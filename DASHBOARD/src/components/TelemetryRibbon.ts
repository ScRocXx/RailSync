/* ============================================================
   TelemetryRibbon — Reports & Analytics + Logs & History
   ============================================================ */

import { store } from '../store/useRailSyncStore.ts';
import {
  D, S, hhmm, shortCorr, esc, scoreColor, CLS_COLOR, railTemp, pad2,
  byId, clear, el,
} from '../lib/core.ts';
import type { TrainClass, LogKind } from '../types/index.ts';

const CORR_LABEL: Record<string, string> = {
  CORR_NORTH: 'North · DLI–PNP', CORR_EAST: 'East · GZB–MTC',
  CORR_SOUTH: 'South · NZM–PWL', CORR_WEST: 'West · DLI–ROK',
};
const DEPT_LABEL: Record<string, string> = {
  TMS: 'TMS · P-Way', TDMS: 'TDMS · TRD', SMMS: 'SMMS · S&T',
};
const DEPT_COLOR: Record<string, string> = {
  TMS: '#f59e0b', TDMS: '#3b82f6', SMMS: '#8b5cf6',
};

interface Panel { root: HTMLElement; body: HTMLElement; }

function panel(title: string, sub?: string): Panel {
  const root = el('div', 'panel');
  const h = el('div', 'panel-hd');
  h.appendChild(el('h2', null, title));
  if (sub) h.appendChild(el('span', 'sub', sub));
  root.appendChild(h);
  const body = el('div', 'panel-bd');
  root.appendChild(body);
  return { root, body };
}

function bar(label: string, pct: number, valTxt: string, color: string): HTMLElement {
  const r = el('div', 'bar-row');
  r.appendChild(el('div', 'lbl', label));
  const tr = el('div', 'track');
  const f = el('div', 'fill');
  f.style.width = Math.max(0, Math.min(100, pct)) + '%';
  f.style.background = color;
  tr.appendChild(f);
  r.appendChild(tr);
  r.appendChild(el('div', 'val', valTxt));
  return r;
}

function punctColor(p: number): string {
  return p >= 90 ? '#22c55e' : p >= 75 ? '#f59e0b' : '#ef4444';
}

/* ---- Reports ---- */

export function renderReports(): void {
  const g = byId('rep-grid');
  if (!g) return;
  clear(g);
  const s = store.getState();
  const m = D().metrics;

  /* Headline punctuality */
  const p1 = panel('Division Punctuality Index', 'on-time = within 15 min');
  p1.root.classList.add('span2');
  const box = el('div');
  box.style.padding = '12px';
  const big = el('div', 'mono', m.punctuality.toFixed(1) + '%');
  big.style.cssText = 'font-size:44px;font-weight:700;line-height:1;color:' + punctColor(m.punctuality);
  box.appendChild(big);
  const sub = el('div', 'mini-note',
    m.trainsOnTime + ' of ' + m.trainsRun + ' passenger trains right time · avg delay ' +
    m.avgDelay + ' min · worst ' + m.maxDelay + ' min · ' + m.freightRakes + ' freight rakes handled');
  sub.style.padding = '6px 0 12px';
  box.appendChild(sub);
  Object.keys(m.byCorridor).forEach((c) => {
    const v = m.byCorridor[c];
    box.appendChild(bar(CORR_LABEL[c] || c, v.pct, v.pct.toFixed(1) + '%', punctColor(v.pct)));
  });
  p1.body.appendChild(box);
  g.appendChild(p1.root);

  /* By class */
  const p2 = panel('Punctuality by Train Class', 'COA / RTIS actuals');
  p2.root.classList.add('span2');
  const b2 = el('div');
  b2.style.padding = '12px';
  Object.keys(m.byClass).forEach((k) => {
    const v = m.byClass[k];
    b2.appendChild(bar(k.charAt(0) + k.slice(1).toLowerCase() + ' (' + v.n + ')',
      v.pct, v.pct.toFixed(1) + '%', CLS_COLOR[k as TrainClass] || '#3b82f6'));
  });
  p2.body.appendChild(b2);
  g.appendChild(p2.root);

  /* Rail temperature */
  const p3 = panel('Sectional Rail Temperature', 'CRT probes · rail temp vs de-stressing td');
  p3.root.classList.add('span2');
  const b3 = el('div');
  b3.style.padding = '8px 12px 12px';
  D().corridors.forEach((c) => {
    const t = railTemp(s.clock, c.id);
    if (!t) return;
    const row = el('div');
    row.style.cssText = 'padding:7px 0;border-bottom:1px solid var(--line-soft)';
    const top = el('div');
    top.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline';
    top.appendChild(el('span', null, CORR_LABEL[c.id] || c.id));
    const over = t.rail - t.dest;
    const v = el('span', 'mono', t.rail.toFixed(1) + '°C');
    v.style.cssText = 'font-size:15px;font-weight:700;color:' +
      (t.rail > t.max ? '#ef4444' : over > 0 ? '#f59e0b' : '#22c55e');
    top.appendChild(v);
    row.appendChild(top);
    const det = el('div', 'mini-note',
      'probe ' + t.probe + ' @ ' + t.station + ' · ambient ' + t.amb + '°C · td ' + t.dest + '°C · ' +
      (over > 0 ? '+' + over.toFixed(1) + '°C above de-stressing' : over.toFixed(1) + '°C below de-stressing') +
      ' · envelope ' + t.min + '–' + t.max + '°C · ' +
      (t.safeTamp ? 'safe to tamp' : 'OUTSIDE TAMPING ENVELOPE') +
      (t.buckle ? ' · BUCKLING WATCH' : ''));
    det.style.padding = '3px 0 0';
    row.appendChild(det);
    b3.appendChild(row);
  });
  p3.body.appendChild(b3);
  g.appendChild(p3.root);

  /* Backlog */
  const p4 = panel('Departmental Backlog', 'demands awaiting a block');
  p4.root.classList.add('span2');
  const b4 = el('div');
  b4.style.padding = '12px';
  const maxN = Math.max(...Object.keys(m.backlog).map((k) => m.backlog[k].n));
  Object.keys(m.backlog).forEach((k) => {
    const v = m.backlog[k];
    b4.appendChild(bar(DEPT_LABEL[k] || k, 100 * v.n / maxN,
      v.n + ' (' + v.critical + ' crit)', DEPT_COLOR[k]));
  });
  p4.body.appendChild(b4);
  g.appendChild(p4.root);

  /* TSR register */
  const p5 = panel('Active TSR / Caution Orders', D().tsr.length + ' in force');
  p5.root.classList.add('span4');
  const tb = el('table', 'grid');
  tb.innerHTML = '<thead><tr><th>Caution order</th><th>Corridor</th><th>Section</th>' +
    '<th>Chainage</th><th>Line</th><th>Restriction</th><th>Reason</th>' +
    '<th>Imposed</th><th>Est. removal</th><th style="text-align:right">Loss/train</th></tr></thead>';
  const tbody = el('tbody');
  D().tsr.forEach((t) => {
    const tr = el('tr');
    tr.appendChild(el('td', 'mono', t.no));
    tr.appendChild(el('td', null, shortCorr(t.corridor)));
    tr.appendChild(el('td', null, t.from + ' – ' + t.to));
    tr.appendChild(el('td', 'mono', 'KM ' + t.fromKm.toFixed(2) + '–' + t.toKm.toFixed(2)));
    tr.appendChild(el('td', 'mono', t.line));
    const sp = el('td');
    sp.appendChild(el('span', 'chip ' + (t.speed <= 30 ? 'crit' : t.speed <= 60 ? 'urg' : 'rout'),
      t.speed + ' / ' + t.normal + ' km/h'));
    tr.appendChild(sp);
    tr.appendChild(el('td', null, t.reason));
    tr.appendChild(el('td', 'mono', t.imposed));
    tr.appendChild(el('td', 'mono', t.removal));
    const l = el('td', 'mono', '+' + t.lossMin.toFixed(1) + ' min');
    l.style.textAlign = 'right';
    tr.appendChild(l);
    tbody.appendChild(tr);
  });
  tb.appendChild(tbody);
  p5.body.appendChild(tb);
  g.appendChild(p5.root);
}

/* ---- Logs ---- */

const LOG_COLOR: Record<LogKind, string> = {
  approve: '#22c55e', reject: '#ef4444', shift: '#f59e0b',
  bundle: '#8b5cf6', reopen: '#3b82f6', system: '#64748b',
};

export function renderLogs(): void {
  const root = byId('log-root');
  if (!root) return;
  clear(root);

  const s = store.getState();
  const hd = el('div', 'panel-hd');
  hd.appendChild(el('h2', null, 'Decision Log & History'));
  hd.appendChild(el('span', 'sub', s.log.length + ' entries this shift'));
  root.appendChild(hd);

  if (!s.log.length) {
    root.appendChild(el('div', 'empty',
      'No controller decisions yet. Approve, reject, shift or bundle a block.'));
    return;
  }

  s.log.forEach((L) => {
    const it = el('div', 'log-item');
    const dot = el('div', 'log-dot');
    dot.style.background = LOG_COLOR[L.kind] || LOG_COLOR.system;
    it.appendChild(dot);
    const b = el('div', 'log-body');
    const t = el('div', 'log-t');
    t.appendChild(el('b', null, L.title));
    b.appendChild(t);
    b.appendChild(el('div', 'log-m', L.detail));
    if (L.ref) {
      const p = s.proposals.filter((x) => x.id === L.ref)[0];
      if (p && p.order && L.kind === 'approve') {
        b.appendChild(el('div', 'log-m',
          'Private Number: SM ' + p.order.pnSm +
          (p.order.pnTpc !== null ? ' / TPC ' + p.order.pnTpc : '') +
          ' · issued ' + hhmm(p.order.issuedAt)));
      }
    }
    it.appendChild(b);
    it.appendChild(el('div', 'log-time', hhmm(L.at)));
    if (L.ref) {
      it.style.cursor = 'pointer';
      it.addEventListener('click', () => { store.getState().setSelProposal(L.ref!); });
    }
    root.appendChild(it);
  });
}
