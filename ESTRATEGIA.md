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

### 3.3 La cadena de evidencia: opción real, todavía no validada

El hash-chain de POD + GPS + timestamps es genuinamente difícil de copiar rápido (hay que
diseñarlo desde el día 1, no añadirlo después). Abre puertas más allá del TMS: defensa en
disputas, negociación de primas de seguro, *factoring* con entrega verificada.

**Pero:** `DISCOVERY-GESTOR.md` §3.7 pregunta si las disputas son un dolor real… y no está
contestada. Sin esa validación, la cadena de evidencia es una solución elegante buscando un
problema. **Es una opción valiosa, no un pilar de venta todavía.** No construir más encima
hasta confirmarlo.

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

### 4.2 🔴 El discovery está construido sobre una sola fuente, y es amiga

Todo lo que "sabemos" del cliente viene de **una conversación informal con un gestor amigo del
fundador**, y el propio `DISCOVERY.md` marca el sesgo. Faltan: el comprador económico
(dueño/gerente — **cero conversaciones**), un gestor ciego sin relación personal, y la
respuesta a Telegram-vs-WhatsApp.

Andreessen: el mercado es el factor dominante, y sobre este mercado se tiene un solo punto de
datos con sesgo conocido.

**Arreglo:** 3 conversaciones en 2 semanas (1 dueño, 1 gestor ciego, 1 confirmación de canal).

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

**Arreglo:** decisión consciente ahora, no dentro de un año (ver sección 7). Si la respuesta
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
   que al de un SaaS. El techo de la sección 7 (€1-1,5M ARR de nicho ibérico) habría que
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
evidencia, no con una corazonada — y hay que rehacer la sección 7 y el 5.3 con márgenes de
servicio, no de software. Si la respuesta es "prefiero el software, ya tengo gestor", el modelo
SaaS de las secciones 1-7 queda intacto y esta sección se archiva como opción de expansión, no
como pivote necesario.

**Riesgo legal a no pasar por alto:** contratar o subcontratar personas que hacen el trabajo de
gestor de tráfico para terceros puede tocar normativa laboral (cesión ilegal de trabajadores si
no se estructura bien, requisitos de ETT en España). No validado — consultarlo con un laboralista
antes de ofrecerlo por escrito a ningún cliente, no después.

---

## 6. Plan de 30 días (esto es lo que de verdad acelera el proyecto)

**Regla marco:** durante 30 días, **cero features nuevas**. Solo se escribe código que un
cliente con nombre y apellidos haya pedido, o que bloquee un piloto real.

### Semana 1 — Romper el bloqueo de validación
- [ ] **Llamar al gestor amigo hoy.** No para la entrevista larga: para 3 preguntas.
      (1) ¿Tus chóferes instalarían Telegram si se lo pides tú? (2) ¿Cuánto tardáis en la
      nómina cada mes? (3) ¿Has tenido una disputa real con un cliente por una entrega?
      → Esas tres respuestas valen más que las Fases 17-19 juntas.
- [ ] **Pedirle la intro a su jefe** (flota de 800) — no para vender: para escuchar.
- [ ] **Llamar a uno de los tres Founding Partner target** (80/100/300). Objetivo de la llamada:
      agendar 45 minutos, no cerrar nada.

### Semana 2 — Producto listo para demo, no para catálogo
- [ ] **Modo esencial**: esconder todo menos Hoy / Viajes / Nómina / Documentos.
- [ ] **Guion de demo de 10 minutos** que termine en la pantalla de nómina, no en analítica.
- [ ] Un **one-pager** con: el número 30→60, "sin apps para el chófer", 3 plazas, precio.

### Semana 3 — Primer piloto real
- [ ] **Firmar 1 Founding Partner** (de los 80/100/300).
- [ ] **10 viajes reales** por Telegram con chóferes de verdad. Aquí saldrán bugs reales; ese
      es el objetivo, no el efecto secundario.
- [ ] Cerrar el smoke test 10.1 con evidencia fechada en `PROGRESS.md`.

### Semana 4 — Cerrar el bucle
- [ ] **Sacar su primera nómina real** con Norenty y ponerla al lado de la que hicieron a mano.
      Si cuadra, ése es el activo comercial más valioso que tendrá el proyecto.
- [ ] Reordenar el ROADMAP con lo aprendido (no con lo que ya estaba escrito).
- [ ] Decidir conscientemente España-vs-Europa (sección 7).

**Métrica única de estos 30 días:** no líneas de código, no fases cerradas. **Viajes reales
completados por chóferes reales.** Hoy: 0.

---

## 7. El techo, con honestidad

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

## 8. Las tres cosas que yo haría si esto fuera mío

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
