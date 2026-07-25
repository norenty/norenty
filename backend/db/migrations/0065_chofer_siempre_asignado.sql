-- ============================================================
-- Norenty C.1/C.2 — "nunca debería haber un chófer sin asignar a un gestor".
--
-- Decisión del usuario (2026-07-25, respuesta a C.1): el modelo de cobertura
-- de vacaciones/bajas NO es "scoping blando" ni "por equipo" -- es que el
-- jefe de tráfico redistribuye manualmente los chóferes de quien se va entre
-- el resto de gestores (ya construido: reasignación en bloque de
-- AjustesEquipoSection, ítem 17.G.3). Lo que SÍ cambia: un chófer nunca
-- debería quedar en el estado "Sin asignar" (gestor_id IS NULL) -- ese pool
-- era el diseño original de F15.1/F15.2, pero el usuario lo descarta
-- explícitamente ("creo que nunca debería haber un chofer sin asignar un
-- gestor").
--
-- Este backfill NO añade una constraint NOT NULL a propósito (más difícil de
-- revertir, y gestor_id sigue con ON DELETE SET NULL por si algún día hay
-- borrado real de un gestor en vez de desactivación) -- la garantía pasa a
-- ser de aplicación: createChofer() ya no usa gestorIdPorDefecto() (que
-- devuelve NULL para admin), sino gestorIdComoAutor() (siempre el gestor
-- actual, nunca NULL); y la UI de reasignación (AjustesEquipoSection) deja
-- de ofrecer "Sin asignar" como opción.
--
-- Backfill: los choferes YA existentes sin gestor pasan al primer admin
-- activo de su empresa (verificado: las 3 empresas de la BD de dev tienen al
-- menos 1 admin activo). El admin ya los veía todos igualmente (RLS trata
-- admin como "ve todo"); esto solo hace explícito quién es responsable, para
-- que el jefe de tráfico pueda redistribuirlos desde Ajustes → Equipo si
-- quiere repartirlos entre varios gestores operativos.
--
-- REVERSIÓN (convención 9.16): no hay DDL que revertir (solo backfill de
-- datos); para deshacer el backfill habría que restaurar desde snapshot, no
-- hay forma limpia de "volver a NULL" sin perder qué filas se tocaron.
-- ============================================================

UPDATE public.chofer c
SET gestor_id = (
  SELECT g.id FROM public.gestor g
  WHERE g.empresa_id = c.empresa_id AND g.rol = 'admin' AND g.activo = true
  ORDER BY g.id
  LIMIT 1
)
WHERE c.gestor_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.gestor g
    WHERE g.empresa_id = c.empresa_id AND g.rol = 'admin' AND g.activo = true
  );
