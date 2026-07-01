-- Registro documental: viaje (CMR/albarán/ADR), vehículo (ITV/seguro/autorización),
-- chófer (licencia/CAP). Tabla única multi-ámbito, bucket privado propio "documentos"
-- con el mismo patrón de RLS por carpeta que el bucket "pods" (migración 0011).

CREATE TABLE IF NOT EXISTS documento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  ambito          text NOT NULL CHECK (ambito IN ('viaje', 'vehiculo', 'chofer')),
  entidad_id      uuid NOT NULL,
  tipo            text NOT NULL,
  fecha_emision   date,
  fecha_caducidad date,
  archivo_url     text,
  estado          text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'caducado', 'pendiente')),
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documento_entidad ON documento (ambito, entidad_id);

ALTER TABLE documento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "empresa ve sus documentos"
  ON documento FOR ALL
  USING (empresa_id = current_empresa_id())
  WITH CHECK (empresa_id = current_empresa_id());

-- Bucket privado "documentos". Ruta de objetos: {empresa_id}/{ambito}/{entidad_id}/{uuid}.{ext}
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "empresa ve sus archivos de documentos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos'
    AND (storage.foldername(name))[1] = current_empresa_id()::text
  );

CREATE POLICY "empresa sube sus archivos de documentos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos'
    AND (storage.foldername(name))[1] = current_empresa_id()::text
  );

CREATE POLICY "empresa borra sus archivos de documentos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND (storage.foldername(name))[1] = current_empresa_id()::text
  );
