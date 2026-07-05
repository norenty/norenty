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
-- la verificación (verificar_cadena.py) y señala el evento exacto.
--
-- HONESTIDAD: esto da DETECCIÓN, no prevención contra quien tenga la service
-- role key. Ese es el diseño buscado ("puedo demostrarte que no lo tocamos").
--
-- Nombre real de la columna de tipo = `tipo` (renombrada de tipo_evento en 0006).
-- `datos jsonb` se EXCLUYE del hash (no determinista + el bot nunca la escribe).
-- Ver SPECS-9.md para el diseño completo.
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
