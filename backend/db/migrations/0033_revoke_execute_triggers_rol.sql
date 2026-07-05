-- Repaso de advisors tras 0032 (roles): dos funciones de trigger quedaron
-- ejecutables directamente por RPC (/rest/v1/rpc/...) desde anon/authenticated.
-- Son funciones pensadas SOLO para uso interno como BEFORE UPDATE/INSERT
-- (dependen de NEW/OLD/TG_OP, contexto que no existe si se llaman sueltas por
-- REST), pero al ser SECURITY DEFINER el linter de seguridad de Supabase las
-- marca correctamente como superficie expuesta de más — mismo criterio que
-- el repaso de advisors del ítem 8.7/0029: cerrar lo que no deba ser público.
-- OJO: Postgres concede EXECUTE a PUBLIC por defecto en toda función nueva;
-- anon/authenticated heredan de PUBLIC, así que revocar solo de esos dos roles
-- NO bastaba (verificado con has_function_privilege antes/después de aplicar
-- esto en la BD real — el primer intento sin incluir PUBLIC no tuvo efecto).
REVOKE EXECUTE ON FUNCTION public.rol_bloquea_columnas_sensibles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.solo_lectura_bloquea_escritura() FROM PUBLIC, anon, authenticated;
-- Revocar EXECUTE no afecta a que estas funciones sigan disparándose como
-- BEFORE UPDATE/INSERT triggers (eso no pasa por un chequeo de privilegio de
-- invocación directa del rol conectado), solo bloquea la llamada RPC directa.
