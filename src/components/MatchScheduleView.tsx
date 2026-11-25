'use client';

import React, { useEffect, useMemo, useState } from 'react';
import DuelComparisonBars from '@/components/DuelComparisonBars';
import RagnarokFieldHeatmap, { type FieldMarker } from '@/components/RagnarokFieldHeatmap';
import { detectRobotRole } from '@/lib/roles';
import type { ScheduleMatch, TeamAnalytics, TimestoneMatchSim } from '@/lib/types';

const MY_TEAM_STORAGE_KEY = 'beyonder_my_team_v1';

type ScheduleFilter = 'all' | 'pending' | 'played' | 'mine';

interface UnifiedMatch {
  key: string;
  matchNum: number;
  level: string;
  label: string;
  scheduledTime: string | null;
  red1: number;
  red2: number;
  blue1: number;
  blue2: number;
  played: boolean;
  redReal: number | null;
  blueReal: number | null;
  isMonteCarlo: boolean;
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

function normalizeLevel(raw: string | undefined | null): string {
  const up = String(raw || 'QUALS').trim().toUpperCase();
  if (up === 'QUALIFICATION' || up === 'QUALS' || up === 'QM') return 'QUALS';
  return up || 'QUALS';
}

function formatMatchTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function logisticRedWinPct(redNet: number, blueNet: number): number {
  const diff = redNet - blueNet;
  const raw = (1 / (1 + Math.exp(-diff / 14))) * 100;
  return Math.round(Math.max(3, Math.min(97, raw)) * 10) / 10;
}

function summarizeAlliance(ids: number[], teamMap: Map<number, TeamAnalytics>) {
  const members = ids
    .filter((id) => id > 0)
    .map((id) => teamMap.get(id))
    .filter((t): t is TeamAnalytics => !!t);

  const sum = (fn: (t: TeamAnalytics) => number) =>
    Math.round(members.reduce((acc, t) => acc + fn(t), 0) * 10) / 10;

  const zones = members.map((m) => m.topStartPos).filter((z) => z && z !== '—');
  const hasCollision = zones.length >= 2 && new Set(zones).size < zones.length;
  const oprMembers = members.filter((m) => m.timestone?.opr != null);
  const combinedOpr =
    oprMembers.length > 0
      ? Math.round(oprMembers.reduce((s, m) => s + (m.timestone?.opr ?? 0), 0) * 10) / 10
      : null;

  return {
    members,
    auto: sum((t) => t.autoAvg),
    tele: sum((t) => t.teleAvg),
    fouls: sum((t) => t.foulsAvg),
    net: Math.round((sum((t) => t.autoAvg) + sum((t) => t.teleAvg) - sum((t) => t.foulsAvg)) * 10) / 10,
    balancin: sum((t) => t.balancinAutoAvg + t.balancinTeleAvg),
    flor: sum((t) => t.florAvg),
    garden: sum((t) => t.gardenAvg),
    swarmPts: sum((t) => t.swarmPtsAvg),
    combinedOpr,
    hasCollision,
    zones,
  };
}

function AllianceRobotDetailedCards({
  ids,
  teamMap,
  accent,
  myTeam,
  onSelect,
}: {
  ids: number[];
  teamMap: Map<number, TeamAnalytics>;
  accent: string;
  myTeam: number;
  onSelect: (teamNum: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {ids.map((id, idx) => {
        const m = teamMap.get(id);
        if (!m) {
          return (
            <div
              key={`${id}-${idx}`}
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
              #{id || '?'} • Sin datos en Scouting todavía
            </div>
          );
        }

        const roleMeta = detectRobotRole(m);
        const thumb = m.pit?.photos?.[0];
        const isMine = id === myTeam;
        const name = m.pit?.teamName || m.timestone?.name;

        return (
          <div
            key={m.team}
            onClick={() => onSelect(m.team)}
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
                  alt={`#${m.team}`}
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
                    {isMine ? '★ ' : ''}#{m.team}
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
                  Auto Zona <strong style={{ color: 'var(--text-silver)' }}>{m.topStartPos}</strong> • EPA{' '}
                  <strong style={{ color: 'var(--bey-purple)' }}>{m.epaNetAvg.toFixed(1)}</strong>
                  {m.timestone?.opr != null && (
                    <>
                      {' '}• OPR <strong style={{ color: 'var(--bey-cyan)' }}>{m.timestone.opr.toFixed(1)}</strong> / DPR{' '}
                      <strong style={{ color: 'var(--accent-emerald)' }}>{m.timestone.dpr?.toFixed(1) ?? '—'}</strong>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', fontWeight: 700, flexWrap: 'wrap', alignItems: 'center', fontSize: '11.5px' }}>
              <span style={{ color: '#E2E8F0' }}>A {m.autoAvg.toFixed(1)}</span>
              <span style={{ color: '#E2E8F0' }}>T {m.teleAvg.toFixed(1)}</span>
              <span style={{ color: '#60A5FA' }}>Bal {(m.balancinAutoAvg + m.balancinTeleAvg).toFixed(1)}</span>
              <span style={{ color: '#FB7185' }}>Flor {m.florAvg.toFixed(1)}</span>
              <span style={{ color: '#34D399' }}>Gar {m.gardenAvg.toFixed(1)}</span>
              <span style={{ color: m.reliabilityPct >= 90 ? '#34D399' : m.reliabilityPct < 70 ? '#FCA5A5' : '#FFD166' }}>
                {m.reliabilityPct.toFixed(0)}% Op
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
  scheduleMatches,
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
  scheduleMatches: ScheduleMatch[];
  activeEventCode: string;
  loadedEvent: { code: string; name: string; season: number } | null;
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

  // Unify Timestone simulations + FTCScout schedule (with timestamps)
  const unifiedMatches = useMemo<UnifiedMatch[]>(() => {
    const tsByKey = new Map<string, TimestoneMatchSim>();
    for (const tm of timestoneMatches) {
      const lvl = normalizeLevel(tm.nivel);
      tsByKey.set(`${lvl}#${tm.match}`, tm);
    }

    const schedByKey = new Map<string, ScheduleMatch>();
    for (const sm of scheduleMatches) {
      const lvl = normalizeLevel(sm.tournamentLevel);
      schedByKey.set(`${lvl}#${sm.matchNum}`, sm);
    }

    const allKeys = Array.from(new Set([...tsByKey.keys(), ...schedByKey.keys()]));
    const list: UnifiedMatch[] = [];

    for (const key of allKeys) {
      const tm = tsByKey.get(key);
      const sm = schedByKey.get(key);

      const level = tm ? normalizeLevel(tm.nivel) : normalizeLevel(sm?.tournamentLevel);
      const matchNum = tm ? tm.match : sm?.matchNum || 0;
      if (!matchNum) continue;

      const smRed1 = sm?.teams.find((t) => t.alliance === 'Red' && t.station === 'One')?.teamNumber || 0;
      const smRed2 = sm?.teams.find((t) => t.alliance === 'Red' && t.station === 'Two')?.teamNumber || 0;
      const smBlue1 = sm?.teams.find((t) => t.alliance === 'Blue' && t.station === 'One')?.teamNumber || 0;
      const smBlue2 = sm?.teams.find((t) => t.alliance === 'Blue' && t.station === 'Two')?.teamNumber || 0;

      const red1 = tm?.red1 || smRed1;
      const red2 = tm?.red2 || smRed2;
      const blue1 = tm?.blue1 || smBlue1;
      const blue2 = tm?.blue2 || smBlue2;

      const redSummary = summarizeAlliance([red1, red2], teamMap);
      const blueSummary = summarizeAlliance([blue1, blue2], teamMap);

      const fallbackRedPct = logisticRedWinPct(redSummary.net, blueSummary.net);
      const scheduledTime = formatMatchTime(sm?.scheduledStartTime || sm?.actualStartTime);
      const labelPrefix = level === 'QUALS' ? 'Q' : level.slice(0, 1);

      const played = Boolean(tm?.jugado || sm?.hasBeenPlayed);

      list.push({
        key,
        matchNum,
        level,
        label: `${labelPrefix}${matchNum}`,
        scheduledTime,
        red1,
        red2,
        blue1,
        blue2,
        played,
        redReal: tm?.redReal ?? null,
        blueReal: tm?.blueReal ?? null,
        isMonteCarlo: Boolean(tm),
        redEst: tm ? tm.redEst : redSummary.net,
        blueEst: tm ? tm.blueEst : blueSummary.net,
        redWinPct: tm ? tm.redWinPct : fallbackRedPct,
        blueWinPct: tm ? tm.blueWinPct : Math.round((100 - fallbackRedPct) * 10) / 10,
        tiePct: tm ? tm.tiePct : 0,
        redRpsEst: tm ? tm.redRpsEst : 0,
        blueRpsEst: tm ? tm.blueRpsEst : 0,
        redFloresTap: tm ? tm.redFloresTap : 0,
        blueFloresTap: tm ? tm.blueFloresTap : 0,
        redAutoConflict: tm ? tm.redAutoConflict : redSummary.hasCollision,
        blueAutoConflict: tm ? tm.blueAutoConflict : blueSummary.hasCollision,
      });
    }

    list.sort((a, b) => {
      if (a.level === 'QUALS' && b.level !== 'QUALS') return -1;
      if (a.level !== 'QUALS' && b.level === 'QUALS') return 1;
      if (a.level !== b.level) return a.level.localeCompare(b.level);
      return a.matchNum - b.matchNum;
    });

    return list;
  }, [timestoneMatches, scheduleMatches, teamMap]);

  const myMatches = useMemo(() => {
    if (!myTeam) return [];
    return unifiedMatches.filter(
      (m) => m.red1 === myTeam || m.red2 === myTeam || m.blue1 === myTeam || m.blue2 === myTeam
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
      const inRed = m.red1 === myTeam || m.red2 === myTeam;
      if (m.played && m.redReal !== null && m.blueReal !== null) {
        if ((inRed && m.redReal > m.blueReal) || (!inRed && m.blueReal > m.redReal)) projWins += 1;
        else if (m.redReal !== m.blueReal) projLosses += 1;
      } else {
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
      if (
        filter === 'mine' &&
        m.red1 !== myTeam &&
        m.red2 !== myTeam &&
        m.blue1 !== myTeam &&
        m.blue2 !== myTeam
      ) {
        return false;
      }
      if (q) {
        const haystack = `${m.label} ${m.matchNum} ${m.red1} ${m.red2} ${m.blue1} ${m.blue2}`.toUpperCase();
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
  const manualRedProj = summarizeAlliance([manualRed1, manualRed2], teamMap);
  const manualBlueProj = summarizeAlliance([manualBlue1, manualBlue2], teamMap);
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
    const inRed = m.red1 === myTeam || m.red2 === myTeam;
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
            {playedCount} jugados • {pendingCount} pendientes
          </span>
        </div>

        <div className="kpi-card" style={{ borderTopColor: 'var(--accent-amber)' }}>
          <span className="kpi-label">Próximo Match (#{myTeam || '—'})</span>
          <span className="kpi-value tabular" style={{ color: 'var(--accent-amber)' }}>
            {nextMyMatch ? nextMyMatch.label : '—'}
          </span>
          <span className="kpi-sub tabular">
            {nextMyMatch && nextBadge
              ? `${nextMyMatch.scheduledTime ? `${nextMyMatch.scheduledTime} • ` : ''}${nextBadge.inRed ? 'Roja' : 'Azul'} (${nextBadge.pct.toFixed(0)}% Win)`
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
            placeholder="Código FTCScout (ej. MXTO)"
            value={eventCodeInput}
            onChange={(e) => onChangeEventCodeInput(e.target.value)}
            className="input-rag"
            style={{ width: '155px', padding: '6px 10px', fontSize: '11.5px' }}
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
        <div className="panel" style={{ padding: '32px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-silver)' }}>
            {unifiedMatches.length === 0
              ? 'No hay horario de matches cargado todavía.'
              : 'Ningún match coincide con el filtro actual.'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '520px' }}>
            {unifiedMatches.length === 0
              ? 'Selecciona un evento con simulación Timestone o ingresa el código de evento arriba y pulsa "Cargar Horario" para traer los horarios oficiales desde FTCScout.'
              : 'Prueba cambiar a "Todos" o limpiar la búsqueda.'}
          </div>
        </div>
      ) : (
        <div className="schedule-list">
          {filteredMatches.map((m) => {
            const isExpanded = expandedKeys.has(m.key);
            const hasMyTeam =
              myTeam > 0 && (m.red1 === myTeam || m.red2 === myTeam || m.blue1 === myTeam || m.blue2 === myTeam);
            const isNextMine = nextMyMatch?.key === m.key;

            const redSummary = isExpanded ? summarizeAlliance([m.red1, m.red2], teamMap) : null;
            const blueSummary = isExpanded ? summarizeAlliance([m.blue1, m.blue2], teamMap) : null;

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
                    {[m.red1, m.red2].map((tNum, idx) => {
                      const isMine = tNum > 0 && tNum === myTeam;
                      return (
                        <span
                          key={`${tNum}-${idx}`}
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
                          {isMine ? '★ ' : ''}#{tNum || '?'}
                        </span>
                      );
                    })}
                  </div>

                  {/* Col 3: Probabilidad de Ganar + Barra Dual */}
                  <div className="tabular" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontWeight: 900, gap: '6px' }}>
                      <span style={{ color: 'var(--rag-coral)' }}>
                        {m.redWinPct.toFixed(0)}% <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>({m.redEst.toFixed(0)})</span>
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
                            : 'EPA'}
                      </span>

                      <span style={{ color: 'var(--accent-cyan)' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>({m.blueEst.toFixed(0)})</span> {m.blueWinPct.toFixed(0)}%
                      </span>
                    </div>

                    <div style={{ height: '7px', width: '100%', background: 'var(--accent-cyan)', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${m.redWinPct}%`, background: 'var(--rag-crimson)' }} />
                      {m.tiePct > 0 && <div style={{ width: `${m.tiePct}%`, background: 'var(--accent-amber)' }} />}
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
                    {[m.blue1, m.blue2].map((tNum, idx) => {
                      const isMine = tNum > 0 && tNum === myTeam;
                      return (
                        <span
                          key={`${tNum}-${idx}`}
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
                          {isMine ? '★ ' : ''}#{tNum || '?'}
                        </span>
                      );
                    })}
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
                        ROJA EST: {m.redEst.toFixed(1)} PTS ({m.redWinPct.toFixed(1)}%)
                        {m.isMonteCarlo ? ` • ${m.redRpsEst.toFixed(2)} xRP • ${m.redFloresTap.toFixed(1)} fl.` : ''}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                        {m.tiePct > 0 ? `Empate ${m.tiePct.toFixed(1)}% • ` : ''}
                        Swarm R {redSummary.swarmPts.toFixed(1)}/16 • A {blueSummary.swarmPts.toFixed(1)}/16
                      </span>
                      <span style={{ color: 'var(--accent-cyan)' }}>
                        AZUL EST: {m.blueEst.toFixed(1)} PTS ({m.blueWinPct.toFixed(1)}%)
                        {m.isMonteCarlo ? ` • ${m.blueRpsEst.toFixed(2)} xRP • ${m.blueFloresTap.toFixed(1)} fl.` : ''}
                      </span>
                    </div>

                    {/* 2 Columnas de Robots */}
                    <div className="match-2col">
                      <div className="panel" style={{ borderTop: '3px solid var(--rag-crimson)' }}>
                        <div className="panel-header">
                          <span className="panel-title" style={{ color: 'var(--rag-coral)' }}>Alianza Roja (R1 + R2)</span>
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
                          ids={[m.red1, m.red2]}
                          teamMap={teamMap}
                          accent="var(--rag-crimson)"
                          myTeam={myTeam}
                          onSelect={onOpenTeamProfile}
                        />
                      </div>

                      <div className="panel" style={{ borderTop: '3px solid var(--accent-cyan)' }}>
                        <div className="panel-header">
                          <span className="panel-title" style={{ color: 'var(--accent-cyan)' }}>Alianza Azul (A1 + A2)</span>
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
                          ids={[m.blue1, m.blue2]}
                          teamMap={teamMap}
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
                          <span className="panel-title">Posiciones Esperadas en Auto (4 Robots)</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>Amarillo = Empalme</span>
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
