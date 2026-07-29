-- ============================================================
-- Norenty Fase 23, 23.F.1 — Roles combinables (`gestor.roles` array).
--
-- Disparador: al construir 23.E (rol `planificador`) el usuario señaló que en la práctica
-- una misma persona hace de gestor Y de planificador ("en mi cabeza el rol de planificador
-- y el de gestor tendría que estar unificado") -- el modelo de `gestor.rol` (un único valor)
-- obliga a elegir UNO solo. Decisión de diseño (acordada explícitamente, no un sistema de
-- módulos genérico): mismo vocabulario discreto de 5 roles ya existente
-- (admin/gestor_operativo/planificador/comercial/solo_lectura), pero ahora combinable.
--
-- COMPATIBILIDAD HACIA ATRÁS (deliberada, hasta que 23.F.2 construya el multi-select en
-- el dashboard): `gestor.rol` (columna singular) SIGUE existiendo y siendo la que escribe
-- la UI actual de un solo `<select>`. Un trigger mantiene `roles` sincronizado con `rol` en
-- cada INSERT/UPDATE -- así CERO gestor existente pierde acceso y CERO código que aún lea
-- `rol` se rompe. Cuando 23.F.2 traiga un multi-select real, escribirá `roles` directamente
-- (con más de un valor) y dejará de tocar `rol`.
--
-- PRINCIPIO ADITIVO: cada rol solo AÑADE capacidades, nunca resta. `solo_lectura` y
-- `comercial` (los dos roles "restringidos", con triggers que BLOQUEAN escritura) solo
-- bloquean si son el ÚNICO rol del gestor -- si además tiene otro rol con permiso de
-- escritura, ese permiso gana. Evita el caso raro (pero posible con roles combinables) de
-- alguien con `['planificador','solo_lectura']` quedando bloqueado por su segundo rol.
--
-- REVERSIÓN (convención 9.16): `ALTER TABLE gestor DROP COLUMN roles;` +
-- `DROP FUNCTION current_gestor_roles();` + `DROP TRIGGER trg_sync_roles_desde_rol ON gestor;`
-- + revertir las policies/triggers de abajo a `current_gestor_rol() = '...'`.
-- ============================================================

-- 1) Columna nueva. Default '{}' + backfill inmediato desde `rol` -- ningún gestor existente
--    queda con roles vacío tras esta migración.
ALTER TABLE public.gestor ADD COLUMN IF NOT EXISTS roles text[] NOT NULL DEFAULT '{}';
UPDATE public.gestor SET roles = ARRAY[rol] WHERE roles = '{}';

-- 2) Trigger de sincronización: mientras la UI siga siendo un solo <select> (hasta 23.F.2),
--    cualquier cambio de `rol` se refleja en `roles` como array de un solo elemento. En
--    INSERT también cubre el caso de que `roles` llegue vacío (default).
CREATE OR REPLACE FUNCTION public.sync_roles_desde_rol()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (NEW.roles IS NULL OR NEW.roles = '{}') THEN
    NEW.roles := ARRAY[NEW.rol];
  ELSIF TG_OP = 'UPDATE' AND NEW.rol IS DISTINCT FROM OLD.rol THEN
    NEW.roles := ARRAY[NEW.rol];
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_roles_desde_rol ON public.gestor;
CREATE TRIGGER trg_sync_roles_desde_rol BEFORE INSERT OR UPDATE ON public.gestor
  FOR EACH ROW EXECUTE FUNCTION public.sync_roles_desde_rol();

-- 3) current_gestor_roles(): mismo criterio de current_gestor_rol() (0032) -- NULL/vacío
--    si desactivado o sin fila. SECURITY DEFINER por el mismo motivo (no recursar RLS).
CREATE OR REPLACE FUNCTION public.current_gestor_roles()
RETURNS text[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT roles FROM gestor
   WHERE auth_user_id = auth.uid() AND activo = true
   LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.current_gestor_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_gestor_roles() TO authenticated;

-- current_gestor_rol() (0032) NO se toca -- sigue leyendo la columna `rol`, que el trigger
-- del punto 2 mantiene en sincronía. Es la red de seguridad: cualquier policy que esta
-- migración no haya tocado explícitamente sigue funcionando exactamente igual que antes.

-- 4) rol_bloquea_columnas_sensibles (0032): admin (en cualquier combinación) puede todo.
CREATE OR REPLACE FUNCTION public.rol_bloquea_columnas_sensibles()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_roles text[] := public.current_gestor_roles();
BEGIN
  IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'gestor sin rol activo no puede modificar columnas sensibles';
  END IF;

  IF 'admin' = ANY(v_roles) THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'empresa' THEN
    IF NEW.coste_km IS DISTINCT FROM OLD.coste_km
       OR NEW.precio_gasoil_litro IS DISTINCT FROM OLD.precio_gasoil_litro
       OR NEW.coste_peaje_km IS DISTINCT FROM OLD.coste_peaje_km
       OR NEW.dieta_noche_eur IS DISTINCT FROM OLD.dieta_noche_eur
       OR NEW.coste_conductor_km IS DISTINCT FROM OLD.coste_conductor_km
       OR NEW.margen_objetivo_pct IS DISTINCT FROM OLD.margen_objetivo_pct THEN
      RAISE EXCEPTION 'rol % no puede modificar costes de empresa', v_roles;
    END IF;
  ELSIF TG_TABLE_NAME = 'vehiculo' THEN
    IF NEW.coste_km IS DISTINCT FROM OLD.coste_km
       OR NEW.consumo_l_100km IS DISTINCT FROM OLD.consumo_l_100km THEN
      RAISE EXCEPTION 'rol % no puede modificar costes de vehiculo', v_roles;
    END IF;
  ELSIF TG_TABLE_NAME = 'viaje' THEN
    IF NEW.precio IS DISTINCT FROM OLD.precio THEN
      RAISE EXCEPTION 'rol % no puede modificar el precio del viaje', v_roles;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 5) solo_lectura_bloquea_escritura (0032): principio aditivo -- solo bloquea si
--    'solo_lectura' es el ÚNICO rol.
CREATE OR REPLACE FUNCTION public.solo_lectura_bloquea_escritura()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_roles text[] := public.current_gestor_roles();
BEGIN
  IF auth.uid() IS NOT NULL AND v_roles = ARRAY['solo_lectura'] THEN
    RAISE EXCEPTION 'rol solo_lectura no puede modificar datos';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 6) rol_comercial_restringido (0063): mismo principio aditivo -- solo bloquea si
--    'comercial' es el ÚNICO rol.
CREATE OR REPLACE FUNCTION public.rol_comercial_restringido()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_roles text[] := public.current_gestor_roles();
BEGIN
  IF auth.uid() IS NOT NULL AND v_roles = ARRAY['comercial'] THEN
    RAISE EXCEPTION 'rol comercial no puede modificar %', TG_TABLE_NAME;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 7) gestor_id_solo_admin (0072): admin O planificador, en cualquier combinación.
CREATE OR REPLACE FUNCTION public.gestor_id_solo_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_roles text[] := public.current_gestor_roles();
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.gestor_id IS DISTINCT FROM OLD.gestor_id
     AND NOT (v_roles && ARRAY['admin', 'planificador']) THEN
    RAISE EXCEPTION 'solo un admin o planificador puede asignar/reasignar el gestor de un % (roles actuales: %)', TG_TABLE_NAME, COALESCE(v_roles::text, 'ninguno');
  END IF;

  RETURN NEW;
END;
$$;

-- 8) Policies RLS de "ver todo" (chofer/viaje/gasto_viaje/decision_asignacion, última
--    versión en 0072): admin O planificador, en cualquier combinación. `&&` (overlap) en
--    vez de `IN`/`=` porque ahora comparamos contra un array, no un valor único.
DROP POLICY IF EXISTS empresa_scoped_chofer ON public.chofer;
CREATE POLICY empresa_scoped_chofer ON public.chofer
  FOR ALL
  USING (
    empresa_id = current_empresa_id()
    AND (current_gestor_roles() && ARRAY['admin', 'planificador'] OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  )
  WITH CHECK (
    empresa_id = current_empresa_id()
    AND (current_gestor_roles() && ARRAY['admin', 'planificador'] OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  );

DROP POLICY IF EXISTS empresa_scoped_viaje ON public.viaje;
CREATE POLICY empresa_scoped_viaje ON public.viaje
  FOR ALL
  USING (
    empresa_id = current_empresa_id()
    AND (current_gestor_roles() && ARRAY['admin', 'planificador'] OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  )
  WITH CHECK (
    empresa_id = current_empresa_id()
    AND (current_gestor_roles() && ARRAY['admin', 'planificador'] OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  );

DROP POLICY IF EXISTS empresa_scoped_gasto_viaje ON public.gasto_viaje;
CREATE POLICY empresa_scoped_gasto_viaje ON public.gasto_viaje
  FOR ALL
  USING (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_roles() && ARRAY['admin', 'planificador'] OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  )
  WITH CHECK (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_roles() && ARRAY['admin', 'planificador'] OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  );

DROP POLICY IF EXISTS empresa_scoped_decision_asignacion ON public.decision_asignacion;
CREATE POLICY empresa_scoped_decision_asignacion ON public.decision_asignacion
  FOR ALL
  USING (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_roles() && ARRAY['admin', 'planificador'] OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  )
  WITH CHECK (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_roles() && ARRAY['admin', 'planificador'] OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  );

-- 9) gestor_update_admin (0048/0032): solo admin edita gestores de su empresa (y nunca a
--    sí mismo). `'admin' = ANY(...)` en vez de `= 'admin'`.
DROP POLICY IF EXISTS gestor_update_admin ON public.gestor;
CREATE POLICY gestor_update_admin ON public.gestor
  FOR UPDATE
  USING (
    empresa_id = current_empresa_id()
    AND 'admin' = ANY(current_gestor_roles())
    AND auth_user_id IS DISTINCT FROM (select auth.uid())
  )
  WITH CHECK (
    empresa_id = current_empresa_id()
    AND 'admin' = ANY(current_gestor_roles())
    AND auth_user_id IS DISTINCT FROM (select auth.uid())
  );
-- GRANT UPDATE de columna: ampliar a `roles` para que 23.F.2 (multi-select) pueda
-- escribirla; `rol` se conserva concedida por compatibilidad con la UI actual.
GRANT UPDATE (rol, roles, activo) ON public.gestor TO authenticated;

-- 10) invitacion (0032): crear/borrar solo admin.
DROP POLICY IF EXISTS "admin crea invitaciones" ON public.invitacion;
CREATE POLICY "admin crea invitaciones" ON public.invitacion
  FOR INSERT WITH CHECK (
    empresa_id = current_empresa_id() AND 'admin' = ANY(current_gestor_roles())
  );

DROP POLICY IF EXISTS "admin borra invitaciones" ON public.invitacion;
CREATE POLICY "admin borra invitaciones" ON public.invitacion
  FOR DELETE USING (
    empresa_id = current_empresa_id() AND 'admin' = ANY(current_gestor_roles())
  );

-- 11) solicitud_aprobacion (0063): admin/gestor_operativo resuelve.
DROP POLICY IF EXISTS "jefe de trafico resuelve solicitudes" ON public.solicitud_aprobacion;
CREATE POLICY "jefe de trafico resuelve solicitudes" ON public.solicitud_aprobacion
  FOR UPDATE
  USING (
    empresa_id = current_empresa_id()
    AND current_gestor_roles() && ARRAY['admin', 'gestor_operativo']
    AND estado = 'pendiente'
  )
  WITH CHECK (empresa_id = current_empresa_id());
