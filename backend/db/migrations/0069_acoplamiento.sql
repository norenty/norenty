-- ============================================================
-- Norenty Fase 23, Bloque C — Unidad de transporte real: `acoplamiento`.
--
-- Origen: sesion de 60 min con un gestor de trafico real viendo su TMS
-- (Cometweb) en pantalla (2026-07-27, DISCOVERY.md insights 9/21/22). Su
-- queja mas repetida: "el ordenador se hace mierda" con los remolques,
-- porque el viaje que hace el remolque y el que hace el camion no siempre
-- es el mismo. Nuestro esquema (viaje.vehiculo_id + viaje.remolque_id) tenia
-- EL MISMO error: un remolque fijo durante todo el viaje.
--
-- Correccion de modelo: no hay una fila "viaje con remolque", hay CUATRO
-- lineas de tiempo independientes (chofer, tractora, cada remolque, viaje
-- comercial) que se acoplan y desacoplan. Lo que las une es un intervalo
-- de tiempo, no un campo -- de ahi `acoplamiento`, append-only como
-- ejecucion_evento.
--
-- El punto central del diseno: los estados imposibles ("un remolque
-- acoplado a dos tractoras a la vez") no se validan en la aplicacion, se
-- hacen IRREPRESENTABLES con indices unicos parciales. Ver SPECS-23.md.
--
-- No destructivo: viaje.vehiculo_id/remolque_id NO se borran (quedan como
-- dato heredado); esta tabla es la nueva fuente de verdad de "que va
-- acoplado a que, ahora mismo".
--
-- REVERSION (convencion 9.16):
--   DROP TABLE IF EXISTS public.acoplamiento;
--   ALTER TABLE public.hito DROP COLUMN IF EXISTS remolque_id;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.acoplamiento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  -- NULL = remolque suelto (dejado en un punto, sin tractora que lo lleve).
  tractora_id    uuid REFERENCES public.vehiculo(id) ON DELETE SET NULL,
  remolque_id    uuid NOT NULL REFERENCES public.vehiculo(id) ON DELETE CASCADE,
  -- 1 o 2: soporta el caso "duo" (dos remolques + Dolly en una misma tractora).
  posicion       smallint NOT NULL DEFAULT 1 CHECK (posicion IN (1, 2)),
  chofer_id      uuid REFERENCES public.chofer(id) ON DELETE SET NULL,
  viaje_id       uuid REFERENCES public.viaje(id) ON DELETE SET NULL,
  desde          timestamptz NOT NULL DEFAULT now(),
  hasta          timestamptz, -- NULL = vigente
  motivo         text NOT NULL CHECK (motivo IN ('enganche', 'desenganche', 'cambio', 'suelta', 'correccion')),
  registrado_por text NOT NULL CHECK (registrado_por IN ('bot', 'gestor', 'sistema')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (hasta IS NULL OR hasta >= desde)
);

-- Invariante 1: un remolque no puede estar acoplado en dos sitios a la vez.
-- Esto hace IMPOSIBLE (no solo "no deberia pasar") el bug central que
-- describio el gestor: el ordenador ya no puede "hacerse mierda" pensando
-- que un remolque esta en dos viajes porque el propio indice lo rechaza.
CREATE UNIQUE INDEX IF NOT EXISTS idx_acoplamiento_remolque_vigente
  ON public.acoplamiento (remolque_id) WHERE hasta IS NULL;

-- Invariante 2: una tractora no puede llevar dos remolques en la MISMA
-- posicion a la vez (si puede llevar uno en 1 y otro en 2 -> duo).
CREATE UNIQUE INDEX IF NOT EXISTS idx_acoplamiento_tractora_posicion_vigente
  ON public.acoplamiento (tractora_id, posicion)
  WHERE hasta IS NULL AND tractora_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acoplamiento_empresa
  ON public.acoplamiento (empresa_id);
CREATE INDEX IF NOT EXISTS idx_acoplamiento_chofer_vigente
  ON public.acoplamiento (chofer_id) WHERE hasta IS NULL;
CREATE INDEX IF NOT EXISTS idx_acoplamiento_viaje
  ON public.acoplamiento (viaje_id);

ALTER TABLE public.acoplamiento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa ve sus acoplamientos" ON public.acoplamiento;
CREATE POLICY "empresa ve sus acoplamientos" ON public.acoplamiento
  FOR SELECT USING (empresa_id = current_empresa_id());

-- Escritura: cualquier gestor activo salvo solo_lectura (mismo criterio que
-- el resto de tablas operativas, 0032). El rol comercial tampoco escribe
-- aqui (no gestiona patio) -- se cablea via el trigger generico existente
-- si en el futuro hace falta; por ahora basta con la policy de rol.
DROP POLICY IF EXISTS "operativos registran acoplamientos" ON public.acoplamiento;
CREATE POLICY "operativos registran acoplamientos" ON public.acoplamiento
  FOR INSERT WITH CHECK (
    empresa_id = current_empresa_id()
    AND current_gestor_rol() IN ('admin', 'gestor_operativo')
  );

DROP POLICY IF EXISTS "operativos cierran acoplamientos" ON public.acoplamiento;
CREATE POLICY "operativos cierran acoplamientos" ON public.acoplamiento
  FOR UPDATE
  USING (empresa_id = current_empresa_id() AND current_gestor_rol() IN ('admin', 'gestor_operativo'))
  WITH CHECK (empresa_id = current_empresa_id());

-- `hito.remolque_id`: a que remolque pertenece la carga de esa parada
-- concreta. Resuelve el caso del duo con una sola descarga posible (el
-- ordenador de Cometweb marca el CONJUNTO como cargado cuando solo un
-- remolque tiene mercancia pendiente).
ALTER TABLE public.hito ADD COLUMN IF NOT EXISTS remolque_id uuid REFERENCES public.vehiculo(id) ON DELETE SET NULL;

-- Backfill no destructivo: un acoplamiento por cada viaje existente que ya
-- tenga tractora+remolque fijados a la vieja usanza. Marcado como
-- 'correccion'/'sistema' para distinguirlo de lo registrado en vivo por el
-- bot. Los viajes ya cerrados quedan con hasta=created_at (aproximado); los
-- abiertos quedan vigentes (hasta NULL).
INSERT INTO public.acoplamiento (empresa_id, tractora_id, remolque_id, chofer_id, viaje_id, desde, hasta, motivo, registrado_por)
SELECT
  v.empresa_id,
  v.vehiculo_id,
  v.remolque_id,
  v.chofer_id,
  v.id,
  v.created_at,
  CASE WHEN v.estado IN ('completado', 'cancelado') THEN v.created_at ELSE NULL END,
  'correccion',
  'sistema'
FROM public.viaje v
WHERE v.remolque_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.acoplamiento a WHERE a.viaje_id = v.id AND a.remolque_id = v.remolque_id)
ON CONFLICT DO NOTHING;
