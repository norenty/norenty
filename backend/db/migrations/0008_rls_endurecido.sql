-- ============================================================
-- Norenty — Endurecer RLS: de "dev_all" (USING true) a authenticated-only
-- Aplicado directamente vía Supabase MCP el 2026-06-30.
-- El bot usa SUPABASE_SERVICE_ROLE_KEY (bypasa RLS), así que esto
-- no le afecta. El dashboard exige sesión (AuthGuard), así que
-- "authenticated" cubre todo el uso legítimo.
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chofer','ejecucion_evento','empresa','gestor','hito','incidencia',
                            'plantilla_hito','plantilla_ruta','pod','ubicacion','valoracion','vehiculo','viaje']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS dev_all_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY auth_only_%I ON public.%I FOR ALL USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')',
      t, t
    );
  END LOOP;
END $$;

-- Bucket "pods": quitar listado público amplio, dejar solo lectura autenticada
-- (la URL pública de un objeto concreto sigue funcionando vía el flag "public" del bucket)
DROP POLICY IF EXISTS dev_all_storage_objects ON storage.objects;

CREATE POLICY "authenticated_select_pods" ON storage.objects
  FOR SELECT USING (bucket_id = 'pods' AND auth.role() = 'authenticated');

CREATE POLICY "service_role_write_pods" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'pods' AND auth.role() = 'service_role');

CREATE POLICY "service_role_update_pods" ON storage.objects
  FOR UPDATE USING (bucket_id = 'pods' AND auth.role() = 'service_role');

CREATE POLICY "service_role_delete_pods" ON storage.objects
  FOR DELETE USING (bucket_id = 'pods' AND auth.role() = 'service_role');

-- Función SECURITY DEFINER expuesta sin necesidad: revocar ejecución pública
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- Índices de claves foráneas que faltaban (rendimiento)
CREATE INDEX IF NOT EXISTS idx_evento_chofer ON ejecucion_evento(chofer_id);
CREATE INDEX IF NOT EXISTS idx_evento_hito ON ejecucion_evento(hito_id);
CREATE INDEX IF NOT EXISTS idx_incidencia_hito ON incidencia(hito_id);
CREATE INDEX IF NOT EXISTS idx_valoracion_gestor ON valoracion(gestor_id);
CREATE INDEX IF NOT EXISTS idx_viaje_gestor ON viaje(gestor_id);
