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

## Fase 0 — Decisión de producto (HUMANO, bloqueante)

- [ ] `[DECISIÓN]` **Modelo de negocio**: ¿SaaS multi-cliente (muchas flotas) o herramienta interna para una sola flota? Determina tenancy, onboarding y billing.
  - *Asunción por defecto hasta confirmación*: **datos multi-tenant correctos** (cada query scoped por `empresa_id`, RLS lo fuerza), pero **UI de gestión de organización diferida**. Es el default técnicamente correcto porque retrofitear tenancy más tarde es de las migraciones más dolorosas que existen.

## Fase 1 — Fundaciones (GATE: no pasar a Fase 2 sin cerrar esto)

- [ ] `[LOOP]` **Tenancy correcta**: eliminar el hack `getDefaultEmpresaId()`/"primera empresa". Toda query scoped por `empresa_id` del gestor logueado. RLS que compara `empresa_id` de cada fila contra la empresa del gestor (vía `gestor.auth_user_id` = `auth.uid()`).
- [ ] `[LOOP]` **Integridad auth→gestor→empresa**: onboarding real. Un gestor nuevo crea su propia empresa (o se une por invitación), no se engancha a la primera existente.
- [ ] `[LOOP]` **Harness de tests** (define "verificado" = test pasa, no "200"):
  - Backend: pytest sobre lógica del bot (hito-pertenece-a-chófer, flujo POD, alerta fuera-de-ventana).
  - Dashboard: tests de `lib/data.js` (validaciones de conflicto de asignación, cambio de estado).
- [ ] `[LOOP]` **CI local mínimo**: script que corre lint + tests + build y que el loop ejecuta antes de cada commit.

## Fase 2 — Features

### Loop-safe (spec inequívoca)
- [ ] `[LOOP]` **Vincular Telegram del gestor** — sin esto la feature de alertas no llega a nadie. Enlace de alta tipo `t.me/NorentyBot?start=gestor_<id>` + handler en el bot.
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
