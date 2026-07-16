# SPECS — Scoping de datos por gestor (Fase 15, 2026-07-15)

**Decisión del usuario (2026-07-15):** hoy cualquier gestor activo de una empresa ve TODOS los
chóferes/viajes/vehículos de esa empresa — confirmado en el código, no había restricción por
gestor individual (`viaje.gestor_id` solo se usaba para atribución/estadísticas, `RequireRol`
solo esconde botones, nunca filtra datos). El usuario, informado de esto, pidió explícitamente
construir el scoping real: cada gestor (`gestor_operativo`/`solo_lectura`) solo ve sus propios
chóferes y rutas asignados; `admin` (el "jefe de tráfico") sigue viendo todo, y además necesita
poder **gestionar el equipo: asignar/reasignar chóferes a cada gestor**.

Es un cambio de seguridad real (RLS), no una feature de dashboard — se trata con el mismo rigor
que cualquier cambio de aislamiento multi-tenant: migración con checksum, políticas RLS
verificadas contra la BD real, tests de aislamiento (mismo patrón que `isolation.test.js`), y
UNA COLA DE ITEMS PEQUEÑOS verificables uno a uno, no un cambio monolítico.

## Base técnica confirmada (auditoría de código, 2026-07-15)

- `current_empresa_id()` y `current_gestor_rol()` ya existen como funciones Postgres
  `SECURITY DEFINER STABLE`, reutilizables tal cual (`backend/db/migrations/0009_...` y
  `0032_roles_gestor.sql`). El check de admin ya establecido en el código: `current_gestor_rol()
  = 'admin'`.
- `chofer`/`viaje`/`vehiculo`/`plantilla_ruta` tienen política `empresa_scoped_%I` directa sobre
  su propio `empresa_id`.
- `hito`, `ejecucion_evento`, `pod`, `incidencia`, `valoracion` se scopean vía subquery sobre
  `viaje_id IN (SELECT id FROM viaje WHERE empresa_id = current_empresa_id())` — **heredan el
  scoping automáticamente si se reescribe la política de `viaje`**, sin tocarlas una a una.
- `ubicacion` se scopea vía `chofer_id` con el mismo patrón — hereda igual reescribiendo la
  política de `chofer`.
- `gasto_viaje`, `nota_gestor`, `decision_asignacion` tienen su propia política vía `viaje_id`/
  `chofer_id` — SÍ hay que tocarlas (no heredan de `viaje`/`chofer` automáticamente, tienen su
  propia `CREATE POLICY`).
- `gestor.rol` ya es un CHECK constraint cerrado: `admin`/`gestor_operativo`/`solo_lectura`.

## F15.1 — Migración: `chofer.gestor_id` + `current_gestor_id()` `[sonnet, bajo]`

- Migración nueva: `ALTER TABLE chofer ADD COLUMN gestor_id uuid REFERENCES gestor(id) ON DELETE
  SET NULL` (nullable — un chófer SIN gestor asignado es un estado válido, ver F15.3).
- `viaje.gestor_id` YA EXISTE (columna desde 0008) — se reutiliza tal cual, sin migración.
- Nueva función `current_gestor_id()` en Postgres (mismo patrón que `current_empresa_id()`):
  `SELECT id FROM gestor WHERE auth_user_id = auth.uid() AND activo = true LIMIT 1`.
- Verificación (Grupo B): columna existe, nullable, función devuelve el id correcto para la
  sesión demo real.

## F15.2 — Políticas RLS: `chofer` y `viaje` `[sonnet, medio]` — el núcleo de seguridad

- Reescribir la política de `chofer` y `viaje`: además de `empresa_id = current_empresa_id()`,
  añadir `AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS
  NULL)`. **`gestor_id IS NULL` es intencional**: un chófer/viaje sin asignar es visible para
  todos los gestores de la empresa (evita que quede "huérfano e invisible" para todo el mundo,
  que sería peor que el estado actual). Migrar los chóferes/viajes existentes sin tocar sus
  filas (todos quedan con `gestor_id IS NULL` = visibles para todos hasta que el admin los
  asigne — sin regresión brusca el día del despliegue de esta migración).
- Esto hereda automáticamente el scoping a `hito`/`ejecucion_evento`/`pod`/`incidencia`/
  `valoracion` (vía `viaje`) y a `ubicacion` (vía `chofer`) — no se tocan sus políticas.
- **Tests de aislamiento** (mismo patrón que `isolation.test.js`, contra la BD real, Grupo B):
  dos gestores de la MISMA empresa (uno `admin`, uno `gestor_operativo`), fixtures de chófer/
  viaje con `gestor_id` distinto para cada uno — el `gestor_operativo` NO ve las filas del otro
  ni por listado ni por `.eq("id", X)` directo; el `admin` ve ambas. Chófer/viaje sin `gestor_id`
  asignado, visible para ambos.
- **Riesgo real a vigilar**: `current_gestor_rol()`/`current_empresa_id()` devuelven NULL si
  `auth.uid()` no resuelve a un gestor activo (service role, scripts) — confirmar que
  `migrate.py`/scripts de mantenimiento siguen funcionando (corren con `SUPABASE_SERVICE_ROLE_KEY`,
  que bypassa RLS por diseño de Supabase, no debería verse afectado, pero SE VERIFICA, no se
  asume).

## F15.3 — Pantalla de gestión de equipo: asignar chóferes/rutas a un gestor `[sonnet, medio]`

- Ajustes → Equipo (ya existe la sección, `AjustesEquipoSection.jsx`, admin-only): añadir tabla
  de chóferes con selector "Asignado a: [gestor ▾ / Sin asignar]" — `guardarGestorChofer(choferId,
  gestorId)` en `data.js`, un simple `UPDATE chofer SET gestor_id = ...`.
- En `/viajes` (o en el propio `/viajes/[id]`), mismo selector para `viaje.gestor_id`
  (admin-only) — reutiliza el campo que ya existe, hoy sin UI de edición manual (solo se fija
  al crear el viaje si acaso).
- Tests Grupo A: guarda, permite null (desasignar), rechaza gestor de otra empresa (si aplica).

## F15.4 — Diferenciar KPIs del dashboard de `admin` vs. gestor `[DECISIÓN parcial]`

Una vez el scoping esté activo, con datos reales de "mis chóferes" vs. "todos los chóferes" el
dashboard de un `gestor_operativo` mostrará naturalmente SOLO sus propias cifras (mismo código,
datos ya filtrados por RLS) — no hace falta construir dos dashboards distintos, la sección
"Gestores" de Analítica ya es la vista agregada admin-only que compara entre todos. Revisar tras
F15.1-F15.3 si sigue haciendo falta algo más específico, o si esto ya cierra la necesidad
("KPIs diferentes" del jefe de tráfico = ya los tiene con la comparación entre gestores + ver
todo sin filtro).

---

**Orden de ejecución**: F15.1 → F15.2 (el núcleo, no se toca nada más sin esto verificado) →
F15.3 → revisar F15.4. Ningún ítem de UI se construye antes de que F15.2 esté verificado con
tests de aislamiento reales — de nada sirve una pantalla de asignación si la seguridad de fondo
no funciona.
