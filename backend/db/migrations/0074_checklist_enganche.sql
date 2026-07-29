-- ============================================================
-- Norenty Fase 23, Bloque C (23.C.5, completado 2026-07-29) — checklist de
-- enganche con foto.
--
-- DISCOVERY.md insight 21: "¿has revisado las ruedas? ¿que no haya cortes en
-- la lona?" -- con foto si hay un defecto, mismo flujo de calidad que ya
-- valida 23.A.1 (POD). Protege de disputas de daños entre chóferes que se
-- intercambian un remolque.
--
-- Nullable, sin backfill: un acoplamiento sin foto de checklist sigue siendo
-- válido (el checklist es una mejora de evidencia, no un requisito bloqueante
-- para enganchar).
--
-- REVERSION (convencion 9.16):
--   ALTER TABLE public.acoplamiento DROP COLUMN IF EXISTS foto_checklist_url;
-- ============================================================

ALTER TABLE public.acoplamiento ADD COLUMN IF NOT EXISTS foto_checklist_url text;
