'use client';

import React, { useState } from 'react';
import type { TeamAnalytics } from '@/lib/types';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function PitComparePanel({
  left,
  right,
}: {
  left: TeamAnalytics;
  right: TeamAnalytics;
}) {
  const lp = left.pit;
  const rp = right.pit;

  if (!lp && !rp) return null;

  const rows: { label: string; l: string; r: string }[] = [
    { label: 'Chasis', l: lp?.chassisType || '—', r: rp?.chassisType || '—' },
    {
      label: 'Peso',
      l: lp?.weightLb !== null && lp?.weightLb !== undefined ? `${lp.weightLb} lb` : '—',
      r: rp?.weightLb !== null && rp?.weightLb !== undefined ? `${rp.weightLb} lb` : '—',
    },
    { label: 'Intake', l: lp?.intakeType || '—', r: rp?.intakeType || '—' },
    { label: 'Capacidad', l: lp?.capacity || '—', r: rp?.capacity || '—' },
    { label: 'Mecanismo Hive', l: lp?.hiveMech || '—', r: rp?.hiveMech || '—' },
    { label: 'Mecanismo Flor', l: lp?.flowerMech || '—', r: rp?.flowerMech || '—' },
    { label: 'Lado Auto', l: lp?.autoSide || '—', r: rp?.autoSide || '—' },
    {
      label: 'Auto Est.',
      l: lp ? `${lp.claimedAutoPoints} pts` : '—',
      r: rp ? `${rp.claimedAutoPoints} pts` : '—',
    },
    { label: 'Horas Drivers', l: lp?.driverHours || '—', r: rp?.driverHours || '—' },
    { label: 'Rol Declarado', l: lp?.preferredRole || '—', r: rp?.preferredRole || '—' },
    {
      label: 'Fotos',
      l: lp ? `${lp.photos.length}` : '0',
      r: rp ? `${rp.photos.length}` : '0',
    },
  ];

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="panel-header" style={{ padding: '14px 16px', marginBottom: 0 }}>
        <span className="panel-title">Comparativa Técnica de Pits</span>
        <span className="tabular" style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)' }}>
          #{left.team} vs #{right.team}
        </span>
      </div>
      <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
        <table className="rag-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left', paddingLeft: '14px' }}>Especificación</th>
              <th style={{ color: '#E11D48' }}>#{left.team}</th>
              <th style={{ color: '#38BDF8' }}>#{right.team}</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((row) => (
              <tr key={row.label} style={{ cursor: 'default' }}>
                <td style={{ textAlign: 'left', paddingLeft: '14px', color: 'var(--text-muted)', fontWeight: 700 }}>
                  {row.label}
                </td>
                <td style={{ color: row.l === '—' ? 'var(--text-muted)' : 'var(--text-white)' }}>{row.l}</td>
                <td style={{ color: row.r === '—' ? 'var(--text-muted)' : 'var(--text-white)' }}>{row.r}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TeamPitCard({ team }: { team: TeamAnalytics }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const pit = team.pit;

  if (!pit) {
    return (
      <div
        className="panel"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          borderStyle: 'dashed',
        }}
      >
        <div>
          <div className="panel-title" style={{ color: 'var(--text-silver)' }}>
            Ficha Técnica de Pits • #{team.team}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Sin ficha de Pit Scouting registrada.
          </div>
        </div>
      </div>
    );
  }

  const photos = pit.photos || [];
  const activePhoto = lightboxIdx !== null ? photos[lightboxIdx] || null : null;
  const overWeight = pit.weightLb !== null && pit.weightLb > 42;

  return (
    <>
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Header */}
        <div
          className="panel-header"
          style={{ marginBottom: 0, flexWrap: 'wrap', gap: '8px' }}
        >
          <div>
            <span className="panel-title">
              Ficha Técnica de Pits • #{team.team}
              {pit.teamName ? ` — ${pit.teamName}` : ''}
            </span>
            <div className="tabular" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
              Scout: <strong style={{ color: 'var(--text-silver)' }}>{pit.scouter || '—'}</strong>
              {pit.timestamp ? ` • ${pit.timestamp}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {pit.preferredRole && (
              <span
                style={{
                  background: 'rgba(168, 85, 247, 0.16)',
                  border: '1px solid rgba(168, 85, 247, 0.45)',
                  color: 'var(--bey-purple)',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontWeight: 800,
                }}
              >
                {pit.preferredRole}
              </span>
            )}
            <span
              className="tabular"
              style={{
                background: photos.length > 0 ? 'rgba(56, 189, 248, 0.14)' : 'var(--bg-carbon)',
                border: `1px solid ${photos.length > 0 ? 'rgba(56, 189, 248, 0.45)' : 'var(--border-steel)'}`,
                color: photos.length > 0 ? 'var(--bey-cyan)' : 'var(--text-muted)',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 800,
              }}
            >
              {photos.length} foto{photos.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {/* Galería de Fotos */}
        {photos.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              style={{
                fontSize: '10.5px',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
                color: 'var(--bey-cyan)',
              }}
            >
              Galería del Robot (clic para ampliar)
            </div>
            <div className="pit-photo-grid">
              {photos.map((photo, idx) => {
                const src = `/api/pit/photo?id=${encodeURIComponent(photo.photoId)}${
                  photo.eventCode ? `&event=${encodeURIComponent(photo.eventCode)}` : ''
                }`;
                return (
                  <button
                    key={photo.photoId}
                    type="button"
                    onClick={() => setLightboxIdx(idx)}
                    style={{
                      background: 'var(--bg-carbon)',
                      border: '1px solid var(--border-steel)',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      padding: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <div style={{ position: 'relative', width: '100%', height: '132px', background: '#090A0F' }}>
                      <img
                        src={src}
                        alt={`#${team.team} ${photo.caption || `Foto ${idx + 1}`}`}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                      {photo.sizeBytes > 0 && (
                        <span
                          className="tabular"
                          style={{
                            position: 'absolute',
                            bottom: '6px',
                            right: '6px',
                            background: 'rgba(9, 10, 15, 0.85)',
                            border: '1px solid var(--border-steel)',
                            borderRadius: '3px',
                            padding: '2px 5px',
                            fontSize: '9.5px',
                            fontWeight: 700,
                            color: 'var(--accent-amber)',
                          }}
                        >
                          {formatBytes(photo.sizeBytes)}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        padding: '7px 9px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '6px',
                        width: '100%',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 800,
                          color: 'var(--text-white)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {photo.caption || `Foto ${idx + 1}`}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--bey-cyan)', fontWeight: 800 }}>↗</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 3 Grupos Estructurados de Especificaciones */}
        <div className="pit-spec-grid">
          {/* Grupo 1: Hardware & Mecánica */}
          <div
            style={{
              background: 'var(--bg-carbon)',
              border: '1px solid var(--border-steel)',
              borderRadius: '6px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--accent-amber)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Hardware &amp; Mecánica
            </div>
            <div className="tabular" style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Chasis</span>
                <strong style={{ color: 'var(--text-white)' }}>{pit.chassisType || '—'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Peso</span>
                <strong style={{ color: overWeight ? 'var(--rag-coral)' : 'var(--text-white)' }}>
                  {pit.weightLb !== null ? `${pit.weightLb} lb` : '—'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Intake</span>
                <strong style={{ color: 'var(--text-white)', textAlign: 'right' }}>{pit.intakeType || '—'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Capacidad</span>
                <strong style={{ color: 'var(--text-white)', textAlign: 'right' }}>{pit.capacity || '—'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Hive</span>
                <strong style={{ color: '#60A5FA', textAlign: 'right' }}>{pit.hiveMech || '—'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Flor</span>
                <strong style={{ color: '#FB7185', textAlign: 'right' }}>{pit.flowerMech || '—'}</strong>
              </div>
            </div>
          </div>

          {/* Grupo 2: Autónomo & Software */}
          <div
            style={{
              background: 'var(--bg-carbon)',
              border: '1px solid var(--border-steel)',
              borderRadius: '6px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--bey-cyan)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Autónomo &amp; Software
            </div>
            <div className="tabular" style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Lado preferido</span>
                <strong style={{ color: 'var(--text-white)' }}>{pit.autoSide || '—'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Auto Est. vs Real</span>
                <strong style={{ color: 'var(--bey-cyan)' }}>
                  {pit.claimedAutoPoints} pts
                  {team.matchesPlayed > 0 ? ` / ${team.autoAvg.toFixed(1)} real` : ''}
                </strong>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '4px' }}>
                Rutinas de Autónomo
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {pit.autoRoutines.length === 0 ? (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>—</span>
                ) : (
                  pit.autoRoutines.map((r) => (
                    <span
                      key={r}
                      style={{
                        background: 'rgba(56, 189, 248, 0.12)',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        color: '#7DD3FC',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        fontSize: '10px',
                        fontWeight: 700,
                      }}
                    >
                      {r}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '4px' }}>
                Sensores y Visión
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {pit.sensorsVision.length === 0 ? (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>—</span>
                ) : (
                  pit.sensorsVision.map((s) => (
                    <span
                      key={s}
                      style={{
                        background: 'rgba(168, 85, 247, 0.14)',
                        border: '1px solid rgba(168, 85, 247, 0.35)',
                        color: '#D8B4FE',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        fontSize: '10px',
                        fontWeight: 700,
                      }}
                    >
                      {s}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Grupo 3: Equipo & Observaciones */}
          <div
            style={{
              background: 'var(--bg-carbon)',
              border: '1px solid var(--border-steel)',
              borderRadius: '6px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--bey-purple)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Equipo &amp; Observaciones
            </div>
            <div className="tabular" style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Rol en cancha</span>
                <strong style={{ color: 'var(--text-white)', textAlign: 'right' }}>{pit.preferredRole || '—'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Práctica drivers</span>
                <strong style={{ color: 'var(--accent-emerald)' }}>{pit.driverHours || '—'}</strong>
              </div>
            </div>
            <div style={{ marginTop: '2px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '4px' }}>
                Notas de Pits
              </div>
              <div
                style={{
                  fontSize: '12px',
                  lineHeight: 1.45,
                  color: pit.notes ? 'var(--text-silver)' : 'var(--text-muted)',
                  background: 'rgba(19, 22, 34, 0.7)',
                  border: '1px solid var(--border-steel)',
                  borderRadius: '4px',
                  padding: '8px',
                  minHeight: '58px',
                }}
              >
                {pit.notes || 'Sin observaciones adicionales.'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox interactivo para fotos */}
      {activePhoto && lightboxIdx !== null && (
        <div
          onClick={() => setLightboxIdx(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(9, 10, 15, 0.92)',
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            gap: '12px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '820px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            <div className="tabular" style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-white)' }}>
              #{team.team} • {activePhoto.caption || `Foto ${lightboxIdx + 1}`}{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>
                ({lightboxIdx + 1}/{photos.length})
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setLightboxIdx((lightboxIdx - 1 + photos.length) % photos.length)}
                    className="btn-ghost"
                  >
                    ‹ Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setLightboxIdx((lightboxIdx + 1) % photos.length)}
                    className="btn-ghost"
                  >
                    Siguiente ›
                  </button>
                </>
              )}
              <a
                href={`/api/pit/photo?id=${encodeURIComponent(activePhoto.photoId)}${
                  activePhoto.eventCode ? `&event=${encodeURIComponent(activePhoto.eventCode)}` : ''
                }`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost"
                style={{ textDecoration: 'none', borderColor: 'var(--bey-cyan)', color: 'var(--bey-cyan)' }}
              >
                Abrir original ↗
              </a>
              <button type="button" onClick={() => setLightboxIdx(null)} className="btn-ghost">
                ✕
              </button>
            </div>
          </div>

          <img
            src={`/api/pit/photo?id=${encodeURIComponent(activePhoto.photoId)}${
              activePhoto.eventCode ? `&event=${encodeURIComponent(activePhoto.eventCode)}` : ''
            }`}
            alt={`#${team.team} ${activePhoto.caption}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '92vw',
              maxHeight: '78vh',
              objectFit: 'contain',
              borderRadius: '6px',
              border: '1px solid var(--border-steel-bright)',
              background: '#090A0F',
            }}
          />
        </div>
      )}
    </>
  );
}
