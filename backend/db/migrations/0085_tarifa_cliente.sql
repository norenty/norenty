-- ============================================================
-- Norenty — tarifas pactadas por cliente (Fase 27, informe competitivo de los
-- TMS tradicionales 2026-08-02: SAP TM / Oracle OTM tienen "Contract and Rate
-- Management" como pieza central y Norenty no tenía NADA -- el precio de cada
-- viaje se teclea a mano, sin contrato contra el que contrastarlo).
--
-- Deliberadamente SIMPLE (ponytail/YAGNI): tarifa por CLIENTE, no por ruta
-- origen-destino. Una tarifa por lane exige emparejar direcciones de texto
-- libre, que es frágil y no aporta hasta que un cliente real lo pida. Dos
-- modos, que cubren cómo se cotiza de verdad en carretera nacional:
--   'fijo'   -> precio cerrado por viaje para ese cliente
--   'por_km' -> €/km pactado, se multiplica por los km estimados del viaje
--
-- UNIQUE (cliente_id): una tarifa vigente por cliente. Sin historial de
-- versiones a propósito -- cuando alguien necesite "qué tarifa regía en marzo"
-- se añade una tabla de histórico, no antes.
--
-- REVERSIÓN (convención 9.16):
--   DROP TABLE IF EXISTS public.tarifa_cliente;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tarifa_cliente (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  cliente_id  uuid NOT NULL REFERENCES public.cliente(id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('fijo', 'por_km')),
  valor       numeric NOT NULL CHECK (valor >= 0),
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cliente_id)
);

CREATE INDEX IF NOT EXISTS idx_tarifa_cliente_empresa ON public.tarifa_cliente (empresa_id);

ALTER TABLE public.tarifa_cliente ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresa gestiona sus tarifas" ON public.tarifa_cliente FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());
