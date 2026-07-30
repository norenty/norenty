-- ============================================================
-- Norenty — ciudad de residencia del chófer.
--
-- Pedido por el usuario (2026-07-30) viendo el Planificador vacío: la
-- "vuelta a casa el fin de semana" es una restricción real de negocio
-- (DISCOVERY.md: "el jueves ya tienes que estar viendo que el viaje..." --
-- retorno a casa como restricción dura) que hoy no tiene ningún dato que la
-- represente. Este campo es el primer paso -- solo el dato, nullable, sin
-- construir todavía el algoritmo de restricción sobre él (eso es un ítem de
-- planificación aparte, no un texto de ciudad).
--
-- REVERSIÓN: ALTER TABLE public.chofer DROP COLUMN IF EXISTS ciudad_residencia;
-- ============================================================

ALTER TABLE public.chofer ADD COLUMN IF NOT EXISTS ciudad_residencia text;
