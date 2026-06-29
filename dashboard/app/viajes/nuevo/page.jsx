"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, AlertTriangle, Info } from "lucide-react";
import { getChoferes, createViaje, validarAsignacion } from "../../../lib/data";
import { supabase } from "../../../lib/supabase";

function nuevoHito() {
  return { tipo: "entrega", direccion: "", ventana_inicio: "", ventana_fin: "" };
}

export default function NuevoViaje() {
  const router = useRouter();
  const [choferes, setChoferes] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [plantillas, setPlantillas] = useState([]);
  const [referencia, setReferencia] = useState("");
  const [choferId, setChoferId] = useState("");
  const [vehiculoId, setVehiculoId] = useState("");
  const [remolqueId, setRemolqueId] = useState("");
  const [hitos, setHitos] = useState([nuevoHito()]);
  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [errorGuardar, setErrorGuardar] = useState(null);
  const validarTimer = useRef(null);

  useEffect(() => {
    getChoferes().then(setChoferes);
    supabase
      .from("vehiculo")
      .select("id, matricula, tipo, marca, modelo")
      .eq("activo", true)
      .order("matricula")
      .then(({ data }) => setVehiculos(data || []));
    supabase
      .from("plantilla_ruta")
      .select("id, nombre")
      .order("nombre")
      .then(({ data }) => setPlantillas(data || []));
  }, []);

  const tractoras = vehiculos.filter((v) => ["tractora", "rigido", "furgoneta"].includes(v.tipo));
  const remolques = vehiculos.filter((v) => v.tipo === "remolque");

  function validarConDebounce(newChofer, newVeh, newRem, newRef) {
    clearTimeout(validarTimer.current);
    validarTimer.current = setTimeout(async () => {
      const result = await validarAsignacion({
        choferId: newChofer || null,
        vehiculoId: newVeh || null,
        remolqueId: newRem || null,
        referencia: newRef?.trim() || null,
      });
      setAvisos(result.avisos);
      setErrores(result.errores);
    }, 300);
  }

  function setChoferIdWrapped(v) { setChoferId(v); validarConDebounce(v, vehiculoId, remolqueId, referencia); }
  function setVehiculoIdWrapped(v) { setVehiculoId(v); validarConDebounce(choferId, v, remolqueId, referencia); }
  function setRemolqueIdWrapped(v) { setRemolqueId(v); validarConDebounce(choferId, vehiculoId, v, referencia); }
  function setReferenciaWrapped(v) { setReferencia(v); validarConDebounce(choferId, vehiculoId, remolqueId, v); }

  function validarVentanas() {
    for (let i = 0; i < hitos.length; i++) {
      const h = hitos[i];
      if (h.ventana_inicio && h.ventana_fin && h.ventana_inicio >= h.ventana_fin) {
        return `Hito ${i + 1}: la ventana de inicio debe ser anterior a la de fin`;
      }
    }
    return null;
  }

  async function cargarPlantilla(plantillaId) {
    if (!plantillaId) return;
    const { data } = await supabase
      .from("plantilla_hito")
      .select("tipo, direccion")
      .eq("plantilla_ruta_id", plantillaId)
      .order("orden");
    if (data?.length) {
      setHitos(data.map((h) => ({ ...h, ventana_inicio: "", ventana_fin: "" })));
    }
  }

  function actualizarHito(i, campo, valor) {
    setHitos((hs) => hs.map((h, idx) => (idx === i ? { ...h, [campo]: valor } : h)));
  }

  async function guardar(e) {
    e.preventDefault();
    setErrorGuardar(null);

    const errorVentana = validarVentanas();
    if (errorVentana) { setErrorGuardar(errorVentana); return; }

    if (errores.length > 0) { setErrorGuardar(errores.join(". ")); return; }

    if (avisos.length > 0) {
      if (!confirm(`Atención:\n\n${avisos.join("\n")}\n\n¿Crear el viaje de todos modos?`)) return;
    }

    setGuardando(true);
    try {
      const result = await createViaje({
        referencia: referencia.trim(),
        choferId: choferId || null,
        vehiculoId: vehiculoId || null,
        remolqueId: remolqueId || null,
        hitos: hitos.filter((h) => h.direccion.trim()),
      });
      router.push(`/viajes/${result.viaje.id}`);
    } catch (err) {
      setErrorGuardar(err.message);
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary no-underline mb-4 hover:text-ink">
        <ArrowLeft size={16} /> Volver
      </Link>
      <h1 className="text-xl font-medium text-ink mb-6">Nuevo viaje</h1>

      {errorGuardar && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-estado-incidencia">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {errorGuardar}
        </div>
      )}

      {avisos.length > 0 && (
        <div className="flex flex-col gap-1 mb-4 px-3 py-2.5 rounded-lg bg-yellow-50 border border-yellow-200">
          {avisos.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-yellow-700">
              <Info size={14} className="shrink-0 mt-0.5" /> {a}
            </div>
          ))}
        </div>
      )}

      {errores.length > 0 && (
        <div className="flex flex-col gap-1 mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200">
          {errores.map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-estado-incidencia">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {e}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={guardar} className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Referencia</label>
            <input
              value={referencia}
              onChange={(e) => setReferenciaWrapped(e.target.value)}
              placeholder="VJ-2055"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Chófer</label>
            <select
              value={choferId}
              onChange={(e) => setChoferIdWrapped(e.target.value)}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            >
              <option value="">Sin asignar</option>
              {choferes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} ({c.idioma?.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Vehículo</label>
            <select
              value={vehiculoId}
              onChange={(e) => setVehiculoIdWrapped(e.target.value)}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            >
              <option value="">Sin asignar</option>
              {tractoras.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.matricula} {v.marca && `· ${v.marca}`} {v.modelo || ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Remolque</label>
            <select
              value={remolqueId}
              onChange={(e) => setRemolqueIdWrapped(e.target.value)}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            >
              <option value="">Sin remolque</option>
              {remolques.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.matricula} {v.marca && `· ${v.marca}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {plantillas.length > 0 && (
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Cargar desde plantilla</label>
            <select
              onChange={(e) => cargarPlantilla(e.target.value)}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
              defaultValue=""
            >
              <option value="">— Hitos manuales —</option>
              {plantillas.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-ink">Hitos</label>
            <button
              type="button"
              onClick={() => setHitos((hs) => [...hs, nuevoHito()])}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
            >
              <Plus size={14} /> Añadir hito
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {hitos.map((h, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-xs text-ink-muted w-5">{i + 1}.</span>
                  <select
                    value={h.tipo}
                    onChange={(e) => actualizarHito(i, "tipo", e.target.value)}
                    className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                  >
                    <option value="recogida">Recogida</option>
                    <option value="entrega">Entrega</option>
                  </select>
                  <input
                    value={h.direccion}
                    onChange={(e) => actualizarHito(i, "direccion", e.target.value)}
                    placeholder="Dirección"
                    className="flex-1 text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:border-brand"
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
                <div className="flex items-center gap-2 pl-7">
                  <span className="text-xs text-ink-muted">Ventana:</span>
                  <input
                    type="datetime-local"
                    value={h.ventana_inicio}
                    onChange={(e) => actualizarHito(i, "ventana_inicio", e.target.value)}
                    className="text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand"
                  />
                  <span className="text-xs text-ink-muted">–</span>
                  <input
                    type="datetime-local"
                    value={h.ventana_fin}
                    onChange={(e) => actualizarHito(i, "ventana_fin", e.target.value)}
                    className="text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={guardando || errores.length > 0}
          className="self-start text-sm px-4 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
        >
          {guardando ? "Creando…" : "Crear viaje"}
        </button>
      </form>
    </div>
  );
}
