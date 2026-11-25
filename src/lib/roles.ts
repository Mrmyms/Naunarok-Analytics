import type { TeamAnalytics } from './types';

export type RobotRole = 'BALANCÍN' | 'FLOR' | 'HÍBRIDO' | 'GARDEN' | 'BASE';
export type PickTag = 'none' | 'top' | 'pick' | 'avoid' | 'drafted';
export type ScoringProfileId = 'balanced' | 'offensive' | 'defensive' | 'playoffs';
export type TierGrade = 'S' | 'A' | 'B' | 'C';

export interface ScoringWeights {
  offensive: number;
  defensive: number;
  auto: number;
  reliability: number;
  discipline: number;
  driver: number;
}

export const SCORING_PROFILES: Record<
  ScoringProfileId,
  { id: ScoringProfileId; label: string; shortLabel: string; description: string; weights: ScoringWeights }
> = {
  balanced: {
    id: 'balanced',
    label: 'Balanceado',
    shortLabel: 'Balanceado',
    description: 'Equilibrio entre ofensiva, defensa (DPR), auto, confiabilidad y disciplina.',
    weights: { offensive: 0.30, defensive: 0.20, auto: 0.15, reliability: 0.20, discipline: 0.10, driver: 0.05 },
  },
  offensive: {
    id: 'offensive',
    label: 'Máx. Ofensiva',
    shortLabel: 'Ofensivo',
    description: 'Prioriza capacidad anotadora (EPA/OPR), autónomo y habilidad de piloto.',
    weights: { offensive: 0.50, defensive: 0.0, auto: 0.25, reliability: 0.15, discipline: 0.0, driver: 0.10 },
  },
  defensive: {
    id: 'defensive',
    label: 'Defensivo',
    shortLabel: 'Defensivo',
    description: 'Prioriza DPR bajo (menos puntos permitidos), descore en Garden, confiabilidad y disciplina.',
    weights: { offensive: 0.15, defensive: 0.45, auto: 0.0, reliability: 0.25, discipline: 0.15, driver: 0.0 },
  },
  playoffs: {
    id: 'playoffs',
    label: 'Playoffs / Confiable',
    shortLabel: 'Playoffs',
    description: 'Minimiza riesgo de desconexiones y faltas manteniendo buen aporte ofensivo.',
    weights: { offensive: 0.25, defensive: 0.10, auto: 0.10, reliability: 0.35, discipline: 0.20, driver: 0.0 },
  },
};

export interface TeamClassification {
  score: number;
  tier: TierGrade;
  tierColor: string;
  tierBg: string;
  breakdown: {
    offensive: number;
    defensive: number;
    auto: number;
    reliability: number;
    discipline: number;
    driver: number;
  };
}

function clamp100(val: number): number {
  return Math.max(0, Math.min(100, val));
}

function minMaxNormalize(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return 0;
  if (max <= min) return val > 0 ? 100 : 0;
  return clamp100(((val - min) / (max - min)) * 100);
}

export function computeTeamClassification(
  team: TeamAnalytics,
  allTeams: TeamAnalytics[],
  profileId: ScoringProfileId = 'balanced'
): TeamClassification {
  const weights = SCORING_PROFILES[profileId].weights;

  const epas = allTeams.map((t) => t.epaNetAvg);
  const minEpa = epas.length ? Math.min(...epas) : 0;
  const maxEpa = epas.length ? Math.max(...epas) : 1;
  const epaNorm = minMaxNormalize(team.epaNetAvg, minEpa, maxEpa);

  const oprVals = allTeams
    .map((t) => t.timestone?.opr)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  const teamOpr = team.timestone?.opr;
  let offensive = epaNorm;
  if (teamOpr !== null && teamOpr !== undefined && oprVals.length >= 2) {
    const oprNorm = minMaxNormalize(teamOpr, Math.min(...oprVals), Math.max(...oprVals));
    offensive = epaNorm * 0.5 + oprNorm * 0.5;
  }

  const discipline = clamp100(100 - team.foulsAvg * 4);
  const dprVals = allTeams
    .map((t) => t.timestone?.dpr)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  const teamDpr = team.timestone?.dpr;
  let defensive = clamp100(team.gardenDescorePct) * 0.5 + discipline * 0.5;
  if (teamDpr !== null && teamDpr !== undefined && dprVals.length >= 2) {
    const minDpr = Math.min(...dprVals);
    const maxDpr = Math.max(...dprVals);
    // Menor DPR = mejor defensa
    const dprInvNorm = maxDpr > minDpr ? clamp100(((maxDpr - teamDpr) / (maxDpr - minDpr)) * 100) : 50;
    defensive = dprInvNorm * 0.7 + clamp100(team.gardenDescorePct) * 0.3;
  }

  const autos = allTeams.map((t) => t.autoAvg);
  const auto = minMaxNormalize(
    team.autoAvg,
    autos.length ? Math.min(...autos) : 0,
    autos.length ? Math.max(...autos) : 1
  );

  const reliability = clamp100(team.reliabilityPct);
  const driver = clamp100((team.driverAvg / 5) * 100);

  const rawScore =
    offensive * weights.offensive +
    defensive * weights.defensive +
    auto * weights.auto +
    reliability * weights.reliability +
    discipline * weights.discipline +
    driver * weights.driver;

  const score = Math.round(clamp100(rawScore) * 10) / 10;

  let tier: TierGrade = 'C';
  let tierColor = '#94A3B8';
  let tierBg = 'rgba(148, 163, 184, 0.14)';

  if (score >= 80) {
    tier = 'S';
    tierColor = '#FFD166';
    tierBg = 'rgba(255, 209, 102, 0.18)';
  } else if (score >= 65) {
    tier = 'A';
    tierColor = '#A855F7';
    tierBg = 'rgba(168, 85, 247, 0.2)';
  } else if (score >= 48) {
    tier = 'B';
    tierColor = '#38BDF8';
    tierBg = 'rgba(56, 189, 248, 0.16)';
  }

  return {
    score,
    tier,
    tierColor,
    tierBg,
    breakdown: {
      offensive: Math.round(offensive),
      defensive: Math.round(defensive),
      auto: Math.round(auto),
      reliability: Math.round(reliability),
      discipline: Math.round(discipline),
      driver: Math.round(driver),
    },
  };
}

export function detectRobotRole(t: TeamAnalytics): {
  role: RobotRole;
  color: string;
  bg: string;
} {
  const bal = t.balancinAutoAvg + t.balancinTeleAvg;
  const flor = t.florAvg;
  const gar = t.gardenAvg;

  if (bal === 0 && flor === 0 && gar === 0) {
    return { role: 'BASE', color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.14)' };
  }
  if (gar > bal + flor && gar >= 2) {
    return { role: 'GARDEN', color: '#34D399', bg: 'rgba(16, 185, 129, 0.16)' };
  }
  if (bal >= 1 && flor >= 1 && Math.abs(bal - flor) <= Math.max(bal, flor) * 0.35) {
    return { role: 'HÍBRIDO', color: '#A855F7', bg: 'rgba(168, 85, 247, 0.18)' };
  }
  if (bal >= flor) {
    return { role: 'BALANCÍN', color: '#60A5FA', bg: 'rgba(59, 130, 246, 0.16)' };
  }
  return { role: 'FLOR', color: '#F87171', bg: 'rgba(225, 29, 72, 0.16)' };
}

export const PICK_TAG_META: Record<PickTag, { label: string; color: string; border: string; bg: string }> = {
  none: { label: '—', color: '#94A3B8', border: '#23283D', bg: 'transparent' },
  top: { label: '★ TOP', color: '#FFD166', border: '#FFD166', bg: 'rgba(255, 209, 102, 0.16)' },
  pick: { label: '✓ PICK', color: '#10B981', border: '#10B981', bg: 'rgba(16, 185, 129, 0.16)' },
  avoid: { label: '✕ EVITAR', color: '#FCA5A5', border: '#DC2626', bg: 'rgba(220, 38, 38, 0.18)' },
  drafted: { label: 'DRAFTED', color: '#94A3B8', border: '#343B59', bg: 'rgba(52, 59, 89, 0.25)' },
};

export const NEXT_PICK_TAG: Record<PickTag, PickTag> = {
  none: 'top',
  top: 'pick',
  pick: 'avoid',
  avoid: 'drafted',
  drafted: 'none',
};
