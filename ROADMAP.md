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
- [ ] `[LOOP]` **Loading states + anti-doble-clic** en botones async (validar POD, cambiar estado incidencia).
- [ ] `[LOOP]` **Localización real del bot** — textos por `chofer.idioma`, no hardcode español.
- [ ] `[LOOP]` **Paginación** en notificaciones e incidencias.
- [ ] `[LOOP]` **Página detalle de chófer** (historial viajes, valoraciones, estado vinculación).
- [ ] `[LOOP]` **Mantenimiento/averías de vehículo** — tabla + CRUD (ITV, revisiones, averías).

### Necesitan decisión (NO autónomo)
- [ ] `[DECISIÓN]` **Panel analítica/KPIs** — qué métricas exactas y para quién.
- [ ] `[DECISIÓN]` **Validación POD con visión LLM** — cuesta dinero por uso; requiere rate-limit + presupuesto definidos ANTES de construir.
- [ ] `[DECISIÓN]` **Voz en el bot (Whisper/TTS)** — coste por uso; ¿lo piden los chóferes de verdad?
- [ ] `[DECISIÓN]` **Drag-and-drop Kanban** — decisión de UX.

## Fase 3 — Hardening (pre-deploy)

- [ ] `[LOOP]` **Bucket POD privado + URLs firmadas** — descubierto en Fase 1: el bucket `pods` es público, así que sirve fotos por URL directa sin pasar por RLS. Cualquiera con la URL exacta (aunque sea de otra empresa) puede verla. Arreglo: bucket privado + `createSignedUrl()` con expiración corta al renderizar cada `pod.foto_url`.
- [ ] `[LOOP]` **Observabilidad**: error-tracking (Sentry o equivalente) en bot y dashboard.
- [ ] `[DECISIÓN]` **Bot en modo webhook + supervisión de proceso** (hoy long-poll, single point of failure).
- [ ] `[LOOP]` **Disciplina de migraciones**: runner ordenado y reproducible, no ad-hoc por MCP.

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
