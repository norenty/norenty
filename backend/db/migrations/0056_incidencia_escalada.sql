-- ============================================================
-- R1 (Fase 16, escalación proactiva, 2026-07-15) — nivel 2 de la escalación
-- de retraso silencioso: cuándo una incidencia "fuera_de_ventana" ya se
-- avisó (nivel 1) pero sigue abierta, se re-avisa a TODOS los gestores
-- activos, ignorando la preferencia (a los 45 min sin resolver deja de ser
-- "opcional"). `escalada_en` marca que esa segunda vuelta ya se hizo, para
-- no repetirla en cada pasada del monitor (una incidencia escala UNA VEZ).
-- ============================================================

ALTER TABLE public.incidencia
  ADD COLUMN IF NOT EXISTS escalada_en timestamptz;
