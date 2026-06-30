-- Tabla de mantenimiento / averías de vehículo
CREATE TABLE IF NOT EXISTS mantenimiento_vehiculo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  vehiculo_id uuid NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('itv','revision','averia','reparacion','otro')),
  descripcion text,
  fecha       date,
  km          integer,
  coste       numeric(10,2),
  estado      text NOT NULL DEFAULT 'completado' CHECK (estado IN ('pendiente','completado')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mantenimiento_vehiculo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "empresa ve su mantenimiento"
  ON mantenimiento_vehiculo FOR ALL
  USING (empresa_id = current_empresa_id())
  WITH CHECK (empresa_id = current_empresa_id());
