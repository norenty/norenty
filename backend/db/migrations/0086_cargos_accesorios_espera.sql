-- ============================================================
-- Norenty — cargos accesorios por espera/paralización (Fase 27.2, informe TMS
-- tradicionales 2026-08-02: SAP TM/OTM facturan "accessorial charges" -- horas
-- de espera del camión en el muelle -- y Norenty ya tenía el dato (eventos
-- 'llegada'/'salida' de cada hito) sin convertirlo nunca en dinero.
--
-- Diseño: se calcula UNA VEZ, en el mismo trigger que ya crea la factura
-- automática al validar el POD (0082) -- no un trigger nuevo sobre 'salida',
-- porque el momento fiable de "ya sé cuánto esperó" es cuando el viaje se da
-- por bueno (POD sellado), no antes. Reutiliza el mismo punto único de verdad
-- en vez de coordinar dos triggers escribiendo la misma fila.
--
-- `importe_accesorios` vive APARTE de `importe` (que sigue siendo el precio
-- de venta del viaje) -- un informe que quiera el total factura importe +
-- importe_accesorios, no se sustituye el campo ya usado en 23.C/Qargo.
--
-- Configuración por empresa (mismo patrón que umbral_vuelta_casa_km):
--   tarifa_hora_espera_eur: NULL = función desactivada (no se cobra nada,
--     retrocompatible con empresas que no la configuren).
--   franquicia_espera_horas: horas gratis antes de empezar a cobrar, default 1h.
--
-- REVERSIÓN (convención 9.16):
--   ALTER TABLE public.factura DROP COLUMN IF EXISTS importe_accesorios;
--   ALTER TABLE public.empresa DROP COLUMN IF EXISTS tarifa_hora_espera_eur;
--   ALTER TABLE public.empresa DROP COLUMN IF EXISTS franquicia_espera_horas;
--   -- restaurar crear_factura_automatica_pod() a la versión de 0082.
-- ============================================================

ALTER TABLE public.factura
  ADD COLUMN IF NOT EXISTS importe_accesorios numeric NOT NULL DEFAULT 0 CHECK (importe_accesorios >= 0);

ALTER TABLE public.empresa
  ADD COLUMN IF NOT EXISTS tarifa_hora_espera_eur numeric CHECK (tarifa_hora_espera_eur IS NULL OR tarifa_hora_espera_eur >= 0),
  ADD COLUMN IF NOT EXISTS franquicia_espera_horas numeric NOT NULL DEFAULT 1 CHECK (franquicia_espera_horas >= 0);

CREATE OR REPLACE FUNCTION public.crear_factura_automatica_pod()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
  v_cliente_id uuid;
  v_precio numeric;
  v_tarifa_espera numeric;
  v_franquicia numeric;
  v_horas_espera numeric;
BEGIN
  IF NEW.sellado IS TRUE AND NEW.estado_validacion = 'valido' THEN
    SELECT empresa_id, cliente_id, precio INTO v_empresa_id, v_cliente_id, v_precio
    FROM public.viaje WHERE id = NEW.viaje_id;

    IF v_precio IS NOT NULL THEN
      SELECT tarifa_hora_espera_eur, franquicia_espera_horas INTO v_tarifa_espera, v_franquicia
      FROM public.empresa WHERE id = v_empresa_id;

      v_horas_espera := 0;
      IF v_tarifa_espera IS NOT NULL THEN
        -- Suma, por cada hito del viaje, las horas entre 'llegada' y 'salida'
        -- que superan la franquicia. Un hito sin ambos eventos aporta 0 (no
        -- se inventa una espera que no se pudo medir).
        SELECT COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (s.ocurrido_en - l.ocurrido_en)) / 3600.0 - v_franquicia)), 0)
        INTO v_horas_espera
        FROM public.hito h
        JOIN LATERAL (
          SELECT ocurrido_en FROM public.ejecucion_evento
          WHERE hito_id = h.id AND tipo = 'llegada' ORDER BY ocurrido_en ASC LIMIT 1
        ) l ON true
        JOIN LATERAL (
          SELECT ocurrido_en FROM public.ejecucion_evento
          WHERE hito_id = h.id AND tipo = 'salida' ORDER BY ocurrido_en DESC LIMIT 1
        ) s ON true
        WHERE h.viaje_id = NEW.viaje_id AND s.ocurrido_en > l.ocurrido_en;
      END IF;

      INSERT INTO public.factura (empresa_id, viaje_id, cliente_id, importe, importe_accesorios, origen)
      VALUES (v_empresa_id, NEW.viaje_id, v_cliente_id, v_precio, ROUND(v_horas_espera * COALESCE(v_tarifa_espera, 0), 2), 'automatica_pod')
      ON CONFLICT (viaje_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
