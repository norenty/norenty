-- Viabilidad / margen de viaje (ítem 5.2). Modelo de coste POR CAPAS: el cálculo
-- usa el coste/km más granular disponible y cae al menos granular. Así el cliente
-- "elige hasta dónde llegar" según cuántos datos puebla:
--   1. vehiculo.coste_km (override por camión)  -> el más granular de la v1
--   2. empresa.coste_km  (blended global)        -> fallback
-- El desglose completo (combustible por consumo/peso, coste conductor, peajes) y
-- el indexado de costes reales por viaje (repostajes, multas) es v2 y se añadirá
-- como capas por DELANTE de estas dos, sin romper el cálculo existente.
--
-- Sin cambios de RLS: las columnas heredan las políticas empresa-scoped que ya
-- tienen viaje / empresa / vehiculo.

ALTER TABLE viaje    ADD COLUMN IF NOT EXISTS precio    numeric;  -- ingreso: lo que se cobra al cliente por el viaje
ALTER TABLE empresa  ADD COLUMN IF NOT EXISTS coste_km  numeric;  -- coste/km blended de la empresa (fallback global)
ALTER TABLE vehiculo ADD COLUMN IF NOT EXISTS coste_km  numeric;  -- coste/km específico de este vehículo (override opcional)
