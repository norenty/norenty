"use client";

import { useMemo, useState } from "react";
import { Users, Send, Copy, Check, X, History, ChevronDown } from "lucide-react";
import { getAuditLogPorGestor } from "../../lib/data";
import { describirAuditoria, fmtFechaHora } from "../../lib/format";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "gestor_operativo", label: "Gestor operativo" },
  // Fase 23, 23.E.1/23.E.4 (2026-07-29): el rol ya funcionaba de punta a
  // punta a nivel de RLS/backend, pero faltaba aquí -- asignarlo requería
  // tocar la base de datos a mano.
  { value: "planificador", label: "Planificador" },
  { value: "comercial", label: "Comercial" },
  { value: "solo_lectura", label: "Solo lectura" },
];

/** Sección "Equipo" de Ajustes (ítem 9.40): invitar gestores y gestionar
 * roles/expulsión del equipo (ítem 9.29). El llamador debe envolver este
 * componente en `<RequireRol roles={["admin"]}>`, igual que antes.
 * Presentacional — el estado y los handlers viven en `ajustes/page.jsx`. */
export default function AjustesEquipoSection({
  invitaciones,
  invitarEmail,
  setInvitarEmail,
  invitando,
  enviarInvitacion,
  revocarInvitacion,
  copiarEnlaceInvitacion,
  codigoCopiadoId,
  invitacionValidezDias,
  gestores,
  user,
  gestorAccionandoId,
  cambiarRolGestor,
  cambiarRolesGestor,
  onDesactivarGestor,
  onReactivarGestor,
  choferes,
  cambiarGestorChofer,
  choferAccionandoId,
  viajesPool,
  cambiarGestorViaje,
  viajeAccionandoId,
  solicitudesAprobacion,
  resolverSolicitud,
  solicitudAccionandoId,
}) {
  // 17.G.3 (auditoría de asignación, 2026-07-23): con muchos chóferes (caso
  // real: 80 en la empresa de prueba "Transportes Pepito") esta lista se
  // volvía una pared de filas sin buscar ni forma de reasignar varios a la
  // vez -- justo el escenario de cobertura por vacaciones/bajas que motivó
  // F15.3 en primer lugar (un gestor se va, hay que mover TODOS sus chóferes
  // a otro de golpe, no uno a uno). Filtro de texto + selección múltiple +
  // reasignación en bloque, reutilizando `cambiarGestorChofer` fila a fila
  // (misma llamada que ya existe, sin tocar `data.js`).
  // Fase 23, 23.F.2: multi-select de roles (migración 0075) -- qué gestor tiene el
  // desplegable de roles abierto ahora mismo (solo uno a la vez).
  const [rolesAbiertoPara, setRolesAbiertoPara] = useState(null);

  function alternarRolEnSeleccion(rolesActuales, valor) {
    const set = new Set(rolesActuales);
    if (set.has(valor)) set.delete(valor); else set.add(valor);
    return Array.from(set);
  }

  // 23.G.1: auditoría por gestor -- se carga bajo demanda al desplegar la fila (no de
  // entrada, para no disparar N consultas de audit_log cuando la empresa tiene muchos
  // gestores) y se cachea en memoria mientras el componente sigue montado.
  const [gestorAuditoriaAbierta, setGestorAuditoriaAbierta] = useState(null);
  const [auditoriaPorGestor, setAuditoriaPorGestor] = useState({});
  const [cargandoAuditoria, setCargandoAuditoria] = useState(null);

  async function alternarAuditoria(gestorId) {
    if (gestorAuditoriaAbierta === gestorId) {
      setGestorAuditoriaAbierta(null);
      return;
    }
    setGestorAuditoriaAbierta(gestorId);
    if (!auditoriaPorGestor[gestorId]) {
      setCargandoAuditoria(gestorId);
      const entradas = await getAuditLogPorGestor(gestorId);
      setAuditoriaPorGestor((prev) => ({ ...prev, [gestorId]: entradas }));
      setCargandoAuditoria(null);
    }
  }

  const [filtroChofer, setFiltroChofer] = useState("");
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [gestorBulk, setGestorBulk] = useState("");
  const [aplicandoBulk, setAplicandoBulk] = useState(false);

  // 18.C.1: mismo patrón, pero para adjudicar viajes del "pool" (sin gestor)
  // a un gestor concreto — es el jefe de tráfico decidiendo "esta ruta la
  // llevas tú" que describió el usuario.
  const [filtroViaje, setFiltroViaje] = useState("");
  const viajesFiltrados = useMemo(() => {
    const q = filtroViaje.trim().toLowerCase();
    const lista = viajesPool || [];
    if (!q) return lista;
    return lista.filter((v) =>
      (v.referencia || "").toLowerCase().includes(q) || (v.cliente?.nombre || "").toLowerCase().includes(q)
    );
  }, [viajesPool, filtroViaje]);
  const viajesSinAsignar = viajesFiltrados.filter((v) => !v.gestor_id);
  const viajesYaAsignados = viajesFiltrados.filter((v) => v.gestor_id);

  const choferesFiltrados = useMemo(() => {
    const q = filtroChofer.trim().toLowerCase();
    if (!q) return choferes || [];
    return (choferes || []).filter((c) => c.nombre.toLowerCase().includes(q));
  }, [choferes, filtroChofer]);

  function alternarSeleccion(id) {
    setSeleccionados((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function aplicarBulk() {
    // C.2: nunca "sin asignar" -- hace falta elegir un gestor de verdad.
    if (!seleccionados.size || !gestorBulk) return;
    setAplicandoBulk(true);
    try {
      for (const choferId of seleccionados) {
        await cambiarGestorChofer(choferId, gestorBulk);
      }
      setSeleccionados(new Set());
      setGestorBulk("");
    } finally {
      setAplicandoBulk(false);
    }
  }

  return (
    <section id="ajustes-equipo" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <Users size={18} className="text-brand" />
        <h2 className="text-sm font-medium text-ink">Equipo</h2>
      </div>
      <p className="text-xs text-ink-secondary mb-4">
        Invita a otros gestores de tu empresa. El enlace une al gestor nuevo a
        TU empresa (no crea una nueva) y solo se puede usar una vez.
      </p>

      <form onSubmit={enviarInvitacion} className="flex items-end gap-2 mb-4">
        <div className="flex-1">
          <label className="block text-xs text-ink-secondary mb-1">Email a invitar</label>
          <input
            type="email"
            value={invitarEmail}
            onChange={(e) => setInvitarEmail(e.target.value)}
            placeholder="compañero@empresa.com"
            maxLength={254}
            className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
          />
        </div>
        <button
          type="submit"
          disabled={invitando}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
        >
          <Send size={16} /> Invitar
        </button>
      </form>

      {invitaciones.length === 0 ? (
        <p className="text-xs text-ink-muted">Sin invitaciones todavía.</p>
      ) : (
        <div className="flex flex-col gap-2 mb-5">
          {invitaciones.map((inv) => (
            <div key={inv.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-surface-alt">
              <span className="flex-1 text-ink">{inv.email}</span>
              {inv.usada_at ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-estado-ok">Usada</span>
              ) : inv.vencida ? (
                <>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-ink-muted" title={`Han pasado más de ${invitacionValidezDias} días — el enlace ya no funciona`}>
                    Vencida
                  </span>
                  <button
                    onClick={() => revocarInvitacion(inv.id)}
                    className="p-1.5 text-ink-muted hover:text-estado-incidencia"
                    title="Eliminar invitación vencida"
                  >
                    <X size={14} />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700">Pendiente</span>
                  <button
                    onClick={() => copiarEnlaceInvitacion(inv)}
                    className="p-1.5 text-ink-secondary hover:text-ink"
                    title="Copiar enlace de invitación"
                  >
                    {codigoCopiadoId === inv.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button
                    onClick={() => revocarInvitacion(inv.id)}
                    className="p-1.5 text-ink-muted hover:text-estado-incidencia"
                    title="Revocar invitación"
                  >
                    <X size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <h3 className="text-xs font-medium text-ink-secondary mb-2 mt-2">Gestores de la empresa</h3>
      {gestores.length === 0 ? (
        <p className="text-xs text-ink-muted">Cargando gestores…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {gestores.map((g) => {
            const esUnoMismo = g.auth_user_id === user?.id;
            const auditoriaAbierta = gestorAuditoriaAbierta === g.id;
            const entradas = auditoriaPorGestor[g.id];
            // Fase 23, 23.F.2: `roles` (array, migración 0075) es la fuente de verdad;
            // fallback a `[rol]` para gestores que aún no tengan la columna poblada
            // (no debería pasar tras el backfill, pero es gratis ser robustos).
            const rolesGestor = g.roles?.length ? g.roles : (g.rol ? [g.rol] : []);
            const rolesMenuAbierto = rolesAbiertoPara === g.id;
            return (
              <div key={g.id} className="rounded-md bg-surface-alt">
                <div className="flex items-center gap-2 text-sm px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-ink truncate">{g.nombre}{esUnoMismo && <span className="text-ink-muted"> (tú)</span>}</div>
                    <div className="text-xs text-ink-muted truncate">{g.email}</div>
                  </div>
                  <button
                    onClick={() => alternarAuditoria(g.id)}
                    title="Ver actividad reciente"
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-ink-secondary hover:bg-surface"
                  >
                    <History size={13} /> Actividad
                    <ChevronDown size={13} className={auditoriaAbierta ? "rotate-180 transition-transform" : "transition-transform"} />
                  </button>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setRolesAbiertoPara(rolesMenuAbierto ? null : g.id)}
                      disabled={esUnoMismo || gestorAccionandoId === g.id}
                      title={esUnoMismo ? "No puedes cambiar tu propio rol" : "Cambiar roles"}
                      className="flex items-center gap-1 text-xs border border-border rounded-md px-2 py-1 disabled:opacity-40 whitespace-nowrap"
                    >
                      {rolesGestor.map((r) => ROLES.find((x) => x.value === r)?.label || r).join(", ") || "Sin rol"}
                      <ChevronDown size={12} />
                    </button>
                    {rolesMenuAbierto && (
                      <div className="absolute right-0 top-full mt-1 z-10 bg-surface border border-border rounded-md shadow-lg p-2 flex flex-col gap-1 min-w-[160px]">
                        {ROLES.map((r) => {
                          const marcado = rolesGestor.includes(r.value);
                          const esUltimo = marcado && rolesGestor.length === 1;
                          return (
                            <label
                              key={r.value}
                              className={`flex items-center gap-2 text-xs px-1.5 py-1 rounded hover:bg-surface-alt ${esUltimo ? "opacity-40" : ""}`}
                              title={esUltimo ? "Un gestor debe tener al menos un rol" : undefined}
                            >
                              <input
                                type="checkbox"
                                checked={marcado}
                                disabled={esUltimo}
                                onChange={() => cambiarRolesGestor(g.id, alternarRolEnSeleccion(rolesGestor, r.value))}
                                className="rounded border-border"
                              />
                              {r.label}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {g.activo ? (
                    <button
                      onClick={() => onDesactivarGestor(g)}
                      disabled={esUnoMismo || gestorAccionandoId === g.id}
                      title={esUnoMismo ? "No puedes desactivarte a ti mismo" : "Desactivar gestor"}
                      className="text-xs px-2 py-1 rounded-md border border-border text-estado-incidencia hover:bg-red-50 disabled:opacity-40"
                    >
                      Desactivar
                    </button>
                  ) : (
                    <button
                      onClick={() => onReactivarGestor(g)}
                      disabled={gestorAccionandoId === g.id}
                      className="text-xs px-2 py-1 rounded-md border border-border text-estado-ok hover:bg-green-50 disabled:opacity-40"
                    >
                      Reactivar
                    </button>
                  )}
                  {!g.activo && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-ink-muted">Desactivado</span>
                  )}
                </div>
                {auditoriaAbierta && (
                  <div className="px-3 pb-3">
                    {cargandoAuditoria === g.id ? (
                      <p className="text-xs text-ink-muted">Cargando actividad…</p>
                    ) : !entradas || entradas.length === 0 ? (
                      <p className="text-xs text-ink-muted">Sin actividad registrada todavía.</p>
                    ) : (
                      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto border-t border-border pt-2">
                        {entradas.map((a) => (
                          <div key={a.id} className="text-xs text-ink-secondary flex items-start gap-2">
                            <span className="text-ink-muted whitespace-nowrap">{fmtFechaHora(a.created_at)}</span>
                            <span>{describirAuditoria(a)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h3 className="text-xs font-medium text-ink-secondary mb-2 mt-4">
        Asignación de chóferes (F15.3)
      </h3>
      <p className="text-xs text-ink-secondary mb-3">
        Todo chófer tiene siempre un gestor responsable — tú (admin) sigues viendo todo. Cuando
        alguien se va de vacaciones o causa baja, redistribuye sus chóferes entre el resto aquí
        (decisión C.1: nunca debería quedar un chófer sin asignar).
      </p>
      {!choferes || choferes.length === 0 ? (
        <p className="text-xs text-ink-muted">Sin chóferes todavía.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2">
            <input
              value={filtroChofer}
              onChange={(e) => setFiltroChofer(e.target.value)}
              placeholder="Buscar chófer por nombre..."
              className="flex-1 text-xs border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
            />
            {seleccionados.size > 0 && (
              <>
                <span className="text-xs text-ink-muted whitespace-nowrap">{seleccionados.size} seleccionados</span>
                <select
                  value={gestorBulk}
                  onChange={(e) => setGestorBulk(e.target.value)}
                  disabled={aplicandoBulk}
                  className="text-xs border border-border rounded-md px-2 py-1 disabled:opacity-40"
                >
                  <option value="">Elegir gestor…</option>
                  {gestores.filter((g) => g.activo).map((g) => (
                    <option key={g.id} value={g.id}>{g.nombre}</option>
                  ))}
                </select>
                <button
                  onClick={aplicarBulk}
                  disabled={aplicandoBulk || !gestorBulk}
                  className="text-xs px-2 py-1 rounded-md bg-brand text-white font-medium disabled:opacity-40 whitespace-nowrap"
                >
                  {aplicandoBulk ? "Aplicando…" : "Reasignar seleccionados"}
                </button>
              </>
            )}
          </div>
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
            {choferesFiltrados.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-surface-alt">
                <input
                  type="checkbox"
                  checked={seleccionados.has(c.id)}
                  onChange={() => alternarSeleccion(c.id)}
                  className="rounded border-border"
                />
                <span className="flex-1 min-w-0 truncate text-ink">{c.nombre}</span>
                <select
                  value={c.gestor_id || ""}
                  disabled={choferAccionandoId === c.id}
                  onChange={(e) => e.target.value && cambiarGestorChofer(c.id, e.target.value)}
                  className="text-xs border border-border rounded-md px-2 py-1 disabled:opacity-40"
                >
                  {!c.gestor_id && <option value="">Elegir gestor…</option>}
                  {gestores.filter((g) => g.activo).map((g) => (
                    <option key={g.id} value={g.id}>{g.nombre}</option>
                  ))}
                </select>
              </div>
            ))}
            {choferesFiltrados.length === 0 && (
              <p className="text-xs text-ink-muted">Ningún chófer coincide con "{filtroChofer}".</p>
            )}
          </div>
        </>
      )}

      <h3 className="text-xs font-medium text-ink-secondary mb-2 mt-4">
        Adjudicación de viajes (18.C.1)
      </h3>
      <p className="text-xs text-ink-secondary mb-3">
        Un viaje "En el pool" lo puede ver y tomar cualquier gestor. Adjudícalo a uno para que
        sea suyo — a partir de ahí, ese gestor es quien decide qué chófer concreto lo hace.
      </p>
      {!viajesPool || viajesPool.length === 0 ? (
        <p className="text-xs text-ink-muted">Sin viajes abiertos todavía.</p>
      ) : (
        <>
          <input
            value={filtroViaje}
            onChange={(e) => setFiltroViaje(e.target.value)}
            placeholder="Buscar por referencia o cliente..."
            className="w-full text-xs border border-border rounded-md px-2 py-1.5 mb-2 focus:outline-none focus:border-brand"
          />
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
            {viajesSinAsignar.map((v) => (
              <div key={v.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-yellow-50 border border-yellow-200">
                <span className="flex-1 min-w-0 truncate text-ink">
                  {v.referencia || "(sin referencia)"}
                  {v.cliente?.nombre && <span className="text-ink-muted"> · {v.cliente.nombre}</span>}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-800 whitespace-nowrap">En el pool</span>
                <select
                  value=""
                  disabled={viajeAccionandoId === v.id}
                  onChange={(e) => e.target.value && cambiarGestorViaje(v.id, e.target.value)}
                  className="text-xs border border-border rounded-md px-2 py-1 disabled:opacity-40"
                >
                  <option value="">Adjudicar a…</option>
                  {gestores.filter((g) => g.activo).map((g) => (
                    <option key={g.id} value={g.id}>{g.nombre}</option>
                  ))}
                </select>
              </div>
            ))}
            {viajesYaAsignados.map((v) => (
              <div key={v.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-surface-alt">
                <span className="flex-1 min-w-0 truncate text-ink">
                  {v.referencia || "(sin referencia)"}
                  {v.cliente?.nombre && <span className="text-ink-muted"> · {v.cliente.nombre}</span>}
                </span>
                <select
                  value={v.gestor_id || ""}
                  disabled={viajeAccionandoId === v.id}
                  onChange={(e) => cambiarGestorViaje(v.id, e.target.value || null)}
                  className="text-xs border border-border rounded-md px-2 py-1 disabled:opacity-40"
                >
                  <option value="">Devolver al pool</option>
                  {gestores.filter((g) => g.activo).map((g) => (
                    <option key={g.id} value={g.id}>{g.nombre}</option>
                  ))}
                </select>
              </div>
            ))}
            {viajesFiltrados.length === 0 && (
              <p className="text-xs text-ink-muted">Ningún viaje coincide con "{filtroViaje}".</p>
            )}
          </div>
        </>
      )}

      <h3 className="text-xs font-medium text-ink-secondary mb-2 mt-4">
        Aprobaciones pendientes (18.A.2)
      </h3>
      <p className="text-xs text-ink-secondary mb-3">
        Rutas nuevas y viajes cuya ventana horaria no es viable con los descansos legales
        obligatorios — el jefe de tráfico decide antes de que sigan adelante.
      </p>
      {!solicitudesAprobacion || solicitudesAprobacion.length === 0 ? (
        <p className="text-xs text-ink-muted">Sin solicitudes pendientes.</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
          {solicitudesAprobacion.map((s) => (
            <div key={s.id} className="flex items-start gap-2 text-sm px-3 py-2 rounded-md bg-yellow-50 border border-yellow-200">
              <div className="flex-1 min-w-0">
                <div className="text-ink">
                  {s.tipo === "ruta_nueva" ? "Ruta nueva" : "Viabilidad baja"}
                  {s.solicitante?.nombre && <span className="text-ink-muted"> · pedido por {s.solicitante.nombre}</span>}
                </div>
                {s.motivo && <div className="text-xs text-ink-secondary mt-0.5">{s.motivo}</div>}
              </div>
              <button
                disabled={solicitudAccionandoId === s.id}
                onClick={() => resolverSolicitud(s.id, true)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-brand text-white disabled:opacity-40"
              >
                <Check size={13} /> Aprobar
              </button>
              <button
                disabled={solicitudAccionandoId === s.id}
                onClick={() => resolverSolicitud(s.id, false)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-ink-secondary disabled:opacity-40"
              >
                <X size={13} /> Rechazar
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
