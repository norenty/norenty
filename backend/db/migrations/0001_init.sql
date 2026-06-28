-- ============================================================
-- Lexenty — Milestone 1: esquema inicial de la base de datos
-- Ejecutar en: Supabase -> SQL Editor -> New query -> pegar -> Run
-- Es idempotente: puede ejecutarse varias veces (borra y recrea).
-- ============================================================

-- 1) LIMPIEZA: borra nuestras tablas si ya existian (orden inverso de dependencias)
drop table if exists incidencia       cascade;
drop table if exists pod              cascade;
drop table if exists ejecucion_evento cascade;
drop table if exists hito             cascade;
drop table if exists viaje            cascade;
drop table if exists chofer           cascade;
drop table if exists gestor           cascade;
drop table if exists empresa          cascade;

-- 2) TABLAS

-- empresa: la compania de transporte (raiz de todo)
create table empresa (
    id         uuid primary key default gen_random_uuid(),
    nombre     text not null,
    created_at timestamptz not null default now()
);

-- gestor: supervisor; pertenece a una empresa
create table gestor (
    id         uuid primary key default gen_random_uuid(),
    empresa_id uuid not null references empresa(id) on delete cascade,
    nombre     text not null,
    email      text,
    created_at timestamptz not null default now()
);

-- chofer: conductor; guarda idioma y chat_id de Telegram
create table chofer (
    id         uuid primary key default gen_random_uuid(),
    empresa_id uuid not null references empresa(id) on delete cascade,
    nombre     text not null,
    idioma     text not null default 'es',          -- codigo ISO: es, ro, ar, ...
    chat_id    text unique,                         -- id de chat de Telegram
    telefono   text,
    created_at timestamptz not null default now()
);

-- viaje: un trayecto asignado a un chofer
create table viaje (
    id         uuid primary key default gen_random_uuid(),
    empresa_id uuid not null references empresa(id) on delete cascade,
    chofer_id  uuid references chofer(id) on delete set null,
    gestor_id  uuid references gestor(id) on delete set null,
    referencia text,                                 -- codigo/albaran del cliente
    estado     text not null default 'planificado'
               check (estado in ('planificado','en_curso','completado','cancelado')),
    created_at timestamptz not null default now()
);

-- hito: cada parada del viaje (recogida/entrega) con lat/lon y ventana horaria
create table hito (
    id             uuid primary key default gen_random_uuid(),
    viaje_id       uuid not null references viaje(id) on delete cascade,
    orden          int not null,                     -- secuencia dentro del viaje
    tipo           text not null check (tipo in ('recogida','entrega')),
    direccion      text,
    lat            double precision,
    lon            double precision,
    ventana_inicio timestamptz,
    ventana_fin    timestamptz,
    estado         text not null default 'pendiente'
                   check (estado in ('pendiente','en_curso','completado','fallido')),
    created_at     timestamptz not null default now(),
    unique (viaje_id, orden)
);

-- ejecucion_evento: el LOG de lo que paso de verdad (el activo del producto).
-- Pensado como SOLO-ANADIR: no se edita ni se borra.
create table ejecucion_evento (
    id            uuid primary key default gen_random_uuid(),
    viaje_id      uuid not null references viaje(id) on delete cascade,
    hito_id       uuid references hito(id) on delete set null,
    chofer_id     uuid references chofer(id) on delete set null,
    tipo_evento   text not null,                     -- 'llegada','salida','pod_subido',...
    datos         jsonb not null default '{}'::jsonb,
    ocurrido_en   timestamptz not null default now(),  -- cuando paso de verdad
    registrado_en timestamptz not null default now()   -- cuando lo guardamos
);

-- pod: foto del albaran + resultado de la validacion con vision
create table pod (
    id                   uuid primary key default gen_random_uuid(),
    hito_id              uuid not null references hito(id) on delete cascade,
    viaje_id             uuid not null references viaje(id) on delete cascade,
    foto_url             text not null,              -- ruta en Supabase Storage
    estado_validacion    text not null default 'pendiente'
                         check (estado_validacion in ('pendiente','valido','invalido','dudoso')),
    resultado_validacion jsonb,                      -- lo que devolvio el LLM
    validado_en          timestamptz,
    created_at           timestamptz not null default now()
);

-- incidencia: cualquier cosa que se salio del plan
create table incidencia (
    id          uuid primary key default gen_random_uuid(),
    viaje_id    uuid not null references viaje(id) on delete cascade,
    hito_id     uuid references hito(id) on delete set null,
    tipo        text not null,                        -- 'retraso','direccion',...
    descripcion text,
    estado      text not null default 'abierta'
                check (estado in ('abierta','en_revision','resuelta')),
    created_at  timestamptz not null default now(),
    resuelta_en timestamptz
);

-- 3) INDICES (para que las busquedas habituales sean rapidas)
create index idx_gestor_empresa        on gestor(empresa_id);
create index idx_chofer_empresa        on chofer(empresa_id);
create index idx_viaje_empresa         on viaje(empresa_id);
create index idx_viaje_chofer          on viaje(chofer_id);
create index idx_viaje_estado          on viaje(estado);
create index idx_hito_viaje            on hito(viaje_id);
create index idx_evento_viaje          on ejecucion_evento(viaje_id);
create index idx_evento_viaje_ocurrido on ejecucion_evento(viaje_id, ocurrido_en);
create index idx_pod_hito              on pod(hito_id);
create index idx_pod_viaje             on pod(viaje_id);
create index idx_incidencia_viaje      on incidencia(viaje_id);
create index idx_incidencia_estado     on incidencia(estado);

-- 4) SEGURIDAD: activar RLS (Row Level Security) en todas las tablas.
-- Sin politicas = nadie accede por la API publica de Supabase.
-- El backend se conecta con la cadena de conexion (dueno de la BD) y NO le afecta RLS.
-- Las politicas de acceso fino las anadiremos en un milestone posterior.
alter table empresa          enable row level security;
alter table gestor           enable row level security;
alter table chofer           enable row level security;
alter table viaje            enable row level security;
alter table hito             enable row level security;
alter table ejecucion_evento enable row level security;
alter table pod              enable row level security;
alter table incidencia       enable row level security;
