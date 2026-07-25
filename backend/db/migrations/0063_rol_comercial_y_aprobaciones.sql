-- ============================================================
-- Norenty 18.A.1 (primer paso) + 18.A.2 — Gobernanza: rol "comercial" +
-- flujo de aprobaciones real.
--
-- 18.A.1: el usuario pidió plantear varios roles nuevos (gestor de tráfico,
-- administrador, contabilidad, comercial) pero lo dejó apuntado para el
-- discovery real (12.3) -- salvo "comercial", que ya tiene un caso de uso
-- concreto y ya construido (18.C.1, pool de viajes): el departamento
-- comercial crea el viaje, no necesita tocar Ajustes/Equipo/Facturación.
-- Se añade SOLO ese 4º rol ahora; "administrador de parámetros" y
-- "contabilidad" siguen pendientes del discovery.
--
-- 18.A.2: *"que haya un flujo de aprobaciones algo lógico"*, dos casos:
--   (a) dar de alta una ruta nueva (plantilla_ruta) -> la aprueba el jefe de
--       tráfico (admin/gestor_operativo).
--   (b) si la viabilidad de un viaje no da 100% (calcularAvisosViabilidad,
--       ya construido) -> aprobación manual explícita en vez de dejarlo pasar.
-- Tabla única `solicitud_aprobacion` para ambos casos (mismo estado/quién
-- aprueba), en vez de dos mecanismos distintos.
--
-- REVERSIÓN (convención 9.16): para deshacer --
--   DROP TABLE IF EXISTS public.solicitud_aprobacion;
--   DROP TRIGGER IF EXISTS trg_rol_comercial_viaje ON public.viaje; (y las demás, ver DO $$ abajo)
--   DROP FUNCTION IF EXISTS public.rol_comercial_restringido();
--   ALTER TABLE public.gestor DROP CONSTRAINT gestor_rol_check;
--   ALTER TABLE public.gestor ADD CONSTRAINT gestor_rol_check
--     CHECK (rol IN ('admin','gestor_operativo','solo_lectura'));
--   ALTER TABLE public.viaje DROP CONSTRAINT viaje_estado_check;
--   ALTER TABLE public.viaje ADD CONSTRAINT viaje_estado_check
--     CHECK (estado IN ('planificado','en_curso','completado','cancelado'));
-- ============================================================

-- 1) 4º rol: comercial.
ALTER TABLE public.gestor DROP CONSTRAINT IF EXISTS gestor_rol_check;
ALTER TABLE public.gestor ADD CONSTRAINT gestor_rol_check
  CHECK (rol IN ('admin','gestor_operativo','solo_lectura','comercial'));

-- 2) Nuevo estado de viaje: pendiente_aprobacion (viabilidad <100%, caso b).
ALTER TABLE public.viaje DROP CONSTRAINT IF EXISTS viaje_estado_check;
ALTER TABLE public.viaje ADD CONSTRAINT viaje_estado_check
  CHECK (estado IN ('planificado','en_curso','completado','cancelado','pendiente_aprobacion'));

-- 3) Tabla de solicitudes de aprobación (18.A.2).
CREATE TABLE IF NOT EXISTS public.solicitud_aprobacion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('ruta_nueva', 'viabilidad_baja')),
  entidad         text NOT NULL CHECK (entidad IN ('plantilla_ruta', 'viaje')),
  entidad_id      uuid NOT NULL,
  motivo          text,
  estado          text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  solicitado_por  uuid REFERENCES public.gestor(id) ON DELETE SET NULL,
  solicitado_en   timestamptz NOT NULL DEFAULT now(),
  resuelto_por    uuid REFERENCES public.gestor(id) ON DELETE SET NULL,
  resuelto_en     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_solicitud_aprobacion_empresa_estado
  ON public.solicitud_aprobacion (empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_solicitud_aprobacion_entidad
  ON public.solicitud_aprobacion (entidad, entidad_id);

ALTER TABLE public.solicitud_aprobacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa ve sus solicitudes" ON public.solicitud_aprobacion;
CREATE POLICY "empresa ve sus solicitudes" ON public.solicitud_aprobacion
  FOR SELECT USING (empresa_id = current_empresa_id());

-- Cualquier gestor activo de la empresa puede solicitar (es lo que dispara
-- crear un viaje/plantilla que no pasa la viabilidad, no un privilegio
-- especial en sí mismo -- lo especial es RESOLVER, ver abajo).
DROP POLICY IF EXISTS "empresa crea solicitudes" ON public.solicitud_aprobacion;
CREATE POLICY "empresa crea solicitudes" ON public.solicitud_aprobacion
  FOR INSERT WITH CHECK (empresa_id = current_empresa_id());

-- Solo admin/gestor_operativo (jefe de tráfico) resuelve -- y solo mientras
-- sigue pendiente (no se puede reabrir/editar una ya resuelta desde el cliente).
DROP POLICY IF EXISTS "jefe de trafico resuelve solicitudes" ON public.solicitud_aprobacion;
CREATE POLICY "jefe de trafico resuelve solicitudes" ON public.solicitud_aprobacion
  FOR UPDATE
  USING (
    empresa_id = current_empresa_id()
    AND current_gestor_rol() IN ('admin', 'gestor_operativo')
    AND estado = 'pendiente'
  )
  WITH CHECK (empresa_id = current_empresa_id());

-- 4) Restricción de escritura del rol comercial: solo viaje/hito/cliente
--    (crear y editar viajes, ítem 18.C.1). El resto de tablas de negocio
--    queda bloqueado -- mismo patrón/lista que solo_lectura_bloquea_escritura
--    (0032) menos viaje/hito, que aquí SÍ se permiten.
CREATE OR REPLACE FUNCTION public.rol_comercial_restringido()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.current_gestor_rol() = 'comercial' THEN
    RAISE EXCEPTION 'rol comercial no puede modificar %', TG_TABLE_NAME;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'incidencia','chofer','vehiculo','plantilla_ruta',
    'plantilla_hito','gasto_viaje','documento','nota_gestor',
    'decision_asignacion','parking','mantenimiento_vehiculo','valoracion',
    'pod','empresa','invitacion','gestor'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_rol_comercial_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_rol_comercial_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.rol_comercial_restringido()', t, t);
  END LOOP;
END $$;
