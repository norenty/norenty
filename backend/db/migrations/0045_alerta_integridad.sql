-- ============================================================
-- Norenty 10.6 — Verificacion de integridad PROGRAMADA (hash-chain +
-- fotos de POD), con alerta si algo falla.
--
-- verificar_cadena.py (9.7) y verificar_pod.py (9.8) ya existian, de solo
-- lectura, pero solo se ejecutaban a mano -- "la funcion de integridad no
-- vale nada si la verificacion solo corre cuando alguien se acuerda de
-- lanzarla". monitor_integridad.py (este item) las invoca a las dos y, si
-- alguna rotura aparece, alerta -- pero a diferencia del heartbeat (10.5,
-- que SI se recupera solo), una rotura de integridad NO se auto-resuelve:
-- "reparar es una decision humana" (ya dicho en verificar_cadena.py). Por
-- eso el anti-spam aqui es mas simple: una fila UNICA por (tipo, entidad_id)
-- rota, insertada con ON CONFLICT DO NOTHING -- se alerta la PRIMERA vez que
-- se detecta esa rotura concreta, nunca mas (hasta que un humano la borre
-- tras investigar/reparar).
--
-- Mecanismo interno (como bot_heartbeat/alerta_bot_caido): RLS ON, sin
-- policies para `authenticated`.
--
-- DDL puro, SIN backfill -> idempotente ("una migracion, una
-- responsabilidad", 9.37).
--
-- REVERSION (convencion 9.16): para deshacer --
--   DROP TABLE IF EXISTS public.alerta_integridad;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.alerta_integridad (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          text NOT NULL CHECK (tipo IN ('cadena', 'pod')),
  entidad_id    text NOT NULL,   -- evento_id (cadena) o pod_id (pod)
  motivo        text,
  detectada_en  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, entidad_id)
);

ALTER TABLE public.alerta_integridad ENABLE ROW LEVEL SECURITY;
-- Sin policies para `authenticated`: el dashboard no necesita verla ni tocarla.
