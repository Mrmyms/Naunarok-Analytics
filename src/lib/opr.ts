export interface OprDprStat {
  opr: number;
  dpr: number;
  ccwm: number;
  rankOff: number;
  rankDef: number;
  rankCombAvg: number;
}

export interface PlayedMatchScoreInput {
  red1: number;
  red2: number;
  blue1: number;
  blue2: number;
  redScore: number;
  blueScore: number;
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r][col]);
      if (val > maxAbs) {
        maxAbs = val;
        pivotRow = r;
      }
    }

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let c = col; c <= n; c++) {
      M[col][c] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  return M.map((row) => row[n]);
}

export function computeOprDprFromMatches(
  matches: PlayedMatchScoreInput[]
): Map<number, OprDprStat> {
  const validMatches = matches.filter(
    (m) =>
      m.red1 > 0 &&
      m.red2 > 0 &&
      m.blue1 > 0 &&
      m.blue2 > 0 &&
      Number.isFinite(m.redScore) &&
      Number.isFinite(m.blueScore)
  );

  if (validMatches.length === 0) {
    return new Map();
  }

  const teamSet = new Set<number>();
  for (const m of validMatches) {
    teamSet.add(m.red1);
    teamSet.add(m.red2);
    teamSet.add(m.blue1);
    teamSet.add(m.blue2);
  }

  const teamIds = Array.from(teamSet).sort((a, b) => a - b);
  const idxMap = new Map<number, number>(teamIds.map((t, i) => [t, i]));
  const n = teamIds.length;

  // Normal equations: (M^T M + lambda * I) x = M^T y
  const lambda = 1e-4;
  const ata: number[][] = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => (r === c ? lambda : 0))
  );
  const atbOwn = new Array<number>(n).fill(0);
  const atbOpp = new Array<number>(n).fill(0);

  const addEquation = (t1: number, t2: number, ownScore: number, oppScore: number) => {
    const i1 = idxMap.get(t1)!;
    const i2 = idxMap.get(t2)!;
    ata[i1][i1] += 1;
    ata[i2][i2] += 1;
    if (i1 !== i2) {
      ata[i1][i2] += 1;
      ata[i2][i1] += 1;
    } else {
      ata[i1][i1] += 2;
    }
    atbOwn[i1] += ownScore;
    atbOwn[i2] += ownScore;
    atbOpp[i1] += oppScore;
    atbOpp[i2] += oppScore;
  };

  for (const m of validMatches) {
    addEquation(m.red1, m.red2, m.redScore, m.blueScore);
    addEquation(m.blue1, m.blue2, m.blueScore, m.redScore);
  }

  const oprVec = solveLinearSystem(ata, atbOwn);
  const dprVec = solveLinearSystem(ata, atbOpp);

  const entries = teamIds.map((team, idx) => {
    const opr = Math.round(oprVec[idx] * 100) / 100;
    const dpr = Math.round(dprVec[idx] * 100) / 100;
    const ccwm = Math.round((opr - dpr) * 100) / 100;
    return { team, opr, dpr, ccwm, rankOff: 0, rankDef: 0 };
  });

  // Rank Ofensivo: mayor OPR = #1
  [...entries]
    .sort((a, b) => b.opr - a.opr || b.ccwm - a.ccwm || a.team - b.team)
    .forEach((e, i) => {
      e.rankOff = i + 1;
    });

  // Rank Defensivo: menor DPR = #1
  [...entries]
    .sort((a, b) => a.dpr - b.dpr || b.ccwm - a.ccwm || a.team - b.team)
    .forEach((e, i) => {
      e.rankDef = i + 1;
    });

  const out = new Map<number, OprDprStat>();
  for (const e of entries) {
    out.set(e.team, {
      opr: e.opr,
      dpr: e.dpr,
      ccwm: e.ccwm,
      rankOff: e.rankOff,
      rankDef: e.rankDef,
      rankCombAvg: Math.round(((e.rankOff + e.rankDef) / 2) * 10) / 10,
    });
  }

  return out;
}
