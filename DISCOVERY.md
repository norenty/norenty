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

## Mismo gestor — adelanto previo a la entrevista formal del 12.3 (2026-07-14)

Reunión formal pospuesta a la mañana del sábado (2026-07-18 aprox.), pero con dos datos ya
adelantados por él y una novedad importante sobre el formato de la reunión.

### Insight 7: su software actual es malo y está pendiente de cambio
> Dice que su software actual "es bastante malo" y que en su empresa tienen pendiente cambiarlo.

**Por qué importa:** confirma que hay una ventana de decisión de compra ABIERTA de verdad, no
hipotética — no es "convencerle de dejar algo que funciona bien", es "llegar cuando ya está
buscando alternativa". Máxima prioridad de discovery del sábado: preguntar qué usa hoy, qué odia
de él en concreto, y qué le haría decidirse por otra cosa — ver `DISCOVERY-GESTOR.md` §2.3/§4.7.

**Novedad de formato:** la reunión del sábado no es solo conversación — van a poder ver su
software/datos/operativa reales en pantalla. Es la primera oportunidad real de auditoría
competitiva directa (qué hace bien el sistema que usa hoy, qué le falta) en vez de discovery solo
verbal.

### Insight 8: ya intentan minimizar cargas vacías activamente
> Dice que intentan minimizar los trayectos que vuelven sin carga, pero no está claro si tiene un
> porcentaje o dato concreto de cuánto consiguen.

**Por qué importa:** valida que existe conciencia del problema (y por tanto del valor económico
de resolverlo mejor) — relevante para evaluar a medio/largo plazo si conectar oferta/demanda entre
flotas (ítem `7B.9`, moonshot marketplace) tiene sentido para el perfil de este tipo de gestor, o
si ya lo resuelven razonablemente bien por otras vías (bolsa de carga, cartera fija) y el problema
real está en otro sitio.

**Implicación de producto:** ninguna todavía — pendiente de la cifra/mecanismo real el sábado
(`DISCOVERY-GESTOR.md` §3.7).

---

## Investigación regulatoria y de fuentes de datos — 2026-07-01

Origen: el gestor cuenta que planifican las rutas a **75 km/h de media**, añadiendo las **paradas
legales cada X horas** y usando **su mapa de parkings seguros**. Se investiga qué dice la ley y si
las fuentes de datos existen o hay que construirlas. Principio acordado con el usuario: para lo
difícil (routing, mapas, tráfico) **recurrir a terceros**, no reimplementar.

### Tiempos de conducción y descanso — Reglamento (CE) 561/2006
Fuente: EUR-Lex + Ministerio de Transportes (España). Límites a modelar:
- **Pausa:** tras 4,5 h de conducción → 45 min ininterrumpidos (o fraccionada 15 + 30).
- **Conducción diaria:** 9 h (ampliable a 10 h, máx. 2 veces/semana).
- **Conducción semanal:** 56 h. **Bisemanal:** 90 h en 2 semanas consecutivas.
- **Descanso diario:** 11 h (reducible a 9 h, máx. 3 veces entre descansos semanales).
- **Descanso semanal:** 45 h (reducible a 24 h).

**Implicación de producto:** el ETA de una ruta larga NO es km/velocidad — hay que insertar las
paradas obligatorias. Es lo que el gestor hace a mano → ítem 5.3 en ROADMAP (construible sobre la
DURACIÓN que ya da OSRM). La pausa de 45 min/4,5 h y el descanso diario de 11 h son los que más
mueven el ETA.

### Velocidad de planificación (75 km/h)
No es ley, es heurístico. Contexto: camiones >3,5 t con limitador obligatorio a 90 km/h (Directiva
92/6/CEE), 80 en convencional. 75 de media absorbe urbano/tráfico/repechos. **Implicación:**
parámetro configurable por empresa, default 75 (`VELOCIDAD_PLANIFICACION_KMH`).

### Parkings seguros — ¿existe la fuente? SÍ, y es gratis
- **Oficial y abierta:** European Access Point for Truck Parking Data — formato DATEX II, dataset
  "ETPA" en data.europa.eu, base regulatoria Reglamento delegado 885/2013. Cubre sobre todo
  corredores TEN-T; la calidad/cobertura la mantiene cada Estado miembro (no garantiza todo España).
- **Certificación SSTPA:** 4 niveles Bronze/Silver/Gold/Platinum (estándar de "parking seguro").
- **Comercial:** Truck Parking Europe y similares (más cobertura + app).

**Implicación de producto:** NO tiene que aportarlo la empresa (hay dataset público), PERO la empresa
del gestor ya tiene su mapa curado propio (activo). Diseño: soportar ambos — importar la lista propia
+ enriquecer con el dataset EU. → ítem 5.4 en ROADMAP (`[DECISIÓN]`: parsear DATEX II tiene coste;
la parte "importar lista propia" sería loop-safe por separado).

### Routing de terceros
- **OSRM** (ya en uso): gratis, self-host, da distancia + duración. Suficiente para km (5.2) y
  ETA-con-paradas (5.3).
- **HERE:** estándar del sector, *truck-aware* (altura/peso/ADR/restricciones + tráfico). De pago;
  salto de calidad cuando haya presupuesto.
- **Google Directions / Waze:** buenos con tráfico pero NO truck-aware.
- **Regla:** la lógica de negocio (paradas legales, margen, noches fuera) se queda como capa propia
  por encima del proveedor, para cambiar de proveedor sin reescribirla.

---

## Pendiente de esta semana

- [ ] Conversación con **dueño** de flota (comprador económico) — foco: qué pagaría, qué le
  preocupa de verdad (coste, compliance, rotación de gestores), cómo mide el ROI hoy.
- [ ] Conversación con **gerente** — foco: cómo entra el trabajo (email/portal/EDI/bolsa de
  carga), qué TMS usan, qué exportan/importan, encaje con la tesis de "capa sobre el TMS".
- [ ] Repetir con un segundo **gestor** sin relación personal con el fundador, para contrastar el
  sesgo de apertura del insight 6.
