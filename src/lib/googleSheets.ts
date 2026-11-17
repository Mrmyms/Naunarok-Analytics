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
