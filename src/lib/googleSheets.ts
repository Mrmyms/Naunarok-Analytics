import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

let cachedCreds: { client_email: string; private_key: string } | null = null;
const sheetId = process.env.GOOGLE_SHEET_ID || '1e6LXPnQFsIYImBLn3JrOv7h2Bo1il3hIHWJLRFJbWTQ';

const EVENT_TAB_PREFIXES = [
  'Captura_BIOBUZZ_',
  'Pit_BIOBUZZ_',
  'Ranking_EPA_',
  'Simulacion_Matches_',
  'Standings_Proy_',
];

const RESERVED_DEFAULT_CODES = new Set(['', 'DEFAULT', 'GENERAL', 'MANUAL', 'ALL']);

export function formatSheetRange(sheetName: string, range: string): string {
  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'!${range}`;
}

export function normalizeEventCode(raw?: string | null): string {
  if (!raw) return '';
  const cleaned = raw
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  if (!cleaned || RESERVED_DEFAULT_CODES.has(cleaned)) {
    return '';
  }

  return cleaned;
}

export function extractAllAvailableEvents(titles: string[]): string[] {
  const events = new Set<string>();
  for (const title of titles) {
    for (const prefix of EVENT_TAB_PREFIXES) {
      if (title.startsWith(prefix)) {
        const code = normalizeEventCode(title.slice(prefix.length));
        if (code) events.add(code);
      }
    }
  }
  return Array.from(events).sort();
}

export function resolveEventCode(requestedEvent?: string, availableEvents?: string[]): string {
  const requested = normalizeEventCode(requestedEvent);
  if (requested) return requested;

  const envEvent = normalizeEventCode(process.env.TIMESTONE_EVENT || 'MXTLQ');
  if (envEvent) return envEvent;

  return availableEvents?.[0] || 'MXTLQ';
}

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

function getSheetsReadonlyClient() {
  const creds = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

export async function listSpreadsheetTitles(): Promise<string[]> {
  const sheets = getSheetsReadonlyClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties.title',
  });
  return (meta.data.sheets || [])
    .map((s) => s.properties?.title || '')
    .filter(Boolean);
}

export async function fetchAnalyticsSheets(
  eventCode?: string,
  preloadedTitles?: string[]
): Promise<{
  resumenRows: unknown[][];
  capturaRows: unknown[][];
  capturaSheet: string;
}> {
  const sheets = getSheetsReadonlyClient();
  const titles = preloadedTitles ?? (await listSpreadsheetTitles());
  const normalizedEvent = normalizeEventCode(eventCode);

  if (normalizedEvent) {
    const candidates = [
      `Captura_BIOBUZZ_${normalizedEvent}`,
      `Captura_${normalizedEvent}`,
      `Scouting_${normalizedEvent}`,
    ];
    const capturaSheet = candidates.find((t) => titles.includes(t)) || '';
    if (!capturaSheet) {
      return {
        resumenRows: [],
        capturaRows: [],
        capturaSheet: '',
      };
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: formatSheetRange(capturaSheet, 'A1:AE'),
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    return {
      resumenRows: [],
      capturaRows: res.data.values || [],
      capturaSheet,
    };
  }

  const ranges: { key: 'resumen' | 'captura'; range: string }[] = [];
  if (titles.includes('Resumen_Equipos')) {
    ranges.push({ key: 'resumen', range: formatSheetRange('Resumen_Equipos', 'A3:N100') });
  }
  if (titles.includes('Captura_BIOBUZZ')) {
    ranges.push({ key: 'captura', range: formatSheetRange('Captura_BIOBUZZ', 'A1:AE') });
  }

  if (ranges.length === 0) {
    return { resumenRows: [], capturaRows: [], capturaSheet: '' };
  }

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: ranges.map((r) => r.range),
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const valueRanges = response.data.valueRanges || [];
  let resumenRows: unknown[][] = [];
  let capturaRows: unknown[][] = [];

  ranges.forEach((item, idx) => {
    const values = valueRanges[idx]?.values || [];
    if (item.key === 'resumen') resumenRows = values;
    if (item.key === 'captura') capturaRows = values;
  });

  return {
    resumenRows,
    capturaRows,
    capturaSheet: titles.includes('Captura_BIOBUZZ') ? 'Captura_BIOBUZZ' : '',
  };
}

export async function fetchTimestoneSheets(
  requestedEvent?: string,
  preloadedTitles?: string[]
): Promise<{
  eventCode: string;
  availableEvents: string[];
  rankingRows: unknown[][];
  simMatchRows: unknown[][];
  standingsRows: unknown[][];
}> {
  const sheets = getSheetsReadonlyClient();
  const titles = preloadedTitles ?? (await listSpreadsheetTitles());
  const availableEvents = extractAllAvailableEvents(titles);
  const resolvedEvent = resolveEventCode(requestedEvent, availableEvents);

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
  if (titles.includes(rankingTab)) {
    rangesToFetch.push({ key: 'ranking', range: formatSheetRange(rankingTab, 'A1:AZ200') });
  }
  if (titles.includes(matchesTab)) {
    rangesToFetch.push({ key: 'matches', range: formatSheetRange(matchesTab, 'A1:AZ300') });
  }
  if (titles.includes(standingsTab)) {
    rangesToFetch.push({ key: 'standings', range: formatSheetRange(standingsTab, 'A1:AZ200') });
  }

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

export async function fetchPitScoutingData(
  eventCode?: string,
  preloadedTitles?: string[]
): Promise<{
  pitRows: unknown[][];
  photoMetaRows: unknown[][];
  pitEventCode: string;
}> {
  const sheets = getSheetsReadonlyClient();
  const titles = preloadedTitles ?? (await listSpreadsheetTitles());
  const normalizedEvent = normalizeEventCode(eventCode);

  const pitTab = normalizedEvent ? `Pit_BIOBUZZ_${normalizedEvent}` : 'Pit_BIOBUZZ';
  const photosTab = normalizedEvent ? `Pit_Fotos_${normalizedEvent}` : 'Pit_Fotos';

  const ranges: { key: 'pit' | 'photos'; range: string }[] = [];
  if (titles.includes(pitTab)) {
    ranges.push({ key: 'pit', range: formatSheetRange(pitTab, 'A1:S') });
  }
  if (titles.includes(photosTab)) {
    ranges.push({ key: 'photos', range: formatSheetRange(photosTab, 'A2:I') });
  }

  if (ranges.length === 0) {
    return { pitRows: [], photoMetaRows: [], pitEventCode: normalizedEvent };
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

  return { pitRows, photoMetaRows, pitEventCode: normalizedEvent };
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
  photoId: string,
  eventCode?: string
): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
  const cleanId = photoId.trim();
  if (!cleanId) return null;

  const sheets = getSheetsReadonlyClient();
  const titles = await listSpreadsheetTitles();
  const normalizedEvent = normalizeEventCode(eventCode);

  const candidateSheets: string[] = [];
  const addCandidate = (sheetTitle: string) => {
    if (titles.includes(sheetTitle) && !candidateSheets.includes(sheetTitle)) {
      candidateSheets.push(sheetTitle);
    }
  };

  if (normalizedEvent) {
    addCandidate(`Pit_Fotos_${normalizedEvent}`);
  }
  addCandidate('Pit_Fotos');
  for (const title of titles) {
    if (title.startsWith('Pit_Fotos_')) {
      addCandidate(title);
    }
  }

  let foundSheet: string | null = null;
  let matches: PhotoChunkMatch[] = [];

  for (const sheetTitle of candidateSheets) {
    const metaRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: formatSheetRange(sheetTitle, 'A2:I'),
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const metaRows = metaRes.data.values || [];
    const sheetMatches: PhotoChunkMatch[] = [];

    metaRows.forEach((row, idx) => {
      if (String(row[1] ?? '').trim() === cleanId) {
        sheetMatches.push({
          rowNum: idx + 2,
          part: Number(row[6]) || 0,
          totalParts: Number(row[7]) || 1,
          mimeType: String(row[4] || 'application/octet-stream'),
          fileName: String(row[3] || 'photo'),
        });
      }
    });

    if (sheetMatches.length > 0) {
      foundSheet = sheetTitle;
      matches = sheetMatches;
      break;
    }
  }

  if (!foundSheet || matches.length === 0) return null;

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
    ranges: runs.map((r) => formatSheetRange(foundSheet!, `J${r.startRow}:J${r.endRow}`)),
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
