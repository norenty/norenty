# Norenty — Discovery de mercado

Aprendizajes de conversaciones reales con el sector (dueños, gerentes, gestores de tráfico).
Fuente de verdad de "qué sabemos de verdad" frente a lo que suponemos. Se amplía cada vez que
hay una conversación nueva; no se borra nada, se marca si algo queda invalidado por una
conversación posterior.

Formato por entrada: **quién / cuándo** → **lo que dijo** → **por qué importa** → **implicación de producto**.

---

## Tesis de fondo (a validar, no todavía confirmada)

- Norenty es una **capa de ejecución sobre el TMS existente**, no un TMS nuevo. Se entra por el
  hueco de ejecución en tiempo real (comunicación, seguimiento, POD, incidencias), no por
  planificación/facturación/EDI donde los TMS incumbentes son fuertes.
- El pitch correcto en v1 es **apalancamiento** ("lleva más camiones"), no **reemplazo**
  ("sustituye al gestor"). El recorte de plantilla es una consecuencia observada, no la promesa
  de venta — el gestor es el usuario diario y puede sabotear una herramienta que lo amenaza
  directamente.
- Comprador económico: dueño/gerente. Usuario diario: gestor de tráfico. Son personas distintas
  con incentivos distintos — cualquier entrevista debe distinguir de quién viene cada insight.

---

## Gestor de tráfico (amigo del fundador) — 2026-07-01

**Contexto:** conversación informal, no una entrevista estructurada. Gestiona ~30 camiones hoy.

### Insight 1: prefiere texto, el chófer prefiere voz
> "Él prefiere mensajes que llamadas, pero entiende que para el conductor sea mejor llamar por
> manos libres."

**Por qué importa:** confirma que el producto correcto no es "chat" ni "telefonía", es una
**capa de traducción de canal**: el chófer habla (manos libres, multilingüe), el gestor recibe
texto estructurado en su idioma. Valida el `[DECISIÓN]` de notas de voz (Whisper) como el 80/20
real del "agente de voz" — no hace falta telefonía completa para capturar la mayor parte del
valor.

**Implicación de producto:** priorizar voice-to-text en el bot (chófer habla, texto llega al
gestor) antes que un agente de voz telefónico completo. Ver `[DECISIÓN]` en ROADMAP.md.

### Insight 2: nóminas — noches fuera y km, a mano, cada mes
> "Tiene que poner info de seguimiento de camioneros de noches fuera y km para las nóminas de
> los chóferes."

**Por qué importa:** es el mejor wedge encontrado hasta ahora porque **Norenty ya tiene el dato
subyacente** (timestamps de hitos por viaje) — no es "digitalizar una tarea manual", es hacerla
desaparecer como subproducto de lo que el sistema ya rastrea. Tarea mensual, tediosa, repetida
por chófer → altísimo ROI percibido, y muy pegajoso una vez que la nómina depende de tus datos.

**Implicación de producto:** candidato fuerte a **Fase 5, primer ítem `[LOOP]`** (sin coste, sin
datos nuevos de terceros). Requiere: (a) concepto de "base" de la empresa para calcular noches
fuera de verdad, (b) km por viaje — vía suma de distancias entre hitos (geocoding ya existe para
el mapa) o campo manual de cuentakilómetros. Ver spec en Fase 5 del ROADMAP.

### Insight 3: viabilidad de un viaje / si comercial se equivocó en precio
> Evalúa si un viaje es viable hacerlo o si el equipo comercial se ha columpiado en precio o
> viabilidad.

**Por qué importa:** es un cálculo de margen (ingreso del viaje vs. coste real: km, combustible,
tiempo, peajes, dietas). Muy valioso pero requiere datos de coste que hoy no capturamos (precio
del viaje, coste de combustible, tarifas por chófer/vehículo).

**Implicación de producto:** **NO construir todavía.** Anotado como candidato v2/v3, después de
tener datos de coste reales. No es loop-safe hoy porque falta el modelo de datos base.

### Insight 4: asigna rutas a los chóferes ("hasta cierto punto")
**Por qué importa:** confirma que hay una capa de dispatch/asignación semi-manual hoy. Es el
North Star ("sistema operativo total") pero el propio fundador ya identificó que no se debe
empezar por ahí — coincide con la tesis de "capa de ejecución primero, dispatch automático
después".

**Implicación de producto:** no construir asignación automática todavía. Seguir con asignación
manual (ya existe en el dashboard) hasta tener volumen de datos para entrenar/reglar un
asignador razonable.

### Insight 5: el número que valida la tesis — "de 30 a 60 camiones"
> Con automatizar tareas muy básicas, él cree que podría pasar de 30 a 60 camiones.

**Por qué importa:** es la validación de apalancamiento (2x) dicha por un gestor real, sin que
se le vendiera nada — mucho más creíble que cualquier proyección interna. Es el número a usar en
ventas ("un gestor pasa de 30 a 60 camiones"), no "de 20 personas a 3".

**Implicación de producto:** ninguna directa de feature, pero es el mensaje de venta validado
para el pitch al dueño/gerente.

### Insight 6: autoconsciencia sobre su propio reemplazo
> Es consciente de que si algo como esto existiera (y existirá) se quedaría casi sin trabajo, o
> sería el que lleva el sistema "por si acaso". Lo bueno: el sistema trabaja 24/365, no tiene
> bajas.

**Por qué importa:** confirma la tensión política gestor-vs-dueño de la tesis de fondo, pero
también da el argumento de venta al dueño: el sistema es mano de obra + memoria institucional
que no coge bajas, no se va de vacaciones, no dimite llevándose el conocimiento operativo.

**Implicación de producto:** ninguna de feature. Mensaje de venta: "24/365, sin bajas, memoria
institucional que no se va con la persona."

**Nota de sesgo:** es un gestor amigo del fundador, no una entrevista ciega — es autoconsciente y
no está a la defensiva, algo que probablemente NO sea representativo de gestores desconocidos.
Con gestores sin esa relación de confianza, esperar más resistencia/desconfianza hacia una
herramienta percibida como amenaza. No generalizar este nivel de apertura.

---

## Pendiente de esta semana

- [ ] Conversación con **dueño** de flota (comprador económico) — foco: qué pagaría, qué le
  preocupa de verdad (coste, compliance, rotación de gestores), cómo mide el ROI hoy.
- [ ] Conversación con **gerente** — foco: cómo entra el trabajo (email/portal/EDI/bolsa de
  carga), qué TMS usan, qué exportan/importan, encaje con la tesis de "capa sobre el TMS".
- [ ] Repetir con un segundo **gestor** sin relación personal con el fundador, para contrastar el
  sesgo de apertura del insight 6.
