-- ============================================================
-- Auditoría 2026-08-04 (hallazgos #7 y #8, bajo): dos índices que faltaban
-- para consultas ya existentes -- no crítico al volumen actual, pero barato
-- de añadir ahora que se han identificado.
--
-- REVERSIÓN: DROP INDEX IF EXISTS idx_viaje_empresa_created;
--            DROP INDEX IF EXISTS idx_hito_ventana_fin;
-- ============================================================

-- getViajesLista (dashboard/lib/data.js) filtra por empresa_id y ordena por
-- created_at desc en el listado principal de /viajes.
CREATE INDEX IF NOT EXISTS idx_viaje_empresa_created ON viaje(empresa_id, created_at DESC);

-- Filtros de "viajes en riesgo"/hitos por ventana (dashboard/lib/data.js
-- getMetricasPorCliente y otras) filtran hito por ventana_fin.
CREATE INDEX IF NOT EXISTS idx_hito_ventana_fin ON hito(ventana_fin);
