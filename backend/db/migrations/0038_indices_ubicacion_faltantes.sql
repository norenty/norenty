-- ============================================================
-- Norenty — Captura de deriva de esquema real (auditoría 2026-07-05).
--
-- Los índices idx_ubicacion_chofer / idx_ubicacion_chofer_reciente EXISTEN
-- en la base de datos real de producción, pero no había ningún archivo de
-- migración que los declarase — se aplicaron ad-hoc por MCP en algún punto
-- y nunca se capturaron, violando el principio de "disciplina de
-- migraciones: runner ordenado y reproducible, no ad-hoc" (Fase 3).
-- Efecto real: un proyecto Supabase nuevo (ítem 9.1, separar dev/prod)
-- reconstruido SOLO desde backend/db/migrations/*.sql arrancaría sin estos
-- índices sobre la tabla de mayor volumen de escritura del esquema
-- (posición GPS de cada chófer, cada pocos minutos, para siempre).
--
-- CREATE INDEX IF NOT EXISTS: idempotente, no rompe nada si ya existen
-- (que es el caso en producción hoy).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_ubicacion_chofer
  ON public.ubicacion (chofer_id);

CREATE INDEX IF NOT EXISTS idx_ubicacion_chofer_reciente
  ON public.ubicacion (chofer_id, created_at DESC);
