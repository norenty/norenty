-- ============================================================
-- Norenty CARGA.1 — Carga real de un viaje (LDM/kg/m3).
--
-- COT.3/4 (2026-07-14) anadieron capacidad al VEHICULO y el calculo de
-- FTL/grupaje en la calculadora standalone (/presupuesto), pero un viaje
-- REAL creado hoy no guarda que carga lleva -- se pierde la info justo
-- donde mas importa. Mismo patron que vehiculo.capacidad_* (migracion 0050):
-- tres columnas nullable, el cliente rellena la que le importe.
--
-- DDL puro, SIN backfill -> idempotente ("una migracion, una
-- responsabilidad", 9.37). RLS de `viaje` ya cubre estas columnas nuevas.
--
-- REVERSION (convencion 9.16): para deshacer --
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS carga_m3;
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS carga_kg;
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS carga_ldm;
-- ============================================================

ALTER TABLE public.viaje
  ADD COLUMN IF NOT EXISTS carga_ldm numeric,
  ADD COLUMN IF NOT EXISTS carga_kg numeric,
  ADD COLUMN IF NOT EXISTS carga_m3 numeric;
