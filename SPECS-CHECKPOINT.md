# SPECS — Modelo de checkpoint (parada obligatoria detectada por GPS)

Orden de trabajo cerrada (2026-07-14), diseño acordado con el usuario en la conversación de CTO
del mismo día. Reutiliza `hito` (no tabla nueva). Protocolo: uno por iteración, `ci.ps1` verde,
commit, `[x]` en ROADMAP + línea en PROGRESS.md.

**Alcance deliberadamente acotado:** detección automática + visibilidad. La ALERTA de "checkpoint
no cruzado a tiempo" queda FUERA (decisión de producto — ¿qué es "a tiempo"? ¿ventana? ¿ETA
calculado? — no inventar sin que el usuario lo cierre).

---

## CHK.1 — Migración: `hito.es_checkpoint` + `hito.radio_m` `[sonnet, bajo]`

- `backend/db/migrations/0051_hito_checkpoint.sql`: DDL puro, cabecera de reversión.
  `ALTER TABLE public.hito ADD COLUMN IF NOT EXISTS es_checkpoint boolean NOT NULL DEFAULT false;`
  `ALTER TABLE public.hito ADD COLUMN IF NOT EXISTS radio_m integer;` (nullable — sin configurar,
  el detector usa `UMBRAL_GEO_LLEGADA_M` como fallback, igual criterio que otros umbrales).
- Aplicar con `migrate.py` (no MCP ad-hoc). Verificar Grupo B: columnas existen, `es_checkpoint`
  default `false`, `radio_m` nullable.

## CHK.2 — `createViaje` persiste `es_checkpoint`/`radio_m` `[sonnet, bajo]`

- En `data.js`, el `map` que construye `rows` para el insert de `hito` (dentro de `createViaje`)
  añade `es_checkpoint: !!h.es_checkpoint, radio_m: h.radio_m !== undefined && h.radio_m !== "" && h.radio_m != null ? Number(h.radio_m) : null`.
  Retrocompatible: si el objeto `hito` no trae esos campos (llamadas existentes), `es_checkpoint`
  sale `false` y `radio_m` sale `null` — igual que hoy.
- Test: `createViaje` con un hito `{..., es_checkpoint: true, radio_m: 150}` guarda esas columnas
  tal cual; un hito sin esos campos guarda `false`/`null` (no rompe las llamadas existentes).

## CHK.3 — Formulario `/viajes/nuevo-w`: marcar un hito como checkpoint `[sonnet, bajo]`

- `nuevoHito()` gana `es_checkpoint: false, radio_m: ""`.
- En cada tarjeta de parada del paso 1: checkbox "Punto de control obligatorio" + (solo si está
  marcado) input numérico de radio en metros, placeholder `"por defecto: 300m"`. Mismo patrón
  visual que el resto del formulario (`actualizarHito(i, campo, valor)` ya genérico, reutilizar
  sin tocar su firma).
- Sin tests de UI nuevos (la página no tiene tests hoy, precedente ya establecido en el resto del
  wizard); verificación por `ci.ps1` (build+lint).

## CHK.4 — Detección automática en el bot (`handle_location`) `[sonnet, bajo — puede requerir opus si la integración con el flujo existente no es directa]`

- Constante `UMBRAL_GEO_LLEGADA_M` ya existe como fallback de radio. Nueva función pura
  `punto_en_checkpoint(lat, lon, hito, umbral_default=UMBRAL_GEO_LLEGADA_M)`: `True` si
  `haversine_km(...)*1000 <= (hito.get("radio_m") or umbral_default)`.
- En `handle_location`, DESPUÉS de la lógica de geo-llegada existente (no la sustituye): si hay
  viaje en curso, consultar los hitos de ese viaje con `es_checkpoint = true` (además de los ya
  consultados o en una query separada `.eq("es_checkpoint", True)`), y para cada uno:
  - Si `punto_en_checkpoint(...)` es `True` Y no existe ya un `ejecucion_evento` con
    `tipo = "checkpoint_pasado"` y ese `hito_id` (consulta previa, idempotente — un checkpoint se
    cruza una vez), insertar `ejecucion_evento` (`tipo: "checkpoint_pasado"`, `hito_id`,
    `chofer_id`, `viaje_id`, `detalle`: la dirección del hito). Sin mensaje al chófer (silencioso,
    a diferencia de la pregunta de geo-llegada — un checkpoint no exige confirmación, es
    aseguramiento pasivo).
- Tests (`test_bot.py`): (1) `punto_en_checkpoint` pura — dentro del radio propio→True, fuera→False,
  sin `radio_m` cae al umbral por defecto; (2) `handle_location` con un hito checkpoint cercano
  registra el evento; (3) no lo registra dos veces si ya existe; (4) un hito NO marcado
  `es_checkpoint` no genera este evento aunque esté cerca (no confundir con la pregunta de
  geo-llegada, que sigue funcionando igual, sin relación).

## CHK.5 — Visibilidad en el detalle del viaje `[sonnet, bajo]`

- `/viajes/[id]/page.jsx`: en la lista de hitos (`hitos.map`), si `h.es_checkpoint`, badge junto al
  estado ("🎯 Checkpoint" o similar, texto sobrio) + sub-badge "Cruzado" (verde) si existe un
  evento `checkpoint_pasado` para ese `hito_id` en `eventos` (ya cargado por `getViaje`, sin query
  nueva) o "Pendiente" (neutro) si no. Reutilizar el patrón de badges ya usado en esa lista para
  `ESTADO_HITO`.
- Sin tests nuevos de lógica (es una lectura directa de `eventos` ya testeado en otros sitios);
  verificación por `ci.ps1`.

---

## FUERA DE ESTE LOOP

- **Alerta de checkpoint no cruzado a tiempo.** Necesita decidir "a tiempo respecto a qué" (ventana
  del hito, ETA calculado, hora fija). Anotar como `[DECISIÓN]` en ROADMAP al cerrar esta cola.
- **Editar checkpoints en `/viajes/nuevo` (el formulario simple, sin lat/lon)** — ese formulario no
  captura coordenadas, así que un checkpoint ahí no sería detectable por GPS de todas formas; no
  tiene sentido añadir el checkbox ahí. Solo `/viajes/nuevo-w` (el wizard con mapa).
