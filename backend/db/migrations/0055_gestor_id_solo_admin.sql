-- ============================================================
-- F15.2b (Fase 15, scoping de datos por gestor, 2026-07-15) — sigue a 0054.
--
-- Hallazgo al escribir el test de aislamiento: `authenticated` no tiene NI
-- SIQUIERA el GRANT de columna para escribir chofer.gestor_id/viaje.gestor_id
-- (solo idioma/nombre/telefono en chofer están concedidos) -- ni admin podría
-- asignar un chófer a un gestor todavía. Esta migración:
--   1) concede el GRANT de columna que falta (necesario para F15.3, la
--      pantalla de asignación).
--   2) añade un trigger que solo deja cambiar `gestor_id` al rol `admin` —
--      la política RLS de 0054 por sí sola dejaría que un gestor_operativo
--      se "auto-asignara" un chófer/viaje sin gestor (gestor_id IS NULL
--      cumple su propio WITH CHECK), y el pedido explícito del usuario es
--      que la asignación de equipo es cosa del jefe de tráfico, no algo que
--      cada gestor decida por su cuenta. Mismo patrón que
--      rol_bloquea_columnas_sensibles (0032), pero solo para gestor_id.
-- ============================================================

GRANT UPDATE (gestor_id) ON public.chofer TO authenticated;
GRANT UPDATE (gestor_id) ON public.viaje TO authenticated;

CREATE OR REPLACE FUNCTION public.gestor_id_solo_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rol text := public.current_gestor_rol();
BEGIN
  -- service role / procesos internos (auth.uid() NULL): nunca se bloquea,
  -- mismo criterio que rol_bloquea_columnas_sensibles (0032) y
  -- solo_lectura_bloquea_escritura (0032) -- el bot/backend usa service role.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.gestor_id IS DISTINCT FROM OLD.gestor_id AND v_rol IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'solo un admin puede asignar/reasignar el gestor de un % (rol actual: %)', TG_TABLE_NAME, COALESCE(v_rol, 'ninguno');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gestor_id_solo_admin_chofer ON public.chofer;
CREATE TRIGGER trg_gestor_id_solo_admin_chofer BEFORE UPDATE ON public.chofer
  FOR EACH ROW EXECUTE FUNCTION public.gestor_id_solo_admin();

DROP TRIGGER IF EXISTS trg_gestor_id_solo_admin_viaje ON public.viaje;
CREATE TRIGGER trg_gestor_id_solo_admin_viaje BEFORE UPDATE ON public.viaje
  FOR EACH ROW EXECUTE FUNCTION public.gestor_id_solo_admin();
