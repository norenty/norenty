# Norenty — Checklist de despliegue

**Este documento es solo un checklist. Desplegar es una decisión explícita del usuario
(`[DECISIÓN D4]`) — nadie ejecuta nada de esto sin luz verde dada en el momento, ni siquiera
habiendo leído este archivo.** Arquitectura decidida: GitHub → Vercel (dashboard) → Railway
(backend/bot) → dominio `norenty.com` vía Cloudflare.

## 0. Antes de nada

- [ ] `[DECISIÓN D1]` `SUPABASE_SERVICE_ROLE_KEY` real puesta y probada contra el bot en local.
- [ ] `[DECISIÓN D4]` luz verde explícita del usuario para ESTA sesión de despliegue concreta.
- [ ] `ci.ps1` verde en el commit exacto que se va a desplegar.
- [ ] Repaso de advisors de Supabase corrido y sin sorpresas (ítem 8.7 — repetir si ha pasado
  tiempo desde la última vez).

## 1. Dashboard → Vercel

1. Conectar el repo de GitHub a un proyecto nuevo de Vercel, root directory `dashboard/`.
2. Variables de entorno en Vercel (Production + Preview, ver `ONBOARDING.md` §2 para el detalle
   de cada una):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_BOT_USERNAME`
   - `NEXT_PUBLIC_OSRM_URL` (apuntando al OSRM de producción — ver §3 más abajo, NO a localhost)
   - `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` (si hay Sentry)
3. Dominio: añadir `norenty.com` (o subdominio, p.ej. `app.norenty.com`) en Vercel → Domains, y
   apuntar el DNS en Cloudflare (registro CNAME/A que indique Vercel al añadir el dominio).
4. **CSP a "enforcing"**: en `dashboard/next.config.js`, la cabecera hoy es
   `Content-Security-Policy-Report-Only` (registra violaciones, no bloquea nada — ítem 6.6).
   Antes de promoverla:
   - Dejar el Report-Only corriendo en producción **al menos una semana** revisando la consola del
     navegador / los reportes de Sentry en busca de violaciones inesperadas.
   - Si no hay sorpresas, renombrar la cabecera a `Content-Security-Policy` (mismo valor,
     `CSP_REPORT_ONLY` en el código) para que empiece a bloquear de verdad.

## 2. Backend/bot → Railway

1. Nuevo servicio en Railway apuntando a `backend/` del repo.
2. Variables de entorno (mismas que `.env`, ver `ONBOARDING.md` §2):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (la real, no la anon — el bot necesita saltar RLS),
   `TELEGRAM_BOT_TOKEN`, `SENTRY_DSN`, y si aplican `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`.
3. **Activar modo webhook del bot** (hoy corre en polling, ver `backend/run_bot.py`):
   - `BOT_WEBHOOK_URL` = la URL pública de Railway para este servicio.
   - `BOT_WEBHOOK_SECRET` = un secreto nuevo, generado para esta puesta en producción (no
     reutilizar nada de dev). Telegram lo reenvía en cada petición para verificar el origen.
   - `BOT_WEBHOOK_PORT` (por defecto 8443) / `BOT_LISTEN` (por defecto 0.0.0.0) según lo que
     Railway exponga.
4. Supervisión de proceso: Railway reinicia el servicio solo si crashea (restart policy nativa) —
   confirmar que está configurada como "always restart", no "never".
5. Verificar que `HEARTBEAT_INTERVAL_S` (bot.py, ítem 8.3) sigue latiendo tras el despliegue —
   comprobar en `/ajustes` del dashboard que "Estado del bot" pasa a activo en los primeros 2 min.

## 3. OSRM en producción

Hoy OSRM es infraestructura de desarrollo (`infra/osrm/docker-compose.yml`, ver su README).
Para producción:
1. Decidir dónde se hostea (un servicio Docker en Railway/Fly.io/una VM — necesita RAM suficiente
   para el extracto de España cargado en memoria).
2. Repetir el preprocesado del mapa (`infra/osrm/README.md` §Preparación) en el entorno de
   producción — el `.osm.pbf` no se versiona ni se copia, se regenera.
3. Apuntar `NEXT_PUBLIC_OSRM_URL` (Vercel) a la URL pública de ese servicio.
4. Si no se hace en el primer despliegue: no pasa nada, todo el sistema ya tiene el fallback
   Haversine×1.3 marcado como estimado (`estimado: true` en toda la UI) — es una degradación
   aceptable para un primer piloto, no un bloqueante.

## 4. Sentry (opcional pero recomendado antes de un piloto real)

- Crear un proyecto en Sentry para el dashboard (Next.js) y otro para el bot (Python).
- `SENTRY_DSN` (bot) / `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` (dashboard) en las variables de
  entorno de Railway/Vercel respectivamente.
- Confirmar que llega un evento de prueba a cada proyecto antes de dar por bueno el despliegue
  (forzar un error controlado y verlo aparecer).

## 5. Smoke tests post-deploy (no confiar en "arrancó sin errores")

1. Contra el dashboard desplegado: login con la empresa demo, crear un viaje, asignar chófer,
   confirmar que el Kanban/Operación/Analítica cargan sin errores en consola.
2. Contra el bot desplegado: vincular un chófer de prueba real por Telegram, confirmar que
   `/estado` responde y que una confirmación de llegada se refleja en el dashboard en segundos.
3. Correr `dashboard/lib/smoke.test.js` y `dashboard/lib/isolation.test.js` (ítems 8.1/8.4) **apuntando
   a las variables de entorno de producción** (no solo en local) — si pasan contra producción,
   confirma que las funciones de lectura reales y el aislamiento multi-tenant siguen intactos
   después del despliegue, no solo en desarrollo.
4. Portal público (7A.14): generar un enlace de seguimiento de un viaje de prueba, abrirlo en una
   ventana de incógnito (sin sesión) y confirmar que carga.
5. **Rate-limit del endpoint público** (`/rest/v1/rpc/viaje_publico`, ítem 8.5): configurar en
   Cloudflare/Vercel antes de anunciar el portal de cliente a ningún cliente real — es anónimo por
   diseño, necesita protección de infra contra abuso, no solo el token impredecible+caducidad.

## 6. Después del despliegue

- [ ] Actualizar este documento con cualquier paso que haya sido distinto en la práctica.
- [ ] Anotar en `PROGRESS.md` la fecha y el resultado del despliegue.
- [ ] Revisar `RUNBOOK.md` — con el proyecto ya en producción, es el momento de resolver
  `[DECISIÓN D2]` (`DATABASE_URL`) y activar backups reales, no solo confiar en los automáticos.
