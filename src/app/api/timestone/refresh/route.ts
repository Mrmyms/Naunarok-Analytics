import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);
const recentDispatches = new Map<string, number>();
const COOLDOWN_MS = 90_000;

function sanitizeEventCode(raw: unknown, fallback = ''): string {
  const cleaned = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  return cleaned.length >= 2 && cleaned.length <= 24 ? cleaned : fallback;
}

export async function POST(request: Request) {
  try {
    let body: { eventCode?: string; ftcscoutCode?: string; season?: number; force?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      // Allow empty POST body
    }

    const envEvent = sanitizeEventCode(process.env.TIMESTONE_EVENT, '');
    const eventCode = sanitizeEventCode(body.eventCode, envEvent);
    if (!eventCode) {
      return NextResponse.json(
        {
          success: false,
          error: 'Selecciona o escribe un código de evento válido antes de ejecutar Timestone.',
        },
        { status: 400 }
      );
    }
    const ftcscoutCode = body.ftcscoutCode ? sanitizeEventCode(body.ftcscoutCode, '') : '';
    const season = Number.isFinite(Number(body.season)) ? Math.max(2020, Math.min(2035, Math.round(Number(body.season)))) : 2026;
    const force = Boolean(body.force);

    const lastRun = recentDispatches.get(eventCode) || 0;
    if (!force && Date.now() - lastRun < COOLDOWN_MS) {
      return NextResponse.json({
        success: true,
        mode: 'cooldown',
        eventCode,
        message: `Ya hay una actualización reciente para ${eventCode}; esperando resultados.`,
      });
    }

    // 1. Ejecución directa en servidor local / self-hosted si existe .venv y script Python
    const isVercel = process.env.VERCEL === '1';
    const scriptPath = path.resolve(process.cwd(), 'timestone_ftc_2026_2027_v1.py');
    const venvPython = path.resolve(process.cwd(), '.venv', 'bin', 'python');
    const hasLocalPython = !isVercel && fs.existsSync(scriptPath) && fs.existsSync(venvPython);

    if (hasLocalPython) {
      recentDispatches.set(eventCode, Date.now());
      const args = [scriptPath, '--event', eventCode, '--season', String(season)];
      if (ftcscoutCode) {
        args.push('--ftcscout-code', ftcscoutCode);
      }

      const { stdout, stderr } = await execFileAsync(venvPython, args, {
        cwd: process.cwd(),
        timeout: 60_000,
        env: process.env,
      });

      return NextResponse.json({
        success: true,
        mode: 'local-python',
        eventCode,
        message: `Simulación Timestone (${eventCode}) ejecutada y subida a Google Sheets.`,
        logTail: (stdout || stderr || '').slice(-400),
      });
    }

    // 2. Producción en Vercel: disparar GitHub Actions workflow_dispatch
    const githubToken = (process.env.GITHUB_TOKEN || '').trim();
    const githubRepo = (process.env.GITHUB_REPO || 'Mrmyms/Naunarok-Analytics').trim();
    const workflowFile = (process.env.GITHUB_WORKFLOW_FILE || 'timestone-refresh.yml').trim();
    const gitRef = (process.env.GITHUB_REF || 'main').trim();

    if (!githubToken) {
      return NextResponse.json(
        {
          success: false,
          code: 'REFRESH_NOT_CONFIGURED',
          eventCode,
          error:
            'Falta GITHUB_TOKEN en Vercel para disparar GitHub Actions (o ejecuta en local con .venv Python / Google Colab).',
        },
        { status: 501 }
      );
    }

    recentDispatches.set(eventCode, Date.now());

    const dispatchRes = await fetch(
      `https://api.github.com/repos/${githubRepo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          ref: gitRef,
          inputs: {
            event_code: eventCode,
            ftcscout_code: ftcscoutCode,
            season: String(season),
          },
        }),
        cache: 'no-store',
      }
    );

    if (!dispatchRes.ok) {
      const errText = await dispatchRes.text().catch(() => '');
      recentDispatches.delete(eventCode);
      return NextResponse.json(
        {
          success: false,
          eventCode,
          error: `GitHub Actions respondió ${dispatchRes.status}: ${errText.slice(0, 200)}`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      mode: 'github-actions',
      eventCode,
      message: `Timestone (${eventCode}) lanzado en GitHub Actions; sincronizando en ~30–60s.`,
    });
  } catch (error: any) {
    console.error('Error en /api/timestone/refresh:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Error ejecutando actualización de Timestone',
      },
      { status: 500 }
    );
  }
}

