-- Bucket POD privado + RLS empresa-scoped en storage.objects
-- Antes: bucket public=true, URLs públicas sin RLS.
-- Ahora: bucket private, solo el gestor de la empresa propietaria puede leer sus pods.
-- El bot sigue usando SERVICE_ROLE para subir (no le afecta la policy de SELECT).
-- El dashboard usa createSignedUrl() con la sesión del gestor (TTL 1h).

UPDATE storage.buckets SET public = false WHERE id = 'pods';

-- Ruta de objetos: {empresa_id}/{viaje_id}/{hito_id}/{uuid}.jpg
-- El primer segmento de carpeta es empresa_id -> permite policy empresa-scoped.
CREATE POLICY "empresa ve sus pods"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'pods'
    AND (storage.foldername(name))[1] = current_empresa_id()::text
  );
