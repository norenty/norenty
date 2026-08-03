"use client";

import { useEffect, useState } from "react";
import { Plus, Truck, Check, X, Pencil, Star } from "lucide-react";
import {
  getSubcontratistas, createSubcontratista, actualizarSubcontratista, desactivarSubcontratista,
  valorarSubcontratista, getValoracionesSubcontratista,
} from "../../lib/data";
import EmptyState from "../components/ui/EmptyState";

// Fase 27.3 (informe TMS tradicionales 2026-08-02): subcontratista como
// entidad de primera clase, distinta de chofer. Calco deliberado del patrón
// de /clientes -- mismo tipo de formulario, misma UX, para no reinventar.
function formVacio() {
  return { nombre: "", cif: "", telefono: "", email: "", tarifaKmPactada: "", notas: "" };
}

export default function SubcontratistasPage() {
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState(formVacio());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [formEdicion, setFormEdicion] = useState(formVacio());
  const [procesandoId, setProcesandoId] = useState(null);
  const [valorandoId, setValorandoId] = useState(null);

  async function load() {
    setLista(await getSubcontratistas({ incluirInactivos: mostrarInactivos }));
  }
  useEffect(() => { load(); }, [mostrarInactivos]);

  async function añadir(e) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      await createSubcontratista(form);
      setForm(formVacio());
      await load();
    } catch (err) {
      setError(err.message);
    }
    setGuardando(false);
  }

  function empezarEdicion(s) {
    setEditandoId(s.id);
    setFormEdicion({
      nombre: s.nombre || "", cif: s.cif || "", telefono: s.telefono || "",
      email: s.email || "", tarifaKmPactada: s.tarifa_km_pactada != null ? String(s.tarifa_km_pactada) : "",
      notas: s.notas || "",
    });
  }

  async function guardarEdicion(id) {
    setError(null);
    setProcesandoId(id);
    try {
      await actualizarSubcontratista(id, formEdicion);
      setEditandoId(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
    setProcesandoId(null);
  }

  async function darDeBaja(s) {
    if (procesandoId) return;
    if (!window.confirm(`¿Dar de baja a "${s.nombre}"? No se borra su histórico, solo deja de aparecer en las asignaciones.`)) return;
    setProcesandoId(s.id);
    try {
      await desactivarSubcontratista(s.id);
      await load();
    } finally {
      setProcesandoId(null);
    }
  }

  async function valorar(s) {
    const puntuacion = Number(window.prompt(`Valora a ${s.nombre} del 1 al 5:`));
    if (!puntuacion || puntuacion < 1 || puntuacion > 5) return;
    const nota = window.prompt("Nota (opcional):") || null;
    setValorandoId(s.id);
    try {
      await valorarSubcontratista(s.id, { puntuacion, nota });
    } catch (err) {
      setError(err.message);
    }
    setValorandoId(null);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-medium text-ink mb-1">Subcontratistas</h1>
      <p className="text-sm text-ink-secondary mb-6">
        Transportistas externos a los que asignas viajes -- distinto de un chófer propio, aunque
        sea autónomo. Con tarifa €/km pactada, se puede auditar lo que facturan contra lo acordado.
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
            placeholder="Transportes García SL"
            maxLength={200}
            className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">CIF/NIF</label>
          <input
            value={form.cif}
            onChange={(e) => setForm({ ...form, cif: e.target.value })}
            placeholder="B12345678"
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-32"
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
        <div>
          <label className="block text-xs text-ink-secondary mb-1">Tarifa pactada (€/km)</label>
          <input
            type="number" step="any" min="0"
            value={form.tarifaKmPactada}
            onChange={(e) => setForm({ ...form, tarifaKmPactada: e.target.value })}
            placeholder="1.20"
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-28"
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
          Mostrar dados de baja
        </label>
      </div>

      <div className="flex flex-col gap-2">
        {lista.map((s) => (
          <div key={s.id} className={`bg-surface border border-border rounded-xl p-4 ${!s.activo ? "opacity-50" : ""}`}>
            {editandoId === s.id ? (
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
                    placeholder="CIF/NIF"
                    className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                  />
                  <input
                    value={formEdicion.telefono}
                    onChange={(e) => setFormEdicion({ ...formEdicion, telefono: e.target.value })}
                    placeholder="Teléfono"
                    className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                  />
                  <input
                    value={formEdicion.email}
                    onChange={(e) => setFormEdicion({ ...formEdicion, email: e.target.value })}
                    placeholder="Email"
                    className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                  />
                </div>
                <input
                  type="number" step="any" min="0"
                  value={formEdicion.tarifaKmPactada}
                  onChange={(e) => setFormEdicion({ ...formEdicion, tarifaKmPactada: e.target.value })}
                  placeholder="Tarifa pactada (€/km)"
                  className="text-sm border border-border rounded-md px-2 py-1.5 w-40 focus:outline-none focus:border-brand"
                />
                <textarea
                  value={formEdicion.notas}
                  onChange={(e) => setFormEdicion({ ...formEdicion, notas: e.target.value })}
                  placeholder="Notas"
                  rows={2}
                  className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => guardarEdicion(s.id)}
                    disabled={procesandoId === s.id || !formEdicion.nombre.trim()}
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
                <div className="w-9 h-9 rounded-full bg-orange-50 text-accent-ink flex items-center justify-center shrink-0">
                  <Truck size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">{s.nombre}</div>
                  <div className="text-xs text-ink-secondary truncate">
                    {[s.cif, s.telefono, s.tarifa_km_pactada != null ? `${s.tarifa_km_pactada} €/km` : null].filter(Boolean).join(" · ") || "Sin datos"}
                  </div>
                </div>
                {s.activo && (
                  <button onClick={() => valorar(s)} disabled={valorandoId === s.id} className="p-1.5 text-ink-muted hover:text-yellow-600" title="Valorar">
                    <Star size={14} />
                  </button>
                )}
                {s.activo && (
                  <button onClick={() => empezarEdicion(s)} className="p-1.5 text-ink-muted hover:text-ink" title="Editar">
                    <Pencil size={14} />
                  </button>
                )}
                {s.activo && (
                  <button
                    onClick={() => darDeBaja(s)}
                    disabled={procesandoId === s.id}
                    className="text-xs px-2.5 py-1 rounded-full border border-border text-ink-secondary hover:bg-red-50 hover:text-estado-incidencia disabled:opacity-40"
                  >
                    {procesandoId === s.id ? "…" : "Dar de baja"}
                  </button>
                )}
                {!s.activo && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-ink-muted">Dado de baja</span>
                )}
              </div>
            )}
          </div>
        ))}
        {lista.length === 0 && (
          <EmptyState
            icon={Truck}
            titulo="Todavía no hay subcontratistas"
            texto="Añade el primero con el formulario de arriba."
          />
        )}
      </div>
    </div>
  );
}
