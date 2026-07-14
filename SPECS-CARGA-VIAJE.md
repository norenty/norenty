# SPECS — Carga real del viaje (cierra COT.3/4 en la calculadora → llevarlo al viaje real)

Orden de trabajo cerrada (2026-07-14). Hallazgo: COT.3 (capacidad de vehículo) y COT.4
(FTL/grupaje) solo viven en `/presupuesto` (calculadora standalone) — un viaje real creado hoy NO
guarda qué carga lleva, así que se pierde esa información justo donde más importa (el viaje de
verdad, no la simulación). Cierra el círculo: la misma `calcularOcupacion` ya construida y testeada
se reutiliza, sin lógica nueva de negocio.

Protocolo: uno por iteración, `ci.ps1` verde, commit, `[x]` en ROADMAP + línea en PROGRESS.md.

---

## CARGA.1 — Migración `viaje.carga_ldm/carga_kg/carga_m3` `[sonnet, bajo]`

- `backend/db/migrations/0052_viaje_carga.sql`: DDL puro, cabecera de reversión. Tres columnas
  `numeric` nullable en `viaje` (mismo patrón que `vehiculo.capacidad_*` de COT.3).
- Aplicar con `migrate.py`. Verificar Grupo B: columnas existen, nullable.

## CARGA.2 — `createViaje` acepta y persiste la carga `[sonnet, bajo]`

- `createViaje({..., carga = null})` — `carga` opcional `{ldm, kg, m3}` (strings o números, sin
  parsear estricto, mismo criterio que el resto de la función). Añadir al insert de `viaje`:
  `carga_ldm`, `carga_kg`, `carga_m3` (cada uno `Number(...)` si viene, si no `null`).
  Retrocompatible: sin `carga`, las 3 columnas salen `null` (llamadas existentes no cambian).
- Tests: guarda las 3 dimensiones si se pasan; sin `carga`, las 3 quedan `null`.

## CARGA.3 — Wizard `/viajes/nuevo-w`: capturar carga + ver ocupación en vivo `[sonnet, bajo]`

- Extender el `select` de vehículos a incluir `capacidad_ldm, capacidad_kg, capacidad_m3` (ya
  existen desde COT.3).
- Nueva sección "Carga" (mismo sitio que la sección "Simulación" de `/presupuesto`, estilo
  consistente): 3 inputs (LDM/kg/m³), estado `carga = {ldm:"", kg:"", m3:""}`.
- Panel lateral (`calcularPanelViaje` ya se recalcula con debounce al cambiar hitos/vehículo/
  precio — añadir `carga` a las dependencias del `useEffect`): si el vehículo elegido tiene
  capacidad configurada, mostrar la misma barra de ocupación + badge FTL/grupaje que ya existe en
  `/presupuesto` (reutilizar `calcularOcupacion` importada de `data.js`, NO reimplementar).
- `crear()` pasa `carga` a `createViaje`.
- Verificación: `ci.ps1` (build+lint) — ruta exige sesión.

## CARGA.4 — `/viajes/[id]`: mostrar carga + ocupación del viaje real `[sonnet, bajo]`

- Extender el `select` de vehículo en la carga de la página para incluir `capacidad_ldm,
  capacidad_kg, capacidad_m3`.
- Si `viaje.carga_ldm/kg/m3` tiene algún valor Y el vehículo tiene capacidad configurada: sección
  "Carga" con los 3 valores + el mismo badge FTL/grupaje (`calcularOcupacion`), en el mismo sitio
  visual que la sección de Viabilidad/margen ya existente.
- Sin tests nuevos de lógica (reutiliza `calcularOcupacion`, ya testeado en COT.4); verificación
  por `ci.ps1`.

---

**Al cerrar CARGA.4:** `PushNotification` con el resumen + DETENER el loop.
