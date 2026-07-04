# SPECS 9 — Roles de gestor y expulsión (ítem 9.28 → implementa 9.29)

Especificación "mascada" del ítem 9.28 del ROADMAP. Mismo criterio que `SPECS-7A.md` / `SPECS-9.md`:
**todas las decisiones de diseño están tomadas AQUÍ.** El ejecutor de 9.29 (modelo barato) NO debe
tomar ninguna decisión: copia el SQL literal, las firmas de función/componente y los tests tal cual.

**Alcance de 9.28 (esta spec):** SOLO el diseño escrito. NO implementa nada.
**Alcance de 9.29 (otra orden):** crea la migración `0032_*`, el componente `RequireRol`, el gateo
de la UI enumerado en §4/§5 y los tests.

Objetivo de producto (decisiones YA CERRADAS con el usuario, NO reabrir):

- **3 roles** en la columna nueva `gestor.rol`:
  - `admin` — dueño / máximo nivel: TODO, incluye gestión de equipo/invitaciones, ver
    coste/precio/margen, exportar nómina, borrar cosas.
  - `gestor_operativo` — día a día: asignar viajes/chóferes/vehículos, gestionar hitos e
    incidencias, subir documentos, ver el centro de mando. **SIN** coste/precio/margen de viaje,
    **SIN** exportar nómina, **SIN** gestión de equipo, **SIN** borrar documentos/viajes.
  - `solo_lectura` — ve todo, no muta nada.
- **Expulsar = desactivar** (`gestor.activo=false`), **NO borrar** — el historial permanece intacto
  para auditoría. Se descarta el flujo 4-eyes por ahora (revisar más adelante).
- Todo gestor YA EXISTENTE conserva su acceso actual sin sorpresas: default `rol='admin'`,
  default `activo=true`. **NO es una restricción retroactiva silenciosa** para nadie que use hoy el
  sistema.

**Honestidad (política 0.6 del repo):** el gateo del dashboard (§4) es UX, no seguridad. La
seguridad real la da el RLS de Postgres (§2). Ambas capas son necesarias (defensa en profundidad,
igual que 0019), pero si sólo se implementa una, debe ser la de Postgres.

---

## 1. Estado verificado del esquema y el código (PASO 0 — la verdad manda sobre suposiciones)

Este repo ha sufrido **drift de esquema real** más de una vez (ver `SPECS-9.md` §1.2, `tipo_evento`→`tipo`).
Todo lo de abajo está leído a archivo:línea, no asumido.

### 1.1 `current_empresa_id()` — cómo está HOY

`backend/db/migrations/0009_tenancy_multiempresa.sql:10-18`:

```sql
CREATE OR REPLACE FUNCTION public.current_empresa_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT empresa_id FROM gestor WHERE auth_user_id = auth.uid() LIMIT 1
$$;
```

- Es `SECURITY DEFINER` **a propósito** (evita recursión de RLS al leer `gestor` desde dentro de otra
  policy) — `0009:8-9`.
- `REVOKE EXECUTE ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;` (`0009:20-21`). El
  advisor de Supabase marca el SECURITY DEFINER ejecutable por `authenticated` como WARN aceptado
  (`0009:22-25`).
- **TODAS** las policies de aislamiento por empresa cuelgan de esta función: `chofer`, `viaje`,
  `vehiculo`, `plantilla_ruta` (`0009:32-38`), `hito`, `ejecucion_evento`, `pod`, `incidencia`,
  `valoracion` (`0009:47-54`), `ubicacion` (`0009:58-61`), `plantilla_hito` (`0009:64-67`),
  `empresa` (`0009:76-83`), `gestor` (`0009:92-99`). También `invitacion`
  (`0018_invitaciones.sql:35-45`), `gasto_viaje`, `nota_gestor`, `parking`, `decision_asignacion`,
  etc. de migraciones posteriores.
- **Consecuencia clave para §3:** si `current_empresa_id()` devolviese NULL para un gestor,
  `empresa_id = current_empresa_id()` → `empresa_id = NULL` → **falso para toda fila** (NULL no
  iguala nada en SQL). Es decir, un gestor con `current_empresa_id()=NULL` pierde acceso a TODO
  automáticamente, sin tocar ninguna policy. Este es el mecanismo que explota §3.

### 1.2 Patrón REVOKE/GRANT de columna ya existente (0019)

`backend/db/migrations/0019_seguridad_columnas.sql`: RLS de columna a `authenticated`, defensa en
profundidad **adicional** al RLS de fila (`0019:33-34`):

- `gestor.auth_user_id`: inmutable desde dashboard →
  `REVOKE UPDATE ON gestor FROM authenticated; GRANT UPDATE (nombre,email,notif_incidencias,notif_entregas,notif_fuera_ventana,telegram_chat_id) ON gestor TO authenticated;`
  (`0019:42-44`). **`empresa_id` y `auth_user_id` quedan fuera de la lista de UPDATE por diseño.**
- `chofer.chat_id`: `REVOKE UPDATE ON chofer FROM authenticated; GRANT UPDATE (nombre,idioma,telefono) ...`
  (`0019:51-53`).
- `ejecucion_evento`, `ubicacion`: solo lectura para el dashboard →
  `REVOKE INSERT, UPDATE, DELETE ... FROM authenticated;` (`0019:57-58`).

**Este patrón es la referencia**: cuando queramos bloquear COLUMNAS concretas de una tabla que el
gestor sí puede tocar en general, usamos GRANT de columna; cuando queramos bloquear FILAS o
OPERACIONES enteras condicionadas al rol, usamos policy RLS. §2 decide caso por caso.

### 1.3 `usar_invitacion()` y el bootstrap (0018) — la trampa a NO reabrir

`backend/db/migrations/0018_invitaciones.sql:50-68`: canje de invitación por función SECURITY
DEFINER, porque un usuario recién registrado **aún no tiene fila en `gestor`** y `current_empresa_id()`
sería NULL, con lo que no podría leer `invitacion` por RLS (`0018:6-11`). El alta real está en
`dashboard/lib/auth.js:18-82` (`signUp`): crea empresa (sin RETURNING, `id` generado en cliente —
`auth.js:64-68`) y luego inserta la fila `gestor` (`auth.js:71-77`).

**Riesgo análogo para la expulsión (§3):** un gestor recién desactivado no debe seguir pasando checks
por caché de sesión. Como el JWT no lleva `activo`, la comprobación NO puede vivir en el JWT: debe
vivir en la BD, consultada en cada policy. Por eso §3 mete `activo` dentro de la propia
`current_empresa_id()` (o una función auxiliar), que se re-evalúa en cada query.

### 1.4 Resolución sesión→gestor→empresa en el dashboard

`dashboard/lib/data.js:310-324` (`getCurrentEmpresaId`): **re-consulta `gestor` en cada llamada**
(`data.js:314-318`, `.select("empresa_id").eq("auth_user_id", session.user.id).single()`), NO cachea.
Este es el punto natural para leer también `rol` y `activo`. `dashboard/app/components/AuthGuard.jsx`
sólo distingue sesión / no-sesión (`AuthGuard.jsx:29-33`) y deja pasar `/t/` (portal público,
`:19`); **no sabe nada de gestor ni rol** → el gateo por rol NO encaja en AuthGuard, necesita
resolver el gestor primero. §4 define un `RolProvider` + `RequireRol` para eso.

### 1.5 Tablas/columnas sensibles y operaciones de mutación (inventario real, archivo:línea)

**Columnas de coste/precio/margen (empresa-level, en tabla `empresa`):** `coste_km`,
`precio_gasoil_litro`, `coste_peaje_km`, `dieta_noche_eur`, `coste_conductor_km`,
`margen_objetivo_pct` (leídas en `data.js:1211,1228,1244,1246,1247,1323,1383,1604`; escritas en
`ajustes/page.jsx:127` `empresa.update({coste_km})` y `:146-150` `empresa.update({...})`).

**Columnas de coste a nivel vehículo (tabla `vehiculo`):** `coste_km`, `consumo_l_100km` (leídas
`data.js:1210,1228,1325,1385`; escritas `vehiculos/[id]/page.jsx:89`
`vehiculo.update({coste_km,consumo_l_100km})`).

**Precio de viaje (tabla `viaje`, columna `precio`):** escrito en `viajes/[id]/page.jsx:176`
`viaje.update({precio})` (con auditoría `:177`).

**Tabla `invitacion` completa** (`0018`): gestión de equipo. Escrita vía `createInvitacion`
(`data.js:339-349`) y `deleteInvitacion` (`data.js:351-353`).

**Tabla `gasto_viaje`:** `deleteGastoViaje` (`data.js:1462-1463`), `createGastoViaje`.

**Operaciones DELETE existentes en el dashboard (verificadas, lista completa):**
| Tabla | Función / sitio | archivo:línea |
|-------|-----------------|---------------|
| `invitacion` | `deleteInvitacion` | `data.js:352-353` |
| `gasto_viaje` | `deleteGastoViaje` | `data.js:1462-1463` |
| `parking` | `deleteParkingPropio` | `data.js:1746-1747` |
| `documento` | inline `borrar(doc)` | `components/DocumentosSection.jsx:105` |
| `mantenimiento_vehiculo` | inline `borrar(regId)` | `vehiculos/[id]/page.jsx:126` |

**NOTA IMPORTANTE (verdad del repo):** **NO existe hoy ningún DELETE de `viaje`, `vehiculo` ni
`chofer` en el dashboard** (grep exhaustivo sobre `dashboard/` — sólo hay los 5 DELETE de arriba).
La orden menciona "borrar viajes/vehículos/chóferes" como escenario a bloquear, pero **hoy esos
botones no existen**. Decisión: 9.29 **NO crea** botones de borrado nuevos; sólo gateará los DELETE
que YA existen (documento, gasto_viaje, mantenimiento, invitacion, parking) y el RLS de §2 debe
cerrar el DELETE **incondicionalmente por rol** en esas tablas por si un día se añade el botón o por
REST directo. `parking` propio: es dato de baja sensibilidad, pero se gatea igual por coherencia.

**Botón exportar CSV de nómina:** `nomina/page.jsx:12` (`function exportarCSV`), botón en `:57-60`
(`onClick={() => exportarCSV(...)}`). La exportación es 100% cliente (Blob, `:23-27`) sobre datos ya
cargados; no hay endpoint que gatear → el bloqueo aquí es SOLO UI (ocultar el botón). Aceptable: el
`solo_lectura`/`gestor_operativo` ya ve la nómina en pantalla; lo que se le niega es la
descarga/exportación, que es una decisión de producto, no un secreto (los datos ya están en su
DOM). Se documenta esta limitación explícitamente.

**Precio editable en la ficha de viaje:** botón "Precio" `viajes/[id]/page.jsx:425-430`, form de
edición `:435-449`, `guardarPrecio` `:166-181`. El margen/coste se muestra en `:453-460`.

**Paso de coste/precio del wizard de nuevo viaje:** `viajes/nuevo-w/page.jsx` — input precio `:192-194`,
panel "Coste estimado" `:279-283`, "Precio sugerido" `:285-287`. El precio se guarda al crear el
viaje (`:137`).

**Ajustes — secciones a gatear:** "Equipo" (invitaciones) `ajustes/page.jsx:364-416`; "Coste de
operación" `:474-500`; "Coste desglosado (avanzado)" `:541-589`.

---

## 2. Migración `0032_roles_gestor.sql` — SQL literal completo

Convenciones respetadas (0.1 de SPECS-7A): cabecera explicando el porqué; aplicar por
`apply_migration` (project_id `hloqddmdwinvjksqkhey`) o `python backend/db/migrate.py`; registrar
checksum en `schema_migrations`. La 0030 es la última HOY (0031 la crea 9.7 en paralelo; **si al
aplicar ya existe una 0031, esta sigue siendo 0032** — no renumerar, ambas son independientes).

**Crear el archivo con Write/Edit, NUNCA con `Set-Content -Encoding UTF8`** (BOM rompe el checksum /
`read_text(encoding="utf-8")` de `migrate.py`).

### 2.1 Decisión de arquitectura RLS — caso por caso (NO respuesta genérica)

Dos herramientas disponibles: **(A) RLS de fila condicionado a rol** (`CREATE POLICY ... USING/WITH
CHECK (... AND rol_del_llamante = 'admin')`) y **(B) REVOKE/GRANT de columna** al estilo 0019. Regla
de decisión:

- Si lo sensible es **una columna concreta de una tabla que el gestor SÍ debe poder tocar en
  general** → **(B) GRANT de columna** condicionado NO es posible (los GRANT de columna no dependen
  del rol de aplicación, sólo del rol Postgres, que es `authenticated` para todos). Por tanto para
  distinguir `admin` vs `gestor_operativo` sobre una columna hace falta **(A) policy de fila
  restringida por rol sobre esa columna**, vía una **policy FOR UPDATE separada** o un CHECK que
  compare valores. Ver detalle abajo — Postgres no tiene "column policy por rol", así que se usa
  una policy de UPDATE que compara que las columnas sensibles NO cambian salvo admin.
- Si lo sensible es **una tabla/operación entera** (todo el DELETE, toda la tabla `invitacion`) →
  **(A) policy de fila por rol** es lo natural y suficiente.

Para leer el rol del llamante dentro de una policy sin recursión de RLS, se crea una función
auxiliar SECURITY DEFINER espejo de `current_empresa_id()`:

```sql
CREATE OR REPLACE FUNCTION public.current_gestor_rol()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT rol FROM gestor WHERE auth_user_id = auth.uid() AND activo = true LIMIT 1
$$;
```

`activo=true` en el WHERE: un gestor desactivado devuelve `rol=NULL` → falla todo check `= 'admin'`.
Doble seguridad además de §3 (que ya le corta `current_empresa_id`).

### 2.2 Tabla resumen de la decisión por recurso

| Recurso sensible | Mecanismo | Por qué |
|------------------|-----------|---------|
| `empresa.coste_km, precio_gasoil_litro, coste_peaje_km, dieta_noche_eur, coste_conductor_km, margen_objetivo_pct` | **(A) policy UPDATE por rol** que exige que estas columnas no cambien salvo `admin` | La fila `empresa` es única por tenant y el gestor operativo SÍ edita otros campos de empresa (nombre, base…); no se puede revocar la tabla entera. Un GRANT de columna no distingue rol. Solución: policy que bloquea el UPDATE si cambia una columna de coste y no eres admin. |
| `vehiculo.coste_km, consumo_l_100km` | **(A) policy UPDATE por rol** análoga (columnas de coste inmutables salvo admin) | El operativo edita el vehículo (matrícula, notas) pero no su coste. Misma lógica que empresa. |
| `viaje.precio` | **(A) policy UPDATE por rol** (precio inmutable salvo admin) | El operativo cambia `chofer_id`, `estado`, `vehiculo_id` del viaje (7A.3), pero NO el precio. |
| `invitacion` (INSERT/DELETE, toda la tabla) | **(A) policy de fila por rol = admin** en INSERT y DELETE; SELECT sigue abierto a la empresa | Gestión de equipo es exclusiva de admin. Tabla entera → policy limpia. |
| DELETE en `documento`, `gasto_viaje`, `mantenimiento_vehiculo`, `parking` | **(A) policy DELETE por rol** (`admin` o `gestor_operativo`; `solo_lectura` nunca) — ver matiz | Borrar es mutación. `solo_lectura` nunca borra. `gestor_operativo` SÍ borra documentos/gastos/mantenimiento (es día a día); la orden dice "SIN borrar documentos/viajes" para operativo → **decisión cerrada:** operativo NO borra `documento` (evidencia), SÍ borra `gasto_viaje`/`mantenimiento`/`parking` (operativa corriente). Ver §2.4. |
| Cualquier INSERT/UPDATE/DELETE de datos operativos (`viaje`, `hito`, `incidencia`, `chofer`, `vehiculo`, `gasto_viaje`, `documento`, `nota_gestor`, `decision_asignacion`, `pod`…) por `solo_lectura` | **(A) restricción global: `solo_lectura` no muta nada** — ver §2.5 | Un solo mecanismo que niega toda escritura al rol lector, sin enumerar 17 tablas. |

**Por qué NO GRANT de columna aquí:** el GRANT/REVOKE de columna de 0019 sirve cuando la columna está
prohibida para **TODO** `authenticated` (auth_user_id, chat_id). Aquí la columna (p.ej.
`empresa.coste_km`) está permitida para `admin` y prohibida para `gestor_operativo`, y **ambos son el
mismo rol Postgres `authenticated`**. Postgres no puede distinguirlos con GRANT de columna → hay que
usar policy RLS que consulta el rol de aplicación (`current_gestor_rol()`). Por eso todas las filas de
la tabla son (A), no (B). El patrón 0019 (B) se conserva intacto para lo que ya cubría; no se toca.

### 2.3 SQL literal — columnas nuevas + función auxiliar

```sql
-- ============================================================
-- Norenty 9.28/9.29 — Roles de gestor + desactivación (expulsión).
--
-- Hasta hoy cualquier gestor de una empresa podía hacerlo TODO (no había roles)
-- y no había forma de expulsar a uno que se fuera. Esta migración añade:
--   gestor.rol    ∈ {admin, gestor_operativo, solo_lectura}   DEFAULT 'admin'
--   gestor.activo boolean                                     DEFAULT true
-- Defaults elegidos para que NINGÚN gestor existente pierda acceso tras migrar
-- (todos quedan admin/activo). No es restricción retroactiva silenciosa.
--
-- La expulsión se implementa como activo=false (NO borrar: el historial queda
-- para auditoría). El corte de acceso es INSTANTÁNEO porque current_empresa_id()
-- se re-evalúa en cada query y ahora exige activo=true (ver §3): un gestor
-- desactivado obtiene current_empresa_id()=NULL y pierde acceso a TODA tabla
-- cuya policy dependa de esa función, sin tocar las 17 policies una por una.
--
-- Seguridad real = RLS de Postgres (abajo). El gateo del dashboard es UX; un
-- gestor_operativo NO puede escribir coste/precio ni por REST directo saltándose
-- la UI, porque estas policies lo rechazan en el motor.
-- ============================================================

-- 1) Columnas nuevas. Defaults conservadores (todos los existentes = admin/activo).
ALTER TABLE public.gestor
  ADD COLUMN IF NOT EXISTS rol text NOT NULL DEFAULT 'admin'
    CHECK (rol IN ('admin','gestor_operativo','solo_lectura'));
ALTER TABLE public.gestor
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

-- Índice: las funciones auxiliares filtran por auth_user_id (ya PK/único de facto)
-- y activo; un índice parcial acelera el lookup del gestor activo del JWT actual.
CREATE INDEX IF NOT EXISTS idx_gestor_auth_activo
  ON public.gestor (auth_user_id) WHERE activo = true;

-- 2) Rol del gestor llamante (NULL si desactivado o sin fila). SECURITY DEFINER
--    para no recursar RLS al leer gestor desde otra policy (mismo motivo que
--    current_empresa_id, 0009).
CREATE OR REPLACE FUNCTION public.current_gestor_rol()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT rol FROM gestor
   WHERE auth_user_id = auth.uid() AND activo = true
   LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.current_gestor_rol() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_gestor_rol() TO authenticated;
```

### 2.4 SQL literal — policies por rol (columnas sensibles y borrados)

**Patrón para "columna inmutable salvo admin" en un UPDATE:** Postgres evalúa `WITH CHECK` sobre la
fila NUEVA pero NO da acceso a la fila vieja dentro de la policy. La forma robusta y estándar es una
policy `FOR UPDATE` cuyo `USING` (fila vieja) y `WITH CHECK` (fila nueva) restrinjan por rol, más un
**trigger BEFORE UPDATE** que rechace el cambio de la columna concreta si `current_gestor_rol() <>
'admin'` (porque comparar viejo≠nuevo de UNA columna dentro de una policy no es expresable). Decisión
cerrada: **usar trigger para el nivel columna** (empresa/vehiculo/viaje) y **policy para el nivel
tabla/operación** (invitacion/delete/solo_lectura). Justificación: el trigger es la única forma de
comparar `OLD.col <> NEW.col`, y corre en el motor igual para REST directo. El trigger consulta
`current_gestor_rol()`.

```sql
-- 3) Trigger que impide a NO-admins cambiar columnas de coste/precio.
--    Se aplica a empresa, vehiculo, viaje. Compara OLD vs NEW de las columnas
--    protegidas; si cambian y el llamante no es admin -> excepción.
CREATE OR REPLACE FUNCTION public.rol_bloquea_columnas_sensibles()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rol text := public.current_gestor_rol();
BEGIN
  -- service role / procesos internos: auth.uid() es NULL -> v_rol NULL -> NO bloquear
  -- (el bot/backend usa service role y salta RLS; este trigger no debe frenarlo).
  IF v_rol IS NULL THEN
    -- Distinguir "sin sesión de gestor" (service role, permitir) de "gestor
    -- desactivado" (ya bloqueado por current_empresa_id en la policy de fila,
    -- que ni siquiera deja llegar aquí). Si auth.uid() ES NULL -> service role.
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;
    -- auth.uid() no nulo pero rol NULL = gestor desactivado/sin fila: bloquear.
    RAISE EXCEPTION 'gestor sin rol activo no puede modificar columnas sensibles';
  END IF;

  IF v_rol = 'admin' THEN
    RETURN NEW;  -- admin puede todo
  END IF;

  IF TG_TABLE_NAME = 'empresa' THEN
    IF NEW.coste_km IS DISTINCT FROM OLD.coste_km
       OR NEW.precio_gasoil_litro IS DISTINCT FROM OLD.precio_gasoil_litro
       OR NEW.coste_peaje_km IS DISTINCT FROM OLD.coste_peaje_km
       OR NEW.dieta_noche_eur IS DISTINCT FROM OLD.dieta_noche_eur
       OR NEW.coste_conductor_km IS DISTINCT FROM OLD.coste_conductor_km
       OR NEW.margen_objetivo_pct IS DISTINCT FROM OLD.margen_objetivo_pct THEN
      RAISE EXCEPTION 'rol % no puede modificar costes de empresa', v_rol;
    END IF;
  ELSIF TG_TABLE_NAME = 'vehiculo' THEN
    IF NEW.coste_km IS DISTINCT FROM OLD.coste_km
       OR NEW.consumo_l_100km IS DISTINCT FROM OLD.consumo_l_100km THEN
      RAISE EXCEPTION 'rol % no puede modificar costes de vehiculo', v_rol;
    END IF;
  ELSIF TG_TABLE_NAME = 'viaje' THEN
    IF NEW.precio IS DISTINCT FROM OLD.precio THEN
      RAISE EXCEPTION 'rol % no puede modificar el precio del viaje', v_rol;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rol_sensibles_empresa ON public.empresa;
CREATE TRIGGER trg_rol_sensibles_empresa BEFORE UPDATE ON public.empresa
  FOR EACH ROW EXECUTE FUNCTION public.rol_bloquea_columnas_sensibles();

DROP TRIGGER IF EXISTS trg_rol_sensibles_vehiculo ON public.vehiculo;
CREATE TRIGGER trg_rol_sensibles_vehiculo BEFORE UPDATE ON public.vehiculo
  FOR EACH ROW EXECUTE FUNCTION public.rol_bloquea_columnas_sensibles();

DROP TRIGGER IF EXISTS trg_rol_sensibles_viaje ON public.viaje
  ;
CREATE TRIGGER trg_rol_sensibles_viaje BEFORE UPDATE ON public.viaje
  FOR EACH ROW EXECUTE FUNCTION public.rol_bloquea_columnas_sensibles();
```

**NOTA de compatibilidad con 0031 hash-chain:** 0031 pone un trigger `BEFORE INSERT` en
`ejecucion_evento`, no en `viaje`; no colisiona. Si 0031 añadiera algún trigger sobre `viaje`, el
orden de disparo es alfabético por nombre — ambos son independientes y sólo leen/validan, sin
conflicto.

```sql
-- 4) invitacion: crear/borrar solo admin. SELECT sigue abierto a la empresa (0018).
--    Se REEMPLAZAN las policies de INSERT/DELETE de 0018 por versiones que exigen rol.
DROP POLICY IF EXISTS "empresa crea invitaciones" ON public.invitacion;
CREATE POLICY "admin crea invitaciones" ON public.invitacion
  FOR INSERT WITH CHECK (
    empresa_id = current_empresa_id() AND current_gestor_rol() = 'admin'
  );

DROP POLICY IF EXISTS "empresa borra sus invitaciones" ON public.invitacion;
CREATE POLICY "admin borra invitaciones" ON public.invitacion
  FOR DELETE USING (
    empresa_id = current_empresa_id() AND current_gestor_rol() = 'admin'
  );
-- La policy SELECT de 0018 ("empresa ve sus invitaciones") se deja intacta.

-- 5) gestor: solo admin puede UPDATE (cambiar rol / desactivar) filas de gestores
--    de su empresa; y NUNCA su propia fila (evita autobloqueo). Reemplaza la
--    policy gestor_update_empresa de 0009. La regla "no a sí mismo" se refuerza
--    también en trigger (§5) por si acaso.
DROP POLICY IF EXISTS gestor_update_empresa ON public.gestor;
CREATE POLICY gestor_update_admin ON public.gestor
  FOR UPDATE
  USING (
    empresa_id = current_empresa_id()
    AND current_gestor_rol() = 'admin'
    AND auth_user_id IS DISTINCT FROM auth.uid()   -- no editar tu propia fila
  )
  WITH CHECK (
    empresa_id = current_empresa_id()
    AND current_gestor_rol() = 'admin'
    AND auth_user_id IS DISTINCT FROM auth.uid()
  );
-- IMPORTANTE: 0019:42-44 revocó UPDATE de columna sobre gestor y concedió solo
-- (nombre,email,notif_*,telegram_chat_id). Para que el admin pueda escribir
-- `rol` y `activo`, AMPLIAR el GRANT de columna:
GRANT UPDATE (rol, activo) ON public.gestor TO authenticated;
-- (auth_user_id y empresa_id siguen fuera; el gateo por rol lo hace la policy.)
```

### 2.5 SQL literal — `solo_lectura` no muta nada (mecanismo global, sin enumerar 17 tablas)

`solo_lectura` no debe poder INSERT/UPDATE/DELETE en NINGUNA tabla de negocio. En vez de añadir
`AND current_gestor_rol() <> 'solo_lectura'` a decenas de policies, se aprovecha que **todas** las
policies de escritura ya dependen de `current_empresa_id()`. Se crea una función que devuelve la
empresa **solo si el gestor puede escribir** y se usa en las policies de mutación. Pero como
reescribir 17 policies es justo lo que queremos evitar, la decisión cerrada es:

**Mecanismo elegido — `current_empresa_id()` para LECTURA sigue igual; se añade
`current_empresa_id_rw()` (read-write) para las policies de escritura de las tablas de negocio.**
No obstante, reescribir cada `WITH CHECK` es costoso y propenso a huecos. **Decisión final (más
simple y sin huecos):** para `solo_lectura` se hace a nivel de **privilegio Postgres NO** (no se
puede, es el mismo rol `authenticated`), así que se usa **un trigger genérico de bloqueo de escritura
por rol** replicado sobre las tablas de negocio mutables, MÁS el gateo de UI. Como eso son muchos
triggers, se centraliza en una función y se aplica con un `DO $$ FOREACH tabla $$`:

```sql
-- 6) solo_lectura: bloquear INSERT/UPDATE/DELETE en todas las tablas de negocio
--    mutables desde el dashboard. Un trigger por tabla, misma función.
CREATE OR REPLACE FUNCTION public.solo_lectura_bloquea_escritura()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- service role (auth.uid() NULL) nunca se bloquea.
  IF auth.uid() IS NOT NULL AND public.current_gestor_rol() = 'solo_lectura' THEN
    RAISE EXCEPTION 'rol solo_lectura no puede modificar datos';
  END IF;
  RETURN COALESCE(NEW, OLD);  -- NEW en INSERT/UPDATE, OLD en DELETE
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'viaje','hito','incidencia','chofer','vehiculo','plantilla_ruta',
    'plantilla_hito','gasto_viaje','documento','nota_gestor',
    'decision_asignacion','parking','mantenimiento_vehiculo','valoracion',
    'pod','empresa','invitacion','gestor'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_solo_lectura_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_solo_lectura_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.solo_lectura_bloquea_escritura()', t, t);
  END LOOP;
END $$;
```

**Por qué trigger genérico y no policy:** una policy `FOR ALL ... AND current_gestor_rol() <> 'solo_lectura'`
habría que meterla tabla por tabla y reescribir las de 0009/0018 (riesgo de hueco si se olvida una).
El trigger genérico se aplica en bucle sobre la lista, es una sola función, y **falla cerrado** (si
olvidas una tabla en el array, esa tabla simplemente no gana la protección extra pero sigue con su
RLS de empresa — no abre un hueco de tenant, solo de rol; y la lista es revisable de un vistazo).
Cubre 100% de mutaciones incluso por REST directo. `ejecucion_evento`/`ubicacion` NO van en la lista
porque 0019 ya las revocó por completo para `authenticated`.

**Registro del checksum (obligatorio):**
```
python -c "import hashlib,pathlib; sql=pathlib.Path('backend/db/migrations/0032_roles_gestor.sql').read_text(encoding='utf-8'); print(hashlib.sha256(sql.encode('utf-8')).hexdigest())"
```
```sql
INSERT INTO schema_migrations (filename, checksum)
VALUES ('0032_roles_gestor.sql','<hash>') ON CONFLICT (filename) DO NOTHING;
```
(Si se aplica con `python backend/db/migrate.py`, el runner inserta el checksum solo,
`migrate.py:84-87`.)

---

## 3. Expulsión/desactivación — mecanismo de instantaneidad (decisión cerrada)

**Requisito:** `activo=false` corta el acceso YA, no en el próximo login.

**Opción elegida: A — modificar `current_empresa_id()` para exigir `activo=true`.**

```sql
-- Reemplaza la de 0009: ahora un gestor desactivado obtiene NULL.
CREATE OR REPLACE FUNCTION public.current_empresa_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT empresa_id FROM gestor
   WHERE auth_user_id = auth.uid() AND activo = true
   LIMIT 1
$$;
-- GRANTs igual que 0009 (ya están; CREATE OR REPLACE los conserva). Confirmar:
REVOKE EXECUTE ON FUNCTION public.current_empresa_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_empresa_id() TO authenticated;
```

**Por qué A y no tabla por tabla:** TODAS las policies de aislamiento (17+ tablas, §1.1) ya cuelgan
de `current_empresa_id()`. Al meter `activo=true` en esa única función, un gestor desactivado obtiene
`current_empresa_id()=NULL`, y como `empresa_id = NULL` es falso para toda fila (§1.1), pierde acceso
de lectura y escritura a TODO instantáneamente, en su siguiente query, sin tocar ni una policy.
Hacerlo tabla por tabla (añadir `AND activo` a cada USING) sería 17+ ediciones con riesgo alto de
olvidar una y dejar un hueco por el que un gestor expulsado siga leyendo/escribiendo. **A es un único
punto de control, imposible de saltarse parcialmente.**

**Trade-off evaluado:** `current_empresa_id()` pasa a filtrar por `activo` además de `auth_user_id`.
Coste: idéntico en la práctica (mismo `SELECT ... LIMIT 1` sobre el índice; el índice parcial
`idx_gestor_auth_activo` de §2.3 lo cubre). No hay penalización real. El riesgo de dejar huecos
(opción tabla-por-tabla) supera de largo el coste marginal nulo de A. **Cerrado: opción A.**

**Efecto colateral deseado y su matiz:** un gestor desactivado ya no puede ni siquiera LEER su propia
empresa (`empresa_select_propia` usa `id = current_empresa_id()` → NULL). El dashboard, al llamar
`getCurrentEmpresaId` (`data.js:310`), recibirá 0 filas / error "sin empresa asociada" y lo tratará
como sesión inválida (§4 lo redirige a un aviso "tu acceso ha sido revocado"). Esto es lo correcto:
funcionalmente está fuera.

### 3.1 ¿Forzar cierre de sesión Supabase Auth del expulsado?

**Decisión: NO es necesario para la seguridad; SÍ recomendable como higiene de UX, pero opcional en
9.29.** Razonamiento:

- El JWT del gestor expulsado sigue siendo **técnicamente válido** hasta que expire (Supabase por
  defecto ~1h de access token + refresh). Pero con opción A, ese JWT **no da acceso a NADA por RLS**:
  toda query devuelve 0 filas o "permission denied"/excepción de trigger. Un JWT válido sin acceso a
  nada es **funcionalmente equivalente a estar fuera**.
- Forzar el cierre server-side requiere la **Admin API** (`auth.admin.signOut(userId)` /
  invalidar sesiones), que necesita **service role key** — y ese secreto **HOY está VACÍO** en el
  entorno (`SPECS-7A.md` 0.8: "`SUPABASE_SERVICE_ROLE_KEY` está VACÍA (D1 pendiente)"). Meter una
  dependencia de service role en el flujo de desactivación del dashboard es introducir un secreto de
  máximo privilegio en el cliente → **prohibido**. Tendría que hacerse desde un Edge Function/backend,
  fuera de alcance de 9.29.
- **Cerrado:** la seguridad la garantiza el RLS (opción A), NO el cierre de sesión. El JWT residual
  es aceptable porque no puede hacer nada. **9.29 NO implementa cierre forzado de sesión.** Se anota
  como mejora futura (cuando exista service role / Edge Function): un `auth.admin.signOut` para que el
  expulsado vea la pantalla de login de inmediato en vez de "acceso revocado". Es cosmético.

**Aceptabilidad explícita:** SÍ es aceptable que el JWT siga vivo, porque el modelo de amenaza es "un
gestor que se va y no debe seguir tocando datos" — y no los toca. No es un modelo de "atacante con el
token robado intentando exfiltrar en la ventana de 1h": incluso ese caso está cubierto (no lee nada).

---

## 4. Gateo del dashboard — lista EXHAUSTIVA + componente `RequireRol`

**Recordatorio de honestidad:** esto es UX; la seguridad está en §2/§3. Ocultar un botón NO protege
nada por sí solo — pero mejora la experiencia y evita errores. Todo lo listado tiene su respaldo RLS.

### 4.1 `RolProvider` — resolver el rol una vez y compartirlo por contexto

Vive en `dashboard/app/components/` junto a `AuthGuard.jsx` (coherente con 7A.12 sistema de diseño).
`AuthGuard` ya resuelve sesión; `RolProvider` cuelga debajo y resuelve gestor→{rol,activo}.

```jsx
// dashboard/app/components/RolProvider.jsx
"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const RolContext = createContext({ rol: null, activo: null, cargando: true });
export const useRol = () => useContext(RolContext);

export default function RolProvider({ children }) {
  const [estado, setEstado] = useState({ rol: null, activo: null, cargando: true });

  useEffect(() => {
    let vivo = true;
    async function cargar() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { if (vivo) setEstado({ rol: null, activo: null, cargando: false }); return; }
      const { data } = await supabase
        .from("gestor")
        .select("rol, activo")
        .eq("auth_user_id", session.user.id)
        .single();
      if (vivo) setEstado({ rol: data?.rol ?? null, activo: data?.activo ?? null, cargando: false });
    }
    cargar();
    const { data: sub } = supabase.auth.onAuthStateChange(() => cargar());
    return () => { vivo = false; sub?.subscription?.unsubscribe(); };
  }, []);

  return <RolContext.Provider value={estado}>{children}</RolContext.Provider>;
}
```

**Dónde montarlo:** envolver `children` de `AuthGuard` cuando hay sesión. En
`AuthGuard.jsx:33` (`return children;`), cambiar a `return <RolProvider>{children}</RolProvider>;`.
**PERO** la orden prohíbe tocar `Sidebar.jsx` (otra orden en vuelo) — `AuthGuard.jsx` SÍ se puede
tocar. Si 9.29 encuentra conflicto, montar `RolProvider` en el layout raíz
(`dashboard/app/layout.jsx`) por debajo de `AuthGuard`. Decisión: **9.29 monta `RolProvider` en
`AuthGuard.jsx:33`**; si eso colisiona con otra orden, en `layout.jsx`.

**Manejo de gestor desactivado en cliente:** si `activo === false`, `RolProvider` muestra (en vez de
children) un aviso "Tu acceso a esta empresa ha sido revocado. Contacta con un administrador." Esto
NO es la barrera de seguridad (lo es el RLS), es UX para que no vea una app rota.

### 4.2 `RequireRol` — guarda declarativa reutilizable

```jsx
// dashboard/app/components/RequireRol.jsx
"use client";
import { useRol } from "./RolProvider";

/**
 * Renderiza children SOLO si el rol del gestor logueado está permitido.
 * Uso: <RequireRol roles={["admin"]}>...</RequireRol>
 *      <RequireRol rol="admin">...</RequireRol>   (azúcar de roles={[rol]})
 * `admin` SIEMPRE pasa (superset) salvo que se excluya explícitamente.
 * Mientras carga el rol, no renderiza nada (evita parpadeo del botón).
 * `fallback` opcional para mostrar algo en lugar de ocultar.
 */
export default function RequireRol({ rol, roles, children, fallback = null }) {
  const { rol: rolActual, cargando } = useRol();
  if (cargando) return null;
  const permitidos = roles ?? (rol ? [rol] : []);
  return permitidos.includes(rolActual) ? children : fallback;
}
```

**Decisión sobre `solo_lectura` (más simple sin huecos):** NO se crea un "modo readOnly global" en
cliente. Se envuelve cada **botón/acción de mutación** con `RequireRol roles={["admin","gestor_operativo"]}`
(es decir: "cualquiera menos solo_lectura"). Como el RLS ya bloquea a `solo_lectura` en el motor (§2.5),
el gateo de UI es sólo para no mostrarle botones que fallarían. Regla mecánica para 9.29: **todo
`onClick` que llame a una función que hace `.insert/.update/.delete` va envuelto en `RequireRol
roles={["admin","gestor_operativo"]}`** (o `roles={["admin"]}` si además es exclusivo de admin, ver
tabla). Ningún modo global → ningún hueco por "olvidé activar el modo".

### 4.3 Lista EXHAUSTIVA de sitios a gatear (archivo:línea + rol requerido)

| # | Qué se oculta/bloquea | archivo:línea | `RequireRol roles=` |
|---|-----------------------|---------------|---------------------|
| 1 | Ajustes → sección "Equipo" completa (invitar + lista invitaciones) | `ajustes/page.jsx:364-416` | `["admin"]` |
| 2 | Ajustes → "Coste de operación" (input + botón Guardar coste) | `ajustes/page.jsx:474-500` | `["admin"]` |
| 3 | Ajustes → "Coste desglosado (avanzado)" | `ajustes/page.jsx:541-589` | `["admin"]` |
| 4 | Nómina → botón "Exportar CSV" | `nomina/page.jsx:57-60` | `["admin"]` |
| 5 | Ficha viaje → botón "Precio" (editar) | `viajes/[id]/page.jsx:425-430` | `["admin"]` |
| 6 | Ficha viaje → bloque coste/margen mostrado (`:453-460`) | `viajes/[id]/page.jsx:453-460` | `["admin"]` (ocultar cifras de margen/coste a operativo/lectura) |
| 7 | Wizard nuevo viaje → input Precio | `viajes/nuevo-w/page.jsx:192-194` | `["admin"]` |
| 8 | Wizard → panel "Coste estimado" y "Precio sugerido" | `viajes/nuevo-w/page.jsx:279-287` | `["admin"]` |
| 9 | DocumentosSection → botón eliminar documento | `components/DocumentosSection.jsx:249-253` | `["admin"]` (operativo NO borra evidencia; ver §2.2) |
| 10 | GastosViajeSection → botón borrar gasto | `components/GastosViajeSection.jsx:177-179` | `["admin","gestor_operativo"]` |
| 11 | Vehículo → botón eliminar registro mantenimiento | `vehiculos/[id]/page.jsx:381` (botón), `borrar` `:123-129` | `["admin","gestor_operativo"]` |
| 12 | Vehículo → input coste/consumo + Guardar coste | `vehiculos/[id]/page.jsx:67-68` (inputs), `:89` (save), botón `:211` | `["admin"]` |
| 13 | Parking → botón borrar parking propio | (sitio que llame `deleteParkingPropio`, `data.js:1746`) | `["admin","gestor_operativo"]` |

**Nota sobre `#6/#8` (ocultar cifras de coste/margen a la vista):** la orden dice que
`gestor_operativo` NO tiene acceso a coste/precio/margen de viaje. Como el precio/coste se calcula en
cliente (`data.js` `getViabilidadViaje`), ocultar el bloque en la UI es suficiente para no mostrarlo;
NO hay policy de columna de SELECT que ocultar (esos valores viven en `empresa`/`vehiculo`/`viaje` y
el operativo puede leerlos técnicamente por RLS de SELECT). **Limitación honesta documentada:** un
`gestor_operativo` que abra devtools PODRÍA leer `empresa.coste_km` vía REST (SELECT está abierto a la
empresa). Ocultar la LECTURA de coste a nivel Postgres requeriría RLS de columna de SELECT o vistas,
que es más invasivo. **Decisión cerrada:** para 9.29 el coste/margen se OCULTA en UI (suficiente para
el requisito de producto "no lo ve en su día a día"); el bloqueo duro de LECTURA de coste queda como
mejora futura si el usuario lo pide (la ESCRITURA sí está bloqueada duro por §2). Esto se dice tal cual.

---

## 5. Sección "Equipo" en Ajustes — cambios necesarios

Hoy `ajustes/page.jsx:364-416` sólo lista invitaciones. 9.29 añade **listado de gestores de la
empresa** con gestión de rol/estado, visible/editable SOLO para `admin` (envuelto en el `RequireRol
roles={["admin"]}` del punto #1). Cambios:

1. **Nueva función en `data.js`:** `getGestoresEmpresa()` → `select("id, nombre, email, rol, activo, auth_user_id")`
   de `gestor` (RLS ya limita a la empresa, `gestor_select_empresa` de 0009). Ordenar por nombre en JS
   (recordar: `order()` es NO-OP en el mock, 0.3 de SPECS-7A).
2. **Selector de rol por gestor:** `<select>` con las 3 opciones; `onChange` →
   `actualizarRolGestor(gestorId, nuevoRol)` = `supabase.from("gestor").update({ rol }).eq("id", gestorId)`.
   El GRANT de columna de §2.4 permite escribir `rol`; la policy `gestor_update_admin` exige ser admin
   y NO ser tu propia fila.
3. **Botón "Desactivar" con confirmación:** `desactivarGestor(gestorId)` =
   `supabase.from("gestor").update({ activo: false }).eq("id", gestorId)`. Confirmación con diálogo
   (patrón existente de borrado). También un botón "Reactivar" si `activo=false`
   (`update({ activo: true })`).
4. **Regla de seguridad — no a sí mismo (doble barrera):**
   - En UI: el selector de rol y el botón Desactivar de la fila del **propio gestor logueado**
     (comparar `gestor.auth_user_id === session.user.id`) van deshabilitados con tooltip "No puedes
     cambiar tu propio rol ni desactivarte".
   - En BD: la policy `gestor_update_admin` (§2.4) ya incluye `auth_user_id IS DISTINCT FROM auth.uid()`,
     así que aunque burle la UI, Postgres rechaza el UPDATE de su propia fila. **Esto evita que el
     único admin se autobloquee.**
   - **Matiz "último admin":** NO se añade lógica de "no puedes desactivar al último admin" en esta
     versión (complejidad extra). La regla "no a ti mismo" ya impide el autobloqueo directo; el caso
     "admin A desactiva a admin B siendo B el que quería quedarse" es un problema organizativo, no de
     seguridad. Anotado como posible mejora (contar admins activos antes de degradar/desactivar).
5. **Invitaciones pendientes de un gestor que se desactiva — decisión:** las invitaciones NO tienen
   columna "creada_por" hoy (`invitacion` = `id, empresa_id, email, codigo, usada_at, created_at`,
   `0018:18-25`), así que **no se pueden asociar a un gestor concreto** → **no se revocan
   automáticamente** al desactivarlo (no hay forma de saber cuáles eran suyas, y además pertenecen a
   la empresa, no al gestor). Decisión cerrada: las invitaciones pendientes son de la EMPRESA; siguen
   válidas; un admin puede revocarlas manualmente desde la lista (#1). NO se añade columna
   `creada_por` en 9.29 (fuera de alcance). Se documenta.

---

## 6. Casos de test enumerados

**Criterio honesto (igual que `SPECS-9.md` §5 / `isolation.test.js`):** un `gestor_operativo`
intentando UPDATE directo de `empresa.coste_km` vía REST **debe ser rechazado por Postgres**, y eso
**SOLO se prueba contra RLS/trigger real**, NO con el mock de `data.test.js` (que no ejecuta SQL). Dos
grupos:

### 6.1 Grupo A — lógica pura / componente (vitest, mocks — rápido, en `.\ci.ps1`)

- **(A1) `RequireRol` renderiza children si el rol está en `roles`.** Mock de `useRol` devolviendo
  `{rol:"admin", cargando:false}`; `<RequireRol roles={["admin"]}>X</RequireRol>` → X visible.
- **(A2) `RequireRol` NO renderiza si el rol no está.** `useRol`→`{rol:"solo_lectura"}`;
  `roles={["admin"]}` → nada (o `fallback`).
- **(A3) `RequireRol` no renderiza mientras `cargando=true`** (evita parpadeo).
- **(A4) `RolProvider` expone `activo=false`** cuando la fila gestor lo trae (mock de supabase) → el
  aviso de acceso revocado se muestra.
- **(A5) UI "no a sí mismo":** dado el session.user.id, el botón Desactivar de la propia fila está
  `disabled` (test de render de la sección Equipo con mock de `getGestoresEmpresa`).
- **(A6) `getGestoresEmpresa` ordena por nombre en JS** (el mock no ordena — 0.3).

### 6.2 Grupo B — RLS/triggers contra BD real (script `psycopg2`/urllib, NO mocks — manual/documentado)

Es la ÚNICA forma de probar §2/§3. Patrón: crear branch Supabase (`create_branch` del MCP) o BD real,
sembrar 2 gestores (admin + operativo + lectura) de la misma empresa con distintos `rol`, y con el
**JWT de cada uno** (login vía REST) intentar operaciones. Documentar resultado en PROGRESS (patrón
6.9/7A.14 "verificación contra BD real").

- **(B1) operativo NO puede UPDATE `empresa.coste_km` vía REST** → Postgres rechaza (excepción del
  trigger `rol_bloquea_columnas_sensibles`). Caso estrella.
- **(B2) operativo SÍ puede UPDATE otros campos de `empresa`** (p.ej. nombre) → OK (el trigger sólo
  bloquea columnas de coste).
- **(B3) operativo NO puede UPDATE `vehiculo.coste_km` ni `viaje.precio`** → rechazado.
- **(B4) operativo SÍ puede UPDATE `viaje.chofer_id`/`estado`** (día a día) → OK.
- **(B5) operativo NO puede INSERT/DELETE en `invitacion`** → rechazado por policy
  `admin crea/borra invitaciones`.
- **(B6) `solo_lectura` NO puede INSERT/UPDATE/DELETE en NINGUNA tabla de la lista §2.5** (probar al
  menos `viaje`, `gasto_viaje`, `documento`) → rechazado por `solo_lectura_bloquea_escritura`.
- **(B7) `solo_lectura` SÍ puede SELECT** todo lo de su empresa → OK.
- **(B8) EXPULSIÓN INSTANTÁNEA:** con un gestor `activo=true` que lee su empresa OK, hacer
  `UPDATE gestor SET activo=false` (desde el admin), y con el MISMO JWT del expulsado (sin re-login)
  repetir el SELECT de `empresa`/`viaje` → **0 filas / permission denied**. Prueba que
  `current_empresa_id()` corta YA, no en el próximo login. **Caso crítico de §3.**
- **(B9) admin NO puede desactivarse a sí mismo** → `UPDATE gestor SET activo=false WHERE
  auth_user_id = <el suyo>` con su propio JWT → rechazado por policy `gestor_update_admin`
  (`auth_user_id IS DISTINCT FROM auth.uid()`).
- **(B10) admin SÍ puede cambiar rol/activo de OTRO gestor de su empresa** → OK.
- **(B11) gestor existente pre-migración (default admin/activo)** conserva acceso total tras aplicar
  0032 → OK (probar que un gestor sin `rol` explícito quedó `admin`). Verifica el requisito "sin
  sorpresas retroactivas".
- **(B12) service role no se bloquea** por los triggers de rol (auth.uid() NULL) → el bot/backend
  sigue escribiendo `ejecucion_evento`, `viaje`, etc. sin problema.

---

## 7. Trampas del repo relevantes (de `SPECS-7A.md` §0 y `SPECS-9.md` §6, confirmadas aquí)

1. **RETURNING vs RLS bootstrap (0.2):** NO usar `.insert(...).select().single()` donde la policy
   SELECT pueda no ver la fila. No aplica directamente a esta spec (no hay bootstrap nuevo), pero
   `createInvitacion` (`data.js:342-347`) YA usa `.select().single()` — funciona porque el creador es
   un gestor vinculado que sí ve su empresa; al restringir a `admin` sigue viéndose. Sin cambios ahí.
2. **postgrest-py returning=minimal (0.2):** aplica al backend, no al dashboard; no relevante aquí.
3. **Verificación contra BD real OBLIGATORIA para RLS (0.2):** los mocks NO reproducen RLS ni
   triggers → §6.2 (Grupo B) es imprescindible; NO fingir que el Grupo A cubre §2/§3.
4. **Checksum de migraciones (0.1):** registrar SHA-256 de `0032_roles_gestor.sql` en
   `schema_migrations`. El runner avisa si el contenido difiere del checksum (`migrate.py:69`) — **no
   reeditar una migración ya aplicada**; correcciones van en migración nueva.
5. **BOM de PowerShell (0.3):** crear `0032_*.sql` y los `.jsx` con Write/Edit, NUNCA
   `Set-Content -Encoding UTF8` (rompe checksum y resolución de imports de vitest).
6. **`order()` NO-OP en el mock JS (0.3):** `getGestoresEmpresa` debe ordenar en JS, no confiar en
   `.order()` para el test.
7. **0019 revocó UPDATE de columna en `gestor` (0.1 nota):** por eso §2.4 debe hacer
   `GRANT UPDATE (rol, activo) ON gestor TO authenticated` explícito; si se olvida, escribir `rol`/
   `activo` desde el dashboard fallará con "permission denied for column", por diseño de 0019.
8. **`current_empresa_id()` es SECURITY DEFINER y de ella cuelga TODO (§1.1):** modificarla (§3) es un
   cambio de máximo impacto — probar B8/B11 sí o sí antes de dar por bueno. Un error aquí rompe el
   aislamiento de TODOS los tenants.
9. **service role salta RLS y triggers de rol via `auth.uid() IS NULL` (§2.3/§2.5):** los triggers
   deben dejar pasar a service role explícitamente o romperían el bot. Test B12 lo verifica.
10. **`SUPABASE_SERVICE_ROLE_KEY` VACÍA (0.8):** por eso §3.1 NO depende de Admin API para el cierre
    de sesión; la seguridad vive en RLS, no en signOut forzado.
