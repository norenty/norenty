# SPECS — Fase 14: brainstorm de continuidad (2026-07-15)

Ideas planteadas en el chat del 2026-07-15 tras cerrar la Fase 13, confirmadas por el usuario
como pendientes a construir. Los `[DECISIÓN]` (F14.5-F14.7) quedan anotados pero no se ejecutan
sin criterio del usuario — ver cada uno para el motivo concreto.

---

## F14.1 — Aviso ITV/seguro que choca con un viaje ya asignado `[sonnet, bajo]`

`/documentos` ya avisa de documentos por caducar, pero es una lista plana sin cruzar con la
operación: hoy no hay forma de ver que un vehículo con ITV pendiente para el día 20 tiene un
viaje asignado que termina el día 22.

- `getConflictosMantenimientoViaje()` en `data.js`: trae `mantenimiento_vehiculo` con
  `tipo='itv', estado='pendiente'` y fecha no nula, cruza por `vehiculo_id` contra `viaje` con
  `estado` en `['planificado','en_curso']` que tengan ese `vehiculo_id`, y de esos viaje trae su
  hito de mayor `orden` con `ventana_fin` (fecha estimada de fin). Conflicto = `ventana_fin` del
  viaje > `fecha` del vencimiento. Devuelve lista de `{ vehiculoId, matricula, fechaVencimiento,
  viajeId, referencia, fechaFinViaje }`.
- Sin `ventana_fin` en ningún hito del viaje → no se puede evaluar, se omite (no falso positivo).
- Tarjeta "Conflictos ITV/viaje" en `/documentos` (arriba de la lista de documentos, mismo
  patrón visual), o badge en la fila del vehículo si ya se muestra ahí — más simple: sección
  nueva en `/documentos`, reutilizando el layout de tarjeta existente.
- Tests (Grupo A): detecta conflicto real, no detecta si el viaje termina antes del vencimiento,
  omite sin `ventana_fin`.

## F14.2 — Alerta de "hueco sospechoso" en la cadena de ubicación `[sonnet, bajo]`

`ubicacion` ya guarda pings (UBI.1); hoy nadie avisa si un viaje `en_curso` lleva mucho sin
ninguno — podría ser el chófer con el móvil apagado, sin cobertura, o la app cerrada.

- `detectarHuecoUbicacion(ultimoPing, ahora, umbralHoras)` puro en `data.js`: si no hay ningún
  ping o el último es más antiguo que `umbralHoras` (3h, valor inicial razonable, mismo estatus
  que otros umbrales del proyecto), devuelve `{ hueco: true, horasSinSeñal }`.
- `getViajesConHuecoUbicacion()`: para cada viaje `en_curso` con chófer asignado, el último ping
  de `ubicacion` de ese chófer; aplica `detectarHuecoUbicacion`. Devuelve los que tienen hueco.
- Sección en `/mapa` o tarjeta en la home (`ResumenHoy`) — más consistente con el patrón
  existente: añadir a `getResumenHoy()` un campo `huecosUbicacion` y una tarjeta más en
  `ResumenHoy.jsx` (ya son 5, sería la 6ª, incluir en el grid).
- Tests: detecta hueco con último ping antiguo, no detecta con ping reciente, no marca viajes sin
  chófer asignado o sin ningún ping todavía (viaje recién empezado, se le da margen).

## F14.3 — Reasignación sugerida si un viaje se queda sin chófer a mitad de ruta `[sonnet, medio]`

`SugerenciaChofer` (componente) ya sugiere chófer para viajes nuevos vía `sugerirChofer(...)`.
Falta el caso: un viaje `en_curso` pierde su chófer (el gestor lo desasigna, ej. por baja) y hay
que sugerir uno para CONTINUAR la ruta, no para empezarla.

- Reutilizar `sugerirChofer` tal cual — la función ya opera sobre hitos con lat/lon, no le
  importa si el viaje es nuevo o está a medias. El único trabajo real es de UI: en
  `/viajes/[id]`, cuando `viaje.estado === 'en_curso'` y `!viaje.chofer_id`, mostrar
  `<SugerenciaChofer>` en vez de (o además de) el selector manual que ya existe para "Sin
  asignar".
- Comprobar que `SugerenciaChofer` acepta hitos ya parcialmente completados sin romperse (pasar
  solo los hitos `pendiente`, no toda la ruta desde el origen — sugerir sobre lo que queda, no
  sobre el trayecto ya hecho).
- Tests: Grupo A si se toca la lógica de filtrado de hitos pendientes; si es solo cableado de UI
  sobre una función ya testeada, verificación por build.

## F14.4 — Comparativa "antes/después" para founding partners `[sonnet, bajo]`

`verdad_observada` (10.9) ya guarda snapshots pero hoy nadie los enseña de forma legible — es la
prueba más honesta de que el producto mejora algo real, y el argumento de venta más fuerte para
un founding partner.

- Página nueva `/analitica` vista "Evolución" (o sección dentro de Rentabilidad si encaja mejor):
  usa `getTendenciaVerdadObservada()` (ya existe) para listar los snapshots ordenados por fecha,
  con `BarraDoble` (F13.4, ya construido) mostrando `pct_hitos_a_tiempo` y
  `desviacion_coste_pct_media` por snapshot.
  **Nota de honestidad**: si hay 0 o 1 snapshot, mostrar "Aún no hay histórico suficiente —
  genera un snapshot mensual desde Ajustes" (no inventar una gráfica vacía como si fuera un
  fallo). `crearSnapshotVerdadObservada()` ya existe pero no tiene botón en la UI — añadir uno en
  Ajustes (admin-only) para poder generar el primer snapshot manualmente hasta que exista cron.
- Tests: Grupo A de que la vista no lanza con 0/1/N snapshots.

---

## F14.5-F14.7 — `[DECISIÓN]`, no se ejecutan sin el usuario

- **F14.5 (resumen de jornada)**: falta decidir el disparador (hora fija vs. al completar el
  último hito) — no es mecánico.
- **F14.6 (foto en incidencia desde el chat)**: amplía el flujo conversacional del bot (nuevo
  estado de conversación), más alcance que un ítem `[LOOP]` de una sola función.
- **F14.7 (página pública de fiabilidad)**: implica decidir qué cifras son seguras de exponer
  públicamente y con qué disclaimers — riesgo reputacional si se hace sin criterio.
