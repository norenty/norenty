-- ============================================================
-- Aviso de límite de seguro de la carga (ROADMAP 20.6, petición del usuario
-- 2026-07-26, validado con amigos del sector): el seguro de mercancía (CMR)
-- de la empresa cubre hasta un importe; por encima el transportista asume el
-- riesgo (robo, "rotura de lonas" -- patrón de robo documentado en rutas del
-- sur de Francia). Dos columnas nullable, mismo patrón que
-- margen_objetivo_pct/objetivo_puntualidad_pct: sin configurar, no se avisa
-- de nada (comportamiento actual, sin romper viajes existentes).
-- ============================================================

ALTER TABLE public.empresa ADD COLUMN IF NOT EXISTS valor_asegurado_maximo_eur numeric;
ALTER TABLE public.viaje ADD COLUMN IF NOT EXISTS valor_mercancia_eur numeric;

-- REVERSIÓN:
-- ALTER TABLE public.empresa DROP COLUMN IF EXISTS valor_asegurado_maximo_eur;
-- ALTER TABLE public.viaje DROP COLUMN IF EXISTS valor_mercancia_eur;
