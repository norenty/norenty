"use client";

import { Save, User, Shield, Bell } from "lucide-react";

/** Sección "Perfil" de Ajustes (ítem 9.40): cuenta, cambio de contraseña,
 * preferencias de notificación y cierre de sesión(es). Puramente
 * presentacional — todo el estado y los handlers viven en `ajustes/page.jsx`. */
export default function AjustesPerfilSection({
  user,
  newPassword,
  setNewPassword,
  guardando,
  cambiarPassword,
  gestor,
  prefs,
  togglePref,
  cerrandoSesiones,
  onCerrarTodasLasSesiones,
  onSignOut,
}) {
  return (
    <>
      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <User size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Tu cuenta</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Email</label>
            <input
              value={user?.email || ""}
              readOnly
              className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface-alt text-ink-muted"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary mb-1">ID</label>
            <input
              value={user?.id?.slice(0, 12) || ""}
              readOnly
              className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface-alt text-ink-muted font-mono"
            />
          </div>
        </div>
      </section>

      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Cambiar contraseña</h2>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-ink-secondary mb-1">Nueva contraseña</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              minLength={6}
              maxLength={128}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <button
            onClick={cambiarPassword}
            disabled={guardando || newPassword.length < 6}
            className="text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            Cambiar
          </button>
        </div>
      </section>

      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Notificaciones</h2>
        </div>
        {!gestor ? (
          <p className="text-xs text-ink-muted">Cargando preferencias…</p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.notif_incidencias}
                onChange={() => togglePref("notif_incidencias")}
                className="accent-brand w-4 h-4"
              />
              <div>
                <div className="text-sm text-ink">Incidencias</div>
                <div className="text-xs text-ink-secondary">Notificar cuando se detecte una incidencia</div>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.notif_entregas}
                onChange={() => togglePref("notif_entregas")}
                className="accent-brand w-4 h-4"
              />
              <div>
                <div className="text-sm text-ink">Entregas completadas</div>
                <div className="text-xs text-ink-secondary">Notificar cuando un viaje se complete</div>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.notif_fuera_ventana}
                onChange={() => togglePref("notif_fuera_ventana")}
                className="accent-brand w-4 h-4"
              />
              <div>
                <div className="text-sm text-ink">Fuera de ventana</div>
                <div className="text-xs text-ink-secondary">Alerta cuando un hito se sale de su ventana horaria</div>
              </div>
            </label>
          </div>
        )}
      </section>

      <div className="flex items-center gap-4">
        <button onClick={onSignOut} className="text-sm text-estado-incidencia hover:underline">
          Cerrar sesión
        </button>
        <button
          onClick={onCerrarTodasLasSesiones}
          disabled={cerrandoSesiones}
          className="text-sm text-estado-incidencia hover:underline disabled:opacity-40"
          title="Cierra tu sesión en todos los dispositivos, no solo este"
        >
          Cerrar sesión en todos los dispositivos
        </button>
      </div>
    </>
  );
}
