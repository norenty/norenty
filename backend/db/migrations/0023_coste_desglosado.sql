-- Coste de ruta desglosado por capas (7A.5): combustible real, peajes, dietas y
-- conductor por separado en vez de un único €/km blended. Cada campo es opcional
-- — la empresa "elige hasta dónde llega" poblando datos (extiende la decisión de
-- 5.2). margen_objetivo_pct es para el presupuestador instantáneo (7A.6).
ALTER TABLE vehiculo ADD COLUMN IF NOT EXISTS consumo_l_100km numeric;
ALTER TABLE empresa  ADD COLUMN IF NOT EXISTS precio_gasoil_litro numeric;
ALTER TABLE empresa  ADD COLUMN IF NOT EXISTS coste_peaje_km numeric;
ALTER TABLE empresa  ADD COLUMN IF NOT EXISTS dieta_noche_eur numeric;
ALTER TABLE empresa  ADD COLUMN IF NOT EXISTS coste_conductor_km numeric;
ALTER TABLE empresa  ADD COLUMN IF NOT EXISTS margen_objetivo_pct numeric;
