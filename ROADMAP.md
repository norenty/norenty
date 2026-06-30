# Norenty — Roadmap

Fuente de verdad del backlog. El loop autónomo lee este archivo, coge el siguiente ítem
de "Pendiente", lo implementa, lo verifica, hace commit y lo mueve a "Hecho".

Convención de prioridad: 🔴 alta · 🟡 media · ⚪ baja

---

## Hecho (M1–M3)

- Bot Telegram: vinculación chófer, navegación (Maps/Waze), confirmación llegada, foto POD, comando `/incidencia`
- Dashboard: Kanban operativo, mapa en vivo (Leaflet), listado/detalle de viajes, chóferes, vehículos, plantillas de ruta, importador Excel/CSV, ajustes, auth (login/registro/reset password)
- Notificaciones in-app + alertas Telegram al gestor (incidencias, entregas, fuera de ventana)
- Validaciones de negocio (sin doble asignación de chófer/vehículo/remolque, referencias únicas, ventanas horarias)
- Auditoría de seguridad: RLS endurecido a `authenticated`, bucket POD sin listado público, función SECURITY DEFINER cerrada, índices FK añadidos
- Responsive móvil, exportar CSV, página 404, favicon

## Pendiente

### 🔴 Alta prioridad

- [ ] **Vincular Telegram del gestor** — hoy `gestor.telegram_chat_id` es una columna sin UI ni flujo. Falta: comando en el bot tipo `/vincular_gestor CODIGO` o página en ajustes que genere un enlace de alta, igual que hicimos con los chóferes.
- [ ] **RLS multi-empresa real** — ahora mismo cualquier usuario autenticado ve TODAS las empresas (RLS solo exige `authenticated`, no filtra por `empresa_id` del gestor). Hay que añadir política que compare `empresa_id` de cada fila con la empresa del gestor logueado. Crítico antes de tener más de un cliente.
- [ ] **Tests automatizados** — no existe ningún test (ni unitario ni de integración) en backend ni dashboard. Mínimo viable: tests del bot (verificación de hito-pertenece-a-chófer, flujo POD) y tests de las validaciones de negocio (`lib/data.js`).
- [ ] **Loading states en botones async** — varios botones (validar POD, cambiar estado incidencia) no muestran estado de carga ni deshabilitan mientras procesan; riesgo de doble clic / doble escritura.

### 🟡 Media prioridad

- [ ] **Mantenimiento/averías de vehículos** — tabla `vehiculo` existe pero no hay registro de incidencias mecánicas, ITV, revisiones. Mencionado como "controlling" que interesa.
- [ ] **Validación de POD con visión LLM** — `ANTHROPIC_API_KEY` está en `.env` sin usar. Idea original: que un modelo con visión valide automáticamente que la foto del albarán es legible/válida antes de marcarla "pendiente" de revisión humana.
- [ ] **Voz en el bot (Whisper STT + TTS)** — `OPENAI_API_KEY` en `.env` sin usar. Pensado para chóferes que prefieran hablar en vez de escribir/pulsar botones.
- [ ] **Localización real del bot** — el chófer tiene campo `idioma` pero todos los mensajes del bot están hardcodeados en español. Si se va a operar con chóferes de otros idiomas, hay que traducir los textos de `bot.py`.
- [ ] **Drag-and-drop en el Kanban** — hoy cambiar estado de un viaje se hace desde el detalle, no arrastrando la tarjeta.
- [ ] **Panel de analítica/KPIs** — tiempos medios de entrega, incidencias por chófer/vehículo, cumplimiento de ventana horaria. Tenemos los datos (eventos, incidencias) pero no hay vista agregada.

### ⚪ Baja prioridad / pulido

- [ ] CI básico (lint + build check en cada push, cuando haya GitHub conectado)
- [ ] Paginación en notificaciones e incidencias (hoy limitado a 10-15 resultados sin "ver más")
- [ ] Página de detalle de chófer (historial de viajes, valoraciones, vinculación)
- [ ] Confirmación visual tras exportar CSV (hoy descarga silenciosa)

---

## Despliegue (pospuesto)

No tocar hasta que el roadmap de arriba esté en buen estado. Ver conversación: GitHub → Vercel (dashboard) → Railway (backend) → dominio norenty.com vía Cloudflare.

## Notas para el loop autónomo

- Cada iteración: leer este archivo, coger el primer ítem sin marcar de mayor prioridad, implementarlo, verificar (`npm run dev` + comprobar páginas responden 200, o test específico), commit, marcar `[x]` aquí.
- Tareas de arquitectura/seguridad/bugs difíciles → delegar a subagente con `model: opus`.
- Tareas mecánicas/repetitivas → delegar a subagente con `model: haiku`.
- Nunca tocar nada de la sección "Despliegue" sin confirmación explícita del usuario.
- Si una tarea requiere una decisión de producto (no técnica), parar y preguntar en vez de asumir.
