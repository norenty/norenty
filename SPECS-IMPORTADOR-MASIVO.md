# SPECS — Importación masiva de chóferes y vehículos

Orden de trabajo cerrada para el loop autónomo (2026-07-14). Continúa el Pilar B del plan de
solidificación ("ingesta sin fricción") y responde directamente a la preocupación del usuario:
"ingesta de datos de chóferes" en el mismo turno donde se decidió el cotizador.

**Problema real, verificado en el código:** `/importar` (página existente) importa VIAJES, y para
enlazar cada fila con su chófer/vehículo busca por nombre/matrícula EN LO YA EXISTENTE
(`getChoferes()` + `select vehiculo`) — pero no hay forma de dar de alta chóferes o vehículos en
masa. Con 30-60 chóferes, la única vía hoy es el formulario de alta uno-a-uno (`/choferes`,
`/vehiculos`). Antes de poder importar un CSV de viajes de una flota real, primero hay que poder
importar sus chóferes y vehículos.

**Infra reutilizable ya existente (no reinventar):** `dashboard/lib/importar.js` —
`parseFile(file)` (csv/tsv/xlsx/xls genérico) y `autoMapColumns(fileColumns, aliases)` YA son
agnósticos del tipo de entidad (el segundo parámetro `aliases` no existe todavía como parámetro —
hoy `autoMapColumns` tiene los alias de VIAJE hardcoded dentro; hay que parametrizarlo, ver IMP.1).
`createChofer({nombre, idioma})` ya existe en `data.js`. No hay `createVehiculo` — el alta de
vehículo se hace hoy con `supabase.from("vehiculo").insert(...)` directo en `/vehiculos/page.jsx`.

---

## IMP.1 — Generalizar `autoMapColumns` a distintos juegos de alias `[sonnet, bajo]`

- Cambiar la firma: `autoMapColumns(fileColumns, aliases)` — el segundo argumento (objeto
  `campo -> [alias...]`) deja de estar hardcoded dentro de la función, se pasa desde fuera.
- Mover el objeto `aliases` actual (líneas 45-55 de `importar.js`) a una constante exportada
  `ALIAS_VIAJE` en el mismo archivo.
- **Retrocompatibilidad**: `/importar/page.jsx` (import de viajes) pasa `ALIAS_VIAJE` explícito en
  su única llamada existente — el comportamiento no cambia una coma.
- Tests (`importar.test.js`, archivo nuevo — no existe todavía un test de este módulo): mover
  cualquier cobertura implícita a explícita: dado un set de columnas de ejemplo y un `aliases`
  custom, `autoMapColumns` mapea correctamente; con `aliases` vacío no mapea nada; no lanza con
  columnas vacías.

## IMP.2 — Alias y campos de chófer/vehículo + `createVehiculo` `[sonnet, bajo]`

- En `importar.js`: `CAMPOS_CHOFER = [{key:"nombre", label:"Nombre", required:true}, {key:"idioma",
  label:"Idioma (es/en/ro/fr/it/pt/de/ar)"}]` y `ALIAS_CHOFER = {nombre: [...], idioma: [...]}`.
- `CAMPOS_VEHICULO = [{key:"matricula", label:"Matrícula", required:true}, {key:"tipo",
  label:"Tipo (tractora/remolque/rigido/furgoneta)"}, {key:"marca", label:"Marca"}, {key:"modelo",
  label:"Modelo"}]` y `ALIAS_VEHICULO` correspondiente.
- En `data.js`: `createVehiculo({matricula, tipo = "tractora", marca = null, modelo = null})` —
  mismo patrón que `createChofer` (resuelve `empresa_id`, valida matrícula no vacía, `.insert()
  .select().single()`, lanza `Error` si el `error` de Supabase indica duplicado — mensaje
  "Ya existe un vehículo con esa matrícula"). Reutilizarla también en `/vehiculos/page.jsx` en vez
  del insert directo actual (mismo comportamiento, menos duplicación — pero SOLO si no cambia nada
  observable: mismo mensaje de error, misma normalización a mayúsculas de la matrícula).
- Tests: `createVehiculo` guarda con defaults, rechaza matrícula vacía, mensaje claro en
  duplicado (mock de error de constraint).

## IMP.3 — UI: selector de tipo de importación + flujo por lotes `[sonnet, bajo]`

- `/importar/page.jsx` gana un selector inicial (antes del paso "Subir archivo"): **"¿Qué quieres
  importar?"** con 3 tarjetas — Viajes / Chóferes / Vehículos. Recomendación visible: "Si es la
  primera vez, importa primero chóferes y vehículos, luego viajes" (el propio orden de dependencia).
- Según el tipo elegido, usar `CAMPOS_VIAJE`/`CAMPOS_CHOFER`/`CAMPOS_VEHICULO` y
  `ALIAS_VIAJE`/`ALIAS_CHOFER`/`ALIAS_VEHICULO` correspondientes en los pasos de mapeo/preview que
  YA existen (son genéricos, solo hay que parametrizar qué `CAMPOS_*`/`aliases` usan — no
  reescribir el stepper).
- El paso de ejecución (`ejecutarImport`) se ramifica por tipo:
  - **Chóferes**: por fila, `createChofer({nombre, idioma: idioma || "es"})`. Fila sin `nombre` →
    error de fila (no aborta el resto).
  - **Vehículos**: por fila, `createVehiculo({matricula, tipo: tipo || "tractora", marca,
    modelo})`.
  - **Viajes**: el código YA existente, sin tocar.
- Mismo patrón de resultado (`{ok, errores, total}`) y misma UI de "Paso 3: Resultado" para los 3
  tipos — no hace falta un componente nuevo, solo generalizar el texto ("N choferes importados" en
  vez de "N viajes importados").
- Verificación: `ci.ps1` (build+lint) — la ruta exige sesión, no navegable sin credenciales (regla
  de secretos). La lógica de mapeo/creación SÍ tiene tests unitarios (IMP.1/IMP.2).

---

## FUERA DE ESTE LOOP

- **Detección de duplicados al importar** (¿ya existe un chófer con ese nombre? ¿fusionar o
  crear otro?) — v2, cuando haya un caso real de re-importación. Hoy: si el nombre coincide, se
  crea un chófer NUEVO con el mismo nombre (mismo comportamiento que dar de alta dos veces a mano
  hoy — no es una regresión, es el estado actual del sistema).
- **Plantilla descargable (.xlsx de ejemplo)** por tipo — mejora de UX, no bloqueante, candidato a
  ítem propio si el usuario lo pide tras probar el importador.
