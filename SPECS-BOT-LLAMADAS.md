# SPECS — Bot de llamadas (IVR de voz para el chófer, distinto del agente 7B.3/11.7)

Diseño técnico, 2026-07-14. **NO es orden de trabajo para el loop** — cae en los "STOPS duros" del
protocolo (features que gastan dinero por uso + infra nueva de telefonía). Se escribe ahora, gratis,
para que el día que haya presupuesto/decisión sea picar código, no diseñar. Nadie debe ejecutar esto
sin: (a) cuenta de proveedor de telefonía creada por el usuario, (b) presupuesto de coste-por-minuto
aprobado, (c) 11.5 (consentimiento/RGPD de voz) resuelto.

## Qué es esto y qué NO es

Es una **interfaz de voz alternativa al bot de Telegram**, para el chófer que llama a un número de
teléfono en vez de escribir. Mismo backend, mismos datos, mismas acciones (confirmar llegada,
reportar incidencia, pedir parking/ETA) — el canal cambia, la lógica de negocio no se duplica.

**NO es** el `7B.3`/`11.7` "agente telefónico" (ese ayuda al GESTOR en llamadas con CLIENTES,
modo asistir/copiloto). Son dos proyectos distintos que comparten infraestructura de telefonía
pero no lógica de conversación. Este documento cubre solo el canal chófer→sistema.

**Caso de uso real que resuelve** (a validar en discovery, `DISCOVERY-GESTOR.md` §3.4): chóferes
sin smartphone, sin datos móviles en el extranjero, o que simplemente prefieren llamar. Complementa
Telegram, no lo sustituye — un chófer usa el canal que tenga a mano.

## Arquitectura

```
Chófer marca el número único de Norenty
        │
        ▼
Proveedor de telefonía (Twilio Programmable Voice u homólogo)
  — UN número, gestiona la concurrencia de llamadas simultáneas por su cuenta,
    cada llamada es una sesión independiente (Call SID)
        │  webhook HTTP por evento de la llamada
        ▼
FastAPI (backend/app/, ya existe — nuevo router `telefonia.py`)
  — async por diseño: N llamadas concurrentes = N peticiones HTTP concurrentes,
    nada nuevo que construir para la concurrencia en sí
        │
        ├─ identificar chófer: normalizar el Caller ID (E.164) y
        │  SELECT * FROM chofer WHERE telefono = :caller_id
        │  (columna `chofer.telefono` YA EXISTE, sin migración)
        │
        ├─ si no hay match: flujo de fallback (pedir código por voz/DTMF,
        │  igual que /start CODIGO en Telegram)
        │
        ├─ resolver contexto: empresa_id, viaje en_curso, hito pendiente,
        │  gestor asignado — MISMAS queries que ya usa el bot de Telegram,
        │  cero lógica de negocio nueva
        │
        └─ STT (voz→texto) + intención + TTS (texto→voz) en tiempo real
           — la única pieza realmente nueva y cara
```

## Identificación del chófer (el mecanismo central)

Mismo patrón que `get_chofer_by_chat(chat_id)` en `bot.py`, con el teléfono en vez del chat_id:

```python
def get_chofer_by_telefono(telefono_e164: str):
    r = ejecutar_con_reintentos(
        lambda: supabase.table("chofer").select("id, nombre, empresa_id, idioma")
            .eq("telefono", telefono_e164).execute(),
        contexto={"accion": "get_chofer_by_telefono"},
    )
    return r.data[0] if r.data else None
```

Requisito de datos previo: `chofer.telefono` tiene que estar poblado y en formato consistente
(E.164, `+34...`) — hoy es `text` libre, sin normalizar. Antes de construir esto habría que:
1. Añadir validación/normalización al guardar el teléfono (formulario de alta de chófer +
   importador masivo, IMP.2).
2. Backfill de los teléfonos ya existentes que no estén en formato E.164.

## Multi-tenant: confirmado, mismo patrón que Telegram

Un único número de teléfono, un único servicio — el aislamiento por empresa lo da la BD (RLS +
`empresa_id` resuelto vía el chófer identificado), exactamente igual que el bot de Telegram
(`TOKEN` único, `get_chofer_by_chat` resuelve el resto). **No hace falta un número por gestor ni
por empresa.**

## Costes (cifras ya estimadas en `COSTES-IA.md`, sin repetir la investigación)

$0,15-0,30/min todo incluido (telefonía + STT tiempo real + LLM + TTS). Con 60 chóferes llamando
un par de veces/semana ≈ 180 min/mes ≈ **$27-54/mes**. No es la parte cara del proyecto — la parte
cara es la complejidad de construirlo bien (latencia real-time, cortes de línea, silencios,
fallback si algo falla a media llamada) — igual conclusión que ya estaba en `COSTES-IA.md`.

## Fases de construcción (cuando se desbloquee)

1. **Normalización de `chofer.telefono`** — loop-safe, sin coste, se podría hacer YA si se
   decide que este proyecto se retoma (no depende del resto).
2. **Identificación + fallback por código** (sin voz todavía) — webhook que reconoce el número y
   contesta con DTMF/menú simple ("pulsa 1 para confirmar llegada"). Bajo coste, sin STT/TTS.
3. **Voz completa** (STT+LLM+TTS en tiempo real) — la fase cara, con presupuesto aprobado.

Esta fase 1 y parte de la 2 podrían ser loop-safe de verdad (sin coste por uso) si se decide
retomarlo — el salto a STOP duro es específicamente la fase 3.

## Riesgos a decidir antes de construir (no técnicos, de producto)

- **Consentimiento de voz** (11.5) — grabar/transcribir es dato personal, hace falta base legal.
- **Qué pasa si el chófer llama y no hay cobertura de red del backend** — fallback a un mensaje
  de voz grabado + notificación al gestor, no dejar la llamada muerta.
- **Idioma**: el chófer identificado ya trae `idioma` en la BD — el saludo/menú debe salir en su
  idioma desde el primer segundo, reutilizando `TEXTOS`/`t()` del bot de Telegram (ya tiene los 8
  idiomas completos) en vez de traducir de nuevo.
