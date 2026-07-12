-- ============================================================
-- Norenty 10.8 — Registro sistemático del error de estimación ("verdad
-- observada"). Es la base de datos del aprendizaje (Bloque I, principio
-- rector: "el sistema aprende de su propia verdad, pero cada ajuste se
-- ofrece como sugerencia transparente, nunca mutación silenciosa" -- ver
-- ROADMAP.md Fase 10). Sin esta tabla, 10.9 (calibración por empresa) no
-- tiene sobre qué calcular una tendencia.
--
-- Cada fila es una FOTO de un periodo: cuánto se desvió lo real de lo
-- estimado, en los dos ejes ya calculables sin duplicar lógica de negocio
-- en Python (puntualidad de llegada, desviación de coste). El ratio de
-- sinuosidad real (km OSRM/Haversine) se DEJA FUERA a propósito -- no hay
-- hoy ninguna llamada que compare ambos valores para el mismo tramo (cuando
-- OSRM responde, nunca se calcula el Haversine equivalente); añadir esas
-- llamadas extra solo para calibrar sería trabajo especulativo sin que 10.9
-- lo necesite todavía. Se hará cuando 10.9 (gated por decisión del usuario)
-- lo requiera de verdad.
--
-- APPEND-ONLY (como audit_log, 0037): es un registro histórico de tendencia,
-- no memoria de trabajo editable -- igual que audit_log, ninguna fila se
-- corrige, se añade una nueva. Policy FOR SELECT+INSERT, sin UPDATE/DELETE.
--
-- DDL puro, SIN backfill -> idempotente ("una migracion, una
-- responsabilidad", 9.37).
--
-- REVERSION (convencion 9.16): para deshacer --
--   DROP TABLE IF EXISTS public.verdad_observada;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.verdad_observada (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                  uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  periodo_desde               timestamptz NOT NULL,
  periodo_hasta               timestamptz NOT NULL,
  num_viajes_con_datos        integer NOT NULL DEFAULT 0,
  pct_hitos_a_tiempo          numeric,   -- null si no hay hitos con dato en el periodo
  delta_llegada_medio_min     numeric,   -- media de (llegada_real - ventana_fin) en minutos
  desviacion_coste_pct_media  numeric,   -- media de |real-estimado|/estimado, mismo calculo que getMetricasRentabilidad
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verdad_observada_empresa
  ON public.verdad_observada (empresa_id, periodo_desde DESC);

ALTER TABLE public.verdad_observada ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa ve su verdad observada" ON public.verdad_observada;
CREATE POLICY "empresa ve su verdad observada" ON public.verdad_observada
  FOR SELECT USING (empresa_id = current_empresa_id());

DROP POLICY IF EXISTS "empresa inserta su verdad observada" ON public.verdad_observada;
CREATE POLICY "empresa inserta su verdad observada" ON public.verdad_observada
  FOR INSERT WITH CHECK (empresa_id = current_empresa_id());

-- Sin policy de UPDATE ni DELETE: RLS deniega esas operaciones por defecto
-- para `authenticated`. Append-only real, igual que audit_log (0037).

DROP TRIGGER IF EXISTS trg_solo_lectura_verdad_observada ON public.verdad_observada;
CREATE TRIGGER trg_solo_lectura_verdad_observada BEFORE INSERT OR UPDATE OR DELETE ON public.verdad_observada
  FOR EACH ROW EXECUTE FUNCTION public.solo_lectura_bloquea_escritura();
