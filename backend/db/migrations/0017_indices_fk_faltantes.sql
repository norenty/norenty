-- Índices FK que faltaban (ítem 6.5). El advisor de performance de Supabase
-- (get_advisors) falla con un error interno propio en este proyecto
-- ("syntax error at or near 'storage.buckets'", bug en su lint, no en
-- nuestro esquema), así que se hizo el chequeo equivalente a mano: FKs sin
-- índice que las cubra como primera columna.
--
-- Las tres importan porque se filtran en CADA query gracias a RLS
-- (empresa_id = current_empresa_id() en documento y mantenimiento_vehiculo)
-- o en cada carga de /vehiculos/[id] y en getMetricasFlota (vehiculo_id).
-- Sin índice, eso es un seq scan que empeora con el volumen de datos.

CREATE INDEX IF NOT EXISTS idx_documento_empresa ON documento (empresa_id);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_empresa ON mantenimiento_vehiculo (empresa_id);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_vehiculo ON mantenimiento_vehiculo (vehiculo_id);
