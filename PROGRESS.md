# Norenty — Log de progreso del loop

Append-only. Una línea por iteración del loop. Formato:
`<fecha-hora> | <ítem> | <commit|—> | <resultado: HECHO / BLOQUEADO / NECESITA HUMANO>`

Este archivo es estado durable: el loop lo lee al despertar para saber qué se hizo sin
depender del historial de conversación.

---

2026-06-30 | Roadmap reestructurado en fases con gates + protocolo loop stateless | 1c91256→(pendiente) | HECHO
2026-06-30 | Fase 0 (modelo de negocio) | — | HECHO: usuario eligió SaaS multi-cliente. Tenancy multi-tenant correcta obligatoria en Fase 1. UI de gestión de org diferida. Fase 1 desbloqueada.
2026-06-30 | Fase 1: Tenancy correcta | (pendiente push) | HECHO. getDefaultEmpresaId() eliminado (5 archivos dashboard). getCurrentEmpresaId() nueva en lib/data.js, resuelve sesión→gestor→empresa, lanza error explícito si no hay vínculo (no oculta el fallo). signUp() ahora crea empresa nueva por gestor + pide nombre en LoginPage. RLS real aplicado en Supabase (migración 0009): función current_empresa_id() SECURITY DEFINER + políticas empresa-scoped en 13 tablas (directas: chofer/viaje/vehiculo/plantilla_ruta; indirectas vía viaje_id: hito/ejecucion_evento/pod/incidencia/valoracion; vía chofer_id: ubicacion; vía plantilla_ruta_id: plantilla_hito; casos especiales INSERT para empresa y gestor). ajustes/page.jsx corregido (ya no dependía implícitamente de RLS para acertar la empresa). Advisor de seguridad: 1 WARN aceptado (current_empresa_id ejecutable por authenticated — necesario, sin fuga). 10 páginas verificadas compilando (200). Descubierto y anotado en Fase 3: bucket POD público sirve fotos sin pasar por RLS (necesita URLs firmadas).
