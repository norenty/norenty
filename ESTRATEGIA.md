# Norenty — Análisis estratégico de mercado, competencia y GTM

Análisis del **2026-07-26**. Complementa `MENTORIA-ESTRATEGICA.md` (que aplicó marcos de
fundadores al *proceso* de construcción) atacando lo que aquel no cubrió: **tamaño real del
mercado, competencia financiada, posicionamiento y plan de venta**.

Lentes aplicadas: Thiel (monopolio de nicho), Andreessen (el mercado manda), Bezos (working
backwards), Musk (primeros principios / borrar la pieza), Horowitz (wartime), Varsavsky
(realidad del mercado europeo/español).

**Regla de este documento:** cada cifra viene con fuente. Donde no hay dato, se dice "no
validado" en vez de inventarlo.

---

## 0.5 North Star (2026-07-28) — "el Bloomberg de la logística", y cómo se llega sin morir en el camino

Confirmado con el usuario: la ambición final NO es un módulo de nómina ni una capa de ejecución
modesta — es ser **el líder absoluto de la industria**. En sus palabras: un algoritmo total que
reciba todos los inputs (rutas, dónde vive cada chófer, cumplimiento del schedule, incidentes de
tráfico en tiempo real — "si hay un incendio en Burdeos y cortan la carretera, recircular las
rutas solo") y GPS real de **tractora + remolque + persona**, de modo que el sistema decida solo.

**Por qué esto es correcto como North Star y peligroso como plan de esta semana.** Es
literalmente la definición de un TMS completo con motor de optimización — el terreno exacto de
Qargo (€46M, 400 clientes) y de HERE/Trimble (20 años de ventaja en routing *truck-aware*).
Section 2 de este mismo documento ya lo advirtió: *"Norenty NO puede ganar como un TMS más
completo — en funcionalidades, siempre pierde."* Intentar construir el algoritmo total ahora, con
**cero clientes reales** (§4.1, riesgo #1 del proyecto), es apostar meses de trabajo sobre
supuestos que nadie ha validado — el patrón exacto que `MENTORIA-ESTRATEGICA.md` diagnosticó como
la amenaza real del proyecto, no la competencia ni la tecnología.

**La resolución, no un "no":** el North Star se escribe y se guarda, no se folcloriza ni se
descarta. Pero se persigue **por capas, cada una validada con un cliente real antes de escalarla**
— no de golpe:

1. **Capa 0 (Fase 23, en curso):** el cimiento de datos correcto — unidad de transporte real
   (chófer/tractora/remolque como líneas de tiempo independientes, no un campo), posición
   derivada sin telemetría propia, nómina completa, POD fiable, semáforo honesto. Esto no es "la
   versión pequeña" del North Star: es su cimiento literal. Un algoritmo de rutas construido sobre
   el modelo viejo (remolque fijo por viaje) heredaría el mismo error que tiene Cometweb hoy.
2. **Capa 1 (tras el primer piloto real, §6.5):** con datos reales de viajes ejecutados, hay algo
   que optimizar y algo con qué medir si un algoritmo de rutas mejora de verdad la operación de
   ESE cliente. Antes de eso, "optimizar rutas" es optimizar contra una simulación.
3. **Capa 2 (con 2-3 Founding Partners, gate de §5.6):** telemetría de remolque real (hoy bloqueada
   en ROADMAP 23.0.3 por falta de proveedor y de cliente que la pague), reglas de replanificación
   por incidente (tráfico, incendios, cortes) sobre datos de tráfico de terceros (HERE tiene esto
   *truck-aware*, ver §3, "para lo difícil recurrir a terceros, no reimplementar" — un motor de
   rutas propio compitiendo con HERE no es el foso, integrarlo bien sí lo es), y "dónde vive el
   chófer" como restricción dura de asignación (ya hay una semilla real de esto en
   `DISCOVERY.md` insight 21 — el planificador ya evita mandar a un chófer lejos de casa un jueves).
4. **Capa 3 (escala, §8):** aquí es donde "Bloomberg de la logística" deja de ser aspiracional.

**Ampliación del North Star (2026-07-30), pedida explícitamente por el usuario ("una locura,
que reciba todos los inputs y dé una solución top"):** se registran aquí, NO se construyen.
Mismo principio de capas de arriba — cada una necesita el cliente real que valide que el dato
importa antes de tocar código:

- **Clima en tiempo real** cruzado con la ruta (nieve/hielo/viento que retrasa un tramo) —
  mismo patrón que el aviso de tráfico de Capa 2 (recurrir a un proveedor externo tipo
  AEMET/OpenWeather, no reimplementar meteorología).
- **Depósito de gasoil por camión + red de gasolineras + acuerdos de precio con el proveedor**
  — para sugerir dónde repostar más barato en ruta. Requiere primero saber si hay margen real
  ahí (¿cuánto ahorra un gestor real hoy negociando gasoil?) antes de construir nada; es
  exactamente el tipo de "dato bonito sin comprador validado" que este documento lleva
  advirtiendo desde el §0.
- **Machine learning sobre todos los datos que el propio sistema genera** (viajes, incidencias,
  desviaciones estimado-vs-real, decisiones de asignación) — la tesis de 10.10/`verdad_observada`
  ya apunta aquí, y sigue **bloqueada por falta de volumen real** (0 filas en producción hoy,
  ver ROADMAP 10.10). Sin datos reales no hay nada que entrenar; construir esto ahora sería
  ajustar un modelo a ruido.
- **Minería del WhatsApp de la empresa cliente** (una vez conectado) como fuente de conocimiento
  — ya identificado como Fase 11 ("capa de conocimiento: capturar lo que hoy se pierde") y
  como decisión `[DECISIÓN]` explícitamente pospuesta hasta después del despliegue con volumen
  real de conversaciones (ROADMAP, "Aprendizaje sobre conversaciones"). Además choca de frente
  con el gate de WhatsApp ya decidido: no se migra a WhatsApp sin un cliente pagando que lo
  pida y cubra el coste de infraestructura (Meta Business API).
- **Vigilancia de tendencias/quejas del mercado** (gente quejándose de su TMS actual en
  Internet, foros del sector) — señal de producto útil para discovery/ventas, no para
  construir código; encaja en la disciplina ya existente de discovery real antes de construir
  (12.3), no en un scraper permanente.

Ninguno de estos puntos se toca en el loop autónomo ni se decide construir por iniciativa
propia — misma regla de secuencia que el resto del North Star, ver abajo.

**Regla de secuencia (no negociable, y es la misma del GATE MAESTRO):** ningún ítem de Capa 1+ se
empieza sin haber cerrado el criterio de éxito de la Capa anterior con un cliente real. El loop
autónomo NO decide subir de capa por iniciativa propia — eso requiere una decisión explícita del
usuario, igual que un despliegue.

---

## 0. Veredicto en 30 segundos

**Sí, la idea tiene sentido y merece intentarse — pero el proyecto está a una decisión de
convertirse en un hobby caro.**

Lo que la hace viable: hay dolor real y validado, hay una cuña diferenciada que la
investigación de mercado confirma (no es una corazonada), hay distribución caliente
(~2.310 camiones a una llamada de distancia) y el coste de operación es ~€0/mes, así que el
proyecto no puede morir de falta de caja.

Lo que la puede matar no es Qargo, ni el mercado, ni la tecnología: es el **patrón de
comportamiento revelado**. `MENTORIA-ESTRATEGICA.md` diagnosticó en julio "producto muy por
delante de cliente" y propuso un GATE MAESTRO. Desde entonces se han construido las Fases 17,
18 y 19, y el discovery formal (12.3) **sigue sin ocurrir**. Cero clientes, cero viajes
reales, cero conversaciones con el comprador económico. Esa es la amenaza existencial, y es
interna.

---

## 1. El dato que cambia el encuadre: el mercado español es diminuto en la cima

Nadie había puesto números al TAM. Aquí están, del Ministerio de Transportes:

| Segmento (España, transporte de mercancías por carretera) | Empresas | % |
|---|---|---|
| Total empresas del sector | 103.375 | 100% |
| Con vehículos pesados | 58.972 | 57% |
| **1 solo vehículo** | 61.242 | **59,2%** |
| **≤5 vehículos** | ~88.600 | **85,7%** |
| **>60 vehículos** | **485** | **0,5%** |

Fuente: [Orientanet / Ministerio de Transportes](https://www.orientanet.es/cuantas-empresas-de-transporte-por-carretera-hay-en-espana/),
[Mordor Intelligence](https://www.mordorintelligence.com/es/industry-reports/spain-road-freight-transport-market).

### Qué implica esto, en serio

El ICP de Norenty **no es "empresas de transporte"** — es "flotas con un gestor de tráfico
dedicado", porque toda la propuesta de valor (apalancamiento 30→60 camiones, nómina, control)
presupone que existe esa persona. Ese rol aparece a partir de ~20-30 camiones.

- **>60 camiones: 485 empresas en toda España.**
- 30-60 camiones: estimable en ~800-1.200 (no hay dato público desglosado; **no validado**).
- **TAM español realista del ICP: ~1.300-1.700 empresas.**

A €15/camión/mes y flota media de 70 camiones → **€12.600 ARR por cliente**.
- 100% del mercado español = ~€19M ARR (imposible).
- 5% del mercado = **~€950k ARR**. Ése es el techo realista en España sola.

**Conclusión dura:** España es un mercado de lanzamiento, no un mercado. €1M ARR es un
negocio excelente para un fundador solo, y una decepción para cualquiera que espere escala
tipo venture. Hay que decidir conscientemente cuál de las dos cosas se persigue — y el diseño
del producto, el precio y hasta el idioma del código cambian según la respuesta.

### El lado bueno (Thiel, y es genuino)

Un mercado de 485 empresas **se puede enumerar por nombre en una hoja de cálculo**. Eso es
literalmente el consejo de Thiel: dominar un mercado pequeño y específico antes de expandir.
No es una limitación, es una ventaja táctica — permite venta 1-a-1, cero gasto en marketing,
y conocer personalmente a todo tu mercado. La trampa sería fingir que es más grande de lo que
es y gastar como si lo fuera.

**Lo que NO hay que hacer:** bajar de gama al 85,7% de empresas con ≤5 camiones. No tienen
gestor de tráfico, no hay historia de apalancamiento, no pagarán, y el producto entero
(roles, aprobaciones, controlling) sobra para ellos. Sería tirar la tesis.

---

## 2. La competencia: Qargo es el hecho más importante que no estaba documentado

**Qargo** (Gante, Bélgica) levantó **€28M Serie B en diciembre 2025** (Sofina + Balderton),
**€46M totales**. Y lo relevante no es el dinero, es la tracción:

- De **~100 a más de 400 clientes** entre mayo 2024 y diciembre 2025.
- De £420M a **£1.900M** de facturación anual procesada por la plataforma.
- Claim: **75% menos tiempo** en tareas administrativas repetitivas.
- ICP: *carriers, freight forwarders y 3PLs* — **exactamente el mismo comprador que Norenty**.

Fuentes: [Tech.eu](https://tech.eu/2025/12/11/qargo-expands-ai-driven-transport-management-with-33m-series-b/),
[EU-Startups](https://www.eu-startups.com/2025/12/belgian-tms-startup-qargo-secures-e28-million-to-scale-operations-and-product-development/),
[FreightWaves](https://www.freightwaves.com/news/qargo-lands-33m-series-b-to-fuel-ai-driven-tms-growth-in-europe).

Además, en España ya operan **Logistiko, Hedyla, NovaTrans, easyTMS** y el francés
**Dashdoc**, y por arriba están Transporeon/Alpega, Trimble y Webfleet.
Referencias de precio del sector: Cargoson desde **€199/mes**, tramos SMB de **$300-1.000/mes**,
por usuario **$50-500/usuario/mes** ([Cargoson](https://www.cargoson.com/en/blog/top-transport-management-software-tms-providers),
[Locus](https://locus.sh/blogs/transport-management-system-cost/)).

### La lectura estratégica

**Norenty NO puede ganar como "un TMS más barato".** Qargo tiene 46 millones, 400 clientes y
un equipo entero; en una comparativa de funcionalidades de TMS, Norenty pierde siempre. Y el
producto **ha derivado justo hacia ahí**: 22+ páginas de dashboard, cotizador, facturación,
analítica, roles, aprobaciones… eso es competir con Qargo en el terreno de Qargo.

La pregunta de Thiel que hay que responder es: **¿qué hace Norenty que Qargo estructuralmente
no hará?** Hay dos respuestas buenas, y están en la sección 3.

---

## 3. La cuña real (y está infrautilizada)

### 3.1 El chófer no instala apps — y esto está confirmado fuera de casa

La investigación del sector es explícita: *"incluso en 2024, muchos transportistas operan como
hace 15 años — hojas de cálculo, mensajería instantánea y email"*, y el flujo real descrito es
*"el chófer recoge el albarán, comprueba la carga, **manda una foto al despachador por Viber o
WhatsApp**, y arranca"* ([Adexin](https://adexin.com/blog/logistics-mobile-apps-for-truck-drivers/)).

Y la investigación sobre fracasos de implantación de TMS apunta al mismo sitio: la adopción se
desploma en los primeros 90 días por complejidad percibida
([RoaDo](https://roado.tech/blog/why-tms-implementations-fail-and-what-to-do-differently/),
[Panorama](https://www.panorama-consulting.com/top-reasons-for-tms-failure/)).

**Esto valida la apuesta central de Norenty**: no pedir al chófer que instale nada nuevo, ir a
la mensajería que ya usa. Es una verdad contraintuitiva y defendible — el tipo de "secreto" que
Thiel busca. **Y no está en el centro del discurso comercial. Debería estarlo.**

Matiz honesto y sin resolver: Norenty usa **Telegram**, y el chófer español medio usa
**WhatsApp**. `DISCOVERY-GESTOR.md` §3.4 ya tiene la pregunta ("¿instalaría Telegram si se lo
pides tú, o eso ya es fricción real?") — **y sigue sin respuesta**. Si la respuesta es "no lo
instala", toda la cuña se tambalea y hay que ir a WhatsApp Business API (con su coste por
conversación y su ventana de 24h). **Es la pregunta más cara del proyecto y lleva semanas sin
hacerse.** Coste de responderla: una llamada de 10 minutos.

### 3.2 La nómina es el mejor caballo de Troya, y está desaprovechada como argumento

De `DISCOVERY.md`, Insight 2 (gestor real, sin que se le vendiera nada): las noches fuera y los
km para las nóminas se calculan **a mano, cada mes, chófer por chófer**.

Por qué esto es el mejor wedge disponible:

1. **Es dolor recurrente con fecha límite.** Todos los meses, sí o sí. Fuerza el uso.
2. **Norenty ya tiene el dato** como subproducto de los hitos. No es "digitalizar una tarea",
   es hacerla desaparecer.
3. **Qargo no compite ahí.** Ellos atacan planificación/administración/facturación. La nómina
   del chófer español (dietas, noches fuera, convenio) es local, sucia y poco sexy — justo el
   tipo de cosa que un producto paneuropeo financiado no prioriza.
4. **Crea lock-in inmediato.** Cuando tu nómina depende de mis datos, no te vas.
5. **El ROI se calcula en una servilleta** delante del dueño.

Corolario técnico importante: si la nómina es la cuña, el bug de truncamiento a 1000 filas de
la Fase 19 **era existencial, no una deuda técnica más** — una nómina mal calculada en el mes 1
mata la cuenta y la referencia. Bien encontrado y bien arreglado; y confirma dónde debe estar
el listón de calidad: en la cuña, no repartido por igual entre 22 pantallas.

### 3.3 La cadena de evidencia: ✅ VALIDADA el 2026-07-27 — pasa de opción a pilar

El hash-chain de POD + GPS + timestamps es genuinamente difícil de copiar rápido (hay que
diseñarlo desde el día 1, no añadirlo después). Abre puertas más allá del TMS: defensa en
disputas, negociación de primas de seguro, *factoring* con entrega verificada.

~~**Pero:** `DISCOVERY-GESTOR.md` §3.7 pregunta si las disputas son un dolor real… y no está
contestada.~~ **Contestada el 2026-07-27** (`DISCOVERY.md` insight 16), y por iniciativa del
gestor, sin que se le preguntara:

> "Lo lógico sería cambiarlo todo a nivel de que sea **una huella digital. Todo digital. Y que
> sea inalterable**. Es una trazabilidad digital."

Lo que la convierte en dolor económico y no en elegancia técnica:
- **Papel perdido = viaje potencialmente no cobrado.** "Está en su derecho de decirte que no."
- **Fotos de albarán ilegibles** son un problema diario: hay que volver a pedírselas al chófer
  días después, cuando ya está a 500 km.
- **Anotaciones no registradas** ("mercancía mojada") se convierten en descuentos a fin de mes
  que ya no se pueden discutir.
- **Custodia legal de 3 años (albaranes) y 10 (facturas)** en armarios físicos: "me he pegado
  media hora buscando papeles. Es imposible encontrar algo."
- **eCMR** (carta de porte electrónica) "ya está en marcha, pero no se usa aún" → hay un estándar
  al que engancharse en vez de inventar un formato propio.

**Corrección de rumbo respecto a la versión anterior de esta sección:** el problema NO estaba en
si la cadena de evidencia importa (importa), sino en **la calidad del dato de entrada**. Una foto
borrosa rompe la cadena entera y no nos enteramos hasta que es tarde. Por eso la Fase 23 ataca
primero la validación de la foto en el momento de la captura, no más criptografía encima.

### 3.4 El activo que nadie ha puesto en el pitch: la velocidad

Un fundador solo con un loop de IA que cierra fases enteras en una noche tiene un argumento de
venta que Qargo **no puede igualar por estructura**: con 400 clientes, la petición de un
cliente nuevo es la número 401 de la cola.

> *"Lo que me pidas el martes está en producción el jueves. Con mi competidor, entra en el
> roadmap del Q3."*

Para un Founding Partner eso vale más que cualquier tabla comparativa de funcionalidades. Es
la traducción comercial de la ventaja real que ya existe. No está en
`PROPUESTA-FOUNDING-PARTNER.md`. Debería ser el segundo párrafo.

---

## 4. Los 5 problemas que pueden hundirlo (y qué hacer con cada uno)

### 4.1 🔴 Cero validación tras 19 fases — el riesgo #1, y es de comportamiento

No es falta de conocimiento: el proyecto **ya se diagnosticó solo** en julio y propuso el
remedio. Y luego construyó tres fases más. Un loop que lee el ROADMAP y construye lo que
encuentra **siempre encontrará algo que construir** — es una máquina de posponer la
conversación incómoda con un cliente.

**Arreglo (no negociable):** el GATE MAESTRO que ya propuso `MENTORIA-ESTRATEGICA.md`, pero
esta vez con un compromiso de calendario, no de intención. Ver plan de 30 días (sección 6).

### 4.2 🟡 El discovery está construido sobre una sola fuente, y es amiga

**Actualizado 2026-07-27 — mejora sustancial, pero el riesgo de fondo NO desaparece.**

Todo lo que "sabemos" del cliente viene de **un único gestor amigo del fundador**, y el propio
`DISCOVERY.md` marca el sesgo. Lo que cambió el 2026-07-27: una sesión de ~60 min **con su TMS
real (Cometweb) en pantalla**, recorriendo la operación pantalla por pantalla. Eso sube la
calidad de "anécdota recordada" a **auditoría de campo + auditoría competitiva directa**, y
produjo los insights 9-21 de `DISCOVERY.md`, incluidos cuatro fallos concretos del competidor
que él nombró sin que se le preguntara.

**Lo que sigue exactamente igual de mal:** es la MISMA persona. Un punto de datos muy profundo
sigue siendo un punto de datos. Faltan, sin excusa:
- El **comprador económico** (dueño/gerente): **cero conversaciones**. Y ahora sabemos que ya
  existe una "mega Excel del jefe" midiendo a los gestores (insight 15) — es decir, el dueño ya
  tiene una pregunta que Norenty contesta, y no hemos hablado con él nunca.
- Un **gestor ciego**, sin relación personal, para contrastar el sesgo de apertura del insight 6.
- **Telegram-vs-WhatsApp** desde el punto de vista del chófer: sigue sin contestarse. Apareció un
  ángulo legal nuevo (insight 17: WhatsApp no era válido como prueba en Marcotran) pero es una
  impresión suya, **no validada** — no usarlo como argumento de venta sin confirmarlo.

Andreessen: el mercado es el factor dominante, y sobre este mercado se tiene un solo punto de
datos con sesgo conocido — ahora muy bien documentado, pero uno.

**Arreglo (sin cambios):** 3 conversaciones (1 dueño, 1 gestor ciego, 1 confirmación de canal).

### 4.3 🟡 El producto se ha convertido en el TMS que decía no ser

`DISCOVERY.md` fija la tesis: *"capa de ejecución sobre el TMS existente, no un TMS nuevo"*.
Pero se han construido cotizador, facturación, analítica, controlling, roles y aprobaciones —
es decir, un TMS. Cada pantalla nueva acerca el producto al terreno donde Qargo gana, y sube
la complejidad percibida que mata la adopción a 90 días.

**Arreglo (Musk, "borra la pieza"):** no borrar código — **esconderlo**. Un "modo esencial"
con 4-5 pantallas para el piloto (Hoy, Viajes, Nómina, Documentos) y el resto tras un
interruptor de "avanzado". Es cambio de un día y sube la tasa de cierre en la demo.

### 4.4 🟡 Conflicto de incentivos usuario-vs-comprador, documentado y sin resolver

El comprador es el dueño; el usuario diario es el gestor; y el gestor **sabe que esto podría
sustituirle** (Insight 6). Un usuario amenazado sabotea un piloto, aunque sea pasivamente.

La respuesta actual ("vender apalancamiento, no reemplazo") es correcta pero insuficiente.

**Arreglo:** que el producto le dé al gestor algo **egoístamente suyo**: quitarle la nómina
manual de encima, que salga antes de trabajar, que quede bien ante su jefe con datos que antes
no tenía. Vender ROI al dueño, vender *alivio* al gestor. Y en el piloto, hacerle campeón
explícito con nombre y voz en el roadmap.

### 4.5 🟡 Riesgo de un solo idioma y un solo país

Todo el producto, la documentación y el discurso están en español, y el mercado español del
ICP tope a ~€1M ARR. Si en algún momento se quiere Europa, la deuda de internacionalización
crece cada semana.

**Arreglo:** decisión consciente ahora, no dentro de un año (ver sección 8). Si la respuesta
es "España primero y ya veremos", perfecto — pero que sea una decisión, no un accidente.

---

## 5. Cómo venderlo (el posicionamiento que yo usaría)

### 5.1 Bezos, working backwards — la nota de prensa

> **Norenty rellena solo el papeleo de tu flota, porque tus chóferes ya usan el móvil que
> tienen.**
>
> Sin apps nuevas que instalar, sin formación. El chófer manda una foto o una nota de voz como
> ya hace hoy; Norenty convierte eso en horas de llegada, kilómetros, albaranes con prueba
> infalsificable y la nómina del mes ya calculada. Un gestor de tráfico pasa de llevar 30
> camiones a llevar 60.

Nótese lo que **no** dice: TMS, plataforma, optimización, IA. Todo eso es lenguaje de
competidor.

### 5.2 La escalera de venta (tres frases, en este orden)

1. **Gancho (dolor concreto y periódico):** *"¿Cuánto tiempo echa tu equipo cada mes cuadrando
   noches fuera y kilómetros para las nóminas?"*
2. **Cuña (la verdad contraintuitiva):** *"El motivo por el que los programas de flota fallan es
   que el chófer no usa la app. Nosotros no le pedimos que instale nada."*
3. **Cierre (asimetría de riesgo):** *"3 plazas de Founding Partner. No pagas hasta que
   funcione con tus viajes reales, y el precio te queda bloqueado de por vida."*

### 5.3 Precio: la lógica ya está bien, falta el número

`PROPUESTA-FOUNDING-PARTNER.md` razona bien (fracción del valor creado, por camión/mes) pero
deja el número en blanco. Anclas defendibles con los datos de mercado de arriba:

| | Founding (bloqueado) | Lista |
|---|---|---|
| Por camión/mes | **€8-12** | **€18-25** |
| Flota de 80 | €640-960/mes | €1.440-2.000/mes |
| Flota de 300 | €2.400-3.600/mes | €5.400-7.500/mes |

Encaja con el tramo SMB del sector ($300-1.000/mes) por abajo y con mid-market por arriba, y
**la prueba del valor**: un gestor cuesta ~€35k/año; si duplica capacidad, una flota de 80 con
3 gestores ahorra del orden de €35-70k/año. Pagar €10-12k/año por eso es una decisión fácil.

**Recomendación fuerte:** cobrar algo desde el día 1, aunque sea €1/camión simbólico. El propio
documento lo contempla como variante; yo lo haría regla. Lo gratis no se defiende internamente,
no se prioriza, y no te dice nada sobre disposición real a pagar — que es justo lo que hay que
aprender.

### 5.4 Service-as-Software: el modelo que resuelve el conflicto de 4.4 en vez de gestionarlo

Añadido el 2026-07-26, tras discutir una reformulación de la tesis comercial.

**La idea del fundador, en sus palabras:** no vender "software que ayuda a tu gestor", vender
*"tu departamento de gestores te cuesta 100k/año, te lo hago por 50k/30k con garantías totales
— y de partida esos gestores los contrato yo para desarrollar el software hasta que funcione"*.
Es decir: Norenty no vende una herramienta, vende el **resultado** (la flota gestionada) y se
queda con el personal que hoy hace ese trabajo.

**Por qué esto es mejor que "TMS más barato" y mejor que "ayuda a tu gestor a rendir más":**

Category-wise es exactamente el patrón de las empresas de Service-as-Software que están
ganando ahora mismo (Sierra, Decagon y similares): no vendes el asiento de software, vendes el
puesto de trabajo hecho, con un precio que es una fracción del coste de plantilla. Es una venta
brutalmente simple para el comprador — no hay que evaluar features, hay que comparar dos
números (100k vs 50k) — y es coherente con el ángulo de Bezos de la sección 5.1: el cliente no
compra "gestión de flota con IA", compra que el problema desaparezca de su balance.

**El motivo por el que esto SÍ resuelve 4.4 (y no solo lo mitiga):** la sección 4.4 identificó
que el gestor, al ser el usuario diario pero no el comprador, tiene incentivo a sabotear un
producto que se vende como su propio reemplazo. Ese conflicto **existe porque el gestor sigue
siendo empleado del cliente** mientras el software le compite. En el modelo de aquí, el gestor
pasa a ser **empleado o subcontratado de Norenty**, no del cliente. Ya no hay saboteador interno
posible en el sentido clásico: la persona que opera el sistema tiene ahora el mismo lado de la
mesa que el vendedor, no el lado opuesto. El conflicto de incentivos no se gestiona con un
"vender alivio, no reemplazo" (el parche de 4.4) — **se elimina de raíz, cambiando quién firma
la nómina de esa persona.**

**Lo que cambia de negocio, y hay que decirlo sin adornos:**

Esto ya no es un SaaS puro — es un **BPO con software propietario**, mucho más parecido a lo que
hace una gestoría o un contact center outsourceado que a lo que hace Qargo. Eso tiene
consecuencias reales, no cosméticas:

1. **Los márgenes cambian de naturaleza.** Un SaaS de €15/camión/mes tiene margen bruto del
   ~85-90% porque el coste marginal es servidor. Aquí el coste marginal incluye **sueldos de
   gestores reales**, así que el margen se parece más al de una consultora/gestoría (30-50%)
   que al de un SaaS. El techo de la sección 8 (€1-1,5M ARR de nicho ibérico) habría que
   recalcularlo con este margen, no con el de software — **no validado, hacer la cuenta antes
   de vender la primera unidad así.**
2. **Escala de forma distinta.** Un SaaS escala con código; un BPO escala con contratación y
   formación de gente. El "loop nocturno que cierra fases en una noche" (sección 3.4) deja de
   ser la ventaja competitiva central si el cuello de botella pasa a ser cuántos gestores puedes
   contratar y formar bien. Sigue siendo una ventaja, pero dentro de una empresa distinta.
3. **El pitch de "garantías totales" es una promesa operativa, no solo comercial.** Si Norenty
   se compromete a gestionar la flota de un cliente por 50k cuando a él le cuesta 100k, un fallo
   operativo (un chófer sin ruta un lunes, una nómina mal calculada) ya no es "un bug de
   software" — es un incumplimiento de servicio con el mismo peso que si el cliente hubiera
   despedido a su propio equipo y el sustituto no apareciera. El listón de fiabilidad sube de
   golpe, y en fase inicial (0 clientes, producto con Fase 19 recién estabilizada) ese riesgo
   es alto. Hay que dimensionarlo antes de prometerlo, no después del primer cliente.
4. **Encaje con "chófer no instala nada" (3.1) — se refuerza, no compite.** Si Norenty pone el
   gestor humano en la ecuación (aunque sea remoto), ese gestor puede absorber exactamente los
   casos donde el chófer no manda el dato limpio por Telegram/WhatsApp — es el colchón humano
   que hace tolerable la fricción residual del canal de mensajería. Encaja con el ROADMAP
   18.D.7 (bot de cotización) como la primera pieza de "el sistema hace el 80%, el gestor
   remoto de Norenty resuelve el 20% restante".

**El orden correcto para probarlo, sin apostar la empresa entera de golpe:**

No hace falta decidir "SaaS puro" vs "Service-as-Software" como blanco o negro desde ya. El
camino de menor riesgo es usarlo como **variante de piloto, no como modelo único**: al primer
Founding Partner (o a uno de los tres) ofrecerle explícitamente la opción B — *"tú me pagas lo
que hoy gastas en un gestor menos el ahorro, y yo pongo la persona (formada por mí, usando mi
software) que hace ese trabajo durante los primeros 3-6 meses"*. Eso da un dato real y barato de
validar: ¿el cliente prefiere comprar software o comprar un resultado gestionado? Si la
respuesta es masivamente "resultado gestionado", el pivote de modelo de negocio se hace con
evidencia, no con una corazonada — y hay que rehacer la sección 8 y el 5.3 con márgenes de
servicio, no de software. Si la respuesta es "prefiero el software, ya tengo gestor", el modelo
SaaS de las secciones 1-7 queda intacto y esta sección se archiva como opción de expansión, no
como pivote necesario.

**Riesgo legal a no pasar por alto:** contratar o subcontratar personas que hacen el trabajo de
gestor de tráfico para terceros puede tocar normativa laboral (cesión ilegal de trabajadores si
no se estructura bien, requisitos de ETT en España). No validado — consultarlo con un laboralista
antes de ofrecerlo por escrito a ningún cliente, no después.

### 5.5 Amigos-gestor: asesores primero, socios/empleados después — y el techo del modelo B es la pericia, no el dato

Añadido el 2026-07-26, tras discutir si asociar/contratar a los gestores amigos que validan la
idea (el fundador tiene varios — "casi me daría para montar la empresa de gestión
subcontratada").

**Amigos + dinero:** el instinto de no mezclarlos es correcto, pero la respuesta no es "sí o
no" sino "en qué papel". Recomendación: empezar como **asesores pagados por hora/sesión**, sin
equity ni nómina — bajo compromiso, bajo riesgo de que un fallo del negocio se convierta en un
problema personal. Si más adelante alguno quiere entrar de verdad, hacerlo con reglas por
escrito desde el día 1 (qué pasa si no funciona, cómo se reparte, cómo se sale) — la amistad se
rompe por no hablar de esto, no por trabajar juntos.

**La trampa de "solo hace falta al principio, hasta que el algoritmo lo haga":** puede ser
cierta para el 80% mecánico del trabajo (cuadrar horas, kilómetros, nómina) y **falsa para el
20% de excepciones**, que es justo donde vive el valor del gestor de 20 años — resuelve
situaciones anómalas que un gestor novel escalaría sin más. Ese 20% no se automatiza solo
porque se acumulen datos; por definición, lo anómalo es lo que peor generaliza. Conclusión: si
el modelo B (Service-as-Software, sección 5.4) avanza, **el experto humano no es una muleta
temporal — es una parte permanente del producto**, aunque en proporción decreciente. Decisión
pendiente y honesta, no urgente pero sí consciente: ¿el negocio final es "software con apoyo
humano decreciente" (SaaS) o "gestoría con software de apalancamiento" (BPO)? Son dos empresas
con dos estructuras de coste distintas, y hay que responderla con datos de las primeras
llamadas reales, no antes ni con una corazonada.

**Por qué una "agencia" que reparte gestores entre varios clientes distintos NO conserva la
misma pericia:** un gestor senior responde bien a lo anómalo porque conoce a fondo *una*
operación concreta — sus clientes, sus rutas, sus manías. Repartirlo entre 4-5 flotas de
clientes distintos con procesos distintos lo convierte de "experto en esta operación" a
"generalista repartido" — la versión débil, no la fuerte. Es el mismo problema estructural de
cualquier gestoría o call center outsourceado. Consecuencia para la unidad económica del modelo
B: probablemente no es "un gestor para N clientes" sino algo más parecido a "un gestor senior
supervisa a 2-3 junior, cada uno dedicado a 1-2 clientes" — una jerarquía, no un pool
intercambiable. Esto sube el coste operativo asumido en 5.4 y hay que meterlo en la cuenta de
márgenes **antes** de prometer "50k en vez de 100k con garantías totales" a nadie.

**Recomendación concreta para ahora:** no contratar ni asociar a nadie todavía. Usar a 2-3
amigos gestores como asesores puntuales pagados para las llamadas de validación (sección 6) y
para revisar casos anómalos según aparezcan. Decidir la pregunta de SaaS-vs-BPO con datos de
esas llamadas, no antes.

### 5.6 Cuándo cambiar el mensaje: apalancamiento primero, ahorro de personal después

Confirmado con el usuario (2026-07-26): el mensaje principal siempre ha sido vender "puerta a
puerta" con la promesa de apalancamiento ("el mismo gestor lleva más flota", sección 5.2) — no
"te reduzco la plantilla". El cambio de mensaje a "el TMS del futuro que te recorta el coste de
personal" se reserva a propósito para **después** de tener 2-3 Founding Partners reales
funcionando.

**Por qué este orden y no al revés:** vender la reducción de coste de personal ANTES de tener un
caso real es prometer un ahorro que nadie ha visto todavía — y es exactamente el mensaje que
activa el sabotaje del gestor descrito en 4.4 (la persona que tienes delante en la demo se
siente amenazada). Vender apalancamiento primero dejando que el ahorro se demuestre solo con
los primeros clientes evita quemar ningún contacto: la reducción de coste, cuando llegue, se
cuenta como caso de estudio de un cliente distinto ("la empresa X pasó de 3 gestores a 1"), no
como promesa al gestor que tienes enfrente. El gate para el cambio de mensaje: 2-3 Founding
Partners con datos reales de al menos varios meses, no antes.

---

## 6. Hoja de ruta: de aquí a las primeras conversaciones con el sector

El fundador considera que el producto y el mensaje ya están en un punto presentable — "no me
pilla en calzoncillos como hace unos días" — y quiere una secuencia concreta para hablar con
gente del sector sin quemar los contactos importantes ni regalar más de lo necesario.

### 6.1 Los tres miedos y cómo se gestiona cada uno (no con el mismo movimiento)

| Miedo | Por qué no se resuelve hablando más | Qué lo resuelve |
|---|---|---|
| "No soy del sector, no me tomarán en serio" | No se puede fingir experiencia | Enseñar el **dashboard en vivo** (no capturas, no enviar accesos) + reconocer la asimetría en la primera frase, no esconderla |
| "Me pueden copiar la idea" | La idea en sí no es defendible ni patentable | El activo real es la ejecución + la relación personal que se construye llamando primero — no pedir NDA para una charla exploratoria, controlar el nivel de detalle (problema sí, arquitectura/precio/modelo B no) |
| "Mezclar amigos y negocio si sale mal" | Evitarlo del todo desperdicia el conocimiento que sí tienen | Empezarlos como **asesores pagados**, no socios/empleados (ver 5.5) |

### 6.2 Orden de contactos — no probar el mensaje en los contactos que más importan

1. **Nivel 0 — gestor(es) amigo(s):** no es venta, es informante + asesor puntual. Guion en 6.3.
2. **Nivel 1 — contactos secundarios / flotas medianas que no son el founding partner soñado:**
   aquí se prueba el pitch en voz alta por primera vez con alguien sin relación personal. Si
   falla, el coste es bajo.
3. **Nivel 2 — founding partners target (80/100/300 camiones):** no se llega a ellos hasta que
   el mensaje ya sonó bien 2-3 veces en el nivel 1. Se ganan la versión pulida, no la primera.

**Actualización de pipeline (2026-07-28):** la empresa grande donde trabaja el gestor amigo
(Nivel 0) probablemente **no es un cliente viable** — el propio usuario intuye resistencia por
secretismo de datos, aunque el amigo cree que sí ayudarían a desarrollarlo. Tratar esa empresa
como fuente de discovery/asesoría (ya lo es), no como target de venta.

En cambio, hay **dos contactos de Nivel 1/2 con acceso directo al comprador económico**, no solo
al usuario diario: una empresa donde el usuario conoce personalmente al **propietario**, y otra
donde conoce al **jefe supremo** (máximo responsable). Esto es mejor posición de la que describía
§6.2 en general ("secundarios, sin relación personal") — aquí SÍ hay relación personal con quien
firma el cheque, lo que salta directamente hacia el perfil de Founding Partner real. Candidatos
fuertes para la Semana 3 del plan de 30 días (§6.4), una vez el mensaje se haya probado en Nivel 1
si hace falta, o directamente si la relación personal ya reduce el riesgo de quemar el contacto.

### 6.3 Guion para la primera llamada (nivel 0)

1. **Apertura honesta sobre la asimetría:** *"Quiero pedirte 15 minutos de tu cabeza, no de tu
   tiempo de trabajo. Llevo meses construyendo algo para flotas como la vuestra y prefiero
   equivocarme contigo antes que con un cliente."*
2. **Prueba de seriedad:** compartir pantalla con el dashboard con datos de prueba — 2 minutos.
3. **Las 3 preguntas de validación** (ya estaban en el plan de 30 días, sección 6.4 semana 1):
   tiempo mensual en nómina; ¿instalarían Telegram si se lo pides tú?; ¿alguna disputa real con
   un cliente por una entrega?
4. **Sonda del modelo B, como pregunta abierta, nunca como oferta:** *"Si te dijera que puedo
   llevaros la gestión de tráfico por bastante menos de lo que os cuesta hoy el equipo, ¿eso
   suena a ayuda o a que alguien os quiere quitar el puesto?"*
5. **Cierre pidiendo puerta, no venta:** *"No te pido que compres nada. Dime sin filtro qué está
   mal de lo que has visto, y si conoces a alguien más en tu situación."*

### 6.4 Plan de 30 días (el marco de ejecución ya existente) (esto es lo que de verdad acelera el proyecto)

**Regla marco:** durante 30 días, **cero features nuevas**. Solo se escribe código que un
cliente con nombre y apellidos haya pedido, o que bloquee un piloto real.

### Semana 1 — Romper el bloqueo de validación
- [ ] **Llamar al gestor amigo hoy.** No para la entrevista larga: para 3 preguntas.
      (guion completo en 6.3, incluida la sonda del modelo B). → Esas tres respuestas valen
      más que las Fases 17-19 juntas.
- [ ] **Pedirle la intro a su jefe** (flota de 800) — no para vender: para escuchar.
- [ ] **Usar el orden de contactos de 6.2**: no llamar todavía al founding partner soñado; antes
      probar el mensaje con 1-2 contactos de nivel 1 (secundarios).

#### Semana 2 — Producto listo para demo, no para catálogo
- [ ] **Modo esencial**: esconder todo menos Hoy / Viajes / Nómina / Documentos.
- [ ] **Guion de demo de 10 minutos** que termine en la pantalla de nómina, no en analítica.
- [ ] Un **one-pager** con: el número 30→60, "sin apps para el chófer", 3 plazas, precio.

#### Semana 3 — Primer piloto real
- [ ] **Llamar a uno de los tres Founding Partner target** (80/100/300), ya con el mensaje
      probado en el nivel 1. Objetivo de la llamada: agendar 45 minutos, no cerrar nada.
- [ ] **Firmar 1 Founding Partner**.
- [ ] **10 viajes reales** por Telegram con chóferes de verdad. Aquí saldrán bugs reales; ese
      es el objetivo, no el efecto secundario.
- [ ] Cerrar el smoke test 10.1 con evidencia fechada en `PROGRESS.md`.

#### Semana 4 — Cerrar el bucle
- [ ] **Sacar su primera nómina real** con Norenty y ponerla al lado de la que hicieron a mano.
      Si cuadra, ése es el activo comercial más valioso que tendrá el proyecto.
- [ ] Reordenar el ROADMAP con lo aprendido (no con lo que ya estaba escrito).
- [ ] Decidir conscientemente España-vs-Europa (sección 8).
- [ ] Con los datos de las llamadas de las semanas 1-3, decidir SaaS-vs-BPO (sección 5.5) —
      no antes.

**Métrica única de estos 30 días:** no líneas de código, no fases cerradas. **Viajes reales
completados por chóferes reales.** Hoy: 0.

### 6.5 La forma del piloto — nos la dio el propio gestor (2026-07-27)

Añadido tras la sesión con Cometweb en pantalla (`DISCOVERY.md` insight 20). Hasta ahora el
piloto era una idea nuestra; ahora tiene forma dicha por el cliente, y eso cambia la venta.

**La objeción que hay que superar, en sus palabras:**
> "Tú también tienes un problema: no estás vendiendo una cosita. Estás vendiendo que **te juegas
> que te funcione todo, a ti y a la empresa**."

Es la objeción correcta y es fatal si se ignora: un TMS es infraestructura crítica, y nadie
apaga el suyo por un producto de un fundador solo sin clientes. **No se responde con una demo
mejor, se responde con una estructura de piloto que no pueda romper nada.**

**La estructura, propuesta por él:**

1. **Entrada por módulo, no reemplazo.** "Podrías ponerlo un poco aparte y sacar cosas: la zona
   de recursos humanos fuera, la administrativa también, el tema comercial un poco también."
   → Norenty entra por lo que hoy es **un Excel a mano** (nómina, palets, POD), no por lo que hoy
   es el sistema de registro. Cero riesgo operativo, cero migración.
2. **Un mes, en paralelo, ~10 chóferes, sin apagar nada.** "Corres con esto y corres con lo otro…
   un mes, usándolo diez personas, con todas las incidencias, y ver cómo va."
3. **Exportación como condición de entrada.** "Si ya usan SAP o un programa de contabilidad, al
   final le exportas todo y ya está." Sin export, el paralelo no es viable.
4. **Contar con la resistencia desde el día 1.** "Los que lo estén haciendo dirán: me gasta los
   huevos, todo mal." → el piloto necesita un campeón con nombre (§4.4) y un canal de quejas que
   se atienda en horas, que es justo la ventaja de velocidad de §3.4.

**Por qué esto mejora el plan que teníamos:** el "modo esencial" de §4.3 (esconder pantallas para
que la demo cierre) era la solución correcta al problema equivocado. El problema no es que el
producto parezca complejo — es que **sustituir asusta**. Correr en paralelo sobre un módulo que
hoy es manual elimina el miedo sin tocar el producto. El modo esencial sigue siendo buena idea
para la demo, pero ya no es lo que desbloquea la firma.

**Criterio de éxito del piloto, medible en la primera semana** (insight 18): el gestor dedica hoy
**2-3 h/día** a "reflejar bien los viajes en el ordenador" y cree que con la herramienta adecuada
"se hace en 20 minutos". Ése es el número a medir — es mucho mejor que "de 30 a 60 camiones",
porque se observa en días en vez de en trimestres.

---

## 8. El techo, con honestidad

| Escenario | Requisitos | ARR realista | Probabilidad |
|---|---|---|---|
| **Muere** | Sigue el patrón: más fases, cero clientes | €0 | Alta si no cambia nada en 30 días |
| **Negocio de fundador** | 20-40 clientes en España | €300k-600k | La más probable si se ejecuta el plan |
| **Líder de nicho ibérico** | 80-120 clientes, Portugal incluido | €1-1,5M | Requiere venta sistemática, no solo red |
| **Escala europea** | i18n, equipo, capital | €5-15M | Requiere levantar y competir con Qargo de frente |
| **Adquisición** | Cuña de adopción probada + evidencia | €3-15M salida | **La salida más natural** |

Sobre la adquisición, que creo que es el escenario que más se infravalora: **Qargo, Alpega,
Transporeon o Dashdoc tienen exactamente el problema que Norenty resuelve** — sus clientes no
consiguen que los chóferes usen la app. Una capa de adopción por mensajería, con cadena de
evidencia y funcionando con flotas reales, es una compra lógica para ellos. Y el camino para
llegar ahí es idéntico al del negocio de fundador: clientes reales usando la cuña. No hay que
elegir hoy.

Y el precedente que conviene tener presente, porque desmonta el falso dilema
"venture o nada": la francesa **Fleet** llegó a una valoración de **€100M totalmente
bootstrapped en 7 años**, con más del 90% de crecimiento en 2025 y siendo rentable
([EU-Startups](https://www.eu-startups.com/2026/02/bootstrapped-for-seven-years-french-it-scale-up-fleet-enters-first-lbo-at-e100-million-valuation/)).
Con €0/mes de coste de infraestructura, Norenty puede permitirse ese camino. Ésa es la ventaja
real de no haber levantado dinero: se puede tardar. Lo que no se puede es no tener clientes.

---

## 9. Las tres cosas que yo haría si esto fuera mío

1. **Dejar de construir hoy.** No mañana. El producto está objetivamente por delante del
   cliente y cada fase nueva empeora la asimetría y sube el coste psicológico de pivotar.
2. **Convertir la cuña en el producto.** Nómina automática + cero apps para el chófer. Todo lo
   demás pasa a "modo avanzado". El TMS completo se gana después, cliente a cliente.
3. **Usar la red antes de que se enfríe.** 2.310 camiones de intro caliente es un activo que la
   mayoría de fundadores no tiene y que se deprecia con el tiempo. Es, hoy, más valioso que
   todo el código del repositorio.

---

## Fuentes (2026-07-26)

- [¿Cuántas empresas de transporte por carretera hay en España? — Orientanet/Ministerio](https://www.orientanet.es/cuantas-empresas-de-transporte-por-carretera-hay-en-espana/)
- [Spain Road Freight Transport Market — Mordor Intelligence](https://www.mordorintelligence.com/es/industry-reports/spain-road-freight-transport-market)
- [Qargo raises $33M Series B — Tech.eu](https://tech.eu/2025/12/11/qargo-expands-ai-driven-transport-management-with-33m-series-b/)
- [Belgian TMS startup Qargo secures €28 million — EU-Startups](https://www.eu-startups.com/2025/12/belgian-tms-startup-qargo-secures-e28-million-to-scale-operations-and-product-development/)
- [Qargo lands $33M Series B — FreightWaves](https://www.freightwaves.com/news/qargo-lands-33m-series-b-to-fuel-ai-driven-tms-growth-in-europe)
- [Top Transport Management Software providers — Cargoson](https://www.cargoson.com/en/blog/top-transport-management-software-tms-providers)
- [Transport Management System Cost — Locus](https://locus.sh/blogs/transport-management-system-cost/)
- [Logistics mobile apps for truck drivers — Adexin](https://adexin.com/blog/logistics-mobile-apps-for-truck-drivers/)
- [Why TMS Implementations Fail — RoaDo](https://roado.tech/blog/why-tms-implementations-fail-and-what-to-do-differently/)
- [Top Reasons for TMS Failure — Panorama Consulting](https://www.panorama-consulting.com/top-reasons-for-tms-failure/)
- [Bootstrapped French scale-up Fleet at €100M valuation — EU-Startups](https://www.eu-startups.com/2026/02/bootstrapped-for-seven-years-french-it-scale-up-fleet-enters-first-lbo-at-e100-million-valuation/)
- [Top 10 Software TMS para Transporte de España — Outvio](https://outvio.com/es/blog/tms-que-es/)
