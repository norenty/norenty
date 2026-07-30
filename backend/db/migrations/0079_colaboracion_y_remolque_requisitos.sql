-- ============================================================
-- Norenty — tipo de colaboración del chófer + requisitos de remolque por viaje.
--
-- Pedido por el usuario (2026-07-30), dos ideas del mismo mensaje:
--
-- 1) "Podemos vender viajes o subcontratar autónomos como chóferes" -- hoy
--    todo chófer es implícitamente un empleado. `chofer.tipo_colaboracion`
--    distingue empleado/autónomo -- por ahora solo el dato (visible en la
--    ficha), sin lógica de facturación/nómina distinta todavía (eso sería
--    un ítem aparte: un autónomo no entra en el cálculo de nómina de
--    23.B, factura él).
--
-- 2) "El cliente te dice qué tipo de remolque quiere... frigo con rangos de
--    temperatura" -- `vehiculo.subtipo` describe qué ES físicamente un
--    remolque (lona/caja cerrada/frigorífico/cisterna/portacontenedor), y
--    `vehiculo.temperatura_min/max` la capacidad real de un frigorífico.
--    `viaje.remolque_requerido` + `viaje.temperatura_requerida_min/max` son
--    lo que el CLIENTE pidió para ESE viaje -- deliberadamente separado del
--    remolque real asignado (que puede no cumplir el requisito, y eso es
--    justo lo que habría que avisar en un ítem futuro, no aquí).
--
-- Todo nullable/con default seguro: DDL puro, sin backfill destructivo.
--
-- REVERSIÓN (convención 9.16):
--   ALTER TABLE public.chofer DROP COLUMN IF EXISTS tipo_colaboracion;
--   ALTER TABLE public.vehiculo DROP COLUMN IF EXISTS subtipo;
--   ALTER TABLE public.vehiculo DROP COLUMN IF EXISTS temperatura_min;
--   ALTER TABLE public.vehiculo DROP COLUMN IF EXISTS temperatura_max;
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS remolque_requerido;
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS temperatura_requerida_min;
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS temperatura_requerida_max;
-- ============================================================

ALTER TABLE public.chofer
  ADD COLUMN IF NOT EXISTS tipo_colaboracion text NOT NULL DEFAULT 'empleado'
    CHECK (tipo_colaboracion IN ('empleado', 'autonomo'));

ALTER TABLE public.vehiculo
  ADD COLUMN IF NOT EXISTS subtipo text
    CHECK (subtipo IN ('lona', 'caja_cerrada', 'frigorifico', 'cisterna', 'portacontenedor')),
  ADD COLUMN IF NOT EXISTS temperatura_min numeric,
  ADD COLUMN IF NOT EXISTS temperatura_max numeric;

ALTER TABLE public.viaje
  ADD COLUMN IF NOT EXISTS remolque_requerido text
    CHECK (remolque_requerido IN ('lona', 'caja_cerrada', 'frigorifico', 'cisterna', 'portacontenedor')),
  ADD COLUMN IF NOT EXISTS temperatura_requerida_min numeric,
  ADD COLUMN IF NOT EXISTS temperatura_requerida_max numeric;
