-- ============================================================
-- Norenty 11.2 — Capa de contexto atada a las entidades.
--
-- Generaliza nota_gestor (0022): en vez de una nota suelta atada solo a un
-- viaje, `contexto` guarda cualquier pieza de conocimiento (nota manual,
-- extracto de email, y en el futuro transcripcion de llamada / WhatsApp)
-- anclada polimorficamente a un viaje, chofer o cliente, CON PROCEDENCIA:
-- quien lo dijo (gestor_id o autor_externo), por que canal (canal), y cuando
-- paso de verdad (ocurrido_en) vs cuando se guardo (created_at).
--
-- Dia 1 sin IA: memoria organizada y buscable de cada viaje/cliente. Despues:
-- corpus de recuperacion del bot de llamadas (11.7). El campo `canal` ya
-- enumera los valores futuros ('llamada_transcrita' para 11.3, 'whatsapp' para
-- 11.6) marcados RESERVADOS, para que esos items NO tengan que re-migrar el
-- CHECK -- pero HOY solo se escriben 'nota_manual' y 'email' desde el dashboard.
--
-- Anclaje polimorfico (entidad + entidad_id) igual que audit_log (0030) y
-- documento: coherente con el codebase, y deseable aqui porque el contexto es
-- memoria del negocio que debe sobrevivir al borrado de la entidad (por eso NO
-- hay FK sobre entidad_id; el aislamiento lo da empresa_id + RLS).
--
-- MUTABLE a proposito (NO append-only como audit_log 0037): es memoria de
-- trabajo editable, no evidencia forense. Policy FOR ALL como nota_gestor/
-- cliente, + trigger solo_lectura para que rol solo_lectura no escriba.
--
-- DDL puro (tabla + indices + RLS + trigger), SIN backfill: la tabla nace
-- vacia -> idempotente y seguro de reintentar ("una migracion, una
-- responsabilidad", 9.37). nota_gestor se DEJA INTACTA (ver SPECS-11.md 6).
--
-- REVERSION (convencion 9.16): para deshacer --
--   DROP TABLE IF EXISTS public.contexto;   -- (borra policy y trigger en cascada)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contexto (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  entidad       text NOT NULL CHECK (entidad IN ('viaje','chofer','cliente')),
  entidad_id    uuid NOT NULL,
  canal         text NOT NULL DEFAULT 'nota_manual'
                  CHECK (canal IN ('nota_manual','email','llamada_transcrita','whatsapp')),
  texto         text NOT NULL,
  resumen       text,
  gestor_id     uuid REFERENCES public.gestor(id) ON DELETE SET NULL,
  autor_externo text,
  ocurrido_en   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indice del feed: "todo el contexto de esta entidad, hecho mas reciente primero".
-- (entidad, entidad_id, ocurrido_en DESC) cubre el filtro + el orden en un solo indice.
CREATE INDEX IF NOT EXISTS idx_contexto_entidad
  ON public.contexto (entidad, entidad_id, ocurrido_en DESC);

-- Indice por empresa (consistente con nota_gestor/audit_log/cliente).
CREATE INDEX IF NOT EXISTS idx_contexto_empresa
  ON public.contexto (empresa_id);

ALTER TABLE public.contexto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa gestiona su contexto" ON public.contexto;
CREATE POLICY "empresa gestiona su contexto" ON public.contexto FOR ALL
  USING (empresa_id = current_empresa_id()) WITH CHECK (empresa_id = current_empresa_id());

-- Defensa en profundidad: rol solo_lectura no puede crear/editar/borrar contexto.
DROP TRIGGER IF EXISTS trg_solo_lectura_contexto ON public.contexto;
CREATE TRIGGER trg_solo_lectura_contexto BEFORE INSERT OR UPDATE OR DELETE ON public.contexto
  FOR EACH ROW EXECUTE FUNCTION public.solo_lectura_bloquea_escritura();
