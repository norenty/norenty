-- ============================================================
-- Norenty COT.3 — Capacidad de carga del vehiculo (LDM + kg + m3).
--
-- El cotizador (SPECS-COTIZADOR.md) necesita saber si una carga es camion
-- completo (FTL) o grupaje. El estandar del sector europeo de transporte
-- por carretera mide la capacidad por TRES dimensiones a la vez -- metros
-- lineales de carga (LDM), peso maximo y volumen -- porque la que se llena
-- primero es la que decide si cabe mas mercancia. Se anaden las tres,
-- todas OPCIONALES: un cliente puede poblar solo la que le importe, o
-- ninguna (el cotizador cae a "sin capacidad conocida", no rompe nada).
--
-- DDL puro (tres columnas nullable sobre tabla existente), SIN backfill ->
-- idempotente y seguro de reintentar ("una migracion, una responsabilidad",
-- 9.37). RLS de vehiculo ya cubre estas columnas nuevas (misma tabla).
--
-- REVERSION (convencion 9.16): para deshacer --
--   ALTER TABLE public.vehiculo DROP COLUMN IF EXISTS capacidad_m3;
--   ALTER TABLE public.vehiculo DROP COLUMN IF EXISTS capacidad_kg;
--   ALTER TABLE public.vehiculo DROP COLUMN IF EXISTS capacidad_ldm;
-- ============================================================

ALTER TABLE public.vehiculo
  ADD COLUMN IF NOT EXISTS capacidad_ldm numeric,
  ADD COLUMN IF NOT EXISTS capacidad_kg numeric,
  ADD COLUMN IF NOT EXISTS capacidad_m3 numeric;
