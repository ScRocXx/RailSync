/* ============================================================
   RailSync — Main Application Entrypoint
   Delhi Division Operational Section Control Desk
   6 Full-Screen Workspaces · SCADA Palette · URL Hash Sync
   ============================================================ */

import './index.css';
import { store } from './store/useRailSyncStore.ts';
import type { Bundle, Workspace } from './types/index.ts';
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
  setText('s-punct-sub', m.trainsOnTime + '/' + m.trainsRun + ' RT (+ ' + m.avgDelay.toFixed(0) + 'm)');

  const t = railTemp(s.clock, s.corridor);
  if (t) {
    const over = t.rail - t.dest;
    setText('s-temp', t.rail.toFixed(1) + '° / ' + t.dest.toFixed(0) + '°');
    const tn = byId('s-temp');
    if (tn) tn.className = 'stat-v ' + (t.rail > t.max ? 'v-bad' : over > 0 ? 'v-warn' : 'v-good');
    setText('s-temp-sub', 'amb ' + t.amb + '° · ' + (t.safeTamp ? 'Tamp OK' : 'No Tamp') + (t.buckle ? ' · BUCKLE' : ''));
    const chip = byId('tsr-chip');
    if (chip) {
      chip.onmousemove = (e) => { tip(tsrTip(), e as MouseEvent); };
      chip.onmouseleave = tipOff;
      chip.onclick = () => { store.getState().setWorkspace('reports'); };
    }
  }

  const run = runningAt(s.clock, null);
  const pax = run.filter((r) => r.train.kind === 'PASSENGER').length;
  setText('s-running', String(run.length));
  setText('s-running-sub', pax + ' pax · ' + (run.length - pax) + ' goods');

  const approved = s.proposals.filter((p) => p.status === 'APPROVED');
  const cleared = approved.reduce((a, p) => a + p.items.length + p.added.length, 0);
  const crit = data.queue.filter((q) => q.band === 'CRITICAL').length;
  setText('s-backlog', String(data.queue.length - cleared));
  setText('s-backlog-sub', crit + ' crit · ' + cleared + ' done');

  const induced = approved.reduce((a, p) => a + p.impact.paxDelayMin, 0);
  setText('s-approved', approved.length + '/' + s.proposals.length);
  setText('s-approved-sub', induced + 'm delay induced');

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
    '<div class="tt-r" style="margin-top:6px;color:#64748b"><span>Click to open Reports &amp; Charts</span></div>';
}

/* ------------------------------------------------------- wall clock & shift */

function updateWallClock(): void {
  const now = new Date();
  // Format Indian Standard Time (IST)
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  };
  const istTime = now.toLocaleTimeString('en-GB', options) + ' IST';
  const s = store.getState();

  // If simulation is not playing, use formatted current IST clock or division clock
  if (!s.playing) {
    setText('s-clock', istTime);
  } else {
    setText('s-clock', hhmm(s.clock) + ' SIM');
  }

  // Calculate shift
  const hrs = now.getHours();
  let shiftName = 'MORNING 06:00–14:00';
  if (hrs >= 14 && hrs < 22) shiftName = 'EVENING 14:00–22:00';
  else if (hrs >= 22 || hrs < 6) shiftName = 'NIGHT 22:00–06:00';

  setText('s-shift-chip', 'SHIFT: ' + shiftName);
}

/* ------------------------------------------------------- 6 workspaces */

export function renderWorkspace(): void {
  const s = store.getState();
  const ws = s.workspace;

  // Sync navigation bar buttons
  const navBtns = document.querySelectorAll<HTMLElement>('.ws-nav-btn');
  navBtns.forEach((b) => {
    b.classList.toggle('on', b.dataset.ws === ws);
  });

  // Sync workspace pane visibility
  const panes = ['marey', 'ctc', 'planner', 'fleet', 'reports', 'audit'] as Workspace[];
  panes.forEach((w) => {
    const p = byId('ws-' + w);
    if (p) p.classList.toggle('on', w === ws);
  });

  // Render active workspace contents
  switch (ws) {
    case 'marey':
      Marey.render();
      break;
    case 'ctc':
      Schematic.render();
      break;
    case 'planner':
      Queue.renderQueue();
      Queue.renderProposals();
      break;
    case 'fleet':
      Fleet.render();
      break;
    case 'reports':
      Ribbon.renderReports();
      break;
    case 'audit':
      Ribbon.renderLogs();
      break;
  }
}

function bindWorkspaceNav(): void {
  const navBtns = document.querySelectorAll<HTMLElement>('.ws-nav-btn');
  navBtns.forEach((b) => {
    b.addEventListener('click', () => {
      const ws = b.dataset.ws as Workspace;
      if (ws) {
        store.getState().setWorkspace(ws);
      }
    });
  });
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
      store.getState().setClock(450); // 07:30 AM
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

/* ------------------------------------------------------- live SSE stream */

let sseSource: EventSource | null = null;
let reconnectTimeout: number | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 16000;

function connectSSE(): void {
  if (sseSource) {
    try { sseSource.close(); } catch {}
    sseSource = null;
  }

  try {
    sseSource = new EventSource('/api/stream');

    sseSource.onopen = () => {
      reconnectDelay = 1000;
      console.info('[RailSync SSE] Live operational stream connected.');
    };

    sseSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'telemetry_tick') {
          if (typeof payload.clock === 'number' && store.getState().playing) {
            store.getState().setClock(payload.clock);
          }

          // Live Telemetry status chip in header ribbon
          const dot = byId('sim-live-dot');
          const lbl = byId('s-sim-link');
          const chip = byId('scada-telemetry-chip');
          const connSims: Array<{sim_id: string; sim_name: string; tick_count: number; last_message: string; latency_sec: number}> = payload.connected_simulators || [];

          if (payload.telemetry_live && connSims.length > 0) {
            if (dot) dot.className = 'live-dot active';
            if (lbl) {
              lbl.textContent = `${connSims.length}/8 LIVE`;
              lbl.style.color = '#22c55e';
            }
            if (chip) {
              chip.title = 'Active Simulator Pipelines:\n' + connSims.map((c) => `• ${c.sim_name} (tick ${c.tick_count}, ${c.latency_sec}s ago)\n  └─ ${c.last_message}`).join('\n');
            }
          } else {
            if (dot) dot.className = 'live-dot';
            if (lbl) {
              lbl.textContent = 'STANDBY';
              lbl.style.color = '#f59e0b';
            }
            if (chip) {
              chip.title = 'No live terminal simulators detected.\nRun launch_all_simulators.bat to stream live raw telemetry.';
            }
          }
        }
      } catch (e) {
        console.warn('[RailSync SSE] Parse warning:', e);
      }
    };

    sseSource.onerror = () => {
      const dot = byId('sim-live-dot');
      const lbl = byId('s-sim-link');
      if (dot) dot.className = 'live-dot';
      if (lbl) {
        lbl.textContent = 'OFFLINE';
        lbl.style.color = '#ef4444';
      }
      if (sseSource) {
        try { sseSource.close(); } catch {}
        sseSource = null;
      }
      if (reconnectTimeout !== null) clearTimeout(reconnectTimeout);
      reconnectTimeout = window.setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        connectSSE();
      }, reconnectDelay);
    };
  } catch (err) {
    console.warn('[RailSync SSE] EventSource unavailable, running local simulation:', err);
  }
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

  // Setup UI bindings
  Schematic.bindTabs();
  Marey.bindZoom();
  bindWorkspaceNav();
  Queue.buildFilters();
  Queue.bindBurstBuffer();
  Drawer.bind();
  bindClock();
  connectSSE();

  // Wall clock interval (every 1s)
  updateWallClock();
  setInterval(updateWallClock, 1000);

  /* ---- Store Subscriptions ---- */

  // 1. Workspace switching
  store.subscribe((state, prev) => {
    if (state.workspace !== prev.workspace) {
      renderWorkspace();
    }
  });

  // 2. Clock updates
  store.subscribe((state, prev) => {
    if (state.clock !== prev.clock) {
      Marey.updateNeedle();

      if (state.zoom < 24) {
        const span = state.zoom * 60;
        if (state.clock < state.zoomAt || state.clock > state.zoomAt + span) {
          const newAt = Math.max(0, Math.min(DAY - span, state.clock - span / 2));
          store.getState().setZoom(state.zoom, newAt);
          if (state.workspace === 'marey') Marey.render();
        }
      }

      renderBanner();

      if (state.workspace === 'ctc') {
        Schematic.render();
      } else if (state.workspace === 'reports') {
        Ribbon.renderReports();
      }
    }
  });

  // 3. Play/pause toggle
  store.subscribe((state, prev) => {
    if (state.playing !== prev.playing) {
      const play = byId<HTMLButtonElement>('c-play');
      if (play) {
        play.innerHTML = state.playing ? '&#10073;&#10073;' : '&#9654;';
        play.classList.toggle('on', state.playing);
      }
    }
  });

  // 4. Corridor change
  store.subscribe((state, prev) => {
    if (state.corridor !== prev.corridor) {
      renderBanner();
      renderWorkspace();
    }
  });

  // 5. Cursor synchronization (hover sync between Marey and Schematic)
  store.subscribe((state, prev) => {
    if (state.hotTrain !== prev.hotTrain || state.hotBlock !== prev.hotBlock) {
      if (state.workspace === 'marey') {
        // Class toggling is handled natively in DOM for instant performance
      } else if (state.workspace === 'ctc') {
        Schematic.render();
      }
    }
  });

  // 6. Proposal mutations (approved / rejected / shifted)
  store.subscribe((state, prev) => {
    if (state.proposals !== prev.proposals) {
      renderBanner();
      if (state.workspace === 'planner') {
        Queue.renderProposals();
      } else if (state.workspace === 'marey') {
        Marey.render();
      } else if (state.workspace === 'audit') {
        Ribbon.renderLogs();
      }
    }
  });

  // 7. Log additions
  store.subscribe((state, prev) => {
    if (state.log !== prev.log && state.workspace === 'audit') {
      Ribbon.renderLogs();
    }
  });

  // 8. Window resize debouncer
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
  renderWorkspace();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void boot(); });
} else {
  void boot();
}
