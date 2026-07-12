# Norenty — Runbooks de incidentes

Procedimientos operativos para los 5 incidentes más probables (ítem 9.20 del roadmap).
Este documento cubre **diagnóstico y respuesta en caliente**; no duplica:
- [RUNBOOK.md](RUNBOOK.md) — backup/restore de la base de datos y Storage.
- [RUNBOOK-SECRETS.md](RUNBOOK-SECRETS.md) — procedimiento genérico de rotación de cada secreto.

Cuando un incidente requiera rotar un secreto, este documento remite a la sección
correspondiente de `RUNBOOK-SECRETS.md` en vez de repetir los pasos.

---

## 1 — Bot caído (no responde en Telegram)

**Síntoma:** los chóferes no reciben respuesta al escribir al bot; en el dashboard (`/ajustes`)
el "Estado del bot" no pasa a "activo" o lleva más de 2-3 min sin heartbeat (`bot_heartbeat`,
ítem 8.3).

**Actualización (ítem 10.5, 2026-07-12):** si `backend/db/monitor_heartbeat.py` está programado
(ver `ONBOARDING.md §8b`), este síntoma ya no depende de que alguien mire el dashboard — manda
Telegram automáticamente a los gestores con chat vinculado en cuanto el heartbeat lleva >5 min
caído, y avisa también cuando se recupera. Si no está programado todavía (nadie lo ha puesto en
una Tarea Programada/cron), el diagnóstico manual de abajo sigue siendo necesario.

**Diagnóstico (en orden, para no perder tiempo):**
1. **¿Es un problema nuestro o de Supabase/Telegram?** Mirar https://status.telegram.org y el
   status de Supabase (`https://status.supabase.com`). Si hay incidente ahí, no hay nada que
   arreglar de nuestro lado — ver también §2 "Supabase degradado" más abajo, que documenta un
   caso real de este session en que un banner de "org degradada" se confundió con un bug de login.
2. **¿El proceso del bot está vivo?** Si corre en local: comprobar la ventana/proceso de
   `python -m backend.run_bot` (o el proceso que lo lanzó). Si corre en Railway: panel del
   servicio → pestaña "Deployments" → ver si el último deploy está "Active" o si ha crasheado
   (estado "Crashed"/"Failed").
3. **Logs.** Local: la consola donde corre el proceso (logging estructurado JSON, ítem 9.5 —
   buscar el último `ERROR` o traceback). Railway: pestaña "Logs" del servicio.
4. **Causas más probables, de más a menos frecuente:**
   - `TELEGRAM_BOT_TOKEN` inválido o revocado → el bot arranca pero Telegram rechaza todas las
     llamadas. Ver "clave rotada a medias" (§5) y `RUNBOOK-SECRETS.md §4`.
   - Excepción no capturada que tumbó el proceso (buscar traceback en logs). Si es reproducible,
     es un bug de código — no un incidente operativo puro.
   - Sin `DATABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` tras un redeploy que perdió variables de
     entorno (revisar Railway → Variables antes de asumir que es un bug).

**Respuesta:**
1. Si el proceso murió: reiniciarlo (Railway → "Redeploy"; local → relanzar el proceso). **No
   matar procesos `python` genéricos** — apuntar específicamente al proceso del bot (ver memoria
   de sesión sobre este mismo error).
2. Verificar heartbeat en `/ajustes` en los 2 min siguientes al reinicio.
3. Mandar `/estado` al bot desde un chófer de prueba en Telegram para confirmar que responde de
   verdad, no solo que el proceso está "up".
4. Si la causa fue un token inválido, seguir `RUNBOOK-SECRETS.md §4` para rotarlo correctamente.

---

## 2 — Supabase degradado o caído

**Síntoma:** el dashboard no carga datos, el login falla con error genérico, o el bot no puede
leer/escribir en la BD. **Antes de investigar nada del lado nuestro**, comprobar
`https://status.supabase.com` y, si se tiene acceso, el banner de estado en la propia consola de
Supabase (organización → aparece un aviso si el proyecto o la org está degradado/pausado).

**Caso real de esta sesión:** un banner de "organización degradada" en el panel de Supabase se
confundió inicialmente con un problema de contraseña de login del propio usuario — la contraseña
era correcta, el problema era una incidencia de infraestructura de Supabase, no nuestra. **Lección:
siempre descartar el status de Supabase ANTES de asumir que el problema es una clave mal puesta o
un bug de nuestro código.**

**Diagnóstico:**
1. Status page de Supabase (arriba). Si hay incidente reportado ahí: es un problema de su
   infraestructura, no nuestro. Comunicarlo a los usuarios del dashboard si aplica y esperar.
2. Si el status page está verde: probar una query simple desde el SQL Editor del panel de
   Supabase. Si eso también falla, es su plataforma aunque no lo hayan publicado aún.
3. Si el SQL Editor funciona pero el dashboard/bot no: el problema es nuestro (clave rotada a
   medias — ver §5 — o un bug de código), no de Supabase.

**Respuesta:**
- Si es Supabase: no hay mitigación posible más que esperar. Documentar la ventana de caída en
  `PROGRESS.md` (hora de inicio/fin, referencia al incidente de status.supabase.com si lo
  publican) para tener histórico de disponibilidad real del proveedor.
- Si el proyecto aparece "Pausado" (plan free tras inactividad prolongada): panel de Supabase →
  botón "Restore project". Puede tardar varios minutos en volver a estar operativo.

---

## 3 — Webhook roto (modo producción con `BOT_WEBHOOK_URL`)

**Síntoma:** el bot no recibe mensajes en absoluto (a diferencia de "caído", donde el proceso ni
arranca; aquí el proceso está vivo pero Telegram no le está entregando updates). Solo aplica
cuando se opera en modo webhook (`BOT_WEBHOOK_URL` definida) — en desarrollo con polling este
incidente no puede ocurrir.

**Diagnóstico:**
1. Comprobar el registro actual del webhook contra la API de Telegram:
   ```
   https://api.telegram.org/bot<TOKEN>/getWebhookInfo
   ```
   (pegar la URL en el navegador o `curl`, sustituyendo `<TOKEN>` por el token real — **nunca
   pegar el token en un chat o log compartido**). La respuesta indica `url`, `last_error_date`,
   `last_error_message` y `pending_update_count`.
2. **Causas más probables:**
   - `url` no coincide con el endpoint real desplegado (p.ej. tras cambiar de dominio en Railway
     sin volver a llamar `setWebhook`).
   - `last_error_message` con un 401/403 → normalmente `X-Telegram-Bot-Api-Secret-Token` no
     coincide, es decir `BOT_WEBHOOK_SECRET` desincronizado entre Railway y el registrado en
     Telegram (ver §5 y `RUNBOOK-SECRETS.md §5`).
   - `pending_update_count` alto y creciendo → Telegram no puede entregar updates, normalmente
     porque el endpoint devuelve error o timeout (mirar logs del servicio en Railway).
   - Certificado TLS caducado/inválido en el dominio del webhook (Telegram exige HTTPS válido).

**Respuesta:**
1. Si la URL registrada es la incorrecta o el secreto no coincide: volver a llamar `setWebhook`
   con la URL y `secret_token` correctos (ver `DEPLOY.md §2` para el comando exacto).
2. Verificar con `getWebhookInfo` de nuevo que `last_error_date` no sigue avanzando.
3. Mandar un mensaje de prueba desde un chófer de prueba y confirmar que llega (heartbeat +
   respuesta).
4. Si `pending_update_count` es muy alto, Telegram reintentará entregar los updates pendientes
   una vez el webhook vuelva a responder 200 — no hace falta limpiarlos manualmente salvo que se
   quiera descartarlos explícitamente con `dropPendingUpdates=true` en `setWebhook` (esto
   **descarta mensajes reales de chóferes** — usar solo si se decide conscientemente ignorarlos).

---

## 4 — Proveedor LLM caído (cuando exista integración — Fase 7B)

**Estado actual: no aplica todavía.** Hoy no hay ninguna llamada a un proveedor LLM en
producción (Whisper/voz, triaje AI, agente telefónico son ítems de Fase 7B, no implementados).
Este runbook se deja preparado para cuando se active esa fase, según `RUNBOOK-SECRETS.md §8`.

**Cuando exista la integración, el procedimiento será:**
1. Comprobar la status page del proveedor (p.ej. `status.anthropic.com`, `status.openai.com`).
2. Si el proveedor está caído: la funcionalidad que dependa de él debe **degradar
   explícitamente** (mensaje claro al usuario de "función no disponible temporalmente", nunca un
   error silencioso ni un colgado indefinido) — esto debe diseñarse en la propia integración
   cuando se construya, no improvisarse durante el incidente.
2. Si el proveedor está operativo pero las llamadas fallan: revisar cuota/rate-limit (alertas de
   presupuesto recomendadas en `RUNBOOK-SECRETS.md §8`) y validez de la API key.
3. Ninguna función del bot core (asignación de viajes, POD, ubicación) depende de un LLM —
   un fallo de proveedor LLM nunca debe tumbar el flujo operativo principal. Si en el futuro se
   introduce una dependencia dura, ese acoplamiento es en sí mismo un defecto de diseño a corregir,
   no algo que este runbook deba justificar.

---

## 5 — Clave rotada a medias (nueva puesta en un sitio, vieja aún activa en otro)

**Síntoma:** comportamiento inconsistente — funciona desde un sitio (p.ej. el SQL Editor de
Supabase) pero no desde otro (el bot, el dashboard), o funciona un rato y luego deja de
funcionar sin cambios aparentes. Es la firma típica de que **un secreto se actualizó en un
store de entorno pero no en otro**, o se revocó el viejo antes de confirmar que el nuevo
funcionaba en todos los consumidores.

**Caso real de esta sesión:** al rotar `DATABASE_URL` tras una exposición accidental de la
contraseña de Postgres, hubo pasos intermedios en que el archivo `.env` local tenía el valor
nuevo pero aún no se había verificado contra el bot/dashboard desplegado — el procedimiento
correcto (seguido) fue verificar cada consumidor uno a uno ANTES de dar la rotación por
terminada, nunca asumir que "puse el valor nuevo en un sitio" equivale a "ya rotó everywhere".

**Diagnóstico:**
1. Identificar **todos** los consumidores del secreto afectado (tabla en
   `RUNBOOK-SECRETS.md`, sección "Tabla de secretos" — cada fila indica quién lo consume y en
   qué archivo/línea).
2. Para cada consumidor, comprobar qué valor tiene activo AHORA MISMO — sin asumir. Esto casi
   siempre significa: mirar la variable en Railway/Vercel directamente (no fiarse de memoria de
   "ya lo actualicé"), y si es local, mirar `.env` con un comando que NO imprima el valor
   completo (p.ej. contar caracteres o comprobar que la variable no está vacía, nunca volcar el
   secreto entero a la pantalla o a un log — ver la nota de seguridad de este propio incidente
   más abajo).
3. Confirmar cuál es el valor "correcto" actual (el nuevo, si la rotación está en curso; el
   antiguo, si aún no se ha rotado) contrastándolo contra el panel de origen (Supabase/BotFather/
   Sentry).

**Respuesta:**
1. Igualar el valor en TODOS los consumidores al valor correcto, siguiendo el orden del
   procedimiento genérico de `RUNBOOK-SECRETS.md` ("primero el nuevo valor existe en todos los
   sitios → luego se retira el viejo").
2. Redeploy de cada servicio que se haya tocado.
3. Verificar cada consumidor por separado (no basta con verificar uno y asumir que los demás
   están bien): heartbeat del bot, carga del dashboard, y `migrate.py --check` o
   `calcular_slos.py` si el afectado es `DATABASE_URL`.
4. **Nota de seguridad crítica:** si durante el diagnóstico un secreto queda expuesto en texto
   plano en cualquier chat, terminal compartida o log (aunque sea accidental y se corrija al
   momento), tratar la clave como comprometida y rotarla de nuevo de inmediato — no basta con
   "ya nadie más lo vio". Este es exactamente el incidente que ocurrió esta sesión con la
   contraseña de `DATABASE_URL`: se detectó, se comunicó de inmediato, se rotó, y se re-verificó
   sin volver a exponer el valor. Ese es el procedimiento correcto a repetir.

---

## Principio general para los 5

En todos los casos: **diagnosticar antes de actuar** (¿es un proveedor externo caído, o es
nuestro?), **nunca revocar/borrar un secreto viejo antes de confirmar que el nuevo funciona en
todos los consumidores**, y **documentar en `PROGRESS.md`** qué pasó y cómo se resolvió (sin
incluir valores de secretos) para que el próximo incidente similar se resuelva más rápido.
