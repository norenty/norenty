-- ============================================================
-- Norenty — Milestone 3+: vehiculos, plantillas de ruta, ubicacion
-- ============================================================

CREATE TABLE IF NOT EXISTS vehiculo (
    id         uuid primary key default gen_random_uuid(),
    empresa_id uuid not null references empresa(id) on delete cascade,
    matricula  text not null,
    tipo       text not null check (tipo in ('tractora','remolque','rigido','furgoneta')),
    marca      text,
    modelo     text,
    notas      text,
    activo     boolean not null default true,
    created_at timestamptz not null default now()
);

ALTER TABLE viaje ADD COLUMN IF NOT EXISTS vehiculo_id uuid references vehiculo(id) on delete set null;
ALTER TABLE viaje ADD COLUMN IF NOT EXISTS remolque_id uuid references vehiculo(id) on delete set null;

CREATE TABLE IF NOT EXISTS plantilla_ruta (
    id         uuid primary key default gen_random_uuid(),
    empresa_id uuid not null references empresa(id) on delete cascade,
    nombre     text not null,
    notas      text,
    created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS plantilla_hito (
    id                uuid primary key default gen_random_uuid(),
    plantilla_ruta_id uuid not null references plantilla_ruta(id) on delete cascade,
    orden             int not null,
    tipo              text not null check (tipo in ('recogida','entrega')),
    direccion         text,
    lat               double precision,
    lon               double precision,
    notas             text,
    link_extra        text,
    unique (plantilla_ruta_id, orden)
);

CREATE TABLE IF NOT EXISTS ubicacion (
    id         uuid primary key default gen_random_uuid(),
    chofer_id  uuid not null references chofer(id) on delete cascade,
    lat        double precision not null,
    lon        double precision not null,
    velocidad  real,
    rumbo      real,
    created_at timestamptz not null default now()
);
