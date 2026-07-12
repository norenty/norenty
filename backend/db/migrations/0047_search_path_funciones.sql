-- ============================================================
-- Hardening (2026-07-12, hallazgo del linter de seguridad de Supabase):
-- 3 funciones sin `search_path` fijo (`function_search_path_mutable`, WARN).
-- Sin esto, una sesión que consiguiera cambiar su `search_path` (p.ej. vía un
-- rol con privilegios para crear objetos en otro esquema) podría hacer que
-- una referencia NO cualificada dentro de la función resuelva a un objeto
-- suyo en vez del real de `public` ("schema shadowing"). Las 3 funciones ya
-- cualifican TODO con `public.` explícitamente, así que fijar
-- `search_path = ''` es seguro y no cambia ningún comportamiento — solo
-- cierra la vía de ataque. No requiere recrear las funciones (CREATE OR
-- REPLACE preserva permisos/triggers que las usan).
-- ============================================================

ALTER FUNCTION public.ejecucion_evento_calc_hash(text, uuid, uuid, uuid, uuid, text, text, timestamptz)
  SET search_path = '';

ALTER FUNCTION public.ejecucion_evento_hash_chain()
  SET search_path = '';

ALTER FUNCTION public.cola_reclamar_lote(integer, text)
  SET search_path = '';
