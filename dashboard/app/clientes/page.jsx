"use client";

import { useEffect, useState } from "react";
import { Plus, Building2, Check, X, Pencil } from "lucide-react";
import { getClientes, createCliente, actualizarCliente, desactivarCliente } from "../../lib/data";
import EmptyState from "../components/ui/EmptyState";

function formVacio() {
  return { nombre: "", cif: "", email: "", telefono: "", notas: "" };
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState([]);
  const [form, setForm] = useState(formVacio());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [formEdicion, setFormEdicion] = useState(formVacio());
  const [procesandoId, setProcesandoId] = useState(null);

  async function load() {
    setClientes(await getClientes({ incluirInactivos: mostrarInactivos }));
  }
  useEffect(() => { load(); }, [mostrarInactivos]);

  async function añadir(e) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      await createCliente(form);
      setForm(formVacio());
      await load();
    } catch (err) {
      setError(err.message);
    }
    setGuardando(false);
  }

  function empezarEdicion(c) {
    setEditandoId(c.id);
    setFormEdicion({
      nombre: c.nombre || "", cif: c.cif || "", email: c.email || "",
      telefono: c.telefono || "", notas: c.notas || "",
    });
  }

  async function guardarEdicion(id) {
    setError(null);
    setProcesandoId(id);
    try {
      await actualizarCliente(id, formEdicion);
      setEditandoId(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
    setProcesandoId(null);
  }

  async function darDeBaja(c) {
    if (procesandoId) return;
    if (!window.confirm(`¿Dar de baja a "${c.nombre}"? No se borra su histórico, solo deja de aparecer en los formularios.`)) return;
    setProcesandoId(c.id);
    try {
      await desactivarCliente(c.id);
      await load();
    } finally {
      setProcesandoId(null);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-medium text-ink mb-1">Clientes</h1>
      <p className="text-sm text-ink-secondary mb-6">
        Clientes de tu empresa. Se pueden asociar a un viaje además de (no en vez de) la
        referencia/albarán de texto libre.
      </p>

      {error && (
        <div className="mb-4 text-xs px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-estado-incidencia flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-ink-muted ml-2">✕</button>
        </div>
      )}

      <form onSubmit={añadir} className="bg-surface border border-border rounded-xl p-4 mb-6 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[10rem]">
          <label className="block text-xs text-ink-secondary mb-1">Nombre</label>
          <input
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            placeholder="Mercadona SA"
            maxLength={200}
            className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">CIF</label>
          <input
            value={form.cif}
            onChange={(e) => setForm({ ...form, cif: e.target.value })}
            placeholder="B12345678"
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-32"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="compras@cliente.com"
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-44"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">Teléfono</label>
          <input
            value={form.telefono}
            onChange={(e) => setForm({ ...form, telefono: e.target.value })}
            placeholder="600111222"
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-32"
          />
        </div>
        <button
          type="submit"
          disabled={guardando || !form.nombre.trim()}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
        >
          <Plus size={16} /> Añadir
        </button>
      </form>

      <div className="flex items-center justify-between mb-4">
        <label className="flex items-center gap-2 text-xs text-ink-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={mostrarInactivos}
            onChange={(e) => setMostrarInactivos(e.target.checked)}
            className="accent-brand w-3.5 h-3.5"
          />
          Mostrar clientes dados de baja
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {clientes.map((c) => (
          <div key={c.id} className={`bg-surface border border-border rounded-xl p-4 ${!c.activo ? "opacity-50" : ""}`}>
            {editandoId === c.id ? (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={formEdicion.nombre}
                    onChange={(e) => setFormEdicion({ ...formEdicion, nombre: e.target.value })}
                    placeholder="Nombre"
                    className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                  />
                  <input
                    value={formEdicion.cif}
                    onChange={(e) => setFormEdicion({ ...formEdicion, cif: e.target.value })}
                    placeholder="CIF"
                    className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                  />
                  <input
                    value={formEdicion.email}
                    onChange={(e) => setFormEdicion({ ...formEdicion, email: e.target.value })}
                    placeholder="Email"
                    className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                  />
                  <input
                    value={formEdicion.telefono}
                    onChange={(e) => setFormEdicion({ ...formEdicion, telefono: e.target.value })}
                    placeholder="Teléfono"
                    className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                  />
                </div>
                <textarea
                  value={formEdicion.notas}
                  onChange={(e) => setFormEdicion({ ...formEdicion, notas: e.target.value })}
                  placeholder="Notas (preferencias, incidencias habituales...)"
                  rows={2}
                  className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => guardarEdicion(c.id)}
                    disabled={procesandoId === c.id || !formEdicion.nombre.trim()}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-brand text-white font-medium disabled:opacity-40"
                  >
                    <Check size={14} /> Guardar
                  </button>
                  <button
                    onClick={() => setEditandoId(null)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
                  >
                    <X size={14} /> Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-full bg-blue-50 text-estado-en-curso flex items-center justify-center shrink-0">
                  <Building2 size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">{c.nombre}</div>
                  <div className="text-xs text-ink-secondary truncate">
                    {[c.cif, c.email, c.telefono].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                  </div>
                  {c.notas && <div className="text-xs text-ink-muted mt-0.5 truncate">{c.notas}</div>}
                </div>
                {c.activo && (
                  <button
                    onClick={() => empezarEdicion(c)}
                    className="p-1.5 text-ink-muted hover:text-ink"
                    title="Editar cliente"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {c.activo && (
                  <button
                    onClick={() => darDeBaja(c)}
                    disabled={procesandoId === c.id}
                    className="text-xs px-2.5 py-1 rounded-full border border-border text-ink-secondary hover:bg-red-50 hover:text-estado-incidencia disabled:opacity-40"
                  >
                    {procesandoId === c.id ? "…" : "Dar de baja"}
                  </button>
                )}
                {!c.activo && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-ink-muted">Dado de baja</span>
                )}
              </div>
            )}
          </div>
        ))}
        {clientes.length === 0 && (
          <EmptyState
            icon={Building2}
            titulo="Todavía no hay clientes"
            texto="Añade el primero con el formulario de arriba."
          />
        )}
      </div>
    </div>
  );
}
