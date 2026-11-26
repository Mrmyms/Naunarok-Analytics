'use client';

import React, { useEffect, useMemo, useState } from 'react';
import DuelComparisonBars from '@/components/DuelComparisonBars';
import RagnarokFieldHeatmap, { type FieldMarker } from '@/components/RagnarokFieldHeatmap';
import { detectRobotRole } from '@/lib/roles';
import type {
  EventRosterTeam,
  ScheduleMatch,
  ScheduleTeam,
  TeamAnalytics,
  TimestoneMatchSim,
  TimestoneTeamMetric,
} from '@/lib/types';

const MY_TEAM_STORAGE_KEY = 'beyonder_my_team_v1';

type ScheduleFilter = 'all' | 'pending' | 'played' | 'mine';

interface UnifiedMatch {
  key: string;
  matchNum: number;
  level: string;
  label: string;
  scheduledTime: string | null;
  redTeams: number[];
  blueTeams: number[];
  red1: number;
  red2: number;
  blue1: number;
  blue2: number;
  played: boolean;
  redReal: number | null;
  blueReal: number | null;
  isMonteCarlo: boolean;
  hasProjection: boolean;
  redEst: number;
  blueEst: number;
  redWinPct: number;
  blueWinPct: number;
  tiePct: number;
  redRpsEst: number;
  blueRpsEst: number;
  redFloresTap: number;
  blueFloresTap: number;
  redAutoConflict: boolean;
  blueAutoConflict: boolean;
}

const STATION_ORDER: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
};

function normalizeLevel(raw: string | undefined | null): string {
  const up = String(raw || 'QUALS').trim().toUpperCase();
  if (up === 'QUALIFICATION' || up === 'QUALS' || up === 'QM') return 'QUALS';
  return up || 'QUALS';
}

function getEffectiveMatchCode(level: string, matchNum: number, series?: number): number {
  if (level !== 'QUALS' && series && series > 0) {
    return matchNum === 1 ? series : series * 100 + matchNum;
  }
  return matchNum;
}

function extractAllianceTeams(teams: ScheduleTeam[] | undefined, alliance: 'Red' | 'Blue'): number[] {
  if (!teams?.length) return [];
  return teams
    .filter((t) => String(t.alliance || '').toUpperCase() === alliance.toUpperCase() && Number(t.teamNumber) > 0)
    .sort((a, b) => {
      const sa = STATION_ORDER[String(a.station || '').toUpperCase()] ?? 9;
      const sb = STATION_ORDER[String(b.station || '').toUpperCase()] ?? 9;
      return sa - sb;
    })
    .map((t) => Number(t.teamNumber));
}

function formatMatchTime(
  iso: string | null | undefined,
  timeZone?: string | null,
  includeDate = false
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const opts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(includeDate ? { day: '2-digit', month: '2-digit' } : {}),
  };
  if (timeZone) {
    try {
      return d.toLocaleTimeString('es-MX', { ...opts, timeZone });
    } catch {
      // Fallback to browser timezone if IANA string is invalid
    }
  }
  return d.toLocaleTimeString('es-MX', opts);
}

function logisticRedWinPct(redNet: number, blueNet: number): number {
  const diff = redNet - blueNet;
  const raw = (1 / (1 + Math.exp(-diff / 14))) * 100;
  return Math.round(Math.max(3, Math.min(97, raw)) * 10) / 10;
}

function summarizeAlliance(
  ids: number[],
  teamMap: Map<number, TeamAnalytics>,
  tsTeamMap: Map<number, TimestoneTeamMetric>
) {
  const cleanIds = ids.filter((id) => id > 0);
  const members = cleanIds
    .map((id) => teamMap.get(id))
    .filter((t): t is TeamAnalytics => !!t);

  let auto = 0;
  let tele = 0;
  let fouls = 0;
  let net = 0;
  let balancin = 0;
  let flor = 0;
  let garden = 0;
  let swarmPts = 0;
  let oprSum = 0;
  let oprCount = 0;
  const zones: string[] = [];

  for (const id of cleanIds) {
    const scout = teamMap.get(id);
    const ts = scout?.timestone ?? tsTeamMap.get(id);

    if (scout) {
      auto += scout.autoAvg;
      tele += scout.teleAvg;
      fouls += scout.foulsAvg;
      net += scout.autoAvg + scout.teleAvg - scout.foulsAvg;
      balancin += scout.balancinAutoAvg + scout.balancinTeleAvg;
      flor += scout.florAvg;
      garden += scout.gardenAvg;
      swarmPts += scout.swarmPtsAvg;
      if (scout.topStartPos && scout.topStartPos !== '—') {
        zones.push(scout.topStartPos);
      }
    } else if (ts) {
      auto += ts.autoEst;
      tele += ts.teleEst + ts.endEst;
      fouls += ts.foulsEst;
      net += ts.epa;
      flor += ts.piezasFlor;
      if (ts.posEstimada && ts.posEstimada !== 'NONE') {
        zones.push(ts.posEstimada);
      }
    }

    if (ts?.opr != null) {
      oprSum += ts.opr;
      oprCount += 1;
    }
  }

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const hasCollision = zones.length >= 2 && new Set(zones).size < zones.length;

  return {
    members,
    auto: r1(auto),
    tele: r1(tele),
    fouls: r1(fouls),
    net: r1(net),
    balancin: r1(balancin),
    flor: r1(flor),
    garden: r1(garden),
    swarmPts: r1(swarmPts),
    combinedOpr: oprCount > 0 ? r1(oprSum) : null,
    hasCollision,
    zones,
  };
}

function AllianceRobotDetailedCards({
  ids,
  teamMap,
  tsTeamMap,
  eventTeamNameMap,
  accent,
  myTeam,
  onSelect,
}: {
  ids: number[];
  teamMap: Map<number, TeamAnalytics>;
  tsTeamMap: Map<number, TimestoneTeamMetric>;
  eventTeamNameMap: Map<number, string>;
  accent: string;
  myTeam: number;
  onSelect: (teamNum: number) => void;
}) {
  const cleanIds = ids.filter((id) => id > 0);
  if (cleanIds.length === 0) {
    return (
      <div
        style={{
          background: 'var(--bg-carbon)',
          border: '1px solid var(--border-steel)',
          borderLeft: `3px solid ${accent}`,
          borderRadius: '4px',
          padding: '10px 12px',
          fontSize: '12px',
          color: 'var(--text-muted)',
        }}
      >
        Sin equipos asignados en esta alianza.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {cleanIds.map((id, idx) => {
        const m = teamMap.get(id);
        const ts = m?.timestone ?? tsTeamMap.get(id);
        const officialName = eventTeamNameMap.get(id) || ts?.name;
        const isMine = id === myTeam;

        if (!m && !ts) {
          return (
            <div
              key={`${id}-${idx}`}
              className="tabular"
              style={{
                background: 'var(--bg-carbon)',
                border: isMine ? '1px solid rgba(255, 209, 102, 0.55)' : '1px solid var(--border-steel)',
                borderLeft: `3px solid ${isMine ? 'var(--accent-amber)' : accent}`,
                borderRadius: '4px',
                padding: '10px 12px',
                fontSize: '12px',
                color: 'var(--text-muted)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontWeight: 800, color: isMine ? 'var(--accent-amber)' : 'var(--text-silver)' }}>
                {isMine ? '★ ' : ''}#{id}
                {officialName ? ` • ${officialName}` : ''}
              </span>
              <span style={{ fontSize: '11px' }}>Sin scouting local todavía</span>
            </div>
          );
        }

        if (!m && ts) {
          return (
            <div
              key={`${id}-${idx}`}
              className="tabular"
              style={{
                background: 'var(--bg-carbon)',
                border: isMine ? '1px solid rgba(255, 209, 102, 0.55)' : '1px solid var(--border-steel)',
                borderLeft: `3px solid ${isMine ? 'var(--accent-amber)' : accent}`,
                borderRadius: '4px',
                padding: '10px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                fontSize: '12px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 900, fontSize: '14px', color: isMine ? 'var(--accent-amber)' : '#FFFFFF' }}>
                    {isMine ? '★ ' : ''}#{ts.team}
                  </span>
                  {officialName && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>{officialName}</span>
                  )}
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  EPA <strong style={{ color: 'var(--bey-purple)' }}>{ts.epa.toFixed(1)}</strong>
                  {ts.opr != null && (
                    <>
                      {' '}• OPR <strong style={{ color: 'var(--bey-cyan)' }}>{ts.opr.toFixed(1)}</strong> / DPR{' '}
                      <strong style={{ color: 'var(--accent-emerald)' }}>{ts.dpr?.toFixed(1) ?? '—'}</strong>
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', fontWeight: 700, flexWrap: 'wrap', alignItems: 'center', fontSize: '11.5px' }}>
                <span style={{ color: '#E2E8F0' }}>A {ts.autoEst.toFixed(1)}</span>
                <span style={{ color: '#E2E8F0' }}>T {(ts.teleEst + ts.endEst).toFixed(1)}</span>
                <span style={{ color: '#FB7185' }}>Flor {ts.piezasFlor.toFixed(1)}</span>
                <span style={{ color: ts.reliabilityPct >= 90 ? '#34D399' : '#FFD166' }}>
                  {ts.reliabilityPct.toFixed(0)}% Op
                </span>
              </div>
            </div>
          );
        }

        const robot = m!;
        const roleMeta = detectRobotRole(robot);
        const thumb = robot.pit?.photos?.[0];
        const name = robot.pit?.teamName || officialName;

        return (
          <div
            key={robot.team}
            onClick={() => onSelect(robot.team)}
            className="tabular"
            style={{
              background: 'var(--bg-carbon)',
              border: isMine ? '1px solid rgba(255, 209, 102, 0.55)' : '1px solid var(--border-steel)',
              borderLeft: `3px solid ${isMine ? 'var(--accent-amber)' : accent}`,
              borderRadius: '4px',
              padding: '10px 12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {thumb && (
                <img
                  src={`/api/pit/photo?id=${encodeURIComponent(thumb.photoId)}`}
                  alt={`#${robot.team}`}
                  loading="lazy"
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '4px',
                    objectFit: 'cover',
                    border: '1px solid var(--border-steel-bright)',
                  }}
                />
              )}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 900, fontSize: '14px', color: isMine ? 'var(--accent-amber)' : '#FFFFFF' }}>
                    {isMine ? '★ ' : ''}#{robot.team}
                  </span>
                  {name && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>{name}</span>
                  )}
                  <span
                    style={{
                      background: roleMeta.bg,
                      color: roleMeta.color,
                      border: `1px solid ${roleMeta.color}44`,
                      borderRadius: '3px',
                      padding: '1px 5px',
                      fontSize: '9px',
                      fontWeight: 800,
                    }}
                  >
                    {roleMeta.role}
                  </span>
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Auto Zona <strong style={{ color: 'var(--text-silver)' }}>{robot.topStartPos}</strong> • EPA{' '}
                  <strong style={{ color: 'var(--bey-purple)' }}>{robot.epaNetAvg.toFixed(1)}</strong>
                  {ts?.opr != null && (
                    <>
                      {' '}• OPR <strong style={{ color: 'var(--bey-cyan)' }}>{ts.opr.toFixed(1)}</strong> / DPR{' '}
                      <strong style={{ color: 'var(--accent-emerald)' }}>{ts.dpr?.toFixed(1) ?? '—'}</strong>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', fontWeight: 700, flexWrap: 'wrap', alignItems: 'center', fontSize: '11.5px' }}>
              <span style={{ color: '#E2E8F0' }}>A {robot.autoAvg.toFixed(1)}</span>
              <span style={{ color: '#E2E8F0' }}>T {robot.teleAvg.toFixed(1)}</span>
              <span style={{ color: '#60A5FA' }}>Bal {(robot.balancinAutoAvg + robot.balancinTeleAvg).toFixed(1)}</span>
              <span style={{ color: '#FB7185' }}>Flor {robot.florAvg.toFixed(1)}</span>
              <span style={{ color: '#34D399' }}>Gar {robot.gardenAvg.toFixed(1)}</span>
              <span style={{ color: robot.reliabilityPct >= 90 ? '#34D399' : robot.reliabilityPct < 70 ? '#FCA5A5' : '#FFD166' }}>
                {robot.reliabilityPct.toFixed(0)}% Op
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MatchScheduleView({
  teams,
  teamMap,
  timestoneMatches,
  timestoneTeams,
  scheduleMatches,
  eventTeams,
  activeEventCode,
  loadedEvent,
  eventSeason,
  eventCodeInput,
  loadingEvent,
  eventError,
  onChangeEventSeason,
  onChangeEventCodeInput,
  onLoadEvent,
  onOpenTeamProfile,
  onSendToAllianceSim,
}: {
  teams: TeamAnalytics[];
  teamMap: Map<number, TeamAnalytics>;
  timestoneMatches: TimestoneMatchSim[];
  timestoneTeams: TimestoneTeamMetric[];
  scheduleMatches: ScheduleMatch[];
  eventTeams: EventRosterTeam[];
  activeEventCode: string;
  loadedEvent: {
    code: string;
    name: string;
    season: number;
    timezone?: string | null;
    hasMatches?: boolean;
  } | null;
  eventSeason: number;
  eventCodeInput: string;
  loadingEvent: boolean;
  eventError: string | null;
  onChangeEventSeason: (season: number) => void;
  onChangeEventCodeInput: (code: string) => void;
  onLoadEvent: () => void;
  onOpenTeamProfile: (teamNum: number) => void;
  onSendToAllianceSim: (r1: number, r2: number, b1: number, b2: number) => void;
}) {
  const [myTeam, setMyTeam] = useState<number>(4010);
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [showManualSandbox, setShowManualSandbox] = useState(false);

  // Manual 2v2 sandbox state
  const [manualRed1, setManualRed1] = useState<number>(0);
  const [manualRed2, setManualRed2] = useState<number>(0);
  const [manualBlue1, setManualBlue1] = useState<number>(0);
  const [manualBlue2, setManualBlue2] = useState<number>(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MY_TEAM_STORAGE_KEY);
      if (saved && Number(saved) > 0) setMyTeam(Number(saved));
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (teams.length > 0) {
      setManualRed1((p) => p || teams[0]?.team || 0);
      setManualRed2((p) => p || teams[1]?.team || teams[0]?.team || 0);
      setManualBlue1((p) => p || teams[2]?.team || teams[0]?.team || 0);
      setManualBlue2((p) => p || teams[3]?.team || teams[1]?.team || 0);
    }
  }, [teams]);

  const handleMyTeamChange = (val: number) => {
    const clean = Math.max(0, Math.round(val));
    setMyTeam(clean);
    try {
      localStorage.setItem(MY_TEAM_STORAGE_KEY, String(clean));
    } catch {
      // ignore
    }
  };

  const eventTeamNameMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const et of eventTeams) {
      if (et.teamNumber > 0) map.set(et.teamNumber, et.name);
    }
    return map;
  }, [eventTeams]);

  const tsTeamMap = useMemo(() => {
    const map = new Map<number, TimestoneTeamMetric>();
    for (const tt of timestoneTeams) {
      if (tt.team > 0) map.set(tt.team, tt);
    }
    return map;
  }, [timestoneTeams]);

  // Guard against stale/generic demo matches cached in Timestone Sheets when FTCScout confirms 0 matches & zero roster overlap
  const timestoneRosterMismatch = useMemo(() => {
    if (
      !loadedEvent ||
      loadedEvent.code !== activeEventCode ||
      scheduleMatches.length > 0 ||
      eventTeamNameMap.size === 0 ||
      timestoneMatches.length === 0
    ) {
      return false;
    }
    for (const tm of timestoneMatches) {
      for (const tid of [tm.red1, tm.red2, tm.blue1, tm.blue2]) {
        if (tid > 0 && eventTeamNameMap.has(tid)) return false;
      }
    }
    return true;
  }, [loadedEvent, activeEventCode, scheduleMatches.length, eventTeamNameMap, timestoneMatches]);

  const includeDateInTime = useMemo(() => {
    const tz = loadedEvent?.timezone || undefined;
    const days = new Set<string>();
    for (const sm of scheduleMatches) {
      const iso = sm.scheduledStartTime || sm.actualStartTime;
      if (!iso) continue;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) continue;
      try {
        days.add(d.toLocaleDateString('en-CA', tz ? { timeZone: tz } : undefined));
      } catch {
        days.add(d.toLocaleDateString('en-CA'));
      }
    }
    return days.size > 1;
  }, [scheduleMatches, loadedEvent?.timezone]);

  // Unify Timestone simulations + FTCScout schedule (with timestamps, series keys & real scores)
  const unifiedMatches = useMemo<UnifiedMatch[]>(() => {
    const effectiveTsMatches = timestoneRosterMismatch ? [] : timestoneMatches;

    const tsByKey = new Map<string, TimestoneMatchSim>();
    for (const tm of effectiveTsMatches) {
      const lvl = normalizeLevel(tm.nivel);
      tsByKey.set(`${lvl}#${tm.match}`, tm);
    }

    const schedByKey = new Map<string, ScheduleMatch>();
    for (const sm of scheduleMatches) {
      const lvl = normalizeLevel(sm.tournamentLevel);
      const effCode = getEffectiveMatchCode(lvl, sm.matchNum, sm.series);
      schedByKey.set(`${lvl}#${effCode}`, sm);
    }

    const allKeys = Array.from(new Set([...tsByKey.keys(), ...schedByKey.keys()]));
    const list: UnifiedMatch[] = [];

    for (const key of allKeys) {
      const tm = tsByKey.get(key);
      const sm = schedByKey.get(key);

      const level = sm ? normalizeLevel(sm.tournamentLevel) : normalizeLevel(tm?.nivel);
      const matchNum = sm
        ? getEffectiveMatchCode(level, sm.matchNum, sm.series)
        : tm?.match || 0;
      if (!matchNum) continue;

      const smRed = extractAllianceTeams(sm?.teams, 'Red');
      const smBlue = extractAllianceTeams(sm?.teams, 'Blue');
      const tmRed = [tm?.red1 || 0, tm?.red2 || 0].filter((n) => n > 0);
      const tmBlue = [tm?.blue1 || 0, tm?.blue2 || 0].filter((n) => n > 0);

      const redTeams = smRed.length > 0 ? smRed : tmRed;
      const blueTeams = smBlue.length > 0 ? smBlue : tmBlue;

      const red1 = redTeams[0] || 0;
      const red2 = redTeams[1] || 0;
      const blue1 = blueTeams[0] || 0;
      const blue2 = blueTeams[1] || 0;

      const redSummary = summarizeAlliance(redTeams, teamMap, tsTeamMap);
      const blueSummary = summarizeAlliance(blueTeams, teamMap, tsTeamMap);

      const fallbackRedPct =
        redSummary.net > 0 || blueSummary.net > 0
          ? logisticRedWinPct(redSummary.net, blueSummary.net)
          : 50;

      const scheduledTime = formatMatchTime(
        sm?.scheduledStartTime || sm?.actualStartTime,
        loadedEvent?.timezone,
        includeDateInTime
      );
      const labelPrefix = level === 'QUALS' ? 'Q' : level.slice(0, 1);
      const label = (sm?.description || '').trim() || `${labelPrefix}${matchNum}`;

      const played = Boolean(tm?.jugado || sm?.hasBeenPlayed);
      const redReal = tm?.redReal ?? sm?.scores?.red?.totalPoints ?? null;
      const blueReal = tm?.blueReal ?? sm?.scores?.blue?.totalPoints ?? null;

      // Handle Timestone rows for completely unscouted events (0 est / 0% win / 100% tie)
      const tmHasZeroEstimates = Boolean(
        tm && tm.redEst === 0 && tm.blueEst === 0 && tm.redWinPct === 0 && tm.blueWinPct === 0
      );
      const isMonteCarlo = Boolean(tm && !tmHasZeroEstimates);
      const hasProjection =
        isMonteCarlo || redSummary.net > 0 || blueSummary.net > 0;

      list.push({
        key,
        matchNum,
        level,
        label,
        scheduledTime,
        redTeams,
        blueTeams,
        red1,
        red2,
        blue1,
        blue2,
        played,
        redReal,
        blueReal,
        isMonteCarlo,
        hasProjection,
        redEst: isMonteCarlo && tm ? tm.redEst : redSummary.net,
        blueEst: isMonteCarlo && tm ? tm.blueEst : blueSummary.net,
        redWinPct: isMonteCarlo && tm ? tm.redWinPct : fallbackRedPct,
        blueWinPct: isMonteCarlo && tm ? tm.blueWinPct : Math.round((100 - fallbackRedPct) * 10) / 10,
        tiePct: isMonteCarlo && tm ? tm.tiePct : 0,
        redRpsEst: isMonteCarlo && tm ? tm.redRpsEst : 0,
        blueRpsEst: isMonteCarlo && tm ? tm.blueRpsEst : 0,
        redFloresTap: isMonteCarlo && tm ? tm.redFloresTap : 0,
        blueFloresTap: isMonteCarlo && tm ? tm.blueFloresTap : 0,
        redAutoConflict: isMonteCarlo && tm ? tm.redAutoConflict : redSummary.hasCollision,
        blueAutoConflict: isMonteCarlo && tm ? tm.blueAutoConflict : blueSummary.hasCollision,
      });
    }

    const levelRank = (lvl: string) => {
      if (lvl === 'QUALS') return 0;
      if (lvl === 'SEMIS') return 1;
      if (lvl === 'DOUBLEELIM') return 2;
      if (lvl === 'FINALS') return 3;
      return 4;
    };

    list.sort((a, b) => {
      const la = levelRank(a.level);
      const lb = levelRank(b.level);
      if (la !== lb) return la - lb;
      if (a.level !== b.level) return a.level.localeCompare(b.level);
      return a.matchNum - b.matchNum;
    });

    return list;
  }, [
    timestoneMatches,
    timestoneRosterMismatch,
    scheduleMatches,
    teamMap,
    tsTeamMap,
    loadedEvent?.timezone,
    includeDateInTime,
  ]);

  const myMatches = useMemo(() => {
    if (!myTeam) return [];
    return unifiedMatches.filter(
      (m) => m.redTeams.includes(myTeam) || m.blueTeams.includes(myTeam)
    );
  }, [unifiedMatches, myTeam]);

  const nextMyMatch = useMemo(
    () => myMatches.find((m) => !m.played) || myMatches[0] || null,
    [myMatches]
  );

  // Auto-expand next match of myTeam on first load if nothing expanded yet
  useEffect(() => {
    if (nextMyMatch && expandedKeys.size === 0) {
      setExpandedKeys(new Set([nextMyMatch.key]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextMyMatch?.key]);

  const myRecordStats = useMemo(() => {
    let projWins = 0;
    let projLosses = 0;
    for (const m of myMatches) {
      const inRed = m.redTeams.includes(myTeam);
      if (m.played && m.redReal !== null && m.blueReal !== null) {
        if ((inRed && m.redReal > m.blueReal) || (!inRed && m.blueReal > m.redReal)) projWins += 1;
        else if (m.redReal !== m.blueReal) projLosses += 1;
      } else if (m.hasProjection) {
        const myWinPct = inRed ? m.redWinPct : m.blueWinPct;
        if (myWinPct >= 50) projWins += 1;
        else projLosses += 1;
      }
    }
    return { projWins, projLosses };
  }, [myMatches, myTeam]);

  const filteredMatches = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    return unifiedMatches.filter((m) => {
      if (filter === 'pending' && m.played) return false;
      if (filter === 'played' && !m.played) return false;
      if (filter === 'mine' && !m.redTeams.includes(myTeam) && !m.blueTeams.includes(myTeam)) {
        return false;
      }
      if (q) {
        const haystack = `${m.label} ${m.matchNum} ${m.redTeams.join(' ')} ${m.blueTeams.join(' ')}`.toUpperCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [unifiedMatches, filter, myTeam, searchQuery]);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allFilteredExpanded =
    filteredMatches.length > 0 && filteredMatches.every((m) => expandedKeys.has(m.key));

  const toggleExpandAll = () => {
    if (allFilteredExpanded) {
      setExpandedKeys(new Set());
    } else {
      setExpandedKeys(new Set(filteredMatches.map((m) => m.key)));
    }
  };

  const playedCount = unifiedMatches.filter((m) => m.played).length;
  const pendingCount = unifiedMatches.length - playedCount;
  const mcCount = unifiedMatches.filter((m) => m.isMonteCarlo).length;

  // Manual 2v2 Sandbox projections
  const manualRedProj = summarizeAlliance([manualRed1, manualRed2], teamMap, tsTeamMap);
  const manualBlueProj = summarizeAlliance([manualBlue1, manualBlue2], teamMap, tsTeamMap);
  const manualRedPct = logisticRedWinPct(manualRedProj.net, manualBlueProj.net);
  const manualMarkers: FieldMarker[] = [
    ...manualRedProj.members.map((m, idx) => ({
      slot: `R${idx + 1}`,
      team: m.team,
      startPos: m.topStartPos,
      alliance: 'red' as const,
    })),
    ...manualBlueProj.members.map((m, idx) => ({
      slot: `A${idx + 1}`,
      team: m.team,
      startPos: m.topStartPos,
      alliance: 'blue' as const,
    })),
  ].filter((m) => m.startPos && m.startPos !== '—');

  const getMyWinBadge = (m: UnifiedMatch | null) => {
    if (!m) return null;
    const inRed = m.redTeams.includes(myTeam);
    const pct = inRed ? m.redWinPct : m.blueWinPct;
    return { inRed, pct };
  };
  const nextBadge = getMyWinBadge(nextMyMatch);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* ================= KPI DECK ================= */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Matches en Horario</span>
          <span className="kpi-value tabular">{unifiedMatches.length}</span>
          <span className="kpi-sub tabular">
            {unifiedMatches.length > 0
              ? `${playedCount} jugados • ${pendingCount} pendientes`
              : eventTeams.length > 0
                ? `${eventTeams.length} equipos registrados`
                : 'Sin matches publicados'}
          </span>
        </div>

        <div className="kpi-card" style={{ borderTopColor: 'var(--accent-amber)' }}>
          <span className="kpi-label">Próximo Match (#{myTeam || '—'})</span>
          <span className="kpi-value tabular" style={{ color: 'var(--accent-amber)' }}>
            {nextMyMatch ? nextMyMatch.label : '—'}
          </span>
          <span className="kpi-sub tabular">
            {nextMyMatch && nextBadge
              ? `${nextMyMatch.scheduledTime ? `${nextMyMatch.scheduledTime} • ` : ''}${nextBadge.inRed ? 'Roja' : 'Azul'}${nextMyMatch.hasProjection ? ` (${nextBadge.pct.toFixed(0)}% Win)` : ''}`
              : 'Sin partido próximo'}
          </span>
        </div>

        <div className="kpi-card" style={{ borderTopColor: 'var(--accent-emerald)' }}>
          <span className="kpi-label">Marca Proyectada (#{myTeam || '—'})</span>
          <span className="kpi-value tabular" style={{ color: 'var(--accent-emerald)' }}>
            {myMatches.length > 0 ? `${myRecordStats.projWins}–${myRecordStats.projLosses}` : '—'}
          </span>
          <span className="kpi-sub tabular">{myMatches.length} partidos asignados</span>
        </div>

        <div className="kpi-card" style={{ borderTopColor: 'var(--bey-cyan)' }}>
          <span className="kpi-label">Motor de Probabilidad</span>
          <span className="kpi-value tabular" style={{ fontSize: '20px', color: 'var(--bey-cyan)', paddingTop: '4px' }}>
            {mcCount > 0 ? 'Monte Carlo' : unifiedMatches.length > 0 ? 'Estimado EPA' : 'Sin Horario'}
          </span>
          <span className="kpi-sub tabular">
            {mcCount > 0
              ? `${mcCount}/${unifiedMatches.length} simulados (${activeEventCode})`
              : loadedEvent
                ? `${loadedEvent.code} (${loadedEvent.season})`
                : 'Carga evento en FTCScout'}
          </span>
        </div>
      </section>

      {/* ================= TOOLBAR: MI EQUIPO, FILTROS & FTCSCOUT ================= */}
      <div className="filter-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--accent-amber)', textTransform: 'uppercase' }}>
              Mi Equipo #
            </span>
            <input
              type="number"
              min={1}
              value={myTeam || ''}
              onChange={(e) => handleMyTeamChange(Number(e.target.value) || 0)}
              className="input-rag tabular"
              style={{ width: '76px', padding: '6px 8px' }}
            />
          </div>

          <input
            type="text"
            placeholder="Buscar Q12 o #equipo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-rag tabular"
            style={{ width: '165px', padding: '6px 10px' }}
          />

          {(
            [
              { id: 'all', label: `Todos (${unifiedMatches.length})` },
              { id: 'pending', label: `Pendientes (${pendingCount})` },
              { id: 'played', label: `Jugados (${playedCount})` },
              { id: 'mine', label: `★ #${myTeam || '?'} (${myMatches.length})` },
            ] as { id: ScheduleFilter; label: string }[]
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`btn-ghost tabular ${filter === f.id ? 'active' : ''}`}
              style={{ padding: '6px 10px', fontSize: '11.5px' }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <select
            value={eventSeason}
            onChange={(e) => onChangeEventSeason(Number(e.target.value))}
            className="select-rag tabular"
            style={{ padding: '6px 8px', fontSize: '11.5px' }}
          >
            <option value={2026}>2026</option>
            <option value={2025}>2025</option>
          </select>
          <input
            type="text"
            placeholder="Código FTCScout (ej. MXTLQ)"
            value={eventCodeInput}
            onChange={(e) => onChangeEventCodeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onLoadEvent();
            }}
            className="input-rag"
            style={{ width: '165px', padding: '6px 10px', fontSize: '11.5px' }}
          />
          <button
            type="button"
            onClick={onLoadEvent}
            disabled={loadingEvent}
            className="btn-rag"
            style={{ padding: '6px 11px', fontSize: '11.5px' }}
          >
            {loadingEvent ? '...' : 'Cargar Horario'}
          </button>

          {filteredMatches.length > 0 && (
            <button
              type="button"
              onClick={toggleExpandAll}
              className="btn-ghost"
              style={{ padding: '6px 10px', fontSize: '11.5px' }}
            >
              {allFilteredExpanded ? 'Contraer' : 'Expandir'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowManualSandbox((v) => !v)}
            className={`btn-ghost ${showManualSandbox ? 'active' : ''}`}
            style={{ padding: '6px 10px', fontSize: '11.5px' }}
          >
            + 2v2 Manual
          </button>
        </div>

        {eventError && <div style={{ width: '100%', fontSize: '11px', color: 'var(--rag-coral)' }}>{eventError}</div>}
      </div>

      {/* ================= SANDBOX MANUAL 2v2 OPCIONAL ================= */}
      {showManualSandbox && (
        <div className="panel" style={{ borderTop: '3px solid var(--bey-purple)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="panel-header" style={{ marginBottom: 0 }}>
            <span className="panel-title">Simulador Rápido 2v2 Manual</span>
            <div className="tabular" style={{ display: 'flex', gap: '12px', fontSize: '12px', fontWeight: 900 }}>
              <span style={{ color: 'var(--rag-crimson)' }}>ROJA: {manualRedProj.net.toFixed(1)} ({manualRedPct.toFixed(0)}%)</span>
              <span style={{ color: 'var(--accent-cyan)' }}>AZUL: {manualBlueProj.net.toFixed(1)} ({(100 - manualRedPct).toFixed(0)}%)</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
            {[
              { label: 'Rojo 1', val: manualRed1, set: setManualRed1, color: 'var(--rag-coral)' },
              { label: 'Rojo 2', val: manualRed2, set: setManualRed2, color: 'var(--rag-coral)' },
              { label: 'Azul 1', val: manualBlue1, set: setManualBlue1, color: 'var(--accent-cyan)' },
              { label: 'Azul 2', val: manualBlue2, set: setManualBlue2, color: 'var(--accent-cyan)' },
            ].map((s) => (
              <div key={s.label}>
                <div style={{ fontSize: '10px', color: s.color, fontWeight: 800, marginBottom: '4px' }}>{s.label}</div>
                <select value={s.val} onChange={(e) => s.set(Number(e.target.value))} className="select-rag tabular" style={{ width: '100%' }}>
                  <option value={0}>Elegir</option>
                  {teams.map((t) => (
                    <option key={t.team} value={t.team}>#{t.team} ({t.epaNetAvg.toFixed(1)})</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="split-2col">
            <DuelComparisonBars
              leftTitle="ROJA"
              rightTitle="AZUL"
              metrics={[
                { label: 'Auto Prom.', leftVal: manualRedProj.auto, rightVal: manualBlueProj.auto },
                { label: 'TeleOp Prom.', leftVal: manualRedProj.tele, rightVal: manualBlueProj.tele },
                { label: 'Balancín (P+N)', leftVal: manualRedProj.balancin, rightVal: manualBlueProj.balancin },
                { label: 'Flor (P+N)', leftVal: manualRedProj.flor, rightVal: manualBlueProj.flor },
                { label: 'Swarm Pts', leftVal: manualRedProj.swarmPts, rightVal: manualBlueProj.swarmPts },
                { label: 'Faltas', leftVal: manualRedProj.fouls, rightVal: manualBlueProj.fouls, lowerIsBetter: true },
              ]}
            />
            <div className="panel" style={{ padding: '12px' }}>
              <div className="panel-header" style={{ marginBottom: '8px' }}>
                <span className="panel-title">Posiciones Auto (Manual)</span>
              </div>
              <RagnarokFieldHeatmap markers={manualMarkers} />
            </div>
          </div>
        </div>
      )}

      {/* ================= LISTA EXPANDIBLE DE HORARIO ================= */}
      {filteredMatches.length === 0 ? (
        <div className="panel" style={{ padding: '28px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-silver)' }}>
            {loadedEvent && eventTeams.length > 0 && scheduleMatches.length === 0
              ? `${loadedEvent.code} (${loadedEvent.name}) no tiene matches publicados en FTCScout ${loadedEvent.season}.`
              : unifiedMatches.length === 0
                ? 'No hay horario de matches cargado todavía.'
                : 'Ningún match coincide con el filtro actual.'}
          </div>

          {timestoneRosterMismatch && (
            <div style={{ fontSize: '12px', color: 'var(--accent-amber)', maxWidth: '580px' }}>
              Se ocultaron {timestoneMatches.length} filas de Sheets porque no coinciden con los {eventTeams.length} equipos oficiales de {loadedEvent?.code}. Pulsa Timestone para limpiar esas pestañas.
            </div>
          )}

          {loadedEvent && eventTeams.length > 0 && scheduleMatches.length === 0 && (
            <div style={{ width: '100%', maxWidth: '780px', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--bey-cyan)', textTransform: 'uppercase' }}>
                Roster oficial FTCScout ({eventTeams.length} equipos)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
                {eventTeams.map((et) => (
                  <span
                    key={et.teamNumber}
                    className="tabular"
                    style={{
                      background: 'var(--bg-carbon)',
                      border: '1px solid var(--border-steel)',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      fontSize: '11px',
                      color: 'var(--text-silver)',
                      fontWeight: 700,
                    }}
                  >
                    <strong style={{ color: '#FFFFFF' }}>#{et.teamNumber}</strong> · {et.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="schedule-list">
          {filteredMatches.map((m) => {
            const isExpanded = expandedKeys.has(m.key);
            const hasMyTeam =
              myTeam > 0 && (m.redTeams.includes(myTeam) || m.blueTeams.includes(myTeam));
            const isNextMine = nextMyMatch?.key === m.key;

            const redSummary = isExpanded ? summarizeAlliance(m.redTeams, teamMap, tsTeamMap) : null;
            const blueSummary = isExpanded ? summarizeAlliance(m.blueTeams, teamMap, tsTeamMap) : null;

            const expandedMarkers: FieldMarker[] =
              isExpanded && redSummary && blueSummary
                ? [
                    ...redSummary.members.map((mem, idx) => ({
                      slot: `R${idx + 1}`,
                      team: mem.team,
                      startPos: mem.topStartPos,
                      alliance: 'red' as const,
                    })),
                    ...blueSummary.members.map((mem, idx) => ({
                      slot: `A${idx + 1}`,
                      team: mem.team,
                      startPos: mem.topStartPos,
                      alliance: 'blue' as const,
                    })),
                  ].filter((mk) => mk.startPos && mk.startPos !== '—')
                : [];

            return (
              <div key={m.key} className={`schedule-row-card ${hasMyTeam ? 'my-team-match' : ''}`}>
                {/* CABECERA COMPACTA CLICABLE */}
                <button
                  type="button"
                  onClick={() => toggleExpand(m.key)}
                  aria-expanded={isExpanded}
                  className="schedule-row-header"
                >
                  {/* Col 1: Match, Hora y Estado */}
                  <div className="tabular" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 900, color: hasMyTeam ? 'var(--accent-amber)' : '#FFFFFF' }}>
                        {m.label}
                      </span>
                      {m.scheduledTime && (
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-silver)' }}>
                          {m.scheduledTime}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span
                        style={{
                          fontSize: '9.5px',
                          fontWeight: 800,
                          padding: '1px 6px',
                          borderRadius: '3px',
                          background: m.played
                            ? 'rgba(16, 185, 129, 0.14)'
                            : isNextMine
                              ? 'rgba(255, 209, 102, 0.18)'
                              : 'rgba(148, 163, 184, 0.12)',
                          color: m.played
                            ? 'var(--accent-emerald)'
                            : isNextMine
                              ? 'var(--accent-amber)'
                              : 'var(--text-muted)',
                        }}
                      >
                        {m.played ? 'FINAL' : isNextMine ? 'PRÓXIMO ★' : 'PENDIENTE'}
                      </span>
                    </div>
                  </div>

                  {/* Col 2: Alianza Roja */}
                  <div className="tabular" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {m.redTeams.length === 0 ? (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>TBD</span>
                    ) : (
                      m.redTeams.map((tNum, idx) => {
                        const isMine = tNum > 0 && tNum === myTeam;
                        const tName = eventTeamNameMap.get(tNum) || teamMap.get(tNum)?.pit?.teamName || tsTeamMap.get(tNum)?.name;
                        return (
                          <span
                            key={`${tNum}-${idx}`}
                            title={tName ? `#${tNum} • ${tName}` : `#${tNum}`}
                            style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: 900,
                              background: isMine ? 'rgba(255, 209, 102, 0.18)' : 'rgba(225, 29, 72, 0.14)',
                              border: `1px solid ${isMine ? 'var(--accent-amber)' : 'rgba(225, 29, 72, 0.45)'}`,
                              color: isMine ? 'var(--accent-amber)' : '#FDA4AF',
                            }}
                          >
                            {isMine ? '★ ' : ''}#{tNum}
                          </span>
                        );
                      })
                    )}
                  </div>

                  {/* Col 3: Probabilidad de Ganar + Barra Dual */}
                  <div className="tabular" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontWeight: 900, gap: '6px' }}>
                      <span style={{ color: 'var(--rag-coral)' }}>
                        {m.hasProjection ? (
                          <>
                            {m.redWinPct.toFixed(0)}% <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>({m.redEst.toFixed(0)})</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </span>

                      <span
                        style={{
                          fontSize: '9.5px',
                          fontWeight: 800,
                          padding: '1px 6px',
                          borderRadius: '3px',
                          background: m.isMonteCarlo ? 'var(--bey-plum)' : 'rgba(56, 189, 248, 0.12)',
                          color: m.isMonteCarlo ? 'var(--bey-purple)' : 'var(--bey-cyan)',
                        }}
                      >
                        {m.played && m.redReal !== null && m.blueReal !== null
                          ? `REAL ${m.redReal}-${m.blueReal}`
                          : m.isMonteCarlo
                            ? 'MC'
                            : m.hasProjection
                              ? 'EPA'
                              : 'SIN SCOUT'}
                      </span>

                      <span style={{ color: 'var(--accent-cyan)' }}>
                        {m.hasProjection ? (
                          <>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>({m.blueEst.toFixed(0)})</span> {m.blueWinPct.toFixed(0)}%
                          </>
                        ) : (
                          '—'
                        )}
                      </span>
                    </div>

                    <div style={{ height: '7px', width: '100%', background: m.hasProjection ? 'var(--accent-cyan)' : 'var(--border-steel)', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
                      {m.hasProjection ? (
                        <>
                          <div style={{ width: `${m.redWinPct}%`, background: 'var(--rag-crimson)' }} />
                          {m.tiePct > 0 && <div style={{ width: `${m.tiePct}%`, background: 'var(--accent-amber)' }} />}
                        </>
                      ) : m.played && m.redReal !== null && m.blueReal !== null && m.redReal + m.blueReal > 0 ? (
                        <>
                          <div
                            style={{
                              width: `${(m.redReal / (m.redReal + m.blueReal)) * 100}%`,
                              background: 'var(--rag-crimson)',
                            }}
                          />
                          <div style={{ flex: 1, background: 'var(--accent-cyan)' }} />
                        </>
                      ) : null}
                    </div>

                    {(m.isMonteCarlo || m.redAutoConflict || m.blueAutoConflict) && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: 'var(--text-muted)', fontWeight: 700 }}>
                        <span>{m.isMonteCarlo ? `R: ${m.redRpsEst.toFixed(2)} xRP` : ''}</span>
                        {(m.redAutoConflict || m.blueAutoConflict) && (
                          <span style={{ color: 'var(--accent-amber)' }}>⚠ Choque Auto</span>
                        )}
                        <span>{m.isMonteCarlo ? `A: ${m.blueRpsEst.toFixed(2)} xRP` : ''}</span>
                      </div>
                    )}
                  </div>

                  {/* Col 4: Alianza Azul */}
                  <div className="tabular" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
                    {m.blueTeams.length === 0 ? (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>TBD</span>
                    ) : (
                      m.blueTeams.map((tNum, idx) => {
                        const isMine = tNum > 0 && tNum === myTeam;
                        const tName = eventTeamNameMap.get(tNum) || teamMap.get(tNum)?.pit?.teamName || tsTeamMap.get(tNum)?.name;
                        return (
                          <span
                            key={`${tNum}-${idx}`}
                            title={tName ? `#${tNum} • ${tName}` : `#${tNum}`}
                            style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: 900,
                              background: isMine ? 'rgba(255, 209, 102, 0.18)' : 'rgba(56, 189, 248, 0.14)',
                              border: `1px solid ${isMine ? 'var(--accent-amber)' : 'rgba(56, 189, 248, 0.45)'}`,
                              color: isMine ? 'var(--accent-amber)' : '#7DD3FC',
                            }}
                          >
                            {isMine ? '★ ' : ''}#{tNum}
                          </span>
                        );
                      })
                    )}
                  </div>

                  {/* Col 5: Chevron */}
                  <span style={{ textAlign: 'right', color: isExpanded ? 'var(--bey-cyan)' : 'var(--text-muted)', fontSize: '12px', fontWeight: 900 }}>
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </button>

                {/* DESGLOSE EXPANDIDO BAJO DEMANDA */}
                {isExpanded && redSummary && blueSummary && (
                  <div className="schedule-expanded-body">
                    {/* Strip resumen del partido */}
                    <div
                      className="tabular"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '10px',
                        background: 'var(--bg-graphite)',
                        border: '1px solid var(--border-steel)',
                        borderRadius: '6px',
                        padding: '10px 14px',
                        fontSize: '12px',
                        fontWeight: 800,
                      }}
                    >
                      <span style={{ color: 'var(--rag-coral)' }}>
                        {m.hasProjection
                          ? `ROJA EST: ${m.redEst.toFixed(1)} PTS (${m.redWinPct.toFixed(1)}%)`
                          : m.played && m.redReal !== null
                            ? `ROJA REAL: ${m.redReal} PTS`
                            : 'ROJA: Sin proyección'}
                        {m.isMonteCarlo ? ` • ${m.redRpsEst.toFixed(2)} xRP • ${m.redFloresTap.toFixed(1)} fl.` : ''}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                        {m.tiePct > 0 ? `Empate ${m.tiePct.toFixed(1)}% • ` : ''}
                        Swarm R {redSummary.swarmPts.toFixed(1)}/16 • A {blueSummary.swarmPts.toFixed(1)}/16
                      </span>
                      <span style={{ color: 'var(--accent-cyan)' }}>
                        {m.hasProjection
                          ? `AZUL EST: ${m.blueEst.toFixed(1)} PTS (${m.blueWinPct.toFixed(1)}%)`
                          : m.played && m.blueReal !== null
                            ? `AZUL REAL: ${m.blueReal} PTS`
                            : 'AZUL: Sin proyección'}
                        {m.isMonteCarlo ? ` • ${m.blueRpsEst.toFixed(2)} xRP • ${m.blueFloresTap.toFixed(1)} fl.` : ''}
                      </span>
                    </div>

                    {/* 2 Columnas de Robots */}
                    <div className="match-2col">
                      <div className="panel" style={{ borderTop: '3px solid var(--rag-crimson)' }}>
                        <div className="panel-header">
                          <span className="panel-title" style={{ color: 'var(--rag-coral)' }}>Alianza Roja</span>
                          <span className="tabular" style={{ fontSize: '11.5px', fontWeight: 800, color: redSummary.swarmPts >= 16 ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                            Swarm: {redSummary.swarmPts.toFixed(1)} / 16 pts
                          </span>
                        </div>
                        {redSummary.hasCollision && (
                          <div style={{ marginBottom: '10px', padding: '7px 10px', borderRadius: '4px', background: 'rgba(255, 209, 102, 0.14)', border: '1px solid var(--accent-amber)', fontSize: '11px', fontWeight: 700, color: 'var(--accent-amber)' }}>
                            Alerta Auto: ambos aliados rojos arrancan en Zona {redSummary.zones[0]}.
                          </div>
                        )}
                        <AllianceRobotDetailedCards
                          ids={m.redTeams}
                          teamMap={teamMap}
                          tsTeamMap={tsTeamMap}
                          eventTeamNameMap={eventTeamNameMap}
                          accent="var(--rag-crimson)"
                          myTeam={myTeam}
                          onSelect={onOpenTeamProfile}
                        />
                      </div>

                      <div className="panel" style={{ borderTop: '3px solid var(--accent-cyan)' }}>
                        <div className="panel-header">
                          <span className="panel-title" style={{ color: 'var(--accent-cyan)' }}>Alianza Azul</span>
                          <span className="tabular" style={{ fontSize: '11.5px', fontWeight: 800, color: blueSummary.swarmPts >= 16 ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                            Swarm: {blueSummary.swarmPts.toFixed(1)} / 16 pts
                          </span>
                        </div>
                        {blueSummary.hasCollision && (
                          <div style={{ marginBottom: '10px', padding: '7px 10px', borderRadius: '4px', background: 'rgba(255, 209, 102, 0.14)', border: '1px solid var(--accent-amber)', fontSize: '11px', fontWeight: 700, color: 'var(--accent-amber)' }}>
                            Alerta Auto: ambos aliados azules arrancan en Zona {blueSummary.zones[0]}.
                          </div>
                        )}
                        <AllianceRobotDetailedCards
                          ids={m.blueTeams}
                          teamMap={teamMap}
                          tsTeamMap={tsTeamMap}
                          eventTeamNameMap={eventTeamNameMap}
                          accent="var(--accent-cyan)"
                          myTeam={myTeam}
                          onSelect={onOpenTeamProfile}
                        />
                      </div>
                    </div>

                    {/* Comparativa + Mapa de Cancha 6x6 */}
                    <div className="split-2col">
                      <DuelComparisonBars
                        leftTitle="ROJA"
                        rightTitle="AZUL"
                        metrics={[
                          { label: 'Auto Prom.', leftVal: redSummary.auto, rightVal: blueSummary.auto },
                          { label: 'TeleOp Prom.', leftVal: redSummary.tele, rightVal: blueSummary.tele },
                          { label: 'Balancín (P+N)', leftVal: redSummary.balancin, rightVal: blueSummary.balancin },
                          { label: 'Flor (P+N)', leftVal: redSummary.flor, rightVal: blueSummary.flor },
                          { label: 'Garden', leftVal: redSummary.garden, rightVal: blueSummary.garden },
                          { label: 'Swarm Pts', leftVal: redSummary.swarmPts, rightVal: blueSummary.swarmPts },
                          ...(redSummary.combinedOpr !== null && blueSummary.combinedOpr !== null
                            ? [{ label: 'OPR Combinado', leftVal: redSummary.combinedOpr, rightVal: blueSummary.combinedOpr }]
                            : []),
                          { label: 'Faltas', leftVal: redSummary.fouls, rightVal: blueSummary.fouls, lowerIsBetter: true },
                        ]}
                      />

                      <div className="panel">
                        <div className="panel-header">
                          <span className="panel-title">Posiciones Esperadas en Auto</span>
                        </div>
                        <RagnarokFieldHeatmap markers={expandedMarkers} />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => onSendToAllianceSim(m.red1, m.red2, m.blue1, m.blue2)}
                        className="btn-ghost"
                        style={{ borderColor: 'rgba(168, 85, 247, 0.5)', color: '#E9D5FF', fontSize: '11.5px' }}
                      >
                        Abrir en Simulador Alianzas →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
