-- ============================================================
-- Norenty 17.G.1 — Vincular plantilla_ruta a un cliente (opcional).
--
-- Por que: el asistente de nuevo viaje (/viajes/nuevo-w) va a poder ofrecer
-- "cargar hitos desde una ruta guardada de este cliente" al elegir cliente
-- (feedback real del usuario probando la empresa ficticia "Transportes
-- Pepito": las plantillas existian pero no estaban conectadas al alta de
-- viaje, habia que rellenar todo a mano igualmente). Para filtrar plantillas
-- por cliente hace falta la relacion -- hoy plantilla_ruta (0003) solo tiene
-- empresa_id, no cliente_id.
--
-- Nullable a proposito: una plantilla puede seguir siendo generica (sin
-- cliente atado), asi las ~plantillas ya creadas no se rompen ni necesitan
-- backfill.
--
-- DDL puro, sin backfill -> idempotente ("una migracion, una
-- responsabilidad", 9.37).
--
-- REVERSION (convencion 9.16): para deshacer --
--   ALTER TABLE public.plantilla_ruta DROP COLUMN IF EXISTS cliente_id;
-- ============================================================

ALTER TABLE public.plantilla_ruta
  ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.cliente(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plantilla_ruta_cliente ON public.plantilla_ruta (cliente_id);
