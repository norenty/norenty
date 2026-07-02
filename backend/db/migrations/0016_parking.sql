-- Parkings para camión (ítem 5.4). Dos fuentes en la misma tabla:
--   - fuente='dataset_abierto', empresa_id NULL: ubicaciones conocidas de parking/
--     descanso/repostaje para camión, dataset abierto (Fraunhofer ISI vía Zenodo,
--     CC-BY 4.0, ver backend/db/seed_parking_abierto.py). Visibles para TODAS las
--     empresas (no son datos de negocio de nadie, son geografía pública).
--     IMPORTANTE: esto NO es el registro oficial "SSTPA" de parkings certificados
--     seguros de la UE (ese requiere acceso ECAS/DATEX II, sigue pendiente, ver
--     DISCOVERY.md) — es una capa de "dónde hay parking/descanso conocido", que
--     ya es el caso de uso real que pidió el gestor.
--   - fuente='empresa', empresa_id NOT NULL: parkings propios de una empresa
--     (su propio mapa curado), gestionados desde el dashboard.

CREATE TABLE IF NOT EXISTS parking (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid REFERENCES empresa(id) ON DELETE CASCADE, -- NULL = dataset abierto (global)
  nombre      text NOT NULL,
  tipo        text NOT NULL DEFAULT 'otro' CHECK (tipo IN ('parking', 'fueling', 'rest_area', 'otro')),
  lat         double precision NOT NULL,
  lon         double precision NOT NULL,
  pais        text,       -- ISO2, solo dataset abierto
  confianza   text,       -- 'High' | 'Medium', solo dataset abierto (ver codebook Zenodo)
  fuente      text NOT NULL CHECK (fuente IN ('dataset_abierto', 'empresa')),
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parking_empresa ON parking (empresa_id);

ALTER TABLE parking ENABLE ROW LEVEL SECURITY;

-- Cualquier gestor ve el dataset abierto (empresa_id IS NULL) + los propios de su empresa.
CREATE POLICY "ve parkings del dataset abierto o propios de su empresa"
  ON parking FOR SELECT
  USING (empresa_id IS NULL OR empresa_id = current_empresa_id());

-- Solo puede CREAR/EDITAR/BORRAR los suyos propios (empresa_id = la suya, nunca NULL:
-- los globales del dataset abierto los siembra un script con service role, que salta RLS).
CREATE POLICY "empresa crea sus propios parkings"
  ON parking FOR INSERT
  WITH CHECK (empresa_id = current_empresa_id());

CREATE POLICY "empresa edita sus propios parkings"
  ON parking FOR UPDATE
  USING (empresa_id = current_empresa_id())
  WITH CHECK (empresa_id = current_empresa_id());

CREATE POLICY "empresa borra sus propios parkings"
  ON parking FOR DELETE
  USING (empresa_id = current_empresa_id());
