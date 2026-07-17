-- ============================================================
-- F14.6 (2026-07-17) — el chófer solo puede reportar una incidencia con
-- texto libre (`/incidencia ...`); a veces una foto dice más que la
-- descripción (una carga mal estibada, un daño, un control de carretera).
-- Añade las dos columnas que ya usa `pod` para evidencia con integridad
-- (hash calculado ANTES de subir, mismo patrón que 9.8/9.9) -- reutiliza el
-- bucket privado "pods" (0011), que ya scopa por empresa_id vía el primer
-- segmento de carpeta, sin tocar RLS de storage: la ruta pasa a ser
-- {empresa_id}/incidencia/{incidencia_id}/{uuid}.jpg, sigue empezando por
-- empresa_id igual que las de POD.
-- ============================================================

ALTER TABLE public.incidencia
  ADD COLUMN IF NOT EXISTS foto_url text,
  ADD COLUMN IF NOT EXISTS foto_hash_sha256 text;
