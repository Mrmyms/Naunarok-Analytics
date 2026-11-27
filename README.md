# The Beyonder • FTC BIOBUZZ (2026–2027)

Dashboard de telemetría avanzada, ficha técnica de pits + galería de fotos, picklist, simulador Monte Carlo (Timestone) y proyecciones de Standings conectado en vivo a Google Sheets (`Captura_BIOBUZZ_<EVENTO>`, `Pit_BIOBUZZ_<EVENTO>`, `Pit_Fotos_<EVENTO>`, fallback legacy `Captura_BIOBUZZ`/`Pit_BIOBUZZ`/`Pit_Fotos`/`Resumen_Equipos` y pestañas `*_EVENT` de Timestone) y FTCScout.

## Rutas Principales
- `/` (**The Beyonder**):
  - Soporta parámetro directo `?event=<CODIGO>` y conmutación entre múltiples eventos simultáneos (ej. `MXTLQ`, `MXMOQ`, `TEST_A`, `TEST_B`).
  - **Ranking & Picklist**: clasificación compuesta por características (**Tier S/A/B/C** y score 0–100) con 4 perfiles de pesos (`Balanceado`, `Máx. Ofensiva`, `Defensivo`, `Playoffs`), métricas **OPR**, **DPR**, **CCWM**, **Rank Ofensivo**, **Rank Defensivo** y **Rank Promedio OPR–DPR**, rol, confiabilidad, bajas faltas y **`Con Pit`**.
  - **Perfil de Equipo** (reestructurado en 3 secciones):
    1. **Resumen & Pit**: comparativa 1v1 (incluye score compuesto, OPR/DPR/CCWM y pits), desglose de clasificación por 6 características (`Ofensiva`, `Defensa`, `Autónomo`, `Confiabilidad`, `Disciplina`, `Piloto`), galería de fotos del robot con lightbox (`/api/pit/photo?id=...&event=...`), especificaciones estructuradas (`Hardware & Mecánica`, `Autónomo & Software`, `Equipo & Observaciones`), eficiencia y notas de scouters.
    2. **Gráficas & Cancha**: radar BIOBUZZ (con overlay 1v1), distribuciones Balancín vs Flor, tendencia histórica y mapa de calor 6×6 de zonas de inicio `A–E`.
    3. **Bitácora**: historial partido a partido y alertas.
  - **Match 2v2**, **Simulador Alianzas** y **Standings Proy.**.
- `/api/analytics`: agrega la hoja de scouting del evento (`Captura_BIOBUZZ_<EVENTO>` o `Captura_BIOBUZZ`), `Pit_BIOBUZZ_<EVENTO>`, metadatos de `Pit_Fotos_<EVENTO>`, hojas `*_EVENT` de Timestone y cálculo automático de OPR/DPR/CCWM (desde `Ranking_EPA_*` o mediante solver en tiempo real sobre matches jugados).
- `/api/pit/photo?id=...&event=...`: reconstruye y sirve imágenes almacenadas en `Pit_Fotos_<EVENTO>` (con fallback a `Pit_Fotos` y otras pestañas `Pit_Fotos_*`) por fragmentos Base64.
- `/api/timestone/refresh`: ejecuta Timestone en local (`.venv`) o vía GitHub Actions (`timestone-refresh.yml`).

## Variables de entorno en Vercel
- `GOOGLE_SHEET_ID`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `TIMESTONE_EVENT` *(opcional, default `MXTLQ`)*
- `GITHUB_TOKEN` *(token con permiso `actions:write` para disparar `timestone-refresh.yml` desde el botón de Refresh o auto-refresco > 1h)*
- `GITHUB_REPO` *(opcional, default `Mrmyms/Naunarok-Analytics`)*

## Secretos en GitHub Actions (`.github/workflows/timestone-refresh.yml`)
- `GOOGLE_SHEET_ID`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

## Ejecución local / Colab de Timestone
- En Google Colab: ejecutar `timestone_ftc_2026_2027_v2.py` directamente.
- En local:
  ```bash
  .venv/bin/python timestone_ftc_2026_2027_v2.py --event MXTLQ
  .venv/bin/pytest -v tests/test_timestone.py
  ```
