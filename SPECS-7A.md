# SPECS Fase 7A — Norenty OS, especificaciones de implementación

Especificaciones "mascadas" de los 14 ítems de la Fase 7A (ver ROADMAP.md para la visión).
Objetivo: que un modelo ejecutor (Sonnet en el loop) implemente cada ítem SIN tomar decisiones
de diseño — todas están tomadas aquí. **Antes de implementar un ítem 7A.x, leer su sección
completa aquí + el preámbulo de convenciones.**

---

## 0. CONVENCIONES DEL REPO (leer siempre — evitan los errores ya cometidos y resueltos)

### 0.1 Migraciones
1. Crear `backend/db/migrations/00NN_nombre.sql` (numeración: la última es 0019
   [`0019_seguridad_columnas.sql`, endurecimiento de GRANT/REVOKE por columna, 2026-07-03]; los
   ítems de esta fase usan **0020–0025**, asignadas abajo: 0020 decision_asignacion (7A.2), 0021
   notificacion_asignacion (7A.3), 0022 coste_desglosado (7A.5), 0023 gasto_viaje (7A.7), 0024
   nota_gestor (7A.10), 0025 token_publico (7A.14)). Comentario de cabecera explicando el
   porqué. **Nota importante para
   7A.3/7A.5/7A.7/7A.14**: la migración 0019 restringió qué columnas puede tocar `authenticated`
   (dashboard) en `gestor`, `chofer`, `ejecucion_evento` y `ubicacion` — ver esa migración antes
   de añadir columnas nuevas a esas tablas o de escribir código que actualice
   `chofer.chat_id`/`gestor.auth_user_id`/`gestor.empresa_id` desde el dashboard (seguirá
   fallando con "permission denied for column X", por diseño). `viaje.chofer_id` y
   `viaje.notificado_asignacion_en` (7A.3) SÍ son escribibles por `authenticated` (no tocados
   por 0019) — sin problema.
2. Aplicar vía MCP `apply_migration` (project_id `hloqddmdwinvjksqkhey`), nombre en snake_case.
3. Registrar checksum:
   `python -c "import hashlib,pathlib; sql=pathlib.Path('backend/db/migrations/00NN_x.sql').read_text(encoding='utf-8'); print(hashlib.sha256(sql.encode('utf-8')).hexdigest())"`
   y luego `execute_sql`: `INSERT INTO schema_migrations (filename, checksum) VALUES ('00NN_x.sql','<hash>') ON CONFLICT (filename) DO NOTHING;`

### 0.2 Trampas de RLS/PostgREST (bugs REALES ya sufridos)
- **NUNCA** `.insert(...).select().single()` sobre una tabla cuya policy SELECT pueda no ver la
  fila recién creada (p. ej. durante bootstrap sin fila `gestor`): Postgres evalúa el RETURNING
  contra la policy SELECT y falla con "new row violates row-level security policy". Solución:
  generar el `id` con `crypto.randomUUID()` en cliente y NO pedir RETURNING. (Bug de signUp,
  commit 0be2356.)
- postgrest-py (backend) pide RETURNING **por defecto** en `insert()` — pasar
  `returning="minimal"` cuando la policy SELECT no aplique. supabase-js (dashboard) NO lo pide
  salvo que encadenes `.select()`.
- Para lecturas públicas/pre-vinculación: función `SECURITY DEFINER` que solo funciona conociendo
  un token/uuid exacto y devuelve SOLO los campos necesarios (patrón `usar_invitacion`, migración
  0018). `GRANT EXECUTE` al rol mínimo necesario.
- Verificar flujos de RLS **contra la BD real** (script python con urllib contra la REST API,
  como en 6.9), no solo con mocks: los mocks no reproducen RLS y ya ocultaron 2 bugs críticos.

### 0.3 Tests
- **Dashboard (vitest)**: mock query-builder en `dashboard/lib/data.test.js` (líneas 1–50).
  Soporta: `select/eq/neq/in/gte/lt/limit/single/insert(→.select().single())/delete().eq()`.
  **`order()` es NO-OP en el mock JS** — si el código depende del orden, ordenar en JS tras la
  query o el test fallará engañosamente. `gte/lt` descartan filas con el campo null.
  OSRM está mockeado (`osrmMock`, default 100 km/tramo; `osrmMock.mockResolvedValue(null)`
  simula caída → fallback Haversine). SESSION/TABLES se resetean en beforeEach.
- **Backend (pytest)**: `tests/fakes.py` — `FakeSupabase` con `order()` REAL (ordena),
  `limit()`, `FakeStorage` (uploads). `tests/test_bot_e2e.py` — arnés E2E con Updates reales de
  PTB: helpers `make_app`, `command_update`, `text_update`, `photo_update`, `callback_update`,
  `ultimo_mensaje_bot`, `mensaje_editado`. Trampas PTB v22 ya resueltas ahí: Bot congelado
  (parchear métodos a nivel de CLASE), `get_me` fake debe setear `self._bot_user`, todo Message
  construido a mano necesita `.set_bot(app.bot)`.
- **NUNCA** editar archivos JS con PowerShell `Set-Content -Encoding UTF8` (añade BOM y rompe la
  resolución de imports de vitest). Usar las herramientas Edit/Write.

### 0.4 CI y commits
- `.\ci.ps1` desde la raíz = pytest + vitest + `next build`. VERDE antes de cada commit.
- Un commit para el código del ítem; otro para docs (marcar `[x]` en ROADMAP + línea en
  PROGRESS.md, formato `fecha | item | commit | HECHO + detalle honesto`).

### 0.5 i18n del bot
`TEXTOS` en `backend/app/bot.py`: es/en/ro/fr completos; ar/it/pt/de alias de en. **Añadir cada
clave nueva a LOS CUATRO diccionarios.** Acceso: `t(chofer_or_idioma, key, **kwargs)`.

### 0.6 Honestidad de datos (política de producto)
Todo dato estimado se etiqueta: "~" + nota visible. Constantes-umbral exportadas con comentario
"valor inicial razonable, NO pactado con cliente real" (patrón `UMBRAL_NOCHE_FUERA_KM`).

### 0.7 Estilo UI
Tailwind con tokens del proyecto: `bg-surface`, `bg-surface-alt`, `border-border`, `text-ink`,
`text-ink-secondary`, `text-ink-muted`, `text-estado-*`, `bg-brand`. Tarjetas:
`bg-surface border border-border rounded-xl p-4/p-5`. Inputs: `focus:outline-none
focus:border-brand focus:ring-2 focus:ring-brand/30` + `<label htmlFor>`+`id`. Contraste: NUNCA
`text-estado-ok` sobre `bg-green-50` en texto pequeño (falla AA) → usar `text-green-700`.
Botones solo-icono llevan `aria-label`. Errores de form con `role="alert"`.

### 0.8 Datos de contexto
- Empresa demo (`seed_demo.py`): login `demo@norenty.com` + `DEMO_PASSWORD` del `.env` — usarla
  para verificar UI contra datos reales. `SUPABASE_SERVICE_ROLE_KEY` está VACÍA (D1 pendiente).
- Constantes existentes en `dashboard/lib/data.js`: `UMBRAL_NOCHE_FUERA_KM=50`,
  `UMBRAL_MARGEN_AMBAR_PCT=10`, `VELOCIDAD_PLANIFICACION_KMH=75`, `FACTOR_SINUOSIDAD_FALLBACK=1.3`,
  `haversineKm(a,b)` (privada), `kmCarreteraViaje(hitos)→{km,estimado}` (OSRM+fallback),
  `calcularEtaConParadas(horas)→{horasTotales,paradas45min,descansos11h}`.
- En `backend/app/bot.py`: `haversine_km(lat1,lon1,lat2,lon2)`, `calcular_eta_con_paradas(h)`,
  `FACTOR_SINUOSIDAD_FALLBACK=1.3`, `VELOCIDAD_PLANIFICACION_KMH_DEFAULT=75`,
  `obtener_ubicacion_chofer(chofer)`, `t()`, `get_chofer_by_chat`, `notificar_gestor_evento`.

---

## 7A.1 — Estado 561 por chófer

**Objetivo:** horas de conducción estimadas 7/14 días por chófer contra límites 56h/90h.
**Sin migración.**

### lib/data.js
```
export const LIMITE_561_SEMANAL_H = 56;   // Reglamento CE 561/2006
export const LIMITE_561_BISEMANAL_H = 90;

// Pura, exportada para tests: km aproximados de un viaje SIN llamar a OSRM
// (Haversine × FACTOR_SINUOSIDAD_FALLBACK entre hitos consecutivos con coords,
// ordenados por `orden`). Para 561 no queremos N llamadas OSRM por chófer.
export function kmAproxViaje(hitos) -> number
```
`export async function getEstado561(choferId, { ahora = new Date() } = {})`:
1. `desde14 = ISO(ahora − 14d)`; query `ejecucion_evento` `.eq("tipo","llegada")
   .eq("chofer_id",choferId).gte("ocurrido_en",desde14)` → llegadas.
2. Si vacío → `{horas7:0, horas14:0, margen7:56, margen14:90, pct7:0, pct14:0, estimado:true}`.
3. `viajeIds7` = set de `viaje_id` con llegada ≥ (ahora−7d); `viajeIds14` = todos.
4. Query `hito` `.in("viaje_id",[...viajeIds14])` con `id,viaje_id,orden,estado,lat,lon`;
   query `empresa` para velocidad (`resolveVelocidadPlanificacion`, ya existe).
5. Por viaje: `km = kmAproxViaje(hitos completados del viaje)`; `horasViaje = km/velocidad`.
   `horas7 = Σ horasViaje de viajeIds7`; `horas14 = Σ de viajeIds14`.
   (Aproximación deliberada: atribuye todas las horas del viaje al periodo de su llegada —
   documentar en comment. Es estimación por km, NO tacógrafo → `estimado: true` siempre.)
6. Return `{horas7, horas14, margen7: max(0, 56−horas7), margen14: max(0, 90−horas14),
   pct7: round(horas7/56*100), pct14: round(horas14/90*100), estimado: true}` con horas a 1 decimal.

### UI
- `/choferes/[id]`: card "Horas de conducción (estimación)" bajo la cabecera: dos barras de
  progreso (patrón `Barra` de analítica): "Semana: X h / 56 h" y "14 días: X h / 90 h". Color de
  barra: `bg-brand` <70%, `bg-yellow-500` 70–90%, `bg-estado-incidencia` >90%. Nota:
  "Estimación por km recorridos, no por tacógrafo."
- Aviso al asignar: en `/viajes/[id]` (editor de chófer) y `/viajes/nuevo` (select chófer): al
  seleccionar, cargar `getEstado561` y si `pct7 >= 80` mostrar chip ámbar
  "⚠️ {nombre} cerca del límite semanal: quedan {margen7} h (est.)". No bloquea.

### Tests (vitest, ~6)
Fixtures: eventos a −2d/−10d/−20d con viajes/hitos con coords conocidas (Madrid→Barcelona ≈504 km
Haversine → ×1.3 ≈655 km → a 75 km/h ≈8.7 h). Casos: sin eventos→0; solo dentro de 7d cuenta en
ambos; entre 7–14 solo en horas14; >14d ignorado; `kmAproxViaje` ignora hitos sin coords;
límites/margen/pct correctos.

---

## 7A.2 — Motor de asignación v1 (score explicado + registro de decisiones)

**DECISIÓN DE PRODUCTO (usuario, 2026-07-03): la asignación la decide el GESTOR, no el chófer.**
No hay flujo de "aceptar/rechazar" para el chófer (eso era el diseño original de 7A.3 — se
descarta explícitamente, ver nota en esa sección más abajo). El sistema sugiere con
transparencia, el gestor asigna con un clic, el chófer solo se ENTERA (7A.3 nuevo).

### Migración `0020_decision_asignacion.sql`
```sql
-- Registro de cada asignación: qué sugirió el sistema vs qué eligió el gestor. Es el
-- hook de "aprendizaje" — no hay ML todavía, pero sin este registro no habría con qué
-- entrenar/ajustar nada el día de mañana (7B.7). Cuando el gestor NO sigue la sugerencia
-- top, se le pide un motivo opcional: esa nota es la señal más valiosa (por qué un score
-- alto no fue la elección real).
CREATE TABLE IF NOT EXISTS decision_asignacion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  viaje_id            uuid NOT NULL REFERENCES viaje(id) ON DELETE CASCADE,
  chofer_sugerido_id  uuid REFERENCES chofer(id) ON DELETE SET NULL,
  chofer_elegido_id   uuid NOT NULL REFERENCES chofer(id) ON DELETE CASCADE,
  score_sugerido      integer,
  score_elegido       integer,
  siguio_sugerencia   boolean NOT NULL,
  motivo              text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_asignacion_empresa ON decision_asignacion (empresa_id);
CREATE INDEX IF NOT EXISTS idx_decision_asignacion_viaje ON decision_asignacion (viaje_id);
ALTER TABLE decision_asignacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa ve y crea sus decisiones" ON decision_asignacion FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());
-- Sin UPDATE con propósito real de negocio, pero FOR ALL es más simple que 3 policies y
-- el riesgo es nulo (es un log propio de la empresa, no evidencia de terceros como
-- ejecucion_evento/ubicacion — no aplica el mismo criterio de 0019).
```
Aplicar checksum igual que el resto (ver 0.1). Recordar: 0019 ya está aplicada, esta es 0020.

### lib/data.js — scoring
```
export const PESOS_ASIGNACION = {
  disponibilidad: 40, margen561: 25, documentos: 15, proximidad: 10, historial: 10,
}; // valores iniciales razonables, NO pactados — ajustables

export function scoreChofer({ chofer, tieneViajeActivo, estado561, docsOk, docsCaducados,
                              distanciaOrigenKm, metricas, horasViaje }) ->
  { score: number, razones: string[], bloqueos: string[] }
```
`metricas` es el objeto de ESE chófer devuelto por `getMetricasChoferes()` (ya existe, ítem 4.5:
`{viajes, valoracionMedia, incidencias, pctPuntualidad}`) — **reutilizar esa función, no
reinventar el cálculo**. Reglas EXACTAS de `scoreChofer` (pura, testear exhaustivamente):
- **Disponibilidad** (máx 40): `!tieneViajeActivo` → +40, razón "Disponible"; si no → +0, razón
  "En viaje ahora".
- **Margen 561** (máx 25): `estado561 == null` → +12, razón "Sin datos de horas"; si no →
  `+round(min(1, estado561.margen7 / max(horasViaje ?? 9, 1)) * 25)`, razón
  `"${margen7} h de margen semanal (est.)"`.
- **Documentos** (máx 15): `docsCaducados.length > 0` → +0 y `bloqueos.push("Documento
  caducado: " + docsCaducados.join(", "))`; si no → +15, razón "Documentos en vigor".
  (docsOk/docsCaducados se calculan FUERA: tipos `licencia`/`cap` del chófer con
  `fecha_caducidad < hoy`.)
- **Proximidad** (máx 10): `distanciaOrigenKm == null` → +5, razón "Ubicación desconocida";
  ≤50→+10, ≤200→+6, ≤500→+3, >500→+1, razón `"a ~${round(d)} km del origen"`.
- **Historial real** (máx 10 — ESTA ES LA MEJORA PEDIDA: usar desempeño real, no solo estrellas):
  `metricas == null || metricas.viajes === 0` → +5, razón "Sin historial de viajes"; si no,
  suma de 3 componentes:
  - puntualidad (máx 5): `metricas.pctPuntualidad != null ? round(metricas.pctPuntualidad / 100 * 5) : 2`
  - incidencias (máx 3): `round(clamp(1 - metricas.incidencias / metricas.viajes, 0, 1) * 3)`
  - valoración (máx 2): `metricas.valoracionMedia != null ? round(metricas.valoracionMedia / 5 * 2) : 1`
  Razón compuesta: `"${metricas.viajes} viajes previos"` + si `pctPuntualidad != null`:
  `", ${pctPuntualidad}% puntual"` + si `incidencias > 0`: `", ${incidencias} incid."`.
  (Nota de alcance: NO se intenta correlacionar "mismo cliente/misma ruta habitual" en v1 — el
  esquema no tiene un identificador de ruta/cliente reutilizable en `viaje`, y forzarlo con
  fuzzy-matching de direcciones sería una fuente de falsos positivos. Queda anotado como
  posible 7B futuro si el volumen de datos lo justifica.)

`export async function sugerirChofer(viajeId)`:
1. Cargas paralelas: choferes; viajes con estado in ESTADOS_ACTIVOS (para `tieneViajeActivo`,
   excluyendo el propio viajeId); documentos `.eq("ambito","chofer")` (agrupar por entidad_id,
   tipos licencia/cap, detectar caducados); `getMetricasChoferes()` (sin rango → usa el default de
   90 días de `resolveRango`, ya existente); ubicaciones (SIN order — el mock no ordena; reducir
   en JS: max `created_at` por chofer); hitos del viaje (primer hito por `orden` en JS = origen;
   y `kmAproxViaje`/velocidad → horasViaje).
2. Por chófer: `distanciaOrigenKm` = haversine(ultimaUbicacion, origen) si ambos, si no null.
   Llamar `getEstado561` por chófer (secuencial ok; anotar deuda O(N) en comment). `metricas` =
   la entrada de `getMetricasChoferes()` para ese chófer (por id), o null si no aparece.
3. Return array `{chofer:{id,nombre,idioma}, score, razones, bloqueos}` orden desc por score.

### lib/data.js — registro de decisión
```
export async function registrarDecisionAsignacion({ viajeId, choferSugeridoId, scoreSugerido,
  choferElegidoId, scoreElegido, motivo = null }) {
  const empresaId = await getCurrentEmpresaId();
  const siguioSugerencia = choferSugeridoId != null && choferSugeridoId === choferElegidoId;
  await supabase.from("decision_asignacion").insert({
    empresa_id: empresaId, viaje_id: viajeId,
    chofer_sugerido_id: choferSugeridoId, chofer_elegido_id: choferElegidoId,
    score_sugerido: scoreSugerido, score_elegido: scoreElegido,
    siguio_sugerencia: siguioSugerencia, motivo,
  }, { returning: "minimal" }); // no necesitamos la fila de vuelta, evita RETURNING/RLS de más
}
```
No lanza si falla (`try/catch` interno + log de consola) — es telemetría de aprendizaje, nunca
debe bloquear el flujo de asignar un chófer.

### UI — componente `app/components/SugerenciaChofer.jsx`
Props `{viajeId, onAsignado(choferId)}` (callback tras asignar, para refrescar el padre — YA NO
hay prop `onOfertar`, se elimina esa rama). Carga `sugerirChofer` al montar. Render: top 5 filas
— nombre + score (número grande a la derecha) + razones como chips `text-xs bg-surface-alt
rounded-full px-2 py-0.5` + bloqueos en chip rojo + botón "Asignar" por fila. Al pulsar "Asignar"
en una fila que NO es la primera (mayor score) de la lista: mostrar un `<input>` inline
"¿Por qué este chófer y no {top.nombre}? (opcional)" antes de confirmar — botones "Confirmar
sin motivo" / "Guardar y asignar". Al pulsar "Asignar" en la fila top: asigna directo, sin pedir
nada. Tras asignar: llama a la función de asignación existente (`cambiarChofer` en
`/viajes/[id]`) Y a `registrarDecisionAsignacion` con `choferSugeridoId` = el `id` de la fila top
de la lista (aunque el gestor haya elegido otra), `scoreSugerido`/`scoreElegido` de sus
respectivas filas. Skeleton mientras carga. Integrar debajo del select de chófer en
`/viajes/[id]` (editor) — **NOTA de alcance real**: `sugerirChofer(viajeId)` necesita un
`viaje_id` real (para excluirlo de "activo" y leer sus hitos ya guardados). El formulario plano
`/viajes/nuevo` de hoy NO tiene ese id hasta el submit final, así que la integración con
sugerencias ordenadas ahí NO se hizo en la v1 de 7A.2 — llega con el wizard (7A.11), que sí tiene
un paso 2 dedicado a esto tras capturar los hitos. `/viajes/nuevo` se queda con el chip 561 de
7A.1 mientras tanto.

### Tests (~12)
`scoreChofer` puro: cada dimensión aislada (incl. las 3 sub-componentes de historial) +
combinación máxima (100) + bloqueo por caducidad + sin historial (`metricas` null o `viajes:0`).
`sugerirChofer` integración: 3 chóferes con perfiles distintos → orden esperado; excluye el
propio viaje de "activo". `registrarDecisionAsignacion`: inserta con `siguio_sugerencia` correcto
(true si coincide top, false si no); no lanza si la tabla falla (mock que rechaza el insert).

---

## 7A.3 — Notificación de asignación al chófer (NO oferta/aceptar-rechazar)

**Cambio de diseño (usuario, 2026-07-03): descartado el flujo Uber-style de "ofertar y que el
chófer acepte/rechace" de la spec original.** Motivo del usuario: la decisión de a quién asignar
es del GESTOR (que tiene el histórico e info de negocio), no del chófer. El chófer solo necesita
ENTERARSE de su ruta — cero fricción, cero decisión que tomar, coherente con el principio de
diseño "el chófer solo carga y conduce". Esto simplifica mucho la spec original: sin
`InlineKeyboardButton`, sin callbacks de aceptar/rechazar, sin estado "ofertado pero no
confirmado", sin `ofertado_a`/`ofertado_en`.

### Migración `0021_notificacion_asignacion.sql`
```sql
ALTER TABLE viaje ADD COLUMN IF NOT EXISTS notificado_asignacion_en timestamptz;
```

### Arquitectura del push (misma decisión de la spec original, se mantiene)
El dashboard no puede mandar Telegram directamente (el token vive solo en el proceso del bot).
Se usa **JobQueue de PTB**: job repetitivo cada 30 s que busca viajes con chófer asignado y sin
notificar, y envía un mensaje informativo. Requiere `python-telegram-bot[job-queue]` en
`backend/requirements.txt` (si no está ya de una implementación previa de esta spec).

### backend/app/bot.py
1. i18n (4 idiomas): `asignacion_titulo` ("🚚 Se te ha asignado el viaje {ref}"),
   `asignacion_detalle` ("{n} paradas · ~{km} km\nPrimera parada: {dir}").
2. `async def procesar_notificaciones_asignacion(ctx)`: cargar viajes con `chofer_id IS NOT
   NULL` (`.not_.is_("chofer_id","null")` si el cliente real lo soporta; si no, `.execute()` de
   viajes con `chofer_id` no nulo vía `.neq` no sirve para NULL — cargar TODOS los viajes activos
   `.in_("estado", ["planificado","en_curso"])` y filtrar en Python `v["chofer_id"] and not
   v.get("notificado_asignacion_en")`, igual que el patrón ya usado en el bot para otros campos
   nulos). Por cada uno: chófer por id con chat_id → componer mensaje con hitos (contar + km
   aproximados sumando haversine×1.3 entre hitos con coords, mismo cálculo que
   `kmAproxViaje`/`FACTOR_SINUOSIDAD_FALLBACK` pero en Python) → `ctx.bot.send_message` (SIN
   botones, texto plano) → update `notificado_asignacion_en = now`. Si el chófer no tiene
   chat_id: marcar notificado igual (evita reintento infinito) y `notificar_gestor_evento`
   avisando que el chófer no está vinculado a Telegram.
3. Registro en `create_bot_app`: `if app.job_queue: app.job_queue.run_repeating(
   procesar_notificaciones_asignacion, interval=30, first=15)` (guard para tests sin job-queue;
   `first=15` en vez de 10 para no pisar el job de 7A.1/561 si existiera uno — de momento no hay
   ninguno más, es solo higiene).
4. **Reasignación**: si un viaje YA notificado cambia de chófer (el gestor reasigna), el
   dashboard debe resetear `notificado_asignacion_en = null` al hacer el update de `chofer_id`
   (ver abajo) para que se re-notifique al nuevo chófer. No hace falta avisar al chófer anterior
   de que se le quitó — fuera de alcance v1 (anótalo como posible mejora, no lo bloquees).

### dashboard
En `cambiarChofer` (`/viajes/[id]/page.jsx`) y en la creación de viaje con chófer preasignado
(`createViaje` en `/viajes/nuevo`): al hacer `update`/`insert` con un `chofer_id` no nulo, incluir
también `notificado_asignacion_en: null` en el mismo payload (si la columna ya tenía un valor de
una notificación anterior, se resetea; si es un alta nueva, ya nace null por defecto, no pasa
nada escribirlo igual). No hace falta ninguna función nueva en `lib/data.js` para esto — es un
campo más en los updates/inserts que ya existen.

### Tests
pytest (~5): `procesar_notificaciones_asignacion` (coroutine directa con fake ctx.bot AsyncMock +
fake_db) — envía y marca; chófer sin chat_id; nada pendiente; no reenvía si ya notificado. E2E
opcional: no crítico (no hay callback que probar, es solo un envío saliente).

---

## 7A.4 — Live location + geo-llegada v1

**Sin migración** (tabla `ubicacion` ya existe: id, chofer_id, lat, lon, velocidad, rumbo,
created_at).

### backend/app/bot.py
1. `UMBRAL_GEO_LLEGADA_M = 300` (constante módulo, comentario "valor inicial").
2. i18n (4): `geo_llegada_pregunta` ("📍 Parece que has llegado a {dir}. ¿Confirmas?").
3. `async def handle_location(update, ctx)`:
   - `msg = update.message or update.edited_message` (live location llega como edited_message);
     `loc = msg.location`; chofer por chat; si no vinculado → return silencioso.
   - Insert `ubicacion` `{chofer_id, lat: loc.latitude, lon: loc.longitude}`.
   - Geo-pregunta: viaje en_curso del chófer → hito con estado `pendiente` de menor `orden` con
     coords; `d_m = haversine_km(...)*1000`; si `d_m <= UMBRAL_GEO_LLEGADA_M` y
     `ctx.chat_data.get("geo_preguntado") != hito["id"]`: enviar `geo_llegada_pregunta` con
     botón `[InlineKeyboardButton(t(chofer,"btn_llegado"), callback_data=f"pre_llegada:{id}")]`
     y `ctx.chat_data["geo_preguntado"] = hito["id"]`. NO responder nada en el resto de casos
     (silencio: live location manda updates cada pocos segundos).
4. Registro (dos handlers): `MessageHandler(filters.LOCATION, handle_location)` y
   `MessageHandler(filters.UpdateType.EDITED_MESSAGE & filters.LOCATION, handle_location)`.
5. En el mensaje de vinculación exitosa de `cmd_start`, añadir línea: "Comparte tu ubicación en
   tiempo real (clip 📎 → Ubicación → Compartir en tiempo real) para activar la llegada automática."

### Tests
E2E helper nuevo `location_update(app, lat, lon, edited=False)` (Message con
`location=Location(longitude, latitude)`, recordar `.set_bot`). Casos (~5): guarda ubicación;
pregunta cuando <300 m del hito pendiente; NO pregunta dos veces (chat_data); NO pregunta lejos;
no vinculado silencioso.

---

## 7A.5 — Coste total de ruta v2 (desglose por capas)

### Migración `0022_coste_desglosado.sql`
```sql
ALTER TABLE vehiculo ADD COLUMN IF NOT EXISTS consumo_l_100km numeric;
ALTER TABLE empresa  ADD COLUMN IF NOT EXISTS precio_gasoil_litro numeric;
ALTER TABLE empresa  ADD COLUMN IF NOT EXISTS coste_peaje_km numeric;
ALTER TABLE empresa  ADD COLUMN IF NOT EXISTS dieta_noche_eur numeric;
ALTER TABLE empresa  ADD COLUMN IF NOT EXISTS coste_conductor_km numeric;
ALTER TABLE empresa  ADD COLUMN IF NOT EXISTS margen_objetivo_pct numeric;  -- para 7A.6
```

### lib/data.js — `calcularCosteRuta({ km, noches = 0, vehiculo, empresa })` (pura)
Dos modos, elegidos automáticamente:
- **Desglosado** (si `vehiculo?.consumo_l_100km && empresa?.precio_gasoil_litro`):
  `combustible = km * consumo/100 * precio`; `conductor = empresa?.coste_conductor_km != null ?
  km * coste_conductor_km : null`; `peajes = empresa?.coste_peaje_km != null ? km*peaje : null`;
  `dietas = noches === 0 ? 0 : (empresa?.dieta_noche_eur != null ? noches*dieta : null)`.
  `total` = suma de los NO-null; `capasFaltantes` = nombres de los null.
- **Blended** (fallback, si no hay datos de combustible): reutilizar `resolveCosteKm` existente
  → `total = km * costeKm` (o todo null si tampoco hay), `modo: "blended"`.
Return `{ modo: "desglosado"|"blended"|null, combustible, conductor, peajes, dietas, total,
capasFaltantes: [] }` (números redondeados a 2 dec).

`getViabilidadViaje` pasa a: calcular `noches = descansos11h` del ETA del viaje (reutilizar
`calcularEtaConParadas(km/velocidad)`), llamar `calcularCosteRuta`, y devolver además
`{desglose}` manteniendo compatibilidad con los campos actuales (coste = total). **No romper los
tests existentes de 5.2** — el modo blended con solo coste_km debe dar el mismo resultado.

### UI
- Ajustes → "Coste de operación" ampliada: 4 inputs nuevos (gasoil €/l, peaje €/km, dieta
  €/noche, conductor €/km) con el patrón label+id+guardar existente; texto que explica los modos.
- Ficha vehículo (`/vehiculos/[id]`): campo "Consumo (l/100km)" junto al coste/km override.
- Viabilidad en `/viajes/[id]`: bajo el badge de margen, tabla pequeña del desglose; filas con
  capa faltante: "— configura {campo} en Ajustes" en text-ink-muted.

### Tests (~8)
Modo desglosado completo; cada capa faltante → null + en capasFaltantes; noches=0 → dietas 0
aunque falte tarifa; fallback blended idéntico a 5.2; total suma solo activos.

---

## 7A.6 — Presupuestador instantáneo

**Usa la migración 0022** (`empresa.margen_objetivo_pct`).

### lib/data.js
`export const MARGEN_OBJETIVO_PCT_DEFAULT = 15;` (comentario estándar).
`export async function calcularPresupuesto({ puntos, vehiculoId = null })` — `puntos` =
`[{lat, lon}, ...]` (≥2):
1. `{km, estimado} = await kmCarreteraViaje(puntos.map((p,i)=>({...p, orden:i+1})))`.
2. empresa (velocidad, costes, margen_objetivo_pct) + vehículo si id.
3. `eta = calcularEtaConParadas(km/velocidad)`; `noches = eta.descansos11h`.
4. `coste = calcularCosteRuta({km, noches, vehiculo, empresa})`.
5. `margenObj = empresa.margen_objetivo_pct ?? MARGEN_OBJETIVO_PCT_DEFAULT`;
   `precioSugerido = coste.total != null ? round(coste.total / (1 - margenObj/100), 2) : null`.
6. Return todo: `{km, estimado, horasConduccion, horasTotales, paradas45min, descansos11h,
   noches, coste, precioSugerido, margenObjetivo: margenObj}`.

### UI — página `app/presupuesto/page.jsx` + Sidebar (icono `Calculator`, entre Analítica y Plantillas)
Form: lista dinámica de puntos (label, lat, lon numéricos — mismo estilo que el form de parking
del mapa), botones añadir/quitar (mínimo 2), select de vehículo opcional (cargar con matrícula).
Botón "Calcular" → card de resultado: precio sugerido DESTACADO (text-2xl), y debajo: ~km,
horas de conducción + paradas + descansos, noches, desglose de coste (tabla de 7A.5), margen
objetivo aplicado. Aviso estándar "~" si `estimado`. Botón secundario "Crear viaje" → link a
`/viajes/nuevo` (v1 sin precarga; la precarga llega con el wizard 7A.11 — dejar TODO comentado).

### Tests (~4)
calcularPresupuesto con mock: feliz completo; sin costes configurados → precioSugerido null;
margen de empresa respetado vs default; <2 puntos → km 0.

---

## 7A.7 — Gastos del viaje (multas, repostajes…)

### Migración `0023_gasto_viaje.sql`
```sql
CREATE TABLE IF NOT EXISTS gasto_viaje (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  viaje_id    uuid NOT NULL REFERENCES viaje(id) ON DELETE CASCADE,
  chofer_id   uuid REFERENCES chofer(id) ON DELETE SET NULL,
  vehiculo_id uuid REFERENCES vehiculo(id) ON DELETE SET NULL,
  tipo        text NOT NULL CHECK (tipo IN ('repostaje','peaje','multa','dieta','otro')),
  importe     numeric NOT NULL,
  litros      numeric,
  descripcion text,
  fecha       date,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gasto_viaje_viaje ON gasto_viaje (viaje_id);
CREATE INDEX IF NOT EXISTS idx_gasto_viaje_empresa ON gasto_viaje (empresa_id);
ALTER TABLE gasto_viaje ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa gestiona sus gastos" ON gasto_viaje FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());
```

### lib/data.js
`getGastosViaje(viajeId)` (lista orden fecha desc — ordenar en JS por el mock);
`createGastoViaje({viajeId, tipo, importe, litros, descripcion, fecha, choferId, vehiculoId})` —
`empresa_id` de `getCurrentEmpresaId()`, insert normal con `.select().single()` (aquí SÍ se puede:
la policy SELECT ve la fila); `deleteGastoViaje(id)`;
`getMultasPorChofer(choferId)` / `getMultasPorVehiculo(vehiculoId)` → `{total, ultimas}` (tipo
'multa', máx 5 recientes).

### UI
- `/viajes/[id]`: sección "Gastos" (mismo patrón form colapsable de mantenimiento de vehículo):
  alta rápida (tipo select con labels: Repostaje/Peaje/Multa/Dieta/Otro, importe €, litros solo
  visible si tipo=repostaje, fecha, descripción, chófer preseleccionado al del viaje), lista con
  icono por tipo + borrar, y pie con "Total gastos: X €" + subtotal por tipo.
- `/choferes/[id]` y `/vehiculos/[id]`: card "Multas" (total € + últimas 5 con fecha/importe/viaje).

### Tests (~6)
create con empresa del gestor; getGastos filtra por viaje; multas por chofer solo tipo multa;
delete; totales.

---

## 7A.8 — P&L real del viaje

**Sin migración** (usa `gasto_viaje` de 7A.7 y precio/coste existentes).

### lib/data.js — `getPnlViaje(viajeId)`
1. `viabilidad = await getViabilidadViaje(viajeId)` (estimado).
2. `gastos = await getGastosViaje(viajeId)`; `gastosReales = Σ importe`.
3. Return `{precio, costeEstimado: viabilidad.coste, margenEstimado: viabilidad.margen,
   gastosReales, margenReal: precio != null ? precio − gastosReales : null,
   desviacionPct: (costeEstimado && gastosReales) ? round((gastosReales−costeEstimado)/
   costeEstimado*100) : null, numGastos}`.

### UI
- `/viajes/[id]`: card "Resultado (P&L)" bajo Viabilidad: dos columnas "Estimado | Real" con
  coste, margen, y fila de desviación con color (verde si real ≤ estimado). Si no hay gastos:
  "Aún sin gastos reales — añádelos en la sección Gastos."
- `/analitica`: 5ª pestaña "Rentabilidad" (icono `TrendingUp`): función
  `getMetricasRentabilidad(rango)` — viajes con precio en el rango; por viaje: precio, gastos
  reales agregados (una query gasto_viaje del rango, agrupar en JS), margen real. KPIs (Stat):
  margen real medio %, nº viajes a pérdidas reales, desviación media |real−estimado| (solo P&L
  de viajes con ambos). Tabla top/bottom 5 por margen real.

### Tests (~5)
Pnl con gastos/sin gastos/sin precio; métricas de rentabilidad con 3 viajes mixtos.

---

## 7A.9 — Plan-vs-real en el detalle del viaje

**Sin migración.**

### lib/data.js — `getPlanVsReal(viajeId)`
Query hitos + eventos `.eq("tipo","llegada").eq("viaje_id",viajeId)`. Por hito: primera llegada
con su `hito_id` → `llegadaReal`. Delta: si `ventana_fin` y llegadaReal:
`deltaMin = round((llegadaReal − ventana_fin)/60000)`; `estado: deltaMin <= 0 ? "a_tiempo" :
deltaMin <= 60 ? "tarde_leve" : "tarde"`; sin ventana o sin llegada → `estado: "sin_datos"`.
Return `{filas: [{hitoId, orden, deltaMin, llegadaReal, estado}], resumen: {aTiempo, conVentana}}`.

### UI — en la lista de hitos existente de `/viajes/[id]`
Bajo cada hito con llegada real: línea `text-xs` — "Llegó {HH:MM} ({+X min | a tiempo})" con
color verde/ámbar/rojo según estado. Encima de la lista: "{aTiempo}/{conVentana} hitos a tiempo"
si conVentana > 0.

### Tests (~4): a tiempo (delta ≤0), tarde leve, tarde, sin ventana → sin_datos; resumen.

---

## 7A.10 — Centro de mando "Hoy" (+ notas del gestor)

**Migración `0024_nota_gestor.sql`** (única migración de este ítem; el resto de "Hoy" es
solo lectura de tablas existentes). Subsume 6.20. Añade captura de contexto pedida por el
usuario (2026-07-03): "meter algo de notas o comentarios para coger info de primera mano y
aprender" — un cuaderno de bitácora ligero, sin estructura, que con el tiempo puede minarse para
entender criterio del gestor (complementa el registro estructurado de `decision_asignacion`
de 7A.2, que ya captura el motivo cuando el gestor NO sigue la sugerencia).

```sql
CREATE TABLE IF NOT EXISTS nota_gestor (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  gestor_id   uuid REFERENCES gestor(id) ON DELETE SET NULL,
  texto       text NOT NULL,
  viaje_id    uuid REFERENCES viaje(id) ON DELETE SET NULL, -- opcional: nota atada a un viaje
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nota_gestor_empresa ON nota_gestor (empresa_id);
ALTER TABLE nota_gestor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa gestiona sus notas" ON nota_gestor FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());
```

### lib/data.js — `getResumenHoy()`
Promise.all: (a) `getDocumentosPorCaducar()` → count; (b) incidencias `.in("estado",
["abierta","en_revision"])` → count + `masAntiguaDias`; (c) viajes en riesgo: viajes en_curso +
sus hitos; riesgo = algún hito no completado con `ventana_fin < ahora` → count + refs (máx 3);
(d) chóferes 561: `getEstado561` por chófer con viaje activo (solo esos, para acotar N) →
los de pct7 ≥ 80 → count + nombres; (e) viajes a pérdidas estimadas: viajes activos con precio →
`getViabilidadViaje` de cada uno (máx 20) → margen < 0 → count.
Return `{docsPorCaducar, incidencias:{count,masAntiguaDias}, viajesEnRiesgo:{count,refs},
choferes561:{count,nombres}, viajesPerdidas:{count}, todoEnOrden: bool}`.

### lib/data.js — notas
```
export async function getNotasRecientes(limite = 10) {
  const { data } = await supabase.from("nota_gestor")
    .select("id, texto, viaje_id, created_at, gestor:gestor_id(nombre)")
    .order("created_at", { ascending: false }).limit(limite);
  return data || [];
}
export async function createNotaGestor({ texto, viajeId = null }) {
  const empresaId = await getCurrentEmpresaId();
  const { data: gestor } = await supabase.from("gestor").select("id")
    .eq("auth_user_id", (await supabase.auth.getSession()).data.session.user.id).single();
  await supabase.from("nota_gestor").insert({
    empresa_id: empresaId, gestor_id: gestor?.id || null, texto: texto.trim(), viaje_id: viajeId,
  });
}
```

### UI — `app/components/ResumenHoy.jsx`, montado ARRIBA en `app/page.jsx` (Kanban debajo, intacto)
Fila de 5 tarjetas clicables (grid responsive): número grande + label + flecha; color del número
rojo si >0 (docs ámbar). Hrefs: `/documentos`, `/incidencias`, `/viajes?filtro=riesgo` (o `/`
con anchor — usar `/incidencias` y `/viajes` simples v1), `/choferes`, `/viajes`. Si
`todoEnOrden`: banner verde único "✅ Todo en orden — nada requiere tu atención ahora mismo."
(esa frase ES el producto). Skeleton de 5 cajas mientras carga.

Debajo de las tarjetas, sección "Notas rápidas": textarea corto + botón "Añadir" (llama
`createNotaGestor`, limpia el campo, refresca la lista) + lista de las últimas 10 (`getNotasRecientes`)
con autor + fecha relativa + texto. Sin edición ni borrado en v1 (es un log de apuntes, no un
editor de documentos — si algo se apuntó mal, se añade una nota nueva aclarando). También
integrar un textarea opcional "Nota (opcional)" en `/viajes/[id]` bajo el detalle del viaje que
llama `createNotaGestor({texto, viajeId})` — mismas notas, filtrables por viaje si se listan ahí
con `.eq("viaje_id", id)` en vez de sin filtro.

### Tests (~7): todoEnOrden true/false; viaje en riesgo detectado; 561 solo chóferes con viaje
activo; createNotaGestor inserta con gestor_id resuelto; getNotasRecientes respeta el límite.

---

## 7A.11 — Wizard "Nuevo viaje"

**Sin migración.** Construir en `/viajes/nuevo-w`; cuando el usuario lo valide se hace swap
(anotar como pendiente-decisión el swap, NO hacerlo autónomamente).

### Estructura — `app/viajes/nuevo-w/page.jsx`
Estado único `{paso: 1|2|3, referencia, precio, hitos: [...], choferId, vehiculoId, remolqueId}`.
Header de pasos (1 Ruta → 2 Asignación → 3 Confirmar) con check en completados.
- **Paso 1**: editor de hitos (reutilizar el patrón del actual `/viajes/nuevo`: tipo
  recogida/entrega, dirección, lat/lon, ventanas) + referencia + precio. **Panel lateral sticky**
  (en `lg:grid-cols-[1fr_320px]`): recalcula con debounce 500 ms cuando cambian hitos con coords:
  ~km (`kmCarreteraViaje`), horas+paradas (`calcularEtaConParadas`), noches, coste
  (`calcularCosteRuta`), precio sugerido (lógica 7A.6) y margen del precio introducido con
  semáforo. Extraer el cálculo a `lib/data.js: calcularPanelViaje({puntos, vehiculoId, precio})`
  para testearlo (composición de lo ya existente).
- **Paso 2**: `SugerenciaChofer` (7A.2, ya sin flujo de oferta — el gestor asigna directo) +
  selects vehículo/remolque (con `validarAsignacion` existente) + chip 561 (7A.1). Al asignar
  chófer aquí, el mismo `notificado_asignacion_en: null` de 7A.3 se incluye en el insert de
  `createViaje`.
- **Paso 3**: resumen completo de todo + botón Crear → `createViaje` existente (extenderlo para
  aceptar `precio` — verificar firma actual y añadir el campo al insert).

### Tests: `calcularPanelViaje` (~3 casos). El componente no se testea (consistente con el repo).

---

## 7A.12 — Sistema de diseño consolidado

**Sin migración. Refactor puro: cero cambios de comportamiento.** Subsume 6.14.

1. `dashboard/lib/labels.js`: mover y unificar TODOS los diccionarios duplicados —
   `ESTADO_VIAJE` (viajes/page, viajes/[id], choferes/[id]), `ESTADO_HITO`, `ESTADO_POD`,
   `TIPOS_DOC_VIAJE/VEHICULO/CHOFER` + `TIPO_DOC_LABEL` (documentos/page, NotificationCenter),
   `TIPOS_PARKING`/`TIPO_PARKING_LABEL` (mapa, MapView), `AMBITO_LABEL/ICON`, `TIPO_GASTO_LABEL`
   (7A.7), `TIPOS_VEHICULO` (vehiculos/page).
2. `dashboard/lib/format.js`: `fmtFecha(iso)`, `fmtFechaHora(iso)`, `fmtEur(n)`, `fmtKm(n)`
   (unificar los `toLocaleString("es-ES")` dispersos), `diasHasta(fecha)`,
   `badgeCaducidad(fecha)` (la lógica de DocumentosSection/documentos), `badgeMargen(margen,pct)`.
3. `app/components/ui/`: `Stat.jsx` ({label, value, sub, href?, tone?}), `Badge.jsx`
   ({tone: "ok"|"warn"|"error"|"neutral", children} — ok = bg-green-50 text-green-700),
   `EmptyState.jsx` ({icon, titulo, texto, ctaLabel?, ctaHref?/onCta?}), `SectionCard.jsx`
   ({title, icon, actions, children} — el patrón header+borde repetido en 10 sitios).
4. Migrar TODAS las páginas a estos módulos, en 2–3 commits (labels+format primero, luego
   componentes). CI verde tras cada commit; los tests solo cambian imports si acaso.

---

## 7A.13 — Onboarding y empty states

**Sin migración.** Depende de 7A.12 (`EmptyState`).

### lib/data.js — `getOnboardingEstado()`
Counts en paralelo → `{pasos: [{id:"vehiculo", done, label:"Añade tu primer vehículo",
href:"/vehiculos"}, {id:"chofer", ...}, {id:"telegram", done: chóferes con chat_id>0,
href:"/choferes"}, {id:"viaje", ...href:"/viajes/nuevo"}, {id:"costes", done:
empresa.coste_km!=null || empresa.precio_gasoil_litro!=null, href:"/ajustes"}], completado: bool}`.

### UI
`app/components/ChecklistOnboarding.jsx` en la home, encima de ResumenHoy: card "Primeros pasos
({n}/5)" con cada paso → check verde o círculo + link. Se muestra si `!completado` y no está
oculto (`localStorage["norenty_onboarding_oculto"]`, botón "Ocultar"). Reemplazar los textos
"Sin datos"/"Sin viajes" de las listas (viajes, choferes, vehiculos, plantillas, documentos,
incidencias) por `EmptyState` con CTA a la acción de alta correspondiente.

### Tests (~3): getOnboardingEstado vacío/parcial/completo.

---

## 7A.14 — Portal de cliente (tracking público)

### Migración `0025_token_publico.sql`
```sql
ALTER TABLE viaje ADD COLUMN IF NOT EXISTS token_publico uuid UNIQUE;

CREATE OR REPLACE FUNCTION public.viaje_publico(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'referencia', vi.referencia, 'estado', vi.estado,
    'hitos', (SELECT jsonb_agg(jsonb_build_object(
        'orden', h.orden, 'tipo', h.tipo, 'direccion', h.direccion,
        'estado', h.estado, 'ventana_inicio', h.ventana_inicio, 'ventana_fin', h.ventana_fin
      ) ORDER BY h.orden) FROM hito h WHERE h.viaje_id = vi.id),
    'ultima_posicion', (SELECT jsonb_build_object(
        'lat', round(u.lat::numeric, 2), 'lon', round(u.lon::numeric, 2), 'ts', u.created_at)
      FROM ubicacion u WHERE u.chofer_id = vi.chofer_id
      ORDER BY u.created_at DESC LIMIT 1)
  ) INTO v FROM viaje vi WHERE vi.token_publico = p_token;
  RETURN v;  -- NULL si el token no existe. NUNCA precio/coste/nombre chófer/matrícula.
END; $$;
GRANT EXECUTE ON FUNCTION public.viaje_publico(uuid) TO anon, authenticated;
```

### dashboard
- `lib/data.js`: `generarTokenPublico(viajeId)` (uuid en cliente `crypto.randomUUID()`, update
  viaje), `revocarTokenPublico(viajeId)` (update null), `getViajePublico(token)` →
  `supabase.rpc("viaje_publico", {p_token: token})`.
- **GOTCHA AuthGuard**: `layout.jsx` envuelve TODO en AuthGuard → en `AuthGuard.jsx`, usar
  `usePathname()` y si `pathname.startsWith("/t/")` devolver `children` directamente (sin exigir
  sesión). El Sidebar/Topbar también se renderizan desde layout: en `Sidebar.jsx` y `Topbar.jsx`
  devolver `null` si `usePathname().startsWith("/t/")` (y el `<main>` ya ocupa todo).
- Página `app/t/[token]/page.jsx` ("use client"): carga `getViajePublico`; si null → "Enlace no
  válido o caducado". Render: logo Norenty pequeño, referencia, badge de estado, lista de hitos
  con check (sin precio ni datos internos), "posición aproximada" en texto o mini-mapa MapView
  simplificado (v1: solo texto "Última posición: hace X min" + link a Maps con las coords
  redondeadas — SIN cargar Leaflet en la página pública para mantenerla ligera). Poll cada 60 s.
  Pie: "Seguimiento proporcionado por Norenty".
- `/viajes/[id]`: sección "Compartir con el cliente" — si sin token: botón "Generar enlace";
  con token: input readonly con la URL completa + copiar + "Revocar".

### Verificación OBLIGATORIA contra BD real (patrón 6.9)
Script en scratchpad vía REST con anon key: (1) rpc con token válido devuelve SOLO los campos
whitelisted (assert que NO aparecen "precio"/"coste"); (2) token inventado → null; (3) tras
revocar → null. Documentar resultado en PROGRESS.

### Tests vitest (~4): generar/revocar; getViajePublico feliz/null (mock rpc — añadir `rpc` al
mock de data.test.js igual que en auth.test.js).

---

## Orden de ejecución y dependencias

```
7A.1 → 7A.2 → 7A.3 → 7A.4 → 7A.5 → 7A.6 → 7A.7 → 7A.8 → 7A.9 → 7A.10 → 7A.12 → 7A.13 → 7A.11 → 7A.14
```
(7A.12 antes que 7A.13 porque EmptyState; 7A.11 tarde porque compone 7A.1/2/3/5/6; el resto en
orden natural de dependencias: 2 usa 1, 3 usa 2, 6 usa 5, 8 usa 7, 10 usa 1+viabilidad.)
Después: 6.12, 6.13, 6.16, 6.17, 6.18, 6.19, 6.21, 6.22.
