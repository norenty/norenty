-- ============================================================
-- Objetivo de puntualidad por empresa (petición del usuario 2026-07-12):
-- igual que `margen_objetivo_pct` ya permite fijar un objetivo de margen y
-- compararlo con la realidad, esta columna permite fijar un % de puntualidad
-- objetivo (p.ej. "queremos el 95% de hitos dentro de ventana") y mostrar la
-- vista de Analítica → Puntualidad frente a ese objetivo, no solo el dato
-- absoluto. Nullable: sin configurar, la vista simplemente no muestra
-- comparación (mismo criterio que margen_objetivo_pct).
-- ============================================================

ALTER TABLE public.empresa ADD COLUMN IF NOT EXISTS objetivo_puntualidad_pct numeric;
