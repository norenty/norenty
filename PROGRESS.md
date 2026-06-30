# Norenty — Log de progreso del loop

Append-only. Una línea por iteración del loop. Formato:
`<fecha-hora> | <ítem> | <commit|—> | <resultado: HECHO / BLOQUEADO / NECESITA HUMANO>`

Este archivo es estado durable: el loop lo lee al despertar para saber qué se hizo sin
depender del historial de conversación.

---

2026-06-30 | Roadmap reestructurado en fases con gates + protocolo loop stateless | 1c91256→(pendiente) | HECHO
2026-06-30 | Fase 0 (modelo de negocio) | — | HECHO: usuario eligió SaaS multi-cliente. Tenancy multi-tenant correcta obligatoria en Fase 1. UI de gestión de org diferida. Fase 1 desbloqueada.
2026-06-30 | Fase 1: Tenancy correcta | db44abd | HECHO. getDefaultEmpresaId() eliminado (5 archivos dashboard). getCurrentEmpresaId() nueva en lib/data.js, resuelve sesión→gestor→empresa, lanza error explícito si no hay vínculo (no oculta el fallo). signUp() ahora crea empresa nueva por gestor + pide nombre en LoginPage. RLS real aplicado en Supabase (migración 0009): función current_empresa_id() SECURITY DEFINER + políticas empresa-scoped en 13 tablas. ajustes/page.jsx corregido (ya no dependía implícitamente de RLS). Descubierto y anotado en Fase 3: bucket POD público sirve fotos sin pasar por RLS.
2026-06-30 | Fase 1: Harness de tests + CI | (pendiente push) | HECHO. backend/tests/ (fakes.py + test_bot.py, 16 tests, incl. test del fix de seguridad hito-pertenece-a-chofer). dashboard/lib/data.test.js (18 tests, mock de query builder en memoria, vitest instalado). ci.ps1 en raíz: pytest + vitest + next build, exit 0/1. Corregido de paso: themeColor mal ubicado en metadata (Next.js 15 lo exige en viewport) — lo detectó el build, no lo habría pillado un check de "200". FASE 1 CERRADA. Fase 2 desbloqueada.
