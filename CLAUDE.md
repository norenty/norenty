Norenty — Contexto del proyecto
Qué construimos
Una capa de "aseguramiento de ejecución" para empresas de transporte de flota propia. Un agente que habla con el chófer en su idioma por Telegram (y por voz), confirma cada hito del viaje, EXIGE foto del albarán (POD) antes de cerrar, lo registra todo, y avisa al gestor si algo se sale del plan. NO planifica rutas. El chófer es el sensor.
Alcance de V1 (y lo que NO entra)
SÍ: confirmación de hitos (texto + voz), multilingüe, validación del albarán con visión, log de ejecución, dashboard del gestor (Kanban + mapa + alertas).

NO (NO lo construyas, es para más adelante): planificación/optimización de rutas, asignación de viajes, cotización, nóminas/variables, coaching/scoring. Si te pillas añadiendo algo de esta lista, párate y avísame.
Stack

Backend: Python + FastAPI.
Base de datos + almacenamiento + auth: Supabase (Postgres).
Dashboard: Next.js con mapa Leaflet/OpenStreetMap.
Bot: Telegram Bot API; LLM con visión para el albarán; voz con Whisper (STT) + TTS.
Estructura: monorepo con /backend y /dashboard.

Modelo de datos (tablas)
empresa, gestor, chofer (idioma, chat_id), viaje, hito (lat/lon, ventanas), ejecucion_evento (lo que pasó de verdad), pod (foto + validación), incidencia. El activo del producto es el log de ejecución; trátalo con cuidado.
Cómo trabajamos

Milestone a milestone. No construyas todo de golpe.
Antes de una tarea grande, dame el PLAN y espera mi OK. No ejecutes sin aprobación.
Explica en español, claro y sencillo; no soy experto en fontanería técnica.
Commits pequeños y descriptivos.

## Regla de seguridad: NUNCA leer archivos de secretos directamente

**Prohibido usar `Read`, `cat`, `Get-Content` ni ninguna herramienta que vuelque el contenido
completo de `.env`, `dashboard/.env.local`, o `~/.norenty-secrets/.env` en la conversación.**
Desde 2026-07-08, los secretos REALES (`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
`TELEGRAM_BOT_TOKEN`, etc.) viven en `~/.norenty-secrets/.env`, **fuera del repo** — ver
`RUNBOOK-SECRETS.md §0`. El `.env` de la raíz del repo ya NO debería tener valores reales, pero
la regla de no leerlo se mantiene igual (defensa en profundidad; y por si en algún momento vuelve
a tener algo sensible). Verlos entra en el historial de la conversación y cuenta como una
exposición real, aunque sea "solo para comprobar algo" (ya pasó dos veces en este proyecto antes
de mover los secretos fuera del repo).

**Cómo comprobar cosas de `.env` sin exponerlo:**
- ¿Existe una variable / no está vacía? → un script (Python/PowerShell) que compruebe
  `bool(valor)` o `len(valor)` y solo imprima el booleano/longitud, nunca el valor.
- ¿Una variable coincide con un valor conocido? → comparar en el script y solo imprimir el
  resultado de la comparación (`True`/`False`), como se hizo para verificar `DEMO_EMAIL`.
- ¿Hay que EDITAR una variable? → usar `Edit` con un `old_string` que la localice sin necesidad
  de haber leído el archivo antes con `Read` (p. ej. buscar por el nombre de la variable con
  `Grep` en modo `files_with_matches`, nunca `content`, y editar a ciegas por el nombre de la
  clave). Si de verdad hace falta ver la estructura del archivo, pedir al usuario que lo
  confirme o que pegue solo los NOMBRES de las variables, nunca los valores.
- Si accidentalmente se expone un secreto real en la conversación: decírselo al usuario
  INMEDIATAMENTE y recomendar rotarlo, sin esperar a que pregunte (ver `RUNBOOK-SECRETS.md`).
