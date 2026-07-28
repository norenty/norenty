-- ============================================================
-- Norenty Fase 23, Bloque B (23.B.3) — Palets entregados/devueltos.
--
-- DISCOVERY.md insight 13: "¿Cuántos euros dijo mi jefe? En palets que
-- habian desaparecido. Miles y miles de euros." El dato de entrada es
-- trivial (cuantos palets se entregan y cuantos se devuelven en cada
-- parada, algo que el chofer ya maneja fisicamente) y hoy no se mide.
--
-- Nullable, sin backfill: un hito sin palets contados sigue siendo valido
-- (no todos los viajes llevan palets).
--
-- REVERSION (convencion 9.16):
--   ALTER TABLE public.hito DROP COLUMN IF EXISTS palets_entregados;
--   ALTER TABLE public.hito DROP COLUMN IF EXISTS palets_devueltos;
-- ============================================================

ALTER TABLE public.hito ADD COLUMN IF NOT EXISTS palets_entregados int;
ALTER TABLE public.hito ADD COLUMN IF NOT EXISTS palets_devueltos int;

ALTER TABLE public.hito DROP CONSTRAINT IF EXISTS hito_palets_no_negativos;
ALTER TABLE public.hito ADD CONSTRAINT hito_palets_no_negativos
  CHECK (palets_entregados IS NULL OR palets_entregados >= 0);

ALTER TABLE public.hito DROP CONSTRAINT IF EXISTS hito_palets_devueltos_no_negativos;
ALTER TABLE public.hito ADD CONSTRAINT hito_palets_devueltos_no_negativos
  CHECK (palets_devueltos IS NULL OR palets_devueltos >= 0);
