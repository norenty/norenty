-- ============================================================
-- Norenty — estado "bloqueado" + flag "marcado" en viaje.
--
-- Pedido por el usuario (2026-08-02): filtro completo en la lista de viajes
-- por "todos, por planificar, planificados, en transporte, entregados,
-- cancelados, bloqueados, marcados (por el gestor por x motivo)".
--
-- Mapeo con lo que YA existía (sin duplicar estados):
--   por planificar  -> pendiente_aprobacion (viabilidad <100%, aún sin confirmar)
--   planificados    -> planificado
--   en transporte   -> en_curso
--   entregados      -> completado
--   cancelados      -> cancelado
--
-- Dos conceptos nuevos de verdad:
--   1) "bloqueado": un estado MÁS del viaje (el gestor lo pausa a propósito --
--      ej. cliente no paga, incidencia grave sin resolver -- nadie debe tocarlo
--      hasta que se desbloquee). Es un estado porque es EXCLUYENTE con los demás.
--   2) "marcado": NO es un estado -- es ortogonal. Un viaje "en_curso" puede
--      estar marcado a la vez (ej. "ojo, cliente conflictivo" en un viaje que
--      sigue en marcha con normalidad). Por eso vive en su propia columna
--      boolean + motivo, no dentro del CHECK de estado.
--
-- REVERSIÓN (convención 9.16):
--   ALTER TABLE public.viaje DROP CONSTRAINT IF EXISTS viaje_estado_check;
--   ALTER TABLE public.viaje ADD CONSTRAINT viaje_estado_check
--     CHECK (estado IN ('planificado','en_curso','completado','cancelado','pendiente_aprobacion'));
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS marcado;
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS marcado_motivo;
-- ============================================================

ALTER TABLE public.viaje DROP CONSTRAINT IF EXISTS viaje_estado_check;
ALTER TABLE public.viaje ADD CONSTRAINT viaje_estado_check
  CHECK (estado IN ('planificado','en_curso','completado','cancelado','pendiente_aprobacion','bloqueado'));

ALTER TABLE public.viaje
  ADD COLUMN IF NOT EXISTS marcado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marcado_motivo text;

CREATE INDEX IF NOT EXISTS idx_viaje_marcado ON public.viaje (empresa_id, marcado) WHERE marcado;
