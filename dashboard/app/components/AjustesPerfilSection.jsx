"use client";

import { Save, User, Shield, Bell, Palmtree } from "lucide-react";

const ESTADO_VACACION_ESTILO = {
  pendiente: "bg-yellow-50 text-yellow-700",
  aprobada: "bg-green-50 text-estado-ok",
  rechazada: "bg-red-50 text-estado-incidencia",
};
const ESTADO_VACACION_LABEL = { pendiente: "Pendiente", aprobada: "Aprobada", rechazada: "Rechazada" };

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
  telefonoGestor,
  setTelefonoGestor,
  guardandoTelefonoGestor,
  onGuardarTelefonoGestor,
  misVacaciones,
  fechaInicioVacaciones,
  setFechaInicioVacaciones,
  fechaFinVacaciones,
  setFechaFinVacaciones,
  solicitandoVacaciones,
  onSolicitarVacaciones,
}) {
  return (
    <>
      <section id="ajustes-cuenta" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
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
          <div>
            <label className="block text-xs text-ink-secondary mb-1">
              Teléfono (para "llamada urgente" del chófer)
            </label>
            <div className="flex items-center gap-2">
              <input
                value={telefonoGestor}
                onChange={(e) => setTelefonoGestor(e.target.value)}
                placeholder="+34 600 111 222"
                className="flex-1 text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
              />
              <button
                onClick={onGuardarTelefonoGestor}
                disabled={guardandoTelefonoGestor}
                className="text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
              >
                {guardandoTelefonoGestor ? "…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="ajustes-contrasena" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
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

      <section id="ajustes-notificaciones" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
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

      <section id="ajustes-vacaciones" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
        <div className="flex items-center gap-2 mb-1">
          <Palmtree size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Mis vacaciones</h2>
        </div>
        <p className="text-xs text-ink-secondary mb-4">
          Pide tus fechas y le llega una solicitud de aprobación al jefe de tráfico
          (Fase 25) — junto con el aviso de cobertura del equipo para esas fechas.
        </p>
        <div className="flex items-end gap-2 mb-4">
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Desde</label>
            <input
              type="date"
              value={fechaInicioVacaciones}
              onChange={(e) => setFechaInicioVacaciones(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Hasta</label>
            <input
              type="date"
              value={fechaFinVacaciones}
              onChange={(e) => setFechaFinVacaciones(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <button
            onClick={onSolicitarVacaciones}
            disabled={solicitandoVacaciones || !fechaInicioVacaciones || !fechaFinVacaciones}
            className="text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            {solicitandoVacaciones ? "…" : "Solicitar"}
          </button>
        </div>
        {!misVacaciones || misVacaciones.length === 0 ? (
          <p className="text-xs text-ink-muted">Sin solicitudes todavía.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {misVacaciones.map((v) => (
              <div key={v.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-surface-alt">
                <span className="flex-1 text-ink">{v.fecha_inicio} → {v.fecha_fin}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${ESTADO_VACACION_ESTILO[v.estado] || ""}`}>
                  {ESTADO_VACACION_LABEL[v.estado] || v.estado}
                </span>
              </div>
            ))}
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
