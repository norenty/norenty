-- Habilitar Supabase Realtime en tablas clave
-- Ejecutar en Supabase SQL Editor
ALTER PUBLICATION supabase_realtime ADD TABLE viaje;
ALTER PUBLICATION supabase_realtime ADD TABLE hito;
ALTER PUBLICATION supabase_realtime ADD TABLE ejecucion_evento;
ALTER PUBLICATION supabase_realtime ADD TABLE incidencia;
