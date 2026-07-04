-- Repaso de advisors de Supabase (8.7). Hallazgos reales corregidos aquí;
-- el resto (SECURITY DEFINER de usar_invitacion/viaje_publico/current_empresa_id,
-- schema_migrations sin policy) ya estaba revisado como intencional en
-- revisiones previas — ver PROGRESS.md 2026-07-04.

-- 1. auth_rls_initplan (WARN, performance): `auth.role()`/`auth.uid()` sin
--    envolver en `(select ...)` se reevalúan una vez POR FILA en vez de una
--    vez por consulta. A la escala de hoy es irrelevante, pero es gratis de
--    arreglar y evita que crezca con el volumen.
DROP POLICY IF EXISTS empresa_insert_nueva ON public.empresa;
CREATE POLICY empresa_insert_nueva ON public.empresa
  FOR INSERT WITH CHECK ((select auth.role()) = 'authenticated');

DROP POLICY IF EXISTS gestor_insert_propio ON public.gestor;
CREATE POLICY gestor_insert_propio ON public.gestor
  FOR INSERT WITH CHECK (auth_user_id = (select auth.uid()));

-- 2. unindexed_foreign_keys (INFO, performance) en las tablas nuevas de
--    Fase 7A — mismo criterio que el ítem 6.5 (índices de FK faltantes).
CREATE INDEX IF NOT EXISTS idx_decision_asignacion_chofer_sugerido ON public.decision_asignacion (chofer_sugerido_id);
CREATE INDEX IF NOT EXISTS idx_decision_asignacion_chofer_elegido ON public.decision_asignacion (chofer_elegido_id);
CREATE INDEX IF NOT EXISTS idx_gasto_viaje_chofer ON public.gasto_viaje (chofer_id);
CREATE INDEX IF NOT EXISTS idx_gasto_viaje_vehiculo ON public.gasto_viaje (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_nota_gestor_gestor ON public.nota_gestor (gestor_id);
CREATE INDEX IF NOT EXISTS idx_nota_gestor_viaje ON public.nota_gestor (viaje_id);
