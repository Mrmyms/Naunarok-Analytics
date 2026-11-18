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
  if (titles.includes(rankingTab)) rangesToFetch.push({ key: 'ranking', range: `${rankingTab}!A1:Z200` });
  if (titles.includes(matchesTab)) rangesToFetch.push({ key: 'matches', range: `${matchesTab}!A1:Z300` });
  if (titles.includes(standingsTab)) rangesToFetch.push({ key: 'standings', range: `${standingsTab}!A1:Z200` });

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
