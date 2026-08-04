-- ============================================================
-- Norenty — gastos generales de empresa (no atados a un viaje ni vehículo).
--
-- Hallazgo real (2026-08-02, revisando cómo se meten los costes hoy): había
-- tres sitios para gastos -- gasto_viaje (por viaje), mantenimiento_vehiculo
-- (por vehículo), y las tarifas €/km de Ajustes (estimación, no gasto real) --
-- pero ninguno servía para un gasto que no está atado a un viaje o vehículo
-- concreto: la factura mensual de leasing, el seguro de la flota, el alquiler
-- de la oficina, la nómina de un gestor.
--
-- Decisión (misma sesión): no construir un conector de contabilidad genérico
-- (no hay "el" software español estándar -- Sage, A3, Holded, Contasimple...);
-- en su lugar, esta tabla + un export a CSV, que cualquier gestoría puede
-- importar. Cuando un cliente real pida integración directa con SU software,
-- se construye esa, no una especulativa.
--
-- REVERSIÓN (convención 9.16): DROP TABLE IF EXISTS public.gasto_empresa;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.gasto_empresa (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  categoria   text NOT NULL CHECK (categoria IN (
                'leasing', 'seguro', 'nomina', 'alquiler', 'suministros',
                'software', 'asesoria', 'marketing', 'otro'
              )),
  importe     numeric NOT NULL CHECK (importe >= 0),
  proveedor   text,
  descripcion text,
  fecha       date NOT NULL DEFAULT current_date,
  creado_por  uuid REFERENCES public.gestor(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gasto_empresa_empresa_fecha ON public.gasto_empresa (empresa_id, fecha DESC);

ALTER TABLE public.gasto_empresa ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa gestiona sus gastos generales" ON public.gasto_empresa FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());
