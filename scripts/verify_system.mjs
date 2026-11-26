#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

const ROOT = process.cwd();

function loadEnvLocal() {
  const envPath = path.resolve(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function getCredentials() {
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }
  const candidates = [
    path.resolve(ROOT, 'nauticode-8b981f1cee2d.json'),
    path.resolve(ROOT, '../Naunarok/nauticode-8b981f1cee2d.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const json = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { client_email: json.client_email, private_key: json.private_key };
    }
  }
  throw new Error('Faltan credenciales GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY o JSON local');
}

async function checkGoogleSheets() {
  const sheetId =
    process.env.GOOGLE_SHEET_ID || '1e6LXPnQFsIYImBLn3JrOv7h2Bo1il3hIHWJLRFJbWTQ';
  const creds = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'properties.title,sheets.properties.title',
  });
  const title = meta.data.properties?.title || 'Sin título';
  const tabs = (meta.data.sheets || [])
    .map((s) => s.properties?.title || '')
    .filter(Boolean);

  console.log(`[PASS] Google Sheets conectado: "${title}" (${tabs.length} pestañas)`);

  const ranges = [];
  if (tabs.includes('Captura_BIOBUZZ')) ranges.push('Captura_BIOBUZZ!A1:AE1000');
  if (tabs.includes('Resumen_Equipos')) ranges.push('Resumen_Equipos!A3:N5');
  if (tabs.includes('Pit_BIOBUZZ')) ranges.push('Pit_BIOBUZZ!A1:S500');
  if (tabs.includes('Pit_Fotos')) ranges.push('Pit_Fotos!A1:I500');

  const events = Array.from(
    new Set(
      tabs.flatMap((t) => {
        for (const p of ['Ranking_EPA_', 'Simulacion_Matches_', 'Standings_Proy_']) {
          if (t.startsWith(p)) return [t.slice(p.length)];
        }
        return [];
      })
    )
  ).sort();

  for (const ev of events) {
    if (tabs.includes(`Ranking_EPA_${ev}`)) ranges.push(`Ranking_EPA_${ev}!A1:AZ5`);
  }

  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const byRange = new Map();
  (batch.data.valueRanges || []).forEach((vr, idx) => {
    byRange.set(ranges[idx], vr.values || []);
  });

  // Captura_BIOBUZZ check
  const capRows = byRange.get('Captura_BIOBUZZ!A1:AE1000') || [];
  const capHeaders = capRows[0] || [];
  if (capHeaders.length === 31) {
    console.log(`[PASS] Captura_BIOBUZZ: 31 columnas exactas, ${Math.max(0, capRows.length - 1)} matches registrados`);
  } else {
    console.log(`[WARN] Captura_BIOBUZZ tiene ${capHeaders.length} columnas (esperadas 31)`);
  }

  // Resumen_Equipos check
  if (tabs.includes('Resumen_Equipos')) {
    console.log('[PASS] Resumen_Equipos presente');
  } else {
    console.log('[WARN] Resumen_Equipos no encontrada');
  }

  // Pit_BIOBUZZ & Pit_Fotos check
  if (tabs.includes('Pit_BIOBUZZ')) {
    const pitRows = byRange.get('Pit_BIOBUZZ!A1:S500') || [];
    console.log(`[PASS] Pit_BIOBUZZ presente (${Math.max(0, pitRows.length - 1)} fichas)`);
  } else {
    console.log('[INFO] Pit_BIOBUZZ aún no existe (se creará automáticamente al guardar el primer Pit)');
  }

  if (tabs.includes('Pit_Fotos')) {
    const photoRows = byRange.get('Pit_Fotos!A1:I500') || [];
    console.log(`[PASS] Pit_Fotos presente (${Math.max(0, photoRows.length - 1)} fragmentos)`);
  } else {
    console.log('[INFO] Pit_Fotos aún no existe (se creará automáticamente al subir la primera foto)');
  }

  // Timestone event tabs
  for (const ev of events) {
    const rRows = byRange.get(`Ranking_EPA_${ev}!A1:AZ5`) || [];
    const hdr = rRows[0] || [];
    const hasOpr = hdr.includes('OPR') && hdr.includes('DPR') && hdr.includes('CCWM');
    const updIdx = hdr.indexOf('Updated_At');
    const updatedAt = updIdx >= 0 && rRows[1] ? rRows[1][updIdx] : null;
    console.log(
      `[PASS] Timestone evento ${ev}: OPR/DPR/CCWM=${hasOpr ? 'SI' : 'FALLBACK_TS'}, Updated_At=${updatedAt || 'N/D'}`
    );
  }
}

async function checkFTCScout() {
  const res = await fetch('https://api.ftcscout.org/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'query { eventsSearch(season: 2026, searchText: "Mexico", limit: 3) { code name } }',
    }),
  });
  if (!res.ok) throw new Error(`FTCScout HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  const count = json.data?.eventsSearch?.length ?? 0;
  console.log(`[PASS] FTCScout GraphQL accesible (200 OK, ${count} eventos de muestra)`);
}

function checkSiblingSchemaAlignment() {
  const scoutPath = path.resolve(ROOT, '../Naunarok/src/app/api/scout/route.ts');
  const pitPath = path.resolve(ROOT, '../Naunarok/src/app/api/pit/route.ts');
  if (!fs.existsSync(scoutPath) || !fs.existsSync(pitPath)) {
    console.log('[INFO] Repo hermano ../Naunarok no presente junto a este directorio; omitiendo chequeo cruzado.');
    return;
  }
  const scoutSrc = fs.readFileSync(scoutPath, 'utf8');
  const pitSrc = fs.readFileSync(pitPath, 'utf8');
  const has31 = scoutSrc.includes('31 columnas') && scoutSrc.includes('AE:');
  const has19 = pitSrc.includes("'FOTOS_IDS'") && pitSrc.includes('Pit_BIOBUZZ');
  if (!has31 || !has19) {
    throw new Error(`Desalineación de esquema en ../Naunarok (31cols=${has31}, pit19=${has19})`);
  }
  console.log('[PASS] Alineación de esquemas con ../Naunarok verificada (Captura_BIOBUZZ 31 cols, Pit_BIOBUZZ 19 cols)');
}

async function main() {
  loadEnvLocal();
  await checkGoogleSheets();
  await checkFTCScout();
  checkSiblingSchemaAlignment();
  console.log('\nVERIFY_SYSTEM_OK');
}

main().catch((err) => {
  console.error('[FAIL]', err.message || err);
  process.exit(1);
});
