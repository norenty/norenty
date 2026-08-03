-- ============================================================
-- Norenty — subcontratistas como entidad de primera clase (Fase 27.3, informe
-- TMS tradicionales 2026-08-02: SAP TM/Oracle OTM tienen "carrier management"
-- como pieza central -- a quién subcontratas, a qué tarifa, cómo valoras su
-- servicio -- y Norenty no tenía absolutamente nada de esto, verificado en
-- las 84 migraciones previas: ni una tabla de subcontratistas ni de tarifas
-- de compra.
--
-- `subcontratista` es una empresa/autónomo EXTERNO -- deliberadamente
-- distinto de `chofer` (que es alguien de tu propia operación, aunque su
-- tipo_colaboracion sea 'autonomo', 0079). Un viaje se ejecuta con TU flota
-- (chofer_id + vehiculo_id) O con un subcontratista, no ambos a la vez -- de
-- ahí el CHECK.
--
-- `tarifa_km_pactada` vive aquí (no en una tabla de tarifas aparte, a
-- diferencia de tarifa_cliente 0085) porque de momento es un único número
-- por subcontratista, no por ruta -- mismo YAGNI que ya se aplicó a tarifas
-- de venta.
--
-- `valoracion.subcontratista_id`: se reutiliza la tabla ya existente
-- (chofer_id se hace nullable) en vez de duplicar el concepto de
-- "puntuación 1-5 + nota" en una tabla aparte.
--
-- REVERSIÓN (convención 9.16):
--   ALTER TABLE public.viaje DROP CONSTRAINT IF EXISTS viaje_ejecutor_check;
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS subcontratista_id;
--   ALTER TABLE public.valoracion DROP CONSTRAINT IF EXISTS valoracion_sujeto_check;
--   ALTER TABLE public.valoracion DROP COLUMN IF EXISTS subcontratista_id;
--   ALTER TABLE public.valoracion ALTER COLUMN chofer_id SET NOT NULL;
--   DROP TABLE IF EXISTS public.subcontratista;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subcontratista (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  nombre              text NOT NULL,
  cif                 text,
  telefono             text,
  email               text,
  tarifa_km_pactada    numeric CHECK (tarifa_km_pactada IS NULL OR tarifa_km_pactada >= 0),
  telegram_chat_id     text,
  activo              boolean NOT NULL DEFAULT true,
  notas               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subcontratista_empresa ON public.subcontratista (empresa_id);

ALTER TABLE public.subcontratista ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa gestiona sus subcontratistas" ON public.subcontratista FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());

ALTER TABLE public.viaje ADD COLUMN IF NOT EXISTS subcontratista_id uuid REFERENCES public.subcontratista(id) ON DELETE SET NULL;

ALTER TABLE public.viaje DROP CONSTRAINT IF EXISTS viaje_ejecutor_check;
ALTER TABLE public.viaje ADD CONSTRAINT viaje_ejecutor_check
  CHECK (subcontratista_id IS NULL OR (chofer_id IS NULL AND vehiculo_id IS NULL AND remolque_id IS NULL));

ALTER TABLE public.valoracion ALTER COLUMN chofer_id DROP NOT NULL;
ALTER TABLE public.valoracion ADD COLUMN IF NOT EXISTS subcontratista_id uuid REFERENCES public.subcontratista(id) ON DELETE CASCADE;
ALTER TABLE public.valoracion DROP CONSTRAINT IF EXISTS valoracion_sujeto_check;
ALTER TABLE public.valoracion ADD CONSTRAINT valoracion_sujeto_check
  CHECK ((chofer_id IS NOT NULL) <> (subcontratista_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_valoracion_subcontratista ON public.valoracion (subcontratista_id);
