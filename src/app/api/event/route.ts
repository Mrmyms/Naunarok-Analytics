import { NextResponse } from 'next/server';

const FTCSCOUT_GRAPHQL_URL = 'https://api.ftcscout.org/graphql';

type FTCScoutEventSummary = {
  code: string;
  name: string;
  regionCode: string;
  start: string;
  hasMatches: boolean;
};

const SEARCH_EVENTS_QUERY = `
  query SearchEvents($season: Int!, $searchText: String, $region: RegionOption, $limit: Int) {
    eventsSearch(season: $season, searchText: $searchText, region: $region, limit: $limit) {
      code
      name
      regionCode
      start
      hasMatches
    }
  }
`;

const EVENT_SUMMARY_BY_CODE_QUERY = `
  query EventSummary($season: Int!, $code: String!) {
    eventByCode(season: $season, code: $code) {
      code
      name
      regionCode
      start
      hasMatches
    }
  }
`;

const EVENT_BY_CODE_QUERY = `
  query EventMatches($season: Int!, $code: String!) {
    eventByCode(season: $season, code: $code) {
      code
      name
      season
      regionCode
      start
      timezone
      hasMatches
      teams {
        teamNumber
        team {
          name
        }
      }
      matches {
        id
        matchNum
        series
        tournamentLevel
        hasBeenPlayed
        scheduledStartTime
        actualStartTime
        description
        teams {
          teamNumber
          alliance
          station
          surrogate
        }
        scores {
          ... on MatchScores2026 {
            red {
              totalPoints
              totalPointsNp
            }
            blue {
              totalPoints
              totalPointsNp
            }
          }
          ... on MatchScores2025 {
            red {
              totalPoints
              totalPointsNp
            }
            blue {
              totalPoints
              totalPointsNp
            }
          }
        }
      }
    }
  }
`;

function normalizeText(str: string): string {
  return str
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

async function queryFTCScout(query: string, variables: Record<string, unknown>) {
  const res = await fetch(FTCSCOUT_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al consultar FTCScout`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message || 'Error en FTCScout');
  return json.data;
}

async function safeEventSummaryByCode(
  season: number,
  code: string
): Promise<FTCScoutEventSummary | null> {
  try {
    const data = await queryFTCScout(EVENT_SUMMARY_BY_CODE_QUERY, { season, code });
    return data?.eventByCode || null;
  } catch {
    return null;
  }
}

function dedupeEvents(list: FTCScoutEventSummary[]): FTCScoutEventSummary[] {
  const seen = new Set<string>();
  const result: FTCScoutEventSummary[] = [];
  for (const ev of list) {
    if (!ev?.code || seen.has(ev.code)) continue;
    seen.add(ev.code);
    result.push(ev);
  }
  return result;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'matches';
    const season = parseInt(searchParams.get('season') || '2026', 10);

    if (action === 'search') {
      const q = (searchParams.get('q') || '').trim();
      const rawRegion = (searchParams.get('region') || '').trim().toUpperCase();
      const region = rawRegion && rawRegion !== 'ALL' ? rawRegion : '';
      const looksLikeCode = /^[A-Za-z0-9_-]{3,16}$/.test(q);
      const qNorm = normalizeText(q);

      if (region) {
        const [regionData, exactEvent] = await Promise.all([
          queryFTCScout(SEARCH_EVENTS_QUERY, {
            season,
            searchText: null,
            region,
            limit: 50,
          }),
          looksLikeCode ? safeEventSummaryByCode(season, q.toUpperCase()) : Promise.resolve(null),
        ]);

        const regionEvents: FTCScoutEventSummary[] = (regionData?.eventsSearch || [])
          .slice()
          .sort((a: FTCScoutEventSummary, b: FTCScoutEventSummary) =>
            String(a.start || '').localeCompare(String(b.start || ''))
          );

        const filtered = qNorm
          ? regionEvents.filter((ev) => {
              const haystack = normalizeText(`${ev.code} ${ev.name} ${ev.regionCode}`);
              return haystack.includes(qNorm);
            })
          : regionEvents;

        return NextResponse.json({
          success: true,
          events: dedupeEvents([...(exactEvent ? [exactEvent] : []), ...filtered]),
        });
      }

      const [globalData, exactEvent, mxData] = await Promise.all([
        queryFTCScout(SEARCH_EVENTS_QUERY, {
          season,
          searchText: q || null,
          region: null,
          limit: 20,
        }),
        looksLikeCode ? safeEventSummaryByCode(season, q.toUpperCase()) : Promise.resolve(null),
        qNorm === 'mexico'
          ? queryFTCScout(SEARCH_EVENTS_QUERY, {
              season,
              searchText: null,
              region: 'MX',
              limit: 50,
            })
          : Promise.resolve(null),
      ]);

      return NextResponse.json({
        success: true,
        events: dedupeEvents([
          ...(exactEvent ? [exactEvent] : []),
          ...(mxData?.eventsSearch || []),
          ...(globalData?.eventsSearch || []),
        ]),
      });
    }

    const code = (searchParams.get('code') || '').trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ success: false, error: 'Falta parámetro code' }, { status: 400 });
    }
    const data = await queryFTCScout(EVENT_BY_CODE_QUERY, { season, code });
    if (!data?.eventByCode) {
      return NextResponse.json({ success: false, error: `Evento ${code} no encontrado` }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      event: {
        code: data.eventByCode.code,
        name: data.eventByCode.name,
        season: data.eventByCode.season,
        timezone: data.eventByCode.timezone || null,
        hasMatches: Boolean(data.eventByCode.hasMatches),
      },
      teams: (data.eventByCode.teams || [])
        .map((t: any) => ({
          teamNumber: Number(t.teamNumber) || 0,
          name: String(t.team?.name || `Equipo ${t.teamNumber}`).trim(),
        }))
        .filter((t: any) => t.teamNumber > 0),
      matches: data.eventByCode.matches || [],
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Error FTCScout' }, { status: 500 });
  }
}
