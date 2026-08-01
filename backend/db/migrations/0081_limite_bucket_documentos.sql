-- ============================================================
-- Norenty — límite de tamaño y tipo de archivo en el bucket "documentos".
--
-- Hallazgo de auditoría (2026-08-01): el bucket "documentos" (migración 0012)
-- se creó sin `file_size_limit` ni `allowed_mime_types` -- cualquier archivo,
-- de cualquier tamaño y tipo, podía subirse (licencia/CAP de chófer, ITV/seguro
-- de vehículo, foto de gasto). `DocumentosSection.jsx`/`GastosViajeSection.jsx`
-- no validan esto en el cliente, así que la única barrera real es esta.
--
-- 15 MB cubre de sobra un PDF escaneado o una foto de móvil; tipos limitados a
-- imagen y PDF, que es lo único que se sube en la práctica (documentos legales
-- y fotos de ticket/gasto).
--
-- REVERSIÓN (convención 9.16):
--   UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL WHERE id = 'documentos';
-- ============================================================

UPDATE storage.buckets
SET file_size_limit = 15728640,  -- 15 MB
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
WHERE id = 'documentos';
