-- ============================================================
-- Hardening (2026-07-12, hallazgo del linter de rendimiento de Supabase):
-- `auth_rls_initplan` — la policy `gestor_update_admin` (0032) llama a
-- `auth.uid()` directamente, lo que Postgres reevalúa FILA POR FILA en vez de
-- una sola vez por consulta. Envolverlo en `(select auth.uid())` deja que el
-- planner lo trate como una subconsulta InitPlan (se evalúa una vez, se
-- cachea) — mismo resultado, mejor rendimiento a escala. No cambia ninguna
-- semántica de seguridad, solo el plan de ejecución.
-- ============================================================

DROP POLICY IF EXISTS gestor_update_admin ON public.gestor;
CREATE POLICY gestor_update_admin ON public.gestor
  FOR UPDATE
  USING (
    empresa_id = current_empresa_id()
    AND current_gestor_rol() = 'admin'
    AND auth_user_id IS DISTINCT FROM (select auth.uid())   -- no editar tu propia fila
  )
  WITH CHECK (
    empresa_id = current_empresa_id()
    AND current_gestor_rol() = 'admin'
    AND auth_user_id IS DISTINCT FROM (select auth.uid())
  );
