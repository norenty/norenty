# SPECS 11 — Capa de contexto (ítem 11.2)

Especificación "mascada" del ítem **11.2** del ROADMAP ("Fase 11 — Capa de conocimiento").
Mismo criterio que `SPECS-9.md` / `SPECS-7A.md`: **todas las decisiones de diseño están tomadas
AQUÍ.** El ejecutor (modelo de tier barato) NO debe tomar ninguna decisión: copia el SQL literal,
las firmas de función JS y los tests tal cual.

**Alcance de esta spec: SOLO el diseño escrito. NO implementa nada.** Una orden de trabajo posterior
(tier más barato) implementará literalmente desde este archivo: la migración `0042_contexto.sql`, las
funciones de `dashboard/lib/data.js` y los tests del Grupo A.

Texto literal del roadmap (11.2): *"Capa de contexto atada a las entidades — tabla `contexto`
(nota / transcripción / extracto de email) anclada a viaje/chofer/cliente, con PROCEDENCIA (quién lo
dijo, por qué canal, cuándo), coherente con la trazabilidad de la Fase 8. Día 1 sin IA: memoria
organizada y buscable de cada viaje/cliente. Después: corpus de recuperación del bot de llamadas."*

**Honestidad desde la primera línea (política 0.6 del repo):** esta spec construye SOLO el esquema
de datos y su capa de acceso. NO construye 11.3 (nota de voz → transcripción Whisper), NI 11.5
(consentimiento RGPD), NI 11.6 (WhatsApp), NI búsqueda full-text real. Esos son items **separados y
gateados** (GATE 11 en el roadmap). Lo que esta tabla SÍ hace es nacer preparada para recibirlos sin
re-migrar: el campo `canal` ya enumera los valores futuros (marcados como reservados), de modo que
cuando 11.3 empiece a escribir transcripciones sólo tendrá que insertar filas con
`canal='llamada_transcrita'` — no tocar el esquema. **No se anticipa infraestructura que nada usa
todavía** (ver §5 sobre el índice de texto: deferido, con la nota de por qué).

---

## 1. Estado verificado del esquema (PASO 0 — la verdad manda sobre suposiciones)

Todo lo de abajo está leído a archivo:línea, no asumido.

### 1.1 Numeración de migraciones
La última migración en disco es **`0041_cliente.sql`** (verificado listando
`backend/db/migrations/`; 0040 es `cola_trabajos`, 0041 es `cliente`). Por tanto la nueva es
**`0042_contexto.sql`**. Si al implementar ya existiese una 0042 de otra orden en vuelo, usar el
siguiente número libre — ni la tabla ni el código dependen del número.

### 1.2 Entidades a las que `contexto` puede anclarse (existen HOY, verificadas)
- **`viaje`** (`0001_init.sql`) — `viaje.id uuid PK`. Anclaje principal.
- **`chofer`** (`0001_init.sql`) — `chofer.id uuid PK`.
- **`cliente`** (`0041_cliente.sql`, recién creada por 11.1) — `cliente.id uuid PK`,
  `empresa_id NOT NULL`, RLS `empresa_id = current_empresa_id()`, trigger
  `trg_solo_lectura_cliente` con `solo_lectura_bloquea_escritura()`. Es la entidad NUEVA que 11.2
  necesitaba para poder anclar contexto a un cliente real.

### 1.3 Patrón polimórfico YA en uso en el repo (`audit_log`, `documento`)
`audit_log` (`0030_audit_log.sql`) usa el par **`entidad text NOT NULL` + `entidad_id uuid NOT NULL`**,
con índice `idx_audit_log_entidad ON (entidad, entidad_id)` y la cabecera dice literal: *"`entidad`
sigue la misma convención de ámbito que `documento` (viaje/vehiculo/chofer)"*. La capa JS
(`registrarAuditoria`/`getAuditLog` en `dashboard/lib/data.js:1964,1987`) trabaja con
`{ entidad, entidadId }` y filtra `.eq("entidad", ...).eq("entidad_id", ...)`. **Este es el patrón
polimórfico establecido del codebase.** (Decisión de §2.2: `contexto` lo copia.)

### 1.4 El precedente lightweight que `contexto` generaliza (`nota_gestor`)
`nota_gestor` (`0022_nota_gestor.sql`): `id`, `empresa_id NOT NULL`, `gestor_id` (FK
`gestor ON DELETE SET NULL`), `texto NOT NULL`, `viaje_id` (FK `viaje ON DELETE SET NULL`),
`created_at`. RLS `FOR ALL USING/WITH CHECK (empresa_id = current_empresa_id())`. Está en el array
del trigger `solo_lectura_bloquea_escritura` (`0032_roles_gestor.sql:170`). Capa JS:
`getNotasRecientes(limite, {viajeId})` y `createNotaGestor({texto, viajeId})`
(`data.js:1295,1304`). `contexto` es su generalización: mismo espíritu (cuaderno de bitácora
minable) pero (a) anclable a cualquier entidad, no sólo viaje, y (b) con procedencia de canal.

### 1.5 Convenciones de migración confirmadas (ONBOARDING §7/§9)
- Cabecera de comentario explicando el **porqué** (patrón visible en 0037/0041).
- **Cabecera de REVERSIÓN** (convención 9.16), tal cual la trae `0041_cliente.sql:25-27`.
- **"Una migración, una responsabilidad" (9.37):** esto es **DDL puro** (crear tabla + índices + RLS
  + trigger de rol), **SIN backfill** — la tabla nace vacía. Por tanto va en **un solo archivo**,
  idempotente y seguro de reintentar. Confirmado explícitamente: no hay datos que migrar.
- **BOM de PowerShell (trampa del repo):** crear `0042_contexto.sql` con Write/Edit, **NUNCA** con
  `Set-Content -Encoding UTF8` (mete BOM, rompe el checksum y `read_text(encoding="utf-8")` de
  `migrate.py`).
- Aplicar con `python backend/db/migrate.py` (inserta el checksum solo) o `apply_migration` del MCP
  (project_id `hloqddmdwinvjksqkhey`, insertar checksum a mano).

---

## 2. Decisiones de diseño (tomadas AQUÍ, no reabrir)

### 2.1 Nombre de tabla: **`contexto`**
Literal del roadmap. Singular, como el resto del esquema (`viaje`, `chofer`, `cliente`,
`nota_gestor`, `audit_log`).

### 2.2 Anclaje: **polimórfico `entidad` + `entidad_id`** (NO tres FK nullable). Justificado.
**Decisión cerrada: par polimórfico `entidad text` + `entidad_id uuid`, copiando `audit_log`.**

Trade-off analizado:
- **Tres FK nullable** (`viaje_id`, `chofer_id`, `cliente_id`, cada una FK con `ON DELETE SET NULL`):
  ventaja = integridad referencial real de Postgres. Desventajas: (a) obliga a un `CHECK` de "exactamente
  una no-nula", más ruidoso; (b) **NO es el patrón del codebase** — `audit_log` y `documento` ya son
  polimórficos, y la capa JS (`getAuditLog(entidad, entidadId)`) ya está escrita en ese estilo; (c)
  cada nueva entidad anclable (mañana `vehiculo`, `hito`) exige `ALTER TABLE ADD COLUMN` + FK. Rígido.
- **Par polimórfico** (elegido): coherente con `audit_log`/`documento`; añadir un tipo de entidad
  nuevo es dato (`entidad='vehiculo'`), no DDL; la capa JS reusa el mismo shape `{entidad, entidadId}`
  que `getAuditLog`, así que un desarrollador que ya conoce el patrón lo lee sin fricción.

**Coste asumido honestamente:** el polimórfico **pierde la FK real** — Postgres no puede garantizar
que `entidad_id` apunte a una fila viva de la tabla correcta, ni cascada al borrar el viaje. Esto es
**aceptable y consistente** porque `audit_log` ya hace exactamente el mismo trade-off por la misma
razón (trazabilidad longeva que sobrevive al borrado de la entidad). Para `contexto` es incluso
**deseable**: si se borra un viaje, sus notas/transcripciones NO deben desaparecer en silencio (son
"memoria del negocio", igual que la auditoría). El aislamiento fuerte lo sigue dando `empresa_id` +
RLS, no la FK.

**Valores permitidos de `entidad` (CHECK):** `'viaje'`, `'chofer'`, `'cliente'`. Enumerados con
`CHECK` para atrapar typos (a diferencia de `audit_log`, que dejó `entidad` libre; aquí lo cerramos
porque el conjunto de entidades anclables es pequeño y conocido, y un typo silencioso rompería el
filtrado). Añadir una entidad futura = una línea en el CHECK (DDL trivial), decisión consciente frente
al texto libre.

### 2.3 Procedencia — los tres ejes "quién / por qué canal / cuándo"

**QUIÉN (`gestor_id` + `autor_externo`):**
- **`gestor_id uuid` FK `gestor ON DELETE SET NULL`**, nullable. Presente cuando lo capturó el gestor
  logueado (igual que `nota_gestor.gestor_id` / `audit_log.gestor_id`). La capa JS lo rellena
  resolviendo la sesión → fila `gestor` (mismo código que `createNotaGestor`/`registrarAuditoria`).
- **`autor_externo text`**, nullable. Para cuando quien "lo dijo" NO es un gestor: un chófer por
  teléfono, un contacto del cliente. Es **texto libre descriptivo** ("Juan, del cliente Transportes
  X" / "el chófer Pedro"), NO una FK — porque un contacto de cliente no existe como entidad en el
  esquema hoy, y un chófer sí existe pero el "quién habló" en una transcripción no siempre mapea
  limpio a una fila `chofer`. Decisión cerrada: `gestor_id` para el autor interno identificado;
  `autor_externo` texto para el resto. Ambos pueden ser NULL (una nota tecleada por un gestor tendrá
  `gestor_id` y `autor_externo=NULL`; una transcripción futura de una llamada con el cliente podrá
  tener `gestor_id=NULL` y `autor_externo='contacto del cliente'`).

**POR QUÉ CANAL (`canal` con CHECK enumerado):**
Valores del CHECK, con marca de uso HOY vs. reservado para item futuro gateado:

| valor                 | uso            | item |
|-----------------------|----------------|------|
| `'nota_manual'`       | **HOY**        | 11.2 (esta spec) — texto tecleado por el gestor |
| `'email'`             | **HOY**        | 11.2 — extracto de email pegado a mano por el gestor |
| `'llamada_transcrita'`| **RESERVADO**  | 11.3 (nota de voz → Whisper). Nadie lo escribe hasta que 11.3 se apruebe. |
| `'whatsapp'`          | **RESERVADO**  | 11.6 (WhatsApp 2º canal). |

Se enumeran los cuatro **en el CHECK desde ya** para que 11.3/11.6 no tengan que re-migrar el CHECK
(cambiar un CHECK es un `ALTER TABLE ... DROP/ADD CONSTRAINT`, molesto y arriesgado sobre tabla con
datos). El **coste de listar valores reservados ahora es cero** (son literales en un CHECK), frente a
una migración futura — por eso se hace. La capa JS de ESTA spec sólo permite `'nota_manual'` y
`'email'` (default `'nota_manual'`); intentar `'llamada_transcrita'` desde el dashboard hoy no tiene
UI y no debe ofrecerse (lo escribirá el backend de 11.3, service role, cuando exista).

**CUÁNDO (`ocurrido_en` vs `created_at`, pueden diferir):**
Se separan explícitamente, igual que `ejecucion_evento` separa `ocurrido_en`/`registrado_en`:
- **`ocurrido_en timestamptz NOT NULL DEFAULT now()`** — cuándo pasó el hecho de verdad (cuándo fue la
  llamada, cuándo llegó el email). Para una nota tecleada al momento coincide con la captura; para una
  transcripción de una llamada de ayer, será ayer. Editable por quien captura.
- **`created_at timestamptz NOT NULL DEFAULT now()`** — cuándo se guardó la fila. Reloj del servidor,
  no editable. Es el orden de captura.
Ordenar el feed por `ocurrido_en DESC` (el hecho), no por `created_at` — así una transcripción de una
llamada antigua cae en su sitio cronológico real. (Ver índice §5.)

### 2.4 El contenido: `texto` + `resumen`
- **`texto text NOT NULL`** — el cuerpo (la nota, el extracto de email, la transcripción). NOT NULL
  como `nota_gestor.texto`: un contexto sin cuerpo no tiene sentido.
- **`resumen text`**, nullable — resumen corto opcional. HOY el gestor puede rellenarlo a mano (o
  dejarlo NULL). **Reservado** además para que un item futuro de IA lo autogenere sobre transcripciones
  largas (corpus del bot, 11.7). No se autogenera nada en esta spec; es sólo una columna que existe.

### 2.5 `empresa_id` — eje de aislamiento (NOT NULL)
`empresa_id uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE`, igual que `nota_gestor`,
`audit_log`, `cliente`. Es el eje de multi-tenancy (RLS §4). NOT NULL: todo contexto pertenece a
exactamente una empresa. `ON DELETE CASCADE`: si se borra la empresa entera, su contexto se va con
ella (consistente con `nota_gestor`/`cliente`).

---

## 3. Esquema final de `contexto` (tabla)

| Columna         | Tipo          | NOT NULL | Default             | Notas |
|-----------------|---------------|----------|---------------------|-------|
| `id`            | `uuid`        | sí (PK)  | `gen_random_uuid()` | |
| `empresa_id`    | `uuid`        | sí       | —                   | FK `empresa ON DELETE CASCADE`. Eje de aislamiento. |
| `entidad`       | `text`        | sí       | —                   | CHECK ∈ (`viaje`,`chofer`,`cliente`). Anclaje polimórfico (§2.2). |
| `entidad_id`    | `uuid`        | sí       | —                   | id de la entidad anclada (sin FK, por diseño §2.2). |
| `canal`         | `text`        | sí       | `'nota_manual'`     | CHECK ∈ (`nota_manual`,`email`,`llamada_transcrita`,`whatsapp`). Los dos últimos RESERVADOS (§2.3). |
| `texto`         | `text`        | sí       | —                   | Cuerpo del contexto. |
| `resumen`       | `text`        | no       | —                   | Resumen corto opcional (§2.4). |
| `gestor_id`     | `uuid`        | no       | —                   | FK `gestor ON DELETE SET NULL`. Autor interno si aplica (§2.3). |
| `autor_externo` | `text`        | no       | —                   | Quién lo dijo si no es un gestor (§2.3). |
| `ocurrido_en`   | `timestamptz` | sí       | `now()`             | Cuándo pasó el hecho (§2.3). Orden del feed. |
| `created_at`    | `timestamptz` | sí       | `now()`             | Cuándo se guardó la fila. |

### 3.1 RLS y trigger — decisión explícita: **NO append-only. Mutable con RLS `FOR ALL`.**

**La pregunta que la orden exige resolver:** ¿debe `contexto` ser append-only como `audit_log` (0037),
o mutable como `nota_gestor`/`cliente`?

**Decisión cerrada: MUTABLE (SELECT/INSERT/UPDATE/DELETE permitidos), con la MISMA policy `FOR ALL`
que `nota_gestor` y `cliente`, más el trigger `solo_lectura_bloquea_escritura`.**

Justificación (y por qué NO copia el modelo append-only de `audit_log`):
- **`audit_log` es append-only porque es evidencia de "quién cambió qué"** — un registro forense cuyo
  valor depende de que nadie pueda editarlo. `contexto` NO es eso: es **memoria de trabajo editable**
  (el gestor teclea una nota, se equivoca, la corrige; pega un email, recorta lo que sobra). Bloquear
  UPDATE/DELETE aquí sería hostil al uso real y no aporta garantía de negocio: nadie promete al cliente
  "esta nota es inmutable". El nivel de "record de confianza" del roadmap se refiere a que el contexto
  **exista y esté organizado**, no a que sea criptográficamente inalterable.
- **`nota_gestor` (el precedente directo que esto generaliza) es `FOR ALL`** — mutable. Ser coherente
  con él evita una asimetría rara ("la nota vieja se edita, la nota nueva no").
- **La honestidad de 0037** era: no dejar UPDATE/DELETE **por accidente** en una tabla que SÍ debía
  ser append-only. Aquí la decisión de permitir escritura es **deliberada y justificada**, no un
  descuido — que es exactamente la lección de 0037 (decidir explícitamente la forma de la policy).
- **La trazabilidad de "quién tocó qué contexto"** ya la cubre `audit_log`: si se quiere registrar la
  edición/borrado de una fila de `contexto`, se llama `registrarAuditoria({entidad:'contexto', ...})`
  desde la capa JS — patrón existente, sin necesidad de hacer la tabla append-only. (Enganchar esa
  auditoría en la UI es trabajo de la capa de presentación, fuera de esta spec; la tabla queda lista.)

**Trigger `solo_lectura_bloquea_escritura` (0032): SÍ aplica.** Igual que `cliente` (0041:56-58) y
`nota_gestor` (está en el array de 0032): un gestor con rol `solo_lectura` no debe poder crear/editar
contexto. Defensa en profundidad sobre la policy. Se añade un trigger `trg_solo_lectura_contexto`.

---

## 4. Migración `0042_contexto.sql` (SQL literal completo, copiar-pegar)

```sql
-- ============================================================
-- Norenty 11.2 — Capa de contexto atada a las entidades.
--
-- Generaliza nota_gestor (0022): en vez de una nota suelta atada solo a un
-- viaje, `contexto` guarda cualquier pieza de conocimiento (nota manual,
-- extracto de email, y en el futuro transcripcion de llamada / WhatsApp)
-- anclada polimorficamente a un viaje, chofer o cliente, CON PROCEDENCIA:
-- quien lo dijo (gestor_id o autor_externo), por que canal (canal), y cuando
-- paso de verdad (ocurrido_en) vs cuando se guardo (created_at).
--
-- Dia 1 sin IA: memoria organizada y buscable de cada viaje/cliente. Despues:
-- corpus de recuperacion del bot de llamadas (11.7). El campo `canal` ya
-- enumera los valores futuros ('llamada_transcrita' para 11.3, 'whatsapp' para
-- 11.6) marcados RESERVADOS, para que esos items NO tengan que re-migrar el
-- CHECK -- pero HOY solo se escriben 'nota_manual' y 'email' desde el dashboard.
--
-- Anclaje polimorfico (entidad + entidad_id) igual que audit_log (0030) y
-- documento: coherente con el codebase, y deseable aqui porque el contexto es
-- memoria del negocio que debe sobrevivir al borrado de la entidad (por eso NO
-- hay FK sobre entidad_id; el aislamiento lo da empresa_id + RLS).
--
-- MUTABLE a proposito (NO append-only como audit_log 0037): es memoria de
-- trabajo editable, no evidencia forense. Policy FOR ALL como nota_gestor/
-- cliente, + trigger solo_lectura para que rol solo_lectura no escriba.
--
-- DDL puro (tabla + indices + RLS + trigger), SIN backfill: la tabla nace
-- vacia -> idempotente y seguro de reintentar ("una migracion, una
-- responsabilidad", 9.37). nota_gestor se DEJA INTACTA (ver SPECS-11.md 6).
--
-- REVERSION (convencion 9.16): para deshacer --
--   DROP TABLE IF EXISTS public.contexto;   -- (borra policy y trigger en cascada)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contexto (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  entidad       text NOT NULL CHECK (entidad IN ('viaje','chofer','cliente')),
  entidad_id    uuid NOT NULL,
  canal         text NOT NULL DEFAULT 'nota_manual'
                  CHECK (canal IN ('nota_manual','email','llamada_transcrita','whatsapp')),
  texto         text NOT NULL,
  resumen       text,
  gestor_id     uuid REFERENCES public.gestor(id) ON DELETE SET NULL,
  autor_externo text,
  ocurrido_en   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indice del feed: "todo el contexto de esta entidad, hecho mas reciente primero".
-- (entidad, entidad_id, ocurrido_en DESC) cubre el filtro + el orden en un solo indice.
CREATE INDEX IF NOT EXISTS idx_contexto_entidad
  ON public.contexto (entidad, entidad_id, ocurrido_en DESC);

-- Indice por empresa (consistente con nota_gestor/audit_log/cliente).
CREATE INDEX IF NOT EXISTS idx_contexto_empresa
  ON public.contexto (empresa_id);

ALTER TABLE public.contexto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa gestiona su contexto" ON public.contexto;
CREATE POLICY "empresa gestiona su contexto" ON public.contexto FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());

-- Defensa en profundidad: rol solo_lectura no puede crear/editar/borrar contexto.
DROP TRIGGER IF EXISTS trg_solo_lectura_contexto ON public.contexto;
CREATE TRIGGER trg_solo_lectura_contexto BEFORE INSERT OR UPDATE OR DELETE ON public.contexto
  FOR EACH ROW EXECUTE FUNCTION public.solo_lectura_bloquea_escritura();
```

**Registro del checksum** (obligatorio si se aplica por `apply_migration` del MCP; `migrate.py` lo
hace solo):
```
python -c "import hashlib,pathlib; sql=pathlib.Path('backend/db/migrations/0042_contexto.sql').read_text(encoding='utf-8'); print(hashlib.sha256(sql.encode('utf-8')).hexdigest())"
```
```sql
INSERT INTO schema_migrations (filename, checksum)
VALUES ('0042_contexto.sql','<hash>') ON CONFLICT (filename) DO NOTHING;
```

---

## 5. Índices — decididos aquí

**Patrón de consulta real 1 — "todo el contexto de este viaje/chofer/cliente, lo más reciente
primero":** cubierto por `idx_contexto_entidad (entidad, entidad_id, ocurrido_en DESC)`. El filtro
usa las dos primeras columnas y el orden la tercera → índice compuesto, una sola pasada. Es el patrón
de `idx_audit_log_entidad` extendido con la columna de orden.

**Patrón de consulta real 2 (FUTURO) — "buscar una frase en el texto del contexto":**
**DEFERIDO explícitamente. No se crea índice de texto (GIN/`tsvector`/`pg_trgm`) en esta migración.**
Razón (anti-roadmap, política del repo de no construir infraestructura especulativa): HOY nadie
consulta por texto — la UI del Día 1 lista el contexto de una entidad concreta (patrón 1), no hace
búsqueda global. Un índice GIN sobre `to_tsvector` no es gratis (ocupa espacio, ralentiza los
INSERT, y elegir configuración de idioma español es una decisión de producto no tomada). **Coste de
añadirlo luego = una migración `CREATE INDEX CONCURRENTLY` de una línea, sin tocar datos** — barato y
sin riesgo. Por tanto se defiere hasta que exista una pantalla que realmente busque. Anotado como
mejora futura del corpus del bot (11.7), no de 11.2.

---

## 6. Decisión: ¿migrar `nota_gestor` a `contexto`? — **NO. Se deja intacta.** Justificado.

**Decisión cerrada: esta spec AÑADE `contexto` junto a `nota_gestor`; NO migra los datos ni el código
de `nota_gestor`.**

Razones (principio del repo de cambios mínimos y no especulativos):
- `nota_gestor` **funciona hoy** y tiene callers vivos (`getNotasRecientes`/`createNotaGestor` en
  `data.js`, usados por la UI). Migrar implicaría: backfill de datos (violando el "DDL puro, sin
  backfill" de esta migración), reescribir los callers, y arriesgar romper una pantalla que anda.
  Coste real y riesgo, a cambio de nada urgente.
- El diseño de las funciones nuevas (§7) **imita deliberadamente** las firmas de
  `getNotasRecientes`/`createNotaGestor`, de modo que **migrar los callers más adelante sea un diff
  pequeño** si algún día se decide unificar. La puerta queda abierta, no forzada.
- Regla anotada para el futuro: cuando/si se unifiquen, `nota_gestor` se mapea a `contexto` con
  `entidad='viaje'`, `entidad_id=viaje_id`, `canal='nota_manual'`, `ocurrido_en=created_at`. Ese
  backfill sería su propia migración (una responsabilidad), no ésta.

---

## 7. Capa de datos — `dashboard/lib/data.js` (firmas y cuerpos literales)

Imitan el estilo de `createNotaGestor` (resolución de `gestor_id` vía sesión) y `getAuditLog`
(filtro polimórfico + orden + límite server-side). `getCurrentEmpresaId()` existente. Errores con
`if (error) throw error`. Añadir estas funciones (p.ej. junto a las de `nota_gestor`, ~línea 1319):

```js
// --- Capa de contexto (11.2) — memoria organizada y buscable de cada entidad
// (viaje/chofer/cliente), con procedencia (quien / que canal / cuando). Generaliza
// nota_gestor: mismo espiritu de cuaderno minable, anclable a cualquier entidad y
// con canal de origen. HOY solo se escriben los canales 'nota_manual' y 'email'
// desde el dashboard; 'llamada_transcrita'/'whatsapp' quedan para 11.3/11.6. ---

const CANALES_CONTEXTO_DASHBOARD = ["nota_manual", "email"];
export const LIMITE_CONTEXTO = 200;

/**
 * Lista el contexto anclado a una entidad, hecho mas reciente primero.
 * @param {"viaje"|"chofer"|"cliente"} entidad
 * @param {string} entidadId
 * @returns filas { id, canal, texto, resumen, autor_externo, ocurrido_en, created_at, gestor:{nombre} }
 */
export async function getContexto(entidad, entidadId) {
  const { data } = await supabase
    .from("contexto")
    .select("id, canal, texto, resumen, autor_externo, ocurrido_en, created_at, gestor:gestor_id(nombre)")
    .eq("entidad", entidad)
    .eq("entidad_id", entidadId)
    .order("ocurrido_en", { ascending: false })
    .limit(LIMITE_CONTEXTO);
  return data || [];
}

/**
 * Crea una pieza de contexto anclada a una entidad. Resuelve gestor_id de la
 * sesion (autor interno), igual que createNotaGestor. `canal` limitado a los
 * usables desde el dashboard hoy; `ocurridoEn`/`resumen`/`autorExterno` opcionales.
 * @returns {string} id de la fila creada
 */
export async function createContexto({
  entidad,
  entidadId,
  texto,
  canal = "nota_manual",
  resumen = null,
  autorExterno = null,
  ocurridoEn = null,
}) {
  if (!["viaje", "chofer", "cliente"].includes(entidad)) {
    throw new Error(`entidad no valida: ${entidad}`);
  }
  if (!CANALES_CONTEXTO_DASHBOARD.includes(canal)) {
    throw new Error(`canal no permitido desde el dashboard: ${canal}`);
  }
  const empresaId = await getCurrentEmpresaId();
  const { data: { session } } = await supabase.auth.getSession();
  let gestorId = null;
  if (session?.user) {
    const { data: gestor } = await supabase
      .from("gestor").select("id").eq("auth_user_id", session.user.id).single();
    gestorId = gestor?.id || null;
  }
  const fila = {
    empresa_id: empresaId,
    entidad,
    entidad_id: entidadId,
    canal,
    texto: texto.trim(),
    resumen: resumen ? resumen.trim() : null,
    gestor_id: gestorId,
    autor_externo: autorExterno,
  };
  if (ocurridoEn) fila.ocurrido_en = ocurridoEn;
  const { data, error } = await supabase.from("contexto").insert(fila).select("id").single();
  if (error) throw error;
  return data.id;
}
```

Notas de estilo (deliberadas, no reabrir):
- `getContexto(entidad, entidadId)` = mismo shape que `getAuditLog(entidad, entidadId)` → migrar un
  caller de `nota_gestor` a esto es cambiar `getNotasRecientes(n,{viajeId})` por
  `getContexto('viaje', viajeId)`, diff pequeño (§6).
- El orden va **server-side por `ocurrido_en DESC`** (usa el índice §5), a diferencia de
  `getNotasRecientes` que ordena en JS. Correcto: aquí sí hay índice que lo soporta y el volumen puede
  crecer con transcripciones futuras.
- La validación de `canal` en JS es la barrera que impide escribir `'llamada_transcrita'` desde el
  dashboard hoy (el CHECK de la BD lo permitiría, pero es para el backend de 11.3, service role).

---

## 8. Casos de test (Grupo A) que el implementer DEBE escribir

Mismo criterio de honestidad que `SPECS-9.md §5`: el `FakeSupabase` en memoria de los tests del
dashboard (vitest) **NO ejecuta RLS, CHECKs ni triggers reales de Postgres** — es un fake de PostgREST.
Por tanto:

- **Grupo A (vitest, `dashboard/lib/*.test.js` junto a los tests de `nota_gestor`/`cliente`):** prueba
  la LÓGICA de las funciones JS contra el fake. Es lo que corre en `ci.ps1`. Cubre las validaciones y
  el shape de las llamadas, NO el enforcement de la BD.
- **Grupo B (verificación manual contra la BD real / branch Supabase, documentada en PROGRESS):** RLS
  por empresa, el CHECK de `canal`/`entidad`, y el trigger `solo_lectura`. Igual que se verificó 11.1
  (ver PROGRESS 2026-07-07). **No fingir que el Grupo A cubre RLS/CHECK/trigger.** El implementer debe
  ejecutar el Grupo B y anotarlo; esta spec sólo enumera el Grupo A abajo.

Casos enumerados (Grupo A):

- **(a) `createContexto` con los campos mínimos inserta el shape correcto.** Con `{entidad:'viaje',
  entidadId:<uuid>, texto:'  hola  '}` → la fila insertada tiene `entidad='viaje'`,
  `canal='nota_manual'` (default), `texto='hola'` (trim), `empresa_id` = el de la sesión mockeada,
  `gestor_id` resuelto de la sesión. Devuelve el `id`.
- **(b) `createContexto` resuelve `gestor_id` de la sesión.** Con sesión mock cuyo gestor tiene
  `id='g1'` → la fila lleva `gestor_id='g1'`. Sin sesión de usuario → `gestor_id=null` (no lanza por
  eso; el fallo de sesión lo daría `getCurrentEmpresaId`).
- **(c) `createContexto` rechaza `entidad` inválida.** `{entidad:'vehiculo', ...}` → lanza
  `entidad no valida: vehiculo`, sin insertar.
- **(d) `createContexto` rechaza `canal` reservado desde el dashboard.** `{entidad:'viaje',
  entidadId, texto, canal:'llamada_transcrita'}` → lanza `canal no permitido desde el dashboard:
  llamada_transcrita`, sin insertar. (Protege la frontera 11.2/11.3.)
- **(e) `createContexto` acepta `canal:'email'` y campos opcionales.** Con
  `{canal:'email', resumen:'  r  ', autorExterno:'contacto cliente', ocurridoEn:'2026-01-01T00:00:00Z'}`
  → fila con `canal='email'`, `resumen='r'` (trim), `autor_externo='contacto cliente'`,
  `ocurrido_en='2026-01-01T00:00:00Z'`.
- **(f) `resumen`/`autorExterno` omitidos quedan `null`.** `createContexto` mínimo → `resumen:null`,
  `autor_externo:null`, y NO se envía `ocurrido_en` en el payload (toma el default de la BD).
- **(g) `getContexto` filtra por entidad+entidadId.** Con filas de `('viaje','v1')` y `('viaje','v2')`
  en el fake → `getContexto('viaje','v1')` devuelve sólo las de `v1`.
- **(h) `getContexto` pide orden por `ocurrido_en` descendente y límite.** Verificar (vía el spy del
  fake sobre `.order`/`.limit`) que se llama `.order("ocurrido_en",{ascending:false})` y
  `.limit(LIMITE_CONTEXTO)`. (El fake no ordena de verdad; se comprueba que se pidió, mismo criterio
  que otros tests del repo que verifican la forma de la query.)
- **(i) `getContexto` con tabla vacía devuelve `[]`,** no `undefined` (el `|| []`).

**Nota:** hardcodear en (a)/(e) los valores esperados exactos de la fila insertada (inspeccionando lo
que el fake recibió en `.insert(...)`), de modo que un cambio accidental de nombres de columna
(`entidad_id` ↔ `entidadId`) rompa el test.

---

## 9. Trampas del repo relevantes (checklist para el implementer)

1. **BOM de PowerShell:** crear `0042_contexto.sql` con Write/Edit, NUNCA `Set-Content -Encoding UTF8`.
2. **Nombres de columna snake_case en la BD, camelCase en los params JS:** `entidad_id`/`gestor_id`/
   `ocurrido_en`/`autor_externo` en SQL e insert; `entidadId`/`ocurridoEn`/`autorExterno` en la firma JS.
   No confundirlos (test (a)/(e) lo atrapan).
3. **`current_empresa_id()` y `solo_lectura_bloquea_escritura()` ya existen** (0009/0032). No
   redefinirlas; sólo referenciarlas en la policy y el trigger.
4. **`canal` reservado ≠ prohibido en la BD:** el CHECK de Postgres PERMITE los 4 valores (para 11.3/
   11.6); es la capa JS quien restringe a 2 hoy. No "endurecer" el CHECK quitando los reservados —
   eso obligaría a re-migrar cuando llegue 11.3.
5. **NO append-only:** no copiar el patrón de `audit_log` (0037) de "sólo SELECT+INSERT". La policy es
   `FOR ALL` a propósito (§3.1). Si el implementer ve el precedente de 0037 y "corrige" a append-only,
   estaría rompiendo la decisión tomada aquí.
6. **NO migrar `nota_gestor`** (§6): no tocar `getNotasRecientes`/`createNotaGestor` ni su tabla.
7. **NO crear índice de texto/GIN** (§5): fuera de alcance, deferido a propósito.
8. **`ci.ps1` verde antes de commit** y commits separados código/docs — lo gestiona el orquestador;
   esta orden produce el `.sql`, las funciones en `data.js` y los tests del Grupo A que pasen vitest,
   y ejecuta+documenta el Grupo B.
```
