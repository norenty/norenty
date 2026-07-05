# Plantilla de Acuerdo de Encargado del Tratamiento (DPA) — Norenty

**Estado: PLANTILLA/BORRADOR TÉCNICO (ítem 9.14).** Estructura estándar de un DPA conforme al
art. 28 RGPD, con los datos técnicos de Norenty ya rellenos a partir del esquema real del
producto (ver `PRIVACIDAD-RAT.md`). **Los huecos marcados `[RELLENAR]` deben completarse por
cliente. Este documento NO debe firmarse sin revisión de un abogado** (mismo pendiente que
`PRIVACIDAD-RAT.md`, ítem 9.11) — es la base técnica, no el contrato final.

---

## Acuerdo de Encargado del Tratamiento

Entre:

**El Responsable del tratamiento** (Controller): `[RELLENAR — razón social del cliente]`,
con NIF `[RELLENAR]`, en adelante "el Cliente".

**El Encargado del tratamiento** (Processor): Norenty, en adelante "Norenty".

En relación con el uso por el Cliente del software de gestión de flotas Norenty (en adelante,
"el Servicio"), conforme al art. 28 del Reglamento (UE) 2016/679 (RGPD).

### 1. Objeto y duración

Norenty trata datos personales por cuenta del Cliente, según sus instrucciones documentadas
(la configuración y el uso normal del Servicio), durante la vigencia del contrato de prestación
del Servicio entre las partes, y hasta la finalización/purga de los datos conforme a la
cláusula 8.

### 2. Naturaleza y finalidad del tratamiento

Gestión operativa de una flota de transporte: seguimiento de viajes, geolocalización de
chóferes, gestión de incidencias, prueba de entrega (POD), documentación de vehículos/chóferes,
nómina derivada de datos de ejecución, y funciones de análisis operativo. Detalle completo por
tabla en `PRIVACIDAD-RAT.md` (documento vivo, referenciado como Anexo I de este DPA).

### 3. Categorías de interesados

Chóferes y gestores del Cliente. Indirectamente, clientes del Cliente si este activa el portal
público de seguimiento (datos minimizados, ver `PRIVACIDAD-RAT.md` §3).

### 4. Categorías de datos personales

Datos identificativos (nombre, email, teléfono), datos de geolocalización, datos de ejecución
laboral (valoraciones de desempeño, horarios de conducción), imágenes (fotos de prueba de
entrega), documentación de identidad/aptitud profesional (licencia, CAP). Ver inventario
completo en `PRIVACIDAD-RAT.md` §2. **No se tratan categorías especiales de datos (art. 9 RGPD)
de forma intencional** — a confirmar que ningún campo de texto libre (incidencias, notas)
introduzca datos de salud/religión/etc. por error del usuario final; el Cliente es responsable
de instruir a sus chóferes/gestores en consecuencia.

### 5. Obligaciones de Norenty como encargado

Norenty se compromete a:
- Tratar los datos únicamente según las instrucciones documentadas del Cliente (la propia
  configuración del Servicio).
- Garantizar que las personas autorizadas a tratar los datos se comprometen a confidencialidad.
- Adoptar las medidas de seguridad del art. 32 RGPD — ver lista real implementada en
  `PRIVACIDAD-RAT.md` §5 (RLS multi-tenant, hash-chain de integridad, MFA, audit log...).
- No subcontratar a otro encargado sin autorización general o específica del Cliente — ver
  lista de subencargados actuales en `PRIVACIDAD-SUBPROCESADORES.md` (Anexo II de este DPA).
  El Cliente autoriza con carácter general la subcontratación de los subencargados ya listados
  en ese anexo; Norenty notificará cualquier cambio con `[RELLENAR — plazo de preaviso, p.ej.
  30 días]` de antelación para que el Cliente pueda oponerse.
- Asistir al Cliente en la respuesta a solicitudes de derechos de los interesados (ver
  procedimiento ARCO, ítem 9.15) y en el cumplimiento de sus obligaciones de los arts. 32-36
  RGPD (seguridad, notificación de violaciones, evaluaciones de impacto).
- Notificar al Cliente sin dilación indebida ante cualquier violación de seguridad de los datos
  que le conste, en un plazo máximo de `[RELLENAR — p.ej. 72 horas]`.
- Poner a disposición del Cliente la información necesaria para demostrar el cumplimiento de
  estas obligaciones, y permitir auditorías `[RELLENAR — condiciones: preaviso, frecuencia,
  coste]`.
- Al finalizar la prestación del Servicio: suprimir o devolver todos los datos personales,
  según elija el Cliente, salvo obligación legal de conservación (p.ej. documentación de
  transporte, ver `PRIVACIDAD-RAT.md`).

### 6. Transferencias internacionales

Ninguna prevista. Todos los subencargados listados en el Anexo II operan (o están en proceso de
fijarse explícitamente) en la Unión Europea.

### 7. Medidas de seguridad (Anexo técnico)

Ver `PRIVACIDAD-RAT.md` §5 — lista viva de medidas técnicas y organizativas ya implementadas,
referenciada como parte integrante de este DPA.

### 8. Duración de la conservación tras la finalización del contrato

`[RELLENAR — plazo pactado]`. Por defecto, ver política de retención de `PRIVACIDAD-RAT.md`
(geolocalización: 90 días desde su generación, con independencia de la vigencia del contrato;
evidencia contractual — ejecución de eventos, POD —: se conserva el plazo legal aplicable a la
documentación de transporte, a determinar con 9.11).

---

**Anexos de este DPA** (documentos vivos, git-trackeados, se actualizan sin necesidad de
renegociar el DPA salvo cambio material):
- Anexo I: `PRIVACIDAD-RAT.md` (Registro de Actividades de Tratamiento)
- Anexo II: `PRIVACIDAD-SUBPROCESADORES.md` (lista de subencargados)

**Firmas**: `[RELLENAR — pendiente de versión final revisada legalmente antes de cualquier firma real]`
