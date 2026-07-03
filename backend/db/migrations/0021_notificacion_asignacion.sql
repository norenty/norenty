-- Notificación de asignación al chófer (7A.3). Reemplaza el diseño original
-- "Uber-style" (oferta con aceptar/rechazar) descartado a petición del usuario:
-- la decisión de a quién asignar es del gestor, el chófer solo se entera de su
-- ruta, sin fricción ni elección para él.
ALTER TABLE viaje ADD COLUMN IF NOT EXISTS notificado_asignacion_en timestamptz;
