'use client';

import React from 'react';

interface Segment {
  label: string;
  value: number;
  color: string;
}

function SegmentedBarRow({
  title,
  accentColor,
  segments,
  totalLabel,
}: {
  title: string;
  accentColor: string;
  segments: Segment[];
  totalLabel: string;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);

  return (
    <div
      style={{
        background: 'var(--bg-carbon)',
        border: `1px solid ${accentColor}`,
        borderRadius: '6px',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-white)', letterSpacing: '0.3px' }}>
          {title}
        </span>
        <span className="tabular" style={{ fontSize: '12px', fontWeight: 800, color: accentColor }}>
          {totalLabel}
        </span>
      </div>

      {/* Stacked bar */}
      <div
        style={{
          height: '12px',
          width: '100%',
          background: '#09090B',
          borderRadius: '3px',
          overflow: 'hidden',
          display: 'flex',
          border: '1px solid #27272E',
        }}
      >
        {total === 0 ? (
          <div style={{ width: '100%', background: '#1F1F26' }} />
        ) : (
          segments.map((seg) =>
            seg.value > 0 ? (
              <div
                key={seg.label}
                title={`${seg.label}: ${seg.value.toFixed(1)}`}
                style={{
                  width: `${(seg.value / total) * 100}%`,
                  background: seg.color,
                  height: '100%',
                }}
              />
            ) : null
          )
        )}
      </div>

      {/* Breakdown values */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))`, gap: '6px' }}>
        {segments.map((seg) => (
          <div key={seg.label} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span style={{ fontSize: '9.5px', fontWeight: 700, color: seg.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {seg.label}
            </span>
            <span className="tabular" style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-white)' }}>
              {seg.value.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DistributionBars({
  autoBalPollen,
  autoBalNectar,
  autoFlorPollen,
  autoFlorNectar,
  teleBalPollen,
  teleBalNectar,
  teleFlorPollen,
  teleFlorNectar,
  gardenAvg,
}: {
  autoBalPollen: number;
  autoBalNectar: number;
  autoFlorPollen: number;
  autoFlorNectar: number;
  teleBalPollen: number;
  teleBalNectar: number;
  teleFlorPollen: number;
  teleFlorNectar: number;
  gardenAvg: number;
}) {
  const autoTotal = autoBalPollen + autoBalNectar + autoFlorPollen + autoFlorNectar;
  const teleTotal = teleBalPollen + teleBalNectar + teleFlorPollen + teleFlorNectar + gardenAvg;
  const grandTotal = autoTotal + teleTotal;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Leyenda unificada de zonas */}
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '10.5px', fontWeight: 800 }}>
        <span style={{ color: '#60A5FA' }}>■ BALANCÍN (Azules)</span>
        <span style={{ color: '#F87171' }}>■ FLOWER (Rojos)</span>
        <span style={{ color: '#34D399' }}>■ GARDEN (Verdes)</span>
      </div>

      <SegmentedBarRow
        title="Auto Piece Distribution"
        accentColor="#3B82F6"
        totalLabel={`${autoTotal.toFixed(1)} pzs`}
        segments={[
          { label: 'Bal. POLLEN', value: autoBalPollen, color: '#60A5FA' },
          { label: 'Bal. Néctar', value: autoBalNectar, color: '#2563EB' },
          { label: 'Flor POLLEN', value: autoFlorPollen, color: '#FB7185' },
          { label: 'Flor Néctar', value: autoFlorNectar, color: '#DC2626' },
        ]}
      />

      <SegmentedBarRow
        title="TeleOp Piece Distribution"
        accentColor="#E11D48"
        totalLabel={`${teleTotal.toFixed(1)} pzs`}
        segments={[
          { label: 'Bal. POLLEN', value: teleBalPollen, color: '#60A5FA' },
          { label: 'Bal. Néctar', value: teleBalNectar, color: '#2563EB' },
          { label: 'Flor POLLEN', value: teleFlorPollen, color: '#FB7185' },
          { label: 'Flor Néctar', value: teleFlorNectar, color: '#DC2626' },
          { label: 'Garden', value: gardenAvg, color: '#10B981' },
        ]}
      />

      <SegmentedBarRow
        title="Total Match Distribution (Balancín · Flower · Garden)"
        accentColor="#10B981"
        totalLabel={`${grandTotal.toFixed(1)} pzs`}
        segments={[
          { label: 'Balancín Total', value: autoBalPollen + autoBalNectar + teleBalPollen + teleBalNectar, color: '#3B82F6' },
          { label: 'Flower Total', value: autoFlorPollen + autoFlorNectar + teleFlorPollen + teleFlorNectar, color: '#E11D48' },
          { label: 'Garden Total', value: gardenAvg, color: '#10B981' },
        ]}
      />
    </div>
  );
}

