-- Registro de cada asignación: qué sugirió el sistema vs qué eligió el gestor. Es el
-- hook de "aprendizaje" — no hay ML todavía, pero sin este registro no habría con qué
-- entrenar/ajustar nada el día de mañana (7B.7). Cuando el gestor NO sigue la sugerencia
-- top, se le pide un motivo opcional: esa nota es la señal más valiosa (por qué un score
-- alto no fue la elección real).
CREATE TABLE IF NOT EXISTS decision_asignacion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  viaje_id            uuid NOT NULL REFERENCES viaje(id) ON DELETE CASCADE,
  chofer_sugerido_id  uuid REFERENCES chofer(id) ON DELETE SET NULL,
  chofer_elegido_id   uuid NOT NULL REFERENCES chofer(id) ON DELETE CASCADE,
  score_sugerido      integer,
  score_elegido       integer,
  siguio_sugerencia   boolean NOT NULL,
  motivo              text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_asignacion_empresa ON decision_asignacion (empresa_id);
CREATE INDEX IF NOT EXISTS idx_decision_asignacion_viaje ON decision_asignacion (viaje_id);
ALTER TABLE decision_asignacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa ve y crea sus decisiones" ON decision_asignacion FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());
