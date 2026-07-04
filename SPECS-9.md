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
