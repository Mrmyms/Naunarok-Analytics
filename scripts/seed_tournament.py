# -*- coding: utf-8 -*-
"""Generador de torneo completo realista (BIOBUZZ FTC 2026-2027) para pruebas.

Genera un evento completo realista (24 equipos incluyendo #4010 Nautilus,
36 matches de calificación —30 jugados con scouting completo = 120 filas en
``Captura_BIOBUZZ``, más 6 matches futuros #31–#36 en ``Matches``—), respetando
las reglas físicas de BIOBUZZ y los encabezados exactos del Google Sheet.

Uso:
    # Generar y subir datos realistas a Google Sheets + correr Timestone
    .venv/bin/python scripts/seed_tournament.py --upload --run-timestone --event MXTLQ

    # Simulación local sin escribir en Google Sheets
    .venv/bin/python scripts/seed_tournament.py --dry-run

    # Limpiar datos de prueba (conserva fila 1 de encabezados) antes del torneo real
    .venv/bin/python scripts/seed_tournament.py --clear --event MXTLQ
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import timestone_ftc_2026_2027_v2 as ts


TEAM_ARCHETYPES: List[Dict[str, Any]] = [
    # Tier 1 — Elite / Híbridos y Especialistas Top
    {"id": 4010,  "name": "Nautilus",          "pos": ["A", "E"], "leave": 0.96, "apark": 0.25, "epark": 0.92, "ah_p": 0.9, "ah_n": 1.1, "af_p": 0.6, "af_n": 0.4, "th_p": 2.4, "th_n": 3.6, "tf_p": 1.8, "tf_n": 1.4, "bot": 0.45, "gar": 1.2, "def": 0.10, "drv": 4.7, "fl_own": 0.75, "f_min": 0.10, "f_maj": 0.00, "tag": "Híbrido elite • ciclos rápidos en Balancín y Flor"},
    {"id": 14367, "name": "Voltec",            "pos": ["A", "B"], "leave": 0.95, "apark": 0.30, "epark": 0.90, "ah_p": 1.2, "ah_n": 1.2, "af_p": 0.3, "af_n": 0.2, "th_p": 2.8, "th_n": 3.8, "tf_p": 1.0, "tf_n": 0.9, "bot": 0.35, "gar": 0.8, "def": 0.05, "drv": 4.6, "fl_own": 0.55, "f_min": 0.15, "f_maj": 0.00, "tag": "Auto sólido en Balancín [Auto consistente]"},
    {"id": 16405, "name": "PrepaTec Bot",      "pos": ["E", "D"], "leave": 0.92, "apark": 0.20, "epark": 0.88, "ah_p": 0.7, "ah_n": 0.9, "af_p": 0.7, "af_n": 0.6, "th_p": 1.8, "th_n": 2.5, "tf_p": 2.2, "tf_n": 2.0, "bot": 0.50, "gar": 1.0, "def": 0.15, "drv": 4.5, "fl_own": 0.80, "f_min": 0.20, "f_maj": 0.00, "tag": "Muy preciso tapando Flores con Néctar"},
    {"id": 21229, "name": "Kukulkan Robotics", "pos": ["C", "D"], "leave": 0.90, "apark": 0.15, "epark": 0.85, "ah_p": 0.2, "ah_n": 0.4, "af_p": 1.1, "af_n": 1.0, "th_p": 0.8, "th_n": 1.2, "tf_p": 3.1, "tf_n": 2.6, "bot": 0.65, "gar": 0.6, "def": 0.10, "drv": 4.4, "fl_own": 0.88, "f_min": 0.15, "f_maj": 0.00, "early_dc": True, "tag": "Especialista en Flores + Bottom Nectar"},

    # Tier 2 — Competitivos Altos
    {"id": 12961, "name": "TecGear",           "pos": ["A", "C"], "leave": 0.88, "apark": 0.35, "epark": 0.82, "ah_p": 1.0, "ah_n": 0.8, "af_p": 0.1, "af_n": 0.1, "th_p": 3.0, "th_n": 3.2, "tf_p": 0.6, "tf_n": 0.4, "bot": 0.20, "gar": 1.1, "def": 0.10, "drv": 4.2, "fl_own": 0.35, "f_min": 0.20, "f_maj": 0.00, "tag": "Enfoque Balancín alto volumen"},
    {"id": 17843, "name": "Xibalba",           "pos": ["D", "E"], "leave": 0.85, "apark": 0.20, "epark": 0.80, "ah_p": 0.1, "ah_n": 0.2, "af_p": 0.8, "af_n": 0.9, "th_p": 0.6, "th_n": 0.9, "tf_p": 2.8, "tf_n": 2.2, "bot": 0.60, "gar": 0.9, "def": 0.20, "drv": 4.1, "fl_own": 0.82, "f_min": 0.25, "f_maj": 0.00, "tag": "Control rápido de Flor"},
    {"id": 19402, "name": "Aztech Robotics",   "pos": ["B", "A"], "leave": 0.90, "apark": 0.40, "epark": 0.78, "ah_p": 0.9, "ah_n": 0.9, "af_p": 0.2, "af_n": 0.2, "th_p": 2.2, "th_n": 2.6, "tf_p": 1.1, "tf_n": 0.9, "bot": 0.30, "gar": 1.5, "def": 0.15, "drv": 4.0, "fl_own": 0.48, "f_min": 0.20, "f_maj": 0.05, "tag": "Buen Swarm + Balancín"},
    {"id": 22814, "name": "Quetzal",           "pos": ["C", "E"], "leave": 0.84, "apark": 0.18, "epark": 0.80, "ah_p": 0.3, "ah_n": 0.3, "af_p": 0.7, "af_n": 0.6, "th_p": 1.0, "th_n": 1.2, "tf_p": 2.4, "tf_n": 1.9, "bot": 0.55, "gar": 1.4, "def": 0.12, "drv": 3.9, "fl_own": 0.74, "f_min": 0.15, "f_maj": 0.00, "tag": "Buen ciclo en Flores"},
    {"id": 11582, "name": "Cyborg Panthers",   "pos": ["A", "D"], "leave": 0.82, "apark": 0.22, "epark": 0.76, "ah_p": 0.6, "ah_n": 0.6, "af_p": 0.4, "af_n": 0.3, "th_p": 1.8, "th_n": 2.0, "tf_p": 1.5, "tf_n": 1.3, "bot": 0.35, "gar": 1.6, "def": 0.20, "drv": 3.8, "fl_own": 0.52, "f_min": 0.30, "f_maj": 0.05, "tag": "Híbrido parejo [Buen driver]"},
    {"id": 24109, "name": "Ocelot Tech",       "pos": ["B", "C"], "leave": 0.86, "apark": 0.25, "epark": 0.75, "ah_p": 0.8, "ah_n": 0.7, "af_p": 0.1, "af_n": 0.1, "th_p": 2.4, "th_n": 2.2, "tf_p": 0.5, "tf_n": 0.4, "bot": 0.15, "gar": 1.0, "def": 0.10, "drv": 3.8, "fl_own": 0.25, "f_min": 0.25, "f_maj": 0.00, "recent_dc": True, "tag": "Falla reciente en transmisión"},

    # Tier 3 — Media Tabla
    {"id": 15230, "name": "Jaguar Bots",       "pos": ["B", "D"], "leave": 0.78, "apark": 0.30, "epark": 0.72, "ah_p": 0.5, "ah_n": 0.4, "af_p": 0.2, "af_n": 0.1, "th_p": 1.7, "th_n": 1.5, "tf_p": 0.9, "tf_n": 0.7, "bot": 0.25, "gar": 2.0, "def": 0.25, "drv": 3.5, "fl_own": 0.35, "f_min": 0.30, "f_maj": 0.05, "tag": "Aporta constante en TeleOp"},
    {"id": 18765, "name": "Mecha Azteca",      "pos": ["C", "A"], "leave": 0.76, "apark": 0.22, "epark": 0.70, "ah_p": 0.4, "ah_n": 0.4, "af_p": 0.3, "af_n": 0.2, "th_p": 1.3, "th_n": 1.4, "tf_p": 1.3, "tf_n": 1.0, "bot": 0.30, "gar": 1.8, "def": 0.20, "drv": 3.4, "fl_own": 0.40, "f_min": 0.25, "f_maj": 0.05, "tag": "Versátil en media cancha"},
    {"id": 20311, "name": "Orion FTC",         "pos": ["D", "B"], "leave": 0.75, "apark": 0.32, "epark": 0.68, "ah_p": 0.6, "ah_n": 0.3, "af_p": 0.1, "af_n": 0.0, "th_p": 1.9, "th_n": 1.3, "tf_p": 0.4, "tf_n": 0.4, "bot": 0.15, "gar": 1.5, "def": 0.15, "drv": 3.3, "fl_own": 0.20, "f_min": 0.35, "f_maj": 0.05, "tag": "Enfoque Pollen en Balancín"},
    {"id": 23590, "name": "Valkyria",          "pos": ["E", "C"], "leave": 0.74, "apark": 0.18, "epark": 0.72, "ah_p": 0.2, "ah_n": 0.2, "af_p": 0.4, "af_n": 0.3, "th_p": 0.8, "th_n": 0.9, "tf_p": 1.6, "tf_n": 1.4, "bot": 0.40, "gar": 1.7, "def": 0.18, "drv": 3.4, "fl_own": 0.55, "f_min": 0.20, "f_maj": 0.00, "tag": "Buen apoyo en Flor"},
    {"id": 13448, "name": "Titanes",           "pos": ["A", "B"], "leave": 0.72, "apark": 0.28, "epark": 0.65, "ah_p": 0.4, "ah_n": 0.3, "af_p": 0.1, "af_n": 0.1, "th_p": 1.5, "th_n": 1.3, "tf_p": 0.7, "tf_n": 0.5, "bot": 0.20, "gar": 2.4, "def": 0.30, "drv": 3.2, "fl_own": 0.25, "f_min": 0.40, "f_maj": 0.10, "tag": "Chasis pesado para defensa"},
    {"id": 16992, "name": "Steel Eagles",      "pos": ["B", "E"], "leave": 0.70, "apark": 0.25, "epark": 0.68, "ah_p": 0.3, "ah_n": 0.3, "af_p": 0.2, "af_n": 0.1, "th_p": 1.2, "th_n": 1.1, "tf_p": 1.0, "tf_n": 0.8, "bot": 0.25, "gar": 2.1, "def": 0.22, "drv": 3.1, "fl_own": 0.32, "f_min": 0.25, "f_maj": 0.05, "tag": "Ciclos regulares"},
    {"id": 25014, "name": "Hyperion MX",       "pos": ["C", "D"], "leave": 0.68, "apark": 0.20, "epark": 0.64, "ah_p": 0.2, "ah_n": 0.3, "af_p": 0.3, "af_n": 0.2, "th_p": 1.0, "th_n": 1.1, "tf_p": 1.1, "tf_n": 0.9, "bot": 0.30, "gar": 2.3, "def": 0.25, "drv": 3.0, "fl_own": 0.38, "f_min": 0.35, "f_maj": 0.05, "tag": "Buen desempeño en Garden"},
    {"id": 19881, "name": "Cerberus",          "pos": ["D", "A"], "leave": 0.70, "apark": 0.22, "epark": 0.62, "ah_p": 0.4, "ah_n": 0.2, "af_p": 0.1, "af_n": 0.1, "th_p": 1.4, "th_n": 1.0, "tf_p": 0.6, "tf_n": 0.5, "bot": 0.20, "gar": 2.6, "def": 0.35, "drv": 3.0, "fl_own": 0.22, "f_min": 0.45, "f_maj": 0.10, "tag": "Defensa activa en Garden"},

    # Tier 4 — Soporte / Garden / En Desarrollo
    {"id": 21904, "name": "RoboLions",         "pos": ["B", "C"], "leave": 0.65, "apark": 0.20, "epark": 0.55, "ah_p": 0.1, "ah_n": 0.1, "af_p": 0.1, "af_n": 0.0, "th_p": 0.4, "th_n": 0.3, "tf_p": 0.3, "tf_n": 0.2, "bot": 0.10, "gar": 5.5, "def": 0.55, "drv": 2.9, "fl_own": 0.10, "f_min": 0.40, "f_maj": 0.10, "tag": "Especialista Garden + Descore"},
    {"id": 24777, "name": "Nova Tech",         "pos": ["E", "B"], "leave": 0.68, "apark": 0.35, "epark": 0.60, "ah_p": 0.1, "ah_n": 0.1, "af_p": 0.1, "af_n": 0.1, "th_p": 0.5, "th_n": 0.4, "tf_p": 0.4, "tf_n": 0.3, "bot": 0.15, "gar": 4.2, "def": 0.35, "drv": 2.8, "fl_own": 0.15, "f_min": 0.25, "f_maj": 0.05, "tag": "Apoyo Swarm + Garden"},
    {"id": 26112, "name": "Phoenix Jr",        "pos": ["A", "E"], "leave": 0.55, "apark": 0.18, "epark": 0.48, "ah_p": 0.1, "ah_n": 0.1, "af_p": 0.0, "af_n": 0.0, "th_p": 0.6, "th_n": 0.4, "tf_p": 0.3, "tf_n": 0.2, "bot": 0.10, "gar": 2.8, "def": 0.25, "drv": 2.5, "fl_own": 0.10, "f_min": 0.60, "f_maj": 0.18, "tag": "Rookie • propenso a faltas en zona"},
    {"id": 27405, "name": "Aether Bots",       "pos": ["C", "B"], "leave": 0.58, "apark": 0.22, "epark": 0.50, "ah_p": 0.1, "ah_n": 0.0, "af_p": 0.1, "af_n": 0.0, "th_p": 0.5, "th_n": 0.3, "tf_p": 0.3, "tf_n": 0.2, "bot": 0.10, "gar": 3.0, "def": 0.30, "drv": 2.6, "fl_own": 0.12, "f_min": 0.35, "f_maj": 0.05, "early_noshow": True, "tag": "Inicia lento pero limpia bien Garden"},
    {"id": 25678, "name": "Vortex",            "pos": ["D", "C"], "leave": 0.60, "apark": 0.15, "epark": 0.52, "ah_p": 0.0, "ah_n": 0.1, "af_p": 0.0, "af_n": 0.1, "th_p": 0.3, "th_n": 0.3, "tf_p": 0.4, "tf_n": 0.3, "bot": 0.15, "gar": 4.8, "def": 0.50, "drv": 2.7, "fl_own": 0.12, "f_min": 0.45, "f_maj": 0.10, "tag": "Defensa en Garden rival"},
    {"id": 28331, "name": "Solaris",           "pos": ["B", "A"], "leave": 0.52, "apark": 0.28, "epark": 0.45, "ah_p": 0.0, "ah_n": 0.0, "af_p": 0.0, "af_n": 0.0, "th_p": 0.2, "th_n": 0.2, "tf_p": 0.2, "tf_n": 0.1, "bot": 0.08, "gar": 3.5, "def": 0.20, "drv": 2.4, "fl_own": 0.08, "f_min": 0.30, "f_maj": 0.05, "tag": "Pushbot básico • aparca al final"},
]

SCOUTERS = ["Ana M.", "Carlos R.", "Sofía G.", "Diego L.", "Valeria P.", "Mateo H."]


def build_balanced_schedule(
    team_ids: List[int],
    n_rounds: int = 6,
    rng: np.random.Generator | None = None,
) -> pd.DataFrame:
    """Genera un calendario balanceado de ``n_rounds`` rondas (cada equipo juega 1 vez/ronda)."""
    generator = rng or np.random.default_rng(2026)
    n_teams = len(team_ids)
    assert n_teams % 4 == 0, "La cantidad de equipos debe ser múltiplo de 4."

    rows: List[Dict[str, int]] = []
    match_num = 1
    for _ in range(n_rounds):
        perm = list(generator.permutation(team_ids))
        for offset in range(0, n_teams, 4):
            rows.append({
                "match_code": match_num,
                "RED1": int(perm[offset]),
                "RED2": int(perm[offset + 1]),
                "BLUE1": int(perm[offset + 2]),
                "BLUE2": int(perm[offset + 3]),
            })
            match_num += 1
    return pd.DataFrame(rows)


def _poisson_nonneg(rng: np.random.Generator, lam: float) -> int:
    return int(rng.poisson(max(0.0, lam))) if lam > 0 else 0


def load_real_event_archetypes(event_code: str, season: int = 2026) -> List[Dict[str, Any]]:
    """Mapea los 24 arquetipos estadísticos a equipos reales del evento en FTCScout."""
    try:
        ftc_data = ts.fetch_ftcscout_event(event_code, season=season)
        ftc_teams = ts._parse_ftcscout_teams(ftc_data) if ftc_data else pd.DataFrame()
    except Exception:
        ftc_teams = pd.DataFrame()

    if ftc_teams.empty:
        return [dict(a) for a in TEAM_ARCHETYPES]

    ordered: List[Tuple[int, str]] = []
    seen = set()
    # Priorizar 21735 (Nautilus en MXTLQ) o 4010 como primer equipo si participa
    for priority_id in (21735, 4010):
        match = ftc_teams[ftc_teams["Team ID"] == priority_id]
        if not match.empty:
            r = match.iloc[0]
            tid = int(r["Team ID"])
            seen.add(tid)
            ordered.append((tid, str(r["Names"])))

    for _, r in ftc_teams.iterrows():
        tid = int(r["Team ID"])
        if tid in seen:
            continue
        seen.add(tid)
        ordered.append((tid, str(r["Names"])))
        if len(ordered) >= len(TEAM_ARCHETYPES):
            break

    if len(ordered) < len(TEAM_ARCHETYPES):
        return [dict(a) for a in TEAM_ARCHETYPES]

    mapped: List[Dict[str, Any]] = []
    for idx, base in enumerate(TEAM_ARCHETYPES):
        tid, name = ordered[idx]
        item = dict(base)
        item["id"] = tid
        item["name"] = name
        mapped.append(item)
    return mapped


def build_pit_dataframe(archetypes: List[Dict[str, Any]], count: int = 12) -> pd.DataFrame:
    """Genera fichas técnicas realistas para ``Pit_BIOBUZZ`` (19 columnas exactas)."""
    chassis_opts = ["Mecanum goBILDA", "Swerve 4-Pod", "Mecanum REV", "Tank / Traction"]
    intake_opts = ["Roller Rodillo + Rampa", "Garra Activa Dual", "Sweeper Compliant", "Intake Lateral"]
    cap_opts = ["1 pieza", "2 piezas", "2 piezas + clasificador"]
    hive_mechs = ["Elevador Telescópico", "Brazo Doble Articulado", "Elevador Cascada 2 Etapas", "No alcanza Hive"]
    flor_mechs = ["Brazo Superior + Néctar", "Torreta Flor Rápida", "Dispensador Frontal", "Solo Garden"]
    auto_routines = [
        "Leave + 2 Hive + Park",
        "Leave + 1 Hive + 1 Flor",
        "Leave + 2 Flores",
        "Leave + Park Seguro",
    ]
    auto_sides = ["Ambos lados", "Lado Hive (A/E)", "Lado Flor (B/C)", "Indiferente"]
    vision_opts = [
        "Limelight 3A + Odometría",
        "Webcam AprilTags + Encoders",
        "Limelight 3A + Sensor Color",
        "Solo Encoders / IMU",
    ]
    hours_opts = ["40+ hrs", "25-40 hrs", "15-25 hrs", "< 15 hrs"]

    rows: List[Dict[str, Any]] = []
    now_str = datetime.now().strftime("%d/%m/%Y, %H:%M:%S")
    for idx, p in enumerate(archetypes[:count]):
        bal_focus = (p["ah_p"] + p["ah_n"] + p["th_p"] + p["th_n"]) >= (p["af_p"] + p["af_n"] + p["tf_p"] + p["tf_n"])
        if p["gar"] >= 4.0:
            pref_role = "Garden / Defensa"
        elif idx < 4:
            pref_role = "Híbrido"
        elif bal_focus:
            pref_role = "Balancín (Hive)"
        else:
            pref_role = "Flor (Polen/Néctar)"

        claimed_auto = round(
            3 * p["leave"] + 5 * p["apark"] + 2 * (p["ah_p"] + p["ah_n"] + p["af_p"] + p["af_n"])
        )
        rows.append({
            "Timestamp": now_str,
            "EQUIPO": p["id"],
            "NOMBRE_EQUIPO": p["name"],
            "SCOUT": SCOUTERS[idx % len(SCOUTERS)],
            "CHASIS": chassis_opts[idx % len(chassis_opts)],
            "PESO_LB": round(29.5 + (idx % 7) * 1.6, 1),
            "INTAKE": intake_opts[idx % len(intake_opts)],
            "CAPACIDAD": cap_opts[min(2, idx % len(cap_opts))],
            "MECANISMO_HIVE": hive_mechs[3 if p["th_p"] + p["th_n"] < 1.0 else idx % 3],
            "MECANISMO_FLOR": flor_mechs[3 if p["tf_p"] + p["tf_n"] < 1.0 else idx % 3],
            "RUTINAS_AUTO": auto_routines[min(3, idx // 3)],
            "LADO_AUTO": auto_sides[idx % len(auto_sides)],
            "SENSORES_VISION": vision_opts[min(3, idx // 3)],
            "AUTO_PTS_EST": claimed_auto,
            "HORAS_DRIVER": hours_opts[min(3, idx // 3)],
            "ROL_PREFERIDO": pref_role,
            "NOTAS": p["tag"],
            "FOTOS_COUNT": 0,
            "FOTOS_IDS": "",
        })
    return pd.DataFrame(rows)


def generate_tournament_data(
    played_matches: int = 30,
    total_rounds: int = 6,
    seed: int = 2026,
    archetypes: List[Dict[str, Any]] | None = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Construye ``captura_df``, ``teams_df`` y ``matches_df`` realistas para un torneo."""
    rng = np.random.default_rng(seed)
    source_archetypes = archetypes or TEAM_ARCHETYPES
    profiles = {t["id"]: t for t in source_archetypes}
    team_ids = [t["id"] for t in source_archetypes]

    teams_df = pd.DataFrame([{"Team ID": t["id"], "Names": t["name"]} for t in source_archetypes])
    matches_df = build_balanced_schedule(team_ids, n_rounds=total_rounds, rng=rng)
    matches_df["tournament_level"] = "Quals"
    matches_df["has_been_played"] = matches_df["match_code"] <= played_matches
    for col in ("actual_red_score", "actual_blue_score", "actual_red_np", "actual_blue_np", "actual_red_rp", "actual_blue_rp"):
        matches_df[col] = np.nan

    played_df = matches_df[matches_df["match_code"] <= played_matches]
    team_appearance_count: Dict[int, int] = {tid: 0 for tid in team_ids}
    team_total_in_played: Dict[int, int] = {tid: 0 for tid in team_ids}
    for _, mr in played_df.iterrows():
        for s in ("RED1", "RED2", "BLUE1", "BLUE2"):
            team_total_in_played[int(mr[s])] += 1

    captura_rows: List[Dict[str, Any]] = []
    start_dt = datetime(2026, 11, 19, 9, 10, 0)

    for _, m_row in played_df.iterrows():
        m_num = int(m_row["match_code"])
        match_dt = start_dt + timedelta(minutes=(m_num - 1) * 9)
        remaining_flowers_field = 4

        slots = [
            ("ROJO", int(m_row["RED1"]), 0),
            ("ROJO", int(m_row["RED2"]), 1),
            ("AZUL", int(m_row["BLUE1"]), 2),
            ("AZUL", int(m_row["BLUE2"]), 3),
        ]

        # Evitar duplicar exactamente la misma posición entre compañeros en la mayoría de matches
        used_pos_by_alliance: Dict[str, str] = {}
        alliance_stats: Dict[str, Dict[str, float]] = {
            "ROJO": {"auto_tele": 0.0, "fouls_committed": 0.0, "swarm_pts": 0.0, "hive_g": 0.0},
            "AZUL": {"auto_tele": 0.0, "fouls_committed": 0.0, "swarm_pts": 0.0, "hive_g": 0.0},
        }

        for alianza, tid, scouter_offset in slots:
            p = profiles[tid]
            team_appearance_count[tid] += 1
            app_idx = team_appearance_count[tid]
            total_app = team_total_in_played[tid]

            ts_str = (match_dt + timedelta(seconds=scouter_offset * 14)).strftime("%d/%m/%Y, %H:%M:%S")
            scouter = SCOUTERS[(m_num + scouter_offset) % len(SCOUTERS)]

            pos_choices = list(p["pos"])
            if alianza in used_pos_by_alliance and used_pos_by_alliance[alianza] == pos_choices[0] and len(pos_choices) > 1 and rng.random() < 0.8:
                start_pos = pos_choices[1]
            else:
                start_pos = pos_choices[0] if rng.random() < 0.72 else pos_choices[-1]
            used_pos_by_alliance[alianza] = start_pos

            # Casos especiales de confiabilidad para validar reglas reales en Timestone
            if p.get("early_noshow") and app_idx == 1:
                status = "No se presentó"
            elif p.get("early_dc") and app_idx == 1:
                status = "Desconectado/Inmóvil"
            elif p.get("recent_dc") and app_idx == total_app:
                status = "Desconectado/Inmóvil"
            elif rng.random() < 0.04:
                status = "Falla Mecánica Parcial"
            else:
                status = "100% Operativo"

            if status in {"No se presentó", "Desconectado/Inmóvil"}:
                auto_leave = status != "No se presentó" and rng.random() < 0.35
                auto_park = False
                ah_p = ah_n = af_p = af_n = 0
                th_p = th_n = tf_p = tf_n = 0
                prop_flor = 0
                bot_nect = False
                gar_p = 0
                gar_def = False
                end_park = False
                f_min = 0
                f_maj = 0
                card = "Ninguna"
                drv = max(1, min(5, int(round(p["drv"] - 1.5))))
                note = "Robot desconectado tras arranque" if status == "Desconectado/Inmóvil" else "No salió a cancha"
            else:
                scale = 0.65 if status == "Falla Mecánica Parcial" else 1.0
                auto_leave = bool(rng.random() < p["leave"])
                auto_park = bool(auto_leave and rng.random() < p["apark"])
                ah_p = _poisson_nonneg(rng, p["ah_p"] * scale)
                ah_n = _poisson_nonneg(rng, p["ah_n"] * scale)
                af_p = _poisson_nonneg(rng, p["af_p"] * scale)
                af_n = _poisson_nonneg(rng, p["af_n"] * scale)
                th_p = _poisson_nonneg(rng, p["th_p"] * scale)
                th_n = _poisson_nonneg(rng, p["th_n"] * scale)
                tf_p = _poisson_nonneg(rng, p["tf_p"] * scale)
                tf_n = _poisson_nonneg(rng, p["tf_n"] * scale)

                if remaining_flowers_field > 0 and (af_n + tf_n > 0 or rng.random() < p["fl_own"] * 0.5):
                    wants = 2 if (tf_p + tf_n >= 4 and rng.random() < p["fl_own"]) else (1 if rng.random() < p["fl_own"] else 0)
                    prop_flor = min(remaining_flowers_field, wants)
                    remaining_flowers_field -= prop_flor
                else:
                    prop_flor = 0

                bot_nect = bool(rng.random() < p["bot"])
                gar_p = _poisson_nonneg(rng, p["gar"] * scale)
                gar_def = bool(rng.random() < p["def"])
                end_park = bool(rng.random() < p["epark"] * scale)
                f_min = 1 if rng.random() < p["f_min"] else 0
                f_maj = 1 if rng.random() < p["f_maj"] else 0
                card = "Amarilla" if f_maj > 0 and rng.random() < 0.35 else "Ninguna"
                drv = int(np.clip(round(rng.normal(p["drv"], 0.45)), 1, 5))
                note = p["tag"] if rng.random() < 0.4 else ("Atorado 8s con pieza" if status == "Falla Mecánica Parcial" else "")

            # Puntajes oficiales BIOBUZZ idénticos a Naunarok/src/app/page.tsx
            auto_pts = (3 if auto_leave else 0) + (5 if auto_park else 0) + (ah_p + ah_n + af_p + af_n) * 2
            flower_mult = 2 if prop_flor > 0 else 0
            tele_pts = (
                (th_p + th_n) * 2
                + (tf_p + tf_n) * flower_mult
                + (5 if bot_nect else 0)
                + gar_p
                + (5 if end_park else 0)
            )
            fouls_pts = f_min * 5 + f_maj * 20
            net_pts = max(0, auto_pts + tele_pts - fouls_pts)

            swarm_robot = (3 if auto_leave else 0) + (5 if auto_park else 0) + (5 if end_park else 0)
            hive_g_robot = (ah_p + th_p) * 55 + (ah_n + th_n) * 90
            alliance_stats[alianza]["auto_tele"] += auto_pts + tele_pts
            alliance_stats[alianza]["fouls_committed"] += fouls_pts
            alliance_stats[alianza]["swarm_pts"] += swarm_robot
            alliance_stats[alianza]["hive_g"] += hive_g_robot

            captura_rows.append({
                "Timestamp": ts_str,
                "MATCH": m_num,
                "EQUIPO": tid,
                "ALIANZA": alianza,
                "SCOUT": scouter,
                "POSICIÓN INICIAL": start_pos,
                "AUTO LEAVE": "SI" if auto_leave else "NO",
                "AUTO PARK": "SI" if auto_park else "NO",
                "AUTO HIVE POLLEN": ah_p,
                "AUTO HIVE NÉCTAR": ah_n,
                "AUTO FLOR POLLEN": af_p,
                "AUTO FLOR NÉCTAR": af_n,
                "TELE HIVE POLLEN": th_p,
                "TELE HIVE NÉCTAR": th_n,
                "PROPIEDAD FLOR": prop_flor,
                "TELE FLOR POLLEN": tf_p,
                "TELE FLOR NÉCTAR": tf_n,
                "BOTTOM NÉCTAR": "SI" if bot_nect else "NO",
                "GARDEN PIEZAS": gar_p,
                "DEFENSA GARDEN": "SI" if gar_def else "NO",
                "ENDGAME PARK": "SI" if end_park else "NO",
                "ESTATUS ROBOT": status,
                "FALTAS MENORES": f_min,
                "FALTAS GRAVES": f_maj,
                "TARJETAS": card,
                "PILOTO": drv,
                "NOTAS": note,
                "Auto Pts": auto_pts,
                "TeleOp Pts": tele_pts,
                "Faltas Pts": fouls_pts,
                "Puntos Netos": net_pts,
            })

        red_np = int(round(alliance_stats["ROJO"]["auto_tele"]))
        blue_np = int(round(alliance_stats["AZUL"]["auto_tele"]))
        red_tot = red_np + int(round(alliance_stats["AZUL"]["fouls_committed"]))
        blue_tot = blue_np + int(round(alliance_stats["ROJO"]["fouls_committed"]))
        red_tips = alliance_stats["ROJO"]["hive_g"] / 455.0
        blue_tips = alliance_stats["AZUL"]["hive_g"] / 455.0
        red_win_rp = 3 if red_tot > blue_tot else (1 if red_tot == blue_tot else 0)
        blue_win_rp = 3 if blue_tot > red_tot else (1 if red_tot == blue_tot else 0)
        red_rp = red_win_rp + (1 if alliance_stats["ROJO"]["swarm_pts"] >= 16 else 0) + (1 if red_tips >= 4 else 0) + (1 if red_tips >= 7 else 0)
        blue_rp = blue_win_rp + (1 if alliance_stats["AZUL"]["swarm_pts"] >= 16 else 0) + (1 if blue_tips >= 4 else 0) + (1 if blue_tips >= 7 else 0)

        m_idx = matches_df.index[matches_df["match_code"] == m_num]
        matches_df.loc[m_idx, "actual_red_np"] = red_np
        matches_df.loc[m_idx, "actual_blue_np"] = blue_np
        matches_df.loc[m_idx, "actual_red_score"] = red_tot
        matches_df.loc[m_idx, "actual_blue_score"] = blue_tot
        matches_df.loc[m_idx, "actual_red_rp"] = red_rp
        matches_df.loc[m_idx, "actual_blue_rp"] = blue_rp

    captura_df = pd.DataFrame(captura_rows)
    return captura_df, teams_df, matches_df


def _write_tab_preserving_headers(spreadsheet: Any, tab_name: str, df: pd.DataFrame) -> None:
    """Sobrescribe filas de datos en una pestaña manteniendo su estructura de columnas."""
    from gspread_dataframe import set_with_dataframe

    try:
        ws = spreadsheet.worksheet(tab_name)
        existing_headers = ws.row_values(1)
        if existing_headers:
            for col in existing_headers:
                if col not in df.columns:
                    df[col] = ""
            df = df[existing_headers]
        ws.clear()
    except Exception:
        ws = spreadsheet.add_worksheet(title=tab_name, rows=len(df) + 20, cols=len(df.columns) + 5)

    set_with_dataframe(ws, df, resize=True)
    print(f"[OK] '{tab_name}' actualizada con {len(df)} filas.")


def _clear_tab_keep_header(spreadsheet: Any, tab_name: str) -> None:
    """Limpia los datos de una pestaña conservando intacta la fila 1 de encabezados."""
    try:
        ws = spreadsheet.worksheet(tab_name)
        header = ws.row_values(1)
        ws.clear()
        if header:
            ws.update("A1", [header])
        print(f"[CLEAR] '{tab_name}' limpiada (encabezados conservados).")
    except Exception as exc:
        print(f"[SKIP] No se limpió '{tab_name}': {exc}")


def main(argv: List[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Generador de torneo completo realista BIOBUZZ 2026-2027")
    parser.add_argument("--event", default="MXTLQ", help="Código de evento para las pestañas de Timestone.")
    parser.add_argument("--played", type=int, default=30, help="Matches jugados y escouteados (default: 30 de 36).")
    parser.add_argument("--rounds", type=int, default=6, help="Rondas de calificación (default: 6 -> 36 matches).")
    parser.add_argument("--seed", type=int, default=2026, help="Semilla aleatoria reproducible.")
    parser.add_argument("--upload", action="store_true", help="Sube Captura_BIOBUZZ, Equipos y Matches a Google Sheets.")
    parser.add_argument("--run-timestone", action="store_true", help="Ejecuta Timestone v2 tras subir datos.")
    parser.add_argument("--clear", action="store_true", help="Limpia datos de prueba conservando encabezados.")
    parser.add_argument("--dry-run", action="store_true", help="Solo muestra resumen local sin tocar Google Sheets.")
    args = parser.parse_args(argv)

    if args.clear:
        gc = ts.authenticate_gspread()
        ss = ts.open_spreadsheet(gc, sheet_id=ts.SHEET_ID, sheet_name=ts.SHEET_NAME)
        for tab in (
            "Captura_BIOBUZZ",
            "Pit_BIOBUZZ",
            "Pit_Fotos",
        ):
            _clear_tab_keep_header(ss, tab)
        existing_titles = {ws.title for ws in ss.worksheets()}
        for tab in (
            "Equipos",
            "Matches",
            f"Matches_{args.event}",
            f"Ranking_EPA_{args.event}",
            f"Equipos_Simulados_{args.event}",
            f"Simulacion_Matches_{args.event}",
            f"Rojo_Alianza_{args.event}",
            f"Azul_Alianza_{args.event}",
            f"Standings_Proy_{args.event}",
        ):
            if tab in existing_titles:
                try:
                    ss.del_worksheet(ss.worksheet(tab))
                    print(f"[DEL] '{tab}' eliminada.")
                except Exception as exc:
                    print(f"[SKIP] No se eliminó '{tab}': {exc}")
        return

    archetypes = load_real_event_archetypes(args.event, season=2026)
    captura_df, teams_df, matches_df = generate_tournament_data(
        played_matches=args.played,
        total_rounds=args.rounds,
        seed=args.seed,
        archetypes=archetypes,
    )
    pit_df = build_pit_dataframe(archetypes, count=12)
    print(
        f"[GEN] Evento {args.event} | Equipos: {len(teams_df)} | Matches totales: {len(matches_df)} | "
        f"Captura_BIOBUZZ: {len(captura_df)} | Pit_BIOBUZZ: {len(pit_df)}"
    )

    if args.dry_run or not args.upload:
        norm_df = ts._rename_with_aliases(captura_df.copy(), ts.SCOUTING_COLUMN_ALIASES)
        norm_df["MATCH"] = norm_df["MATCH"].apply(ts.normalise_match_id).astype(int)
        ranking_df, _, sim_matches_df, _, _, standings_df = ts.build_export_tables(
            args.event, norm_df, teams_df, matches_df, n_sims=1000, seed=args.seed
        )
        print("\n=== TOP 8 RANKING EPA (SIMULACIÓN LOCAL) ===")
        print(ranking_df.head(8)[["Rank_EPA", "Team ID", "Nombre", "Matches", "EPA", "EPA_Operativo", "OPR", "DPR", "CCWM", "Confiabilidad %"]].to_string(index=False))
        print("\n=== TOP 8 STANDINGS PROYECTADOS ===")
        print(standings_df.head(8)[["Rank_Proyectado", "Team ID", "Nombre", "PJ_Jugados", "PJ_Restantes", "RP_Promedio", "Score_Promedio", "Prob_Top4_Pct"]].to_string(index=False))
        print("\n=== ÚLTIMOS 6 MATCHES PENDIENTES (#31-#36) ===")
        print(sim_matches_df.tail(6)[["Match", "RED1", "RED2", "BLUE1", "BLUE2", "Red Est", "Blue Est", "Red Win %", "Blue Win %", "Red RPs Est", "Blue RPs Est"]].to_string(index=False))
        return

    gc = ts.authenticate_gspread()
    ss = ts.open_spreadsheet(gc, sheet_id=ts.SHEET_ID, sheet_name=ts.SHEET_NAME)
    _write_tab_preserving_headers(ss, "Captura_BIOBUZZ", captura_df)
    _write_tab_preserving_headers(ss, "Pit_BIOBUZZ", pit_df)
    _write_tab_preserving_headers(ss, f"Matches_{args.event}", matches_df)

    if args.run_timestone:
        ts.run_pipeline(
            event_code=args.event,
            sheet_id=ts.SHEET_ID,
            sheet_name=ts.SHEET_NAME,
            upload=True,
            use_ftcscout=True,
        )


if __name__ == "__main__":
    main()
