-- ============================================================
-- Fix crítico de seguridad (auditoría 2026-08-04): valoracion tenía
-- "dev_all_valoracion" USING (true) desde 0002_valoracion_y_pod.sql, nunca
-- corregida. 0054_rls_scoping_gestor.sql da por hecho en su comentario que
-- valoracion "hereda scoping" de viaje_id igual que hito/pod/ejecucion_evento,
-- pero eso solo es cierto para políticas que YA filtraban por viaje_id — a
-- valoracion nunca se le creó esa policy filtrada, así que en realidad seguía
-- abierta a "true" para cualquier gestor autenticado de CUALQUIER empresa vía
-- PostgREST. Mismo patrón que gasto_viaje/decision_asignacion (0054):
-- viaje_id puede ser NULL (valoración general del chofer, no atada a un
-- viaje concreto -- ver comentario en 0002), así que el filtro se hace por
-- chofer_id, no por viaje_id.
--
-- Además: 0009_tenancy_multiempresa.sql (bloque DO $$ .. FOREACH sobre
-- ['hito','ejecucion_evento','pod','incidencia','valoracion']) YA había creado
-- una policy "empresa_scoped_valoracion" filtrando por viaje_id -- pero como
-- RLS combina políticas PERMISIVAS con OR, coexistía con "dev_all_valoracion"
-- (true) sin anularla: el hueco seguía abierto igual. Esa versión de 0009
-- tiene además un bug propio: excluye para TODOS las valoraciones generales
-- del chofer (viaje_id IS NULL -- ver 0002 líneas 9-13), porque "IN (NULL)"
-- nunca es true. Se sustituye por una única policy sobre chofer_id, que cubre
-- ambos casos y hereda el scoping por gestor vía la RLS ya activa en `chofer`
-- (0054), igual que hace `ubicacion` desde 0009.
--
-- REVERSIÓN: DROP POLICY empresa_scoped_valoracion ON public.valoracion;
--            CREATE POLICY "dev_all_valoracion" ON valoracion FOR ALL USING (true) WITH CHECK (true);
--            CREATE POLICY empresa_scoped_valoracion ON public.valoracion FOR ALL
--              USING (viaje_id IN (SELECT id FROM viaje WHERE empresa_id = current_empresa_id()))
--              WITH CHECK (viaje_id IN (SELECT id FROM viaje WHERE empresa_id = current_empresa_id()));
-- ============================================================

DROP POLICY IF EXISTS "dev_all_valoracion" ON public.valoracion;
DROP POLICY IF EXISTS empresa_scoped_valoracion ON public.valoracion;

CREATE POLICY empresa_scoped_valoracion ON public.valoracion
  FOR ALL
  USING (
    chofer_id IN (
      SELECT id FROM chofer
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  )
  WITH CHECK (
    chofer_id IN (
      SELECT id FROM chofer
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  );
