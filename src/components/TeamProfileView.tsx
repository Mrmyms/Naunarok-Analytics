'use client';

import React, { useMemo, useState } from 'react';
import DistributionBars from '@/components/DistributionBars';
import DuelComparisonBars from '@/components/DuelComparisonBars';
import RagnarokFieldHeatmap from '@/components/RagnarokFieldHeatmap';
import TeamHistoricChart from '@/components/TeamHistoricChart';
import TeamPitCard, { PitComparePanel } from '@/components/TeamPitCard';
import TeamRadarChart from '@/components/TeamRadarChart';
import {
  PICK_TAG_META,
  SCORING_PROFILES,
  detectRobotRole,
  type PickTag,
  type ScoringProfileId,
  type TeamClassification,
} from '@/lib/roles';
import type { TeamAnalytics } from '@/lib/types';

type ProfileSubTab = 'resumen' | 'pit' | 'partidos' | 'comparar';
type SidebarFilter = 'all' | 'starred' | 'pit';

const DIRECT_PICK_TAGS: readonly Exclude<PickTag, 'none'>[] = ['top', 'pick', 'avoid', 'drafted'];

interface TeamProfileViewProps {
  teams: TeamAnalytics[];
  selectedTeam: TeamAnalytics | null;
  compareTeam: TeamAnalytics | null;
  classificationByTeam: Map<number, TeamClassification>;
  scoringProfile: ScoringProfileId;
  pickTags: Record<number, PickTag>;
  onSelectTeam: (teamNum: number) => void;
  onSelectCompareTeam: (teamNum: number) => void;
  onSetPickTag: (teamNum: number, tag: PickTag) => void;
  onChangeScoringProfile: (profile: ScoringProfileId) => void;
  onFindPerfectMatch: (teamNum: number) => void;
}

export default function TeamProfileView({
  teams,
  selectedTeam,
  compareTeam,
  classificationByTeam,
  scoringProfile,
  pickTags,
  onSelectTeam,
  onSelectCompareTeam,
  onSetPickTag,
  onChangeScoringProfile,
  onFindPerfectMatch,
}: TeamProfileViewProps) {
  const [subTab, setSubTab] = useState<ProfileSubTab>('resumen');
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>('all');

  const filteredSidebarTeams = useMemo(() => {
    const q = sidebarQuery.trim().toLowerCase();
    return teams.filter((t) => {
      if (sidebarFilter === 'starred') {
        const tag = pickTags[t.team];
        if (tag !== 'top' && tag !== 'pick') return false;
      } else if (sidebarFilter === 'pit' && !t.pit) {
        return false;
      }

      if (q) {
        const numMatch = String(t.team).includes(q);
        const pitName = (t.pit?.teamName || '').toLowerCase();
        const tsName = (t.timestone?.name || '').toLowerCase();
        if (!numMatch && !pitName.includes(q) && !tsName.includes(q)) return false;
      }
      return true;
    });
  }, [teams, sidebarQuery, sidebarFilter, pickTags]);

  const stepTeam = (delta: number) => {
    const list =
      selectedTeam && filteredSidebarTeams.some((t) => t.team === selectedTeam.team)
        ? filteredSidebarTeams
        : teams;
    if (!list.length || !selectedTeam) return;
    const idx = list.findIndex((t) => t.team === selectedTeam.team);
    const nextIdx = idx === -1 ? 0 : (idx + delta + list.length) % list.length;
    onSelectTeam(list[nextIdx].team);
  };

  const suggestedRivals = useMemo(() => {
    if (!selectedTeam) return [];
    const others = teams.filter((t) => t.team !== selectedTeam.team);
    const byRank = [...others].sort((a, b) => a.rank - b.rank);
    const picked: TeamAnalytics[] = [];
    const seen = new Set<number>();

    const addIfValid = (candidate?: TeamAnalytics) => {
      if (!candidate || seen.has(candidate.team)) return;
      seen.add(candidate.team);
      picked.push(candidate);
    };

    // Top 3 overall + nearest rank neighbors around the selected team
    for (let i = 0; i < 3; i++) addIfValid(byRank[i]);
    const selPos = byRank.findIndex((t) => t.rank > selectedTeam.rank);
    const anchor = selPos === -1 ? byRank.length - 1 : selPos;
    for (const offset of [-1, 0, 1, 2, -2]) {
      addIfValid(byRank[anchor + offset]);
    }
    for (const t of byRank) {
      if (picked.length >= 6) break;
      addIfValid(t);
    }
    return picked.slice(0, 6);
  }, [teams, selectedTeam]);

  if (!selectedTeam) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
        No hay equipos registrados todavía.
      </div>
    );
  }

  const teamName = selectedTeam.pit?.teamName || selectedTeam.timestone?.name || '';
  const roleMeta = detectRobotRole(selectedTeam);
  const cls = classificationByTeam.get(selectedTeam.team);
  const activeTag: PickTag = pickTags[selectedTeam.team] || 'none';
  const firstPhoto = selectedTeam.pit?.photos?.[0] || null;
  const photoCount = selectedTeam.pit?.photos?.length ?? 0;
  const tsMetric = selectedTeam.timestone;
  const hasOpr = tsMetric?.opr !== null && tsMetric?.opr !== undefined;

  const pitTabLabel = photoCount > 0 ? `Pit & Fotos (${photoCount})` : selectedTeam.pit ? 'Pit & Fotos ✓' : 'Pit & Fotos';
  const compareTabLabel = compareTeam ? `vs #${compareTeam.team}` : 'Comparar 1v1';

  const activeWeights = SCORING_PROFILES[scoringProfile].weights;
  const charBars: { label: string; val: number; weightPct: number; color: string }[] = cls
    ? [
      { label: 'Ofensiva (EPA/OPR)', val: cls.breakdown.offensive, weightPct: Math.round(activeWeights.offensive * 100), color: '#A855F7' },
      { label: 'Defensa (DPR/Garden)', val: cls.breakdown.defensive, weightPct: Math.round(activeWeights.defensive * 100), color: '#10B981' },
      { label: 'Autónomo', val: cls.breakdown.auto, weightPct: Math.round(activeWeights.auto * 100), color: '#38BDF8' },
      { label: 'Confiabilidad', val: cls.breakdown.reliability, weightPct: Math.round(activeWeights.reliability * 100), color: '#60A5FA' },
      { label: 'Disciplina', val: cls.breakdown.discipline, weightPct: Math.round(activeWeights.discipline * 100), color: '#FFD166' },
      { label: 'Piloto', val: cls.breakdown.driver, weightPct: Math.round(activeWeights.driver * 100), color: '#FB7185' },
    ]
    : [];

  return (
    <div className="profile-shell">
      {/* Rail izquierdo: Buscador instantáneo de equipos */}
      <aside className="profile-sidebar" aria-label="Explorador de equipos">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="panel-title" style={{ fontSize: '11.5px' }}>Equipos</span>
          <span className="tabular" style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
            {filteredSidebarTeams.length}/{teams.length}
          </span>
        </div>

        <input
          type="search"
          value={sidebarQuery}
          onChange={(e) => setSidebarQuery(e.target.value)}
          placeholder="Buscar # o nombre..."
          className="input-rag"
          style={{ width: '100%' }}
        />

        <div style={{ display: 'flex', gap: '4px' }}>
          {(
            [
              { id: 'all', label: 'Todos' },
              { id: 'starred', label: '★ Top/Pick' },
              { id: 'pit', label: 'Con Pit' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSidebarFilter(f.id)}
              className={`btn-ghost ${sidebarFilter === f.id ? 'active' : ''}`}
              style={{ flex: 1, padding: '4px 6px', fontSize: '10.5px', textAlign: 'center' }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="profile-team-list" role="listbox" aria-label="Lista de equipos">
          {filteredSidebarTeams.length === 0 ? (
            <div style={{ padding: '18px 8px', textAlign: 'center', fontSize: '11.5px', color: 'var(--text-muted)' }}>
              Sin coincidencias
            </div>
          ) : (
            filteredSidebarTeams.map((t) => {
              const isSelected = t.team === selectedTeam.team;
              const tName = t.pit?.teamName || t.timestone?.name || '';
              const tCls = classificationByTeam.get(t.team);
              const tTag = pickTags[t.team] || 'none';
              const tagMeta = PICK_TAG_META[tTag];
              const hasPhotos = (t.pit?.photos?.length ?? 0) > 0;

              return (
                <button
                  key={t.team}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onSelectTeam(t.team)}
                  className={`profile-team-item tabular ${isSelected ? 'active' : ''}`}
                >
                  <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: '7px' }}>
                    {tTag !== 'none' && (
                      <span
                        title={tagMeta.label}
                        style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '999px',
                          background: tagMeta.color,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontWeight: 900, fontSize: '12.5px', color: '#FFFFFF' }}>#{t.team}</span>
                        {tCls && (
                          <span
                            style={{
                              fontSize: '9.5px',
                              fontWeight: 900,
                              color: tCls.tierColor,
                              background: tCls.tierBg,
                              borderRadius: '3px',
                              padding: '0 4px',
                            }}
                          >
                            {tCls.tier}
                          </span>
                        )}
                        {hasPhotos && (
                          <span title="Tiene fotos de Pit" style={{ fontSize: '10px', opacity: 0.85 }}>
                            📷
                          </span>
                        )}
                      </div>
                      {tName && (
                        <div
                          style={{
                            fontSize: '10.5px',
                            color: 'var(--text-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {tName}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--bey-purple)' }}>
                      {t.epaNetAvg.toFixed(1)}
                    </div>
                    <div style={{ fontSize: '9.5px', color: 'var(--text-muted)' }}>#{t.rank}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Contenido Principal del Equipo */}
      <section className="profile-main">
        {/* Hero Card */}
        <div className="profile-hero">
          <div className="profile-hero-top">
            {/* Identidad + Miniatura */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, flex: '1 1 280px' }}>
              {firstPhoto ? (
                <button
                  type="button"
                  onClick={() => setSubTab('pit')}
                  title="Ver galería de Pit"
                  style={{
                    width: '76px',
                    height: '76px',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    border: '1px solid rgba(56, 189, 248, 0.45)',
                    background: '#090A0F',
                    padding: 0,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={`/api/pit/photo?id=${encodeURIComponent(firstPhoto.photoId)}`}
                    alt={`Robot #${selectedTeam.team}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </button>
              ) : (
                <div
                  className="tabular"
                  style={{
                    width: '76px',
                    height: '76px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-steel)',
                    background: 'var(--bg-carbon)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: '16px', fontWeight: 900, color: '#FFFFFF' }}>#{selectedTeam.team}</span>
                  <span style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontWeight: 700 }}>SIN FOTO</span>
                </div>
              )}

              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="tabular" style={{ fontSize: '24px', fontWeight: 900, color: '#FFFFFF', lineHeight: 1.05 }}>
                    #{selectedTeam.team}
                  </span>
                  <span
                    style={{
                      background: roleMeta.bg,
                      color: roleMeta.color,
                      border: `1px solid ${roleMeta.color}44`,
                      borderRadius: '4px',
                      padding: '3px 7px',
                      fontSize: '10px',
                      fontWeight: 800,
                    }}
                  >
                    {roleMeta.role}
                  </span>
                  {cls && (
                    <span
                      className="tabular"
                      style={{
                        background: cls.tierBg,
                        color: cls.tierColor,
                        border: `1px solid ${cls.tierColor}66`,
                        borderRadius: '4px',
                        padding: '3px 8px',
                        fontSize: '10.5px',
                        fontWeight: 900,
                      }}
                    >
                      Tier {cls.tier} · {cls.score.toFixed(1)}
                    </span>
                  )}
                </div>

                {teamName && (
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: 'var(--text-silver)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {teamName}
                  </div>
                )}

                <div className="tabular" style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontWeight: 700 }}>
                  Rank #{selectedTeam.rank} · {selectedTeam.matchesPlayed} PJ · Inicio Auto: {selectedTeam.topStartPos}
                </div>
              </div>
            </div>

            {/* Acciones rápidas + Picklist directo */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => stepTeam(-1)}
                  className="btn-ghost"
                  aria-label="Equipo anterior"
                  title="Equipo anterior"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => stepTeam(1)}
                  className="btn-ghost"
                  aria-label="Equipo siguiente"
                  title="Equipo siguiente"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => onFindPerfectMatch(selectedTeam.team)}
                  className="btn-ghost"
                  style={{ borderColor: 'rgba(168, 85, 247, 0.55)', color: '#E9D5FF' }}
                >
                  ✦ Match Perfecto
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('comparar')}
                  className={`btn-ghost ${subTab === 'comparar' ? 'active' : ''}`}
                >
                  ⇄ Comparar 1v1
                </button>
              </div>

              <div className="profile-tag-group tabular" role="group" aria-label="Etiqueta Picklist">
                {DIRECT_PICK_TAGS.map((tagKey) => {
                  const meta = PICK_TAG_META[tagKey];
                  const isActive = activeTag === tagKey;
                  return (
                    <button
                      key={tagKey}
                      type="button"
                      onClick={() => onSetPickTag(selectedTeam.team, isActive ? 'none' : tagKey)}
                      style={{
                        background: isActive ? meta.bg : 'transparent',
                        border: `1px solid ${isActive ? meta.border : 'transparent'}`,
                        color: isActive ? meta.color : 'var(--text-muted)',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '10.5px',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tira única de 5 KPIs clave (sin duplicados abajo) */}
          <div className="profile-kpi-strip tabular">
            <div style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '6px', padding: '10px 12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                EPA Neto
              </div>
              <div style={{ fontSize: '20px', fontWeight: 900, color: 'var(--bey-purple)', marginTop: '2px' }}>
                {selectedTeam.epaNetAvg.toFixed(1)} pts
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                Min {selectedTeam.minNet} – Max {selectedTeam.maxNet}
              </div>
            </div>

            <div style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '6px', padding: '10px 12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Auto / TeleOp
              </div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--accent-cyan)', marginTop: '3px' }}>
                {selectedTeam.autoAvg.toFixed(1)}{' '}
                <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>/</span>{' '}
                <span style={{ color: 'var(--accent-amber)' }}>{selectedTeam.teleAvg.toFixed(1)}</span>
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                Bal {(selectedTeam.balancinAutoAvg + selectedTeam.balancinTeleAvg).toFixed(1)} · Flor {selectedTeam.florAvg.toFixed(1)} · Gar {selectedTeam.gardenAvg.toFixed(1)}
              </div>
            </div>

            {hasOpr && tsMetric ? (
              <div style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '6px', padding: '10px 12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  OPR / DPR / CCWM
                </div>
                <div style={{ fontSize: '16px', fontWeight: 900, marginTop: '4px', display: 'flex', gap: '6px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ color: '#7DD3FC' }}>{tsMetric.opr!.toFixed(1)}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>/</span>
                  <span style={{ color: '#34D399' }}>{(tsMetric.dpr ?? 0).toFixed(1)}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>/</span>
                  <span style={{ color: (tsMetric.ccwm ?? 0) >= 0 ? 'var(--accent-amber)' : 'var(--rag-coral)' }}>
                    {(tsMetric.ccwm ?? 0) >= 0 ? '+' : ''}
                    {(tsMetric.ccwm ?? 0).toFixed(1)}
                  </span>
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                  Off {tsMetric.rankOff ? `#${tsMetric.rankOff}` : '—'} · Def {tsMetric.rankDef ? `#${tsMetric.rankDef}` : '—'}
                </div>
              </div>
            ) : (
              <div style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '6px', padding: '10px 12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Piezas Prom.
                </div>
                <div style={{ fontSize: '16px', fontWeight: 900, marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                  <span style={{ color: '#60A5FA' }}>{(selectedTeam.balancinAutoAvg + selectedTeam.balancinTeleAvg).toFixed(1)}B</span>
                  <span style={{ color: '#FB7185' }}>{selectedTeam.florAvg.toFixed(1)}F</span>
                  <span style={{ color: '#34D399' }}>{selectedTeam.gardenAvg.toFixed(1)}G</span>
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                  Control Flor {selectedTeam.flowerControlPct.toFixed(0)}%
                </div>
              </div>
            )}

            <div style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '6px', padding: '10px 12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Confiabilidad
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 900,
                  color: selectedTeam.reliabilityPct >= 90 ? 'var(--accent-emerald)' : selectedTeam.reliabilityPct < 70 ? 'var(--rag-coral)' : 'var(--text-white)',
                  marginTop: '2px',
                }}
              >
                {selectedTeam.reliabilityPct.toFixed(0)}%
              </div>
              <div style={{ fontSize: '10.5px', color: selectedTeam.foulsAvg > 15 ? 'var(--rag-coral)' : 'var(--text-muted)' }}>
                Faltas {selectedTeam.foulsAvg.toFixed(1)} pts
              </div>
            </div>

            <div style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '6px', padding: '10px 12px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Piloto &amp; Swarm
              </div>
              <div style={{ fontSize: '20px', fontWeight: 900, color: 'var(--accent-amber)', marginTop: '2px' }}>
                {selectedTeam.driverAvg.toFixed(1)} / 5
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                Swarm {selectedTeam.swarmPtsAvg.toFixed(1)} pts
              </div>
            </div>
          </div>

          {/* Sub-pestañas claras */}
          <div className="profile-subtabs" role="tablist" aria-label="Vistas del perfil de equipo">
            {(
              [
                { id: 'resumen', label: 'Resumen' },
                { id: 'pit', label: pitTabLabel },
                { id: 'partidos', label: `Partidos (${selectedTeam.history.length})` },
                { id: 'comparar', label: compareTabLabel },
              ] as const
            ).map((sec) => (
              <button
                key={sec.id}
                type="button"
                role="tab"
                aria-selected={subTab === sec.id}
                onClick={() => setSubTab(sec.id)}
                className={`nav-tab ${subTab === sec.id ? 'active' : ''}`}
              >
                {sec.label}
              </button>
            ))}
          </div>
        </div>

        {/* SUB-TAB 1: RESUMEN */}
        {subTab === 'resumen' && (
          <>
            <div className="match-hero-banner" data-capture="radar-tier" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="panel-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="panel-title">Perfilamiento Táctico &amp; Clasificación</span>
                  <span
                    style={{
                      background: roleMeta.bg,
                      color: roleMeta.color,
                      border: `1px solid ${roleMeta.color}55`,
                      borderRadius: '4px',
                      padding: '2px 7px',
                      fontSize: '10px',
                      fontWeight: 900,
                      letterSpacing: '0.4px',
                    }}
                  >
                    {roleMeta.role}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {(Object.keys(SCORING_PROFILES) as ScoringProfileId[]).map((pid) => (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => onChangeScoringProfile(pid)}
                      className={`btn-ghost ${scoringProfile === pid ? 'active' : ''}`}
                      style={{ padding: '4px 9px', fontSize: '10.5px' }}
                    >
                      {SCORING_PROFILES[pid].shortLabel}
                    </button>
                  ))}
                </div>
              </div>

              <div className="split-2col" style={{ alignItems: 'center', gap: '18px' }}>
                {/* Radar BIOBUZZ */}
                <div
                  style={{
                    background: 'rgba(11, 13, 21, 0.72)',
                    border: '1px solid var(--border-steel)',
                    borderRadius: '8px',
                    padding: '12px 10px 10px',
                  }}
                >
                  <TeamRadarChart team={selectedTeam} compareTeam={null} allTeams={teams} />
                </div>

                {/* Gauge Circular Tier + 6 Ejes + Espectro S/A/B/C */}
                {cls && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Score Ring + Espectro continuo */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                        background: 'rgba(11, 13, 21, 0.72)',
                        border: `1px solid ${cls.tierColor}44`,
                        borderRadius: '8px',
                        padding: '10px 14px',
                      }}
                    >
                      {(() => {
                        const r = 28;
                        const c = 2 * Math.PI * r;
                        const dash = (Math.min(100, Math.max(0, cls.score)) / 100) * c;
                        return (
                          <div style={{ position: 'relative', width: '68px', height: '68px', flexShrink: 0 }}>
                            <svg width="68" height="68" viewBox="0 0 68 68" style={{ transform: 'rotate(-90deg)' }}>
                              <circle cx="34" cy="34" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
                              <circle
                                cx="34"
                                cy="34"
                                r={r}
                                fill="none"
                                stroke={cls.tierColor}
                                strokeWidth="6"
                                strokeLinecap="round"
                                strokeDasharray={`${dash} ${c}`}
                                style={{ filter: `drop-shadow(0 0 6px ${cls.tierColor}88)` }}
                              />
                            </svg>
                            <div
                              className="tabular"
                              style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <span style={{ fontSize: '15px', fontWeight: 900, color: '#FFFFFF', lineHeight: 1 }}>
                                {cls.score.toFixed(0)}
                              </span>
                              <span style={{ fontSize: '9px', fontWeight: 900, color: cls.tierColor, marginTop: '2px' }}>
                                TIER {cls.tier}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-silver)', textTransform: 'uppercase' }}>
                            Escala de Clasificación
                          </span>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: cls.tierColor }}>
                            {cls.score.toFixed(1)} / 100
                          </span>
                        </div>

                        {/* Barra de espectro C -> B -> A -> S con marcador */}
                        <div style={{ position: 'relative', height: '10px', borderRadius: '999px', overflow: 'visible', display: 'flex', gap: '2px' }}>
                          <div style={{ width: '48%', height: '100%', background: 'rgba(148, 163, 184, 0.32)', borderRadius: '999px 0 0 999px' }} />
                          <div style={{ width: '17%', height: '100%', background: 'rgba(56, 189, 248, 0.45)' }} />
                          <div style={{ width: '15%', height: '100%', background: 'rgba(168, 85, 247, 0.55)' }} />
                          <div style={{ width: '20%', height: '100%', background: 'rgba(255, 209, 102, 0.72)', borderRadius: '0 999px 999px 0' }} />
                          <div
                            style={{
                              position: 'absolute',
                              left: `calc(${Math.min(98, Math.max(2, cls.score))}% - 6px)`,
                              top: '-2px',
                              width: '12px',
                              height: '14px',
                              borderRadius: '3px',
                              background: '#FFFFFF',
                              border: `2px solid ${cls.tierColor}`,
                              boxShadow: `0 0 8px ${cls.tierColor}`,
                            }}
                          />
                        </div>

                        <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', fontWeight: 800, color: 'var(--text-muted)' }}>
                          <span style={{ color: cls.tier === 'C' ? '#E2E8F0' : undefined }}>C &lt;48</span>
                          <span style={{ color: cls.tier === 'B' ? '#38BDF8' : undefined }}>B 48–64</span>
                          <span style={{ color: cls.tier === 'A' ? '#C084FC' : undefined }}>A 65–79</span>
                          <span style={{ color: cls.tier === 'S' ? '#FFD166' : undefined }}>S 80–100</span>
                        </div>
                      </div>
                    </div>

                    {/* 6 Ejes con peso activo */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
                      {charBars.map((bar) => (
                        <div
                          key={bar.label}
                          style={{
                            background: 'rgba(11, 13, 21, 0.72)',
                            border: '1px solid var(--border-steel)',
                            borderRadius: '6px',
                            padding: '8px 10px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '5px',
                          }}
                        >
                          <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10.5px', fontWeight: 800, gap: '4px' }}>
                            <span style={{ color: 'var(--text-silver)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {bar.label}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                              <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 700 }}>
                                {bar.weightPct}%
                              </span>
                              <span style={{ color: bar.color }}>{bar.val}</span>
                            </div>
                          </div>
                          <div style={{ height: '6px', width: '100%', background: '#07080D', borderRadius: '3px', overflow: 'hidden' }}>
                            <div
                              style={{
                                height: '100%',
                                width: `${bar.val}%`,
                                background: `linear-gradient(90deg, ${bar.color}99, ${bar.color})`,
                                boxShadow: `0 0 8px ${bar.color}55`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="split-2col">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Tendencia por Partido</span>
                    <span className="tabular" style={{ fontSize: '11px', color: 'var(--accent-amber)', fontWeight: 700 }}>
                      {selectedTeam.history.length} PJ
                    </span>
                  </div>
                  <TeamHistoricChart history={selectedTeam.history} />
                </div>

                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">Eficiencia &amp; RP</span>
                  </div>
                  <div className="tabular" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
                    {[
                      { l: 'Auto Leave', v: `${selectedTeam.autoLeavePct.toFixed(0)}%`, c: '#94A3B8' },
                      { l: 'Auto Park', v: `${selectedTeam.autoParkPct.toFixed(0)}%`, c: '#94A3B8' },
                      { l: 'Endgame Park', v: `${selectedTeam.endgameParkPct.toFixed(0)}%`, c: '#FFD166' },
                      { l: 'Control Flor', v: `${selectedTeam.flowerControlPct.toFixed(0)}% · ${selectedTeam.flowersOwnedAvg.toFixed(1)}`, c: '#FB7185' },
                      { l: 'Bottom Nectar', v: `${selectedTeam.bottomNectarPct.toFixed(0)}%`, c: '#F87171' },
                      { l: 'Descore Garden', v: `${selectedTeam.gardenDescorePct.toFixed(0)}%`, c: '#34D399' },
                    ].map((m) => (
                      <div
                        key={m.l}
                        style={{
                          background: 'var(--bg-carbon)',
                          border: '1px solid var(--border-steel)',
                          borderRadius: '4px',
                          padding: '9px 10px',
                        }}
                      >
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>{m.l}</div>
                        <div style={{ fontSize: '16px', fontWeight: 900, color: m.c, marginTop: '2px' }}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Zonas de Inicio (6×6)</span>
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
          </>
        )}

        {/* SUB-TAB 2: PIT & FOTOS + NOTAS */}
        {subTab === 'pit' && (
          <>
            <TeamPitCard team={selectedTeam} />

            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Notas de Scouters &amp; Alertas</span>
                <span className="tabular" style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                  {selectedTeam.notes.length} notas
                </span>
              </div>
              {selectedTeam.notes.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Sin observaciones ni fallas reportadas.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '340px', overflowY: 'auto' }}>
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
          </>
        )}

        {/* SUB-TAB 3: PARTIDOS + DISTRIBUCIONES */}
        {subTab === 'partidos' && (
          <>
            <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="panel-header" style={{ padding: '14px 16px', marginBottom: 0 }}>
                <span className="panel-title">Bitácora de Partidos (#{selectedTeam.team})</span>
                <span className="tabular" style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                  {selectedTeam.history.length} registros
                </span>
              </div>
              {selectedTeam.history.length === 0 ? (
                <div style={{ padding: '28px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Este equipo aún no tiene partidos capturados en Captura_BIOBUZZ.
                </div>
              ) : (
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
              )}
            </div>

            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Distribución de Piezas (Balancín vs Flor)</span>
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
          </>
        )}

        {/* SUB-TAB 4: COMPARAR 1v1 */}
        {subTab === 'comparar' && (
          <>
            <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span className="tabular" style={{ fontWeight: 900, color: '#E11D48' }}>#{selectedTeam.team}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 800 }}>vs</span>
                <select
                  value={compareTeam?.team ?? 0}
                  onChange={(e) => onSelectCompareTeam(Number(e.target.value))}
                  className="select-rag tabular"
                >
                  <option value={0}>Elegir rival...</option>
                  {teams
                    .filter((t) => t.team !== selectedTeam.team)
                    .map((t) => {
                      const rName = t.pit?.teamName || t.timestone?.name;
                      return (
                        <option key={t.team} value={t.team}>
                          #{t.team}{rName ? ` • ${rName}` : ''} (EPA {t.epaNetAvg.toFixed(1)})
                        </option>
                      );
                    })}
                </select>
              </div>

              {compareTeam && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => {
                      const prevSel = selectedTeam.team;
                      const prevCmp = compareTeam.team;
                      onSelectTeam(prevCmp);
                      onSelectCompareTeam(prevSel);
                    }}
                    className="btn-ghost"
                  >
                    Intercambiar ⇄
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectCompareTeam(0)}
                    className="btn-ghost"
                  >
                    Quitar ✕
                  </button>
                </div>
              )}
            </div>

            {!compareTeam ? (
              <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="panel-header" style={{ marginBottom: 0 }}>
                  <span className="panel-title">Comparación rápida</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '8px' }}>
                  {suggestedRivals.map((rival) => {
                    const rName = rival.pit?.teamName || rival.timestone?.name || '';
                    return (
                      <button
                        key={rival.team}
                        type="button"
                        onClick={() => onSelectCompareTeam(rival.team)}
                        className="tabular"
                        style={{
                          background: 'var(--bg-carbon)',
                          border: '1px solid var(--border-steel)',
                          borderRadius: '6px',
                          padding: '10px 12px',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 900, fontSize: '14px', color: '#FFFFFF' }}>#{rival.team}</span>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--bey-cyan)' }}>
                            {rival.epaNetAvg.toFixed(1)} EPA
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Rank #{rival.rank}{rName ? ` · ${rName}` : ''}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                <DuelComparisonBars
                  leftTitle={`#${selectedTeam.team}`}
                  rightTitle={`#${compareTeam.team}`}
                  metrics={[
                    {
                      label: `Score (${SCORING_PROFILES[scoringProfile].shortLabel})`,
                      leftVal: classificationByTeam.get(selectedTeam.team)?.score ?? 0,
                      rightVal: classificationByTeam.get(compareTeam.team)?.score ?? 0,
                    },
                    { label: 'EPA Neto', leftVal: selectedTeam.epaNetAvg, rightVal: compareTeam.epaNetAvg },
                    ...(selectedTeam.timestone?.opr != null && compareTeam.timestone?.opr != null
                      ? [
                        { label: 'OPR', leftVal: selectedTeam.timestone.opr, rightVal: compareTeam.timestone.opr },
                        {
                          label: 'DPR (menor=mejor)',
                          leftVal: selectedTeam.timestone.dpr ?? 0,
                          rightVal: compareTeam.timestone.dpr ?? 0,
                          lowerIsBetter: true,
                        },
                        {
                          label: 'CCWM (OPR−DPR)',
                          leftVal: selectedTeam.timestone.ccwm ?? 0,
                          rightVal: compareTeam.timestone.ccwm ?? 0,
                        },
                      ]
                      : []),
                    { label: 'Auto Prom', leftVal: selectedTeam.autoAvg, rightVal: compareTeam.autoAvg },
                    { label: 'TeleOp Prom', leftVal: selectedTeam.teleAvg, rightVal: compareTeam.teleAvg },
                    {
                      label: 'Balancín Total',
                      leftVal: selectedTeam.balancinAutoAvg + selectedTeam.balancinTeleAvg,
                      rightVal: compareTeam.balancinAutoAvg + compareTeam.balancinTeleAvg,
                    },
                    { label: 'Flor Total', leftVal: selectedTeam.florAvg, rightVal: compareTeam.florAvg },
                    { label: 'Garden Prom', leftVal: selectedTeam.gardenAvg, rightVal: compareTeam.gardenAvg },
                    { label: 'Confiabilidad', leftVal: selectedTeam.reliabilityPct, rightVal: compareTeam.reliabilityPct, unit: '%' },
                    { label: 'Faltas Prom', leftVal: selectedTeam.foulsAvg, rightVal: compareTeam.foulsAvg, lowerIsBetter: true },
                    { label: 'Piloto (1–5)', leftVal: selectedTeam.driverAvg, rightVal: compareTeam.driverAvg },
                  ]}
                />

                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-title">
                      Radar Comparativo: #{selectedTeam.team} vs #{compareTeam.team}
                    </span>
                  </div>
                  <TeamRadarChart team={selectedTeam} compareTeam={compareTeam} allTeams={teams} />
                </div>

                <PitComparePanel left={selectedTeam} right={compareTeam} />
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
