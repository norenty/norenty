-- ============================================================
-- Norenty — Captura de deriva de esquema real (auditoria de seguridad 2026-07-05).
--
-- vehiculo, plantilla_ruta, plantilla_hito y ubicacion se crearon en
-- 0003_vehiculos_plantillas_ubicacion.sql SIN "ENABLE ROW LEVEL SECURITY".
-- Las policies de estas tablas se anadieron despues (0008/0009) asumiendo
-- que RLS ya estaba activo, y en la BD real efectivamente lo esta -- pero
-- porque alguien ejecuto el ALTER TABLE a mano (via MCP/SQL editor) en algun
-- momento, nunca capturado en una migracion. Si el esquema se reconstruyera
-- HOY solo desde backend/db/migrations/*.sql (proyecto nuevo, ítem 9.1;
-- disaster recovery), estas 4 tablas -- incluida ubicacion, el dato de
-- geolocalizacion en tiempo real del chofer -- tendrian policies definidas
-- pero RLS DESACTIVADO, es decir: PostgREST devolveria TODAS las filas de
-- TODAS las empresas a cualquier usuario autenticado. Fix: capturar el
-- ENABLE que ya esta vigente en produccion, para que los archivos sean
-- fieles a la realidad. Idempotente (ENABLE sobre una tabla que ya lo tiene
-- activo no falla ni cambia nada).
-- ============================================================

ALTER TABLE public.vehiculo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantilla_ruta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantilla_hito ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ubicacion ENABLE ROW LEVEL SECURITY;
