# SPECS 9 — Cadena criptográfica (hash-chain) sobre `ejecucion_evento`

Especificación "mascada" del ítem 9.6/9.7 del ROADMAP. Mismo criterio que `SPECS-7A.md`:
todas las decisiones de diseño están tomadas AQUÍ. El ejecutor de 9.7 (modelo barato) NO debe
tomar ninguna decisión: copia el SQL literal, las firmas y los tests tal cual.

**Alcance de 9.6 (esta spec):** SOLO el diseño escrito. NO implementa nada.
**Alcance de 9.7 (otra orden):** crea la migración `0031_*`, el script de verificación y los tests.

Objetivo de producto: `ejecucion_evento` es la "evidencia creíble" que vende Norenty. La 0019 ya
la hizo INSERT-only para el dashboard (`authenticated`): solo el bot (service role) escribe. Falta
la capa que ata cada evento al anterior mediante un hash encadenado, de forma que **cualquier
alteración o borrado de un evento histórico rompe la cadena de forma detectable** — incluso hecha
por quien tenga la service role key. El pitch: "ni nosotros podemos falsificar una hora de llegada,
y puedo demostrártelo recorriendo la cadena".

**Honestidad desde la primera línea (política 0.6 del repo):** el hash-chain da **DETECCIÓN**, no
prevención absoluta. Quien tiene la service role key puede hacer UPDATE/DELETE; lo que NO puede es
hacerlo sin que la verificación posterior lo delate señalando el evento exacto. Esto se dice tal
cual en el spec y debe decirse tal cual al cliente. No se promete lo que no se cumple.

---

## 1. Estado verificado del esquema (PASO 0 — la verdad manda sobre los .sql antiguos)

Este repo ha sufrido **drift real de esquema**: la columna del tipo de evento se llamó
`tipo_evento` en el init y fue **renombrada a `tipo`** después. Verificado leyendo migraciones y
código en ejecución. NO asumir; estos son los hechos citados a archivo:línea.

### 1.1 Columnas ACTUALES de `ejecucion_evento` (estado real de la BD hoy)

| Columna         | Tipo          | NOT NULL | Default          | Origen / notas |
|-----------------|---------------|----------|------------------|----------------|
| `id`            | `uuid`        | sí (PK)  | `gen_random_uuid()` | `0001_init.sql:78` |
| `viaje_id`      | `uuid`        | sí       | —                | FK `viaje`, `0001_init.sql:79` |
| `hito_id`       | `uuid`        | no       | —                | FK `hito` ON DELETE SET NULL, `0001_init.sql:80` |
| `chofer_id`     | `uuid`        | no       | —                | FK `chofer` ON DELETE SET NULL, `0001_init.sql:81` |
| **`tipo`**      | `text`        | sí       | —                | **Renombrada de `tipo_evento`** en `0006_gestor_telegram_alertas.sql:10`. Valores: `'llegada'`, `'salida'`, `'pod_subido'`, `'viaje_completado'`. |
| `datos`         | `jsonb`       | sí       | `'{}'::jsonb`    | `0001_init.sql:83`. **EXISTE pero el bot NO la escribe nunca** — se queda en `'{}'`. Ver §1.3. |
| `detalle`       | `text`        | no       | —                | Añadida en `0006_...sql:15` ("antes datos, normalizar"). **ES la que usa el bot** para el texto libre (p.ej. la dirección del hito en la llegada). |
| `ocurrido_en`   | `timestamptz` | sí       | `now()`          | "cuando pasó de verdad", `0001_init.sql:84` |
| `registrado_en` | `timestamptz` | sí       | `now()`          | "cuando lo guardamos", `0001_init.sql:85` |

**NO existe hoy** ninguna columna de hash, secuencia, orden encadenado ni nada relacionado con
integridad criptográfica. La 0031 las crea de cero. Índices existentes relevantes:
`idx_evento_viaje` sobre `(viaje_id)` y `idx_evento_viaje_ocurrido` sobre `(viaje_id, ocurrido_en)`
(`0001_init.sql:121-122`), `idx_evento_chofer`, `idx_evento_hito` (`0008_rls_endurecido.sql:44-45`).

### 1.2 CONTRADICCIÓN encontrada y su resolución

- `0001_init.sql:82` define la columna como **`tipo_evento`**.
- `0006_gestor_telegram_alertas.sql:5-12` ejecuta un `DO $$ ... RENAME COLUMN tipo_evento TO tipo`
  (condicional idempotente: solo renombra si existe `tipo_evento` y no existe `tipo`).
- El **código en ejecución confirma que el nombre real es `tipo`**:
  - Bot escribe `"tipo": "llegada"` (`backend/app/bot.py:691`), `"tipo": "salida"` (`:724`, `:882`),
    `"tipo": "pod_subido"` (`:875`), `"tipo": "viaje_completado"` (`:458`).
  - Dashboard lee `.eq("tipo","llegada")` (`dashboard/lib/data.js:704`, `:1108`, `:1561`).
- **Resolución:** el nombre real y actual de la columna del tipo de evento es **`tipo`** (text). El
  `tipo_evento` de 0001 ya no existe. El bug que menciona la orden ("la nómina consultaba
  `tipo_evento`") era exactamente esto; hoy está normalizado a `tipo`. **En toda esta spec se usa
  `tipo`, NUNCA `tipo_evento`.**

Segunda normalización de 0006: `datos jsonb` sigue existiendo (no se dropeó), pero se añadió
`detalle text` como campo de texto libre y **el bot escribe en `detalle`, no en `datos`**. `datos`
permanece siempre en su default `'{}'`.

### 1.3 Quién escribe filas y con qué cliente (importa para el trigger)

- **Solo el bot escribe** `ejecucion_evento`. Lo hace vía `supabase.table("ejecucion_evento").insert(...)`
  usando el cliente de `backend/app/db.py:7-10`, que se instancia con
  `SUPABASE_SERVICE_ROLE_KEY` (o `SUPABASE_ANON_KEY` como fallback). Es decir: inserciones vía
  **PostgREST** (API REST), no por conexión Postgres directa.
- El dashboard **NO escribe** (revocado en `0019_seguridad_columnas.sql:57`): `authenticated` solo
  tiene SELECT sobre esta tabla.
- **Consecuencia para el diseño:** un trigger `BEFORE INSERT` de Postgres se dispara igual venga la
  inserción por PostgREST o por conexión directa (el trigger vive en el motor, no en el cliente).
  Por tanto el trigger cubre 100% de las inserciones reales sin tocar el código del bot. El bot NO
  necesita cambios: no calcula el hash, lo calcula el trigger.
- **Columnas que el bot NO envía en el insert** (y que por tanto toman su default): `datos` (→`'{}'`),
  `ocurrido_en` (→`now()`), `registrado_en` (→`now()`). Las nuevas `hash`/`hash_prev` también las
  rellenará el trigger, no el bot.

### 1.4 Payload observado de un insert real del bot (para fijar qué columnas son "inmutables")

Ejemplo real de la llegada (`backend/app/bot.py:687-693`):
```python
supabase.table("ejecucion_evento").insert({
    "viaje_id": viaje["id"],
    "hito_id": hito_id,
    "chofer_id": chofer_id,
    "tipo": "llegada",
    "detalle": hito.get("direccion"),
}).execute()
```
`ocurrido_en`/`registrado_en` no van en el payload → los pone `now()` el servidor en el mismo
instante. Son **iguales entre sí** en la práctica para cada fila, pero NO son deterministas respecto
a un recálculo externo (dependen del reloj del servidor en el momento del insert).

---

## 2. Diseño del hash-chain

### 2.1 Decisión de partición: **POR `viaje_id`** (cerrada, no abierta)

Trade-off analizado:

- **Cadena global** (una secuencia para toda la tabla): cada insert debe leer "el último hash de
  toda la tabla" y encadenar. Esto crea un **punto de serialización**: dos eventos concurrentes de
  chóferes distintos compiten por el mismo "último hash" → hay que serializar los inserts (lock de
  tabla o `SERIALIZABLE` con reintentos), lo que estrangula el throughput de escritura y complica el
  trigger. A cambio no aporta seguridad extra relevante: un atacante con service role puede alterar
  igual cualquier partición; lo que importa es que la alteración sea detectable dentro de su cadena.
- **Cadena por `viaje_id`** (elegida): cada viaje es su propia cadena independiente. Encaja
  **exactamente** con cómo se generan los eventos — un chófer avanza SU viaje de forma secuencial
  (llegada→salida→pod→...), y dos viajes distintos progresan en paralelo sin competir. El lock de
  concurrencia se reduce al ámbito de un solo viaje (colisión solo si dos eventos del MISMO viaje se
  insertan a la vez, caso rarísimo y de todos modos serializable barato). La verificación recorre
  cada viaje por separado y señala evento+viaje exacto donde se rompe.

**Por qué `viaje_id` y no por empresa:** por empresa la partición sería más gruesa (muchos viajes
concurrentes de la misma empresa competirían) sin ganancia de seguridad. `viaje_id` es el grano
natural del dominio y ya está indexado (`idx_evento_viaje`, `idx_evento_viaje_ocurrido`).

**Nota de robustez:** `viaje_id` es `NOT NULL` en la tabla (`0001_init.sql:79`), así que TODO
evento pertenece a exactamente una cadena. No hay eventos "huérfanos" sin partición. Bien.

### 2.2 Columnas nuevas

```sql
ALTER TABLE ejecucion_evento ADD COLUMN hash_prev text;   -- hash del evento anterior de SU viaje (NULL en el primero)
ALTER TABLE ejecucion_evento ADD COLUMN hash      text;   -- hash de este evento (encadena hash_prev + payload)
```
`hash` NO se declara `NOT NULL` en el `ADD COLUMN` inicial porque el backfill (§3) rellena las filas
existentes en un paso posterior dentro de la misma migración; tras el backfill se añade
`SET NOT NULL` sobre `hash` (ver §3). `hash_prev` **sí admite NULL** de forma permanente (el primer
evento de cada viaje no tiene anterior). Ambas son `text` con el hex SHA-256 (64 chars).

### 2.3 Algoritmo del hash (determinista y reproducible)

```
payload_canonico = coalesce(hash_prev,'') || '|' ||
                   id::text        || '|' ||
                   viaje_id::text  || '|' ||
                   coalesce(hito_id::text,'')   || '|' ||
                   coalesce(chofer_id::text,'') || '|' ||
                   tipo            || '|' ||
                   coalesce(detalle,'') || '|' ||
                   to_char(ocurrido_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')

hash = encode( sha256( convert_to(payload_canonico,'UTF8') ), 'hex')
```

**Columnas que ENTRAN en el payload (las inmutables del evento), en este ORDEN FIJO:**
`hash_prev, id, viaje_id, hito_id, chofer_id, tipo, detalle, ocurrido_en`.

Justificación campo por campo:
- **`id`**: identidad inmutable del evento. Incluirlo ata el hash a esta fila concreta (impide
  "mover" un hash de una fila a otra).
- **`viaje_id`**: define la partición; incluirlo impide reasignar un evento a otro viaje sin romper.
- **`hito_id`, `chofer_id`**: parte del hecho registrado (a qué parada / qué chófer). Inmutables.
  Se serializan con `coalesce(...,'')` porque son nullable.
- **`tipo`**: EL dato de negocio (llegada/salida/...). Nombre real de la columna (§1.2), no `tipo_evento`.
- **`detalle`**: texto libre del evento (dirección, etc.). Es `text`, determinista, inmutable → entra.
  `coalesce(...,'')` por ser nullable.
- **`ocurrido_en`**: LA hora que el producto promete no poder falsificar. Es el objetivo mismo de la
  cadena → **debe entrar**. Se serializa con `to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
  para forzar UTC + microsegundos + formato fijo, evitando ambigüedad de timezone/precisión al
  recomputar desde Python o desde otra sesión con distinto `TimeZone` GUC.

**Columnas que NO entran y por qué:**
- **`registrado_en`**: es hora de inserción (reloj del servidor en el momento del insert), NO un
  hecho del negocio. Incluirla no aporta (es redundante con `ocurrido_en` para eventos del bot, que
  los pone iguales) y ata el hash a un valor no reproducible fuera del insert. **Excluida.**
- **`datos jsonb`**: **EXCLUIDA por determinismo.** El bot nunca la escribe (siempre `'{}'`, §1.3),
  así que no aporta información. Y aunque la escribiera, el texto de un `jsonb` NO es determinista
  (Postgres reordena claves y normaliza espacios/números internamente; `jsonb::text` puede variar
  entre versiones/filas). Meterla arriesga falsos "cadena rota" en la verificación. Si en el futuro
  `datos` pasara a usarse y hubiera que protegerla, se haría con una forma canónica explícita
  (p.ej. `jsonb_canonical` con claves ordenadas) — **fuera de alcance de 9.6/9.7**; anotado como
  posible mejora futura. Por ahora: **excluida, sin excepción**.
- `hash` (la propia): obviamente no entra en su propio cálculo.

**Determinismo garantizado:** todos los campos incluidos son escalares con serialización fija; el
único con riesgo (timestamp) se ancla a UTF+formato explícito. Un script Python espejo (§4) puede
recomputar el hash byte a byte idéntico al del trigger.

### 2.4 Función + trigger `BEFORE INSERT` (SQL literal)

La función busca el `hash` del último evento de la MISMA partición (`viaje_id`) y encadena. "Último"
se define por el orden canónico de la cadena: `ocurrido_en ASC`, desempate por `registrado_en ASC`,
desempate final por `id ASC` (determinista y estable; mismo criterio en verificación y backfill).

```sql
CREATE OR REPLACE FUNCTION public.ejecucion_evento_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev text;
BEGIN
  -- Último hash de la cadena de ESTE viaje (NULL si es el primer evento del viaje).
  -- FOR UPDATE serializa inserciones concurrentes del MISMO viaje (grano fino: no bloquea
  -- otros viajes). Si no hay filas previas, v_prev queda NULL.
  SELECT e.hash
    INTO v_prev
    FROM public.ejecucion_evento e
   WHERE e.viaje_id = NEW.viaje_id
   ORDER BY e.ocurrido_en DESC, e.registrado_en DESC, e.id DESC
   LIMIT 1
   FOR UPDATE;

  NEW.hash_prev := v_prev;

  NEW.hash := encode(
    digest(
      convert_to(
        coalesce(NEW.hash_prev,'') || '|' ||
        NEW.id::text               || '|' ||
        NEW.viaje_id::text         || '|' ||
        coalesce(NEW.hito_id::text,'')   || '|' ||
        coalesce(NEW.chofer_id::text,'') || '|' ||
        NEW.tipo                   || '|' ||
        coalesce(NEW.detalle,'')   || '|' ||
        to_char(NEW.ocurrido_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ejecucion_evento_hash_chain
  BEFORE INSERT ON public.ejecucion_evento
  FOR EACH ROW
  EXECUTE FUNCTION public.ejecucion_evento_hash_chain();
```

**Nota de dependencia `digest`/`sha256`:** `digest(bytea, text)` vive en la extensión **`pgcrypto`**.
Supabase la trae disponible pero puede no estar habilitada. La migración 0031 debe empezar con
`CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;` (Supabase instala extensiones en el
schema `extensions`, que está en el `search_path` por defecto). Si al aplicar diera
`function digest(...) does not exist`, es que `extensions` no está en el search_path de la sesión:
usar entonces `extensions.digest(...)` cualificado en la función. **Decisión cerrada:** escribir la
función con `digest(...)` sin cualificar Y crear la extensión en `extensions`; si el ejecutor ve el
error de "does not exist" al aplicar, cambiar las dos llamadas a `extensions.digest(...)`. (Alternativa
equivalente: `encode(digest(...,'sha256'),'hex')` es lo mismo que `encode(sha256(...),'hex')`;
`sha256(bytea)` es builtin en PG14+ y no requiere pgcrypto — **si el proyecto es PG15+ (Supabase lo
es), se puede usar `sha256(convert_to(...,'UTF8'))` directamente y NO hace falta pgcrypto**. Usar
esta vía builtin como opción primaria; ver §3 el SQL final ya la usa.)

### 2.5 ¿Trigger `BEFORE UPDATE`/`DELETE` que bloquee? — evaluado, NO se implementa

Se evaluó añadir un trigger que lance excepción en UPDATE/DELETE salvo bajo una GUC de mantenimiento
(`SET norenty.mantenimiento = 'on'`). **Decisión: NO implementarlo en 9.7.** Razones:
- No aporta prevención real contra el único vector que queda (service role): quien tiene service role
  puede `SET` la GUC, `ALTER TABLE ... DISABLE TRIGGER`, o `DROP TRIGGER`. Un candado cuya llave tiene
  el mismo que quieres frenar no frena a nadie; sí da falsa sensación de seguridad.
- Complica el backfill y cualquier corrección legítima futura, y añade una GUC "mágica" fácil de
  olvidar activada.
- El valor real —**detección**— ya lo da el hash-chain + la verificación (§4). Ese es el diseño
  honesto: no prometemos prevención, prometemos que cualquier manipulación es demostrable.

Queda anotado como posible mejora si algún día se separan roles (un rol de escritura del bot SIN
privilegio de `ALTER`/`DROP` sobre la tabla, y el trigger de bloqueo bajo un rol distinto). Fuera de
alcance de 9.6/9.7.

---

## 3. Migración `0031_hash_chain_ejecucion_evento.sql` (SQL literal completo)

Convenciones del repo respetadas (0.1 de SPECS-7A): cabecera explicando el porqué; aplicar por
`apply_migration` (project_id `hloqddmdwinvjksqkhey`) o `python backend/db/migrate.py`; registrar el
checksum en `schema_migrations`. La 0030 es la última existente hoy → esta es la **0031**.

**IMPORTANTE (trampa de PowerShell, 0.3 de SPECS-7A):** crear el archivo con la herramienta
Write/Edit, **NUNCA** con `Set-Content -Encoding UTF8` de PowerShell (mete BOM y rompe el checksum /
la lectura UTF-8 de `migrate.py`, que hace `read_text(encoding="utf-8")`).

```sql
-- ============================================================
-- Norenty 9.6/9.7 — Cadena criptográfica (hash-chain) sobre ejecucion_evento.
--
-- ejecucion_evento es la "evidencia creíble" del producto. La 0019 ya la hizo
-- INSERT-only para el dashboard (solo el bot/service-role escribe). Esta capa
-- ata cada evento al anterior de SU MISMO viaje mediante SHA-256 encadenado:
--   hash = sha256( hash_prev | id | viaje_id | hito_id | chofer_id | tipo |
--                  detalle | ocurrido_en(UTC) )
-- Partición POR viaje_id (cada viaje = una cadena independiente): encaja con la
-- generación secuencial de eventos por viaje y evita el cuello de botella de una
-- cadena global. Cualquier UPDATE/DELETE posterior de un evento histórico rompe
-- la verificación (§verificar_cadena.py) y señala el evento exacto.
--
-- HONESTIDAD: esto da DETECCIÓN, no prevención contra quien tenga la service
-- role key. Ese es el diseño buscado ("puedo demostrarte que no lo tocamos").
--
-- Nombre real de la columna de tipo = `tipo` (renombrada de tipo_evento en 0006).
-- `datos jsonb` se EXCLUYE del hash (no determinista + el bot nunca la escribe).
-- ============================================================

-- 1) Columnas nuevas (hash nullable de momento; se pone NOT NULL tras backfill).
ALTER TABLE public.ejecucion_evento ADD COLUMN IF NOT EXISTS hash_prev text;
ALTER TABLE public.ejecucion_evento ADD COLUMN IF NOT EXISTS hash      text;

-- 2) Función de cálculo del hash de una fila (usada por trigger Y backfill).
--    sha256(bytea) es builtin en Postgres 14+ (Supabase es PG15+), no requiere pgcrypto.
CREATE OR REPLACE FUNCTION public.ejecucion_evento_calc_hash(
  p_hash_prev   text,
  p_id          uuid,
  p_viaje_id    uuid,
  p_hito_id     uuid,
  p_chofer_id   uuid,
  p_tipo        text,
  p_detalle     text,
  p_ocurrido_en timestamptz
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    sha256(
      convert_to(
        coalesce(p_hash_prev,'') || '|' ||
        p_id::text               || '|' ||
        p_viaje_id::text         || '|' ||
        coalesce(p_hito_id::text,'')   || '|' ||
        coalesce(p_chofer_id::text,'') || '|' ||
        p_tipo                   || '|' ||
        coalesce(p_detalle,'')   || '|' ||
        to_char(p_ocurrido_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'UTF8'
      )
    ),
    'hex'
  );
$$;

-- 3) Trigger BEFORE INSERT: busca el último hash de la cadena del viaje y encadena.
CREATE OR REPLACE FUNCTION public.ejecucion_evento_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev text;
BEGIN
  SELECT e.hash
    INTO v_prev
    FROM public.ejecucion_evento e
   WHERE e.viaje_id = NEW.viaje_id
   ORDER BY e.ocurrido_en DESC, e.registrado_en DESC, e.id DESC
   LIMIT 1
   FOR UPDATE;

  NEW.hash_prev := v_prev;
  NEW.hash := public.ejecucion_evento_calc_hash(
    NEW.hash_prev, NEW.id, NEW.viaje_id, NEW.hito_id, NEW.chofer_id,
    NEW.tipo, NEW.detalle, NEW.ocurrido_en
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ejecucion_evento_hash_chain ON public.ejecucion_evento;
CREATE TRIGGER trg_ejecucion_evento_hash_chain
  BEFORE INSERT ON public.ejecucion_evento
  FOR EACH ROW
  EXECUTE FUNCTION public.ejecucion_evento_hash_chain();

-- 4) BACKFILL de las filas ya existentes, recorriendo CADA viaje en orden
--    determinista (ocurrido_en, registrado_en, id) y encadenando. Usa una
--    función-window: hash_prev = hash de la fila anterior de la misma partición.
--    Se hace con un bucle sobre viajes; dentro, un recorrido ordenado que arrastra
--    el hash previo. Idempotente en la práctica porque recalcula desde cero.
DO $backfill$
DECLARE
  r          record;
  v_prev     text;
  v_last_viaje uuid := NULL;
BEGIN
  FOR r IN
    SELECT id, viaje_id, hito_id, chofer_id, tipo, detalle, ocurrido_en
      FROM public.ejecucion_evento
     ORDER BY viaje_id, ocurrido_en, registrado_en, id
  LOOP
    -- Al cambiar de viaje, reiniciar la cadena.
    IF v_last_viaje IS DISTINCT FROM r.viaje_id THEN
      v_prev := NULL;
      v_last_viaje := r.viaje_id;
    END IF;

    UPDATE public.ejecucion_evento
       SET hash_prev = v_prev,
           hash = public.ejecucion_evento_calc_hash(
                    v_prev, r.id, r.viaje_id, r.hito_id, r.chofer_id,
                    r.tipo, r.detalle, r.ocurrido_en)
     WHERE id = r.id;

    -- Releer el hash recién escrito para encadenar el siguiente.
    SELECT hash INTO v_prev FROM public.ejecucion_evento WHERE id = r.id;
  END LOOP;
END;
$backfill$;

-- 5) Tras el backfill, TODAS las filas tienen hash → exigirlo en adelante.
ALTER TABLE public.ejecucion_evento ALTER COLUMN hash SET NOT NULL;
```

**Registro del checksum (obligatorio, patrón 0.1 de SPECS-7A / `migrate.py`):**
```
python -c "import hashlib,pathlib; sql=pathlib.Path('backend/db/migrations/0031_hash_chain_ejecucion_evento.sql').read_text(encoding='utf-8'); print(hashlib.sha256(sql.encode('utf-8')).hexdigest())"
```
y luego vía `execute_sql`:
```sql
INSERT INTO schema_migrations (filename, checksum)
VALUES ('0031_hash_chain_ejecucion_evento.sql','<hash>')
ON CONFLICT (filename) DO NOTHING;
```
(Si se aplica con `python backend/db/migrate.py`, el runner ya inserta el checksum solo — ver
`backend/db/migrate.py:84-87`. Solo registrar a mano si se aplica por `apply_migration` del MCP.)

---

## 4. Verificación de integridad — `backend/db/verificar_cadena.py`

Script que recorre cada cadena (partición por `viaje_id`), recomputa cada hash y lo compara con el
almacenado, verificando además que `hash_prev` de cada evento == `hash` del anterior. Devuelve OK o
el **PRIMER** punto de ruptura (evento id + viaje_id + motivo). Ante fallo: **ALERTA** (log a stderr,
exit 1, y —si `SENTRY_DSN` está configurado— captura a Sentry). **NUNCA arreglo silencioso**: el
script es de solo-lectura, jamás hace UPDATE. Reparar una cadena rota es una decisión humana (implica
decidir qué evento es el legítimo), no automática.

### 4.1 Firma / interfaz
```
python backend/db/verificar_cadena.py            # verifica TODA la tabla, exit 0 si OK, 1 si rota
python backend/db/verificar_cadena.py --viaje <uuid>   # solo esa cadena
```
Reusa `DATABASE_URL` y `psycopg2` igual que `migrate.py` (`backend/db/migrate.py:16,21,43,53`).
Función central testeable:
```python
def verificar_cadena(cur, viaje_id: str | None = None) -> dict:
    """Recorre las cadenas y devuelve
    {'ok': bool, 'eventos_verificados': int, 'cadenas': int,
     'rotura': None | {'evento_id','viaje_id','motivo'}}.
    'motivo' ∈ {'hash_no_coincide','hash_prev_roto','primer_evento_con_hash_prev'}.
    Se detiene y reporta el PRIMER evento roto (por partición, en orden canónico)."""
```

### 4.2 Pseudocódigo
```
SELECT id, viaje_id, hito_id, chofer_id, tipo, detalle, ocurrido_en, hash, hash_prev
  FROM ejecucion_evento
 [WHERE viaje_id = %s]        -- si --viaje
 ORDER BY viaje_id, ocurrido_en, registrado_en, id

prev_hash_por_viaje = {}          # viaje_id -> hash del evento anterior
for fila in filas:
    esperado_prev = prev_hash_por_viaje.get(fila.viaje_id)   # None si primero
    # (a) coherencia del enlace hacia atrás
    if fila.hash_prev != esperado_prev:
        return rotura(fila, 'hash_prev_roto' if esperado_prev is not None
                              else 'primer_evento_con_hash_prev')
    # (b) recomputar el hash de ESTA fila (espejo EXACTO del SQL de §2.3)
    h = sha256_hex( (fila.hash_prev or '') + '|' + fila.id + '|' + fila.viaje_id + '|'
                    + (fila.hito_id or '') + '|' + (fila.chofer_id or '') + '|'
                    + fila.tipo + '|' + (fila.detalle or '') + '|'
                    + fila.ocurrido_en.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%S.%fZ') )
    if h != fila.hash:
        return rotura(fila, 'hash_no_coincide')
    prev_hash_por_viaje[fila.viaje_id] = fila.hash
return {ok: True, ...}
```
**Trampa de formato del timestamp (crítica para que el espejo coincida):** `to_char(...,'US')` de
Postgres da **microsegundos con 6 dígitos SIEMPRE** (rellena ceros). `strftime('%f')` de Python
también da 6 dígitos. Coinciden. Pero `psycopg2` puede devolver el timestamp con `tzinfo`; forzar
`.astimezone(timezone.utc)` antes de formatear, y usar `strftime('%Y-%m-%dT%H:%M:%S.%fZ')` (la `Z`
literal, igual que el `"Z"` del `to_char`). Verificar en el test (f) que un evento real recién
insertado por el trigger pasa el espejo Python — si no, el formato de microsegundos/timezone es el
sospechoso número uno.

### 4.3 Uso operativo (anotar en el script, no implementar cron aquí)
Pensado para correr: (a) manualmente antes de enseñar la evidencia a un cliente/juzgado; (b) opcional
en CI o en un cron diario (fuera de alcance de 9.7). Salida OK: `Cadena íntegra: N eventos en M
viajes.` Salida rota: `CADENA ROTA en viaje <uuid>, evento <uuid>: <motivo>` a stderr + exit 1.

---

## 5. Casos de test (para que 9.7 los implemente)

**Decisión honesta sobre dónde viven (política del repo "no simular que se probó algo que no se
probó", 0.3/0.6 de SPECS-7A):** un trigger de Postgres **NO lo ejerce** el `FakeSupabase` en memoria
de `backend/tests/fakes.py` (es un fake de PostgREST en Python, no ejecuta SQL ni triggers). Por
tanto los tests se dividen en **dos grupos** y hay que ser explícito sobre qué prueba cada uno:

- **Grupo A — lógica de hashing en Python espejo (pytest, `backend/tests/test_hash_chain.py`):**
  prueba la FUNCIÓN de recomputo de `verificar_cadena.py` y el encadenado, con datos en memoria. NO
  prueba el trigger real, prueba que el algoritmo espejo es correcto y detecta roturas. Rápido,
  corre en CI (`.\ci.ps1`). Cubre (a),(b),(c),(d),(e) a nivel de lógica.
- **Grupo B — trigger + backfill contra BD real (script manual documentado, `scratchpad`):** un
  script con `psycopg2`/`DATABASE_URL` que, contra la BD real (o una branch de Supabase vía MCP
  `create_branch`), inserta eventos y comprueba que el trigger rellena `hash`/`hash_prev`, luego
  altera una fila por SQL directo y comprueba que `verificar_cadena` la detecta. Es la ÚNICA forma de
  probar el trigger de verdad. Documentar el resultado en PROGRESS al ejecutarlo (patrón 6.9/7A.14 de
  verificación contra BD real). **No fingir que el Grupo A cubre el trigger.**

Casos enumerados y concretos:

- **(a) Inserción normal encadena bien.** Grupo B: insertar 1 evento en un viaje nuevo → `hash_prev IS
  NULL`, `hash` = 64 hex, y `verificar_cadena(--viaje)` → ok. Grupo A: `calc_hash` espejo con
  `hash_prev=None` da un valor estable conocido (fixture con hash esperado hardcodeado).
- **(b) Dos inserciones seguidas en el mismo viaje encadenan en orden.** Grupo B: insertar evento1
  luego evento2 (mismo `viaje_id`, `ocurrido_en` crecientes) → `evento2.hash_prev == evento1.hash`;
  verificación ok. Grupo A: cadena de 2 en memoria, la verificación las valida.
- **(c) Inserciones en viajes distintos son cadenas independientes.** Grupo B: evento en viajeX y
  evento en viajeY → ambos con `hash_prev IS NULL` (cada uno es el primero de SU cadena); verificación
  ok para ambos. Confirma que la partición es por `viaje_id`.
- **(d) Alterar `ocurrido_en` de un evento histórico por SQL directo → detectado, evento exacto.**
  Grupo B: `UPDATE ejecucion_evento SET ocurrido_en = ocurrido_en - interval '2 hours' WHERE id=<X>`
  (salta el trigger porque es UPDATE, no INSERT) → `verificar_cadena` devuelve `ok:False`,
  `rotura.evento_id == X`, `motivo == 'hash_no_coincide'`. Este ES el caso estrella del producto.
  Grupo A: mutar un campo de una fila en el fixture y comprobar que el espejo lo detecta.
- **(e) Borrar un evento intermedio → detectado.** Grupo B: en una cadena de 3, `DELETE` del
  intermedio → al recorrer, el tercero tiene `hash_prev` == hash del (ya borrado) segundo, que ya no
  coincide con el hash del primero (ahora su "anterior") → `motivo == 'hash_prev_roto'`, señalando el
  tercer evento. Grupo A: quitar el elemento intermedio de la lista y comprobar la detección.
- **(f) El backfill sobre datos existentes produce una cadena verificable.** Grupo B: sobre una BD/
  branch con eventos PRE-existentes (insertados antes de crear el trigger, p.ej. deshabilitándolo o
  usando datos de una branch clonada), aplicar el bloque de backfill de la 0031 y luego
  `verificar_cadena` (toda la tabla) → `ok:True`. Confirma que el orden determinista del backfill
  coincide con el de la verificación.

**Nota sobre fixtures deterministas del Grupo A:** para (a) hardcodear el hash esperado, computar
UNA vez con el mismo algoritmo (p.ej. con `openssl` o un `python -c`) sobre un payload conocido y
pegarlo en el test como valor esperado — así el test también protege contra cambios accidentales del
formato de serialización (si alguien cambia el orden de campos o el formato del timestamp, (a) rompe).

---

## 6. Trampas del repo relevantes (revisadas de SPECS-7A §0 y confirmadas para esta spec)

1. **Checksum en `schema_migrations` (0.1):** toda migración debe registrar su SHA-256. Si se aplica
   con `python backend/db/migrate.py`, el runner lo inserta solo (`migrate.py:84-87`); si se aplica
   con `apply_migration` del MCP, insertarlo a mano (§3). El runner AVISA si el contenido local
   difiere del checksum registrado (`migrate.py:69`) — **no reeditar una migración ya aplicada**;
   si hay que corregir, va en una migración nueva.
2. **BOM de PowerShell (0.3):** crear `0031_*.sql` y `verificar_cadena.py` con Write/Edit, NUNCA con
   `Set-Content -Encoding UTF8`. El BOM rompe `read_text(encoding="utf-8")` de `migrate.py` y
   cambiaría el checksum silenciosamente. (Aplica igual a cualquier `.py`/`.sql` nuevo.)
3. **Nombre real de columna = `tipo`, no `tipo_evento` (§1.2):** el drift más importante. Cualquier
   SQL o Python que toque el tipo del evento usa `tipo`. Este es exactamente el tipo de bug
   ("consultaba `tipo_evento`") que la orden avisa; ya está normalizado a `tipo` en la BD real.
4. **`datos jsonb` existe pero está vacía y NO entra en el hash (§2.3):** no confundir con `detalle`
   (que sí usa el bot y sí entra). No añadir `datos` al payload "por completitud" — rompería el
   determinismo.
5. **El trigger corre para inserciones vía PostgREST del bot sin tocar el bot (§1.3):** no hay que
   modificar `backend/app/bot.py`. Si algún test o script inserta con service role, también dispara
   el trigger. El dashboard no puede insertar (0019), así que no genera eventos sin hash.
6. **`FOR UPDATE` en el trigger serializa solo la partición del viaje:** correcto y deseado. No
   convertirlo en lock de tabla ni en `SELECT ... FOR UPDATE` sin `WHERE viaje_id` — eso
   reintroduciría el cuello de botella global que la decisión de partición evita (§2.1).
7. **`sha256(bytea)` es builtin en PG14+ (Supabase PG15+):** NO hace falta `pgcrypto` con la vía de
   §3. Si por lo que fuera el ejecutor usa `digest(...)`, entonces sí necesita
   `CREATE EXTENSION IF NOT EXISTS pgcrypto` y quizá cualificar `extensions.digest` (§2.4). Preferir
   `sha256` builtin y olvidarse de la extensión.
8. **`ci.ps1` verde antes de commit (0.4)** y **commits separados código/docs (0.4)** — pero eso lo
   gestiona el orquestador; 9.7 solo produce archivos + tests que pasen `pytest`.
```

---
---

# Bloque colas — diseño de cola asíncrona sobre Postgres (ítem 9.17)

Especificación "mascada" del ítem **9.17** del ROADMAP. Mismo criterio que la sección hash-chain de
arriba y que `SPECS-7A.md` / `SPECS-9-ROLES.md`: **todas las decisiones de diseño están tomadas
AQUÍ.** El ejecutor de **9.18** (modelo barato) NO debe tomar ninguna decisión: copia el SQL literal,
las firmas de función y los tests tal cual.

**Alcance de 9.17 (esta spec):** SOLO el diseño escrito. NO implementa nada.
**Alcance de 9.18 (otra orden):** crea la migración `0040_*`, el módulo `backend/app/cola.py`, el
enganche del worker en `bot.py`, y los tests de los dos grupos (§9.7).

Texto literal del roadmap (9.17): *"Cuando haya volumen real: sacar de la request del bot lo lento
(validación de POD con visión LLM cuando se apruebe D3/7B, notificaciones) a un worker con reintentos
persistentes. Diseño recomendado: **Postgres como cola** (`SELECT ... FOR UPDATE SKIP LOCKED`) antes
que añadir Redis — menos piezas nuevas, más sólido, coherente con el 'anti-roadmap' de no añadir
infraestructura que no haga falta todavía."*

**HONESTIDAD DESDE LA PRIMERA LÍNEA (política 0.6 del repo, y cultura visible en todo `PROGRESS.md`
de "aquí está lo que NO se hizo y por qué"):** esta spec construye la **infraestructura** de la cola
(tabla + claim + reintentos + dead-letter + tests), NO un consumidor de negocio en producción. El
roadmap dice literal *"cuando haya volumen real"* y *"cuando se apruebe D3/7B"* — es decir, la cola es
**prospectiva a propósito**. Tras analizar los call-sites reales (§9.6) la conclusión es que **HOY no
hay ningún trabajo síncrono que DEBA migrarse** para resolver un dolor actual; el POD-visión-LLM aún
no está aprobado (decisión de presupuesto D3/7B) y las notificaciones síncronas actuales son
suficientes. Por tanto **9.18 construye la mecánica y UN worker que corre en vacío (o procesa un
`kind` de humo/`noop`), con el primer consumidor real dejado como stub documentado** hasta que
POD-visión se apruebe. Esto es deliberado y correcto: no inflamos, dejamos los raíles puestos.

---

## 9.1 Estado verificado del repo (PASO 0 — la verdad manda sobre suposiciones)

Todo lo de abajo está leído a archivo:línea, no asumido.

### 9.1.1 Numeración de migraciones

Listado real de `backend/db/migrations/` (a fecha de esta spec): la última existente en disco es
**`0039_rls_enable_faltante.sql`**. Por tanto la nueva es **`0040_cola_trabajos.sql`**. (0031 y 0032
convivieron sin renumerar porque eran independientes; aquí no hay ambigüedad: 0040 es el siguiente
libre. Si al aplicar 9.18 ya existiese una 0040 de otra orden en vuelo, usar el siguiente número
libre — la tabla y el código NO dependen del número.)

### 9.1.2 Precedente de tabla "solo service-role" con RLS pero SIN policies de `authenticated`

`backend/db/migrations/0027_bot_heartbeat.sql` es el precedente EXACTO que esta cola imita para la
multi-tenancy (§9.4):

```sql
CREATE TABLE IF NOT EXISTS bot_heartbeat (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bot_heartbeat ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cualquier autenticado puede leer el heartbeat" ON bot_heartbeat
  FOR SELECT USING (true);
-- Sin policy de INSERT/UPDATE/DELETE para `authenticated`: solo el bot
-- (service role, que ignora RLS) escribe aquí — mismo criterio que
-- ejecucion_evento/ubicacion en la migración 0019.
REVOKE INSERT, UPDATE, DELETE ON bot_heartbeat FROM authenticated;
```

`bot_heartbeat` **no tiene `empresa_id`** y no cuelga de `current_empresa_id()`: es un mecanismo
interno del backend, no dato de un tenant. La cola de trabajos es igual de interna → §9.4 decide
seguir este patrón (RLS ON, cero policies de escritura para `authenticated`), con la diferencia de que
la cola NO necesita ni siquiera SELECT para `authenticated` (a diferencia del heartbeat, que el
dashboard lee para el aviso de "bot caído" de 8.3). La cola es 100% invisible al dashboard.

### 9.1.3 Cómo escribe/lee el backend contra Postgres

- El bot usa el cliente **PostgREST** (`supabase-py`) con `SUPABASE_SERVICE_ROLE_KEY` (o
  `SUPABASE_ANON_KEY` como fallback), instanciado en `backend/app/db.py:7-10`. Es API REST, **no
  conexión Postgres directa** — por eso el bot NO puede ejecutar `SELECT ... FOR UPDATE SKIP LOCKED`
  (PostgREST no expone locking de fila explícito). Ver §9.2 la consecuencia de arquitectura.
- El runner de migraciones `backend/db/migrate.py` **sí** usa `psycopg2` con `DATABASE_URL`
  (`migrate.py:16,53`), y `verificar_cadena.py` (§4 de la sección hash-chain) también. Es decir: en
  este repo ya hay precedente de **backend con conexión Postgres directa vía `DATABASE_URL`** para
  trabajo que PostgREST no cubre bien. El worker de la cola sigue ese precedente (§9.5).

### 9.1.4 `ejecutar_con_reintentos` (8.2) — qué es y qué NO resuelve

`backend/app/bot.py:45-68`: envuelve una llamada a Supabase con **reintentos en memoria** (3 intentos,
backoff 0.5s/1s) ante errores de red transitorios (`httpx.TimeoutException`, `ConnectError`,
`ReadError`, `RemoteProtocolError`), y si agota los intentos manda a Sentry y relanza. **Es reintento
DENTRO de la misma request/proceso, efímero:** si el proceso del bot muere entre el intento 2 y el 3,
el trabajo se pierde. La cola de esta spec es la capa **complementaria y ortogonal**: reintentos
**PERSISTENTES** (sobreviven a un reinicio del proceso porque el estado vive en la tabla). Regla de
diseño: `ejecutar_con_reintentos` sigue siendo la herramienta para el *camino síncrono* (la request
del chófer, que debe responder ya); la cola es para el *trabajo diferido* que puede esperar y NO debe
perderse aunque el proceso caiga. **No se sustituye una por otra; conviven.**

### 9.1.5 Patrón JobQueue existente (`heartbeat`, `procesar_notificaciones_asignacion`)

`bot.py:1441-1443` registra dos jobs repetitivos vía la `JobQueue` de `python-telegram-bot`:

```python
if app.job_queue:
    app.job_queue.run_repeating(procesar_notificaciones_asignacion, interval=30, first=15)
    app.job_queue.run_repeating(heartbeat, interval=HEARTBEAT_INTERVAL_S, first=1)
```

El `if app.job_queue:` es un guard para tests sin la extra `[job-queue]` instalada. Este es el
mecanismo que §9.5 decide **reutilizar** para el worker de la cola (un tercer `run_repeating`), con su
justificación.

---

## 9.2 Decisión de arquitectura: claim en SQL literal vía función, worker con `psycopg2`

**Problema de fondo:** el patrón de cola robusto es `SELECT ... FOR UPDATE SKIP LOCKED` — dos workers
concurrentes reclaman filas distintas sin bloquearse ni pisarse, porque `SKIP LOCKED` hace que cada
uno salte las filas que el otro ya tiene bloqueadas en su transacción. **Pero PostgREST (el cliente
del bot) no expone `FOR UPDATE SKIP LOCKED`.** Dos salidas:

- **(A) Claim como función Postgres `SECURITY DEFINER` invocable por RPC** (`supabase.rpc(...)`), que
  encapsula el `SELECT ... FOR UPDATE SKIP LOCKED ... UPDATE ... RETURNING` en una sola llamada
  atómica. El bot podría llamarla por PostgREST.
- **(B) Worker con conexión Postgres directa (`psycopg2` + `DATABASE_URL`)**, ejecutando el claim como
  SQL directo dentro de una transacción explícita.

**Decisión cerrada: SE HACEN LAS DOS COSAS, con roles distintos, porque resuelven cosas distintas:**

1. **La función de claim se escribe en la migración 0040 como función SQL (§9.3.2).** Es el punto
   único de la lógica de claim, testeable contra la BD real, e invocable de ambas formas (RPC o SQL
   directo). Que la lógica viva en la BD (no en Python) garantiza atomicidad real: el
   `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` corre en UNA transacción del motor.
2. **El worker usa `psycopg2`/`DATABASE_URL` (opción B para el consumo), no PostgREST.** Motivo: el
   worker necesita control transaccional fino (claim → procesar → marcar completed/failed en la misma
   o en transacciones controladas), y ya hay precedente en el repo (`migrate.py`,
   `verificar_cadena.py`). Llamar la función por RPC desde PostgREST también funcionaría para el
   *claim*, pero el *ciclo de vida completo* (marcar resultado, backoff) es más limpio y auditable con
   una conexión directa. **El `enqueue` (encolar), en cambio, SÍ se puede hacer por PostgREST** (es un
   `INSERT` normal, sin locking) — así el productor (el handler del bot que quiere diferir algo) encola
   con el mismo cliente `supabase` que ya usa, sin abrir una conexión Postgres nueva en el hot path.

**Resumen de qué usa qué:**

| Operación | Cliente | Por qué |
|-----------|---------|---------|
| `enqueue` (productor, hot path del bot) | PostgREST (`supabase.table("cola_trabajo").insert(...)`) | Es un INSERT normal; reutiliza el cliente ya instanciado; no necesita locking. |
| `claim_batch` (worker) | `psycopg2`/`DATABASE_URL`, llamando la función `cola_reclamar_lote()` | Necesita `FOR UPDATE SKIP LOCKED` + transacción; PostgREST no lo expone. |
| `marcar_completado` / `marcar_fallido` (worker) | `psycopg2`/`DATABASE_URL` | Control transaccional; mismo canal que el claim. |

**Dependencia nueva de infraestructura: NINGUNA.** `psycopg2` ya está en `backend/requirements.txt`
(lo usa `migrate.py`). Se cumple el anti-roadmap: cero Redis/Celery/RabbitMQ.

---

## 9.3 Migración `0040_cola_trabajos.sql` (SQL literal completo)

Convenciones del repo respetadas: cabecera explicando el porqué; aplicar por `apply_migration`
(project_id `hloqddmdwinvjksqkhey`) o `python backend/db/migrate.py`; registrar checksum en
`schema_migrations`. **Crear el archivo con Write/Edit, NUNCA con `Set-Content -Encoding UTF8`** (BOM
rompe el checksum y `read_text(encoding="utf-8")` de `migrate.py`).

**Nota de PROGRESS.md (auditoría CTO del 2026-07-05):** "migraciones como 0031/0032 mezclan
schema+backfill+hardening en un solo archivo (ya causó que un subagente muriera a mitad en 9.29) —
para migraciones futuras de ese tamaño, separar en pasos independientes". **Esta migración es
pequeña** (una tabla nueva vacía + índices + una función + RLS; sin backfill de datos existentes
porque la tabla nace vacía), así que va en un solo archivo sin riesgo. Se anota para que 9.18 no la
trocee innecesariamente.

### 9.3.1 Tabla `cola_trabajo`

```sql
-- ============================================================
-- Norenty 9.17/9.18 — Cola de trabajos asíncrona sobre Postgres.
--
-- Saca de la request síncrona del bot el trabajo LENTO/NO FIABLE (futuro:
-- validación de POD con visión LLM cuando se apruebe D3/7B; notificaciones si
-- algún día pesan) a un worker con reintentos PERSISTENTES (sobreviven al
-- reinicio del proceso, a diferencia de ejecutar_con_reintentos de 8.2, que es
-- en memoria). Patrón: SELECT ... FOR UPDATE SKIP LOCKED — dos workers nunca
-- reclaman la misma fila. NO se añade Redis/Celery (anti-roadmap: menos piezas).
--
-- Multi-tenancy: mecanismo INTERNO del backend, como bot_heartbeat (0027). RLS
-- ON pero SIN policies para authenticated: el dashboard no la ve ni la toca.
-- Solo el bot/worker (service role, salta RLS) escribe y consume. `empresa_id`
-- es OPCIONAL (nullable) solo como metadato de trazabilidad del payload, NO como
-- eje de aislamiento — ver §9.4 de SPECS-9.md.
--
-- FILOSOFÍA "evidencia, nunca perder datos en silencio" (igual que hash-chain y
-- audit_log): un trabajo que agota reintentos NO se borra; queda en estado
-- 'muerto' (dead-letter) para inspección humana. Nada se auto-purga.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cola_trabajo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,                         -- tipo de trabajo, p.ej. 'validar_pod', 'noop'
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,    -- datos que el handler del kind necesita
  estado        text NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','en_proceso','completado','fallido','muerto')),
  intentos      integer NOT NULL DEFAULT 0,            -- reintentos consumidos hasta ahora
  max_intentos  integer NOT NULL DEFAULT 5,            -- tope antes de pasar a 'muerto' (dead-letter)
  ultimo_error  text,                                  -- último mensaje de error (para diagnóstico)
  empresa_id    uuid REFERENCES public.empresa(id) ON DELETE SET NULL,  -- metadato opcional, NO aislamiento
  disponible_en timestamptz NOT NULL DEFAULT now(),    -- no reclamable hasta este instante (backoff/retraso)
  reclamado_en  timestamptz,                           -- cuándo un worker lo tomó (NULL si nunca)
  reclamado_por text,                                  -- id/hostname del worker que lo tomó (diagnóstico)
  creado_en     timestamptz NOT NULL DEFAULT now(),
  completado_en timestamptz                            -- cuándo terminó (completado/muerto); NULL si no
);
```

**Justificación de cada columna y su tipo (decisiones cerradas, NO reabrir):**

- **`kind text`** (no un enum): los tipos de trabajo crecerán (`validar_pod`, quizá `notificar_*`,
  etc.) y un `CHECK`/enum obligaría a una migración por cada tipo nuevo. `text` libre + validación en
  el código del worker (que enruta por `kind`) es más flexible y coherente con cómo el repo trata
  `ejecucion_evento.tipo` (text, no enum). Un `kind` desconocido para el worker se trata como fallo
  con `ultimo_error='kind desconocido'` (§9.5), nunca se pierde.
- **`payload jsonb DEFAULT '{}'`**: mismo tipo y default que `ejecucion_evento.datos`. jsonb permite
  que cada `kind` lleve sus propios campos sin columnas nuevas (p.ej. `{"pod_id": "...", "hito_id":
  "..."}` para `validar_pod`).
- **`estado`** con `CHECK` de 5 valores: `pendiente` (recién encolado) → `en_proceso` (reclamado por un
  worker) → `completado` (OK) | `fallido` (falló pero le quedan intentos, volverá a `pendiente` con
  backoff) | `muerto` (agotó `max_intentos`, dead-letter permanente). Ver máquina de estados §9.5.1.
  El `CHECK` es barato y protege contra typos del código.
- **`intentos` / `max_intentos integer`**: contador y tope. `max_intentos DEFAULT 5` (justificación del
  número en §9.5.2). Se permite override por fila (un `kind` caro como visión-LLM podría encolarse con
  `max_intentos=3`).
- **`ultimo_error text`**: el último error como texto para diagnóstico humano. NO se borra al reintentar
  (se sobrescribe con el error más reciente). Coherente con "evidencia".
- **`empresa_id uuid` nullable, FK `ON DELETE SET NULL`**: METADATO, no eje de aislamiento (§9.4). Es
  útil para depurar ("¿de qué tenant era este POD que falló?") y para métricas, pero la cola NO se
  particiona por empresa ni cuelga de `current_empresa_id()`. `ON DELETE SET NULL` (no CASCADE): si se
  borra una empresa, el registro del trabajo NO desaparece — sigue siendo evidencia de que algo se
  procesó. Nullable porque algunos trabajos internos podrían no tener empresa.
- **`disponible_en timestamptz DEFAULT now()`**: LA columna clave del backoff y del scheduling. Un
  worker solo reclama filas con `disponible_en <= now()`. Al fallar, se empuja al futuro
  (`now() + backoff`). Encolar con `disponible_en` futuro permite además trabajos **diferidos** (no solo
  reintentos). Default `now()` = disponible ya.
- **`reclamado_en` / `reclamado_por`**: diagnóstico y detección de trabajos "colgados" (un worker que
  murió con una fila en `en_proceso`). `reclamado_por` = identificador del worker (hostname+pid, §9.5).
  Ver §9.5.3 el rescate de trabajos huérfanos.
- **`creado_en` / `completado_en`**: auditoría temporal. `completado_en` se rellena al pasar a
  `completado` o `muerto` (fin de vida), NULL mientras siga vivo.

### 9.3.2 Índices — el claim query debe ser rápido

```sql
-- Índice PARCIAL para el claim: el worker solo mira filas reclamables
-- (pendiente/fallido con disponible_en ya vencido). Parcial = pequeño y
-- caliente aunque la tabla acumule millones de 'completado'/'muerto'.
-- Ordenado por disponible_en para servir las más antiguas/vencidas primero (FIFO
-- aproximado por prioridad temporal).
CREATE INDEX IF NOT EXISTS idx_cola_reclamables
  ON public.cola_trabajo (disponible_en)
  WHERE estado IN ('pendiente','fallido');

-- Índice para el rescate de huérfanos (§9.5.3): trabajos 'en_proceso' viejos.
CREATE INDEX IF NOT EXISTS idx_cola_en_proceso
  ON public.cola_trabajo (reclamado_en)
  WHERE estado = 'en_proceso';

-- Índice para inspección operativa del dead-letter y por empresa (diagnóstico).
CREATE INDEX IF NOT EXISTS idx_cola_estado ON public.cola_trabajo (estado);
```

**Por qué el índice parcial en `(disponible_en) WHERE estado IN ('pendiente','fallido')`:** el claim
(§9.3.3) filtra exactamente por `estado IN ('pendiente','fallido') AND disponible_en <= now()` y
ordena por `disponible_en`. Un índice parcial sobre ese predicado es pequeño (solo las filas
pendientes de trabajo, no los millones de completados históricos) y hace el claim un index-scan barato
aunque la tabla crezca sin límite. Este es EL índice que hace la cola escalar; el resto son de
diagnóstico.

### 9.3.3 Función de claim `cola_reclamar_lote()` — SQL literal (el `FOR UPDATE SKIP LOCKED`)

```sql
-- Reclama atómicamente hasta p_limite trabajos disponibles y los marca
-- 'en_proceso'. FOR UPDATE SKIP LOCKED: dos workers concurrentes NUNCA reclaman
-- la misma fila — cada uno salta las que el otro ya bloqueó en su transacción.
-- Devuelve las filas reclamadas (para que el worker las procese). Atómica: el
-- SELECT-bloqueante y el UPDATE ocurren en la misma sentencia/transacción.
CREATE OR REPLACE FUNCTION public.cola_reclamar_lote(
  p_limite    integer DEFAULT 10,
  p_worker_id text    DEFAULT NULL
)
RETURNS SETOF public.cola_trabajo
LANGUAGE sql
AS $$
  UPDATE public.cola_trabajo c
     SET estado       = 'en_proceso',
         reclamado_en = now(),
         reclamado_por = p_worker_id,
         intentos     = c.intentos + 1
   WHERE c.id IN (
     SELECT c2.id
       FROM public.cola_trabajo c2
      WHERE c2.estado IN ('pendiente','fallido')
        AND c2.disponible_en <= now()
      ORDER BY c2.disponible_en
      LIMIT p_limite
      FOR UPDATE SKIP LOCKED
   )
  RETURNING c.*;
$$;

-- Solo el backend/worker (service role) o el dueño de la BD la ejecutan.
-- NO se concede a authenticated ni anon: el dashboard jamás toca la cola.
REVOKE EXECUTE ON FUNCTION public.cola_reclamar_lote(integer, text) FROM PUBLIC, anon, authenticated;
```

**Puntos cerrados (NO reabrir):**
- El `FOR UPDATE SKIP LOCKED` va en el **subselect** que elige los ids; el `UPDATE` externo los marca.
  Este es el idioma canónico de "cola sobre Postgres" y es correcto: las filas elegidas quedan
  bloqueadas para la transacción actual, `SKIP LOCKED` hace que un segundo worker concurrente ignore
  esas y elija otras.
- `intentos = c.intentos + 1` se incrementa **al reclamar**, no al fallar. Consecuencia: si el worker
  muere mientras procesa (sin marcar resultado), el intento YA cuenta — el rescate de huérfanos
  (§9.5.3) lo devolverá a `pendiente`/`muerto` según los intentos ya consumidos, sin bucle infinito.
  Decisión deliberada: preferimos "contar de más" un intento perdido a arriesgar reintentos infinitos.
- `RETURNS SETOF public.cola_trabajo` + `RETURNING c.*`: devuelve las filas completas para que el
  worker tenga `kind`/`payload` sin una segunda query.
- **NO es `SECURITY DEFINER`** (a diferencia de `current_empresa_id()`): no hay recursión de RLS que
  evitar (la cola no tiene policies de `authenticated`), y el único que la llama es el worker con
  service role, que ya salta RLS. Mantenerla `SECURITY INVOKER` (default) es el mínimo privilegio.

### 9.3.4 RLS — patrón `bot_heartbeat`

```sql
ALTER TABLE public.cola_trabajo ENABLE ROW LEVEL SECURITY;
-- SIN NINGUNA policy: por defecto, con RLS activado y sin policies, `authenticated`
-- y `anon` no pueden hacer NADA (ni SELECT). Solo el service role (que ignora RLS)
-- opera la cola. La cola es 100% interna: el dashboard ni la lee. Esto es MÁS
-- restrictivo que bot_heartbeat (0027), que sí abre SELECT porque el dashboard
-- muestra el estado del bot; la cola no se muestra en ningún sitio.
REVOKE ALL ON public.cola_trabajo FROM authenticated, anon;
```

### 9.3.5 Registro del checksum (obligatorio, patrón 0.1 de SPECS-7A / `migrate.py`)

```
python -c "import hashlib,pathlib; sql=pathlib.Path('backend/db/migrations/0040_cola_trabajos.sql').read_text(encoding='utf-8'); print(hashlib.sha256(sql.encode('utf-8')).hexdigest())"
```
y luego, si se aplica por `apply_migration` del MCP, vía `execute_sql`:
```sql
INSERT INTO schema_migrations (filename, checksum)
VALUES ('0040_cola_trabajos.sql','<hash>')
ON CONFLICT (filename) DO NOTHING;
```
Si se aplica con `python backend/db/migrate.py`, el runner inserta el checksum solo
(`migrate.py:84-87`) — registrar a mano SOLO si se aplica por MCP.

---

## 9.4 Multi-tenancy — decisión cerrada: interna, patrón `bot_heartbeat`, NO `empresa_id`+RLS de tenant

**Decisión: la `cola_trabajo` NO se aísla por `empresa_id` vía RLS. Es un mecanismo interno del
backend, con RLS activado pero SIN policies para `authenticated` (patrón `bot_heartbeat`, 0027).**

Justificación contra el precedente REAL del repo:

- Toda tabla que es **dato de un tenant y que el dashboard toca** cuelga de `current_empresa_id()` con
  policies por empresa (`decision_asignacion`, `gasto_viaje`, `nota_gestor`… ver `SPECS-9-ROLES.md`
  §1.1). La `cola_trabajo` **no es eso**: es fontanería del backend. El dashboard nunca la lee ni
  escribe. Igual que `bot_heartbeat` (0027) no tiene `empresa_id` y solo el service role escribe.
- El productor y el consumidor son **siempre el backend con service role** (que ignora RLS). Meter
  policies de `authenticated` sería seguridad-teatro: no hay ningún flujo de `authenticated` que las
  ejerza.
- `empresa_id` **sí existe** en la tabla, pero como **metadato de trazabilidad** (saber de qué tenant
  era un POD que falló), NO como eje de aislamiento. No hay policy `empresa_id = current_empresa_id()`.
- **Honestidad:** si algún día el dashboard necesitara MOSTRAR el estado de la cola a un gestor (p.ej.
  "3 validaciones de POD pendientes"), habría que añadir entonces una función `SECURITY DEFINER` que
  devuelva solo agregados de su empresa (patrón `viaje_publico` de 7A.14), NO abrir la tabla. Eso es
  fuera de alcance de 9.18; se anota como posible mejora. Hoy: cero exposición.

Esto es coherente con `bot_heartbeat`, que la propia migración 0027 justifica como "mismo criterio que
ejecucion_evento/ubicacion en 0019" (tablas que solo el service role escribe).

---

## 9.5 Forma del proceso worker — reutiliza la `JobQueue` de `bot.py`, NO un proceso separado

**Decisión cerrada: el worker corre DENTRO del proceso `bot.py` existente, como un tercer
`app.job_queue.run_repeating`, en `backend/app/bot.py`. La lógica de la cola vive en un módulo nuevo
`backend/app/cola.py`; el enganche (`run_repeating`) se añade en `create_bot_app()`.**

Justificación:

- Ya hay **exactamente este patrón** funcionando: `heartbeat` y `procesar_notificaciones_asignacion`
  son jobs `run_repeating` en el mismo proceso (`bot.py:1441-1443`). Añadir un tercero es cero
  infraestructura nueva, cero proceso que supervisar, cero systemd/pm2 extra. Coherente con el
  anti-roadmap ("menos piezas nuevas").
- El volumen esperado HOY es **cero o casi cero** (§9.6: no hay consumidor real todavía). Justificar un
  proceso Python separado para una cola que aún no procesa nada de negocio sería sobre-ingeniería
  contraria a la cultura del repo.
- **Matiz importante y honesto (el trade-off que 9.18 debe conocer):** la `JobQueue` de PTB corre en el
  **event loop asyncio** del bot. El claim y el marcado usan `psycopg2` que es **bloqueante (síncrono)**.
  Para no congelar el loop del bot mientras el worker habla con la BD, el job de la cola debe ejecutar
  el trabajo bloqueante en un thread: `await asyncio.get_event_loop().run_in_executor(None, _tick_sync)`
  donde `_tick_sync()` hace el claim+proceso+marcado con `psycopg2`. **Esta es la única sutileza real de
  esta decisión** y está escrita aquí para que 9.18 no la descubra por las malas. (Alternativa
  rechazada: un proceso `backend/worker.py` separado con su propio bucle `while True: sleep`. Se
  rechaza HOY por lo de arriba — sin volumen no compensa. **Se anota como la evolución natural cuando
  POD-visión-LLM esté aprobado y el volumen lo pida:** mover `_tick_sync` a un `backend/worker.py` que
  importe `cola.py` y corra en su propio proceso, reutilizando el MISMO módulo `cola.py` sin
  reescribirlo. El diseño de `cola.py` en §9.5.4 se hace pensando en ese futuro: funciones puras de
  claim/marcado que no dependen de PTB.)**

### 9.5.1 Máquina de estados (la referencia visual para el worker)

```
   enqueue                claim (cola_reclamar_lote)
  ─────────►  pendiente ───────────────────────────►  en_proceso
                 ▲                                        │
                 │ backoff (disponible_en = now()+d)      │  procesar(kind, payload)
                 │                                        │
              fallido ◄───────────────────────────────── ┤ excepción, intentos < max_intentos
                                                          │
              muerto  ◄───────────────────────────────── ┤ excepción, intentos >= max_intentos  (dead-letter, permanente)
                                                          │
              completado ◄─────────────────────────────── ┘ éxito
```

- `fallido` es transitorio: tiene `disponible_en` en el futuro; el índice parcial lo incluye, así que
  un tick posterior (pasado el backoff) lo re-reclama. `pendiente` y `fallido` son ambos
  "reclamables"; se distinguen solo para diagnóstico (¿nació así o ya falló alguna vez?).
- `muerto` y `completado` son terminales: NO están en el índice de reclamables, nunca se re-reclaman.
  **Ninguno se borra jamás** (política "evidencia"): quedan para inspección/métricas.

### 9.5.2 Reintentos y backoff — algoritmo exacto (decisión cerrada)

- **`max_intentos` por defecto = 5.** Justificación del número: suficiente para superar un blip de red
  o una caída breve de un servicio externo (p.ej. la API de visión-LLM), sin martillear
  indefinidamente un trabajo que está roto de verdad. Con el backoff de abajo, 5 intentos cubren ~una
  hora de ventana (0 + 2 + 8 + 32 + 128 min ≈ 170 min de espera acumulada máxima), tiempo de sobra
  para que un incidente transitorio se resuelva.
- **Backoff EXPONENCIAL con base 2 sobre una unidad de 60 s, sin jitter en v1:**
  `retraso_segundos = 60 * (2 ** (intentos - 1))` donde `intentos` es el nº de intentos YA consumidos
  (1 tras el primer fallo, 2 tras el segundo…). Es decir, tras el fallo Nº k, la fila vuelve a estar
  disponible en `now() + interval '60 seconds' * (2 ^ (k-1))`:
  - fallo 1 → +60 s
  - fallo 2 → +120 s
  - fallo 3 → +240 s
  - fallo 4 → +480 s
  - (fallo 5 → sería +960 s, pero al llegar a `max_intentos` pasa a `muerto`, no se reprograma)
  Coherente con `ejecutar_con_reintentos` (8.2), que también usa backoff exponencial base 2 (`backoff_base
  * (2 ** intento)`); aquí la unidad base es 60 s en vez de 0.5 s porque es trabajo diferido, no una
  request en vivo. **Sin jitter en v1** (un solo worker hoy → cero thundering herd que aleatorizar); se
  anota jitter como mejora trivial si algún día hay muchos workers concurrentes.
- **Fórmula del `disponible_en` al fallar (SQL que ejecuta el worker en `marcar_fallido`):**
  ```sql
  UPDATE public.cola_trabajo
     SET estado = CASE WHEN intentos >= max_intentos THEN 'muerto' ELSE 'fallido' END,
         ultimo_error = %(err)s,
         disponible_en = CASE WHEN intentos >= max_intentos
                              THEN disponible_en
                              ELSE now() + (interval '60 seconds' * power(2, intentos - 1)) END,
         completado_en = CASE WHEN intentos >= max_intentos THEN now() ELSE completado_en END
   WHERE id = %(id)s;
  ```
  (`intentos` ya viene incrementado por el claim, §9.3.3, así que aquí se compara `>=` directamente.)
- **Dead-letter:** al alcanzar `max_intentos`, `estado='muerto'` + `completado_en=now()` + se conserva
  `ultimo_error`. **Nunca se auto-borra** — consistente con la filosofía "evidencia, never silently
  lose data" del hash-chain y del `audit_log` (0037, append-only). Un humano inspecciona la cola muerta
  (`SELECT * FROM cola_trabajo WHERE estado='muerto'`) y decide (reprocesar poniéndolo a `pendiente`
  con `intentos=0`, o descartarlo conscientemente).

### 9.5.3 Rescate de trabajos huérfanos (worker que murió con la fila en `en_proceso`)

Si el proceso muere entre el claim y el marcado, una fila queda en `en_proceso` para siempre (nunca se
re-reclama porque `en_proceso` no está en el índice de reclamables). Mecanismo de rescate, ejecutado
al inicio de cada tick del worker ANTES del claim:

```sql
-- Trabajos 'en_proceso' reclamados hace más de COLA_TIMEOUT_HUERFANO segundos se
-- consideran huérfanos (el worker murió) y vuelven a la cola. Si ya agotaron
-- intentos, pasan a 'muerto' en vez de reintentar en bucle.
UPDATE public.cola_trabajo
   SET estado = CASE WHEN intentos >= max_intentos THEN 'muerto' ELSE 'fallido' END,
       ultimo_error = COALESCE(ultimo_error, 'huérfano: worker no marcó resultado'),
       disponible_en = now(),
       completado_en = CASE WHEN intentos >= max_intentos THEN now() ELSE completado_en END
 WHERE estado = 'en_proceso'
   AND reclamado_en < now() - (interval '1 second' * %(timeout)s);
```

`COLA_TIMEOUT_HUERFANO` = 300 s por defecto (constante en `cola.py`, comentario "valor inicial
razonable, NO pactado con cliente real" — patrón 0.6). Debe ser holgadamente mayor que la duración
esperada del trabajo más lento (una validación de visión-LLM podría tardar decenas de segundos; 300 s
da margen sin dejar un huérfano bloqueado horas).

### 9.5.4 Módulo `backend/app/cola.py` — firmas EXACTAS (el ejecutor las copia tal cual)

Diseñado para NO depender de PTB (para poder migrarlo a un proceso separado en el futuro sin
reescribir). Usa `psycopg2` + `DATABASE_URL` (como `migrate.py`). El `enqueue` es la excepción: usa el
cliente PostgREST `supabase` (hot path del bot).

```python
"""Cola de trabajos asíncrona sobre Postgres (ítem 9.18, spec en SPECS-9.md §9).

Reintentos PERSISTENTES (sobreviven al reinicio del proceso), a diferencia de
ejecutar_con_reintentos de bot.py (en memoria). NO usa Redis/Celery — la cola ES
la tabla cola_trabajo. Ver SPECS-9.md §9 para el diseño cerrado.
"""
import os
import socket
import logging
from typing import Callable

import psycopg2
import psycopg2.extras

logger = logging.getLogger("norenty.cola")

COLA_TIMEOUT_HUERFANO_S = 300   # valor inicial razonable, NO pactado con cliente real
COLA_LOTE_DEFAULT = 10          # trabajos por tick

# Registro de handlers por kind. Un handler recibe el payload (dict) y lanza si
# falla (el fallo se captura arriba y dispara el backoff/dead-letter). Un kind
# sin handler registrado se trata como fallo ('kind desconocido'), nunca se pierde.
_HANDLERS: dict[str, Callable[[dict], None]] = {}


def registrar_handler(kind: str, fn: Callable[[dict], None]) -> None:
    """Registra el handler que procesa los trabajos de un `kind` dado."""
    _HANDLERS[kind] = fn


def enqueue(kind: str, payload: dict, *, empresa_id=None, max_intentos: int = 5,
            disponible_en=None) -> None:
    """Encola un trabajo (PRODUCTOR — hot path del bot, vía PostgREST).
    `disponible_en` opcional (ISO str) para trabajos diferidos; por defecto now().
    NO abre conexión psycopg2: reutiliza el cliente supabase ya instanciado.
    """
    from .db import supabase
    fila = {"kind": kind, "payload": payload, "max_intentos": max_intentos}
    if empresa_id is not None:
        fila["empresa_id"] = empresa_id
    if disponible_en is not None:
        fila["disponible_en"] = disponible_en
    supabase.table("cola_trabajo").insert(fila, returning="minimal").execute()
    # returning="minimal": no necesitamos la fila de vuelta y evita RETURNING/RLS
    # de más (patrón 0.2 de SPECS-7A). La tabla no tiene policy SELECT, así que
    # pedir RETURNING con service role funcionaría, pero minimal es lo correcto.


def _conectar():
    """Conexión psycopg2 directa (como migrate.py). Requiere DATABASE_URL."""
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def rescatar_huerfanos(cur, timeout_s: int = COLA_TIMEOUT_HUERFANO_S) -> int:
    """Devuelve a la cola los trabajos 'en_proceso' abandonados. Retorna nº rescatados.
    SQL literal en SPECS-9.md §9.5.3."""
    ...


def reclamar_lote(cur, limite: int = COLA_LOTE_DEFAULT, worker_id: str | None = None) -> list[dict]:
    """Llama a cola_reclamar_lote() y devuelve las filas reclamadas como dicts.
    Usa RealDictCursor. SQL: SELECT * FROM cola_reclamar_lote(%s, %s)."""
    ...


def marcar_completado(cur, trabajo_id: str) -> None:
    """estado='completado', completado_en=now(). SQL literal simple."""
    ...


def marcar_fallido(cur, trabajo_id: str, intentos: int, max_intentos: int, error: str) -> None:
    """Backoff exponencial + dead-letter. SQL literal en SPECS-9.md §9.5.2."""
    ...


def procesar_uno(trabajo: dict) -> tuple[bool, str | None]:
    """Ejecuta el handler del kind del trabajo. FUNCIÓN PURA de enrutado (testeable
    con handlers fake, sin BD). Devuelve (ok, error). Un kind sin handler → (False,
    'kind desconocido: <kind>'). Una excepción del handler → (False, str(exc))."""
    kind = trabajo["kind"]
    handler = _HANDLERS.get(kind)
    if handler is None:
        return False, f"kind desconocido: {kind}"
    try:
        handler(trabajo["payload"])
        return True, None
    except Exception as exc:      # noqa: BLE001 — cualquier fallo del handler va al backoff
        return False, str(exc)


def tick(limite: int = COLA_LOTE_DEFAULT) -> dict:
    """Un ciclo completo del worker (SÍNCRONO, psycopg2). Pensado para llamarse
    desde el JobQueue del bot vía run_in_executor (NO bloquear el event loop) o
    desde un bucle de proceso separado en el futuro. Abre conexión, rescata
    huérfanos, reclama un lote, procesa cada trabajo y marca resultado; cada
    trabajo en su propia transacción para que un fallo no tumbe el lote entero.
    Devuelve {'reclamados': n, 'completados': n, 'fallidos': n, 'rescatados': n}.
    """
    ...
```

### 9.5.5 Enganche en `bot.py` (`create_bot_app`) — código EXACTO a añadir

```python
# En bot.py, junto a heartbeat / procesar_notificaciones_asignacion:
import asyncio
from . import cola

COLA_TICK_INTERVAL_S = 20   # cada 20 s se drena un lote de la cola

async def procesar_cola(ctx):
    """Job repetitivo (9.18): drena un lote de cola_trabajo. El trabajo real es
    SÍNCRONO (psycopg2), así que se ejecuta en un executor para NO congelar el
    event loop del bot. Un fallo aquí no debe tumbar el job: se loguea y ya."""
    try:
        loop = asyncio.get_event_loop()
        resumen = await loop.run_in_executor(None, cola.tick)
        if resumen.get("reclamados"):
            logger.info("Cola: %s", resumen)
    except Exception as e:      # noqa: BLE001
        logger.error("Fallo en el tick de la cola: %s", e)

# ... y dentro de create_bot_app(), en el bloque `if app.job_queue:`:
    if app.job_queue:
        app.job_queue.run_repeating(procesar_notificaciones_asignacion, interval=30, first=15)
        app.job_queue.run_repeating(heartbeat, interval=HEARTBEAT_INTERVAL_S, first=1)
        app.job_queue.run_repeating(procesar_cola, interval=COLA_TICK_INTERVAL_S, first=25)
        # first=25 para no arrancar a la vez que los otros dos jobs (higiene, no
        # crítico); interval 20 s = latencia máxima ~20 s para un trabajo encolado.
```

---

## 9.6 Primer consumidor real — conclusión honesta: NINGUNO se migra hoy; se deja stub `noop` + `validar_pod` documentado

Se analizaron los call-sites reales de trabajo potencialmente diferible en `bot.py`:

| Call-site | Qué hace | ¿Migrar a la cola HOY? |
|-----------|----------|------------------------|
| `notificar_gestor_evento` (`bot.py:446-455`) | Envía Telegram informativo a los gestores (viaje completado, POD recibido). Ya envuelto en `try/except` que loguea sin romper el flujo del chófer. | **NO.** Es rápido y ya es best-effort tolerante a fallo. Moverlo a la cola AÑADIRÍA latencia (el gestor tarda hasta 20 s en enterarse) sin resolver dolor: si el envío falla, hoy simplemente se pierde esa notificación informativa — molesto pero no crítico, y no hay queja real de volumen. |
| `alertar_gestor` (`bot.py:422-443`) | Crea `incidencia` (INSERT crítico) + notifica gestores. | **NO** (y con matiz importante): el INSERT de la incidencia es EVIDENCIA y debe ser síncrono y confirmado al chófer ("tu gestor ha sido notificado"). Solo la parte de *envío Telegram* sería candidata, pero aplica lo mismo que arriba: rápido, best-effort, sin dolor actual. Partir esta función en "insert síncrono + notificación encolada" es complejidad sin retorno hoy. |
| Subida de POD + `pod.insert(estado_validacion='pendiente')` (`handle_photo`, `bot.py:955-961`) | Sube la foto y la marca `pendiente` de validación. | **La validación** (visión-LLM) ES el consumidor natural de la cola — PERO **está gated tras D3/7B (decisión de presupuesto), NO aprobada**. El POD ya nace `estado_validacion='pendiente'`; el día que se apruebe, el encolado es trivial (§9.6.1). Hoy: **stub**. |

**Conclusión cerrada (y deliberadamente conservadora, en la cultura de PROGRESS.md):** **no existe hoy
ningún trabajo síncrono cuyo dolor actual justifique moverlo a la cola.** Las notificaciones son
rápidas y ya toleran fallo; el único consumidor con sentido real (validación de POD por visión) está
bloqueado por una decisión de presupuesto que no se ha tomado. Forzar una migración "para estrenar la
cola" sería exactamente el tipo de complejidad inflada que este repo rechaza.

Por tanto **9.18 construye:**
1. La tabla + índices + función de claim + RLS (§9.3).
2. El módulo `cola.py` completo (§9.5.4) con el worker enganchado (§9.5.5).
3. **Un handler `noop` real** (`registrar_handler("noop", lambda payload: None)`) que sirve como
   trabajo de humo end-to-end: permite probar el ciclo completo (encolar → reclamar → completar) en el
   Grupo B contra BD real SIN depender de ningún servicio externo. Es el "primer consumidor" que prueba
   que los raíles funcionan, sin inventar negocio.
4. **Un handler `validar_pod` como STUB documentado**: registrado pero con cuerpo que lanza
   `NotImplementedError("visión-LLM pendiente de D3/7B")` — de modo que si alguien encola un
   `validar_pod` hoy, el trabajo va limpiamente a `fallido`→`muerto` con un `ultimo_error` claro, NUNCA
   se procesa a medias ni se pierde. El día que D3/7B se apruebe, se rellena ESE cuerpo y se añade la
   línea de `enqueue` en `handle_photo` (§9.6.1); nada más de la infraestructura cambia.

### 9.6.1 Cómo se activará `validar_pod` el día que se apruebe (para que quede escrito, NO se implementa)

En `handle_photo` (`bot.py`), justo después del `pod.insert(...)` (`bot.py:955-961`), añadir:
```python
cola.enqueue("validar_pod",
             {"pod_id": <id del pod>, "hito_id": hito["id"], "viaje_id": viaje["id"],
              "foto_path": file_path},
             empresa_id=chofer["empresa_id"])
```
y rellenar el handler `validar_pod` en `cola.py` (llamar la API de visión, actualizar
`pod.estado_validacion` a `validado`/`rechazado`, notificar al gestor si procede). El chófer NO espera
por esto (el POD ya se confirmó síncronamente); la validación ocurre en background con reintentos
persistentes — que es EXACTAMENTE el caso de uso que el roadmap nombra. Todo esto queda **fuera de
alcance de 9.18**; se escribe aquí para que la activación futura sea copy-paste, sin re-diseño.

---

## 9.7 Casos de test enumerados (misma convención de dos grupos que §5 de la sección hash-chain)

**Criterio honesto (política del repo "no simular que se probó algo que no se probó", 0.3/0.6 de
SPECS-7A):** el `FOR UPDATE SKIP LOCKED`, la concurrencia real de dos workers, y el backoff dependen
del **motor Postgres** y NO los ejerce el `FakeSupabase` de `backend/tests/fakes.py` (es un fake de
PostgREST, no ejecuta SQL ni locking). Por tanto:

- **Grupo A — lógica pura en Python (pytest, `backend/tests/test_cola.py`):** prueba el enrutado de
  `procesar_uno` (handlers registrados, kind desconocido, handler que lanza), el cálculo del backoff
  como función pura, y el `enqueue` contra `FakeSupabase` (que sí registra el INSERT). NO prueba el
  claim ni la concurrencia. Rápido, corre en `.\ci.ps1`.
- **Grupo B — claim/locking/backoff contra BD real (script manual documentado, `scratchpad`):** un
  script con `psycopg2`/`DATABASE_URL` (o una branch de Supabase vía MCP `create_branch` si el plan lo
  permitiera — hoy NO, ver PROGRESS 9.16) que ejerce la función `cola_reclamar_lote`, la concurrencia y
  el ciclo de vida contra la tabla real. Es la ÚNICA forma de probar el `SKIP LOCKED`. Documentar el
  resultado en PROGRESS (patrón 6.9/7A.14). **No fingir que el Grupo A cubre el claim.**

Casos enumerados y concretos:

- **(a) Grupo A — enrutado de `procesar_uno`.** Handler `noop` registrado → `(True, None)`. Kind sin
  handler → `(False, "kind desconocido: <kind>")`. Handler que lanza `ValueError("x")` → `(False, "x")`.
- **(b) Grupo A — backoff exponencial puro.** Una función/fixture que dado `intentos` devuelva el
  retraso esperado: intentos=1→60 s, 2→120 s, 3→240 s, 4→480 s. Protege la fórmula contra cambios
  accidentales.
- **(c) Grupo A — `enqueue` inserta la fila correcta** contra `FakeSupabase`: `kind`, `payload`,
  `max_intentos`, y `empresa_id` solo si se pasa. Verifica `returning="minimal"`.
- **(d) Grupo B — DOS workers concurrentes NUNCA reclaman el mismo trabajo.** Sembrar N trabajos
  `pendiente`; abrir DOS conexiones psycopg2, en cada una `SELECT * FROM cola_reclamar_lote(N, 'w1')` y
  `...('w2')` **en transacciones solapadas** (llamar el claim en la conexión 1 sin commitear, luego en
  la 2), y comprobar que la intersección de ids reclamados es **vacía**. Este ES el caso estrella (el
  `SKIP LOCKED`). Verifica también que la suma de reclamados por ambos ≤ N y que cada fila quedó
  `en_proceso` con su `reclamado_por` correcto.
- **(e) Grupo B — un trabajo que falla se reintenta con backoff hasta `max_intentos`, luego dead-letter.**
  Encolar un trabajo con `max_intentos=2` cuyo handler siempre lanza. Tick 1 → queda `fallido` con
  `disponible_en ≈ now()+60s` e `intentos=1`. Forzar `disponible_en=now()` (simular que pasó el
  backoff) y tick 2 → `intentos=2 >= max_intentos` → **`muerto`**, `completado_en` seteado,
  `ultimo_error` conservado. Comprobar que un tick posterior **NO** lo re-reclama (no está en el índice
  de reclamables). Verifica dead-letter permanente + "nunca se borra".
- **(f) Grupo B — un trabajo con éxito se marca `completado` y no se re-reclama.** Encolar un `noop`;
  un tick → `estado='completado'`, `completado_en` seteado; tick siguiente no lo toca.
- **(g) Grupo B — rescate de huérfanos.** Insertar a mano una fila `en_proceso` con
  `reclamado_en = now() - interval '10 minutes'`; llamar `rescatar_huerfanos(cur, timeout_s=300)` →
  vuelve a `fallido` (o `muerto` si agotó intentos) y queda reclamable. Verifica §9.5.3.
- **(h) Grupo B — `disponible_en` futuro no se reclama.** Encolar con `disponible_en = now()+1h`; un
  tick NO lo reclama (respeta trabajos diferidos y backoff).

---

## 9.8 Trampas del repo relevantes (revisadas y confirmadas para esta sección)

1. **PostgREST NO expone `FOR UPDATE SKIP LOCKED` (§9.2):** por eso el claim es una función SQL llamada
   desde el worker con `psycopg2`/`DATABASE_URL`, NO con el cliente `supabase` del bot. El `enqueue` sí
   va por PostgREST (INSERT normal). No mezclar los dos canales por comodidad.
2. **`JobQueue` de PTB corre en el event loop asyncio; `psycopg2` es bloqueante (§9.5):** el tick de la
   cola DEBE ir en `run_in_executor`, o congela el bot entero. Esta es la sutileza nº1 de esta spec.
3. **Checksum en `schema_migrations` (0.1):** `0040_cola_trabajos.sql` registra su SHA-256. Con
   `migrate.py` el runner lo inserta solo (`migrate.py:84-87`); con `apply_migration` del MCP, a mano
   (§9.3.5). No reeditar una migración ya aplicada; correcciones en una migración nueva.
4. **BOM de PowerShell (0.3):** crear `0040_*.sql` y `backend/app/cola.py` con Write/Edit, NUNCA con
   `Set-Content -Encoding UTF8` (rompe `read_text(encoding="utf-8")` y el checksum silenciosamente).
5. **Patrón `bot_heartbeat` para RLS interna (§9.1.2/§9.4):** RLS ON, cero policies de escritura para
   `authenticated`; aquí incluso sin SELECT (más restrictivo que el heartbeat). El dashboard no toca la
   cola. `empresa_id` es metadato, NO eje de aislamiento — no colgar de `current_empresa_id()`.
6. **"Evidencia, nunca perder datos" (hash-chain §4 / `audit_log` 0037):** el dead-letter (`muerto`) es
   permanente, nunca se auto-purga. Reprocesar un muerto es decisión humana explícita.
7. **`ejecutar_con_reintentos` (8.2) NO se sustituye (§9.1.4):** sigue siendo el reintento del camino
   síncrono. La cola es reintento PERSISTENTE del camino diferido. Conviven; no confundir sus ámbitos.
8. **Branching de Supabase NO disponible en el plan actual (PROGRESS 9.16):** el Grupo B se corre
   contra la BD de desarrollo real con `DATABASE_URL`, no contra una branch efímera. Sembrar/limpiar los
   datos de prueba explícitamente (la tabla acumula, nada se borra solo).
9. **Sentry para errores (visible en `bot.py:14-20`, `ejecutar_con_reintentos:63-67`):** el worker debe
   capturar a Sentry los fallos que llevan un trabajo a `muerto` (dead-letter = algo se perdió de
   procesar y un humano debe mirarlo), si `SENTRY_DSN` está configurado — mismo patrón que 8.2.
10. **`ci.ps1` verde antes de commit (0.4)** y **commits separados código/docs (0.4)** — lo gestiona el
    orquestador; 9.18 solo produce archivos + tests Grupo A que pasen `pytest`, y documenta el Grupo B
    en PROGRESS.
