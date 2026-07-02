-- Invitaciones multi-gestor (ítem 6.9). Un gestor existente invita a otro por
-- email; el signup con ?invitacion=<codigo> une al gestor nuevo a ESA empresa
-- en vez de crear una nueva.
--
-- Problema de arranque (el mismo que en 6.2, ver PROGRESS.md 2026-07-02): un
-- usuario recién registrado NO tiene fila en `gestor` todavía, así que
-- current_empresa_id() es NULL y una policy `empresa_id = current_empresa_id()`
-- nunca le dejaría LEER la invitación para saber a qué empresa unirse. Por eso
-- el canje de la invitación NO se hace vía SELECT/UPDATE normal de la tabla
-- (que sí queda con RLS estricta, solo para gestores YA vinculados que gestionan
-- SUS propias invitaciones), sino vía una función SECURITY DEFINER que:
--   - solo puede canjear si SE CONOCE el código exacto (uuid impredecible, es
--     el propio secreto — no expone listado ni permite enumerar),
--   - marca la invitación como usada atómicamente (evita que dos personas
--     canjeen el mismo código a la vez),
--   - devuelve SOLO el empresa_id (nada de email ni otras filas).

CREATE TABLE IF NOT EXISTS invitacion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  email       text NOT NULL,
  codigo      uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  usada_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitacion_empresa ON invitacion (empresa_id);

ALTER TABLE invitacion ENABLE ROW LEVEL SECURITY;

-- Un gestor YA vinculado gestiona (ve/crea/borra) las invitaciones de SU empresa.
-- Sin UPDATE de authenticated normal a propósito: marcar usada_at solo pasa por
-- la función de abajo, para que sea atómico y no dependa de que el nuevo
-- usuario ya tenga fila en gestor en ese instante.
CREATE POLICY "empresa ve sus invitaciones"
  ON invitacion FOR SELECT
  USING (empresa_id = current_empresa_id());

CREATE POLICY "empresa crea invitaciones"
  ON invitacion FOR INSERT
  WITH CHECK (empresa_id = current_empresa_id());

CREATE POLICY "empresa borra sus invitaciones"
  ON invitacion FOR DELETE
  USING (empresa_id = current_empresa_id());

-- Canjea una invitación: si el código existe y no se ha usado, la marca usada
-- y devuelve el empresa_id a la que unirse. NULL si el código es inválido o ya
-- se usó. SECURITY DEFINER: salta RLS deliberadamente (ver comentario arriba).
CREATE OR REPLACE FUNCTION public.usar_invitacion(p_codigo uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
BEGIN
  UPDATE invitacion
  SET usada_at = now()
  WHERE codigo = p_codigo AND usada_at IS NULL
  RETURNING empresa_id INTO v_empresa_id;

  RETURN v_empresa_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.usar_invitacion(uuid) TO authenticated;
