# SPECS-23 — Fase 23, Bloque C: acoplamiento (unidad de transporte real)

Spec cerrada para 23.C.1/23.C.2 antes de picar código (convención `SPECS-7A.md`). Contexto y
citas completas en `DISCOVERY.md` insights 9, 21, 22 y `ROADMAP.md` Fase 23.

## Problema

`viaje.vehiculo_id` + `viaje.remolque_id` asumen un remolque fijo por viaje. La operación real
tiene cuatro líneas de tiempo independientes (chófer, tractora, cada remolque, viaje comercial)
que se acoplan y desacoplan libremente. Los campos viejos NO se borran (nada destructivo);
`acoplamiento` es la fuente de verdad nueva y `viaje.remolque_id` queda como dato heredado.

## Tabla `acoplamiento` (append-only, como `ejecucion_evento`)

```sql
CREATE TABLE IF NOT EXISTS public.acoplamiento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES public.empresa(id) ON DELETE CASCADE,
  tractora_id    uuid REFERENCES public.vehiculo(id) ON DELETE SET NULL, -- NULL = remolque suelto
  remolque_id    uuid NOT NULL REFERENCES public.vehiculo(id) ON DELETE CASCADE,
  posicion       smallint NOT NULL DEFAULT 1 CHECK (posicion IN (1, 2)), -- duo: 1º y 2º remolque
  chofer_id      uuid REFERENCES public.chofer(id) ON DELETE SET NULL,
  viaje_id       uuid REFERENCES public.viaje(id) ON DELETE SET NULL,
  desde          timestamptz NOT NULL DEFAULT now(),
  hasta          timestamptz, -- NULL = vigente
  motivo         text NOT NULL CHECK (motivo IN ('enganche','desenganche','cambio','suelta','correccion')),
  registrado_por text NOT NULL CHECK (registrado_por IN ('bot','gestor','sistema')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (hasta IS NULL OR hasta >= desde)
);
```

### Invariantes en índices, no en aplicación (el punto central del diseño)

```sql
-- Un remolque no puede estar acoplado a dos sitios a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_acoplamiento_remolque_vigente
  ON public.acoplamiento (remolque_id) WHERE hasta IS NULL;

-- Una tractora no puede tener dos remolques en la MISMA posición a la vez
-- (sí puede tener uno en posición 1 y otro en posición 2 -> duo).
CREATE UNIQUE INDEX IF NOT EXISTS idx_acoplamiento_tractora_posicion_vigente
  ON public.acoplamiento (tractora_id, posicion)
  WHERE hasta IS NULL AND tractora_id IS NOT NULL;
```

Un chófer no tiene índice único propio: la tractora ya lo fija indirectamente (una tractora
vigente por remolque; el chófer va con la tractora). Si dos chóferes reclamaran la misma
tractora, el índice de tractora+posición ya lo impide indirectamente vía el remolque acoplado
a ella, y `23.C.4` detecta discrepancias adicionales que un índice no puede expresar.

### `hito.remolque_id`

```sql
ALTER TABLE public.hito ADD COLUMN IF NOT EXISTS remolque_id uuid REFERENCES public.vehiculo(id) ON DELETE SET NULL;
```

Nullable, sin backfill obligatorio: un hito antiguo sin remolque asignado sigue siendo válido
(campo informativo, no bloqueante). Cuando 23.E.3 construya "orden de carga", ahí se rellenará
de forma natural.

### RLS y permisos

Mismo patrón que el resto de tablas operativas: aislamiento por `empresa_id`, lectura para
cualquier gestor activo de la empresa, escritura para roles operativos (no `solo_lectura`).

### Backfill (no destructivo)

Por cada `viaje` con `remolque_id` no nulo y `vehiculo_id` no nulo, crear una fila de
`acoplamiento` con `desde = viaje.created_at`, `hasta = NULL` si el viaje sigue
`planificado`/`en_curso`, o `hasta = viaje.created_at` (aproximado) si ya está
`completado`/`cancelado` — se marca `motivo='correccion'`, `registrado_por='sistema'` para
distinguir el dato migrado del registrado en vivo.

## Corrección de modelo encontrada al implementar 23.C.3 (2026-07-27)

Cambiar de REMOLQUE y cambiar de TRACTORA son dos hechos independientes que el esquema no separa
en entidades propias. Al implementar "soltar remolque" (cierra la fila de `acoplamiento`, que
lleva `tractora_id` Y `remolque_id` juntos), la primera versión de la función que resuelve "con
qué tractora va este chófer ahora" perdía la respuesta en cuanto el chófer soltaba un remolque —
exactamente el caso real de la lanzadera nocturna (`DISCOVERY.md` insight 9).

Resuelto sin cambiar el esquema: `_tractora_actual_de_chofer` (`backend/app/bot.py`) consulta,
en orden, (1) acoplamiento vigente con tractora, (2) el **último acoplamiento con tractora del
chófer, cerrado o no** — ésta es la pieza que faltaba —, (3) el viaje en curso
(`viaje.vehiculo_id`). Documentado aquí porque cualquier código futuro que necesite "la tractora
de un chófer" debe usar esta misma función, no re-derivarlo de `acoplamiento` vigente a secas.

## Fuera de esta spec (se especifica cuando se pique cada ítem)

- 23.C.2 (posición derivada): servicio de lectura sobre `ubicacion` + `acoplamiento`, sin tabla
  nueva. Se detalla al implementar.
- 23.C.3 (operaciones de patio en el bot) y 23.C.4 (contradicciones): consumen esta tabla, no la
  modifican de estructura.
