'use client';

import React, { useState } from 'react';
import type { MatchRecord } from '@/lib/types';

export default function TeamHistoricChart({ history }: { history: MatchRecord[] }) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (history.length === 0) {
    return (
      <div style={{ padding: '44px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
        Sin historial de partidos capturados todavía.
      </div>
    );
  }

  const width = 520;
  const height = 210;
  const padL = 36;
  const padR = 16;
  const padT = 18;
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxVal = Math.max(
    40,
    ...history.flatMap((m) => [m.netScore, m.autoScore, m.teleScore, m.foulsScore])
  );
  const niceMax = Math.ceil(maxVal / 20) * 20;

  const getX = (idx: number) =>
    history.length === 1 ? padL + plotW / 2 : padL + (idx / (history.length - 1)) * plotW;
  const getY = (val: number) => padT + plotH - (Math.max(0, val) / niceMax) * plotH;

  const buildPath = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(v).toFixed(1)}`).join(' ');

  const netVals = history.map((m) => m.netScore);
  const autoVals = history.map((m) => m.autoScore);
  const teleVals = history.map((m) => m.teleScore);
  const foulVals = history.map((m) => m.foulsScore);

  const areaPath =
    history.length > 1
      ? `${buildPath(netVals)} L ${getX(history.length - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${getX(0).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`
      : '';

  const activeMatch = selectedIdx !== null ? history[selectedIdx] : history[history.length - 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Legend + Selected match readout */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11px', fontWeight: 700 }}>
          <span style={{ color: '#E11D48' }}>● Neto</span>
          <span style={{ color: '#06B6D4' }}>● Auto</span>
          <span style={{ color: '#F59E0B' }}>● TeleOp</span>
          <span style={{ color: '#FCA5A5' }}>┈ Faltas</span>
        </div>

        {activeMatch && (
          <div
            className="tabular"
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--text-silver)',
              background: 'var(--bg-carbon)',
              border: '1px solid var(--border-steel)',
              borderRadius: '4px',
              padding: '4px 8px',
            }}
          >
            M#{activeMatch.match} ({activeMatch.alliance}) · Neto{' '}
            <strong style={{ color: '#E11D48' }}>{activeMatch.netScore}</strong> · Auto{' '}
            <strong style={{ color: '#06B6D4' }}>{activeMatch.autoScore}</strong> · Tele{' '}
            <strong style={{ color: '#F59E0B' }}>{activeMatch.teleScore}</strong>
          </div>
        )}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: 'block', background: '#111116', borderRadius: '4px', border: '1px solid #27272E' }}>
        <defs>
          <linearGradient id="ragNetArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E11D48" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#E11D48" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const val = Math.round(niceMax * t);
          const y = getY(val);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#27272E" strokeWidth="1" />
              <text x={padL - 6} y={y} textAnchor="end" dominantBaseline="central" fill="#71717A" fontSize="9" fontWeight="700">
                {val}
              </text>
            </g>
          );
        })}

        {/* Area fill under Net */}
        {areaPath && <path d={areaPath} fill="url(#ragNetArea)" />}

        {/* Series paths */}
        {history.length > 1 && (
          <>
            <path d={buildPath(foulVals)} fill="none" stroke="#FCA5A5" strokeWidth="1.5" strokeDasharray="4 3" />
            <path d={buildPath(autoVals)} fill="none" stroke="#06B6D4" strokeWidth="2" />
            <path d={buildPath(teleVals)} fill="none" stroke="#F59E0B" strokeWidth="2" />
            <path d={buildPath(netVals)} fill="none" stroke="#E11D48" strokeWidth="2.8" />
          </>
        )}

        {/* Match points & X labels */}
        {history.map((m, i) => {
          const cx = getX(i);
          const isActive = (selectedIdx ?? history.length - 1) === i;
          return (
            <g key={`${m.id}-${i}`} onClick={() => setSelectedIdx(i)} style={{ cursor: 'pointer' }}>
              <line
                x1={cx}
                y1={padT}
                x2={cx}
                y2={padT + plotH}
                stroke={isActive ? 'rgba(225, 29, 72, 0.4)' : 'transparent'}
                strokeWidth="1"
              />
              <circle cx={cx} cy={getY(m.autoScore)} r={isActive ? 4 : 3} fill="#06B6D4" />
              <circle cx={cx} cy={getY(m.teleScore)} r={isActive ? 4 : 3} fill="#F59E0B" />
              <circle
                cx={cx}
                cy={getY(m.netScore)}
                r={isActive ? 5.5 : 4}
                fill="#E11D48"
                stroke="#FAFAFA"
                strokeWidth={isActive ? 1.5 : 0.8}
              />
              <text x={cx} y={height - 10} textAnchor="middle" fill={isActive ? '#FAFAFA' : '#71717A'} fontSize="9.5" fontWeight="700">
                M{m.match}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

