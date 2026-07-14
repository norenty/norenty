# SPECS — Cotizador (calculadora de rutas/presupuestos)

Orden de trabajo CERRADA para el loop autónomo (2026-07-14). Estilo `SPECS-7A.md`: cada ítem trae
archivos, firmas, SQL y casos de test. El ejecutor pica código, las decisiones ya están tomadas
aquí. Protocolo por ítem: implementar → `ci.ps1` verde → commit → `[x]` en ROADMAP + 1 línea en
PROGRESS.md → siguiente. Modelo: `sonnet` esfuerzo bajo (spec cerrada).

**Contexto:** el motor de cotización YA existe — `calcularPresupuesto({ puntos, vehiculoId })` en
`dashboard/lib/data.js:1842` calcula km (OSRM+fallback Haversine), horas de conducción, ETA con
paradas 561, coste desglosado (`calcularCosteRuta`: combustible/conductor/peajes/dietas o blended)
y precio sugerido (`coste / (1 - margen/100)`), leyendo la config de `empresa`/`vehiculo`. La
página `/presupuesto` ya lo usa. Esta spec añade las 4 capas que faltan.

**Convenciones del repo (no re-descubrir):** tests puros en `data.test.js` con `osrmMock`
(`osrmMock.mockResolvedValue(km)`) y `TABLES.empresa`/`TABLES.vehiculo`; funciones de guardado con
validación numérica que lanzan `Error` con texto claro (patrón `guardarCosteKmEmpresa`); migración
nueva vía MCP `apply_migration`, `.sql` en `backend/db/migrations/`, registrada en
`schema_migrations`; datos estimados SIEMPRE etiquetados. La página exige sesión → verificación por
`ci.ps1` (tests + build) cuando el navegador no sea alcanzable sin login (regla de secretos de
CLAUDE.md), igual que la capa de POD.

---

## COT.1 — `calcularPresupuesto` acepta overrides (what-if) `[sonnet, bajo]`

Objetivo: poder recalcular la cotización con valores hipotéticos (sube el gasoil, 78 km/h en vez
de 75, otro margen) SIN tocar la config guardada de la empresa.

- Firma nueva: `calcularPresupuesto({ puntos, vehiculoId = null, overrides = null })`.
  Retrocompatible: sin `overrides` el comportamiento es idéntico (los tests existentes deben pasar
  sin tocarse).
- `overrides` (todas las claves opcionales; `null`/`undefined` = usar la config real):
  `velocidadKmh`, `precioGasoilLitro`, `consumoL100km`, `costeKm`, `costeConductorKm`,
  `costePeajeKm`, `dietaNocheEur`, `margenObjetivoPct`.
- Implementación: helper puro `aplicarOverridesPresupuesto(empresa, vehiculo, overrides)` que
  devuelve `{ empresa, vehiculo }` con los overrides fusionados sobre los objetos cargados
  (mapeo clave override → columna: `velocidadKmh`→`velocidad_planificacion_kmh`,
  `precioGasoilLitro`→`precio_gasoil_litro`, `consumoL100km`→`vehiculo.consumo_l_100km`,
  `costeKm`→`coste_km`, `costeConductorKm`→`coste_conductor_km`, `costePeajeKm`→`coste_peaje_km`,
  `dietaNocheEur`→`dieta_noche_eur`, `margenObjetivoPct`→`margen_objetivo_pct`). Solo aplica claves
  no-nulas. Luego `calcularPresupuesto` usa los objetos efectivos en `resolveVelocidadPlanificacion`,
  `calcularCosteRuta` y el cálculo de `margenObjetivo`. Exportar `aplicarOverridesPresupuesto` para
  testearla aislada.
- Tests (Grupo A, `data.test.js`): (1) override `precioGasoilLitro` sube `coste.combustible` y
  `coste.total` (con `vehiculo.consumo_l_100km` puesto); (2) override `velocidadKmh` cambia
  `horasConduccion`; (3) override `margenObjetivoPct` cambia `precioSugerido`; (4) sin overrides el
  resultado es idéntico a llamar sin el arg; (5) `aplicarOverridesPresupuesto` con override null no
  muta el objeto original.

## COT.2 — Página calculadora con what-if en vivo `[sonnet, bajo]`

Objetivo: que un comercial teclee origen+destino, elija vehículo, y vea coste/precio recalcularse
al mover gasoil/velocidad/margen.

- Reutilizar/extender la página `/presupuesto` existente (LEERLA primero). Añadir controles
  what-if: inputs numéricos (o sliders) para precio del gasoil, velocidad media y margen objetivo,
  **prellenados con la config real de la empresa** (mostrar "por defecto: X" para que se vea de
  dónde sale). Al cambiar cualquiera, re-llamar `calcularPresupuesto` con `overrides` (debounce como
  el buscador, ~250ms) y repintar km/horas/desglose/precio.
- Un botón "Restablecer" que vuelve a los valores de la empresa (overrides = null).
- Etiquetar claramente lo que es simulación ("simulando: gasoil 1,60 €/L") vs. la config real.
- Sin migración. Verificación: `ci.ps1` (build) — la ruta exige sesión, no navegable sin login.

## COT.3 — Capacidad de vehículo + modelo de carga `[sonnet, bajo]`

DECISIÓN tomada (el usuario no eligió entre LDM y m³+kg → se usan LOS TRES, que es lo correcto del
sector; la ocupación la decide el que se llene primero):

- Migración `0050_capacidad_carga.sql` (DDL puro, cabecera de reversión): `vehiculo` gana
  `capacidad_ldm numeric`, `capacidad_kg numeric`, `capacidad_m3 numeric` (los tres nullable). Sin
  backfill. Registrar checksum.
- `data.js`: `guardarCapacidadVehiculo(vehiculoId, { ldm, kg, m3 })` con validación (números ≥ 0 o
  vacío→null; lanza `Error` claro), patrón `guardarCosteKmEmpresa`. Incluir los 3 campos en el
  formulario de `/vehiculos/[id]` (sección "Capacidad de carga").
- Tests (Grupo A): guarda los 3, vacío→null, rechaza negativo. Grupo B: columnas existen en la BD
  real, nullable.

## COT.4 — Cálculo FTL / grupaje `[sonnet, bajo]`

- Constante `export const UMBRAL_FTL_PCT = 85;` (valor inicial razonable, NO pactado — mismo estatus
  que `UMBRAL_MARGEN_AMBAR_PCT`).
- Función pura `export function calcularOcupacion(carga, capacidad)` donde
  `carga = { ldm, kg, m3 }` y `capacidad = { ldm, kg, m3 }`:
  - Para cada dimensión con capacidad > 0 y carga presente: `pct = carga/capacidad * 100`.
  - `pctOcupacion = max(pcts disponibles)`; si no hay ninguna dimensión calculable → `null`.
  - `tipo = pctOcupacion == null ? "desconocido" : pctOcupacion >= UMBRAL_FTL_PCT ? "completo" : "grupaje"`.
  - Devuelve `{ pctLdm, pctKg, pctM3, pctOcupacion, dimensionLimitante, tipo }`
    (`dimensionLimitante` = la clave del máximo: "ldm"|"kg"|"m3"|null).
- Integrar en la calculadora (COT.2): inputs de carga (ldm/kg/m³), y al haber vehículo con
  capacidad, mostrar la barra de ocupación + badge "Camión completo"/"Grupaje" + qué dimensión
  limita.
- Tests (Grupo A): limitado por peso, por volumen, por LDM; frontera 85% (completo vs grupaje);
  sin capacidad → `tipo: "desconocido"`, `pctOcupacion: null`.

---

## FUERA DE ESTE LOOP (gated — NO construir en autónomo)

- **COT.5 (escalón 3) — "basado en tu estándar / por encima-debajo".** Comparar la cotización
  contra viajes reales similares (mismo corredor / franja de km). Requiere **datos reales de viajes
  completados**, que hoy no existen (pre-piloto, `decision_asignacion`/histórico ≈ 0 filas). Sin
  datos no hay nada que comparar ni con qué validar. Se retoma post-piloto. Es la feature-foso.
- **COT.6 (escalón 4) — audio → presupuesto.** Transcripción con Whisper self-host (decidido, €0)
  + EXTRACCIÓN de origen/destino/carga de habla libre (LLM o gramática acotada). Toca infra nueva
  (proceso Whisper) y potencialmente coste por uso de LLM → cae en los "STOPS duros" del protocolo
  del loop (features que gastan dinero / infra nueva). Requiere decisión + despliegue. Última capa.

**Al terminar COT.1–COT.4:** el loop envía `PushNotification` con el resumen y se DETIENE
(`ScheduleWakeup stop`). No intentar COT.5/COT.6.
