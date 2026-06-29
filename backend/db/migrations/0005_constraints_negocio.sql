-- ============================================================
-- Norenty — Constraints de negocio
-- ============================================================

-- Referencia única por empresa (no puede haber dos viajes con la misma ref)
CREATE UNIQUE INDEX IF NOT EXISTS idx_viaje_referencia_empresa
  ON viaje (empresa_id, referencia)
  WHERE referencia IS NOT NULL;

-- Un chófer solo puede estar en un viaje activo (planificado o en_curso)
CREATE UNIQUE INDEX IF NOT EXISTS idx_viaje_chofer_activo
  ON viaje (chofer_id)
  WHERE chofer_id IS NOT NULL AND estado IN ('planificado', 'en_curso');

-- Un vehículo solo puede estar en un viaje activo
CREATE UNIQUE INDEX IF NOT EXISTS idx_viaje_vehiculo_activo
  ON viaje (vehiculo_id)
  WHERE vehiculo_id IS NOT NULL AND estado IN ('planificado', 'en_curso');

-- Un remolque solo puede estar en un viaje activo
CREATE UNIQUE INDEX IF NOT EXISTS idx_viaje_remolque_activo
  ON viaje (remolque_id)
  WHERE remolque_id IS NOT NULL AND estado IN ('planificado', 'en_curso');

-- La matrícula es única por empresa
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehiculo_matricula_empresa
  ON vehiculo (empresa_id, matricula);

-- Un chófer no puede estar duplicado por nombre en la misma empresa
CREATE UNIQUE INDEX IF NOT EXISTS idx_chofer_nombre_empresa
  ON chofer (empresa_id, nombre);

-- La ventana de inicio debe ser anterior a la de fin
ALTER TABLE hito ADD CONSTRAINT chk_hito_ventana
  CHECK (ventana_inicio IS NULL OR ventana_fin IS NULL OR ventana_inicio < ventana_fin);

-- La valoración debe estar entre 1 y 5
ALTER TABLE valoracion ADD CONSTRAINT chk_valoracion_rango
  CHECK (puntuacion >= 1 AND puntuacion <= 5);
