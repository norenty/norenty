# SPECS — Captura de conocimiento por voz + bot de llamadas (escalera A→B→C)

Diseño cerrado en la sesión estratégica del **2026-07-19** (reemplaza el diseño anterior, que
apuntaba al caso equivocado: IVR para chófer sin smartphone). **NO es orden de trabajo para el loop
todavía** — el build arranca tras el discovery del gestor (mañana lunes) + deploy + 11.5. Se escribe
ahora para que construir sea turnkey y correcto, no para adivinar la taxonomía antes de validarla.

## El problema y el reencuadre (por qué esto es una clave del proyecto)

El valor máximo del producto está en las **excepciones**: camión roto a 400 km con entrega a las
8:00, cliente cabreado, hora límite. Hoy se resuelven por teléfono, con la experiencia del jefe de
tráfico, y **el sistema es ciego justo en el momento de máximo valor**.

**Reencuadre central:** el dato del moat NO es el problema del chófer ("me he averiado en la A-2" =
situación, poco valiosa). Es la **DECISIÓN del jefe de tráfico** (a quién reasigna, a qué cliente
llama, qué sacrifica y por qué). Ese triple `situación → decisión → resultado` no está escrito en
ningún sitio — vive en su cabeza y muere en cada llamada. Capturarlo estructurado es:
1. Memoria útil desde el día 1 (dossier, patrón "este chófer/ruta siempre falla aquí").
2. El corpus propietario que nadie más tiene (ni Samsara ni un TMS) — el combustible del "100%
   autónomo" a largo plazo (7B.7). No puedes automatizar el criterio del experto sin miles de sus
   decisiones con su desenlace.

**Dónde apuntar la captura:** al humano que DECIDE (jefe de tráfico), no solo al chófer que reporta.

## Principio de diseño: no forzar, ser el camino de menor resistencia

No puedes forzar a un jefe en crisis a usar la herramienta — si añades fricción en el peor momento,
te esquiva por teléfono y pierdes las dos cosas (dato Y usuario). Se gana por:
1. **Ser EL canal, no un canal paralelo** (la captura ES el canal, no un "regístralo también").
2. **Detección → pregunta** (el sistema cazó el anómalo y pregunta; nadie tuvo que acordarse).
3. **Devolver valor** (dossier, patrón, sugerencia) para que usarlo gane a no usarlo.
4. **Coste de captura ≤ que la llamada que reemplaza** (nota de voz de 15s, un toque).

## La escalera de captura por severidad

| Nivel | Situación | Captura | Tecnología | Estado |
|---|---|---|---|---|
| 0 | Estado normal | Botones/texto estructurado | Ya existe | Hecho |
| 1 | Incidencia menor | Nota de voz → transcribe → **clasifica** complejidad/tipo/urgencia → ancla a `contexto` (11.2) | Whisper self-host + 1 LLM. Sin telefonía | **Primero a construir** (11.3 + 7B.2) |
| 2 | Significativa | El sistema **detecta** (R1 ya lo hace) y **contacta primero** con contexto + opciones | Lo ya construido + el clasificador | Reusa R1 |
| 3 | Urgencia máxima | Voz — ver opciones A/B abajo | Ver abajo | Gated |

## Nivel 1 — el corazón, y lo primero (detalle de implementación)

Extiende `handle_photo` (bot.py) con un `handle_voice` gemelo: el chófer/gestor manda una nota de
voz de Telegram (Bot API la entrega como `message.voice`, mismo patrón que la foto). Flujo:
1. Descargar el audio (igual que la foto), hash SHA-256 antes de subir (misma tesis de evidencia).
2. Transcribir con Whisper self-host (idioma del `chofer.idioma`/`gestor` ya en BD).
3. Una llamada LLM que devuelve JSON acotado: `{tipo, urgencia (0-3), resumen, entidad_sugerida,
   escalacion_sugerida}` — la clasificación, NO una mutación libre.
4. Anclar como `contexto` (canal `llamada_transcrita`, ya reservado en el CHECK de 0042 sin
   re-migrar) a la entidad correcta (viaje/chófer/cliente).
5. Si `urgencia` alta → dispara el Nivel 2 (avisar al gestor con el resumen ya clasificado).

**Taxonomía de `tipo` y umbrales de `urgencia`: PENDIENTE del discovery** (§3.4c). No inventarla.

## Nivel 3 — las dos opciones honestas (recomendación: A primero)

**Opción A — capturar la RESOLUCIÓN justo después (no la llamada viva).** La llamada ocurre como
sea (teléfono normal). En cuanto el sistema detecta que se resolvió, pregunta al jefe "¿cómo lo has
hecho? [nota de voz 15s]". Pierde la conversación en bruto pero captura decisión + resultado (el
dato del moat). Coste ≈0, legalmente limpio (auto-reportado, sin grabar terceros), esquiva el "se lo
saltan" (no le cambias cómo llama, solo pides 15s después).

**Opción B — ser dueño del puente telefónico.** Un número (Twilio/homólogo) que puentea
chófer↔gestor; con consentimiento capturas la conversación. Captura más, pero: per-minuto,
subprocesador externo (DPA + residencia UE), aviso de consentimiento en cada llamada, y la fricción
grande de convencerles de usar TU número. Aquí muerde el riesgo de que se lo salten.

**Recomendación:** A primero. B solo si los datos de A demuestran que la conversación en bruto tiene
más señal que el resumen tras la resolución (dudoso: dos personas negociando es ruido; "qué decidí y
por qué" es señal). **La "escucha pasiva" de una llamada humano-a-humano NO existe técnicamente** —
o eres parte de la llamada, o dueño del puente, o no la oyes.

## Costura agnóstica de proveedor (cuando se llegue a 3-B)

Un adaptador fino de "captura de voz" (mismo patrón que la abstracción de canal 4.6), no casarse con
Vapi/Retell/Twilio. Se elige por **residencia UE + coste + latencia** cuando toque. Nota: esto
invierte la decisión de Whisper-self-host-€0 (real-time es per-minuto y externo), así que async
(Nivel 1) se queda en Whisper self-host; solo el Nivel 3-B necesita proveedor externo.

## La parte de ingeniería REAL (no es la voz)

Retell/Vapi ya resuelven voz, latencia, turnos, multilenguaje, function-calling. Lo difícil es:
1. **La API de acciones segura y ACOTADA** que el agente de voz puede tocar — un conjunto mínimo y
   cerrado (buscar viaje por chófer, registrar incidencia, escalar) que NO pueda exceder. Nunca un
   LLM con función de escritura libre. Misma disciplina "acción acotada, nunca mutación libre" de
   todo el proyecto.
2. **Identidad en una llamada** — caller-ID contra `chofer.telefono` (columna ya existe) basta para
   REPORTAR (bajo riesgo); insuficiente para MUTAR estado sensible; se rompe con SIM extranjera /
   roaming (justo el caso multilenguaje que el gestor marcó como clave).

## Requisitos de datos previos (loop-safe, sin coste, se pueden hacer ya)

- **Normalización de `chofer.telefono` a E.164** (`+34...`) — hoy es `text` libre. Validar al guardar
  (alta de chófer + importador IMP.2) + backfill. Necesario para la identificación por caller-ID (3).
- `get_chofer_by_telefono(telefono_e164)` — gemelo de `get_chofer_by_chat`, ya esbozado.

## Riesgos de producto a decidir antes de construir

- **11.5 consentimiento de voz** — transcribir/grabar es dato personal, hace falta base legal.
- **Taxonomía de incidencia/urgencia** — sale del discovery, no se inventa.
- **Fallback si el chófer llama y el backend no responde** — mensaje grabado + aviso al gestor, no
  dejar la llamada muerta.
- **Idioma desde el primer segundo** — reusar `TEXTOS`/`t()` (8 idiomas ya completos), no re-traducir.

## Validado en discovery (2026-07-19)

El gestor (amigo del usuario, experto del sector) confirmó: mensajes/postjes normales prefiere por
texto, pero **tener llamadas, incluso multilingües, es muy clave**. Su empresa actual no trabaja
tanto con chóferes de otros países, pero puede haberlos → el multilenguaje importa. Esto sube la
prioridad del Nivel 3 y confirma que no es construir a ciegas.

## Las 3 preguntas que cierran las incógnitas (para el discovery, §3.4c)

1. ¿El jefe contestaría 15s de "¿cómo lo resolviste?" en caliente, o ni eso?
2. ¿Cuántas de estas urgencias hay al día — 2 o 20? (dimensiona coste y prioridad)
3. ¿Qué acciones querría que el bot pudiera hacer solo en una llamada, y cuáles jamás? (define la
   API de acciones acotada del punto de ingeniería 1)
