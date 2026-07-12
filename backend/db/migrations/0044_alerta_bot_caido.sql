-- ============================================================
-- Norenty 10.5 — Alerta real de "bot caido" (no solo la tarjeta pasiva del
-- dashboard, que nadie mira si no tiene la pestana abierta).
--
-- Tabla minima para el mecanismo ANTI-SPAM: si el heartbeat lleva caido,
-- monitor_heartbeat.py (invocado periodicamente por un scheduler externo --
-- cron/Task Scheduler, ver RUNBOOKS.md; no se anade infraestructura nueva
-- tipo Celery/Kubernetes, solo un script + el propio scheduler del SO) manda
-- Telegram a los gestores con telegram_chat_id UNA VEZ por episodio de caida,
-- no en cada ejecucion del script. Cuando el heartbeat se recupera, se marca
-- resuelta_en y se manda un aviso de recuperacion.
--
-- Mecanismo interno del backend (como bot_heartbeat, 0027): RLS ON pero SIN
-- policies para `authenticated` -- el dashboard no la ve ni la toca, solo el
-- script (via DATABASE_URL, superusuario, bypassa RLS).
--
-- DDL puro, SIN backfill -> idempotente ("una migracion, una responsabilidad",
-- 9.37).
--
-- REVERSION (convencion 9.16): para deshacer --
--   DROP TABLE IF EXISTS public.alerta_bot_caido;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.alerta_bot_caido (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enviada_en   timestamptz NOT NULL DEFAULT now(),
  resuelta_en  timestamptz  -- NULL mientras el episodio de caida sigue abierto
);

CREATE INDEX IF NOT EXISTS idx_alerta_bot_caido_abierta
  ON public.alerta_bot_caido (resuelta_en) WHERE resuelta_en IS NULL;

ALTER TABLE public.alerta_bot_caido ENABLE ROW LEVEL SECURITY;
-- Sin policies para `authenticated`: el dashboard no necesita verla ni tocarla.
