-- Añadir chat_id de Telegram al gestor para recibir alertas
ALTER TABLE gestor ADD COLUMN IF NOT EXISTS telegram_chat_id text;

-- Campo tipo en ejecucion_evento (antes tipo_evento, normalizar)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ejecucion_evento' AND column_name='tipo_evento')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ejecucion_evento' AND column_name='tipo')
  THEN
    ALTER TABLE ejecucion_evento RENAME COLUMN tipo_evento TO tipo;
  END IF;
END $$;

-- Campo detalle en ejecucion_evento (antes datos, normalizar)
ALTER TABLE ejecucion_evento ADD COLUMN IF NOT EXISTS detalle text;
