-- ============================================================
-- Norenty 18.A.2 (caso a) — estado de aprobación de plantilla_ruta.
--
-- Complementa 0063 (tabla solicitud_aprobacion): la solicitud es la cola de
-- trabajo del jefe de tráfico, esta columna es el estado consultable desde
-- el propio plantilla_ruta (para filtrar qué plantillas puede usar el
-- asistente de nuevo viaje sin tener que hacer join con solicitud_aprobacion
-- en cada consulta).
--
-- Default 'aprobada' a propósito: las plantillas YA EXISTENTES antes de esta
-- migración se dan por buenas (no hay backfill retroactivo que las bloquee).
-- Solo las que se creen a partir de ahora vía crearPlantillaRuta() nacen en
-- 'pendiente' explícitamente desde la aplicación.
--
-- REVERSIÓN (convención 9.16): para deshacer --
--   ALTER TABLE public.plantilla_ruta DROP COLUMN IF EXISTS estado_aprobacion;
-- ============================================================

ALTER TABLE public.plantilla_ruta
  ADD COLUMN IF NOT EXISTS estado_aprobacion text NOT NULL DEFAULT 'aprobada'
    CHECK (estado_aprobacion IN ('pendiente', 'aprobada', 'rechazada'));
