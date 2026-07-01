# Norenty — Roadmap

Fuente de verdad del backlog. Estructurado en **fases con puertas (gates)**: no se avanza a
una fase hasta cerrar la anterior. El loop autónomo lee este archivo + `PROGRESS.md`, coge el
primer ítem sin marcar de la fase abierta de mayor prioridad, lo implementa, lo verifica de
verdad, hace commit y lo marca `[x]`.

Etiquetas: `[DECISIÓN]` = requiere criterio humano, el loop NO lo implementa (lo deja anotado en
PROGRESS.md y sigue). `[LOOP]` = spec inequívoca, el loop puede hacerlo solo.

---

## Hecho (M1–M3)

- Bot Telegram: vinculación chófer, navegación (Maps/Waze), confirmación llegada, foto POD, `/incidencia`
- Dashboard: Kanban, mapa (Leaflet), listado/detalle viajes, chóferes, vehículos, plantillas, importador Excel/CSV, ajustes, auth
- Alertas Telegram al gestor + notificaciones in-app
- Validaciones de negocio (sin doble asignación, referencias/matrículas únicas, ventanas)
- Seguridad: RLS `authenticated`, bucket POD sin listado público, SECURITY DEFINER cerrada, índices FK
- Responsive móvil, exportar CSV, 404, favicon

---

## Fase 0 — Decisión de producto (CERRADA ✓)

- [x] **Modelo de negocio: SaaS multi-cliente** (decidido 2026-06-30). Muchas flotas, cada una ve solo sus datos. Construir tenancy correcta desde ya: toda query scoped por `empresa_id`, RLS forzando aislamiento por empresa del gestor logueado. UI de gestión de organización (alta de nuevas empresas, invitaciones de gestores) se difiere — el modelo de datos por debajo ya debe ser correcto.

## Fase 1 — Fundaciones (GATE: no pasar a Fase 2 sin cerrar esto)

- [x] **Tenancy correcta** (2026-06-30) — `getDefaultEmpresaId()` eliminado, sustituido por `getCurrentEmpresaId()` (resuelve sesión→gestor→empresa). Signup ahora crea una empresa nueva por gestor (antes enganchaba a "la primera"). RLS real por empresa en 13 tablas vía `current_empresa_id()`. Pendiente conocido: bucket POD público sin URLs firmadas (añadido a Fase 3).
- [x] **Integridad auth→gestor→empresa** (2026-06-30) — resuelto como parte del ítem de tenancy: signup crea empresa propia, sin invitaciones todavía (diferido, no bloqueante).
- [x] **Harness de tests** (2026-06-30) — 16 tests pytest (backend: `verificar_hito_pertenece_a_chofer` incl. caso de seguridad, `get_chofer_by_chat`, `nav_buttons`, `build_hito_message`, con `tests/fakes.py` fake de Supabase) + 18 tests vitest (dashboard: `validarAsignacion`, `validarCambioEstado`, `getCurrentEmpresaId`, con mock de query builder en memoria en `data.test.js`). 34/34 verde.
- [x] **CI local mínimo** (2026-06-30) — `ci.ps1` en la raíz: pytest + vitest + `next build`. Exit code 0/1. El loop debe correrlo antes de cada commit de "trabajo terminado".

## Fase 2 — Features

### Loop-safe (spec inequívoca)
- [x] **Vincular Telegram del gestor** (2026-06-30) — `t.me/NorentyBot?start=gestor_<id>` distingue de código de chófer por prefijo. Bot: `vincular_gestor()` con 5 tests (no encontrado, éxito, ya vinculado a otro chat, re-vincular mismo chat es idempotente, enrutado desde `cmd_start`). UI en Ajustes: sección "Alertas por Telegram" con copiar enlace, estado vinculado/sin vincular.
- [x] `[LOOP]` **Loading states + anti-doble-clic** en botones async (validar POD, cambiar estado incidencia). (2026-06-30)
- [x] `[LOOP]` **Localización real del bot** — TEXTOS dict 8 idiomas (es/en/ro/fr full, ar/it/pt/de=en stub) + helper `t(chofer, key)`. 33 tests. (2026-06-30)
- [x] `[LOOP]` **Paginación** incidencias (20/página + Ver más) y viajes lista (50/página + Ver más con filtro servidor). (2026-06-30)
- [x] `[LOOP]` **Página detalle de chófer** (`/choferes/[id]`): historial viajes paginado, valoraciones recientes, estado vinculación Telegram, copiar enlace. (2026-06-30)
- [x] `[LOOP]` **Mantenimiento/averías de vehículo** — tabla `mantenimiento_vehiculo` con RLS + CRUD en `/vehiculos/[id]` (tipos: ITV/revisión/avería/reparación/otro, fecha, km, coste, estado pendiente/completado). (2026-06-30)

### Necesitan decisión (NO autónomo)
- [ ] `[DECISIÓN]` **Panel analítica/KPIs** — qué métricas exactas y para quién.
- [ ] `[DECISIÓN]` **Validación POD con visión LLM** — cuesta dinero por uso; requiere rate-limit + presupuesto definidos ANTES de construir.
- [ ] `[DECISIÓN]` **Voz en el bot (Whisper/TTS)** — coste por uso; ¿lo piden los chóferes de verdad?
- [ ] `[DECISIÓN]` **Drag-and-drop Kanban** — decisión de UX.

## Fase 3 — Hardening (pre-deploy)

- [x] `[LOOP]` **Bucket POD privado + URLs firmadas** — descubierto en Fase 1: el bucket `pods` es público, así que sirve fotos por URL directa sin pasar por RLS. Cualquiera con la URL exacta (aunque sea de otra empresa) puede verla. Arreglo: bucket privado + `createSignedUrl()` con expiración corta al renderizar cada `pod.foto_url`. (2026-06-30: bucket privado, policy de storage RLS por empresa, ruta `{empresa_id}/{viaje_id}/{hito_id}/...`, componente `PodImage` con signed URL.)
- [x] `[LOOP]` **Observabilidad**: error-tracking (Sentry o equivalente) en bot y dashboard. (2026-06-30: `sentry-sdk` en el bot y `@sentry/nextjs` en el dashboard, ambos opt-in vía `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`, inertes si no hay DSN.)
- [x] `[DECISIÓN]` **Bot en modo webhook + supervisión de proceso** (hoy long-poll, single point of failure). Decidido 2026-06-30: usar webhook. Código listo (`run_bot.py` soporta ambos modos vía `BOT_WEBHOOK_URL`); activación real pendiente de tener un endpoint HTTPS público, lo que depende de Despliegue (pospuesto). Supervisión de proceso (systemd/pm2/Docker restart-policy) también pendiente de Despliegue.
- [x] `[LOOP]` **Disciplina de migraciones**: runner ordenado y reproducible, no ad-hoc por MCP. (2026-06-30: `backend/db/migrate.py`, tabla `schema_migrations` con checksum por archivo; las 0001-0011 ya aplicadas se registraron como backfill.)

---

## Fase 4 — Features de valor (ABIERTA, loop-safe; specs cerradas con usuario 2026-06-30)

Todos `[LOOP]`: sin coste por uso, sin deploy. Construir EN ORDEN. Cada ítem: implementar → `ci.ps1` verde → commit → marcar `[x]` + 1 línea en `PROGRESS.md`. Las migraciones nuevas se aplican vía MCP Supabase (`apply_migration`/`execute_sql`), se guarda el `.sql` en `backend/db/migrations/` y se registra en `schema_migrations` con su checksum.

- [x] `[LOOP]` **4.1 Botones de acción rápida en el bot** — Menú persistente (`ReplyKeyboardMarkup`) para el chófer con: "📍 Reportar incidencia", "📋 Mi viaje", "📞 Contactar gestor". "Reportar incidencia" enruta al flujo de `/incidencia` existente; "Mi viaje" muestra hito/estado actual (como `/estado`); "Contactar gestor" devuelve nombre/teléfono del gestor de la empresa del chófer (si no hay, mensaje "tu gestor aún no ha configurado contacto"). Textos con `t()`. Tests del enrutado. Sin tablas nuevas. (2026-07-01: nota — la tabla `gestor` no tiene campo teléfono, se usa email como contacto; teclado se adjunta al mensaje de vinculación exitosa del chófer.)

- [x] `[LOOP]` **4.2 Registro documental — base + viaje** — Migración `0012_documentos.sql`: tabla `documento(id uuid PK, empresa_id uuid FK empresa, ambito text CHECK in ('viaje','vehiculo','chofer'), entidad_id uuid NOT NULL, tipo text NOT NULL, fecha_emision date, fecha_caducidad date, archivo_url text, estado text DEFAULT 'vigente' CHECK in ('vigente','caducado','pendiente'), notas text, created_at timestamptz DEFAULT now())`, RLS `empresa_id = current_empresa_id()` (ALL, USING + WITH CHECK). Bucket privado nuevo `documentos` + policy storage por empresa (mismo patrón que `pods`: `(storage.foldername(name))[1] = current_empresa_id()::text`). Ruta de subida: `{empresa_id}/{ambito}/{entidad_id}/{uuid}.{ext}`. UI en `/viajes/[id]`: sección "Documentos" — subir (tipo CMR/albarán/ADR/otro, fechas, archivo), listar con enlace "ver/descargar" vía `createSignedUrl` (¡soporta PDF e imagen! no asumir `<img>`), borrar. (2026-07-01)

- [x] `[LOOP]` **4.3 Documentos de vehículo y chófer** — Reutiliza tabla `documento` y bucket. Extraer la UI de 4.2 a un componente reutilizable `DocumentosSection({ ambito, entidadId })`. En `/vehiculos/[id]`: ámbito 'vehiculo', tipos ITV/seguro/autorización de transporte/otro. En `/choferes/[id]`: ámbito 'chofer', tipos licencia/CAP/otro. Sin migración nueva. (2026-07-01: construido junto a 4.2 — el componente reutilizable se hizo directamente reutilizable desde el principio en lugar de extraerlo después.)

- [x] `[LOOP]` **4.4 Alertas de caducidad + vista "por caducar"** — Página/sección `/documentos`: lista documentos con `fecha_caducidad` en los próximos 30 días o ya caducados, ordenados por urgencia, con enlace a su entidad. Badge "caduca pronto/caducado" en los detalles. Reutilizar el sistema de alertas al gestor existente (Telegram + in-app) para avisar de documentos por caducar. Sin coste. (2026-07-01: página `/documentos` + `getDocumentosPorCaducar()` en `lib/data.js` con tests. In-app: integrado en `NotificationCenter`. Telegram: NO implementado — requeriría un job programado que revise caducidades periódicamente, y hoy no existe infraestructura de cron/scheduler en el proyecto; construirla ahora sería infra nueva fuera del alcance "sin deploy" de esta fase. El aviso in-app + la página dedicada cubren el caso de uso mientras tanto; la parte Telegram queda pendiente para cuando haya un runner programado, algo natural de resolver junto al despliegue.)

- [ ] `[LOOP]` **4.5 Vistas de métricas preset** — Página `/analitica` con selector entre 4 vistas, todo scoped por empresa: (1) **Puntualidad**: % entregas dentro de ventana, tendencia, peores rutas; (2) **Incidencias**: total + tasa, por tipo/chófer/vehículo; (3) **Rendimiento de chóferes**: viajes, valoración media, incidencias, % puntualidad; (4) **Flota**: utilización, ITV/mantenimiento próximos, averías recientes. Presentación: tarjetas numéricas + tablas + barras CSS simples (SIN librería de gráficos nueva). Funciones de agregación en `lib/data.js` con tests. (Selector de KPIs custom: diferido, fuera de scope.)

- [ ] `[LOOP]` **4.6 Abstracción de la capa de mensajería** — Refactor de `bot.py`: separar la lógica de negocio de las llamadas concretas a la API de Telegram con una fina interfaz de transporte/notificador (enviar texto, enviar con botones, enviar foto), para que un adaptador WhatsApp sea factible luego sin reescribir. Tests existentes siguen verdes; NO cambia comportamiento. Sin tablas nuevas.

### Production-gated — NO en el loop nocturno (coste por uso o deploy)
- [ ] `[DECISIÓN]` **Notas de voz → transcripción (Whisper)** — la fontanería (capturar/guardar nota de voz) sería loop-safe, pero la transcripción cuesta dinero → requiere rate-limit + presupuesto ANTES. Es el 80/20 del agente de voz; primer candidato cuando haya presupuesto.
- [ ] `[DECISIÓN]` **Agente de voz telefónico** — telefonía + STT/LLM/TTS en tiempo real; coste por minuto + producción.
- [ ] `[DECISIÓN]` **Validación POD con visión LLM** — coste por imagen; a producción.
- [ ] `[DECISIÓN]` **Adaptador WhatsApp** — Meta Business API, coste por conversación, la ventana de 24h rompe el push proactivo; decisión GTM. La abstracción (4.6) deja el terreno preparado.
- [ ] `[DECISIÓN]` **Aprendizaje sobre conversaciones (chófer↔gestor, notas internas jefe tráfico/GM)** — decidido con el usuario 2026-07-01: interesante PERO explícitamente para DESPUÉS del despliegue, cuando haya volumen real de conversaciones que analizar (hoy no hay datos de producción). Lectura recomendada cuando se retome: (A) extracción de patrones vía llamadas puntuales a LLM sobre texto libre (clasificar incidencias, detectar clientes/rutas problemáticas, temas recurrentes) — coste acotado por uso, no requiere entrenar nada; (B) modelo que se re-entrena/mejora con el tiempo — proyecto mayor, requiere pipeline de datos y presupuesto serio, no es el punto de partida. Empezar por (A) si/cuando se retome. Cuesta dinero por uso → requiere rate-limit + presupuesto antes de construir, igual que el resto de esta sección.

---

## Despliegue (POSPUESTO — no tocar sin confirmación explícita)

GitHub → Vercel (dashboard) → Railway (backend) → dominio norenty.com vía Cloudflare.

---

## Protocolo del loop autónomo (optimizado para tokens / operación prolongada)

**Principio: cada iteración es STATELESS.** No depende del historial de conversación, solo de
`ROADMAP.md` + `PROGRESS.md`. Esto es lo que permite trabajar a lo largo del día sin arrastrar
(ni pagar) un contexto gigante.

Cada despertar:
1. Leer `ROADMAP.md` + el final de `PROGRESS.md`. Nada más de memoria.
2. Coger el **primer ítem `[ ]` de la fase abierta de mayor prioridad**. No saltar de fase (gates).
3. Si es `[DECISIÓN]`: NO implementar. Anotar en `PROGRESS.md` (`BLOQUEADO: <ítem> — necesita: <qué>`) y pasar al siguiente `[LOOP]`, o dormir si no hay ninguno.
4. Implementar UN ítem. Leer solo los archivos necesarios. `Edit` antes que reescribir.
5. **Verificar de verdad**: correr el test relevante; si es UI, comprobar el comportamiento concreto, no solo 200.
6. Commit con mensaje claro. Marcar `[x]` aquí + 1 línea en `PROGRESS.md` (`<fecha> | <ítem> | <commit> | <resultado>`).
7. Tras 3 fallos seguidos en el mismo ítem o si hay presión de cuota: parar, anotar `NECESITA HUMANO`, dormir más largo.
8. Dormir con `ScheduleWakeup`, 1500–1800s por defecto. Nunca <300s (desperdicia caché).

**Tiering de modelos** (el orquestador se mantiene barato por ser stateless):
- Mecánico/repetitivo → subagente `model: haiku`.
- Seguridad/arquitectura/bug difícil → subagente `model: opus`.
- Delegar la EXPLORACIÓN de código a subagentes para que el hilo principal no se llene de contenido de archivos.

**STOPS duros (nunca en autónomo):** desplegar, features que gastan dinero (LLM visión/voz sin
rate-limit+presupuesto), cambios de esquema destructivos, cualquier `[DECISIÓN]`.
