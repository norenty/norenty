-- ============================================================
-- Revisión de arquitectura 2026-08-05 (hallazgo #2, confirmado real): los
-- índices únicos de 0005_constraints_negocio.sql bloqueaban chofer/vehículo/
-- remolque en CUALQUIER viaje 'planificado' o 'en_curso' -- pero
-- checkConflictoRecurso (dashboard/lib/data.js) ya tiene la lógica correcta
-- desde antes: un conflicto con un viaje 'planificado' (a futuro, aún sin
-- arrancar) es solo un AVISO, no un bloqueo -- "es la forma normal de
-- planificar con antelación el siguiente viaje de un camión antes de que el
-- actual arranque" (comentario propio en esa función). El código ya asumía
-- que esto funcionaba; el índice lo contradecía en silencio y habría hecho
-- fallar el INSERT con un error de restricción única confuso la primera vez
-- que alguien planificara dos viajes seguidos para el mismo chófer.
--
-- Se reduce el índice a solo 'en_curso' -- que es el único caso real de "no
-- puede estar en dos sitios a la vez" (bloqueante=true en checkConflictoRecurso).
--
-- REVERSIÓN: DROP INDEX idx_viaje_chofer_activo;
--            CREATE UNIQUE INDEX idx_viaje_chofer_activo ON viaje (chofer_id)
--              WHERE chofer_id IS NOT NULL AND estado IN ('planificado', 'en_curso');
--            (mismo patrón para vehiculo_id y remolque_id)
-- ============================================================

DROP INDEX IF EXISTS idx_viaje_chofer_activo;
CREATE UNIQUE INDEX idx_viaje_chofer_activo
  ON viaje (chofer_id)
  WHERE chofer_id IS NOT NULL AND estado = 'en_curso';

DROP INDEX IF EXISTS idx_viaje_vehiculo_activo;
CREATE UNIQUE INDEX idx_viaje_vehiculo_activo
  ON viaje (vehiculo_id)
  WHERE vehiculo_id IS NOT NULL AND estado = 'en_curso';

DROP INDEX IF EXISTS idx_viaje_remolque_activo;
CREATE UNIQUE INDEX idx_viaje_remolque_activo
  ON viaje (remolque_id)
  WHERE remolque_id IS NOT NULL AND estado = 'en_curso';
