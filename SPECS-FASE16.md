# SPECS — Fase 16: escalación proactiva + informe de jefe de tráfico (2026-07-15)

Revisión de código pedida por el usuario tras cerrar Fase 15. Encontró dos huecos reales en la
promesa central del producto ("te avisamos antes de que tú lo sepas"):

1. **`notif_incidencias`/`notif_entregas`/`notif_fuera_ventana`** (Ajustes → Perfil) son botones
   decorativos — `alertar_gestor`/`notificar_gestor_evento` en `bot.py` nunca los leen, mandan a
   TODOS los gestores con `telegram_chat_id` de la empresa, ignorando la preferencia y sin
   filtrar por `activo`.
2. **Ningún aviso proactivo si el chófer ignora el bot**: hoy `fuera_de_ventana` solo se dispara
   si el chófer CONFIRMA la llegada tarde (`bot.py` ~1090-1103). El caso "silencioso y tarde" —
   exactamente el que el producto existe para cazar — solo se ve si el gestor abre el dashboard.

El usuario pidió explícitamente, además, una respuesta a "¿y si la gente ignora las señales?" —
un plan de escalación, no solo el primer aviso.

---

## R2 — Las preferencias de notificación empiezan a respetarse `[sonnet, bajo]`

Arreglar primero por ser la base de R1 (el monitor nuevo debe respetar las mismas reglas desde
el minuto uno, no heredar el bug).

- `alertar_gestor`/`notificar_gestor_evento` en `bot.py`: al listar gestores a notificar, añadir
  `.eq("activo", True)` (hoy no filtra) y seleccionar también `notif_incidencias`/
  `notif_entregas`/`notif_fuera_ventana` según el tipo de evento que dispara la llamada.
  `alertar_gestor` ya recibe un `tipo` (p.ej. `"fuera_de_ventana"`, `"incidencia_cliente"`) —
  mapear tipo → columna de preferencia (`fuera_de_ventana` → `notif_fuera_ventana`, cualquier
  otro tipo de incidencia → `notif_incidencias`). `notificar_gestor_evento` se usa hoy para
  "entrega completada"/"viaje completado"/"asignación" → `notif_entregas` es la más cercana,
  pero se llama con textos genéricos: añadir un parámetro `tipo_notif` con default
  `"entregas"` para no romper las llamadas existentes ni obligar a reclasificar cada sitio.
- Sin fila de gestor o preferencia `NULL` → tratar como el DEFAULT de la columna (`notif_incidencias`/
  `notif_entregas` default `true`, `notif_fuera_ventana` default `false`) — no como "no avisar".
- Tests (Grupo A, `test_bot.py`): gestor con la preferencia desactivada NO recibe el mensaje;
  gestor inactivo NO recibe el mensaje aunque tenga la preferencia activa; gestor con la
  preferencia activa SÍ lo recibe.

## R1 — Escalación proactiva de retraso silencioso `[sonnet, medio]`

Nuevo monitor `backend/db/monitor_retraso_silencioso.py`, mismo patrón EXACTO que
`monitor_heartbeat.py` (script standalone, `psycopg2` + `urllib.request` directo a la Bot API,
sin `python-telegram-bot`, `enviar_fn` inyectable para testear sin red/DB real, cron vía
`.github/workflows/monitores.yml`).

- **Detección**: hitos con `estado != 'completado'`, `ventana_fin < now()`, del viaje
  `estado = 'en_curso'`, que NO tengan ya una `incidencia` con `tipo = 'fuera_de_ventana'` para
  ese `hito_id` (dedup — la tabla `incidencia` ya tiene `hito_id`, se reutiliza como marca de
  "ya alertado", sin tabla nueva para el nivel 1).
- **Nivel 1 (inmediato)**: al detectar un hito nuevo en esa situación, crear la `incidencia`
  (`tipo='fuera_de_ventana'`, `estado='abierta'`, `hito_id`, `viaje_id`, descripción con el
  chófer/hito) y avisar por Telegram a los gestores de la empresa con
  `notif_fuera_ventana = true` Y `activo = true` (mismo criterio de R2).
- **Nivel 2 (escalación, migración nueva)**: `incidencia.escalada_en timestamptz NULL` — en cada
  ejecución del monitor, cualquier `incidencia` `tipo='fuera_de_ventana'` `estado='abierta'` con
  `escalada_en IS NULL` y creada hace más de `UMBRAL_ESCALACION_MIN` (45 min, valor inicial
  razonable, mismo estatus que otros umbrales del proyecto) se escala: avisa a TODOS los
  gestores `activo = true` de la empresa (ignora la preferencia — a los 45 min sin que nadie la
  resuelva, deja de ser "opcional") y marca `escalada_en = now()`. Una incidencia solo escala
  UNA VEZ (no hay nivel 3 automático en v1 — más allá de eso ya es indistinguible de "nadie mira
  el dashboard nunca", un problema de adopción, no de ingeniería).
- **Resolución**: cuando el hito por fin se completa (`cb_llegada` ya existente en `bot.py`), si
  había una `incidencia` `fuera_de_ventana` abierta para ese `hito_id`, marcarla `estado='resuelta'`,
  `resuelta_en=now()` — así el monitor deja de verla en la siguiente pasada. Cambio mínimo en
  `bot.py`, no en el monitor.
- Nuevo job `retraso_silencioso` en `monitores.yml`: cron cada 15 min (mismo que heartbeat, es la
  cadencia que importa aquí — un retraso de más de 15 min sin detectar sería demasiado lento para
  la promesa del producto), mismos secrets que heartbeat (`DATABASE_URL`, `TELEGRAM_BOT_TOKEN`).
- Tests (Grupo A, `test_monitor_retraso_silencioso.py`, mismo patrón `FakeCursor` que
  `test_monitor_heartbeat.py`): detecta hito nuevo fuera de ventana → nivel 1; no duplica alerta
  en la siguiente pasada; escala tras el umbral si sigue abierta; no escala dos veces; respeta
  `notif_fuera_ventana`/`activo` en nivel 1, los ignora en la escalación.

## R3 — Informe exportable para el jefe de tráfico `[sonnet, bajo]`

Pedido explícito del usuario en la sesión anterior ("facilitar la generación de un informe que
el jefe de tráfico pueda analizar y enviar"), pausado hasta ahora.

- `getInformeEjecutivo(rango)` en `data.js`: compone (sin queries de negocio nuevas)
  `getMetricasPuntualidad`, `getMetricasRentabilidad`, `getMetricasFlota`,
  `getComparativaMensual` — ya existen todas — en un único objeto plano pensado para imprimir/
  exportar, no para pintar cards interactivas.
- Página nueva `/analitica/informe` (o botón "Generar informe" en la vista Puntualidad/
  Rentabilidad que abre una vista imprimible): cabecera con nombre de empresa + periodo, bloques
  de KPIs clave (puntualidad, margen, flota, comparativa vs. mes anterior), mismo patrón
  `print:` que `/nomina` y el dossier de F13.2 — `window.print()` a PDF, sin librería nueva.
  Admin-only (`RequireRol`), coherente con que es una herramienta de jefe de tráfico, no del
  día a día del gestor.
- Tests (Grupo A): `getInformeEjecutivo` no lanza y compone la forma esperada con datos fixture.

---

**Orden de ejecución**: R2 primero (arregla la base que R1 necesita) → R1 (el hueco central,
detección + escalación) → R3 (independiente, se puede hacer en paralelo si hace falta pero se
deja al final por ser la de menor urgencia de las tres).
