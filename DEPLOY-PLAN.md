# Plan de despliegue a producción real

Objetivo: que tus conocidos puedan entrar a `norenty.com` (o el subdominio que decidas), darse
de alta con su propia empresa (el flujo de registro **ya existe**, no hay que construirlo) y
usar el dashboard/bot de verdad, sin que dependa de tu portátil encendido.

Estado de partida: todo corre hoy contra un único proyecto de Supabase (mezcla dev/prod), el
dashboard solo se ha probado con `npm run dev` local, y el bot corre como proceso local en
long-poll. Nada de esto está desplegado.

---

## Fase 0 — Antes de invitar a nadie (obligatorio)

1. **9.1 — Proyecto Supabase de producción separado.** Crear un proyecto nuevo en Supabase
   (plan gratuito sirve para empezar — 500MB DB, 1GB Storage, cubre de sobra para unas pocas
   empresas piloto). Aplicar las 49 migraciones desde cero con `backend/db/migrate.py` apuntando
   al nuevo `DATABASE_URL`. **No copiar los datos de demo/dev** — el proyecto de producción
   empieza limpio, cada empresa se da de alta desde cero con datos reales o de prueba propios.
2. **Rotar credenciales para producción**: nuevas `SUPABASE_ANON_KEY`/`SUPABASE_URL` (públicas,
   van al build del dashboard), nueva `SUPABASE_SERVICE_ROLE_KEY`/`DATABASE_URL` (solo para el
   bot/scripts de backend, nunca en el dashboard). Mismo criterio de `RUNBOOK-SECRETS.md`:
   nunca en el repo, nunca pegadas en un chat.
3. **Activar Sentry** (10.4b) en el proyecto de producción — es mucho más importante tener esto
   ANTES de que usuarios reales lo usen que en dev, donde los errores los ves tú en consola.
4. **Repasar RLS/roles una vez más contra el proyecto de producción real** (no basta con que
   pasen los tests contra dev): correr `isolation.test.js`/`roles-isolation.test.js` apuntando
   al proyecto nuevo antes de invitar a nadie — son tests ya escritos, solo cambia el `.env`.

## Fase 1 — Hosting

**Dashboard (Next.js):** recomendado **Vercel** — es quien mantiene Next.js, cero configuración
para App Router/SSR, tier gratuito (Hobby) más que suficiente para un piloto con pocos usuarios,
y despliega automáticamente en cada `git push`. Alternativas (Netlify, Railway, self-host) son
peores encaje para Next.js específicamente sin motivo para elegirlas aquí.

- Conectar el repo de GitHub a Vercel (import project).
- Variables de entorno en el panel de Vercel (nunca en el repo): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `NEXT_PUBLIC_BOT_USERNAME`.
- Dominio: `norenty.com` → Vercel (ya lo tienes, ver memoria de sesiones anteriores: `.com` y
  `.es` en tu propiedad, `.es` pendiente de redirigir al `.com`). Configurar los registros DNS
  que pida Vercel (normalmente A/CNAME) desde donde tengas gestionado el dominio.

**Bot de Telegram (Python):** Vercel NO sirve para esto — es un proceso de larga duración
(long-poll o webhook con estado), no una función serverless. Opciones razonables:
- **Railway** o **Fly.io**: ambos tienen tier gratuito/muy barato para un proceso pequeño
  siempre encendido, despliegan desde el mismo repo, y dan un dominio HTTPS público gratis —
  necesario para activar el **modo webhook** que ya está construido (`BOT_WEBHOOK_URL`) en vez
  del long-poll actual (que es un single point of failure, ya anotado en el roadmap).
- Variables de entorno del bot ahí: `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `SENTRY_DSN`,
  `BOT_WEBHOOK_URL` (la URL pública que te da Railway/Fly).

**Supervisión de proceso:** Railway/Fly reinician el proceso solos si crashea (restart-policy
incluida) — cubre el ítem pendiente de "supervisión de proceso" del roadmap sin tener que
montar systemd/pm2 a mano.

## Fase 2 — Cron / tareas programadas en producción

Los scripts de `backend/db/` (`monitor_heartbeat.py`, `monitor_integridad.py`,
`purgar_ubicacion.py`) no tienen scheduler propio (documentado así a propósito, ver
`ONBOARDING.md §8b`). En producción, la opción más simple sin montar infraestructura nueva:
**GitHub Actions con `schedule:` (cron)** — el repo ya vive en GitHub, un workflow programado
cada 5-15 min que hace `python db/monitor_heartbeat.py` con los secrets de producción guardados
como GitHub Secrets. Gratis para repos con este volumen de uso, no depende de tu portátil.

## Fase 3 — Invitar a los primeros usuarios reales

1. Elegir 2-3 conocidos de máxima confianza primero (no todos a la vez) — si algo falla, que el
   radio de impacto sea pequeño y sepas exactamente a quién avisar.
2. Cada uno se da de alta con el flujo de registro existente (crea su propia empresa,
   aislada por RLS de las demás — ya verificado extensamente esta sesión).
3. Pedirles explícitamente que prueben con datos de mentira al principio (un par de viajes de
   prueba), no con clientes/chóferes reales, hasta que tengas una semana de uso sin sustos.
4. Vigilar Sentry + `panel_salud.py` a diario la primera semana.
5. Solo después de eso, plantear que alguno lo pruebe con datos reales de verdad (matriculas,
   chóferes reales) — y ahí sí entra en juego 9.11 (consulta legal RGPD) si van a meter datos
   personales de terceros (chóferes) en un sistema todavía no auditado formalmente.

## Fase 4 — Qué NO hacer todavía

- No anunciar esto públicamente ni ponerlo en redes — es un piloto cerrado con gente de
  confianza, no un lanzamiento.
- No migrar datos reales de ninguna empresa desde su Excel/TMS actual todavía — eso es un
  proyecto en sí mismo (mapeo de formato, ver `DISCOVERY-GESTOR.md` §4) para cuando haya
  confianza de que el producto aguanta.
- No activar WhatsApp/voz/agente telefónico en este piloto — son coste + complejidad
  adicionales que no hacen falta para validar si el dashboard en sí sirve.

---

## Checklist rápido antes de dar el primer acceso

- [ ] Proyecto Supabase de producción creado y con las 49 migraciones aplicadas
- [ ] Credenciales de producción generadas y guardadas fuera del repo
- [ ] Sentry activo (dashboard + bot) apuntando al proyecto de producción
- [ ] `isolation.test.js`/`roles-isolation.test.js` verificados contra producción
- [ ] Dashboard desplegado en Vercel, dominio `norenty.com` apuntando ahí
- [ ] Bot desplegado en Railway/Fly en modo webhook, `BOT_WEBHOOK_URL` configurada
- [ ] Cron de `monitor_heartbeat.py`/`monitor_integridad.py` corriendo vía GitHub Actions
- [ ] `RUNBOOK.md`/`RUNBOOKS.md` releídos con la infraestructura real en mente (no solo local)
