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
}

export interface AnalyticsPayload {
  success: boolean;
  updatedAt: string;
  matchesCount: number;
  teamsCount: number;
  teams: TeamAnalytics[];
  matches: MatchRecord[];
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

