-- Cuaderno de bitácora ligero (ítem 7A.10) — a petición del usuario 2026-07-03:
-- "meter algo de notas o comentarios para coger info de primera mano y aprender".
-- Sin estructura, complementa el registro estructurado de decision_asignacion
-- (7A.2) como segunda fuente para entender criterio del gestor con el tiempo.
CREATE TABLE IF NOT EXISTS nota_gestor (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  gestor_id   uuid REFERENCES gestor(id) ON DELETE SET NULL,
  texto       text NOT NULL,
  viaje_id    uuid REFERENCES viaje(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nota_gestor_empresa ON nota_gestor (empresa_id);
ALTER TABLE nota_gestor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa gestiona sus notas" ON nota_gestor FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());
