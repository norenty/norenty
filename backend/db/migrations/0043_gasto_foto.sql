-- ============================================================
-- Norenty 12.1 — Foto adjunta al gasto (ticket de gasolina, multa...).
--
-- gasto_viaje (0024) guardaba importe/litros/tipo pero sin evidencia visual.
-- Se anaden dos columnas OPCIONALES (nullable, la mayoria de gastos seguiran
-- sin foto): la ruta del archivo en Storage y su hash SHA-256, misma logica de
-- "evidencia con integridad" que el POD (pod.hash_sha256, 0034) -- para que un
-- ticket subido no pueda alterarse en silencio.
--
-- Reutiliza el bucket `documentos` YA existente y seguro (RLS por empresa), con
-- ruta `{empresa_id}/gasto/{viaje_id}/...`. NO se crea bucket ni policy nuevos:
-- la policy de `documentos` scopea por la primera carpeta = empresa_id, asi que
-- el prefijo nuevo `gasto/` queda cubierto sin tocar Storage.
--
-- DDL puro (dos columnas nullable sobre tabla existente), SIN backfill ->
-- idempotente y seguro de reintentar ("una migracion, una responsabilidad",
-- 9.37). RLS de gasto_viaje (0024) ya cubre estas columnas nuevas.
--
-- REVERSION (convencion 9.16): para deshacer --
--   ALTER TABLE public.gasto_viaje DROP COLUMN IF EXISTS foto_hash_sha256;
--   ALTER TABLE public.gasto_viaje DROP COLUMN IF EXISTS foto_url;
-- ============================================================

ALTER TABLE public.gasto_viaje
  ADD COLUMN IF NOT EXISTS foto_url text,
  ADD COLUMN IF NOT EXISTS foto_hash_sha256 text;
