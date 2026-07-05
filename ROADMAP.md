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

- [x] `[LOOP]` **4.5 Vistas de métricas preset** — Página `/analitica` con selector entre 4 vistas, todo scoped por empresa: (1) **Puntualidad**: % entregas dentro de ventana, tendencia, peores rutas; (2) **Incidencias**: total + tasa, por tipo/chófer/vehículo; (3) **Rendimiento de chóferes**: viajes, valoración media, incidencias, % puntualidad; (4) **Flota**: utilización, ITV/mantenimiento próximos, averías recientes. Presentación: tarjetas numéricas + tablas + barras CSS simples (SIN librería de gráficos nueva). Funciones de agregación en `lib/data.js` con tests. (Selector de KPIs custom: diferido, fuera de scope.) (2026-07-01: puntualidad usa las incidencias `fuera_de_ventana` que ya crea el bot como señal de "llegada tarde" frente al total de hitos con ventana definida; 6 tests nuevos, 27 vitest total.)

- [x] `[LOOP]` **4.6 Abstracción de la capa de mensajería** — Refactor de `bot.py`: separar la lógica de negocio de las llamadas concretas a la API de Telegram con una fina interfaz de transporte/notificador (enviar texto, enviar con botones, enviar foto), para que un adaptador WhatsApp sea factible luego sin reescribir. Tests existentes siguen verdes; NO cambia comportamiento. Sin tablas nuevas. (2026-07-01: alcance real — se abstrajo la interfaz `Transporte`/`TransporteTelegram` para el envío de texto plano al GESTOR, usado por `alertar_gestor` y `notificar_gestor_evento` [antes cada uno instanciaba `Bot(token=TOKEN)` inline]. El flujo del CHÓFER —botones inline con callback_query, reply keyboard— NO se abstrajo: son mecanismos propios de la UI de Telegram sin equivalente directo en WhatsApp, y abstraerlos a fondo habría significado tocar todos los handlers con riesgo real de romper comportamiento en una sola noche. La interfaz cubre el caso de uso que de verdad bloqueaba un futuro adaptador WhatsApp — las alertas push al gestor, justo el caso mencionado en el ítem `[DECISIÓN]` de WhatsApp más abajo. 3 tests nuevos (43 pytest total).)

**FASE 4 CERRADA (2026-07-01).** Los 6 ítems `[LOOP]` construidos en loop nocturno, CI verde en cada paso. Quedan solo `[DECISIÓN]` de la sección production-gated de abajo, pendientes de presupuesto/despliegue/criterio humano.

### Production-gated — NO en el loop nocturno (coste por uso o deploy)
- [ ] `[DECISIÓN]` **Notas de voz → transcripción (Whisper)** — la fontanería (capturar/guardar nota de voz) sería loop-safe, pero la transcripción cuesta dinero → requiere rate-limit + presupuesto ANTES. Es el 80/20 del agente de voz; primer candidato cuando haya presupuesto.
- [ ] `[DECISIÓN]` **Agente de voz telefónico** — telefonía + STT/LLM/TTS en tiempo real; coste por minuto + producción.
- [ ] `[DECISIÓN]` **Validación POD con visión LLM** — coste por imagen; a producción.
- [ ] `[DECISIÓN]` **Adaptador WhatsApp** — Meta Business API, coste por conversación, la ventana de 24h rompe el push proactivo; decisión GTM. La abstracción (4.6) deja el terreno preparado.
- [ ] `[DECISIÓN]` **Aprendizaje sobre conversaciones (chófer↔gestor, notas internas jefe tráfico/GM)** — decidido con el usuario 2026-07-01: interesante PERO explícitamente para DESPUÉS del despliegue, cuando haya volumen real de conversaciones que analizar (hoy no hay datos de producción). Lectura recomendada cuando se retome: (A) extracción de patrones vía llamadas puntuales a LLM sobre texto libre (clasificar incidencias, detectar clientes/rutas problemáticas, temas recurrentes) — coste acotado por uso, no requiere entrenar nada; (B) modelo que se re-entrena/mejora con el tiempo — proyecto mayor, requiere pipeline de datos y presupuesto serio, no es el punto de partida. Empezar por (A) si/cuando se retome. Cuesta dinero por uso → requiere rate-limit + presupuesto antes de construir, igual que el resto de esta sección.
- [ ] `[DECISIÓN]` **Asistente in-dashboard (resolver dudas / sacar info al instante)** — propuesto por el usuario 2026-07-01. Llamaría a un LLM con contexto de los datos de la empresa (viajes, incidencias, chóferes...) para responder preguntas en lenguaje natural desde el dashboard. Cuesta dinero por consulta → requiere rate-limit + presupuesto antes de construir. Además hay una decisión de alcance previa: ¿solo lectura (responde preguntas sobre datos existentes, más seguro) o también puede *actuar* (cambiar estados, crear incidencias, más potente pero mucho más peligroso si alucina)? Recomendación: empezar solo-lectura con acceso de solo-lectura scoped por RLS del gestor logueado (nunca acceso cross-empresa), igual que el resto del dashboard.

### Auditoría de seguridad 2026-07-01 (a petición del usuario) — hallazgos y pendientes
- [x] RLS en las 16 tablas de negocio + buckets de storage: correcto, verificado con `get_advisors` de Supabase + revisión manual de policies.
- [x] `current_empresa_id()` (SECURITY DEFINER, llamable por RPC): revisado el cuerpo — sin parámetros, sin escritura, solo devuelve el propio `empresa_id` del caller, `search_path` fijado. Benigno, el linter lo marca de forma genérica pero no hay vulnerabilidad real.
- [x] Corregido: `/db/health` usaba la service role key (salta RLS) en endpoint público y devolvía conteo de filas — se quitó el campo `rows` de la respuesta.
- [x] Corregido: cabeceras de seguridad básicas añadidas en `next.config.js` (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS).
- [ ] `[LOOP]` **Content-Security-Policy** — NO añadida todavía: requiere un allowlist cuidadoso de los orígenes reales en uso (Supabase, tiles de Leaflet/OpenStreetMap para el mapa, Sentry) y probarla en navegador real para no romper nada; más seguro hacerlo con tiempo dedicado que a ciegas en un tick de loop. Pendiente antes de desplegar.
- [ ] CORS del backend FastAPI: hoy no tiene `CORSMiddleware` configurado, lo cual es aceptable porque el dashboard no lo llama (habla directo a Supabase). Si en el futuro se añaden endpoints reales consumidos desde el navegador, configurar CORS scoped exactamente al origen del dashboard (nunca wildcard `*` combinado con credenciales).

---

## Fase 5 — Discovery & aprendizajes de mercado (ABIERTA, 2026-07-01)

Detalle completo de cada conversación en `DISCOVERY.md` (git-trackeado, se amplía tras cada
entrevista). Esta sección solo recoge las implicaciones de producto que salen de ahí.

Contexto: conversación con un gestor de tráfico real (~30 camiones). Pendiente: dueño, gerente,
y un segundo gestor sin relación personal con el fundador (para contrastar sesgo de apertura).

- [x] `[LOOP]` **5.1 Informe de nómina auto-derivado (noches fuera + km por chófer)** — El gestor
  reporta hacerlo a mano cada mes; Norenty ya tiene el dato subyacente (timestamps de hitos por
  viaje). Decisión de modelo de datos cerrada con el usuario (2026-07-01): (a) **base de la
  empresa** = nuevo campo opcional `base_lat`/`base_lon` en `empresa` (migración 0013), configurable
  en Ajustes; **noche fuera** = llegada nocturna (22:00–06:00) a más de un umbral (50 km, valor
  inicial ajustable = `UMBRAL_NOCHE_FUERA_KM`) de la base, dedup por chófer+fecha; (b) **km** = por
  CARRETERA REAL vía OSRM (no Haversine), sumando tramos entre hitos consecutivos completados.
  `getInformeNomina(mes, anio)` en `dashboard/lib/data.js` (mismo patrón que getMetricas*, OSRM
  mockeado en tests). Página `/nomina`. Infra OSRM de desarrollo en `infra/osrm/` (docker-compose +
  README); **su despliegue en producción queda pospuesto junto con "Despliegue"**. (2026-07-01)
- [ ] `[DECISIÓN]` **Voice-to-text en el bot (chófer habla, gestor recibe texto)** — mismo ítem
  que "Notas de voz → transcripción (Whisper)" de la sección production-gated de Fase 4, ahora
  reforzado por el insight del gestor: prioridad #1 cuando haya presupuesto para transcripción,
  por delante del agente de voz telefónico completo.
- [x] `[LOOP]` **5.2 Cálculo de viabilidad/margen de un viaje** (¿comercial se columpió en precio?)
  — decisión de modelo de coste cerrada con el usuario (2026-07-01): **modelo POR CAPAS** para que el
  cliente "elija hasta dónde llegar" según cuántos datos puebla. Migración 0014: `viaje.precio`
  (ingreso), `empresa.coste_km` (blended, fallback), `vehiculo.coste_km` (override por camión).
  `resolveCosteKm()` usa el dato más granular disponible (vehículo→empresa); `calcularMargen()` y
  `kmCarreteraViaje()` (OSRM, ruta planificada = todos los hitos) puros y testeados;
  `getViabilidadViaje()` integra todo. UI: precio editable + badge de margen (rojo <0, ámbar
  <`UMBRAL_MARGEN_AMBAR_PCT`=10%, verde) en `/viajes/[id]`; coste/km de empresa en Ajustes; override
  por vehículo en `/vehiculos/[id]`. 14 tests nuevos (50 vitest). (2026-07-01)
  **EN RECÁMARA (v2, documentado, NO construido):** desglose completo como capas por DELANTE de las
  dos actuales — combustible por consumo real (L/100km × €/L, variando por peso/conducción, usando
  la BD pública de costes/consumos de camiones del mercado que el usuario recuerda haber montado),
  coste de conductor, peajes; e indexar costes REALES por viaje (repostajes, multas) para ir afinando
  el cálculo con datos de producción en vez de estimaciones. El `UMBRAL_MARGEN_AMBAR_PCT`=10% y el
  `UMBRAL_NOCHE_FUERA_KM`=50 son valores iniciales, pendientes de pactar con cliente real.
- [x] `[LOOP]` **5.3 ETA "cumple-561" — tiempo de ruta con paradas legales** — El gestor calcula
  a mano el tiempo real de una ruta insertando las paradas obligatorias; automatizarlo. Detalle
  regulatorio investigado 2026-07-01 (ver `DISCOVERY.md`, Reglamento CE 561/2006): pausa 45 min tras
  4,5 h de conducción; conducción diaria 9 h (10 h máx 2×/sem); descanso diario 11 h (reducible 9 h);
  semanal 56 h / bisemanal 90 h; descanso semanal 45 h (reducible 24 h).
  (2026-07-01: **decisión de implementación tomada en esta sesión** — NO se usa la duración que
  devuelve OSRM directamente, porque su perfil "driving" está calibrado para turismos y subestimaría
  el tiempo real de un camión. En su lugar: horas de conducción = km por carretera (ya calculados en
  5.2 vía `kmCarreteraViaje`, ruta planificada) / `VELOCIDAD_PLANIFICACION_KMH` (75 default,
  configurable por empresa en Ajustes — migración 0015 `empresa.velocidad_planificacion_kmh`).
  `calcularEtaConParadas()` pura simula el Reglamento e inserta pausas/descansos; v1 CONSERVADORA
  deliberada: usa siempre el límite diario base 9h y descanso normal 11h (nunca la excepción de 10h
  2×/semana ni el descanso reducido 9h — ambas requieren estado multi-viaje que no existe en un
  cálculo aislado), y NO comprueba límites semanal/bisemanal/descanso semanal (mismo motivo). Esto
  hace que el cálculo sobreestime el tiempo, nunca lo infraestime. `getEtaViaje()` integra todo.
  UI en `/viajes/[id]`: "X km a Y km/h → Z h conducción + N paradas de 45min + M descansos de 11h =
  T h totales". 12 tests nuevos (62 vitest). CI verde.)
  (v2 con HERE: routing truck-aware con altura/peso/ADR + tráfico, de pago; ver principio de
  terceros abajo. v2 también: modelar límites semanales/bisemanales con estado real del chófer.)
- [x] **5.4 Parkings en la ruta** — (2026-07-02, aprobado por usuario "sigue con los parkings").
  Hallazgo clave: el endpoint oficial UE (webgate.ec.europa.eu/etpa) requiere login ECAS — NO es
  descarga abierta; el DATEX II oficial queda pendiente. En su lugar se usó un dataset REALMENTE
  abierto: Fraunhofer ISI vía Zenodo (Link & Plötz 2024, Data in Brief, CC-BY 4.0, 19.713
  ubicaciones EU de parking/descanso/repostaje para camión construidas sobre OSM). NO es la
  certificación SSTPA "seguro" — es "dónde hay parking conocido", etiquetado honesto en la UI.
  Migración 0016: tabla `parking` (dataset abierto global con empresa_id NULL visible para todos +
  propios por empresa con RLS completa). Sembradas 763 ubicaciones de España
  (`backend/db/seed_parking_abierto.py`, idempotente, `--pais`). Mapa: capa toggle "Parkings"
  (icono gris dataset / ámbar propios, popup con confianza y fuente, borrar propios desde popup,
  NO entran en fitBounds), alta de parking propio con form compacto. 3 tests (65 vitest). Pendiente
  v2: DATEX II oficial si algún cliente lo exige, y "sugerir parking donde cae el descanso de 11h"
  (encaja con 5.3).
- [ ] `[DECISIÓN]` **Asignación automática de rutas (dispatch)** — confirmado como North Star,
  no como punto de partida. Mantener asignación manual (ya existe) hasta tener volumen de datos.

### Principio de arquitectura: recurrir a terceros para lo difícil (decidido con usuario 2026-07-01)
Para capacidades caras de construir y mantener (routing, tráfico, mapas), apoyarse en terceros en vez
de reimplementar. Estado actual: **OSRM** (gratis, self-host) da distancia + duración, suficiente para
km (5.2) y ETA-con-paradas (5.3). Salto de calidad cuando haya presupuesto: **HERE** (routing
*truck-aware* real — respeta altura/peso/ADR/restricciones de camión + tráfico en vivo), que es el
estándar del sector; Google Directions/Waze son buenos con tráfico pero NO truck-aware. Nuestra lógica
de negocio (paradas legales, margen, noches fuera) se queda como capa propia por encima del proveedor,
para poder cambiar de proveedor sin reescribirla.

---

## Revisión CTO — 2026-07-02 (a petición del usuario)

**Qué hay (sólido):** bot Telegram completo (vinculación chófer/gestor, hitos con navegación,
POD, incidencias, menú, i18n es/en/ro/fr), dashboard completo (operación, mapa+parkings, viajes
con viabilidad y ETA-561, chóferes, vehículos con coste/km, documentos con caducidades, analítica
4 vistas, nómina auto-derivada, ajustes), multi-tenant con RLS en 17 tablas + 2 buckets privados,
16 migraciones con checksum, 43 pytest + 65 vitest + build en `ci.ps1`, Sentry opt-in, webhook-ready.

**Hallazgos (por gravedad):**
1. **CRÍTICO — `SUPABASE_SERVICE_ROLE_KEY` vacía en `.env`.** El bot cae a la anon key; con RLS
   activo desde 2026-06-30, el bot EN VIVO no puede leer ni escribir nada (los tests pasan porque
   mockean la BD). Consecuencia: el flujo real del bot probablemente lleva roto desde que se activó
   RLS y nadie lo ha notado porque no se ha probado en vivo. → `[DECISIÓN D1]` abajo.
2. **BUG (corregido 2026-07-02, commit fe056b6):** el informe de nómina consultaba la columna
   `tipo_evento`, que no existe (`ejecucion_evento.tipo`). Contra la BD real el informe salía
   siempre vacío. Cazado y arreglado en esta revisión. Lección aplicada: los fakes de tests
   replican el schema que asumimos, no el real → ítem 6.2 (datos demo vía RLS real) y 6.11 (E2E).
3. **Riesgo — nada probado end-to-end en vivo:** OSRM sin contenedor local (nómina/viabilidad/ETA
   muestran 0 km sin él → ítem 6.1 fallback), bot sin prueba real post-RLS (→ D1), sin datos demo.
4. **Deuda anotada:** CSP pendiente (→ 6.6), agregaciones cargan tablas completas sin rango
   (aceptable hoy, → 6.4), `DATABASE_URL` vacía (migrate.py/backup no ejecutables localmente → D2),
   ar/it/pt/de aliasados a inglés (→ 6.19), labels de tipos duplicados en 3 archivos (→ 6.14).
5. **Sin riesgo:** advisors de Supabase limpios salvo 2 avisos benignos ya analizados
   (schema_migrations sin policies — solo se toca por psycopg2/MCP; current_empresa_id SECURITY
   DEFINER — revisada, inocua).

**Decisión de dirección (CTO):** el producto está sobrado de features y corto de VERDAD — nada se
ha validado contra datos/uso real. Julio se dedica a: (semana 1) verdad y robustez, (semana 2)
demo/piloto listo para enseñar a insiders, (semana 3) operativa real del bot y estado semanal,
(semana 4) deploy-ready. NO se añaden features grandes nuevas hasta que un insider haya visto la demo.

## Fase 6 — Julio: verdad, demo y deploy-ready (ABIERTA 2026-07-02, cola del loop 24/7)

Protocolo: mismo de siempre (EN ORDEN, uno por iteración, `ci.ps1` verde, commit, `[x]` + línea en
PROGRESS.md). Si un ítem está bloqueado por una `[DECISIÓN]`, saltarlo y seguir con el siguiente.

### Semana 1 (2–6 jul) — verdad y robustez
- [x] `[LOOP]` **6.1 Fallback Haversine cuando OSRM no responde** — (2026-07-02) `kmCarreteraViaje`
  ahora devuelve `{km, estimado}`: si `distanciaPorCarretera` devuelve null para un tramo, usa
  Haversine × `FACTOR_SINUOSIDAD_FALLBACK` (1.3) para ESE tramo y marca `estimado=true`. Nómina
  refactorizada para reutilizar `kmCarreteraViaje` en vez de duplicar el bucle OSRM (bonus: elimina
  código repetido entre 5.1/5.2/5.3). UI (`/nomina`, viabilidad y ETA en `/viajes/[id]`) muestra "~"
  + aviso cuando `estimado`. 6 tests nuevos (71 vitest). CI verde.
- [x] `[LOOP]` **6.2 Datos demo por la puerta de RLS** — (2026-07-02) `backend/db/seed_demo.py`:
  login/alta del gestor demo vía anon key + `DEMO_EMAIL`/`DEMO_PASSWORD` (nunca service role — RLS
  real). Puebla 6 vehículos, 8 chóferes (uno por cada idioma del bot), 25 viajes en los 4 estados
  con hitos geocodificados a 15 ciudades españolas reales, eventos de ejecución en los completados
  (para que nómina/analítica tengan señal real), incidencias, valoraciones, precios, documentos con
  caducidades, 3 parkings propios, y configura empresa (base/coste_km/velocidad). Idempotente
  (borra solo los datos de esa empresa antes de repoblar). **Verificado en producción real: 25
  viajes / 8 chóferes / 6 vehículos / 57 hitos / 69 eventos / 4 documentos / 3 parkings, ejecutado
  dos veces para confirmar idempotencia, sin fugas a otras empresas.**
  **HALLAZGO CRÍTICO al ejecutarlo por primera vez (2026-07-02): el alta de una empresa NUEVA lleva
  ROTA desde que se activó RLS (2026-06-30) — nadie lo detectó porque solo se había probado con la
  empresa pre-sembrada de antes de RLS.** Causa: `.insert(...).select().single()` pide `RETURNING`;
  la policy SELECT de `empresa` es `id = current_empresa_id()`, y en el momento del alta el usuario
  no tiene fila en `gestor` todavía → `current_empresa_id()` es NULL → Postgres rechaza el
  `RETURNING` con "new row violates row-level security policy" (mismo mensaje que un fallo de
  `WITH CHECK`, indistinguible sin depurar a fondo). Arreglado en `dashboard/lib/auth.js` (commit
  0be2356): generar el `id` de la empresa en el cliente y NO pedir `RETURNING` en ese insert
  concreto — evita depender de una visibilidad que aún no existe. Test de regresión en
  `auth.test.js` (4 tests) que fija la forma correcta de la llamada. Este es exactamente el tipo de
  bug que 6.2 estaba diseñado para cazar (verdad vs. mocks) y lo cazó a la primera.
- [x] `[LOOP]` **6.3 Export del informe de nómina** — (2026-07-02) botón "Exportar CSV" en
  `/nomina` (mismo patrón que `/viajes`) + botón "Imprimir/PDF". Estilos `print:` (Tailwind) a
  nivel global: `layout.jsx`/Sidebar/Topbar ocultos al imprimir, `main` sin scroll/padding
  forzados; controles de mes/año y botones ocultos, tabla sin bordes redondeados en la versión
  impresa. Sin librería nueva (usa `window.print()`).
- [x] `[LOOP]` **6.4 Rango de fechas server-side en agregaciones** — (2026-07-02) `getInformeNomina`:
  el filtro de `ejecucion_evento` por mes ahora se aplica en la query (`.eq("tipo","llegada").gte/.lt`)
  en vez de traer la tabla entera y filtrar en cliente. `getMetricasPuntualidad/Incidencias/Choferes`
  aceptan `{ desde, hasta }` opcional (default últimos 90 días vía `resolveRango()` compartido),
  aplicado en servidor sobre las columnas con fecha real (`created_at`/`ventana_fin`).
  `getMetricasFlota` es un caso aparte y se documentó como tal: "vehículos activos"/"en uso"/"ITV
  pendientes" son estado ACTUAL (no tiene sentido acotarlos a un rango — una ITV pendiente sigue
  pendiente aunque venza fuera del rango), así que el rango se aplica SOLO a "averías recientes",
  en una query de `mantenimiento_vehiculo` separada de la de ITV. **Cambio de comportamiento real
  para el usuario** (antes `/analitica` mostraba histórico completo, ahora últimos 90 días por
  defecto): se añadió un aviso visible en la cabecera de `/analitica` para que no sea un cambio
  silencioso. 2 tests nuevos + 3 tests existentes actualizados (fixtures con fechas fijas de 2026-01
  necesitan un rango explícito amplio, ya no basta con no pasar argumentos). 77 vitest, 43 pytest.
  CI verde.
- [x] `[LOOP]` **6.5 Índices según advisor de performance** — (2026-07-02) `get_advisors(performance)`
  falla con un error interno propio de Supabase ("syntax error at or near 'storage.buckets'", bug en
  su lint, no en nuestro esquema — reproducido 2 veces). Chequeo equivalente hecho a mano por SQL
  (FKs sin índice que las cubra como primera columna): 3 encontradas — `documento.empresa_id`,
  `mantenimiento_vehiculo.empresa_id`, `mantenimiento_vehiculo.vehiculo_id` — las tres importan
  porque RLS las filtra en CADA query (`empresa_id = current_empresa_id()`) o se usan en cada carga
  de `/vehiculos/[id]`/`getMetricasFlota`. Migración 0017 (aplicada + checksum registrado), verificado
  que los 3 índices existen tras aplicar. **Hallazgo adicional del advisor de seguridad** (no estaba
  en la auditoría del 2026-07-01, posiblemente un check añadido después): "Leaked Password
  Protection" desactivada — Supabase puede rechazar contraseñas filtradas (HaveIBeenPwned) pero es
  un toggle del panel de Supabase (Authentication → Providers → Email), no algo tocable por SQL/MCP.
  Añadido como acción ligera pendiente del usuario (no requiere criterio, solo el toggle) — ver
  sección de decisiones. CI verde (sin cambios de código app, solo migración).
- [x] `[LOOP]` **6.6 CSP en modo Report-Only** — (2026-07-02) `Content-Security-Policy-Report-Only`
  añadida en `next.config.js`. Allowlist basado en grep real del código (no adivinado): Supabase
  (`https://*.supabase.co` + `wss://*.supabase.co` para REST/Realtime), tiles de Leaflet
  (`https://*.tile.openstreetmap.org`, URL exacta de `MapView.jsx`), Sentry (`*.sentry.io` +
  `*.ingest.us/de.sentry.io` — dominio best-effort porque no hay DSN real configurado todavía;
  inofensivo en Report-Only si no coincide exacto). `style-src 'unsafe-inline'` (Tailwind + estilos
  inline de React en varios componentes); `script-src` se dejó ESTRICTO a propósito (sin
  unsafe-inline) para que las violaciones reales ahí sean visibles. NO se descubrió que Google Fonts
  no se usa de verdad (solo nombradas en `@theme`, sin `<link>` — un dominio menos que allowlistear).
  **NO verificado en navegador real** (intentado con `mcp__Claude_Preview__*`: la herramienta resultó
  estar mal configurada en este entorno — su "workspace" apunta a la carpeta de instalación de Git
  para Windows, no al proyecto; `chromium-cli` tampoco está disponible aquí). Verificación de
  respaldo: build de producción limpio (`ci.ps1`) confirma que la cabecera se genera sin errores, y
  al ser Report-Only un allowlist incompleto solo generaría avisos en consola, nunca rompe nada —
  riesgo real bajo. Promocionar a enforcing tras una semana revisando la consola en un navegador de
  verdad (pendiente, requiere acceso a esa consola que aquí no se pudo obtener).

### Semana 2 (7–13 jul) — demo/piloto enseñable
- [x] `[LOOP]` **6.7 Bot: /parking** — (2026-07-02) `obtener_ubicacion_chofer()`: tabla `ubicacion`
  (GPS en vivo) primero, si no hay nada cae al último hito COMPLETADO del viaje activo. `/parking`
  junta parkings propios de la empresa + dataset abierto (mismo criterio que `getParkings()` del
  dashboard, replicado a mano porque el bot usa service role y salta RLS), calcula distancia con
  `haversine_km()` (espejo en Python de la función JS), devuelve los 3 más cercanos con nombre real
  (propios) o tipo localizado (dataset abierto) + botón "Cómo llegar" a Maps por cada uno. i18n
  completo es/en/ro/fr. `tests/fakes.py` ampliado con `.order()`/`.limit()` reales (antes `.order()`
  era no-op) para poder testear "más reciente" de verdad. 10 tests nuevos (53 pytest total). CI verde.
- [x] `[LOOP]` **6.8 Bot: /eta** — (2026-07-02) `calcular_eta_con_paradas()` en `bot.py`, espejo
  exacto de `calcularEtaConParadas()` (JS, 5.3), mismos 6 casos de test (0h, 3h, 5h, 9h, 10h, 18h)
  y mismos resultados. **Decisión de alcance distinta a la del dashboard, documentada**: mientras
  el dashboard calcula la ruta PLANIFICADA completa (todos los hitos, útil antes/durante el viaje
  visto desde fuera), `/eta` calcula lo que queda DESDE AHORA — solo hitos no completados
  (pendiente/en_curso), más útil para un chófer preguntando a mitad de trayecto. El bot no depende
  de OSRM, así que usa Haversine×`FACTOR_SINUOSIDAD_FALLBACK` (1.3) directamente, no como fallback.
  Respeta `empresa.velocidad_planificacion_kmh` (default 75, mismo que el dashboard). i18n completo
  es/en/ro/fr con pluralización real de "parada(s)"/"descanso(s)". 12 tests nuevos (65 pytest
  total). CI verde.
- [x] `[LOOP]` **6.9 Invitaciones multi-gestor** — (2026-07-02) Migración 0018: tabla
  `invitacion(id, empresa_id, email, codigo uuid único, usada_at)` con RLS empresa-scoped
  (SELECT/INSERT/DELETE) para que un gestor YA vinculado gestione SUS invitaciones. **Mismo
  problema de arranque que en 6.2** (un usuario recién registrado sin fila en `gestor` no puede
  leer la tabla por RLS): resuelto con una función `usar_invitacion(codigo)` SECURITY DEFINER que
  canjea atómicamente (marca `usada_at` + devuelve `empresa_id`, o `NULL` si inválida/ya usada) —
  sin exponer listado, solo funciona conociendo el código exacto (uuid impredecible). `signUp()`
  acepta un `invitacionCodigo` opcional: si viene, canjea vía RPC y une el gestor a esa empresa en
  vez de crear una nueva (ya no exige nombre de empresa). Sección "Equipo" en Ajustes: invitar por
  email, copiar enlace (`?invitacion=codigo`), revocar, ver estado pendiente/usada. `LoginPage`
  lee `?invitacion=` de la URL y ajusta el formulario. **Verificado en producción real** (no solo
  con mocks, aprendida la lección de 6.2): usuario auténtico nuevo sin fila `gestor`, canjea la
  invitación vía RPC real → recibe el `empresa_id` correcto; segundo intento con el mismo código →
  `NULL` (no se puede reusar); código inventado → `NULL`; inserción del gestor con ese `empresa_id`
  → éxito. Datos de prueba limpiados después. 8 tests nuevos en `data.test.js` + 4 tests de
  regresión en `auth.test.js` (85 vitest total). CI verde.
- [x] `[LOOP]` **6.10 Pase de accesibilidad/móvil de páginas nuevas** — (2026-07-02) Revisadas
  documentos, analítica, nómina, mapa (form parking), viabilidad/ETA en viaje, `DocumentosSection`.
  **Hallazgo real de contraste** (no cosmético): `text-estado-ok` (#16A34A) sobre `bg-green-50` da
  ~3.15:1 — pasa para texto grande (≥3:1) pero FALLA WCAG AA para texto pequeño (necesita 4.5:1);
  corregido a `text-green-700` en el badge "Vigente" de documentos y "Margen sano" de viabilidad
  (ambos en texto pequeño). Labels de formulario (mes/año en nómina, parking en mapa, tipo/fechas/
  archivo/notas en `DocumentosSection`) pasaron de `<label>` suelto sin asociación programática a
  `htmlFor`+`id` reales (o `sr-only` cuando no hace falta label visible); ids únicos por `ambito` en
  el componente reutilizable para no colisionar. `focus:ring-2` añadido donde `focus:outline-none`
  dejaba sin indicador visible de foco. Botones solo-icono (ver/descargar, eliminar documento) con
  `aria-label` (el `title` no es fiable como nombre accesible). Tablas de nómina/chóferes (analítica)
  con `overflow-x-auto` para 360px en vez de romper el layout. Pestañas de `/analitica` con
  `role="tablist"`/`role="tab"`/`aria-selected`. Mensajes de error de formulario con `role="alert"`.
  Documentos/página no necesitaba cambios (sin formularios, sin badges verdes). Sin librerías nuevas.
  CI verde (build limpio, sin tests nuevos — cambios puramente de marcado/estilo).
- [x] `[LOOP]` **6.11 E2E del bot con updates reales** — (2026-07-02) `tests/test_bot_e2e.py`:
  construye `Update`s REALES de PTB (Message con `MessageEntity.BOT_COMMAND`, `CallbackQuery`,
  `PhotoSize`) y los pasa por `app.process_update()` — el mismo camino que un mensaje real de
  Telegram — en vez de llamar a los handlers a mano. Flujo completo verificado: /start CODIGO →
  vincula → hito 1 (recogida) → pre_llegada → llegada → hito 2 (entrega) → llegada → pide foto →
  foto (POD sube a storage fake, crea pod, completa hito) → viaje completado. Más /incidencia con
  args reales del framework y un comando desconocido (no rompe). Trampas de PTB v22 resueltas y
  documentadas en el propio test: `Bot` congelado (parcheo a nivel de CLASE, no de instancia),
  `get_me` debe cachear `_bot_user` (si no `.username` revienta en CommandHandler), cada `Message`
  construido a mano necesita `.set_bot()` para que los shortcuts (`reply_text`,
  `edit_message_text`) funcionen. `fakes.py` ampliado con `FakeStorage` (upload de POD).
  **Verificado que el test caza regresiones reales**: rompí temporalmente el patrón del
  CallbackQueryHandler de "llegada:" y el E2E falló al instante (el hito se quedó en "pendiente");
  restaurado después. 3 tests E2E (68 pytest total). CI verde.

### Semana 3 (14–20 jul) — operativa real
- [ ] `[LOOP]` **6.12 Búsqueda global (Ctrl+K)** — paleta de búsqueda sobre viajes (referencia),
  chóferes (nombre), vehículos (matrícula): modal con input, resultados agrupados, navegación con
  teclado. Sin librería nueva.
- [ ] `[LOOP]` **6.13 Audit log ligero** — migración: tabla `audit_log(id, empresa_id, gestor_id,
  entidad, entidad_id, accion, detalle, created_at)` RLS por empresa; registrar desde el dashboard
  los cambios críticos (estado de viaje, asignación de chófer, precio, borrado de documento);
  mostrar como "Actividad" colapsable en el detalle del viaje.
- [ ] `[LOOP]` **6.14 Constantes compartidas** — extraer TIPO_LABEL de documentos (3 copias),
  tipos de parking (2 copias) y helpers fmtFecha/badgeFor duplicados a `dashboard/lib/labels.js` y
  `dashboard/lib/format.js`. Solo refactor, tests siguen verdes.
- [ ] `[LOOP]` **6.15 Aviso de límite semanal en asignación** — al asignar chófer a viaje, estimar
  sus horas de conducción de los últimos 7 días (km Haversine×1.3 de sus viajes con actividad /
  velocidad de planificación) y avisar (no bloquear) si la suma con el viaje nuevo supera 56h/90h
  (Reglamento 561). Aproximación honesta etiquetada como estimación. Tests.
- [ ] `[LOOP]` **6.16 ONBOARDING.md** — guía de arranque para un segundo desarrollador: requisitos,
  .env (qué clave es cada una y dónde se consigue), arrancar bot/dashboard/OSRM, correr tests,
  aplicar migraciones, sembrar demo/parkings, convenciones del repo (fases, loop, PROGRESS).

### Semana 4 (21–31 jul) — deploy-ready (sin desplegar)
- [ ] `[LOOP]` **6.17 Runbook de backup/restore** — documentar (y scriptear si D2 desbloqueada)
  pg_dump/restore de Supabase, qué incluye (BD sí, storage aparte), frecuencia recomendada y prueba
  de restore. Si falta DATABASE_URL: documentar el procedimiento y marcar el script como pendiente.
- [ ] `[LOOP]` **6.18 Reintentos y captura de errores en el bot** — wrapper con 3 reintentos y
  backoff para llamadas Supabase del bot, errores a Sentry con contexto (update_id, chofer),
  mensaje de disculpa al chófer si todo falla. Tests del wrapper.
- [ ] `[LOOP]` **6.19 i18n real ar/it/pt/de** — traducir las ~35 claves de TEXTOS a los 4 idiomas
  hoy aliasados a inglés (árabe incluido — el chófer magrebí es persona real del sector). Tests de
  muestreo por idioma.
- [ ] `[LOOP]` **6.20 Tarjetas de riesgo en Operación** — en la home añadir dos tarjetas:
  "Documentos por caducar (N)" → /documentos y "Viajes a pérdidas (N)" (margen<0 con precio y
  coste configurados) → lista filtrada. Reutiliza getDocumentosPorCaducar/getViabilidadViaje.
- [ ] `[LOOP]` **6.21 Checklist de despliegue** — DEPLOY.md: pasos exactos Vercel+Railway+dominio,
  variables por entorno, activar webhook del bot (BOT_WEBHOOK_URL/SECRET ya soportados), promover
  CSP a enforcing, alta de OSRM en producción, Sentry DSN, smoke tests post-deploy. Deja el
  despliegue a un clic de decisión humana.
- [ ] `[LOOP]` **6.22 Pase final de simplificación** — recorrer los diffs de julio buscando
  duplicación restante, dead code y TODOs; arreglar lo obvio, listar lo dudoso en PROGRESS.

### Decisiones pendientes del usuario (bloquean lo marcado)
- [ ] `[DECISIÓN D1 — CRÍTICA]` **Pegar la SUPABASE_SERVICE_ROLE_KEY real en `.env`** (Supabase →
  Project Settings → API). Sin ella el bot EN VIVO no funciona con RLS. Tras pegarla: probar flujo
  real con un chófer de prueba en Telegram (yo preparo el guion de prueba cuando confirmes).
- [ ] `[DECISIÓN D2]` **Pegar DATABASE_URL en `.env`** (connection string con contraseña) para
  `migrate.py` y backups locales.
- [ ] `[DECISIÓN D3]` **Presupuesto voz (Whisper)** — sigue siendo la feature #1 validada por el
  gestor; en cuanto haya cifra mensual aceptable, se especifica y entra en cola.
- [ ] `[DECISIÓN D4]` **Luz verde al despliegue** — con 6.21 hecho, desplegar es una sesión contigo.
- [ ] `[DECISIÓN D5]` **BD pública de consumos de camiones** — dijiste que la montaste hace meses;
  pásala (archivo o enlace) y especifico la capa de coste por combustible de viabilidad v2.
- [ ] `[ACCIÓN D6 — ligera, sin criterio]` **Activar "Leaked Password Protection"** en Supabase
  (Authentication → Providers → Email). Encontrado por el advisor de seguridad el 2026-07-02
  (item 6.5); un toggle de un clic, gratis, rechaza contraseñas ya filtradas (HaveIBeenPwned) en el
  signup/cambio de contraseña. No tocable por SQL/MCP, solo desde el panel.

---

# NORENTY OS — El gestor de tráfico autónomo (visión de producto, 2026-07-02)

**North Star: camiones por gestor.** Hoy un gestor lleva ~30 camiones. El gestor real entrevistado
dijo que con "automatizar lo básico" llevaría 60. El producto ideal lleva ese número a **120**: no
un SaaS que el gestor usa, sino un sistema que HACE el trabajo del gestor y deja a la persona solo
las decisiones excepcionales. Para el chófer, la experiencia es "Uber": recibe la ruta, carga y
conduce — todo lo demás (papeles, tiempos, incidencias, cobros) lo lleva el sistema.

**Métricas que definen el éxito** (instrumentar desde el día 1 del piloto):
- Camiones gestionados por persona (North Star)
- % de viajes completados sin NINGUNA intervención humana del gestor
- Tiempo medio de resolución de incidencia (del reporte del chófer a la resolución)
- Margen medio real por ruta (no estimado — real, con repostajes y multas imputados)
- Tiempo de respuesta a una petición de presupuesto (objetivo: < 60 segundos)

## Revisión de lo construido (qué tenemos vs. qué falta, por pilar)

**1. CEREBRO — viabilidad y coste de ruta.** Tenemos: coste €/km por capas (empresa→vehículo),
margen con semáforo, ETA cumple-561, km por carretera (OSRM + fallback Haversine). Falta: desglose
real de coste (combustible por consumo del camión, peajes, dietas/noches), presupuestador
instantáneo, y el P&L REAL (lo gastado de verdad, no lo estimado).

**2. DISPATCH — asignación.** Tenemos: asignación manual con validaciones (anti doble asignación,
vehículo inactivo). Falta TODO lo inteligente: sugerencia de chófer con score explicado, oferta
push al chófer con Aceptar/Rechazar, y el camino progresivo hacia auto-dispatch.

**3. OJOS — ejecución y seguimiento.** Tenemos: hitos con botones, POD por foto, mapa con última
ubicación, eventos de ejecución. Falta: captura de live location en el bot (la tabla `ubicacion`
existe pero el bot no tiene handler de location), geo-detección de llegada (que el chófer no tenga
ni que pulsar un botón), plan-vs-real, alerta por desviación.

**4. VOZ — comunicación multilingüe y resolución de incidencias.** Tenemos: bot en 4 idiomas
completos (+4 con fallback), /incidencia, alertas al gestor. Falta: voz→texto (Whisper), traducción
bidireccional gestor↔chófer, y el salto grande: TRIAJE AUTOMÁTICO de incidencias con playbooks (el
sistema resuelve las comunes; solo escala las raras). La llamada telefónica con agente es la v2.

**5. ESCUDO — cumplimiento legal.** Tenemos: ETA-561 conservador, registro documental con
caducidades, parkings (dataset ES + propios). Falta: estado 561 REAL por chófer (horas acumuladas
semana/bisemana desde los eventos), tacógrafo (descarga remota, v2), registro de multas.

**6. CAJA — cierre económico.** Tenemos: informe de nómina (noches fuera + km), precio y margen
estimado. Falta: repostajes y multas imputadas al viaje, P&L real-vs-estimado, exports listos para
gestoría/nómina, integración con tarjetas de combustible (v2).

**7. PLATAFORMA Y UX.** Tenemos: multi-tenant con RLS sólido, invitaciones de equipo, demo con
datos realistas, tests (68 pytest + 85 vitest + E2E). Falta: el dashboard como CENTRO DE MANDO (hoy
es una colección de páginas; debe abrir con "qué necesita mi atención AHORA"), wizard de creación
guiado, explicaciones ("por qué este chófer"), onboarding, y el portal de cliente (tracking público
por enlace — lo que convierte a Norenty en algo que los CLIENTES de la flota también ven).

## Principios de diseño (aplican a todo lo de abajo)

1. **Automatiza el 80%, explica el 100%.** Cada sugerencia del sistema lleva su "por qué" visible
   (score desglosado). La confianza del gestor se gana con transparencia, no con magia.
2. **Human-in-the-loop progresivo.** Toda automatización nace como sugerencia → pasa a "aprobar con
   1 clic" → termina en automática con guardrails. Nunca se salta etapas.
3. **El chófer solo carga y conduce.** Cada interacción que le pedimos al chófer es un fallo de
   diseño a eliminar: la llegada se detecta por GPS, no por botón; el idioma es el suyo, siempre.
4. **Datos estimados y reales, siempre separados y siempre etiquetados.** Ya lo hacemos (~, avisos
   v1) — es política de producto, no detalle.
5. **Dashboard = decisiones, no datos.** Cada pantalla responde "¿qué hago?" antes que "¿qué hay?".

---

## Fase 7A — Norenty OS, cola ejecutable (CERRADA 2026-07-04 — los 14 ítems construidos)

Protocolo del loop: **esta cola va ANTES que los ítems restantes de Fase 6** (6.12, 6.13, 6.16,
6.17, 6.18, 6.19, 6.21, 6.22, que pasan a cola secundaria). Los ítems 6.14, 6.15 y 6.20 quedan
SUBSUMIDOS por 7A.12, 7A.1 y 7A.10 respectivamente (no hacerlos por separado). Mismo protocolo:
EN ORDEN, uno por iteración, `ci.ps1` verde, commit, `[x]` + línea en PROGRESS.md.

**⚠️ OBLIGATORIO antes de implementar cualquier ítem 7A.x: leer `SPECS-7A.md`** — contiene la
especificación de implementación completa de cada ítem (archivos exactos, firmas de funciones,
SQL literal de migraciones, algoritmos con reglas numéricas, casos de test, y el preámbulo de
convenciones/trampas del repo). Las decisiones de diseño YA están tomadas ahí; el ejecutor solo
pica código. Orden de ejecución con dependencias, al final de ese documento:
7A.1→2→3→4→5→6→7→8→9→10→12→13→11→14, y después los 6.x restantes.

- [x] `[LOOP]` **7A.1 Estado 561 por chófer** (subsume 6.15) — Función `getEstado561(choferId)` en
  `lib/data.js`: horas de conducción estimadas de los últimos 7 y 14 días (km Haversine×1.3 de sus
  viajes con eventos de llegada en ese periodo / velocidad de planificación — misma aproximación
  honesta que nómina, etiquetada como estimación), contra límites 56h/90h. Vista: barra de
  progreso + horas restantes en `/choferes/[id]` y chip de aviso (no bloqueo) al asignar chófer en
  `/viajes/nuevo` y en el cambio de chófer del detalle si la suma con el viaje nuevo supera límites.
  Tests de la función con fixtures de eventos.
- [x] `[LOOP]` **7A.2 Motor de asignación v1 — sugerencia con score explicado + registro de
  decisiones** — `sugerirChofer(viajeId)` en `lib/data.js`: puntúa cada chófer de la empresa con
  desglose visible: disponibilidad (sin viaje activo, +40), margen 561 (horas restantes vs. horas
  del viaje, 0–25), documentos vigentes (licencia/CAP no caducados, +15 / bloqueo visual si
  caducados), proximidad al origen (última ubicación conocida vs. primer hito, 0–10), **historial
  real de desempeño** (puntualidad + tasa de incidencias + valoración, reutilizando
  `getMetricasChoferes()` — NO solo estrellas, 0–10). Devuelve ranking con `{chofer, score,
  razones}`. La decisión SIEMPRE es del gestor (nunca del chófer, ver 7A.3): tabla
  `decision_asignacion` registra qué se sugirió vs. qué se eligió, y pide un motivo opcional
  cuando el gestor no sigue la sugerencia top — es el hook de aprendizaje para 7B.7. UI: lista
  ordenada por score con las razones visibles y "Asignar" a 1 clic. Tests exhaustivos del scoring
  y del registro de decisión. **Ver `SPECS-7A.md` (reescrito 2026-07-03).**
- [x] `[LOOP]` **7A.3 Notificación de asignación al chófer** (reemplaza el diseño original
  "Uber-style" de aceptar/rechazar — descartado a petición del usuario 2026-07-03: la decisión es
  del gestor, el chófer solo se entera, cero fricción/cero elección para él) — Migración:
  `viaje.notificado_asignacion_en timestamptz`. Job del bot (cada 30s) que, cuando un viaje tiene
  chófer asignado y no se le ha avisado aún, le manda un mensaje informativo (ruta, nº paradas,
  km estimados) SIN botones de aceptar/rechazar. Reasignar resetea el flag para renotificar al
  nuevo chófer. i18n 4 idiomas. Tests unitarios del job. **Ver `SPECS-7A.md`.**
- [x] `[LOOP]` **7A.4 Live location + geo-llegada v1** — Bot: `MessageHandler(filters.LOCATION)`
  que guarda cada ubicación (incluida live location editada — handler de `edited_message`) en la
  tabla `ubicacion`. Al recibir ubicación, si el chófer tiene hito pendiente/en_curso a <300 m
  (Haversine), el bot pregunta proactivamente "¿Has llegado a X?" con el botón de confirmar de
  siempre (NO auto-confirma en v1 — guardrail del principio 2). Mensaje al vincular que explica
  cómo compartir ubicación en tiempo real. `UMBRAL_GEO_LLEGADA_M = 300` configurable. Tests con
  updates reales de location en el arnés E2E.
- [x] `[LOOP]` **7A.5 Coste total de ruta v2 — desglose por capas** — Migración: `vehiculo.
  consumo_l_100km numeric`, `empresa.precio_gasoil_litro numeric`, `empresa.coste_peaje_km numeric`,
  `empresa.dieta_noche_eur numeric` (todos nullable). `calcularCosteRuta({km, noches, vehiculo,
  empresa})` puro: combustible (km × consumo/100 × €/l) + conductor (coste_km existente si se
  quiere mantener blended, o desglosado) + peajes (km × €/km peaje) + dietas (noches × €/noche);
  cada componente devuelve `null` si faltan datos y el total indica qué capas están activas — el
  cliente "elige hasta dónde llega" poblando datos (decisión de 5.2 extendida). La viabilidad de
  `/viajes/[id]` muestra el desglose en tabla pequeña. Campos nuevos en Ajustes y ficha de
  vehículo. Tests por capa y combinaciones.
- [x] `[LOOP]` **7A.6 Presupuestador instantáneo** — Página `/presupuesto`: form origen + destinos
  (direcciones con lat/lon manual o clic en mini-mapa) + vehículo opcional → devuelve al instante:
  km, horas-561 con paradas, noches fuera estimadas (por descansos de 11h del cálculo ETA), coste
  total desglosado (7A.5), y PRECIO SUGERIDO = coste / (1 − margen objetivo) con
  `MARGEN_OBJETIVO_PCT = 15` configurable en Ajustes. Botón "Crear viaje con estos datos" que
  precarga el wizard. Es la respuesta en <60 s a "¿me sale a cuenta esta carga?" — la herramienta
  anti-"comercial se columpió". Tests del cálculo.
- [x] `[LOOP]` **7A.7 Multas y repostajes por viaje** — Migración: tabla `gasto_viaje(id, viaje_id,
  empresa_id, tipo CHECK in ('repostaje','peaje','multa','dieta','otro'), importe numeric, litros
  numeric NULL, descripcion, fecha, chofer_id NULL, created_at)` con RLS empresa. UI: sección
  "Gastos" en `/viajes/[id]` (alta rápida + lista + total). Las multas además se ven agregadas en
  la ficha del chófer (historial de multas) y del vehículo. Tests data.js.
- [x] `[LOOP]` **7A.8 P&L real del viaje** — Card en `/viajes/[id]`: ingreso (precio) − gastos
  REALES (suma de gasto_viaje) = margen real, lado a lado con el estimado (7A.5/5.2) y la
  desviación en %. En `/analitica`, vista nueva "Rentabilidad": top viajes por margen real, viajes
  a pérdidas reales, desviación media estimado-vs-real (la métrica que dice si nuestro cost engine
  aprende). Tests.
- [x] `[LOOP]` **7A.9 Plan-vs-real en el detalle del viaje** — Para cada hito: ventana planificada
  vs. llegada real (evento `llegada`), con delta en minutos y color (verde a tiempo / ámbar <1h
  tarde / rojo más). Un mini-resumen arriba: "3/4 hitos a tiempo". Reutiliza datos existentes, sin
  migración. Tests del cálculo de deltas.
- [x] `[LOOP]` **7A.10 Centro de mando "Hoy" + notas del gestor** (subsume 6.20) — La home (`/`)
  deja de ser solo el Kanban y abre con una fila de tarjetas accionables: viajes EN RIESGO (fuera
  de ventana ya, o ETA imposible), incidencias abiertas (con antigüedad), documentos por caducar
  (N), chóferes cerca del límite 561 (de 7A.1), viajes a pérdidas (margen<0). Cada tarjeta → clic
  lleva al sitio con el filtro puesto. Kanban debajo, intacto. Debajo, "Notas rápidas": cuaderno de
  bitácora ligero (tabla `nota_gestor`) para que el gestor apunte contexto de primera mano —
  complementa el registro estructurado de `decision_asignacion` (7A.2) como segunda fuente de
  aprendizaje futuro. Es la pantalla que el gestor deja abierta todo el día: si está todo verde,
  no hay nada que hacer — ese es el producto. **Ver `SPECS-7A.md`.**
- [x] `[LOOP]` **7A.11 Wizard "Nuevo viaje" con inteligencia inline** — Rehacer `/viajes/nuevo` en
  3 pasos: (1) ruta (hitos, con km/horas/coste/precio-sugerido calculándose en vivo en un panel
  lateral según añades hitos), (2) chófer+vehículo (ranking de 7A.2 con razones, aviso 561 — el
  gestor asigna directo, sin flujo de oferta), (3) confirmación (resumen completo + viabilidad
  final). Mantener el flujo actual como fallback hasta que el wizard esté completo (feature por
  ruta nueva `/viajes/nuevo-w` hasta validar, luego swap). Tests de los cálculos del panel.
- [x] `[LOOP]` **7A.12 Sistema de diseño consolidado** (subsume 6.14) — `dashboard/lib/labels.js`
  (todos los TIPO_LABEL/estados/ámbitos duplicados hoy en 3+ archivos) y `dashboard/lib/format.js`
  (fmtFecha, fmtEuros, fmtKm, badges de caducidad/margen). Componentes compartidos en
  `app/components/ui/`: `Stat` (tarjeta numérica), `Badge` (semáforo consistente), `EmptyState`
  (icono + texto + CTA), `SectionCard`. Migrar las páginas existentes a estos componentes SIN
  cambiar comportamiento (refactor puro, tests siguen verdes). Es lo que hace que todo lo demás se
  vea y se sienta igual de pulido.
- [x] `[LOOP]` **7A.13 Onboarding y empty states** — Para una empresa recién creada, la home
  muestra un checklist guiado: 1) añade tu primer vehículo → 2) tu primer chófer → 3) vincúlalo a
  Telegram (enlace listo) → 4) crea tu primer viaje → 5) configura costes (€/km, gasoil, base).
  Cada paso con enlace directo y check automático al completarse. Todos los empty states de listas
  pasan de "Sin datos" a explicación + botón de acción (usar `EmptyState` de 7A.12).
- [x] `[LOOP]` **7A.14 Portal de cliente — tracking público por enlace** — Migración: `viaje.token_
  publico uuid NULL UNIQUE`. Botón "Compartir seguimiento" en el detalle genera el token y copia
  `/t/{token}`. Página pública `/t/[token]` (SIN login, fuera del AuthGuard): referencia, estado,
  hitos con check de completados, ETA-561, última posición aproximada del camión en un mini-mapa
  (redondeada a ~2 decimales por privacidad del chófer), auto-refresh. Lectura vía función RPC
  SECURITY DEFINER `viaje_publico(token)` que devuelve SOLO esos campos (nunca precio, coste,
  nombre completo del chófer ni matrícula) — mismo patrón seguro que `usar_invitacion` de 6.9.
  Revocable (botón regenerar/quitar token). Es lo que la flota enseña a SUS clientes — Norenty se
  vuelve visible más allá del gestor. Tests de la RPC (que no filtre campos sensibles) + página.

## Fase 7B — Norenty OS, production-gated (requieren presupuesto/deploy/decisión — NO loop)

- [ ] `[DECISIÓN]` **7B.1 Voz Whisper** (= D3, prioridad #1 confirmada por discovery): nota de voz
  del chófer → texto en el idioma del gestor; respuesta del gestor → texto en el idioma del chófer.
  La fontanería (capturar/almacenar audio) es loop-safe y se preparará cuando se apruebe el gasto.
- [ ] `[DECISIÓN]` **7B.2 Triaje AI de incidencias con playbooks** — el salto de "reportar" a
  "RESOLVER": clasificador LLM sobre el texto/voz de la incidencia + playbooks deterministas:
  retraso → recalcular ETA + (con 7A.14) el cliente lo ve solo; avería → 3 talleres/parkings más
  cercanos + aviso al gestor con contexto completo; espera en muelle → cronometrar paralización
  (dato facturable). Cada playbook empieza en modo "sugerir al gestor" (principio 2). Coste por
  incidencia acotado (~1 llamada LLM); definir presupuesto mensual + rate limit.
- [ ] `[DECISIÓN]` **7B.3 Agente telefónico** — STT/LLM/TTS en tiempo real, identifica al chófer
  por número, contexto del viaje cargado. Después de que 7B.1+7B.2 demuestren valor.
- [ ] `[DECISIÓN]` **7B.4 Tacógrafo remoto** — integraciones de descarga remota (Continental VDO,
  Stoneridge, Webfleet…): sustituye la ESTIMACIÓN 561 de 7A.1 por horas REALES. Requiere acuerdos/
  cuentas con proveedores; evaluar en el piloto qué usa la flota.
- [ ] `[DECISIÓN]` **7B.5 Tarjetas de combustible** (Solred, DKV, AS24…): repostajes reales
  automáticos al P&L (7A.8) sin que nadie teclee nada.
- [ ] `[DECISIÓN]` **7B.6 Routing truck-aware (HERE)** — altura/peso/ADR + tráfico real; sustituye
  OSRM/Haversine capa por capa sin tocar la lógica de negocio (principio ya establecido en Fase 5).
- [ ] `[DECISIÓN]` **7B.7 Auto-dispatch con guardrails** — cuando 7A.2/7A.3 acumulen historial:
  auto-ofertar al mejor chófer si score > umbral y sin conflictos; el gestor solo ve excepciones.
  El paso final hacia 120 camiones/persona.
- [ ] `[DECISIÓN]` **7B.8 Integraciones TMS + API pública** — import/export con los TMS que usen
  los pilotos (descubrir en entrevistas), webhooks, API con claves por empresa.
- [ ] `[DECISIÓN]` **7B.9 (Moonshot) Marketplace de cargas** — con la flota digitalizada, conectar
  camiones vacíos con bolsas de carga (Timocom etc.) o cargas de otras empresas Norenty. Es el
  efecto red que convierte la herramienta en plataforma. No antes de tener >5 flotas activas.

---

## Fase 8 — Solidez, seguridad y confiabilidad (TODOS LOS `[LOOP]` CERRADOS 2026-07-04)

**Estado: 8.1 a 8.5 y 8.7 a 8.12 hechos.** Solo quedan pendientes cosas que no puede hacer el
loop: `8.6` (activar "Leaked Password Protection" — un clic en el panel de Supabase, no vía
SQL/MCP) y las `[DECISIÓN D1/D2/D4]` de más abajo, todas necesitan criterio/acceso del usuario.

**Decisión de dirección (usuario, 2026-07-04):** para este producto la confianza ES el producto
— es un SaaS de *aseguramiento de ejecución*: el gestor paga por creer que lo que ve (hora de
llegada, POD, km, horas) es VERDAD y nadie lo ha tocado. Por encima de features nuevas y de la
estética (que para V1 no es imprescindible), la prioridad es que sea **sólido, seguro y
confiable**. Esta fase reorganiza y AMPLÍA lo que quedaba de Fase 6 alrededor de esos tres
pilares, y **baja de prioridad** los ítems que son features puras (`6.12 Ctrl+K`, `6.19 i18n
completo` — se mantienen en backlog pero después de Fase 8).

**Las 6 claves de que este SaaS tenga éxito** (marco de decisión para todo lo de abajo):
1. **La evidencia es incorruptible.** Nadie reescribe una hora de llegada ni un POD para maquillar
   un dato. (Empezado: migración 0019 bloquea escribir `ejecucion_evento`/`ubicacion` desde el
   dashboard.) → audit log + aislamiento probado.
2. **El sistema no pierde datos y no miente.** Backups probados, y CERO divergencia entre lo que el
   código asume y lo que la BD tiene de verdad. Los tres bugs que han llegado al usuario (nómina
   `tipo_evento`, mapa `.rpc().catch()`, y los 2 de RLS bootstrap) pasaron los tests porque los
   mocks replican el schema ASUMIDO, no el real. → smoke tests contra la BD real.
3. **El canal con el chófer nunca se cae en silencio.** El bot es el único punto de contacto; si
   muere, los chóferes no reportan y el gestor no se entera. → reintentos + health check + alerta.
4. **Aislamiento multi-tenant a prueba de balas.** Una flota jamás ve datos de otra. → suite de
   aislamiento que lo prueba contra la BD real, no solo confiar en las policies.
5. **Trazabilidad total.** Quién cambió qué y cuándo. En un producto de "assurance" no es opcional.
6. **Operable por otra persona.** Si entra otro dev, o vuelves en 3 meses, el sistema se entiende,
   se arranca y se despliega sin arqueología.

Protocolo igual: EN ORDEN, uno por iteración, `ci.ps1` verde, commit, `[x]` + línea en PROGRESS.
Los ítems marcados `[DECISIÓN]` NO los hace el loop (necesitan una clave/servicio/criterio tuyo).

### Bloque A — Confiabilidad de la verdad (lo de mayor palanca; los bugs que ya te llegaron)
- [x] `[LOOP]` **8.1 Smoke tests contra la BD demo real en CI.** El agujero nº1: los mocks no
  cazan que una columna no exista o que una página crashee en runtime. Script que, con la empresa
  demo, carga las funciones de datos reales (`getViajes`, `getResumenHoy`, `getViabilidadViaje`,
  `getInformeNomina`, `getMetricasRentabilidad`, `getPlanVsReal`, y la RPC `viaje_publico`) contra
  el Supabase real vía anon key y asegura que devuelven sin lanzar y con el shape esperado.
  Integrar en `ci.ps1` como paso opcional (salta con aviso si no hay `.env`, para no romper CI en
  máquinas sin credenciales). Esto habría cazado la nómina y el mapa antes que tú.
- [x] `[LOOP]` **8.2 Reintentos + captura de errores en el bot** (era 6.18). Wrapper con 3
  reintentos y backoff exponencial para TODA llamada a Supabase del bot; en fallo definitivo →
  Sentry con contexto (`update_id`, `chofer_id`, acción) + mensaje de disculpa al chófer en su
  idioma ("estamos teniendo un problema técnico, reinténtalo en un minuto"). Nunca un silencio.
  Tests del wrapper (éxito al 2º intento, fallo tras 3, que no traga excepciones no-red).
- [x] `[LOOP]` **8.3 Health check + heartbeat del bot.** Endpoint/tarea que registra "el bot está
  vivo" cada N minutos (fila en una tabla `bot_heartbeat` o log a Sentry), y una comprobación que,
  si el último heartbeat es viejo, avisa. En local es una tabla + una vista en Ajustes ("Bot:
  activo hace 30s / SIN SEÑAL desde hace 12 min"); la alerta real por Telegram/email al gestor
  queda para el deploy (necesita proceso vivo 24/7). Es la diferencia entre "el bot se cayó y lo
  supimos" y "un chófer lleva 3h sin poder reportar y nadie lo sabe".

### Bloque B — Seguridad
- [x] `[LOOP]` **8.4 Suite de aislamiento multi-tenant.** Test que crea (o usa) dos empresas y
  verifica contra la BD REAL que, autenticado como gestor de la empresa A, NINGUNA tabla ni RPC
  devuelve una sola fila de la empresa B (viajes, hitos, choferes, vehículos, documentos, gastos,
  notas, decisiones, invitaciones, incidencidencias, POD). Es la prueba que convierte "las policies
  deberían aislar" en "está demostrado que aíslan". Documentar el resultado.
- [x] `[LOOP]` **8.5 Endurecer el portal público (7A.14).** El endpoint `viaje_publico` es anónimo:
  (a) caducidad opcional del token (`token_publico_expira timestamptz`; la RPC devuelve null si
  pasó) para que un enlace compartido no viva para siempre; (b) documentar que el token es un uuid
  impredecible (no enumerable) y que la RPC ya no filtra datos internos (verificado en 7A.14);
  (c) nota para el deploy: poner rate-limit a nivel de infra sobre `/rest/v1/rpc/viaje_publico`.
- [ ] `[ACCIÓN D6]` **8.6 Activar "Leaked Password Protection"** en Supabase (Auth → Providers →
  Email). 1 clic, gratis, rechaza contraseñas ya filtradas. No tocable por MCP, solo panel — te
  guío cuando quieras.
- [x] `[LOOP]` **8.7 Repaso de advisors + superficies.** Correr los security advisors de Supabase,
  revisar cada tabla nueva de 7A (decision_asignacion, nota_gestor, gasto_viaje) confirmando RLS y
  grants correctos, y que ninguna función SECURITY DEFINER nueva expone de más. Documentar.

### Bloque C — Trazabilidad y datos
- [x] `[LOOP]` **8.8 Audit log** (era 6.13). Tabla `audit_log(id, empresa_id, gestor_id, entidad,
  entidad_id, accion, detalle jsonb, created_at)` con RLS por empresa; registrar los cambios que
  importan para "assurance": cambio de estado de viaje, (re)asignación de chófer, cambio de precio,
  borrado de documento, generación/revocación de token público. Vista "Actividad" colapsable en el
  detalle del viaje. Complementa `decision_asignacion` (que ya registra el porqué de la asignación).
- [x] `[LOOP]` **8.9 Runbook de backup/restore** (era 6.17). Documentar pg_dump/restore de Supabase,
  qué cubre (BD sí, storage aparte), frecuencia, y una prueba de restore real. La parte scriptada
  necesita `DATABASE_URL` (D2); sin ella, documentar el procedimiento manual y marcar el script
  como pendiente.

### Bloque D — Operabilidad (bus factor)
- [x] `[LOOP]` **8.10 ONBOARDING.md** (era 6.16). Guía para que un segundo dev (o tú en 3 meses)
  arranque todo: requisitos, cada variable de `.env` (qué es y dónde se saca), arrancar
  bot/dashboard/OSRM, correr tests, aplicar migraciones, sembrar demo, y las convenciones del repo.
- [x] `[LOOP]` **8.11 Checklist de despliegue** (era 6.21). DEPLOY.md: pasos exactos
  Vercel+Railway+dominio, variables por entorno, activar webhook del bot, CSP a enforcing, OSRM en
  prod, Sentry DSN, y smoke tests post-deploy. Deja el despliegue a un clic de tu decisión.
- [x] `[LOOP]` **8.12 Pase final de simplificación** (era 6.22). Recorrer los diffs de julio
  buscando duplicación restante, dead code y TODOs; arreglar lo obvio, listar lo dudoso en PROGRESS.

### Decisiones que solo tú puedes tomar (desbloquean lo de arriba)
- `[DECISIÓN D1 — CRÍTICA]` Pegar la `SUPABASE_SERVICE_ROLE_KEY` real en `.env` (te expliqué cómo
  hacerlo de forma segura). Sin ella el bot EN VIVO no puede escribir con RLS activo. Bloquea 8.3
  parcialmente y todo el flujo real del bot.
- `[DECISIÓN D2]` Pegar `DATABASE_URL` para que `migrate.py` y los backups (8.9) sean ejecutables.
- `[DECISIÓN D4]` Luz verde al despliegue (tras 8.11, es una sesión contigo).

### Diferido a después de Fase 8 (features, no confiabilidad)
- `6.12 Búsqueda global (Ctrl+K)` · `6.19 i18n real ar/it/pt/de` — útiles, pero no mueven la aguja
  de sólido/seguro/confiable. Se retoman cuando Fase 8 esté cerrada.

---

## Despliegue (POSPUESTO — no tocar sin confirmación explícita)

GitHub → Vercel (dashboard) → Railway (backend) → dominio norenty.com vía Cloudflare.

**Pendiente para el checklist de despliegue (8.11):** poner rate-limit a nivel de infra
(Cloudflare/Vercel) sobre `/rest/v1/rpc/viaje_publico` — es un endpoint anónimo (portal de
cliente, 7A.14/8.5); el token en sí es impredecible y caduca a los 30 días, pero sin rate-limit
alguien podría intentar fuerza bruta de tokens contra el endpoint. No aplicable en local.

---

# Fase 9 — Confianza como producto: seguridad, solidez y escala (ABIERTA, 2026-07-04)

Origen: hoja de ruta de arquitectura elaborada por Fable a partir de un snapshot exacto del
proyecto (código, esquema, ROADMAP/PROGRESS reales), revisada por el ejecutor de este repo y
adoptada por el usuario. Reestructurada aquí con la convención exacta de este documento
(`[LOOP]`/`[DECISIÓN]`, gates, protocolo stateless) para que el loop autónomo la pueda ejecutar.

### Principio rector (tesis técnica del producto)

Norenty no vende software; vende **evidencia creíble**. Tres propiedades SON el producto:

1. **Integridad de la evidencia** — `ejecucion_evento`, `pod`, `ubicacion` inviolables:
   append-only, con cadena de custodia demostrable (hoy: RLS de fila + REVOKE de columna a
   nivel de esquema, migración `0019`; falta la capa criptográfica, ver Bloque C).
2. **Aislamiento absoluto entre empresas** — ya existe (RLS + REVOKE de columna + suite de
   aislamiento `isolation.test.js` contra BD real). Es el mejor activo del proyecto: se
   protege manteniéndolo **obligatorio en CI, nunca opcional**, no ampliándolo porque sí.
3. **Disponibilidad honesta** — el gestor deja el teléfono solo si el sistema nunca lo deja
   tirado, o le avisa en el momento en que no puede.

Todo ítem de esta fase sirve a una de esas tres propiedades. Lo que no sirva a ninguna es
vanidad y no entra aquí (por eso NO hay microservicios, Kubernetes, Kafka ni multi-región en
este roadmap — ver "Anti-roadmap" al final de la fase).

### Convención nueva de esta fase: "órdenes de trabajo" modulares + tiering de modelo

Cada ítem lleva anotado el modelo recomendado, siguiendo el protocolo de la sección final de
este documento (ahora actualizado): `(picar código: sonnet, esfuerzo bajo)` para trabajo
mecánico con spec cerrada, `(diseño: opus, esfuerzo medio)` cuando el ítem requiere una
decisión de arquitectura antes de picar código. Para los dos ítems más sensibles de diseño
(9.5 hash-chain, 9.13 colas) el protocolo es el mismo que ya funcionó en Fase 7A: **opus
escribe primero un `SPECS-9.md`** (formato SQL literal + firmas de función + casos de test,
igual que `SPECS-7A.md`) y **solo entonces sonnet ejecuta contra esa spec** — nunca al revés.

---

### Bloque A — Tocar la realidad (GATE previo — YA rastreado, no duplicar)

Equivale 1:1 a las decisiones `D1`/`D2`/`D4`/`D6` de Fase 8 (service role key real → probar
el bot contra Telegram real de punta a punta con un viaje completo y POD visible en el
dashboard → activar leaked-password-protection → desplegar). **No crear ítems nuevos aquí**:
seguir marcando el progreso en la sección "Decisiones que solo tú puedes tomar" de Fase 8.

**GATE A (= gate de entrada a todo lo de abajo):** un viaje real recorrido end-to-end contra
Telegram real, en el entorno desplegado, con POD subido y visible en el dashboard. Sin esto,
el resto de esta fase es trabajo de preparación, no de producción.

*Nota de secuencia:* los ítems `[LOOP]` de los Bloques B-C que NO dependen de estar
desplegado (documentación, triggers de BD, scripts) pueden picarse ya, antes del Gate A, para
no tener al loop parado esperando. Los que sí dependen de infra desplegada quedan marcados
explícitamente `(bloqueado por Gate A)`.

---

### Bloque B — Endurecer lo desplegado (semana 1-3 tras el Gate A)

- [ ] `[DECISIÓN]` **9.1 Proyecto Supabase de producción separado del de desarrollo.** Hoy
  demo y "real" viven en el mismo proyecto Supabase — riesgo real no señalado hasta ahora.
  Requiere crear el proyecto nuevo (cuenta/plan Supabase) y decidir el procedimiento de
  migración del esquema (las 30 migraciones ya versionadas hacen esto mecánico una vez
  exista el proyecto). Bloquea: que `seed_demo.py` pueda seguir usándose sin riesgo de tocar
  datos reales.
- [x] `[LOOP]` **9.2 Runbook de rotación de secretos** (picar código: sonnet, esfuerzo bajo).
  `RUNBOOK-SECRETS.md`: procedimiento escrito de 15 min para rotar `SUPABASE_SERVICE_ROLE_KEY`,
  token del bot de Telegram y cualquier clave LLM futura, con el orden exacto de pasos para no
  dejar una ventana sin servicio (rotar en Supabase/BotFather → actualizar en el store de
  secretos de Railway/Vercel → redeploy → verificar heartbeat). No depende del Gate A.
- [ ] `[LOOP]` **9.3 De CSP Report-Only a enforcing** (picar código: sonnet, esfuerzo bajo;
  bloqueado por Gate A). Script/checklist que, tras una semana recogiendo reports reales en
  producción, resume las violaciones y propone el allowlist final; cambiar
  `Content-Security-Policy-Report-Only` a `Content-Security-Policy` en `next.config.js` una
  vez confirmado. Preparar el checklist ya; ejecutarlo solo tras el Gate A.
- [ ] `[LOOP]` **9.4 Simulacro de restore + RPO/RTO documentado** (picar código: sonnet,
  esfuerzo bajo; bloqueado por `D2` — necesita `DATABASE_URL`). Activar Point-in-Time
  Recovery en el proyecto de producción; script de restore a un entorno de prueba +
  checklist de verificación (¿cuántas filas, hasta qué timestamp?); documento con objetivo
  RPO ≤ 24h / RTO ≤ 4h para el piloto y el tiempo medido real del último simulacro.
  Calendarlo mensual (recordatorio, no automatización todavía).
- [ ] `[LOOP]` **9.5 Observabilidad mínima seria** (picar código: sonnet, esfuerzo bajo).
  Sentry ya está cableado (opt-in) — solo falta pegar un DSN real (`[DECISIÓN]` ligera, como
  D6). Lo `[LOOP]` de verdad: configurar un monitor externo gratuito (UptimeRobot/Better
  Stack) contra `/db/health` + home del dashboard + lectura del `bot_heartbeat`, con alerta a
  un chat de Telegram propio; y logging estructurado (JSON) en `bot.py` con `empresa_id`/
  `viaje_id`/`update_id` en cada línea relevante, para poder responder en minutos a "ayer a
  las 18:40 no me llegó la alerta".

**GATE B:** CSP enforcing sin romper nada en producción; un restore de backup ejecutado con
éxito y cronometrado; una alerta de caída del bot probada de verdad (matarlo adrede y
confirmar que el aviso llega).

---

### Bloque B2 — Roles/permisos y navegación (feedback del usuario, 2026-07-04)

Origen: el usuario detectó en uso real que (a) hoy CUALQUIER gestor vinculado a una empresa
puede hacer TODO — sin distinción de rol, sin forma de expulsar a alguien que se va de la
empresa salvo revocar su sesión manualmente — y (b) el sidebar es una lista plana que ha
dejado de ser intuitiva según ha crecido el número de páginas. No depende del Gate A (es
código de dashboard/BD local, no de despliegue) — puede construirse ya.

Decisión de modelo de roles cerrada con el usuario (2026-07-04): **3 roles por empresa**:
- **Admin/Dueño** — todo: gestión de equipo (invitar/expulsar), ver costes/precios/márgenes,
  exportar nómina, borrar datos.
- **Gestor operativo** — día a día: asignar viajes/chóferes/vehículos, hitos, incidencias,
  subir documentos, ver el centro de mando. SIN acceso a coste/precio/margen de viaje, sin
  exportar nómina, sin gestión de equipo (invitar/expulsar), sin borrar documentos/viajes.
- **Solo lectura** — ve todo, no puede mutar nada (útil para dueño/gerente que solo quiere
  mirar sin operar).

Decisión sobre "que alguien se vaya no pueda fastidiar el sistema": lo que falta hoy no es
más auditoría (`audit_log` de 8.8 ya cubre el rastro) ni más aislamiento (RLS ya lo cubre) —
es que **no existe un botón para expulsar/desactivar a un gestor de la empresa**, solo
invitar. Se añade esa capacidad, solo para Admin. Se descarta (por ahora) un flujo de
aprobación en dos pasos (4-eyes) para acciones destructivas — añade fricción real al día a
día y solo tiene sentido con 2+ Admins activos; revisar más adelante si hace falta.

- [x] `[LOOP]` **9.28 SPECS-9-ROLES.md — diseño de roles + expulsión de gestor** (2026-07-04;
  diseño: opus, esfuerzo medio). Antes de tocar código: documento con el diseño exacto, mismo formato
  que `SPECS-7A.md`/`SPECS-9.md`. Debe cerrar, sin dejar nada abierto para quien ejecute:
  - **Esquema:** migración `0032` — columna `gestor.rol text NOT NULL DEFAULT 'admin' CHECK
    (rol IN ('admin','gestor_operativo','solo_lectura'))` (default `'admin'` para que todo
    gestor YA existente conserve su acceso actual sin sorpresas — no es una restricción
    retroactiva silenciosa) + columna `gestor.activo boolean NOT NULL DEFAULT true` (o
    `gestor.expulsado_en timestamptz NULL` — decidir cuál de las dos formas y justificar).
  - **RLS reforzado por rol, no solo por fila:** qué tablas/columnas necesitan una policy
    adicional condicionada a `rol = 'admin'` (p.ej. UPDATE de `empresa.coste_km`/
    `precio_gasoil_litro`/etc., DELETE de `documento`/`viaje`, INSERT/DELETE de `invitacion`,
    UPDATE de `gestor.rol`/`gestor.activo` — un gestor nunca debe poder auto-promoverse) y
    cuáles quedan igual (RLS de fila por `empresa_id` ya es suficiente, el rol solo gatea UI).
    Aplicar el mismo principio de la migración `0019`: defensa en profundidad a nivel de
    Postgres, no confiar solo en que el dashboard oculte un botón.
  - **Expulsión:** cómo un gestor con `activo=false` pierde acceso AL INSTANTE (no solo se le
    oculta la UI) — vía una policy RLS que exige `activo=true` para todo (ver
    `current_empresa_id()` y evaluar si debe empezar a devolver NULL para un gestor inactivo,
    o una función nueva `gestor_activo()` reutilizada en las policies), más forzar el cierre
    de sesión real del `auth.users` correspondiente (Supabase Admin API, requiere qué clave).
    Su historial (`decision_asignacion`, `audit_log`, eventos donde aparezca como `gestor_id`)
    permanece intacto — nunca se borra un gestor, solo se desactiva.
  - **Gating del dashboard:** qué páginas/acciones concretas se ocultan o bloquean para
    `gestor_operativo` y para `solo_lectura` (lista exhaustiva: Ajustes→coste/precio, Ajustes→
    Equipo, exportar CSV de nómina, precio editable en `/viajes/[id]`, botones de borrar en
    documentos/viajes/vehículos/chóferes, wizard de nuevo viaje paso de coste). Un componente
    de guarda reutilizable (p.ej. `<RequireRol rol="admin">`) en vez de condicionales sueltos
    repetidos — coherente con el sistema de diseño consolidado de 7A.12.
  - **Casos de test:** RLS rechaza a un `gestor_operativo` intentando UPDATE directo de
    `empresa.coste_km`; un gestor `activo=false` no puede leer NADA de su empresa aunque el
    JWT siga siendo válido; un gestor no puede auto-promoverse a admin.
- [x] `[LOOP]` **9.29 Implementar roles + expulsión según SPECS-9-ROLES.md** (2026-07-04/05;
  picar código: sonnet, esfuerzo bajo — spec ya cerrada por 9.28). Migración `0032_roles_gestor.sql`
  aplicada y VERIFICADA contra la BD real (no solo confiada): columnas `gestor.rol`/`activo`
  con defaults correctos, `current_empresa_id()` confirmada con `AND activo = true` (expulsión
  instantánea real), triggers `trg_rol_sensibles_*`/`trg_solo_lectura_*` presentes en las 5
  tablas de la spec (empresa/vehiculo/viaje/invitacion/gestor), policies de fila en
  gestor/invitacion. Checksum del archivo local confirmado idéntico al aplicado (sin drift).
  Componente `RequireRol`/`RolProvider` + gating extendido a Ajustes, AuthGuard, nómina, viaje,
  documentos, gastos, mapa, vehículos, wizard. Sección "Equipo" con selector de rol y botón
  "Desactivar" (con protección anti-autobloqueo). 4 tests nuevos de `RequireRol` (184 vitest).
  **Bonus encontrado en la verificación**: el advisor de seguridad señaló 2 funciones de
  trigger (`rol_bloquea_columnas_sensibles`, `solo_lectura_bloquea_escritura`) con `EXECUTE`
  expuesto por RPC a `anon`/`authenticated` — corregido en migración `0033` (REVOKE también de
  `PUBLIC`, no solo de los roles nombrados; el primer intento sin `PUBLIC` no tuvo efecto,
  detectado con `has_function_privilege` antes/después de aplicar). **Pendiente honesto**: la
  verificación de esta noche fue manual por SQL directo (columnas/función/triggers/privilegios),
  no un test automático repetible — falta un test tipo `isolation.test.js` que cree un
  `gestor_operativo`/`solo_lectura` reales y confirme por REST que las mutaciones sensibles
  son rechazadas. Ver 9.31. Nota de proceso: el subagente que picó este código murió a mitad
  (proceso cortado) y el MCP de Supabase se desconectó a la vez — el trabajo se salvó en 2
  commits WIP y se verificó/cerró manualmente cuando el MCP reconectó.
- [x] `[LOOP]` **9.31 Test automático de aislamiento por rol** (2026-07-05) — mismo patrón que
  `isolation.test.js` de 8.4, pero para rol en vez de solo empresa. Crear 2-3 gestores de
  prueba reales (uno por rol) en la empresa demo, confirmar contra Supabase real que: un
  `gestor_operativo` recibe error al intentar `UPDATE` directo de `empresa.coste_km`/
  `viaje.precio` por REST; un `solo_lectura` recibe error en CUALQUIER mutación; un gestor con
  `activo=false` no lee ni una fila de su empresa aunque su JWT siga siendo válido; un gestor
  no puede auto-promoverse ni auto-desactivarse. Limpiar los datos de prueba después (mismo
  criterio que la verificación de invitaciones en 6.9). Cierra el pendiente honesto de 9.29.
  `dashboard/lib/roles-isolation.test.js`: fixtures fijos `roles931.operativo@norenty.com` /
  `roles931.lectura@norenty.com` en la empresa demo, auto-curados en cada ejecución (rol/activo
  se normalizan siempre, así B8 puede desactivar "lectura" a propósito sin dejar el fixture
  roto para la siguiente vez). 12 casos (B1-B11) verificados en verde contra la BD real; B12
  (bypass de service role) queda `it.skip` documentado — no automatizable sin
  `SUPABASE_SERVICE_ROLE_KEY` (D1 sigue vacía). Hallazgo de infraestructura: el proyecto SÍ
  exige confirmación de email para signUp (contrario a lo asumido en sesiones anteriores) y el
  envío de emails de confirmación tiene rate-limit — bloqueó el alta del segundo fixture por
  agotar la cuota. Resuelto sin depender de service role: usuario de Auth creado directamente
  por SQL (pgcrypto `crypt()`/`gen_salt('bf')`, mismo hash que usa GoTrue) con fila espejo en
  `auth.identities`, evitando el envío de email por completo. Es un bootstrap de una sola vez
  por fixture; las siguientes ejecuciones solo hacen `signInWithPassword`.
- [x] `[LOOP]` **9.30 Reorganización del sidebar en grupos/submenús** (picar código: sonnet,
  esfuerzo bajo — spec cerrada aquí mismo, no hace falta SPECS-9 aparte). Reagrupar
  `Sidebar.jsx` de lista plana a grupos colapsables, manteniendo cada enlace existente sin
  romper ninguna ruta:
  - **Hoy** (`/`) — suelto arriba, sin grupo (es la pantalla que se deja abierta todo el día).
  - **Operación** — Viajes, Mapa, Incidencias.
  - **Maestros** (agrupa lo que pediste explícitamente: "todo lo que sea introducir datos") —
    Vehículos, Chóferes, Plantillas de ruta, Parkings (si se independiza de Mapa) — evaluar si
    Parkings se queda dentro de Mapa (hoy es una capa del mapa, no una página propia) o si
    merece entrada propia en Maestros; decidir por consistencia, no split solo por la palabra.
  - **Documentos y cumplimiento** — Documentos (caducidades).
  - **Análisis** — Analítica, Nómina, Presupuesto.
  - **Ajustes** — suelto abajo, con Equipo/roles visible dentro (tras 9.29).
  Colapsable con estado persistido (localStorage, sin backend), grupo activo se auto-expande
  según la ruta actual. Accesibilidad: `aria-expanded` en cada grupo (coherente con el pase
  de accesibilidad de 6.10). Sin librería nueva. Verificar visualmente en `next dev` (no solo
  `next build`) que no se rompe ningún enlace ni el resaltado de "página activa".

**GATE B2:** un gestor con rol `gestor_operativo` no ve coste/precio/equipo en la UI Y, si
intenta la misma operación por una llamada REST directa (saltándose la UI), Postgres la
rechaza — verificado, no asumido. Sidebar reagrupado sin perder ningún enlace, probado a
mano en `next dev`.

---

### Bloque C — Integridad de la evidencia como feature vendible

- [x] `[LOOP]` **9.6 SPECS-9.md — hash-chain de `ejecucion_evento`** (2026-07-04; diseño: opus,
  esfuerzo medio). Antes de tocar código: documento con el diseño exacto — algoritmo del hash
  (`hash = SHA256(hash_anterior || payload canónico)`), migración `0031` (columna `hash` +
  trigger `BEFORE INSERT` que lo calcula, encadenado por `viaje_id` o global — decidir cuál
  y por qué), función/job de verificación de integridad de la cadena completa por empresa,
  qué pasa si la verificación falla (alerta, nunca "arreglo silencioso"), y los casos de
  test (inserción normal, intento de alterar una fila histórica → detectado, cadena rota a
  mitad → localiza el punto exacto). Mismo formato que `SPECS-7A.md`.
- [x] `[LOOP]` **9.7 Implementar hash-chain según SPECS-9.md** (2026-07-05) — migración
  `0031_hash_chain_ejecucion_evento.sql` aplicada (columnas `hash_prev`/`hash`, función
  `ejecucion_evento_calc_hash`, trigger `BEFORE INSERT` que encadena por `viaje_id`, backfill de
  las 69 filas existentes — verificado 69/69 con hash tras aplicar, 15 cadenas/raíces = 15
  viajes con eventos). Script `backend/db/verificar_cadena.py` (solo-lectura, recorre cada
  partición, recomputa y compara; `--viaje <uuid>` opcional; alerta a Sentry si `SENTRY_DSN`).
  Grupo A (`backend/tests/test_hash_chain.py`, 7 tests): algoritmo de hashing/verificación en
  memoria. Grupo B verificado A MANO contra la BD real (dos viajes desechables, borrados
  después): el trigger encadena bien 2 y 3 eventos seguidos, dos viajes son cadenas
  independientes, alterar `ocurrido_en` de un evento histórico por UPDATE directo hace que el
  hash recalculado ya no coincida con el guardado, y borrar el evento intermedio de una cadena
  de 3 rompe el enlace `hash_prev` del siguiente — los 5 casos de SPECS-9.md §5 confirmados.
  **Bonus de verificación**: el hash recomputado por el mirror Python coincide BYTE A BYTE con
  el que calculó el trigger de Postgres para los mismos eventos (mismo algoritmo, confirmado, no
  asumido). Job de verificación periódica (cron/scheduler) queda pendiente de que exista
  infraestructura de scheduler real — mismo criterio honesto que 4.4; ejecutar
  `verificar_cadena.py` manualmente antes de enseñar la evidencia a un cliente mientras tanto.
  93 pytest, 196 vitest, ci.ps1 verde. Este ítem sostiene el pitch "ni nosotros podemos
  falsificar una hora de llegada".
- [ ] `[LOOP]` **9.8 Hash SHA-256 de cada POD al subirlo** (picar código: sonnet, esfuerzo
  bajo). Columna `pod.hash_sha256`; calcular el hash del fichero en el momento de la subida
  (bot, que es quien sube) y guardarlo junto al `foto_url`. Verificación bajo demanda:
  función que recalcula el hash del fichero en Storage y lo compara. Tests.
- [ ] `[LOOP]` **9.9 Endurecer el perímetro del bot** (picar código: sonnet, esfuerzo bajo;
  activación en producción bloqueada por Gate A). Validar `X-Telegram-Bot-Api-Secret-Token`
  en cada request cuando se use modo webhook (ya soportado, no activado); rate limiting
  simple por `chat_id` (ventana deslizante en memoria o tabla, anti-flood); validación de
  tamaño/tipo de fichero en las fotos de POD antes de subir; dedupe por `update_id` de
  Telegram para que un reintento de la propia Telegram no duplique eventos de ejecución.
  Tests de cada guardrail con el arnés E2E existente.
- [ ] `[LOOP]` **9.10 Mínimos de AuthN/AuthZ del dashboard** (picar código: sonnet, esfuerzo
  bajo). MFA opcional para gestores (Supabase Auth ya lo soporta, activar + UI en Ajustes);
  expiración/revocación explícita de invitaciones ya vencidas; botón "cerrar todas las
  sesiones" del gestor. Mantener `isolation.test.js` como **check obligatorio en `ci.ps1`**
  (ya lo es — dejar explícito aquí que nunca se debe hacer opcional ni saltable).

**GATE C:** demo grabada de 2 minutos enseñando la cadena de custodia (intento de alterar un
evento histórico → detectado por la verificación); suite de aislamiento + verificación de
cadena corriendo en `ci.ps1` en verde de forma sostenida.

---

### Bloque D — GDPR y compliance como argumento comercial (en paralelo al piloto)

Los datos de geolocalización de un chófer son datos personales sensibles en la práctica.
Cualquier cliente serio lo va a preguntar; mejor llegar con los deberes hechos que a remolque.

- [ ] `[DECISIÓN]` **9.11 Consulta de 1h con abogado laboralista/privacidad** — base
  jurídica del tracking del chófer (interés legítimo del empleador + información al
  trabajador; el consentimiento NO es la base correcta en una relación laboral). Es una
  consulta puntual, no un retainer — desbloquea el resto del bloque con criterio real en
  vez de una suposición del loop.
- [ ] `[LOOP]` **9.12 Registro de actividades de tratamiento (art. 30) — borrador** (picar
  código: sonnet, esfuerzo bajo). Documento `PRIVACIDAD-RAT.md` con el borrador basado en el
  esquema real (qué tabla guarda qué dato personal, con qué finalidad, cuánto se retiene) —
  el loop puede redactar el borrador técnico; la base jurídica final la cierra 9.11.
- [ ] `[LOOP]` **9.13 Política de retención automatizada** (picar código: sonnet, esfuerzo
  bajo). Job de purga: `ubicacion` (dato granular de posición) se agrega o borra pasados N
  días (default 90, configurable); `ejecucion_evento` y `pod` se retienen años (son la
  evidencia contractual del servicio, no se purgan). Documentar la política junto al código.
  Tests del job de purga (con fixtures de fechas).
- [ ] `[LOOP]` **9.14 Página "Subprocesadores" + plantilla de DPA** (picar código: sonnet,
  esfuerzo bajo). Lista pública de subencargados de tratamiento (Supabase, Vercel, Railway,
  Sentry — todos con DPA estándar propio, enlazarlos) y una plantilla de DPA lista para
  firmar con cada cliente (Norenty como encargado/processor, la flota como responsable/
  controller). Fijar región UE explícitamente en la configuración de Supabase/Vercel/Railway
  y documentarlo.
- [ ] `[LOOP]` **9.15 Procedimiento de derechos ARCO** (picar código: sonnet, esfuerzo bajo).
  Documento + función de soporte en `lib/data.js` (aunque el procedimiento sea manual al
  principio) para exportar o borrar todos los datos de un chófer concreto a petición suya:
  qué tablas tocar, en qué orden (respetando FKs), qué NO se puede borrar sin romper la
  cadena de custodia de 9.7 (documentar esa tensión explícitamente, no ocultarla).

**GATE D:** una página pública "Seguridad y privacidad" en norenty.com + DPA firmable +
una respuesta escrita de una página al cuestionario típico de un responsable de compliance.

---

### Bloque E — Solidez operativa multi-cliente (con 2-3 flotas reales activas)

- [ ] `[LOOP]` **9.16 Migraciones con red** (picar código: sonnet, esfuerzo bajo). Entorno de
  staging con datos sintéticos (reutilizar `seed_demo.py`) donde cada migración corre antes
  que en producción; por cada migración nueva a partir de aquí, documentar también su
  reversión (aunque sea "restaurar backup + replay de eventos posteriores").
- [ ] `[LOOP]` **9.17 SPECS-9.md (bloque colas) — colas para lo asíncrono** (diseño: opus,
  esfuerzo medio). Cuando haya volumen real: sacar de la request del bot lo lento
  (validación de POD con visión LLM cuando se apruebe D3/7B, notificaciones) a un worker con
  reintentos persistentes. Diseño recomendado: **Postgres como cola** (`SELECT ... FOR
  UPDATE SKIP LOCKED`) antes que añadir Redis — menos piezas nuevas, más sólido, coherente
  con el "anti-roadmap" de no añadir infraestructura que no haga falta todavía.
- [ ] `[LOOP]` **9.18 Implementar colas según SPECS-9.md** (picar código: sonnet, esfuerzo
  bajo — spec ya cerrada por 9.17). Tabla de cola, worker, tests de reintentos y de que un
  fallo del worker no pierde el mensaje.
- [ ] `[LOOP]` **9.19 SLOs internos medidos con lo que ya se loguea** (picar código: sonnet,
  esfuerzo bajo). Definir 2-3 objetivos concretos ("el bot responde en <5s el 99% de las
  veces", "la notificación de asignación llega en <60s") y un script/vista que los calcule a
  partir de los logs estructurados de 9.5 y el propio `bot_heartbeat`. Nada de infra nueva.
- [ ] `[LOOP]` **9.20 Runbooks de los 5 incidentes más probables** (picar código: sonnet,
  esfuerzo bajo). `RUNBOOKS.md`: bot caído, Supabase degradado, webhook roto, proveedor LLM
  caído (cuando exista), clave rotada a medias — pasos escritos y concretos para cada uno.
- [ ] `[DECISIÓN]` **9.21 Simulacro de incidente real** — un sábado, romper algo a propósito
  (con aviso y ventana acordada) y operar el runbook correspondiente de 9.20. Necesita que
  el usuario fije la fecha/ventana; el loop no decide cuándo interrumpir un sistema en uso.
- [ ] `[LOOP]` **9.22 OSRM: probarlo de verdad o degradarlo oficialmente** (picar código:
  sonnet, esfuerzo bajo). O se levanta el contenedor Docker con el extracto de España y se
  verifica el camino feliz real una vez (medio día), o se documenta explícitamente en
  `ROADMAP.md`/UI que el cálculo de km/ETA es "Haversine×1.3, no probado contra routing real"
  hasta tener presupuesto para HERE. Lo que no se ha ejecutado nunca no se vende como si
  funcionara — cerrar esta ambigüedad en un sentido u otro, no dejarla flotando más tiempo.

**GATE E:** 30 días seguidos con 2+ flotas activas sin intervención manual no planificada;
runbooks probados al menos una vez cada uno; SLOs medidos y publicables.

---

### Bloque F — La arquitectura escala con el negocio (gated por ingresos, NO antes)

Nada de este bloque se empieza sin (a) un cliente que lo pida explícitamente + (b) ingreso
real que lo pague + (c) el ítem anterior de la cadena en producción estable. Todo `[DECISIÓN]`.

- [ ] `[DECISIÓN]` **9.23 API propia entre dashboard y datos.** Hoy el dashboard habla
  directo a Supabase (por diseño, más simple). Migrar solo cuando: integraciones TMS de
  terceros, app móvil nativa, o lógica que no quepa en RLS lo exijan. Ventaja ya pagada por
  cómo está construido: `dashboard/lib/data.js` son funciones puras y testeadas — moverlas
  detrás de FastAPI el día que haga falta es mecánico, no una reescritura.
- [ ] `[DECISIÓN]` **9.24 Particionado de `ubicacion`/`ejecucion_evento`** — cuando superen
  del orden de 10M de filas, no antes (prematuro hoy).
- [ ] `[DECISIÓN]` **9.25 Réplica de lectura para analítica** — cuando los informes
  (`/analitica`, `/nomina`, rentabilidad) empiecen a competir de verdad con el tráfico
  transaccional del bot/dashboard.
- [ ] `[DECISIÓN]` **9.26 SOC 2 Type I / ISO 27001** — solo si un cliente enterprise lo pide
  por escrito. Los Bloques B-D de esta fase ya dejan el grueso del camino hecho (evidencias,
  runbooks, control de acceso).
- [ ] `[DECISIÓN]` **9.27 Voz (D3/7B.1), triaje LLM (7B.2), HERE truck-aware (7B.6),
  auto-dispatch (7B.7)** — ya estaban en Fase 7B; entran en este orden por demanda real de
  cliente, no por elección interna. Auto-dispatch en particular: SIEMPRE con humano en el
  loop hasta que `decision_asignacion` (7A.2) demuestre estadísticamente que el motor elige
  igual o mejor que el mejor gestor humano — nunca antes, sin excepción.

**GATE F:** cada ítem de este bloque entra solo con las tres condiciones (a)+(b)+(c) cumplidas
a la vez, documentadas en `PROGRESS.md` con el nombre del cliente/ingreso que lo desbloqueó.

---

### Anti-roadmap de la Fase 9 (lo que NO se hace, y por qué)

- **Microservicios, Kubernetes, Kafka, multi-región: no.** Un monolito Python + Next.js +
  Postgres bien operado aguanta cientos de flotas. La complejidad añadida es enemiga directa
  de la solidez que este producto vende.
- **Reescrituras.** El código ya está bien estructurado (lógica en funciones puras, migraciones
  con checksum, tests de aislamiento). Esta fase ENDURECE, no reescribe.
- **Herramientas de seguridad de pago antes de agotar lo gratis.** Supabase PITR, Sentry,
  UptimeRobot/Better Stack, GitHub Dependabot + secret-scanning — activar esto es gratis y
  mecánico (candidatos claros para `sonnet, esfuerzo bajo` en cuanto se decida 9.1).
- **Features nuevas mientras un gate de esta fase esté en rojo.** Julio 2026 ya estableció
  "solidez antes que features"; esta fase es su continuación, no su sustituto — el loop NO
  debe volver a Fase 7B/backlog de features mientras un Bloque A-D esté abierto.

### El pitch que compra esta fase (para la reunión con la empresa piloto)

"Cada hora de llegada, cada albarán y cada kilómetro que ves lleva una cadena criptográfica
que ni nosotros podemos alterar. Tus datos están aislados por diseño y lo probamos en cada
despliegue con tests automáticos. Todo en servidores de la UE, con contrato de tratamiento de
datos listo para tu asesoría. Y si el sistema se cae, lo sabemos antes que tú."

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

**Tiering de modelos** (el orquestador se mantiene barato por ser stateless; actualizado
2026-07-04 para maximizar el uso de la IA sin gastar de más — vigente desde Fase 9 en
adelante, aplica también con carácter retroactivo a cualquier fase anterior aún abierta):
- **Picar código con spec ya cerrada** (mecánico, repetitivo, sin ambigüedad de diseño) →
  subagente `model: sonnet`, esfuerzo/reasoning **bajo**. Es el caso por defecto: la mayoría
  de ítems `[LOOP]` de este documento ya traen la decisión de diseño tomada en su propia
  descripción.
- **Decisión de arquitectura, seguridad, o cualquier ítem que module el comportamiento de
  varias piezas del sistema a la vez** → subagente `model: opus`, esfuerzo/reasoning
  **medio**. Antes de picar código, opus produce primero una spec corta y cerrada (mismo
  patrón que `SPECS-7A.md`: SQL literal, firmas de función, reglas numéricas, casos de test)
  cuando el ítem lo amerite — ver la convención de "SPECS-9.md" explicada al inicio de la
  Fase 9. Una vez la spec existe, la EJECUCIÓN vuelve a ser trabajo de `sonnet` esfuerzo bajo.
- **Bug difícil / diagnóstico con causa no obvia** → `model: opus`, esfuerzo medio (mismo
  criterio que ya cazó los bugs reales de `tipo_evento`, el `RETURNING` vs RLS, y el
  `.rpc().catch()` del mapa — todos requerían leer varias piezas del sistema a la vez, no
  picar una línea).
- Delegar la EXPLORACIÓN de código a subagentes (cualquier tier) para que el hilo principal
  no se llene de contenido de archivos.

**Órdenes de trabajo modulares:** cada ítem `[LOOP]` de este documento debe poder entregarse
a un subagente SIN que necesite leer el resto de la conversación — el propio texto del ítem
(o su `SPECS-*.md` asociado) es la orden de trabajo completa: qué construir, qué archivos
toca, cómo se verifica, y qué modelo usar. Si un ítem no se puede resumir así, es señal de
que hace falta escribir su SPECS-*.md antes de ejecutarlo, no de improvisar sobre la marcha.

**STOPS duros (nunca en autónomo):** desplegar, features que gastan dinero (LLM visión/voz sin
rate-limit+presupuesto), cambios de esquema destructivos, cualquier `[DECISIÓN]`, romper algo
a propósito para un simulacro de incidente sin ventana acordada con el usuario (9.21).
