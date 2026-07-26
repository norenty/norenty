-- ROADMAP 10.10 (petición del usuario, 2026-07-26): "quiero que sea una fuente
-- real de verdad, no que se apruebe lo que da el software sin mirar".
--
-- Hoy, asignar al chófer #1 sugerido no pide NADA (a propósito, para no
-- friccionar el caso normal) -- lo que significa que `siguio_sugerencia=true`
-- es indistinguible entre "el gestor de verdad evaluó y estuvo de acuerdo" y
-- "no miró y le dio al botón". Añadir fricción (pedir motivo siempre) mataría
-- la adopción, que es el objetivo #1 del proyecto. En vez de eso: una señal
-- PASIVA y honesta -- cuánto tiempo estuvo el ranking visible en pantalla
-- antes de que se pulsara "Asignar". No decide nada por sí sola, pero permite
-- filtrar/ponderar después (10.10) los clics reflejo de las decisiones reales.
ALTER TABLE public.decision_asignacion ADD COLUMN IF NOT EXISTS tiempo_visible_ms integer;

-- REVERSIÓN: ALTER TABLE public.decision_asignacion DROP COLUMN IF EXISTS tiempo_visible_ms;
