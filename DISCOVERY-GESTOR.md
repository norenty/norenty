# Guion de entrevista — Discovery con gestor de tráfico (ítem 12.3)

Objetivo de esta conversación: no es "enseñar el producto", es **extraer la realidad operativa
tal cual es hoy** — para confirmar o tirar abajo lo que ya está construido, y sobre todo para
saber **qué datos necesitamos de verdad** (formato, unidades, quién los tiene, con qué
frecuencia cambian) antes de seguir construyendo a ciegas.

Es la segunda conversación con este gestor (la primera, informal, está en `DISCOVERY.md`). Esta
vez conviene ser más sistemático: llevar el guion, tomar notas literales (las citas textuales
son las que más valen), y volcar todo a `DISCOVERY.md` después con el mismo formato: **quién/
cuándo → lo que dijo → por qué importa → implicación de producto**.

**Regla de oro de toda la sesión:** cuando diga "uso una hoja de Excel para X", pedir **verla en
pantalla** (o una captura/export sin datos sensibles) en el momento. Una descripción verbal de
un formato de datos casi siempre difiere de la realidad — columnas que se le olvida mencionar,
celdas combinadas, formatos de fecha inconsistentes, etc.

---

## 0. Antes de empezar

- Llevar portátil/tablet con el dashboard abierto (empresa demo) para poder señalar "¿esto se
  parece a lo que tú haces?" en vez de describir en abstracto.
- Grabar (con su permiso) o tomar notas exhaustivas — la memoria selectiva después de la reunión
  pierde matices, y aquí el matiz es el dato.
- No vender. Si pregunta "¿esto ya lo hacéis?", responder brevemente y volver a la pregunta —
  el objetivo de HOY es escuchar, no cerrar una venta.

---

## 1. Contexto general (calentamiento, 5 min)

1. ¿Cuántos camiones/chóferes llevas ahora mismo? ¿Ha cambiado mucho en el último año?
2. ¿Cómo es tu día normal, de que hora a que hora, y qué franja es la más caótica?
3. ¿Qué usas hoy para organizarte? (nombra TODO: TMS, Excel, WhatsApp, papel, pizarra,
   calendario, ERP de la empresa...) — no asumir que hay un único sistema, casi nunca lo hay.
4. De todo eso, ¿qué es "la fuente de verdad" cuando dos sitios no coinciden?

---

## 2. Un día cualquiera (observación del flujo real, 15-20 min)

Pedir que **comparta pantalla o enseñe físicamente** cómo:

1. Le entra un viaje/carga nuevo — ¿de dónde viene? (llamada, email, portal del cliente, bolsa
   de carga, EDI del TMS) ¿Qué datos trae ese encargo el día 1, y cuáles se rellenan después?
2. Decide qué chófer/camión asignar — ¿qué mira? ¿Hay algo escrito o es "lo sabe de memoria"?
3. Hace seguimiento del viaje mientras ocurre — ¿cómo se entera de que ha llegado, de que hay
   un retraso, de una incidencia?
4. Cierra el viaje — ¿qué necesita para darlo por completado? ¿POD, firma, foto, nada?
5. A fin de mes, qué informes saca (para el dueño, para el chófer -nómina-, para el cliente).

**Anotar en cada paso:** ¿en qué pantalla/papel vive ese dato? ¿lo copia a mano a otro sitio?
¿cuánto tarda cada paso?

---

## 3. Validar (o tirar) cada función ya construida o planeada

Para cada bloque: (a) ¿lo necesitas/lo harías así? (b) ¿qué le falta o le sobra a como lo
imaginamos? (c) **¿qué datos concretos hacen falta para que funcione de verdad en tu operación?**

### 3.1 Coste real / margen / cotización instantánea (ya construido: `/presupuesto`)
- ¿Sabes hoy si un viaje da dinero de verdad, o solo lo intuyes?
- ¿Cómo calculas el coste hoy (€/km fijo, desglosado por combustible/peajes/dietas/conductor,
  o "a ojo")? ¿Quién tiene esos números (tú, administración, el dueño)?
- ¿Con qué margen objetivo trabajáis normalmente? ¿Es el mismo para todos los clientes/rutas o
  varía?
- Formato/tipo de dato: ¿precio del gasoil lo actualizas cada cuánto? ¿el coste por km es un
  número fijo o cambia por vehículo/ruta?

### 3.2 Controlling / KPIs / objetivos (recién construido: pestaña "Gestores" + objetivos)
- ¿Ya mides algo como esto hoy (aunque sea a mano)? ¿En qué formato (Excel, cabeza)?
- Si comparases gestores entre sí, ¿con qué métrica sería justo compararlos? (¿viajes gestionados
  sin más penaliza al que lleva las rutas más difíciles?)
- ¿Un objetivo de puntualidad/margen tiene sentido fijarlo una vez al año, por trimestre, o no
  tiene sentido fijar un número único para toda la flota?
- ¿Qué harías si el sistema te dijera "este mes bajaste del objetivo"? ¿Es información útil o
  ruido?

### 3.3 Documentación legal + gastos con foto (ya construido: `/documentos`, foto en gastos)
- ¿Qué documentos caducan y hay que vigilar hoy (ITV, seguro, CAP del chófer, ADR, tacógrafo)?
  ¿Cómo te enteras de que caduca uno?
- Tickets de gasolina/peajes/multas: ¿los guardáis en papel, foto suelta, Excel? ¿Quién los
  necesita después (gestoría, Hacienda, el propio chófer)?
- ¿Hay un plazo legal de conservación que conozcas (multas, nóminas, tacógrafo)?
- **Añadido 2026-07-23, del smoke test con Pepito (el bot pide SIEMPRE foto de albarán en la
  entrega y no hay forma de saltarlo si el chófer no la tiene a mano en ese momento — hubo que
  desactivar `empresa.requiere_pod` a mano para poder completar la prueba).** Preguntar en
  detalle qué documentación lleva/genera realmente el chófer al hacer un viaje: ¿solo albarán
  firmado, o también CMR, foto de la mercancía, notas de incidencia, otros? ¿Es siempre en papel
  firmado a mano, o cada vez más digital (foto del móvil, firma en tablet, algo integrado en su
  TMS)? Si un cliente no tiene albarán físico (todo por email/portal), ¿cómo lo cierra hoy sin
  esa prueba? Esto decide si "pedir foto de albarán siempre" debe seguir siendo la única vía, o
  si hace falta un "no tengo foto ahora, márcalo pendiente" real (no solo un toggle de admin
  para desactivarlo entero por empresa).

### 3.4 Comunicación con chóferes (bot de Telegram, texto vs. voz)

**Nota de diseño (2026-07-23):** el bot ya tiene un teclado persistente con botones ("📋 Mi
viaje", "📍 Reportar incidencia", "📞 Contactar gestor") para no depender de que el chófer
escriba comandos como `/estado` — importante recordarlo al gestor probándolo: quien está al
otro lado es un chófer conduciendo o con las manos sucias, cuanto menos tenga que teclear mejor.
Preguntar directamente: al enseñarle el bot, ¿le resultan obvios esos botones, o los pasa por
alto y escribe igualmente? Si Telegram Desktop/móvil los esconde tras un icono poco visible,
puede hacer falta un mensaje más explícito la primera vez ("usa los botones de abajo").
- ¿Cómo te comunicas hoy con un chófer en ruta? ¿Llamada, WhatsApp, otra app?
- **Directa, no dar por hecho la respuesta:** ¿el chófer usa WhatsApp, Telegram, u otra cosa
  ahora mismo? Si es WhatsApp — ¿instalaría Telegram si se lo pides tú (es gratis e instalar y
  ya), o eso ya sería fricción real que perderías gente por el camino?
- Si el chófer pudiera mandar una nota de voz que te llega como texto ya traducido/resumido,
  ¿eso te ahorra algo de verdad, o el problema real es otro (que no te avisa, que llega tarde)?
- ¿Cuántas veces al día hablas con un chófer para algo que NO es una incidencia (solo estado)?
- Si el chófer pudiera simplemente LLAMAR a un número (sin apps, sin instalar nada) y un sistema
  automático supiera quién es y en qué viaje va, ¿eso resolvería un caso real (chóferes mayores,
  sin smartphone, sin datos móviles en el extranjero) o para tu flota el problema no es ese?

### 3.4b Móvil del chófer y privacidad de la ubicación (añadido 2026-07-19, antes de la charla)
- ¿Los chóferes usan móvil de empresa o el suyo propio? (Sospecha del usuario: probablemente el
  suyo — confirmar, porque cambia el criterio legal de privacidad: no es lo mismo trackear un
  dispositivo de la empresa que el móvil personal del trabajador.)
- Hoy el sistema captura la ubicación SOLO mientras el chófer comparte "ubicación en vivo" de
  Telegram — es una acción que él controla (empieza y para cuando quiere), no un tracking
  forzado en segundo plano. Preguntar: ¿le parecería razonable a un chófer compartirla solo
  mientras hay un hito pendiente de confirmar (ventana de llegada), en vez de todo el trayecto?
  ¿O el gestor necesita visibilidad de ruta completa para algo real (ETA al cliente, desvíos)?
  Esto determina si conviene limitar la ventana de captura por diseño, no solo por confianza en
  que el chófer pare de compartirla él mismo.

### 3.4c Captura de las urgencias / bot de llamadas (añadido 2026-07-19 — CLAVE, ya semi-validado)
El amigo gestor ya confirmó que **tener llamadas, incluso multilingües, es muy clave** (mensajes
normales los prefiere por texto). El valor está en las excepciones (camión roto, hora límite) que se
resuelven por teléfono y hoy el sistema no ve. Diseño cerrado en `SPECS-BOT-LLAMADAS.md`. Las 3
preguntas que cierran las incógnitas del build (sin ellas se picaría una taxonomía inventada):
1. Cuando resuelves una urgencia por teléfono, ¿contestarías 15 segundos de nota de voz "¿cómo lo
   has resuelto?" en caliente, o ni eso? (define si el Nivel 3-A es viable)
2. ¿Cuántas de estas urgencias hay al día — 2, 20? (dimensiona coste por minuto y prioridad)
3. ¿Qué acciones querrías que un bot pudiera hacer SOLO en una llamada (dar un ETA, registrar una
   incidencia, avisar a otro gestor) y cuáles JAMÁS sin ti? (define la API de acciones acotada)
4. Cuando algo se tuerce de verdad, ¿cómo se resuelve y con quién? ¿Queda algo escrito después, o se
   pierde? ¿Qué consultas mentalmente para decidir que NO está en ningún sistema? (ahí está el oro)

### 3.5 Asignación de rutas / dispatch
- Cuando asignas, ¿qué pesa más: quién está libre, quién conoce la ruta, el descanso legal
  pendiente, preferencia del cliente por un chófer concreto, otra cosa?
- ¿Alguna vez el sistema/tu criterio de asignación se ha equivocado y por qué?

### 3.7 Cargas vacías y confianza/disputas (añadido 2026-07-14, tras validar la idea de red/marketplace)
- ¿Qué porcentaje de vuestros trayectos vuelven vacíos (sin carga de retorno)? Si no lo sabe con
  número exacto, una estimación gruesa vale ("casi nunca", "1 de cada 3", "la mitad") — esto solo
  busca saber si hay margen real ahí, no una cifra auditada.
  Confirmado ya (conversación previa): dice que hoy INTENTAN minimizarlas activamente. Preguntar
  CÓMO lo hacen hoy (¿bolsa de carga, cartera de clientes fija, cliente de vuelta ya pactado?) —
  la respuesta a "cómo" importa más que el número exacto.
- ¿Alguna vez has tenido una disputa real con un cliente (dice que no llegó, que faltaba
  mercancía, que llegó tarde)? ¿Cómo se resolvió? ¿Tenías alguna prueba (foto, hora, firma) que te
  ayudara, o fue "su palabra contra la tuya"?

### 3.8 Roles, permisos y aprobaciones (añadido 2026-07-24, a petición explícita del usuario)

Contexto: al recorrer Ajustes, el usuario detectó que hoy cualquier gestor puede cambiar el nombre
de la empresa, el coste/km, los objetivos de puntualidad y margen. Su reacción: *"es como SAP, yo
no puedo cambiar x cosas si no hay un flujo de aprobaciones"*. Estas preguntas deciden el modelo
de roles (ítem 18.A.1) y el flujo de aprobaciones (18.A.2), que son cambios de modelo de datos —
conviene acertar antes de construirlos.

- ¿Cuánta gente distinta toca el sistema de transporte en tu empresa, y quién hace qué? ¿Hay
  alguien de contabilidad o de comercial que entre, o es solo tráfico?
- ¿Quién decide (y quién PUEDE cambiar) cosas como el coste por kilómetro o el objetivo de margen?
  ¿Es algo que se fija una vez y no se toca, o cambia a menudo?
- ¿Hay algo que hoy requiera el visto bueno de un superior antes de hacerse? (dar de alta una ruta
  nueva, aceptar un viaje que sale muy justo de precio o de tiempo, contratar un porte a otro)
- Si el sistema te dijera "este viaje NO es viable en el tiempo que te piden", ¿querrías que te
  bloqueara y tuviera que aprobarlo tu jefe, o que solo te avisara y tú decides?
- ¿La facturación la ve el jefe de tráfico, o solo administración/contabilidad?
- ¿Tenéis una sola base/nave o varias? (afecta al cálculo de "noches fuera" de la nómina)

### 3.9 Cómo se crea y se reparte un viaje (cadena comercial → tráfico → chófer)

Contexto: el usuario describió este flujo como el real, y HOY no está implementado así (ítem
18.C.1). Hay que confirmarlo con alguien de fuera antes de reescribir el modelo.

- ¿Quién crea un viaje nuevo cuando entra un encargo: el comercial, tú, el cliente directamente?
- ¿Existe algo parecido a una "bandeja" de viajes pendientes de repartir entre gestores, o cada
  gestor tiene sus clientes fijos de siempre?
- Cuando hay varios gestores de tráfico, ¿cómo se decide qué viajes lleva cada uno? ¿Y qué
  chóferes lleva cada uno?
- ¿En qué momento exacto se decide QUÉ CAMIÓN concreto hace el viaje: al cotizar, al planificar, o
  el mismo día? (esto decide si el presupuesto debe pedir matrícula o solo promedios)

### 3.10 Direcciones y cómo se dicen los sitios

Contexto: hoy el sistema pide latitud/longitud a mano. El usuario: *"eso no lo utiliza nadie, es
imposible"* (ítem 18.D.2).

- Cuando te entra un encargo, ¿cómo te dan la dirección: dirección postal, nombre del almacén, un
  código de cliente, coordenadas, un enlace de Google Maps?
- ¿Repetís mucho los mismos puntos de carga/descarga? ¿Los tenéis apuntados en algún sitio?
- ¿Cuántas paradas suele tener un viaje típico?

### 3.11 Bases/naves y dónde duermen los chóferes (añadido 2026-07-25)

Contexto: se implementó soporte para varias bases por empresa (18.C.3), calculando "noche fuera"
contra la más cercana en vez de una única fija. El propio usuario lo pidió con una duda explícita:
*"no tiene por qué estar asignado una persona a una base, sino que se podría desplazar entre
ellas, no estoy del todo seguro, deberíamos preguntarlo"*.

- ¿Cuántas naves/bases tenéis, y dónde?
- Un chófer concreto, ¿sale y vuelve siempre de la misma nave, o depende de la ruta que le toque
  esa semana?
- Cuando pasa la noche lejos de casa, ¿la dieta se calcula respecto a su base de siempre o
  respecto a donde esté la carga/descarga más cercana?

### 3.6 La pregunta de oro
> "¿Qué es lo que más tiempo te quita al día sin aportarte nada?"

Y la de seguimiento: "si mañana desapareciera esa tarea, ¿qué harías con ese tiempo?"

---

## 4. Información indispensable para poder construir bien (la parte más técnica)

Aquí el objetivo es dejar de adivinar el modelo de datos y copiar el real. Para cada fuente que
mencione en el punto 2, preguntar:

1. **¿Puedo ver el archivo/pantalla real (anonimizado si hace falta)?** — una plantilla Excel
   vacía o una captura vale más que cualquier descripción.
2. **¿Qué columnas/campos tiene?** Anotar el nombre EXACTO que usa él, no el que nosotros
   usaríamos (ej. si él dice "matrícula" y nosotros decimos "vehiculo_id", hay que mapear).
3. **¿Qué formato tiene cada dato?**
   - Fechas: ¿dd/mm/aaaa, con hora, sin hora, zona horaria?
   - Dinero: ¿con IVA o sin IVA, en qué moneda, cuántos decimales?
   - Matrículas/identificadores: ¿formato español estándar, algún código interno propio?
   - Coordenadas/direcciones: ¿dirección en texto libre, o ya tiene lat/lon de algún sitio?
   - Teléfonos/contactos de chóferes y clientes: ¿formato, país, WhatsApp vs. llamada?
4. **¿Qué campos son SIEMPRE obligatorios y cuáles casi nunca se rellenan?** — para saber qué
   hacer nullable y qué no en el modelo de datos (evita el error de exigir en el sistema un dato
   que en la realidad casi nunca existe el día 1).
5. **¿Con qué frecuencia cambia cada dato?** (matrícula de un vehículo: nunca. Coste del gasoil:
   semanal. Estado de un viaje: cada minuto.) — esto dice qué debe ser configuración vs. qué debe
   ser un evento en tiempo real.
6. **¿Quién más toca estos datos además de ti?** (administración, el dueño, el propio chófer,
   un cliente con acceso a un portal) — para saber qué roles/permisos hacen falta de verdad.
7. **¿Ya usáis algún TMS o software con el que tendríamos que importar/exportar?** Si sí: ¿qué
   formato exporta (CSV, Excel, EDI, API)? ¿Nos dejarías ver un export de muestra?
8. **Volumen real:** ¿cuántos viajes/mes, cuántos documentos/mes, cuántas fotos/mes? — para saber
   si el diseño actual (Postgres + Storage de Supabase, sin caché ni CDN dedicado) aguanta o hay
   que planear más pronto de lo pensado.

### 4.1 Bolsas de carga / cómo entran los encargos (investigado antes de preguntar)

Investigación previa (2026-07-13): en el sur de Europa las bolsas de carga dominantes son
**Wtransnet** (líder en la Península Ibérica, del Grupo Alpega), **Teleroute** (mismo grupo,
fusionada con Wtransnet), **TimoCom** (Alemania, fuerte en Europa central) y **Trans.eu**
(Polonia/Este de Europa). Todas ofrecen **API** para buscar cargas, publicar disponibilidad de
vehículo y sincronizar con un TMS — no haría falta scrapear ni pedir datos a mano si el gestor
ya usa alguna.

Preguntar:
- ¿Usas alguna bolsa de carga (Wtransnet, Teleroute, TimoCom, Trans.eu, otra)? ¿Para publicar
  disponibilidad, para buscar carga de vuelta, ambas?
- Si es que sí: ¿tienes acceso a su API o solo usas el portal web? ¿Nos dejarías ver cómo es un
  encargo cuando llega de ahí (campos, formato)?
- ¿Cuánta carga de la que mueves entra por bolsa de carga vs. cliente directo/recurrente?
- Si es que no: ¿por qué no? (coste de la suscripción, desconfianza, no le hace falta porque
  tiene cartera de clientes fija) — esto dice si integrar con una bolsa es prioritario o
  irrelevante para vuestro perfil de negocio.

---

## 5. Cierre

1. De todo lo que hemos hablado, si solo pudiéramos construir UNA cosa este trimestre, ¿cuál?
2. ¿Conoces a otro gestor de tráfico (sin relación con nosotros) al que le pudiéramos preguntar
   lo mismo, para contrastar? (el `DISCOVERY.md` ya anota que este gestor es amigo del fundador —
   sus respuestas pueden ser más generosas que las de un desconocido)
3. ¿Te enseño lo que ya tenemos construido y me dices qué está mal antes de irme?

---

## 6. Después de la entrevista

1. Volcar cada hallazgo a `DISCOVERY.md` con el formato ya establecido (quién/cuándo → dijo →
   por qué importa → implicación de producto). No editar los insights anteriores, añadir nuevos
   y marcar si alguno queda invalidado.
2. Cualquier fichero/captura de ejemplo que haya compartido: guardarlo en
   `docs/discovery/` (crear la carpeta si no existe) — NUNCA en el repo si contiene datos
   personales reales de clientes/chóferes sin anonimizar primero.
3. Revisar `ROADMAP.md`: los ítems `[DECISIÓN]` de Fase 12/7B que esta conversación responda,
   marcarlos y decidir si hay que reordenar el resto del plan (el propio ítem 12.3 ya avisa:
   "lo que traiga reordena el resto del plan").
