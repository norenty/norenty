-- ROADMAP 20.4: distinguir parking vigilado (con seguridad) de normal.
-- No existe fuente abierta y gratuita fiable del registro oficial SSTPA/SSPA
-- (requiere cuenta ECAS/DATEX II, ya documentado como pendiente en 0016). En
-- vez de inventar una clasificación, esta columna queda NULL ("desconocido")
-- para todo el dataset abierto (Fraunhofer/OSM) y solo se puede afirmar
-- true/false en los parkings propios de cada empresa, que el gestor sí conoce
-- de primera mano (su propia nave/acuerdo con un parking de confianza).
ALTER TABLE public.parking ADD COLUMN IF NOT EXISTS vigilado boolean;

-- REVERSIÓN: ALTER TABLE public.parking DROP COLUMN IF EXISTS vigilado;
