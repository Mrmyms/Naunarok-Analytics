'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DistributionBars from '@/components/DistributionBars';
import DuelComparisonBars from '@/components/DuelComparisonBars';
import RagnarokFieldHeatmap, { FieldMarker } from '@/components/RagnarokFieldHeatmap';
import TeamHistoricChart from '@/components/TeamHistoricChart';
import TeamRadarChart from '@/components/TeamRadarChart';
import {
  detectRobotRole,
  NEXT_PICK_TAG,
  PICK_TAG_META,
  type PickTag,
  type RobotRole,
} from '@/lib/roles';
import type { AnalyticsPayload, ScheduleMatch, TeamAnalytics } from '@/lib/types';

type ViewTab = 'ranking' | 'equipo' | 'match' | 'alianza' | 'standings';
type SortKey =
  | 'rank'
  | 'team'
  | 'matchesPlayed'
  | 'epaNetAvg'
  | 'autoAvg'
  | 'teleAvg'
  | 'balancinAutoAvg'
  | 'balancinTeleAvg'
  | 'florAvg'
  | 'gardenAvg'
  | 'flowerControlPct'
  | 'reliabilityPct'
  | 'foulsAvg'
  | 'driverAvg'
  | 'maxNet';

const EVENT_STORAGE_KEY = 'ragnarok_analytics_event_v1';
const PICK_TAGS_STORAGE_KEY = 'ragnarok_pick_tags_v1';

export default function RagnarokAnalyticsPage() {
  const [tab, setTab] = useState<ViewTab>('ranking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null);

  // Ranking filters & picklist state
  const [searchTeam, setSearchTeam] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | RobotRole>('ALL');
  const [onlyReliable, setOnlyReliable] = useState(false);
  const [onlyLowFouls, setOnlyLowFouls] = useState(false);
  const [hideDrafted, setHideDrafted] = useState(false);
  const [prioritizeTop, setPrioritizeTop] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortAsc, setSortAsc] = useState(true);
  const [pickTags, setPickTags] = useState<Record<number, PickTag>>({});

  // Team Profile + 1v1 Compare state
  const [selectedTeamNum, setSelectedTeamNum] = useState<number>(0);
  const [compareTeamNum, setCompareTeamNum] = useState<number>(0);

  // Match 2v2 Breakdown state
  const [matchNum, setMatchNum] = useState<number>(1);
  const [red1, setRed1] = useState<number>(0);
  const [red2, setRed2] = useState<number>(0);
  const [blue1, setBlue1] = useState<number>(0);
  const [blue2, setBlue2] = useState<number>(0);

  // Alliance Playoffs Simulator (2 starters + optional backup)
  const [allyCap, setAllyCap] = useState<number>(0);
  const [allyPick1, setAllyPick1] = useState<number>(0);
  const [allySub, setAllySub] = useState<number>(0);
  const [opp1, setOpp1] = useState<number>(0);
  const [opp2, setOpp2] = useState<number>(0);
  const [oppSub, setOppSub] = useState<number>(0);

  // Optional FTCScout / Timestone dynamic event selector
  const [eventCodeInput, setEventCodeInput] = useState('');
  const [eventSeason, setEventSeason] = useState(2026);
  const [loadedEvent, setLoadedEvent] = useState<{ code: string; name: string; season: number } | null>(null);
  const [scheduleMatches, setScheduleMatches] = useState<ScheduleMatch[]>([]);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [searchingEvents, setSearchingEvents] = useState(false);
  const [eventSearchResults, setEventSearchResults] = useState<
    { code: string; name: string; regionCode?: string; start?: string }[]
  >([]);

  // Timestone refresh & staleness (>1h) control
  const [timestoneRefreshing, setTimestoneRefreshing] = useState(false);
  const [timestoneStatusMsg, setTimestoneStatusMsg] = useState<string | null>(null);
  const autoTriggeredEventsRef = useRef<Set<string>>(new Set());
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadedEventRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    loadedEventRef.current = loadedEvent?.code;
  }, [loadedEvent]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchAnalytics = useCallback(async (eventOverride?: string): Promise<AnalyticsPayload | null> => {
    setLoading(true);
    setError(null);
    try {
      const targetEvent = eventOverride || loadedEventRef.current;
      const qs = targetEvent ? `?event=${encodeURIComponent(targetEvent)}` : '';
      const res = await fetch(`/api/analytics${qs}`, { cache: 'no-store' });
      const data: AnalyticsPayload = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error obteniendo analíticas');
      }
      setPayload(data);
      if (data.teams.length > 0) {
        setSelectedTeamNum((prev) => (prev && data.teams.some((t) => t.team === prev) ? prev : data.teams[0].team));
        setRed1((prev) => prev || data.teams[0]?.team || 0);
        setRed2((prev) => prev || data.teams[1]?.team || data.teams[0]?.team || 0);
        setBlue1((prev) => prev || data.teams[2]?.team || data.teams[0]?.team || 0);
        setBlue2((prev) => prev || data.teams[3]?.team || data.teams[1]?.team || 0);
        setAllyCap((prev) => prev || data.teams[0]?.team || 0);
        setAllyPick1((prev) => prev || data.teams[1]?.team || 0);
        setOpp1((prev) => prev || data.teams[2]?.team || data.teams[0]?.team || 0);
        setOpp2((prev) => prev || data.teams[3]?.team || data.teams[1]?.team || 0);
      }
      return data;
    } catch (err: any) {
      setError(err.message || 'Error de red');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerTimestoneRefresh = useCallback(
    async (eventOverride?: string, isAuto = false) => {
      const targetEvent = (
        eventOverride ||
        loadedEventRef.current ||
        payload?.timestone?.eventCode ||
        ''
      )
        .trim()
        .toUpperCase();

      if (!targetEvent) {
        setShowEventPicker(true);
        setTimestoneStatusMsg('Elige o busca un evento antes de ejecutar Timestone.');
        return;
      }

      const prevUpdatedAt = payload?.timestone?.updatedAt ?? null;

      setTimestoneRefreshing(true);
      setTimestoneStatusMsg(
        isAuto
          ? `Datos Timestone (${targetEvent}) con más de 1h sin actualizar; ejecutando actualización automática...`
          : `Lanzando actualización Timestone (${targetEvent})...`
      );

      try {
        const res = await fetch('/api/timestone/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventCode: targetEvent,
            season: eventSeason,
            force: !isAuto,
          }),
        });
        const json = await res.json();

        if (!res.ok || !json.success) {
          if (res.status === 501 && isAuto) {
            setTimestoneStatusMsg(null);
            return;
          }
          throw new Error(json.error || 'No se pudo iniciar la actualización de Timestone');
        }

        if (json.mode === 'local-python') {
          setTimestoneStatusMsg(`Timestone (${targetEvent}) actualizado localmente.`);
          await fetchAnalytics(targetEvent);
          setTimestoneRefreshing(false);
          return;
        }

        // GitHub Actions u otro runner asíncrono: hacer polling acotado hasta detectar nuevo Updated_At
        setTimestoneStatusMsg(json.message || `Sincronizando Timestone (${targetEvent})...`);
        stopPolling();
        let attempts = 0;
        pollTimerRef.current = setInterval(async () => {
          attempts += 1;
          const fresh = await fetchAnalytics(targetEvent);
          const nextTs = fresh?.timestone?.updatedAt ?? null;
          const changed = nextTs !== null && nextTs !== prevUpdatedAt && !fresh?.timestone?.isStale;
          if (changed || attempts >= 6) {
            stopPolling();
            setTimestoneRefreshing(false);
            setTimestoneStatusMsg(
              changed
                ? `Timestone (${targetEvent}) sincronizado correctamente.`
                : `Actualización de Timestone (${targetEvent}) enviada; vuelve a pulsar Actualizar en unos segundos si aún sigue corriendo.`
            );
          }
        }, 12_000);
      } catch (err: any) {
        setTimestoneRefreshing(false);
        setTimestoneStatusMsg(err.message || 'Error al actualizar Timestone');
      }
    },
    [eventSeason, fetchAnalytics, payload?.timestone?.eventCode, payload?.timestone?.updatedAt, stopPolling]
  );

  useEffect(() => {
    let initialEvent: string | undefined;
    try {
      const savedEvent = localStorage.getItem(EVENT_STORAGE_KEY);
      if (savedEvent) {
        const parsed = JSON.parse(savedEvent);
        if (parsed.event) {
          setLoadedEvent(parsed.event);
          initialEvent = parsed.event.code;
          loadedEventRef.current = parsed.event.code;
        }
        if (Array.isArray(parsed.matches)) setScheduleMatches(parsed.matches);
      }
      const savedTags = localStorage.getItem(PICK_TAGS_STORAGE_KEY);
      if (savedTags) {
        setPickTags(JSON.parse(savedTags));
      }
    } catch {
      // ignore localStorage read errors
    }

    fetchAnalytics(initialEvent).then((data) => {
      const ts = data?.timestone;
      if (ts && ts.isStale && !autoTriggeredEventsRef.current.has(ts.eventCode)) {
        autoTriggeredEventsRef.current.add(ts.eventCode);
        triggerTimestoneRefresh(ts.eventCode, true);
      }
    });

    return () => {
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cyclePickTag = (teamNum: number) => {
    setPickTags((prev) => {
      const curr = prev[teamNum] || 'none';
      const next = NEXT_PICK_TAG[curr];
      const updated = { ...prev, [teamNum]: next };
      if (next === 'none') delete updated[teamNum];
      try {
        localStorage.setItem(PICK_TAGS_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore quota errors
      }
      return updated;
    });
  };

  const teams = useMemo(() => payload?.teams || [], [payload]);
  const teamMap = useMemo(() => {
    const m = new Map<number, TeamAnalytics>();
    for (const t of teams) m.set(t.team, t);
    return m;
  }, [teams]);

  // Apply FTCScout schedule teams automatically when changing matchNum
  useEffect(() => {
    if (!scheduleMatches.length) return;
    const found =
      scheduleMatches.find((m) => m.matchNum === matchNum && m.tournamentLevel === 'Quals') ||
      scheduleMatches.find((m) => m.matchNum === matchNum);
    if (!found) return;
    const r1 = found.teams.find((t) => t.alliance === 'Red' && t.station === 'One')?.teamNumber;
    const r2 = found.teams.find((t) => t.alliance === 'Red' && t.station === 'Two')?.teamNumber;
    const b1 = found.teams.find((t) => t.alliance === 'Blue' && t.station === 'One')?.teamNumber;
    const b2 = found.teams.find((t) => t.alliance === 'Blue' && t.station === 'Two')?.teamNumber;
    if (r1) setRed1(r1);
    if (r2) setRed2(r2);
    if (b1) setBlue1(b1);
    if (b2) setBlue2(b2);
  }, [scheduleMatches, matchNum]);

  const activateEvent = async (rawCode: string) => {
    const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!code) return;
    setLoadingEvent(true);
    setEventError(null);
    try {
      const res = await fetch(`/api/event?season=${eventSeason}&code=${encodeURIComponent(code)}`);
      const json = await res.json();

      let nextEvent = { code, name: code, season: eventSeason };
      let nextMatches: ScheduleMatch[] = [];

      if (res.ok && json.success && json.event) {
        nextEvent = json.event;
        nextMatches = json.matches || [];
      } else {
        // Código personalizado local (no registrado en FTCScout): permitir activarlo para Timestone/Sheets
        setEventError(`'${code}' no se encontró en FTCScout ${eventSeason}; activado usando pestañas locales de Google Sheets.`);
      }

      setLoadedEvent(nextEvent);
      loadedEventRef.current = nextEvent.code;
      setScheduleMatches(nextMatches);
      setEventCodeInput(nextEvent.code);
      setShowEventPicker(false);
      localStorage.setItem(EVENT_STORAGE_KEY, JSON.stringify({ event: nextEvent, matches: nextMatches }));

      const fresh = await fetchAnalytics(nextEvent.code);
      const ts = fresh?.timestone;
      if (ts && ts.eventCode && ts.isStale && !autoTriggeredEventsRef.current.has(ts.eventCode)) {
        autoTriggeredEventsRef.current.add(ts.eventCode);
        triggerTimestoneRefresh(ts.eventCode, true);
      }
    } catch (err: any) {
      setEventError(err.message);
    } finally {
      setLoadingEvent(false);
    }
  };

  const handleLoadEvent = () => activateEvent(eventCodeInput);

  const handleSearchEvents = async () => {
    setSearchingEvents(true);
    setEventError(null);
    try {
      const q = eventCodeInput.trim();
      const res = await fetch(
        `/api/event?action=search&season=${eventSeason}&q=${encodeURIComponent(q)}`
      );
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Error buscando eventos');
      setEventSearchResults(json.events || []);
    } catch (err: any) {
      setEventError(err.message);
    } finally {
      setSearchingEvents(false);
    }
  };

  const filteredTeams = useMemo(() => {
    const tagPriority: Record<PickTag, number> = { top: 0, pick: 1, none: 2, avoid: 3, drafted: 4 };
    return teams
      .filter((t) => {
        if (searchTeam.trim() && !String(t.team).includes(searchTeam.trim())) return false;
        if (roleFilter !== 'ALL' && detectRobotRole(t).role !== roleFilter) return false;
        if (onlyReliable && t.reliabilityPct < 70) return false;
        if (onlyLowFouls && t.foulsAvg > 15) return false;
        if (hideDrafted && pickTags[t.team] === 'drafted') return false;
        return true;
      })
      .sort((a, b) => {
        if (prioritizeTop) {
          const pa = tagPriority[pickTags[a.team] || 'none'];
          const pb = tagPriority[pickTags[b.team] || 'none'];
          if (pa !== pb) return pa - pb;
        }
        const diff = a[sortKey] - b[sortKey];
        return sortAsc ? diff : -diff;
      });
  }, [teams, searchTeam, roleFilter, onlyReliable, onlyLowFouls, hideDrafted, prioritizeTop, pickTags, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'rank' || key === 'team' || key === 'foulsAvg');
    }
  };

  const selectedTeam = teamMap.get(selectedTeamNum) || teams[0] || null;
  const compareTeam = compareTeamNum && compareTeamNum !== selectedTeam?.team ? teamMap.get(compareTeamNum) || null : null;

  const selectedTeamIndex = selectedTeam ? teams.findIndex((t) => t.team === selectedTeam.team) : -1;
  const stepSelectedTeam = (delta: number) => {
    if (!teams.length || selectedTeamIndex === -1) return;
    const nextIdx = (selectedTeamIndex + delta + teams.length) % teams.length;
    setSelectedTeamNum(teams[nextIdx].team);
  };

  const topEpaTeam = teams[0] || null;
  const bestAutoTeam = useMemo(
    () => (teams.length ? [...teams].sort((a, b) => b.autoAvg - a.autoAvg)[0] : null),
    [teams]
  );

  const aggregateAlliance = (teamIds: number[]) => {
    const members = teamIds.filter((id) => id > 0).map((id) => teamMap.get(id)).filter((t): t is TeamAnalytics => !!t);
    const sum = (fn: (t: TeamAnalytics) => number) => Math.round(members.reduce((s, t) => s + fn(t), 0) * 10) / 10;
    const startZones = members.map((m) => m.topStartPos).filter((p) => p && p !== '—');
    const hasCollision = startZones.length >= 2 && new Set(startZones).size < startZones.length;

    const roles = members.map((m) => detectRobotRole(m).role);
    const hasBalancin = roles.some((r) => r === 'BALANCÍN' || r === 'HÍBRIDO');
    const hasFlor = roles.some((r) => r === 'FLOR' || r === 'HÍBRIDO');
    const synergyLabel =
      members.length < 2
        ? 'Selecciona al menos 2 robots'
        : hasBalancin && hasFlor
          ? 'Sinergia Óptima (Cobertura Balancín + Flor)'
          : hasBalancin
            ? 'Alianza enfocada en Balancín (posible baja cobertura Flor)'
            : 'Alianza enfocada en Flor (posible baja anotación Balancín)';

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
      hasCollision,
      startZones,
      synergyLabel,
      synergyOk: hasBalancin && hasFlor && !hasCollision,
    };
  };

  const redAllianceProj = aggregateAlliance([red1, red2]);
  const blueAllianceProj = aggregateAlliance([blue1, blue2]);

  const timestoneData = payload?.timestone;
  const activeEventCode = loadedEvent?.code || timestoneData?.eventCode || '';
  const availableEventOptions = useMemo(() => {
    const set = new Set<string>(timestoneData?.availableEvents || []);
    if (loadedEvent?.code) set.add(loadedEvent.code);
    if (timestoneData?.eventCode) set.add(timestoneData.eventCode);
    return Array.from(set).filter(Boolean).sort();
  }, [timestoneData?.availableEvents, timestoneData?.eventCode, loadedEvent?.code]);

  const timestoneMatch = useMemo(() => {
    const list = timestoneData?.matches || [];
    if (!list.length) return null;
    const byNum =
      list.find((m) => m.match === matchNum && m.nivel.toUpperCase() === 'QUALS') ||
      list.find((m) => m.match === matchNum);
    if (!byNum) return null;
    const sameTeams =
      byNum.red1 === red1 && byNum.red2 === red2 && byNum.blue1 === blue1 && byNum.blue2 === blue2;
    return sameTeams ? byNum : null;
  }, [timestoneData?.matches, matchNum, red1, red2, blue1, blue2]);

  const fallbackRedWinProb =
    redAllianceProj.net + blueAllianceProj.net > 0
      ? Math.round((Math.max(1, redAllianceProj.net) / (Math.max(1, redAllianceProj.net) + Math.max(1, blueAllianceProj.net))) * 100)
      : 50;
  const redWinProb = timestoneMatch ? timestoneMatch.redWinPct : fallbackRedWinProb;
  const blueWinProb = timestoneMatch ? timestoneMatch.blueWinPct : 100 - fallbackRedWinProb;

  const matchFieldMarkers: FieldMarker[] = [
    ...redAllianceProj.members.map((m, idx) => ({
      slot: `R${idx + 1}`,
      team: m.team,
      startPos: m.topStartPos,
      alliance: 'red' as const,
    })),
    ...blueAllianceProj.members.map((m, idx) => ({
      slot: `A${idx + 1}`,
      team: m.team,
      startPos: m.topStartPos,
      alliance: 'blue' as const,
    })),
  ].filter((m) => m.startPos && m.startPos !== '—');

  const myAllianceProj = aggregateAlliance([allyCap, allyPick1, allySub]);
  const oppAllianceProj = aggregateAlliance([opp1, opp2, oppSub]);
  const allianceDiff = Math.round((myAllianceProj.net - oppAllianceProj.net) * 10) / 10;

  const openTeamProfile = (teamNum: number) => {
    setSelectedTeamNum(teamNum);
    setTab('equipo');
  };

  return (
    <div className="shell">
      {/* Top Pit-Wall Bar */}
      <header className="topbar">
        <div className="topbar-inner">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img
              src="/beyonder-logo.svg"
              alt="Logo The Beyonder"
              width={54}
              height={54}
              style={{
                display: 'block',
                flexShrink: 0,
                filter: 'drop-shadow(0 0 12px rgba(168, 85, 247, 0.5))',
              }}
            />
            <div style={{ fontSize: '17px', fontWeight: 900, letterSpacing: '0.8px', color: 'var(--text-white)' }}>
              THE{' '}
              <span
                style={{
                  background: 'linear-gradient(90deg, #A855F7 0%, #6366F1 55%, #38BDF8 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                BEYONDER
              </span>
            </div>
          </div>

          <div
            className="collab-lockup"
            title="Colaboración Nautilus 4010 × Ragnarok"
            aria-label="Colaboración Nautilus 4010 por Ragnarok"
          >
            <img
              src="/nautilus-logo.png"
              alt="Logo Nautilus 4010"
              className="collab-logo-nautilus"
            />
            <svg
              viewBox="0 0 16 16"
              fill="none"
              className="collab-x-icon"
              aria-hidden="true"
            >
              <path
                d="M3 3L13 13M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
            <img
              src="/ragnarok-logo.svg"
              alt="Logo Ragnarok"
              className="collab-logo-ragnarok"
            />
          </div>

          <nav className="nav-tabs" aria-label="Vistas de Analítica">
            {(
              [
                { id: 'ranking', label: 'Ranking & Picklist' },
                { id: 'equipo', label: 'Perfil de Equipo' },
                { id: 'match', label: 'Match 2v2' },
                { id: 'alianza', label: 'Simulador Alianzas' },
                { id: 'standings', label: 'Standings Proy.' },
              ] as { id: ViewTab; label: string }[]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`nav-tab ${tab === item.id ? 'active' : ''}`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <select
              aria-label="Evento activo"
              value={activeEventCode || '__NEW__'}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__NEW__') {
                  setShowEventPicker(true);
                } else {
                  activateEvent(val);
                }
              }}
              className="select-rag tabular"
              style={{ maxWidth: '165px' }}
            >
              {availableEventOptions.length === 0 && (
                <option value="__NEW__">Seleccionar evento...</option>
              )}
              {availableEventOptions.map((ev) => (
                <option key={ev} value={ev}>
                  Evento: {ev}
                </option>
              ))}
              <option value="__NEW__">+ Buscar / Otro...</option>
            </select>

            <button
              type="button"
              onClick={() => setShowEventPicker((prev) => !prev)}
              className={`btn-ghost ${showEventPicker ? 'active' : ''}`}
              title="Buscar evento en FTCScout o ingresar código personalizado"
            >
              {showEventPicker ? 'Cerrar' : 'Cambiar'}
            </button>

            <button
              type="button"
              onClick={() => triggerTimestoneRefresh(undefined, false)}
              disabled={timestoneRefreshing}
              className="btn-ghost"
              title={
                timestoneData?.updatedAt
                  ? `Último Timestone (${activeEventCode || 'Sin evento'}): ${new Date(timestoneData.updatedAt).toLocaleString('es-MX')}`
                  : 'Ejecutar simulación Timestone (Monte Carlo + FTCScout)'
              }
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '999px',
                  background: timestoneRefreshing
                    ? 'var(--accent-amber)'
                    : timestoneData?.available && !timestoneData?.isStale
                      ? 'var(--accent-emerald)'
                      : 'var(--accent-amber)',
                  display: 'inline-block',
                }}
              />
              {timestoneRefreshing
                ? 'Simulando...'
                : activeEventCode
                  ? `Timestone (${activeEventCode})${timestoneData?.ageMinutes !== null && timestoneData?.ageMinutes !== undefined ? ` • ${timestoneData.ageMinutes}m` : ''}`
                  : 'Timestone'}
            </button>

            <button type="button" onClick={() => fetchAnalytics()} disabled={loading} className="btn-rag">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              {loading ? 'Sincronizando...' : 'Actualizar'}
            </button>
          </div>
        </div>
      </header>

      <main className="main-container">
        {showEventPicker && (
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderColor: 'var(--bey-purple)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <span className="panel-title">Selector Dinámico de Evento (FTCScout + Google Sheets)</span>
              {loadedEvent && (
                <button
                  type="button"
                  onClick={() => {
                    setLoadedEvent(null);
                    loadedEventRef.current = undefined;
                    setScheduleMatches([]);
                    setEventCodeInput('');
                    localStorage.removeItem(EVENT_STORAGE_KEY);
                    fetchAnalytics();
                  }}
                  className="btn-ghost"
                  style={{ padding: '4px 9px', fontSize: '11px' }}
                >
                  Restablecer ({loadedEvent.code})
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <select value={eventSeason} onChange={(e) => setEventSeason(Number(e.target.value))} className="select-rag tabular">
                <option value={2026}>2026</option>
                <option value={2025}>2025</option>
              </select>
              <input
                type="text"
                placeholder="Buscar nombre o código (ej. MXTO, Monterrey, MXCMP...)"
                value={eventCodeInput}
                onChange={(e) => setEventCodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearchEvents();
                }}
                className="input-rag"
                style={{ flex: 1, minWidth: '220px' }}
              />
              <button type="button" onClick={handleSearchEvents} disabled={searchingEvents} className="btn-ghost">
                {searchingEvents ? 'Buscando...' : 'Buscar FTCScout'}
              </button>
              <button type="button" onClick={handleLoadEvent} disabled={loadingEvent || !eventCodeInput.trim()} className="btn-rag">
                {loadingEvent ? 'Cargando...' : 'Activar Código'}
              </button>
            </div>

            {availableEventOptions.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11px' }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>En Sheets:</span>
                {availableEventOptions.map((ev) => (
                  <button
                    key={ev}
                    type="button"
                    onClick={() => activateEvent(ev)}
                    className={`btn-ghost ${activeEventCode === ev ? 'active' : ''}`}
                    style={{ padding: '4px 10px', fontSize: '11px' }}
                  >
                    {ev}
                  </button>
                ))}
              </div>
            )}

            {eventSearchResults.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                {eventSearchResults.map((ev) => (
                  <button
                    key={ev.code}
                    type="button"
                    onClick={() => activateEvent(ev.code)}
                    className="btn-ghost"
                    style={{ padding: '5px 10px', fontSize: '11px', textAlign: 'left' }}
                  >
                    <strong style={{ color: 'var(--bey-cyan)' }}>{ev.code}</strong> · {ev.name}
                    {ev.regionCode ? ` (${ev.regionCode})` : ''}
                  </button>
                ))}
              </div>
            )}

            {eventError && <div style={{ fontSize: '11px', color: 'var(--accent-amber)', fontWeight: 700 }}>{eventError}</div>}
          </div>
        )}
        {timestoneStatusMsg && (
          <div
            style={{
              background: 'rgba(99, 102, 241, 0.14)',
              border: '1px solid var(--bey-indigo)',
              borderRadius: '6px',
              padding: '10px 14px',
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--text-silver)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span>{timestoneStatusMsg}</span>
            <button
              type="button"
              onClick={() => setTimestoneStatusMsg(null)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 900 }}
              aria-label="Cerrar aviso"
            >
              ✕
            </button>
          </div>
        )}
        {error && (
          <div
            style={{
              background: 'var(--rag-blood)',
              border: '1px solid var(--rag-crimson)',
              borderRadius: '6px',
              padding: '12px 14px',
              fontSize: '13px',
              fontWeight: 700,
              color: 'var(--rag-coral)',
            }}
          >
            Error cargando datos: {error}
          </div>
        )}

        {/* ================= 1. RANKING & PICKLIST ================= */}
        {tab === 'ranking' && (
          <>
            <section className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-label">Partidos Analizados</span>
                <span className="kpi-value tabular">{payload?.matchesCount ?? 0}</span>
                <span className="kpi-sub">Registros válidos del torneo</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Equipos Activos</span>
                <span className="kpi-value tabular">{payload?.teamsCount ?? 0}</span>
                <span className="kpi-sub">Con telemetría evaluada</span>
              </div>
              <div className="kpi-card" style={{ borderTopColor: 'var(--accent-amber)' }}>
                <span className="kpi-label">Líder EPA Neto</span>
                <span className="kpi-value tabular" style={{ color: 'var(--accent-amber)' }}>
                  {topEpaTeam ? `#${topEpaTeam.team}` : '—'}
                </span>
                <span className="kpi-sub tabular">
                  {topEpaTeam ? `${topEpaTeam.epaNetAvg.toFixed(1)} pts promedio` : 'Sin datos'}
                </span>
              </div>
              <div className="kpi-card" style={{ borderTopColor: 'var(--accent-cyan)' }}>
                <span className="kpi-label">Mejor Autónomo</span>
                <span className="kpi-value tabular" style={{ color: 'var(--accent-cyan)' }}>
                  {bestAutoTeam ? `#${bestAutoTeam.team}` : '—'}
                </span>
                <span className="kpi-sub tabular">
                  {bestAutoTeam ? `${bestAutoTeam.autoAvg.toFixed(1)} pts en auto` : 'Sin datos'}
                </span>
              </div>
            </section>

            {/* Filtros tácticos y Picklist */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Buscar # equipo..."
                  value={searchTeam}
                  onChange={(e) => setSearchTeam(e.target.value)}
                  className="input-rag tabular"
                  style={{ width: '145px' }}
                />

                {(['ALL', 'BALANCÍN', 'FLOR', 'HÍBRIDO'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRoleFilter(r)}
                    className={`btn-ghost ${roleFilter === r ? 'active' : ''}`}
                  >
                    {r === 'ALL' ? 'Todos' : r}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setOnlyReliable(!onlyReliable)}
                  className={`btn-ghost ${onlyReliable ? 'active' : ''}`}
                >
                  Op ≥ 70%
                </button>
                <button
                  type="button"
                  onClick={() => setOnlyLowFouls(!onlyLowFouls)}
                  className={`btn-ghost ${onlyLowFouls ? 'active' : ''}`}
                >
                  Faltas ≤ 15
                </button>
                <button
                  type="button"
                  onClick={() => setPrioritizeTop(!prioritizeTop)}
                  className={`btn-ghost ${prioritizeTop ? 'active' : ''}`}
                >
                  ★ Favoritos primero
                </button>
                <button
                  type="button"
                  onClick={() => setHideDrafted(!hideDrafted)}
                  className={`btn-ghost ${hideDrafted ? 'active' : ''}`}
                >
                  Ocultar Drafted
                </button>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                Toca Tag para marcar ★ TOP / DRAFTED • Clic en fila abre perfil
              </span>
            </div>

            {/* Tabla Maestra */}
            <div className="table-wrap" style={{ maxHeight: '64vh', overflowY: 'auto' }}>
              <table className="rag-table">
                <thead>
                  <tr>
                    <th>Picklist</th>
                    {[
                      { k: 'rank', l: 'Rank' },
                      { k: 'team', l: 'Equipo' },
                    ].map((col) => (
                      <th key={col.k} onClick={() => handleSort(col.k as SortKey)}>
                        {col.l} {sortKey === col.k ? (sortAsc ? '▲' : '▼') : ''}
                      </th>
                    ))}
                    <th>Rol</th>
                    {[
                      { k: 'matchesPlayed', l: 'PJ' },
                      { k: 'epaNetAvg', l: 'EPA Neto' },
                      { k: 'autoAvg', l: 'Auto' },
                      { k: 'teleAvg', l: 'TeleOp' },
                      { k: 'balancinAutoAvg', l: 'Bal. Auto' },
                      { k: 'balancinTeleAvg', l: 'Bal. Tele' },
                      { k: 'florAvg', l: 'Flor Total' },
                      { k: 'gardenAvg', l: 'Garden' },
                      { k: 'flowerControlPct', l: '% Flor' },
                      { k: 'reliabilityPct', l: '% Op.' },
                      { k: 'foulsAvg', l: 'Faltas' },
                      { k: 'driverAvg', l: 'Piloto' },
                      { k: 'maxNet', l: 'Max' },
                    ].map((col) => (
                      <th key={col.k} onClick={() => handleSort(col.k as SortKey)}>
                        {col.l} {sortKey === col.k ? (sortAsc ? '▲' : '▼') : ''}
                      </th>
                    ))}
                    {timestoneData?.available && <th title="EPA ponderado Timestone (y EPA Operativo)">EPA Sim.</th>}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {filteredTeams.length === 0 ? (
                    <tr>
                      <td colSpan={timestoneData?.available ? 18 : 17} style={{ padding: '28px', color: 'var(--text-muted)' }}>
                        {loading ? 'Cargando datos...' : 'Sin equipos que coincidan con el filtro.'}
                      </td>
                    </tr>
                  ) : (
                    filteredTeams.map((t) => {
                      const roleMeta = detectRobotRole(t);
                      const tag = pickTags[t.team] || 'none';
                      const tagMeta = PICK_TAG_META[tag];

                      return (
                        <tr key={t.team} className={tag === 'drafted' ? 'drafted-row' : undefined} onClick={() => openTeamProfile(t.team)}>
                          <td
                            onClick={(e) => {
                              e.stopPropagation();
                              cyclePickTag(t.team);
                            }}
                          >
                            <button
                              type="button"
                              style={{
                                background: tagMeta.bg,
                                border: `1px solid ${tagMeta.border}`,
                                color: tagMeta.color,
                                borderRadius: '4px',
                                padding: '3px 7px',
                                fontSize: '10px',
                                fontWeight: 800,
                                cursor: 'pointer',
                                minWidth: '64px',
                              }}
                              title="Cambiar etiqueta de Picklist"
                            >
                              {tagMeta.label}
                            </button>
                          </td>
                          <td style={{ fontWeight: 900, color: t.rank === 1 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                            #{t.rank}
                          </td>
                          <td style={{ fontWeight: 900, color: '#FFFFFF' }}>#{t.team}</td>
                          <td>
                            <span
                              style={{
                                background: roleMeta.bg,
                                color: roleMeta.color,
                                border: `1px solid ${roleMeta.color}44`,
                                borderRadius: '3px',
                                padding: '2px 6px',
                                fontSize: '9.5px',
                                fontWeight: 800,
                              }}
                            >
                              {roleMeta.role}
                            </span>
                          </td>
                          <td>{t.matchesPlayed}</td>
                          <td style={{ fontWeight: 900, color: 'var(--bey-purple)' }}>{t.epaNetAvg.toFixed(1)}</td>
                          <td style={{ color: 'var(--accent-cyan)' }}>{t.autoAvg.toFixed(1)}</td>
                          <td style={{ color: 'var(--accent-amber)' }}>{t.teleAvg.toFixed(1)}</td>
                          <td style={{ color: '#93C5FD' }}>{t.balancinAutoAvg.toFixed(1)}</td>
                          <td style={{ color: '#60A5FA', fontWeight: 800 }}>{t.balancinTeleAvg.toFixed(1)}</td>
                          <td style={{ color: '#FB7185', fontWeight: 800 }}>{t.florAvg.toFixed(1)}</td>
                          <td style={{ color: '#34D399', fontWeight: 800 }}>{t.gardenAvg.toFixed(1)}</td>
                          <td style={{ color: '#FDA4AF' }}>{t.flowerControlPct.toFixed(0)}%</td>
                          <td
                            style={{
                              fontWeight: 800,
                              color:
                                t.reliabilityPct >= 90
                                  ? 'var(--accent-emerald)'
                                  : t.reliabilityPct < 70
                                    ? 'var(--rag-coral)'
                                    : 'var(--text-silver)',
                            }}
                          >
                            {t.reliabilityPct.toFixed(0)}%
                          </td>
                          <td style={{ color: t.foulsAvg > 15 ? 'var(--rag-coral)' : 'var(--text-silver)', fontWeight: t.foulsAvg > 15 ? 800 : 600 }}>
                            {t.foulsAvg.toFixed(1)}
                          </td>
                          <td>{t.driverAvg.toFixed(1)}</td>
                          <td style={{ color: 'var(--accent-amber)' }}>{t.maxNet}</td>
                          {timestoneData?.available && (
                            <td
                              title={
                                t.timestone
                                  ? `Operativo: ${t.timestone.epaOperational.toFixed(1)} • Fallas excl.: ${t.timestone.excludedOldFailures}`
                                  : 'Sin datos en Timestone'
                              }
                              style={{ fontWeight: 800, color: 'var(--bey-cyan)' }}
                            >
                              {t.timestone ? (
                                <>
                                  {t.timestone.epa.toFixed(1)}
                                  {Math.abs(t.timestone.epaOperational - t.timestone.epa) >= 1 && (
                                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                                      (Op {t.timestone.epaOperational.toFixed(0)})
                                    </span>
                                  )}
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ================= 2. PERFIL DE EQUIPO ================= */}
        {tab === 'equipo' && (
          <>
            <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => stepSelectedTeam(-1)} className="btn-ghost" aria-label="Equipo anterior">
                  ‹
                </button>
                <select
                  value={selectedTeam?.team ?? ''}
                  onChange={(e) => setSelectedTeamNum(Number(e.target.value))}
                  className="select-rag tabular"
                >
                  {teams.map((t) => (
                    <option key={t.team} value={t.team}>
                      #{t.team} (Rank #{t.rank} • EPA {t.epaNetAvg.toFixed(1)})
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => stepSelectedTeam(1)} className="btn-ghost" aria-label="Equipo siguiente">
                  ›
                </button>

                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, marginLeft: '6px' }}>vs:</span>
                <select
                  value={compareTeamNum}
                  onChange={(e) => setCompareTeamNum(Number(e.target.value))}
                  className="select-rag tabular"
                >
                  <option value={0}>Comparar con...</option>
                  {teams
                    .filter((t) => t.team !== selectedTeam?.team)
                    .map((t) => (
                      <option key={t.team} value={t.team}>
                        #{t.team} (EPA {t.epaNetAvg.toFixed(1)})
                      </option>
                    ))}
                </select>
              </div>

              {selectedTeam && (
                <div className="tabular" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12px', fontWeight: 800 }}>
                  {(() => {
                    const roleMeta = detectRobotRole(selectedTeam);
                    const tagMeta = PICK_TAG_META[pickTags[selectedTeam.team] || 'none'];
                    return (
                      <>
                        <span
                          style={{
                            background: roleMeta.bg,
                            color: roleMeta.color,
                            border: `1px solid ${roleMeta.color}44`,
                            borderRadius: '4px',
                            padding: '3px 8px',
                            fontSize: '10px',
                          }}
                        >
                          {roleMeta.role}
                        </span>
                        <button
                          type="button"
                          onClick={() => cyclePickTag(selectedTeam.team)}
                          style={{
                            background: tagMeta.bg,
                            border: `1px solid ${tagMeta.border}`,
                            color: tagMeta.color,
                            borderRadius: '4px',
                            padding: '4px 8px',
                            fontSize: '10px',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          Tag: {tagMeta.label}
                        </button>
                      </>
                    );
                  })()}
                  <span>RANK <strong style={{ color: 'var(--accent-amber)' }}>#{selectedTeam.rank}</strong></span>
                  <span>PJ <strong>{selectedTeam.matchesPlayed}</strong></span>
                  <span>EPA <strong style={{ color: 'var(--bey-purple)' }}>{selectedTeam.epaNetAvg.toFixed(1)}</strong></span>
                  <span>RANGO <strong>{selectedTeam.minNet}–{selectedTeam.maxNet}</strong></span>
                  <span>OP <strong style={{ color: selectedTeam.reliabilityPct >= 90 ? 'var(--accent-emerald)' : 'var(--rag-coral)' }}>{selectedTeam.reliabilityPct.toFixed(0)}%</strong></span>
                  <span>PILOTO <strong style={{ color: 'var(--accent-amber)' }}>{selectedTeam.driverAvg.toFixed(1)}/5</strong></span>
                </div>
              )}
            </div>

            {!selectedTeam ? (
              <div className="panel" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                No hay equipos registrados todavía.
              </div>
            ) : (
              <>
                <div className="split-2col">
                  {/* Columna Izquierda: Radar + Distribuciones + Tasas + Notas */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="panel">
                      <div className="panel-header">
                        <span className="panel-title">Perfil de Capacidades BIOBUZZ (Radar)</span>
                        {compareTeam && (
                          <span className="tabular" style={{ fontSize: '11px', color: 'var(--accent-cyan)', fontWeight: 800 }}>
                            Comparando vs #{compareTeam.team}
                          </span>
                        )}
                      </div>
                      <TeamRadarChart team={selectedTeam} compareTeam={compareTeam} allTeams={teams} />
                    </div>

                    <div className="panel">
                      <div className="panel-header">
                        <span className="panel-title">Distribuciones de Piezas (Balancín vs Flor)</span>
                        <span className="tabular" style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                          Prom. por match
                        </span>
                      </div>
                      <DistributionBars
                        autoBalPollen={selectedTeam.autoHivePollenAvg}
                        autoBalNectar={selectedTeam.autoHiveNectarAvg}
                        autoFlorPollen={selectedTeam.autoFlowerPollenAvg}
                        autoFlorNectar={selectedTeam.autoFlowerNectarAvg}
                        teleBalPollen={selectedTeam.teleHivePollenAvg}
                        teleBalNectar={selectedTeam.teleHiveNectarAvg}
                        teleFlorPollen={selectedTeam.teleFlowerPollenAvg}
                        teleFlorNectar={selectedTeam.teleFlowerNectarAvg}
                        gardenAvg={selectedTeam.gardenAvg}
                      />
                    </div>

                    <div className="panel">
                      <div className="panel-header">
                        <span className="panel-title">Eficiencia, RP & Confiabilidad</span>
                      </div>
                      <div className="tabular" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px', marginBottom: '12px' }}>
                        {[
                          { l: 'Auto [Min·Prom·Max]', v: `${selectedTeam.minAuto} · ${selectedTeam.autoAvg.toFixed(1)} · ${selectedTeam.maxAuto}`, c: '#FAFAFA' },
                          { l: 'Tele [Min·Prom·Max]', v: `${selectedTeam.minTele} · ${selectedTeam.teleAvg.toFixed(1)} · ${selectedTeam.maxTele}`, c: '#FAFAFA' },
                          { l: 'Neto [Min·Prom·Max]', v: `${selectedTeam.minNet} · ${selectedTeam.epaNetAvg.toFixed(1)} · ${selectedTeam.maxNet}`, c: '#FFD166' },
                        ].map((rng) => (
                          <div key={rng.l} style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '4px', padding: '8px 10px' }}>
                            <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontWeight: 700 }}>{rng.l}</div>
                            <div style={{ fontSize: '13px', fontWeight: 900, color: rng.c, marginTop: '2px' }}>[ {rng.v} ]</div>
                          </div>
                        ))}
                      </div>

                      <div className="tabular" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
                        {[
                          { l: 'Auto Leave', v: `${selectedTeam.autoLeavePct.toFixed(0)}%`, c: '#94A3B8' },
                          { l: 'Auto Park', v: `${selectedTeam.autoParkPct.toFixed(0)}%`, c: '#94A3B8' },
                          { l: 'Endgame Park', v: `${selectedTeam.endgameParkPct.toFixed(0)}%`, c: '#FFD166' },
                          { l: 'Control Flor', v: `${selectedTeam.flowerControlPct.toFixed(0)}% · ${selectedTeam.flowersOwnedAvg.toFixed(1)} fl.`, c: '#FB7185' },
                          { l: 'Bottom Nectar', v: `${selectedTeam.bottomNectarPct.toFixed(0)}%`, c: '#F87171' },
                          { l: 'Descore Garden', v: `${selectedTeam.gardenDescorePct.toFixed(0)}%`, c: '#34D399' },
                        ].map((m) => (
                          <div
                            key={m.l}
                            style={{
                              background: 'var(--bg-carbon)',
                              border: '1px solid var(--border-steel)',
                              borderRadius: '4px',
                              padding: '10px',
                            }}
                          >
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>{m.l}</div>
                            <div style={{ fontSize: '18px', fontWeight: 900, color: m.c }}>{m.v}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="panel">
                      <div className="panel-header">
                        <span className="panel-title">Notas de Scouters & Alertas</span>
                      </div>
                      {selectedTeam.notes.length === 0 ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sin observaciones ni fallas reportadas.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {selectedTeam.notes.map((n, idx) => (
                            <div
                              key={idx}
                              style={{
                                background: 'var(--bg-carbon)',
                                border: '1px solid var(--border-steel)',
                                borderLeft: `3px solid ${n.status === '100% Operativo' ? 'var(--bey-indigo)' : 'var(--accent-amber)'}`,
                                borderRadius: '4px',
                                padding: '8px 10px',
                                fontSize: '12px',
                              }}
                            >
                              <div className="tabular" style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>
                                Match #{n.match} ({n.alliance}) • {n.scouter} • {n.status}
                              </div>
                              {n.note && <div style={{ color: 'var(--text-white)', marginTop: '3px' }}>{n.note}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Columna Derecha: Historic + Field Heatmap */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="panel">
                      <div className="panel-header">
                        <span className="panel-title">HISTORIC • Tendencia por Partido</span>
                        <span className="tabular" style={{ fontSize: '11px', color: 'var(--accent-amber)', fontWeight: 700 }}>
                          Swarm Prom: {selectedTeam.swarmPtsAvg.toFixed(1)} pts
                        </span>
                      </div>
                      <TeamHistoricChart history={selectedTeam.history} />
                    </div>

                    <div className="panel">
                      <div className="panel-header">
                        <span className="panel-title">POSITIONS • Zonas de Inicio (6×6 BIOBUZZ)</span>
                        <span className="tabular" style={{ fontSize: '11px', color: 'var(--text-silver)', fontWeight: 700 }}>
                          Favorita: {selectedTeam.topStartPos}
                        </span>
                      </div>
                      <RagnarokFieldHeatmap
                        positions={selectedTeam.positions}
                        sidePositions={selectedTeam.sidePositions}
                        teamNumber={selectedTeam.team}
                      />
                    </div>
                  </div>
                </div>

                {/* Tabla detallada Match por Match */}
                <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="panel-header" style={{ padding: '14px 16px', marginBottom: 0 }}>
                    <span className="panel-title">Bitácora de Partidos (#{selectedTeam.team})</span>
                    <span className="tabular" style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                      {selectedTeam.history.length} registros
                    </span>
                  </div>
                  <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                    <table className="rag-table">
                      <thead>
                        <tr>
                          <th>Match</th>
                          <th>Alianza</th>
                          <th>Inicio</th>
                          <th>Bal. Auto (P/N)</th>
                          <th>Flor Auto (P/N)</th>
                          <th>Bal. Tele (P/N)</th>
                          <th>Flor Tele (P/N)</th>
                          <th>Prop. Flor</th>
                          <th>Garden</th>
                          <th>Estatus</th>
                          <th>Faltas</th>
                          <th>Auto</th>
                          <th>Tele</th>
                          <th>Neto</th>
                        </tr>
                      </thead>
                      <tbody className="tabular">
                        {selectedTeam.history.map((m) => (
                          <tr key={m.id} style={{ cursor: 'default' }}>
                            <td style={{ fontWeight: 900, color: '#FFFFFF' }}>M#{m.match}</td>
                            <td style={{ color: m.alliance === 'ROJO' ? 'var(--rag-coral)' : 'var(--accent-cyan)', fontWeight: 800 }}>
                              {m.alliance}
                            </td>
                            <td>{m.startPos}</td>
                            <td style={{ color: '#93C5FD' }}>{m.autoHivePollen} / {m.autoHiveNectar}</td>
                            <td style={{ color: '#FDA4AF' }}>{m.autoFlowerPollen} / {m.autoFlowerNectar}</td>
                            <td style={{ color: '#60A5FA', fontWeight: 800 }}>{m.teleopHivePollen} / {m.teleopHiveNectar}</td>
                            <td style={{ color: '#FB7185', fontWeight: 800 }}>{m.teleopFlowerPollen} / {m.teleopFlowerNectar}</td>
                            <td style={{ color: m.flowerOwnedCount > 0 ? '#FB7185' : 'var(--text-muted)', fontWeight: m.flowerOwnedCount > 0 ? 800 : 600 }}>
                              {m.flowerOwnedCount}
                            </td>
                            <td style={{ color: '#34D399', fontWeight: 800 }}>{m.gardenElements}</td>
                            <td style={{ color: m.status === '100% Operativo' ? 'var(--accent-emerald)' : 'var(--rag-coral)' }}>
                              {m.status}
                            </td>
                            <td>{m.foulsScore}</td>
                            <td style={{ color: 'var(--accent-cyan)' }}>{m.autoScore}</td>
                            <td style={{ color: 'var(--accent-amber)' }}>{m.teleScore}</td>
                            <td style={{ fontWeight: 900, color: 'var(--bey-purple)' }}>{m.netScore}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* ================= 3. MATCH BREAKDOWN 2v2 ================= */}
        {tab === 'match' && (
          <>
            <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span className="panel-title">Match #:</span>
                <button type="button" onClick={() => setMatchNum((m) => Math.max(1, m - 1))} className="btn-ghost">‹</button>
                <input
                  type="number"
                  min={1}
                  value={matchNum}
                  onChange={(e) => setMatchNum(Math.max(1, Number(e.target.value) || 1))}
                  className="input-rag tabular"
                  style={{ width: '68px', textAlign: 'center' }}
                />
                <button type="button" onClick={() => setMatchNum((m) => m + 1)} className="btn-ghost">›</button>
                {loadedEvent && (
                  <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--accent-emerald)', marginLeft: '6px' }}>
                    {loadedEvent.code} ({loadedEvent.season})
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <select value={eventSeason} onChange={(e) => setEventSeason(Number(e.target.value))} className="select-rag tabular">
                  <option value={2026}>2026</option>
                  <option value={2025}>2025</option>
                </select>
                <input
                  type="text"
                  placeholder="Código evento (ej. MXCMP)"
                  value={eventCodeInput}
                  onChange={(e) => setEventCodeInput(e.target.value)}
                  className="input-rag"
                  style={{ width: '175px' }}
                />
                <button type="button" onClick={handleLoadEvent} disabled={loadingEvent} className="btn-rag">
                  {loadingEvent ? '...' : 'Cargar FTCScout'}
                </button>
              </div>
              {eventError && <div style={{ width: '100%', fontSize: '11px', color: 'var(--rag-coral)' }}>{eventError}</div>}
            </div>

            {/* Win Probability Bar */}
            <div className="panel" style={{ padding: '14px 16px' }}>
              <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '13px', fontWeight: 900, flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ color: 'var(--rag-crimson)' }}>
                  ROJA PROYECTADA: {timestoneMatch ? timestoneMatch.redEst.toFixed(0) : redAllianceProj.net.toFixed(1)} PTS ({redWinProb.toFixed(1)}%)
                  {timestoneMatch && (
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--rag-coral)' }}>
                      • {timestoneMatch.redRpsEst.toFixed(2)} xRP
                    </span>
                  )}
                </span>
                {timestoneMatch ? (
                  <span style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--bey-purple)', background: 'var(--bey-plum)', padding: '2px 8px', borderRadius: '4px' }}>
                    MONTE CARLO TIMESTONE
                    {timestoneMatch.tiePct > 0 ? ` • Empate ${timestoneMatch.tiePct.toFixed(1)}%` : ''}
                    {timestoneMatch.jugado && timestoneMatch.redReal !== null && timestoneMatch.blueReal !== null
                      ? ` • REAL: ${timestoneMatch.redReal} - ${timestoneMatch.blueReal}`
                      : ''}
                  </span>
                ) : null}
                <span style={{ color: 'var(--accent-cyan)' }}>
                  AZUL PROYECTADA: {timestoneMatch ? timestoneMatch.blueEst.toFixed(0) : blueAllianceProj.net.toFixed(1)} PTS ({blueWinProb.toFixed(1)}%)
                  {timestoneMatch && (
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: '#7DD3FC' }}>
                      • {timestoneMatch.blueRpsEst.toFixed(2)} xRP
                    </span>
                  )}
                </span>
              </div>
              <div style={{ height: '10px', width: '100%', background: 'var(--accent-cyan)', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${redWinProb}%`, background: 'var(--rag-crimson)' }} />
                {timestoneMatch && timestoneMatch.tiePct > 0 && (
                  <div style={{ width: `${timestoneMatch.tiePct}%`, background: 'var(--accent-amber)' }} />
                )}
              </div>
            </div>

            <div className="match-2col">
              {/* Alianza Roja */}
              <div className="panel" style={{ borderTop: '3px solid var(--rag-crimson)' }}>
                <div className="panel-header">
                  <span className="panel-title" style={{ color: 'var(--rag-coral)' }}>Alianza Roja (R1 + R2)</span>
                  <span className="tabular" style={{ fontSize: '12px', fontWeight: 800, color: redAllianceProj.swarmPts >= 16 ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                    Swarm: {redAllianceProj.swarmPts.toFixed(1)} / 16 pts
                  </span>
                </div>

                {redAllianceProj.hasCollision && (
                  <div style={{ marginBottom: '10px', padding: '8px 10px', borderRadius: '4px', background: 'rgba(255, 209, 102, 0.14)', border: '1px solid var(--accent-amber)', fontSize: '11px', fontWeight: 700, color: 'var(--accent-amber)' }}>
                    Alerta Auto: ambos aliados arrancan en la misma zona ({redAllianceProj.startZones[0]}).
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                  {[
                    { label: 'Rojo 1', val: red1, set: setRed1 },
                    { label: 'Rojo 2', val: red2, set: setRed2 },
                  ].map((slot) => (
                    <div key={slot.label}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '4px' }}>{slot.label}</div>
                      <select value={slot.val} onChange={(e) => slot.set(Number(e.target.value))} className="select-rag tabular" style={{ width: '100%' }}>
                        <option value={0}>Elegir equipo</option>
                        {teams.map((t) => (
                          <option key={t.team} value={t.team}>#{t.team} (EPA {t.epaNetAvg.toFixed(1)})</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <AllianceRobotsCards members={redAllianceProj.members} accent="var(--rag-crimson)" onSelect={openTeamProfile} />
              </div>

              {/* Alianza Azul */}
              <div className="panel" style={{ borderTop: '3px solid var(--accent-cyan)' }}>
                <div className="panel-header">
                  <span className="panel-title" style={{ color: 'var(--accent-cyan)' }}>Alianza Azul (A1 + A2)</span>
                  <span className="tabular" style={{ fontSize: '12px', fontWeight: 800, color: blueAllianceProj.swarmPts >= 16 ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                    Swarm: {blueAllianceProj.swarmPts.toFixed(1)} / 16 pts
                  </span>
                </div>

                {blueAllianceProj.hasCollision && (
                  <div style={{ marginBottom: '10px', padding: '8px 10px', borderRadius: '4px', background: 'rgba(255, 209, 102, 0.14)', border: '1px solid var(--accent-amber)', fontSize: '11px', fontWeight: 700, color: 'var(--accent-amber)' }}>
                    Alerta Auto: ambos aliados arrancan en la misma zona ({blueAllianceProj.startZones[0]}).
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                  {[
                    { label: 'Azul 1', val: blue1, set: setBlue1 },
                    { label: 'Azul 2', val: blue2, set: setBlue2 },
                  ].map((slot) => (
                    <div key={slot.label}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '4px' }}>{slot.label}</div>
                      <select value={slot.val} onChange={(e) => slot.set(Number(e.target.value))} className="select-rag tabular" style={{ width: '100%' }}>
                        <option value={0}>Elegir equipo</option>
                        {teams.map((t) => (
                          <option key={t.team} value={t.team}>#{t.team} (EPA {t.epaNetAvg.toFixed(1)})</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <AllianceRobotsCards members={blueAllianceProj.members} accent="var(--accent-cyan)" onSelect={openTeamProfile} />
              </div>
            </div>

            {/* Face-off Bars + Combined Field Start Map */}
            <div className="split-2col">
              <DuelComparisonBars
                leftTitle="ROJA"
                rightTitle="AZUL"
                metrics={[
                  { label: 'Auto Prom.', leftVal: redAllianceProj.auto, rightVal: blueAllianceProj.auto },
                  { label: 'TeleOp Prom.', leftVal: redAllianceProj.tele, rightVal: blueAllianceProj.tele },
                  { label: 'Balancín (P+N)', leftVal: redAllianceProj.balancin, rightVal: blueAllianceProj.balancin },
                  { label: 'Flor (P+N)', leftVal: redAllianceProj.flor, rightVal: blueAllianceProj.flor },
                  { label: 'Garden', leftVal: redAllianceProj.garden, rightVal: blueAllianceProj.garden },
                  { label: 'Swarm Pts', leftVal: redAllianceProj.swarmPts, rightVal: blueAllianceProj.swarmPts },
                  { label: 'Faltas', leftVal: redAllianceProj.fouls, rightVal: blueAllianceProj.fouls, lowerIsBetter: true },
                ]}
              />

              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Posiciones Esperadas en Auto (4 Robots)</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>Amarillo = Empalme</span>
                </div>
                <RagnarokFieldHeatmap markers={matchFieldMarkers} />
              </div>
            </div>
          </>
        )}

        {/* ================= 4. SIMULADOR DE ALIANZAS (PLAYOFFS) ================= */}
        {tab === 'alianza' && (
          <>
            {/* Verdict Banner */}
            <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderLeft: `4px solid ${allianceDiff >= 0 ? 'var(--bey-purple)' : 'var(--accent-cyan)'}` }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>
                  Proyección Eliminatorias
                </div>
                <div className="tabular" style={{ fontSize: '18px', fontWeight: 900, color: allianceDiff >= 0 ? 'var(--accent-emerald)' : 'var(--rag-coral)' }}>
                  {allianceDiff >= 0
                    ? `TU ALIANZA +${allianceDiff.toFixed(1)} PTS DE VENTAJA`
                    : `RIVAL +${Math.abs(allianceDiff).toFixed(1)} PTS DE VENTAJA`}
                </div>
              </div>
              <div className="tabular" style={{ display: 'flex', gap: '16px', fontSize: '13px', fontWeight: 800 }}>
                <span style={{ color: 'var(--bey-purple)' }}>TU ALIANZA: {myAllianceProj.net.toFixed(1)}</span>
                <span style={{ color: 'var(--accent-cyan)' }}>RIVAL: {oppAllianceProj.net.toFixed(1)}</span>
              </div>
            </div>

            <div className="match-2col">
              {[
                {
                  title: 'Tu Alianza (Playoffs)',
                  color: 'var(--bey-purple)',
                  slots: [
                    { label: 'Capitán', val: allyCap, set: setAllyCap },
                    { label: 'Pick 1', val: allyPick1, set: setAllyPick1 },
                    { label: 'Suplente / Pick 2 (Opc.)', val: allySub, set: setAllySub },
                  ],
                  proj: myAllianceProj,
                },
                {
                  title: 'Alianza Rival (Comparativa)',
                  color: 'var(--accent-cyan)',
                  slots: [
                    { label: 'Capitán Rival', val: opp1, set: setOpp1 },
                    { label: 'Pick 1 Rival', val: opp2, set: setOpp2 },
                    { label: 'Suplente Rival (Opc.)', val: oppSub, set: setOppSub },
                  ],
                  proj: oppAllianceProj,
                },
              ].map((side) => (
                <div key={side.title} className="panel" style={{ borderTop: `3px solid ${side.color}` }}>
                  <div className="panel-header">
                    <span className="panel-title" style={{ color: side.color }}>{side.title}</span>
                    <span className="tabular" style={{ fontSize: '16px', fontWeight: 900, color: '#FFFFFF' }}>
                      {side.proj.net.toFixed(1)} PTS
                    </span>
                  </div>

                  {/* Synergy badge */}
                  <div
                    style={{
                      marginBottom: '12px',
                      padding: '8px 10px',
                      borderRadius: '4px',
                      background: side.proj.synergyOk ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 209, 102, 0.12)',
                      border: `1px solid ${side.proj.synergyOk ? 'var(--accent-emerald)' : 'var(--accent-amber)'}`,
                      fontSize: '11px',
                      fontWeight: 700,
                      color: side.proj.synergyOk ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                    }}
                  >
                    {side.proj.synergyLabel}
                    {side.proj.hasCollision ? ` • ⚠ Posible choque Auto en ${side.proj.startZones[0]}` : ''}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                    {side.slots.map((s) => (
                      <div key={s.label}>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '4px' }}>{s.label}</div>
                        <select value={s.val} onChange={(e) => s.set(Number(e.target.value))} className="select-rag tabular" style={{ width: '100%' }}>
                          <option value={0}>Ninguno</option>
                          {teams.map((t) => (
                            <option key={t.team} value={t.team}>#{t.team} ({t.epaNetAvg.toFixed(1)})</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  <div className="tabular" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
                    {[
                      { l: 'Auto', v: side.proj.auto.toFixed(1), c: '#F8FAFC' },
                      { l: 'TeleOp', v: side.proj.tele.toFixed(1), c: '#F8FAFC' },
                      { l: 'Faltas', v: side.proj.fouls.toFixed(1), c: '#FFD166' },
                      { l: 'Balancín P+N', v: side.proj.balancin.toFixed(1), c: '#60A5FA' },
                      { l: 'Flower P+N', v: side.proj.flor.toFixed(1), c: '#FB7185' },
                      { l: 'Garden P+N', v: side.proj.garden.toFixed(1), c: '#34D399' },
                    ].map((k) => (
                      <div key={k.l} style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '4px', padding: '10px' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>{k.l}</div>
                        <div style={{ fontSize: '18px', fontWeight: 900, color: k.c }}>{k.v}</div>
                      </div>
                    ))}
                  </div>

                  <AllianceRobotsCards members={side.proj.members} accent={side.color} onSelect={openTeamProfile} />
                </div>
              ))}
            </div>

            <DuelComparisonBars
              leftTitle="TU ALIANZA"
              rightTitle="RIVAL"
              metrics={[
                { label: 'Auto', leftVal: myAllianceProj.auto, rightVal: oppAllianceProj.auto },
                { label: 'TeleOp', leftVal: myAllianceProj.tele, rightVal: oppAllianceProj.tele },
                { label: 'Balancín (P+N)', leftVal: myAllianceProj.balancin, rightVal: oppAllianceProj.balancin },
                { label: 'Flor (P+N)', leftVal: myAllianceProj.flor, rightVal: oppAllianceProj.flor },
                { label: 'Garden', leftVal: myAllianceProj.garden, rightVal: oppAllianceProj.garden },
                { label: 'Swarm Pts', leftVal: myAllianceProj.swarmPts, rightVal: oppAllianceProj.swarmPts },
                { label: 'Faltas', leftVal: myAllianceProj.fouls, rightVal: oppAllianceProj.fouls, lowerIsBetter: true },
              ]}
            />
          </>
        )}

        {/* ================= 5. STANDINGS PROYECTADOS (HÍBRIDO REAL + MONTE CARLO) ================= */}
        {tab === 'standings' && (
          <>
            <section className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-label">Evento Timestone</span>
                <span className="kpi-value tabular">{activeEventCode || 'Sin elegir'}</span>
                <span className="kpi-sub">
                  {timestoneData?.updatedAt
                    ? `Actualizado ${new Date(timestoneData.updatedAt).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                    : activeEventCode
                      ? 'Sin ejecución previa para este evento'
                      : 'Selecciona un evento en la barra superior'}
                </span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Equipos en Ranking</span>
                <span className="kpi-value tabular">{timestoneData?.standings.length ?? 0}</span>
                <span className="kpi-sub">Con simulación Monte Carlo</span>
              </div>
              <div className="kpi-card" style={{ borderTopColor: 'var(--accent-amber)' }}>
                <span className="kpi-label">Líder Proyectado</span>
                <span className="kpi-value tabular" style={{ color: 'var(--accent-amber)' }}>
                  {timestoneData?.standings[0] ? `#${timestoneData.standings[0].team}` : '—'}
                </span>
                <span className="kpi-sub tabular">
                  {timestoneData?.standings[0]
                    ? `${timestoneData.standings[0].rpPromedio.toFixed(2)} RP/match • ${timestoneData.standings[0].probTop4Pct.toFixed(0)}% Top 4`
                    : 'Sin datos'}
                </span>
              </div>
              <div className="kpi-card" style={{ borderTopColor: 'var(--accent-emerald)' }}>
                <span className="kpi-label">Corte Top 4</span>
                <span className="kpi-value tabular" style={{ color: 'var(--accent-emerald)' }}>
                  {timestoneData?.standings[3]
                    ? `${timestoneData.standings[3].rpPromedio.toFixed(2)}`
                    : '—'}
                </span>
                <span className="kpi-sub tabular">
                  {timestoneData?.standings[3]
                    ? `RP/match (#${timestoneData.standings[3].team} • ${timestoneData.standings[3].probTop4Pct.toFixed(0)}% Top 4)`
                    : 'Se requieren ≥ 4 equipos'}
                </span>
              </div>
            </section>

            {!timestoneData?.standings.length ? (
              <div className="panel" style={{ padding: '28px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-silver)' }}>
                  {activeEventCode
                    ? `Todavía no hay datos en Standings_Proy_${activeEventCode}.`
                    : 'Selecciona o busca un evento para generar o ver Standings Proyectados.'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '520px' }}>
                  {activeEventCode
                    ? 'Ejecuta Timestone desde Colab, en local o pulsando el botón inferior.'
                    : 'Usa el selector de evento en la barra superior (o busca en FTCScout) para activar un evento.'}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setShowEventPicker(true)}
                    className="btn-ghost"
                  >
                    Seleccionar / Buscar Evento
                  </button>
                  {activeEventCode && (
                    <button
                      type="button"
                      onClick={() => triggerTimestoneRefresh(activeEventCode, false)}
                      disabled={timestoneRefreshing}
                      className="btn-rag"
                    >
                      {timestoneRefreshing ? 'Ejecutando Timestone...' : `Generar Standings (${activeEventCode})`}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: '66vh', overflowY: 'auto' }}>
                <table className="rag-table">
                  <thead>
                    <tr>
                      <th>Rank Proy.</th>
                      <th>Equipo</th>
                      <th>Nombre</th>
                      <th>PJ Jug.</th>
                      <th>PJ Rest.</th>
                      <th>RPs Reales</th>
                      <th>RPs Est. Total</th>
                      <th>RP Prom.</th>
                      <th>Score Prom.</th>
                      <th>Rango Rank</th>
                      <th>Prob. Top 4</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {timestoneData.standings.map((row) => {
                      const inTop4 = row.rankProyectado <= 4;
                      return (
                        <tr
                          key={row.team}
                          onClick={() => openTeamProfile(row.team)}
                          style={inTop4 ? { background: 'rgba(16, 185, 129, 0.05)' } : undefined}
                        >
                          <td style={{ fontWeight: 900, color: inTop4 ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                            #{row.rankProyectado}
                          </td>
                          <td style={{ fontWeight: 900, color: '#FFFFFF' }}>#{row.team}</td>
                          <td style={{ textAlign: 'left', color: 'var(--text-silver)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.name}
                          </td>
                          <td>{row.pjJugados}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{row.pjRestantes}</td>
                          <td style={{ fontWeight: 800, color: 'var(--accent-cyan)' }}>{row.rpsReales}</td>
                          <td style={{ fontWeight: 900, color: 'var(--bey-purple)' }}>{row.rpsTotales.toFixed(2)}</td>
                          <td style={{ fontWeight: 800, color: 'var(--accent-amber)' }}>{row.rpPromedio.toFixed(2)}</td>
                          <td>{row.scorePromedio.toFixed(1)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>
                            #{row.rankMin}–#{row.rankMax}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '115px' }}>
                              <div style={{ flex: 1, height: '7px', background: 'var(--bg-carbon)', borderRadius: '3px', overflow: 'hidden' }}>
                                <div
                                  style={{
                                    width: `${Math.min(100, Math.max(0, row.probTop4Pct))}%`,
                                    height: '100%',
                                    background: row.probTop4Pct >= 60 ? 'var(--accent-emerald)' : row.probTop4Pct >= 25 ? 'var(--accent-amber)' : 'var(--rag-crimson)',
                                  }}
                                />
                              </div>
                              <span style={{ fontWeight: 800, width: '40px', textAlign: 'right' }}>
                                {row.probTop4Pct.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function AllianceRobotsCards({
  members,
  accent,
  onSelect,
}: {
  members: TeamAnalytics[];
  accent: string;
  onSelect: (teamNum: number) => void;
}) {
  if (members.length === 0) {
    return <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '12px 0' }}>Selecciona equipos para proyectar la alianza.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {members.map((m) => {
        const roleMeta = detectRobotRole(m);
        return (
          <div
            key={m.team}
            onClick={() => onSelect(m.team)}
            className="tabular"
            style={{
              background: 'var(--bg-carbon)',
              border: '1px solid var(--border-steel)',
              borderLeft: `3px solid ${accent}`,
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
              <span style={{ fontWeight: 900, fontSize: '14px', color: '#FFFFFF' }}>#{m.team}</span>
              <span
                style={{
                  background: roleMeta.bg,
                  color: roleMeta.color,
                  border: `1px solid ${roleMeta.color}44`,
                  borderRadius: '3px',
                  padding: '2px 5px',
                  fontSize: '9px',
                  fontWeight: 800,
                }}
              >
                {roleMeta.role}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>• {m.topStartPos}</span>
            </div>
            <div style={{ display: 'flex', gap: '10px', fontWeight: 700, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: '#E2E8F0' }}>A [{m.minAuto}·{m.autoAvg.toFixed(0)}·{m.maxAuto}]</span>
              <span style={{ color: '#E2E8F0' }}>T [{m.minTele}·{m.teleAvg.toFixed(0)}·{m.maxTele}]</span>
              <span style={{ color: '#60A5FA' }}>Bal {(m.balancinAutoAvg + m.balancinTeleAvg).toFixed(1)}</span>
              <span style={{ color: '#FB7185' }}>Flor {m.florAvg.toFixed(1)}</span>
              <span style={{ color: '#34D399' }}>Gar {m.gardenAvg.toFixed(1)}</span>
              <span style={{ color: m.reliabilityPct >= 90 ? '#34D399' : '#FFD166' }}>
                {m.reliabilityPct.toFixed(0)}% OP
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
