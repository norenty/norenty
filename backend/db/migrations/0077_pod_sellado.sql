-- ============================================================
-- Norenty F13.7 (reformulado) — Sello/firma del cliente en la entrega.
--
-- Discovery real (DISCOVERY.md insight 14) + decisión explícita del usuario
-- (2026-07-30): "asegurarse de que la entrega y albarán es correcto es básico, si no
-- te sellan no cobras". No es una firma digital genérica (pad de firma) -- es
-- confirmar, en el momento y en el bot, si el cliente selló/firmó el albarán. Si no,
-- se marca como incidencia automática ("entrega_sin_sello") el mismo día, no a fin de
-- mes cuando ya es tarde para reclamar.
--
-- `sellado` vive en `pod` (no en `hito`) porque es un atributo de ESE albarán
-- concreto, igual que `estado_validacion`/`hash_sha256`. NULL = todavía no
-- contestado (chófer no ha pulsado Sí/No); no se fuerza NOT NULL porque el flujo del
-- bot pregunta DESPUÉS de subir la foto, hay una ventana donde el pod existe sin
-- respuesta aún.
--
-- REVERSIÓN (convención 9.16): ALTER TABLE public.pod DROP COLUMN IF EXISTS sellado;
-- ============================================================

ALTER TABLE public.pod ADD COLUMN IF NOT EXISTS sellado boolean;
