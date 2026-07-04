# Norenty — Runbook de rotación de secretos

Procedimiento operativo para rotar cada secreto de producción **sin ventana de caída**.
Tiempo estimado por secreto: 10-15 min.

**Principio fundamental:** en producción los secretos viven SOLO en los stores de entorno de
Railway (backend/bot) y Vercel (dashboard). El archivo `.env` local es exclusivamente para
desarrollo y está en `.gitignore` — nunca lo subas a git ni lo pegues en ningún chat.
Consulta [ONBOARDING.md §2](ONBOARDING.md) para saber qué variable va en cada archivo.
Consulta [DEPLOY.md §1-2](DEPLOY.md) para las instrucciones de despliegue completo.

---

## Tabla de secretos

| Secreto | Dónde se genera/rota | Quién lo consume | Criticidad |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | bot/backend (`backend/app/db.py:8`) | **CRÍTICA** — salta RLS; rotar ante cualquier sospecha |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API | bot/backend (fallback en `backend/app/db.py:8`) | Alta |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | dashboard (`dashboard/lib/supabase.js:4`) | Alta — es pública pero expone el endpoint del proyecto |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | dashboard (`dashboard/lib/supabase.js:3`) | Media — URL pública, pero identifica el proyecto |
| `TELEGRAM_BOT_TOKEN` | @BotFather en Telegram | bot (`backend/app/bot.py:34`) | **CRÍTICA** — quien la tiene controla el bot; rotar ante cualquier sospecha |
| `BOT_WEBHOOK_SECRET` | Generado localmente (ver §6) | `backend/run_bot.py:31` | Alta — solo en producción con modo webhook activo |
| `SENTRY_DSN` | Panel de Sentry → proyecto Python | bot (`backend/app/bot.py:13`) | Baja — opt-in, inerte si vacía |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` | Panel de Sentry → proyecto Next.js | dashboard (`dashboard/sentry.client.config.js:3`, `sentry.server.config.js:3`) | Baja — opt-in, inerte si vacía |
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string → URI | `backend/db/migrate.py:43` | Media — hoy vacía (`[DECISIÓN D2]`); activar cuando se resuelva |
| Claves de proveedores LLM (futuro) | Panel del proveedor (Anthropic, OpenAI…) | Fase 7B — no existe aún | Alta cuando se usen |

---

## Procedimiento genérico (aplica a todos los secretos)

El orden importa: **primero el nuevo valor existe en todos los sitios** → luego se retira el
viejo. Nunca al revés: borrar primero causaría caída inmediata.

1. **Generar el nuevo secreto** en el panel correspondiente (detalles por secreto abajo).
2. **Actualizar en el store del entorno de producción:**
   - Railway (backend/bot): Service → Variables → editar la variable, pegar el valor nuevo.
   - Vercel (dashboard): Project → Settings → Environment Variables → editar, pegar.
   - `.env` local (desarrollo): editar el archivo manualmente.
3. **Redeploy / reinicio:**
   - Railway: tras guardar la variable, hacer "Redeploy" del servicio. El proceso anterior
     sigue vivo hasta que el nuevo arrange — no hay ventana de caída.
   - Vercel: cualquier cambio de variable de entorno dispara un redeploy automático, o
     lánzalo manualmente desde "Deployments → Redeploy".
4. **Verificar que el sistema sigue vivo:**
   - Bot: en el dashboard (`/ajustes`), el campo "Estado del bot" debe mostrar "activo" en
     los primeros 2 min (heartbeat de `bot_heartbeat`, ítem 8.3). Alternativamente, mandar
     `/estado` al bot desde Telegram con un chófer de prueba.
   - Dashboard: abrir la home (`/`), confirmar que carga sin errores en consola del navegador.
5. **Revocar el secreto viejo** en el panel de origen (Supabase, BotFather, Sentry). Solo
   después de confirmar que el nuevo funciona.
6. **Anotar en `PROGRESS.md`** la fecha y qué se rotó (sin incluir el valor).

---

## §1 — `SUPABASE_SERVICE_ROLE_KEY`

**La clave más sensible del sistema.** Salta RLS: cualquiera que la tenga puede leer y
escribir datos de TODAS las empresas. Rotar ante la mínima sospecha de exposición.

**Estado actual:** hoy está VACÍA en `.env` local (`[DECISIÓN D1]` del roadmap). Sin ella, el
bot en vivo no puede escribir con RLS activo. Esto es un bug crítico conocido; ver ROADMAP
§Fase 8 Bloque A. Una vez se pegue la clave real, este runbook aplica para rotarla.

**Dónde se genera:** Supabase → [tu proyecto] → Project Settings → API → sección
"Project API keys" → fila "service_role" → botón "Reveal" / "Reset".

**Quién la consume:** `backend/app/db.py:8`:
```python
_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_ANON_KEY"]
```
Si la variable está vacía o no definida, el bot cae silenciosamente a la `SUPABASE_ANON_KEY`,
que con RLS activo no puede hacer nada útil (bug conocido — las queries fallan en runtime).

**Orden de rotación sin caída:**
1. En Supabase, generar la nueva clave (el panel crea una nueva sin invalidar la actual).
2. Actualizar `SUPABASE_SERVICE_ROLE_KEY` en Railway (Variables del servicio backend/bot).
3. Redeploy del servicio en Railway.
4. Verificar heartbeat del bot en `/ajustes` del dashboard.
5. Una vez confirmado: revocar la clave vieja en Supabase (si el panel lo permite; si no,
   el cambio ya ha surtido efecto porque la app usa la nueva).

**Nota de seguridad:** esta clave nunca debe aparecer en el dashboard (`.env.local`), en logs,
en mensajes de Telegram, ni en ningún chat. Si sospechas que se filtró, rótala antes de
investigar la causa.

---

## §2 — `SUPABASE_ANON_KEY` (backend)

Clave pública que respeta RLS. El bot la usa como fallback cuando no hay service role key
(pero con RLS activo, el bot apenas puede operar con ella — su función real es para llamadas
sin autenticar o de baja sensibilidad).

**Dónde se genera:** Supabase → Project Settings → API → "anon public" → "Reveal" / "Reset".

**Quién la consume:** `backend/app/db.py:8` (fallback).

**Orden de rotación sin caída:** mismo procedimiento genérico §0. No es necesario revocar
la vieja de inmediato — la anon key es pública por diseño.

---

## §3 — `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `NEXT_PUBLIC_SUPABASE_URL` (dashboard)

Visibles en el navegador (prefijo `NEXT_PUBLIC_`). No las confundas con la service role key.

**Dónde se generan:** Supabase → Project Settings → API. La URL no cambia salvo que muevas
el proyecto; la anon key puede rotarse igual que en §2.

**Quién las consume:** `dashboard/lib/supabase.js:3-4`:
```js
const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
```

**Orden de rotación sin caída:**
1. Actualizar ambas variables en Vercel (Environment Variables → Production + Preview).
2. El redeploy de Vercel es automático o lanzarlo manualmente.
3. Verificar que el dashboard carga y permite login.
4. Revocar la clave vieja en Supabase si procede.

**Nota:** si rotas la anon key del backend (§2), rota esta también — son la misma clave.

---

## §4 — `TELEGRAM_BOT_TOKEN`

**La segunda clave más sensible.** Quien la tenga puede enviar y recibir mensajes en nombre
del bot, suplantar respuestas a los chóferes y leer todo el historial. Rotar ante cualquier
sospecha.

**Dónde se genera/rota:** en Telegram, hablar con **@BotFather** → `/mybots` → seleccionar
`@NorentyBot` → "API Token" → "Revoke current token". BotFather genera uno nuevo
inmediatamente; el viejo queda inválido al instante.

**Quién la consume:** `backend/app/bot.py:34`:
```python
TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
```

**Orden de rotación sin caída:**
1. En @BotFather, revocar y obtener el nuevo token (operación instantánea en BotFather).
2. Actualizar `TELEGRAM_BOT_TOKEN` en Railway ANTES de que el servicio actual se caiga.
3. Redeploy en Railway.
4. Verificar heartbeat + mandar un comando de prueba al bot.

**Advertencia:** a diferencia de Supabase, BotFather revoca el token viejo en el mismo paso
que genera el nuevo. El servicio actual usará el token viejo hasta que Railway termine el
redeploy — hay una ventana de unos segundos/minutos en que el bot no puede enviar mensajes
(puede recibir updates pero las respuestas fallan). Es la ventana mínima inevitable; no hay
forma de tener dos tokens activos a la vez en Telegram. Minimízala haciendo el redeploy de
Railway inmediatamente después.

---

## §5 — `BOT_WEBHOOK_SECRET`

Solo relevante en producción con modo webhook activo (`BOT_WEBHOOK_URL` definida). En
desarrollo con polling, esta variable no se usa.

Telegram reenvía este secreto en cada request webhook como cabecera
`X-Telegram-Bot-Api-Secret-Token`; el bot lo valida para rechazar requests falsos.
Ver `backend/run_bot.py:31`.

**Dónde se genera:** no hay un panel externo — lo generas tú. Debe ser una cadena
impredecible de al menos 32 caracteres:
```powershell
# PowerShell — genera 32 bytes aleatorios en hex
[System.Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }))
```
O en Python: `import secrets; print(secrets.token_urlsafe(32))`.

**Orden de rotación sin caída:**
1. Generar el nuevo secreto localmente.
2. Actualizar `BOT_WEBHOOK_SECRET` en Railway.
3. Llamar a la API de Telegram para registrar el nuevo secreto junto al webhook:
   `setWebhook` con el nuevo `secret_token` (ver DEPLOY.md §2). El webhook sigue
   funcionando con el secreto viejo hasta que Telegram actualice su registro — hay una
   ventana breve donde los requests llevan el viejo secreto pero el bot ya espera el nuevo
   (el bot rechazaría esos requests). Para minimizarla: hacer el redeploy de Railway y
   la llamada a `setWebhook` en el menor tiempo posible.
4. Verificar heartbeat.

---

## §6 — `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`

Opt-in. Si no están definidas, Sentry simplemente no se inicializa — la app funciona igual.

**Dónde se generan:** panel de Sentry → tu proyecto Python (bot) o Next.js (dashboard) →
Settings → Client Keys (DSN).

**Quién las consume:**
- Bot: `backend/app/bot.py:13` (`SENTRY_DSN`).
- Dashboard cliente: `dashboard/sentry.client.config.js:3` (`NEXT_PUBLIC_SENTRY_DSN`).
- Dashboard servidor: `dashboard/sentry.server.config.js:3` (intenta `SENTRY_DSN` primero,
  luego `NEXT_PUBLIC_SENTRY_DSN`).
- Build: `dashboard/next.config.js:44` (comprueba si alguna está definida para activar el
  plugin de Sentry durante el build).

**Orden de rotación sin caída:** crear un nuevo DSN en Sentry → actualizar en Railway/Vercel →
redeploy → verificar que llega un evento de prueba al nuevo proyecto de Sentry → archivar el
DSN viejo.

---

## §7 — `DATABASE_URL`

Hoy vacía (`[DECISIÓN D2]` pendiente). Usada solo por `backend/db/migrate.py:43` para aplicar
migraciones y para backups con `pg_dump`. Sin ella, las migraciones se aplican vía MCP de
Supabase o el SQL Editor del panel (ver ONBOARDING.md §7).

**Dónde se obtiene:** Supabase → Project Settings → Database → "Connection string" → URI.
Incluye la contraseña del usuario `postgres` — trátala con el mismo nivel de sensibilidad que
la service role key (acceso directo a Postgres sin pasar por RLS).

**Orden de rotación sin caída:** la contraseña de `postgres` se cambia en Supabase →
Project Settings → Database → "Database password" → "Reset database password". Tras el reset:
1. Actualizar `DATABASE_URL` con la nueva contraseña en el store de Railway (si se usa desde
   el servicio desplegado para migraciones o backups programados).
2. Actualizar el `.env` local.
3. Verificar que `migrate.py --check` conecta sin error.

---

## §8 — Claves de proveedores LLM (futuro — Fase 7B)

Cuando se aprueben los ítems de presupuesto LLM (D3 / 7B.1 voz Whisper, 7B.2 triaje AI,
7B.3 agente telefónico), el proyecto usará claves de proveedores como Anthropic o OpenAI.
Los `.env` y `ONBOARDING.md` ya tienen los huevos `ANTHROPIC_API_KEY` y `OPENAI_API_KEY`
preparados (hoy vacíos).

El procedimiento de rotación será el mismo de este runbook: generar nueva clave en el panel
del proveedor → actualizar en Railway → redeploy → verificar → revocar la vieja.

**Sensibilidad:** una clave de LLM filtrada puede generar costes ilimitados en segundos.
Configurar **alertas de presupuesto** en el panel del proveedor antes de activar cualquier
integración LLM de producción.

---

## Cuándo rotar sin esperar al mantenimiento programado

Rotar inmediatamente (no esperar) si:

- Se detecta un acceso no autorizado o anómalo en los logs de Supabase o Sentry.
- Se confirma o sospecha que una clave fue expuesta en código, en un chat, en un log público
  o en cualquier sitio fuera del store de entorno.
- Un colaborador con acceso a las claves deja el proyecto.
- Telegram o Supabase notifican una brecha de seguridad en su plataforma.

Los tokens de Telegram y las service-role keys de Supabase son los dos secretos que se
filtran con más frecuencia (Telegram por commits accidentales, Supabase por capturas de
pantalla o logs). Si la duda existe, el coste de rotar es 15 minutos; el coste de no rotar
puede ser irreversible.
