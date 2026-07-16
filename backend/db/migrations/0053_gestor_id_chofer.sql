-- ============================================================
-- F15.1 (Fase 15, scoping de datos por gestor, 2026-07-15) — base para que
-- cada gestor no-admin solo vea sus propios chóferes/rutas asignados.
--
-- viaje.gestor_id YA EXISTE desde 0008 (hasta ahora solo se usaba para
-- atribución/estadísticas, getRendimientoGestores). Esta migración añade el
-- equivalente en chofer + la función auxiliar current_gestor_id(), que F15.2
-- usará para reescribir las políticas RLS de chofer/viaje. NO cambia ninguna
-- política todavía -- eso es F15.2, deliberadamente en una migración aparte
-- para poder verificar cada paso por separado.
-- ============================================================

-- gestor_id nullable a propósito: un chófer SIN gestor asignado es un estado
-- válido (visible para todos los gestores de la empresa hasta que el admin lo
-- asigne, ver F15.2) -- evita que la migración deje chóferes existentes
-- huérfanos e invisibles el día del despliegue.
ALTER TABLE public.chofer
  ADD COLUMN IF NOT EXISTS gestor_id uuid REFERENCES public.gestor(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chofer_gestor_id ON public.chofer (gestor_id);

-- gestor logueado (NULL si desactivado o sin fila) -- mismo patrón que
-- current_empresa_id()/current_gestor_rol() (0009/0032): SECURITY DEFINER
-- para no recursar RLS al leer 'gestor' desde dentro de otra policy.
CREATE OR REPLACE FUNCTION public.current_gestor_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT id FROM gestor
   WHERE auth_user_id = auth.uid() AND activo = true
   LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.current_gestor_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_gestor_id() TO authenticated;
