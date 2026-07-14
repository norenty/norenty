-- ============================================================
-- Norenty CHK.1 — Modelo de checkpoint (parada obligatoria detectada por GPS).
--
-- Reutiliza `hito` (no tabla nueva): un checkpoint ES un hito, solo que sin
-- botones de confirmación ni POD -- se cruza solo, detectado por la
-- ubicacion en vivo del chofer (mismo mecanismo que la pregunta proactiva de
-- geo-llegada, 7A.4, pero silencioso: no exige confirmacion).
--
-- es_checkpoint: false por defecto -- un hito normal (recogida/entrega) no
-- cambia de comportamiento. radio_m: nullable -- sin configurar, el detector
-- cae al mismo UMBRAL_GEO_LLEGADA_M que ya usa la geo-llegada (bot.py).
--
-- DDL puro (dos columnas nullable/con default sobre tabla existente), SIN
-- backfill -> idempotente ("una migracion, una responsabilidad", 9.37). RLS
-- de `hito` ya cubre estas columnas nuevas (misma tabla).
--
-- REVERSION (convencion 9.16): para deshacer --
--   ALTER TABLE public.hito DROP COLUMN IF EXISTS radio_m;
--   ALTER TABLE public.hito DROP COLUMN IF EXISTS es_checkpoint;
-- ============================================================

ALTER TABLE public.hito
  ADD COLUMN IF NOT EXISTS es_checkpoint boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS radio_m integer;
