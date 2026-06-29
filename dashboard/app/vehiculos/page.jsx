"use client";

import { useEffect, useState } from "react";
import { Plus, Truck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { getDefaultEmpresaId } from "../../lib/data";

const TIPOS = [
  { value: "tractora", label: "Tractora" },
  { value: "remolque", label: "Remolque" },
  { value: "rigido", label: "Rígido" },
  { value: "furgoneta", label: "Furgoneta" },
];

export default function VehiculosPage() {
  const [vehiculos, setVehiculos] = useState([]);
  const [form, setForm] = useState({ matricula: "", tipo: "tractora", marca: "", modelo: "" });
  const [guardando, setGuardando] = useState(false);
  const [filtro, setFiltro] = useState("todos");
  const [error, setError] = useState(null);

  async function load() {
    const { data } = await supabase
      .from("vehiculo")
      .select("*")
      .order("created_at", { ascending: false });
    setVehiculos(data || []);
  }
  useEffect(() => { load(); }, []);

  async function añadir(e) {
    e.preventDefault();
    const mat = form.matricula.trim().toUpperCase();
    if (!mat) return;
    const dup = vehiculos.find((v) => v.matricula === mat);
    setError(null);
    if (dup) { setError(`Ya existe un vehículo con matrícula "${mat}"`); return; }
    setGuardando(true);
    const empresa_id = await getDefaultEmpresaId();
    const { error } = await supabase.from("vehiculo").insert({
      matricula: mat,
      tipo: form.tipo,
      marca: form.marca.trim() || null,
      modelo: form.modelo.trim() || null,
      empresa_id,
    });
    if (error) { setError(error.message); } else {
      setForm({ matricula: "", tipo: "tractora", marca: "", modelo: "" });
    }
    setGuardando(false);
    load();
  }

  async function toggleActivo(id, activo) {
    await supabase.from("vehiculo").update({ activo: !activo }).eq("id", id);
    load();
  }

  const filtrados = filtro === "todos"
    ? vehiculos
    : vehiculos.filter((v) => v.tipo === filtro);

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-medium text-ink mb-1">Vehículos</h1>
      <p className="text-sm text-ink-secondary mb-6">
        Gestiona tractoras, remolques y otros vehículos de la flota.
      </p>

      {error && (
        <div className="mb-4 text-xs px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-estado-incidencia flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-ink-muted ml-2">✕</button>
        </div>
      )}

      <form onSubmit={añadir} className="bg-surface border border-border rounded-xl p-4 mb-6 flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs text-ink-secondary mb-1">Matrícula</label>
          <input
            value={form.matricula}
            onChange={(e) => setForm({ ...form, matricula: e.target.value })}
            placeholder="1234 ABC"
            maxLength={15}
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-32"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">Tipo</label>
          <select
            value={form.tipo}
            onChange={(e) => setForm({ ...form, tipo: e.target.value })}
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
          >
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">Marca</label>
          <input
            value={form.marca}
            onChange={(e) => setForm({ ...form, marca: e.target.value })}
            placeholder="Scania"
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-28"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">Modelo</label>
          <input
            value={form.modelo}
            onChange={(e) => setForm({ ...form, modelo: e.target.value })}
            placeholder="R450"
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-28"
          />
        </div>
        <button
          type="submit"
          disabled={guardando || !form.matricula.trim()}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
        >
          <Plus size={16} /> Añadir
        </button>
      </form>

      <div className="flex gap-2 mb-4">
        {["todos", ...TIPOS.map((t) => t.value)].map((t) => (
          <button
            key={t}
            onClick={() => setFiltro(t)}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              filtro === t
                ? "bg-brand text-white border-brand"
                : "border-border text-ink-secondary hover:bg-surface-alt"
            }`}
          >
            {t === "todos" ? "Todos" : TIPOS.find((x) => x.value === t)?.label || t}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {filtrados.map((v) => (
          <div key={v.id} className={`bg-surface border border-border rounded-xl p-4 flex items-center gap-4 ${!v.activo ? "opacity-50" : ""}`}>
            <div className="w-9 h-9 rounded-full bg-blue-50 text-estado-en-curso flex items-center justify-center">
              <Truck size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink font-mono">{v.matricula}</div>
              <div className="text-xs text-ink-secondary">
                {TIPOS.find((t) => t.value === v.tipo)?.label}
                {v.marca && ` · ${v.marca}`}
                {v.modelo && ` ${v.modelo}`}
              </div>
            </div>
            <button
              onClick={() => toggleActivo(v.id, v.activo)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                v.activo
                  ? "border-estado-ok text-estado-ok"
                  : "border-border text-ink-muted"
              }`}
            >
              {v.activo ? "Activo" : "Inactivo"}
            </button>
          </div>
        ))}
        {filtrados.length === 0 && (
          <p className="text-sm text-ink-secondary py-4">No hay vehículos {filtro !== "todos" ? `de tipo "${filtro}"` : ""}. Añade el primero arriba.</p>
        )}
      </div>
    </div>
  );
}
