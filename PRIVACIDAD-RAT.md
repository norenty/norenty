# Registro de Actividades de Tratamiento (RAT) — Art. 30 RGPD/LOPDGDD

**Estado: BORRADOR TÉCNICO (ítem 9.12).** Redactado a partir del esquema REAL de la base de
datos (leído directamente del proyecto Supabase, no supuesto) — cada tabla listada abajo existe
tal cual hoy. La **base jurídica** marcada como "provisional" en este documento queda pendiente
de confirmación por un abogado laboralista/de privacidad (ítem 9.11 del `ROADMAP.md`,
`[DECISIÓN]` todavía no resuelta). **Este documento NO es asesoramiento legal** — es la base
técnica sobre la que un abogado debe cerrar la base jurídica definitiva antes de presentarlo a
un cliente, a una autoridad de control, o de firmarlo como parte de un DPA.

---

## 0. Roles (RGPD)

- **Responsable del tratamiento (controller)**: cada **empresa cliente** (flota de transporte)
  — decide los fines y medios del tratamiento de los datos de SUS chóferes y gestores.
- **Encargado del tratamiento (processor)**: **Norenty** — trata los datos por cuenta de cada
  empresa cliente, según sus instrucciones (el propio software). Ver `PRIVACIDAD-SUBPROCESADORES.md`
  (ítem 9.14, pendiente) para los subencargados de Norenty (Supabase, Vercel, Railway, Sentry).
- **Aislamiento entre empresas clientes**: garantizado por RLS a nivel de Postgres, probado
  contra la BD real (`dashboard/lib/isolation.test.js`, ítem 8.4) — cada empresa solo trata SUS
  propios datos, nunca los de otra empresa cliente.

## 1. Categorías de interesados (data subjects)

- **Chóferes**: empleados/colaboradores de la empresa cliente que operan el bot de Telegram.
- **Gestores**: usuarios del dashboard, empleados de la empresa cliente.
- **(Indirectamente) clientes de la flota**: si la empresa cliente comparte el portal público de
  tracking (ítem 7A.14) con SUS propios clientes — solo ven datos ya minimizados (§3).

## 2. Inventario de tratamiento por tabla

Leído de `backend/db/migrations/` y verificado contra el esquema real del proyecto Supabase.

| Tabla | Interesado | Dato personal | Finalidad | Base jurídica (**provisional**, ver 9.11) | Retención |
|---|---|---|---|---|---|
| `chofer` | Chófer | `nombre`, `telefono`, `chat_id` (Telegram), `idioma` | Identificar al chófer y operar el bot: recibir rutas, reportar incidencias, confirmar hitos | Ejecución del contrato de trabajo / interés legítimo del empleador | Mientras dure la relación laboral + plazo legal aplicable después (a fijar con 9.11). **Sin borrado automático hoy** — pendiente de 9.15 (procedimiento ARCO) |
| `gestor` | Gestor | `nombre`, `email`, `telegram_chat_id`, `auth_user_id` (vínculo a Supabase Auth), `rol` | Identificar usuarios del dashboard, control de acceso por rol (9.29), alertas | Ejecución del contrato de servicio / relación laboral del gestor con la empresa cliente | Mientras la cuenta esté activa. Al desactivar (9.29) se conserva el registro histórico para auditoría — **nunca se borra un gestor, solo se desactiva** (mismo criterio que `decision_asignacion`/`audit_log`) |
| `ubicacion` | Chófer | `lat`, `lon`, `velocidad`, `rumbo` + `chofer_id` + `created_at` | Geolocalización en tiempo real: seguimiento de la ejecución del viaje, detección automática de llegada (7A.4), posición aproximada en el portal de cliente | Interés legítimo del empleador para supervisar la ejecución de un servicio de transporte contratado, **con información previa obligatoria al trabajador** (el consentimiento NO es la base correcta en una relación laboral — ver 9.11) | **Es el dato más sensible del sistema.** Política prevista: 90 días por defecto, agregado o purgado (ítem 9.13, configurable) — **HOY NO HAY PURGA AUTOMÁTICA, pendiente honesto de construir** |
| `ejecucion_evento` | Chófer | `chofer_id`, `hito_id`, `tipo`, `detalle` (texto libre, p.ej. dirección) + hash-chain (9.6/9.7) | Evidencia de ejecución del servicio (hora de llegada/salida, subida de POD) — la "evidencia creíble" del producto | Ejecución del contrato de transporte entre la empresa cliente y su cliente final (prueba de entrega) + interés legítimo (evidencia frente a disputas) | **Años — es la evidencia contractual del servicio, NO se purga** (mismo criterio que facturas/albaranes en papel) |
| `pod` | Chófer (y, incidentalmente, quien firma/aparece en la foto) | `foto_url` (foto del albarán — puede incluir firma o rostro), `hash_sha256` (9.8) | Prueba de entrega | Igual que `ejecucion_evento` | Igual que `ejecucion_evento` — no se purga |
| `incidencia` | Chófer | `descripcion` (texto libre escrito por el chófer, puede contener datos personales incidentales) | Registro y gestión de incidencias operativas reportadas por el chófer | Ejecución del contrato + interés legítimo | Vinculada al historial del viaje — indefinida hoy, sin política explícita (a revisar) |
| `valoracion` | Chófer | `puntuacion`, `nota` (texto libre) + `chofer_id`/`gestor_id` | Evaluación del desempeño del chófer por su gestor — **dato sensible desde el punto de vista laboral** | Interés legítimo del empleador (gestión del desempeño) | Indefinida hoy — alimenta el motor de asignación (7A.2) y el histórico de desempeño; a revisar si debe tener límite (9.11/9.15) |
| `decision_asignacion` | Chófer (indirectamente) | `chofer_sugerido_id`, `chofer_elegido_id`, `motivo` (texto libre) | Registro de qué chófer se sugirió/eligió por viaje, con el motivo si el gestor no siguió la sugerencia — aprendizaje futuro del motor de asignación (7B.7) | Interés legítimo (mejora del servicio) + trazabilidad operativa | Indefinida — histórico de decisiones |
| `nota_gestor` | Chófer (mencionado, indirectamente) | `texto` libre (puede nombrar chóferes) | Cuaderno de bitácora del gestor para contexto operativo | Interés legítimo (gestión operativa) | Indefinida hoy |
| `audit_log` | Gestor | `gestor_id`, `entidad`, `accion`, `detalle` (jsonb) | Trazabilidad de quién cambió qué (estado de viaje, precio, asignación, borrado de documento, token público) — uno de los 3 pilares de seguridad del producto (Fase 9) | Interés legítimo (seguridad, prevención de fraude) + obligación de rendición de cuentas del propio RGPD (art. 5.2) | Indefinida — es la prueba de "quién tocó qué" |
| `invitacion` | Persona invitada (aún no necesariamente usuaria) | `email` | Gestión de altas de nuevos gestores | Interés legítimo (gestión de equipo) / medida precontractual | Caduca a los 7 días para su USO (ítem 9.10), pero la fila permanece hasta que un admin la revoque/borre manualmente — candidato para ampliar la purga automática de 9.13 |
| `documento` (ámbito `chofer`) | Chófer | `archivo_url` (licencia, CAP — documentos de identidad/aptitud) | Cumplimiento de obligaciones normativas de transporte (verificar documentación en vigor antes de operar un viaje) | Obligación legal (normativa sectorial de transporte) + ejecución de contrato | Mientras dure la relación laboral + plazo legal de conservación de documentación de transporte (a determinar con 9.11 — previsiblemente años tras finalizar la relación, por normativa sectorial) |
| `empresa` | — (no es una persona física) | `base_lat`/`base_lon` (sede, no de una persona) | Cálculo de noches fuera (nómina), no es dato personal de un individuo | N/A | Documentado solo por transparencia |

## 3. Datos de clientes finales de la flota (portal público, ítem 7A.14)

El token público (`viaje.token_publico`) da acceso de solo lectura, vía la función RPC
`viaje_publico()` (`SECURITY DEFINER`, verificada con tests que confirman que NO filtra de más),
a: referencia del viaje, estado, hitos, ETA, y la posición aproximada del camión (**redondeada a
~2 decimales por diseño**, ítem 7A.14/8.5, para no exponer la posición exacta del chófer).
**NUNCA** expone precio, coste, nombre completo del chófer ni matrícula. No hay dato personal
identificable de un tercero aquí más allá de la posición aproximada de un vehículo.

## 4. Transferencias internacionales

Ninguna prevista: Supabase/Vercel/Railway se fijan explícitamente en región UE (ver
`PRIVACIDAD-SUBPROCESADORES.md`, ítem 9.14, y `DEPLOY.md`).

## 5. Medidas de seguridad ya implementadas (relevantes para el art. 32 RGPD)

- RLS + aislamiento multi-tenant, probado contra la BD real (`isolation.test.js`, 8.4;
  `roles-isolation.test.js`, 9.31).
- Columnas sensibles bloqueadas por rol a nivel de Postgres (migraciones 0019, 0032-0034), no
  solo ocultas en la UI.
- Cadena hash-chain de `ejecucion_evento` (detección de alteración, 9.6/9.7) y hash SHA-256 de
  cada POD (9.8) — integridad de la evidencia, no solo confidencialidad.
- Bucket de Storage privado con URLs firmadas de corta duración (migración 0011).
- MFA opcional (TOTP) para gestores (9.10).
- Registro de auditoría de acciones críticas del dashboard (`audit_log`, 8.8).
- Rate-limiting y dedupe en el perímetro del bot (9.9).

## 6. Pendientes honestos (no fingir que ya está resuelto)

- [ ] Base jurídica definitiva del tracking del chófer — pendiente de 9.11 (consulta con abogado).
- [ ] Purga/agregación automática de `ubicacion` a 90 días — pendiente de construir (9.13).
- [ ] Procedimiento formal de derechos ARCO (acceso, rectificación, cancelación, oposición) —
  pendiente de 9.15.
- [ ] Plantilla de DPA firmable con cada cliente + página de subprocesadores — pendiente de 9.14.
- [ ] Este documento es un **borrador técnico**: necesita revisión legal antes de presentarse a
  un cliente o a una autoridad de control.

---
Generado 2026-07-05 a partir del esquema real del proyecto Supabase (`hloqddmdwinvjksqkhey`).
Si este documento y el esquema divergen en el futuro, **el esquema manda** — actualizar este
documento, no al revés.
