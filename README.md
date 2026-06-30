# Norenty

Capa de "aseguramiento de ejecución" para empresas de transporte de flota propia.
El contexto completo del proyecto está en [`CLAUDE.md`](./CLAUDE.md).

## Estructura (monorepo)

- `/backend` — API en Python + FastAPI.
- `/dashboard` — panel del gestor en Next.js.

## Estado actual: Milestone 0

Esqueleto que arranca en vacío. Todavía **sin lógica de negocio** (ni hitos, ni bot,
ni base de datos). Solo sirve para comprobar que backend y dashboard encienden.

## Cómo arrancar

### Backend (FastAPI)

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Comprobación: abrir http://127.0.0.1:8000/health → debe responder `{"status": "ok"}`.

#### Migraciones de base de datos

```powershell
cd backend
python db/migrate.py --check   # lista pendientes sin aplicar nada
python db/migrate.py           # aplica las pendientes en orden
```

Requiere `DATABASE_URL` (connection string de Postgres) en `.env`. Cada SQL nuevo
va en `backend/db/migrations/NNNN_descripcion.sql`; el runner lleva el registro
de lo aplicado en la tabla `schema_migrations`. No aplicar SQL ad-hoc por el
MCP de Supabase salvo para inspección puntual.

### Dashboard (Next.js)

```powershell
cd dashboard
npm install
npm run dev
```

Comprobación: abrir http://localhost:3000 → debe verse la página "Norenty — dashboard (vacío)".

## Configuración

Copia `.env.example` a `.env` y rellena las claves cuando toque (a partir del
Milestone 1). El archivo `.env` está ignorado por Git: **nunca subas claves reales**.
