import { detectRobotRole, type PickTag } from './roles';
import type { TeamAnalytics } from './types';

export type MatchStrategyMode = 'balanced' | 'synergy' | 'max_score' | 'safe_playoffs';

export interface PartnerReason {
  text: string;
  tone: 'good' | 'warn' | 'info';
}

export interface PartnerRecommendation {
  team: TeamAnalytics;
  compatibilityScore: number;
  tierLabel: 'Match Ideal' | 'Muy Compatible' | 'Buena Opción' | 'Alternativa';
  projectedAllianceNet: number;
  projectedAllianceAuto: number;
  projectedAllianceTele: number;
  projectedSwarmPts: number;
  marginVsRival: number | null;
  hasAutoCollision: boolean;
  breakdown: {
    offense: number;
    synergy: number;
    autoCompat: number;
    reliability: number;
  };
  reasons: PartnerReason[];
}

export const MATCH_STRATEGY_MODES: Record<
  MatchStrategyMode,
  {
    id: MatchStrategyMode;
    label: string;
    description: string;
    weights: { offense: number; synergy: number; autoCompat: number; reliability: number };
  }
> = {
  balanced: {
    id: 'balanced',
    label: 'Balanceado',
    description: 'Equilibrio entre puntaje, cobertura Balancín+Flor, Auto sin choque y confiabilidad.',
    weights: { offense: 0.35, synergy: 0.3, autoCompat: 0.15, reliability: 0.2 },
  },
  synergy: {
    id: 'synergy',
    label: 'Sinergia / Roles',
    description: 'Maximiza complementariedad Balancín + Flor + Garden y evita empalmes en Auto.',
    weights: { offense: 0.2, synergy: 0.45, autoCompat: 0.2, reliability: 0.15 },
  },
  max_score: {
    id: 'max_score',
    label: 'Máx. Puntos',
    description: 'Prioriza potencia ofensiva bruta y techo de puntaje para alianzas de alto score.',
    weights: { offense: 0.55, synergy: 0.2, autoCompat: 0.1, reliability: 0.15 },
  },
  safe_playoffs: {
    id: 'safe_playoffs',
    label: 'Playoffs Seguros',
    description: 'Prioriza confiabilidad mecánica, cero desconexiones y bajas faltas.',
    weights: { offense: 0.25, synergy: 0.2, autoCompat: 0.15, reliability: 0.4 },
  },
};

function clamp100(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(100, val));
}

function minMaxNorm(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return 0;
  if (max <= min) return val > 0 ? 100 : 0;
  return clamp100(((val - min) / (max - min)) * 100);
}

function getEffectiveEpa(t: TeamAnalytics): number {
  return t.timestone?.epaOperational ?? t.epaNetAvg;
}

function hasFlexibleAutoStart(t: TeamAnalytics): boolean {
  if (t.pit?.autoSide === 'Indiferente') return true;
  const significantZones = Object.values(t.positions || {}).filter((p) => p.pct >= 20);
  return significantZones.length >= 2;
}

export function findBestPartners(params: {
  captain: TeamAnalytics;
  allTeams: TeamAnalytics[];
  mode: MatchStrategyMode;
  pickTags?: Record<number, PickTag>;
  excludeDrafted?: boolean;
  excludeAvoid?: boolean;
  excludeTeamIds?: number[];
  rivalProjectedNet?: number | null;
}): PartnerRecommendation[] {
  const {
    captain,
    allTeams,
    mode,
    pickTags = {},
    excludeDrafted = true,
    excludeAvoid = true,
    excludeTeamIds = [],
    rivalProjectedNet = null,
  } = params;

  const excludedSet = new Set<number>([captain.team, ...excludeTeamIds]);
  const weights = MATCH_STRATEGY_MODES[mode].weights;

  const epaVals = allTeams.map(getEffectiveEpa);
  const minEpa = epaVals.length ? Math.min(...epaVals) : 0;
  const maxEpa = epaVals.length ? Math.max(...epaVals) : 1;

  const peakVals = allTeams.map((t) => t.maxNet);
  const minPeak = peakVals.length ? Math.min(...peakVals) : 0;
  const maxPeak = peakVals.length ? Math.max(...peakVals) : 1;

  const autoVals = allTeams.map((t) => t.autoAvg);
  const minAuto = autoVals.length ? Math.min(...autoVals) : 0;
  const maxAuto = autoVals.length ? Math.max(...autoVals) : 1;

  const oprVals = allTeams
    .map((t) => t.timestone?.opr)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  const minOpr = oprVals.length ? Math.min(...oprVals) : 0;
  const maxOpr = oprVals.length ? Math.max(...oprVals) : 1;

  const dprVals = allTeams
    .map((t) => t.timestone?.dpr)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  const minDpr = dprVals.length ? Math.min(...dprVals) : 0;
  const maxDpr = dprVals.length ? Math.max(...dprVals) : 1;

  const capBal = captain.balancinAutoAvg + captain.balancinTeleAvg;
  const capFlor = captain.florAvg;
  const capRole = detectRobotRole(captain).role;
  const capPos = captain.topStartPos && captain.topStartPos !== '—' ? captain.topStartPos : '';

  const recommendations: PartnerRecommendation[] = [];

  for (const cand of allTeams) {
    if (excludedSet.has(cand.team)) continue;
    const tag = pickTags[cand.team] || 'none';
    if (excludeDrafted && tag === 'drafted') continue;
    if (excludeAvoid && tag === 'avoid') continue;

    const candBal = cand.balancinAutoAvg + cand.balancinTeleAvg;
    const candFlor = cand.florAvg;
    const candGar = cand.gardenAvg;
    const candRole = detectRobotRole(cand).role;

    // 1. Offense (0..100) — incorporates OPR when available
    const epaNorm = minMaxNorm(getEffectiveEpa(cand), minEpa, maxEpa);
    const peakNorm = minMaxNorm(cand.maxNet, minPeak, maxPeak);
    const candOpr = cand.timestone?.opr;
    const offense =
      oprVals.length >= 2 && candOpr !== null && candOpr !== undefined && Number.isFinite(candOpr)
        ? clamp100(epaNorm * 0.45 + minMaxNorm(candOpr, minOpr, maxOpr) * 0.35 + peakNorm * 0.2)
        : clamp100(epaNorm * 0.75 + peakNorm * 0.25);

    // 2. BIOBUZZ Synergy (0..100)
    let synergy = 50;
    const coversBal = capBal + candBal >= 2.5;
    const coversFlor = capFlor + candFlor >= 2.0 || captain.flowerControlPct >= 40 || cand.flowerControlPct >= 40;
    if (coversBal && coversFlor) synergy += 25;

    const capNeedsFlor = capFlor < 1.5 && (candFlor >= 2.0 || cand.flowerControlPct >= 50);
    const capNeedsBal = capBal < 2.0 && candBal >= 2.5;
    if (capNeedsFlor || capNeedsBal) synergy += 15;

    let utilityBonus = 0;
    if (candGar >= 2 || cand.gardenDescorePct >= 30) utilityBonus += 5;
    if (cand.bottomNectarPct >= 30 && captain.bottomNectarPct < 30) utilityBonus += 5;
    synergy += Math.min(10, utilityBonus);

    const sameSingleFocusBal =
      capRole === 'BALANCÍN' && candRole === 'BALANCÍN' && capFlor + candFlor < 1.0;
    const sameSingleFocusFlor =
      capRole === 'FLOR' && candRole === 'FLOR' && capBal + candBal < 1.0;
    if (sameSingleFocusBal || sameSingleFocusFlor) synergy -= 15;

    synergy = clamp100(synergy);

    // 3. Auto Compatibility (0..100)
    const candPos = cand.topStartPos && cand.topStartPos !== '—' ? cand.topStartPos : '';
    const hasAutoCollision = Boolean(capPos && candPos && capPos === candPos);
    const flexible = hasFlexibleAutoStart(captain) || hasFlexibleAutoStart(cand);
    const collisionPenalty = hasAutoCollision ? (flexible ? 12 : 35) : 0;

    const projectedSwarmPts = Math.round((captain.swarmPtsAvg + cand.swarmPtsAvg) * 10) / 10;
    const swarmBonus = projectedSwarmPts >= 16 ? 15 : projectedSwarmPts >= 13 ? 7 : 0;
    const candAutoNorm = minMaxNorm(cand.autoAvg, minAuto, maxAuto);
    const autoCompat = clamp100(65 + candAutoNorm * 0.25 + swarmBonus - collisionPenalty);

    // 4. Reliability & Discipline (0..100) — blends low DPR defense when available
    const discipline = clamp100(100 - cand.foulsAvg * 4);
    const driverNorm = clamp100((cand.driverAvg / 5) * 100);
    let reliability = cand.reliabilityPct * 0.65 + discipline * 0.25 + driverNorm * 0.1;
    if (cand.matchesPlayed > 0 && (cand.reliabilityPct < 70 || cand.foulsAvg > 15)) {
      reliability -= 15;
    }
    const candDpr = cand.timestone?.dpr;
    if (
      cand.matchesPlayed > 0 &&
      dprVals.length >= 2 &&
      candDpr !== null &&
      candDpr !== undefined &&
      Number.isFinite(candDpr)
    ) {
      const dprInvNorm = maxDpr > minDpr ? clamp100(((maxDpr - candDpr) / (maxDpr - minDpr)) * 100) : 50;
      reliability = clamp100(reliability * 0.8 + dprInvNorm * 0.2);
    }
    if (cand.matchesPlayed === 0) {
      reliability = 35;
    }
    reliability = clamp100(reliability);

    // Weighted total + slight tie-break for ★ TOP tag
    let total =
      offense * weights.offense +
      synergy * weights.synergy +
      autoCompat * weights.autoCompat +
      reliability * weights.reliability;
    if (tag === 'top') total += 2;
    const compatibilityScore = Math.round(clamp100(total) * 10) / 10;

    const tierLabel: PartnerRecommendation['tierLabel'] =
      compatibilityScore >= 82
        ? 'Match Ideal'
        : compatibilityScore >= 68
          ? 'Muy Compatible'
          : compatibilityScore >= 52
            ? 'Buena Opción'
            : 'Alternativa';

    const projectedAllianceAuto = Math.round((captain.autoAvg + cand.autoAvg) * 10) / 10;
    const projectedAllianceTele = Math.round((captain.teleAvg + cand.teleAvg) * 10) / 10;
    const projectedAllianceNet =
      Math.round(
        (captain.autoAvg + cand.autoAvg + captain.teleAvg + cand.teleAvg - (captain.foulsAvg + cand.foulsAvg)) * 10
      ) / 10;
    const marginVsRival =
      rivalProjectedNet !== null && Number.isFinite(rivalProjectedNet)
        ? Math.round((projectedAllianceNet - rivalProjectedNet) * 10) / 10
        : null;

    // Concise human-readable reasons
    const reasons: PartnerReason[] = [];
    if (cand.matchesPlayed === 0) {
      reasons.push({ text: 'Sin matches aún', tone: 'info' });
    } else {
      if (coversBal && coversFlor) {
        reasons.push({ text: 'Sinergia Balancín + Flor', tone: 'good' });
      } else if (sameSingleFocusBal || sameSingleFocusFlor) {
        reasons.push({ text: `Mismo enfoque (${candRole})`, tone: 'warn' });
      }

      if (hasAutoCollision) {
        reasons.push({
          text: flexible ? `Empalme Auto ${candPos} (flexible)` : `Choque Auto en ${candPos}`,
          tone: 'warn',
        });
      } else if (capPos && candPos) {
        reasons.push({ text: `Sin choque Auto (${capPos} + ${candPos})`, tone: 'good' });
      }

      if (projectedSwarmPts >= 16) {
        reasons.push({ text: `Swarm RP (${projectedSwarmPts.toFixed(1)}/16)`, tone: 'good' });
      }

      if (cand.reliabilityPct >= 90 && cand.foulsAvg <= 10) {
        reasons.push({ text: `${cand.reliabilityPct.toFixed(0)}% Op. • Disciplinado`, tone: 'good' });
      } else if (cand.reliabilityPct < 70 || cand.foulsAvg > 15) {
        reasons.push({
          text: `Riesgo (${cand.reliabilityPct.toFixed(0)}% Op · ${cand.foulsAvg.toFixed(0)} faltas)`,
          tone: 'warn',
        });
      }

      if (
        cand.timestone?.ccwm != null &&
        cand.timestone.ccwm > 0 &&
        ((cand.timestone.rankOff ?? 99) <= 4 || (cand.timestone.rankDef ?? 99) <= 4)
      ) {
        reasons.push({
          text: `OPR ${cand.timestone.opr?.toFixed(1) ?? '—'} · DPR ${cand.timestone.dpr?.toFixed(1) ?? '—'}`,
          tone: 'good',
        });
      }
    }

    if (cand.pit) {
      const pitSnippet = [cand.pit.chassisType, cand.pit.hiveMech].filter(Boolean).slice(0, 2).join(' • ');
      if (pitSnippet) {
        reasons.push({ text: `Pit: ${pitSnippet}`, tone: 'info' });
      }
    }

    recommendations.push({
      team: cand,
      compatibilityScore,
      tierLabel,
      projectedAllianceNet,
      projectedAllianceAuto,
      projectedAllianceTele,
      projectedSwarmPts,
      marginVsRival,
      hasAutoCollision,
      breakdown: {
        offense: Math.round(offense),
        synergy: Math.round(synergy),
        autoCompat: Math.round(autoCompat),
        reliability: Math.round(reliability),
      },
      reasons: reasons.slice(0, 4),
    });
  }

  recommendations.sort(
    (a, b) => b.compatibilityScore - a.compatibilityScore || b.projectedAllianceNet - a.projectedAllianceNet
  );

  return recommendations;
}
