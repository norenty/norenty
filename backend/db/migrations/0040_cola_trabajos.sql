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
-- eje de aislamiento — ver SPECS-9.md §9.4.
--
-- FILOSOFÍA "evidencia, nunca perder datos en silencio" (igual que hash-chain y
-- audit_log): un trabajo que agota reintentos NO se borra; queda en estado
-- 'muerto' (dead-letter) para inspección humana. Nada se auto-purga.
--
-- Ver SPECS-9.md "Bloque colas" para el diseño completo (ítem 9.17/9.18).
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

-- Índice PARCIAL para el claim: el worker solo mira filas reclamables
-- (pendiente/fallido con disponible_en ya vencido). Parcial = pequeño y
-- caliente aunque la tabla acumule millones de 'completado'/'muerto'.
CREATE INDEX IF NOT EXISTS idx_cola_reclamables
  ON public.cola_trabajo (disponible_en)
  WHERE estado IN ('pendiente','fallido');

-- Índice para el rescate de huérfanos: trabajos 'en_proceso' viejos.
CREATE INDEX IF NOT EXISTS idx_cola_en_proceso
  ON public.cola_trabajo (reclamado_en)
  WHERE estado = 'en_proceso';

-- Índice para inspección operativa del dead-letter y por empresa (diagnóstico).
CREATE INDEX IF NOT EXISTS idx_cola_estado ON public.cola_trabajo (estado);

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

ALTER TABLE public.cola_trabajo ENABLE ROW LEVEL SECURITY;
-- SIN NINGUNA policy: por defecto, con RLS activado y sin policies, `authenticated`
-- y `anon` no pueden hacer NADA (ni SELECT). Solo el service role (que ignora RLS)
-- opera la cola. La cola es 100% interna: el dashboard ni la lee. Esto es MÁS
-- restrictivo que bot_heartbeat (0027), que sí abre SELECT porque el dashboard
-- muestra el estado del bot; la cola no se muestra en ningún sitio.
REVOKE ALL ON public.cola_trabajo FROM authenticated, anon;
