'use client';

import React from 'react';
import type { TeamAnalytics } from '@/lib/types';

export default function TeamRadarChart({
  team,
  compareTeam,
  allTeams,
}: {
  team: TeamAnalytics;
  compareTeam?: TeamAnalytics | null;
  allTeams: TeamAnalytics[];
}) {
  const maxAuto = Math.max(10, ...allTeams.map((t) => t.autoAvg));
  const maxBal = Math.max(4, ...allTeams.map((t) => t.balancinAutoAvg + t.balancinTeleAvg));
  const maxFlor = Math.max(4, ...allTeams.map((t) => t.florAvg));
  const maxGarden = Math.max(4, ...allTeams.map((t) => t.gardenAvg));

  const getAxes = (t: TeamAnalytics) => [
    { label: 'AUTO', val: Math.min(1, t.autoAvg / maxAuto), raw: t.autoAvg.toFixed(1) },
    {
      label: 'BALANCÍN',
      val: Math.min(1, (t.balancinAutoAvg + t.balancinTeleAvg) / maxBal),
      raw: (t.balancinAutoAvg + t.balancinTeleAvg).toFixed(1),
    },
    { label: 'FLOR', val: Math.min(1, t.florAvg / maxFlor), raw: t.florAvg.toFixed(1) },
    { label: 'GARDEN', val: Math.min(1, t.gardenAvg / maxGarden), raw: t.gardenAvg.toFixed(1) },
    {
      label: 'FIABILIDAD',
      val: Math.min(1, (t.reliabilityPct / 100) * 0.7 + (t.driverAvg / 5) * 0.3),
      raw: `${t.reliabilityPct.toFixed(0)}%`,
    },
  ];

  const primaryAxes = getAxes(team);
  const compareAxes = compareTeam ? getAxes(compareTeam) : null;

  const size = 250;
  const cx = 125;
  const cy = 126;
  const radius = 78;

  const pointAt = (idx: number, ratio: number) => {
    const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / 5;
    const r = Math.max(0.08, ratio) * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  const toPolygon = (axes: { val: number }[]) =>
    axes
      .map((a, i) => {
        const p = pointAt(i, a.val);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: '260px', display: 'block' }}>
        {/* Concentric pentagons */}
        {[0.25, 0.5, 0.75, 1].map((ring) => {
          const pts = [0, 1, 2, 3, 4]
            .map((i) => {
              const p = pointAt(i, ring);
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            })
            .join(' ');
          return <polygon key={ring} points={pts} fill="none" stroke="#23283D" strokeWidth="1" />;
        })}

        {/* Axis spokes & labels */}
        {primaryAxes.map((ax, i) => {
          const outer = pointAt(i, 1);
          const lbl = pointAt(i, 1.24);
          const labelColor =
            ax.label === 'BALANCÍN'
              ? '#60A5FA'
              : ax.label === 'FLOR'
                ? '#F87171'
                : ax.label === 'GARDEN'
                  ? '#34D399'
                  : '#94A3B8';
          return (
            <g key={ax.label}>
              <line x1={cx} y1={cy} x2={outer.x} y2={outer.y} stroke="#23283D" strokeWidth="1" />
              <text
                x={lbl.x}
                y={lbl.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={labelColor}
                fontSize="8.5"
                fontWeight="800"
              >
                {ax.label}
              </text>
            </g>
          );
        })}

        {/* Compare team polygon */}
        {compareAxes && (
          <polygon
            points={toPolygon(compareAxes)}
            fill="rgba(56, 189, 248, 0.16)"
            stroke="#38BDF8"
            strokeWidth="2"
          />
        )}

        {/* Primary team polygon */}
        <polygon
          points={toPolygon(primaryAxes)}
          fill="rgba(168, 85, 247, 0.25)"
          stroke="#A855F7"
          strokeWidth="2.2"
        />

        {/* Vertex dots */}
        {primaryAxes.map((ax, i) => {
          const p = pointAt(i, ax.val);
          return <circle key={ax.label} cx={p.x} cy={p.y} r="3.2" fill="#A855F7" stroke="#F8FAFC" strokeWidth="1" />;
        })}
      </svg>

      {/* Legend */}
      <div className="tabular" style={{ display: 'flex', gap: '14px', fontSize: '11px', fontWeight: 800 }}>
        <span style={{ color: '#A855F7' }}>■ #{team.team}</span>
        {compareTeam && <span style={{ color: '#38BDF8' }}>■ #{compareTeam.team}</span>}
      </div>
    </div>
  );
}

