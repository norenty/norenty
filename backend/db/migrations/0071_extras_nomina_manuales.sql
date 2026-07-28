-- ============================================================
-- Norenty Fase 23, Bloque B (23.B.4) — Extras de nómina que necesitan un
-- flag humano (ningún sensor los da): ADR, carga/descarga por el chófer,
-- y retén.
--
-- DISCOVERY.md insight 12:
--   "No lo cuida todo el mundo. Tienes que tener un curso, tienes que
--    renovarlo, tienes que poner unas chapas en el camión." (ADR)
--   "Si hace cosas que hayan de plan B, o si carga o descarga él..."
--   "Retenes son dejar a un tío parado para hacer un viaje en concreto el
--    día siguiente."
--
-- REVERSION (convencion 9.16):
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS adr;
--   ALTER TABLE public.hito DROP COLUMN IF EXISTS carga_descarga_chofer;
--   DROP TABLE IF EXISTS public.reten;
-- ============================================================

ALTER TABLE public.viaje ADD COLUMN IF NOT EXISTS adr boolean NOT NULL DEFAULT false;
ALTER TABLE public.hito ADD COLUMN IF NOT EXISTS carga_descarga_chofer boolean NOT NULL DEFAULT false;

-- reten: un día de un chófer, no un viaje ni un hito -- se le para para poder
-- salir con disco limpio al día siguiente. `viaje_siguiente_id` es opcional
-- (puede registrarse antes de que el viaje concreto exista en el sistema).
CREATE TABLE IF NOT EXISTS public.reten (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  chofer_id        uuid NOT NULL REFERENCES public.chofer(id) ON DELETE CASCADE,
  fecha            date NOT NULL,
  motivo           text,
  viaje_siguiente_id uuid REFERENCES public.viaje(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chofer_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_reten_empresa_fecha ON public.reten (empresa_id, fecha);

ALTER TABLE public.reten ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa ve sus retenes" ON public.reten;
CREATE POLICY "empresa ve sus retenes" ON public.reten
  FOR SELECT USING (empresa_id = current_empresa_id());

DROP POLICY IF EXISTS "operativos registran retenes" ON public.reten;
CREATE POLICY "operativos registran retenes" ON public.reten
  FOR INSERT WITH CHECK (empresa_id = current_empresa_id() AND current_gestor_rol() IN ('admin', 'gestor_operativo'));

DROP POLICY IF EXISTS "operativos borran retenes" ON public.reten;
CREATE POLICY "operativos borran retenes" ON public.reten
  FOR DELETE USING (empresa_id = current_empresa_id() AND current_gestor_rol() IN ('admin', 'gestor_operativo'));
