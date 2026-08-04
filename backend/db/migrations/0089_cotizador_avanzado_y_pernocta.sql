-- ============================================================
-- Norenty — cotizador avanzado + captura de pernocta del chófer.
--
-- Pedido por el usuario (2026-08-02): el cotizador debe tener en cuenta
-- leasing del camión y desgaste (no solo combustible/conductor/peajes/dietas
-- que ya existían), saber si el vehículo es bitrén/megatráiler, si el viaje
-- lleva un segundo chófer (conducción en pareja/relevo), y capturar dónde ha
-- dormido el chófer y si el parking era seguro.
--
-- 1) empresa.coste_leasing_km / coste_desgaste_km: mismo patrón EXACTO que
--    coste_peaje_km/dieta_noche_eur (0023) -- capas opcionales del desglose,
--    "elige hasta dónde llega poblando datos". Reutiliza calcularCosteRuta,
--    guardarDesgloseCosteEmpresa (ya genérico, no necesita cambio) y
--    aplicarOverridesPresupuesto.
--
-- 2) vehiculo.es_bitren: atributo del VEHÍCULO (doble remolque/megatráiler),
--    no cambia el modelo de viaje -- confirmado con el usuario, distinto de
--    "dos chóferes" (ver 3).
--
-- 3) viaje.chofer2_id: segundo chófer opcional (conducción en pareja/relevo
--    largo recorrido). Solo el dato por ahora -- el ajuste de horas legales
--    para conducción en pareja (evita algunas paradas 561) es un ítem de
--    planificación aparte, no se improvisa aquí. ON DELETE SET NULL igual
--    que chofer_id.
--
-- 4) pernocta_chofer: dónde ha dormido el chófer y si estaba todo bien --
--    hueco real que no existía (el catálogo `parking` -- 0016 -- es solo un
--    directorio de sitios conocidos, nada registraba que un chófer CONCRETO
--    durmió en uno CONCRETO una noche concreta). `parking_id` nullable: el
--    chófer puede parar en un sitio que no está en el catálogo. `todo_ok`
--    es la pregunta simple del bot (Sí/No) -- si es No, dispara incidencia
--    real, mismo patrón que sello/checklist de salida (no se improvisa la
--    integración con el bot todavía, eso es el siguiente paso, esta
--    migración deja la tabla lista para ello).
--
-- GPS/tacógrafo (mencionado por el usuario, "tenemos listo para integrar"):
-- NO se toca aquí -- no hay spec ni columnas que añadir todavía, se deja
-- anotado en ROADMAP como decisión futura cuando haya un proveedor concreto.
--
-- NUMERACIÓN: originalmente creada como 0085, colisionaba con
-- 0085_tarifa_cliente.sql (trabajo en paralelo) -- renumerada a 0089 antes de
-- aplicarse en prod. El registro de dev en schema_migrations se corrigió a
-- mano (mismo checksum, nombre actualizado), no se reejecutó el SQL dos veces.
--
-- REVERSIÓN (convención 9.16):
--   ALTER TABLE public.empresa DROP COLUMN IF EXISTS coste_leasing_km;
--   ALTER TABLE public.empresa DROP COLUMN IF EXISTS coste_desgaste_km;
--   ALTER TABLE public.vehiculo DROP COLUMN IF EXISTS es_bitren;
--   ALTER TABLE public.viaje DROP COLUMN IF EXISTS chofer2_id;
--   DROP TABLE IF EXISTS public.pernocta_chofer;
-- ============================================================

ALTER TABLE public.empresa
  ADD COLUMN IF NOT EXISTS coste_leasing_km numeric,
  ADD COLUMN IF NOT EXISTS coste_desgaste_km numeric;

ALTER TABLE public.vehiculo
  ADD COLUMN IF NOT EXISTS es_bitren boolean NOT NULL DEFAULT false;

ALTER TABLE public.viaje
  ADD COLUMN IF NOT EXISTS chofer2_id uuid REFERENCES public.chofer(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.pernocta_chofer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  viaje_id    uuid REFERENCES public.viaje(id) ON DELETE SET NULL,
  chofer_id   uuid NOT NULL REFERENCES public.chofer(id) ON DELETE CASCADE,
  parking_id  uuid REFERENCES public.parking(id) ON DELETE SET NULL,
  lat         double precision,
  lon         double precision,
  todo_ok     boolean,
  comentario  text,
  ocurrido_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pernocta_chofer_empresa ON public.pernocta_chofer (empresa_id);
CREATE INDEX IF NOT EXISTS idx_pernocta_chofer_viaje ON public.pernocta_chofer (viaje_id);
CREATE INDEX IF NOT EXISTS idx_pernocta_chofer_chofer ON public.pernocta_chofer (chofer_id);

ALTER TABLE public.pernocta_chofer ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa gestiona sus pernoctas" ON public.pernocta_chofer FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());
