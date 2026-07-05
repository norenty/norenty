# Procedimiento de derechos ARCO (Acceso, Rectificación, Cancelación, Oposición)

**Estado: BORRADOR TÉCNICO (ítem 9.15).** Procedimiento manual hoy — no hay UI dedicada, solo las
funciones de soporte en `dashboard/lib/data.js` que un admin ejecuta (desde la consola del
navegador o una futura pantalla) cuando llega una solicitud real. Marcado como borrador técnico,
no asesoramiento legal — el criterio final de qué se puede negar y por qué depende de 9.11.

## 0. Quién puede ejercer estos derechos

Principalmente **chóferes** (empleados/colaboradores de la empresa cliente) sobre sus propios
datos. También gestores sobre los suyos, aunque su volumen de datos personales es menor (ver
`PRIVACIDAD-RAT.md` §2). Este documento se centra en el caso del chófer, el más completo.

## 1. Derecho de ACCESO — `getExportacionChofer(choferId)`

Recorre TODAS las tablas donde el esquema real (no supuesto) tiene una referencia al chófer y
devuelve su contenido tal cual existe: `chofer` (su propia fila), `viaje` (los que ha hecho),
`ubicacion` (las que no se hayan purgado aún, ver 9.13), `valoracion` (evaluaciones de
desempeño), `documento` (licencia/CAP), `decision_asignacion` (donde aparece como sugerido o
elegido). Es de solo lectura, permitido por RLS sin necesitar privilegios especiales.

## 2. Derecho de RECTIFICACIÓN

Ya cubierto por las pantallas normales del dashboard: `/choferes/[id]` permite editar
`nombre`/`idioma`/`telefono` (las únicas columnas de `chofer` que el dashboard puede escribir,
ver `0019_seguridad_columnas.sql:52-53` — `chat_id` es intencionalmente inmutable desde ahí, solo
lo escribe el bot). Nada nuevo que construir aquí.

## 3. Derechos de CANCELACIÓN/OPOSICIÓN — `anonimizarChofer(choferId)` y su TENSIÓN real

**La tensión que no se puede ocultar**: el hash-chain de `ejecucion_evento` (ítems 9.6/9.7) y el
hash SHA-256 de cada `pod` (ítem 9.8) incluyen `chofer_id` como parte del payload que se hashea.
**Si se modifica o se anula el `chofer_id` de una fila de `ejecucion_evento`/`pod` ya existente,
el hash guardado deja de coincidir con el recalculado** — `verificar_cadena.py`/`verificar_pod.py`
lo señalarían como "cadena rota", indistinguible de una manipulación maliciosa real. Por eso
**estas dos tablas NUNCA se tocan** en una solicitud de cancelación, ni siquiera para anonimizar
la referencia. Es una decisión de diseño, no un descuido — la evidencia de ejecución del
servicio (hora de llegada, POD) es además previsiblemente amparada por la excepción del art.
17.3 RGPD (necesidad de conservar prueba para el cumplimiento de obligaciones contractuales/
ejercicio de reclamaciones legales) — a confirmar con el abogado (9.11), no una suposición
definitiva de este documento.

**Qué SÍ se anonimiza/borra, en este orden** (respeta FKs, no rompe nada):

1. `documento` (ámbito `chofer`, licencia/CAP) — **se borra** por completo. No tiene cadena de
   integridad; una vez transcurrido el plazo legal de conservación de documentación de
   transporte (a determinar con 9.11), no hay motivo para retenerlo.
2. `chofer.nombre`/`chofer.telefono` — **se sustituyen** por un valor neutro
   ("Chófer eliminado a petición propia" / `null`). Son las ÚNICAS columnas de `chofer` que el
   dashboard puede escribir (0019); `idioma` se deja (no es un dato identificativo).

**Qué NO se toca desde `lib/data.js` (limitaciones honestas, documentadas, no escondidas)**:

- `chofer.chat_id` — el dashboard NO tiene permiso de escritura sobre esta columna (0019, a
  propósito, para que solo el bot pueda vincular Telegram). Desvincularlo de verdad requiere un
  script con la service role key (fuera de alcance de `lib/data.js`; candidato para un script en
  `backend/db/` si se necesita con frecuencia — hoy, desactivar al chófer con `desactivarGestor`-
  style (si aplica) o simplemente dejar de asignarle viajes cumple el objetivo práctico).
- `ubicacion` — el dashboard tiene **REVOKE total de INSERT/UPDATE/DELETE** sobre esta tabla
  (0019: `authenticated` es solo lector). Un borrado inmediato a petición del chófer (en vez de
  esperar los 90 días de la purga automática, ítem 9.13) requiere ejecutar
  `backend/db/purgar_ubicacion.py` (o una variante con filtro por chófer, no construida hoy —
  candidato de ampliación si hace falta) con `DATABASE_URL`, no desde el dashboard.
- `ejecucion_evento`, `pod` — nunca, por la tensión de integridad explicada arriba.
- `valoracion`, `decision_asignacion` — se **dejan intactas** a propósito: son registros de
  desempeño/decisión de la EMPRESA sobre su propia operación (no exclusivamente "datos del
  chófer" en el sentido de que él los generó), análogos a un expediente laboral interno. Si un
  chófer concreto pide su cancelación, la posición por defecto es no borrarlos salvo que 9.11
  determine lo contrario — anotado como pregunta abierta, no resuelta unilateralmente aquí.

## 4. Orden de ejecución recomendado

1. Verificar identidad del solicitante (fuera de alcance técnico — proceso de la empresa cliente).
2. `getExportacionChofer(choferId)` — para poder ofrecer el export si el chófer también pide
   acceso a la vez (frecuente en la práctica).
3. `anonimizarChofer(choferId)` — borra `documento`, anonimiza `chofer.nombre`/`telefono`.
4. Si se pide además el borrado de `ubicacion` inmediato: ejecutar
   `purgar_ubicacion.py` manualmente (borra TODO lo de más de N días, no solo de este chófer —
   ajustar `--dias` a 0 si se quiere purgar todo lo existente, con cuidado de que afecta a TODA
   la empresa, no solo a este chófer — limitación explícita, no next-day fix).
5. Documentar la solicitud atendida (fecha, alcance, qué se hizo y qué se negó y por qué) — no
   hay tabla dedicada hoy; usar `nota_gestor` o un registro externo hasta que se decida si
   merece su propia tabla.
