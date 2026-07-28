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

## Mismo gestor — SESIÓN LARGA CON SU SOFTWARE EN PANTALLA (2026-07-27) 🔴 LA MÁS IMPORTANTE

**Contexto:** ~60 min de conversación grabada (4 notas de voz, transcritas con Whisper local a
`transcripciones/transcripcion.txt`) mientras recorría **Cometweb**, el TMS real que usa a diario
en Carreras, pantalla por pantalla. Es la primera vez que se ve la operación real y el software
incumbente al detalle, no descrita de memoria. **Todo lo de abajo es cita o paráfrasis fiel de
un gestor con la herramienta delante, no hipótesis nuestra.**

**Cambio de estatus del discovery:** hasta hoy `ESTRATEGIA.md` §4.2 decía "todo lo que sabemos
viene de una conversación informal". Ya no: esto es observación directa de la operación + del
competidor real. Sigue siendo la MISMA fuente (sesgo de amistad intacto, ver nota del insight 6),
así que **no sustituye** a la necesidad de un gestor ciego y un dueño — pero la profundidad sube
de "anécdota" a "auditoría de campo".

### Auditoría competitiva: qué es Cometweb y por dónde falla

> "Es muy arcaico de diseño. Parece un Excel." · "Va lento." · "Este programa es perfecto para
> encontrar culpables" (dicho por su jefe) · "Pero también tienes que primar que sea estable y
> que funcione bien antes que sea estético."

**Veredicto honesto:** Cometweb es **muy completo** funcionalmente (planificación, bolsa de
viajes, órdenes de carga, RRHH, documentación, KPIs de gestor) y ahí no se le gana por catálogo
— exactamente lo que `ESTRATEGIA.md` §2 ya advertía sobre Qargo. Donde sí se le gana es en los
**cuatro fallos concretos que el gestor nombró sin que se le preguntara**, que le cuestan horas
y dinero todas las semanas. Ésos son la nueva cuña, y son la columna vertebral de la Fase 23.

**Nota de método:** su última frase sobre estética ("primero estable, luego bonito") es una
validación directa del principio de solidez del proyecto. No hay que ganarle por diseño.

---

### Insight 9 🔴 — El modelo tractora/remolque/carga: "el ordenador se hace mierda"

Es la queja más repetida de toda la sesión (5+ veces, con ejemplos distintos):

> "El tema de cambios hace mucha mierda al ordenador. El programa no está preparado." ·
> "No entiende que la mercancía va en uno o en otro." · "Cuando haces un cambio, no entiende que
> un remolque lo suelto pero el otro me lo llevo." · "El viaje que hace el remolque y el viaje
> que hace el camión no siempre es el mismo."

Casos concretos que rompen el sistema actual **suyo** (y también el nuestro):
1. **Duo/megatruck:** dos remolques + un Dolly (la pieza que va entre medias). Si una de las dos
   descargas no se puede hacer, el sistema marca el CONJUNTO como cargado, cuando la carga
   pendiente está solo en uno de los dos remolques.
2. **Desacoplo parcial:** tractora + remolque1 + remolque2 llegan a Madrid; la tractora se la
   lleva otro chófer, el remolque2 se queda, y el remolque1 lo recoge un tercero.
3. **Remolque suelto:** un remolque **cargado** que se deja aparcado en un punto porque el chófer
   se fue a otra cosa. "Hay más remolques que tractoras." Hay chóferes cuyo trabajo entero es
   cambiar remolques (lanzadera nocturna Madrid–Barcelona: dos chóferes salen, se cruzan a mitad
   de camino, intercambian y vuelven cada uno a su casa).
4. **Cambio no registrado:** "si no lo pones bien, te pasas un mes con un remolque [equivocado en
   el sistema]".

**Por qué importa:** nuestro esquema tiene hoy `viaje.vehiculo_id` + `viaje.remolque_id` — **un
solo remolque, fijo durante todo el viaje**. Es exactamente el modelo que él acaba de describir
como roto. No es una feature que falte: es un **error de modelado del dominio** que heredamos del
competidor sin saberlo. Todo lo que se construya encima (km, nómina, POD, semáforo) hereda el
error.

**Implicación de producto:** rediseñar la unidad de transporte como **composición con historia**
(quién va acoplado a qué y desde cuándo), no como campo fijo del viaje. Es el cimiento de la
Fase 23, Bloque A. Y es **la ventaja competitiva más defendible encontrada hasta ahora**: no se
parchea, hay que diseñarlo bien desde el modelo de datos — igual que la cadena de evidencia.

**Regalo adicional del mismo insight (feature que pidió literalmente):**
> "Tendría que avisarte si hay muchos kilómetros de diferencia entre la tractora y el remolque."
> — "Es un puntazo."

Detección automática de acoplamiento mal registrado comparando el GPS de tractora vs remolque.
Barato de construir (ya tenemos `ubicacion` y `alerta_integridad`), imposible de tener sin el
modelo correcto.

---

### Insight 10 🔴 — El bug de ordenación de hitos que les cuesta un día al mes (y km falsos)

> "Si ahora está descargando mañana a las 11:30 y me pasan un viaje de mañana para cargar de 8 a
> 18, el programa entiende que es antes la carga que la descarga [porque ordena por la primera
> hora de la ventana]. Entonces me van a meter carga a carga y me van a hacer kilómetros en
> vacío... te va a poner 350 kilómetros en vacío."
>
> "Y todos los meses, al final del mes, tenemos que meternos todos a mirar nuestros camiones uno
> por uno por si te pasó."

**Por qué importa:** es un bug de ordenación (ordena por `ventana_inicio` en vez de por la
secuencia real de ejecución) con **tres consecuencias en cascada**: (a) kilómetros en vacío
falsos, (b) que contaminan el coste del viaje y **la nómina del chófer**, (c) y una auditoría
manual mensual de toda la flota, camión por camión, para cazarlo.

Es el caso de estudio perfecto de la tesis del proyecto: un fallo aburrido, invisible desde
fuera, que consume un día de trabajo al mes y corrompe el número que se le paga a una persona.
Y conecta directamente con el hallazgo de la Fase 19 (truncamiento a 1000 filas): **el listón de
calidad tiene que estar en los números que salen de la nómina**, no repartido entre 22 pantallas.

**Implicación de producto:** nuestro `hito.orden` ya es una secuencia explícita (no derivada de
la hora) — **estructuralmente ya lo tenemos bien**. Falta: (1) validar en el momento de crear el
viaje que la secuencia es físicamente posible (no puedes cargar en A a las 8 si descargas en B a
las 11:30 y hay 350 km), y (2) avisar cuando el orden introducido genera un tramo en vacío
sospechoso. Fase 23, Bloque B.

---

### Insight 11 🔴 — "Que el ordenador me diga qué camión va tarde sí o sí" (la feature #1 pedida)

> "El ver si lleva los camiones en hora o no, eso tendría que ir solo. Que tú vengas a las 8 de
> la mañana y el ordenador te diga: este camión va tarde sí o sí. Eso tendría que ir como un
> tiro."

Cometweb ya lo intenta y **ha fracasado de la peor manera posible**:
> "El mismo se supone que lo calcula, pero no es muy fiable." · "Está todo rojo."

Causa que él intuye: compara contra un punto de ruta demasiado grueso ("marcaba en Zaragoza y
todavía es de día"), sin entender el estado real.

**Por qué importa — y esta es la lección de ingeniería más valiosa de toda la sesión:** un
semáforo que se equivoca no es una feature a medias, es **peor que no tenerlo**. Se pone todo
rojo, el gestor deja de mirarlo, y el módulo entero muere aunque luego se arregle. La primera
impresión de fiabilidad es irrecuperable.

**Implicación de producto:** el semáforo es el ítem de mayor valor de la Fase 23 **y el de mayor
riesgo de reputación**. Reglas no negociables de diseño (Bloque B):
- ETA real = OSRM (carretera real) + paradas legales 561/2006 + tiempo de servicio en el hito +
  horas ya conducidas por el chófer. Nunca km/velocidad a secas.
- **Prohibido el falso verde.** Si la posición está obsoleta, OSRM no responde, o falta un dato,
  el estado es "no lo sé" explícito — nunca un color tranquilizador por defecto.
- Esto convierte el despliegue de OSRM en producción (ítem 20.3) de "pendiente cosmético" a
  **dependencia dura**.

**Bonus de UX, pedido literal:** > "Que salga una barrita que se fuera llenando, con un punto
medio, y si se va por atrás muy rojo, y si va muy bien, verde."

---

### Insight 12 🔴 — La lista COMPLETA de lo que se mete a mano en nómina

Hasta hoy sabíamos "noches fuera y km" (insight 2). La lista real es mucho más larga, y la dio
enumerándola él:

| Concepto | Regla real que aplicó | ¿Lo tenemos hoy? |
|---|---|---|
| Noches fuera | Fuera de base a medianoche | ✅ `getInformeNomina` |
| Kilómetros | Por carretera real | ⚠️ Sí, pero cae a Haversine×1,3 en prod (20.3) |
| **Dieta internacional** | Día completo si estuvo fuera de España, aunque sea entre semana | ❌ |
| **Fin de semana** | Medio sábado / sábado entero / medio domingo / domingo entero | ❌ |
| **Regla de fracción** | **> 4,5 h trabajadas → día entero**; menos → medio día. Incluye el descanso | ❌ |
| **Carga/descarga por el chófer** | Si carga o descarga él en persona, es extra | ❌ |
| **ADR (mercancías peligrosas)** | Extra; requiere curso, renovación y chapas en el camión | ❌ |
| **Retén** | Dejar al chófer parado un día para salir con disco limpio al siguiente | ❌ |
| **Palets devueltos** | Se metía a cobrar (ver insight 13) | ❌ |

> "Todo eso lo tienes que meter tú a mano. Todo a mano."

Y sobre la automatización, él mismo dio el camino:
> "Por el GPS se podía ver si ha estado el día entero fuera de España, o más del 80%, y le pagas
> el internacional."

**Por qué importa:** confirma que la cuña de nómina está **construida al ~30%**, no al 80% como
podríamos haber creído. Cada fila de esa tabla es una decisión que hoy toma una persona a mano,
todos los meses, para 30 chóferes. Y todas menos dos son derivables de datos que el sistema ya
captura (GPS + timestamps de hitos).

**Implicación de producto:** Fase 23, Bloque C. Ordenar por (valor × facilidad): internacional y
fin de semana primero (100% derivables del dato que ya tenemos), ADR y retén después (necesitan
un flag manual, pero uno solo por viaje en vez de un cálculo por chófer y mes).

---

### Insight 13 — Los palets: "miles y miles de euros" que nadie controla

> "¿Cuántos euros dijo mi jefe? En palets que habían desaparecido. Miles y miles de euros." ·
> "Si vale un euro cada palet y tienes 33 en cada frigo..." · "Hay sitios que te descargan y los
> palets te los devuelven — es el chófer con la manica, cogerlos uno a uno, 33 palets, y meterlos
> a la paletera."

**Por qué importa:** es una fuga de dinero **cuantificada por el propio dueño**, recurrente, que
nadie está midiendo bien. Y el dato de entrada es trivial: cuántos palets se entregan y cuántos
se devuelven en cada parada. Es el tipo de cosa que un TMS paneuropeo no prioriza (igual que la
nómina española) y que se calcula en una servilleta delante del dueño — **exactamente el perfil
de argumento de venta que `ESTRATEGIA.md` §3.2 identificó como el mejor disponible**.

**Implicación de producto:** contador de palets entregados/devueltos por hito (dos números que el
chófer ya maneja) → informe de "palets pendientes de recuperar por cliente". Fase 23, Bloque C.
Barato, medible en euros, y no lo tiene nadie bien.

---

### Insight 14 🔴 — Fotos de albarán ilegibles: el POD que no se puede cobrar

> "Hay muchos [fallos] en la foto del volante... no se lee ninguna letra de la que me ha pasado.
> Tengo que volver a pedirle al chófer que me la pase." · "Alguno la sube desde la montaña rusa,
> no se ve nada."

Y la solución que pidió, literal:
> "Que te haga como un enfoque y te haga como un videíto, o lo que sea, para que se guarde y se
> haga bien."

Y por qué esto es dinero, no comodidad:
> "Si el cliente ha recibido la mercancía y no te toca los huevos aunque hayas perdido el papel,
> te vale el viaje. **Pero está en su derecho de decirte que no** [y no pagarte]."

> "Anotaciones: 'mercancía llega mojada'. Porque luego llega el fin de mes y te van a decir que
> este dinero te lo descontamos por esta mercancía mojada, y nadie va a saber nada, y lo vas a
> tener que pagar. Sin embargo, si ahora te lo anotan, puedes decirle al chófer: pásame foto."

**Por qué importa:** valida la cadena de evidencia con un **caso económico concreto**, que es
justo lo que faltaba (ver más abajo, insight 16). Y señala que el fallo no está en el diseño de
la cadena sino en **la calidad del dato de entrada**: una foto ilegible rompe la cadena entera,
y se detecta días después, cuando el chófer ya está a 500 km.

**Implicación de producto:** validar la calidad de la foto **en el bot, en el momento**, y pedir
repetición inmediata si está borrosa/oscura/recortada — mientras el chófer sigue en el muelle.
Más anotaciones estructuradas ("mercancía mojada", "faltan N palets", "sello ilegible"). Fase 23,
Bloque D. Es de las cosas más baratas de construir y de las de dolor más diario.

---

### Insight 15 — El gestor está MEDIDO, y el sistema es quien lo mide

> "Hay como una mega Excel de mi jefe donde puedes ver el porcentaje de viajes por gestor: los que
> fallan, los que llegan en hora, **el porcentaje de acierto en estimaciones**, los críticos que
> has fallado."

Y el incentivo perverso que eso genera, contado por él sin filtro:
> "Lo que hace algún gestor es: yo no me la juego, yo no como largo... Porque una cagada es que tú
> digas 'tengo este camión vacío a las 10' y llegues a las 11. Pero muchos dicen 'no, no puedo
> estar vacío hasta las 13' y llegan vacíos a las 10. [Entonces] vas a tener un camión 3 horas
> parado como mínimo."

**Por qué importa:** dos cosas grandes.
1. **Argumento de venta al dueño** (el comprador económico, con quien seguimos con cero
   conversaciones): "mide a tus gestores con datos reales, automáticamente, sin una Excel a mano".
2. **Confirma la tesis de 10.10 / `verdad_observada` con un mecanismo humano concreto:** el gestor
   tiene un incentivo racional a **inflar sus estimaciones** para no fallar el KPI, y eso genera
   camiones parados. Es decir: la brecha entre lo estimado y lo real no es solo ruido — hay una
   presión sistemática que la sesga en una dirección conocida. Medir esa brecha (que es
   exactamente lo que hace `verdad_observada`) tiene valor económico directo.

**Implicación de producto:** el módulo de "acierto de estimaciones" ya tiene comprador (el dueño)
y ya tiene mecanismo (la brecha estimado-vs-real que ya registramos). No construir el panel de
KPIs por gestor todavía — pero saber que existe y que el dueño ya lo quiere.

---

### Insight 16 ✅ — La cadena de evidencia queda VALIDADA (pregunta abierta de ESTRATEGIA §3.3)

`ESTRATEGIA.md` §3.3 dejaba la cadena de evidencia como "solución elegante buscando un problema"
porque `DISCOVERY-GESTOR.md` §3.7 (¿hay disputas reales?) seguía sin contestar. **Contestada, y
por iniciativa suya, sin preguntársela:**

> "Lo lógico sería cambiarlo todo a nivel de que sea **una huella digital. Todo digital. Y que sea
> inalterable**, y decir: vale, ¿esto es válido? Pues ya está. Es una trazabilidad digital."

Contexto que lo hace real:
- Custodia legal: **3 años los albaranes, 10 años las facturas**. "Un armario como éste. Me he
  pegado media hora buscando papeles. Es imposible encontrar algo. Casi imposible."
- **eCMR (carta de porte electrónica):** "yo creo que ya está en marcha el CMR electrónico, pero
  no se usa aún." Es el documento que sella la policía en internacional.
- Y el caso económico del insight 14: papel perdido = el cliente está en su derecho de no pagar.

**Por qué importa:** sube la cadena de evidencia de "opción no validada" a **pilar con demanda
expresada**, y le da un estándar concreto al que engancharse (eCMR) en vez de un formato propio.

**Implicación de producto:** actualizar `ESTRATEGIA.md` §3.3 (hecho). No construir eCMR todavía
—es un estándar con su propia complejidad regulatoria— pero **diseñar la exportación de la cadena
de evidencia pensando en que algún día sea un eCMR**, no en un PDF propietario.

---

### Insight 17 — WhatsApp vs canal propio: hay un argumento LEGAL, no solo de fricción

`ESTRATEGIA.md` §3.1 llamaba a "Telegram vs WhatsApp" la pregunta más cara del proyecto. Sigue sin
contestarse la parte de adopción del chófer, pero apareció un ángulo nuevo que no teníamos:

> "En Marcotran era obligado usar el programa de la empresa, y nos llamaban la atención a los
> gestores porque **WhatsApp no era válido a nivel de ley**. Como no había WhatsApp de empresa,
> todas las pruebas eran con el móvil personal. **Solo valía para defenderte, no para denunciar.**"
>
> "Ahora creo que ya sí. Ahora ya debe serlo."

Y el estado real del canal hoy: hay chat interno en Cometweb, pero
> "usan mucho más WhatsApp, si no, ya te mueres."

**Por qué importa:** invierte parcialmente el marco. No es solo "el chófer no instala apps, hay
que ir a donde ya está" — es que **el canal informal tiene un problema de validez probatoria y
custodia** que una empresa grande ya ha sufrido. Un canal propio con cadena de evidencia no es
solo más cómodo: es admisible. Eso vale para el dueño, no para el chófer.

**Implicación de producto / pendiente:** ⚠️ **NO VALIDADO** — su "ahora creo que ya sí" es una
impresión, no un dato. Antes de usar esto como argumento de venta hay que confirmarlo con una
fuente legal real. Anotado como pendiente, no como hecho.

---

### Insight 18 🔴 — La cadena de tres roles: comercial → planificador → gestor

Ampliado el 2026-07-27 tras repasar los audios: no son dos roles, son **tres**, y cada uno mira
datos distintos. Es un hueco de nuestro modelo (hoy solo tenemos `admin | gestor_operativo |
solo_lectura`).

**1. Comercial — consigue el viaje y fija el contrato.**
> "El comercial da el viaje y dice: vale, tengo que llevarlo a Alcañiz. Lo compra… tiene que
> recogerlo hasta tal hora y devolverlo hasta otra hora."

Fija origen, destino, ventanas, **precio**, y los requisitos: temperatura (fija o variable), tipo
de plataforma y por dónde se carga (lateral / trasera / techo), ADR, riesgo de robo, y si el
cliente es **crítico** o no. Los viajes entran de bolsas públicas, de tratos y del propio
comercial; y **se pueden revender** si no compensan ("los rojos están puestos a la venta, los
morados ya los han vendido"), salvo los que "hay que hacer sí o sí".

**2. Planificador — decide QUIÉN lo hace. Junta viaje + tractora + chófer.**
> "Eso es el planificador. **Yo no reparto los viajes**, yo les puedo dar una idea o sugerir." ·
> "Llega el planificador y te dice: vale, tengo este viaje, **lo hace esta persona**." · "Lo ha
> arrastrado a la tractora que lo va a hacer."

Su vista es la inversa de la del gestor: **no mira "mis camiones", mira toda una delegación**.
> "En vez de filtrar mis camiones como yo, [filtra] todos los camiones que hay en la delegación 1,
> que es Zaragoza. **¿Cuántos camiones hay mañana en Zaragoza?** Y hay todos estos… 34."

Datos con los que decide, en orden de importancia observado:
- **Cuándo y dónde queda libre cada camión** — el número central de su trabajo.
- **Horas de conducción ya gastadas**, que le vetan viajes directamente: *"este tío, con 5, solo
  puede conducir 4 o 5 horas más. O sea que el planificador ya no lo puede coger."*
- **El precio** — ve lo que paga el cliente y decide qué compensa (⚠️ nuestro `gestor_operativo`
  tiene prohibido tocar precio; el planificador **necesita** verlo).
- **Criticidad del cliente**: primero los críticos (Mercadona, Carrefour, Lidl, Alcampo), luego lo
  que más rente. *"Tú vas a descargar a Saica y llegas una semana tarde, no les importa. Pero vas
  a Mercadona que lo necesita ese día y esa hora."*
- **Retorno a casa como restricción dura**: *"el jueves ya tienes que estar viendo que el viaje
  esté conmigo. Igual no ganas tanto, pero no mandas a un gallego [lejos] de casa."*

**3. Gestor — hace que sea VERDAD.**
> "Y te llega a ti y dices: vale, **¿a qué hora puede estar?**" · "**Mi trabajo es que mis 30 tíos
> estén donde pone el ordenador. Que lo que hay aquí sea verdad.**" · "El planificador se mueve
> con lo que hay ahí, que es verdad."

Lo que hace en concreto: fija la hora exacta dentro de la ventana, **estima cuánto durará la
carga/descarga** ("si te hará una hora de descargar o si te hará dos"), manda la orden al chófer,
le añade puntos de paso y notas ("para en este parking, arranca mañana a esta hora, y cuando estés
vacío llámame"), y cada mañana repasa el GPS **camión por camión**. Cuando algo cambia, se lo
devuelve al planificador.

**Y la distinción de modelo más importante que salió de aquí:**
> "**No es lo mismo el viaje del ordenador que el que tú le mandas al chófer.** Es orden de carga
> y orden de trabajo. El chófer recibe la orden de trabajo, **que se la modifico yo**." · "Puede
> ser que un mismo viaje lleve tres órdenes de carga, si hace tres cargas."

Tres objetos, no uno: **viaje comercial** (lo vendido) → **orden(es) de carga** (la ejecución
concreta: tractora, remolque, chófer, delegación a la que se imputa, plataforma, temperatura) →
**orden de trabajo** (lo que llega al Telegram del chófer, ya retocada por el gestor).

**Su opinión sobre el futuro de los roles:**
> "En mi cabeza, el rol de planificador y el de gestor tendría que estar unificado… si tienes una
> herramienta potente, ciertas cosas no necesitas."

Modelos distintos según empresa: en Carreras están separados; en Marcotran el gestor lleva una
zona **y** planifica.

**Por qué importa:** define con precisión quirúrgica qué automatiza Norenty. El gestor no es "el
que planifica" — **es el que mantiene la correspondencia entre el sistema y la realidad**. Si el
sistema se entera solo de lo que pasa (GPS + bot + hitos), ese trabajo desaparece por
construcción, y lo que queda es la planificación, donde sí hay criterio humano. Él lo cuantificó:
> "Me pego dos o tres horas al día solo reflejando bien los viajes en el ordenador… si se hiciera
> solo, se hace en 20 minutos en vez de 3 horas."

**2-3 h/día por gestor es la métrica de ROI más concreta que tenemos** — mejor que "de 30 a 60
camiones", porque se mide en la primera semana de piloto, no en trimestres.

Y es el argumento de apalancamiento afinado, que encaja con `ESTRATEGIA.md` §5.6: no vendemos
"sustituimos al gestor", vendemos "**el sistema ya sabe la verdad, así que tu gestor puede
planificar en vez de teclear**".

**Implicación de producto:** Fase 23, Bloque 23.E (rol `planificador`, su vista de delegación, y
el modelo orden de carga ≠ orden de trabajo). **Ojo:** construir el rol y la vista, **no** el
algoritmo que asigna por él.

---

### Insight 22 🔴 — La desviación cuesta dinero EN LAS DOS DIRECCIONES

Señalado por el usuario como uno de los puntos clave, y con razón: la primera lectura de estos
audios se quedó en "avisar de retrasos", y eso es solo la mitad del problema.

> "**El parado también es un problema.** O que te descarguen y no tengas nada para después." ·
> "Lo óptimo es que sea lo más exacto posible."

El ejemplo que lo deja claro:
> "Una cagada es que digas 'tengo este camión vacío a las 10' y llegues a las 11. **Pero muchos
> dicen 'no puedo estar vacío hasta las 13' y llegan vacíos a las 10: vas a tener un camión 3
> horas parado como mínimo.** Y si luego no hay carga hasta las 5…"

**Por qué importa:** el número que de verdad mueve la operación no es "¿llega tarde?", es
**"¿cuándo y dónde queda libre este camión?"**. Con ese dato encaja el planificador el siguiente
viaje. Un error hacia atrás rompe el compromiso con el cliente; un error hacia adelante deja un
camión parado, que es **capacidad vendida y no cobrada**. Los dos son fallos y los dos se comen
hoy a mano.

**Y se cruza con el insight 15 de una forma incómoda para el cliente:** al gestor se le mide el
"porcentaje de acierto en estimaciones", así que tiene un motivo racional para **inflar** sus
estimaciones y no fallar nunca por retraso. El resultado sistemático de ese sesgo son camiones
parados que nadie contabiliza. Medir la desviación en ambos sentidos **expone una fuga que el KPI
actual premia**. Es argumento de venta al dueño, no al gestor.

**Implicación de producto:** el estado de un viaje no es un semáforo de tres colores. Son cinco:
`adelantado` (parado, capacidad perdida) · `en_plan` · `ajustado` · `retrasado` · `desconocido`.
Y encaja con la barra que él mismo pidió, que **ya era bidireccional**: *"una barrita con un punto
medio, y si se va por atrás muy rojo, y si va muy bien, verde"* — no es una barra de progreso, es
una **barra de desviación**. Fase 23, Bloque 23.D.

---

### Insight 19 ⭐ — La frase de venta, dicha por el usuario amenazado

> "**Esto no te va a quitar el trabajo, te va a cambiar el trabajo.** Igual alguien no vale para
> esto, pero ahora tengo otra manera, o habrá otra cosa. Siempre hay gente... sale una necesidad,
> la cubres con otra, y aparece otra necesidad."

Y sobre el efecto en plantilla, dicho por él, sin que se le vendiera:
> "Un tío, en vez de llevar 30, pues igual puede llevar 60. Esto puede reducir a la mitad de la
> gente." · "Te quedas con gente más válida... un tío que solo vale para gestor, o solo para
> planificador, no te merece tanto la pena. Tienes un trabajador en cuenta de tres y cobra más."

**Por qué importa:** es la respuesta directa al conflicto de incentivos de `ESTRATEGIA.md` §4.4 y
la confirmación de la secuencia de mensaje de §5.6. El usuario amenazado no solo no sabotea:
**verbaliza el argumento de reemplazo mejor que nosotros y lo enmarca en positivo**. La nota de
sesgo del insight 6 sigue aplicando (es amigo, es autoconsciente, no es representativo) — pero
como frase de pitch, viene de un gestor real y eso es exactamente lo que §5.6 pedía guardar para
cuando haya Founding Partners.

---

### Insight 20 🔴 — Él nos dio la forma del piloto (y la objeción que hay que responder)

**La objeción, en sus palabras:**
> "Tú también tienes un problema: no estás vendiendo una cosita. Estás vendiendo que **te juegas
> que te funcione todo, a ti y a la empresa**."

**Su propia solución (dos, y las dos son buenas):**
1. **Entrada por módulo, no reemplazo total:** "Podrías ponerlo un poco aparte y sacar cosas: la
   zona de recursos humanos fuera. La zona administrativa también, más o menos. Tema comercial,
   igual un poco también."
2. **Piloto en paralelo, con criterio de éxito y duración:** "Corres con esto y corres con lo
   otro... vas a trabajar con dos programas y vamos a ver cómo funciona éste. **Un mes, usándolo
   diez personas, con todas las incidencias y todas las cosas**, y ver cómo va."

Y el aviso realista sobre la resistencia:
> "Los que lo estén haciendo dirán 'me gasta los huevos, todo mal'."

**Por qué importa:** resuelve el problema comercial que `ESTRATEGIA.md` §4.3 intentaba resolver
con el "modo esencial" — pero mejor, porque viene del cliente. No hay que reemplazar el TMS: hay
que **entrar por un módulo que hoy es un Excel a mano** (nómina, palets, POD) y correr en paralelo
sin riesgo operativo. El piloto no se juega la empresa del cliente, y por eso se puede firmar.

**Implicación de producto y de GTM:**
- El piloto tiene forma definida: **1 mes · ~10 chóferes · en paralelo · sin apagar Cometweb**.
  Eso es lo que hay que ofrecer, y es lo que la Fase 23 tiene que dejar listo.
- Requisito de entrada que él mismo señaló: **"si ya usan SAP o un programa de contabilidad, al
  final le exportas todo y ya está."** La exportación no es un extra, es condición para que el
  piloto en paralelo sea posible.

---

### Insight 21 — Detalles operativos que corrigen suposiciones nuestras

Cosas menores por separado, pero que juntas cambian varios cálculos:

- **Tiempo de servicio en el hito ≈ 2 h de media** ("hora y media, dos horas"), variable por
  cliente, y **lo estima el gestor a mano** en cada viaje. Nuestro ETA lo ignora hoy.
- **La ruta real ≠ la ruta óptima.** Le meten puntos de paso a propósito: por casa del chófer
  ("si es de Calatayud y va Madrid–Barcelona"), o rodeando zonas con incidencias ("hay incendios
  por la zona de Burgos, te metes por nacional"). "Esos kilómetros los tienen que llevar los
  parámetros." → el cálculo de km debe soportar **waypoints intermedios**, no solo origen-destino.
- **Velocidad de planificación 75 km/h** confirmada (ya la teníamos) — y el planificador **añade
  colchón a propósito**: "yo pongo 1 hora de pausa aunque sean 45 minutos, por lo que pueda pasar".
- **Cálculo inverso:** "si tienes que llegar mañana a las 11:30 y son 739 km, tienes que salir
  cargado como tarde hoy a las 4". Hace **latest-departure-time** a mano en un Excel.
- **Notación de fechas relativa** (elogiada espontáneamente): `.` = hoy, `+1` = mañana, `+2`,
  `-1`… → "eso está de puta madre, es mucho más cómodo". UX gratis que copiar.
- **Doble tripulación:** dos chóferes en el mismo camión, tarjetas personales, ~20 h de jornada
  entre los dos. "Su mismo camión pueden cogerlo 10 personas." → chófer↔vehículo es **N:M en el
  tiempo**, no 1:1.
- **Viajes críticos:** los hay marcados como tales (Carrefour, Alcampo, Lidl, Mercadona) donde
  llegar tarde tiene coste real, frente a otros (Saica) donde "te da exactamente igual". → la
  prioridad no es solo la hora, es **criticidad del cliente**.
- **Los viajes se compran y se venden.** Entran de bolsas públicas, tratos y comercial; se pueden
  revender si no compensan; algunos "hay que hacerlos sí o sí".
- **Consolidación:** "este viaje solo ocupa 14 [huecos], le puedes meter 20 palés más si los
  remontan". → capacidad restante = oportunidad, y hoy la ve un humano.
- **Riesgo de robo:** mercancía sensible (alimentación, electrodomésticos, vinos, tabaco) con
  seguro de carga con **valor máximo** (p. ej. 300.000 €) y albarán valorado. "El tabaco va en
  frigorífico para que no te lo roben."
- **Retorno a casa como restricción dura:** "el jueves ya tienes que estar viendo que el viaje
  esté conmigo. Igual no ganas tanto, pero no mandas a un gallego [lejos] de casa."
- **La rutina de la mañana es un barrido manual:** "lo primero que hago es ver dónde están mis
  camiones. **Uno por uno, por GPS.**" → automatizable al 100%, y es lo primero que ve cada día.
- **El aviso por email del sistema actual no funciona:** "también lo hace el ordenador, pero por
  correo, con un mensaje raro. Es una mierda, no lo miran." → el canal del aviso importa tanto
  como el aviso.
- **Precisión de GPS:** ~20 m, suficiente. Pero **falla por proximidad en hubs**: "en Épila hay
  200 camiones, están todos juntos". → no inferir identidad por cercanía en bases.
- **Tres fuentes de ubicación:** tractora, remolque y móvil del chófer (este último no lo tienen).
  "Si tienes tres fuentes de verdad... tienes la idea de las tres." → valida `verdad_observada`.
- **Checklist al enganchar:** "¿has revisado las ruedas? ¿que no haya cortes en la lona?" — con
  foto si hay algo. → protege de disputas de daños, y ya casi lo tenemos con POD.
- **Trazabilidad de cambios:** "me cambió el horario el de arriba y no me acuerdo — usuario tal,
  hora, ha habido una modificación de horario". Ya tenemos `audit_log`; **falta exponerlo**.

---

### Reglas 561/2006 — correcciones y detalle fino sobre lo que ya teníamos

La sección regulatoria de este documento era correcta, pero incompleta en lo que de verdad se usa:

- **Descanso semanal reducido hay que RECUPERARLO:** "si un fin de semana haces 40, el siguiente
  descanso es 50". La diferencia hasta 45 se compensa. No lo modelábamos.
- **La semana empieza cuando metes un descanso de 24 o 45 h**, no el lunes. "Si abres el lunes a
  las 10:00, puedes trabajar hasta el sábado a las 10:00" (6 días).
- **Bisemanal 90 h** = 56 + 34, ya lo teníamos.
- **Dónde está el umbral real de riesgo:** "se salta esa norma, pero hasta 99 horas. Se hacen más
  de 100 en dos semanas **porque la multa ya pasa de leve a grave**. Ya son multas de miles de
  euros" — y en el extremo, retirada de la tarjeta de transportista. Las leves rondan los 100 €:
  "sale más a cuenta".
- **Fiscalización creciente:** "si te ponen un coche de policía detrás, por Bluetooth te leen el
  tacógrafo".
- **La práctica real en internacional:** 45 h en casa, 24 h fuera, sin recuperar. Lo hacen "todas
  las empresas".

**Implicación de producto — y hay que decirlo con cuidado:** él sugirió un módulo de auditoría
("tú coges una base de datos y solo puedes auditarlo, ver irregularidades"). Es construible y
valioso **en clave preventiva** (avisar antes de cruzar de leve a grave, que es donde está el
dinero). Lo que **no** se debe construir es una herramienta para optimizar el incumplimiento —
ni por ética ni por responsabilidad: dejaría rastro de que el sistema conocía la infracción.
Diseñar siempre como "esto te va a salir grave, párate", nunca como "aquí te cabe una leve".

---

## Pendiente de esta semana

- [ ] Conversación con **dueño** de flota (comprador económico) — foco: qué pagaría, qué le
  preocupa de verdad (coste, compliance, rotación de gestores), cómo mide el ROI hoy.
- [ ] Conversación con **gerente** — foco: cómo entra el trabajo (email/portal/EDI/bolsa de
  carga), qué TMS usan, qué exportan/importan, encaje con la tesis de "capa sobre el TMS".
- [ ] Repetir con un segundo **gestor** sin relación personal con el fundador, para contrastar el
  sesgo de apertura del insight 6.
