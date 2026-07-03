-- La card de P&L real (7A.8) en /viajes/[id] necesita refrescarse cuando se
-- añade/borra un gasto (7A.7) sin recargar la página entera — igual que ya
-- pasa con viaje/hito/ejecucion_evento/incidencia (0004_realtime.sql).
ALTER PUBLICATION supabase_realtime ADD TABLE gasto_viaje;
