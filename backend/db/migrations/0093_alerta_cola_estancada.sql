-- ============================================================
-- Auditoría 2026-08-04 (hallazgo #6, bajo): si DATABASE_URL falta al arrancar
-- el bot, la cola de trabajos (0040_cola_trabajos.sql) no arranca y solo se
-- loguea una vez al inicio -- sin alerta si queda estancada acumulando
-- 'pendiente'. Mismo mecanismo anti-spam que alerta_bot_caido (0044):
-- monitor_cola_estancada.py abre un episodio, avisa a los gestores, y lo
-- cierra con un aviso de recuperación cuando la cola vuelve a drenar.
--
-- REVERSIÓN: DROP TABLE IF EXISTS public.alerta_cola_estancada;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.alerta_cola_estancada (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enviada_en   timestamptz NOT NULL DEFAULT now(),
  resuelta_en  timestamptz  -- NULL mientras el episodio sigue abierto
);

CREATE INDEX IF NOT EXISTS idx_alerta_cola_estancada_abierta
  ON public.alerta_cola_estancada (resuelta_en) WHERE resuelta_en IS NULL;

ALTER TABLE public.alerta_cola_estancada ENABLE ROW LEVEL SECURITY;
-- Sin policies para `authenticated`: el dashboard no necesita verla ni tocarla.
