-- ============================================================
-- Norenty — Endurecimiento: control de columnas modificables por el rol
-- `authenticated` (el que usa el dashboard con el JWT del gestor).
--
-- Motivo: hasta ahora el RLS de este proyecto es solo de FILA (RLS
-- USING/WITH CHECK por empresa_id). Postgres/PostgREST NO restringe qué
-- COLUMNAS puede tocar un UPDATE dentro de esa fila — cualquier gestor
-- autenticado de una empresa podía, con una llamada directa a la API REST
-- (bypaseando la UI, p.ej. desde las devtools del navegador), actualizar
-- CUALQUIER columna de las filas de su propia empresa. Encontramos 3 casos
-- con impacto real de seguridad/integridad:
--
--   1. gestor.auth_user_id — un gestor podría reasignar el auth_user_id de
--      OTRO gestor de su misma empresa (o poner el suyo propio), lo que
--      equivale a un secuestro de identidad dentro de la empresa. Esta
--      columna solo debe fijarse una vez, en el alta (INSERT de signUp).
--   2. chofer.chat_id — el vínculo Telegram del chófer lo escribe SOLO el
--      bot (con la service role key, que salta RLS) cuando el chófer pulsa
--      su enlace único de invitación. Si el dashboard pudiera tocarlo, un
--      gestor podría enlazar el chat_id de OTRO chófer (o el suyo propio)
--      a un chófer distinto, desviando avisos de ruta a un chat equivocado.
--   3. ejecucion_evento y ubicacion — son el registro de auditoría/evidencia
--      del sistema (hora real de llegada, posición GPS). Los escribe SOLO
--      el bot. Si el dashboard pudiera hacer UPDATE/DELETE, un gestor podría
--      reescribir la hora de una llegada para "arreglar" una incidencia de
--      puntualidad o inflar una nómina — exactamente lo que este producto
--      existe para evitar. El dashboard hoy solo LEE estas dos tablas
--      (verificado: ningún .insert/.update/.delete en el código del
--      dashboard sobre ellas) — se revoca todo menos SELECT.
--
-- El resto de columnas de estas tablas siguen abiertas a `authenticated`
-- porque son ediciones legítimas desde el dashboard (nombre, idioma, precio
-- del viaje, estado, notas...). RLS de fila sigue aplicando igual, esto es
-- una capa adicional (defensa en profundidad), no un sustituto.
-- ============================================================

-- 1. gestor.auth_user_id: inmutable desde el dashboard. Solo se fija en el
--    INSERT del alta (signUp) — ahí sí hace falta poder escribirla una vez.
ALTER TABLE public.gestor
  ALTER COLUMN auth_user_id DROP NOT NULL; -- (ya era nullable; no-op de seguridad, deja explícito el estado)

REVOKE UPDATE ON public.gestor FROM authenticated;
GRANT UPDATE (nombre, email, notif_incidencias, notif_entregas, notif_fuera_ventana, telegram_chat_id)
  ON public.gestor TO authenticated;
-- auth_user_id y empresa_id quedan fuera de la lista: ni UPDATE los toca.
-- El INSERT (alta) no se ve afectado — los privilegios de columna solo
-- restringen UPDATE, no INSERT.

-- 2. chofer.chat_id: inmutable desde el dashboard, solo lo escribe el bot
--    (service role, que ignora estos GRANT/REVOKE de todos modos).
REVOKE UPDATE ON public.chofer FROM authenticated;
GRANT UPDATE (nombre, idioma, telefono)
  ON public.chofer TO authenticated;
-- chat_id, empresa_id, id quedan fuera.

-- 3. ejecucion_evento y ubicacion: el dashboard es solo lector.
REVOKE INSERT, UPDATE, DELETE ON public.ejecucion_evento FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ubicacion FROM authenticated;
-- SELECT se mantiene (ya concedido por defecto vía RLS); estas dos líneas
-- solo quitan la capacidad de escritura que nunca debió estar ahí.
