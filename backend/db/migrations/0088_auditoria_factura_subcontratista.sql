-- ============================================================
-- Norenty — auditoría de factura de subcontratista (Fase 27.4, informe TMS
-- tradicionales 2026-08-02: "Freight Audit and Payment" -- comparar lo que
-- factura el subcontratista contra lo pactado -- es el mismo patrón que ya
-- usáis con el POD del cliente ("si no te sellan, no cobras") mirando hacia
-- el otro lado: aquí es "si te cobra de más, que alguien lo vea".
--
-- Añade 'subcontratacion' como tipo de gasto_viaje -- lo que el
-- subcontratista FACTURA por ese viaje (coste real pagado a un tercero, no
-- un cargo al cliente -- por eso vive en gasto_viaje, no en factura).
--
-- REVERSIÓN (convención 9.16):
--   ALTER TABLE public.gasto_viaje DROP CONSTRAINT IF EXISTS gasto_viaje_tipo_check;
--   ALTER TABLE public.gasto_viaje ADD CONSTRAINT gasto_viaje_tipo_check
--     CHECK (tipo IN ('repostaje','peaje','multa','dieta','otro'));
-- ============================================================

ALTER TABLE public.gasto_viaje DROP CONSTRAINT IF EXISTS gasto_viaje_tipo_check;
ALTER TABLE public.gasto_viaje ADD CONSTRAINT gasto_viaje_tipo_check
  CHECK (tipo IN ('repostaje','peaje','multa','dieta','subcontratacion','otro'));
