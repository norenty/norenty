-- ============================================================
-- Norenty — Milestone 3: valoracion del gestor + toggle de POD
-- ============================================================

-- Toggle de POD por empresa: si no usan albaran fisico, se desactiva
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS requiere_pod boolean NOT NULL DEFAULT true;

-- Valoracion manual del gestor (1-5), por chofer y opcionalmente por viaje.
-- viaje_id NULL = valoracion general del chofer.
CREATE TABLE IF NOT EXISTS valoracion (
    id         uuid primary key default gen_random_uuid(),
    chofer_id  uuid not null references chofer(id) on delete cascade,
    viaje_id   uuid references viaje(id) on delete set null,
    gestor_id  uuid references gestor(id) on delete set null,
    puntuacion smallint not null check (puntuacion between 1 and 5),
    nota       text,
    created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_valoracion_chofer ON valoracion(chofer_id);
CREATE INDEX IF NOT EXISTS idx_valoracion_viaje ON valoracion(viaje_id);

ALTER TABLE valoracion ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_all_valoracion" ON valoracion FOR ALL USING (true) WITH CHECK (true);
