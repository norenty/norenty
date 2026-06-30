-- ============================================================
-- Norenty — Fase 1: tenancy multi-empresa real
-- Aplicado directamente vía Supabase MCP el 2026-06-30.
-- Sustituye el RLS "authenticated-only" (0008) por aislamiento
-- real por empresa: cada gestor solo ve/escribe datos de su empresa.
-- ============================================================

-- Función auxiliar: empresa del gestor logueado. SECURITY DEFINER para no
-- disparar recursión de RLS al consultar 'gestor' desde dentro de otra policy.
CREATE OR REPLACE FUNCTION public.current_empresa_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT empresa_id FROM gestor WHERE auth_user_id = auth.uid() LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.current_empresa_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_empresa_id() TO authenticated;
-- Nota: "authenticated" debe poder ejecutarla porque las políticas RLS la
-- invocan en cada query. El advisor de Supabase marca esto como WARN
-- (SECURITY DEFINER ejecutable por authenticated) — es intencional y
-- aceptado: la función solo devuelve la empresa del propio usuario.

-- chofer, viaje, vehiculo, plantilla_ruta: empresa_id directo
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chofer','viaje','vehiculo','plantilla_ruta']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_only_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY empresa_scoped_%I ON public.%I FOR ALL USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id())',
      t, t
    );
  END LOOP;
END $$;

-- Tablas que cuelgan de viaje_id
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hito','ejecucion_evento','pod','incidencia','valoracion']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_only_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY empresa_scoped_%I ON public.%I FOR ALL USING (viaje_id IN (SELECT id FROM viaje WHERE empresa_id = current_empresa_id())) WITH CHECK (viaje_id IN (SELECT id FROM viaje WHERE empresa_id = current_empresa_id()))',
      t, t
    );
  END LOOP;
END $$;

-- ubicacion cuelga de chofer_id
DROP POLICY IF EXISTS auth_only_ubicacion ON public.ubicacion;
CREATE POLICY empresa_scoped_ubicacion ON public.ubicacion FOR ALL
  USING (chofer_id IN (SELECT id FROM chofer WHERE empresa_id = current_empresa_id()))
  WITH CHECK (chofer_id IN (SELECT id FROM chofer WHERE empresa_id = current_empresa_id()));

-- plantilla_hito cuelga de plantilla_ruta_id
DROP POLICY IF EXISTS auth_only_plantilla_hito ON public.plantilla_hito;
CREATE POLICY empresa_scoped_plantilla_hito ON public.plantilla_hito FOR ALL
  USING (plantilla_ruta_id IN (SELECT id FROM plantilla_ruta WHERE empresa_id = current_empresa_id()))
  WITH CHECK (plantilla_ruta_id IN (SELECT id FROM plantilla_ruta WHERE empresa_id = current_empresa_id()));

-- empresa: cualquier autenticado puede CREAR una empresa nueva (alta de cliente SaaS).
-- Pero solo puede ver/editar/borrar la suya.
DROP POLICY IF EXISTS auth_only_empresa ON public.empresa;

CREATE POLICY empresa_insert_nueva ON public.empresa
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY empresa_select_propia ON public.empresa
  FOR SELECT USING (id = current_empresa_id());

CREATE POLICY empresa_update_propia ON public.empresa
  FOR UPDATE USING (id = current_empresa_id()) WITH CHECK (id = current_empresa_id());

CREATE POLICY empresa_delete_propia ON public.empresa
  FOR DELETE USING (id = current_empresa_id());

-- gestor: solo puede crear su PROPIO registro (auth_user_id = el suyo).
-- Ver/editar/borrar solo gestores de su misma empresa.
DROP POLICY IF EXISTS auth_only_gestor ON public.gestor;

CREATE POLICY gestor_insert_propio ON public.gestor
  FOR INSERT WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY gestor_select_empresa ON public.gestor
  FOR SELECT USING (empresa_id = current_empresa_id());

CREATE POLICY gestor_update_empresa ON public.gestor
  FOR UPDATE USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());

CREATE POLICY gestor_delete_empresa ON public.gestor
  FOR DELETE USING (empresa_id = current_empresa_id());

-- ============================================================
-- PENDIENTE / conocido: el bucket de Storage "pods" sirve fotos vía URL
-- pública (flag "public" del bucket), lo que evita por completo RLS de
-- storage.objects para el GET directo de una URL conocida. Esto significa
-- que aunque las políticas de objects estén bien, alguien con la URL exacta
-- de la foto de OTRA empresa podría verla igualmente. Solución correcta:
-- bucket privado + URLs firmadas con expiración. No resuelto en esta
-- migración — anotado en ROADMAP.md / PROGRESS.md para Fase 3.
-- ============================================================
