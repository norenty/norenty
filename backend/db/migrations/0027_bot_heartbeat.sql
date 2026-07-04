-- Heartbeat del bot (8.3) — "el canal con el chófer nunca se cae en
-- silencio": el bot inserta una fila cada pocos minutos mientras está vivo;
-- si la última fila es vieja, el gestor lo ve en Ajustes ANTES de que un
-- chófer lleve horas sin poder reportar sin que nadie se entere.
CREATE TABLE IF NOT EXISTS bot_heartbeat (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bot_heartbeat ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cualquier autenticado puede leer el heartbeat" ON bot_heartbeat
  FOR SELECT USING (true);
-- Sin policy de INSERT/UPDATE/DELETE para `authenticated`: solo el bot
-- (service role, que ignora RLS) escribe aquí — mismo criterio que
-- ejecucion_evento/ubicacion en la migración 0019.
REVOKE INSERT, UPDATE, DELETE ON bot_heartbeat FROM authenticated;
