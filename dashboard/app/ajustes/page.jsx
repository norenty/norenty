"use client";

import { useEffect, useState } from "react";
import { Save, User, Building2, Bell, Shield } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { getSession, signOut } from "../../lib/auth";

export default function AjustesPage() {
  const [user, setUser] = useState(null);
  const [empresa, setEmpresa] = useState(null);
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    getSession().then((s) => setUser(s?.user || null));
    supabase
      .from("empresa")
      .select("*")
      .order("created_at")
      .limit(1)
      .single()
      .then(({ data }) => {
        setEmpresa(data);
        setEmpresaNombre(data?.nombre || "");
      });
  }, []);

  async function guardarEmpresa() {
    if (!empresa) return;
    setGuardando(true);
    await supabase.from("empresa").update({ nombre: empresaNombre.trim() }).eq("id", empresa.id);
    setMensaje("Guardado");
    setTimeout(() => setMensaje(null), 2000);
    setGuardando(false);
  }

  async function cambiarPassword() {
    if (newPassword.length < 6) return;
    setGuardando(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setMensaje("Error: " + error.message);
    } else {
      setMensaje("Contraseña actualizada");
      setNewPassword("");
    }
    setTimeout(() => setMensaje(null), 3000);
    setGuardando(false);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-medium text-ink mb-6">Ajustes</h1>

      {mensaje && (
        <div className="mb-4 text-xs px-3 py-2 rounded-md bg-green-50 text-estado-ok">
          {mensaje}
        </div>
      )}

      {/* Cuenta */}
      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <User size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Tu cuenta</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
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

      {/* Cambiar contraseña */}
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

      {/* Empresa */}
      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Empresa</h2>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-ink-secondary mb-1">Nombre</label>
            <input
              value={empresaNombre}
              onChange={(e) => setEmpresaNombre(e.target.value)}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <button
            onClick={guardarEmpresa}
            disabled={guardando}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            <Save size={16} /> Guardar
          </button>
        </div>
        {empresa && (
          <div className="mt-3 text-xs text-ink-muted">
            ID empresa: <span className="font-mono">{empresa.id.slice(0, 12)}…</span>
          </div>
        )}
      </section>

      {/* Notificaciones */}
      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Notificaciones</h2>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" defaultChecked className="accent-brand w-4 h-4" />
            <div>
              <div className="text-sm text-ink">Incidencias</div>
              <div className="text-xs text-ink-secondary">Notificar cuando se detecte una incidencia</div>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" defaultChecked className="accent-brand w-4 h-4" />
            <div>
              <div className="text-sm text-ink">Entregas completadas</div>
              <div className="text-xs text-ink-secondary">Notificar cuando un viaje se complete</div>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" className="accent-brand w-4 h-4" />
            <div>
              <div className="text-sm text-ink">Fuera de ventana</div>
              <div className="text-xs text-ink-secondary">Alerta cuando un hito se sale de su ventana horaria</div>
            </div>
          </label>
        </div>
      </section>

      {/* Cerrar sesión */}
      <button
        onClick={() => signOut()}
        className="text-sm text-estado-incidencia hover:underline"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
