-- ============================================================
-- Norenty — FIX: audit_log debe ser APPEND-ONLY, no lo era.
--
-- Hallado en auditoria de seguridad 2026-07-05: audit_log (0030) tenia una
-- unica policy "FOR ALL" scoped solo por empresa_id, sin restriccion de
-- operacion ni de rol. Efecto real: (a) CUALQUIER gestor -- incluido
-- solo_lectura -- podia hacer UPDATE/DELETE de filas de auditoria de su
-- empresa por REST directo, contradiciendo el proposito mismo de la tabla
-- ("trazabilidad total... en un producto de assurance no es opcional", 8.8);
-- (b) solo_lectura tampoco estaba en el array de tablas de
-- solo_lectura_bloquea_escritura (0032), asi que ni siquiera esa capa lo
-- frenaba.
--
-- Fix: reemplazar la policy FOR ALL por SELECT + INSERT unicamente (ambas
-- scoped por empresa) -- sin ninguna policy de UPDATE/DELETE, esas
-- operaciones quedan denegadas por RLS por defecto, igual que
-- ejecucion_evento/ubicacion desde 0019. Anadir audit_log al trigger de
-- solo_lectura como defensa en profundidad adicional sobre el INSERT.
-- ============================================================

DROP POLICY IF EXISTS "empresa ve y crea su audit log" ON public.audit_log;

CREATE POLICY "empresa ve su audit log" ON public.audit_log
  FOR SELECT USING (empresa_id = current_empresa_id());

CREATE POLICY "empresa inserta en su audit log" ON public.audit_log
  FOR INSERT WITH CHECK (empresa_id = current_empresa_id());

-- Sin policy de UPDATE ni DELETE: RLS deniega esas operaciones por defecto
-- para `authenticated`. Append-only real, no solo por convencion de la app.

DROP TRIGGER IF EXISTS trg_solo_lectura_audit_log ON public.audit_log;
CREATE TRIGGER trg_solo_lectura_audit_log BEFORE INSERT OR UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.solo_lectura_bloquea_escritura();
