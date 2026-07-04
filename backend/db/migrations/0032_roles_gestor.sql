-- ============================================================
-- Norenty 9.28/9.29 — Roles de gestor + desactivación (expulsión).
--
-- Hasta hoy cualquier gestor de una empresa podía hacerlo TODO (no había roles)
-- y no había forma de expulsar a uno que se fuera. Esta migración añade:
--   gestor.rol    ∈ {admin, gestor_operativo, solo_lectura}   DEFAULT 'admin'
--   gestor.activo boolean                                     DEFAULT true
-- Defaults elegidos para que NINGÚN gestor existente pierda acceso tras migrar
-- (todos quedan admin/activo). No es restricción retroactiva silenciosa.
--
-- La expulsión se implementa como activo=false (NO borrar: el historial queda
-- para auditoría). El corte de acceso es INSTANTÁNEO porque current_empresa_id()
-- se re-evalúa en cada query y ahora exige activo=true (ver §3): un gestor
-- desactivado obtiene current_empresa_id()=NULL y pierde acceso a TODA tabla
-- cuya policy dependa de esa función, sin tocar las 17 policies una por una.
--
-- Seguridad real = RLS de Postgres (abajo). El gateo del dashboard es UX; un
-- gestor_operativo NO puede escribir coste/precio ni por REST directo saltándose
-- la UI, porque estas policies lo rechazan en el motor.
-- ============================================================

-- 1) Columnas nuevas. Defaults conservadores (todos los existentes = admin/activo).
ALTER TABLE public.gestor
  ADD COLUMN IF NOT EXISTS rol text NOT NULL DEFAULT 'admin'
    CHECK (rol IN ('admin','gestor_operativo','solo_lectura'));
ALTER TABLE public.gestor
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

-- Índice: las funciones auxiliares filtran por auth_user_id (ya PK/único de facto)
-- y activo; un índice parcial acelera el lookup del gestor activo del JWT actual.
CREATE INDEX IF NOT EXISTS idx_gestor_auth_activo
  ON public.gestor (auth_user_id) WHERE activo = true;

-- 2) Rol del gestor llamante (NULL si desactivado o sin fila). SECURITY DEFINER
--    para no recursar RLS al leer gestor desde otra policy (mismo motivo que
--    current_empresa_id, 0009).
CREATE OR REPLACE FUNCTION public.current_gestor_rol()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT rol FROM gestor
   WHERE auth_user_id = auth.uid() AND activo = true
   LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.current_gestor_rol() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_gestor_rol() TO authenticated;

-- 3) Trigger que impide a NO-admins cambiar columnas de coste/precio.
--    Se aplica a empresa, vehiculo, viaje. Compara OLD vs NEW de las columnas
--    protegidas; si cambian y el llamante no es admin -> excepción.
CREATE OR REPLACE FUNCTION public.rol_bloquea_columnas_sensibles()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rol text := public.current_gestor_rol();
BEGIN
  -- service role / procesos internos: auth.uid() es NULL -> v_rol NULL -> NO bloquear
  -- (el bot/backend usa service role y salta RLS; este trigger no debe frenarlo).
  IF v_rol IS NULL THEN
    -- Distinguir "sin sesión de gestor" (service role, permitir) de "gestor
    -- desactivado" (ya bloqueado por current_empresa_id en la policy de fila,
    -- que ni siquiera deja llegar aquí). Si auth.uid() ES NULL -> service role.
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;
    -- auth.uid() no nulo pero rol NULL = gestor desactivado/sin fila: bloquear.
    RAISE EXCEPTION 'gestor sin rol activo no puede modificar columnas sensibles';
  END IF;

  IF v_rol = 'admin' THEN
    RETURN NEW;  -- admin puede todo
  END IF;

  IF TG_TABLE_NAME = 'empresa' THEN
    IF NEW.coste_km IS DISTINCT FROM OLD.coste_km
       OR NEW.precio_gasoil_litro IS DISTINCT FROM OLD.precio_gasoil_litro
       OR NEW.coste_peaje_km IS DISTINCT FROM OLD.coste_peaje_km
       OR NEW.dieta_noche_eur IS DISTINCT FROM OLD.dieta_noche_eur
       OR NEW.coste_conductor_km IS DISTINCT FROM OLD.coste_conductor_km
       OR NEW.margen_objetivo_pct IS DISTINCT FROM OLD.margen_objetivo_pct THEN
      RAISE EXCEPTION 'rol % no puede modificar costes de empresa', v_rol;
    END IF;
  ELSIF TG_TABLE_NAME = 'vehiculo' THEN
    IF NEW.coste_km IS DISTINCT FROM OLD.coste_km
       OR NEW.consumo_l_100km IS DISTINCT FROM OLD.consumo_l_100km THEN
      RAISE EXCEPTION 'rol % no puede modificar costes de vehiculo', v_rol;
    END IF;
  ELSIF TG_TABLE_NAME = 'viaje' THEN
    IF NEW.precio IS DISTINCT FROM OLD.precio THEN
      RAISE EXCEPTION 'rol % no puede modificar el precio del viaje', v_rol;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rol_sensibles_empresa ON public.empresa;
CREATE TRIGGER trg_rol_sensibles_empresa BEFORE UPDATE ON public.empresa
  FOR EACH ROW EXECUTE FUNCTION public.rol_bloquea_columnas_sensibles();

DROP TRIGGER IF EXISTS trg_rol_sensibles_vehiculo ON public.vehiculo;
CREATE TRIGGER trg_rol_sensibles_vehiculo BEFORE UPDATE ON public.vehiculo
  FOR EACH ROW EXECUTE FUNCTION public.rol_bloquea_columnas_sensibles();

DROP TRIGGER IF EXISTS trg_rol_sensibles_viaje ON public.viaje;
CREATE TRIGGER trg_rol_sensibles_viaje BEFORE UPDATE ON public.viaje
  FOR EACH ROW EXECUTE FUNCTION public.rol_bloquea_columnas_sensibles();

-- 4) invitacion: crear/borrar solo admin. SELECT sigue abierto a la empresa (0018).
--    Se REEMPLAZAN las policies de INSERT/DELETE de 0018 por versiones que exigen rol.
DROP POLICY IF EXISTS "empresa crea invitaciones" ON public.invitacion;
CREATE POLICY "admin crea invitaciones" ON public.invitacion
  FOR INSERT WITH CHECK (
    empresa_id = current_empresa_id() AND current_gestor_rol() = 'admin'
  );

DROP POLICY IF EXISTS "empresa borra sus invitaciones" ON public.invitacion;
CREATE POLICY "admin borra invitaciones" ON public.invitacion
  FOR DELETE USING (
    empresa_id = current_empresa_id() AND current_gestor_rol() = 'admin'
  );
-- La policy SELECT de 0018 ("empresa ve sus invitaciones") se deja intacta.

-- 5) gestor: solo admin puede UPDATE (cambiar rol / desactivar) filas de gestores
--    de su empresa; y NUNCA su propia fila (evita autobloqueo). Reemplaza la
--    policy gestor_update_empresa de 0009. La regla "no a sí mismo" se refuerza
--    también en trigger (§5) por si acaso.
DROP POLICY IF EXISTS gestor_update_empresa ON public.gestor;
CREATE POLICY gestor_update_admin ON public.gestor
  FOR UPDATE
  USING (
    empresa_id = current_empresa_id()
    AND current_gestor_rol() = 'admin'
    AND auth_user_id IS DISTINCT FROM auth.uid()   -- no editar tu propia fila
  )
  WITH CHECK (
    empresa_id = current_empresa_id()
    AND current_gestor_rol() = 'admin'
    AND auth_user_id IS DISTINCT FROM auth.uid()
  );
-- IMPORTANTE: 0019:42-44 revocó UPDATE de columna sobre gestor y concedió solo
-- (nombre,email,notif_*,telegram_chat_id). Para que el admin pueda escribir
-- `rol` y `activo`, AMPLIAR el GRANT de columna:
GRANT UPDATE (rol, activo) ON public.gestor TO authenticated;
-- (auth_user_id y empresa_id siguen fuera; el gateo por rol lo hace la policy.)

-- 6) solo_lectura: bloquear INSERT/UPDATE/DELETE en todas las tablas de negocio
--    mutables desde el dashboard. Un trigger por tabla, misma función.
CREATE OR REPLACE FUNCTION public.solo_lectura_bloquea_escritura()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- service role (auth.uid() NULL) nunca se bloquea.
  IF auth.uid() IS NOT NULL AND public.current_gestor_rol() = 'solo_lectura' THEN
    RAISE EXCEPTION 'rol solo_lectura no puede modificar datos';
  END IF;
  RETURN COALESCE(NEW, OLD);  -- NEW en INSERT/UPDATE, OLD en DELETE
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'viaje','hito','incidencia','chofer','vehiculo','plantilla_ruta',
    'plantilla_hito','gasto_viaje','documento','nota_gestor',
    'decision_asignacion','parking','mantenimiento_vehiculo','valoracion',
    'pod','empresa','invitacion','gestor'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_solo_lectura_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_solo_lectura_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.solo_lectura_bloquea_escritura()', t, t);
  END LOOP;
END $$;

-- 7) Expulsión instantánea: current_empresa_id() ahora exige activo=true.
--    Reemplaza la de 0009: un gestor desactivado obtiene NULL -> pierde acceso
--    a TODO (empresa_id = NULL es falso para toda fila, ver spec §1.1/§3).
CREATE OR REPLACE FUNCTION public.current_empresa_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT empresa_id FROM gestor
   WHERE auth_user_id = auth.uid() AND activo = true
   LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.current_empresa_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_empresa_id() TO authenticated;
