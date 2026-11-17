'use client';

import React from 'react';

interface DuelMetric {
  label: string;
  leftVal: number;
  rightVal: number;
  lowerIsBetter?: boolean;
  unit?: string;
}

export default function DuelComparisonBars({
  leftTitle,
  rightTitle,
  leftColor = '#E11D48',
  rightColor = '#06B6D4',
  metrics,
}: {
  leftTitle: string;
  rightTitle: string;
  leftColor?: string;
  rightColor?: string;
  metrics: DuelMetric[];
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Comparativa Directa por Categoría</span>
        <div className="tabular" style={{ display: 'flex', gap: '14px', fontSize: '11px', fontWeight: 800 }}>
          <span style={{ color: leftColor }}>■ {leftTitle}</span>
          <span style={{ color: rightColor }}>■ {rightTitle}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {metrics.map((m) => {
          const sum = m.leftVal + m.rightVal;
          const leftPct = sum > 0 ? (m.leftVal / sum) * 100 : 50;
          const leftWins = m.lowerIsBetter ? m.leftVal < m.rightVal : m.leftVal > m.rightVal;
          const rightWins = m.lowerIsBetter ? m.rightVal < m.leftVal : m.rightVal > m.leftVal;

          return (
            <div key={m.label} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="tabular" style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px', alignItems: 'center', fontSize: '12px' }}>
                <span style={{ fontWeight: leftWins ? 900 : 700, color: leftWins ? leftColor : 'var(--text-silver)' }}>
                  {m.leftVal.toFixed(1)}
                  {m.unit || ''}
                </span>
                <span style={{ textAlign: 'center', fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  {m.label}
                </span>
                <span style={{ textAlign: 'right', fontWeight: rightWins ? 900 : 700, color: rightWins ? rightColor : 'var(--text-silver)' }}>
                  {m.rightVal.toFixed(1)}
                  {m.unit || ''}
                </span>
              </div>

              <div
                style={{
                  height: '7px',
                  width: '100%',
                  background: '#09090B',
                  border: '1px solid #27272E',
                  borderRadius: '2px',
                  overflow: 'hidden',
                  display: 'flex',
                }}
              >
                <div style={{ width: `${leftPct}%`, background: leftColor, height: '100%' }} />
                <div style={{ width: `${100 - leftPct}%`, background: rightColor, height: '100%' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

