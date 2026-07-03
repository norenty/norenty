"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Plus, Wrench, CalendarCheck, AlertTriangle,
  CheckCircle2, Clock, Trash2,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { getCurrentEmpresaId } from "../../../lib/data";
import DocumentosSection from "../../components/DocumentosSection";

const TIPOS_DOC_VEHICULO = [
  { value: "itv", label: "ITV" },
  { value: "seguro", label: "Seguro" },
  { value: "autorizacion_transporte", label: "Autorización de transporte" },
  { value: "otro", label: "Otro" },
];

const TIPO_LABEL = {
  itv: { label: "ITV", icon: CalendarCheck, color: "text-blue-600", bg: "bg-blue-50" },
  revision: { label: "Revisión", icon: Wrench, color: "text-indigo-600", bg: "bg-indigo-50" },
  averia: { label: "Avería", icon: AlertTriangle, color: "text-estado-incidencia", bg: "bg-red-50" },
  reparacion: { label: "Reparación", icon: Wrench, color: "text-yellow-600", bg: "bg-yellow-50" },
  otro: { label: "Otro", icon: Wrench, color: "text-ink-secondary", bg: "bg-surface-alt" },
};

const ESTADO_CHIP = {
  completado: "bg-green-50 text-estado-ok",
  pendiente: "bg-yellow-50 text-yellow-700",
};

const TIPOS = ["itv", "revision", "averia", "reparacion", "otro"];

function initForm() {
  return { tipo: "revision", descripcion: "", fecha: "", km: "", coste: "", estado: "completado" };
}

export default function VehiculoDetalle() {
  const { id } = useParams();
  const [vehiculo, setVehiculo] = useState(null);
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(initForm());
  const [guardando, setGuardando] = useState(false);
  const [borrandoId, setBorrandoId] = useState(null);
  const [error, setError] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [costeKm, setCosteKm] = useState("");
  const [consumoL100km, setConsumoL100km] = useState("");
  const [guardandoCoste, setGuardandoCoste] = useState(false);

  const loadRegistros = useCallback(async () => {
    const { data } = await supabase
      .from("mantenimiento_vehiculo")
      .select("*")
      .eq("vehiculo_id", id)
      .order("fecha", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    setRegistros(data || []);
  }, [id]);

  useEffect(() => {
    async function load() {
      const { data: v } = await supabase
        .from("vehiculo")
        .select("*")
        .eq("id", id)
        .single();
      setVehiculo(v);
      setCosteKm(v?.coste_km != null ? String(v.coste_km) : "");
      setConsumoL100km(v?.consumo_l_100km != null ? String(v.consumo_l_100km) : "");
      await loadRegistros();
      setLoading(false);
    }
    load();
  }, [id, loadRegistros]);

  async function guardarCosteKm() {
    const coste = costeKm.trim() === "" ? null : Number(costeKm);
    const consumo = consumoL100km.trim() === "" ? null : Number(consumoL100km);
    if (coste != null && (Number.isNaN(coste) || coste < 0)) {
      setError("El coste por km debe ser un número positivo.");
      return;
    }
    if (consumo != null && (Number.isNaN(consumo) || consumo < 0)) {
      setError("El consumo debe ser un número positivo.");
      return;
    }
    setGuardandoCoste(true);
    setError(null);
    await supabase.from("vehiculo").update({ coste_km: coste, consumo_l_100km: consumo }).eq("id", id);
    setVehiculo((v) => ({ ...v, coste_km: coste, consumo_l_100km: consumo }));
    setGuardandoCoste(false);
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.tipo) return;
    setGuardando(true);
    setError(null);
    try {
      const empresaId = await getCurrentEmpresaId();
      const payload = {
        vehiculo_id: id,
        empresa_id: empresaId,
        tipo: form.tipo,
        descripcion: form.descripcion.trim() || null,
        fecha: form.fecha || null,
        km: form.km ? parseInt(form.km, 10) : null,
        coste: form.coste ? parseFloat(form.coste) : null,
        estado: form.estado,
      };
      const { error: err } = await supabase.from("mantenimiento_vehiculo").insert(payload);
      if (err) throw err;
      setForm(initForm());
      setMostrarForm(false);
      await loadRegistros();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(regId) {
    if (borrandoId) return;
    setBorrandoId(regId);
    await supabase.from("mantenimiento_vehiculo").delete().eq("id", regId);
    await loadRegistros();
    setBorrandoId(null);
  }

  const proxITV = registros.find((r) => r.tipo === "itv" && r.estado === "pendiente");

  if (loading) {
    return (
      <div className="max-w-3xl space-y-4">
        <div className="h-24 bg-surface-alt rounded-xl animate-pulse" />
        <div className="h-64 bg-surface-alt rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!vehiculo) {
    return (
      <div className="max-w-3xl">
        <Link href="/vehiculos" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary mb-4 no-underline hover:text-ink">
          <ArrowLeft size={16} /> Vehículos
        </Link>
        <p className="text-sm text-ink-secondary">Vehículo no encontrado.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link href="/vehiculos" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary mb-4 no-underline hover:text-ink">
        <ArrowLeft size={16} /> Vehículos
      </Link>

      {/* Cabecera vehículo */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-medium text-ink font-mono">{vehiculo.matricula}</h1>
            <p className="text-sm text-ink-secondary">
              {[vehiculo.marca, vehiculo.modelo, vehiculo.tipo].filter(Boolean).join(" · ")}
            </p>
            {vehiculo.notas && <p className="text-xs text-ink-muted mt-1">{vehiculo.notas}</p>}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full ${vehiculo.activo ? "bg-green-50 text-estado-ok" : "bg-gray-100 text-ink-muted"}`}>
            {vehiculo.activo ? "Activo" : "Inactivo"}
          </span>
        </div>
        {proxITV && (
          <div className="mt-3 flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 px-3 py-2 rounded-lg">
            <CalendarCheck size={13} />
            ITV pendiente{proxITV.fecha ? ` — ${new Date(proxITV.fecha + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}` : ""}
          </div>
        )}
        <div className="mt-3 pt-3 border-t border-border flex items-end gap-3">
          <div className="flex-1 max-w-[10rem]">
            <label htmlFor="vehiculo-coste-km" className="block text-xs text-ink-secondary mb-1">Coste por km (€)</label>
            <input
              id="vehiculo-coste-km"
              type="number"
              step="any"
              min="0"
              value={costeKm}
              onChange={(e) => setCosteKm(e.target.value)}
              placeholder="por defecto: empresa"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface"
            />
          </div>
          <div className="flex-1 max-w-[10rem]">
            <label htmlFor="vehiculo-consumo" className="block text-xs text-ink-secondary mb-1">Consumo (l/100km)</label>
            <input
              id="vehiculo-consumo"
              type="number"
              step="any"
              min="0"
              value={consumoL100km}
              onChange={(e) => setConsumoL100km(e.target.value)}
              placeholder="30"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface"
            />
          </div>
          <button
            onClick={guardarCosteKm}
            disabled={guardandoCoste}
            className="text-xs px-3 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
          >
            {guardandoCoste ? "Guardando…" : "Guardar"}
          </button>
          <p className="flex-1 text-xs text-ink-muted pb-1">
            Sobrescribe el coste/km de la empresa solo para este vehículo. Vacío = usa el de la empresa.
          </p>
        </div>
      </div>

      {/* Mantenimiento */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-ink">Mantenimiento / Averías</h2>
          <button
            onClick={() => setMostrarForm((v) => !v)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-brand text-white"
          >
            <Plus size={13} /> Añadir registro
          </button>
        </div>

        {mostrarForm && (
          <form onSubmit={guardar} className="p-4 border-b border-border bg-surface-alt">
            {error && (
              <p className="text-xs text-estado-incidencia mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">{error}</p>
            )}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-ink-secondary mb-1">Tipo *</label>
                <select
                  value={form.tipo}
                  onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
                >
                  {TIPOS.map((t) => (
                    <option key={t} value={t}>{TIPO_LABEL[t].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-secondary mb-1">Estado</label>
                <select
                  value={form.estado}
                  onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value }))}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
                >
                  <option value="completado">Completado</option>
                  <option value="pendiente">Pendiente</option>
                </select>
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs text-ink-secondary mb-1">Descripción</label>
              <input
                value={form.descripcion}
                onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                placeholder="Ej: Cambio de aceite y filtros"
                maxLength={300}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
              />
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs text-ink-secondary mb-1">Fecha</label>
                <input
                  type="date"
                  value={form.fecha}
                  onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-secondary mb-1">Km</label>
                <input
                  type="number"
                  value={form.km}
                  onChange={(e) => setForm((f) => ({ ...f, km: e.target.value }))}
                  placeholder="125000"
                  min="0"
                  className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-secondary mb-1">Coste (€)</label>
                <input
                  type="number"
                  value={form.coste}
                  onChange={(e) => setForm((f) => ({ ...f, coste: e.target.value }))}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setMostrarForm(false); setForm(initForm()); setError(null); }}
                className="text-xs px-3 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardando}
                className="text-xs px-3 py-2 rounded-md bg-brand text-white disabled:opacity-40"
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </form>
        )}

        {registros.length === 0 ? (
          <p className="text-sm text-ink-secondary p-6 text-center">
            Sin registros de mantenimiento. Añade el primero con el botón de arriba.
          </p>
        ) : (
          <div>
            {registros.map((r) => {
              const tp = TIPO_LABEL[r.tipo] || TIPO_LABEL.otro;
              const Icon = tp.icon;
              return (
                <div key={r.id} className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-0">
                  <div className={`w-8 h-8 rounded-full ${tp.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    <Icon size={14} className={tp.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-ink">{tp.label}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${ESTADO_CHIP[r.estado]}`}>
                        {r.estado === "completado" ? "Completado" : "Pendiente"}
                      </span>
                    </div>
                    {r.descripcion && (
                      <p className="text-xs text-ink-secondary mb-1">{r.descripcion}</p>
                    )}
                    <div className="flex gap-3 text-xs text-ink-muted">
                      {r.fecha && (
                        <span className="flex items-center gap-1">
                          <Clock size={11} />
                          {new Date(r.fecha + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      )}
                      {r.km && <span>{r.km.toLocaleString("es-ES")} km</span>}
                      {r.coste && <span>{parseFloat(r.coste).toFixed(2)} €</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => borrar(r.id)}
                    disabled={borrandoId === r.id}
                    className="text-ink-muted hover:text-estado-incidencia disabled:opacity-40 shrink-0 p-1"
                    title="Eliminar registro"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4">
        <DocumentosSection ambito="vehiculo" entidadId={id} tipos={TIPOS_DOC_VEHICULO} />
      </div>
    </div>
  );
}
