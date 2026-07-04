-- Audit log ligero (8.8) — "trazabilidad total": quién cambió qué y cuándo.
-- En un producto de "assurance" no es opcional. `entidad` sigue la misma
-- convención de ámbito que `documento` (viaje/vehiculo/chofer) para poder
-- filtrar la actividad de una entidad concreta de forma consistente.
CREATE TABLE IF NOT EXISTS audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  gestor_id  uuid REFERENCES gestor(id) ON DELETE SET NULL,
  entidad    text NOT NULL,
  entidad_id uuid NOT NULL,
  accion     text NOT NULL,
  detalle    jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_empresa ON audit_log (empresa_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entidad ON audit_log (entidad, entidad_id);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa ve y crea su audit log" ON audit_log FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());
