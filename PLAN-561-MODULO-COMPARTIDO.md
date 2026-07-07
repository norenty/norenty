# Norenty — Plan: módulo compartido para el Reglamento CE 561/2006

Ítem 9.42 del roadmap. **No es una implementación** — es el plan escrito que debe seguirse
la próxima vez que alguien necesite tocar la lógica de paradas/descansos del Reglamento
CE 561/2006, para no seguir divergiendo dos implementaciones a mano.

## Estado actual (2026-07-07)

Dos implementaciones independientes del mismo algoritmo, coordinadas solo por convención y
un test de paridad manual:

- **JS**: `calcularEtaConParadas(horasConduccionTotal)` en
  [dashboard/lib/data.js:66](dashboard/lib/data.js) — usada por `getEtaViaje`,
  `getViabilidadViaje`, `calcularPresupuesto` (todo lo que necesita estimar paradas/noches
  fuera desde el dashboard).
- **Python**: `calcular_eta_con_paradas(horas_conduccion_total)` en
  [backend/app/bot.py:1114](backend/app/bot.py) — usada por el comando `/eta` del bot,
  con un docstring explícito ("Espejo en Python de calcularEtaConParadas()").
- **Tests de paridad**: `backend/tests/test_bot.py` (línea ~521) tiene los mismos casos de
  entrada que los tests JS de `dashboard/lib/data.test.js`, verificando que ambas dan el
  mismo resultado para las mismas horas de conducción. Esto CONFIRMA que hoy coinciden, pero
  no PREVIENE que diverjan si alguien edita solo una de las dos sin acordarse de la otra —
  es una red de seguridad reactiva (el CI falla si diverge), no una garantía estructural.

**Por qué esto es aceptable hoy y no urgente**: la lógica no ha cambiado desde que se escribió
(items 5.3 y 6.8), y mientras nadie la toque el riesgo es cero. El riesgo real aparece en el
PRIMER cambio futuro (p.ej. ajustar los límites de conducción diaria/semanal, o añadir el
límite bisemanal de `LIMITE_561_BISEMANAL_H` al cálculo de paradas en vez de solo al aviso del
dashboard) — ese cambio, hecho solo en un lado, pasaría los tests de paridad ACTUALES (porque
esos tests no cubren el caso nuevo) y quedaría divergido en silencio hasta que alguien escriba
un test de paridad para el caso nuevo específicamente.

## Cuándo activar este plan

La próxima vez que un ítem del roadmap toque `calcularEtaConParadas` o
`calcular_eta_con_paradas` — no antes. No hay que migrar la lógica ahora "por si acaso";
sería trabajo especulativo sin un cambio real que lo motive (viola el principio de no
construir para requisitos hipotéticos de este proyecto).

## Opciones evaluadas para compartir la lógica

1. **Servicio HTTP interno** (el dashboard llama a un endpoint del backend Python para el
   cálculo). Rechazado: añade una dependencia de red para un cálculo puro en memoria —
   sobre-ingeniería para una función que tarda microsegundos, y el dashboard ya calcula esto
   client-side para respuesta instantánea en el wizard de nuevo viaje (ítem 7A.11); convertirlo
   en una llamada de red degradaría esa UX sin necesidad.
2. **Transpilar Python -> JS o JS -> Python automáticamente**. Rechazado: introduce una
   herramienta de build nueva (contra el "anti-roadmap" del proyecto, que evita infraestructura
   añadida sin necesidad clara) para una función de ~40 líneas que cambia rara vez.
3. **Extraer la lógica a JSON declarativo** (tabla de reglas: umbral de horas -> tipo de
   parada) y un intérprete pequeño en cada lenguaje. Más prometedor: el ALGORITMO (bucle de
   acumulación) seguiría duplicado, pero las CONSTANTES (4.5h, 45min, 9h diaria, 11h descanso)
   vivirían en un único archivo fuente de verdad. Reduce el riesgo de divergencia de
   parámetros (lo más probable que cambie) sin tocar la estructura del algoritmo.
4. **Mantener duplicado + fortalecer los tests de paridad** (recomendado como paso inmediato,
   más barato que las opciones 1-3): antes de CUALQUIER cambio futuro a esta lógica, añadir
   primero el/los test(s) de paridad para el caso nuevo en AMBOS `data.test.js` y
   `test_bot.py`, confirmar que fallan en al menos un lado con la implementación actual (así
   se sabe que el test realmente ejercita el cambio), implementar el cambio en los DOS
   lenguajes en el mismo PR/commit, y solo entonces marcar el test como pasando en ambos.

## Decisión

**Adoptar la opción 4 ahora** (barata, sin nueva infraestructura) y **dejar la opción 3
anotada como mejora futura** si el algoritmo cambia con la frecuencia suficiente para que
mantener 2 copias del bucle empiece a doler de verdad (p.ej. si el Reglamento CE 561/2006
tiene una reforma real con múltiples reglas nuevas de golpe). No se decide de antemano
construir el intérprete JSON sin esa señal — sería trabajo especulativo.

**Regla operativa a partir de ahora**: ningún cambio a `calcularEtaConParadas` o
`calcular_eta_con_paradas` se mergea sin el mismo cambio reflejado en el otro lenguaje Y un
test de paridad nuevo que cubra específicamente el caso que cambió, no solo los casos que ya
existían. Si el cambio es tan grande que sincronizar a mano se vuelve arriesgado, ESE es el
disparador para revisar la opción 3 en vez de seguir con el patrón actual.
