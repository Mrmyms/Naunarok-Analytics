'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DistributionBars from '@/components/DistributionBars';
import RagnarokFieldHeatmap from '@/components/RagnarokFieldHeatmap';
import TeamHistoricChart from '@/components/TeamHistoricChart';
import type { AnalyticsPayload, ScheduleMatch, TeamAnalytics } from '@/lib/types';

type ViewTab = 'ranking' | 'equipo' | 'match' | 'alianza';
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

export default function RagnarokAnalyticsPage() {
  const [tab, setTab] = useState<ViewTab>('ranking');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<AnalyticsPayload | null>(null);

  // Ranking tab filters & sort
  const [searchTeam, setSearchTeam] = useState('');
  const [onlyReliable, setOnlyReliable] = useState(false);
  const [onlyLowFouls, setOnlyLowFouls] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortAsc, setSortAsc] = useState(true);

  // Team Profile tab state
  const [selectedTeamNum, setSelectedTeamNum] = useState<number>(0);

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

  // Optional FTCScout event loader
  const [eventCodeInput, setEventCodeInput] = useState('');
  const [eventSeason, setEventSeason] = useState(2026);
  const [loadedEvent, setLoadedEvent] = useState<{ code: string; name: string; season: number } | null>(null);
  const [scheduleMatches, setScheduleMatches] = useState<ScheduleMatch[]>([]);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analytics', { cache: 'no-store' });
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
    } catch (err: any) {
      setError(err.message || 'Error de red');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
    try {
      const saved = localStorage.getItem(EVENT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.event) setLoadedEvent(parsed.event);
        if (Array.isArray(parsed.matches)) setScheduleMatches(parsed.matches);
      }
    } catch {
      // ignore localStorage read errors
    }
  }, [fetchAnalytics]);

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

  const handleLoadEvent = async () => {
    const code = eventCodeInput.trim().toUpperCase();
    if (!code) return;
    setLoadingEvent(true);
    setEventError(null);
    try {
      const res = await fetch(`/api/event?season=${eventSeason}&code=${encodeURIComponent(code)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Evento no encontrado');
      setLoadedEvent(json.event);
      setScheduleMatches(json.matches || []);
      localStorage.setItem(EVENT_STORAGE_KEY, JSON.stringify({ event: json.event, matches: json.matches || [] }));
    } catch (err: any) {
      setEventError(err.message);
    } finally {
      setLoadingEvent(false);
    }
  };

  // Filtered & sorted ranking table
  const filteredTeams = useMemo(() => {
    return teams
      .filter((t) => {
        if (searchTeam.trim() && !String(t.team).includes(searchTeam.trim())) return false;
        if (onlyReliable && t.reliabilityPct < 70) return false;
        if (onlyLowFouls && t.foulsAvg > 15) return false;
        return true;
      })
      .sort((a, b) => {
        const diff = a[sortKey] - b[sortKey];
        return sortAsc ? diff : -diff;
      });
  }, [teams, searchTeam, onlyReliable, onlyLowFouls, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'rank' || key === 'team' || key === 'foulsAvg');
    }
  };

  const selectedTeam = teamMap.get(selectedTeamNum) || teams[0] || null;
  const topEpaTeam = teams[0] || null;
  const bestAutoTeam = useMemo(
    () => (teams.length ? [...teams].sort((a, b) => b.autoAvg - a.autoAvg)[0] : null),
    [teams]
  );

  // Alliance aggregation helper
  const aggregateAlliance = (teamIds: number[]) => {
    const members = teamIds.filter((id) => id > 0).map((id) => teamMap.get(id)).filter((t): t is TeamAnalytics => !!t);
    const sum = (fn: (t: TeamAnalytics) => number) => Math.round(members.reduce((s, t) => s + fn(t), 0) * 10) / 10;
    const startZones = members.map((m) => m.topStartPos).filter((p) => p && p !== '—');
    const hasCollision = startZones.length >= 2 && new Set(startZones).size < startZones.length;

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
    };
  };

  const redAllianceProj = aggregateAlliance([red1, red2]);
  const blueAllianceProj = aggregateAlliance([blue1, blue2]);
  const redWinProb =
    redAllianceProj.net + blueAllianceProj.net > 0
      ? Math.round((Math.max(1, redAllianceProj.net) / (Math.max(1, redAllianceProj.net) + Math.max(1, blueAllianceProj.net))) * 100)
      : 50;

  const myAllianceProj = aggregateAlliance([allyCap, allyPick1, allySub]);
  const oppAllianceProj = aggregateAlliance([opp1, opp2, oppSub]);

  const openTeamProfile = (teamNum: number) => {
    setSelectedTeamNum(teamNum);
    setTab('equipo');
  };

  return (
    <div className="shell">
      {/* Top Pit-Wall Bar */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-lockup">
            <div className="brand-mark">RG</div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 900, letterSpacing: '0.6px', color: '#FAFAFA' }}>
                RAGNAROK <span style={{ color: 'var(--rag-crimson)' }}>ANALYTICS</span>
              </div>
              <div className="tabular" style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>
                FTC BIOBUZZ • FUENTE: RESUMEN_EQUIPOS {payload?.updatedAt ? `• SYNC ${payload.updatedAt}` : ''}
              </div>
            </div>
          </div>

          <nav className="nav-tabs" aria-label="Vistas de Analítica">
            {(
              [
                { id: 'ranking', label: 'Ranking & Picklist' },
                { id: 'equipo', label: 'Perfil de Equipo' },
                { id: 'match', label: 'Match 2v2' },
                { id: 'alianza', label: 'Simulador Alianzas' },
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

          <button type="button" onClick={fetchAnalytics} disabled={loading} className="btn-rag">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {loading ? 'Sincronizando...' : 'Actualizar'}
          </button>
        </div>
      </header>

      <main className="main-container">
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
            Error cargando Google Sheets: {error}
          </div>
        )}

        {/* ================= 1. RANKING & PICKLIST ================= */}
        {tab === 'ranking' && (
          <>
            <section className="kpi-grid">
              <div className="kpi-card">
                <span className="kpi-label">Matches Capturados</span>
                <span className="kpi-value tabular">{payload?.matchesCount ?? 0}</span>
                <span className="kpi-sub">Registros en Captura_BIOBUZZ</span>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Equipos Evaluados</span>
                <span className="kpi-value tabular">{payload?.teamsCount ?? 0}</span>
                <span className="kpi-sub">Filas activas en Resumen_Equipos</span>
              </div>
              <div className="kpi-card" style={{ borderTopColor: 'var(--accent-amber)' }}>
                <span className="kpi-label">Líder EPA Neto</span>
                <span className="kpi-value tabular" style={{ color: 'var(--accent-amber)' }}>
                  {topEpaTeam ? `#${topEpaTeam.team}` : '—'}
                </span>
                <span className="kpi-sub tabular">
                  {topEpaTeam ? `${topEpaTeam.epaNetAvg.toFixed(1)} pts prom.` : 'Sin datos'}
                </span>
              </div>
              <div className="kpi-card" style={{ borderTopColor: 'var(--accent-cyan)' }}>
                <span className="kpi-label">Mejor Autónomo</span>
                <span className="kpi-value tabular" style={{ color: 'var(--accent-cyan)' }}>
                  {bestAutoTeam ? `#${bestAutoTeam.team}` : '—'}
                </span>
                <span className="kpi-sub tabular">
                  {bestAutoTeam ? `${bestAutoTeam.autoAvg.toFixed(1)} auto pts` : 'Sin datos'}
                </span>
              </div>
            </section>

            {/* Filtros */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Filtrar # equipo..."
                  value={searchTeam}
                  onChange={(e) => setSearchTeam(e.target.value)}
                  className="input-rag tabular"
                  style={{ width: '165px' }}
                />
                <button
                  type="button"
                  onClick={() => setOnlyReliable(!onlyReliable)}
                  className={`btn-ghost ${onlyReliable ? 'active' : ''}`}
                >
                  Confiabilidad ≥ 70%
                </button>
                <button
                  type="button"
                  onClick={() => setOnlyLowFouls(!onlyLowFouls)}
                  className={`btn-ghost ${onlyLowFouls ? 'active' : ''}`}
                >
                  Faltas ≤ 15 pts
                </button>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                Haz clic en cualquier equipo para abrir su telemetría completa
              </span>
            </div>

            {/* Tabla Maestra */}
            <div className="table-wrap">
              <table className="rag-table">
                <thead>
                  <tr>
                    {[
                      { k: 'rank', l: 'Rank' },
                      { k: 'team', l: 'Equipo' },
                      { k: 'matchesPlayed', l: 'PJ' },
                      { k: 'epaNetAvg', l: 'EPA Neto' },
                      { k: 'autoAvg', l: 'Auto' },
                      { k: 'teleAvg', l: 'TeleOp' },
                      { k: 'balancinAutoAvg', l: 'Bal. Auto' },
                      { k: 'balancinTeleAvg', l: 'Bal. Tele' },
                      { k: 'florAvg', l: 'Flor Total' },
                      { k: 'gardenAvg', l: 'Garden' },
                      { k: 'flowerControlPct', l: '% Flor' },
                      { k: 'reliabilityPct', l: '% Operativo' },
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
                      <td colSpan={15} style={{ padding: '28px', color: 'var(--text-muted)' }}>
                        {loading ? 'Cargando datos de Google Sheets...' : 'Sin equipos que coincidan con el filtro.'}
                      </td>
                    </tr>
                  ) : (
                    filteredTeams.map((t) => (
                      <tr key={t.team} onClick={() => openTeamProfile(t.team)}>
                        <td style={{ fontWeight: 900, color: t.rank === 1 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                          #{t.rank}
                        </td>
                        <td style={{ fontWeight: 900, color: '#FFFFFF' }}>#{t.team}</td>
                        <td>{t.matchesPlayed}</td>
                        <td style={{ fontWeight: 900, color: 'var(--rag-crimson)' }}>{t.epaNetAvg.toFixed(1)}</td>
                        <td style={{ color: 'var(--accent-cyan)' }}>{t.autoAvg.toFixed(1)}</td>
                        <td style={{ color: 'var(--accent-amber)' }}>{t.teleAvg.toFixed(1)}</td>
                        <td>{t.balancinAutoAvg.toFixed(1)}</td>
                        <td>{t.balancinTeleAvg.toFixed(1)}</td>
                        <td>{t.florAvg.toFixed(1)}</td>
                        <td>{t.gardenAvg.toFixed(1)}</td>
                        <td>{t.flowerControlPct.toFixed(0)}%</td>
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
                    ))
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="panel-title">Equipo:</span>
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
              </div>

              {selectedTeam && (
                <div className="tabular" style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px', fontWeight: 800 }}>
                  <span>RANK <strong style={{ color: 'var(--accent-amber)' }}>#{selectedTeam.rank}</strong></span>
                  <span>PJ <strong>{selectedTeam.matchesPlayed}</strong></span>
                  <span>EPA NETO <strong style={{ color: 'var(--rag-crimson)' }}>{selectedTeam.epaNetAvg.toFixed(1)}</strong></span>
                  <span>RANGO <strong>{selectedTeam.minNet}–{selectedTeam.maxNet}</strong></span>
                  <span>OP <strong style={{ color: selectedTeam.reliabilityPct >= 90 ? 'var(--accent-emerald)' : 'var(--rag-coral)' }}>{selectedTeam.reliabilityPct.toFixed(0)}%</strong></span>
                  <span>PILOTO <strong style={{ color: 'var(--accent-amber)' }}>{selectedTeam.driverAvg.toFixed(1)}/5</strong></span>
                </div>
              )}
            </div>

            {!selectedTeam ? (
              <div className="panel" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                No hay equipos registrados en Resumen_Equipos todavía.
              </div>
            ) : (
              <div className="split-2col">
                {/* Columna Izquierda: Distribuciones & Tasas */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                    <div className="tabular" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
                      {[
                        { l: 'Auto Leave', v: `${selectedTeam.autoLeavePct.toFixed(0)}%`, c: 'var(--accent-cyan)' },
                        { l: 'Auto Park', v: `${selectedTeam.autoParkPct.toFixed(0)}%`, c: 'var(--accent-cyan)' },
                        { l: 'Endgame Park', v: `${selectedTeam.endgameParkPct.toFixed(0)}%`, c: 'var(--accent-amber)' },
                        { l: 'Control Flor', v: `${selectedTeam.flowerControlPct.toFixed(0)}%`, c: 'var(--accent-emerald)' },
                        { l: 'Bottom Nectar', v: `${selectedTeam.bottomNectarPct.toFixed(0)}%`, c: 'var(--accent-purple)' },
                        { l: 'Descore Garden', v: `${selectedTeam.gardenDescorePct.toFixed(0)}%`, c: 'var(--rag-coral)' },
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
                              borderLeft: `3px solid ${n.status === '100% Operativo' ? 'var(--rag-crimson)' : 'var(--accent-amber)'}`,
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
                    <RagnarokFieldHeatmap positions={selectedTeam.positions} teamNumber={selectedTeam.team} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ================= 3. MATCH BREAKDOWN 2v2 ================= */}
        {tab === 'match' && (
          <>
            {/* Event / Match Loader */}
            <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span className="panel-title">Match #:</span>
                <input
                  type="number"
                  min={1}
                  value={matchNum}
                  onChange={(e) => setMatchNum(Math.max(1, Number(e.target.value) || 1))}
                  className="input-rag tabular"
                  style={{ width: '74px', textAlign: 'center' }}
                />
                {loadedEvent && (
                  <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--accent-emerald)' }}>
                    Schedule cargado: {loadedEvent.code} ({loadedEvent.season})
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
              <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '13px', fontWeight: 900 }}>
                <span style={{ color: 'var(--rag-crimson)' }}>ROJA PROYECTADA: {redAllianceProj.net.toFixed(1)} PTS ({redWinProb}%)</span>
                <span style={{ color: 'var(--accent-cyan)' }}>AZUL PROYECTADA: {blueAllianceProj.net.toFixed(1)} PTS ({100 - redWinProb}%)</span>
              </div>
              <div style={{ height: '10px', width: '100%', background: 'var(--accent-cyan)', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${redWinProb}%`, background: 'var(--rag-crimson)' }} />
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
                  <div style={{ marginBottom: '10px', padding: '8px 10px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.14)', border: '1px solid var(--accent-amber)', fontSize: '11px', fontWeight: 700, color: 'var(--accent-amber)' }}>
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

                <AllianceRobotsCards members={redAllianceProj.members} accent="var(--rag-crimson)" />
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
                  <div style={{ marginBottom: '10px', padding: '8px 10px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.14)', border: '1px solid var(--accent-amber)', fontSize: '11px', fontWeight: 700, color: 'var(--accent-amber)' }}>
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

                <AllianceRobotsCards members={blueAllianceProj.members} accent="var(--accent-cyan)" />
              </div>
            </div>
          </>
        )}

        {/* ================= 4. SIMULADOR DE ALIANZAS (PLAYOFFS) ================= */}
        {tab === 'alianza' && (
          <div className="match-2col">
            {[
              {
                title: 'Tu Alianza (Playoffs)',
                color: 'var(--rag-crimson)',
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
                    { l: 'Auto', v: side.proj.auto.toFixed(1), c: 'var(--accent-cyan)' },
                    { l: 'TeleOp', v: side.proj.tele.toFixed(1), c: 'var(--accent-amber)' },
                    { l: 'Faltas', v: side.proj.fouls.toFixed(1), c: 'var(--rag-coral)' },
                    { l: 'Balancín P+N', v: side.proj.balancin.toFixed(1), c: 'var(--accent-amber)' },
                    { l: 'Flor P+N', v: side.proj.flor.toFixed(1), c: 'var(--accent-purple)' },
                    { l: 'Swarm Pts', v: side.proj.swarmPts.toFixed(1), c: side.proj.swarmPts >= 16 ? 'var(--accent-emerald)' : 'var(--text-silver)' },
                  ].map((k) => (
                    <div key={k.l} style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '4px', padding: '10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>{k.l}</div>
                      <div style={{ fontSize: '18px', fontWeight: 900, color: k.c }}>{k.v}</div>
                    </div>
                  ))}
                </div>

                <AllianceRobotsCards members={side.proj.members} accent={side.color} />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function AllianceRobotsCards({ members, accent }: { members: TeamAnalytics[]; accent: string }) {
  if (members.length === 0) {
    return <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '12px 0' }}>Selecciona equipos para proyectar la alianza.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {members.map((m) => (
        <div
          key={m.team}
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
          }}
        >
          <div>
            <span style={{ fontWeight: 900, fontSize: '14px', color: '#FFFFFF' }}>#{m.team}</span>{' '}
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>• Inicio: {m.topStartPos}</span>
          </div>
          <div style={{ display: 'flex', gap: '12px', fontWeight: 700 }}>
            <span style={{ color: 'var(--accent-cyan)' }}>Auto {m.autoAvg.toFixed(1)}</span>
            <span style={{ color: 'var(--accent-amber)' }}>Tele {m.teleAvg.toFixed(1)}</span>
            <span>Bal {(m.balancinAutoAvg + m.balancinTeleAvg).toFixed(1)}</span>
            <span>Flor {m.florAvg.toFixed(1)}</span>
            <span style={{ color: m.reliabilityPct >= 90 ? 'var(--accent-emerald)' : 'var(--rag-coral)' }}>
              {m.reliabilityPct.toFixed(0)}% OP
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

