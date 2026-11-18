import type { TeamAnalytics } from './types';

export type RobotRole = 'BALANCÍN' | 'FLOR' | 'HÍBRIDO' | 'GARDEN' | 'BASE';
export type PickTag = 'none' | 'top' | 'pick' | 'avoid' | 'drafted';

export function detectRobotRole(t: TeamAnalytics): {
  role: RobotRole;
  color: string;
  bg: string;
} {
  const bal = t.balancinAutoAvg + t.balancinTeleAvg;
  const flor = t.florAvg;
  const gar = t.gardenAvg;

  if (bal === 0 && flor === 0 && gar === 0) {
    return { role: 'BASE', color: '#94A3B8', bg: 'rgba(148, 163, 184, 0.14)' };
  }
  if (gar > bal + flor && gar >= 2) {
    return { role: 'GARDEN', color: '#34D399', bg: 'rgba(16, 185, 129, 0.16)' };
  }
  if (bal >= 1 && flor >= 1 && Math.abs(bal - flor) <= Math.max(bal, flor) * 0.35) {
    return { role: 'HÍBRIDO', color: '#A855F7', bg: 'rgba(168, 85, 247, 0.18)' };
  }
  if (bal >= flor) {
    return { role: 'BALANCÍN', color: '#60A5FA', bg: 'rgba(59, 130, 246, 0.16)' };
  }
  return { role: 'FLOR', color: '#F87171', bg: 'rgba(225, 29, 72, 0.16)' };
}

export const PICK_TAG_META: Record<PickTag, { label: string; color: string; border: string; bg: string }> = {
  none: { label: '—', color: '#94A3B8', border: '#23283D', bg: 'transparent' },
  top: { label: '★ TOP', color: '#FFD166', border: '#FFD166', bg: 'rgba(255, 209, 102, 0.16)' },
  pick: { label: '✓ PICK', color: '#10B981', border: '#10B981', bg: 'rgba(16, 185, 129, 0.16)' },
  avoid: { label: '✕ EVITAR', color: '#FCA5A5', border: '#DC2626', bg: 'rgba(220, 38, 38, 0.18)' },
  drafted: { label: 'DRAFTED', color: '#94A3B8', border: '#343B59', bg: 'rgba(52, 59, 89, 0.25)' },
};

export const NEXT_PICK_TAG: Record<PickTag, PickTag> = {
  none: 'top',
  top: 'pick',
  pick: 'avoid',
  avoid: 'drafted',
  drafted: 'none',
};

