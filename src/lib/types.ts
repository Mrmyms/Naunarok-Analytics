export interface MatchRecord {
  id: number;
  timestamp: string;
  match: number;
  team: number;
  alliance: 'AZUL' | 'ROJO';
  scouter: string;
  startPos: string;
  autoLeave: boolean;
  autoPark: boolean;
  autoHivePollen: number;
  autoHiveNectar: number;
  autoFlowerPollen: number;
  autoFlowerNectar: number;
  teleopHivePollen: number;
  teleopHiveNectar: number;
  flowerOwnership: string;
  flowerOwnedCount: number;
  teleopFlowerPollen: number;
  teleopFlowerNectar: number;
  bottomNectar: boolean;
  gardenElements: number;
  gardenDescore: boolean;
  teleopPark: boolean;
  status: string;
  minorFouls: number;
  majorFouls: number;
  cards: string;
  driverSkill: number;
  notes: string;
  autoScore: number;
  teleScore: number;
  foulsScore: number;
  netScore: number;
}

export interface TimestoneTeamMetric {
  rankEpa: number;
  team: number;
  name: string;
  matches: number;
  epa: number;
  epaOperational: number;
  scoreEst: number;
  autoEst: number;
  teleEst: number;
  endEst: number;
  foulsEst: number;
  tipsEst: number;
  canTopNectar: boolean;
  floresTop: number;
  piezasFlor: number;
  reliabilityPct: number;
  excludedOldFailures: number;
  posEstimada: string;
  opr?: number | null;
  dpr?: number | null;
  ccwm?: number | null;
  rankOff?: number | null;
  rankDef?: number | null;
  rankCombAvg?: number | null;
}

export interface TimestoneMatchSim {
  evento: string;
  nivel: string;
  match: number;
  jugado: boolean;
  red1: number;
  red2: number;
  blue1: number;
  blue2: number;
  redEst: number;
  blueEst: number;
  redWinPct: number;
  blueWinPct: number;
  tiePct: number;
  ganadorEst: string;
  redFloresTap: number;
  blueFloresTap: number;
  redAutoConflict: boolean;
  blueAutoConflict: boolean;
  redRpsEst: number;
  blueRpsEst: number;
  redReal: number | null;
  blueReal: number | null;
}

export interface TimestoneStandingRow {
  rankProyectado: number;
  team: number;
  name: string;
  pjJugados: number;
  pjRestantes: number;
  pjSim: number;
  rpsReales: number;
  rpsTotales: number;
  rpPromedio: number;
  scoreAcumulado: number;
  scorePromedio: number;
  rankMin: number;
  rankMax: number;
  probTop4Pct: number;
}

export interface TimestonePayload {
  available: boolean;
  eventCode: string;
  availableEvents: string[];
  updatedAt: string | null;
  isStale: boolean;
  ageMinutes: number | null;
  teams: TimestoneTeamMetric[];
  matches: TimestoneMatchSim[];
  standings: TimestoneStandingRow[];
}

export interface PitPhotoMeta {
  photoId: string;
  fileName: string;
  mimeType: string;
  caption: string;
  sizeBytes: number;
  timestamp: string;
}

export interface PitProfile {
  timestamp: string;
  team: number;
  teamName: string;
  scouter: string;
  chassisType: string;
  weightLb: number | null;
  intakeType: string;
  capacity: string;
  hiveMech: string;
  flowerMech: string;
  autoRoutines: string[];
  autoSide: string;
  sensorsVision: string[];
  claimedAutoPoints: number;
  driverHours: string;
  preferredRole: string;
  notes: string;
  photos: PitPhotoMeta[];
}

export interface TeamAnalytics {
  rank: number;
  team: number;
  matchesPlayed: number;
  epaNetAvg: number;
  autoAvg: number;
  teleAvg: number;
  balancinAutoAvg: number;
  balancinTeleAvg: number;
  florAvg: number;
  gardenAvg: number;
  flowerControlPct: number;
  flowersOwnedAvg: number;
  reliabilityPct: number;
  foulsAvg: number;
  driverAvg: number;
  // Detailed distributions & history from Captura_BIOBUZZ
  maxNet: number;
  minNet: number;
  maxAuto: number;
  minAuto: number;
  maxTele: number;
  minTele: number;
  autoHivePollenAvg: number;
  autoHiveNectarAvg: number;
  autoFlowerPollenAvg: number;
  autoFlowerNectarAvg: number;
  teleHivePollenAvg: number;
  teleHiveNectarAvg: number;
  teleFlowerPollenAvg: number;
  teleFlowerNectarAvg: number;
  autoLeavePct: number;
  autoParkPct: number;
  endgameParkPct: number;
  bottomNectarPct: number;
  gardenDescorePct: number;
  swarmPtsAvg: number;
  topStartPos: string;
  positions: Record<string, { count: number; pct: number }>;
  sidePositions?: Record<string, { count: number; pct: number }>;
  notes: { match: number; scouter: string; alliance: string; note: string; status: string }[];
  history: MatchRecord[];
  timestone?: TimestoneTeamMetric;
  pit?: PitProfile;
}

export interface AnalyticsPayload {
  success: boolean;
  updatedAt: string;
  matchesCount: number;
  teamsCount: number;
  pitCount?: number;
  teams: TeamAnalytics[];
  matches: MatchRecord[];
  timestone?: TimestonePayload;
  error?: string;
}

export interface ScheduleTeam {
  teamNumber: number;
  alliance: 'Red' | 'Blue';
  station: 'One' | 'Two';
}

export interface ScheduleMatch {
  id: number;
  matchNum: number;
  tournamentLevel: string;
  teams: ScheduleTeam[];
}

