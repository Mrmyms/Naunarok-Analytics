'use client';

import React from 'react';

type ZoneDef = {
  id: string;
  code: string;
  alliance: 'red' | 'blue';
  x: number;
  y: number;
  w: number;
  h: number;
};

const ALL_ZONES: ZoneDef[] = [
  // Red Alliance Zones (Columns A-C)
  { id: 'A6 · Esq. Sup.', code: 'A6', alliance: 'red', x: 35, y: 23, w: 51, h: 49 },
  { id: 'C6 · Centro Sup.', code: 'C6', alliance: 'red', x: 147, y: 23, w: 50, h: 47 },
  { id: 'A2 · Pared Lat.', code: 'A2', alliance: 'red', x: 35, y: 222, w: 49, h: 74 },
  { id: 'A1 · Garden', code: 'A1', alliance: 'red', x: 35, y: 299, w: 53, h: 48 },
  { id: 'C1 · Audience', code: 'C1', alliance: 'red', x: 120, y: 304, w: 77, h: 49 },
  // Blue Alliance Zones (Columns D-F)
  { id: 'D6 · Centro Sup.', code: 'D6', alliance: 'blue', x: 203, y: 23, w: 77, h: 47 },
  { id: 'F6 · Garden', code: 'F6', alliance: 'blue', x: 312, y: 24, w: 53, h: 48 },
  { id: 'F5 · Pared Lat.', code: 'F5', alliance: 'blue', x: 316, y: 78, w: 49, h: 74 },
  { id: 'F1 · Esq. Inf.', code: 'F1', alliance: 'blue', x: 314, y: 304, w: 51, h: 49 },
  { id: 'D1 · Audience', code: 'D1', alliance: 'blue', x: 203, y: 304, w: 50, h: 49 },
];

const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
const ROWS = ['6', '5', '4', '3', '2', '1'];

export default function RagnarokFieldHeatmap({
  positions,
  teamNumber,
}: {
  positions: Record<string, { count: number; pct: number }>;
  teamNumber?: number;
}) {
  // Match both exact new zone IDs (e.g. "D1 · Audience") and legacy strings
  const getZoneStats = (zone: ZoneDef) => {
    if (positions[zone.id]) return positions[zone.id];
    const byCode = Object.entries(positions).find(([k]) => k.startsWith(zone.code));
    return byCode ? byCode[1] : null;
  };

  const unmappedEntries = Object.entries(positions).filter(
    ([k]) => !ALL_ZONES.some((z) => k === z.id || k.startsWith(z.code))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div
        style={{
          width: '100%',
          maxWidth: '350px',
          margin: '0 auto',
          background: '#0D0D12',
          border: '1px solid var(--border-steel)',
          borderRadius: '6px',
          padding: '8px',
        }}
      >
        <svg viewBox="0 0 384 372" width="100%" style={{ display: 'block' }} role="img" aria-label="Mapa heatmap BIOBUZZ">
          {/* Outer Field */}
          <rect x="32" y="20" width="336" height="336" rx="4" fill="#111116" stroke="#3A3A44" strokeWidth="2" />

          {/* 6x6 Tiles */}
          {ROWS.map((rowLabel, rIdx) =>
            COLS.map((colLabel, cIdx) => {
              const tx = 32 + cIdx * 56;
              const ty = 20 + rIdx * 56;
              const isAlt = (rIdx + cIdx) % 2 === 0;
              return (
                <rect
                  key={`${colLabel}${rowLabel}`}
                  x={tx}
                  y={ty}
                  width="56"
                  height="56"
                  fill={isAlt ? '#111116' : '#16161D'}
                  stroke="#27272E"
                  strokeWidth="1"
                />
              );
            })
          )}

          {/* Midline */}
          <line x1="200" y1="20" x2="200" y2="356" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeDasharray="4 4" />

          {/* Column & Row Labels */}
          {COLS.map((col, idx) => (
            <text key={col} x={32 + idx * 56 + 28} y="31" textAnchor="middle" dominantBaseline="central" fill="#71717A" fontSize="9" fontWeight="700">
              {col}
            </text>
          ))}
          {ROWS.map((row, idx) => (
            <text key={row} x="22" y={20 + idx * 56 + 28} textAnchor="middle" dominantBaseline="central" fill="#71717A" fontSize="9" fontWeight="700">
              {row}
            </text>
          ))}

          {/* Red Loading Zone A5 */}
          <rect x="32" y="76" width="27" height="56" fill="rgba(220, 38, 38, 0.14)" stroke="#DC2626" strokeWidth="1.8" />
          <text x="45.5" y="104" textAnchor="middle" dominantBaseline="central" fill="#FCA5A5" fontSize="8" fontWeight="800">LZ</text>

          {/* Blue Loading Zone F2 */}
          <rect x="341" y="244" width="27" height="56" fill="rgba(6, 182, 212, 0.14)" stroke="#06B6D4" strokeWidth="1.8" />
          <text x="354.5" y="272" textAnchor="middle" dominantBaseline="central" fill="#67E8F9" fontSize="8" fontWeight="800">LZ</text>

          {/* Gardens */}
          <rect x="33" y="351" width="54" height="4" fill="#DC2626" />
          <rect x="313" y="21" width="54" height="4" fill="#06B6D4" />

          {/* 4 Perimeter Flowers */}
          {[
            { cx: 134, cy: 26 },
            { cx: 38, cy: 200 },
            { cx: 362, cy: 176 },
            { cx: 266, cy: 350 },
          ].map((f, idx) => (
            <g key={idx}>
              <circle cx={f.cx} cy={f.cy} r="7.5" fill="rgba(16, 185, 129, 0.2)" stroke="#10B981" strokeWidth="1.5" />
              <circle cx={f.cx} cy={f.cy} r="2.8" fill="#F59E0B" />
            </g>
          ))}

          {/* Central Hives */}
          <rect x="152" y="140" width="96" height="96" rx="4" fill="#18181D" stroke="#3A3A44" strokeWidth="1.5" />
          <rect x="156" y="145" width="39" height="38" rx="3" fill="rgba(220, 38, 38, 0.15)" stroke="#DC2626" strokeWidth="1.4" />
          <rect x="156" y="193" width="39" height="38" rx="3" fill="rgba(220, 38, 38, 0.15)" stroke="#DC2626" strokeWidth="1.4" />
          <rect x="205" y="145" width="39" height="38" rx="3" fill="rgba(6, 182, 212, 0.15)" stroke="#06B6D4" strokeWidth="1.4" />
          <rect x="205" y="193" width="39" height="38" rx="3" fill="rgba(6, 182, 212, 0.15)" stroke="#06B6D4" strokeWidth="1.4" />
          <text x="200" y="188" textAnchor="middle" dominantBaseline="central" fill="#D4D4D8" fontSize="8" fontWeight="900">HIVES</text>

          {/* Heatmap Starting Zones */}
          {ALL_ZONES.map((zone) => {
            const stat = getZoneStats(zone);
            const active = !!stat;
            const cx = zone.x + zone.w / 2;
            const cy = zone.y + zone.h / 2;
            const strokeColor = active
              ? zone.alliance === 'red'
                ? '#E11D48'
                : '#06B6D4'
              : '#27272E';
            const fillColor = active
              ? zone.alliance === 'red'
                ? `rgba(225, 29, 72, ${0.18 + (stat.pct / 100) * 0.45})`
                : `rgba(6, 182, 212, ${0.18 + (stat.pct / 100) * 0.45})`
              : 'rgba(255, 255, 255, 0.02)';

            return (
              <g key={zone.id}>
                <rect
                  x={zone.x}
                  y={zone.y}
                  width={zone.w}
                  height={zone.h}
                  rx="4"
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth={active ? 2 : 1}
                  strokeDasharray={active ? undefined : '3 3'}
                />
                <text
                  x={cx}
                  y={active ? cy - 6 : cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={active ? '#FAFAFA' : '#52525B'}
                  fontSize="10"
                  fontWeight="800"
                >
                  {zone.code}
                </text>
                {active && (
                  <text
                    x={cx}
                    y={cy + 8}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#F59E0B"
                    fontSize="9"
                    fontWeight="900"
                  >
                    {stat.pct}%
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legacy or custom position pills */}
      {(unmappedEntries.length > 0 || Object.keys(positions).length === 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
          {Object.keys(positions).length === 0 ? (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Sin posiciones registradas para #{teamNumber ?? '—'}
            </span>
          ) : (
            unmappedEntries.map(([pos, st]) => (
              <span
                key={pos}
                className="tabular"
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '4px 8px',
                  borderRadius: '4px',
                  background: 'var(--bg-carbon)',
                  border: '1px solid var(--border-steel)',
                  color: 'var(--accent-amber)',
                }}
              >
                {pos}: {st.pct}% ({st.count})
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
}

