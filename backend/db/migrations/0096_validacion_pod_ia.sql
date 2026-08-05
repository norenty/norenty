-- ============================================================
-- Validación de POD con IA de visión (2026-08-05) — construido y APAGADO por
-- defecto. `empresa.validacion_pod_ia_activa` es la ÚNICA puerta: el código
-- Python (backend/app/bot.py, validar_pod_con_ia()) comprueba esta columna
-- ANTES de tocar ninguna librería de red -- si es false, la función devuelve
-- None en la primera línea, sin siquiera importar el SDK de Anthropic. Cero
-- riesgo de gasto mientras nadie active el interruptor a mano en Ajustes.
--
-- Columnas en `pod` para guardar el resultado, SOLO se rellenan si la
-- empresa activó el flag -- en caso contrario quedan NULL para siempre.
--
-- REVERSIÓN: ALTER TABLE empresa DROP COLUMN IF EXISTS validacion_pod_ia_activa;
--            ALTER TABLE pod DROP COLUMN IF EXISTS validacion_ia_sellado;
--            ALTER TABLE pod DROP COLUMN IF EXISTS validacion_ia_fecha_legible;
--            ALTER TABLE pod DROP COLUMN IF EXISTS validacion_ia_notas;
-- ============================================================

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS validacion_pod_ia_activa boolean NOT NULL DEFAULT false;

ALTER TABLE pod ADD COLUMN IF NOT EXISTS validacion_ia_sellado boolean;
ALTER TABLE pod ADD COLUMN IF NOT EXISTS validacion_ia_fecha_legible boolean;
ALTER TABLE pod ADD COLUMN IF NOT EXISTS validacion_ia_notas text;
