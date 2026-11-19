# The Beyonder • FTC BIOBUZZ (2026–2027)

Dashboard de telemetría avanzada, picklist, simulador Monte Carlo (Timestone) y proyecciones de Standings conectado en vivo a Google Sheets (`Resumen_Equipos`, `Captura_BIOBUZZ` y las 6 pestañas `*_EVENT` de Timestone) y FTCScout.

## Variables de entorno en Vercel
- `GOOGLE_SHEET_ID`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `TIMESTONE_EVENT` *(opcional, ej. `MXTO`)*
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
  .venv/bin/python timestone_ftc_2026_2027_v2.py --event MXTO
  .venv/bin/pytest -v tests/test_timestone.py
  ```
