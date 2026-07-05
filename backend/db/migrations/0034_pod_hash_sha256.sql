-- ============================================================
-- Norenty 9.8 — Hash SHA-256 de cada POD al subirlo.
--
-- Igual que ejecucion_evento (9.6/9.7), pod es evidencia: la foto del
-- albarán que demuestra que se entregó. Añade hash_sha256, calculado por el
-- bot en el momento de subir la foto (backend/app/bot.py, handle_photo) y
-- guardado junto a foto_url. Permite verificar bajo demanda que el fichero
-- en Storage sigue siendo EXACTAMENTE el que se subió (backend/db/verificar_pod.py).
--
-- La tabla está vacía hoy (0 filas) -> se añade NOT NULL directamente, sin
-- necesidad de backfill: a partir de esta migración TODO insert de pod debe
-- traer su hash, sin excepción.
--
-- GAP DE SEGURIDAD CERRADO DE PASO (nombrado en el principio de Fase 9 pero
-- nunca cerrado — la 0019 protegió ejecucion_evento/ubicacion, pero pod se
-- quedó fuera): hoy CUALQUIER gestor autenticado de la empresa puede hacer
-- UPDATE de foto_url por REST directo (la policy `empresa_scoped_pod` es
-- FOR ALL, sin restricción de columna) — pisando la evidencia sin pasar por
-- la UI. El dashboard solo necesita escribir `estado_validacion` (única
-- columna que toca `dashboard/app/viajes/[id]/page.jsx:154`, `validarPod`).
-- Mismo patrón REVOKE/GRANT de columna que 0019.
-- ============================================================

ALTER TABLE public.pod ADD COLUMN hash_sha256 text NOT NULL;

REVOKE UPDATE ON public.pod FROM authenticated;
GRANT UPDATE (estado_validacion) ON public.pod TO authenticated;
