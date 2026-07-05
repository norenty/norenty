-- ============================================================
-- Norenty 9.10 — Expiración explícita de invitaciones (mínimos de AuthN/AuthZ).
--
-- Hoy una invitación pendiente es válida PARA SIEMPRE hasta que alguien la
-- revoque a mano (item 6.9). Un enlace de invitación filtrado (email
-- reenviado, captura de pantalla vieja) sigue siendo canjeable meses después.
-- Cierra la ventana: usar_invitacion() ya no canjea invitaciones con más de
-- INVITACION_VALIDEZ_DIAS=7 desde su creación, aunque nadie la haya revocado
-- a mano. Sin columna nueva: se calcula sobre `created_at`, que ya existe.
--
-- Valor inicial (7 días) razonable, NO pactado con cliente real — mismo
-- criterio que otros umbrales v1 del proyecto (UMBRAL_NOCHE_FUERA_KM,
-- UMBRAL_MARGEN_AMBAR_PCT). El resto de la función es idéntico a 0018.
-- ============================================================

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
  WHERE codigo = p_codigo
    AND usada_at IS NULL
    AND created_at > now() - interval '7 days'
  RETURNING empresa_id INTO v_empresa_id;

  RETURN v_empresa_id;
END;
$$;
