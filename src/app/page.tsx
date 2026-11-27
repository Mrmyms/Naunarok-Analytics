'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AllianceMatchFinder from '@/components/AllianceMatchFinder';
import DuelComparisonBars from '@/components/DuelComparisonBars';
import MatchScheduleView from '@/components/MatchScheduleView';
import TeamProfileView from '@/components/TeamProfileView';
import {
  SCORING_PROFILES,
  computeTeamClassification,
  detectRobotRole,
  NEXT_PICK_TAG,
  PICK_TAG_META,
  type PickTag,
  type RobotRole,
  type ScoringProfileId,
  type TeamClassification,
} from '@/lib/roles';
import type { AnalyticsPayload, EventRosterTeam, ScheduleMatch, TeamAnalytics } from '@/lib/types';

type ViewTab = 'ranking' | 'equipo' | 'match' | 'alianza' | 'perfect_match' | 'standings';
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
  | 'maxNet'
  | 'classScore'
  | 'epaSim'
  | 'opr'
  | 'dpr'
  | 'ccwm'
  | 'rankCombAvg';

const EVENT_STORAGE_KEY = 'ragnarok_analytics_event_v1';
const PICK_TAGS_STORAGE_KEY = 'ragnarok_pick_tags_v1';
const DEFAULT_EVENT_CODE = 'MXTLQ';

function normalizeSearchText(str: string): string {
  return str
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export default function RagnarokAnalyticsPage() {
  const [tab, setTab] = useState<ViewTab>('ranking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null);

  // Ranking filters & picklist state
  const [searchTeam, setSearchTeam] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | RobotRole>('ALL');
  const [scoringProfile, setScoringProfile] = useState<ScoringProfileId>('balanced');
  const [onlyReliable, setOnlyReliable] = useState(false);
  const [onlyLowFouls, setOnlyLowFouls] = useState(false);
  const [onlyWithPit, setOnlyWithPit] = useState(false);
  const [hideDrafted, setHideDrafted] = useState(false);
  const [prioritizeTop, setPrioritizeTop] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortAsc, setSortAsc] = useState(true);
  const [pickTags, setPickTags] = useState<Record<number, PickTag>>({});

  // Team Profile + 1v1 Compare state
  const [selectedTeamNum, setSelectedTeamNum] = useState<number>(0);
  const [compareTeamNum, setCompareTeamNum] = useState<number>(0);

  // Alliance Playoffs Simulator (2 starters + optional backup)
  const [allyCap, setAllyCap] = useState<number>(0);
  const [allyPick1, setAllyPick1] = useState<number>(0);
  const [allySub, setAllySub] = useState<number>(0);
  const [opp1, setOpp1] = useState<number>(0);
  const [opp2, setOpp2] = useState<number>(0);
  const [oppSub, setOppSub] = useState<number>(0);

  // Optional FTCScout / Timestone dynamic event selector
  const [eventCodeInput, setEventCodeInput] = useState(DEFAULT_EVENT_CODE);
  const [eventSeason, setEventSeason] = useState(2026);
  const [loadedEvent, setLoadedEvent] = useState<{
    code: string;
    name: string;
    season: number;
    timezone?: string | null;
    hasMatches?: boolean;
  } | null>(null);
  const [eventTeams, setEventTeams] = useState<EventRosterTeam[]>([]);
  const [scheduleMatches, setScheduleMatches] = useState<ScheduleMatch[]>([]);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [searchRegion, setSearchRegion] = useState<'MX' | 'ALL'>('MX');
  const [searchingEvents, setSearchingEvents] = useState(false);
  const [eventSearchResults, setEventSearchResults] = useState<
    { code: string; name: string; regionCode?: string; start?: string; hasMatches?: boolean }[]
  >([]);
  const searchSeqRef = useRef(0);

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
        const hasTeam = (num: number) => Boolean(num) && data.teams.some((t) => t.team === num);
        setSelectedTeamNum((prev) => (hasTeam(prev) ? prev : data.teams[0].team));
        setCompareTeamNum((prev) => (hasTeam(prev) ? prev : 0));
        setAllyCap((prev) => (hasTeam(prev) ? prev : data.teams[0]?.team || 0));
        setAllyPick1((prev) => (hasTeam(prev) ? prev : data.teams[1]?.team || data.teams[0]?.team || 0));
        setOpp1((prev) => (hasTeam(prev) ? prev : data.teams[2]?.team || data.teams[0]?.team || 0));
        setOpp2((prev) => (hasTeam(prev) ? prev : data.teams[3]?.team || data.teams[1]?.team || data.teams[0]?.team || 0));
      } else {
        setSelectedTeamNum(0);
        setCompareTeamNum(0);
        setAllyCap(0);
        setAllyPick1(0);
        setOpp1(0);
        setOpp2(0);
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
                : `Actualización de Timestone (${targetEvent}) enviada; vuelve a pulsar Refrescar datos en unos segundos si aún sigue corriendo.`
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

  const syncEventFromFTCScout = useCallback(async (code: string, season: number) => {
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!clean) return;
    try {
      const res = await fetch(`/api/event?season=${season}&code=${encodeURIComponent(clean)}`);
      const json = await res.json();
      if (res.ok && json.success && json.event) {
        const nextTeams: EventRosterTeam[] = Array.isArray(json.teams) ? json.teams : [];
        const nextMatches: ScheduleMatch[] = Array.isArray(json.matches) ? json.matches : [];
        setLoadedEvent(json.event);
        loadedEventRef.current = json.event.code;
        setEventTeams(nextTeams);
        setScheduleMatches(nextMatches);
        setEventCodeInput(json.event.code);
        try {
          localStorage.setItem(
            EVENT_STORAGE_KEY,
            JSON.stringify({ event: json.event, teams: nextTeams, matches: nextMatches })
          );
        } catch {
          // ignore storage quota
        }
      }
    } catch {
      // keep existing state when offline
    }
  }, []);

  useEffect(() => {
    let initialEvent = DEFAULT_EVENT_CODE;
    let initialSeason = eventSeason;
    let urlEvent = '';
    try {
      const rawUrlEvent = new URLSearchParams(window.location.search).get('event') || '';
      urlEvent = rawUrlEvent.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');

      const savedEvent = localStorage.getItem(EVENT_STORAGE_KEY);
      if (savedEvent) {
        const parsed = JSON.parse(savedEvent);
        if (parsed.event && (!urlEvent || parsed.event.code === urlEvent)) {
          setLoadedEvent(parsed.event);
          initialEvent = parsed.event.code || DEFAULT_EVENT_CODE;
          loadedEventRef.current = initialEvent;
          if (parsed.event.season) {
            initialSeason = Number(parsed.event.season);
            setEventSeason(initialSeason);
          }
          setEventCodeInput(initialEvent);
        }
        if (!urlEvent || parsed.event?.code === urlEvent) {
          if (Array.isArray(parsed.teams)) setEventTeams(parsed.teams);
          if (Array.isArray(parsed.matches)) setScheduleMatches(parsed.matches);
        }
      }

      if (urlEvent) {
        initialEvent = urlEvent;
        loadedEventRef.current = urlEvent;
        setEventCodeInput(urlEvent);
        setLoadedEvent((prev) => (prev?.code === urlEvent ? prev : { code: urlEvent, name: urlEvent, season: initialSeason }));
      }

      const savedTags = localStorage.getItem(PICK_TAGS_STORAGE_KEY);
      if (savedTags) {
        setPickTags(JSON.parse(savedTags));
      }
    } catch {
      // ignore localStorage read errors
    }

    syncEventFromFTCScout(initialEvent, initialSeason);

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

  const setPickTag = (teamNum: number, next: PickTag) => {
    setPickTags((prev) => {
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

  const cyclePickTag = (teamNum: number) => {
    const curr = pickTags[teamNum] || 'none';
    setPickTag(teamNum, NEXT_PICK_TAG[curr]);
  };

  const teams = useMemo(() => payload?.teams || [], [payload]);
  const teamMap = useMemo(() => {
    const m = new Map<number, TeamAnalytics>();
    for (const t of teams) m.set(t.team, t);
    return m;
  }, [teams]);

  const activateEvent = async (rawCode: string) => {
    const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!code) return;
    setLoadingEvent(true);
    setEventError(null);
    try {
      const res = await fetch(`/api/event?season=${eventSeason}&code=${encodeURIComponent(code)}`);
      const json = await res.json();

      let nextEvent: {
        code: string;
        name: string;
        season: number;
        timezone?: string | null;
        hasMatches?: boolean;
      } = { code, name: code, season: eventSeason };
      let nextTeams: EventRosterTeam[] = [];
      let nextMatches: ScheduleMatch[] = [];

      if (res.ok && json.success && json.event) {
        nextEvent = json.event;
        nextTeams = Array.isArray(json.teams) ? json.teams : [];
        nextMatches = Array.isArray(json.matches) ? json.matches : [];
      } else {
        // Código personalizado local (no registrado en FTCScout): permitir activarlo para Timestone/Sheets
        setEventError(`'${code}' no se encontró en FTCScout ${eventSeason}; activado usando pestañas locales de Google Sheets.`);
      }

      setLoadedEvent(nextEvent);
      loadedEventRef.current = nextEvent.code;
      setEventTeams(nextTeams);
      setScheduleMatches(nextMatches);
      setEventCodeInput(nextEvent.code);
      setShowEventPicker(false);
      localStorage.setItem(
        EVENT_STORAGE_KEY,
        JSON.stringify({ event: nextEvent, teams: nextTeams, matches: nextMatches })
      );

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

  const fetchFTCScoutSearch = useCallback(
    async (seasonVal: number, regionVal: 'MX' | 'ALL', queryVal: string) => {
      const seq = ++searchSeqRef.current;
      setSearchingEvents(true);
      setEventError(null);
      try {
        const params = new URLSearchParams({
          action: 'search',
          season: String(seasonVal),
          region: regionVal,
        });
        if (queryVal.trim()) {
          params.set('q', queryVal.trim());
        }
        const res = await fetch(`/api/event?${params.toString()}`);
        const json = await res.json();
        if (seq !== searchSeqRef.current) return;
        if (!res.ok || !json.success) throw new Error(json.error || 'Error buscando eventos');
        setEventSearchResults(json.events || []);
      } catch (err: any) {
        if (seq !== searchSeqRef.current) return;
        setEventError(err.message);
      } finally {
        if (seq === searchSeqRef.current) {
          setSearchingEvents(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!showEventPicker) return;
    if (searchRegion === 'MX') {
      void fetchFTCScoutSearch(eventSeason, 'MX', '');
    }
  }, [showEventPicker, eventSeason, searchRegion, fetchFTCScoutSearch]);

  const visibleEventSearchResults = useMemo(() => {
    if (searchRegion !== 'MX') return eventSearchResults;
    const qNorm = normalizeSearchText(eventCodeInput);
    if (!qNorm) return eventSearchResults;
    const exactOrFiltered = eventSearchResults.filter((ev) => {
      const haystack = normalizeSearchText(`${ev.code} ${ev.name} ${ev.regionCode || ''}`);
      return haystack.includes(qNorm);
    });
    return exactOrFiltered.length > 0 ? exactOrFiltered : eventSearchResults;
  }, [searchRegion, eventSearchResults, eventCodeInput]);

  const handleSearchEvents = async () => {
    await fetchFTCScoutSearch(
      eventSeason,
      searchRegion,
      searchRegion === 'MX' ? '' : eventCodeInput
    );
  };

  const classificationByTeam = useMemo(() => {
    const map = new Map<number, TeamClassification>();
    for (const t of teams) {
      map.set(t.team, computeTeamClassification(t, teams, scoringProfile));
    }
    return map;
  }, [teams, scoringProfile]);

  const filteredTeams = useMemo(() => {
    const tagPriority: Record<PickTag, number> = { top: 0, pick: 1, none: 2, avoid: 3, drafted: 4 };
    const q = searchTeam.trim().toLowerCase();

    const getNullableMetric = (t: TeamAnalytics, key: SortKey): number | null => {
      if (key === 'classScore') return classificationByTeam.get(t.team)?.score ?? 0;
      if (key === 'epaSim') return t.timestone?.epa ?? null;
      if (key === 'opr') return t.timestone?.opr ?? null;
      if (key === 'dpr') return t.timestone?.dpr ?? null;
      if (key === 'ccwm') return t.timestone?.ccwm ?? null;
      if (key === 'rankCombAvg') return t.timestone?.rankCombAvg ?? null;
      return t[key];
    };

    return teams
      .filter((t) => {
        if (q) {
          const teamStr = String(t.team);
          const pitName = (t.pit?.teamName || '').toLowerCase();
          const tsName = (t.timestone?.name || '').toLowerCase();
          if (!teamStr.includes(q) && !pitName.includes(q) && !tsName.includes(q)) return false;
        }
        if (roleFilter !== 'ALL' && detectRobotRole(t).role !== roleFilter) return false;
        if (onlyReliable && t.reliabilityPct < 70) return false;
        if (onlyLowFouls && t.foulsAvg > 15) return false;
        if (onlyWithPit && !t.pit) return false;
        if (hideDrafted && pickTags[t.team] === 'drafted') return false;
        return true;
      })
      .sort((a, b) => {
        if (prioritizeTop) {
          const pa = tagPriority[pickTags[a.team] || 'none'];
          const pb = tagPriority[pickTags[b.team] || 'none'];
          if (pa !== pb) return pa - pb;
        }
        const av = getNullableMetric(a, sortKey);
        const bv = getNullableMetric(b, sortKey);
        if (av === null && bv === null) return a.rank - b.rank;
        if (av === null) return 1;
        if (bv === null) return -1;
        const diff = av - bv;
        return sortAsc ? diff : -diff;
      });
  }, [
    teams,
    searchTeam,
    roleFilter,
    onlyReliable,
    onlyLowFouls,
    onlyWithPit,
    hideDrafted,
    prioritizeTop,
    pickTags,
    sortKey,
    sortAsc,
    classificationByTeam,
  ]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(
        key === 'rank' ||
        key === 'team' ||
        key === 'foulsAvg' ||
        key === 'dpr' ||
        key === 'rankCombAvg'
      );
    }
  };

  const selectedTeam = teamMap.get(selectedTeamNum) || teams[0] || null;
  const compareTeam = compareTeamNum && compareTeamNum !== selectedTeam?.team ? teamMap.get(compareTeamNum) || null : null;

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

  const timestoneData = payload?.timestone;
  const activeEventCode = loadedEvent?.code || timestoneData?.eventCode || '';
  const availableEventOptions = useMemo(() => {
    const set = new Set<string>(timestoneData?.availableEvents || []);
    if (loadedEvent?.code) set.add(loadedEvent.code);
    if (timestoneData?.eventCode) set.add(timestoneData.eventCode);
    return Array.from(set).filter(Boolean).sort();
  }, [timestoneData?.availableEvents, timestoneData?.eventCode, loadedEvent?.code]);

  const myAllianceProj = aggregateAlliance([allyCap, allyPick1, allySub]);
  const oppAllianceProj = aggregateAlliance([opp1, opp2, oppSub]);
  const allianceDiff = Math.round((myAllianceProj.net - oppAllianceProj.net) * 10) / 10;

  const openTeamProfile = (teamNum: number) => {
    setSelectedTeamNum(teamNum);
    setTab('equipo');
  };

  return (
    <div className="shell">
      {/* Band 1: Brand & Collaboration Header */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-lockup">
            <img
              src="/beyonder-logo.svg"
              alt="Logo The Beyonder"
              width={50}
              height={50}
              className="brand-logo-beyonder"
            />
            <div className="brand-text-stack">
              <div className="brand-title">
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
              <div className="brand-subtitle">FTC Scouting &amp; Alliance Engine</div>
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
                strokeWidth="2.1"
                strokeLinecap="round"
              />
            </svg>
            <img
              src="/ragnarok-logo.svg"
              alt="Logo Ragnarok"
              className="collab-logo-ragnarok"
            />
          </div>
        </div>
      </header>

      {/* Band 2: Sticky Navigation & Live Session Controls */}
      <div className="nav-subbar">
        <div className="nav-subbar-inner">
          <nav className="nav-tabs" aria-label="Vistas de Analítica">
            {(
              [
                { id: 'ranking', label: 'Ranking & Picklist' },
                { id: 'equipo', label: 'Perfil de Equipo' },
                { id: 'match', label: 'Horario Matches' },
                { id: 'alianza', label: 'Simulador Alianzas' },
                { id: 'perfect_match', label: '✦ Match Perfecto', featured: true },
                { id: 'standings', label: 'Standings Proy.' },
              ] as { id: ViewTab; label: string; featured?: boolean }[]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`nav-tab ${item.featured ? 'nav-tab-featured' : ''} ${tab === item.id ? 'active' : ''}`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="topbar-controls">
            <button
              type="button"
              onClick={() => setShowEventPicker((prev) => !prev)}
              aria-expanded={showEventPicker}
              aria-label="Cambiar o buscar evento"
              className={`btn-ghost tabular ${showEventPicker ? 'active' : ''}`}
              title="Cambiar evento desde Google Sheets o buscar en FTCScout"
            >
              <span>{activeEventCode ? `Evento: ${activeEventCode}` : 'Seleccionar evento'}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                style={{
                  transform: showEventPicker ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                }}
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => triggerTimestoneRefresh(undefined, false)}
              disabled={timestoneRefreshing}
              className="btn-ghost"
              title={
                timestoneData?.updatedAt
                  ? `Último Timestone (${activeEventCode || 'Sin evento'}): ${new Date(timestoneData.updatedAt).toLocaleString('es-MX')} — Clic para recalcular simulación`
                  : 'Recalcular simulación Timestone (Monte Carlo + FTCScout)'
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
                : `Timestone${timestoneData?.ageMinutes !== null && timestoneData?.ageMinutes !== undefined ? ` • ${timestoneData.ageMinutes}m` : ''}`}
            </button>

            <button
              type="button"
              onClick={() => fetchAnalytics()}
              disabled={loading}
              className="btn-rag"
              title="Recargar datos actuales desde Google Sheets sin recalcular Timestone"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              {loading ? 'Refrescando...' : 'Refrescar datos'}
            </button>
          </div>
        </div>
      </div>

      <main className="main-container">
        {showEventPicker && (
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderColor: 'var(--bey-purple)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <span className="panel-title">Selector Dinámico de Evento (FTCScout + Google Sheets)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {loadedEvent && loadedEvent.code !== DEFAULT_EVENT_CODE && (
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem(EVENT_STORAGE_KEY);
                      activateEvent(DEFAULT_EVENT_CODE);
                    }}
                    className="btn-ghost"
                    style={{ padding: '4px 9px', fontSize: '11px' }}
                  >
                    Restablecer ({DEFAULT_EVENT_CODE})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowEventPicker(false)}
                  className="btn-ghost"
                  style={{ padding: '4px 9px', fontSize: '11px' }}
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <select value={eventSeason} onChange={(e) => setEventSeason(Number(e.target.value))} className="select-rag tabular">
                <option value={2026}>2026</option>
                <option value={2025}>2025</option>
              </select>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => setSearchRegion('MX')}
                  className={`btn-ghost ${searchRegion === 'MX' ? 'active' : ''}`}
                  style={{ padding: '5px 9px', fontSize: '11px' }}
                >
                  México (MX)
                </button>
                <button
                  type="button"
                  onClick={() => setSearchRegion('ALL')}
                  className={`btn-ghost ${searchRegion === 'ALL' ? 'active' : ''}`}
                  style={{ padding: '5px 9px', fontSize: '11px' }}
                >
                  Global
                </button>
              </div>
              <input
                type="text"
                placeholder={
                  searchRegion === 'MX'
                    ? 'Filtrar México (ej. Monterrey, MXTLQ, CDMX...)'
                    : 'Buscar nombre o código global (ej. CMP, USNM...)'
                }
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

            {visibleEventSearchResults.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                {visibleEventSearchResults.map((ev) => (
                  <button
                    key={ev.code}
                    type="button"
                    onClick={() => activateEvent(ev.code)}
                    className="btn-ghost"
                    style={{ padding: '5px 10px', fontSize: '11px', textAlign: 'left', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <strong style={{ color: 'var(--bey-cyan)' }}>{ev.code}</strong> · {ev.name}
                    {ev.regionCode ? ` (${ev.regionCode})` : ''}
                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 800,
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: ev.hasMatches ? 'rgba(16, 185, 129, 0.16)' : 'rgba(148, 163, 184, 0.14)',
                        color: ev.hasMatches ? 'var(--accent-emerald)' : 'var(--text-muted)',
                      }}
                    >
                      {ev.hasMatches ? '✓ Horario' : 'Sin matches'}
                    </span>
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
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Equipos Activos</span>
                <span className="kpi-value tabular">{payload?.teamsCount ?? 0}</span>
                <span className="kpi-sub tabular">{payload?.pitCount ?? 0} con Pit Scouting</span>
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

            {/* Selector de Perfil de Clasificación + Filtros tácticos */}
            <div className="filter-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--accent-amber)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Clasificación:
                  </span>
                  {(Object.keys(SCORING_PROFILES) as ScoringProfileId[]).map((pid) => {
                    const prof = SCORING_PROFILES[pid];
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => setScoringProfile(pid)}
                        className={`btn-ghost ${scoringProfile === pid ? 'active' : ''}`}
                        title={prof.description}
                      >
                        {prof.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', borderTop: '1px solid var(--border-steel)', paddingTop: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="Buscar # o nombre..."
                    value={searchTeam}
                    onChange={(e) => setSearchTeam(e.target.value)}
                    className="input-rag tabular"
                    style={{ width: '165px' }}
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
                    onClick={() => setOnlyWithPit(!onlyWithPit)}
                    className={`btn-ghost ${onlyWithPit ? 'active' : ''}`}
                  >
                    Con Pit
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
              </div>
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
                      { k: 'classScore', l: 'Tier / Score' },
                      { k: 'epaNetAvg', l: 'EPA Neto' },
                      { k: 'epaSim', l: 'EPA Sim.' },
                      { k: 'rankCombAvg', l: 'Prom OPR/DPR' },
                      { k: 'opr', l: 'OPR (#Off)' },
                      { k: 'dpr', l: 'DPR (#Def)' },
                      { k: 'ccwm', l: 'CCWM' },
                    ].map((col) => (
                      <th key={col.k} onClick={() => handleSort(col.k as SortKey)}>
                        {col.l} {sortKey === col.k ? (sortAsc ? '▲' : '▼') : ''}
                      </th>
                    ))}
                    <th>Rol</th>
                    <th>Pit</th>
                    {[
                      { k: 'matchesPlayed', l: 'PJ' },
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
                  </tr>
                </thead>
                <tbody className="tabular">
                  {filteredTeams.length === 0 ? (
                    <tr>
                      <td
                        colSpan={24}
                        style={{ padding: '28px', color: 'var(--text-muted)' }}
                      >
                        {loading ? 'Cargando datos...' : 'Sin equipos que coincidan con el filtro.'}
                      </td>
                    </tr>
                  ) : (
                    filteredTeams.map((t) => {
                      const roleMeta = detectRobotRole(t);
                      const tag = pickTags[t.team] || 'none';
                      const tagMeta = PICK_TAG_META[tag];
                      const cls = classificationByTeam.get(t.team);

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
                          <td style={{ fontWeight: 900, color: '#FFFFFF' }}>
                            #{t.team}
                            {(t.pit?.teamName || t.timestone?.name) && (
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, marginLeft: '5px' }}>
                                {t.pit?.teamName || t.timestone?.name}
                              </span>
                            )}
                          </td>
                          <td>
                            {cls && (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  background: cls.tierBg,
                                  border: `1px solid ${cls.tierColor}55`,
                                  color: cls.tierColor,
                                  borderRadius: '3px',
                                  padding: '2px 6px',
                                  fontSize: '10.5px',
                                  fontWeight: 900,
                                }}
                              >
                                <span>{cls.tier}</span>
                                <span style={{ color: 'var(--text-white)', fontWeight: 800 }}>{cls.score.toFixed(0)}</span>
                              </span>
                            )}
                          </td>
                          <td style={{ fontWeight: 900, color: 'var(--bey-purple)' }}>{t.epaNetAvg.toFixed(1)}</td>
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
                          <td style={{ color: 'var(--text-silver)', fontWeight: 800 }}>
                            {t.timestone?.rankCombAvg !== null && t.timestone?.rankCombAvg !== undefined
                              ? `#${t.timestone.rankCombAvg.toFixed(1)}`
                              : '—'}
                          </td>
                          <td style={{ color: '#7DD3FC', fontWeight: 800 }}>
                            {t.timestone?.opr !== null && t.timestone?.opr !== undefined ? (
                              <>
                                {t.timestone.opr.toFixed(1)}
                                {t.timestone.rankOff ? (
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                                    (#{t.timestone.rankOff})
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td style={{ color: '#34D399', fontWeight: 800 }}>
                            {t.timestone?.dpr !== null && t.timestone?.dpr !== undefined ? (
                              <>
                                {t.timestone.dpr.toFixed(1)}
                                {t.timestone.rankDef ? (
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                                    (#{t.timestone.rankDef})
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td
                            style={{
                              fontWeight: 800,
                              color:
                                t.timestone?.ccwm !== null && t.timestone?.ccwm !== undefined
                                  ? t.timestone.ccwm >= 0
                                    ? 'var(--accent-amber)'
                                    : 'var(--rag-coral)'
                                  : 'var(--text-muted)',
                            }}
                          >
                            {t.timestone?.ccwm !== null && t.timestone?.ccwm !== undefined
                              ? `${t.timestone.ccwm >= 0 ? '+' : ''}${t.timestone.ccwm.toFixed(1)}`
                              : '—'}
                          </td>
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
                          <td>
                            {t.pit ? (
                              <span
                                style={{
                                  background: 'rgba(16, 185, 129, 0.14)',
                                  color: 'var(--accent-emerald)',
                                  border: '1px solid rgba(16, 185, 129, 0.35)',
                                  borderRadius: '3px',
                                  padding: '2px 6px',
                                  fontSize: '9.5px',
                                  fontWeight: 800,
                                }}
                                title={`${t.pit.chassisType || 'Pit'} • ${t.pit.photos.length} foto(s)`}
                              >
                                Pit ✓{t.pit.photos.length > 0 ? ` · ${t.pit.photos.length}📷` : ''}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td>{t.matchesPlayed}</td>
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
          <TeamProfileView
            teams={teams}
            selectedTeam={selectedTeam}
            compareTeam={compareTeam}
            classificationByTeam={classificationByTeam}
            scoringProfile={scoringProfile}
            pickTags={pickTags}
            onSelectTeam={(teamNum) => {
              setSelectedTeamNum(teamNum);
              if (compareTeamNum === teamNum) setCompareTeamNum(0);
            }}
            onSelectCompareTeam={setCompareTeamNum}
            onSetPickTag={setPickTag}
            onChangeScoringProfile={setScoringProfile}
            onFindPerfectMatch={(teamNum) => {
              setAllyCap(teamNum);
              setTab('perfect_match');
            }}
          />
        )}

        {/* ================= 3. HORARIO DE MATCHES EXPANDIBLE ================= */}
        {tab === 'match' && (
          <MatchScheduleView
            teams={teams}
            teamMap={teamMap}
            timestoneMatches={timestoneData?.matches || []}
            timestoneTeams={timestoneData?.teams || []}
            scheduleMatches={scheduleMatches}
            eventTeams={eventTeams}
            activeEventCode={activeEventCode}
            loadedEvent={loadedEvent}
            eventSeason={eventSeason}
            eventCodeInput={eventCodeInput}
            loadingEvent={loadingEvent}
            eventError={eventError}
            onChangeEventSeason={setEventSeason}
            onChangeEventCodeInput={setEventCodeInput}
            onLoadEvent={handleLoadEvent}
            onOpenTeamProfile={openTeamProfile}
            onSendToAllianceSim={(r1, r2, b1, b2) => {
              setAllyCap(r1);
              setAllyPick1(r2);
              setAllySub(0);
              setOpp1(b1);
              setOpp2(b2);
              setOppSub(0);
              setTab('alianza');
            }}
          />
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
              <div className="tabular" style={{ display: 'flex', gap: '12px', fontSize: '13px', fontWeight: 800, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--bey-purple)' }}>TU ALIANZA: {myAllianceProj.net.toFixed(1)}</span>
                <span style={{ color: 'var(--accent-cyan)' }}>RIVAL: {oppAllianceProj.net.toFixed(1)}</span>
                <button
                  type="button"
                  onClick={() => setTab('perfect_match')}
                  className="btn-ghost"
                  style={{ borderColor: 'rgba(168, 85, 247, 0.5)', color: '#E9D5FF', fontSize: '11px' }}
                >
                  ✦ Buscar Match Perfecto →
                </button>
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

        {/* ================= 4B. MATCH PERFECTO (OPTIMIZADOR DE PAREJA) ================= */}
        {tab === 'perfect_match' && (
          <AllianceMatchFinder
            captain={teamMap.get(allyCap) || teams[0] || null}
            onChangeCaptain={setAllyCap}
            allTeams={teams}
            pickTags={pickTags}
            rivalProjectedNet={oppAllianceProj.members.length > 0 ? oppAllianceProj.net : null}
            selectedPick1={allyPick1}
            selectedSub={allySub}
            excludedRivalIds={[opp1, opp2, oppSub].filter(Boolean)}
            onSelectPick1={setAllyPick1}
            onSelectSub={setAllySub}
            onSimulateAlliance={(teamNum) => {
              setAllyPick1(teamNum);
              setTab('alianza');
            }}
            onOpenProfile={openTeamProfile}
          />
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

      <footer className="shell-footer">
        <div className="shell-footer-inner">
          <span>THE BEYONDER · Pit-Wall Scouting Analytics</span>
          <span>Nautilus 4010 × Ragnarok</span>
        </div>
      </footer>
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
