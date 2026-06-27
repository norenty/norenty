Lexenty — Contexto del proyecto
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
