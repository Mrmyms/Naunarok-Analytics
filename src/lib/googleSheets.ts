import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

let cachedCreds: { client_email: string; private_key: string } | null = null;
const sheetId = process.env.GOOGLE_SHEET_ID || '1e6LXPnQFsIYImBLn3JrOv7h2Bo1il3hIHWJLRFJbWTQ';

function getCredentials() {
  if (cachedCreds) return cachedCreds;

  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    cachedCreds = {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
    return cachedCreds;
  }

  // Fallback local opcional si existe el JSON junto al proyecto hermano
  const candidates = [
    path.resolve(process.cwd(), 'nauticode-8b981f1cee2d.json'),
    path.resolve(process.cwd(), '../Naunarok/nauticode-8b981f1cee2d.json'),
  ];
  for (const keyPath of candidates) {
    try {
      if (fs.existsSync(keyPath)) {
        const fileData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        cachedCreds = {
          client_email: fileData.client_email,
          private_key: fileData.private_key,
        };
        return cachedCreds;
      }
    } catch {
      // ignore local fallback read error
    }
  }

  throw new Error('Faltan credenciales GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY en variables de entorno.');
}

export async function fetchAnalyticsSheets() {
  const creds = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: ['Resumen_Equipos!A3:N100', 'Captura_BIOBUZZ!A1:AE1000'],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const valueRanges = response.data.valueRanges || [];
  return {
    resumenRows: valueRanges[0]?.values || [],
    capturaRows: valueRanges[1]?.values || [],
  };
}

export async function fetchTimestoneSheets(requestedEvent?: string): Promise<{
  eventCode: string;
  availableEvents: string[];
  rankingRows: unknown[][];
  simMatchRows: unknown[][];
  standingsRows: unknown[][];
}> {
  const creds = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties.title',
  });
  const titles = (meta.data.sheets || [])
    .map((s) => s.properties?.title || '')
    .filter(Boolean);

  const tabPrefixes = ['Ranking_EPA_', 'Simulacion_Matches_', 'Standings_Proy_'];
  const availableEvents = Array.from(
    new Set(
      titles.flatMap((t) => {
        const prefix = tabPrefixes.find((p) => t.startsWith(p));
        return prefix ? [t.slice(prefix.length)] : [];
      })
    )
  )
    .filter(Boolean)
    .sort();

  const requestedClean = (requestedEvent || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const envEvent = (process.env.TIMESTONE_EVENT || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');

  const resolvedEvent = requestedClean || envEvent || availableEvents[0] || '';

  if (!resolvedEvent) {
    return {
      eventCode: '',
      availableEvents,
      rankingRows: [],
      simMatchRows: [],
      standingsRows: [],
    };
  }

  const rankingTab = `Ranking_EPA_${resolvedEvent}`;
  const matchesTab = `Simulacion_Matches_${resolvedEvent}`;
  const standingsTab = `Standings_Proy_${resolvedEvent}`;

  const rangesToFetch: { key: 'ranking' | 'matches' | 'standings'; range: string }[] = [];
  if (titles.includes(rankingTab)) rangesToFetch.push({ key: 'ranking', range: `${rankingTab}!A1:AZ200` });
  if (titles.includes(matchesTab)) rangesToFetch.push({ key: 'matches', range: `${matchesTab}!A1:AZ300` });
  if (titles.includes(standingsTab)) rangesToFetch.push({ key: 'standings', range: `${standingsTab}!A1:AZ200` });

  if (rangesToFetch.length === 0) {
    return {
      eventCode: resolvedEvent,
      availableEvents,
      rankingRows: [],
      simMatchRows: [],
      standingsRows: [],
    };
  }

  const batchRes = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: rangesToFetch.map((r) => r.range),
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const valueRanges = batchRes.data.valueRanges || [];
  let rankingRows: unknown[][] = [];
  let simMatchRows: unknown[][] = [];
  let standingsRows: unknown[][] = [];

  rangesToFetch.forEach((item, idx) => {
    const values = valueRanges[idx]?.values || [];
    if (item.key === 'ranking') rankingRows = values;
    if (item.key === 'matches') simMatchRows = values;
    if (item.key === 'standings') standingsRows = values;
  });

  return {
    eventCode: resolvedEvent,
    availableEvents,
    rankingRows,
    simMatchRows,
    standingsRows,
  };
}

export async function fetchPitScoutingData(): Promise<{
  pitRows: unknown[][];
  photoMetaRows: unknown[][];
}> {
  const creds = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties.title',
  });
  const titles = (meta.data.sheets || [])
    .map((s) => s.properties?.title || '')
    .filter(Boolean);

  const ranges: { key: 'pit' | 'photos'; range: string }[] = [];
  if (titles.includes('Pit_BIOBUZZ')) {
    ranges.push({ key: 'pit', range: 'Pit_BIOBUZZ!A1:S1000' });
  }
  if (titles.includes('Pit_Fotos')) {
    ranges.push({ key: 'photos', range: 'Pit_Fotos!A2:I50000' });
  }

  if (ranges.length === 0) {
    return { pitRows: [], photoMetaRows: [] };
  }

  const batchRes = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: ranges.map((r) => r.range),
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const valueRanges = batchRes.data.valueRanges || [];
  let pitRows: unknown[][] = [];
  let photoMetaRows: unknown[][] = [];

  ranges.forEach((item, idx) => {
    const values = valueRanges[idx]?.values || [];
    if (item.key === 'pit') pitRows = values;
    if (item.key === 'photos') photoMetaRows = values;
  });

  return { pitRows, photoMetaRows };
}

type PhotoChunkMatch = {
  rowNum: number;
  part: number;
  totalParts: number;
  mimeType: string;
  fileName: string;
  chunk?: string;
};

export async function fetchPitPhotoById(
  photoId: string
): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
  const cleanId = photoId.trim();
  if (!cleanId) return null;

  const creds = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  let metaRows: unknown[][];
  try {
    const metaRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Pit_Fotos!A2:I50000',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    metaRows = metaRes.data.values || [];
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('Unable to parse range')) {
      return null;
    }
    throw err;
  }

  const matches: PhotoChunkMatch[] = [];
  metaRows.forEach((row, idx) => {
    if (String(row[1] ?? '').trim() === cleanId) {
      matches.push({
        rowNum: idx + 2,
        part: Number(row[6]) || 0,
        totalParts: Number(row[7]) || 1,
        mimeType: String(row[4] || 'application/octet-stream'),
        fileName: String(row[3] || 'photo'),
      });
    }
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => a.rowNum - b.rowNum);

  const runs: { startRow: number; endRow: number; items: PhotoChunkMatch[] }[] = [];
  for (const item of matches) {
    const lastRun = runs[runs.length - 1];
    if (lastRun && item.rowNum === lastRun.endRow + 1) {
      lastRun.endRow = item.rowNum;
      lastRun.items.push(item);
    } else {
      runs.push({ startRow: item.rowNum, endRow: item.rowNum, items: [item] });
    }
  }

  const chunkRes = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: runs.map((r) => `Pit_Fotos!J${r.startRow}:J${r.endRow}`),
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const valueRanges = chunkRes.data.valueRanges || [];
  runs.forEach((run, runIdx) => {
    const values = valueRanges[runIdx]?.values || [];
    run.items.forEach((item, offset) => {
      item.chunk = String(values[offset]?.[0] ?? '');
    });
  });

  matches.sort((a, b) => a.part - b.part);

  const expectedTotal = matches[0].totalParts;
  if (matches.length < expectedTotal || matches.some((m) => !m.chunk)) {
    throw new Error('La foto está incompleta en Google Sheets');
  }

  const base64Joined = matches.map((m) => m.chunk || '').join('');
  return {
    buffer: Buffer.from(base64Joined, 'base64'),
    mimeType: matches[0].mimeType,
    fileName: matches[0].fileName,
  };
}
