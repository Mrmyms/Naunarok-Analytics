import { NextResponse } from 'next/server';
import {
  fetchAnalyticsSheets,
  fetchPitScoutingData,
  fetchTimestoneSheets,
} from '@/lib/googleSheets';
import { computeOprDprFromMatches } from '@/lib/opr';
import type {
  MatchRecord,
  PitPhotoMeta,
  PitProfile,
  TeamAnalytics,
  TimestoneMatchSim,
  TimestonePayload,
  TimestoneStandingRow,
  TimestoneTeamMetric,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

function toNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const parsed = Number(String(v ?? '').replace('%', '').trim());
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toPct(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) {
    // Google Sheets stores percentages as decimals (0..1) under UNFORMATTED_VALUE
    return v <= 1.0001 ? Math.round(v * 1000) / 10 : Math.round(v * 10) / 10;
  }
  const str = String(v ?? '').trim();
  const parsed = Number(str.replace('%', ''));
  if (Number.isNaN(parsed)) return 0;
  return str.includes('%') || parsed > 1 ? Math.round(parsed * 10) / 10 : Math.round(parsed * 1000) / 10;
}

function toBool(v: unknown): boolean {
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'SI' || s === 'SÍ' || s === 'TRUE' || s === '1';
}

function parseFlowerOwnedCount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.max(0, Math.min(4, Math.round(v)));
  }
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const upper = s.toUpperCase();
  if (upper === 'CONTROLÓ FLOR' || upper === 'CONTROLO FLOR' || upper === 'SI' || upper === 'SÍ' || upper === 'TRUE') {
    return 1;
  }
  if (upper === 'NINGUNA' || upper === 'PERDIÓ CONTROL' || upper === 'PERDIO CONTROL' || upper === 'NO COMPITIÓ' || upper === 'NO COMPITIO' || upper === 'NO') {
    return 0;
  }
  const match = s.match(/^(\d+)/);
  if (match) {
    return Math.max(0, Math.min(4, Number(match[1])));
  }
  return 0;
}

function formatSerialDate(v: unknown): string {
  if (typeof v === 'number' && v > 25000) {
    // Convert Google Sheets serial number (days since 1899-12-30) to readable string
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('es-MX', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }
  return String(v ?? '');
}

function parseUpdatedAtIso(v: unknown): string | null {
  if (typeof v === 'number' && v > 25000) {
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(v ?? '').trim();
  if (!s) return null;
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function buildHeaderIndex(headerRow: unknown[] | undefined): Record<string, number> {
  const map: Record<string, number> = {};
  if (!headerRow) return map;
  headerRow.forEach((cell, idx) => {
    const key = String(cell ?? '').trim();
    if (key) map[key] = idx;
  });
  return map;
}

function parseTimestonePayload(raw: {
  eventCode: string;
  availableEvents: string[];
  rankingRows: unknown[][];
  simMatchRows: unknown[][];
  standingsRows: unknown[][];
}): TimestonePayload {
  const rankHdr = buildHeaderIndex(raw.rankingRows[0]);
  const matchHdr = buildHeaderIndex(raw.simMatchRows[0]);
  const standHdr = buildHeaderIndex(raw.standingsRows[0]);

  const cell = (row: unknown[], hdr: Record<string, number>, col: string): unknown => {
    const idx = hdr[col];
    return idx === undefined ? undefined : row[idx];
  };

  const toOptNum = (v: unknown): number | null => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(String(v).replace('%', '').trim());
    return Number.isFinite(n) ? n : null;
  };

  let updatedAt: string | null = null;

  const teams: TimestoneTeamMetric[] = raw.rankingRows
    .slice(1)
    .map((r): TimestoneTeamMetric | null => {
      const team = toNum(cell(r, rankHdr, 'Team ID'), 0);
      if (!team) return null;
      if (!updatedAt) {
        updatedAt = parseUpdatedAtIso(cell(r, rankHdr, 'Updated_At'));
      }
      return {
        rankEpa: toNum(cell(r, rankHdr, 'Rank_EPA'), 0),
        team,
        name: String(cell(r, rankHdr, 'Nombre') ?? `Equipo ${team}`),
        matches: toNum(cell(r, rankHdr, 'Matches'), 0),
        epa: toNum(cell(r, rankHdr, 'EPA'), 0),
        epaOperational: toNum(cell(r, rankHdr, 'EPA_Operativo'), toNum(cell(r, rankHdr, 'EPA'), 0)),
        scoreEst: toNum(cell(r, rankHdr, 'Score Est'), 0),
        autoEst: toNum(cell(r, rankHdr, 'Auto Est'), 0),
        teleEst: toNum(cell(r, rankHdr, 'Tele Est'), 0),
        endEst: toNum(cell(r, rankHdr, 'End Est'), 0),
        foulsEst: toNum(cell(r, rankHdr, 'Faltas Est'), 0),
        tipsEst: toNum(cell(r, rankHdr, 'Tips Est'), 0),
        canTopNectar: toBool(cell(r, rankHdr, 'Top Nectar')),
        floresTop: toNum(cell(r, rankHdr, 'Flores TOP'), 0),
        piezasFlor: toNum(cell(r, rankHdr, 'Piezas Flor'), 0),
        reliabilityPct: toNum(cell(r, rankHdr, 'Confiabilidad %'), 100),
        excludedOldFailures: toNum(cell(r, rankHdr, 'Fallas_Excluidas'), 0),
        posEstimada: String(cell(r, rankHdr, 'Pos Estimada') ?? 'NONE'),
        opr: toOptNum(cell(r, rankHdr, 'OPR')),
        dpr: toOptNum(cell(r, rankHdr, 'DPR')),
        ccwm: toOptNum(cell(r, rankHdr, 'CCWM')),
        rankOff: toOptNum(cell(r, rankHdr, 'Rank_Ofensivo')),
        rankDef: toOptNum(cell(r, rankHdr, 'Rank_Defensivo')),
        rankCombAvg: toOptNum(cell(r, rankHdr, 'Rank_OPR_DPR_Prom')),
      };
    })
    .filter((t): t is TimestoneTeamMetric => t !== null);

  const matches: TimestoneMatchSim[] = raw.simMatchRows
    .slice(1)
    .map((r): TimestoneMatchSim | null => {
      const match = toNum(cell(r, matchHdr, 'Match'), 0);
      if (!match) return null;
      const redRealRaw = cell(r, matchHdr, 'Red Real');
      const blueRealRaw = cell(r, matchHdr, 'Blue Real');
      return {
        evento: String(cell(r, matchHdr, 'EVENTO') ?? raw.eventCode),
        nivel: String(cell(r, matchHdr, 'Nivel') ?? 'Quals'),
        match,
        jugado: toBool(cell(r, matchHdr, 'Jugado')),
        red1: toNum(cell(r, matchHdr, 'RED1'), 0),
        red2: toNum(cell(r, matchHdr, 'RED2'), 0),
        blue1: toNum(cell(r, matchHdr, 'BLUE1'), 0),
        blue2: toNum(cell(r, matchHdr, 'BLUE2'), 0),
        redEst: toNum(cell(r, matchHdr, 'Red Est'), 0),
        blueEst: toNum(cell(r, matchHdr, 'Blue Est'), 0),
        redWinPct: toNum(cell(r, matchHdr, 'Red Win %'), 50),
        blueWinPct: toNum(cell(r, matchHdr, 'Blue Win %'), 50),
        tiePct: toNum(cell(r, matchHdr, 'Tie %'), 0),
        ganadorEst: String(cell(r, matchHdr, 'Ganador Est') ?? 'EMPATE'),
        redFloresTap: toNum(cell(r, matchHdr, 'Red Flores Tap.'), 0),
        blueFloresTap: toNum(cell(r, matchHdr, 'Blue Flores Tap.'), 0),
        redAutoConflict: toBool(cell(r, matchHdr, 'Red Conflicto Auto')),
        blueAutoConflict: toBool(cell(r, matchHdr, 'Blue Conflicto Auto')),
        redRpsEst: toNum(cell(r, matchHdr, 'Red RPs Est'), 0),
        blueRpsEst: toNum(cell(r, matchHdr, 'Blue RPs Est'), 0),
        redReal: redRealRaw === '' || redRealRaw === undefined ? null : toNum(redRealRaw, 0),
        blueReal: blueRealRaw === '' || blueRealRaw === undefined ? null : toNum(blueRealRaw, 0),
      };
    })
    .filter((m): m is TimestoneMatchSim => m !== null);

  const standings: TimestoneStandingRow[] = raw.standingsRows
    .slice(1)
    .map((r): TimestoneStandingRow | null => {
      const team = toNum(cell(r, standHdr, 'Team ID'), 0);
      if (!team) return null;
      if (!updatedAt) {
        updatedAt = parseUpdatedAtIso(cell(r, standHdr, 'Updated_At'));
      }
      return {
        rankProyectado: toNum(cell(r, standHdr, 'Rank_Proyectado'), 0),
        team,
        name: String(cell(r, standHdr, 'Nombre') ?? `Equipo ${team}`),
        pjJugados: toNum(cell(r, standHdr, 'PJ_Jugados'), 0),
        pjRestantes: toNum(cell(r, standHdr, 'PJ_Restantes'), 0),
        pjSim: toNum(cell(r, standHdr, 'PJ_Sim'), 0),
        rpsReales: toNum(cell(r, standHdr, 'RPs_Reales'), 0),
        rpsTotales: toNum(cell(r, standHdr, 'RPs_Totales'), 0),
        rpPromedio: toNum(cell(r, standHdr, 'RP_Promedio'), 0),
        scoreAcumulado: toNum(cell(r, standHdr, 'Score_Acumulado'), 0),
        scorePromedio: toNum(cell(r, standHdr, 'Score_Promedio'), 0),
        rankMin: toNum(cell(r, standHdr, 'Rank_Min'), 0),
        rankMax: toNum(cell(r, standHdr, 'Rank_Max'), 0),
        probTop4Pct: toNum(cell(r, standHdr, 'Prob_Top4_Pct'), 0),
      };
    })
    .filter((s): s is TimestoneStandingRow => s !== null);

  const hasSheetOpr = teams.some((t) => t.opr !== null && t.opr !== undefined);
  if (!hasSheetOpr && teams.length > 0 && matches.length > 0) {
    const playedQuals = matches.filter(
      (m) =>
        m.jugado &&
        m.nivel.toUpperCase() === 'QUALS' &&
        m.red1 > 0 &&
        m.red2 > 0 &&
        m.blue1 > 0 &&
        m.blue2 > 0 &&
        m.redReal !== null &&
        m.blueReal !== null
    );
    const sourceMatches =
      playedQuals.length > 0
        ? playedQuals
        : matches.filter(
            (m) =>
              m.jugado &&
              m.red1 > 0 &&
              m.red2 > 0 &&
              m.blue1 > 0 &&
              m.blue2 > 0 &&
              m.redReal !== null &&
              m.blueReal !== null
          );
    if (sourceMatches.length > 0) {
      const computed = computeOprDprFromMatches(
        sourceMatches.map((m) => ({
          red1: m.red1,
          red2: m.red2,
          blue1: m.blue1,
          blue2: m.blue2,
          redScore: Number(m.redReal),
          blueScore: Number(m.blueReal),
        }))
      );
      teams.forEach((t) => {
        const od = computed.get(t.team);
        if (od) {
          t.opr = od.opr;
          t.dpr = od.dpr;
          t.ccwm = od.ccwm;
          t.rankOff = od.rankOff;
          t.rankDef = od.rankDef;
          t.rankCombAvg = od.rankCombAvg;
        }
      });
    }
  }

  const available = teams.length > 0 || matches.length > 0 || standings.length > 0;
  const ageMinutes =
    updatedAt !== null ? Math.max(0, Math.round((Date.now() - Date.parse(updatedAt)) / 60000)) : null;
  const isStale = Boolean(raw.eventCode) && (!available || ageMinutes === null || ageMinutes >= 60);

  return {
    available,
    eventCode: raw.eventCode,
    availableEvents: raw.availableEvents,
    updatedAt,
    isStale,
    ageMinutes,
    teams,
    matches,
    standings,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedEvent = searchParams.get('event')?.trim().toUpperCase() || undefined;

    const [{ resumenRows, capturaRows }, rawTimestone, rawPit] = await Promise.all([
      fetchAnalyticsSheets(),
      fetchTimestoneSheets(requestedEvent).catch((err) => {
        console.warn('No se pudieron cargar pestañas de Timestone:', err);
        return {
          eventCode: requestedEvent || '',
          availableEvents: [],
          rankingRows: [],
          simMatchRows: [],
          standingsRows: [],
        };
      }),
      fetchPitScoutingData().catch((err) => {
        console.warn('No se pudieron cargar pestañas de Pit Scouting:', err);
        return { pitRows: [], photoMetaRows: [] };
      }),
    ]);

    const timestone = parseTimestonePayload(rawTimestone);
    const timestoneTeamMap = new Map<number, TimestoneTeamMetric>(
      timestone.teams.map((t) => [t.team, t])
    );

    // 0. Parse Pit_Fotos metadata (columns A..I) and Pit_BIOBUZZ (columns A..S)
    const photoMetaById = new Map<string, PitPhotoMeta>();
    const photosByTeam = new Map<number, PitPhotoMeta[]>();
    for (const r of rawPit.photoMetaRows) {
      const photoId = String(r[1] ?? '').trim();
      if (!photoId || photoMetaById.has(photoId)) continue;
      const teamNum = toNum(r[2], 0);
      const meta: PitPhotoMeta = {
        photoId,
        fileName: String(r[3] ?? 'photo'),
        mimeType: String(r[4] ?? 'application/octet-stream'),
        caption: String(r[5] ?? 'Vista General'),
        sizeBytes: toNum(r[8], 0),
        timestamp: formatSerialDate(r[0]),
      };
      photoMetaById.set(photoId, meta);
      if (teamNum > 0) {
        const list = photosByTeam.get(teamNum) || [];
        list.push(meta);
        photosByTeam.set(teamNum, list);
      }
    }

    const pitByTeam = new Map<number, PitProfile>();
    for (const r of rawPit.pitRows.slice(1)) {
      const teamNum = toNum(r[1], 0);
      if (!teamNum) continue;

      const splitCsv = (val: unknown): string[] =>
        String(val ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

      const rawWeight = r[5];
      const weightNum =
        rawWeight === '' || rawWeight === null || rawWeight === undefined
          ? null
          : Number.isFinite(Number(rawWeight))
            ? Number(rawWeight)
            : null;

      const rowPhotoIds = splitCsv(r[18]);
      const existing = pitByTeam.get(teamNum);
      const mergedPhotosMap = new Map<string, PitPhotoMeta>();

      if (existing) {
        for (const p of existing.photos) mergedPhotosMap.set(p.photoId, p);
      }
      for (const pid of rowPhotoIds) {
        const meta = photoMetaById.get(pid) || {
          photoId: pid,
          fileName: 'photo',
          mimeType: 'image/jpeg',
          caption: 'Vista General',
          sizeBytes: 0,
          timestamp: '',
        };
        mergedPhotosMap.set(pid, meta);
      }
      for (const p of photosByTeam.get(teamNum) || []) {
        if (!mergedPhotosMap.has(p.photoId)) mergedPhotosMap.set(p.photoId, p);
      }

      pitByTeam.set(teamNum, {
        timestamp: formatSerialDate(r[0]),
        team: teamNum,
        teamName: String(r[2] ?? '').trim(),
        scouter: String(r[3] ?? '').trim(),
        robotType: String(r[19] ?? '').trim(),
        chassisType: String(r[4] ?? '').trim(),
        weightLb: weightNum,
        intakeType: String(r[6] ?? '').trim(),
        capacity: String(r[7] ?? '').trim(),
        hiveMech: String(r[8] ?? '').trim(),
        flowerMech: String(r[9] ?? '').trim(),
        autoRoutines: splitCsv(r[10]),
        autoSide: String(r[11] ?? '').trim(),
        sensorsVision: splitCsv(r[12]),
        claimedAutoPoints: toNum(r[13], 0),
        driverHours: String(r[14] ?? '').trim(),
        preferredRole: String(r[15] ?? '').trim(),
        notes: String(r[16] ?? '').trim(),
        photos: Array.from(mergedPhotosMap.values()),
      });
    }

    // 1. Parse Captura_BIOBUZZ rows (row 0 = headers A1:AE1)
    const rawCapturas = capturaRows.slice(1);
    const matches: MatchRecord[] = rawCapturas
      .map((r, idx): MatchRecord | null => {
        const team = toNum(r[2], 0);
        if (!team) return null;
        return {
          id: idx + 1,
          timestamp: formatSerialDate(r[0]),
          match: toNum(r[1], idx + 1),
          team,
          alliance: ['ROJO', 'ROJA', 'RED'].includes(String(r[3] ?? 'AZUL').trim().toUpperCase()) ? 'ROJO' : 'AZUL',
          scouter: String(r[4] ?? 'Scouter'),
          startPos: /^[A-E]$/i.test(String(r[5] ?? '').trim())
            ? String(r[5] ?? '').trim().toUpperCase()
            : String(r[5] ?? 'Sin pos.').trim(),
          autoLeave: toBool(r[6]),
          autoPark: toBool(r[7]),
          autoHivePollen: toNum(r[8]),
          autoHiveNectar: toNum(r[9]),
          autoFlowerPollen: toNum(r[10]),
          autoFlowerNectar: toNum(r[11]),
          teleopHivePollen: toNum(r[12]),
          teleopHiveNectar: toNum(r[13]),
          flowerOwnership: String(r[14] ?? '0'),
          flowerOwnedCount: parseFlowerOwnedCount(r[14]),
          teleopFlowerPollen: toNum(r[15]),
          teleopFlowerNectar: toNum(r[16]),
          bottomNectar: toBool(r[17]),
          gardenElements: toNum(r[18]),
          gardenDescore: toBool(r[19]),
          teleopPark: toBool(r[20]),
          status: String(r[21] ?? '100% Operativo'),
          minorFouls: toNum(r[22]),
          majorFouls: toNum(r[23]),
          cards: String(r[24] ?? 'Ninguna'),
          driverSkill: toNum(r[25], 3),
          notes: String(r[26] ?? ''),
          autoScore: toNum(r[27]),
          teleScore: toNum(r[28]),
          foulsScore: toNum(r[29]),
          netScore: toNum(r[30]),
        };
      })
      .filter((m): m is MatchRecord => m !== null);

    // Group matches by team for deep-dive metrics
    const matchesByTeam = new Map<number, MatchRecord[]>();
    for (const m of matches) {
      const arr = matchesByTeam.get(m.team) || [];
      arr.push(m);
      matchesByTeam.set(m.team, arr);
    }

    // 2. Parse Resumen_Equipos (row 0 = header row A3:N3, rows 1+ = teams)
    const resumenDataRows = resumenRows.slice(1).filter((r) => toNum(r[1], 0) > 0);
    const seenTeams = new Set<number>();

    const buildTeamAnalytics = (teamNum: number, resumenRow?: unknown[], fallbackRank = 1): TeamAnalytics => {
      const teamMatches = [...(matchesByTeam.get(teamNum) || [])].sort((a, b) => a.match - b.match);
      const count = teamMatches.length || (resumenRow ? toNum(resumenRow[2], 0) : 0);

      const avg = (fn: (m: MatchRecord) => number) =>
        teamMatches.length ? teamMatches.reduce((s, m) => s + fn(m), 0) / teamMatches.length : 0;

      const pct = (fn: (m: MatchRecord) => boolean) =>
        teamMatches.length ? Math.round((teamMatches.filter(fn).length / teamMatches.length) * 1000) / 10 : 0;

      const LEGACY_GRID_TO_LETTER: Record<string, { side: 'red' | 'blue'; letter: string }> = {
        C1: { side: 'red', letter: 'A' },
        A1: { side: 'red', letter: 'B' },
        A2: { side: 'red', letter: 'C' },
        A6: { side: 'red', letter: 'D' },
        C6: { side: 'red', letter: 'E' },
        D6: { side: 'blue', letter: 'A' },
        F6: { side: 'blue', letter: 'B' },
        F5: { side: 'blue', letter: 'C' },
        F1: { side: 'blue', letter: 'D' },
        D1: { side: 'blue', letter: 'E' },
      };

      const positionsCount: Record<string, number> = {};
      const sidePositionsCount: Record<string, number> = {};
      for (const m of teamMatches) {
        if (!m.startPos || m.startPos === 'Sin pos.') continue;
        const raw = m.startPos.trim();
        const upper = raw.toUpperCase();
        const side: 'red' | 'blue' = m.alliance === 'ROJO' ? 'red' : 'blue';

        if (/^[A-E]$/.test(upper)) {
          positionsCount[upper] = (positionsCount[upper] || 0) + 1;
          const sideKey = `${side}:${upper}`;
          sidePositionsCount[sideKey] = (sidePositionsCount[sideKey] || 0) + 1;
        } else {
          positionsCount[raw] = (positionsCount[raw] || 0) + 1;
          const legacyCode = upper.slice(0, 2);
          const mapped = LEGACY_GRID_TO_LETTER[legacyCode];
          if (mapped) {
            const sideKey = `${mapped.side}:${mapped.letter}`;
            sidePositionsCount[sideKey] = (sidePositionsCount[sideKey] || 0) + 1;
          }
        }
      }
      const totalPos = Object.values(positionsCount).reduce((a, b) => a + b, 0);
      const positions: Record<string, { count: number; pct: number }> = {};
      const sidePositions: Record<string, { count: number; pct: number }> = {};
      let topStartPos = '—';
      let topPosCount = 0;
      for (const [pos, c] of Object.entries(positionsCount)) {
        positions[pos] = { count: c, pct: totalPos ? Math.round((c / totalPos) * 100) : 0 };
        if (c > topPosCount) {
          topPosCount = c;
          topStartPos = pos;
        }
      }
      for (const [sideKey, c] of Object.entries(sidePositionsCount)) {
        sidePositions[sideKey] = { count: c, pct: totalPos ? Math.round((c / totalPos) * 100) : 0 };
      }

      const nets = teamMatches.map((m) => m.netScore);
      const autos = teamMatches.map((m) => m.autoScore);
      const teles = teamMatches.map((m) => m.teleScore);

      // Trust Resumen_Equipos only when its match count matches Captura_BIOBUZZ (avoids stale sheet refs overriding new matches)
      const resumenCount = resumenRow ? toNum(resumenRow[2], 0) : 0;
      const useResumen = Boolean(resumenRow && (teamMatches.length === 0 || resumenCount === teamMatches.length));

      const epaNetAvg = useResumen ? toNum(resumenRow![3]) : avg((m) => m.netScore);
      const autoAvg = useResumen ? toNum(resumenRow![4]) : avg((m) => m.autoScore);
      const teleAvg = useResumen ? toNum(resumenRow![5]) : avg((m) => m.teleScore);
      const balancinAutoAvg = useResumen ? toNum(resumenRow![6]) : avg((m) => m.autoHivePollen + m.autoHiveNectar);
      const balancinTeleAvg = useResumen ? toNum(resumenRow![7]) : avg((m) => m.teleopHivePollen + m.teleopHiveNectar);
      const florAvg = useResumen
        ? toNum(resumenRow![8])
        : avg((m) => m.autoFlowerPollen + m.autoFlowerNectar + m.teleopFlowerPollen + m.teleopFlowerNectar);
      const gardenAvg = useResumen ? toNum(resumenRow![9]) : avg((m) => m.gardenElements);
      const flowersOwnedAvg = Math.round(avg((m) => m.flowerOwnedCount) * 10) / 10;
      const flowerControlPct = useResumen ? toPct(resumenRow![10]) : pct((m) => m.flowerOwnedCount > 0);
      const reliabilityPct = useResumen ? toPct(resumenRow![11]) : pct((m) => m.status === '100% Operativo');
      const foulsAvg = useResumen ? toNum(resumenRow![12]) : avg((m) => m.foulsScore);
      const driverAvg = useResumen ? toNum(resumenRow![13], 3) : avg((m) => m.driverSkill);

      return {
        rank: useResumen ? toNum(resumenRow![0], fallbackRank) : fallbackRank,
        team: teamNum,
        matchesPlayed: useResumen ? toNum(resumenRow![2], count) : count,
        epaNetAvg: Math.round(epaNetAvg * 10) / 10,
        autoAvg: Math.round(autoAvg * 10) / 10,
        teleAvg: Math.round(teleAvg * 10) / 10,
        balancinAutoAvg: Math.round(balancinAutoAvg * 10) / 10,
        balancinTeleAvg: Math.round(balancinTeleAvg * 10) / 10,
        florAvg: Math.round(florAvg * 10) / 10,
        gardenAvg: Math.round(gardenAvg * 10) / 10,
        flowerControlPct,
        flowersOwnedAvg,
        reliabilityPct,
        foulsAvg: Math.round(foulsAvg * 10) / 10,
        driverAvg: Math.round(driverAvg * 10) / 10,
        maxNet: nets.length ? Math.max(...nets) : Math.round(epaNetAvg),
        minNet: nets.length ? Math.min(...nets) : Math.round(epaNetAvg),
        maxAuto: autos.length ? Math.max(...autos) : Math.round(autoAvg),
        minAuto: autos.length ? Math.min(...autos) : Math.round(autoAvg),
        maxTele: teles.length ? Math.max(...teles) : Math.round(teleAvg),
        minTele: teles.length ? Math.min(...teles) : Math.round(teleAvg),
        autoHivePollenAvg: Math.round(avg((m) => m.autoHivePollen) * 10) / 10,
        autoHiveNectarAvg: Math.round(avg((m) => m.autoHiveNectar) * 10) / 10,
        autoFlowerPollenAvg: Math.round(avg((m) => m.autoFlowerPollen) * 10) / 10,
        autoFlowerNectarAvg: Math.round(avg((m) => m.autoFlowerNectar) * 10) / 10,
        teleHivePollenAvg: Math.round(avg((m) => m.teleopHivePollen) * 10) / 10,
        teleHiveNectarAvg: Math.round(avg((m) => m.teleopHiveNectar) * 10) / 10,
        teleFlowerPollenAvg: Math.round(avg((m) => m.teleopFlowerPollen) * 10) / 10,
        teleFlowerNectarAvg: Math.round(avg((m) => m.teleopFlowerNectar) * 10) / 10,
        autoLeavePct: pct((m) => m.autoLeave),
        autoParkPct: pct((m) => m.autoPark),
        endgameParkPct: pct((m) => m.teleopPark),
        bottomNectarPct: pct((m) => m.bottomNectar),
        gardenDescorePct: pct((m) => m.gardenDescore),
        swarmPtsAvg: Math.round(
          avg((m) => (m.autoLeave ? 3 : 0) + (m.autoPark ? 5 : 0) + (m.teleopPark ? 5 : 0)) * 10
        ) / 10,
        topStartPos,
        positions,
        sidePositions,
        notes: teamMatches
          .filter((m) => m.notes.trim().length > 0 || m.status !== '100% Operativo' || m.cards !== 'Ninguna')
          .map((m) => ({
            match: m.match,
            scouter: m.scouter,
            alliance: m.alliance,
            note: m.notes,
            status: m.status,
          }))
          .reverse(),
        history: teamMatches,
        timestone: timestoneTeamMap.get(teamNum),
        pit: pitByTeam.get(teamNum),
      };
    };

    const teams: TeamAnalytics[] = [];
    for (let i = 0; i < resumenDataRows.length; i++) {
      const r = resumenDataRows[i];
      const teamNum = toNum(r[1], 0);
      if (!teamNum || seenTeams.has(teamNum)) continue;
      seenTeams.add(teamNum);
      teams.push(buildTeamAnalytics(teamNum, r, i + 1));
    }

    // Add any team present in Captura_BIOBUZZ not yet returned by Resumen_Equipos
    for (const [teamNum] of matchesByTeam.entries()) {
      if (!seenTeams.has(teamNum)) {
        seenTeams.add(teamNum);
        teams.push(buildTeamAnalytics(teamNum, undefined, teams.length + 1));
      }
    }

    // Add any team with Pit Scouting recorded before playing its first match
    for (const [teamNum] of pitByTeam.entries()) {
      if (!seenTeams.has(teamNum)) {
        seenTeams.add(teamNum);
        teams.push(buildTeamAnalytics(teamNum, undefined, teams.length + 1));
      }
    }

    teams.sort((a, b) => b.epaNetAvg - a.epaNetAvg || a.rank - b.rank);
    teams.forEach((t, idx) => {
      t.rank = idx + 1;
    });

    return NextResponse.json({
      success: true,
      updatedAt: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      matchesCount: matches.length,
      teamsCount: teams.length,
      pitCount: pitByTeam.size,
      teams,
      matches,
      timestone,
    });
  } catch (error: any) {
    console.error('Error en /api/analytics:', error);
    return NextResponse.json(
      {
        success: false,
        updatedAt: '',
        matchesCount: 0,
        teamsCount: 0,
        teams: [],
        matches: [],
        error: error.message || 'Error leyendo Google Sheets',
      },
      { status: 500 }
    );
  }
}

