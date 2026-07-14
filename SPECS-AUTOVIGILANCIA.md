# SPECS — Auto-vigilancia (sub-muestreo de ubicación + cron de monitores)

Orden de trabajo cerrada para el loop autónomo (2026-07-14), continuación de la sesión de análisis
de CTO sobre GPS/checkpoints. Estilo `SPECS-7A.md`/`SPECS-COTIZADOR.md`. Protocolo: uno por
iteración, `ci.ps1` verde, commit, `[x]` en ROADMAP + línea en PROGRESS.md. Modelo: `sonnet` bajo.

**Contexto (decisión de CTO ya tomada con el usuario, 2026-07-14):** Telegram Live Location empuja
la posición del chófer cada ~15-60s (push, no polling — no pagamos por preguntar). Hoy
`handle_location` (bot.py:1072) guarda TODOS los pings en `ubicacion` sin sub-muestrear: una
jornada de 9h a un ping/30s son ~1.000 filas/chófer/día — con 60 chóferes, millones de filas al mes
contra un plan gratis de Supabase de 500MB. El patrón correcto es "continuo para detectar, espaciado
para guardar": la detección de geo-llegada (ya existe, línea 1119) sigue evaluando CADA ping
(barato, un haversine); solo la ESCRITURA en `ubicacion` se sub-muestrea.

---

## UBI.1 — Sub-muestreo de escritura en `ubicacion` `[sonnet, bajo]`

- Constantes nuevas en `bot.py`, junto a `UMBRAL_GEO_LLEGADA_M` (línea ~1297):
  `UMBRAL_UBICACION_INTERVALO_S = 120` (no guardar si el último punto de ESE chófer tiene menos de
  2 min) y `UMBRAL_UBICACION_DISTANCIA_M = 200` (salvo que se haya movido más de 200m, entonces se
  guarda igualmente aunque no hayan pasado los 2 min — un giro brusco o parada/arranque importa).
- Nueva función pura `debe_guardar_ubicacion(ultimo_punto, lat, lon, ahora=None)`:
  - `ultimo_punto` = `None` o `{"lat", "lon", "created_at"}` (el más reciente de ESE chófer).
  - Si `ultimo_punto is None` → `True` (primer punto, siempre se guarda).
  - Si han pasado ≥ `UMBRAL_UBICACION_INTERVALO_S` segundos desde `created_at` → `True`.
  - Si `haversine_km(...) * 1000 >= UMBRAL_UBICACION_DISTANCIA_M` respecto al último punto → `True`.
  - Si no, `False`.
  - `ahora` inyectable (testeable sin mockear el reloj real; por defecto `datetime.now(timezone.utc)`).
- En `handle_location`: ANTES del `insert`, consultar el último punto de ese chófer
  (`supabase.table("ubicacion").select("lat, lon, created_at").eq("chofer_id", ...).order(
  "created_at", desc=True).limit(1).execute()`, ya soportado por `tests/fakes.py`). Si
  `debe_guardar_ubicacion(...)` es `False`, NO insertar — pero seguir evaluando la geo-llegada
  proactiva con el `lat`/`lon` del ping actual (la detección nunca se sub-muestrea, solo el guardado).
- Tests (`test_bot.py`): (1) `debe_guardar_ubicacion` pura — sin punto previo→True, <2min y <200m→
  False, ≥2min→True, <2min pero ≥200m→True; (2) `handle_location` con un punto reciente (hace 10s,
  mismo sitio) NO inserta una segunda fila; (3) `handle_location` con un punto de hace 3 min SÍ
  inserta; (4) aunque no se guarde el punto, la pregunta proactiva de geo-llegada sigue disparándose
  si está cerca del hito (reutilizar el fixture de `test_handle_location_pregunta_si_cerca_del_hito_pendiente`
  con un punto previo reciente en `ubicacion`).

## UBI.2 — Workflow de GitHub Actions para los monitores (cron) `[sonnet, bajo]`

- `DEPLOY-PLAN.md` Fase 2 ya especifica esto: GitHub Actions con `schedule:` corriendo
  `monitor_heartbeat.py`/`monitor_integridad.py`/`purgar_ubicacion.py` con los secrets de
  producción. Hoy no existe el archivo del workflow — escribirlo YA no requiere que el despliegue
  exista todavía (el workflow simplemente no se disparará útilmente hasta que los GitHub Secrets
  estén rellenos, pero deja el despliegue "a un clic" como ya hace `DEPLOY.md` con el resto).
- Nuevo `.github/workflows/monitores.yml`: 3 jobs (o 1 job con 3 pasos) en cron separado razonable
  — `monitor_heartbeat.py` cada 15 min, `monitor_integridad.py` cada 6 horas, `purgar_ubicacion.py`
  diario. Cada paso: checkout, setup-python, `pip install -r backend/requirements.txt`, ejecutar
  script con `DATABASE_URL`/`TELEGRAM_BOT_TOKEN` desde `secrets.*` (nombres EXACTOS documentados en
  un comentario al principio del yaml, para que el usuario sepa qué rellenar en
  Settings→Secrets→Actions cuando despliegue).
- Documentar en `DEPLOY-PLAN.md` Fase 2 (actualizar, no reescribir) que el workflow YA EXISTE y
  solo falta rellenar los Secrets — convertir el punto de la lista en un checklist más concreto.
- Sin tests (es config, no código); verificación: `yamllint`-equivalente manual (sintaxis YAML
  válida, revisar visualmente indentación) — no hay linter YAML instalado, revisar a mano con
  cuidado. NO tocar `ci.ps1` (no aplica a un archivo de CI de otro sistema).

---

## FUERA DE ESTE LOOP (siguiente decisión, NO construir sin confirmar)

- **Modelo de checkpoint** (hito `es_checkpoint`+`radio_m`, evento `checkpoint_pasado`, alerta de
  "no cruzado a tiempo"): cambia el modelo de datos de `hito` y añade un concepto nuevo a la UI de
  creación de viaje. Loop-safe en principio, pero se deja fuera de ESTA cola a propósito para que
  el usuario lo revise antes (afecta a más pantallas que UBI.1/UBI.2). Diseño ya esbozado en la
  conversación de CTO del 2026-07-14: reutilizar `hito` (no tabla nueva), detección en
  `handle_location` igual que la geo-llegada.
