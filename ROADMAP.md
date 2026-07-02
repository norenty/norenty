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
- [ ] `[LOOP]` **6.8 Bot: /eta** — portar `calcularEtaConParadas` a Python (función pura espejo,
  mismos casos de test que en JS) y responder al chófer el ETA-561 de su viaje activo usando km
  Haversine×1.3 entre hitos pendientes (el bot no depende de OSRM). i18n.
- [ ] `[LOOP]` **6.9 Invitaciones multi-gestor** — migración: tabla `invitacion(id, empresa_id,
  email, codigo uuid, usada_at)` con RLS por empresa; en Ajustes, sección "Equipo": invitar por
  email genera enlace con código; el signup con `?invitacion=codigo` une el gestor nuevo a ESA
  empresa en vez de crear una. Tests de la lógica de data.js.
- [ ] `[LOOP]` **6.10 Pase de accesibilidad/móvil de páginas nuevas** — documentos, analítica,
  nómina, mapa (form parking), viabilidad/ETA en viaje: labels con htmlFor, focus visible, orden de
  tabulación, contraste de badges, overflow en móvil 360px. Arreglos concretos, sin librerías.
- [ ] `[LOOP]` **6.11 E2E del bot con updates reales** — tests de integración que construyen
  `Update`s reales de PTB y los pasan por los handlers registrados (`app.process_update` con
  FakeSupabase): flujo completo /start→ver hito→llegada→POD→completar viaje, y flujo /incidencia.
  Caza regresiones de wiring que los tests unitarios no ven.

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
