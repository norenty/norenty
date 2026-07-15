# SPECS — Fase 13: valor comercial/financiero + rutas (paridad con TMS)

Orden de trabajo cerrada (2026-07-15). Features que un TMS competidor tiene y que Norenty puede
construir sobre datos que YA existen. Ejecución: `sonnet`, esfuerzo bajo (specs cerradas aquí).
Protocolo de siempre: un ítem por iteración, `ci.ps1` verde, commit, `[x]` en ROADMAP + línea en
PROGRESS.md.

**Principio que aplica a todo:** ninguna feature de aquí inventa datos nuevos de negocio — todas
son presentación/export/composición sobre lo ya construido (precio, gasto_viaje, cliente, POD +
hash, eventos, OSRM). Datos estimados siempre etiquetados como tales.

**Orden de ejecución recomendado:** F13.1 → F13.2 → F13.3 → F13.4 → F13.5 → F13.6. F13.7 (firma)
queda `[DECISIÓN]`, gated por el discovery del sábado.

---

## F13.1 — Export para facturación / integración (CSV + Excel) `[sonnet, bajo]`

NO es un módulo contable (decisión del usuario) — es sacar los datos en un formato que su gestoría
o su ERP (SAP/similar) pueda ingerir, en vez de teclearlos a mano.

- `getDatosFacturacion({ desde, hasta, clienteId = null })` en `data.js`: por cada viaje
  `completado` en el rango (filtrable por cliente), devuelve una fila plana con: referencia,
  cliente (nombre + CIF), fecha de completado, origen, destino, km, precio, coste estimado, margen,
  y suma de `gasto_viaje` por tipo (repostaje/peaje/multa/dieta). Reutiliza `getMetricasRentabilidad`
  y las queries que ya existen — no query nueva de negocio, composición.
- Página/sección `/facturacion` (o pestaña en `/analitica`): selector de rango + cliente, tabla, y
  dos botones: "Exportar CSV" y "Exportar Excel". Reutilizar el patrón de export CSV que YA existe
  en `/nomina` y `/viajes` (mismo helper de descarga); para Excel usar `xlsx` (ya es dependencia,
  la usa `lib/importar.js` — `XLSX.utils.json_to_sheet` + `XLSX.writeFile`).
- Cabeceras de columna en español y estables (un mapeo de integración depende de que no cambien):
  documentarlas en un comentario. Sin IVA/asientos — eso es de la gestoría.
- Tests (Grupo A): `getDatosFacturacion` agrega bien varios viajes, filtra por cliente, suma los
  gastos por tipo. El export en sí (descarga de fichero) no se testea (es DOM), la lógica sí.

## F13.2 — Dossier de evidencia para reclamaciones `[sonnet, bajo]`

El diferenciador real (cadena de hash + POD + GPS + timestamps) convertido en algo enseñable a un
cliente en una disputa. Ningún TMS competidor tiene esto.

- `getDossierViaje(viajeId)` en `data.js`: reúne todo lo probatorio de un viaje — referencia,
  cliente, chófer, cada hito con su hora de llegada real (evento `llegada`), cada POD con su
  `hash_sha256` y `created_at`, checkpoints cruzados, y (si hay) la última ubicación. Solo lectura,
  composición de datos ya existentes.
- Botón "Dossier de evidencia (PDF)" en `/viajes/[id]`: abre una vista imprimible
  (`/viajes/[id]/dossier` o un modo `?dossier=1`) con estilos `print:` (mismo patrón que el informe
  imprimible de `/nomina`), lista cronológica de eventos + los hashes en monoespaciada + las fotos
  POD (vía `PodImage`/URL firmada). El usuario imprime a PDF con `window.print()`.
- Texto de cabecera fijo explicando qué es la cadena de hash ("cada registro lleva una huella
  criptográfica encadenada; alterar cualquiera invalida las siguientes") — es el argumento de venta.
- Sin tests nuevos de lógica pesada (composición de lecturas ya testeadas); un test Grupo A de que
  `getDossierViaje` no lanza y devuelve la forma esperada con datos fixture.

## F13.3 — Rendimiento / SLA por cliente `[sonnet, bajo]`

- `getMetricasPorCliente(rango)` en `data.js`: agrupa por `cliente_id` — nº de viajes, %
  puntualidad (reutiliza la señal `fuera_de_ventana`/`getPlanVsReal` ya existente), nº de
  incidencias, margen medio. Excluye viajes sin cliente asociado (los agrupa como "Sin cliente").
- Nueva pestaña "Clientes" en `/analitica` (mismo patrón que las pestañas existentes
  Puntualidad/Incidencias/Chóferes/Flota/Gestores): tabla ordenable por volumen. Admin-only si el
  resto de vistas financieras lo son.
- Tests (Grupo A): agrupa por cliente, cuenta viajes/incidencias, calcula puntualidad, maneja el
  grupo "Sin cliente".

## F13.4 — Panel ejecutivo cotización vs. real (visual) `[sonnet, bajo]`

El cálculo ya existe (`getMetricasRentabilidad`, `getTendenciaVerdadObservada`); falta la vista que
un dueño enseñaría en una reunión.

- En `/analitica` vista Rentabilidad: añadir un gráfico de barras CSS simples (SIN librería nueva,
  mismo criterio que 4.5) mostrando margen estimado vs. margen real por mes (usando
  `getTendenciaVerdadObservada`, que ya guarda snapshots), y la desviación media (% de viajes donde
  el real se apartó del estimado más de un umbral).
- Etiquetar claramente "estimado" vs "real". Reutilizar el componente `Variacion` (12.2) donde
  encaje.
- Tests: solo si se añade lógica de agregación nueva; si es pura presentación sobre funciones ya
  testeadas, verificación por `ci.ps1` (build).

## F13.5 — Aviso proactivo de descanso 561 (bot) `[sonnet, bajo]`

Hoy el ETA-561 (`getEtaViaje`, 5.3) calcula dónde caen los descansos, pero nadie avisa al chófer —
hay que consultarlo. Versión proactiva HONESTA (sin tacógrafo real, que es 7B.4): al recibir
ubicación (`handle_location`), si el tiempo estimado de conducción acumulado del viaje en curso
supera el umbral de pausa (4,5h) y aún no se ha avisado, empujar un mensaje "te toca una pausa de
45 min pronto".

- **Alcance v1 explícito y etiquetado**: es una ESTIMACIÓN por km recorridos / velocidad de
  planificación (misma base que `getEstado561`), NO horas reales de tacógrafo. Conservadora. Se
  avisa UNA vez por umbral cruzado (dedup en `chat_data` como la geo-llegada), nunca en bucle.
- Nueva clave `aviso_pausa_561` en los 8 idiomas de `TEXTOS`.
- `debe_avisar_pausa(horas_conduccion_estimadas, ya_avisado)` pura y testeable.
- Tests (`test_bot.py`): la función pura (por debajo del umbral no avisa, por encima sí, ya_avisado
  no repite) + que `handle_location` dispara el aviso una sola vez.

## F13.6 — Optimización de rutas multiparada (SUGERENCIA) `[sonnet, bajo→medio]`

**⚠️ Override consciente de `CLAUDE.md`** ("no planificamos rutas"): el usuario decide construirlo
(2026-07-15), pero como SUGERENCIA (reordenar para minimizar km, el gestor aprueba), NO como
dispatch automático — coherente con el principio "automatiza el 80%, explica el 100%".

- `sugerirOrdenParadas(hitos)` puro en `data.js`: dado un conjunto de hitos con lat/lon, propone un
  orden que minimiza los km totales por carretera (OSRM, con fallback Haversine ya existente,
  `kmCarreteraViaje`). v1 CONSERVADORA: **fija el primer hito (origen) y el último (destino
  final)** y solo reordena los intermedios — evita proponer un orden que rompa la lógica de
  recogida-antes-que-entrega. Para N intermedios pequeño (≤ ~7): fuerza bruta sobre las
  permutaciones; si hay más, nearest-neighbor + 2-opt. Devuelve `{ ordenSugerido: [...ids],
  kmActual, kmSugerido, ahorroKm }`. Si el ahorro es ≤ umbral (p.ej. 2%), devolver que no merece
  la pena reordenar (evita ruido).
- **Respetar recogida/entrega**: NO mezclar el orden si eso pusiera una entrega antes de su
  recogida — v1 simple: solo reordena dentro de hitos del mismo tipo, o directamente solo cuando
  todos los intermedios son del mismo tipo. Documentar la limitación; la versión que respeta
  precedencias recogida→entrega es v2.
- UI en `/viajes/nuevo-w`: botón "Sugerir orden óptimo" en el paso de paradas; si hay ahorro,
  muestra "Ahorro estimado: X km" y un botón "Aplicar" que reordena los hitos en el formulario. El
  gestor decide — nunca se aplica solo.
- Tests (Grupo A): con 3-4 puntos en línea, sugiere el orden que minimiza km (OSRM mockeado);
  ahorro por debajo del umbral → no sugiere; respeta origen/destino fijos.

---

## F13.7 — Firma digital en la entrega `[DECISIÓN]` (gated por discovery del sábado)

Estándar en última milla (paquetería). Para transporte de flota propia hay que ver CÓMO operan el
albarán hoy antes de construir: ¿el POD por foto ya cubre la "prueba de entrega firmada"?, ¿el
cliente firma en papel que luego se fotografía (entonces ya lo tenemos)?, ¿hace falta firma en
pantalla del móvil del chófer/receptor? Preguntar el sábado (`DISCOVERY-GESTOR.md`). No construir
hasta saberlo — probablemente el flujo de POD por foto ya está "no desencaminado" (palabras del
usuario) y solo falte, como mucho, una captura de firma en canvas anexa a la foto.
