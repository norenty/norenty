-- ============================================================
-- Norenty 11.1 — Cliente como entidad de primera clase.
--
-- Hasta ahora el cliente era solo texto libre (`viaje.referencia`,
-- "codigo/albaran del cliente" en 0001). Eso significaba que el conocimiento
-- gestor<->cliente (negociaciones, preferencias, historico, quien paga tarde)
-- NO tenia donde vivir. Esta migracion crea la entidad para que la capa de
-- contexto de 11.2 (notas / transcripciones de llamada / email) pueda anclarse
-- a un cliente real, y para que el futuro bot de llamadas (11.7) recupere el
-- historico de ESE cliente.
--
-- Se CONSERVA `viaje.referencia` intacto (no se migra ni se borra): un viaje
-- puede tener cliente_id, o solo la referencia de texto, o ambos. Asi no se
-- rompe ningun viaje existente y la adopcion de la entidad es incremental.
--
-- Esto es DDL puro (crear tabla + columna + RLS + trigger de rol), sin backfill
-- de datos -- por tanto es idempotente y seguro de reintentar si algo se
-- interrumpe a mitad (convencion "una migracion, una responsabilidad", 9.37).
--
-- Multi-tenancy: RLS por empresa_id = current_empresa_id(), mismo patron que
-- nota_gestor (0022). Trigger solo_lectura_bloquea_escritura (0032) anadido
-- porque cliente es escribible desde el dashboard, como el resto de tablas
-- mutables -- no repetir el hueco que 0037 tuvo que arreglar en audit_log.
--
-- REVERSION (convencion 9.16): para deshacer --
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS cliente_id;
--   DROP TABLE IF EXISTS public.cliente;   -- (borra la policy y el trigger en cascada)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cliente (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  cif         text,                                   -- NIF/CIF fiscal, opcional
  email       text,
  telefono    text,
  notas       text,
  activo      boolean NOT NULL DEFAULT true,          -- baja logica, como el resto del esquema
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cliente_empresa ON public.cliente (empresa_id);

ALTER TABLE public.viaje
  ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.cliente(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_viaje_cliente ON public.viaje (cliente_id);

ALTER TABLE public.cliente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa gestiona sus clientes" ON public.cliente;
CREATE POLICY "empresa gestiona sus clientes" ON public.cliente FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());

-- Defensa en profundidad: rol solo_lectura no puede crear/editar clientes.
DROP TRIGGER IF EXISTS trg_solo_lectura_cliente ON public.cliente;
CREATE TRIGGER trg_solo_lectura_cliente BEFORE INSERT OR UPDATE OR DELETE ON public.cliente
  FOR EACH ROW EXECUTE FUNCTION public.solo_lectura_bloquea_escritura();
