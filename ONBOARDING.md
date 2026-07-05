# Norenty — Guía de arranque (ONBOARDING)

Para un segundo desarrollador (o para ti mismo dentro de 3 meses). Sigue el orden — cada paso
asume que el anterior ya funciona.

## 1. Requisitos

- **Node.js** 20+ (el dashboard es Next.js 15 + Tailwind 4).
- **Python** 3.11+ con `venv` (el bot y los scripts de BD).
- **Git**.
- **Docker** — opcional, solo si quieres OSRM local (routing por carretera real; sin él, todo cae
  a un fallback en línea recta corregida — ver `dashboard/lib/data.js: FACTOR_SINUOSIDAD_FALLBACK`).
- Acceso al proyecto de Supabase del equipo (`hloqddmdwinvjksqkhey`) y al bot de Telegram
  (`@NorentyBot`) — pide las claves reales a quien te haya pasado este repo, NUNCA las pidas ni
  las escribas en un chat con un asistente de IA; pégalas tú mismo en `.env`/`.env.local`.

## 2. Variables de entorno

Dos archivos, **ninguno se sube a git** (están en `.gitignore`):

### `.env` (raíz del repo — lo usa el backend/bot)

| Variable | Qué es | De dónde se saca |
|---|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase | Supabase → Project Settings → API |
| `SUPABASE_ANON_KEY` | Clave pública (respeta RLS) | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servidor (SALTA RLS) | Supabase → Project Settings → API. Sin ella, el bot en vivo no puede escribir con RLS activo (era la `[DECISIÓN D1]` crítica del roadmap — resuelta 2026-07-05, verificada). Nunca la pegues en un chat; ábrela tú mismo en el panel y pégala en el archivo. |
| `TELEGRAM_BOT_TOKEN` | Token del bot | @BotFather en Telegram |
| `ANTHROPIC_API_KEY` | Para validación de POD con visión (futuro, `[DECISIÓN]` pendiente de presupuesto) | No hace falta hoy — puede quedar vacía |
| `OPENAI_API_KEY` | Para voz/Whisper (futuro, `[DECISIÓN]` pendiente de presupuesto) | No hace falta hoy — puede quedar vacía |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | Cuenta de la empresa demo (para probar el dashboard y para los smoke tests, ítem 8.1) | Ya en el `.env` del equipo; si no, créala con `seed_demo.py` (ver más abajo) |
| `DATABASE_URL` | Connection string de Postgres (para `migrate.py` y backups) | Supabase → Project Settings → Database → Connection string → URI, pestaña **"Session pooler"** si "Direct connection" no resuelve DNS (habitual sin el add-on de IPv4). Era `[DECISIÓN D2]` — resuelta 2026-07-05, verificada con `migrate.py --check` |
| `SENTRY_DSN` | Error tracking (opt-in, inerte si vacía) | Sentry del proyecto, si existe |

### `dashboard/.env.local` (lo usa el dashboard Next.js — variables `NEXT_PUBLIC_*` son visibles en el navegador)

| Variable | Qué es |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Misma URL que arriba |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Misma anon key que arriba — **nunca** la service role aquí, esto lo ve el navegador |
| `NEXT_PUBLIC_BOT_USERNAME` | Username del bot (`NorentyBot`), para generar enlaces `t.me/...` |
| `NEXT_PUBLIC_OSRM_URL` | Opcional — URL de OSRM si lo tienes levantado (ver §5) |
| `NEXT_PUBLIC_SENTRY_DSN` | Opcional, opt-in |

## 3. Arrancar el dashboard

```powershell
cd dashboard
npm install
npm run dev
```

Abre `http://localhost:3000`. Inicia sesión con `DEMO_EMAIL`/`DEMO_PASSWORD` (o crea tu propia
empresa desde el formulario de alta).

## 4. Arrancar el bot

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python run_bot.py
```

Por defecto arranca en modo **polling** (no necesita servidor público). El modo webhook se activa
solo si defines `BOT_WEBHOOK_URL` — no lo hagas en local, es para cuando exista un despliegue real
(pospuesto, ver ROADMAP §Despliegue).

Vincula tu chófer de prueba: en el dashboard, ficha del chófer → "Copiar enlace de alta" → ábrelo
en tu Telegram.

## 5. OSRM local (opcional — routing por carretera real)

Sin esto, todo funciona igual pero los km son una estimación en línea recta corregida (marcada
con "~" en toda la UI, nunca se presenta como exacta). Para tenerlo:

```powershell
cd infra/osrm
# Ver infra/osrm/README.md para la preparación (descargar+preprocesar el mapa de España, una vez)
docker compose up -d
```

## 6. Tests y CI

```powershell
.\ci.ps1
```

Corre, en este orden: pytest (backend), vitest (dashboard, incluye los smoke tests reales de 8.1
si tienes `.env`/`.env.local` con credenciales — se saltan solos si no), `next build`. **Debe
estar verde antes de cualquier commit "de verdad".**

## 7. Migraciones de base de datos

Dos caminos:

- **Con `DATABASE_URL` puesta** (ver §2, ya es el caso normal desde 2026-07-05):
  `python backend/db/migrate.py` aplica las pendientes; `python backend/db/migrate.py --check`
  solo lista el estado sin aplicar nada.
- **Sin `DATABASE_URL`** (p.ej. una máquina nueva sin la clave puesta todavía): aplicar cada `.sql`
  nuevo de `backend/db/migrations/` a mano vía el MCP de Supabase o el SQL Editor del panel, y
  registrar el checksum en `schema_migrations` — ver el preámbulo de `SPECS-7A.md` §0.1 para el
  procedimiento exacto con `hashlib`.

**Reversión de migraciones (ítem 9.16 — convención vigente desde 2026-07-05, no retroactiva)**:
toda migración nueva a partir de aquí debe documentar en su propia cabecera SQL cómo deshacerla si
hiciera falta (aunque sea "restaurar backup + replay de eventos posteriores" para migraciones de
solo lectura/índices, o el `DROP`/`ALTER` inverso exacto para las reversibles). No hay entorno de
staging real todavía (branching de Supabase no disponible en el plan actual, y un proyecto de
staging separado depende de la misma decisión que 9.1 — separar dev/prod — pospuesta hasta tener
el primer cliente piloto); mientras tanto, probar cada migración nueva contra la BD real de
desarrollo (nunca directo a "producción" sin más, aunque hoy solo exista un proyecto) y verificar
con una consulta real antes de darla por buena, mismo criterio que se ha seguido desde la 0031.

## 8. Sembrar datos de demo

```powershell
cd backend
.\.venv\Scripts\python db\seed_demo.py       # empresa demo con datos realistas (vehículos, chóferes, viajes...)
.\.venv\Scripts\python db\seed_parking_abierto.py  # dataset abierto de parkings (Fraunhofer/Zenodo, CC-BY 4.0)
```

Ambos son idempotentes (se pueden re-ejecutar) y pasan por RLS real con la sesión del gestor demo
— nunca usan la service role key para poblar datos, así validan las policies tal cual las usará
un cliente real.

## 9. Convenciones del repo

- **`ROADMAP.md`** es la fuente de verdad del backlog, organizado en fases con puertas (gates).
  `[LOOP]` = spec inequívoca, ejecutable sin criterio humano. `[DECISIÓN]` = necesita que un
  humano decida algo primero (una clave, un presupuesto, una regla de negocio).
- **`PROGRESS.md`** es un log append-only: una línea por ítem completado, con fecha, commit y
  resultado honesto (qué se hizo de verdad, qué quedó fuera de alcance).
- **`SPECS-7A.md`** tiene las especificaciones de implementación línea a línea de la Fase 7A —
  léelo antes de tocar cualquier ítem de esa fase, incluye las trampas ya sufridas (bootstrap de
  RLS, BOM de PowerShell rompiendo vitest, `order()` no-op en el mock de tests...).
- **Migraciones**: numeradas secuencialmente en `backend/db/migrations/00NN_nombre.sql`, nunca se
  editan una vez aplicadas — un cambio siempre es una migración nueva.
- **Seguridad de columnas**: desde la migración `0019`, RLS de fila NO es suficiente por sí sola
  en `gestor`/`chofer`/`ejecucion_evento`/`ubicacion` — hay `GRANT`/`REVOKE` a nivel de columna
  específicos. Si necesitas que el dashboard escriba un campo nuevo en esas tablas, revisa esa
  migración primero.
- **Nunca** despliegues, toques `[DECISIÓN]` sin confirmación, ni peguen claves/contraseñas en
  texto plano en una conversación con un asistente de IA — ábrelas tú mismo en los archivos.
