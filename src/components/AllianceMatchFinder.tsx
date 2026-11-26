'use client';

import React, { useEffect, useMemo, useState } from 'react';
import RagnarokFieldHeatmap, { type FieldMarker } from '@/components/RagnarokFieldHeatmap';
import {
  findBestPartners,
  MATCH_STRATEGY_MODES,
  type MatchStrategyMode,
} from '@/lib/allianceMatcher';
import { detectRobotRole, PICK_TAG_META, type PickTag } from '@/lib/roles';
import type { TeamAnalytics } from '@/lib/types';

function getTierColor(score: number): string {
  if (score >= 82) return 'var(--accent-emerald)';
  if (score >= 68) return 'var(--bey-cyan)';
  if (score >= 52) return 'var(--accent-amber)';
  return 'var(--text-muted)';
}

function CompatibilityRing({ score, tierLabel }: { score: number; tierLabel: string }) {
  const size = 116;
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference - (clamped / 100) * circumference;
  const color = getTierColor(score);

  return (
    <div
      style={{
        position: 'relative',
        width: `${size}px`,
        height: `${size}px`,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="rgba(9, 10, 15, 0.65)"
          stroke="var(--border-steel)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.35s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.2s ease',
          }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '8px',
        }}
      >
        <span className="tabular" style={{ fontSize: '21px', fontWeight: 900, color, lineHeight: 1 }}>
          {score.toFixed(1)}%
        </span>
        <span
          style={{
            fontSize: '9px',
            fontWeight: 800,
            color: 'var(--text-silver)',
            textTransform: 'uppercase',
            letterSpacing: '0.4px',
            marginTop: '3px',
          }}
        >
          {tierLabel}
        </span>
      </div>
    </div>
  );
}

export default function AllianceMatchFinder({
  captain,
  onChangeCaptain,
  allTeams,
  pickTags,
  rivalProjectedNet,
  selectedPick1,
  selectedSub,
  excludedRivalIds,
  onSelectPick1,
  onSelectSub,
  onSimulateAlliance,
  onOpenProfile,
}: {
  captain: TeamAnalytics | null;
  onChangeCaptain: (teamNum: number) => void;
  allTeams: TeamAnalytics[];
  pickTags: Record<number, PickTag>;
  rivalProjectedNet: number | null;
  selectedPick1: number;
  selectedSub: number;
  excludedRivalIds: number[];
  onSelectPick1: (teamNum: number) => void;
  onSelectSub: (teamNum: number) => void;
  onSimulateAlliance: (pick1TeamNum: number) => void;
  onOpenProfile: (teamNum: number) => void;
}) {
  const [mode, setMode] = useState<MatchStrategyMode>('balanced');
  const [excludeDrafted, setExcludeDrafted] = useState(true);
  const [excludeAvoid, setExcludeAvoid] = useState(true);
  const [excludeRivals, setExcludeRivals] = useState(true);
  const [onlyWithPit, setOnlyWithPit] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState<6 | 12 | 999>(6);
  const [spotlightTeamNum, setSpotlightTeamNum] = useState<number | null>(null);

  const recommendations = useMemo(() => {
    if (!captain) return [];
    const raw = findBestPartners({
      captain,
      allTeams,
      mode,
      pickTags,
      excludeDrafted,
      excludeAvoid,
      excludeTeamIds: excludeRivals ? excludedRivalIds : [],
      rivalProjectedNet,
    });
    return onlyWithPit ? raw.filter((r) => Boolean(r.team.pit)) : raw;
  }, [
    captain,
    allTeams,
    mode,
    pickTags,
    excludeDrafted,
    excludeAvoid,
    excludeRivals,
    excludedRivalIds,
    rivalProjectedNet,
    onlyWithPit,
  ]);

  useEffect(() => {
    if (!recommendations.length) {
      setSpotlightTeamNum(null);
      return;
    }
    if (!spotlightTeamNum || !recommendations.some((r) => r.team.team === spotlightTeamNum)) {
      setSpotlightTeamNum(recommendations[0].team.team);
    }
  }, [recommendations, spotlightTeamNum]);

  const captainIdx = captain ? allTeams.findIndex((t) => t.team === captain.team) : -1;
  const stepCaptain = (delta: number) => {
    if (!allTeams.length || captainIdx === -1) return;
    const nextIdx = (captainIdx + delta + allTeams.length) % allTeams.length;
    onChangeCaptain(allTeams[nextIdx].team);
  };

  if (!captain) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
        No hay equipos cargados todavía para calcular compatibilidad de alianzas.
      </div>
    );
  }

  const captainRole = detectRobotRole(captain);
  const captainName = captain.pit?.teamName || captain.timestone?.name;
  const captainPhoto = captain.pit?.photos?.[0];
  const topMatch = recommendations[0] || null;

  const spotlightIdx = spotlightTeamNum
    ? recommendations.findIndex((r) => r.team.team === spotlightTeamNum)
    : 0;
  const spotlight = (spotlightIdx >= 0 ? recommendations[spotlightIdx] : recommendations[0]) || null;
  const spotlightRank = spotlightIdx >= 0 ? spotlightIdx + 1 : 1;
  const spotlightPhoto = spotlight?.team.pit?.photos?.[0];

  const autoMarkers: FieldMarker[] = spotlight
    ? [
        {
          slot: 'CAP',
          team: captain.team,
          startPos: captain.topStartPos,
          alliance: 'red' as const,
        },
        {
          slot: 'P1',
          team: spotlight.team.team,
          startPos: spotlight.team.topStartPos,
          alliance: 'red' as const,
        },
      ].filter((m) => m.startPos && m.startPos !== '—')
    : [];

  const visibleList = recommendations.slice(0, visibleLimit);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* ================= SECCIÓN A: COMMAND DECK HERO BANNER ================= */}
      <section className="match-hero-banner" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span
                style={{
                  background: 'rgba(168, 85, 247, 0.2)',
                  border: '1px solid rgba(168, 85, 247, 0.55)',
                  color: '#E9D5FF',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '10px',
                  fontWeight: 900,
                  letterSpacing: '0.7px',
                }}
              >
                ✦ ENGINE DE COMPATIBILIDAD BIOBUZZ
              </span>
              {rivalProjectedNet !== null && (
                <span
                  className="tabular"
                  style={{
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    color: 'var(--bey-cyan)',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontSize: '10px',
                    fontWeight: 800,
                  }}
                >
                  Comparando vs Rival ({rivalProjectedNet.toFixed(1)} pts)
                </span>
              )}
            </div>

            <h1 style={{ fontSize: '22px', fontWeight: 900, letterSpacing: '0.4px', color: '#FFFFFF', margin: 0 }}>
              MATCH PERFECTO
            </h1>
          </div>

          {/* Selector de Capitán + Telemetría en vivo */}
          <div
            style={{
              background: 'rgba(14, 16, 24, 0.85)',
              border: '1px solid var(--border-steel-bright)',
              borderRadius: '6px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              minWidth: '300px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Capitán Base
              </span>
              <span
                style={{
                  background: captainRole.bg,
                  color: captainRole.color,
                  border: `1px solid ${captainRole.color}44`,
                  borderRadius: '3px',
                  padding: '1px 6px',
                  fontSize: '9.5px',
                  fontWeight: 800,
                }}
              >
                {captainRole.role}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {captainPhoto && (
                <img
                  src={`/api/pit/photo?id=${encodeURIComponent(captainPhoto.photoId)}`}
                  alt={`#${captain.team}`}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '4px',
                    objectFit: 'cover',
                    border: '1px solid var(--border-steel-bright)',
                    flexShrink: 0,
                  }}
                />
              )}
              <button type="button" onClick={() => stepCaptain(-1)} className="btn-ghost" aria-label="Capitán anterior">
                ‹
              </button>
              <select
                value={captain.team}
                onChange={(e) => onChangeCaptain(Number(e.target.value))}
                className="select-rag tabular"
                style={{ flex: 1, minWidth: 0 }}
              >
                {allTeams.map((t) => {
                  const name = t.pit?.teamName || t.timestone?.name;
                  return (
                    <option key={t.team} value={t.team}>
                      #{t.team}{name ? ` • ${name}` : ''} (Rank #{t.rank} · EPA {t.epaNetAvg.toFixed(1)})
                    </option>
                  );
                })}
              </select>
              <button type="button" onClick={() => stepCaptain(1)} className="btn-ghost" aria-label="Capitán siguiente">
                ›
              </button>
            </div>

            <div className="tabular" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 700 }}>
              {captainName && <span style={{ color: 'var(--text-white)' }}>{captainName}</span>}
              <span>EPA <strong style={{ color: 'var(--bey-purple)' }}>{captain.epaNetAvg.toFixed(1)}</strong></span>
              {captain.timestone?.opr != null && (
                <span>OPR <strong style={{ color: 'var(--bey-cyan)' }}>{captain.timestone.opr.toFixed(1)}</strong></span>
              )}
              {captain.timestone?.dpr != null && (
                <span>DPR <strong style={{ color: 'var(--accent-emerald)' }}>{captain.timestone.dpr.toFixed(1)}</strong></span>
              )}
              <span>Auto <strong style={{ color: 'var(--accent-amber)' }}>{captain.topStartPos}</strong></span>
              <span>Swarm <strong style={{ color: 'var(--text-silver)' }}>{captain.swarmPtsAvg.toFixed(1)}</strong></span>
              <span>Op <strong style={{ color: captain.reliabilityPct >= 90 ? 'var(--accent-emerald)' : 'var(--text-silver)' }}>{captain.reliabilityPct.toFixed(0)}%</strong></span>
            </div>
          </div>
        </div>

        {/* Estrategias + Filtros + CTA rápido */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
            paddingTop: '10px',
            borderTop: '1px solid rgba(52, 59, 89, 0.65)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div className="profile-subtabs" role="group" aria-label="Estrategia de compatibilidad">
              {(Object.keys(MATCH_STRATEGY_MODES) as MatchStrategyMode[]).map((k) => {
                const item = MATCH_STRATEGY_MODES[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setMode(k)}
                    className={`nav-tab ${mode === k ? 'active' : ''}`}
                    title={item.description}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={() => setExcludeDrafted((v) => !v)} className={`btn-ghost ${excludeDrafted ? 'active' : ''}`}>
              Ocultar Drafted
            </button>
            <button type="button" onClick={() => setExcludeAvoid((v) => !v)} className={`btn-ghost ${excludeAvoid ? 'active' : ''}`}>
              Ocultar Evitar
            </button>
            <button type="button" onClick={() => setExcludeRivals((v) => !v)} className={`btn-ghost ${excludeRivals ? 'active' : ''}`}>
              Excluir Rivales
            </button>
            <button type="button" onClick={() => setOnlyWithPit((v) => !v)} className={`btn-ghost ${onlyWithPit ? 'active' : ''}`}>
              Solo con Pit
            </button>
            {topMatch && (
              <button
                type="button"
                onClick={() => onSimulateAlliance(topMatch.team.team)}
                className="btn-rag tabular"
                title={`Asignar a #${topMatch.team.team} como Pick 1 y abrir Simulador de Alianzas`}
              >
                Simular #1 (#{topMatch.team.team}) →
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ================= SECCIÓN B: SPOTLIGHT SHOWCASE + CANCHA 6×6 ================= */}
      {!spotlight ? (
        <div className="panel" style={{ padding: '28px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
          No hay candidatos disponibles con los filtros actuales. Prueba desactivar &ldquo;Ocultar Drafted&rdquo;, &ldquo;Excluir Rivales&rdquo; o &ldquo;Solo con Pit&rdquo;.
        </div>
      ) : (
        <div className="match-spotlight-grid">
          {/* Izquierda: Spotlight Match Card */}
          <div
            className="panel"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              borderTop: `3px solid ${getTierColor(spotlight.compatibilityScore)}`,
              background: 'linear-gradient(180deg, rgba(26, 30, 46, 0.55) 0%, var(--bg-graphite) 42%)',
            }}
          >
            {/* Header del Spotlight */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    className="tabular"
                    style={{
                      background: spotlightRank === 1 ? 'rgba(16, 185, 129, 0.16)' : 'rgba(56, 189, 248, 0.14)',
                      border: `1px solid ${spotlightRank === 1 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(56, 189, 248, 0.4)'}`,
                      color: spotlightRank === 1 ? 'var(--accent-emerald)' : 'var(--bey-cyan)',
                      borderRadius: '4px',
                      padding: '2px 8px',
                      fontSize: '10px',
                      fontWeight: 900,
                    }}
                  >
                    {spotlightRank === 1 ? '✦ #1 MATCH IDEAL' : `INSPECCIONANDO #${spotlightRank} MATCH`}
                  </span>
                  {selectedPick1 === spotlight.team.team && (
                    <span
                      style={{
                        background: 'var(--bey-plum)',
                        border: '1px solid var(--bey-purple)',
                        color: '#E9D5FF',
                        borderRadius: '4px',
                        padding: '2px 7px',
                        fontSize: '10px',
                        fontWeight: 800,
                      }}
                    >
                      ✓ Pick 1 Actual
                    </span>
                  )}
                </div>

                <div className="tabular" style={{ fontSize: '20px', fontWeight: 900, color: '#FFFFFF', marginTop: '6px' }}>
                  #{captain.team} <span style={{ color: 'var(--bey-purple)' }}>×</span> #{spotlight.team.team}
                  {(spotlight.team.pit?.teamName || spotlight.team.timestone?.name) && (
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', marginLeft: '8px' }}>
                      {spotlight.team.pit?.teamName || spotlight.team.timestone?.name}
                    </span>
                  )}
                </div>
              </div>

              {/* Fotos de Pit frente a frente */}
              {(captainPhoto || spotlightPhoto) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {captainPhoto && (
                    <img
                      src={`/api/pit/photo?id=${encodeURIComponent(captainPhoto.photoId)}`}
                      alt={`#${captain.team}`}
                      title={`#${captain.team}`}
                      style={{
                        width: '54px',
                        height: '54px',
                        borderRadius: '6px',
                        objectFit: 'cover',
                        border: '1px solid var(--bey-purple)',
                      }}
                    />
                  )}
                  {spotlightPhoto && (
                    <img
                      src={`/api/pit/photo?id=${encodeURIComponent(spotlightPhoto.photoId)}`}
                      alt={`#${spotlight.team.team}`}
                      title={`#${spotlight.team.team}`}
                      style={{
                        width: '54px',
                        height: '54px',
                        borderRadius: '6px',
                        objectFit: 'cover',
                        border: '1px solid var(--bey-cyan)',
                      }}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Gauge circular + 4 KPIs de pareja */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <CompatibilityRing score={spotlight.compatibilityScore} tierLabel={spotlight.tierLabel} />

              <div className="tabular" style={{ flex: 1, minWidth: '220px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
                <div style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '6px', padding: '9px 11px' }}>
                  <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                    Alianza Proyectada
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 900, color: '#FFFFFF', marginTop: '2px' }}>
                    {spotlight.projectedAllianceNet.toFixed(1)} pts
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    Auto {spotlight.projectedAllianceAuto.toFixed(1)} · Tele {spotlight.projectedAllianceTele.toFixed(1)}
                  </div>
                </div>

                <div style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '6px', padding: '9px 11px' }}>
                  <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                    Swarm RP
                  </div>
                  <div
                    style={{
                      fontSize: '18px',
                      fontWeight: 900,
                      color: spotlight.projectedSwarmPts >= 16 ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                      marginTop: '2px',
                    }}
                  >
                    {spotlight.projectedSwarmPts.toFixed(1)} / 16
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {spotlight.projectedSwarmPts >= 16 ? '✓ RP' : '—'}
                  </div>
                </div>

                <div style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '6px', padding: '9px 11px' }}>
                  <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                    vs Alianza Rival
                  </div>
                  <div
                    style={{
                      fontSize: '18px',
                      fontWeight: 900,
                      color:
                        spotlight.marginVsRival === null
                          ? 'var(--text-muted)'
                          : spotlight.marginVsRival >= 0
                            ? 'var(--accent-emerald)'
                            : 'var(--rag-coral)',
                      marginTop: '2px',
                    }}
                  >
                    {spotlight.marginVsRival === null
                      ? 'Sin rival'
                      : `${spotlight.marginVsRival >= 0 ? '+' : ''}${spotlight.marginVsRival.toFixed(1)} pts`}
                  </div>
                  {rivalProjectedNet !== null && (
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      Rival: {rivalProjectedNet.toFixed(1)} pts
                    </div>
                  )}
                </div>

                <div style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '6px', padding: '9px 11px' }}>
                  <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                    {spotlight.team.timestone?.opr != null ? 'OPR / DPR / CCWM' : 'Confiab. & Faltas'}
                  </div>
                  {spotlight.team.timestone?.opr != null ? (
                    <>
                      <div style={{ fontSize: '15px', fontWeight: 900, color: 'var(--bey-cyan)', marginTop: '3px' }}>
                        {spotlight.team.timestone.opr.toFixed(1)} / {spotlight.team.timestone.dpr?.toFixed(1) ?? '—'}
                      </div>
                      <div style={{ fontSize: '10px', color: (spotlight.team.timestone.ccwm ?? 0) >= 0 ? 'var(--accent-emerald)' : 'var(--rag-coral)' }}>
                        CCWM {(spotlight.team.timestone.ccwm ?? 0) >= 0 ? '+' : ''}{(spotlight.team.timestone.ccwm ?? 0).toFixed(1)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--accent-emerald)', marginTop: '2px' }}>
                        {spotlight.team.reliabilityPct.toFixed(0)}%
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        Faltas prom: {spotlight.team.foulsAvg.toFixed(1)} pts
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 4 Barras de Desglose */}
            <div className="tabular" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
              {[
                { label: 'Ofensiva (EPA / OPR)', val: spotlight.breakdown.offense, color: 'var(--bey-purple)' },
                { label: 'Sinergia BIOBUZZ', val: spotlight.breakdown.synergy, color: 'var(--bey-cyan)' },
                { label: 'Compatibilidad Auto', val: spotlight.breakdown.autoCompat, color: 'var(--accent-amber)' },
                { label: 'Confiabilidad & Def. (DPR)', val: spotlight.breakdown.reliability, color: 'var(--accent-emerald)' },
              ].map((b) => (
                <div key={b.label} style={{ background: 'var(--bg-carbon)', border: '1px solid var(--border-steel)', borderRadius: '4px', padding: '8px 10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px' }}>
                    <span>{b.label}</span>
                    <span style={{ color: '#FFFFFF', fontWeight: 900 }}>{b.val}/100</span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--bg-obsidian)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${b.val}%`, height: '100%', background: b.color, transition: 'width 0.3s ease' }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Razones de compatibilidad */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {spotlight.reasons.map((r, rIdx) => {
                const colors =
                  r.tone === 'good'
                    ? { bg: 'rgba(16, 185, 129, 0.14)', border: 'rgba(16, 185, 129, 0.4)', text: 'var(--accent-emerald)' }
                    : r.tone === 'warn'
                      ? { bg: 'rgba(255, 209, 102, 0.14)', border: 'rgba(255, 209, 102, 0.4)', text: 'var(--accent-amber)' }
                      : { bg: 'rgba(56, 189, 248, 0.14)', border: 'rgba(56, 189, 248, 0.4)', text: 'var(--bey-cyan)' };

                return (
                  <span
                    key={rIdx}
                    style={{
                      background: colors.bg,
                      border: `1px solid ${colors.border}`,
                      color: colors.text,
                      borderRadius: '4px',
                      padding: '4px 8px',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    {r.text}
                  </span>
                );
              })}
            </div>

            {/* Barra de acciones */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '4px' }}>
              <button
                type="button"
                onClick={() => onSimulateAlliance(spotlight.team.team)}
                className="btn-rag"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Simular en Playoffs →
              </button>
              <button
                type="button"
                onClick={() => onSelectPick1(spotlight.team.team)}
                className={`btn-ghost ${selectedPick1 === spotlight.team.team ? 'active' : ''}`}
              >
                {selectedPick1 === spotlight.team.team ? '✓ Pick 1 activo' : 'Elegir Pick 1'}
              </button>
              <button
                type="button"
                onClick={() => onSelectSub(spotlight.team.team)}
                className={`btn-ghost ${selectedSub === spotlight.team.team ? 'active' : ''}`}
              >
                {selectedSub === spotlight.team.team ? '✓ Suplente' : 'Suplente'}
              </button>
              <button
                type="button"
                onClick={() => onOpenProfile(spotlight.team.team)}
                className="btn-ghost"
              >
                Ver Perfil Completo ↗
              </button>
            </div>
          </div>

          {/* Derecha: Vista Previa Auto 6×6 */}
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="panel-header" style={{ marginBottom: 0 }}>
              <span className="panel-title">Vista Previa Auto (6×6 BIOBUZZ)</span>
              <span
                style={{
                  background: spotlight.hasAutoCollision ? 'rgba(255, 209, 102, 0.14)' : 'rgba(16, 185, 129, 0.14)',
                  border: `1px solid ${spotlight.hasAutoCollision ? 'rgba(255, 209, 102, 0.45)' : 'rgba(16, 185, 129, 0.45)'}`,
                  color: spotlight.hasAutoCollision ? 'var(--accent-amber)' : 'var(--accent-emerald)',
                  borderRadius: '4px',
                  padding: '2px 7px',
                  fontSize: '10px',
                  fontWeight: 800,
                }}
              >
                {spotlight.hasAutoCollision ? `⚠ Empalme en Zona ${spotlight.team.topStartPos}` : '✓ Rutas Limpias'}
              </span>
            </div>

            <RagnarokFieldHeatmap markers={autoMarkers} />

            <div
              className="tabular"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                fontSize: '11px',
                background: 'var(--bg-carbon)',
                border: '1px solid var(--border-steel)',
                borderRadius: '4px',
                padding: '8px 10px',
              }}
            >
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '9.5px', fontWeight: 700 }}>CAP #{captain.team}</div>
                <div style={{ color: '#FFFFFF', fontWeight: 800 }}>
                  Zona {captain.topStartPos}
                  {captain.pit?.autoSide ? ` (${captain.pit.autoSide})` : ''}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '9.5px', fontWeight: 700 }}>P1 #{spotlight.team.team}</div>
                <div style={{ color: '#FFFFFF', fontWeight: 800 }}>
                  Zona {spotlight.team.topStartPos}
                  {spotlight.team.pit?.autoSide ? ` (${spotlight.team.pit.autoSide})` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= SECCIÓN C: RANKING DE CONTENDIENTES ================= */}
      {recommendations.length > 0 && (
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="panel-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '8px' }}>
            <span className="panel-title">Candidatos Compatibles ({recommendations.length})</span>

            {recommendations.length > 6 && (
              <div style={{ display: 'flex', gap: '6px' }}>
                {(
                  [
                    { n: 6 as const, label: 'Top 6' },
                    { n: 12 as const, label: 'Top 12' },
                    { n: 999 as const, label: `Todos (${recommendations.length})` },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.n}
                    type="button"
                    onClick={() => setVisibleLimit(opt.n)}
                    className={`btn-ghost tabular ${visibleLimit === opt.n ? 'active' : ''}`}
                    style={{ fontSize: '11px', padding: '5px 10px' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="match-finder-grid">
            {visibleList.map((rec, idx) => {
              const roleMeta = detectRobotRole(rec.team);
              const tag = pickTags[rec.team.team] || 'none';
              const tagMeta = PICK_TAG_META[tag];
              const isPick1 = selectedPick1 === rec.team.team;
              const isSub = selectedSub === rec.team.team;
              const isSpotlight = spotlight?.team.team === rec.team.team;
              const teamName = rec.team.pit?.teamName || rec.team.timestone?.name;
              const thumb = rec.team.pit?.photos?.[0];
              const scoreColor = getTierColor(rec.compatibilityScore);

              return (
                <div
                  key={rec.team.team}
                  onClick={() => setSpotlightTeamNum(rec.team.team)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSpotlightTeamNum(rec.team.team);
                    }
                  }}
                  className={`match-contender-card ${isSpotlight ? 'spotlight-active' : ''}`}
                >
                  {/* Top Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', minWidth: 0 }}>
                      {thumb && (
                        <img
                          src={`/api/pit/photo?id=${encodeURIComponent(thumb.photoId)}`}
                          alt={`#${rec.team.team}`}
                          loading="lazy"
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '4px',
                            objectFit: 'cover',
                            border: '1px solid var(--border-steel-bright)',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span className="tabular" style={{ fontSize: '11px', fontWeight: 900, color: idx === 0 ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                            #{idx + 1}
                          </span>
                          <span className="tabular" style={{ fontSize: '15px', fontWeight: 900, color: '#FFFFFF' }}>
                            #{rec.team.team}
                          </span>
                          {teamName && (
                            <span
                              style={{
                                fontSize: '11px',
                                color: 'var(--text-muted)',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: '140px',
                              }}
                            >
                              {teamName}
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px', flexWrap: 'wrap' }}>
                          <span
                            style={{
                              background: roleMeta.bg,
                              color: roleMeta.color,
                              border: `1px solid ${roleMeta.color}44`,
                              borderRadius: '3px',
                              padding: '1px 6px',
                              fontSize: '9.5px',
                              fontWeight: 800,
                            }}
                          >
                            {roleMeta.role}
                          </span>
                          {tag !== 'none' && (
                            <span
                              style={{
                                background: tagMeta.bg,
                                color: tagMeta.color,
                                border: `1px solid ${tagMeta.border}`,
                                borderRadius: '3px',
                                padding: '1px 6px',
                                fontSize: '9.5px',
                                fontWeight: 800,
                              }}
                            >
                              {tagMeta.label}
                            </span>
                          )}
                          {rec.team.timestone?.opr != null && (
                            <span className="tabular" style={{ fontSize: '10px', color: 'var(--bey-cyan)', fontWeight: 700 }}>
                              OPR {rec.team.timestone.opr.toFixed(1)} · DPR {rec.team.timestone.dpr?.toFixed(1) ?? '—'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="tabular" style={{ fontSize: '18px', fontWeight: 900, color: scoreColor, lineHeight: 1 }}>
                        {rec.compatibilityScore.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: '9.5px', fontWeight: 800, color: scoreColor, marginTop: '2px' }}>
                        {rec.tierLabel}
                      </div>
                    </div>
                  </div>

                  {/* 4 Sub-score bars */}
                  <div className="tabular" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' }}>
                    {[
                      { label: 'Ofensiva', val: rec.breakdown.offense, color: 'var(--bey-purple)' },
                      { label: 'Sinergia', val: rec.breakdown.synergy, color: 'var(--bey-cyan)' },
                      { label: 'Auto', val: rec.breakdown.autoCompat, color: 'var(--accent-amber)' },
                      { label: 'Confiab.', val: rec.breakdown.reliability, color: 'var(--accent-emerald)' },
                    ].map((b) => (
                      <div key={b.label} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: 'var(--text-muted)', fontWeight: 700 }}>
                          <span>{b.label}</span>
                          <span style={{ color: 'var(--text-silver)' }}>{b.val}</span>
                        </div>
                        <div style={{ height: '4px', background: 'var(--bg-graphite)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{ width: `${b.val}%`, height: '100%', background: b.color }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Projected alliance bar */}
                  <div
                    className="tabular"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '6px',
                      background: 'var(--bg-graphite)',
                      border: '1px solid var(--border-steel)',
                      borderRadius: '4px',
                      padding: '6px 8px',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    <span style={{ color: 'var(--text-silver)' }}>
                      Alianza: <strong style={{ color: '#FFFFFF' }}>{rec.projectedAllianceNet.toFixed(1)} pts</strong>
                    </span>
                    <span style={{ color: rec.projectedSwarmPts >= 16 ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                      Swarm {rec.projectedSwarmPts.toFixed(1)}/16
                    </span>
                    {rec.marginVsRival !== null && (
                      <span style={{ color: rec.marginVsRival >= 0 ? 'var(--accent-emerald)' : 'var(--rag-coral)', fontWeight: 800 }}>
                        vs Rival: {rec.marginVsRival >= 0 ? '+' : ''}
                        {rec.marginVsRival.toFixed(1)}
                      </span>
                    )}
                  </div>

                  {/* Reasons */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {rec.reasons.map((r, rIdx) => {
                      const colors =
                        r.tone === 'good'
                          ? { bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)', text: 'var(--accent-emerald)' }
                          : r.tone === 'warn'
                            ? { bg: 'rgba(255, 209, 102, 0.12)', border: 'rgba(255, 209, 102, 0.35)', text: 'var(--accent-amber)' }
                            : { bg: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.35)', text: 'var(--bey-cyan)' };

                      return (
                        <span
                          key={rIdx}
                          style={{
                            background: colors.bg,
                            border: `1px solid ${colors.border}`,
                            color: colors.text,
                            borderRadius: '3px',
                            padding: '2px 6px',
                            fontSize: '10px',
                            fontWeight: 700,
                          }}
                        >
                          {r.text}
                        </span>
                      );
                    })}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '6px', marginTop: 'auto', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectPick1(rec.team.team);
                      }}
                      className={`btn-ghost ${isPick1 ? 'active' : ''}`}
                      style={{ flex: 1, justifyContent: 'center', fontSize: '11px', padding: '6px 8px' }}
                    >
                      {isPick1 ? '✓ Pick 1 activo' : 'Elegir Pick 1'}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSub(rec.team.team);
                      }}
                      className={`btn-ghost ${isSub ? 'active' : ''}`}
                      style={{ justifyContent: 'center', fontSize: '11px', padding: '6px 10px' }}
                    >
                      {isSub ? '✓ Suplente' : 'Suplente'}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenProfile(rec.team.team);
                      }}
                      className="btn-ghost"
                      style={{ justifyContent: 'center', fontSize: '11px', padding: '6px 10px' }}
                    >
                      Perfil ↗
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
