-- ETA "cumple-561" (ítem 5.3): velocidad de planificación para derivar horas de
-- conducción a partir de los km por carretera (ya calculados vía OSRM en 5.2).
-- NO se usa la duración que devuelve OSRM directamente: su perfil "driving" está
-- pensado para turismos, no camiones, y subestimaría el tiempo real. En su lugar,
-- horas de conducción = km / velocidad_planificacion_kmh (heurístico, configurable).
--
-- Nullable: si no se configura, el código usa VELOCIDAD_PLANIFICACION_KMH=75 por
-- defecto (mismo patrón que empresa.coste_km / empresa.base_lat).

ALTER TABLE empresa ADD COLUMN IF NOT EXISTS velocidad_planificacion_kmh numeric;
