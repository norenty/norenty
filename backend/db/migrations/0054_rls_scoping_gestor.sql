-- ============================================================
-- F15.2 (Fase 15, scoping de datos por gestor, 2026-07-15) — el núcleo de
-- seguridad: un gestor NO-admin solo ve chóferes/viajes con su propio
-- gestor_id (o sin asignar todavía). admin sigue viendo TODO de la empresa
-- (current_gestor_rol() = 'admin').
--
-- Hereda automáticamente el scoping a las tablas que cuelgan de viaje_id
-- (hito, ejecucion_evento, pod, incidencia, valoracion) y de chofer_id
-- (ubicacion) -- sus políticas ya filtran por
-- "viaje_id IN (SELECT id FROM viaje WHERE ...)"/"chofer_id IN (SELECT id
-- FROM chofer WHERE ...)", así que basta con que esa subconsulta interna siga
-- devolviendo solo lo visible. NO se tocan esas seis políticas.
--
-- gestor_id IS NULL se trata como "visible para todos los gestores de la
-- empresa" a propósito: los 10 chóferes y todos los viajes existentes hoy no
-- tienen gestor_id asignado (F15.1 los dejó en NULL) -- si NULL implicara
-- "invisible", esta migración dejaría a TODOS los gestores no-admin sin ver
-- nada el día que se aplique. Un chófer/viaje sin asignar sigue siendo un
-- estado de negocio válido (aún no repartido), no un error.
-- ============================================================

DROP POLICY IF EXISTS empresa_scoped_chofer ON public.chofer;
CREATE POLICY empresa_scoped_chofer ON public.chofer
  FOR ALL
  USING (
    empresa_id = current_empresa_id()
    AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  )
  WITH CHECK (
    empresa_id = current_empresa_id()
    AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  );

DROP POLICY IF EXISTS empresa_scoped_viaje ON public.viaje;
CREATE POLICY empresa_scoped_viaje ON public.viaje
  FOR ALL
  USING (
    empresa_id = current_empresa_id()
    AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  )
  WITH CHECK (
    empresa_id = current_empresa_id()
    AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
  );

-- gasto_viaje, nota_gestor, decision_asignacion cuelgan de viaje_id/chofer_id
-- pero tienen su PROPIA política (no heredan de viaje/chofer como hito/pod/
-- etc.) -- hay que reescribirlas explícitamente con el mismo criterio.
DROP POLICY IF EXISTS "empresa gestiona sus gastos" ON public.gasto_viaje;
CREATE POLICY empresa_scoped_gasto_viaje ON public.gasto_viaje
  FOR ALL
  USING (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  )
  WITH CHECK (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "empresa gestiona sus notas" ON public.nota_gestor;
CREATE POLICY empresa_scoped_nota_gestor ON public.nota_gestor
  FOR ALL
  USING (empresa_id = current_empresa_id())
  WITH CHECK (empresa_id = current_empresa_id());
-- nota_gestor: NO se restringe por gestor_id -- es una bitácora compartida del
-- equipo (7A.10, "capturar contexto de primera mano"), cualquier gestor de la
-- empresa debe poder leer las notas de los demás. Solo se re-declara aquí
-- para dejar constancia explícita de que fue REVISADA y la decisión es "sin
-- cambio", no un olvido.

DROP POLICY IF EXISTS "empresa ve y crea sus decisiones" ON public.decision_asignacion;
CREATE POLICY empresa_scoped_decision_asignacion ON public.decision_asignacion
  FOR ALL
  USING (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  )
  WITH CHECK (
    viaje_id IN (
      SELECT id FROM viaje
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  );
