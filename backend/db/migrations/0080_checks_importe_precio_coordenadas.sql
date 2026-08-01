-- ============================================================
-- Norenty — CHECK constraints en campos de dinero y coordenadas.
--
-- Hallazgo de auditoría de validación de inputs (2026-08-01): `gasto_viaje.importe`
-- y `viaje.precio` no tenían ningún límite en base de datos -- solo `min="0"` en el
-- <input> del formulario, que es cosmético (una llamada directa a la API de
-- Supabase se lo salta sin problema). Un importe/precio negativo o absurdamente
-- alto se guardaba sin rechazo y descuadraba el P&L (getPnlViaje/getRentabilidadReal).
-- Igual con `hito.lat/lon` y `plantilla_hito.lat/lon`: se convertían con Number()
-- sin comprobar rango, así que un valor fuera de -90/90 o -180/180 se guardaba
-- igualmente y corrompía cálculos de distancia/ETA.
--
-- Estos CHECK son la única defensa que no se puede saltar desde el cliente ni
-- desde una llamada directa a la API -- validación en dashboard/lib/data.js sigue
-- siendo deseable como primera capa (mejor mensaje de error), pero la barrera
-- real vive aquí.
--
-- REVERSIÓN (convención 9.16):
--   ALTER TABLE public.gasto_viaje DROP CONSTRAINT IF EXISTS gasto_viaje_importe_no_negativo;
--   ALTER TABLE public.viaje DROP CONSTRAINT IF EXISTS viaje_precio_no_negativo;
--   ALTER TABLE public.hito DROP CONSTRAINT IF EXISTS hito_lat_rango;
--   ALTER TABLE public.hito DROP CONSTRAINT IF EXISTS hito_lon_rango;
--   ALTER TABLE public.plantilla_hito DROP CONSTRAINT IF EXISTS plantilla_hito_lat_rango;
--   ALTER TABLE public.plantilla_hito DROP CONSTRAINT IF EXISTS plantilla_hito_lon_rango;
-- ============================================================

ALTER TABLE public.gasto_viaje
  ADD CONSTRAINT gasto_viaje_importe_no_negativo CHECK (importe >= 0);

ALTER TABLE public.viaje
  ADD CONSTRAINT viaje_precio_no_negativo CHECK (precio IS NULL OR precio >= 0);

ALTER TABLE public.hito
  ADD CONSTRAINT hito_lat_rango CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  ADD CONSTRAINT hito_lon_rango CHECK (lon IS NULL OR lon BETWEEN -180 AND 180);

ALTER TABLE public.plantilla_hito
  ADD CONSTRAINT plantilla_hito_lat_rango CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  ADD CONSTRAINT plantilla_hito_lon_rango CHECK (lon IS NULL OR lon BETWEEN -180 AND 180);
