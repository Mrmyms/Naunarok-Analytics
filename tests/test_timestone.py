"""Pruebas unitarias e integración en memoria para Timestone FTC 2026-2027."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import timestone_ftc_2026_2027_v2 as ts


def _make_scouting_row(**overrides) -> dict:
    base = {
        "MATCH": 1,
        "EQUIPO": 4010,
        "ALIANZA": "ROJO",
        "POS INICIAL": "A",
        "AUTO LEAVE": "SI",
        "AUTO PARK": "NO",
        "AUTO HIVE POLEN": 0,
        "AUTO HIVE NÉCTAR": 0,
        "AUTO FLOR POLEN": 0,
        "AUTO FLOR NÉCTAR": 0,
        "TELE HIVE POLEN": 0,
        "TELE HIVE NÉCTAR": 0,
        "TELE FLOR POLEN": 0,
        "TELE FLOR NÉCTAR": 0,
        "PROPIEDAD FLOR": 0,
        "BOTTOM NÉCTAR": "NO",
        "GARDEN PIEZAS": 0,
        "ENDGAME PARK": "SI",
        "ESTATUS ROBOT": "100% Operativo",
        "FALTAS MENORES": 0,
        "FALTAS GRAVES": 0,
    }
    base.update(overrides)
    return base


class TestNormalisersAndHelpers:
    def test_normalise_match_id_handles_floats_and_strings(self):
        assert ts.normalise_match_id(3.0) == 3
        assert ts.normalise_match_id("14.0") == 14
        assert ts.normalise_match_id("Q-3") == 3
        assert ts.normalise_match_id("QM09") == 9
        assert ts.normalise_match_id(None) is None
        assert ts.normalise_match_id(float("nan")) is None
        assert ts.normalise_match_id("nan") is None

    def test_to_numeric_safe_never_returns_nan(self):
        assert ts.to_numeric_safe("") == 0.0
        assert ts.to_numeric_safe(None) == 0.0
        assert ts.to_numeric_safe(float("nan")) == 0.0
        assert ts.to_numeric_safe("abc", default=5.0) == 5.0
        assert ts.to_numeric_safe("12.5") == 12.5

    def test_parse_flower_ownership_supports_numeric_and_text(self):
        assert ts.parse_flower_ownership(0) == 0
        assert ts.parse_flower_ownership("3") == 3
        assert ts.parse_flower_ownership("4") == 4
        assert ts.parse_flower_ownership(9) == 4
        assert ts.parse_flower_ownership("2 FLORES") == 2
        assert ts.parse_flower_ownership("CONTROLÓ FLOR") == 1
        assert ts.parse_flower_ownership("NINGUNA") == 0

    def test_normalise_start_pos_avoids_substring_false_positives(self):
        assert ts.normalise_start_pos("A") == "A"
        assert ts.normalise_start_pos("Zona C") == "C"
        assert ts.normalise_start_pos("D6") == "A"
        assert ts.normalise_start_pos("C1") == "A"
        assert ts.normalise_start_pos("AREA") == "NONE"
        assert ts.normalise_start_pos("RED") == "NONE"
        assert ts.normalise_start_pos("Sin pos.") == "NONE"


class TestMatchScoringAndReliability:
    def test_auto_flower_scores_in_auto_and_hive_carryover_tips_in_tele(self):
        # Auto: Leave(3) + 2 Auto Flor(4) + 4 Auto Hive Nectar (360g -> 0 tip, 8 pts) = 15 pts
        # Tele: 1 Tele Hive Nectar (90g -> 450g total, aún <455g) vs 2 Tele Hive Nectar (180g -> 540g -> 1 Tip = 20 pts, 4 cell pts)
        row = pd.Series(
            _make_scouting_row(
                AUTO_LEAVE="SI",
                **{
                    "AUTO LEAVE": "SI",
                    "AUTO FLOR POLEN": 1,
                    "AUTO FLOR NÉCTAR": 1,
                    "AUTO HIVE NÉCTAR": 4,   # 360g -> 8 pts, 0 tip
                    "TELE HIVE NÉCTAR": 2,   # +180g = 540g -> 1 tip (20 pts) + 4 pts
                    "TELE FLOR POLEN": 2,    # 4 pts
                    "GARDEN PIEZAS": 3,      # 3 pts
                    "ENDGAME PARK": "SI",    # 5 pts
                    "FALTAS MENORES": 1,     # 5 pts
                },
            )
        )
        res = ts._evaluate_match_row(row)
        assert res["auto_pts"] == pytest.approx(3 + 4 + 8)
        assert res["tele_pts"] == pytest.approx(20 + 4 + 4 + 3)
        assert res["end_pts"] == pytest.approx(5)
        assert res["total_tips"] == 1.0
        assert res["fouls_pts"] == 5.0

    def test_old_failure_excluded_after_recovery_window(self):
        # Match 1: Desconectado (0 pts), Matches 2..4: 100% Operativo (30 pts c/u)
        # Fuera de últimos 3 matches y con 3 operativos después -> Match 1 debe excluirse
        rows = [
            _make_scouting_row(MATCH=1, **{"ESTATUS ROBOT": "Desconectado/Inmóvil", "AUTO LEAVE": "NO", "ENDGAME PARK": "NO"}),
            _make_scouting_row(MATCH=2, **{"TELE HIVE POLEN": 5, "GARDEN PIEZAS": 12}),
            _make_scouting_row(MATCH=3, **{"TELE HIVE POLEN": 5, "GARDEN PIEZAS": 12}),
            _make_scouting_row(MATCH=4, **{"TELE HIVE POLEN": 5, "GARDEN PIEZAS": 12}),
        ]
        scouting_df = pd.DataFrame(rows)
        teams_df = pd.DataFrame([{"Team ID": 4010, "Names": "Nautilus"}])

        profile = ts.simulate_robot("MXTO", 4010, scouting_df, teams_df)
        assert profile["matches_played"] == 3
        assert profile["excluded_old_failures"] == 1
        assert profile["reliability_pct"] == 100.0
        assert profile["failure_prob"] == 0.0
        assert profile["EPA"] == profile["epa_operational"]
        assert profile["EPA"] > 25.0

    def test_recent_failure_is_retained_and_affects_reliability_and_mc(self):
        # Match 1..2 Operativos, Match 3 Desconectado -> dentro de últimos 3 matches -> SE CONSERVA
        rows = [
            _make_scouting_row(MATCH=1, **{"TELE HIVE POLEN": 5, "GARDEN PIEZAS": 10}),
            _make_scouting_row(MATCH=2, **{"TELE HIVE POLEN": 5, "GARDEN PIEZAS": 10}),
            _make_scouting_row(MATCH=3, **{"ESTATUS ROBOT": "Desconectado/Inmóvil", "AUTO LEAVE": "NO", "ENDGAME PARK": "NO"}),
        ]
        scouting_df = pd.DataFrame(rows)
        teams_df = pd.DataFrame([{"Team ID": 4010, "Names": "Nautilus"}])

        profile = ts.simulate_robot("MXTO", 4010, scouting_df, teams_df)
        assert profile["matches_played"] == 3
        assert profile["excluded_old_failures"] == 0
        assert profile["reliability_pct"] < 70.0
        assert profile["failure_prob"] > 0.3
        assert profile["EPA"] < profile["epa_operational"]

    def test_no_show_is_excluded_from_technical_performance(self):
        rows = [
            _make_scouting_row(MATCH=1, **{"ESTATUS ROBOT": "No se presentó", "AUTO LEAVE": "NO", "ENDGAME PARK": "NO"}),
            _make_scouting_row(MATCH=2, **{"TELE HIVE POLEN": 5, "GARDEN PIEZAS": 10}),
        ]
        scouting_df = pd.DataFrame(rows)
        teams_df = pd.DataFrame([{"Team ID": 4010, "Names": "Nautilus"}])

        profile = ts.simulate_robot("MXTO", 4010, scouting_df, teams_df)
        assert profile["no_show_matches"] == 1
        assert profile["matches_played"] == 1
        assert profile["reliability_pct"] == 100.0

    def test_temporal_weight_sorts_out_of_order_matches(self):
        # Match 10 viene primero en el DataFrame (más alto), Match 1 viene al final
        rows = [
            _make_scouting_row(MATCH=10, **{"GARDEN PIEZAS": 20}),
            _make_scouting_row(MATCH=1, **{"GARDEN PIEZAS": 0}),
        ]
        scouting_df = pd.DataFrame(rows)
        teams_df = pd.DataFrame([{"Team ID": 4010, "Names": "Nautilus"}])

        profile = ts.simulate_robot("MXTO", 4010, scouting_df, teams_df)
        # Match 10 debe recibir peso 2 y Match 1 peso 1 -> tele_est más cercano a 20
        assert profile["tele_est"] >= 13


class TestFTCScoutAndMonteCarloPipeline:
    def test_ftcscout_parser_and_hybrid_standings(self):
        sample_event = {
            "code": "MXTO",
            "name": "Regional Test",
            "season": 2026,
            "teams": [
                {"teamNumber": 1001, "team": {"number": 1001, "name": "Alpha"}},
                {"teamNumber": 1002, "team": {"number": 1002, "name": "Beta"}},
                {"teamNumber": 1003, "team": {"number": 1003, "name": "Gamma"}},
                {"teamNumber": 1004, "team": {"number": 1004, "name": "Delta"}},
            ],
            "matches": [
                {
                    "id": 1,
                    "matchNum": 1,
                    "tournamentLevel": "Quals",
                    "hasBeenPlayed": True,
                    "teams": [
                        {"teamNumber": 1001, "alliance": "Red", "station": "One", "surrogate": False},
                        {"teamNumber": 1002, "alliance": "Red", "station": "Two", "surrogate": True},
                        {"teamNumber": 1003, "alliance": "Blue", "station": "One", "surrogate": False},
                        {"teamNumber": 1004, "alliance": "Blue", "station": "Two", "surrogate": False},
                    ],
                    "scores": {
                        "red": {"totalPoints": 80, "totalPointsNp": 80, "tips": 4, "swarmRp": True, "pollinator1Rp": True, "pollinator2Rp": False},
                        "blue": {"totalPoints": 40, "totalPointsNp": 40, "tips": 1, "swarmRp": False, "pollinator1Rp": False, "pollinator2Rp": False},
                    },
                },
                {
                    "id": 2,
                    "matchNum": 2,
                    "tournamentLevel": "Quals",
                    "hasBeenPlayed": False,
                    "teams": [
                        {"teamNumber": 1001, "alliance": "Red", "station": "One", "surrogate": False},
                        {"teamNumber": 1003, "alliance": "Red", "station": "Two", "surrogate": False},
                        {"teamNumber": 1002, "alliance": "Blue", "station": "One", "surrogate": False},
                        {"teamNumber": 1004, "alliance": "Blue", "station": "Two", "surrogate": False},
                    ],
                    "scores": None,
                },
            ],
        }

        teams_df = ts._parse_ftcscout_teams(sample_event)
        matches_df = ts._parse_ftcscout_matches(sample_event)

        assert len(teams_df) == 4
        assert len(matches_df) == 2
        assert bool(matches_df.loc[0, "has_been_played"]) is True
        assert int(matches_df.loc[0, "actual_red_rp"]) == 5  # Win(3) + Swarm(1) + Poll1(1)
        assert int(matches_df.loc[0, "actual_blue_rp"]) == 0

        scouting_df = pd.DataFrame([
            _make_scouting_row(MATCH=1, EQUIPO=1001, **{"TELE HIVE NÉCTAR": 6, "TELE FLOR NÉCTAR": 3, "PROPIEDAD FLOR": 2}),
            _make_scouting_row(MATCH=1, EQUIPO=1002, **{"TELE HIVE POLEN": 4}),
            _make_scouting_row(MATCH=1, EQUIPO=1003, **{"GARDEN PIEZAS": 5}),
            _make_scouting_row(MATCH=1, EQUIPO=1004, **{"GARDEN PIEZAS": 2}),
        ])

        ranking_df, df_robots, sim_matches_df, df_red, df_blue, df_standings = ts.build_export_tables(
            "MXTO", scouting_df, teams_df, matches_df, n_sims=500, seed=42
        )

        assert not ranking_df.empty
        assert "Updated_At" in ranking_df.columns
        assert len(sim_matches_df) == 2

        # Probabilidades de victoria deben sumar ~100%
        for _, row in sim_matches_df.iterrows():
            total_p = row["Red Win %"] + row["Blue Win %"] + row["Tie %"]
            assert total_p == pytest.approx(100.0, abs=0.2)

        # Equipo 1002 fue surrogate en Match 1 -> 0 PJ_Jugados, 0 RPs_Reales
        s1002 = df_standings.loc[df_standings["Team ID"] == 1002].iloc[0]
        assert int(s1002["PJ_Jugados"]) == 0
        assert int(s1002["PJ_Restantes"]) == 1
        assert int(s1002["RPs_Reales"]) == 0

        # Equipo 1001 jugó Match 1 real y ganó 5 RPs
        s1001 = df_standings.loc[df_standings["Team ID"] == 1001].iloc[0]
        assert int(s1001["PJ_Jugados"]) == 1
        assert int(s1001["RPs_Reales"]) == 5
        assert 0.0 <= float(s1001["Prob_Top4_Pct"]) <= 100.0

    def test_spanish_captura_biobuzz_aliases_and_auto_conflict(self):
        raw_df = pd.DataFrame([
            {
                "Timestamp": "18/11/2026",
                "Match #": "1.0",
                "Equipo #": 4010,
                "Alianza": "ROJO",
                "Posición Inicio": "A",
                "Auto Leave": "SI",
                "Auto Park": "NO",
                "Auto Balancín Polen": 1,
                "Auto Balancín Néctar": 0,
                "Auto Flor Polen": 1,
                "Auto Flor Néctar": 0,
                "TeleOp Balancín Polen": 0,
                "TeleOp Balancín Néctar": 3,
                "Propiedad Flor (0-4)": 2,
                "TeleOp Flor Polen": 1,
                "TeleOp Flor Néctar": 1,
                "Bottom Nectar": "SI",
                "Garden Piezas": 2,
                "Endgame Park": "SI",
                "Estatus Robot": "100% Operativo",
                "Faltas Menores": 0,
                "Faltas Graves": 0,
            },
            {
                "Timestamp": "18/11/2026",
                "Match #": "1.0",
                "Equipo #": 5000,
                "Alianza": "ROJO",
                "Posición Inicio": "A",
                "Auto Leave": "SI",
                "Auto Park": "NO",
                "Auto Balancín Polen": 0,
                "Auto Balancín Néctar": 0,
                "Auto Flor Polen": 0,
                "Auto Flor Néctar": 0,
                "TeleOp Balancín Polen": 0,
                "TeleOp Balancín Néctar": 0,
                "Propiedad Flor (0-4)": 0,
                "TeleOp Flor Polen": 0,
                "TeleOp Flor Néctar": 0,
                "Bottom Nectar": "NO",
                "Garden Piezas": 4,
                "Endgame Park": "NO",
                "Estatus Robot": "100% Operativo",
                "Faltas Menores": 0,
                "Faltas Graves": 0,
            },
        ])
        norm = ts._rename_with_aliases(raw_df, ts.SCOUTING_COLUMN_ALIASES)
        norm["MATCH"] = norm["MATCH"].apply(ts.normalise_match_id).astype(int)
        teams_df = pd.DataFrame([
            {"Team ID": 4010, "Names": "Nautilus"},
            {"Team ID": 5000, "Names": "Partner"},
        ])
        alliance_score, _ = ts.simulate_alliance("MXTO", 4010, 5000, "RED", norm, teams_df)
        assert alliance_score["color"] == "RED"
        assert alliance_score["auto_conflict"] == "SI"
        assert alliance_score["alliance_top_nectar"] == "SI"
        assert alliance_score["score_est_total"] > 20


class TestOprDprEngine:
    def test_compute_event_opr_dpr_exact_recovery(self):
        # 4 equipos con OPR exactos [30, 20, 15, 10] y DPR exactos [5, 15, 20, 25]
        # En cada match: Score propio = sum(OPR alianza), Score rival = sum(DPR alianza)
        # Esperar 3 partidos linealmente independientes para determinar exactamente los 4 equipos
        # M1: (1,2) vs (3,4) -> Red=50, Blue=25? Mejor usar DPR = puntos que permite la alianza:
        # Si Red tiene equipos (1,2), permite sum(DPR_red) = 5+15 = 20 = BlueScore!
        # Y si Blue tiene (3,4), suma OPR_blue = 25? Para que ambos sean consistentes:
        # En M1 (1,2) vs (3,4): Red=50, Blue=25; M2 (1,3) vs (2,4): Red=45, Blue=30; M3 (1,4) vs (2,3): Red=40, Blue=35
        # Verifiquemos: DPR equipo k = promedio permitido en sus partidos:
        # Equipo 1 permite: 25 (con 2), 30 (con 3), 35 (con 4) -> promedio = 30
        matches_df = pd.DataFrame([
            {
                "match_code": 1, "tournament_level": "Quals", "has_been_played": True,
                "RED1": 1001, "RED2": 1002, "BLUE1": 1003, "BLUE2": 1004,
                "actual_red_np": 50, "actual_blue_np": 25,
                "actual_red_score": 50, "actual_blue_score": 25,
            },
            {
                "match_code": 2, "tournament_level": "Quals", "has_been_played": True,
                "RED1": 1001, "RED2": 1003, "BLUE1": 1002, "BLUE2": 1004,
                "actual_red_np": 45, "actual_blue_np": 30,
                "actual_red_score": 45, "actual_blue_score": 30,
            },
            {
                "match_code": 3, "tournament_level": "Quals", "has_been_played": True,
                "RED1": 1001, "RED2": 1004, "BLUE1": 1002, "BLUE2": 1003,
                "actual_red_np": 40, "actual_blue_np": 35,
                "actual_red_score": 40, "actual_blue_score": 35,
            },
        ])
        od = ts.compute_event_opr_dpr(matches_df, [1001, 1002, 1003, 1004])
        assert od[1001]["opr"] == pytest.approx(30.0, abs=0.05)
        assert od[1002]["opr"] == pytest.approx(20.0, abs=0.05)
        assert od[1003]["opr"] == pytest.approx(15.0, abs=0.05)
        assert od[1004]["opr"] == pytest.approx(10.0, abs=0.05)

        assert od[1001]["rank_off"] == 1
        assert od[1004]["rank_off"] == 4
        # Solución exacta: d1+d2=25, d1+d3=30, d1+d4=35, sum=75 -> d=[7.5, 17.5, 22.5, 27.5]
        assert od[1001]["dpr"] == pytest.approx(7.5, abs=0.05)
        assert od[1004]["dpr"] == pytest.approx(27.5, abs=0.05)
        assert od[1001]["rank_def"] == 1
        assert od[1001]["ccwm"] == pytest.approx(22.5, abs=0.05)
        assert od[1001]["rank_comb_avg"] == 1.0

        # Verificar columnas nuevas en ranking_df de build_export_tables
        scouting_df = pd.DataFrame([_make_scouting_row(MATCH=1, EQUIPO=1001)])
        teams_df = pd.DataFrame([{"Team ID": t, "Names": f"T{t}"} for t in (1001, 1002, 1003, 1004)])
        ranking_df, *_ = ts.build_export_tables("MXTO", scouting_df, teams_df, matches_df, n_sims=50, seed=1)
        for col in ("OPR", "DPR", "CCWM", "Rank_Ofensivo", "Rank_Defensivo", "Rank_OPR_DPR_Prom"):
            assert col in ranking_df.columns

    def test_compute_event_opr_dpr_empty_when_no_played_matches(self):
        unplayed = pd.DataFrame([
            {
                "match_code": 1, "tournament_level": "Quals", "has_been_played": False,
                "RED1": 1001, "RED2": 1002, "BLUE1": 1003, "BLUE2": 1004,
            }
        ])
        assert ts.compute_event_opr_dpr(unplayed, [1001, 1002, 1003, 1004]) == {}
