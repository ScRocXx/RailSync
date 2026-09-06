/* ============================================================
   RailSync Type Definitions
   Shape of the bundle emitted by the backend API.
   ============================================================ */

export type Dept = 'TMS' | 'TDMS' | 'SMMS';
export type Band = 'CRITICAL' | 'URGENT' | 'ROUTINE';
export type TrainClass = 'PREMIUM' | 'EXPRESS' | 'SUBURBAN' | 'FREIGHT';
export type Direction = 'UP' | 'DN';
export type BlockStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** [division minute, chainage km] */
export type Pt = [number, number];

export interface Meta {
  division: string; zone: string; date: string;
  generatedAt: string; source: string;
}

export interface Station {
  code: string; name: string; km: number;
  loop: boolean; loopCsr: number; platforms: number;
  sidings: string[]; crossovers: string[];
}

export interface BlockSection {
  id: string; from: string; to: string; km: number; lines: string[];
}

export interface Corridor {
  id: string; name: string; lines: string[];
  maxSpeed: number; lengthKm: number;
  stations: Station[]; sections: BlockSection[];
}

export interface Halt {
  code: string; km: number;
  arr: number; dep: number; arrAct: number; depAct: number;
  act: string; arrStr: string; depStr: string;
}

export interface Train {
  id: string; no: string; name: string;
  kind: 'PASSENGER' | 'FREIGHT';
  cls: TrainClass; rank: number;
  corridor: string; line: string; dir: Direction;
  mps: number; delay: number;
  entry: number; exit: number; avgSpeed: number;
  sched: Pt[]; path: Pt[]; halts: Halt[];
  /* freight only */
  wagons?: number; tonnage?: number; lengthM?: number;
  canLoop?: boolean; criticality?: string;
  origin?: string; dest?: string;
}

export interface ScoreParts {
  condition: number; overdue: number; safety: number; exposure: number;
}

export interface ScoreDriver {
  k: string; v: string;
  part: 'condition' | 'overdue' | 'safety' | 'exposure';
  pts: number;
}

export interface Demand {
  id: string; dept: Dept; deptFull: string;
  corridor: string;
  line: string;
  lines: string[];
  fromKm: number; toKm: number; chainage: string;
  telemetry: string;
  telemetryDetail: [string, string][];
  action: string; overdueDays: number; priority: string;
  score: number; band: Band; parts: ScoreParts;
  trainsOver: number; durationMin: number;
  drivers: ScoreDriver[];
  machineType: string | null;
  station?: string; isolation?: string; isolators?: string[];
  memo?: string; routes?: string[];
}

export interface WindowParts {
  workMin: number;
  protectionMin: number;
  earthingMin: number;
  rampMin: number;
  totalMin: number;
  workStart: number;
}

export interface Savings {
  independentMin: number; bundledMin: number; savedMin: number;
  tasks: number; depts: Dept[];
}

export interface PostTsr {
  speed: number; hours: number; lengthKm: number; normalSpeed: number;
  addedMinPerTrain: number; peakTrains: number; totalAddedMin: number;
}

export interface Regulation {
  rake: string; lengthM: number | null; tonnage: number | null;
  loop: string | null; loopCsr: number | null; fits: boolean;
}

export interface ReasonCode {
  code: string; label: string; detail: string;
}

export interface ProposalItem {
  id: string; dept: Dept; action: string; score: number;
  chainage: string; durationMin: number; band: Band;
  telemetry: string; overdueDays: number;
  drivers: ScoreDriver[];
}

export interface MachineAlloc {
  id: string; type: string; model: string;
  depot: string; from: string; siding: string;
  transitMin: number; rampIn: number; rampOut: number;
  crew: string; dutyHours: number; maxHours: number;
  engagedHours: number;
  crewRelief: boolean;
  crewRemainingHours: number;
  fuel: number; task: string; reportBy: string;
}

export interface ConflictTrain { no: string; name: string; cls: TrainClass; }

export interface Impact {
  paxDelayMin: number; paxAffected: number;
  freightLooped: number; freightIds: string[];
  backlogCleared: number; scoreReleased: number;
  overdueDaysCleared: number;
  conflictTrains: ConflictTrain[];
}

export interface ShadowTask {
  id: string; dept: Dept; score: number; action: string;
  chainage: string; gapKm: number; addMin: number; note: string;
}

export interface Proposal {
  id: string; corridor: string; corridorName: string;
  line: string;
  lines: string[];
  loKm: number; hiKm: number; section: string;
  start: number; end: number; duration: number;
  startStr: string; endStr: string;
  window: WindowParts;
  savings: Savings;
  postTsr: PostTsr | null;
  regulation: Regulation[];
  reasons: ReasonCode[];
  items: ProposalItem[];
  machines: MachineAlloc[];
  plantShortfall: string[];
  isolation: string | null; isolators: string[];
  memo: string | null; routes: string[];
  impact: Impact;
  shadow: ShadowTask[];
  status: BlockStatus;
  score: number;
}

export interface LiveProposal extends Proposal {
  origStart: number;
  added: ShadowTask[];
  order?: ControlOrder;
  rejectedFor?: ReasonCode;
}

export interface ControlOrder {
  pnSm: number; pnTpc: number | null;
  issuedAt: number; text: string;
}

export interface OverrunProjection {
  extraMin: number;
  trains: { no: string; name: string; cls: TrainClass; delayMin: number }[];
  totalDelayMin: number;
  worst: number;
}

export interface Machine {
  id: string; type: string; model: string;
  fitness: string; pohDue: string; iohDue: string;
  depot: string; station: string; siding: string; freeRunout: boolean;
  corridor: string | null; km: number; assigned: string | null;
  tineWear: number; fuel: number;
  crewId: string; dutyHours: number; maxHours: number; rest: string;
  maxSpeed: number; transitSpeed: number; workingSpeed: number;
  rampIn: number; rampOut: number;
}

export interface Tsr {
  no: string; corridor: string; from: string; to: string;
  fromKm: number; toKm: number; line: string;
  speed: number; normal: number; reason: string;
  imposed: string; removal: string; lossMin: number;
}

export interface WeatherHour {
  amb: number; rail: number; dest: number;
  minMax: [number, number];
  buckle: boolean; safeTamp: boolean;
  rain: number; wind: number;
}

export interface CorridorWeather {
  probe: string; station: string;
  curve: number[];
  hours: (WeatherHour | null)[];
}

export interface RailTempReading {
  rail: number; amb: number; dest: number;
  min: number; max: number;
  buckle: boolean; safeTamp: boolean;
  wind: number; rain: number;
  probe: string; station: string;
}

export interface CorridorMetric {
  n: number; ok: number; delay: number; pct: number; avgDelay: number;
}
export interface BacklogMetric { n: number; critical: number; overdue: number; }

export interface Metrics {
  punctuality: number; trainsRun: number; trainsOnTime: number;
  avgDelay: number; maxDelay: number; freightRakes: number;
  byCorridor: Record<string, CorridorMetric>;
  byClass: Record<string, CorridorMetric>;
  backlog: Record<string, BacklogMetric>;
  tsrCount: number; machinesFit: number; machinesTotal: number;
}

export interface Bundle {
  meta: Meta;
  corridors: Corridor[];
  trains: Train[];
  queue: Demand[];
  proposals: Proposal[];
  machines: Machine[];
  tsr: Tsr[];
  weather: Record<string, CorridorWeather>;
  metrics: Metrics;
}

/* ---------------------------------------------------- app state */

export interface Filters {
  dept: Record<Dept, boolean>;
  band: Record<Band, boolean>;
  corridorOnly: boolean;
}

export type LogKind = 'approve' | 'reject' | 'shift' | 'bundle' | 'reopen' | 'system';

export interface LogEntry {
  kind: LogKind; title: string; detail: string;
  ref: string | null; at: number; wall: Date;
}

export type Workspace = 'marey' | 'ctc' | 'planner' | 'fleet' | 'reports' | 'audit';

export interface AppState {
  clock: number;
  wallClock?: string;
  shift?: string;
  playing: boolean;
  speed: number;
  corridor: string;
  zoom: number;
  zoomAt: number;
  filters: Filters;
  selDemand: string | null;
  selProposal: string | null;
  hotTrain: string | null;
  hotBlock: string | null;
  workspace: Workspace;
  panelTab?: 'blocks' | 'feed' | 'audit';
  overrunMin: number;
  proposals: LiveProposal[];
  log: LogEntry[];
}

export interface TrainPosition { km: number; speed: number; moving: boolean; }
export interface RunningTrain { train: Train; pos: TrainPosition; }

export interface WindowScore {
  paxAffected: number; paxDelayMin: number;
  freightLooped: number; freightIds: string[];
  conflictTrains: ConflictTrain[];
}
