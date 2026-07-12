# Norenty — Log de progreso del loop

Append-only. Una línea por iteración del loop. Formato:
`<fecha-hora> | <ítem> | <commit|—> | <resultado: HECHO / BLOQUEADO / NECESITA HUMANO>`

Este archivo es estado durable: el loop lo lee al despertar para saber qué se hizo sin
depender del historial de conversación.

---

2026-07-12 | Fase 10.7: pantalla de salud del sistema (script de operador) | (por commitear) |
HECHO. `backend/db/panel_salud.py`: junta heartbeat+SLOs(9.19)+alertas de integridad(10.6)+
episodios de bot caído(10.5) en un reporte. Decisión: es un script del operador, NO página del
dashboard — esas tablas son estado global de la plataforma y no existe rol admin-de-plataforma
distinto del intra-empresa; meterlo en el dashboard filtrado por tenant arriesgaría fuga
cruzada entre clientes. Bug real encontrado/corregido: mezclaba RealDictCursor con el estilo de
cursor por tupla que esperan calcular_slos.py/monitor_heartbeat.py. 3 tests Grupo A. Grupo B
contra la BD real (solo lectura): reporte completo sin errores. 139 pytest+7+6+3, 199 vitest,
ci.ps1 completo verde.

2026-07-12 | Fase 10.6: verificación de integridad programada (cadena+POD) | 0234145 |
HECHO. Migración `0045_alerta_integridad.sql`: UNIQUE(tipo,entidad_id) + ON CONFLICT DO
NOTHING — anti-spam distinto al de 10.5 (una rotura NO se auto-resuelve, se alerta la primera
vez y nunca más hasta que un humano investigue/borre). `monitor_integridad.py` reutiliza
verificar_cadena/verificar_hash_pod y enviar_telegram/obtener_chats_gestores de
monitor_heartbeat.py sin duplicar código. Sin scheduler propio (documentado). 6 tests Grupo A.
Grupo B contra la BD real: cadena íntegra, 0 PODs todavía, sin repetir alertas. 139 pytest+7+6,
199 vitest, ci.ps1 completo verde.

2026-07-12 | Fase 10.5: alerta real de "bot caído" (Telegram, anti-spam) | 3e6e5dc |
HECHO. Migración `0044_alerta_bot_caido.sql` (mecanismo interno). `monitor_heartbeat.py`:
comprueba heartbeat, alerta Telegram (HTTP directo a Bot API, independiente del proceso del
bot) si cae y no hay alerta abierta, notifica y cierra al recuperarse. Sin scheduler propio
(cron/Tarea Programada pendiente, documentado). 7 tests Grupo A. Grupo B contra la BD real:
ciclo completo funciona; reveló que bot_heartbeat está vacía (bot nunca corrió contra Telegram
real) y 0 gestores tienen telegram_chat_id vinculado. También corregida colisión de numeración:
el 10.4 de "logs+Sentry" se renumeró a 10.4b (colisionaba con el 10.4 de secretos del 2026-07-08).
139 pytest+7, 199 vitest, ci.ps1 completo verde.

2026-07-12 | Fase 12.2: controlling en el tiempo (comparación mes-a-mes) | 8bea097 |
HECHO. `getComparativaMensual` en data.js: agrega rentabilidad+puntualidad del periodo actual
vs. el anterior de igual duración, variacionPct protegido contra división por 0/null. Sin
tablas/cálculos nuevos, pura composición. `/analitica`: componente `Variacion` (flecha+%, con
`invertir` para "viajes a pérdidas"), cableado en Puntualidad y Rentabilidad. 2 tests Grupo A.
199 vitest, ci.ps1 completo verde.

2026-07-12 | Fase 12.1: foto en los gastos (evidencia con integridad) | 6d95b72 |
HECHO. `gasto_viaje` (0024) guardaba importe/tipo pero sin foto. Migración
`0043_gasto_foto.sql`: 2 columnas nullable (`foto_url`, `foto_hash_sha256`), sin bucket ni
policy nuevos — reutiliza `documentos` (la policy ya scopea por `empresa_id` como primera
carpeta, `gasto/` cae dentro). `createGastoViaje` acepta `fotoUrl`/`fotoHash`;
`GastosViajeSection.jsx` calcula SHA-256 en el navegador (Web Crypto) antes de subir, ver foto
con URL firmada 60s (mismo patrón que `DocumentosSection`), borra el objeto del bucket al
borrar el gasto. 2 tests Grupo A. Verificado Grupo B: columnas confirmadas en la BD real,
nullable, sin romper filas existentes. 197 vitest en data.test.js, ci.ps1 completo verde
(build de 21 páginas). También integrada Fase 12 al roadmap (discovery con gestor de tráfico
12.3, controlling en el tiempo 12.2, asistente/IA Brain 12.4 deferido a propósito — gate: no
antes del discovery + corpus de Fase 11 con uso real).

2026-07-07 | Fase 9.37: convención "una migración, una responsabilidad" | 2eab62e |
HECHO. `ONBOARDING.md §7` documenta separar DDL/backfill/hardening de columnas en migraciones
sucesivas, citando el incidente real de 0032 (9.29) como motivo. No retroactivo. Sin cambios de
código — ci.ps1 verde.

2026-07-08 | Fase 10.4: sacar secretos reales del repo tras exposición accidental | d4c6b4b |
HECHO. Un `Read` de `.env` volcó SUPABASE_SERVICE_ROLE_KEY/DATABASE_URL/TELEGRAM_BOT_TOKEN/
DEMO_PASSWORD al chat (segunda vez, la primera fue un comando PowerShell — RUNBOOKS.md §5).
Arreglo de raíz: secretos reales movidos a ~/.norenty-secrets/.env, fuera del repo (procedimiento
en RUNBOOK-SECRETS.md §0). 11 puntos de load_dotenv/loadEnv en backend+tests actualizados con
override=True sobre la ruta externa. Barrera técnica en .claude/settings.json (deny sobre
Read/cat/Get-Content de .env, dashboard/.env.local, ~/.norenty-secrets/**) + regla en CLAUDE.md.
ci.ps1 verde sin la ruta externa creada todavía (comportamiento idéntico). Pendiente del usuario:
rotar los 4 secretos y rellenar el archivo externo con los valores rotados.
También registrado en 10.2 (bloqueado, ver nota) y hallazgo sobre 10.3: ya existen
isolation.test.js (8.4) y roles-isolation.test.js (9.31), y se creó una cuenta de prueba
rls-iso-b@norenty.com en la empresa ajena a DEMO_EMAIL para reforzar esa suite.

2026-07-08 | Fase 11.2: capa de contexto (`SPECS-11.md` opus → implementado literalmente) |
67c883d | HECHO. Migración `0042_contexto.sql`: anclaje polimórfico entidad+entidad_id
(como audit_log, sin FK a propósito), canal con CHECK de 4 valores (2 usables hoy, 2 reservados
para 11.3/11.6 sin re-migrar), ocurrido_en vs created_at separados. Decisión explícita:
MUTABLE, no append-only (memoria de trabajo editable, no evidencia forense) + trigger
solo_lectura. nota_gestor NO migrada, se deja intacta. Índice de texto deferido a propósito.
data.js: getContexto/createContexto, 9 tests Grupo A. Verificado Grupo B contra la BD real:
estructura completa + los dos CHECK rechazan valores inválidos de verdad + canal reservado se
acepta en BD (restricción solo en JS). 139 pytest, 257+1 skip vitest, build verde.

2026-07-07 | Fase 11.1b: UI de clientes + selector en formularios de viaje | 168b8dc |
HECHO. Página `/clientes` (alta/edición/baja lógica), enlazada en Sidebar. `createViaje` acepta
`clienteId` opcional sin tocar `referencia`. Selector en `/viajes/nuevo` y `/viajes/nuevo-w`
(paso 1 + resumen paso 3). 2 tests Grupo A. Verificado Grupo B contra la BD real: cliente
creado, asociado a un viaje real con `referencia` y `cliente_id` conviviendo, limpiado después.
139 pytest, 247+1 skip vitest, build verde (20 páginas).

2026-07-07 | Fase 11.1: cliente como entidad de primera clase | f2482f2 | HECHO.
Migración `0041_cliente.sql` (DDL puro con cabecera de reversión + trigger solo_lectura),
aplicada con migrate.py (D2 resuelta) y verificada Grupo B contra la BD real (9 columnas, RLS
on, viaje.cliente_id+FK, policy, trigger, checksum registrado). Capa de datos en data.js:
getClientes/createCliente/actualizarCliente/desactivarCliente (baja lógica)/asignarClienteAViaje.
8 tests Grupo A. Se conserva viaje.referencia intacto. Alcance: schema+datos+tests; la UI
(/clientes + selector en formularios de viaje) se deja como 11.1b. 139 pytest, 245+1 skip
vitest, build verde.

2026-07-07 | Fase 11 planificada (capa de conocimiento, precursor del bot de llamadas) | 92ca0c0
| HECHO (planning, sin código). Respuesta a la preocupación del usuario: gran parte
del conocimiento del negocio vive en canales invisibles (llamadas, email, WhatsApp) y solo
tenemos Telegram. Añadida Fase 11: capturar ese conocimiento COMO SUBPRODUCTO de usar el sistema
(no pidiéndolo). Items: 11.1 cliente como entidad de primera clase (hoy es solo texto libre
`viaje.referencia`), 11.2 capa de contexto (nota/transcripción/email) atada a entidades con
procedencia, 11.3 nota de voz→transcripción Whisper (el puente de mayor palanca para capturar
llamadas sin construir el bot), 11.4 extender captura de decisiones más allá de asignación, 11.5
consentimiento/RGPD, 11.6 WhatsApp como 2º canal, 11.7 bot de llamadas por etapas (asistir→
copiloto→autónomo, nunca autónomo de entrada). Principios: corpus primero/bot después; el bot
RECUPERA el conocimiento de la empresa, no lo inventa; cada capa produce el activo de la
siguiente. La captura (11.1/11.2/11.4) es parte del MVP; el bot es lo último (GATE 11). Sin
cambios de código.

2026-07-07 | Fase 10 planificada (revisión CTO "mayor retorno") + reconciliación de items stale
de Fase 6 | 2bcf557 | HECHO (planning, sin código). (1) Reconciliados 9 items stale de
Fase 6: 6.13/6.14/6.15/6.16/6.17/6.18/6.20/6.21/6.22 ya estaban hechos bajo números de Fase
7A/8/9 — marcados [x] con puntero al número real; 6.12 (Ctrl+K) y 6.19 (i18n) confirmados
deprioritizados por decisión del usuario 2026-07-04, se dejan [ ] a propósito. (2) Añadida Fase
10 (Bloques G/H/I): cerrar la brecha con la realidad (smoke en vivo 10.1, restore drill 10.2 ya
desbloqueado por D2, aislamiento RLS en CI 10.3), fiabilidad observable (logs+Sentry 10.4,
alerta bot caído 10.5, integridad programada 10.6, panel de salud 10.7), aprendizaje propio
suggestion-only (error de estimación 10.8, calibración por empresa 10.9, aprender sugerencia de
chófer 10.10). Principio rector nuevo: el sistema aprende de su propia verdad pero cada ajuste
se ofrece como sugerencia transparente, nunca mutación silenciosa (la confianza es el producto).
GATE 10 antes de un piloto pagando = 10.1 pasado una vez + 10.3 verde. Conclusión honesta: el
mayor retorno NO es reconstruir; la arquitectura es sólida para esta etapa.

2026-07-07 | Fase 9.42: plan de módulo compartido para Reglamento CE 561/2006 | 68cd94d |
HECHO. `PLAN-561-MODULO-COMPARTIDO.md`: estado actual, 4 opciones evaluadas, decisión de
adoptar "mantener duplicado + fortalecer tests de paridad" como regla operativa inmediata
(sin construir infraestructura especulativa), con la opción de módulo JSON declarativo
anotada como mejora futura condicionada a una señal real. Sin cambios de código — ci.ps1
verde.

2026-07-07 | Fase 9.40: dividir ajustes/page.jsx en 5 subcomponentes | 31327b7 | HECHO.
`AjustesPerfilSection`, `AjustesMfaSection`, `AjustesBotSection`, `AjustesEquipoSection`,
`AjustesEmpresaSection` — todos presentacionales, estado/handlers se quedan en page.jsx
(908 -> ~370 líneas). Orden visual de secciones cambió ligeramente al agrupar por dominio
(cosmético, no funcional — documentado en ROADMAP). 7 smoke tests nuevos con
renderToStaticMarkup (no había tests de UI para esta página). 237+1 skip vitest, ci.ps1
completo verde (139 pytest).

2026-07-07 | Fase 9.39: extraer escrituras de ajustes/page.jsx a data.js | e64bf79 |
HECHO. Se encontraron 5 funciones (no 3 como decía el ítem): guardarNombreEmpresa,
guardarBaseEmpresa, guardarCosteKmEmpresa, guardarVelocidadEmpresa,
guardarDesgloseCosteEmpresa — todas extraídas a data.js con su validación numérica, lanzando
Error con el mismo texto que antes. 11 tests Grupo A nuevos. 230+1 skip vitest, ci.ps1
completo verde (139 pytest).

2026-07-07 | Fase 9.38: adoptar formateadores de format.js en 9 páginas | 86a2d05 |
HECHO. Las 6 funciones sin adopción (fmtEur, fmtKm, fmtFechaLarga, fmtFechaCorta,
fmtFechaHora, fmtHora) tenían al menos un sitio real donde encajaban exacto — todas
adoptadas, ninguna borrada. Tocadas: analitica, choferes/[id], vehiculos/[id],
GastosViajeSection, viajes/[id], viajes/nuevo-w, presupuesto, nomina, incidencias, t/[token],
Timeline (sustituye un formatHora local duplicado). Sitios donde el formateador NO era un
match seguro (timestamps completos usados con formateadores de fecha-sola que añaden
T12:00:00, o toLocaleDateString sin opciones) se dejaron sin tocar. 219+1 skip vitest, build
sin errores, ci.ps1 completo verde (139 pytest).

2026-07-07 | Fase 9.36: migrate.py falla ante checksum inesperado | ecd369c | HECHO.
`ALLOWLIST_DRIFT_CONOCIDO` con los 10 nombres reales de 0002-0011 (backfill previo al runner);
`clasificar_migraciones()` extraída como lógica pura testeable; cualquier drift de checksum
fuera del allowlist ahora hace `sys.exit(1)` en vez de solo avisar. 5 tests nuevos Grupo A en
`test_migrate_clasificar.py`. 139 pytest, ci.ps1 completo verde.

2026-07-07 | Fase 9.33: caché OSRM + debounce de realtime | dce8e82 | HECHO.
`ResumenHoy.jsx` no está suscrita a realtime hoy (solo carga al montar) — el problema real
descrito está en `getViajes()`/home vía `useRealtimeRefresh`, sin debounce. Arreglado en la
raíz y de forma genérica: `kmCarreteraViaje` cachea en memoria por firma de hitos (TTL 5 min);
`useRealtimeRefresh` ahora usa una función pura `debounce()` (800ms) que coalesce ráfagas de
eventos en una sola llamada, beneficiando a todas las pantallas que usan el hook. Nuevo
`dashboard/lib/realtime.test.js`. 168 vitest en archivos tocados, ci.ps1 completo verde.

2026-07-07 | Fase 9.32: Paginar/acotar lecturas sin límite en data.js | 571b568 | HECHO.
`getDocumentosPorCaducar` filtra `fecha_caducidad` server-side en vez de traer `documento`
entera; `getParkings` añade tope de seguridad `LIMITE_PARKINGS=5000`; `getAuditLog` ordena y
acota server-side `LIMITE_AUDIT_LOG=200` (append-only, migración 0037); `getViajes()` (home)
acota `LIMITE_VIAJES_HOME=300` por `created_at desc`. `getMetricasRentabilidad` ya estaba bien
acotada por fechas, sin cambio. Mock de vitest extendido con `.lte()`, `.not()`, `.order()`
real. 164 vitest data.test.js verdes, ci.ps1 completo verde (134 pytest, 215 vitest).

2026-07-07 | Fase 9.22: OSRM degradado oficialmente (Docker no disponible) | 422547c |
HECHO. No hay Docker instalado en esta máquina, así que no se pudo levantar el contenedor
OSRM ni probar el camino feliz real. Se tomó la rama de degradar oficialmente:
`infra/osrm/README.md` ahora tiene un aviso explícito de que el servicio nunca se ha probado
contra routing real y que hoy todos los cálculos de km/ETA usan el fallback Haversine×1.3
(`FACTOR_SINUOSIDAD_FALLBACK`), ya marcado `estimado:true` en la UI de 5 pantallas
(nomina, presupuesto, analitica, viajes/[id], viajes/nuevo-w). Cierra la ambigüedad sin
fingir una verificación que no ocurrió. Sin cambios de código — ci.ps1 verde.

2026-07-07 | Fase 9.20: Runbooks de los 5 incidentes más probables | 2facf79 | HECHO.
`RUNBOOKS.md` nuevo: bot caído, Supabase degradado, webhook roto, proveedor LLM caído (cuando
exista, Fase 7B), clave rotada a medias. Cada uno con diagnóstico paso a paso y respuesta,
referenciando `RUNBOOK.md`/`RUNBOOK-SECRETS.md` en vez de duplicar contenido. Incluye dos
incidentes reales de esta sesión como casos documentados: el banner de "organización degradada"
de Supabase que se confundió con un problema de login, y la rotación de `DATABASE_URL` tras una
exposición accidental de la contraseña en un comando de diagnóstico. También se corrigió una
nota desactualizada en `RUNBOOK-SECRETS.md §1` (D1 ya resuelta, no seguía vacía). Ítem
documental, sin cambios de código — ci.ps1 verde (134 pytest, 215 vitest).

2026-07-05 | Fase 9.19: SLOs internos medidos con lo que ya se loguea | 664c75a | HECHO.
`backend/db/calcular_slos.py`: 3 objetivos definidos, 2 realmente calculables hoy sin
infraestructura nueva. SLO 1 (disponibilidad del bot ≥99%): a partir de los huecos entre filas
de `bot_heartbeat`, usando el MISMO umbral (`UMBRAL_HEARTBEAT_S=300s`) que ya usa
`dashboard/lib/data.js` para el aviso de "bot caído" (8.3) — consistencia entre lo que ve el
gestor y lo que mide este script. SLO 2 (notificación de asignación en <60s el ≥99%): hallazgo
de que el delta real YA existe en la BD sin instrumentar nada — `audit_log.accion='asignar_chofer'`
(cuando el gestor asigna) y `viaje.notificado_asignacion_en` (cuando el bot avisó al chófer) se
pueden restar directamente por SQL, ambos ya escritos por código existente. SLO 3 (latencia de
respuesta <5s el 99%): marcado EXPLÍCITAMENTE como no calculable hoy en vez de simularlo —
necesita instrumentar duración en los logs estructurados de 9.5 (los campos añadidos ahí son de
contexto, no de tiempo) y un destino de logs consultable que no existe (mismo hueco que el
monitor externo de 9.5, bloqueado por Gate A). 8 tests Grupo A con cursor fake: disponibilidad
100% con latidos regulares, reducción proporcional con un hueco real, sin datos con <2 latidos;
% dentro de objetivo con todas/algunas fuera, percentil 95 sobre deltas ordenados, sin datos sin
asignaciones. Ejecutado contra la BD real (solo lectura, sin riesgo): devuelve honestamente "sin
datos suficientes" para ambos SLOs — el bot nunca se ha ejecutado contra Telegram real todavía
(D1 se resolvió hoy mismo, en esta misma sesión) y no hay asignaciones reales notificadas aún;
resultado correcto, no un fallo. ci.ps1 verde (134 pytest, 215 vitest, build).

---

2026-07-05 | Fase 9.17+9.18: Cola de trabajos asíncrona sobre Postgres | 25f9009 | HECHO.
9.17 (diseño, delegado a un subagente `model: opus`): nueva sección "Bloque colas" en
`SPECS-9.md`, mismo rigor que `SPECS-7A.md`/`SPECS-9-ROLES.md` — todas las decisiones cerradas,
nada dejado a criterio del ejecutor. Tabla `cola_trabajo` con el patrón de `bot_heartbeat` (RLS
interna, sin policies de `authenticated`, `empresa_id` como metadato de trazabilidad, NO como
eje de aislamiento — la cola es 100% invisible al dashboard). Claim vía función SQL
`cola_reclamar_lote()` con `FOR UPDATE SKIP LOCKED` (decisión: PostgREST no expone locking de
fila, así que el worker usa `psycopg2`/`DATABASE_URL` como ya hace `migrate.py`; el `enqueue` sí
va por PostgREST porque es un INSERT normal sin locking, evita abrir una conexión Postgres en
el hot path del bot). Backoff exponencial base 2 sobre 60s (60/120/240/480s), `max_intentos=5`
por defecto, dead-letter (`muerto`) permanente — nunca se auto-purga, misma filosofía que el
hash-chain y `audit_log`. Worker reutiliza la `JobQueue` existente de `bot.py` (tercer
`run_repeating`, junto a `heartbeat`/`procesar_notificaciones_asignacion`) en vez de un proceso
separado — la sutileza documentada: como `psycopg2` es bloqueante y la `JobQueue` corre en el
event loop asyncio, el tick debe ejecutarse vía `run_in_executor` para no congelar el bot.
**Conclusión honesta y deliberadamente conservadora**: tras analizar los call-sites reales
(`notificar_gestor_evento`, `alertar_gestor`, subida de POD), NINGÚN trabajo síncrono actual se
migra a la cola hoy — las notificaciones son rápidas y ya toleran fallo sin dolor real, y el
consumidor natural (validación de POD por visión LLM) sigue bloqueado por la decisión de
presupuesto D3/7B, no aprobada. Se construyen los raíles (tabla+claim+worker) más un handler
`noop` de humo (prueba el ciclo completo sin depender de nada externo) y un stub `validar_pod`
que falla limpiamente con un `NotImplementedError` explícito si alguien lo encola hoy — nunca
se pierde ni se procesa a medias. Queda escrito el copy-paste exacto de cómo activarlo el día
que D3/7B se apruebe.

9.18 (implementación): migración `0040_cola_trabajos.sql` aplicada y verificada; `backend/app/cola.py`
completo (enqueue, `_conectar`, `reclamar_lote`, `marcar_completado`, `marcar_fallido` con la
fórmula de backoff exacta, `rescatar_huerfanos`, `procesar_uno` con enrutado por `kind`, `tick()`
como orquestador de un ciclo completo); enganchado en `bot.py` como job `procesar_cola` cada 20s,
condicionado a que `DATABASE_URL` esté puesta (si no, avisa UNA VEZ en el log de arranque en vez
de fallar con `KeyError` en cada tick). 12 tests Grupo A (`test_cola.py`: enrutado de
`procesar_uno` con handler registrado/kind desconocido/handler que lanza, fórmula de backoff
pura parametrizada, `enqueue` contra `FakeSupabase` — el mock de tests se amplió para aceptar
`returning="minimal"` en `insert()`, que nadie había necesitado hasta ahora). **Grupo B
verificado contra la BD real** (los 5 casos exactos de la spec, con datos de prueba limpiados
después de cada corrida): (d) dos conexiones psycopg2 reclamando en transacciones solapadas
nunca comparten un id — `SKIP LOCKED` real, no simulado; (e) un trabajo con handler que siempre
lanza y `max_intentos=2` queda `fallido` tras el primer tick (`intentos=1`, backoff aplicado) y
pasa a `muerto` (dead-letter, `completado_en` fijado, `ultimo_error` conservado) tras el segundo
— un tick posterior confirma que NO se re-reclama; (f) un `noop` se marca `completado` y un tick
siguiente no lo toca; (g) una fila `en_proceso` con `reclamado_en` de hace 10 minutos (worker
"muerto" simulado) se rescata correctamente a `fallido`; (h) un trabajo con `disponible_en` una
hora en el futuro no se reclama en el tick. ci.ps1 verde (126 pytest, 215 vitest, build).

---

2026-07-05 | Fase 9.5: Logging estructurado en JSON (parcial, alcance honesto) | fd9ea14 | HECHO.
`backend/app/bot.py`: `JsonFormatter` nueva (clase `logging.Formatter`) que vuelca a JSON
`timestamp`/`level`/`logger`/`message` + CUALQUIER campo pasado por `extra={...}` sin lista
blanca rígida (así un log futuro con `extra={"empresa_id":...}` queda buscable automáticamente,
sin tener que tocar el formatter). `default=str` en el `json.dumps` para que un objeto no
serializable nunca reviente el propio logging. Aplicado con contexto real a los puntos de log
que ya tenían empresa_id/viaje_id/chofer_id/hito_id/update_id/chat_id a mano: el wrapper de
reintentos (8.2), el dedupe/rate-limit del perímetro (9.9), vinculación de gestor/chófer,
confirmación de llegada, subida de POD (incl. rechazo por validación), incidencia manual,
notificación de asignación, y el error handler global de PTB. 5 tests nuevos
(`test_logging_estructurado.py`: JSON válido, campos de extra incluidos tal cual, ausentes si no
se pasan, traceback incluido con `exc_info`, nunca revienta con un valor no serializable —
verificado con una clase de prueba sin `__dict__` serializable). **NO hecho, alcance honesto**:
el monitor externo (UptimeRobot/Better Stack) contra `/db/health`+home+`bot_heartbeat` — no hay
nada desplegado que monitorizar todavía (mismo bloqueo que el resto de Gate A); el DSN real de
Sentry sigue pendiente de una decisión ligera del usuario, igual que D6 lo estuvo. De paso
(mismo turno): delegué a un subagente `model: opus` el diseño de un sistema de colas sobre
Postgres (ítem 9.17, `SELECT ... FOR UPDATE SKIP LOCKED`, sin Redis) — apareció como una nueva
sección en `SPECS-9.md` ("Bloque colas"), pendiente de revisar antes de picar 9.18. ci.ps1 verde
(114 pytest, 215 vitest, build).

---

2026-07-05 | Fase 9.16: Migraciones con red (alcance honesto) | bc2a3be | HECHO. Convención
escrita en `ONBOARDING.md` §7: toda migración nueva a partir de ahora debe documentar en su propia
cabecera SQL cómo deshacerla (no retroactiva sobre migraciones ya aplicadas). La parte de "entorno
de staging real" NO se pudo construir: comprobé el branching de Supabase vía `list_branches` y
devuelve error de permisos (no disponible en el plan actual); un proyecto de staging separado
depende de la misma decisión que 9.1 (separar dev/prod), que el usuario ya decidió posponer hasta
el primer cliente piloto. De paso actualicé `ONBOARDING.md` (D1/D2 ya no aparecían como pendientes,
estaban resueltas desde antes en esta misma sesión) y añadí la pestaña "Session pooler" a la
instrucción de `DATABASE_URL`. Sin cambios de código — ci.ps1 verde de control (109 pytest, 215
vitest, build).

---

2026-07-05 | AUDITORÍA CTO COMPLETA (seguridad, arquitectura, calidad) a petición del usuario | 64b8576,
0838fc7,e06d89b,e25db7f,b00fd6e,b1d9f28,be31e74,961cd41,2a6adfd | HECHO. 3 subagentes en paralelo
(seguridad; arquitectura/escalabilidad; calidad de código+cobertura+honestidad del roadmap),
cada uno leyendo el código real y verificando contra la BD real vía MCP, no confiando en
comentarios ni en descripciones. Hallazgos y arreglos, por prioridad:

**CRÍTICO (arreglado, mismo día)**: la migración 0011 (bucket `pods` privado) nunca eliminó la
policy permisiva de 0008 (`authenticated_select_pods`, SELECT abierto a cualquier autenticado sin
scope de empresa) — Postgres combina policies permisivas del mismo comando con OR, así que
CUALQUIER gestor de CUALQUIER empresa podía leer fotos de POD (albaranes, firmas) de otra empresa
vía Storage API directo, sin pasar por la UI. Migración `0036` (DROP de la policy), verificado
antes/después contra la BD real, test de regresión permanente (`test_storage_policies.py`).

**HIGH (arreglados)**: (1) `audit_log` tenía una única policy `FOR ALL` sin restricción de
operación ni de rol — cualquier gestor, incluido `solo_lectura`, podía UPDATE/DELETE el registro
de auditoría, contradiciendo su propósito. Migración `0037`: solo SELECT+INSERT, sin
UPDATE/DELETE, más el trigger de `solo_lectura` que se había omitido. (2) `sugerirChofer` llamaba
a `getEstado561` una vez POR CHOFER dentro de un `Promise.all` (200+ consultas con 100+
conductores) y escaneaba `ubicacion` sin límite de fecha — refactorizado con
`getEstado561ParaChoferes` (2 consultas totales) y acotada la consulta de `ubicacion` a 2 días;
`getEstado561` individual queda con el MISMO comportamiento exacto (155 tests existentes sin
tocar, 3 nuevos para la versión por lotes). (3) el job del bot
`procesar_notificaciones_asignacion` traía la tabla `viaje` ENTERA de TODAS las empresas cada 30s
(service role, salta RLS) y filtraba en Python — el coste crecía con el histórico total de la
plataforma; filtro empujado a la query, verificado contra la BD real (9 de 26 filas, exacto).
(4) `deleteGastoViaje`/`revocarTokenPublico`/`deleteInvitacion`/`deleteParkingPropio`/el borrado
de documento en `anonimizarChofer` no comprobaban `error` en absoluto — un fallo silencioso podía
dejar un gasto "borrado" contando en el P&L o un token público revocado en UI pero vivo de
verdad; todas ahora comprueban y lanzan. (5) cero cobertura de test en
`getGestoresEmpresa`/`actualizarRolGestor`/`desactivarGestor`/`reactivarGestor` (mutación de roles,
9.29) — 6 tests nuevos, mock ampliado para simular errores de UPDATE.

**MEDIUM (arreglados)**: (1) `vehiculos/[id]/page.jsx` tenía un `TIPO_LABEL`/`ESTADO_CHIP` local
idéntico a `labels.js` (exactamente la duplicación que 7A.12 debía haber eliminado) — unificado.
(2) los índices `idx_ubicacion_chofer`/`idx_ubicacion_chofer_reciente` existían en producción
pero en NINGÚN archivo de migración (aplicados ad-hoc por MCP en algún momento sin capturar) —
migración `0038` los captura (idempotente). (3) `vehiculo`/`plantilla_ruta`/`plantilla_hito`/
`ubicacion` se crearon en `0003` sin `ENABLE ROW LEVEL SECURITY`; está activo en producción (a
mano, nunca versionado) — migración `0039` lo captura, para que un proyecto nuevo reconstruido
solo desde las migraciones no arranque con RLS desactivado en la tabla de GPS.

**Pendiente, no arreglado hoy (recomendaciones para más adelante, no urgentes)**: la página "Hoy"
(`/`) hace una consulta sin límite de `viaje` + un abanico de llamadas a OSRM secuenciales en cada
tick de realtime — candidato a paginar/cachear cuando haya más volumen. Varias funciones más
(`getDocumentosPorCaducar`, `getParkings`, `getAuditLog`, `getMetricasRentabilidad`) leen tablas
enteras sin límite, mismo patrón que 6.4 ya corrigió para analítica en su momento — mismo
tratamiento pendiente. El patrón sistémico de "leer `data` e ignorar `error`" en decenas de sitios
de `data.js` puede convertir un fallo real de BD en un número financiero silenciosamente
incorrecto (p.ej. margen/nómina) en vez de un estado visible de error — merece una conversación
de diseño, no un parche masivo a ciegas. `migrate.py --check` solo avisa (no falla) ante un
checksum que no coincide — el caso conocido de 0002-0011 es benigno (backfill), pero la
herramienta no distingue eso de un hand-edit accidental futuro. Migraciones como 0031/0032 mezclan
schema+backfill+hardening en un solo archivo (ya causó que un subagente muriera a mitad en 9.29) —
para migraciones futuras de ese tamaño, separar en pasos independientes. `format.js` tiene
formateadores (`fmtEur`, `fmtKm`, etc.) con cero adopción real — 9 archivos siguen con el patrón
duplicado que debían reemplazar. Ninguno de estos bloquea nada ni es urgente.

CI verde en cada paso (109 pytest, 215 vitest, build) — 8 commits en total documentando cada
arreglo por separado para que el historial sea auditable.

---

2026-07-05 | Fase 9.15: Procedimiento de derechos ARCO — BLOQUE D CERRADO | 03b354b | HECHO.
`PRIVACIDAD-ARCO.md`: procedimiento por derecho, con la tensión documentada SIN esconderla: el
hash-chain de `ejecucion_evento` (9.6/9.7) y el hash de `pod` (9.8) incluyen `chofer_id` en el
payload hasheado — anonimizarlo rompería la verificación de integridad (indistinguible de
manipulación real), así que esas dos tablas nunca se tocan en una cancelación/oposición. En
`dashboard/lib/data.js`: `getExportacionChofer(choferId)` (recopila chofer/viajes/ubicaciones/
valoraciones/documentos/decisiones donde aparece, solo lectura) y `anonimizarChofer(choferId)`
(borra `documento` del chófer por completo — sin cadena de integridad —, anonimiza `nombre`/
`telefono` de `chofer` porque son las ÚNICAS columnas que el dashboard puede escribir según
0019; documentado explícitamente qué NO toca y por qué: `chat_id` — sin permiso de escritura
del dashboard —, `ubicacion` — revoke total de escritura en 0019, requeriría
`purgar_ubicacion.py` con `DATABASE_URL` —, `valoracion`/`decision_asignacion` — registros de la
empresa sobre su propia operación, se dejan intactos a propósito hasta que 9.11 diga lo
contrario). 4 tests nuevos en `data.test.js`. El mock compartido de tests se amplió de paso:
`delete()` ahora acumula varios `.eq()` encadenados antes de ejecutar (nadie había necesitado un
DELETE con más de una condición hasta ahora) y se añadió `.or()` — ambos más fieles al builder
real de `@supabase/supabase-js`. **Con esto se cierra el Bloque D completo (9.12-9.15)** — solo
queda `9.11` (`[DECISIÓN]`, consulta con abogado) para cerrar GATE D del todo. 206 vitest, 105
pytest, ci.ps1 verde.

---

2026-07-05 | Fase 9.14: Página "Subprocesadores" + plantilla de DPA | d7b7195 | HECHO.
`dashboard/app/subprocesadores/page.jsx`: página pública (bypaseada de `AuthGuard`, mismo patrón
que el portal de cliente 7A.14) con tabla de subencargados de tratamiento — Supabase (Postgres/
Auth/Storage), Vercel (dashboard), Railway (backend/bot), Sentry (errores, opt-in) — cada uno con
función, región y referencia a su DPA estándar. `PRIVACIDAD-SUBPROCESADORES.md` es la fuente de
verdad (git-trackeado); la página debe mantenerse en sincronía con él si cambia algo real.
`PRIVACIDAD-DPA-PLANTILLA.md`: plantilla de Acuerdo de Encargado del Tratamiento (art. 28 RGPD)
con el contenido técnico ya relleno a partir de `PRIVACIDAD-RAT.md` (naturaleza/finalidad del
tratamiento, categorías de interesados/datos, medidas de seguridad), huecos `[RELLENAR]` para
datos específicos de cada cliente, marcada explícitamente como NO firmable sin revisión legal
(pendiente de 9.11, mismo criterio honesto que el RAT). Confirmado con `get_project` (MCP de
Supabase) que el proyecto real ya está en región UE (`eu-west-1`, Irlanda) — sin acción
pendiente ahí. `DEPLOY.md` actualizado con pasos explícitos para fijar región UE en Vercel
(Frankfurt/`fra1`) y Railway al desplegar — no ejecutable hoy porque esos proyectos de
producción todavía no existen (deploy pospuesto). Intenté verificar la página nueva en un
navegador real vía `mcp__Claude_Preview__*` (creando `.claude/launch.json`) — falla exactamente
igual que en el ítem 6.6: el "workspace" de la herramienta sigue anclado a una carpeta que no es
la del proyecto (`Escritorio\Git` en vez de `Escritorio\Claude code`), confirmado de nuevo con
dos intentos (ruta absoluta y relativa). Verificación de respaldo: `next build` compila sin
errores e incluye `/subprocesadores` en las rutas generadas. ci.ps1 verde (105 pytest, 202
vitest, build).

---

2026-07-05 | Fase 9.13: Política de retención automatizada (purga de ubicacion) | b563eb2 | HECHO.
`backend/db/purgar_ubicacion.py`: borra filas de `ubicacion` (dato de geolocalización granular,
el más sensible del sistema según `PRIVACIDAD-RAT.md`) con más de 90 días por defecto (`--dias`
custom, `--dry-run` para solo contar sin borrar). Decisión documentada en el propio script:
BORRAR sin agregar, porque hoy nada en el producto consume un histórico agregado de posiciones
(bot y dashboard solo leen la última ubicación conocida vía `.order().limit(1)`) — introducir
agregación sería complejidad sin consumidor real; queda anotado como posible mejora futura si
cambia. `ejecucion_evento`/`pod` quedan fuera a propósito (evidencia contractual, retención
indefinida ya decidida en 9.6-9.8). 5 tests en memoria con cursor fake (cuenta antes de borrar,
`--dry-run` no ejecuta DELETE, sin filas que purgar no ejecuta DELETE innecesario, umbral
parametrizado). **Verificado contra la BD real** (primera vez que se pudo, gracias a que
`DATABASE_URL` ya funciona tras D2): insertadas 4 filas de prueba en un chófer real de la
empresa demo con antigüedades de 120/100/10/0 días — `--dry-run` detectó correctamente las 2 de
más de 90 días sin tocar nada (confirmado que las 4 seguían ahí), la purga real borró exactamente
esas 2 y dejó intactas las 2 recientes; datos de prueba limpiados después, tabla `ubicacion`
vuelta a 0 filas como estaba. Nota honesta: sin scheduler que lo ejecute solo todavía (no hay
infraestructura de cron en el proyecto) — ejecutar a mano o vía Tarea Programada mientras tanto,
mismo criterio que 4.4/9.7. ci.ps1 verde (105 pytest, 202 vitest, build).

---

2026-07-05 | Rotación de contraseña de BD tras exposición accidental | 88be113 | HECHO.
El usuario reseteó la contraseña de la base de datos en Supabase (higiene correcta tras el
incidente de exposición del turno anterior) y actualizó `DATABASE_URL` en `.env` limpiamente
(una sola línea, formato correcto). Verificado con `migrate.py --check`: el primer intento dio
"password authentication failed" (probablemente el cambio de contraseña aún no había propagado
del todo), un segundo intento ~8s después conectó bien — 35/35 migraciones aplicadas, 0
pendientes. La contraseña vista en la conversación anterior queda inútil.

---

2026-07-05 | D2 resuelta: DATABASE_URL real puesta y verificada | cabfaa0 | HECHO. El
primer pegado del usuario vino en formato "Parameters" de Supabase (varias líneas sueltas) en vez
de la URI de una pieza, rompiendo el parseo de `.env` — corregido a mano guiando al usuario. El
segundo intento sí trajo la URI de la variante "Session pooler" pero repartida en líneas
separadas por el propio `.env` (valor vacío en `DATABASE_URL=`, el string real 3 líneas más abajo).
**Incidente de seguridad menor, autoinfligido**: al diagnosticar por qué fallaba, un comando de
PowerShell mío imprimió el contenido completo de esa línea suelta para poder ver su forma —
expuso la connection string (con la contraseña de la BD) en la propia conversación, exactamente lo
que se quería evitar desde el principio. Recomendado al usuario rotar la contraseña de la BD por
precaución (Supabase → Database → Reset database password) — pendiente de que lo haga. Arreglado
el `.env` (todo en una sola línea, sin los corchetes literales `[...]` que Supabase mostraba
alrededor de la contraseña recién generada — no son parte del valor real). Verificado con
`migrate.py --check`: conecta de verdad, 35/35 migraciones aplicadas, 0 pendientes. Hallazgo menor
de paso: checksum registrado de `0002`-`0011` no coincide con el archivo local (backfill
retroactivo de antes de que existiera el runner) — no bloquea, solo avisa.

---

2026-07-05 | D1 resuelta: SUPABASE_SERVICE_ROLE_KEY real puesta y verificada | 61a0c53 | HECHO.
El usuario pegó la clave directo en `.env` (nunca la compartió en el chat, verificado solo por
longitud). Verificación funcional sin imprimir el valor (script desechable en scratchpad): un
cliente Supabase con esa clave ve las 2 empresas reales y los 4 gestores reales sin filtrar por
RLS — confirma que es la clave de servicio de verdad, no la anon key. Esto desbloquea el flujo
real del bot en producción (antes corría con la anon key y no podía leer/escribir con RLS activo).
D2 (`DATABASE_URL`) en curso: la variante "Direct connection" no resuelve DNS desde este entorno
(Supabase la dejó IPv6-only sin el add-on de IPv4, error `could not translate host name`) —
el usuario está cambiando a la variante "Session pooler" (IPv4), pendiente de reintentar la
verificación con `migrate.py --check`.

---

2026-07-05 | D6/8.6 confirmado + aviso de rebote de emails de Supabase investigado | fbd2681 | HECHO.
El usuario recibió un email de Supabase avisando de alta tasa de rebotes en el proyecto y
amenazando con restringir el envío. Investigado contra el proyecto real: solo existen 3 usuarios
en `auth.users`, todos `@norenty.com` (`demo@`, y los dos fixtures de 9.31). El panel de Rate
Limits confirma el límite real: **2 emails/hora** en el plan gratis — el "email rate limit
exceeded" que salió durante la verificación de 9.31 era justo esto, no abuso real. Causa
probable del rebote: el signUp de `roles931.operativo@norenty.com` (creado ese día) sí disparó un
email de confirmación real de Supabase hacia una dirección que probablemente no tiene buzón real
— el segundo fixture (`lectura`) se creó directo por SQL precisamente para evitar repetir esto,
así que ya no debería volver a pasar por trabajo futuro de este proyecto. De paso, el usuario
confirmó con captura de pantalla que **D6 (Leaked Password Protection) ya está activado** en
Authentication → Providers → Email — Fase 8 queda 100% cerrada (antes solo faltaba esto).
Recomendado al usuario no hacer clic en los enlaces del email de aviso y verificar directo en
supabase.com — hizo eso, encontró además una incidencia general de infraestructura de Supabase
(capacidad en varias regiones, ajena a nuestro proyecto) que probablemente explicaba el "me echa"
del login. Sin cambios de código.

---

2026-07-05 | Fase 9.12: Registro de Actividades de Tratamiento (borrador) | 36b367b | HECHO.
`PRIVACIDAD-RAT.md` nuevo: inventario de tratamiento tabla por tabla, leído del esquema REAL de
Supabase (`list_tables` para las 23 tablas del proyecto + SQL directo sobre `information_schema.columns`
para las 13 con dato personal relevante — no un RAT genérico de plantilla). Cubre `chofer`,
`gestor`, `ubicacion` (el dato más sensible: geolocalización en tiempo real), `ejecucion_evento`/
`pod` (evidencia contractual, retención de años, no se purgan — coherente con el hash-chain de
9.6-9.8), `incidencia`, `valoracion`, `decision_asignacion`, `nota_gestor`, `audit_log`,
`invitacion`, `documento` (licencia/CAP del chófer), `empresa`. Cada fila con interesado/dato/
finalidad/base jurídica (marcada PROVISIONAL, pendiente de 9.11)/retención. Roles RGPD explícitos
(Norenty=encargado, cada empresa cliente=responsable, coherente con cómo 9.14 va a plantear el DPA).
Confirma qué expone el portal público (7A.14): nunca precio/coste/nombre completo/matrícula, solo
posición aproximada redondeada. Sección de pendientes honestos explícita (no fingir que el
documento cierra nada que no cierra): base jurídica real depende de 9.11, la purga de 90 días de
`ubicacion` todavía no existe (depende de 9.13), ARCO depende de 9.15, DPA depende de 9.14.
Marcado en la cabecera como BORRADOR TÉCNICO, no asesoramiento legal. Sin cambios de código —
ci.ps1 verde de control (100 pytest, 202 vitest, build).

---

2026-07-05 | Fase 9.10: Mínimos de AuthN/AuthZ del dashboard | ce52068 | HECHO. Los 4
sub-ítems: (1) **MFA opcional (TOTP)** — sección nueva "Verificación en dos pasos" en
`ajustes/page.jsx` (enroll con QR + secreto manual, verify con código de 6 dígitos, listar/
desactivar factores). `AuthGuard.jsx` extendido: además de sesión, comprueba
`supabase.auth.mfa.getAuthenticatorAssuranceLevel()` — si el gestor tiene un factor verificado
y la sesión sigue en aal1 (recién logueado solo con password), muestra `MfaChallenge.jsx`
(componente nuevo) en vez del dashboard hasta resolver el código. **Verificado de extremo a
extremo contra Supabase REAL** (no solo compilado): script Python desechable
(`verificar_mfa_9_10.py`, scratchpad) que calcula el TOTP de verdad a partir del `secret` que
devuelve `enroll()` (RFC 6238, HMAC-SHA1, sin librerías nuevas — implementado a mano porque
`pyotp` no está instalado) sobre la cuenta demo: enrolar+verificar eleva la sesión de aal1 a
aal2; cerrar sesión local y volver a entrar solo con password confirma aal1 con
`nextLevel=aal2` — EXACTAMENTE la condición que usa `AuthGuard` para decidir mostrar el reto;
resolver el reto con `challengeAndVerify` (mismo método que usa `MfaChallenge.jsx`) vuelve a
elevar a aal2. Cuenta demo limpiada al final (`unenroll` + confirmado por SQL directo que
`auth.mfa_factors` queda sin filas para ese usuario) — crítico para no dejar el gestor demo con
MFA activado y romper `smoke.test.js`/`isolation.test.js`/`roles-isolation.test.js`/
`seed_demo.py`, que solo inician sesión con email+password. (2) **Expiración de invitaciones**
— migración `0035_invitacion_expiracion.sql`: `usar_invitacion()` ya no canjea invitaciones con
más de `INVITACION_VALIDEZ_DIAS=7` días desde `created_at` (valor inicial razonable, no pactado
con cliente real, mismo criterio que otros umbrales v1 del proyecto). Verificado contra la BD
real: una invitación de prueba con `created_at` de hace 10 días → `usar_invitacion` devuelve
NULL; una fresca → devuelve el `empresa_id` correcto (ambas limpiadas después).
`getInvitaciones()` en `data.js` añade `vencida` calculado en cliente (mismo umbral, solo para
UI); Ajustes muestra badge "Vencida" distinto de "Pendiente"/"Usada" (con botón para
eliminarla, ya no para copiar un enlace que no funciona). (3) **Cerrar todas las sesiones** —
HALLAZGO REAL no documentado hasta ahora: `supabase.auth.signOut()` sin argumentos usa
`scope:"global"` **por defecto** (cierra la sesión en TODOS los dispositivos, no solo el
actual) — confirmado leyendo el código fuente instalado de `@supabase/auth-js`. El botón
normal de "Cerrar sesión" del Topbar/Ajustes llevaba TODO este tiempo cerrando sesión en todos
los dispositivos sin que nadie lo supiera ni lo hubiera pedido. Corregido: `signOut()` ahora
pasa `{scope:"local"}` explícito (comportamiento esperado de un logout normal — cerrar sesión
en el móvil no debería expulsarte del portátil); nueva función `signOutTodasLasSesiones()`
(`{scope:"global"}` explícito) con su propio botón en Ajustes, con confirmación clara de lo que
va a pasar. (4) **`isolation.test.js` obligatorio** — confirmado (sin cambios de código):
`ci.ps1` ejecuta `npm run test` sin condicionales; el único auto-salto es por falta de
credenciales de entorno, nunca por una opción desactivable. 7 tests nuevos vitest (3 de scope
de `signOut`, 3 de `vencida` de invitaciones) — sin tests de componente interactivos para
`MfaChallenge`/`AuthGuard` (nota honesta: el proyecto no tiene jsdom/testing-library, solo
`renderToStaticMarkup` para componentes puros como `RequireRol`; estos dos usan `useEffect`/
estado async que esa herramienta no ejercita — verificados por `next build` + el script Python
de extremo a extremo contra Supabase real, que es más fuerte que un test de render superficial).
100 pytest, 202 vitest, ci.ps1 verde.

---

2026-07-05 | Fase 9.9: Endurecer el perímetro del bot | 84bd989 | HECHO. Los 4
guardrails del ítem: (1) secret token del webhook — NO se picó código: leí el fuente instalado
de `python-telegram-bot` 22.8 (`telegram/ext/_utils/webhookhandler.py`, método
`TelegramHandler._validate_post()`) y confirmé que la librería YA valida
`X-Telegram-Bot-Api-Secret-Token` contra el `secret_token` pasado a `run_webhook()` (rechaza con
403 si falta o no coincide), y que `run_bot.py:45` ya se lo pasa correctamente — cerrado por
verificación, no por código nuevo. (2) Rate limiting por `chat_id`: `limitar_flujo` en
`bot.py`, ventana deslizante en memoria (`RATE_LIMIT_MAX_UPDATES=15` cada `RATE_LIMIT_VENTANA_S=10s`).
(3) Validación de fotos POD: `_foto_pod_valida` rechaza por tamaño (`POD_MAX_BYTES=10MB`) o
firma JPEG inválida (magic bytes `FF D8 FF`) ANTES de subir a Storage — mensaje `foto_invalida`
nuevo en i18n es/en/ro/fr. (4) Dedupe por `update_id`: `descartar_update_duplicado`, FIFO de los
últimos 2000 vistos en memoria — un reintento de Telegram con el mismo `update_id` no duplica
efectos. Los guardas (2)/(4) son `TypeHandler(Update, ...)` registrados en grupos negativos de
`Application`, corren antes que cualquier handler real y cortan con `ApplicationHandlerStop`.
**BUG REAL CAZADO POR EL PROPIO ARNÉS E2E** (exactamente la clase de regresión que este arnés
existe para cazar, ver 6.11): el primer intento registró dedupe y rate-limit en el MISMO
`group=-1` — PTB solo ejecuta 0-1 handler POR GRUPO (rompe tras el primero que matchea,
confirmado leyendo `_application.py:1316`, comentario literal "Only a max of 1 handler per group
is handled"), así que el segundo `TypeHandler` (rate-limit) quedaba registrado pero MUERTO,
nunca se ejecutaba. El test de flood lo detectó al instante: esperaba 15 mensajes (el límite) y
recibió 20 (ninguno bloqueado). Corregido separando dedupe (`group=-2`) y rate-limit
(`group=-1`) en grupos distintos — cada grupo procesa su propio handler y sigue al siguiente.
3 tests E2E nuevos en `test_bot_e2e.py` (dedupe no duplica el mismo `update_id`, el flood se
corta en el límite exacto, una foto con firma inválida se rechaza sin llegar a Storage/BD) +
fixture `autouse=True` que resetea el estado de módulo (dedupe/rate-limit) antes de cada test —
necesario porque varios tests reutilizan el mismo `chat_id` y el estado vive a nivel de módulo.
El fixture de la foto JPEG fake del E2E existente (`fake-jpg-bytes` sin firma real) tuvo que
actualizarse con magic bytes reales (`\xff\xd8\xff` + resto) para no romperse con la nueva
validación — el hash esperado en el test de 9.8 se actualizó a la vez. 100 pytest (97→100), 196
vitest, ci.ps1 verde.

---

2026-07-05 | Fase 9.8: Hash SHA-256 de cada POD al subirlo | 90105a7 | HECHO. Migración
`0034_pod_hash_sha256.sql` aplicada vía MCP (checksum registrado): `pod.hash_sha256 text NOT
NULL` (la tabla estaba vacía — 0 filas — así que no hizo falta backfill, se pudo poner NOT NULL
directamente). `backend/app/bot.py` (`handle_photo`) calcula `hashlib.sha256(file_bytes)` sobre
los bytes descargados de Telegram ANTES de subir a Storage (el hash es de la foto real que llegó
del chófer, no de una copia potencialmente ya tocada en Storage) y lo incluye en el insert de
`pod` junto a `foto_url`. `backend/db/verificar_pod.py`: script de solo-lectura que descarga el
fichero real desde Storage y recalcula su hash para compararlo con el guardado (`<pod_id>` o
`--todos`) — mismo patrón que `verificar_cadena.py` de 9.7. HALLAZGO Y CIERRE DE GAP DE
SEGURIDAD (no pedido explícitamente por el ítem, pero directamente dentro del principio de Fase
9 — "ejecucion_evento, pod, ubicacion inviolables" — que nunca se había cerrado para `pod`: la
0019 protegió `ejecucion_evento`/`ubicacion` pero dejó fuera `pod`, cuya policy `empresa_scoped_pod`
es `FOR ALL` sin restricción de columna. Confirmado por SQL: cualquier gestor autenticado podía
hacer `UPDATE` de `foto_url` por REST directo, pisando la evidencia sin pasar por la UI). Cerrado
en la misma migración: `REVOKE UPDATE` completo + `GRANT UPDATE (estado_validacion)` solamente
(única columna que el dashboard escribe de verdad, confirmado grep — `viajes/[id]/page.jsx:154`,
`validarPod`). El bucket de Storage "pods" YA estaba bien (verificado: solo `service_role` tiene
INSERT/UPDATE/DELETE sobre los objetos, `authenticated` solo SELECT — el fichero en sí ya estaba
protegido desde la 0011, el gap era solo en la fila de la tabla). 4 tests nuevos en memoria
(`test_verificar_pod.py`, con cliente Storage fake: hash determinista, coincide, detecta fichero
sustituido, detecta fichero ausente) + la aserción E2E existente de subida de POD
(`test_bot_e2e.py`) extendida para confirmar que `hash_sha256` guardado == SHA-256 real de los
bytes subidos. Verificación contra Storage real (Grupo B, descargar un fichero de verdad) queda
BLOQUEADA por el mismo D1 de siempre: sin `SUPABASE_SERVICE_ROLE_KEY` ni sesión de gestor en este
entorno no pude crear un objeto de prueba en el bucket (solo `service_role` tiene INSERT) para
verificar la descarga+comparación de extremo a extremo — documentado tal cual en el docstring del
script, no fingido. 97 pytest (93→97), 196 vitest, ci.ps1 verde.

---

2026-07-05 | Fase 9.7: Hash-chain de ejecucion_evento (implementación de SPECS-9.md) | c850d8d | HECHO.
Migración `0031_hash_chain_ejecucion_evento.sql` aplicada vía MCP (checksum registrado en
`schema_migrations`): columnas `hash_prev`/`hash` en `ejecucion_evento`, función
`ejecucion_evento_calc_hash` (SHA-256 builtin de PG15+, sin pgcrypto), trigger `BEFORE INSERT`
`trg_ejecucion_evento_hash_chain` que encadena por `viaje_id` (partición elegida en 9.6: cada
viaje es su propia cadena, sin cuello de botella global), backfill de las filas existentes.
Verificado tras aplicar: 69/69 eventos con hash, 15 raíces de cadena (= 15 viajes con eventos en
la demo). `backend/db/verificar_cadena.py`: script de solo-lectura que recorre cada partición,
recomputa el hash con el mismo algoritmo del trigger y compara, señalando el PRIMER evento roto
(`--viaje <uuid>` opcional, alerta a Sentry si `SENTRY_DSN`). Grupo A (`test_hash_chain.py`, 7
tests, en memoria): hash conocido hardcodeado, encadenado de 2/3 eventos, viajes independientes,
detección de manipulación de `ocurrido_en`, detección de borrado del evento intermedio, hash_prev
inicial no nulo, cadena vacía. Grupo B verificado A MANO contra la BD real (dos viajes
desechables `TEST-9.7-A`/`TEST-9.7-B`, borrados al terminar — cascada limpió sus eventos, 0
residuos confirmados, y los 69 eventos reales de la demo quedaron intactos): el trigger encadenó
correctamente 2 y 3 eventos seguidos con `hash_prev` real; alterar `ocurrido_en` de un evento
histórico por `UPDATE` directo (salta el trigger, que es solo `BEFORE INSERT`) hizo que
`ejecucion_evento_calc_hash` recalculado ya NO coincidiera con el `hash` guardado; borrar el
evento intermedio de una cadena de 3 dejó el `hash_prev` del tercero apuntando a un hash que ya
no existe, detectado comparándolo con el hash actual del primero (`coincide: false`). **Bonus**:
recomputé a mano en Python los mismos hashes que puso el trigger de Postgres para los eventos de
prueba — coinciden BYTE A BYTE, confirmando que el mirror del script es fiel al algoritmo real,
no solo una aproximación. Job de verificación periódica (cron) queda pendiente de que exista un
scheduler real en el proyecto — mismo criterio honesto aplicado en 4.4 (alertas Telegram de
documentos por caducar); ejecutar `verificar_cadena.py` a mano mientras tanto, sobre todo antes
de enseñar la evidencia a un cliente/piloto. ci.ps1 verde (93 pytest, 196 vitest, build).

---

2026-07-05 | Fase 9.31: Test automático de aislamiento por rol | 7d7f13d | HECHO.
`dashboard/lib/roles-isolation.test.js` (mismo patrón que `isolation.test.js` de 8.4: NO mockea
Supabase, corre contra el proyecto real, se salta si no hay credenciales). Dos gestores de prueba
fijos en la empresa demo (`roles931.operativo@norenty.com`, `roles931.lectura@norenty.com`),
auto-curados en cada ejecución (rol/activo se normalizan siempre al arrancar, así son idempotentes
incluso después de que el propio test B8 desactive a "lectura" a propósito). 12 casos verificados
en verde contra la BD real (B1-B11 de SPECS-9-ROLES.md §6.2: operativo rechazado en costes de
empresa/vehículo/precio de viaje, permitido en otros campos y en chofer_id/estado del viaje,
rechazado creando/borrando invitaciones; solo_lectura rechazado en cualquier mutación, permitido en
SELECT; expulsión corta el acceso al instante con el MISMO JWT sin re-login; admin no puede
desactivarse/auto-editarse a sí mismo; admin sí puede cambiar el rol de otro gestor; el gestor
admin pre-existente conserva rol=admin/activo=true). B12 (bypass de service role en los triggers)
queda `it.skip` documentado — no automatizable sin `SUPABASE_SERVICE_ROLE_KEY` (D1 sigue vacía).
HALLAZGO DE INFRAESTRUCTURA (no documentado en sesiones anteriores): el proyecto SÍ exige
confirmación de email para `signUp` — un `signUp` nuevo NO deja sesión activa hasta confirmar, y
sin service role key no hay Admin API para confirmar por software. Además el envío de emails de
confirmación tiene rate-limit propio de Supabase, que salté al intentar de más para el segundo
fixture. Resuelto sin depender de D1: creé el segundo usuario de Auth directamente por SQL
(`extensions.crypt(password, extensions.gen_salt('bf'))`, el mismo algoritmo bcrypt que usa GoTrue
internamente) con su fila espejo en `auth.identities`, saltándome el envío de email por completo.
Es un bootstrap de una sola vez por fixture — las siguientes ejecuciones de la suite solo hacen
`signInWithPassword` contra una cuenta ya confirmada, sin tocar el límite de emails. ci.ps1 verde
(86 pytest, 197 vitest incl. los 12 nuevos + 1 skip, next build). Cierra el pendiente honesto
dejado por 9.29.

---

2026-07-05 | Fase 9.29: Implementacion de roles verificada + migracion 0033 (advisors) | 8bae2548 (0033) | HECHO. El subagente que picaba 9.29 murio a mitad de proceso (background agent cortado) justo cuando el MCP de Supabase se desconecto de la sesion -- el trabajo parcial se salvo en 2 commits WIP (d025c5c, 019563c: migracion 0032, RequireRol/RolProvider + test, gating extendido a Ajustes/AuthGuard/nomina/viaje/documentos/gastos/mapa/vehiculos/wizard, seccion Equipo con selector de rol + boton Desactivar). Al reconectar el MCP se verifico TODO contra la BD real antes de dar nada por bueno (principio de "verificar de verdad" del protocolo): (1) columnas gestor.rol/activo con los defaults correctos (rol='admin', activo=true) -- ningun gestor existente pierde acceso; (2) current_empresa_id() confirmada con pg_get_functiondef, incluye `AND activo = true` -- la expulsion instantanea funciona exactamente como diseño 9.28 (un gestor desactivado pierde current_empresa_id()=NULL en su siguiente query, sin tocar 17 policies una por una); (3) los 8 triggers de la spec (trg_rol_sensibles_*/trg_solo_lectura_* en empresa/vehiculo/viaje/invitacion/gestor) existen; (4) checksum SHA-256 del archivo local 0032 IDENTICO al registrado en schema_migrations -- sin drift de esquema (el tipo de bug que este proyecto ya sufrio mas de una vez). HALLAZGO Y FIX en la propia verificacion: get_advisors senalo 2 funciones de trigger (rol_bloquea_columnas_sensibles, solo_lectura_bloquea_escritura) con EXECUTE expuesto por RPC a anon/authenticated -- el primer REVOKE (solo de esos 2 roles) NO tuvo efecto real (verificado con has_function_privilege antes/despues), porque Postgres concede EXECUTE a PUBLIC por defecto y esos roles heredan de ahi; corregido revocando tambien de PUBLIC, migracion 0033_revoke_execute_triggers_rol.sql, checksum registrado, confirmado con has_function_privilege que ahora es false para ambos roles en ambas funciones. ci.ps1 verde (86 pytest, 184 vitest incl. los 4 nuevos de RequireRol, next build). PENDIENTE HONESTO: la verificacion de esta noche fue manual por SQL directo contra Supabase, no un test automatico repetible -- anadido como item nuevo 9.31 en ROADMAP (mismo patron que isolation.test.js de 8.4 pero para rol en vez de solo empresa). Bloque B2 (roles+sidebar) queda: 9.28 hecho, 9.29 hecho (con 9.31 de seguimiento), 9.30 hecho. Siguiente sesion: 9.31, o retomar el bloque de mayor prioridad segun ROADMAP.md.

---

2026-07-04 | 8.12 Pase final de simplificación — FASE 8 CERRADA (todos los [LOOP]) | (por commitear) | HECHO. Grep de TODO/FIXME/XXX en dashboard+backend: solo 1 real (presupuesto/page.jsx, "precargar el wizard" — resuelto: ahora `/presupuesto` pasa puntos/vehículo/precio sugerido como query params a `/viajes/nuevo-w`, que los lee con `useSearchParams()` y precarga hitos/vehículo/precio en el montaje). Verificado que no quedan restos muertos del diseño original de "oferta al chófer" descartado en 7A.3 (grep de ofertar/ofertado/oferta_si/oferta_no — limpio). Encontrada y corregida una duplicación real que yo mismo introduje en 7A.11: el wizard reinventaba la lógica de color de margen (`colorMargenPct`) en vez de reusar `badgeMargen()` de `lib/format.js` (construida en 7A.12) — unificado en ambos sitios (wizard y /viajes/[id], que tenía el mismo patrón inline desde antes de 7A.12). Dudoso, NO tocado (listado, no arreglado): quedan ~8 archivos con `.toLocaleString("es-ES")` inline en vez de `fmtEur`/`fmtKm` de format.js — es repetición de una llamada nativa correcta, no lógica que pueda desincronizarse (a diferencia de las tablas de labels que sí se migraron en 7A.12), bajo riesgo/bajo valor completar ahora; `npm audit` reporta 4 vulnerabilidades (3 moderate, 1 high) en dependencias del dashboard, no tocadas — `npm audit fix --force` puede romper cosas y no estaba autorizado. ci.ps1 verde. **Con esto, Fase 8 completa: todos los ítems [LOOP] (8.1-8.5, 8.7-8.12) hechos; solo quedan 8.6 (requiere clic manual en el panel de Supabase) y las decisiones D1/D2/D4 del usuario.**
2026-07-04 | 8.11 Checklist de despliegue (DEPLOY.md) | (por commitear) | HECHO (documento, cero acción — desplegar sigue requiriendo D4 explícita, no tocado). `DEPLOY.md`: paso a paso Vercel (dashboard, variables, dominio, CSP de Report-Only a enforcing tras 1 semana sin sorpresas) + Railway (bot, variables, activar modo webhook con BOT_WEBHOOK_URL/SECRET, supervisión de proceso, verificar el heartbeat de 8.3 tras el deploy) + OSRM en producción (o aceptar el fallback estimado como degradación válida para un primer piloto) + Sentry + smoke tests post-deploy (incluye correr los tests reales de 8.1/8.4 contra producción, no solo local, y el rate-limit pendiente del portal público de 8.5). Deja el despliegue a un clic de la decisión humana. CI verde de control.
2026-07-04 | 8.10 ONBOARDING.md | (por commitear) | HECHO. Guía completa para un segundo desarrollador: requisitos, cada variable de `.env`/`.env.local` explicada (qué es, de dónde se saca, cuál es crítica/D1/D2), arrancar dashboard/bot/OSRM, tests+CI, migraciones (con y sin DATABASE_URL), sembrar demo (seed_demo.py/seed_parking_abierto.py), y las convenciones del repo (ROADMAP/PROGRESS/SPECS-7A, numeración de migraciones, seguridad de columnas de la 0019, nunca pegar claves en el chat). Nada de código — CI verde de control.
2026-07-04 | 8.9 Runbook de backup/restore | (por commitear) | HECHO (documento, sin script — bloqueado por D2). `RUNBOOK.md` nuevo: qué cubre un backup (BD sí vía pg_dump/backups automáticos de Supabase; Storage de pods/documentos NO, es aparte); backup manual con `pg_dump -F c` (comando listo para cuando D2/DATABASE_URL esté resuelta); restore completo y selectivo por tabla con `pg_restore`; backup de Storage hoy es manual desde el panel (script pendiente, necesita D1 para poder leer todos los buckets); frecuencia recomendada; y una prueba de restore real explícitamente marcada como NO ejecutada todavía (usando una rama/proyecto de prueba de Supabase + los smoke tests de 8.1 para confirmar que el restore es de fiar, no solo asumirlo). Nada de código — CI verde de control.
2026-07-04 | 8.8 Audit log | (por commitear) | HECHO. Migración 0030_audit_log.sql: tabla `audit_log(empresa_id, gestor_id, entidad, entidad_id, accion, detalle jsonb)` con RLS por empresa (misma convención de `entidad` que `documento`: viaje/vehiculo/chofer). `registrarAuditoria()` (no bloqueante, mismo criterio que registrarDecisionAsignacion) y `getAuditLog(entidad, entidadId)` en lib/data.js. Conectado a las acciones críticas reales: cambio de estado de viaje, (re)asignación de chófer, cambio de precio, generar/revocar enlace público, y borrado de documento (en el DocumentosSection compartido, así cubre viaje/vehículo/chófer a la vez). Sección "Actividad" colapsable en /viajes/[id] con las entradas traducidas a texto legible (`describirAuditoria`) + quién + cuándo. 3 tests nuevos (180 vitest total). ci.ps1 verde.
2026-07-04 | 8.7 Repaso de advisors + superficies nuevas de 7A | (por commitear) | HECHO. Corrí security+performance advisors de Supabase. Security: 6 hallazgos, todos ya conocidos/intencionales — `usar_invitacion`/`viaje_publico` SECURITY DEFINER ejecutables por anon (por diseño, el token/código impredecible ES la seguridad), `current_empresa_id` SECURITY DEFINER (por diseño, solo devuelve la empresa propia), `schema_migrations` sin policies (intencional, solo se toca por MCP/psycopg2), y "Leaked Password Protection" desactivado = D6/8.6, sigue pendiente de que el usuario haga clic en el panel de Supabase (no soy capaz de tocarlo vía MCP/SQL). Performance: 2 hallazgos reales corregidos en migración 0029_repaso_advisors.sql — (1) las policies `empresa_insert_nueva`/`gestor_insert_propio` reevaluaban `auth.role()`/`auth.uid()` por fila en vez de una vez por consulta, envueltas ahora en `(select ...)`; (2) 6 índices de FK faltantes en las tablas nuevas de Fase 7A (decision_asignacion×2, gasto_viaje×2, nota_gestor×2) — mismo criterio que el índice de FK del ítem 6.5 anterior. Verificado re-corriendo los advisors tras aplicar: ambos avisos ya no aparecen. Los "unused index" restantes son ruido esperado en un proyecto de bajo tráfico (todo índice sale "sin uso" hasta que hay tráfico real) — no se tocan. ci.ps1 verde tras el cambio (smoke.test.js + isolation.test.js confirmaron contra la BD real que el login y el aislamiento siguen funcionando igual).
2026-07-04 | 8.5 Endurecer el portal público (caducidad del token) | (por commitear) | HECHO. Migración 0028_token_publico_expira.sql: `viaje.token_publico_expira` (NULL = sin caducidad, para no romper tokens ya generados antes de esta migración) + la RPC `viaje_publico` ahora devuelve null si `token_publico_expira` ya pasó. `generarTokenPublico(viajeId, {diasValidez=30})` fija caducidad al generar (cambio de shape: ahora devuelve `{token, expira}` en vez de solo el string — el único llamador en la UI no usaba el valor de retorno, así que no rompió nada); `revocarTokenPublico` limpia también la caducidad. UI en /viajes/[id]: fecha de caducidad visible + botón "Renovar (+30 días)". **Verificado contra la BD real** (patrón 6.9/7A.14): puse `token_publico_expira` en el pasado sobre un viaje real y confirmé por REST con la anon key que la RPC devuelve null — limpiado el dato de prueba después. Nota añadida al ROADMAP para el checklist de despliegue (8.11): rate-limit de infra pendiente sobre el endpoint anónimo. 3 tests vitest actualizados/nuevos (177 total). ci.ps1 verde.
2026-07-04 | 8.4 Suite de aislamiento multi-tenant contra la BD real | (por commitear) | HECHO. Sin migración. Descubrí que el proyecto ya tiene DOS empresas reales (no solo la demo): "Transportes Demo Norenty" (demo@norenty.com, la que uso siempre) y una empresa semilla "Demo Transport S.L." con IDs predecibles (mario@norenty.com) — perfecta como fixture de "la otra empresa" sin tener que crear/mutar nada. `dashboard/lib/isolation.test.js` (mismo patrón que smoke.test.js: sesión real, se salta si no hay credenciales): autenticado como la empresa demo, confirma contra la BD real que NUNCA aparece ni un id de la otra empresa — ni pidiéndolo directo por id (empresa/viaje/chofer/hito) ni en un listado general sin filtro. Esto convierte "las RLS policies deberían aislar" en "está demostrado, hoy, contra el proyecto real, que aíslan". 6/6 verde. ci.ps1 verde.
2026-07-04 | 8.3 Health check + heartbeat del bot | (por commitear) | HECHO. Migración 0027_bot_heartbeat.sql: tabla `bot_heartbeat` insert-only desde el bot (service role), SELECT abierto a `authenticated`, sin INSERT/UPDATE/DELETE (mismo criterio que ejecucion_evento/ubicacion de la 0019). Job `heartbeat` en bot.py cada `HEARTBEAT_INTERVAL_S=120`s que inserta una fila (no lanza si falla — la siguiente pasada corrige la señal). `getBotHeartbeat()` en lib/data.js: último latido, segundos desde entonces, `activo` si es más reciente que `UMBRAL_HEARTBEAT_S=300`s (2.5x el intervalo). Card "Estado del bot" en /ajustes (poll cada 30s): verde "Activo — último latido hace Xs" o rojo "SIN SEÑAL — hace Y min" / "nunca se ha registrado un latido". Es la pieza que convierte "el bot se cayó y lo supimos" en algo visible antes de que un chófer lleve horas sin poder reportar. 2 tests pytest + 4 tests vitest nuevos (170 vitest total). ci.ps1 verde.
2026-07-04 | 8.2 Reintentos + captura de errores en el bot | (por commitear) | HECHO. `ejecutar_con_reintentos(fn, intentos=3, backoff_base=0.5, contexto=None)` en bot.py: reintenta solo errores de red/timeout de httpx (ConnectError/TimeoutException/ReadError/RemoteProtocolError) con backoff exponencial (0.5s, 1s) — deliberadamente NO reintenta errores de lógica/validación (un ValueError no se arregla reintentando). Tras agotar intentos, manda a Sentry con contexto (acción, chofer_id, hito_id) y relanza. Aplicado a las dos funciones "puerta de entrada" que usan casi todos los handlers (`get_chofer_by_chat`, `verificar_hito_pertenece_a_chofer`) y a la escritura más crítica del sistema (`cb_llegada`: confirmar_llegada = el dato que el negocio vende). Añadido `app.add_error_handler(manejar_error)` — red de seguridad global de PTB: CUALQUIER excepción no capturada en cualquier handler pasa por aquí, se registra en Sentry con update_id/chat_id, y si se puede identificar el chat se avisa al chófer en su idioma ("Estamos teniendo un problema técnico...") en vez de dejarlo en silencio — clave de fiabilidad nº3 del roadmap. Alcance real (nota honesta): NO se retrofitaron los ~25 call-sites restantes de `.execute()` en bot.py uno por uno (riesgo alto de regresión sin QA exhaustivo por handler) — la cobertura viene de las 2 funciones-puerta + el error handler global, que cubren la mayoría de los flujos sin tocar cada línea. httpx añadido a requirements.txt (antes solo transitivo). 6 tests nuevos (84 pytest total). ci.ps1 verde.
2026-07-04 | 8.1 Smoke tests contra la BD real en CI (Fase 8 arranca) | (por commitear) | HECHO. `dashboard/lib/smoke.test.js`: NO mockea supabase — inicia sesión de verdad como la empresa demo (DEMO_EMAIL/DEMO_PASSWORD) y llama a getViajes/getResumenHoy/getMetricasRentabilidad/getInformeNomina/getViabilidadViaje/getPlanVsReal/getViajePublico(RPC) contra el Supabase real, comprobando que no lanzan y que la forma es la esperada. Se salta entero (`describe.skipIf`) si faltan credenciales en el entorno, para no romper CI en una máquina sin `.env`/`.env.local`. Carga las envs con `dotenv` (añadido como devDependency explícita — antes solo estaba como transitiva de Next, `npm install` corrido para fijar el lockfile). Detectado y corregido en el propio proceso de escribir el test: mi asunción de que `getInformeNomina` devuelve un array era incorrecta (devuelve `{filas, tieneBase, umbralKm}`) — el propio smoke test cazó la discrepancia entre lo asumido y lo real, que es exactamente su propósito. Ya integrado en `ci.ps1` sin cambios (vitest recoge el archivo automáticamente); comentario añadido para que quede documentado. 6/6 verde contra la BD real de producción del proyecto.
2026-07-04 | Bugfix + feature (a petición del usuario, fuera de la cola del loop) | (f6efc55, f448138) | HECHO. (1) FIX: `/mapa` crasheaba (Runtime TypeError) porque `supabase.rpc(...).catch(...)` encadenaba `.catch()` sobre un query builder que no es una Promise nativa (`ultimas_ubicaciones` ni siquiera existe como función en la BD, confirmado por consulta directa — el código ya tenía el fallback correcto, solo estaba roto el encadenado). Arreglado leyendo el campo `error` en vez de encadenar `.catch()`. (2) Aclarado que la validación de POD hoy es 100% manual (marcar Válido/Inválido a mano) — leer y validar la foto con IA es el ítem `[DECISIÓN]` pendiente de presupuesto, no construido. (3) FEATURE nueva confirmada con el usuario: documentación legal obligatoria y vigente antes de poner un viaje "en curso" — ITV+Seguro+Autorización de transporte del vehículo, Licencia+CAP del chófer (documento caducado cuenta como inexistente). Implementado en `validarCambioEstado` (lib/data.js), bloquea con mensaje claro de qué falta; la UI ya mostraba estos errores en un banner, no hizo falta tocarla. Un test existente tuvo que actualizarse porque la regla de negocio cambió a propósito. 6 tests nuevos (160 vitest total). ci.ps1 verde.
2026-07-04 | 7A.14 Portal de cliente (tracking público) — ÚLTIMO ÍTEM DE FASE 7A, CERRADA | (por commitear) | HECHO. Migración 0026_token_publico.sql: `viaje.token_publico uuid UNIQUE` + función RPC SECURITY DEFINER `viaje_publico(token)` que devuelve SOLO {referencia, estado, hitos, ultima_posicion redondeada a 2 decimales} — mismo patrón que usar_invitacion de 6.9. `generarTokenPublico/revocarTokenPublico/getViajePublico` en lib/data.js. `AuthGuard.jsx`/`Sidebar.jsx`/`Topbar.jsx` con bypass por `pathname.startsWith("/t/")`. Página pública `app/t/[token]/page.jsx`: referencia, badge de estado, hitos con check, última posición aproximada con link a Maps (sin cargar Leaflet), poll cada 60s, "enlace no válido" si null. Sección "Compartir con el cliente" en /viajes/[id]: generar/copiar/revocar. **Verificación obligatoria contra la BD real ejecutada** (no solo mocks): (1) token válido → RPC devuelve EXACTAMENTE {estado,hitos,referencia,ultima_posicion}, confirmado que NO aparecen precio/coste/chofer/matrícula; (2) token inventado → null; (3) tras revocar → null. Los 3 casos verificados con script Python contra la API REST real usando la anon key. 4 tests vitest nuevos (156 total) + soporte de `.update()` y `.rpc()` añadido al mock de tests (no existía antes). ci.ps1 verde (build incluye /t/[token]).

**FASE 7A CERRADA (2026-07-04).** Los 14 ítems (7A.1 a 7A.14) construidos en esta sesión, CI verde en cada uno de los ~20 commits. Quedan pendientes de Fase 7A: ninguno. Siguiente: cola secundaria de Fase 6 (6.12, 6.13, 6.16-6.19, 6.21, 6.22) o Fase 7B (production-gated, necesita presupuesto/decisión del usuario).
2026-07-04 | 7A.11 Wizard "Nuevo viaje" con inteligencia inline | (por commitear) | HECHO. Sin migración. `calcularPanelViaje({puntos, vehiculoId, precio})` en lib/data.js: composición pura sobre calcularPresupuesto (7A.6) + margen del precio introducido. `createViaje` extendido para aceptar `precio` y para guardar lat/lon de los hitos si se pasan (antes se descartaban silenciosamente — /viajes/nuevo no los manda y sigue guardando null, cero cambio para el flujo existente). `sugerirChofer` extendido con un segundo parámetro `{hitosOverride}` para poder rankear chóferes ANTES de que el viaje exista (el wizard llega al paso de asignación sin viaje_id todavía) — `SugerenciaChofer.jsx` actualizado para aceptarlo y para NO registrar la decisión en `decision_asignacion` cuando no hay viaje_id real (limitación conocida y documentada: el registro de aprendizaje del wizard queda pendiente de una vuelta futura). Página nueva `/viajes/nuevo-w` en 3 pasos (Ruta con panel lateral sticky de cálculo en vivo con debounce 500ms · Asignación con SugerenciaChofer + vehículo/remolque · Confirmar con resumen y creación) — construida en ruta nueva, SIN sustituir `/viajes/nuevo` (el swap es decisión del usuario, no autónoma). 8 tests nuevos (152 vitest total). ci.ps1 verde (build incluye /viajes/nuevo-w).
2026-07-04 | 7A.13 Onboarding y empty states | (por commitear) | HECHO. Sin migración. `getOnboardingEstado()` en lib/data.js: 5 pasos (vehículo, chófer, chófer vinculado a Telegram, primer viaje, costes configurados) con `done`/`href` cada uno. Componente `ChecklistOnboarding.jsx` montado en la home encima de ResumenHoy: se oculta solo si está completo o si el gestor lo cierra (localStorage `norenty_onboarding_oculto`). Empty states de listas migrados a `EmptyState` (7A.12) con CTA donde tenía sentido (viajes → botón "Nuevo viaje" a /viajes/nuevo) y sin CTA donde el formulario de alta ya está visible en la misma página (chóferes, vehículos, plantillas, incidencias). 3 tests nuevos (146 vitest total). ci.ps1 verde.
2026-07-04 | 7A.12 Sistema de diseño consolidado | (por commitear) | HECHO en 3 commits (sin migración, refactor puro, cero cambio de comportamiento). Investigué con un subagente todos los diccionarios/formateos duplicados del dashboard antes de escribir nada. (1) `lib/labels.js` + `lib/format.js` (fmtEur/fmtKm/fmtFecha/fmtFechaLarga/fmtFechaCorta/fmtFechaHora/fmtHora/badgeCaducidad/badgeMargen, con tests propios) + componentes `ui/` (Stat, Badge, EmptyState, SectionCard) — creados sin consumidores todavía, cero riesgo. (2) Migrados los duplicados REALES que causaban riesgo de desincronización: ESTADO_VIAJE estaba copiado literalmente en 3 archivos (viajes/page, viajes/[id], choferes/[id]); TIPO_DOC_LABEL en 2 (documentos/page, NotificationCenter); TIPOS_PARKING/TIPO_PARKING_LABEL en 2 (mapa/page, MapView); LABEL_CAPA en 2 (viajes/[id], presupuesto/page); la lógica de badge de caducidad (urgencia()/badgeFor()) en 2 (documentos/page, DocumentosSection) — unificados a un único badgeCaducidad(). (3) Pase final: TIPOS_DOC_VEHICULO, TIPOS_VEHICULO, TIPO_GASTO_LABEL, ESTADO_INCIDENCIA/TIPO_INCIDENCIA_LABEL movidos a labels.js (fuente única, aunque no eran duplicados, para completar lo pedido en la spec). Alcance NO cubierto (nota honesta, no hecho por bajo ratio valor/riesgo): diccionarios que mezclan iconos de lucide-react (TIPO_MANTENIMIENTO_LABEL de vehiculos/[id], Timeline eventConfig, GastosViajeSection TIPO_ICON) se quedan locales — moverlos no elimina duplicación real, solo añade indirección. ci.ps1 verde (build completo, 143 vitest + 79 pytest) tras cada uno de los 3 commits.
2026-07-03 | 7A.9 Plan-vs-real por hito | (por commitear) | HECHO. Sin migración. `getPlanVsReal(viajeId)` en lib/data.js: por cada hito, ventana planificada vs. primera llegada real (evento tipo "llegada"), delta en minutos, estado a_tiempo/tarde_leve(<=60min)/tarde/sin_datos + resumen {aTiempo, conVentana}. UI en /viajes/[id]: resumen "X/Y hitos a tiempo" sobre la lista de hitos, y bajo cada hito con llegada real una línea de color (verde/ámbar/rojo) con la hora y el delta. 5 tests nuevos (131 vitest total). ci.ps1 verde.
2026-07-03 | 7A.8 P&L real del viaje | (por commitear) | HECHO. Sin migración de negocio; migración extra 0025_realtime_gasto_viaje.sql (añade gasto_viaje a supabase_realtime para que la card de P&L se refresque sola al añadir/borrar un gasto — 7A.14 se renumera a 0026). `getPnlViaje(viajeId)` (precio, costeEstimado/margenEstimado de la viabilidad 7A.5, gastosReales/margenReal de 7A.7, desviacionPct solo si hay gastos reales con qué comparar) y `getMetricasRentabilidad(rango)` (margen real medio, viajes a pérdidas reales, desviación media |real-estimado|, top/bottom 5 por margen real) en lib/data.js. UI: card "Resultado (P&L)" en /viajes/[id] bajo Viabilidad (estimado vs real, desviación con color); 5ª pestaña "Rentabilidad" en /analitica. 5 tests nuevos (126 vitest total; uno de ellos tuvo un test flaky de carrera de reloj en el primer intento, corregido usando un created_at claramente dentro de la ventana en vez de "ahora mismo"). ci.ps1 verde.
2026-07-03 | 7A.7 Gastos del viaje (multas, repostajes) | (por commitear) | HECHO. Migración 0024_gasto_viaje.sql: tabla gasto_viaje (tipo repostaje/peaje/multa/dieta/otro) con RLS por empresa. `getGastosViaje/createGastoViaje/deleteGastoViaje/getMultasPorChofer/getMultasPorVehiculo` en lib/data.js. Componente `GastosViajeSection.jsx` (form colapsable + lista + total y subtotal por tipo) integrado en /viajes/[id]. Card "Multas" (total + últimas 5) en /choferes/[id] y /vehiculos/[id]. 5 tests nuevos (122 vitest total). ci.ps1 verde. Es la base de datos reales para el P&L (7A.8, siguiente).
2026-07-03 | 7A.6 Presupuestador instantáneo | (por commitear) | HECHO. `calcularPresupuesto({puntos, vehiculoId})` en lib/data.js: km (kmCarreteraViaje), horas de conducción + paradas/descansos (calcularEtaConParadas), noches fuera estimadas, coste desglosado (calcularCosteRuta, 7A.5), y precio sugerido = coste/(1-margenObjetivo) con `MARGEN_OBJETIVO_PCT_DEFAULT=15` o el valor configurado en empresa. Página `/presupuesto` nueva (enlace en Sidebar, icono Calculator): lista dinámica de paradas con lat/lon, vehículo opcional, botón Calcular, card de resultado con precio destacado + desglose de coste + aviso "~" si estimado. Botón "Crear viaje" enlaza a /viajes/nuevo sin precargar (la precarga llega con el wizard 7A.11, TODO dejado en el código). 4 tests nuevos (117 vitest total). ci.ps1 verde.
2026-07-03 | 7A.5 Coste de ruta desglosado por capas | (por commitear) | HECHO. Migración 0023_coste_desglosado.sql (renumerada: 0022 la ocupó nota_gestor de 7A.10, ejecutada antes en el orden real). `calcularCosteRuta({km, noches, vehiculo, empresa})` puro en lib/data.js: modo desglosado (combustible real por consumo del vehículo + peajes + dietas + conductor, cada capa null si falta el dato, capasFaltantes listado) con fallback automático a modo blended (el €/km único de 5.2, mismo resultado que antes) cuando no hay datos de combustible. `getViabilidadViaje` integrado sin romper compatibilidad — mismo resultado en blended, desglose visible cuando hay datos. UI: 4 campos nuevos en Ajustes ("Coste desglosado, avanzado"), campo consumo l/100km en ficha de vehículo junto al coste/km, tabla de desglose en la viabilidad de /viajes/[id] con aviso de qué capa falta configurar. 5 tests nuevos (113 vitest total, ninguno de los 5.2 existentes roto). ci.ps1 verde.
2026-07-03 | 7A.4 Live location + geo-llegada v1 | (por commitear) | HECHO. `handle_location` en bot.py: guarda cada ubicación recibida (incluida live location editada, `edited_message`) en la tabla `ubicacion`; si el chófer tiene un viaje en_curso con un hito pendiente a <300m (`UMBRAL_GEO_LLEGADA_M`), le pregunta proactivamente "¿has llegado?" reutilizando el callback `pre_llegada:{id}` ya existente (mismo botón de confirmar de siempre — NO auto-confirma, sigue exigiendo el clic, guardrail del principio 2). No pregunta dos veces por el mismo hito (`ctx.chat_data`). Mensaje de vinculación del chófer ahora explica cómo compartir ubicación en tiempo real. 6 tests nuevos (79 pytest total). ci.ps1 verde.
2026-07-03 | 7A.10 Centro de mando "Hoy" + notas del gestor | (por commitear) | HECHO. Migración 0022_nota_gestor.sql. `getResumenHoy()` en lib/data.js: documentos por caducar, incidencias abiertas (+antigüedad), viajes en riesgo (hito sin completar con ventana ya pasada), chóferes cerca del límite 561 (solo los que tienen viaje activo AHORA, reutilizando getEstado561), viajes a pérdidas estimadas (margen<0, tope 20 llamadas a getViabilidadViaje). Componente `ResumenHoy.jsx` montado arriba de la home (Kanban debajo, intacto): banner verde único si todo en orden, si no 5 tarjetas clicables con el detalle. Debajo, "Notas rápidas" (a petición del usuario: "meter algo de notas para coger info de primera mano y aprender") — cuaderno de bitácora simple (`nota_gestor`), sin edición/borrado en v1, complementa el registro estructurado de `decision_asignacion` (7A.2). 6 tests nuevos (108 vitest total). ci.ps1 verde (incluye next build).
2026-07-03 | 7A.3 Notificación de asignación al chófer (sin aceptar/rechazar) | (por commitear) | HECHO. Migración 0021_notificacion_asignacion.sql (viaje.notificado_asignacion_en). Job PTB `procesar_notificaciones_asignacion` cada 30s (requiere python-telegram-bot[job-queue], instalado en el venv): cuando un viaje tiene chofer asignado y no se le ha avisado, le manda un mensaje con ruta/paradas/km — SIN botones de aceptar/rechazar, coherente con la decisión del usuario de que la asignación es del gestor. Si el chófer no está vinculado a Telegram, se avisa al gestor en su lugar. `cambiarChofer` en /viajes/[id] resetea el flag al reasignar para renotificar al nuevo chófer. i18n en los 4 idiomas completos. 5 tests pytest nuevos (73 pytest total). ci.ps1 verde.
2026-07-03 | 7A.2 Motor de asignación v1 + registro de decisiones (cambio de diseño a petición del usuario: la elección es del GESTOR, no del chófer) | (por commitear) | HECHO. Migración 0020_decision_asignacion.sql aplicada. `scoreChofer`/`sugerirChofer`/`registrarDecisionAsignacion` en lib/data.js: el componente "historial" usa desempeño REAL (getMetricasChoferes: puntualidad+incidencias+valoración), no solo estrellas, tal como pidió el usuario. Cada asignación queda registrada con `siguio_sugerencia` y un `motivo` opcional cuando el gestor no sigue la sugerencia top — es el hook de aprendizaje para 7B.7 (no hay ML todavía, esto es la captura de datos para poder tenerlo el día que se justifique). Componente `SugerenciaChofer.jsx` integrado en `/viajes/[id]`. Nota de alcance: NO integrado en `/viajes/nuevo` (el form plano no tiene viaje_id real hasta el submit) — llega con el wizard 7A.11. 10 tests nuevos (102 vitest total). SPECS-7A.md actualizado con el diseño real construido.
2026-07-03 | SEGURIDAD (a petición del usuario, fuera de la cola del loop) — 0019_seguridad_columnas.sql | (por commitear) | HECHO. Auditoria de que columnas puede modificar `authenticated` (dashboard) via REST directa, no solo por la UI. RLS del proyecto es solo de FILA (empresa_id) — nunca hubo restriccion de COLUMNA, asi que cualquier gestor autenticado podia, saltandose la UI (llamando a la API REST directamente), hacer UPDATE de CUALQUIER columna de las filas de su empresa. 3 vulnerabilidades reales encontradas y cerradas: (1) gestor.auth_user_id modificable -> un gestor podia reasignar la identidad de OTRO gestor de su empresa (secuestro de cuenta interno); (2) chofer.chat_id modificable -> un gestor podia desviar el vinculo de Telegram de un chofer a otro chat; (3) ejecucion_evento/ubicacion (registro de auditoria GPS/hora de llegada, escrito solo por el bot) tenian INSERT/UPDATE/DELETE abiertos a authenticated -> un gestor podia reescribir la hora de una llegada para maquillar puntualidad/nomina. Arreglo: REVOKE UPDATE + GRANT UPDATE(columnas concretas) en gestor y chofer; REVOKE INSERT/UPDATE/DELETE en ejecucion_evento/ubicacion (dashboard confirmado solo-lector en ambas, grep de todo el codigo). Verificado contra la BD real via `information_schema.column_privileges`: auth_user_id/empresa_id/chat_id ya NO aparecen en los grants de UPDATE. ci.ps1 verde (no rompe nada existente). SPECS-7A.md renumerado: 0019 ya no estaba libre para 7A.3, se corrio la numeracion de las migraciones de Fase 7A a 0020-0023.
2026-07-03 | 7A.1 Estado 561 por chófer | df13aa2 | HECHO. getEstado561/kmAproxViaje en lib/data.js (7 tests nuevos, 92 vitest total), card de horas de conducción (semana/14 días, barras de progreso con umbral de color) en /choferes/[id], chip de aviso ámbar al asignar chófer en /viajes/[id] y /viajes/nuevo cuando pct7>=80. Estimación siempre marcada `estimado:true` (no es tacógrafo real, eso es 7B.4).

2026-06-30 | Roadmap reestructurado en fases con gates + protocolo loop stateless | 1c91256→(pendiente) | HECHO
2026-06-30 | Fase 0 (modelo de negocio) | — | HECHO: usuario eligió SaaS multi-cliente. Tenancy multi-tenant correcta obligatoria en Fase 1. UI de gestión de org diferida. Fase 1 desbloqueada.
2026-06-30 | Fase 1: Tenancy correcta | db44abd | HECHO. getDefaultEmpresaId() eliminado (5 archivos dashboard). getCurrentEmpresaId() nueva en lib/data.js, resuelve sesión→gestor→empresa, lanza error explícito si no hay vínculo (no oculta el fallo). signUp() ahora crea empresa nueva por gestor + pide nombre en LoginPage. RLS real aplicado en Supabase (migración 0009): función current_empresa_id() SECURITY DEFINER + políticas empresa-scoped en 13 tablas. ajustes/page.jsx corregido (ya no dependía implícitamente de RLS). Descubierto y anotado en Fase 3: bucket POD público sirve fotos sin pasar por RLS.
2026-06-30 | Fase 1: Harness de tests + CI | 983083b | HECHO. backend/tests/ (fakes.py + test_bot.py, 16 tests, incl. test del fix de seguridad hito-pertenece-a-chofer). dashboard/lib/data.test.js (18 tests, mock de query builder en memoria, vitest instalado). ci.ps1 en raíz: pytest + vitest + next build, exit 0/1. Corregido de paso: themeColor mal ubicado en metadata (Next.js 15 lo exige en viewport) — lo detectó el build, no lo habría pillado un check de "200". FASE 1 CERRADA. Fase 2 desbloqueada.
2026-06-30 | Fase 2: Vincular Telegram del gestor | (pendiente push) | HECHO. bot.py: vincular_gestor() nueva + cmd_start detecta prefijo "gestor_". Ajustes: sección Telegram con copiar enlace t.me/Bot?start=gestor_<id>. 5 tests nuevos (21/21 backend total). CI completo verde antes de commit.
2026-06-30 | Fase 2: Loading states + anti-doble-clic | — | HECHO. procesandoId pattern en incidencias, vehiculos; guardandoEstado/guardandoChofer/procesandoPod en viaje detalle. Todos los botones async desactivados durante la operación con disabled:opacity-40.
2026-06-30 | Fase 2: Localización real del bot | 807f229 | HECHO. TEXTOS dict 8 idiomas en bot.py, helper t(chofer_or_idioma, key, **kwargs), fallback a 'es' para idioma desconocido. Idiomas completos: es/en/ro/fr; ar/it/pt/de aliasados a 'en'. build_hito_message acepta idioma=. send_next_hito acepta chofer dict en vez de chofer_id. 12 tests i18n nuevos, 33 total pytest, 18 vitest. CI verde.
2026-06-30 | Fase 2: Paginacion incidencias + viajes | 28e42de | HECHO. incidencias: PAGE_SIZE=20, fetchPage(filtro, offset, append), Ver mas button. viajes: getViajesLista(offset, estado) nueva en data.js (50/pag), viajes/page.jsx usa paginacion servidor + filtro estado server-side, busqueda client-side sobre datos cargados.
2026-06-30 | Fase 2: Pagina detalle chofer | 28e42de | HECHO. /choferes/[id]: cabecera (nombre, idioma, estado Telegram, copiar enlace), valoraciones recientes con estrellas, historial viajes paginado (20/pag). Lista choferes: tarjetas clicables con Link group-hover.
2026-06-30 | Fase 2: Mantenimiento vehiculo | 28e42de | HECHO. Migracion 0010: tabla mantenimiento_vehiculo (tipo/descripcion/fecha/km/coste/estado) con RLS empresa. /vehiculos/[id]: detalle vehiculo + CRUD mantenimiento inline (form colapsable, lista con iconos por tipo, borrado, alerta ITV pendiente). Lista vehiculos: tarjetas clicables. FASE 2 CERRADA. Siguiente: Fase 3 Hardening.
2026-06-30 | Fase 3: Bucket POD privado + URLs firmadas | 726d1ee | HECHO. Migracion 0011: bucket pods privado + policy RLS storage por empresa (primer segmento de la ruta). bot.py sube a ruta {empresa_id}/{viaje_id}/{hito_id}/uuid.jpg y guarda el path (no URL publica). Componente PodImage en dashboard resuelve createSignedUrl (TTL 1h) bajo sesion del gestor.
2026-06-30 | Fase 3: Observabilidad (Sentry) | a0eeb6f | HECHO. sentry-sdk en bot.py (init condicional a SENTRY_DSN). @sentry/nextjs en dashboard (sentry.client/server.config.js + instrumentation.ts), condicional a NEXT_PUBLIC_SENTRY_DSN/SENTRY_DSN. Inerte en dev/test sin DSN. CI verde (33 pytest + 18 vitest + next build).
2026-06-30 | Fase 3: Disciplina de migraciones | (pendiente push) | HECHO. backend/db/migrate.py: runner con tabla schema_migrations (filename+checksum), aplica .sql pendientes en orden, --check para listar sin aplicar. Migraciones 0001-0011 (aplicadas ad-hoc por MCP hasta ahora) registradas como backfill en Supabase. README documenta uso.
2026-06-30 | Fase 3: Bot modo webhook (decisión del usuario: usarlo) | (pendiente push) | HECHO el código, NO activado. run_bot.py soporta polling (default, sin BOT_WEBHOOK_URL) y webhook (si BOT_WEBHOOK_URL está definida, requiere BOT_WEBHOOK_SECRET como secret_token de Telegram). No se ha activado en real porque no existe endpoint HTTPS público (Despliegue sigue pospuesto) ni supervisión de proceso configurada — eso se hace junto con el despliegue, no antes. FASE 3 CERRADA.
2026-06-30 | Fase 4 ABIERTA (features de valor) | (este commit) | Specs cerradas con usuario. Cola [LOOP] en orden: 4.1 botones bot, 4.2 registro documental base+viaje (tabla documento + bucket documentos), 4.3 docs vehiculo/chofer, 4.4 alertas caducidad + vista por-caducar, 4.5 metricas preset (4 vistas en /analitica), 4.6 abstraccion mensajeria (seam WhatsApp). Todos sin coste/deploy. Production-gated (NO loop): voz/Whisper, agente telefonico, vision POD, adaptador WhatsApp — todos [DECISIÓN]. Loop ejecuta de noche en Sonnet.
2026-07-01 | Fase 4.1: Botones de accion rapida en el bot | d0e74df | HECHO. menu_keyboard(chofer) con ReplyKeyboardMarkup (3 botones, i18n en 4 idiomas completos). handle_menu_texto reconoce el texto pulsado en cualquier idioma (sets BOTONES_INCIDENCIA/MI_VIAJE/CONTACTAR), enruta a incidencia_ayuda / send_next_hito / contactar_gestor_texto. Nota: tabla gestor no tiene telefono, se usa email. Teclado se adjunta al confirmar vinculacion del chofer. 7 tests nuevos (40 pytest total). CI verde.
2026-07-01 | Idea anotada: aprendizaje sobre conversaciones | 603fc59 | Usuario confirma que es para DESPUES del despliegue, cuando haya datos reales. Anotado en Fase Production-gated como [DECISION], no se construye nada ahora.
2026-07-01 | Fase 4.2 + 4.3: Registro documental completo | 713052f | HECHO. Migracion 0012_documentos.sql: tabla documento (ambito viaje/vehiculo/chofer, tipo, fechas emision/caducidad, archivo_url, estado, notas) con RLS empresa. Bucket privado "documentos" + policies SELECT/INSERT/DELETE storage por empresa (mismo patron que pods). Componente reutilizable DocumentosSection (subida a bucket + insert, listado con badge vigente/caduca pronto/caducado segun fecha_caducidad, ver/descargar via signed URL bajo demanda -soporta PDF e imagen-, borrar). Integrado en /viajes/[id] (CMR/albaran/ADR/otro), /vehiculos/[id] (ITV/seguro/autorizacion transporte/otro), /choferes/[id] (licencia/CAP/otro). CI verde (next build incluye las 3 rutas nuevas con el componente).
2026-07-01 | Fase 4.4: Alertas de caducidad de documentos | fd9a127 | HECHO parcialmente (nota honesta). getDocumentosPorCaducar() en lib/data.js: junta documentos con fecha_caducidad <= hoy+30d con la etiqueta/enlace de su entidad (viaje/vehiculo/chofer), ordenado por urgencia. 4 tests nuevos (21 vitest total). Pagina /documentos (enlace nuevo en Sidebar) lista caducados y por caducar con badges. NotificationCenter ahora incluye estos documentos junto a incidencias/eventos (alerta in-app). NO implementado: push a Telegram del gestor, porque requeriria un job programado (cron) que no existe en el proyecto hoy; construirlo ahora seria infraestructura nueva fuera de "sin deploy". Queda anotado para resolver junto al despliegue (pg_cron de Supabase o un scheduler del backend). CI verde.
2026-07-01 | Fase 4.5: Vistas de metricas preset | 24fb66a | HECHO. 4 funciones de agregacion en lib/data.js (getMetricasPuntualidad/Incidencias/Choferes/Flota), todo calculado en JS a partir de selects simples (sin agregacion SQL, para mantener compatibilidad con el mock de tests). Puntualidad usa incidencias tipo fuera_de_ventana (ya generadas por el bot) frente a hitos con ventana_fin. Pagina /analitica con selector de pestanas entre las 4 vistas, tarjetas + tablas + barras CSS (sin libreria de graficos). 6 tests nuevos (27 vitest total). CI verde, next build incluye /analitica.
2026-07-01 | Fase 4.6: Abstraccion de mensajeria (seam WhatsApp) | e4d7d9e | HECHO con alcance acotado (nota honesta). Interfaz Transporte/TransporteTelegram: alertar_gestor y notificar_gestor_evento ahora envian texto al gestor a traves de transporte_gestor.enviar_texto() en vez de instanciar Bot(token=TOKEN) inline cada vez. Cubre el caso que de verdad bloqueaba un adaptador WhatsApp futuro (push de alertas al gestor). NO se toco el flujo del chofer (botones inline/callback_query, reply keyboard) por ser mecanismos propios de Telegram sin equivalente WhatsApp directo, y por riesgo de romper comportamiento tocando todos los handlers en una sola noche. 3 tests nuevos (43 pytest total). CI verde.
FASE 4 CERRADA (2026-07-01). Los 6 items [LOOP] completados en loop nocturno: botones bot, registro documental (viaje+vehiculo+chofer), alertas de caducidad, metricas preset, abstraccion de mensajeria. Quedan solo items [DECISION] de la seccion production-gated (voz/Whisper, agente telefonico, vision POD, WhatsApp, aprendizaje sobre conversaciones) y Despliegue, todos pendientes de decision/presupuesto humano. Siguiente sesion: esperar instrucciones del usuario, no hay mas [LOOP] pendientes en el roadmap actual.
2026-07-01 | Auditoria de seguridad (RLS, CORS, headers) a peticion del usuario | 5fa13bb | HECHO. RLS: 16/16 tablas de negocio con RLS + policy empresa-scoped; schema_migrations con RLS sin policies es correcto (solo se toca via psycopg2 directo, nunca por REST). current_empresa_id() es SECURITY DEFINER llamable via RPC por authenticated -- revisado el cuerpo: sin parametros, sin escritura, solo devuelve el propio empresa_id del caller, search_path fijado a 'public' (mitiga hijack) -> benigno, no requiere cambio. Buckets pods/documentos privados con policies por empresa. CORS: FastAPI (main.py) sin CORSMiddleware -- aceptable hoy porque el dashboard no llama a esta API (habla directo a Supabase con anon key + RLS); si se añaden endpoints reales habria que configurar CORS scoped al origen del dashboard. Encontrado y corregido: /db/health usaba la SERVICE ROLE key (salta RLS) en un endpoint publico sin auth y devolvia el conteo de filas de la tabla empresa -- se quito el campo "rows" de la respuesta, se mantiene solo el chequeo de conectividad. Secrets: .env/.env.local correctamente en .gitignore, nunca commiteados; dashboard usa anon key, backend/bot usan service role solo server-side. Corregido tambien: Next.js sin cabeceras de seguridad -- añadidas X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, Strict-Transport-Security en next.config.js. NO añadido: Content-Security-Policy (requiere allowlist cuidadosa de Supabase/Leaflet/Sentry, arriesgado añadir sin probar en navegador real; queda como pendiente antes de deploy). CI verde.
2026-07-01 | Fase 5.1: Informe de nomina auto-derivado (noches fuera + km por chofer) | bb86a39 | HECHO con simplificaciones v1 anotadas. Migracion 0013_empresa_base_ubicacion.sql: ALTER TABLE empresa ADD base_lat/base_lon double precision (nullable) -- aplicada via MCP apply_migration (mismo flujo que 0012) y registrada en schema_migrations con su checksum sha256. Cliente OSRM: dashboard/lib/osrm.js, distanciaPorCarretera(origen,destino) llama a /route/v1/driving via fetch, URL configurable (NEXT_PUBLIC_OSRM_URL/OSRM_URL, default localhost:5000), devuelve null si falla (no tumba el informe), mockeable en tests. Infra de DESARROLLO: infra/osrm/ (docker-compose.yml con imagen oficial osrm/osrm-backend + README documentando descarga del extracto spain-latest.osm.pbf de Geofabrik y el preprocesado extract/partition/customize -- NO se descargo el extracto, es enorme; data/ en .gitignore). getInformeNomina(mes,anio) en lib/data.js (mismo patron que getMetricas*): por chofer calcula nochesFuera (llegada nocturna 22:00-06:00 a >UMBRAL_NOCHE_FUERA_KM=50km de la base, dedup por fecha), km por carretera real via OSRM entre hitos completados consecutivos de viajes con actividad en el mes, y lista de viajes que contribuyeron. Pagina /nomina (selector mes/anio, tabla por chofer, aviso si no hay base) + enlace en Sidebar. Form de ubicacion base en Ajustes (2 inputs numericos lat/lon con validacion de rango y "ambas o ninguna"). 7 tests nuevos (34 vitest total, 43 pytest). CI verde (pytest+vitest+next build, /nomina en el build). SIMPLIFICACIONES/PENDIENTES v1 (honesto): (1) el umbral de 50km es un valor inicial RAZONABLE, NO pactado con gestor real -- pendiente de ajustar cuando haya conversacion; anotado tambien en la UI y en UMBRAL_NOCHE_FUERA_KM. (2) La "noche fuera" se estima por evento de llegada nocturna, no por un chequeo real de "viaje en curso a las 00:00 exactas" -- aproximacion v1. (3) Las horas se evaluan en UTC (getUTCHours), no en zona horaria local de Espana; para Espana peninsular (UTC+1/+2) esto desplaza la ventana ~1-2h -- aceptable para v1, anotar para afinar. (4) NO PROBADO end-to-end contra un OSRM real: no hay Docker con el extracto OSM de Espana en este entorno; el routing por carretera se verifico SOLO con OSRM mockeado en los tests. La llamada HTTP real (formato de URL y parseo de la respuesta) esta escrita segun la API documentada de OSRM pero no ejecutada contra el servicio. El despliegue del contenedor OSRM en produccion queda pospuesto junto con "Despliegue".
2026-07-01 | DISCOVERY.md creado + Fase 5 abierta en ROADMAP | (pendiente push) | HECHO. Primera entrada de discovery: conversacion con gestor real (~30 camiones) que valida la tesis de "capa sobre el TMS" y aporta un wedge nuevo -- informe de nomina auto-derivado (noches fuera + km por chofer), ya que Norenty tiene el dato subyacente (timestamps de hitos). Marcado como 5.1 [LOOP] pero CON UNA DECISION DE MODELO DE DATOS PENDIENTE antes de construir (que cuenta como "noche fuera", como se calculan los km) -- no se empieza a construir hasta cerrar esa spec con el usuario. Tambien confirma voice-to-text (Whisper) como prioridad #1 de la seccion production-gated. Anotados como [DECISION] fuera de alcance v1: calculo de viabilidad/margen de viaje, asignacion automatica de rutas. Pendiente de esta semana: entrevistas con dueño, gerente, y un segundo gestor sin relacion personal con el fundador.
2026-07-01 | Fase 5.2: Viabilidad/margen de viaje (modelo de coste por capas) | 867f41d | HECHO. Decision con usuario: modelo de coste POR CAPAS para que el cliente elija granularidad segun datos que puebla. Migracion 0014_coste_viabilidad.sql (aplicada via MCP apply_migration + checksum a7b1a777... registrado en schema_migrations): viaje.precio, empresa.coste_km (blended fallback), vehiculo.coste_km (override por camion). En lib/data.js: resolveCosteKm (vehiculo->empresa, puro), calcularMargen (puro, devuelve nulls si falta dato en vez de inventar), kmCarreteraViaje (OSRM sobre TODOS los hitos = ruta planificada, no solo completados como en nomina), getViabilidadViaje (integra). UMBRAL_MARGEN_AMBAR_PCT=10 (valor inicial, no pactado). UI: precio editable + badge de margen (rojo<0 / ambar<10% / verde) en /viajes/[id]; coste/km empresa en Ajustes; override por vehiculo en /vehiculos/[id]. 14 tests nuevos (50 vitest, 43 pytest). CI verde. EN RECAMARA v2 (documentado en ROADMAP, NO construido): desglose combustible(consumo/peso via BD publica de camiones)/conductor/peajes como capas por delante, e indexar repostajes/multas reales por viaje para afinar. Misma nota que 5.1: km via OSRM NO probado end-to-end (sin Docker/extracto OSM en este entorno), solo con OSRM mockeado en tests.
2026-07-01 | Investigacion regulatoria + fuentes (ETA legal, parkings, routing) | (pendiente push) | HECHO (research + specs, sin codigo). A peticion del usuario, investigado con fuentes oficiales: (1) Reglamento CE 561/2006 -- pausa 45min/4.5h, conduccion diaria 9h(10h 2x/sem), semanal 56h, bisemanal 90h, descanso diario 11h(red.9h), semanal 45h(red.24h). (2) 75km/h es heuristico de planificacion, no ley; camion limitado a 90 (Dir.92/6/CEE) -> parametro configurable default 75. (3) Parkings seguros: SI existe fuente oficial y gratis -- European Access Point for Truck Parking Data (DATEX II, dataset ETPA en data.europa.eu, Regl.delegado 885/2013) + certificacion SSTPA + comercial (Truck Parking Europe); NO tiene que aportarlo la empresa, pero la del gestor ya tiene su mapa propio -> soportar ambos. Registrado en DISCOVERY.md. Nuevos items en ROADMAP Fase 5: 5.3 ETA cumple-561 ([LOOP], construible sobre la DURACION que ya da OSRM), 5.4 parkings seguros ([DECISION], parsear DATEX II). Principio de arquitectura anotado: recurrir a terceros para lo dificil (OSRM ahora, HERE truck-aware cuando haya presupuesto), logica de negocio como capa propia por encima del proveedor.
2026-07-01 | Fix 5.1: ventana horaria de noche fuera en hora local (Europe/Madrid) en vez de UTC | 7cc6c8f | HECHO. getInformeNomina usaba d.getUTCHours() para decidir si una llegada caia en la ventana 22:00-06:00, lo que desplazaba la ventana 1-2h en Espana (CET/CEST) -- pendiente anotado en el commit anterior (bb86a39, punto 3). Nuevo helper partesLocalOperacion() usa Intl.DateTimeFormat con timeZone Europe/Madrid (respeta el cambio de horario automaticamente, sin libreria nueva) para obtener hora/fecha locales; fechaNocheOperacion() calcula el bucket de fecha a partir de esos componentes locales en vez de UTC. 2 tests nuevos que fuerzan horario de verano (CEST, UTC+2) y confirman que el resultado depende de la hora local, no de la UTC (36 vitest total, 43 pytest). CI verde. Pendientes v1 que siguen abiertos (sin cambios): umbral 50km sin pactar con cliente real, y routing OSRM no probado end-to-end (sin Docker/extracto OSM en este entorno).
2026-07-02 | Fase 5.4: Parkings (dataset abierto + propios) | (commit feat 5.4) | HECHO. Endpoint oficial UE requiere login ECAS -> se uso dataset abierto real: Fraunhofer/Zenodo CC-BY 4.0. Migracion 0016 tabla parking (global empresa_id NULL + propios RLS). Sembradas 763 ubicaciones ES via seed_parking_abierto.py -- NOTA: la SERVICE_ROLE_KEY del .env esta VACIA, se sembro con anon key + politicas/grant temporales creados y RETIRADOS via MCP (verificado: 763 filas, policies limpias). Capa toggle en mapa + alta/borrado de parkings propios. 3 tests (65 vitest). Etiquetado honesto: NO es certificacion SSTPA.
2026-07-02 | Fase 6.1: Fallback Haversine cuando OSRM no responde | 4bdbf05 | HECHO. kmCarreteraViaje devuelve ahora {km, estimado} en vez de solo un numero: si distanciaPorCarretera devuelve null para un tramo, se usa Haversine x FACTOR_SINUOSIDAD_FALLBACK=1.3 para ese tramo y se marca estimado=true (antes ese tramo se contaba silenciosamente como 0 km). getInformeNomina refactorizada para llamar a kmCarreteraViaje en vez de duplicar su propio bucle OSRM -- elimina codigo repetido entre 5.1/5.2/5.3 de paso. getViabilidadViaje y getEtaViaje propagan el flag estimado. UI: /nomina (columna km con "~" + nota al pie), /viajes/[id] viabilidad y ETA (mismo patron "~" + aviso amarillo). 6 tests nuevos (71 vitest, 43 pytest). CI verde.
2026-07-02 | REVISION CTO + BUG cazado y corregido | fe056b6 | Revision completa a peticion del usuario (detalle en ROADMAP seccion "Revision CTO 2026-07-02"). CRITICO ENCONTRADO: SUPABASE_SERVICE_ROLE_KEY vacia en .env -> el bot vivo corre con anon key y con RLS activo NO puede leer/escribir; requiere accion del usuario (D1). BUG CORREGIDO: informe de nomina consultaba columna inexistente tipo_evento (el bot escribe "tipo") -> informe siempre vacio contra BD real; los tests no lo cazaron porque el fake replicaba el nombre equivocado. Fix + tests actualizados, CI verde. Fase 6 abierta con 22 items [LOOP] especificados para julio (4 semanas tematicas: verdad/robustez, demo, operativa, deploy-ready) + 5 [DECISION] del usuario (D1 clave service role CRITICA, D2 DATABASE_URL, D3 presupuesto voz, D4 luz verde deploy, D5 BD consumos camiones).
2026-07-01 | Fase 5.3: ETA cumple-561 (paradas legales) | 4115182 | HECHO. Migracion 0015_velocidad_planificacion.sql (empresa.velocidad_planificacion_kmh, nullable, aplicada+checksum registrado). Decision de implementacion tomada esta sesion: NO se usa la duracion que da OSRM (perfil "driving" calibrado para turismos, subestimaria camion); en su lugar horas_conduccion = km_ruta (kmCarreteraViaje de 5.2) / velocidad_planificacion (VELOCIDAD_PLANIFICACION_KMH=75 default, configurable por empresa). calcularEtaConParadas() pura simula Reglamento CE 561/2006 v1 CONSERVADORA: siempre limite diario base 9h + descanso normal 11h (nunca la excepcion 10h/2x-semana ni descanso reducido 9h -- ambas requieren estado multi-viaje inexistente en calculo aislado), NO comprueba limites semanal 56h/bisemanal 90h/descanso semanal 45h (mismo motivo) -- sobreestima el tiempo, nunca lo infraestima. getEtaViaje() integra. UI en /viajes/[id]: seccion "Tiempo estimado" con km/velocidad/horas conduccion/paradas/descansos + nota de la simplificacion v1. Campo velocidad en Ajustes. 12 tests nuevos (62 vitest, 43 pytest). CI verde. Pendiente v2: limites semanales con estado real del chofer, routing truck-aware (HERE).
2026-07-02 | SPECS-7A.md: especificaciones de implementacion mascadas | (este commit) | HECHO a peticion del usuario ("mascado al maximo para que Sonnet solo pique codigo"). Documento nuevo SPECS-7A.md (~600 lineas): preambulo de convenciones del repo con las trampas REALES ya sufridas (RETURNING vs RLS bootstrap, postgrest-py returning=minimal, BOM de PowerShell que rompe vitest, order() no-op en el mock JS, Bot congelado de PTB, verificacion contra BD real obligatoria) + spec completa por item 7A.1-7A.14: SQL literal de las migraciones 0019-0022, firmas de funciones con reglas numericas exactas (pesos del score, umbrales, formulas), archivos a crear/tocar, decisiones de arquitectura tomadas y cerradas (p.ej. push de ofertas via JobQueue de PTB porque el bot es el unico demonio vivo; portal publico via RPC SECURITY DEFINER con whitelist de campos + exclusion del AuthGuard por pathname), lista de casos de test por item, y orden de ejecucion con dependencias (7A.1->...->14, luego 6.x restantes). ROADMAP actualizado: el loop DEBE leer SPECS-7A.md antes de implementar cualquier 7A.x.
2026-07-02 | VISION NORENTY OS + Fases 7A/7B escritas | (commit 995431a) | HECHO a peticion del usuario ("producto ideal que sustituya al gestor de trafico, estilo Uber para el chofer, 1 persona -> 120 camiones"). Seccion nueva en ROADMAP: North Star (camiones/gestor) + 5 metricas, revision honesta de lo construido por 7 pilares (cerebro/dispatch/ojos/voz/escudo/caja/plataforma), 5 principios de diseno (automatiza 80% explica 100%, human-in-the-loop progresivo, el chofer solo carga y conduce, estimado vs real siempre etiquetado, dashboard=decisiones). Fase 7A: 14 items [LOOP] ejecutables ya y especificados al detalle (estado 561 real, motor de asignacion con score explicado, oferta Uber-style al chofer, live location + geo-llegada, coste total desglosado, presupuestador instantaneo, multas/repostajes, P&L real, plan-vs-real, centro de mando Hoy, wizard nuevo viaje, sistema de diseno, onboarding, portal publico de tracking para clientes). Fase 7B: 9 items [DECISION] production-gated (Whisper, triaje AI con playbooks, agente telefonico, tacografo remoto, fuel cards, HERE, auto-dispatch, TMS/API, marketplace moonshot). PRIORIDAD DEL LOOP CAMBIADA: 7A va antes que los 6.x restantes; 6.14/6.15/6.20 subsumidos por 7A.12/7A.1/7A.10. El loop retoma con 7A.1.
2026-07-02 | Fase 6.11: E2E del bot con Updates reales | 8497d1b | HECHO. tests/test_bot_e2e.py: Updates REALES de PTB (MessageEntity.BOT_COMMAND, CallbackQuery, PhotoSize) pasados por app.process_update() -- el mismo camino que un mensaje real. Flujo completo /start->hito1 recogida->pre_llegada->llegada->hito2 entrega->llegada->foto POD->viaje completado, mas /incidencia con args reales y comando desconocido. Trampas PTB v22 documentadas en el test: Bot congelado (parcheo a nivel de clase), get_me debe cachear _bot_user, cada Message manual necesita .set_bot(). fakes.py ampliado con FakeStorage. VERIFICADO que caza regresiones: rompi el patron del handler de llegada temporalmente y el test fallo al instante; restaurado. 3 tests (68 pytest, 85 vitest). CI verde. SEMANA 2 DE FASE 6 COMPLETA (6.7-6.11).
2026-07-02 | Fase 6.10: Pase de accesibilidad/movil | 6f6685b | HECHO. Revisadas documentos, analitica, nomina, mapa (form parking), viabilidad/ETA en viaje, DocumentosSection. Hallazgo real (no cosmetico): text-estado-ok (#16A34A) sobre bg-green-50 da ~3.15:1 -- pasa para texto grande (>=3:1) pero FALLA WCAG AA en texto pequeno (necesita 4.5:1); corregido a text-green-700 en badge "Vigente" (documentos) y "Margen sano" (viabilidad). Labels de formulario que eran <label> suelto sin asociacion programatica (mes/ano nomina, campos parking en mapa, tipo/fechas/archivo/notas en DocumentosSection) ahora tienen htmlFor+id reales (o sr-only), con ids unicos por ambito en el componente reutilizable para no colisionar. focus:ring-2 anadido donde focus:outline-none dejaba sin indicador de foco visible. Botones solo-icono con aria-label (title no es fiable como nombre accesible). Tablas de nomina y choferes (analitica) con overflow-x-auto para 360px. Pestanas de /analitica con role=tablist/tab/aria-selected. Errores de formulario con role=alert. /documentos no necesito cambios. Sin librerias nuevas, CI verde (solo marcado/estilo, sin tests nuevos).
2026-07-02 | Fase 6.9: Invitaciones multi-gestor | 98bace2 | HECHO y VERIFICADO EN VIVO. Migracion 0018: tabla invitacion (empresa_id, email, codigo uuid unico, usada_at) con RLS empresa-scoped para gestion normal. Mismo problema de arranque que 6.2 (usuario nuevo sin fila gestor no puede leer por RLS) resuelto igual que alli: funcion usar_invitacion(codigo) SECURITY DEFINER que canjea atomicamente y devuelve empresa_id o NULL, sin exponer listado. signUp() acepta invitacionCodigo opcional -- canjea via RPC y une a esa empresa en vez de crear una nueva. Seccion Equipo en Ajustes (invitar/copiar enlace/revocar). LoginPage lee ?invitacion= de la URL. VERIFICACION EN PRODUCCION REAL (aplicando la leccion de 6.2 -- no fiarse solo de mocks): cree un usuario auth nuevo de verdad sin fila gestor, canjee la invitacion via RPC real -> devolvio el empresa_id correcto; repeti la llamada con el mismo codigo -> NULL (no se puede reusar, protege contra doble canje); codigo inventado -> NULL; insercion del gestor con ese empresa_id -> exito (201). Datos de prueba limpiados despues (gestor, invitacion, auth.users). 8 tests en data.test.js + 4 en auth.test.js (85 vitest total, 65 pytest). CI verde. Nota de proceso: un intento de ejecutar el script de verificacion con python -c inline en PowerShell disparo un bloqueo de seguridad del sandbox (interpreto mal las comillas anidadas como un intento de Remove-Item sobre .env) -- NO se borro nada (confirmado), se reintento escribiendo el script a un archivo .py en el scratchpad en vez de inline, que funciono limpio.
2026-07-02 | Fase 6.8: Comando /eta en el bot | e409687 | HECHO. calcular_eta_con_paradas() en bot.py es espejo exacto de calcularEtaConParadas() JS (5.3) -- mismos 6 casos de test (0h/3h/5h/9h/10h/18h), mismos resultados verificados. Decision de alcance documentada explicitamente: a diferencia del dashboard (ruta planificada completa, todos los hitos), /eta calcula el tiempo restante DESDE AHORA -- solo hitos no completados (pendiente/en_curso) -- mas util para un chofer preguntando a mitad de trayecto que repetir el calculo de ruta completa. Bot no depende de OSRM -> usa Haversine x FACTOR_SINUOSIDAD_FALLBACK (1.3) directamente en vez de como fallback. Respeta empresa.velocidad_planificacion_kmh (default 75). i18n es/en/ro/fr con pluralizacion real (parada/paradas, descanso/descansos). 12 tests nuevos (65 pytest total, 77 vitest). CI verde.
2026-07-02 | Fase 6.7: Comando /parking en el bot | 44995a8 | HECHO. obtener_ubicacion_chofer(): tabla ubicacion (GPS en vivo) primero, si no hay cae al ultimo hito COMPLETADO del viaje activo, None si no hay ninguna senal. cmd_parking junta parkings propios de la empresa (bot usa service role, salta RLS, asi que se replica a mano el mismo criterio de getParkings del dashboard: propios + dataset_abierto) + calcula distancia con haversine_km() (espejo Python de la funcion JS de data.js) y devuelve los 3 mas cercanos: nombre real si es propio, tipo localizado si es del dataset abierto, boton "Como llegar" (Maps) por cada uno. i18n completo es/en/ro/fr. Bonus: tests/fakes.py FakeQuery.order() era un no-op desde que se creo -- ahora ordena de verdad y se anadio .limit(), necesario para "ultima ubicacion" (order by created_at desc limit 1). 10 tests nuevos (53 pytest total, 77 vitest). CI verde.
2026-07-02 | Fase 6.6: CSP Report-Only | 4572e96 | HECHO con nota honesta. Content-Security-Policy-Report-Only en next.config.js: allowlist basado en grep real del codigo (Supabase REST+Realtime, tiles Leaflet de MapView.jsx, Sentry best-effort). script-src estricto a proposito (sin unsafe-inline), style-src con unsafe-inline (Tailwind + estilos inline React). Descubierto: Google Fonts no se usa realmente (solo nombrado en @theme). Intento de verificacion en navegador real via mcp__Claude_Preview__* fallido: la herramienta tiene un bug de workspace en este entorno (su launch.json apunta a la carpeta de instalacion de Git para Windows, no al proyecto -- confirmado leyendo el contenido de esa carpeta antes de tocar nada); chromium-cli tampoco disponible. Se limpio el .claude/launch.json de scaffolding que no funciono. Verificacion de respaldo: ci.ps1 (build de produccion) confirma la cabecera se genera sin error; Report-Only nunca bloquea nada aunque el allowlist este incompleto, solo avisa en consola -- riesgo bajo de dejarlo sin verificar visualmente. Pendiente: revisar consola en navegador real antes de promocionar a enforcing.
2026-07-02 | Fase 6.5: Indices FK faltantes (advisor con bug interno) | 1aad740 | HECHO. get_advisors(performance) falla con error interno de Supabase (bug en su propio lint, reproducido 2 veces, no arreglable desde aqui). Chequeo equivalente a mano por SQL: 3 FKs sin indice de cobertura -- documento.empresa_id, mantenimiento_vehiculo.empresa_id, mantenimiento_vehiculo.vehiculo_id -- las tres filtradas en cada query por RLS o por paginas reales. Migracion 0017 aplicada + checksum registrado, verificado que los indices existen. Hallazgo adicional del advisor de SEGURIDAD (nuevo desde la auditoria del 2026-07-01): Leaked Password Protection desactivada -- toggle de panel, no de SQL, anadido como D6 (accion ligera, sin criterio) en la lista de decisiones del usuario. CI verde.
2026-07-02 | Fase 6.4: Rango de fechas server-side en agregaciones | 6787fea | HECHO. getInformeNomina: filtro de ejecucion_evento por mes movido a la query (.eq tipo=llegada + .gte/.lt sobre ocurrido_en) en vez de traer la tabla entera. getMetricasPuntualidad/Incidencias/Choferes aceptan {desde,hasta} opcional via resolveRango() compartido (default ultimos 90 dias), aplicado sobre created_at/ventana_fin en servidor. getMetricasFlota tratado aparte: vehiculos activos/en uso/ITV pendientes son estado ACTUAL, no tiene sentido acotarlos a un rango -- el rango se aplica SOLO a averias recientes (query separada de la de ITV). CAMBIO DE COMPORTAMIENTO REAL: /analitica pasa de mostrar historico completo a ultimos 90 dias por defecto -- se anadio aviso visible en la cabecera para que no sea silencioso (commit 6787fea aparte). 2 tests nuevos + 3 actualizados (fixtures de fechas fijas 2026-01 ahora necesitan rango explicito amplio). 77 vitest, 43 pytest. CI verde.
2026-07-02 | Fase 6.3: Export CSV + impresion en /nomina | 518968a | HECHO. Boton Exportar CSV (mismo patron que /viajes: Blob+BOM+download) y boton Imprimir/PDF (window.print()). Estilos print: de Tailwind: layout.jsx oculta scroll/padding forzados en body/main al imprimir, Sidebar y Topbar con print:hidden (mejora global, no solo nomina), controles de mes/ano y botones ocultos en la vista impresa, mes/ano se muestran como texto fijo en el subtitulo solo al imprimir. CI verde.
2026-07-02 | Fase 6.2: Datos demo por RLS real + BUG CRITICO cazado y corregido | 0be2356 | HECHO, con hallazgo mayor. backend/db/seed_demo.py: login/alta gestor demo con ANON KEY (nunca service role), puebla 6 vehiculos, 8 choferes (uno por idioma del bot), 25 viajes (4 estados, con indices unicos de asignacion activa respetados via pool tracking), 57 hitos geocodificados a 15 ciudades reales, 69 eventos de ejecucion en completados (llegada/salida/viaje_completado, para que nomina/analitica tengan senal real), 5 incidencias, 7 valoraciones, 4 documentos con caducidades, 3 parkings propios, configuracion de empresa (base/coste_km/velocidad). Idempotente, ejecutado 2 veces para confirmarlo, verificado por SQL directo que los datos viven SOLO en la empresa demo. HALLAZGO CRITICO: el alta de empresa NUEVA llevaba ROTA desde que se activo RLS (2026-06-30) -- nunca se detecto porque solo se probo con la empresa pre-sembrada de antes de RLS (id 00000000-...-000000001). Causa raiz diagnosticada paso a paso (RPC de depuracion temporal, limpiada despues): `.insert(...).select().single()` pide RETURNING; la policy SELECT de empresa es id=current_empresa_id(), que es NULL en el momento del alta (el gestor aun no existe) -> Postgres rechaza el RETURNING con el MISMO mensaje que un fallo de WITH CHECK ("new row violates row-level security policy"), indistinguible sin depurar a fondo. Ademas se descubrio que postgrest-py (a diferencia de supabase-js) pide RETURNING por defecto en insert() salvo que se pase returning="minimal". Arreglado en dashboard/lib/auth.js (fix real, no solo del script demo): generar el id de empresa en el cliente y no pedir RETURNING en ese insert de arranque. Test de regresion en auth.test.js (4 tests, 75 vitest total) que fija la forma correcta de la llamada -- un mock generico de RLS no lo habria cazado, asi que el test codifica la leccion explicitamente. CI verde. Este es el bug que 6.2 estaba disenado para encontrar (verdad contra mocks), y lo encontro a la primera ejecucion real.
2026-07-04 | Fase 9.28: SPECS-9-ROLES.md (diseno de roles + expulsion de gestor) | (este commit) | HECHO (subagente opus, esfuerzo medio; solo diseno, sin codigo de produccion todavia -- eso es 9.29). Documento SPECS-9-ROLES.md (649 lineas, mismo formato mascado que SPECS-7A.md/SPECS-9.md). Decisiones cerradas: (1) EXPULSION INSTANTANEA via `current_empresa_id()` (0009) devolviendo NULL si `activo=false` -- como las 17+ policies de aislamiento ya cuelgan de esa unica funcion, un gestor desactivado pierde lectura/escritura a TODO en su siguiente query sin tocar ni una policy y sin esperar al proximo login; se descarta forzar signOut server-side (requiere service role, hoy vacia por D1, y un JWT valido sin acceso a nada por RLS es funcionalmente equivalente a estar fuera). (2) RLS de FILA/TRIGGER en vez de REVOKE/GRANT de columna (patron de la migracion 0019): motivo clave, admin y gestor_operativo son el MISMO rol Postgres (authenticated), un GRANT de columna no puede distinguirlos -- eso solo sirve cuando la columna esta prohibida para TODOS. Trigger BEFORE UPDATE comparando OLD<>NEW para columnas de coste/precio (empresa.coste_km y 5 mas, vehiculo.coste_km/consumo, viaje.precio) consultando `current_gestor_rol()`; policy de fila rol=admin para invitacion INSERT/DELETE y gestor UPDATE (mas regla "no a ti mismo" para evitar autobloqueo del unico admin); trigger generico de bloqueo total para solo_lectura en bucle sobre 18 tablas de negocio. El patron 0019 de GRANT de columna se conserva intacto, solo se amplia con GRANT UPDATE (rol,activo) ON gestor. Hallazgo real verificado en el codigo: hoy NO existe ningun DELETE de viaje/vehiculo/chofer en el dashboard, solo 5 DELETE reales (invitacion/gasto_viaje/parking/documento/mantenimiento) -- la spec gatea esos y deja el RLS cerrando el resto por si se anaden en el futuro. Listo para que 9.29 (sonnet, esfuerzo bajo) pique el codigo sin decisiones abiertas. Nota: en paralelo sigue en curso 9.30 (reorganizacion del sidebar) sobre Sidebar.jsx -- no tocado por este commit.
2026-07-04 | Fase 9: Bloque B2 anadido a ROADMAP.md - roles/permisos + reorganizacion sidebar (feedback del usuario) | (este commit) | HECHO (solo roadmap, sin codigo). El usuario reporto en uso real: (a) hoy CUALQUIER gestor de una empresa puede hacer TODO, sin roles ni forma de expulsar a alguien que se va de la empresa (solo invitar existe); (b) el sidebar es una lista plana poco intuitiva segun crecio el numero de paginas, pidio agrupar por menu/submenu y juntar todo lo de "introducir datos" (vehiculos/choferes/parking/rutas). Decisiones cerradas via preguntas al usuario: 3 roles (admin/dueno, gestor_operativo, solo_lectura) con gestor_operativo SIN acceso a coste/precio/margen/nomina/equipo; expulsar/desactivar gestor (no borrar) en vez de flujo de aprobacion en dos pasos (4-eyes descartado por ahora, anadiria friccion sin tener aun 2+ admins reales). Anadidos 3 items nuevos [LOOP] al Bloque B2 (nuevo, no gateado por Gate A -- es codigo local, no depende de desplegar): 9.28 SPECS-9-ROLES.md (diseno opus esfuerzo medio: migracion 0032 gestor.rol/activo default admin+true para no romper acceso existente, RLS reforzado por rol ademas de por fila -- mismo principio defensa-en-profundidad que la migracion 0019, expulsion instantanea vs auth.users real, gating exhaustivo del dashboard con componente RequireRol reutilizable), 9.29 implementacion segun spec (sonnet esfuerzo bajo, tests de RLS contra BD real no mocks), 9.30 reorganizacion de Sidebar.jsx en grupos colapsables (Hoy/Operacion/Maestros/Documentos/Analisis/Ajustes, sonnet esfuerzo bajo, spec cerrada en el propio item sin necesitar SPECS aparte). Siguiente paso: lanzar 9.28 (opus) para cerrar el diseno antes de que 9.29 pique codigo.
2026-07-04 | Fase 9.6: SPECS-9.md (diseno del hash-chain de ejecucion_evento) | (este commit) | HECHO (subagente opus, esfuerzo medio; solo diseno, sin codigo de produccion todavia -- eso es 9.7). Documento SPECS-9.md (493 lineas, mismo formato mascado que SPECS-7A.md) con: (0) estado verificado del esquema -- CONTRADICCION de drift resuelta: 0001_init.sql creo la columna como tipo_evento pero 0006_gestor_telegram_alertas.sql la RENOMBRO a `tipo` (idempotente); el codigo en ejecucion lo confirma (bot inserta "tipo", dashboard lee .eq("tipo",...)) -> el spec fija `tipo` como nombre real, exactamente el tipo de bug de esquema que este proyecto ya sufrio. (2) diseno: particion de la cadena POR viaje_id (no global -- evita el punto de serializacion sobre "el ultimo hash de toda la tabla"; cada viaje es una cadena independiente, encaja con la generacion secuencial de eventos por chofer, lock acotado por viaje via FOR UPDATE). hash = sha256(hash_prev|id|viaje_id|hito_id|chofer_id|tipo|detalle|ocurrido_en_UTC), EXCLUYE datos jsonb (no determinista + vacia) y registrado_en (no reproducible). sha256 builtin de PG15 (sin pgcrypto). Honesto en el spec: el hash-chain da DETECCION, no PREVENCION frente a quien tiene la service role (evaluado un trigger BEFORE UPDATE/DELETE de bloqueo y descartado por complejidad/poco valor). (3) SQL literal de migracion 0031 con backfill de las filas existentes en orden por particion. (4) script verificar_cadena.py que recorre y recomputa, senala el primer punto roto, alerta y nunca "arregla en silencio". (5) casos de test enumerados (incl. la advertencia honesta de que un trigger de Postgres NO lo ejerce el fake en memoria -> los tests de deteccion de alteracion necesitan BD real o un espejo Python de la logica de hash). Listo para que 9.7 (sonnet, esfuerzo bajo) pique el codigo sin decisiones abiertas. Nota de proceso: la orden previa de 9.2 (runbook de secretos, sonnet) murio por un error de conexion del API a mitad y NO produjo archivo -- se relanza aparte.
2026-07-04 | Fase 9 escrita en ROADMAP.md a partir de hoja de ruta de Fable | (pendiente push) | HECHO a peticion del usuario. Se genero primero un snapshot exacto del proyecto (arquitectura, esquema real, bugs conocidos, decisiones pendientes D1-D6) para pasarselo a Fable como base de una evaluacion externa; Fable devolvio una hoja de ruta de seguridad/solidez/escala en 6 fases (tocar la realidad -> endurecer lo desplegado -> integridad de la evidencia -> GDPR/compliance -> solidez operativa multi-cliente -> escala gated por ingresos) mas un anti-roadmap y un pitch. Revisada y validada como coherente con el codigo real (sin afirmaciones falsas), con dos matices corregidos: el simulacro de restore de backups depende de D2 (DATABASE_URL, sigue vacia) y OSRM nunca se ha probado end-to-end en este entorno (ya anotado antes, Fable lo señala independientemente, coincide). A peticion expresa del usuario, integrada en ROADMAP.md como Fase 9 nueva (no un documento aparte) siguiendo la convencion exacta del repo ([LOOP]/[DECISION], gates por bloque A-F), evitando duplicar las decisiones D1/D2/D4/D6 ya rastreadas en Fase 8 (Bloque A de Fase 9 solo referencia esas mismas, no crea items nuevos). Novedades reales que no estaban en el roadmap: hash-chain criptografico de ejecucion_evento (9.6-9.7, requiere SPECS-9.md previo de opus), hash SHA-256 de PODs (9.8), proyecto Supabase de produccion separado del de desarrollo (9.1, gap real senalado por primera vez), bloque GDPR/DPA/retencion completo (9.11-9.15), colas Postgres para trabajo asincrono cuando haya volumen (9.17-9.18, mismo patron SPECS primero). Protocolo del loop actualizado a peticion del usuario ("modelos mas baratos para picar codigo simple, mejores modelos para decisiones relevantes"): tier mecanico pasa de haiku a sonnet-esfuerzo-bajo, tier arquitectura/seguridad queda en opus-esfuerzo-medio, y se formaliza el patron SPECS-*.md (ya usado en 7A) como convencion general de "orden de trabajo modular" para cualquier item de diseño no trivial, con caracter retroactivo a fases anteriores aun abiertas. Sin cambios de codigo en este commit, solo ROADMAP.md + PROGRESS.md. ci.ps1 verde antes y despues (no se toco codigo).
2026-07-04 | Fase 9.2: Runbook de rotacion de secretos | b46dae4 | HECHO. Creado RUNBOOK-SECRETS.md: tabla-resumen de 9 secretos reales (verificados con grep en db.py, bot.py, run_bot.py, migrate.py, supabase.js, sentry.*.config.js), procedimiento generico sin-caida (generar nuevo -> actualizar en Railway/Vercel -> redeploy -> verificar heartbeat -> revocar viejo), y secciones individuales con numero de linea exacto por secreto. Nota explicita sobre SUPABASE_SERVICE_ROLE_KEY vacia (D1) y DATABASE_URL vacia (D2). Hueco documentado para claves LLM de Fase 7B. Enlaza a DEPLOY.md y ONBOARDING.md en vez de repetir contenido. 9.2 marcado [x] en ROADMAP.md.
2026-07-04 | Fase 9.30: Reorganizacion del sidebar en grupos | 14916f6 | HECHO. Sidebar.jsx reorganizado de lista plana a grupos colapsables (React state + localStorage, sin libreria nueva): Hoy suelto arriba (antes etiquetado "Operacion" en el href raiz, renombrado a "Hoy" para no chocar con el nuevo grupo del mismo nombre); grupo Operacion (Viajes, Mapa, Incidencias); grupo Maestros (Vehiculos, Choferes, Plantillas de ruta, mas Importar -- enlace no contemplado en la spec original, colocado aqui por afinidad de "dar de alta datos"); grupo Documentos y cumplimiento (Documentos); grupo Analisis (Analitica, Nomina, Presupuesto); Ajustes suelto abajo. Parkings NO tiene pagina propia hoy (verificado: no existe ruta parkings en app/, vive como capa dentro de la pagina de mapa) -- no se creo entrada nueva, tal como preveia la orden. El grupo con la ruta activa se auto-expande siempre aunque el usuario lo hubiera contraido antes (verificado manualmente: colapse el grupo Operacion, localStorage guardo false, navegue a la pagina de viajes y el grupo se reabrio solo, sin esconder el enlace activo). aria-expanded en cada boton de grupo + focus:ring-2/focus:border-brand igual que el resto del proyecto (mismo criterio del pase de accesibilidad del item 6.10). Verificado con navegador real (preview_start + preview_screenshot/eval contra el dashboard en dev, sesion real de la empresa demo): grupos colapsan y expanden, resaltado de enlace activo funciona igual que antes, ningun enlace desaparecio. ci.ps1 verde (86 pytest, 180 vitest, next build).
