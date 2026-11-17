import { NextResponse } from 'next/server';
import { fetchAnalyticsSheets } from '@/lib/googleSheets';
import type { MatchRecord, TeamAnalytics } from '@/lib/types';

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

export async function GET() {
  try {
    const { resumenRows, capturaRows } = await fetchAnalyticsSheets();

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
          flowerOwnership: String(r[14] ?? 'No compitió'),
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
      const count = teamMatches.length || (resumenRow ? toNum(resumenRow[2], 1) : 1);

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

      const epaNetAvg = resumenRow ? toNum(resumenRow[3]) : avg((m) => m.netScore);
      const autoAvg = resumenRow ? toNum(resumenRow[4]) : avg((m) => m.autoScore);
      const teleAvg = resumenRow ? toNum(resumenRow[5]) : avg((m) => m.teleScore);
      const balancinAutoAvg = resumenRow ? toNum(resumenRow[6]) : avg((m) => m.autoHivePollen + m.autoHiveNectar);
      const balancinTeleAvg = resumenRow ? toNum(resumenRow[7]) : avg((m) => m.teleopHivePollen + m.teleopHiveNectar);
      const florAvg = resumenRow
        ? toNum(resumenRow[8])
        : avg((m) => m.autoFlowerPollen + m.autoFlowerNectar + m.teleopFlowerPollen + m.teleopFlowerNectar);
      const gardenAvg = resumenRow ? toNum(resumenRow[9]) : avg((m) => m.gardenElements);
      const flowerControlPct = resumenRow ? toPct(resumenRow[10]) : pct((m) => m.flowerOwnership === 'Controló Flor');
      const reliabilityPct = resumenRow ? toPct(resumenRow[11]) : pct((m) => m.status === '100% Operativo');
      const foulsAvg = resumenRow ? toNum(resumenRow[12]) : avg((m) => m.foulsScore);
      const driverAvg = resumenRow ? toNum(resumenRow[13], 3) : avg((m) => m.driverSkill);

      return {
        rank: resumenRow ? toNum(resumenRow[0], fallbackRank) : fallbackRank,
        team: teamNum,
        matchesPlayed: resumenRow ? toNum(resumenRow[2], count) : count,
        epaNetAvg: Math.round(epaNetAvg * 10) / 10,
        autoAvg: Math.round(autoAvg * 10) / 10,
        teleAvg: Math.round(teleAvg * 10) / 10,
        balancinAutoAvg: Math.round(balancinAutoAvg * 10) / 10,
        balancinTeleAvg: Math.round(balancinTeleAvg * 10) / 10,
        florAvg: Math.round(florAvg * 10) / 10,
        gardenAvg: Math.round(gardenAvg * 10) / 10,
        flowerControlPct,
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

    teams.sort((a, b) => a.rank - b.rank || b.epaNetAvg - a.epaNetAvg);

    return NextResponse.json({
      success: true,
      updatedAt: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      matchesCount: matches.length,
      teamsCount: teams.length,
      teams,
      matches,
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

