-- ============================================================
-- Norenty Fase 25 (25.2) — Vacaciones de gestor con aviso de cobertura mínima.
--
-- Planteamiento del usuario: que el propio gestor registre sus vacaciones desde el
-- dashboard, que le salte una solicitud de aprobación al jefe de tráfico (mismo
-- patrón que 18.A.2, `solicitud_aprobacion`), y que el sistema avise (nunca bloquee,
-- decisión 25.1) si aprobarla deja la cobertura de gestores activos por debajo de un
-- mínimo configurable por empresa.
--
-- Decisiones cerradas (2026-07-29):
--   - El aviso de cobertura SOLO advierte -- nunca bloquea la aprobación.
--   - % de cobertura mínima por defecto: 70%, pero configurable por empresa (no
--     hardcodeado) -- el número óptimo real depende de cada plantilla/uso.
--
-- REVERSIÓN (convención 9.16):
--   ALTER TABLE public.empresa DROP COLUMN IF EXISTS cobertura_minima_pct;
--   DROP TABLE IF EXISTS public.vacaciones_gestor;
-- ============================================================

ALTER TABLE public.empresa
  ADD COLUMN IF NOT EXISTS cobertura_minima_pct numeric NOT NULL DEFAULT 70
    CHECK (cobertura_minima_pct > 0 AND cobertura_minima_pct <= 100);

-- vacaciones_gestor: un rango de fechas por gestor, con su propio ciclo de
-- aprobación (independiente de `solicitud_aprobacion`, que es para rutas/viabilidad
-- de VIAJES -- aquí la entidad que se aprueba/rechaza es la propia fila, no algo
-- externo a lo que apuntar). `aviso_cobertura` guarda el snapshot del cálculo hecho
-- al solicitar (texto, ej. "6 de 8 gestores activos = 75% ≥ mínimo 70%" o el caso
-- de aviso) -- para que quede constancia de qué se le mostró al jefe de tráfico en
-- el momento de aprobar, no solo el resultado final.
CREATE TABLE IF NOT EXISTS public.vacaciones_gestor (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  gestor_id        uuid NOT NULL REFERENCES public.gestor(id) ON DELETE CASCADE,
  fecha_inicio     date NOT NULL,
  fecha_fin        date NOT NULL CHECK (fecha_fin >= fecha_inicio),
  estado           text NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  aviso_cobertura  text,
  solicitado_en    timestamptz NOT NULL DEFAULT now(),
  resuelto_por     uuid REFERENCES public.gestor(id) ON DELETE SET NULL,
  resuelto_en      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_vacaciones_gestor_empresa_estado
  ON public.vacaciones_gestor (empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_vacaciones_gestor_fechas
  ON public.vacaciones_gestor (gestor_id, fecha_inicio, fecha_fin);

ALTER TABLE public.vacaciones_gestor ENABLE ROW LEVEL SECURITY;

-- Cualquier gestor de la empresa ve TODAS las vacaciones (propias y ajenas) -- hace
-- falta para que el propio cálculo de cobertura sea visible/auditable por cualquiera,
-- no solo por quien aprueba. Mismo criterio que `nota_gestor` (0054): bitácora
-- compartida del equipo, no un dato privado por gestor.
DROP POLICY IF EXISTS "empresa ve sus vacaciones" ON public.vacaciones_gestor;
CREATE POLICY "empresa ve sus vacaciones" ON public.vacaciones_gestor
  FOR SELECT USING (empresa_id = current_empresa_id());

-- Un gestor solicita SOLO para sí mismo (no puede pedir vacaciones "para otro").
DROP POLICY IF EXISTS "gestor solicita sus propias vacaciones" ON public.vacaciones_gestor;
CREATE POLICY "gestor solicita sus propias vacaciones" ON public.vacaciones_gestor
  FOR INSERT WITH CHECK (
    empresa_id = current_empresa_id()
    AND gestor_id = current_gestor_id()
    AND estado = 'pendiente'
  );

-- Solo admin/planificador (jefe de tráfico, mismo criterio que 18.A.2) resuelve, y
-- solo mientras sigue pendiente.
DROP POLICY IF EXISTS "jefe de trafico resuelve vacaciones" ON public.vacaciones_gestor;
CREATE POLICY "jefe de trafico resuelve vacaciones" ON public.vacaciones_gestor
  FOR UPDATE
  USING (
    empresa_id = current_empresa_id()
    AND current_gestor_roles() && ARRAY['admin', 'planificador']
    AND estado = 'pendiente'
  )
  WITH CHECK (empresa_id = current_empresa_id());
