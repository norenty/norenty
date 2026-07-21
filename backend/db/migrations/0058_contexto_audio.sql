-- ============================================================
-- Norenty 11.3 (Nivel 1 de la escalera de captura, ROADMAP Fase 11) —
-- Nota de voz anclada al contexto.
--
-- El valor del producto esta en las EXCEPCIONES, que hoy se resuelven por
-- telefono y el sistema no ve. El primer peldano de la escalera de captura es
-- que una nota de voz (del chofer por Telegram) quede anclada al viaje como
-- `contexto` (11.2), CON su hash de integridad -- misma tesis de evidencia que
-- pod (0034), incidencia (0057) y gasto (0043).
--
-- DELIBERADAMENTE SIN TRANSCRIPCION NI CLASIFICACION: guardar el audio no
-- depende de ninguna decision de producto pendiente (la taxonomia de urgencia /
-- tipo de incidencia la cierra el discovery con el gestor). El audio empieza a
-- acumular corpus HOY y la transcripcion (Whisper self-host, gated por deploy +
-- 11.5 consentimiento) se le puede pasar RETROACTIVAMENTE despues, haciendo
-- UPDATE de `texto` sobre las filas ya guardadas. Por eso `texto` sigue siendo
-- NOT NULL: hasta que haya transcripcion guarda un marcador, y la transcripcion
-- lo reemplaza sin migracion adicional.
--
-- Reutiliza el bucket privado "pods" (0011), igual que hizo incidencia en 0057:
-- su RLS ya scopa por empresa_id en el primer segmento de carpeta, asi que la
-- ruta {empresa_id}/voz/{viaje_id}/{uuid}.ogg queda cubierta sin tocar Storage.
--
-- `canal` gana 'nota_voz'. Los valores reservados en 0042 ('llamada_transcrita'
-- para la llamada real, 'whatsapp' para 11.6) se dejan intactos: una nota de voz
-- asincrona NO es una llamada transcrita, son peldanos distintos de la escalera.
--
-- DDL puro (2 columnas nullable + ampliar un CHECK), SIN backfill -> idempotente
-- ("una migracion, una responsabilidad", 9.37). RLS de contexto (0042) ya cubre
-- las columnas nuevas.
--
-- REVERSION (convencion 9.16): para deshacer --
--   ALTER TABLE public.contexto DROP CONSTRAINT IF EXISTS contexto_canal_check;
--   ALTER TABLE public.contexto ADD CONSTRAINT contexto_canal_check
--     CHECK (canal IN ('nota_manual','email','llamada_transcrita','whatsapp'));
--   ALTER TABLE public.contexto DROP COLUMN IF EXISTS audio_hash_sha256;
--   ALTER TABLE public.contexto DROP COLUMN IF EXISTS audio_url;
-- ============================================================

ALTER TABLE public.contexto
  ADD COLUMN IF NOT EXISTS audio_url text,
  ADD COLUMN IF NOT EXISTS audio_hash_sha256 text;

ALTER TABLE public.contexto DROP CONSTRAINT IF EXISTS contexto_canal_check;
ALTER TABLE public.contexto ADD CONSTRAINT contexto_canal_check
  CHECK (canal IN ('nota_manual','email','llamada_transcrita','whatsapp','nota_voz'));
