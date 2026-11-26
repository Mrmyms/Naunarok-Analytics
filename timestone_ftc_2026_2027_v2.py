# -*- coding: utf-8 -*-
"""Timestone FTC 2026-2027 — Motor de Scouting, FTCScout y Simulación Monte Carlo.

Motor unificado para el evento FTC 2026-2027 (BIOBUZZ) conectado con Google
Sheets y la API GraphQL de FTCScout. Diseñado para ejecutarse tanto en Google
Colab (modo interactivo) como en CLI local o GitHub Actions para alimentar el
dashboard web **The Beyonder (Naunarok-Analytics)**.

Capacidades principales:
    1. **Carga híbrida**: lee scouting desde Google Sheets (``Captura_BIOBUZZ``
       o pestañas por evento) y obtiene equipos, calendario oficial de Quals y
       marcadores reales ya jugados desde FTCScout (con respaldo automático a
       las pestañas de Sheets).
    2. **Confiabilidad inteligente**: excluye ``"No se presentó"`` del cálculo
       técnico; para fallas/desconexiones (``"Desconectado/Inmóvil"`` o falla
       parcial), excluye incidentes antiguos si ocurrieron fuera de los últimos
       3 matches del equipo y ya encadenó 2+ matches ``"100% Operativo"``
       después, manteniendo el riesgo cuando la falla es reciente.
    3. **Simulación Monte Carlo vectorizada (NumPy)**: calcula ``Win Prob %``,
       ``xRP`` continuos, sinergia colaborativa en Flores y Hive, conflictos de
       posición inicial en Auto y proyección híbrida de Standings (RPs reales
       de matches jugados + simulación de los matches pendientes).
    4. **Mismas 6 pestañas de salida** en Google Sheets, incluyendo ``Updated_At``
       (ISO-8601 UTC) en ``Ranking_EPA_{EVENT}`` y ``Standings_Proy_{EVENT}``
       para control de frescura (> 1 hora) desde Beyonder.

Archivo original de Colab:
    https://colab.research.google.com/drive/1HyVvEBvWl-LFfHVdWUsuWPPjIfNaymWM
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics as std
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

import gspread
import numpy as np
import pandas as pd
from gspread_dataframe import set_with_dataframe


# %%
# ==============================================================================
# CELL 0 — Configuración de Evento, Credenciales y Utilidades de Entorno
# ==============================================================================

EVENT: str = os.environ.get("TIMESTONE_EVENT", "MXTLQ")
FTCSCOUT_CODE: Optional[str] = os.environ.get("TIMESTONE_FTCSCOUT_CODE") or None
FTCSCOUT_SEASON: int = int(os.environ.get("TIMESTONE_SEASON", "2026"))
SHEET_ID: str = os.environ.get(
    "GOOGLE_SHEET_ID",
    "1e6LXPnQFsIYImBLn3JrOv7h2Bo1il3hIHWJLRFJbWTQ",
)
SHEET_NAME: str = os.environ.get("TIMESTONE_SHEET_NAME", "Scouting 2026-2027 FTC")
FORM_URL: str = (
    "https://docs.google.com/forms/d/e/"
    "1FAIpQLSdSqel0wC-oo7GaqSOsYKbZnauOrTuagJ-TMTSmF2suQzPjyw/viewform?usp=header"
)
FTCSCOUT_GRAPHQL_URL: str = "https://api.ftcscout.org/graphql"
DEFAULT_MC_SIMS: int = 2000

GOOGLE_SCOPES: List[str] = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def _is_colab() -> bool:
    """Indica si el script corre dentro de Google Colab."""
    try:
        import google.colab  # noqa: F401
        return True
    except ImportError:
        return False


def _load_local_env_defaults() -> None:
    """Carga variables faltantes desde ``.env.local`` o ``.env`` en ejecución local."""
    for env_file in (".env.local", ".env"):
        path = os.path.join(os.getcwd(), env_file)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for raw_line in fh:
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
        except OSError:
            pass


def authenticate_gspread(creds_json_path: Optional[str] = None) -> gspread.Client:
    """Autentica y devuelve un cliente autorizado de ``gspread``.

    Orden de resolución:
        1. Google Colab (autenticación interactiva).
        2. Variables de entorno ``GOOGLE_CLIENT_EMAIL`` + ``GOOGLE_PRIVATE_KEY``.
        3. Archivo Service Account JSON explícito, en ``GOOGLE_APPLICATION_CREDENTIALS``
           o ``nauticode-8b981f1cee2d.json``.
        4. Application Default Credentials (ADC).
    """
    if _is_colab():
        from google.colab import auth
        from google.auth import default

        auth.authenticate_user()
        creds, _ = default()
        return gspread.authorize(creds)

    _load_local_env_defaults()

    client_email = os.environ.get("GOOGLE_CLIENT_EMAIL", "").strip()
    private_key = os.environ.get("GOOGLE_PRIVATE_KEY", "").replace("\\n", "\n").strip()
    if client_email and private_key:
        from google.oauth2.service_account import Credentials

        creds_info = {
            "type": "service_account",
            "client_email": client_email,
            "private_key": private_key,
            "token_uri": "https://oauth2.googleapis.com/token",
        }
        creds = Credentials.from_service_account_info(creds_info, scopes=GOOGLE_SCOPES)
        return gspread.authorize(creds)

    candidate_paths = [
        creds_json_path,
        os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"),
        os.path.join(os.getcwd(), "nauticode-8b981f1cee2d.json"),
        os.path.join(os.getcwd(), "..", "Naunarok", "nauticode-8b981f1cee2d.json"),
    ]
    for path in candidate_paths:
        if path and os.path.isfile(path):
            return gspread.service_account(filename=path)

    from google.auth import default

    creds, _ = default(scopes=GOOGLE_SCOPES)
    return gspread.authorize(creds)


def open_spreadsheet(
    gc: gspread.Client,
    sheet_id: Optional[str] = None,
    sheet_name: Optional[str] = None,
) -> gspread.Spreadsheet:
    """Abre el Spreadsheet por ID (preferido) con respaldo por nombre."""
    resolved_id = (sheet_id or "").strip()
    if resolved_id:
        try:
            return gc.open_by_key(resolved_id)
        except Exception as exc:
            if not sheet_name:
                raise
            print(f"[WARN] No se pudo abrir por SHEET_ID ({exc}); intentando por nombre '{sheet_name}'.")
    if sheet_name:
        return gc.open(sheet_name)
    raise ValueError("Se requiere 'sheet_id' o 'sheet_name' para abrir Google Sheets.")


def display_table(df: Union[pd.DataFrame, Dict[str, Any]], title: Optional[str] = None) -> None:
    """Muestra un DataFrame o diccionario en notebook (Colab/IPython) o consola."""
    if title:
        print(f"\n{title}")
    try:
        from IPython.display import display  # type: ignore

        display(df)
    except Exception:
        if isinstance(df, pd.DataFrame):
            print(df.to_string(index=False))
        else:
            print(df)


# %%
# ==============================================================================
# CELL 1 — Constantes del Juego (BIOBUZZ 2026-2027) y Esquema de Columnas
# ==============================================================================

CAPACIDAD_FLOR: int = 5       # Capacidad física máxima de piezas por Flor
MAX_FLORES_CAMPO: int = 4     # Total de Flores en el perímetro del campo
MAX_FLORES_ALIANZA: int = 2   # Flores operativas habituales por alianza
RECENT_WINDOW: int = 8        # Ventana de ponderación lineal creciente
RECENT_FAILURE_WINDOW: int = 3 # Ventana donde una falla/desconexión se considera reciente
RECOVERY_OPS_REQUIRED: int = 2 # Matches 100% operativos posteriores para perdonar falla antigua

CAPTURA: List[str] = [
    "EVENTO", "MATCH", "EQUIPO", "ALIANZA", "SCOUT", "POS INICIAL",
    "AUTO LEAVE", "AUTO PARK",
    "AUTO HIVE POLEN", "AUTO HIVE NÉCTAR",
    "AUTO FLOR POLEN", "AUTO FLOR NÉCTAR",
    "TELE HIVE POLEN", "TELE HIVE NÉCTAR",
    "TELE FLOR POLEN", "TELE FLOR NÉCTAR",
    "PROPIEDAD FLOR", "BOTTOM NÉCTAR",
    "GARDEN PIEZAS", "DEFENSA GARDEN",
    "ENDGAME PARK", "ESTATUS ROBOT",
    "FALTAS MENORES", "FALTAS GRAVES", "TARJETAS",
    "PILOTO", "NOTAS",
]

SCORES: Dict[str, int] = {
    "AUTO LEAVE": 3,
    "AUTO PARK": 5,
    "TELE PARK": 5,
    "HIVE CELL": 2,
    "HIVE TIP": 20,
    "BOTTOM NECTAR": 5,
    "FLOWER CELL": 2,
    "GARDEN CELL": 1,
    "MINOR FOUL": 5,
    "MAJOR FOUL": 20,
}

RP_THRESHOLDS: Dict[str, int] = {
    "SWARM_POINTS": 16,
    "POLLINATOR_1": 4,
    "POLLINATOR_2": 7,
}

RP: Dict[str, int] = {
    "WIN RP": 3,
    "TIE RP": 1,
    "SWARM RP": 1,
    "POLLINATOR 1 RP": 1,
    "POLLINATOR 2 RP": 1,
}

PESO: Dict[str, int] = {
    "POLLEN": 55,
    "NECTAR": 90,
    "TIP": 455,
}

SCOUTING_COLUMN_ALIASES: Dict[str, str] = {
    "EVENTO": "EVENTO",
    "MATCH": "MATCH",
    "MATCH #": "MATCH",
    "EQUIPO": "EQUIPO",
    "EQUIPO #": "EQUIPO",
    "TEAM": "EQUIPO",
    "TEAM ID": "EQUIPO",
    "ALIANZA": "ALIANZA",
    "SCOUT": "SCOUT",
    "SCOUTER": "SCOUT",
    "POS INICIAL": "POS INICIAL",
    "POSICIÓN INICIAL": "POS INICIAL",
    "POSICION INICIAL": "POS INICIAL",
    "POSICIÓN INICIO": "POS INICIAL",
    "POSICION INICIO": "POS INICIAL",
    "AUTO LEAVE": "AUTO LEAVE",
    "AUTO PARK": "AUTO PARK",
    "AUTO HIVE POLEN": "AUTO HIVE POLEN",
    "AUTO HIVE POLLEN": "AUTO HIVE POLEN",
    "AUTO BALANCÍN POLEN": "AUTO HIVE POLEN",
    "AUTO BALANCIN POLEN": "AUTO HIVE POLEN",
    "AUTO HIVE NÉCTAR": "AUTO HIVE NÉCTAR",
    "AUTO HIVE NECTAR": "AUTO HIVE NÉCTAR",
    "AUTO BALANCÍN NÉCTAR": "AUTO HIVE NÉCTAR",
    "AUTO BALANCIN NECTAR": "AUTO HIVE NÉCTAR",
    "AUTO FLOR POLEN": "AUTO FLOR POLEN",
    "AUTO FLOR POLLEN": "AUTO FLOR POLEN",
    "AUTO FLOR NÉCTAR": "AUTO FLOR NÉCTAR",
    "AUTO FLOR NECTAR": "AUTO FLOR NÉCTAR",
    "TELE HIVE POLEN": "TELE HIVE POLEN",
    "TELE HIVE POLLEN": "TELE HIVE POLEN",
    "TELEOP BALANCÍN POLEN": "TELE HIVE POLEN",
    "TELEOP BALANCIN POLEN": "TELE HIVE POLEN",
    "TELE HIVE NÉCTAR": "TELE HIVE NÉCTAR",
    "TELE HIVE NECTAR": "TELE HIVE NÉCTAR",
    "TELEOP BALANCÍN NÉCTAR": "TELE HIVE NÉCTAR",
    "TELEOP BALANCIN NECTAR": "TELE HIVE NÉCTAR",
    "TELE FLOR POLEN": "TELE FLOR POLEN",
    "TELE FLOR POLLEN": "TELE FLOR POLEN",
    "TELEOP FLOR POLEN": "TELE FLOR POLEN",
    "TELE FLOR NÉCTAR": "TELE FLOR NÉCTAR",
    "TELE FLOR NECTAR": "TELE FLOR NÉCTAR",
    "TELEOP FLOR NÉCTAR": "TELE FLOR NÉCTAR",
    "TELEOP FLOR NECTAR": "TELE FLOR NÉCTAR",
    "PROPIEDAD FLOR": "PROPIEDAD FLOR",
    "PROPIEDAD FLOR (0-4)": "PROPIEDAD FLOR",
    "BOTTOM NÉCTAR": "BOTTOM NÉCTAR",
    "BOTTOM NECTAR": "BOTTOM NÉCTAR",
    "GARDEN PIEZAS": "GARDEN PIEZAS",
    "DEFENSA GARDEN": "DEFENSA GARDEN",
    "ENDGAME PARK": "ENDGAME PARK",
    "ESTATUS ROBOT": "ESTATUS ROBOT",
    "FALTAS MENORES": "FALTAS MENORES",
    "FALTAS GRAVES": "FALTAS GRAVES",
    "TARJETAS": "TARJETAS",
    "PILOTO": "PILOTO",
    "PILOTO (1-5)": "PILOTO",
    "NOTAS": "NOTAS",
}

TEAM_COLUMN_ALIASES: Dict[str, str] = {
    "TEAM ID": "Team ID",
    "TEAM": "Team ID",
    "EQUIPO": "Team ID",
    "EQUIPO #": "Team ID",
    "NAMES": "Names",
    "NAME": "Names",
    "NOMBRE": "Names",
}

MATCH_COLUMN_ALIASES: Dict[str, str] = {
    "MATCH_CODE": "match_code",
    "MATCH": "match_code",
    "MATCH #": "match_code",
    "TOURNAMENT_LEVEL": "tournament_level",
    "NIVEL": "tournament_level",
    "RED1": "RED1",
    "RED 1": "RED1",
    "RED2": "RED2",
    "RED 2": "RED2",
    "BLUE1": "BLUE1",
    "BLUE 1": "BLUE1",
    "BLUE2": "BLUE2",
    "BLUE 2": "BLUE2",
}

LEGACY_GRID_TO_POS: Dict[str, str] = {
    "C1": "A", "A1": "B", "A2": "C", "A6": "D", "C6": "E",
    "D6": "A", "F6": "B", "F5": "C", "F1": "D", "D1": "E",
}

TRUE_VALUES = {"SI", "SÍ", "YES", "1", "TRUE"}


# %%
# ==============================================================================
# CELL 2 — Funciones Matemáticas, Normalización y Auxiliares
# ==============================================================================


# Esta es por si algun dato esta vacio y asi no se corrompa nada
def to_numeric_safe(value: Any, default: float = 0.0) -> float:
    """Convierte cualquier celda (``""``, ``None``, ``NaN``, texto) a ``float`` seguro."""
    if value is None or isinstance(value, (bool, np.bool_)):
        return default
    if isinstance(value, (int, float, np.number)):
        return default if np.isnan(value) or np.isinf(value) else float(value)
    text = str(value).strip()
    if not text:
        return default
    parsed = pd.to_numeric(text, errors="coerce")
    return default if pd.isna(parsed) else float(parsed)


def to_bool_flag(value: Any) -> bool:
    """Interpreta respuestas booleanas heterogéneas (``SI``, ``SÍ``, ``1``, ``True``)."""
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, float, np.number)) and not pd.isna(value):
        return float(value) == 1.0
    return str(value or "").strip().upper() in TRUE_VALUES


def parse_flower_ownership(value: Any) -> int:
    """Normaliza ``PROPIEDAD FLOR`` a un entero en el rango ``[0, MAX_FLORES_CAMPO]``."""
    if isinstance(value, (int, float, np.number)) and not pd.isna(value):
        return max(0, min(MAX_FLORES_CAMPO, int(round(float(value)))))

    text = str(value or "").strip().upper()
    if not text or text in {"0", "NO", "NINGUNA", "PERDIÓ CONTROL", "PERDIO CONTROL", "NO COMPITIÓ", "NO COMPITIO"}:
        return 0
    if text in {"SI", "SÍ", "YES", "TRUE", "CONTROLÓ FLOR", "CONTROLO FLOR"}:
        return 1

    match = re.match(r"^(\d+)", text)
    if match:
        return max(0, min(MAX_FLORES_CAMPO, int(match.group(1))))
    return 0


def normalise_start_pos(raw: Any) -> str:
    """Normaliza una posición inicial hacia ``'A'``..``'E'`` o ``'NONE'``."""
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return "NONE"
    text = str(raw).strip().upper()
    if not text or text in {"0", "NONE", "SIN POS.", "SIN POS", "N/A"}:
        return "NONE"

    if text in {"A", "B", "C", "D", "E"}:
        return text

    grid_match = re.match(r"^([A-F][1-6])\b", text)
    if grid_match and grid_match.group(1) in LEGACY_GRID_TO_POS:
        return LEGACY_GRID_TO_POS[grid_match.group(1)]

    zone_match = re.match(r"^(?:(?:ZONA|POS(?:ICI[OÓ]N)?)\s*)?([A-E])(?:\b|[\s\-:(])", text)
    if zone_match:
        return zone_match.group(1)

    return "NONE"


def normalise_match_id(raw: Any) -> Optional[int]:
    """Normaliza identificadores de match (``'Q-3'``, ``'03'``, ``3.0``, ``3``) a ``int``."""
    if raw is None:
        return None
    if isinstance(raw, (int, np.integer)):
        return int(raw)
    if isinstance(raw, (float, np.floating)):
        return None if np.isnan(raw) or np.isinf(raw) else int(round(float(raw)))

    text = str(raw).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None

    try:
        numeric = float(text)
        if np.isfinite(numeric):
            return int(round(numeric))
    except ValueError:
        pass

    match = re.search(r"(\d+)(?:\.0+)?$", text)
    return int(match.group(1)) if match else None


def classify_robot_status(status_raw: Any) -> str:
    """Clasifica el estatus reportado en ``'OPERATIONAL'``, ``'FAILURE'`` o ``'NO_SHOW'``."""
    text = str(status_raw or "").strip().upper()
    if not text:
        return "OPERATIONAL"
    if any(tok in text for tok in ("NO SE PRESENT", "NO PRESENT", "NO SHOW", "DID NOT SHOW")):
        return "NO_SHOW"
    if any(tok in text for tok in ("DESCONECT", "INMOVIL", "INMÓVIL", "FALLA", "ROTO", "BROKEN", "DISCONNECT")):
        return "FAILURE"
    return "OPERATIONAL"


def temporal_weight(series: Iterable[Any], window: int = RECENT_WINDOW) -> List[Any]:
    """Aplica ponderación lineal creciente (1..k) a los últimos ``window`` elementos."""
    pts = list(series)
    recent = pts[-window:] if window > 0 else pts
    weighted: List[Any] = []
    for idx, val in enumerate(recent):
        weighted.extend([val] * (idx + 1))
    return weighted


def weighted_stats(series: Iterable[float], window: int = RECENT_WINDOW) -> Tuple[float, float, float]:
    """Calcula ``(media, desviacion_estandar, varianza)`` con ponderación temporal."""
    weighted = temporal_weight(series, window=window)
    if not weighted:
        return 0.0, 0.0, 0.0
    arr = np.asarray(weighted, dtype=float)
    return float(np.mean(arr)), float(np.std(arr)), float(np.var(arr))


def safe_mode(data_list: Iterable[Any], default_value: Any = "NO") -> Any:
    """Calcula la moda estadística; ante empates exactos prioriza el valor más reciente."""
    cleaned = [
        item for item in data_list
        if item is not None and not (isinstance(item, float) and np.isnan(item))
    ]
    if not cleaned:
        return default_value
    reversed_cleaned = list(reversed(cleaned))
    try:
        return std.mode(reversed_cleaned)
    except (std.StatisticsError, Exception):
        vals, counts = np.unique(reversed_cleaned, return_counts=True)
        return vals[int(np.argmax(counts))] if len(vals) > 0 else default_value


# %%
# ==============================================================================
# CELL 3 — Carga desde FTCScout GraphQL y Google Sheets
# ==============================================================================

FTCSCOUT_EVENT_QUERY = """
query TimestoneEvent($season: Int!, $code: String!) {
  eventByCode(season: $season, code: $code) {
    code
    name
    season
    teams {
      teamNumber
      team {
        number
        name
      }
      stats {
        ... on TeamEventStats2026 {
          rank
          rp
          tb1
          tb2
          wins
          losses
          ties
          qualMatchesPlayed
          opr {
            totalPoints
          }
        }
      }
    }
    matches {
      id
      matchNum
      series
      tournamentLevel
      hasBeenPlayed
      scheduledStartTime
      teams {
        teamNumber
        alliance
        station
        surrogate
        noShow
        dq
      }
      scores {
        ... on MatchScores2026 {
          red {
            totalPoints
            totalPointsNp
            autoPoints
            dcPoints
            tips
            swarmRp
            pollinator1Rp
            pollinator2Rp
          }
          blue {
            totalPoints
            totalPointsNp
            autoPoints
            dcPoints
            tips
            swarmRp
            pollinator1Rp
            pollinator2Rp
          }
        }
      }
    }
  }
}
"""


def fetch_ftcscout_event(
    event_code: str,
    season: int = FTCSCOUT_SEASON,
    timeout: int = 12,
) -> Optional[Dict[str, Any]]:
    """Consulta equipos, calendario y marcadores oficiales de un evento en FTCScout.

    Devuelve ``None`` ante errores de red o si el código no existe en FTCScout,
    permitiendo respaldo limpio contra las pestañas de Google Sheets.
    """
    code = (event_code or "").strip().upper()
    if not code:
        return None

    payload = json.dumps({
        "query": FTCSCOUT_EVENT_QUERY,
        "variables": {"season": int(season), "code": code},
    }).encode("utf-8")

    req = urllib.request.Request(
        FTCSCOUT_GRAPHQL_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Timestone-Beyonder/2.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"[WARN] FTCScout no disponible para '{code}' ({exc}); usando respaldo de Sheets.")
        return None

    if body.get("errors"):
        msg = body["errors"][0].get("message", "Error GraphQL")
        print(f"[WARN] FTCScout respondió error para '{code}': {msg}")
        return None

    event_data = (body.get("data") or {}).get("eventByCode")
    if not event_data:
        print(f"[INFO] Evento '{code}' (temporada {season}) no encontrado en FTCScout; usando Sheets.")
        return None

    return event_data


def _parse_ftcscout_teams(event_data: Dict[str, Any]) -> pd.DataFrame:
    """Convierte ``eventByCode.teams`` de FTCScout en DataFrame de equipos."""
    rows: List[Dict[str, Any]] = []
    for entry in event_data.get("teams") or []:
        team_info = entry.get("team") or {}
        tid = int(to_numeric_safe(entry.get("teamNumber") or team_info.get("number"), 0))
        if tid <= 0:
            continue
        name = str(team_info.get("name") or f"Equipo {tid}").strip() or f"Equipo {tid}"
        rows.append({"Team ID": tid, "Names": name})
    if not rows:
        return pd.DataFrame(columns=["Team ID", "Names"])
    return pd.DataFrame(rows).drop_duplicates(subset=["Team ID"]).reset_index(drop=True)


def _calc_official_rp(score_block: Optional[Dict[str, Any]], opp_block: Optional[Dict[str, Any]]) -> Optional[int]:
    """Calcula los Ranking Points oficiales FTC 2026-2027 de una alianza en un match jugado."""
    if not score_block or not opp_block:
        return None
    own_pts = int(to_numeric_safe(score_block.get("totalPoints"), 0))
    opp_pts = int(to_numeric_safe(opp_block.get("totalPoints"), 0))
    if own_pts > opp_pts:
        win_rp = RP["WIN RP"]
    elif own_pts == opp_pts:
        win_rp = RP["TIE RP"]
    else:
        win_rp = 0

    bonus = (
        (RP["SWARM RP"] if score_block.get("swarmRp") else 0)
        + (RP["POLLINATOR 1 RP"] if score_block.get("pollinator1Rp") else 0)
        + (RP["POLLINATOR 2 RP"] if score_block.get("pollinator2Rp") else 0)
    )
    return win_rp + bonus


def _parse_ftcscout_matches(event_data: Dict[str, Any]) -> pd.DataFrame:
    """Convierte ``eventByCode.matches`` en DataFrame normalizado con resultados reales."""
    rows: List[Dict[str, Any]] = []
    for m in event_data.get("matches") or []:
        level = str(m.get("tournamentLevel") or "Quals").strip()
        m_num = normalise_match_id(m.get("matchNum"))
        if m_num is None:
            continue

        series = int(to_numeric_safe(m.get("series"), 0))
        if level.upper() != "QUALS" and series > 0:
            match_code = series if m_num == 1 else series * 100 + m_num
        else:
            match_code = m_num

        slots: Dict[str, int] = {"RED1": 0, "RED2": 0, "BLUE1": 0, "BLUE2": 0}
        surrogates: Dict[str, bool] = {
            "red1_surrogate": False,
            "red2_surrogate": False,
            "blue1_surrogate": False,
            "blue2_surrogate": False,
        }

        red_members: List[Tuple[int, str, bool]] = []
        blue_members: List[Tuple[int, str, bool]] = []
        station_order = {"ONE": 1, "TWO": 2, "THREE": 3}

        for tp in m.get("teams") or []:
            alliance = str(tp.get("alliance") or "").strip().upper()
            station = str(tp.get("station") or "").strip().upper()
            tid = int(to_numeric_safe(tp.get("teamNumber"), 0))
            if tid <= 0:
                continue
            is_surr = bool(tp.get("surrogate"))
            if alliance == "RED":
                red_members.append((station_order.get(station, 9), station, is_surr, tid))  # type: ignore[arg-type]
            elif alliance == "BLUE":
                blue_members.append((station_order.get(station, 9), station, is_surr, tid))  # type: ignore[arg-type]

        red_members.sort(key=lambda item: item[0])
        blue_members.sort(key=lambda item: item[0])

        if len(red_members) >= 1:
            slots["RED1"], surrogates["red1_surrogate"] = red_members[0][3], red_members[0][2]  # type: ignore[index]
        if len(red_members) >= 2:
            slots["RED2"], surrogates["red2_surrogate"] = red_members[1][3], red_members[1][2]  # type: ignore[index]
        if len(blue_members) >= 1:
            slots["BLUE1"], surrogates["blue1_surrogate"] = blue_members[0][3], blue_members[0][2]  # type: ignore[index]
        if len(blue_members) >= 2:
            slots["BLUE2"], surrogates["blue2_surrogate"] = blue_members[1][3], blue_members[1][2]  # type: ignore[index]

        scores = m.get("scores") or {}
        red_s = scores.get("red")
        blue_s = scores.get("blue")
        played = bool(m.get("hasBeenPlayed")) and red_s is not None and blue_s is not None

        rows.append({
            "match_code": match_code,
            "tournament_level": level,
            "has_been_played": played,
            **slots,
            **surrogates,
            "actual_red_score": int(to_numeric_safe(red_s.get("totalPoints"), 0)) if played else np.nan,
            "actual_blue_score": int(to_numeric_safe(blue_s.get("totalPoints"), 0)) if played else np.nan,
            "actual_red_np": int(to_numeric_safe(red_s.get("totalPointsNp"), 0)) if played else np.nan,
            "actual_blue_np": int(to_numeric_safe(blue_s.get("totalPointsNp"), 0)) if played else np.nan,
            "actual_red_rp": _calc_official_rp(red_s, blue_s) if played else np.nan,
            "actual_blue_rp": _calc_official_rp(blue_s, red_s) if played else np.nan,
            "actual_red_tips": int(to_numeric_safe(red_s.get("tips"), 0)) if played else np.nan,
            "actual_blue_tips": int(to_numeric_safe(blue_s.get("tips"), 0)) if played else np.nan,
        })

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    level_order = {"QUALS": 0, "SEMIS": 1, "DOUBLEELIM": 2, "FINALS": 3}
    df["_lvl_order"] = df["tournament_level"].str.upper().map(level_order).fillna(9)
    df = df.sort_values(["_lvl_order", "match_code"]).drop(columns=["_lvl_order"]).reset_index(drop=True)
    return df


def _rename_with_aliases(df: pd.DataFrame, aliases: Dict[str, str]) -> pd.DataFrame:
    """Renombra columnas aplicando ``aliases`` sin sensibilidad a mayúsculas ni colisiones."""
    canonical_targets = set(aliases.values())
    rename_map: Dict[str, str] = {}
    seen_targets = set()

    for col in df.columns:
        clean_col = str(col).strip()
        if clean_col in canonical_targets and clean_col not in seen_targets:
            rename_map[col] = clean_col
            seen_targets.add(clean_col)

    for col in df.columns:
        if col in rename_map:
            continue
        clean_col = str(col).strip()
        target = aliases.get(clean_col.upper())
        if target and target not in seen_targets:
            rename_map[col] = target
            seen_targets.add(target)
        elif clean_col in seen_targets:
            rename_map[col] = f"{clean_col}__dup"
        else:
            rename_map[col] = clean_col
            seen_targets.add(clean_col)

    return df.rename(columns=rename_map)


def _read_worksheet_df(spreadsheet: gspread.Spreadsheet, title: str) -> pd.DataFrame:
    """Lee una pestaña de Google Sheets a ``DataFrame`` limpiando encabezados."""
    ws = spreadsheet.worksheet(title)
    df = pd.DataFrame(ws.get_all_records())
    if not df.empty:
        df.columns = [str(c).strip() for c in df.columns]
    return df


def _filter_by_event(df: pd.DataFrame, event_code: str) -> pd.DataFrame:
    """Filtra por columna ``EVENTO`` cuando existe y contiene valores no vacíos."""
    if df.empty or "EVENTO" not in df.columns:
        return df
    non_empty = df["EVENTO"].astype(str).str.strip().ne("")
    if not non_empty.any():
        return df
    mask = df["EVENTO"].astype(str).str.strip().str.upper() == event_code.strip().upper()
    return df.loc[mask].reset_index(drop=True)


def _ensure_match_defaults(matches_df: pd.DataFrame) -> pd.DataFrame:
    """Garantiza columnas estándar en ``matches_df`` provenga de FTCScout o Sheets."""
    if matches_df.empty:
        return pd.DataFrame(
            columns=[
                "match_code", "tournament_level", "has_been_played",
                "RED1", "RED2", "BLUE1", "BLUE2",
                "red1_surrogate", "red2_surrogate", "blue1_surrogate", "blue2_surrogate",
                "actual_red_score", "actual_blue_score",
                "actual_red_np", "actual_blue_np",
                "actual_red_rp", "actual_blue_rp",
                "actual_red_tips", "actual_blue_tips",
            ]
        )

    df = matches_df.copy()
    if "tournament_level" not in df.columns:
        df["tournament_level"] = "Quals"
    if "has_been_played" not in df.columns:
        df["has_been_played"] = False

    for slot in ("RED1", "RED2", "BLUE1", "BLUE2"):
        df[slot] = df[slot].apply(lambda v: int(to_numeric_safe(v, 0))) if slot in df.columns else 0

    for surr in ("red1_surrogate", "red2_surrogate", "blue1_surrogate", "blue2_surrogate"):
        if surr not in df.columns:
            df[surr] = False

    for metric in (
        "actual_red_score", "actual_blue_score",
        "actual_red_np", "actual_blue_np",
        "actual_red_rp", "actual_blue_rp",
        "actual_red_tips", "actual_blue_tips",
    ):
        if metric not in df.columns:
            df[metric] = np.nan

    return df


def load_event_data(
    spreadsheet: gspread.Spreadsheet,
    event_code: str,
    ftcscout_code: Optional[str] = None,
    season: int = FTCSCOUT_SEASON,
    use_ftcscout: bool = True,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Carga y normaliza ``scouting_df``, ``teams_names_df`` y ``matches_df``.

    Combina registros de scouting desde Google Sheets con equipos, calendario
    y marcadores oficiales de FTCScout (si están disponibles), con respaldo
    completo hacia las pestañas locales de Sheets.
    """
    sheet_titles = [ws.title for ws in spreadsheet.worksheets()]

    # ── 1. CARGA DE SCOUTING DESDE SHEETS ──────────────────────────────────────
    scouting_candidates = [
        f"Scouting_{event_code}",
        f"Captura_{event_code}",
        "Captura_BIOBUZZ",
    ]
    scouting_tab = next((t for t in scouting_candidates if t in sheet_titles), sheet_titles[0])
    scouting_df = _read_worksheet_df(spreadsheet, scouting_tab)

    if not scouting_df.empty:
        scouting_df = _rename_with_aliases(scouting_df, SCOUTING_COLUMN_ALIASES)
        scouting_df = _filter_by_event(scouting_df, event_code)

        if "EQUIPO" in scouting_df.columns:
            scouting_df["EQUIPO"] = scouting_df["EQUIPO"].apply(lambda v: int(to_numeric_safe(v, 0)))
            scouting_df = scouting_df[scouting_df["EQUIPO"] > 0].reset_index(drop=True)

        if "MATCH" in scouting_df.columns:
            scouting_df["MATCH"] = scouting_df["MATCH"].apply(normalise_match_id)
            scouting_df = scouting_df.dropna(subset=["MATCH"]).copy()
            scouting_df["MATCH"] = scouting_df["MATCH"].astype(int)
            scouting_df["_row_order"] = np.arange(len(scouting_df))
            scouting_df = scouting_df.sort_values(["MATCH", "_row_order"], kind="mergesort")

            if "EQUIPO" in scouting_df.columns:
                dup_count = int(scouting_df.duplicated(subset=["MATCH", "EQUIPO"], keep="last").sum())
                if dup_count > 0:
                    print(f"[WARN] [{event_code}] {dup_count} registros duplicados (MATCH, EQUIPO); se conservó el más reciente.")
                scouting_df = scouting_df.drop_duplicates(subset=["MATCH", "EQUIPO"], keep="last")

            scouting_df = scouting_df.drop(columns=["_row_order"]).reset_index(drop=True)
    else:
        print(f"[WARN] La pestaña '{scouting_tab}' está vacía.")

    # ── 2. CONSULTA OPCIONAL A FTCSCOUT ────────────────────────────────────────
    ftc_data: Optional[Dict[str, Any]] = None
    if use_ftcscout:
        lookup_code = (ftcscout_code or event_code).strip().upper()
        ftc_data = fetch_ftcscout_event(lookup_code, season=season)
    ftc_found = ftc_data is not None

    # ── 3. CARGA DE EQUIPOS (SHEETS + FTCSCOUT + SCOUTING) ─────────────────────
    ftc_teams_df = _parse_ftcscout_teams(ftc_data) if ftc_data else pd.DataFrame(columns=["Team ID", "Names"])
    team_tab_candidates = (
        (f"Equipos_{event_code}",)
        if ftc_found and not ftc_teams_df.empty
        else (f"Equipos_{event_code}", "Equipos")
    )
    teams_tab = next((t for t in team_tab_candidates if t in sheet_titles), None)
    sheet_teams_df = pd.DataFrame(columns=["Team ID", "Names"])
    if teams_tab:
        raw_teams = _read_worksheet_df(spreadsheet, teams_tab)
        raw_teams = _rename_with_aliases(raw_teams, TEAM_COLUMN_ALIASES)
        raw_teams = _filter_by_event(raw_teams, event_code)
        if not raw_teams.empty and "Team ID" in raw_teams.columns:
            raw_teams["Team ID"] = raw_teams["Team ID"].apply(lambda v: int(to_numeric_safe(v, 0)))
            raw_teams = raw_teams[raw_teams["Team ID"] > 0].drop_duplicates(subset=["Team ID"])
            if "Names" not in raw_teams.columns:
                raw_teams["Names"] = [f"Equipo {t}" for t in raw_teams["Team ID"]]
            sheet_teams_df = raw_teams[["Team ID", "Names"]].reset_index(drop=True)

    # Priorizar nombres reales de FTCScout o de la pestaña Equipos
    name_lookup: Dict[int, str] = {}
    for _, r in ftc_teams_df.iterrows():
        name_lookup[int(r["Team ID"])] = str(r["Names"]).strip()
    for _, r in sheet_teams_df.iterrows():
        tid = int(r["Team ID"])
        sname = str(r["Names"]).strip()
        if tid not in name_lookup or (sname and not sname.startswith("Equipo ")):
            name_lookup[tid] = sname

    scouting_has_event_col = (
        not scouting_df.empty
        and "EVENTO" in scouting_df.columns
        and scouting_df["EVENTO"].astype(str).str.strip().ne("").any()
    )
    allow_scouting_roster = (
        not ftc_found
        or ftc_teams_df.empty
        or scouting_tab in (f"Scouting_{event_code}", f"Captura_{event_code}")
        or scouting_has_event_col
    )
    if allow_scouting_roster and not scouting_df.empty and "EQUIPO" in scouting_df.columns:
        for tid in scouting_df["EQUIPO"].unique():
            tid_int = int(tid)
            if tid_int > 0 and tid_int not in name_lookup:
                name_lookup[tid_int] = f"Equipo {tid_int}"

    teams_names_df = pd.DataFrame(
        [{"Team ID": tid, "Names": name_lookup[tid]} for tid in sorted(name_lookup)]
    ) if name_lookup else pd.DataFrame(columns=["Team ID", "Names"])

    # ── 4. CARGA DE MATCHES (FTCSCOUT > SHEETS > INFERIDO) ─────────────────────
    ftc_matches_df = _parse_ftcscout_matches(ftc_data) if ftc_data else pd.DataFrame()
    if not ftc_matches_df.empty:
        matches_df = _ensure_match_defaults(ftc_matches_df)
    else:
        match_tab_candidates = (
            (f"Matches_{event_code}",)
            if ftc_found
            else (f"Matches_{event_code}", "Matches")
        )
        matches_tab = next((t for t in match_tab_candidates if t in sheet_titles), None)
        if matches_tab:
            raw_matches = _read_worksheet_df(spreadsheet, matches_tab)
            raw_matches = _rename_with_aliases(raw_matches, MATCH_COLUMN_ALIASES)
            raw_matches = _filter_by_event(raw_matches, event_code)
            if "match_code" in raw_matches.columns:
                raw_matches["match_code"] = raw_matches["match_code"].apply(normalise_match_id)
                raw_matches = raw_matches.dropna(subset=["match_code"]).copy()
                raw_matches["match_code"] = raw_matches["match_code"].astype(int)
                raw_matches = raw_matches.sort_values("match_code").reset_index(drop=True)
            matches_df = _ensure_match_defaults(raw_matches)
        elif ftc_found:
            print(f"[INFO] [{event_code}] Evento encontrado en FTCScout sin matches publicados todavía.")
            matches_df = _ensure_match_defaults(pd.DataFrame())
        else:
            matches_list: List[Dict[str, Any]] = []
            if not scouting_df.empty and {"MATCH", "ALIANZA", "EQUIPO"}.issubset(scouting_df.columns):
                for m_num, group in scouting_df.groupby("MATCH", sort=True):
                    alianza_upper = group["ALIANZA"].astype(str).str.upper()
                    reds = group[alianza_upper.str.contains("ROJ|RED", na=False)]["EQUIPO"].unique().tolist()
                    blues = group[alianza_upper.str.contains("AZU|BLU", na=False)]["EQUIPO"].unique().tolist()
                    matches_list.append({
                        "match_code": int(m_num),
                        "tournament_level": "Quals",
                        "has_been_played": False,
                        "RED1": int(reds[0]) if len(reds) > 0 else 0,
                        "RED2": int(reds[1]) if len(reds) > 1 else 0,
                        "BLUE1": int(blues[0]) if len(blues) > 0 else 0,
                        "BLUE2": int(blues[1]) if len(blues) > 1 else 0,
                    })
            matches_df = _ensure_match_defaults(pd.DataFrame(matches_list))

    return scouting_df, teams_names_df, matches_df


# %%
# ==============================================================================
# CELL 4 — Simulación Individual de Robot y Regla de Confiabilidad
# ==============================================================================

def _empty_robot_profile(event_code: str, team_id: int, team_name: str = "UNKNOWN") -> Dict[str, Any]:
    """Construye la estructura base en ceros para un equipo sin datos o inválido."""
    return {
        "EVENT": event_code,
        "team_id": int(team_id),
        "name": team_name,
        "matches_played": 0,
        "no_show_matches": 0,
        "excluded_old_failures": 0,
        "pos_a": 0,
        "pos_b": 0,
        "pos_c": 0,
        "pos_d": 0,
        "pos_e": 0,
        "pos_type": "NONE",
        "auto_leave": "NO",
        "auto_park": "NO",
        "tele_park": "NO",
        "can_top_nectar": "NO",
        "game_piece_pollen": "NO",
        "game_piece_nectar": "NO",
        "game_piece_flower_pollen": "NO",
        "game_piece_flower_nectar": "NO",
        "game_piece_hive_pollen": "NO",
        "game_piece_hive_nectar": "NO",
        "est_tips": 0.0,
        "est_hive_weight_g": 0.0,
        "swarm_pts_est": 0.0,
        "flores_llenadas_est": 0.0,
        "est_flower_pieces": 0.0,
        "est_tele_flower_pieces": 0.0,
        "fouls_est": 0.0,
        "reliability_pct": 0.0,
        "failure_prob": 0.0,
        "auto_scores": [],
        "tele_scores": [],
        "auto_avg": 0,
        "auto_std": 0,
        "auto_var": 0,
        "tele_avg": 0,
        "tele_std": 0,
        "tele_var": 0,
        "endgame_est": 0,
        "endgame_std": 0,
        "endgame_var": 0,
        "endgame_min": 0,
        "endgame_max": 0,
        "auto_est": 0,
        "auto_min": 0,
        "auto_max": 0,
        "tele_est": 0,
        "tele_min": 0,
        "tele_max": 0,
        "score_est": 0,
        "score_min": 0,
        "score_max": 0,
        "net_score_est": 0.0,
        "epa_operational": 0.0,
        "EPA": 0.0,
        "_mc": {
            "op_auto_mean": 0.0, "op_auto_std": 0.0,
            "op_tele_mean": 0.0, "op_tele_std": 0.0,
            "op_end_mean": 0.0, "op_end_std": 0.0,
            "op_swarm_mean": 0.0, "op_swarm_std": 0.0,
            "op_hive_weight_mean": 0.0, "op_hive_weight_std": 0.0,
            "op_flower_mean": 0.0, "op_flower_std": 0.0,
            "op_tele_flower_mean": 0.0, "op_tele_flower_std": 0.0,
            "op_fouls_mean": 0.0, "op_fouls_std": 0.0,
            "failure_prob": 0.0,
            "fail_auto_mean": 0.0, "fail_tele_mean": 0.0, "fail_end_mean": 0.0,
            "fail_swarm_mean": 0.0, "fail_hive_weight_mean": 0.0,
            "fail_flower_mean": 0.0, "fail_tele_flower_mean": 0.0, "fail_fouls_mean": 0.0,
        },
    }


def _evaluate_match_row(row: pd.Series) -> Dict[str, Any]:
    """Calcula desglose de puntos, piezas, masa en Hive, faltas y estatus de una fila."""
    leave_flag = "SI" if to_bool_flag(row.get("AUTO LEAVE")) else "NO"
    apark_flag = "SI" if to_bool_flag(row.get("AUTO PARK")) else "NO"
    epark_flag = "SI" if to_bool_flag(row.get("ENDGAME PARK")) else "NO"

    leave_pts = SCORES["AUTO LEAVE"] if leave_flag == "SI" else 0
    apark_pts = SCORES["AUTO PARK"] if apark_flag == "SI" else 0
    epark_pts = SCORES["TELE PARK"] if epark_flag == "SI" else 0

    # ── AUTO ───────────────────────────────────────────────────────────────────
    a_hive_p = to_numeric_safe(row.get("AUTO HIVE POLEN"))
    a_hive_n = to_numeric_safe(row.get("AUTO HIVE NÉCTAR"))
    a_flor_p = to_numeric_safe(row.get("AUTO FLOR POLEN"))
    a_flor_n = to_numeric_safe(row.get("AUTO FLOR NÉCTAR"))

    a_weight = (a_hive_p * PESO["POLLEN"]) + (a_hive_n * PESO["NECTAR"])
    a_tips = int(a_weight // PESO["TIP"])

    a_pts = (
        leave_pts
        + apark_pts
        + (a_tips * SCORES["HIVE TIP"])
        + ((a_hive_p + a_hive_n) * SCORES["HIVE CELL"])
        + ((a_flor_p + a_flor_n) * SCORES["FLOWER CELL"])
    )

    # ── TELEOP ─────────────────────────────────────────────────────────────────
    t_hive_p = to_numeric_safe(row.get("TELE HIVE POLEN"))
    t_hive_n = to_numeric_safe(row.get("TELE HIVE NÉCTAR"))
    t_flor_p = to_numeric_safe(row.get("TELE FLOR POLEN"))
    t_flor_n = to_numeric_safe(row.get("TELE FLOR NÉCTAR"))
    garden_p = to_numeric_safe(row.get("GARDEN PIEZAS"))
    bot_nect = SCORES["BOTTOM NECTAR"] if to_bool_flag(row.get("BOTTOM NÉCTAR")) else 0

    t_weight = (t_hive_p * PESO["POLLEN"]) + (t_hive_n * PESO["NECTAR"])
    total_weight = a_weight + t_weight
    total_tips = int(total_weight // PESO["TIP"])
    t_tips = max(0, total_tips - a_tips)

    tele_flower_pieces = t_flor_p + t_flor_n
    total_flower_pieces = a_flor_p + a_flor_n + tele_flower_pieces
    tele_flower_pts = tele_flower_pieces * SCORES["FLOWER CELL"]

    flores_propias = parse_flower_ownership(row.get("PROPIEDAD FLOR", 0))
    puede_top_nectar = (a_flor_n + t_flor_n) >= 1 or flores_propias >= 1

    if flores_propias > 0:
        flores_tapadas = float(min(MAX_FLORES_CAMPO, flores_propias))
    elif puede_top_nectar:
        flores_tapadas = min(float(MAX_FLORES_ALIANZA), total_flower_pieces / CAPACIDAD_FLOR)
    else:
        flores_tapadas = 0.0

    t_pts = (
        (t_tips * SCORES["HIVE TIP"])
        + ((t_hive_p + t_hive_n) * SCORES["HIVE CELL"])
        + tele_flower_pts
        + bot_nect
        + (garden_p * SCORES["GARDEN CELL"])
    )

    # ── FALTAS Y ESTATUS ───────────────────────────────────────────────────────
    minor_fouls = to_numeric_safe(row.get("FALTAS MENORES"))
    major_fouls = to_numeric_safe(row.get("FALTAS GRAVES"))
    fouls_pts = (minor_fouls * SCORES["MINOR FOUL"]) + (major_fouls * SCORES["MAJOR FOUL"])

    status_kind = classify_robot_status(row.get("ESTATUS ROBOT", ""))
    start_pos = normalise_start_pos(row.get("POS INICIAL", ""))

    return {
        "leave_flag": leave_flag,
        "apark_flag": apark_flag,
        "epark_flag": epark_flag,
        "start_pos": start_pos,
        "swarm_pts": float(leave_pts + apark_pts + epark_pts),
        "auto_pts": float(a_pts),
        "tele_pts": float(t_pts),
        "end_pts": float(epark_pts),
        "total_tips": float(total_tips),
        "hive_weight_g": float(total_weight),
        "total_flower_pieces": float(total_flower_pieces),
        "tele_flower_pieces": float(tele_flower_pieces),
        "flores_tapadas": float(flores_tapadas),
        "puede_top_nectar": 1.0 if puede_top_nectar else 0.0,
        "fouls_pts": float(fouls_pts),
        "status_kind": status_kind,
        "is_operational": 1.0 if status_kind == "OPERATIONAL" else 0.0,
        "a_hive_p": a_hive_p,
        "a_hive_n": a_hive_n,
        "a_flor_p": a_flor_p,
        "a_flor_n": a_flor_n,
        "t_hive_p": t_hive_p,
        "t_hive_n": t_hive_n,
        "t_flor_p": t_flor_p,
        "t_flor_n": t_flor_n,
    }


def _filter_recovered_failures(
    evaluated: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], int, int]:
    """Aplica la regla de confiabilidad por recencia de fallas.

    - Excluye filas ``NO_SHOW`` (el robot no salió a cancha).
    - Excluye una fila ``FAILURE`` solo si ocurrió fuera de los últimos
      ``RECENT_FAILURE_WINDOW`` (3) matches del equipo **y** tuvo al menos
      ``RECOVERY_OPS_REQUIRED`` (2) matches ``OPERATIONAL`` posteriores.
    """
    no_show_count = sum(1 for m in evaluated if m["status_kind"] == "NO_SHOW")
    played = [m for m in evaluated if m["status_kind"] != "NO_SHOW"]
    n = len(played)
    if n == 0:
        return [], no_show_count, 0

    active: List[Dict[str, Any]] = []
    excluded_old_failures = 0

    for idx, item in enumerate(played):
        if item["status_kind"] == "FAILURE":
            matches_from_end = n - 1 - idx
            ops_after = sum(
                1 for j in range(idx + 1, n)
                if played[j]["status_kind"] == "OPERATIONAL"
            )
            if matches_from_end >= RECENT_FAILURE_WINDOW and ops_after >= RECOVERY_OPS_REQUIRED:
                excluded_old_failures += 1
                continue
        active.append(item)

    return active, no_show_count, excluded_old_failures


def simulate_robot(
    EVENT: str,
    team_id: int,
    scouting_df: pd.DataFrame,
    teams_names_df: pd.DataFrame,
    matches_df: Optional[pd.DataFrame] = None,
) -> Dict[str, Any]:
    """Simula y estima el rendimiento individual de un robot con ponderación temporal."""
    _ = matches_df
    team_int = int(to_numeric_safe(team_id, 0))
    if team_int <= 0:
        return _empty_robot_profile(EVENT, 0, "UNKNOWN")

    team_name = "UNKNOWN"
    if not teams_names_df.empty and {"Team ID", "Names"}.issubset(teams_names_df.columns):
        name_row = teams_names_df.loc[teams_names_df["Team ID"] == team_int, "Names"]
        if not name_row.empty and str(name_row.iloc[0]).strip():
            team_name = str(name_row.iloc[0]).strip()

    robot = _empty_robot_profile(EVENT, team_int, team_name)

    if scouting_df.empty or "EQUIPO" not in scouting_df.columns:
        return robot

    data = scouting_df.loc[scouting_df["EQUIPO"] == team_int].copy()
    if data.empty:
        return robot

    if "MATCH" in data.columns:
        data = data.sort_values("MATCH", kind="mergesort")
    data = data.reset_index(drop=True)

    raw_evaluated = [_evaluate_match_row(row) for _, row in data.iterrows()]
    evaluated, no_show_count, excluded_old = _filter_recovered_failures(raw_evaluated)

    robot["no_show_matches"] = no_show_count
    robot["excluded_old_failures"] = excluded_old
    if not evaluated:
        return robot

    robot["matches_played"] = len(evaluated)

    # ── BANDERAS Y POSICIÓN INICIAL ────────────────────────────────────────────
    robot["auto_leave"] = safe_mode(temporal_weight([m["leave_flag"] for m in evaluated]), "NO")
    robot["auto_park"] = safe_mode(temporal_weight([m["apark_flag"] for m in evaluated]), "NO")
    robot["tele_park"] = safe_mode(temporal_weight([m["epark_flag"] for m in evaluated]), "NO")

    valid_positions = [p for p in temporal_weight([m["start_pos"] for m in evaluated]) if p != "NONE"]
    if valid_positions:
        n_pos = len(valid_positions)
        robot["pos_a"] = round(sum(p == "A" for p in valid_positions) / n_pos * 100)
        robot["pos_b"] = round(sum(p == "B" for p in valid_positions) / n_pos * 100)
        robot["pos_c"] = round(sum(p == "C" for p in valid_positions) / n_pos * 100)
        robot["pos_d"] = round(sum(p == "D" for p in valid_positions) / n_pos * 100)
        robot["pos_e"] = round(sum(p == "E" for p in valid_positions) / n_pos * 100)
        robot["pos_type"] = safe_mode(valid_positions, "NONE")

    # ── BANDERAS DE CAPACIDAD DE PIEZAS ────────────────────────────────────────
    if sum(m["a_flor_p"] + m["t_flor_p"] for m in evaluated) >= 1:
        robot["game_piece_pollen"] = "SI"
        robot["game_piece_flower_pollen"] = "SI"
    if sum(m["a_flor_n"] + m["t_flor_n"] for m in evaluated) >= 1:
        robot["game_piece_nectar"] = "SI"
        robot["game_piece_flower_nectar"] = "SI"
    if sum(m["a_hive_p"] + m["t_hive_p"] for m in evaluated) >= 1:
        robot["game_piece_pollen"] = "SI"
        robot["game_piece_hive_pollen"] = "SI"
    if sum(m["a_hive_n"] + m["t_hive_n"] for m in evaluated) >= 1:
        robot["game_piece_nectar"] = "SI"
        robot["game_piece_hive_nectar"] = "SI"

    top_nectar_rate, _, _ = weighted_stats([m["puede_top_nectar"] for m in evaluated])
    robot["can_top_nectar"] = "SI" if top_nectar_rate >= 0.30 else "NO"

    # ── ESTADÍSTICAS GENERALES CON PONDERACIÓN TEMPORAL ────────────────────────
    match_auto = [m["auto_pts"] for m in evaluated]
    match_tele = [m["tele_pts"] for m in evaluated]
    match_end = [m["end_pts"] for m in evaluated]

    robot["auto_scores"] = [int(round(x)) for x in match_auto]
    robot["tele_scores"] = [int(round(x)) for x in match_tele]

    auto_mean, auto_std, auto_var = weighted_stats(match_auto)
    tele_mean, tele_std, tele_var = weighted_stats(match_tele)
    end_mean, end_std, end_var = weighted_stats(match_end)

    robot["auto_avg"] = round(auto_mean)
    robot["auto_std"] = round(auto_std)
    robot["auto_var"] = round(auto_var)

    robot["tele_avg"] = round(tele_mean)
    robot["tele_std"] = round(tele_std)
    robot["tele_var"] = round(tele_var)

    robot["endgame_est"] = round(end_mean)
    robot["endgame_std"] = round(end_std)
    robot["endgame_var"] = round(end_var)
    robot["endgame_min"] = max(0, round(end_mean - end_std))
    robot["endgame_max"] = round(end_mean + end_std)

    robot["auto_est"] = robot["auto_avg"]
    robot["auto_min"] = max(0, round(auto_mean - auto_std))
    robot["auto_max"] = round(auto_mean + auto_std)

    robot["tele_est"] = robot["tele_avg"]
    robot["tele_min"] = max(0, round(tele_mean - tele_std))
    robot["tele_max"] = round(tele_mean + tele_std)

    tips_mean, _, _ = weighted_stats([m["total_tips"] for m in evaluated])
    hive_w_mean, _, _ = weighted_stats([m["hive_weight_g"] for m in evaluated])
    swarm_mean, _, _ = weighted_stats([m["swarm_pts"] for m in evaluated])
    flores_mean, _, _ = weighted_stats([m["flores_tapadas"] for m in evaluated])
    fl_pieces_mean, _, _ = weighted_stats([m["total_flower_pieces"] for m in evaluated])
    tele_fl_mean, _, _ = weighted_stats([m["tele_flower_pieces"] for m in evaluated])
    fouls_mean, _, _ = weighted_stats([m["fouls_pts"] for m in evaluated])
    op_rate_weighted, _, _ = weighted_stats([m["is_operational"] for m in evaluated])

    robot["est_tips"] = round(tips_mean, 1)
    robot["est_hive_weight_g"] = round(hive_w_mean, 1)
    robot["swarm_pts_est"] = round(swarm_mean, 1)
    robot["flores_llenadas_est"] = round(flores_mean, 2)
    robot["est_flower_pieces"] = round(fl_pieces_mean, 1)
    robot["est_tele_flower_pieces"] = round(tele_fl_mean, 1)
    robot["fouls_est"] = round(fouls_mean, 1)
    robot["reliability_pct"] = round(
        sum(m["is_operational"] for m in evaluated) / len(evaluated) * 100.0, 1
    )
    failure_prob = round(max(0.0, min(1.0, 1.0 - op_rate_weighted)), 4)
    robot["failure_prob"] = failure_prob

    total_mean = auto_mean + tele_mean + end_mean
    total_std = float(np.sqrt(auto_var + tele_var + end_var))

    robot["score_est"] = robot["auto_est"] + robot["tele_est"] + robot["endgame_est"]
    robot["score_min"] = max(0, round(total_mean - total_std))
    robot["score_max"] = round(total_mean + total_std)
    robot["net_score_est"] = round(max(0.0, total_mean - fouls_mean), 1)
    robot["EPA"] = robot["net_score_est"]

    # ── PARÁMETROS MONTE CARLO (DISTRIBUCIÓN OPERATIVA + RIESGO DE FALLA) ──────
    op_rows = [m for m in evaluated if m["status_kind"] == "OPERATIONAL"]
    fail_rows = [m for m in evaluated if m["status_kind"] == "FAILURE"]

    base_op = op_rows if op_rows else evaluated
    op_auto_m, op_auto_s, _ = weighted_stats([m["auto_pts"] for m in base_op])
    op_tele_m, op_tele_s, _ = weighted_stats([m["tele_pts"] for m in base_op])
    op_end_m, op_end_s, _ = weighted_stats([m["end_pts"] for m in base_op])
    op_swarm_m, op_swarm_s, _ = weighted_stats([m["swarm_pts"] for m in base_op])
    op_hive_m, op_hive_s, _ = weighted_stats([m["hive_weight_g"] for m in base_op])
    op_fl_m, op_fl_s, _ = weighted_stats([m["total_flower_pieces"] for m in base_op])
    op_tfl_m, op_tfl_s, _ = weighted_stats([m["tele_flower_pieces"] for m in base_op])
    op_fouls_m, op_fouls_s, _ = weighted_stats([m["fouls_pts"] for m in base_op])

    robot["epa_operational"] = round(max(0.0, (op_auto_m + op_tele_m + op_end_m) - op_fouls_m), 1)

    def _mean_or_zero(rows: List[Dict[str, Any]], key: str) -> float:
        return float(np.mean([r[key] for r in rows])) if rows else 0.0

    robot["_mc"] = {
        "op_auto_mean": op_auto_m, "op_auto_std": op_auto_s,
        "op_tele_mean": op_tele_m, "op_tele_std": op_tele_s,
        "op_end_mean": op_end_m, "op_end_std": op_end_s,
        "op_swarm_mean": op_swarm_m, "op_swarm_std": op_swarm_s,
        "op_hive_weight_mean": op_hive_m, "op_hive_weight_std": op_hive_s,
        "op_flower_mean": op_fl_m, "op_flower_std": op_fl_s,
        "op_tele_flower_mean": op_tfl_m, "op_tele_flower_std": op_tfl_s,
        "op_fouls_mean": op_fouls_m, "op_fouls_std": op_fouls_s,
        "failure_prob": failure_prob,
        "fail_auto_mean": _mean_or_zero(fail_rows, "auto_pts"),
        "fail_tele_mean": _mean_or_zero(fail_rows, "tele_pts"),
        "fail_end_mean": _mean_or_zero(fail_rows, "end_pts"),
        "fail_swarm_mean": _mean_or_zero(fail_rows, "swarm_pts"),
        "fail_hive_weight_mean": _mean_or_zero(fail_rows, "hive_weight_g"),
        "fail_flower_mean": _mean_or_zero(fail_rows, "total_flower_pieces"),
        "fail_tele_flower_mean": _mean_or_zero(fail_rows, "tele_flower_pieces"),
        "fail_fouls_mean": _mean_or_zero(fail_rows, "fouls_pts"),
    }

    return robot


# %%
# ==============================================================================
# CELL 5 — Simulación de Alianzas y Matches (Monte Carlo Vectorizado)
# ==============================================================================

def _resolve_alliance_color(color: Union[int, str]) -> str:
    """Normaliza el identificador de alianza hacia ``'RED'`` o ``'BLUE'``."""
    if isinstance(color, str):
        upper = color.strip().upper()
        return "RED" if upper in {"1", "RED", "ROJO", "ROJA"} else "BLUE"
    return "BLUE" if int(color) == 0 else "RED"


def _get_robot_cached(
    event_code: str,
    team_id: int,
    scouting_df: pd.DataFrame,
    teams_names_df: pd.DataFrame,
    matches_df: Optional[pd.DataFrame],
    robot_cache: Optional[Dict[int, Dict[str, Any]]],
) -> Dict[str, Any]:
    """Obtiene el perfil simulado desde caché o lo calcula una sola vez."""
    tid = int(to_numeric_safe(team_id, 0))
    if robot_cache is not None and tid in robot_cache:
        return robot_cache[tid]
    profile = simulate_robot(event_code, tid, scouting_df, teams_names_df, matches_df)
    if robot_cache is not None and tid > 0:
        robot_cache[tid] = profile
    return profile


def _sample_normal_nonneg(mean: float, std_dev: float, n_sims: int, rng: np.random.Generator) -> np.ndarray:
    """Genera ``n_sims`` muestras normales no negativas."""
    if std_dev <= 0.0 or n_sims <= 0:
        return np.full(n_sims, max(0.0, mean), dtype=float)
    return np.clip(rng.normal(mean, std_dev, size=n_sims), 0.0, None)


def _sample_robot_trials(
    robot: Dict[str, Any],
    n_sims: int,
    rng: np.random.Generator,
) -> Dict[str, np.ndarray]:
    """Genera trayectorias vectorizadas ``(n_sims,)`` incorporando probabilidad de falla."""
    mc = robot.get("_mc") or {}
    fail_prob = float(mc.get("failure_prob", 0.0))
    failed = rng.random(n_sims) < fail_prob if fail_prob > 0.0 else np.zeros(n_sims, dtype=bool)

    def _draw(op_m_key: str, op_s_key: str, fail_key: str) -> np.ndarray:
        arr = _sample_normal_nonneg(float(mc.get(op_m_key, 0.0)), float(mc.get(op_s_key, 0.0)), n_sims, rng)
        if np.any(failed):
            arr[failed] = max(0.0, float(mc.get(fail_key, 0.0)))
        return arr

    return {
        "auto": _draw("op_auto_mean", "op_auto_std", "fail_auto_mean"),
        "tele": _draw("op_tele_mean", "op_tele_std", "fail_tele_mean"),
        "end": _draw("op_end_mean", "op_end_std", "fail_end_mean"),
        "swarm": _draw("op_swarm_mean", "op_swarm_std", "fail_swarm_mean"),
        "hive_weight": _draw("op_hive_weight_mean", "op_hive_weight_std", "fail_hive_weight_mean"),
        "flower": _draw("op_flower_mean", "op_flower_std", "fail_flower_mean"),
        "tele_flower": _draw("op_tele_flower_mean", "op_tele_flower_std", "fail_tele_flower_mean"),
        "fouls": _draw("op_fouls_mean", "op_fouls_std", "fail_fouls_mean"),
    }


def _simulate_alliance_trials(
    r1s: Dict[str, Any],
    r2s: Dict[str, Any],
    n_sims: int,
    rng: np.random.Generator,
) -> Dict[str, np.ndarray]:
    """Simula vectorizadamente ``n_sims`` matches de una alianza con sinergia Hive/Flor."""
    t1 = _sample_robot_trials(r1s, n_sims, rng)
    t2 = _sample_robot_trials(r2s, n_sims, rng)

    auto_arr = t1["auto"] + t2["auto"]
    tele_raw = t1["tele"] + t2["tele"]
    end_arr = t1["end"] + t2["end"]
    swarm_arr = t1["swarm"] + t2["swarm"]
    fouls_arr = t1["fouls"] + t2["fouls"]

    # Sinergia de masa conjunta en Hive (asume optimización en el mismo balancín antes del 2do)
    indiv_tips = np.floor(t1["hive_weight"] / PESO["TIP"]) + np.floor(t2["hive_weight"] / PESO["TIP"])
    combined_tips = np.floor((t1["hive_weight"] + t2["hive_weight"]) / PESO["TIP"])
    extra_tip_pts = np.maximum(0.0, combined_tips - indiv_tips) * SCORES["HIVE TIP"]

    # Sinergia y límite de capacidad en Flores
    can_top = r1s.get("can_top_nectar") == "SI" or r2s.get("can_top_nectar") == "SI"
    total_flower = t1["flower"] + t2["flower"]
    tele_flower = t1["tele_flower"] + t2["tele_flower"]
    max_pieces_alianza = float(MAX_FLORES_ALIANZA * CAPACIDAD_FLOR)

    if can_top:
        excess = np.maximum(0.0, total_flower - max_pieces_alianza)
        excess_tele = np.minimum(tele_flower, excess)
        flor_adj = -(excess_tele * SCORES["FLOWER CELL"])
    else:
        flor_adj = -(tele_flower * SCORES["FLOWER CELL"])

    tele_arr = np.maximum(0.0, tele_raw + extra_tip_pts + flor_adj)
    gross_arr = auto_arr + tele_arr + end_arr

    return {
        "auto": auto_arr,
        "tele": tele_arr,
        "end": end_arr,
        "gross": gross_arr,
        "fouls": fouls_arr,
        "swarm": swarm_arr,
        "tips": combined_tips,
        "swarm_rp": (swarm_arr >= RP_THRESHOLDS["SWARM_POINTS"]).astype(float) * RP["SWARM RP"],
        "poll1_rp": (combined_tips >= RP_THRESHOLDS["POLLINATOR_1"]).astype(float) * RP["POLLINATOR 1 RP"],
        "poll2_rp": (combined_tips >= RP_THRESHOLDS["POLLINATOR_2"]).astype(float) * RP["POLLINATOR 2 RP"],
    }


def simulate_alliance(
    EVENT: str,
    r1: int,
    r2: int,
    color: Union[int, str],
    scouting_df: pd.DataFrame,
    teams_names_df: pd.DataFrame,
    matches_df: Optional[pd.DataFrame] = None,
    robot_cache: Optional[Dict[int, Dict[str, Any]]] = None,
) -> Tuple[Dict[str, Any], Dict[str, Dict[str, Any]]]:
    """Simula el desempeño esperado de una alianza de dos robots."""
    r1s = _get_robot_cached(EVENT, r1, scouting_df, teams_names_df, matches_df, robot_cache)
    r2s = _get_robot_cached(EVENT, r2, scouting_df, teams_names_df, matches_df, robot_cache)
    robots = {"robot1": r1s, "robot2": r2s}

    auto_var_sum = r1s.get("auto_var", 0) + r2s.get("auto_var", 0)
    tele_var_sum = r1s.get("tele_var", 0) + r2s.get("tele_var", 0)
    end_var_sum = r1s.get("endgame_var", 0) + r2s.get("endgame_var", 0)

    auto_std = round(np.sqrt(auto_var_sum))
    tele_std = round(np.sqrt(tele_var_sum))
    end_std = round(np.sqrt(end_var_sum))
    total_std = round(np.sqrt(auto_var_sum + tele_var_sum + end_var_sum))

    auto_est = r1s["auto_avg"] + r2s["auto_avg"]
    tele_est_raw = r1s["tele_avg"] + r2s["tele_avg"]
    end_est = r1s["endgame_est"] + r2s["endgame_est"]

    alliance_can_top_nectar = (
        r1s.get("can_top_nectar") == "SI" or r2s.get("can_top_nectar") == "SI"
    )
    total_flower_pieces = r1s.get("est_flower_pieces", 0.0) + r2s.get("est_flower_pieces", 0.0)
    tele_flower_pieces = r1s.get("est_tele_flower_pieces", 0.0) + r2s.get("est_tele_flower_pieces", 0.0)
    max_pieces_alianza = MAX_FLORES_ALIANZA * CAPACIDAD_FLOR

    if alliance_can_top_nectar:
        alliance_flores_tapadas = round(min(float(MAX_FLORES_ALIANZA), total_flower_pieces / CAPACIDAD_FLOR), 2)
        piezas_excedentes = max(0.0, total_flower_pieces - max_pieces_alianza)
        piezas_excedentes_tele = min(tele_flower_pieces, piezas_excedentes)
        ajuste_flor_pts = -round(piezas_excedentes_tele * SCORES["FLOWER CELL"])
    else:
        alliance_flores_tapadas = 0.0
        ajuste_flor_pts = -round(tele_flower_pieces * SCORES["FLOWER CELL"])

    # Masa acumulada en Hive a nivel de alianza
    combined_hive_weight_g = r1s.get("est_hive_weight_g", 0.0) + r2s.get("est_hive_weight_g", 0.0)
    indiv_tips_sum = r1s.get("est_tips", 0.0) + r2s.get("est_tips", 0.0)
    total_tips_est = round(max(indiv_tips_sum, combined_hive_weight_g / PESO["TIP"]), 1)

    tele_est = max(0, tele_est_raw + ajuste_flor_pts)
    score_est_total = auto_est + tele_est + end_est
    total_swarm_est = round(r1s["swarm_pts_est"] + r2s["swarm_pts_est"], 1)

    auto_conflict = (
        "SI"
        if r1s.get("pos_type", "NONE") != "NONE" and r1s.get("pos_type") == r2s.get("pos_type")
        else "NO"
    )

    score: Dict[str, Any] = {
        "EVENT": EVENT,
        "color": _resolve_alliance_color(color),
        "auto_std": auto_std,
        "tele_std": tele_std,
        "end_std": end_std,
        "auto_est": auto_est,
        "auto_min": max(0, auto_est - auto_std),
        "auto_max": auto_est + auto_std,
        "tele_est": tele_est,
        "tele_min": max(0, tele_est - tele_std),
        "tele_max": tele_est + tele_std,
        "end_est": end_est,
        "end_min": max(0, end_est - end_std),
        "end_max": end_est + end_std,
        "est_tips": total_tips_est,
        "swarm_pts_est": total_swarm_est,
        "fouls_est": round(r1s.get("fouls_est", 0.0) + r2s.get("fouls_est", 0.0), 1),
        "alliance_top_nectar": "SI" if alliance_can_top_nectar else "NO",
        "alliance_flower_pieces": round(total_flower_pieces, 1),
        "alliance_flores_tapadas": alliance_flores_tapadas,
        "auto_conflict": auto_conflict,
        "auto_leave_1": r1s["auto_leave"],
        "auto_leave_2": r2s["auto_leave"],
        "auto_park_1": r1s["auto_park"],
        "auto_park_2": r2s["auto_park"],
        "tele_park_1": r1s["tele_park"],
        "tele_park_2": r2s["tele_park"],
        "score_est_total": score_est_total,
        "score_min_total": max(0, score_est_total - total_std),
        "score_max_total": score_est_total + total_std,
        "SWARM RP": RP["SWARM RP"] if total_swarm_est >= RP_THRESHOLDS["SWARM_POINTS"] else 0,
        "POLLINATOR 1 RP": RP["POLLINATOR 1 RP"] if total_tips_est >= RP_THRESHOLDS["POLLINATOR_1"] else 0,
        "POLLINATOR 2 RP": RP["POLLINATOR 2 RP"] if total_tips_est >= RP_THRESHOLDS["POLLINATOR_2"] else 0,
    }

    return score, robots


def simulate_match_mc(
    EVENT: str,
    red1: int,
    red2: int,
    blue1: int,
    blue2: int,
    scouting_df: pd.DataFrame,
    teams_names_df: pd.DataFrame,
    matches_df: Optional[pd.DataFrame] = None,
    robot_cache: Optional[Dict[int, Dict[str, Any]]] = None,
    n_sims: int = DEFAULT_MC_SIMS,
    rng: Optional[np.random.Generator] = None,
) -> Dict[str, Any]:
    """Ejecuta ``n_sims`` corridas Monte Carlo para un cruce 2v2."""
    generator = rng or np.random.default_rng()
    r1s = _get_robot_cached(EVENT, red1, scouting_df, teams_names_df, matches_df, robot_cache)
    r2s = _get_robot_cached(EVENT, red2, scouting_df, teams_names_df, matches_df, robot_cache)
    b1s = _get_robot_cached(EVENT, blue1, scouting_df, teams_names_df, matches_df, robot_cache)
    b2s = _get_robot_cached(EVENT, blue2, scouting_df, teams_names_df, matches_df, robot_cache)

    red_tr = _simulate_alliance_trials(r1s, r2s, n_sims, generator)
    blue_tr = _simulate_alliance_trials(b1s, b2s, n_sims, generator)

    # En FTC las faltas cometidas suman puntos al marcador del rival
    red_total = np.round(red_tr["gross"] + blue_tr["fouls"])
    blue_total = np.round(blue_tr["gross"] + red_tr["fouls"])

    red_wins = red_total > blue_total
    blue_wins = blue_total > red_total
    ties = red_total == blue_total

    red_win_rp = np.where(red_wins, RP["WIN RP"], np.where(ties, RP["TIE RP"], 0.0))
    blue_win_rp = np.where(blue_wins, RP["WIN RP"], np.where(ties, RP["TIE RP"], 0.0))

    red_rps = red_win_rp + red_tr["swarm_rp"] + red_tr["poll1_rp"] + red_tr["poll2_rp"]
    blue_rps = blue_win_rp + blue_tr["swarm_rp"] + blue_tr["poll1_rp"] + blue_tr["poll2_rp"]

    return {
        "red_win_prob": round(float(np.mean(red_wins)) * 100.0, 1),
        "blue_win_prob": round(float(np.mean(blue_wins)) * 100.0, 1),
        "tie_prob": round(float(np.mean(ties)) * 100.0, 1),
        "red_xrp": round(float(np.mean(red_rps)), 2),
        "blue_xrp": round(float(np.mean(blue_rps)), 2),
        "red_swarm_prob": round(float(np.mean(red_tr["swarm_rp"] > 0)) * 100.0, 1),
        "red_poll1_prob": round(float(np.mean(red_tr["poll1_rp"] > 0)) * 100.0, 1),
        "red_poll2_prob": round(float(np.mean(red_tr["poll2_rp"] > 0)) * 100.0, 1),
        "blue_swarm_prob": round(float(np.mean(blue_tr["swarm_rp"] > 0)) * 100.0, 1),
        "blue_poll1_prob": round(float(np.mean(blue_tr["poll1_rp"] > 0)) * 100.0, 1),
        "blue_poll2_prob": round(float(np.mean(blue_tr["poll2_rp"] > 0)) * 100.0, 1),
        "red_rps_vec": red_rps,
        "blue_rps_vec": blue_rps,
        "red_scores_vec": red_tr["gross"],
        "blue_scores_vec": blue_tr["gross"],
    }


def simulate_match(
    EVENT: str,
    match_num: Any,
    scouting_df: pd.DataFrame,
    teams_names_df: pd.DataFrame,
    matches_df: pd.DataFrame,
    robot_cache: Optional[Dict[int, Dict[str, Any]]] = None,
    tournament_level: Optional[str] = None,
    n_sims: int = DEFAULT_MC_SIMS,
    rng: Optional[np.random.Generator] = None,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """Simula un enfrentamiento completo (Alianza Roja vs Alianza Azul) con Monte Carlo."""
    if matches_df.empty or "match_code" not in matches_df.columns:
        print(f"[WARN] [{EVENT}] simulate_match: matches_df está vacío o sin 'match_code'.")
        return {}, {}

    m_id = normalise_match_id(match_num)
    if m_id is None:
        print(f"[WARN] [{EVENT}] simulate_match: match_num inválido ({match_num!r}).")
        return {}, {}

    mask = matches_df["match_code"] == m_id
    if tournament_level and "tournament_level" in matches_df.columns:
        mask = mask & (matches_df["tournament_level"].astype(str).str.upper() == tournament_level.upper())

    row_df = matches_df.loc[mask]
    if row_df.empty:
        print(f"[WARN] [{EVENT}] simulate_match: match {match_num} no encontrado.")
        return {}, {}

    row = row_df.iloc[0]
    red1 = int(to_numeric_safe(row.get("RED1"), 0))
    red2 = int(to_numeric_safe(row.get("RED2"), 0))
    blue1 = int(to_numeric_safe(row.get("BLUE1"), 0))
    blue2 = int(to_numeric_safe(row.get("BLUE2"), 0))

    red_score, red_robots = simulate_alliance(
        EVENT, red1, red2, 1, scouting_df, teams_names_df, matches_df, robot_cache=robot_cache
    )
    blue_score, blue_robots = simulate_alliance(
        EVENT, blue1, blue2, 0, scouting_df, teams_names_df, matches_df, robot_cache=robot_cache
    )

    mc = simulate_match_mc(
        EVENT, red1, red2, blue1, blue2,
        scouting_df, teams_names_df, matches_df,
        robot_cache=robot_cache, n_sims=n_sims, rng=rng,
    )

    red_score.update({
        "win_prob_pct": mc["red_win_prob"],
        "tie_prob_pct": mc["tie_prob"],
        "xRP": mc["red_xrp"],
        "swarm_rp_prob_pct": mc["red_swarm_prob"],
        "pollinator1_prob_pct": mc["red_poll1_prob"],
        "pollinator2_prob_pct": mc["red_poll2_prob"],
        "_rps_vec": mc["red_rps_vec"],
        "_scores_vec": mc["red_scores_vec"],
    })
    blue_score.update({
        "win_prob_pct": mc["blue_win_prob"],
        "tie_prob_pct": mc["tie_prob"],
        "xRP": mc["blue_xrp"],
        "swarm_rp_prob_pct": mc["blue_swarm_prob"],
        "pollinator1_prob_pct": mc["blue_poll1_prob"],
        "pollinator2_prob_pct": mc["blue_poll2_prob"],
        "_rps_vec": mc["blue_rps_vec"],
        "_scores_vec": mc["blue_scores_vec"],
    })

    robots = {
        "red1": red_robots["robot1"],
        "red2": red_robots["robot2"],
        "blue1": blue_robots["robot1"],
        "blue2": blue_robots["robot2"],
    }
    return {"RED": red_score, "BLUE": blue_score}, robots


# %%
# ==============================================================================
# CELL 6 — Construcción de Tablas Maestras y Standings Híbridos Monte Carlo
# ==============================================================================

def _collect_all_team_ids(
    teams_names_df: pd.DataFrame,
    scouting_df: pd.DataFrame,
    matches_df: pd.DataFrame,
) -> List[int]:
    """Reúne todos los IDs de equipo válidos presentes en equipos, scouting o matches."""
    ids = set()
    if not teams_names_df.empty and "Team ID" in teams_names_df.columns:
        ids.update(int(to_numeric_safe(t, 0)) for t in teams_names_df["Team ID"])
    if not scouting_df.empty and "EQUIPO" in scouting_df.columns:
        ids.update(int(to_numeric_safe(t, 0)) for t in scouting_df["EQUIPO"])
    if not matches_df.empty:
        for slot in ("RED1", "RED2", "BLUE1", "BLUE2"):
            if slot in matches_df.columns:
                ids.update(int(to_numeric_safe(t, 0)) for t in matches_df[slot])
    return sorted(t for t in ids if t > 0)


def _strip_private_keys(record: Dict[str, Any]) -> Dict[str, Any]:
    """Elimina claves internas (prefijo ``_``) antes de exportar a DataFrame."""
    return {k: v for k, v in record.items() if not str(k).startswith("_")}


def compute_event_opr_dpr(
    matches_df: pd.DataFrame,
    all_team_ids: List[int],
) -> Dict[int, Dict[str, Any]]:
    """Calcula OPR, DPR, CCWM y rankings ofensivo/defensivo desde matches jugados."""
    if matches_df is None or matches_df.empty:
        return {}

    eq_rows: List[Tuple[int, int, float, float]] = []
    active_teams_set = set()

    for _, row in matches_df.iterrows():
        t_level = str(row.get("tournament_level", "Quals")).strip().upper()
        if t_level != "QUALS":
            continue
        if not bool(row.get("has_been_played", False)):
            continue

        r1 = int(to_numeric_safe(row.get("RED1"), 0))
        r2 = int(to_numeric_safe(row.get("RED2"), 0))
        b1 = int(to_numeric_safe(row.get("BLUE1"), 0))
        b2 = int(to_numeric_safe(row.get("BLUE2"), 0))
        if r1 <= 0 or r2 <= 0 or b1 <= 0 or b2 <= 0:
            continue

        red_np = row.get("actual_red_np")
        red_tot = row.get("actual_red_score")
        blue_np = row.get("actual_blue_np")
        blue_tot = row.get("actual_blue_score")

        r_score_raw = red_np if pd.notna(red_np) else red_tot
        b_score_raw = blue_np if pd.notna(blue_np) else blue_tot
        if pd.isna(r_score_raw) or pd.isna(b_score_raw):
            continue

        r_score = float(r_score_raw)
        b_score = float(b_score_raw)
        eq_rows.append((r1, r2, r_score, b_score))
        eq_rows.append((b1, b2, b_score, r_score))
        active_teams_set.update([r1, r2, b1, b2])

    if not eq_rows:
        return {}

    active_teams = sorted(active_teams_set)
    idx_map = {tid: idx for idx, tid in enumerate(active_teams)}
    n_eq = len(eq_rows)
    n_teams = len(active_teams)

    M = np.zeros((n_eq, n_teams), dtype=float)
    y_own = np.zeros(n_eq, dtype=float)
    y_opp = np.zeros(n_eq, dtype=float)

    for i, (t1, t2, own_s, opp_s) in enumerate(eq_rows):
        M[i, idx_map[t1]] += 1.0
        M[i, idx_map[t2]] += 1.0
        y_own[i] = own_s
        y_opp[i] = opp_s

    opr_vec = np.linalg.lstsq(M, y_own, rcond=None)[0]
    dpr_vec = np.linalg.lstsq(M, y_opp, rcond=None)[0]

    records = []
    for tid in active_teams:
        idx = idx_map[tid]
        opr_val = round(float(opr_vec[idx]), 2)
        dpr_val = round(float(dpr_vec[idx]), 2)
        ccwm_val = round(opr_val - dpr_val, 2)
        records.append({
            "team": tid,
            "opr": opr_val,
            "dpr": dpr_val,
            "ccwm": ccwm_val,
            "rank_off": 0,
            "rank_def": 0,
        })

    for rank_i, rec in enumerate(
        sorted(records, key=lambda x: (-x["opr"], -x["ccwm"], x["team"])),
        start=1,
    ):
        rec["rank_off"] = rank_i

    for rank_i, rec in enumerate(
        sorted(records, key=lambda x: (x["dpr"], -x["ccwm"], x["team"])),
        start=1,
    ):
        rec["rank_def"] = rank_i

    out: Dict[int, Dict[str, Any]] = {}
    for rec in records:
        out[rec["team"]] = {
            "opr": rec["opr"],
            "dpr": rec["dpr"],
            "ccwm": rec["ccwm"],
            "rank_off": rec["rank_off"],
            "rank_def": rec["rank_def"],
            "rank_comb_avg": round((rec["rank_off"] + rec["rank_def"]) / 2.0, 1),
        }
    return out


def build_export_tables(
    EVENT: str,
    scouting_df: pd.DataFrame,
    teams_names_df: pd.DataFrame,
    matches_df: pd.DataFrame,
    n_sims: int = DEFAULT_MC_SIMS,
    seed: Optional[int] = None,
    updated_at: Optional[str] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Construye las 6 tablas maestras del evento con proyección probabilística."""
    timestamp_iso = updated_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    rng = np.random.default_rng(seed)
    matches_norm = _ensure_match_defaults(matches_df)
    all_team_ids = _collect_all_team_ids(teams_names_df, scouting_df, matches_norm)
    opr_dpr_map = compute_event_opr_dpr(matches_norm, all_team_ids)

    # ── 1. TABLA DE ROBOTS Y RANKING EPA ───────────────────────────────────────
    robot_cache: Dict[int, Dict[str, Any]] = {}
    robots_full: List[Dict[str, Any]] = []
    ranking_rows: List[Dict[str, Any]] = []

    for tid in all_team_ids:
        r_dict = simulate_robot(EVENT, tid, scouting_df, teams_names_df, matches_norm)
        robot_cache[tid] = r_dict
        od = opr_dpr_map.get(tid)

        r_clean = _strip_private_keys(r_dict)
        r_clean["auto_scores"] = str(r_clean["auto_scores"])
        r_clean["tele_scores"] = str(r_clean["tele_scores"])
        r_clean["Updated_At"] = timestamp_iso
        robots_full.append(r_clean)

        ranking_rows.append({
            "EVENTO": EVENT,
            "Team ID": r_dict["team_id"],
            "Nombre": r_dict["name"],
            "Matches": r_dict["matches_played"],
            "EPA": r_dict["EPA"],
            "EPA_Operativo": r_dict["epa_operational"],
            "Score Est": r_dict["score_est"],
            "Auto Est": r_dict["auto_est"],
            "Tele Est": r_dict["tele_est"],
            "End Est": r_dict["endgame_est"],
            "Faltas Est": r_dict["fouls_est"],
            "Tips Est": r_dict["est_tips"],
            "Top Nectar": r_dict["can_top_nectar"],
            "Flores TOP": r_dict["flores_llenadas_est"],
            "Piezas Flor": r_dict["est_flower_pieces"],
            "Confiabilidad %": r_dict["reliability_pct"],
            "Fallas_Excluidas": r_dict["excluded_old_failures"],
            "Pos Estimada": r_dict["pos_type"],
            "OPR": od["opr"] if od else "",
            "DPR": od["dpr"] if od else "",
            "CCWM": od["ccwm"] if od else "",
            "Rank_Ofensivo": od["rank_off"] if od else "",
            "Rank_Defensivo": od["rank_def"] if od else "",
            "Rank_OPR_DPR_Prom": od["rank_comb_avg"] if od else "",
            "Updated_At": timestamp_iso,
        })

    df_robots = pd.DataFrame(robots_full)
    if not df_robots.empty:
        df_robots = df_robots.sort_values(by=["EPA", "score_est"], ascending=False).reset_index(drop=True)

    ranking_df = pd.DataFrame(ranking_rows)
    if not ranking_df.empty:
        ranking_df = ranking_df.sort_values(by=["EPA", "Score Est"], ascending=False).reset_index(drop=True)
        ranking_df.insert(0, "Rank_EPA", ranking_df.index + 1)

    # ── 2. SIMULACIÓN POR MATCH Y ACUMULACIÓN MONTE CARLO DE STANDINGS ─────────
    red_rows: List[Dict[str, Any]] = []
    blue_rows: List[Dict[str, Any]] = []
    match_summary_rows: List[Dict[str, Any]] = []

    team_idx_map = {tid: idx for idx, tid in enumerate(all_team_ids)}
    n_teams = len(all_team_ids)
    sim_rps_matrix = np.zeros((n_teams, n_sims), dtype=float)
    sim_score_matrix = np.zeros((n_teams, n_sims), dtype=float)
    sim_pj_arr = np.zeros(n_teams, dtype=int)

    tracker_meta: Dict[int, Dict[str, Any]] = {
        tid: {
            "Team ID": tid,
            "Nombre": robot_cache[tid]["name"],
            "PJ_Jugados": 0,
            "PJ_Restantes": 0,
            "RPs_Reales": 0,
            "Score_Real": 0,
        }
        for tid in all_team_ids
    }

    for _, m_row in matches_norm.iterrows():
        m_code = int(m_row["match_code"])
        t_level = str(m_row.get("tournament_level") or "Quals")
        is_quals = t_level.strip().upper() == "QUALS"

        alliances, _ = simulate_match(
            EVENT,
            m_code,
            scouting_df,
            teams_names_df,
            matches_norm,
            robot_cache=robot_cache,
            tournament_level=t_level,
            n_sims=n_sims,
            rng=rng,
        )
        if not alliances:
            continue

        red, blue = alliances["RED"], alliances["BLUE"]
        red_rps_vec = red["_rps_vec"]
        blue_rps_vec = blue["_rps_vec"]
        red_scores_vec = red["_scores_vec"]
        blue_scores_vec = blue["_scores_vec"]

        played = bool(m_row.get("has_been_played")) and not pd.isna(m_row.get("actual_red_rp"))
        if played:
            actual_red_pts = int(to_numeric_safe(m_row.get("actual_red_score"), 0))
            actual_blue_pts = int(to_numeric_safe(m_row.get("actual_blue_score"), 0))
            actual_red_rp = int(to_numeric_safe(m_row.get("actual_red_rp"), 0))
            actual_blue_rp = int(to_numeric_safe(m_row.get("actual_blue_rp"), 0))
        else:
            actual_red_pts = None
            actual_blue_pts = None
            actual_red_rp = None
            actual_blue_rp = None

        if red["win_prob_pct"] > blue["win_prob_pct"]:
            ganador = "RED"
        elif blue["win_prob_pct"] > red["win_prob_pct"]:
            ganador = "BLUE"
        else:
            ganador = "EMPATE"

        r1_id = int(m_row["RED1"])
        r2_id = int(m_row["RED2"])
        b1_id = int(m_row["BLUE1"])
        b2_id = int(m_row["BLUE2"])

        red_export = _strip_private_keys(red)
        blue_export = _strip_private_keys(blue)
        red_rows.append({"Nivel": t_level, "Match": m_code, "RED1": r1_id, "RED2": r2_id, **red_export, "Resultado": ganador, "Total_RPs": red["xRP"]})
        blue_rows.append({"Nivel": t_level, "Match": m_code, "BLUE1": b1_id, "BLUE2": b2_id, **blue_export, "Resultado": ganador, "Total_RPs": blue["xRP"]})

        match_summary_rows.append({
            "EVENTO": EVENT,
            "Nivel": t_level,
            "Match": m_code,
            "Jugado": "SI" if played else "NO",
            "RED1": r1_id,
            "RED2": r2_id,
            "BLUE1": b1_id,
            "BLUE2": b2_id,
            "Red Est": red["score_est_total"],
            "Blue Est": blue["score_est_total"],
            "Red Win %": red["win_prob_pct"],
            "Blue Win %": blue["win_prob_pct"],
            "Tie %": red["tie_prob_pct"],
            "Ganador Est": ganador,
            "Red Flores Tap.": red["alliance_flores_tapadas"],
            "Blue Flores Tap.": blue["alliance_flores_tapadas"],
            "Red Conflicto Auto": red["auto_conflict"],
            "Blue Conflicto Auto": blue["auto_conflict"],
            "Red RPs Est": red["xRP"],
            "Blue RPs Est": blue["xRP"],
            "Red Real": actual_red_pts if actual_red_pts is not None else "",
            "Blue Real": actual_blue_pts if actual_blue_pts is not None else "",
        })

        # Solo Quals y participaciones no-surrogate cuentan para la tabla de clasificación
        if not is_quals:
            continue

        slots = [
            (r1_id, bool(m_row.get("red1_surrogate", False)), actual_red_rp, actual_red_pts, red_rps_vec, red_scores_vec),
            (r2_id, bool(m_row.get("red2_surrogate", False)), actual_red_rp, actual_red_pts, red_rps_vec, red_scores_vec),
            (b1_id, bool(m_row.get("blue1_surrogate", False)), actual_blue_rp, actual_blue_pts, blue_rps_vec, blue_scores_vec),
            (b2_id, bool(m_row.get("blue2_surrogate", False)), actual_blue_rp, actual_blue_pts, blue_rps_vec, blue_scores_vec),
        ]

        for t_int, is_surr, real_rp, real_pts, rps_vec, pts_vec in slots:
            if is_surr or t_int not in team_idx_map:
                continue
            idx = team_idx_map[t_int]
            sim_pj_arr[idx] += 1
            if played and real_rp is not None and real_pts is not None:
                tracker_meta[t_int]["PJ_Jugados"] += 1
                tracker_meta[t_int]["RPs_Reales"] += real_rp
                tracker_meta[t_int]["Score_Real"] += real_pts
                sim_rps_matrix[idx, :] += real_rp
                sim_score_matrix[idx, :] += real_pts
            else:
                tracker_meta[t_int]["PJ_Restantes"] += 1
                sim_rps_matrix[idx, :] += rps_vec
                sim_score_matrix[idx, :] += pts_vec

    df_red_alliance = pd.DataFrame(red_rows)
    df_blue_alliance = pd.DataFrame(blue_rows)
    sim_matches_df = pd.DataFrame(match_summary_rows)

    # ── 3. STANDINGS PROYECTADOS (HÍBRIDO: REALES + MONTE CARLO) ───────────────
    standings_rows: List[Dict[str, Any]] = []
    if n_teams > 0:
        pj_safe = np.where(sim_pj_arr > 0, sim_pj_arr, 1)[:, None]
        rp_avg_mat = sim_rps_matrix / pj_safe
        score_avg_mat = sim_score_matrix / pj_safe

        # Ranking por cada universo Monte Carlo (desempate por Score_Promedio)
        ranks_mat = np.zeros((n_teams, n_sims), dtype=int)
        top_cutoff = min(4, n_teams)
        for s_idx in range(n_sims):
            order = np.lexsort((-score_avg_mat[:, s_idx], -rp_avg_mat[:, s_idx]))
            ranks_mat[order, s_idx] = np.arange(1, n_teams + 1)

        for tid in all_team_ids:
            idx = team_idx_map[tid]
            meta = tracker_meta[tid]
            pj_sim = int(sim_pj_arr[idx])
            rps_tot_mean = float(np.mean(sim_rps_matrix[idx, :]))
            score_tot_mean = float(np.mean(sim_score_matrix[idx, :]))
            rp_prom = rps_tot_mean / pj_sim if pj_sim > 0 else 0.0
            score_prom = score_tot_mean / pj_sim if pj_sim > 0 else 0.0

            team_ranks = ranks_mat[idx, :]
            prob_top4 = float(np.mean(team_ranks <= top_cutoff) * 100.0) if pj_sim > 0 else 0.0

            standings_rows.append({
                "Team ID": tid,
                "Nombre": meta["Nombre"],
                "PJ_Jugados": meta["PJ_Jugados"],
                "PJ_Restantes": meta["PJ_Restantes"],
                "PJ_Sim": pj_sim,
                "RPs_Reales": meta["RPs_Reales"],
                "RPs_Totales": round(rps_tot_mean, 2),
                "RP_Promedio": round(rp_prom, 2),
                "Score_Acumulado": round(score_tot_mean, 1),
                "Score_Promedio": round(score_prom, 1),
                "Rank_Min": int(np.min(team_ranks)) if pj_sim > 0 else n_teams,
                "Rank_Max": int(np.max(team_ranks)) if pj_sim > 0 else n_teams,
                "Prob_Top4_Pct": round(prob_top4, 1),
                "Updated_At": timestamp_iso,
            })

    df_standings = pd.DataFrame(standings_rows)
    if not df_standings.empty:
        df_standings = df_standings.sort_values(
            by=["RP_Promedio", "Score_Promedio", "Score_Acumulado"],
            ascending=[False, False, False],
        ).reset_index(drop=True)
        df_standings.insert(0, "Rank_Proyectado", df_standings.index + 1)

    return ranking_df, df_robots, sim_matches_df, df_red_alliance, df_blue_alliance, df_standings


# %%
# ==============================================================================
# CELL 7 — Exportación a Google Sheets y Orquestación CLI / Colab
# ==============================================================================

def upload_dataframes(
    gss_obj: gspread.Spreadsheet,
    dataframes_dict: Dict[str, pd.DataFrame],
) -> None:
    """Sube las 6 pestañas de salida a Google Sheets creando o limpiando cada hoja."""
    for tab_name, df in dataframes_dict.items():
        if df is None or df.empty:
            try:
                ws = gss_obj.worksheet(tab_name)
                ws.clear()
                print(f"[CLEAR] '{tab_name}' estaba vacío; se limpiaron filas obsoletas.")
            except gspread.exceptions.WorksheetNotFound:
                print(f"[SKIP] '{tab_name}' está vacío, no se subió.")
            continue
        try:
            ws = gss_obj.worksheet(tab_name)
            ws.clear()
        except gspread.exceptions.WorksheetNotFound:
            ws = gss_obj.add_worksheet(
                title=tab_name,
                rows=len(df) + 15,
                cols=len(df.columns) + 5,
            )
        set_with_dataframe(ws, df, resize=True)
        print(f"  -> Pestaña '{tab_name}' actualizada ({len(df)} filas).")
    print("[OK] Todas las tablas fueron exportadas exitosamente a Google Sheets.")


def run_pipeline(
    event_code: str = EVENT,
    ftcscout_code: Optional[str] = FTCSCOUT_CODE,
    season: int = FTCSCOUT_SEASON,
    sheet_id: Optional[str] = SHEET_ID,
    sheet_name: str = SHEET_NAME,
    upload: bool = True,
    use_ftcscout: bool = True,
    n_sims: int = DEFAULT_MC_SIMS,
    seed: Optional[int] = None,
    creds_json_path: Optional[str] = None,
) -> Dict[str, pd.DataFrame]:
    """Ejecuta de extremo a extremo la carga, simulación Monte Carlo y exportación."""
    gc = authenticate_gspread(creds_json_path=creds_json_path)
    spreadsheet = open_spreadsheet(gc, sheet_id=sheet_id, sheet_name=sheet_name)

    print(f"Conectado a: '{spreadsheet.title}' | Evento activo: [{event_code}]")
    print(f"Pestañas disponibles: {[ws.title for ws in spreadsheet.worksheets()]}")

    scouting_df, teams_names_df, matches_df = load_event_data(
        spreadsheet,
        event_code=event_code,
        ftcscout_code=ftcscout_code,
        season=season,
        use_ftcscout=use_ftcscout,
    )
    print(
        f"[{event_code}] Scouting: {len(scouting_df)} | "
        f"Equipos: {len(teams_names_df)} | Matches: {len(matches_df)}"
    )

    if not teams_names_df.empty:
        sample_id = int(teams_names_df.iloc[0]["Team ID"])
        sample_profile = _strip_private_keys(
            simulate_robot(event_code, sample_id, scouting_df, teams_names_df, matches_df)
        )
        display_table(
            sample_profile,
            title=f"=== MUESTRA DE SIMULACIÓN EQUIPO {sample_id} [{event_code}] ===",
        )

    ranking_df, df_robots, sim_matches_df, df_red_alliance, df_blue_alliance, df_standings = (
        build_export_tables(
            event_code,
            scouting_df,
            teams_names_df,
            matches_df,
            n_sims=n_sims,
            seed=seed,
        )
    )

    outputs = {
        f"Ranking_EPA_{event_code}": ranking_df,
        f"Equipos_Simulados_{event_code}": df_robots,
        f"Simulacion_Matches_{event_code}": sim_matches_df,
        f"Rojo_Alianza_{event_code}": df_red_alliance,
        f"Azul_Alianza_{event_code}": df_blue_alliance,
        f"Standings_Proy_{event_code}": df_standings,
    }

    if upload:
        upload_dataframes(spreadsheet, outputs)
    else:
        print("[DRY-RUN] Simulación completada sin escritura en Google Sheets.")

    display_table(ranking_df, title=f"=== TOP EQUIPOS POR EPA [{event_code}] ===")
    return outputs


def _parse_cli_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    """Configura argumentos de línea de comandos para ejecución local o CI."""
    parser = argparse.ArgumentParser(
        description="Timestone FTC 2026-2027 — Motor de Scouting y Simulación Monte Carlo"
    )
    parser.add_argument("--event", default=EVENT, help="Código de evento para pestañas de salida (ej. MXTLQ).")
    parser.add_argument("--ftcscout-code", default=FTCSCOUT_CODE, help="Código oficial en FTCScout si difiere de --event.")
    parser.add_argument("--season", type=int, default=FTCSCOUT_SEASON, help="Temporada FTCScout (default: 2026).")
    parser.add_argument("--sheet-id", default=SHEET_ID, help="ID del Google Spreadsheet.")
    parser.add_argument("--sheet-name", default=SHEET_NAME, help="Nombre de respaldo del Spreadsheet.")
    parser.add_argument("--sims", type=int, default=DEFAULT_MC_SIMS, help="Número de corridas Monte Carlo por match.")
    parser.add_argument("--seed", type=int, default=None, help="Semilla opcional para reproducibilidad.")
    parser.add_argument("--creds", default=None, help="Ruta opcional al JSON de Service Account.")
    parser.add_argument("--no-ftcscout", action="store_true", help="Desactiva la consulta a FTCScout API.")
    parser.add_argument("--dry-run", action="store_true", help="Ejecuta sin sobrescribir Google Sheets.")
    return parser.parse_args(argv)


if __name__ == "__main__":
    if _is_colab():
        run_pipeline(
            event_code=EVENT,
            ftcscout_code=FTCSCOUT_CODE,
            season=FTCSCOUT_SEASON,
            sheet_id=SHEET_ID,
            sheet_name=SHEET_NAME,
            upload=True,
        )
    else:
        args = _parse_cli_args()
        run_pipeline(
            event_code=args.event,
            ftcscout_code=args.ftcscout_code,
            season=args.season,
            sheet_id=args.sheet_id,
            sheet_name=args.sheet_name,
            upload=not args.dry_run,
            use_ftcscout=not args.no_ftcscout,
            n_sims=args.sims,
            seed=args.seed,
            creds_json_path=args.creds,
        )
