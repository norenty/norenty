-- ============================================================
-- Norenty Fase 23, Bloque E (23.E.1) — Rol `planificador`.
--
-- DISCOVERY.md insight 18: la cadena real es comercial -> planificador ->
-- gestor. El planificador "no mira sus camiones, mira toda una delegación" y
-- "decide quien hace cada viaje" -- junta viaje + tractora + chofer. Hoy solo
-- tenemos admin/gestor_operativo/solo_lectura/comercial (0032/0063): el
-- planificador no es "un admin mas" (no debe tocar equipo/facturacion/ajustes)
-- ni "un gestor_operativo mas" (que SOLO ve sus propios choferes/viajes
-- asignados, F15.2/0054 -- justo lo opuesto de lo que necesita el planificador).
--
-- Este rol reutiliza la MISMA via de escape que hoy tiene 'admin' en las
-- policies de 0054 (ver todo, no solo lo propio) y en el trigger de 0055
-- (puede asignar/reasignar gestor_id) -- son exactamente los dos privilegios
-- que describe el discovery, ni uno mas.
--
-- REVERSION (convencion 9.16): no trivial (CHECK constraint con valores en
-- uso) -- si hace falta deshacer, quitar 'planificador' del CHECK requiere
-- primero migrar cualquier gestor con ese rol a otro.
-- ============================================================

ALTER TABLE public.gestor DROP CONSTRAINT IF EXISTS gestor_rol_check;
ALTER TABLE public.gestor ADD CONSTRAINT gestor_rol_check
  CHECK (rol IN ('admin','gestor_operativo','solo_lectura','comercial','planificador'));

-- F15.2 (0054): ver TODOS los choferes/viajes de la empresa, no solo los
-- propios -- mismo criterio que admin, es la razon de ser del rol.
DROP POLICY IF EXISTS empresa_scoped_chofer ON public.chofer;
CREATE POLICY empresa_scoped_chofer ON public.chofer
  FOR ALL
  USING (
    empresa_id = current_empresa_id()
    AND (current_gestor_rol() IN ('admin', 'planificador') OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  )
  WITH CHECK (
    empresa_id = current_empresa_id()
    AND (current_gestor_rol() IN ('admin', 'planificador') OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  );

DROP POLICY IF EXISTS empresa_scoped_viaje ON public.viaje;
CREATE POLICY empresa_scoped_viaje ON public.viaje
  FOR ALL
  USING (
    empresa_id = current_empresa_id()
    AND (current_gestor_rol() IN ('admin', 'planificador') OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  )
  WITH CHECK (
    empresa_id = current_empresa_id()
    AND (current_gestor_rol() IN ('admin', 'planificador') OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  );

DROP POLICY IF EXISTS empresa_scoped_gasto_viaje ON public.gasto_viaje;
CREATE POLICY empresa_scoped_gasto_viaje ON public.gasto_viaje
  FOR ALL
  USING (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() IN ('admin', 'planificador') OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  )
  WITH CHECK (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() IN ('admin', 'planificador') OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  );

DROP POLICY IF EXISTS empresa_scoped_decision_asignacion ON public.decision_asignacion;
CREATE POLICY empresa_scoped_decision_asignacion ON public.decision_asignacion
  FOR ALL
  USING (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() IN ('admin', 'planificador') OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  )
  WITH CHECK (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() IN ('admin', 'planificador') OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  );

-- 0055: el planificador SÍ puede asignar/reasignar el gestor de un viaje --
-- es literalmente su función ("decide quién lo hace"). gestor_operativo
-- sigue sin poder (solo ve lo suyo, no tiene con qué decidir un reparto).
CREATE OR REPLACE FUNCTION public.gestor_id_solo_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rol text := public.current_gestor_rol();
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.gestor_id IS DISTINCT FROM OLD.gestor_id AND v_rol NOT IN ('admin', 'planificador') THEN
    RAISE EXCEPTION 'solo un admin o planificador puede asignar/reasignar el gestor de un % (rol actual: %)', TG_TABLE_NAME, COALESCE(v_rol, 'ninguno');
  END IF;

  RETURN NEW;
END;
$$;

-- rol_comercial_restringido (0063) ya itera una lista de tablas fija; el
-- planificador NO está en esa lista (no es un rol restringido, es un rol con
-- privilegios ampliados) -- no hace falta tocar ese trigger.
