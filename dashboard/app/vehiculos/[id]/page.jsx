"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Plus, Wrench, CalendarCheck, AlertTriangle,
  CheckCircle2, Clock, Trash2, Siren,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { getCurrentEmpresaId, getMultasPorVehiculo, guardarCapacidadVehiculo, guardarSubtipoVehiculo } from "../../../lib/data";
import DocumentosSection from "../../components/DocumentosSection";
import { TIPOS_DOC_VEHICULO, TIPO_MANTENIMIENTO_LABEL, ESTADO_MANTENIMIENTO_CHIP, SUBTIPO_LABEL } from "../../../lib/labels";
import RequireRol from "../../components/RequireRol";
import SectionCard from "../../components/ui/SectionCard";
import { fmtEur, fmtKm, fmtFecha, fmtFechaLarga } from "../../../lib/format";

// Iconos por tipo (lucide-react no puede vivir en labels.js, que es texto/color puro
// reutilizable — ver 7A.12); el resto de cada entrada viene de TIPO_MANTENIMIENTO_LABEL.
const ICONO_TIPO = {
  itv: CalendarCheck,
  revision: Wrench,
  averia: AlertTriangle,
  reparacion: Wrench,
  otro: Wrench,
};
const TIPO_LABEL = Object.fromEntries(
  Object.entries(TIPO_MANTENIMIENTO_LABEL).map(([tipo, v]) => [tipo, { ...v, icon: ICONO_TIPO[tipo] }])
);

const ESTADO_CHIP = ESTADO_MANTENIMIENTO_CHIP;

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
  const [multas, setMultas] = useState(null);
  const [capacidadLdm, setCapacidadLdm] = useState("");
  const [capacidadKg, setCapacidadKg] = useState("");
  const [capacidadM3, setCapacidadM3] = useState("");
  const [guardandoCapacidad, setGuardandoCapacidad] = useState(false);
  const [subtipo, setSubtipo] = useState("");
  const [temperaturaMin, setTemperaturaMin] = useState("");
  const [temperaturaMax, setTemperaturaMax] = useState("");
  const [guardandoSubtipo, setGuardandoSubtipo] = useState(false);

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
      setCapacidadLdm(v?.capacidad_ldm != null ? String(v.capacidad_ldm) : "");
      setCapacidadKg(v?.capacidad_kg != null ? String(v.capacidad_kg) : "");
      setCapacidadM3(v?.capacidad_m3 != null ? String(v.capacidad_m3) : "");
      setSubtipo(v?.subtipo || "");
      setTemperaturaMin(v?.temperatura_min != null ? String(v.temperatura_min) : "");
      setTemperaturaMax(v?.temperatura_max != null ? String(v.temperatura_max) : "");
      await loadRegistros();
      setLoading(false);
      getMultasPorVehiculo(id).then(setMultas);
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

  async function guardarCapacidad() {
    setGuardandoCapacidad(true);
    setError(null);
    try {
      await guardarCapacidadVehiculo(id, { ldm: capacidadLdm, kg: capacidadKg, m3: capacidadM3 });
      setVehiculo((v) => ({
        ...v,
        capacidad_ldm: capacidadLdm.trim() === "" ? null : Number(capacidadLdm),
        capacidad_kg: capacidadKg.trim() === "" ? null : Number(capacidadKg),
        capacidad_m3: capacidadM3.trim() === "" ? null : Number(capacidadM3),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoCapacidad(false);
    }
  }

  async function guardarSubtipo() {
    setGuardandoSubtipo(true);
    setError(null);
    try {
      await guardarSubtipoVehiculo(id, { subtipo, temperaturaMin, temperaturaMax });
      setVehiculo((v) => ({
        ...v,
        subtipo: subtipo || null,
        temperatura_min: temperaturaMin.trim() === "" ? null : Number(temperaturaMin),
        temperatura_max: temperaturaMax.trim() === "" ? null : Number(temperaturaMax),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoSubtipo(false);
    }
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
        <div className="h-24 bg-border rounded-xl animate-pulse" />
        <div className="h-64 bg-border rounded-xl animate-pulse" />
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
              {[vehiculo.marca, vehiculo.modelo, vehiculo.tipo, SUBTIPO_LABEL[vehiculo.subtipo]].filter(Boolean).join(" · ")}
              {vehiculo.subtipo === "frigorifico" && (vehiculo.temperatura_min != null || vehiculo.temperatura_max != null) && (
                <> ({vehiculo.temperatura_min ?? "?"}° a {vehiculo.temperatura_max ?? "?"}°C)</>
              )}
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
            ITV pendiente{proxITV.fecha ? ` — ${fmtFechaLarga(proxITV.fecha)}` : ""}
          </div>
        )}
        <RequireRol roles={["admin"]}>
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
        <div className="mt-3 pt-3 border-t border-border flex items-end gap-3 flex-wrap">
          <div className="flex-1 max-w-[8rem]">
            <label htmlFor="vehiculo-ldm" className="block text-xs text-ink-secondary mb-1">Capacidad (LDM)</label>
            <input
              id="vehiculo-ldm"
              type="number"
              step="any"
              min="0"
              value={capacidadLdm}
              onChange={(e) => setCapacidadLdm(e.target.value)}
              placeholder="13,6"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface"
            />
          </div>
          <div className="flex-1 max-w-[8rem]">
            <label htmlFor="vehiculo-kg" className="block text-xs text-ink-secondary mb-1">Capacidad (kg)</label>
            <input
              id="vehiculo-kg"
              type="number"
              step="any"
              min="0"
              value={capacidadKg}
              onChange={(e) => setCapacidadKg(e.target.value)}
              placeholder="24000"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface"
            />
          </div>
          <div className="flex-1 max-w-[8rem]">
            <label htmlFor="vehiculo-m3" className="block text-xs text-ink-secondary mb-1">Capacidad (m³)</label>
            <input
              id="vehiculo-m3"
              type="number"
              step="any"
              min="0"
              value={capacidadM3}
              onChange={(e) => setCapacidadM3(e.target.value)}
              placeholder="90"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface"
            />
          </div>
          <button
            onClick={guardarCapacidad}
            disabled={guardandoCapacidad}
            className="text-xs px-3 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
          >
            {guardandoCapacidad ? "Guardando…" : "Guardar"}
          </button>
          <p className="flex-1 text-xs text-ink-muted pb-1 min-w-[12rem]">
            Para saber si una carga es camión completo o grupaje en el cotizador. Las tres son opcionales.
          </p>
        </div>
        {vehiculo.tipo === "remolque" && (
          <div className="mt-3 pt-3 border-t border-border flex items-end gap-3 flex-wrap">
            <div className="flex-1 max-w-[10rem]">
              <label htmlFor="vehiculo-subtipo" className="block text-xs text-ink-secondary mb-1">Tipo de remolque</label>
              <select
                id="vehiculo-subtipo"
                value={subtipo}
                onChange={(e) => setSubtipo(e.target.value)}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
              >
                <option value="">Sin especificar</option>
                <option value="lona">Lona</option>
                <option value="caja_cerrada">Caja cerrada</option>
                <option value="frigorifico">Frigorífico</option>
                <option value="cisterna">Cisterna</option>
                <option value="portacontenedor">Portacontenedor</option>
              </select>
            </div>
            {subtipo === "frigorifico" && (
              <>
                <div className="flex-1 max-w-[8rem]">
                  <label htmlFor="vehiculo-temp-min" className="block text-xs text-ink-secondary mb-1">Temp. mín. (°C)</label>
                  <input
                    id="vehiculo-temp-min"
                    type="number"
                    step="any"
                    value={temperaturaMin}
                    onChange={(e) => setTemperaturaMin(e.target.value)}
                    placeholder="-20"
                    className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
                  />
                </div>
                <div className="flex-1 max-w-[8rem]">
                  <label htmlFor="vehiculo-temp-max" className="block text-xs text-ink-secondary mb-1">Temp. máx. (°C)</label>
                  <input
                    id="vehiculo-temp-max"
                    type="number"
                    step="any"
                    value={temperaturaMax}
                    onChange={(e) => setTemperaturaMax(e.target.value)}
                    placeholder="5"
                    className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
                  />
                </div>
              </>
            )}
            <button
              onClick={guardarSubtipo}
              disabled={guardandoSubtipo}
              className="text-xs px-3 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
            >
              {guardandoSubtipo ? "Guardando…" : "Guardar"}
            </button>
            <p className="flex-1 text-xs text-ink-muted pb-1 min-w-[12rem]">
              El rango de temperatura real que puede mantener este frigorífico (distinto de lo que pida el
              cliente en un viaje concreto).
            </p>
          </div>
        )}
        </RequireRol>
      </div>

      {/* Multas (7A.7) */}
      {multas && multas.total > 0 && (
        <div className="mb-4">
          <SectionCard title="Multas" icon={Siren}>
            <div className="text-lg font-semibold text-ink mb-2">{fmtEur(multas.total)}</div>
            <div className="flex flex-col gap-1">
              {multas.ultimas.map((m) => (
                <div key={m.id} className="flex justify-between text-xs text-ink-secondary">
                  <span>{m.fecha ? new Date(m.fecha + "T12:00:00").toLocaleDateString("es-ES") : "sin fecha"}{m.descripcion ? ` — ${m.descripcion}` : ""}</span>
                  <span className="font-medium text-ink">{fmtEur(Number(m.importe))}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* Mantenimiento */}
      <SectionCard
        title="Mantenimiento / Averías"
        noPadding
        actions={
          <RequireRol roles={["admin", "gestor_operativo"]}>
            <button
              onClick={() => setMostrarForm((v) => !v)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-brand text-white"
            >
              <Plus size={13} /> Añadir registro
            </button>
          </RequireRol>
        }
      >
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
                          {fmtFecha(r.fecha)}
                        </span>
                      )}
                      {r.km && <span>{fmtKm(r.km)}</span>}
                      {r.coste && <span>{parseFloat(r.coste).toFixed(2)} €</span>}
                    </div>
                  </div>
                  <RequireRol roles={["admin", "gestor_operativo"]}>
                    <button
                      onClick={() => borrar(r.id)}
                      disabled={borrandoId === r.id}
                      className="text-ink-muted hover:text-estado-incidencia disabled:opacity-40 shrink-0 p-1"
                      title="Eliminar registro"
                    >
                      <Trash2 size={14} />
                    </button>
                  </RequireRol>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <div className="mt-4">
        <DocumentosSection ambito="vehiculo" entidadId={id} tipos={TIPOS_DOC_VEHICULO} />
      </div>
    </div>
  );
}
