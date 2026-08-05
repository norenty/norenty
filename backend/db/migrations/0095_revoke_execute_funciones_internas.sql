-- ============================================================
-- Fix de seguridad (Supabase Security Advisor, 2026-08-05, 17 warnings):
-- Postgres concede EXECUTE a PUBLIC por defecto al crear una función, salvo
-- que se revoque explícitamente -- 0009/0032 ya establecieron el patrón
-- correcto para current_empresa_id() etc., pero 5 funciones SECURITY DEFINER
-- más nunca tuvieron su REVOKE explícito, así que se quedaron con el default
-- abierto a anon (API pública sin login) y authenticated.
--
-- Cuatro son funciones de TRIGGER (RETURNS trigger) -- Postgres las invoca
-- internamente al disparar el trigger sobre la tabla; el rol que ejecuta el
-- INSERT/UPDATE no necesita EXECUTE directo sobre la función para que el
-- trigger se dispare. Revocarles EXECUTE por completo (ni anon ni
-- authenticated) no rompe nada y cierra la vía de que alguien las invoque
-- directamente vía RPC:
--   - crear_factura_automatica_pod() (0082/0086)
--   - gestor_id_solo_admin() (0055)
--   - rol_comercial_restringido() (0063/0075)
--   - sync_roles_desde_rol() (0075)
--
-- usar_invitacion(uuid) SÍ se llama por RPC desde el cliente (dashboard/
-- lib/auth.js signUp(), flujo de invitación) -- pero solo DESPUÉS de
-- supabase.auth.signUp(), momento en el que la sesión ya es 'authenticated',
-- nunca 'anon'. Se mantiene el GRANT a authenticated, se revoca de anon.
--
-- viaje_publico(uuid) NO se toca: portal público por token (/t/[token],
-- 0026/0028) está DISEÑADO para anon -- el token en sí es la autenticación,
-- la función ya valida token_publico + expiración en su WHERE. Aparece en el
-- advisor como aviso informativo, no como hallazgo real.
--
-- REVERSIÓN: GRANT EXECUTE ON FUNCTION public.crear_factura_automatica_pod() TO PUBLIC;
--            GRANT EXECUTE ON FUNCTION public.gestor_id_solo_admin() TO PUBLIC;
--            GRANT EXECUTE ON FUNCTION public.rol_comercial_restringido() TO PUBLIC;
--            GRANT EXECUTE ON FUNCTION public.sync_roles_desde_rol() TO PUBLIC;
--            GRANT EXECUTE ON FUNCTION public.usar_invitacion(uuid) TO anon;
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.crear_factura_automatica_pod() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gestor_id_solo_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rol_comercial_restringido() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_roles_desde_rol() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.usar_invitacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usar_invitacion(uuid) TO authenticated;
