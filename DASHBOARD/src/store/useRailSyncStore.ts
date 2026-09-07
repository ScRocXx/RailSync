/* ============================================================
   Zustand Vanilla Store — Reactive state for the dashboard.
   
   Every component subscribes to specific slices via selectors,
   preventing full-component redraws on unrelated state changes
   (e.g. clock tick does NOT re-render the queue table).
   ============================================================ */

import { createStore } from 'zustand/vanilla';
import type {
  AppState, Bundle, LiveProposal, LogEntry, LogKind, Filters, Workspace,
} from '../types/index.ts';

function initialWorkspace(): Workspace {
  if (typeof window === 'undefined') return 'planner';
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  const valid: Workspace[] = ['marey', 'ctc', 'planner', 'fleet', 'reports', 'audit'];
  if (valid.includes(hash as Workspace)) return hash as Workspace;
  if (hash === 'chart') return 'marey';
  if (hash === 'map') return 'ctc';
  if (hash === 'ops') return 'planner';
  if (hash === 'logs') return 'audit';
  return 'planner';
}

/* ---- Store shape: data bundle + mutable app state ---- */

export interface RailSyncState extends AppState {
  /** The immutable data bundle loaded from the API */
  data: Bundle | null;
}

export interface RailSyncActions {
  setData: (d: Bundle) => void;
  setClock: (m: number) => void;
  setWallClock: (s: string) => void;
  setShift: (s: string) => void;
  setPlaying: (on: boolean) => void;
  setSpeed: (s: number) => void;
  setCorridor: (id: string) => void;
  setZoom: (z: number, at: number) => void;
  setFilters: (f: Filters) => void;
  setSelDemand: (id: string | null) => void;
  setSelProposal: (id: string | null) => void;
  setHotTrain: (id: string | null) => void;
  setHotBlock: (id: string | null) => void;
  setWorkspace: (w: Workspace) => void;
  setPanelTab: (t: 'blocks' | 'feed' | 'audit') => void;
  setOverrunMin: (m: number) => void;
  setProposals: (p: LiveProposal[]) => void;
  updateProposal: (id: string, fn: (p: LiveProposal) => LiveProposal) => void;
  addLog: (kind: LogKind, title: string, detail: string, ref: string | null, clock: number) => void;
}

export type RailSyncStore = RailSyncState & RailSyncActions;

const initWs = initialWorkspace();

export const store = createStore<RailSyncStore>()((set) => ({
  /* ---- data ---- */
  data: null,

  /* ---- app state defaults ---- */
  clock: 450,
  wallClock: '07:30:00 IST',
  shift: 'MORNING 06:00–14:00',
  playing: false,
  speed: 1,
  corridor: '',
  zoom: 8,
  zoomAt: 210,
  filters: {
    dept: { TMS: true, TDMS: true, SMMS: true },
    band: { CRITICAL: true, URGENT: true, ROUTINE: true },
    corridorOnly: false,
  },
  selDemand: null,
  selProposal: null,
  hotTrain: null,
  hotBlock: null,
  workspace: initWs,
  panelTab: 'blocks',
  overrunMin: 0,
  proposals: [],
  log: [],

  /* ---- actions ---- */
  setData: (d) => set({ data: d, corridor: d.corridors[0]?.id ?? '' }),
  setClock: (m) => set({ clock: m }),
  setWallClock: (wc) => set({ wallClock: wc }),
  setShift: (sh) => set({ shift: sh }),
  setPlaying: (on) => set({ playing: on }),
  setSpeed: (s) => set({ speed: s }),
  setCorridor: (id) => set({ corridor: id, selDemand: null }),
  setZoom: (z, at) => set({ zoom: z, zoomAt: at }),
  setFilters: (f) => set({ filters: f }),
  setSelDemand: (id) => set((s) => ({ selDemand: s.selDemand === id ? null : id })),
  setSelProposal: (id) => set({ selProposal: id }),
  setHotTrain: (id) => set({ hotTrain: id }),
  setHotBlock: (id) => set({ hotBlock: id }),
  setWorkspace: (w) => {
    try {
      if (window.location.hash !== '#' + w) {
        window.location.hash = '#' + w;
      }
    } catch {}
    set({ workspace: w });
  },
  setPanelTab: (t) => set({ panelTab: t }),
  setOverrunMin: (m) => set({ overrunMin: m }),
  setProposals: (p) => set({ proposals: p }),
  updateProposal: (id, fn) => set((s) => ({
    proposals: s.proposals.map((p) => p.id === id ? fn(p) : p),
  })),
  addLog: (kind, title, detail, ref, clock) => set((s) => ({
    log: [
      { kind, title, detail, ref, at: clock, wall: new Date() } as LogEntry,
      ...s.log,
    ],
  })),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const ws = initialWorkspace();
    if (store.getState().workspace !== ws) {
      store.getState().setWorkspace(ws);
    }
  });
}

/* ---- Granular selectors for performance ---- */

export const selectData = (s: RailSyncStore) => s.data;
export const selectClock = (s: RailSyncStore) => s.clock;
export const selectCorridor = (s: RailSyncStore) => s.corridor;
export const selectZoom = (s: RailSyncStore) => ({ zoom: s.zoom, zoomAt: s.zoomAt });
export const selectHotTrain = (s: RailSyncStore) => s.hotTrain;
export const selectHotBlock = (s: RailSyncStore) => s.hotBlock;
export const selectSelProposal = (s: RailSyncStore) => s.selProposal;
export const selectWorkspace = (s: RailSyncStore) => s.workspace;
export const selectFilters = (s: RailSyncStore) => s.filters;
export const selectProposals = (s: RailSyncStore) => s.proposals;
export const selectLog = (s: RailSyncStore) => s.log;
