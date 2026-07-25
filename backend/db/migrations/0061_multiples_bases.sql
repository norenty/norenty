-- ============================================================
-- 18.C.3 (Fase 18, 2026-07-25) — múltiples bases/naves por empresa.
--
-- Hasta ahora `empresa.base_lat/base_lon` (0013) solo permitía UNA base,
-- usada para calcular "noches fuera" en la nómina. Feedback directo del
-- usuario recorriendo el producto: "podemos tener múltiples bases, es algo
-- que debe estar contemplado". Además, un chófer NO tiene por qué estar
-- fijado a una base concreta (puede desplazarse entre ellas) -- así que el
-- cálculo de nómina pasa a usar la distancia a la base MÁS CERCANA de la
-- empresa, no una única base fija. Confirmar este supuesto con el gestor
-- real en discovery (12.3) sigue pendiente; aquí se documenta la duda del
-- propio usuario ("no estoy del todo seguro, deberíamos preguntarlo").
--
-- `empresa.base_lat/base_lon` NO se borra (evita una migración destructiva
-- y cualquier código que aún los lea no se rompe) pero deja de ser la
-- fuente de verdad: se backfillea como la primera fila de `base_empresa` y
-- el dashboard deja de escribir en las columnas viejas.
--
-- Mismo patrón de RLS que `cliente` (0041): empresa-scoped + trigger
-- solo_lectura. La restricción de "solo admin añade/edita bases" se hace a
-- nivel de UI (sección ya envuelta en RequireRol admin, 18.A.3b), no con un
-- trigger nuevo -- mismo criterio que el resto de Ajustes → Equipo.
--
-- REVERSIÓN: DROP TABLE IF EXISTS public.base_empresa;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.base_empresa (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  lat         double precision NOT NULL,
  lon         double precision NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_base_empresa_empresa ON public.base_empresa (empresa_id);

ALTER TABLE public.base_empresa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa gestiona sus bases" ON public.base_empresa;
CREATE POLICY "empresa gestiona sus bases" ON public.base_empresa FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());

DROP TRIGGER IF EXISTS trg_solo_lectura_base_empresa ON public.base_empresa;
CREATE TRIGGER trg_solo_lectura_base_empresa BEFORE INSERT OR UPDATE OR DELETE ON public.base_empresa
  FOR EACH ROW EXECUTE FUNCTION public.solo_lectura_bloquea_escritura();

-- Backfill: la base única que ya hubiera configurada se convierte en la
-- primera fila, para no perder el dato de ninguna empresa existente.
INSERT INTO public.base_empresa (empresa_id, nombre, lat, lon)
SELECT id, 'Base principal', base_lat, base_lon
  FROM public.empresa
 WHERE base_lat IS NOT NULL AND base_lon IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.base_empresa be WHERE be.empresa_id = empresa.id);
