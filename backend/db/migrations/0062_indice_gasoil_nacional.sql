-- ============================================================
-- Norenty 18.B.3 — Precio del gasoil automático (índice público, no un campo
-- editable en Ajustes que se olvida actualizar).
--
-- El usuario: "me gustaria que pudiera cogerse automaticamente", aceptando
-- que se pueda sobreescribir a mano. Fuente elegida: API REST publica del
-- Ministerio para la Transicion Ecologica (geoportalgasolineras.es /
-- sedeaplicaciones.minetur.gob.es), que devuelve el precio de "Gasoleo A" de
-- CADA gasolinera del pais (miles de filas, sin endpoint de media nacional).
-- La media se calcula en el script (ver actualizar_precio_gasoil.py), no aqui.
--
-- Tabla de UNA sola fila (indice nacional, no es dato por-empresa -> sin
-- empresa_id, sin scoping de tenant). RLS ON con policy de SOLO LECTURA para
-- `authenticated`: el dashboard necesita leerla (mostrar "sugerido: X €/l" en
-- Ajustes), pero solo el script (via DATABASE_URL, bypassa RLS) escribe.
--
-- precio_gasoil_litro en `empresa` (0013/0023) sigue siendo el campo que de
-- verdad se usa para calcular costes -- este indice es solo la SUGERENCIA que
-- se ofrece para rellenarlo, nunca sobreescribe nada solo.
--
-- DDL puro, SIN backfill -> idempotente ("una migracion, una responsabilidad",
-- 9.37). El script hace el primer INSERT/UPDATE la primera vez que se ejecuta.
--
-- REVERSIÓN (convención 9.16): para deshacer --
--   DROP TABLE IF EXISTS public.indice_gasoil_nacional;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.indice_gasoil_nacional (
  id               boolean PRIMARY KEY DEFAULT true,  -- fuerza una sola fila
  precio_medio_eur numeric(6,3) NOT NULL,              -- €/l, media nacional Gasóleo A
  num_estaciones   integer NOT NULL,                   -- cuántas gasolineras entraron en la media (trazabilidad)
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT indice_gasoil_nacional_una_fila CHECK (id)
);

ALTER TABLE public.indice_gasoil_nacional ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lectura publica del indice de gasoil" ON public.indice_gasoil_nacional;
CREATE POLICY "lectura publica del indice de gasoil"
  ON public.indice_gasoil_nacional
  FOR SELECT
  TO authenticated
  USING (true);
