-- ============================================================
-- Fix crítico de seguridad (aviso automático de Supabase, 2026-08-05):
-- `schema_migrations` (tabla interna del runner de migraciones, migrate.py)
-- nunca tuvo RLS activada porque nunca se pensó como tabla de "producto" --
-- pero al vivir en el schema public, PostgREST la expone igual que
-- cualquier otra. Grants heredados por defecto dejaban a `anon` (la clave
-- pública usada por CUALQUIERA con la URL del proyecto, sin login) con
-- INSERT/SELECT/UPDATE/DELETE/TRUNCATE completos y sin RLS que lo frenara.
--
-- Mismo patrón que cola_trabajo (0040): mecanismo 100% interno del backend
-- (solo migrate.py, vía DATABASE_URL directo con psycopg2, que usa el rol
-- postgres/service_role y por tanto bypassa RLS de todas formas) -- RLS ON
-- SIN ninguna policy para authenticated/anon, más REVOKE explícito de los
-- grants heredados (defensa en profundidad: aunque alguien reactivara una
-- policy accidentalmente mañana, sin los grants de tabla no hay nada que
-- ejecutar).
--
-- REVERSIÓN: ALTER TABLE public.schema_migrations DISABLE ROW LEVEL SECURITY;
--            GRANT ALL ON public.schema_migrations TO anon, authenticated;
-- ============================================================

REVOKE ALL ON public.schema_migrations FROM anon, authenticated;

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
-- Sin policies: con RLS activada y ningún policy, anon/authenticated no
-- pueden hacer nada. service_role/postgres (el runner) ignoran RLS.
