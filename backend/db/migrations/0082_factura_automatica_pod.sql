-- ============================================================
-- Norenty — factura de venta automática al validar el POD (copiando lo que
-- Qargo hace bien: "AI checks ePOD-CMRs, and creates purchase invoices
-- automatically"). Hoy Norenty solo tenía un INFORME calculado al vuelo
-- (getDatosFacturacion en dashboard/lib/data.js) -- ningún registro persistente
-- con estado (borrador/enviada/pagada). Esta migración añade la tabla real y
-- el disparador que la rellena sola.
--
-- Regla de negocio (igual que F13.7: "si no te sellan no cobras"): la factura
-- borrador se crea SOLO cuando el POD queda `estado_validacion = 'valido'` Y
-- `sellado = true` -- si el cliente no selló, no se genera factura sola; el
-- gestor decide manualmente qué hacer con esa entrega (ver incidencia
-- `entrega_sin_sello` que ya se dispara en ese caso, 0077).
--
-- `viaje.precio` puede ser NULL (viaje sin cotizar) -- en ese caso no se genera
-- factura automática; el gestor la crea a mano cuando tenga el precio.
--
-- unique(viaje_id): un viaje solo genera una factura automática una vez,
-- aunque el trigger se dispare varias veces (ej. el chófer corrige la
-- respuesta del sello). ON CONFLICT DO NOTHING deja intacta cualquier factura
-- que el gestor ya haya editado a mano.
--
-- REVERSIÓN (convención 9.16):
--   DROP TRIGGER IF EXISTS trg_factura_automatica_pod ON public.pod;
--   DROP FUNCTION IF EXISTS public.crear_factura_automatica_pod();
--   DROP TABLE IF EXISTS public.factura;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.factura (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  viaje_id    uuid NOT NULL REFERENCES public.viaje(id) ON DELETE CASCADE,
  cliente_id  uuid REFERENCES public.cliente(id) ON DELETE SET NULL,
  importe     numeric NOT NULL CHECK (importe >= 0),
  estado      text NOT NULL DEFAULT 'borrador'
              CHECK (estado IN ('borrador', 'enviada', 'pagada')),
  origen      text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'automatica_pod')),
  creada_en   timestamptz NOT NULL DEFAULT now(),
  enviada_en  timestamptz,
  pagada_en   timestamptz,
  UNIQUE (viaje_id)
);
CREATE INDEX IF NOT EXISTS idx_factura_empresa ON public.factura (empresa_id);
CREATE INDEX IF NOT EXISTS idx_factura_estado ON public.factura (empresa_id, estado);

ALTER TABLE public.factura ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa gestiona sus facturas" ON public.factura FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());

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
BEGIN
  IF NEW.sellado IS TRUE AND NEW.estado_validacion = 'valido' THEN
    SELECT empresa_id, cliente_id, precio INTO v_empresa_id, v_cliente_id, v_precio
    FROM public.viaje WHERE id = NEW.viaje_id;

    IF v_precio IS NOT NULL THEN
      INSERT INTO public.factura (empresa_id, viaje_id, cliente_id, importe, origen)
      VALUES (v_empresa_id, NEW.viaje_id, v_cliente_id, v_precio, 'automatica_pod')
      ON CONFLICT (viaje_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_factura_automatica_pod
  AFTER INSERT OR UPDATE OF sellado, estado_validacion ON public.pod
  FOR EACH ROW
  EXECUTE FUNCTION public.crear_factura_automatica_pod();
