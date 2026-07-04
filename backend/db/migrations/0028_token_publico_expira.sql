-- Endurece el portal público (8.5): un enlace compartido no debe vivir para
-- siempre. `token_publico_expira` opcional (NULL = sin caducidad, para no
-- romper tokens ya generados antes de esta migración); generarTokenPublico
-- pasa a fijar 30 días por defecto en los nuevos.
ALTER TABLE viaje ADD COLUMN IF NOT EXISTS token_publico_expira timestamptz;

CREATE OR REPLACE FUNCTION public.viaje_publico(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'referencia', vi.referencia, 'estado', vi.estado,
    'hitos', (SELECT jsonb_agg(jsonb_build_object(
        'orden', h.orden, 'tipo', h.tipo, 'direccion', h.direccion,
        'estado', h.estado, 'ventana_inicio', h.ventana_inicio, 'ventana_fin', h.ventana_fin
      ) ORDER BY h.orden) FROM hito h WHERE h.viaje_id = vi.id),
    'ultima_posicion', (SELECT jsonb_build_object(
        'lat', round(u.lat::numeric, 2), 'lon', round(u.lon::numeric, 2), 'ts', u.created_at)
      FROM ubicacion u WHERE u.chofer_id = vi.chofer_id
      ORDER BY u.created_at DESC LIMIT 1)
  ) INTO v
  FROM viaje vi
  WHERE vi.token_publico = p_token
    AND (vi.token_publico_expira IS NULL OR vi.token_publico_expira > now());
  RETURN v;
END; $$;
GRANT EXECUTE ON FUNCTION public.viaje_publico(uuid) TO anon, authenticated;
