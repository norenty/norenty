"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Copy, Route } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { getCurrentEmpresaId, getClientes, getDireccionesGuardadas } from "../../lib/data";
import EmptyState from "../components/ui/EmptyState";
import Buscador from "../components/ui/Buscador";
import DireccionAutocomplete from "../components/ui/DireccionAutocomplete";

function nuevoHito() {
  return { tipo: "entrega", direccion: "", lat: "", lon: "" };
}

export default function PlantillasPage() {
  const [plantillas, setPlantillas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [direccionesGuardadas, setDireccionesGuardadas] = useState([]);
  const [nombre, setNombre] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [hitos, setHitos] = useState([nuevoHito()]);
  const [guardando, setGuardando] = useState(false);
  const [expandida, setExpandida] = useState(null);
  const [detalles, setDetalles] = useState({});

  async function load() {
    const { data } = await supabase
      .from("plantilla_ruta")
      .select("*, cliente:cliente_id(nombre)")
      .order("created_at", { ascending: false });
    setPlantillas(data || []);
  }

  async function loadHitos(plantillaId) {
    if (detalles[plantillaId]) return;
    const { data } = await supabase
      .from("plantilla_hito")
      .select("*")
      .eq("plantilla_ruta_id", plantillaId)
      .order("orden");
    setDetalles((d) => ({ ...d, [plantillaId]: data || [] }));
  }

  useEffect(() => {
    load();
    getClientes().then(setClientes);
    getDireccionesGuardadas().then(setDireccionesGuardadas);
  }, []);

  function actualizarHito(i, campo, valor) {
    setHitos((hs) => hs.map((h, idx) => (idx === i ? { ...h, [campo]: valor } : h)));
  }

  async function crear(e) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setGuardando(true);
    const empresa_id = await getCurrentEmpresaId();
    const { data: plantilla } = await supabase
      .from("plantilla_ruta")
      .insert({ nombre: nombre.trim(), empresa_id, cliente_id: clienteId || null })
      .select()
      .single();

    const rows = hitos
      .filter((h) => h.direccion.trim())
      .map((h, i) => ({
        plantilla_ruta_id: plantilla.id,
        orden: i + 1,
        tipo: h.tipo,
        direccion: h.direccion.trim(),
        lat: h.lat === "" ? null : Number(h.lat),
        lon: h.lon === "" ? null : Number(h.lon),
      }));
    if (rows.length) await supabase.from("plantilla_hito").insert(rows);

    setNombre("");
    setClienteId("");
    setHitos([nuevoHito()]);
    setGuardando(false);
    load();
  }

  async function usarPlantilla(plantillaId) {
    // Se relee directo de la BD en vez de fiarse de `detalles` (fix real
    // 2026-07-23: `detalles` viene de un setState anterior en la misma
    // función y todavía puede estar obsoleto en este cierre — con una
    // plantilla recién cargada por primera vez, `hitosPlantilla` salía vacío).
    const { data: hitosPlantilla } = await supabase
      .from("plantilla_hito")
      .select("orden, tipo, direccion, lat, lon")
      .eq("plantilla_ruta_id", plantillaId)
      .order("orden");
    if (!hitosPlantilla?.length) return;

    const empresa_id = await getCurrentEmpresaId();
    const p = plantillas.find((x) => x.id === plantillaId);
    const { data: viaje } = await supabase
      .from("viaje")
      .insert({ referencia: `${p.nombre}-${Date.now().toString(36)}`, empresa_id, cliente_id: p.cliente_id || null, estado: "planificado" })
      .select("id")
      .single();

    const rows = hitosPlantilla.map((h) => ({
      viaje_id: viaje.id,
      orden: h.orden,
      tipo: h.tipo,
      direccion: h.direccion,
      lat: h.lat,
      lon: h.lon,
      estado: "pendiente",
    }));
    if (rows.length) await supabase.from("hito").insert(rows);
    alert(`Viaje creado desde plantilla "${p.nombre}". Asígnale chófer en el Kanban.`);
  }

  async function eliminar(id) {
    if (!confirm("¿Eliminar esta plantilla?")) return;
    await supabase.from("plantilla_ruta").delete().eq("id", id);
    load();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-medium text-ink mb-1">Plantillas de ruta</h1>
      <p className="text-sm text-ink-secondary mb-6">
        Rutas frecuentes que puedes reutilizar para crear viajes rápidamente.
      </p>

      <form onSubmit={crear} className="bg-surface border border-border rounded-xl p-4 mb-6">
        <div className="flex items-end gap-3 mb-3">
          <div className="flex-1">
            <label className="block text-xs text-ink-secondary mb-1">Nombre de la ruta</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Madrid → Barcelona diaria"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-ink-secondary mb-1">Cliente (opcional)</label>
            <Buscador
              opciones={clientes.map((c) => ({ value: c.id, label: c.nombre }))}
              value={clienteId}
              onChange={setClienteId}
              placeholder="Buscar cliente..."
              vacioLabel="Ruta genérica (sin cliente)"
            />
          </div>
          <button
            type="submit"
            disabled={guardando || !nombre.trim()}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            <Plus size={16} /> Crear
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {hitos.map((h, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-ink-muted font-mono w-5">{i + 1}.</span>
              <select
                value={h.tipo}
                onChange={(e) => actualizarHito(i, "tipo", e.target.value)}
                className="text-sm border border-border rounded-md px-2 py-1.5"
              >
                <option value="recogida">Recogida</option>
                <option value="entrega">Entrega</option>
              </select>
              <DireccionAutocomplete
                value={h.direccion}
                onChangeDireccion={(v) => actualizarHito(i, "direccion", v)}
                onElegirSugerida={(d) => {
                  actualizarHito(i, "direccion", d.direccion);
                  actualizarHito(i, "lat", String(d.lat));
                  actualizarHito(i, "lon", String(d.lon));
                }}
                direcciones={direccionesGuardadas}
                placeholder="Dirección"
              />
              {hitos.length > 1 && (
                <button
                  type="button"
                  onClick={() => setHitos((hs) => hs.filter((_, idx) => idx !== i))}
                  className="text-ink-muted hover:text-estado-incidencia p-1"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setHitos((hs) => [...hs, nuevoHito()])}
            className="flex items-center gap-1 text-xs text-ink-secondary hover:text-ink"
          >
            <Plus size={14} /> Añadir hito
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        {plantillas.map((p) => (
          <div key={p.id} className="bg-surface border border-border rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-purple-50 text-brand flex items-center justify-center">
                <Route size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink">{p.nombre}</div>
                {p.cliente?.nombre && <div className="text-xs text-ink-muted">{p.cliente.nombre}</div>}
                <button
                  onClick={() => {
                    setExpandida(expandida === p.id ? null : p.id);
                    loadHitos(p.id);
                  }}
                  className="text-xs text-ink-secondary hover:text-ink"
                >
                  {expandida === p.id ? "Ocultar hitos" : "Ver hitos"}
                </button>
              </div>
              <button
                onClick={() => usarPlantilla(p.id)}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-brand text-brand hover:bg-brand hover:text-white transition-colors"
              >
                <Copy size={14} /> Usar
              </button>
              <button
                onClick={() => eliminar(p.id)}
                className="text-ink-muted hover:text-estado-incidencia p-1"
              >
                <Trash2 size={16} />
              </button>
            </div>
            {expandida === p.id && detalles[p.id] && (
              <div className="mt-3 pl-12 flex flex-col gap-1">
                {detalles[p.id].map((h) => (
                  <div key={h.id} className="text-xs text-ink-secondary">
                    <span className="font-mono text-ink-muted">{h.orden}.</span>{" "}
                    <span className={h.tipo === "recogida" ? "text-estado-en-curso" : "text-estado-ok"}>
                      {h.tipo === "recogida" ? "Recogida" : "Entrega"}
                    </span>
                    {" — "}{h.direccion || "—"}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {plantillas.length === 0 && (
          <EmptyState icon={Route} titulo="Todavía no hay plantillas" texto="Crea la primera con el formulario de arriba." />
        )}
      </div>
    </div>
  );
}
