/* ============================================================
   RailSync — Main Application Entrypoint
   Delhi Division Operational Section Control
   ============================================================ */

import './index.css';
import { store } from './store/useRailSyncStore.ts';
import type { Bundle, AppState } from './types/index.ts';
import {
  D, S, DAY, hhmm, pad2, shortCorr, runningAt, railTemp,
  tip, tipOff, tipRows, logEvent, byId, initProposals, setPlaying,
} from './lib/core.ts';
import * as Marey from './components/MareyChart.ts';
import * as Schematic from './components/TrackSchematic.ts';
import * as Queue from './components/BacklogQueue.ts';
import * as Drawer from './components/BlockDrawer.ts';
import * as Ribbon from './components/TelemetryRibbon.ts';
import * as Fleet from './components/FleetTracker.ts';

type ViewName = 'ops' | 'reports' | 'logs';
let currentView: ViewName = 'ops';

function setText(id: string, txt: string): void {
  const n = byId(id);
  if (n) n.textContent = txt;
}

/* ------------------------------------------------------- banner */

function renderBanner(): void {
  const data = D();
  if (!data) return;
  const m = data.metrics;
  const s = store.getState();

  setText('brand-div', data.meta.division + ' Division · ' + data.meta.zone);

  const pu = m.punctuality;
  setText('s-punct', pu.toFixed(1) + '%');
  const pn = byId('s-punct');
  if (pn) pn.className = 'stat-v ' + (pu >= 90 ? 'v-good' : pu >= 75 ? 'v-warn' : 'v-bad');
  setText('s-punct-sub', m.trainsOnTime + '/' + m.trainsRun + ' RT · avg ' + m.avgDelay + ' min');

  setText('s-clock', hhmm(s.clock));

  const t = railTemp(s.clock, s.corridor);
  if (t) {
    const over = t.rail - t.dest;
    setText('s-temp', t.rail.toFixed(1) + '° / ' + t.dest.toFixed(0) + '°');
    const tn = byId('s-temp');
    if (tn) tn.className = 'stat-v ' + (t.rail > t.max ? 'v-bad' : over > 0 ? 'v-warn' : 'v-good');
    setText('s-temp-sub', 'amb ' + t.amb + '° · ' + t.probe + ' · ' +
      (t.safeTamp ? 'tamping OK' : 'OUTSIDE ENVELOPE') + (t.buckle ? ' · BUCKLE' : ''));
    const chip = byId('tsr-chip');
    if (chip) {
      chip.onmousemove = (e) => { tip(tsrTip(), e as MouseEvent); };
      chip.onmouseleave = tipOff;
    }
  }

  const run = runningAt(s.clock, null);
  const pax = run.filter((r) => r.train.kind === 'PASSENGER').length;
  setText('s-running', String(run.length));
  setText('s-running-sub', pax + ' pax · ' + (run.length - pax) + ' freight');

  const approved = s.proposals.filter((p) => p.status === 'APPROVED');
  const cleared = approved.reduce((a, p) => a + p.items.length + p.added.length, 0);
  const crit = data.queue.filter((q) => q.band === 'CRITICAL').length;
  setText('s-backlog', String(data.queue.length - cleared));
  setText('s-backlog-sub', crit + ' critical · ' + cleared + ' cleared');

  const induced = approved.reduce((a, p) => a + p.impact.paxDelayMin, 0);
  setText('s-approved', approved.length + '/' + s.proposals.length);
  setText('s-approved-sub', induced + ' min delay induced');

  setText('s-tsr', String(data.tsr.length));
}

function tsrTip(): string {
  const data = D();
  const rows: [string, string][] = data.tsr.slice(0, 8).map((t) => [
    t.no + '  ' + shortCorr(t.corridor),
    t.from + '–' + t.to + ' · ' + t.speed + '/' + t.normal + ' km/h · ' + t.reason,
  ]);
  return '<div class="tt-h"><span class="swatch" style="background:#ef4444"></span>' +
    data.tsr.length + ' caution orders in force</div>' + tipRows(rows) +
    '<div class="tt-r" style="margin-top:6px;color:#64748b"><span>Click for the full register</span></div>';
}

/* ------------------------------------------------------- workspace */

function moveSchematic(): void {
  const s = store.getState();
  const wrap = byId('net-wrap');
  const target = byId(s.workspace === 'map' ? 'net-wrap-2' : 'net-host-chart');
  if (wrap && target && wrap.parentElement !== target) {
    target.appendChild(wrap);
  }
}

function renderWorkspace(): void {
  const s = store.getState();
  if (s.workspace === 'fleet') {
    Fleet.render();
    return;
  }
  Marey.render();
  Schematic.render();
}

function bindWorkspace(): void {
  const box = byId('ws-tabs');
  if (box) {
    Array.prototype.forEach.call(box.children, (b: HTMLElement) => {
      b.addEventListener('click', () => {
        const ws = b.dataset.ws as AppState['workspace'];
        store.getState().setWorkspace(ws);
        Array.prototype.forEach.call(box.children, (x: HTMLElement) => {
          x.classList.toggle('on', x === b);
        });
        (['chart', 'map', 'fleet'] as AppState['workspace'][]).forEach((w) => {
          const n = byId('ws-' + w);
          if (n) n.classList.toggle('on', w === ws);
        });
        moveSchematic();
        renderWorkspace();
      });
    });
  }

  const pbox = byId('panel-tabs');
  if (pbox) {
    Array.prototype.forEach.call(pbox.children, (b: HTMLElement) => {
      b.addEventListener('click', () => {
        const pt = b.dataset.pt as AppState['panelTab'];
        store.getState().setPanelTab(pt);
        Array.prototype.forEach.call(pbox.children, (x: HTMLElement) => {
          x.classList.toggle('on', x === b);
        });
        (['feed', 'audit'] as AppState['panelTab'][]).forEach((w) => {
          const n = byId('pt-' + w);
          if (n) n.classList.toggle('on', w === pt);
        });
        const qc = byId('q-count'), as = byId('audit-sub');
        if (qc) qc.style.display = pt === 'feed' ? '' : 'none';
        if (as) as.style.display = pt === 'audit' ? '' : 'none';
        if (pt === 'feed') Queue.renderQueue(); else Queue.renderAudit();
      });
    });
  }
}

/* ------------------------------------------------------- clock UI */

function bindClock(): void {
  const play = byId<HTMLButtonElement>('c-play');
  if (play) {
    play.addEventListener('click', () => {
      setPlaying(!store.getState().playing);
    });
  }

  ([['c-x1', 1], ['c-x8', 8], ['c-x60', 60]] as [string, number][]).forEach((b) => {
    const n = byId(b[0]);
    if (!n) return;
    n.addEventListener('click', () => {
      store.getState().setSpeed(b[1]);
      ['c-x1', 'c-x8', 'c-x60'].forEach((id) => {
        const x = byId(id);
        if (x) x.classList.toggle('on', id === b[0]);
      });
      if (store.getState().playing) setPlaying(true);
    });
  });

  const rst = byId('c-rst');
  if (rst) {
    rst.addEventListener('click', () => {
      store.getState().setClock(0);
    });
  }
}

/* ------------------------------------------------------- views */

function renderView(): void {
  const s = store.getState();
  if (currentView === 'ops') {
    renderWorkspace();
    Queue.renderProposals();
    if (s.panelTab === 'feed') Queue.renderQueue(); else Queue.renderAudit();
  } else if (currentView === 'reports') {
    Ribbon.renderReports();
  } else if (currentView === 'logs') {
    Ribbon.renderLogs();
  }
}

function bindViews(): void {
  const btns = document.querySelectorAll<HTMLElement>('.rail-btn');
  btns.forEach((b) => {
    b.addEventListener('click', () => {
      currentView = b.dataset.view as ViewName;
      btns.forEach((x) => {
        x.classList.toggle('on', x === b);
      });
      (['ops', 'reports', 'logs'] as ViewName[]).forEach((v) => {
        const n = byId('view-' + v);
        if (n) n.classList.toggle('on', v === currentView);
      });
      renderView();
    });
  });

  const chip = byId('tsr-chip');
  if (chip) {
    chip.addEventListener('click', () => {
      const b = document.querySelector<HTMLElement>('.rail-btn[data-view="reports"]');
      if (b) b.click();
    });
  }
}

/* ------------------------------------------------------- data loader */

async function loadBundle(): Promise<Bundle> {
  try {
    const res = await fetch('/api/division-state');
    if (res.ok) {
      return await res.json();
    }
  } catch {
    console.warn('API fetch failed, falling back to window.RAILSYNC_DATA...');
  }

  if ((window as unknown as { RAILSYNC_DATA?: Bundle }).RAILSYNC_DATA) {
    return (window as unknown as { RAILSYNC_DATA: Bundle }).RAILSYNC_DATA;
  }

  throw new Error('Neither /api/division-state nor window.RAILSYNC_DATA is available');
}

/* ------------------------------------------------------- boot */

async function boot(): Promise<void> {
  let data: Bundle;
  try {
    data = await loadBundle();
  } catch (err) {
    document.body.innerHTML =
      '<div style="padding:40px;color:#ef4444;font-family:monospace;background:#020617;min-height:100vh">' +
      '<h2>Division Feed Unavailable</h2>' +
      '<p>Could not connect to FastAPI backend at <code>/api/division-state</code> and offline fallback is missing.</p>' +
      '<p>Ensure the backend is running with <code>uvicorn backend.main:app --port 8000</code> or generate data with <code>python build_data.py</code>.</p>' +
      '</div>';
    console.error(err);
    return;
  }

  store.getState().setData(data);
  initProposals();

  // Open on morning peak shift (07:30 AM = 450 min)
  store.getState().setClock(450);

  Schematic.bindTabs();
  Marey.bindZoom();
  bindWorkspace();
  Queue.buildFilters();
  Drawer.bind();
  bindClock();
  bindViews();

  /* ---- Store Subscriptions ---- */

  // 1. Clock updates (lightweight needle + status ribbon, NO full chart wipe)
  store.subscribe((state, prev) => {
    if (state.clock !== prev.clock) {
      // Reposition Marey needle
      Marey.updateNeedle();

      // Keep zoom window centered if following clock
      if (state.zoom < 24) {
        const span = state.zoom * 60;
        if (state.clock < state.zoomAt || state.clock > state.zoomAt + span) {
          const newAt = Math.max(0, Math.min(DAY - span, state.clock - span / 2));
          store.getState().setZoom(state.zoom, newAt);
          Marey.render();
        }
      }

      // Update banner stats
      renderBanner();

      // If in map mode, track schematic reflects live train positions
      if (state.workspace === 'map') {
        Schematic.render();
      }

      // If viewing reports, update punctuality/telemetry
      if (currentView === 'reports') {
        Ribbon.renderReports();
      }
    }
  });

  // 2. Play/pause status
  store.subscribe((state, prev) => {
    if (state.playing !== prev.playing) {
      const play = byId<HTMLButtonElement>('c-play');
      if (play) {
        play.innerHTML = state.playing ? '&#10073;&#10073;' : '&#9654;';
        play.classList.toggle('on', state.playing);
      }
    }
  });

  // 3. Corridor change
  store.subscribe((state, prev) => {
    if (state.corridor !== prev.corridor) {
      renderBanner();
      renderWorkspace();
      if (state.panelTab === 'feed') Queue.renderQueue();
    }
  });

  // 4. Cursor synchronization (hover sync between Marey and Schematic)
  store.subscribe((state, prev) => {
    if (state.hotTrain !== prev.hotTrain || state.hotBlock !== prev.hotBlock) {
      if (state.workspace !== 'fleet') {
        Marey.render();
        Schematic.render();
      }
    }
  });

  // 5. Proposal mutations (approved / rejected)
  store.subscribe((state, prev) => {
    if (state.proposals !== prev.proposals) {
      renderBanner();
      Queue.renderProposals();
      if (state.panelTab === 'audit') Queue.renderAudit();
      if (state.workspace !== 'fleet') {
        Marey.render();
      }
    }
  });

  // 6. Log additions
  store.subscribe((state, prev) => {
    if (state.log !== prev.log && currentView === 'logs') {
      Ribbon.renderLogs();
    }
  });

  // 7. Window resize debouncer
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(renderWorkspace, 120);
  });

  logEvent('system', 'Shift opened — ' + data.meta.division + ' Division',
    data.queue.length + ' demands ingested from TMS / TDMS / SMMS · ' +
    store.getState().proposals.length + ' block proposals generated · ' +
    data.trains.length + ' train paths loaded · ' + data.tsr.length + ' TSR in force.', null);

  renderBanner();
  renderView();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void boot(); });
} else {
  void boot();
}
