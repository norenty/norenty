-- Gastos reales por viaje (7A.7): repostajes, peajes, multas, dietas. Es la
-- base del P&L real (7A.8) — comparar lo estimado con lo que de verdad costó.
CREATE TABLE IF NOT EXISTS gasto_viaje (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  viaje_id    uuid NOT NULL REFERENCES viaje(id) ON DELETE CASCADE,
  chofer_id   uuid REFERENCES chofer(id) ON DELETE SET NULL,
  vehiculo_id uuid REFERENCES vehiculo(id) ON DELETE SET NULL,
  tipo        text NOT NULL CHECK (tipo IN ('repostaje','peaje','multa','dieta','otro')),
  importe     numeric NOT NULL,
  litros      numeric,
  descripcion text,
  fecha       date,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gasto_viaje_viaje ON gasto_viaje (viaje_id);
CREATE INDEX IF NOT EXISTS idx_gasto_viaje_empresa ON gasto_viaje (empresa_id);
ALTER TABLE gasto_viaje ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa gestiona sus gastos" ON gasto_viaje FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());
