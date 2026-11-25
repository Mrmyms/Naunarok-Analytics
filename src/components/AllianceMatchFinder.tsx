'use client';

import React, { useMemo, useState } from 'react';
import {
  findBestPartners,
  MATCH_STRATEGY_MODES,
  type MatchStrategyMode,
} from '@/lib/allianceMatcher';
import { detectRobotRole, PICK_TAG_META, type PickTag } from '@/lib/roles';
import type { TeamAnalytics } from '@/lib/types';

export default function AllianceMatchFinder({
  captain,
  allTeams,
  pickTags,
  rivalProjectedNet,
  selectedPick1,
  selectedSub,
  excludedRivalIds,
  onSelectPick1,
  onSelectSub,
  onOpenProfile,
}: {
  captain: TeamAnalytics | null;
  allTeams: TeamAnalytics[];
  pickTags: Record<number, PickTag>;
  rivalProjectedNet: number | null;
  selectedPick1: number;
  selectedSub: number;
  excludedRivalIds: number[];
  onSelectPick1: (teamNum: number) => void;
  onSelectSub: (teamNum: number) => void;
  onOpenProfile: (teamNum: number) => void;
}) {
  const [mode, setMode] = useState<MatchStrategyMode>('balanced');
  const [excludeDrafted, setExcludeDrafted] = useState(true);
  const [excludeAvoid, setExcludeAvoid] = useState(true);
  const [excludeRivals, setExcludeRivals] = useState(true);
  const [visibleLimit, setVisibleLimit] = useState<4 | 8 | 999>(4);

  const recommendations = useMemo(() => {
    if (!captain) return [];
    return findBestPartners({
      captain,
      allTeams,
      mode,
      pickTags,
      excludeDrafted,
      excludeAvoid,
      excludeTeamIds: excludeRivals ? excludedRivalIds : [],
      rivalProjectedNet,
    });
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
  ]);

  if (!captain) {
    return (
      <div className="panel" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
        Selecciona un <strong>Capitán</strong> en &ldquo;Tu Alianza&rdquo; para buscar su match perfecto.
      </div>
    );
  }

  const topMatch = recommendations[0] || null;
  const visibleList = recommendations.slice(0, visibleLimit);
  const captainRole = detectRobotRole(captain);

  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        borderTop: '3px solid var(--bey-purple)',
      }}
    >
      {/* Header */}
      <div
        className="panel-header"
        style={{ marginBottom: 0, flexWrap: 'wrap', gap: '10px' }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span className="panel-title" style={{ color: 'var(--text-white)' }}>
              Buscador de Match Perfecto
            </span>
            <span
              className="tabular"
              style={{
                background: 'var(--bey-plum)',
                border: '1px solid rgba(168, 85, 247, 0.5)',
                color: 'var(--bey-purple)',
                borderRadius: '4px',
                padding: '2px 7px',
                fontSize: '10.5px',
                fontWeight: 800,
              }}
            >
              Para Capitán #{captain.team} ({captainRole.role} • Auto {captain.topStartPos})
            </span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
            {MATCH_STRATEGY_MODES[mode].description}
          </div>
        </div>

        {topMatch && (
          <button
            type="button"
            onClick={() => onSelectPick1(topMatch.team.team)}
            className="btn-rag tabular"
            title={`Asignar a #${topMatch.team.team} como Pick 1`}
          >
            <span>Aplicar Match #1 (#{topMatch.team.team} · {topMatch.compatibilityScore.toFixed(0)}%)</span>
          </button>
        )}
      </div>

      {/* Strategy pills + Filter toggles */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div className="profile-subtabs" role="group" aria-label="Estrategia de compatibilidad">
          {(Object.keys(MATCH_STRATEGY_MODES) as MatchStrategyMode[]).map((k) => {
            const item = MATCH_STRATEGY_MODES[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={`nav-tab ${mode === k ? 'active' : ''}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setExcludeDrafted((v) => !v)}
            className={`btn-ghost ${excludeDrafted ? 'active' : ''}`}
          >
            Ocultar Drafted
          </button>
          <button
            type="button"
            onClick={() => setExcludeAvoid((v) => !v)}
            className={`btn-ghost ${excludeAvoid ? 'active' : ''}`}
          >
            Ocultar Evitar
          </button>
          <button
            type="button"
            onClick={() => setExcludeRivals((v) => !v)}
            className={`btn-ghost ${excludeRivals ? 'active' : ''}`}
          >
            Excluir Rivales
          </button>
        </div>
      </div>

      {/* Recommendation cards */}
      {visibleList.length === 0 ? (
        <div
          style={{
            background: 'var(--bg-carbon)',
            border: '1px solid var(--border-steel)',
            borderRadius: '6px',
            padding: '20px',
            textAlign: 'center',
            fontSize: '12px',
            color: 'var(--text-muted)',
          }}
        >
          No hay candidatos disponibles con los filtros actuales. Prueba desactivar &ldquo;Ocultar Drafted&rdquo; o &ldquo;Excluir Rivales&rdquo;.
        </div>
      ) : (
        <div className="match-finder-grid">
          {visibleList.map((rec, idx) => {
            const roleMeta = detectRobotRole(rec.team);
            const tag = pickTags[rec.team.team] || 'none';
            const tagMeta = PICK_TAG_META[tag];
            const isPick1 = selectedPick1 === rec.team.team;
            const isSub = selectedSub === rec.team.team;
            const teamName = rec.team.pit?.teamName || rec.team.timestone?.name;

            const scoreColor =
              rec.compatibilityScore >= 82
                ? 'var(--accent-emerald)'
                : rec.compatibilityScore >= 68
                  ? 'var(--bey-cyan)'
                  : rec.compatibilityScore >= 52
                    ? 'var(--accent-amber)'
                    : 'var(--text-muted)';

            return (
              <div
                key={rec.team.team}
                style={{
                  background: 'var(--bg-carbon)',
                  border: isPick1
                    ? '1px solid var(--bey-purple)'
                    : idx === 0
                      ? '1px solid rgba(16, 185, 129, 0.45)'
                      : '1px solid var(--border-steel)',
                  borderRadius: '6px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                {/* Top Row: Rank, Team, Compatibility Score */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span
                        className="tabular"
                        style={{
                          fontSize: '11px',
                          fontWeight: 900,
                          color: idx === 0 ? 'var(--accent-amber)' : 'var(--text-muted)',
                        }}
                      >
                        #{idx + 1} Match
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
                            maxWidth: '130px',
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

                {/* Projected alliance metrics */}
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

                {/* Reasons pills */}
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

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '6px', marginTop: 'auto', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => onSelectPick1(rec.team.team)}
                    className={`btn-ghost ${isPick1 ? 'active' : ''}`}
                    style={{ flex: 1, justifyContent: 'center', fontSize: '11px', padding: '6px 8px' }}
                  >
                    {isPick1 ? '✓ Pick 1 activo' : 'Elegir Pick 1'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSub(rec.team.team)}
                    className={`btn-ghost ${isSub ? 'active' : ''}`}
                    style={{ justifyContent: 'center', fontSize: '11px', padding: '6px 10px' }}
                  >
                    {isSub ? '✓ Suplente' : 'Suplente'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenProfile(rec.team.team)}
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
      )}

      {/* Show more footer */}
      {recommendations.length > 4 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
          {(
            [
              { n: 4 as const, label: 'Top 4' },
              { n: 8 as const, label: 'Top 8' },
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
  );
}
