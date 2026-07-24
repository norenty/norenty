-- ============================================================
-- Norenty 17.G.10 — El bot como intermediario real gestor<->chófer.
--
-- Hallazgo real (2026-07-23, probando el bot con el usuario): la captura de
-- datos era de UNA sola dirección -- chófer->gestor (llegadas, POD,
-- incidencias, notas de voz, todo con hash-chain) estaba completa, pero
-- gestor->chófer NO pasaba por el sistema en absoluto. "Contactar gestor"
-- solo enseñaba un email; nada de lo que se hablaban quedaba capturado.
--
-- `mensaje_chofer` cierra el hueco con el MISMO patrón ya probado que usa
-- `viaje.notificado_asignacion_en` (7A.3): el dashboard/bot INSERTA una fila,
-- un job de 30s (o el propio bot en caliente, para chofer->gestor) la
-- entrega y marca `entregado_en`. No es un chat en tiempo real de verdad
-- (no hay WebSocket), es "buzón con entrega casi instantánea" -- suficiente
-- para el caso de uso y consistente con la arquitectura existente.
--
-- direccion determina quién es emisor/receptor:
--   'gestor_a_chofer': el dashboard escribe, el chofer_id de destino es
--                       obligatorio, gestor_id es el autor.
--   'chofer_a_gestor': el bot escribe (chófer pulsó "Contactar" y mandó
--                       texto/voz), chofer_id es el autor, se entrega EN
--                       CALIENTE (no necesita esperar al job) a los gestores
--                       de la empresa vía la misma `alertar_gestor`/
--                       `transporte_gestor` que ya existen.
--
-- `viaje_id` nullable a propósito: el chófer puede querer contactar aunque
-- no tenga un viaje activo en ese instante (duda general, aviso de
-- disponibilidad). Si hay viaje en curso se enlaza, si no, queda suelto.
--
-- `gestor.telefono` (nullable): para la vía de EMERGENCIA real -- llamada
-- directa, no todo puede/debe pasar por texto. El propio usuario lo pidió
-- explícitamente ("en caso de emergencia hablar por teléfono es clave").
--
-- REVERSION (convención 9.16): para deshacer --
--   ALTER TABLE public.gestor DROP COLUMN IF EXISTS telefono;
--   DROP TABLE IF EXISTS public.mensaje_chofer;
-- ============================================================

ALTER TABLE public.gestor
  ADD COLUMN IF NOT EXISTS telefono text;

CREATE TABLE IF NOT EXISTS public.mensaje_chofer (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  viaje_id     uuid REFERENCES public.viaje(id) ON DELETE SET NULL,
  chofer_id    uuid NOT NULL REFERENCES public.chofer(id) ON DELETE CASCADE,
  gestor_id    uuid REFERENCES public.gestor(id) ON DELETE SET NULL,
  direccion    text NOT NULL CHECK (direccion IN ('gestor_a_chofer', 'chofer_a_gestor')),
  texto        text NOT NULL,
  entregado_en timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mensaje_chofer_pendientes
  ON public.mensaje_chofer (direccion, entregado_en)
  WHERE entregado_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_mensaje_chofer_viaje ON public.mensaje_chofer (viaje_id);
CREATE INDEX IF NOT EXISTS idx_mensaje_chofer_chofer ON public.mensaje_chofer (chofer_id);

ALTER TABLE public.mensaje_chofer ENABLE ROW LEVEL SECURITY;

-- Mismo criterio de scoping que gasto_viaje/decision_asignacion (0054): un
-- gestor no-admin solo ve/escribe mensajes de chóferes sin asignar o
-- asignados a él mismo.
DROP POLICY IF EXISTS empresa_scoped_mensaje_chofer ON public.mensaje_chofer;
CREATE POLICY empresa_scoped_mensaje_chofer ON public.mensaje_chofer
  FOR ALL
  USING (
    chofer_id IN (
      SELECT id FROM public.chofer
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  )
  WITH CHECK (
    chofer_id IN (
      SELECT id FROM public.chofer
       WHERE empresa_id = current_empresa_id()
         AND (current_gestor_rol() = 'admin' OR gestor_id = current_gestor_id() OR gestor_id IS NULL)
    )
  );

-- Defensa en profundidad: rol solo_lectura no puede escribir mensajes.
DROP TRIGGER IF EXISTS trg_solo_lectura_mensaje_chofer ON public.mensaje_chofer;
CREATE TRIGGER trg_solo_lectura_mensaje_chofer BEFORE INSERT OR UPDATE OR DELETE ON public.mensaje_chofer
  FOR EACH ROW EXECUTE FUNCTION public.solo_lectura_bloquea_escritura();

-- 'mensaje_gestor' amplía los canales de `contexto` (0042/0058): todo mensaje
-- entregado (en cualquier dirección) se refleja también ahí para que quede en
-- el corpus buscable del viaje/chófer, no solo en el buzón operativo.
ALTER TABLE public.contexto DROP CONSTRAINT IF EXISTS contexto_canal_check;
ALTER TABLE public.contexto ADD CONSTRAINT contexto_canal_check
  CHECK (canal IN ('nota_manual', 'email', 'llamada_transcrita', 'whatsapp', 'nota_voz', 'mensaje_gestor'));
