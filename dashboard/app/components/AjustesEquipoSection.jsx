"use client";

import { Users, Send, Copy, Check, X } from "lucide-react";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "gestor_operativo", label: "Gestor operativo" },
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
  onDesactivarGestor,
  onReactivarGestor,
  choferes,
  cambiarGestorChofer,
  choferAccionandoId,
}) {
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
            return (
              <div key={g.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-surface-alt">
                <div className="flex-1 min-w-0">
                  <div className="text-ink truncate">{g.nombre}{esUnoMismo && <span className="text-ink-muted"> (tú)</span>}</div>
                  <div className="text-xs text-ink-muted truncate">{g.email}</div>
                </div>
                <select
                  value={g.rol}
                  disabled={esUnoMismo || gestorAccionandoId === g.id}
                  onChange={(e) => cambiarRolGestor(g.id, e.target.value)}
                  title={esUnoMismo ? "No puedes cambiar tu propio rol" : "Cambiar rol"}
                  className="text-xs border border-border rounded-md px-2 py-1 disabled:opacity-40"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
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
            );
          })}
        </div>
      )}

      <h3 className="text-xs font-medium text-ink-secondary mb-2 mt-4">
        Asignación de chóferes (F15.3)
      </h3>
      <p className="text-xs text-ink-secondary mb-3">
        Un chófer "Sin asignar" es visible para todos los gestores. Asígnalo a uno para que
        solo ese gestor vea sus rutas — tú (admin) siempre ves todo, asignado o no.
      </p>
      {!choferes || choferes.length === 0 ? (
        <p className="text-xs text-ink-muted">Sin chóferes todavía.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {choferes.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-surface-alt">
              <span className="flex-1 min-w-0 truncate text-ink">{c.nombre}</span>
              <select
                value={c.gestor_id || ""}
                disabled={choferAccionandoId === c.id}
                onChange={(e) => cambiarGestorChofer(c.id, e.target.value || null)}
                className="text-xs border border-border rounded-md px-2 py-1 disabled:opacity-40"
              >
                <option value="">Sin asignar</option>
                {gestores.filter((g) => g.activo).map((g) => (
                  <option key={g.id} value={g.id}>{g.nombre}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
