'use client';

import React from 'react';

type ZoneDef = {
  id: 'A' | 'B' | 'C' | 'D' | 'E';
  code: string;
  alliance: 'red' | 'blue';
  cx: number;
  cy: number;
  path: string;
};

const ALL_ZONES: ZoneDef[] = [
  // Red Alliance Zones (Columns A-C, 180deg mirror of Blue)
  {
    id: 'A',
    code: 'C1',
    alliance: 'red',
    cx: 143,
    cy: 328.5,
    path: 'M 89 308 Q 89 304 93 304 L 193 304 Q 197 304 197 308 L 197 349 Q 197 353 193 353 L 93 353 Q 89 353 89 349 Z',
  },
  {
    id: 'B',
    code: 'A1',
    alliance: 'red',
    cx: 61.5,
    cy: 323,
    path: 'M 35 303 Q 35 299 39 299 L 84 299 Q 88 299 88 303 L 88 343 Q 88 347 84 347 L 39 347 Q 35 347 35 343 Z',
  },
  {
    id: 'C',
    code: 'A2',
    alliance: 'red',
    cx: 59.5,
    cy: 259,
    path: 'M 35 226 Q 35 222 39 222 L 80 222 Q 84 222 84 226 L 84 292 Q 84 296 80 296 L 39 296 Q 35 296 35 292 Z',
  },
  {
    id: 'D',
    code: 'A6',
    alliance: 'red',
    cx: 60.5,
    cy: 48,
    path: 'M 86 187 Q 86 191 82 191 L 39 191 Q 35 191 35 187 L 35 139 Q 35 135 39 135 L 58 135 Q 62 135 62 131 L 62 77 Q 62 73 58 73 L 39 73 Q 35 73 35 69 L 35 27 Q 35 23 39 23 L 82 23 Q 86 23 86 27 Z',
  },
  {
    id: 'E',
    code: 'C6',
    alliance: 'red',
    cx: 169,
    cy: 48,
    path: 'M 193 72 L 91 72 Q 87 72 87 68 L 87 27 Q 87 23 91 23 L 122.4 23 A 12 12 0 0 0 145.6 23 L 193 23 Q 197 23 197 27 L 197 68 Q 197 72 193 72 Z',
  },
  // Blue Alliance Zones (Columns D-F)
  {
    id: 'A',
    code: 'D6',
    alliance: 'blue',
    cx: 257,
    cy: 47.5,
    path: 'M 203 27 Q 203 23 207 23 L 307 23 Q 311 23 311 27 L 311 68 Q 311 72 307 72 L 207 72 Q 203 72 203 68 Z',
  },
  {
    id: 'B',
    code: 'F6',
    alliance: 'blue',
    cx: 338.5,
    cy: 48,
    path: 'M 312 28 Q 312 24 316 24 L 361 24 Q 365 24 365 28 L 365 68 Q 365 72 361 72 L 316 72 Q 312 72 312 68 Z',
  },
  {
    id: 'C',
    code: 'F5',
    alliance: 'blue',
    cx: 340.5,
    cy: 115,
    path: 'M 316 82 Q 316 78 320 78 L 361 78 Q 365 78 365 82 L 365 148 Q 365 152 361 152 L 320 152 Q 316 152 316 148 Z',
  },
  {
    id: 'D',
    code: 'F1',
    alliance: 'blue',
    cx: 339.5,
    cy: 328,
    path: 'M 314 189 Q 314 185 318 185 L 361 185 Q 365 185 365 189 L 365 237 Q 365 241 361 241 L 342 241 Q 338 241 338 245 L 338 299 Q 338 303 342 303 L 361 303 Q 365 303 365 307 L 365 349 Q 365 353 361 353 L 318 353 Q 314 353 314 349 Z',
  },
  {
    id: 'E',
    code: 'D1',
    alliance: 'blue',
    cx: 229,
    cy: 328.5,
    path: 'M 207 304 L 309 304 Q 313 304 313 308 L 313 349 Q 313 353 309 353 L 277.6 353 A 12 12 0 0 0 254.4 353 L 207 353 Q 203 353 203 349 L 203 308 Q 203 304 207 304 Z',
  },
];

const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
const ROWS = ['6', '5', '4', '3', '2', '1'];

export interface FieldMarker {
  slot: string;
  team: number;
  startPos: string;
  alliance: 'red' | 'blue';
}

export default function RagnarokFieldHeatmap({
  positions,
  sidePositions,
  teamNumber,
  markers,
}: {
  positions?: Record<string, { count: number; pct: number }>;
  sidePositions?: Record<string, { count: number; pct: number }>;
  teamNumber?: number;
  markers?: FieldMarker[];
}) {
  // Match alliance-scoped A-E zones first, with fallback for legacy coordinate strings
  const getZoneStats = (zone: ZoneDef) => {
    const sideKey = `${zone.alliance}:${zone.id}`;
    if (sidePositions && sidePositions[sideKey]) return sidePositions[sideKey];
    if (!positions) return null;
    const byCode = Object.entries(positions).find(([k]) => k.toUpperCase().startsWith(zone.code));
    if (byCode) return byCode[1];
    if (!sidePositions && positions[zone.id]) return positions[zone.id];
    return null;
  };

  const getZoneMarkers = (zone: ZoneDef) => {
    if (!markers?.length) return [];
    return markers.filter((m) => {
      if (m.alliance !== zone.alliance) return false;
      const upper = m.startPos.trim().toUpperCase();
      return upper === zone.id || upper.startsWith(zone.code);
    });
  };

  const unmappedEntries = positions
    ? Object.entries(positions).filter(([k]) => {
        const upper = k.trim().toUpperCase();
        return !/^[A-E]$/.test(upper) && !ALL_ZONES.some((z) => upper.startsWith(z.code));
      })
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div
        style={{
          width: '100%',
          maxWidth: '350px',
          margin: '0 auto',
          background: '#090A0F',
          border: '1px solid var(--border-steel)',
          borderRadius: '6px',
          padding: '8px',
        }}
      >
        <svg viewBox="0 0 384 372" width="100%" style={{ display: 'block' }} role="img" aria-label="Mapa heatmap BIOBUZZ">
          {/* Outer Field */}
          <rect x="32" y="20" width="336" height="336" rx="4" fill="#0E1018" stroke="#343B59" strokeWidth="2" />

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
                  fill={isAlt ? '#0E1018' : '#131622'}
                  stroke="#23283D"
                  strokeWidth="1"
                />
              );
            })
          )}

          {/* Midline */}
          <line x1="200" y1="20" x2="200" y2="356" stroke="rgba(248, 250, 252, 0.22)" strokeWidth="1.5" strokeDasharray="4 4" />

          {/* Column & Row Labels */}
          {COLS.map((col, idx) => (
            <text key={col} x={32 + idx * 56 + 28} y="11" textAnchor="middle" dominantBaseline="central" fill="#94A3B8" fontSize="9" fontWeight="700">
              {col}
            </text>
          ))}
          {ROWS.map((row, idx) => (
            <text key={row} x="22" y={20 + idx * 56 + 28} textAnchor="middle" dominantBaseline="central" fill="#94A3B8" fontSize="9" fontWeight="700">
              {row}
            </text>
          ))}

          {/* Red Loading Zone A5 */}
          <rect x="32" y="76" width="27" height="56" fill="rgba(220, 38, 38, 0.14)" stroke="#DC2626" strokeWidth="1.8" />
          <text x="45.5" y="104" textAnchor="middle" dominantBaseline="central" fill="#FCA5A5" fontSize="8" fontWeight="800">LZ</text>

          {/* Blue Loading Zone F2 */}
          <rect x="341" y="244" width="27" height="56" fill="rgba(56, 189, 248, 0.14)" stroke="#38BDF8" strokeWidth="1.8" />
          <text x="354.5" y="272" textAnchor="middle" dominantBaseline="central" fill="#7DD3FC" fontSize="8" fontWeight="800">LZ</text>

          {/* Gardens */}
          <rect x="33" y="351" width="54" height="4" fill="#DC2626" />
          <rect x="313" y="21" width="54" height="4" fill="#38BDF8" />

          {/* 4 Perimeter Flowers */}
          {[
            { cx: 134, cy: 26 },
            { cx: 38, cy: 200 },
            { cx: 362, cy: 176 },
            { cx: 266, cy: 350 },
          ].map((f, idx) => (
            <g key={idx}>
              <circle cx={f.cx} cy={f.cy} r="7.5" fill="rgba(16, 185, 129, 0.2)" stroke="#10B981" strokeWidth="1.5" />
              <circle cx={f.cx} cy={f.cy} r="2.8" fill="#FFD166" />
            </g>
          ))}

          {/* Central Hives */}
          <rect x="152" y="140" width="96" height="96" rx="4" fill="#131622" stroke="#343B59" strokeWidth="1.5" />
          <rect x="156" y="145" width="39" height="38" rx="3" fill="rgba(220, 38, 38, 0.15)" stroke="#DC2626" strokeWidth="1.4" />
          <rect x="156" y="193" width="39" height="38" rx="3" fill="rgba(220, 38, 38, 0.15)" stroke="#DC2626" strokeWidth="1.4" />
          <rect x="205" y="145" width="39" height="38" rx="3" fill="rgba(56, 189, 248, 0.15)" stroke="#38BDF8" strokeWidth="1.4" />
          <rect x="205" y="193" width="39" height="38" rx="3" fill="rgba(56, 189, 248, 0.15)" stroke="#38BDF8" strokeWidth="1.4" />
          <text x="200" y="188" textAnchor="middle" dominantBaseline="central" fill="#E2E8F0" fontSize="8" fontWeight="900">HIVES</text>

          {/* Heatmap Starting Zones */}
          {ALL_ZONES.map((zone) => {
            const stat = getZoneStats(zone);
            const zoneMarkers = getZoneMarkers(zone);
            const active = !!stat || zoneMarkers.length > 0;
            const hasConflict = zoneMarkers.length > 1;
            const { cx, cy } = zone;
            const strokeColor = hasConflict
              ? '#FFD166'
              : active
                ? zone.alliance === 'red'
                  ? '#E11D48'
                  : '#38BDF8'
                : '#23283D';
            const fillColor = hasConflict
              ? 'rgba(255, 209, 102, 0.26)'
              : stat
                ? zone.alliance === 'red'
                  ? `rgba(225, 29, 72, ${0.18 + (stat.pct / 100) * 0.45})`
                  : `rgba(56, 189, 248, ${0.18 + (stat.pct / 100) * 0.45})`
                : zoneMarkers.length > 0
                  ? zone.alliance === 'red'
                    ? 'rgba(225, 29, 72, 0.32)'
                    : 'rgba(56, 189, 248, 0.32)'
                  : 'rgba(255, 255, 255, 0.02)';

            return (
              <g key={`${zone.alliance}-${zone.id}`}>
                <path
                  d={zone.path}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth={active ? 2 : 1}
                  strokeDasharray={active ? undefined : '3 3'}
                />
                <text
                  x={cx}
                  y={active ? cy - 7 : cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={active ? '#F8FAFC' : '#64748B'}
                  fontSize="11"
                  fontWeight="900"
                >
                  {zone.id}
                </text>
                {stat && (
                  <text
                    x={cx}
                    y={cy + 7}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#FFD166"
                    fontSize="9"
                    fontWeight="900"
                  >
                    {stat.pct}%
                  </text>
                )}
                {!stat && zoneMarkers.length > 0 && (
                  <text
                    x={cx}
                    y={cy + 7}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={hasConflict ? '#FFD166' : '#F8FAFC'}
                    fontSize="8"
                    fontWeight="900"
                  >
                    {zoneMarkers.map((m) => `#${m.team}`).join(' ')}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legacy or custom position pills */}
      {!markers && positions && (unmappedEntries.length > 0 || Object.keys(positions).length === 0) && (
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

