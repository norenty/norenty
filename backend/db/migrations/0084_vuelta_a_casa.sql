-- ============================================================
-- Norenty — restricción de "vuelta a casa el fin de semana" (ROADMAP, decisión
-- 2026-08-02 con el usuario tras discutirlo: por defecto es una regla DURA
-- --bloquea, no solo avisa-- porque "apuntamos a un algoritmo que optimice lo
-- que un humano no ve"; pero con vía de excepción explícita para el gestor,
-- igual que 18.A.2 (pendiente_aprobacion + solicitud_aprobacion) para
-- viabilidad -- nunca un bloqueo sin salida. El umbral es configurable por
-- empresa (no fijo en código) porque el propio usuario señaló que "depende de
-- la situación, costes, ingresos" -- cada jefe de tráfico ajusta el suyo.
--
-- 1) chofer.ciudad_residencia_lat/lon: coordenadas de la ciudad de residencia
--    (0078 solo guardaba el nombre en texto) -- se geocodifican UNA VEZ al
--    guardar (Nominatim, ya usado en buscarDireccion), no en cada viaje.
-- 2) empresa.umbral_vuelta_casa_km: default 150 (~2h de conducción), editable
--    desde Ajustes -- mismo patrón que velocidad_planificacion_kmh.
-- 3) solicitud_aprobacion.tipo: se añade 'vuelta_a_casa' junto a los ya
--    existentes ('ruta_nueva', 'viabilidad_baja').
--
-- REVERSIÓN (convención 9.16):
--   ALTER TABLE public.chofer DROP COLUMN IF EXISTS ciudad_residencia_lat;
--   ALTER TABLE public.chofer DROP COLUMN IF EXISTS ciudad_residencia_lon;
--   ALTER TABLE public.empresa DROP COLUMN IF EXISTS umbral_vuelta_casa_km;
--   ALTER TABLE public.solicitud_aprobacion DROP CONSTRAINT IF EXISTS solicitud_aprobacion_tipo_check;
--   ALTER TABLE public.solicitud_aprobacion ADD CONSTRAINT solicitud_aprobacion_tipo_check
--     CHECK (tipo IN ('ruta_nueva', 'viabilidad_baja'));
-- ============================================================

ALTER TABLE public.chofer
  ADD COLUMN IF NOT EXISTS ciudad_residencia_lat double precision,
  ADD COLUMN IF NOT EXISTS ciudad_residencia_lon double precision;

ALTER TABLE public.empresa
  ADD COLUMN IF NOT EXISTS umbral_vuelta_casa_km numeric NOT NULL DEFAULT 150
    CHECK (umbral_vuelta_casa_km > 0);

ALTER TABLE public.solicitud_aprobacion DROP CONSTRAINT IF EXISTS solicitud_aprobacion_tipo_check;
ALTER TABLE public.solicitud_aprobacion ADD CONSTRAINT solicitud_aprobacion_tipo_check
  CHECK (tipo IN ('ruta_nueva', 'viabilidad_baja', 'vuelta_a_casa'));
