"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, AlertTriangle, Check, ChevronRight } from "lucide-react";
import { getChoferes, createViaje, validarAsignacion, calcularPanelViaje, getEstado561 } from "../../../lib/data";
import { supabase } from "../../../lib/supabase";
import SugerenciaChofer from "../../components/SugerenciaChofer";

// Wizard "Nuevo viaje" (7A.11) — construido en ruta nueva a propósito, SIN
// sustituir /viajes/nuevo todavía: el swap (decidir si este pasa a ser el
// flujo por defecto) es una decisión del usuario, no algo que el loop haga
// solo. Los hitos aquí SÍ capturan lat/lon (a diferencia de /viajes/nuevo,
// que solo pide dirección de texto) porque el panel de cálculo en vivo
// necesita coordenadas para estimar km/coste/precio sugerido.
function nuevoHito() {
  return { tipo: "entrega", direccion: "", lat: "", lon: "", ventana_inicio: "", ventana_fin: "" };
}

const PASOS = [
  { n: 1, label: "Ruta" },
  { n: 2, label: "Asignación" },
  { n: 3, label: "Confirmar" },
];

function colorMargenPct(pct) {
  if (pct == null) return "text-ink-muted";
  if (pct < 0) return "text-estado-incidencia";
  if (pct < 10) return "text-yellow-700";
  return "text-green-700";
}

export default function NuevoViajeWizard() {
  const router = useRouter();
  const [paso, setPaso] = useState(1);
  const [referencia, setReferencia] = useState("");
  const [precio, setPrecio] = useState("");
  const [hitos, setHitos] = useState([nuevoHito(), nuevoHito()]);
  const [choferId, setChoferId] = useState("");
  const [choferNombre, setChoferNombre] = useState("");
  const [vehiculoId, setVehiculoId] = useState("");
  const [remolqueId, setRemolqueId] = useState("");
  const [vehiculos, setVehiculos] = useState([]);
  const [choferes, setChoferes] = useState([]);
  const [panel, setPanel] = useState(null);
  const [calculandoPanel, setCalculandoPanel] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [avisoAsignacion, setAvisoAsignacion] = useState(null);
  const [aviso561, setAviso561] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    getChoferes().then(setChoferes);
    supabase.from("vehiculo").select("id, matricula, tipo, marca, modelo").eq("activo", true).order("matricula")
      .then(({ data }) => setVehiculos(data || []));
  }, []);

  const tractoras = vehiculos.filter((v) => ["tractora", "rigido", "furgoneta"].includes(v.tipo));
  const remolques = vehiculos.filter((v) => v.tipo === "remolque");

  // Panel lateral: recalcula con debounce 500ms cuando cambian hitos con
  // coords, vehículo o precio.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const puntos = hitos
      .filter((h) => h.lat !== "" && h.lon !== "" && h.lat != null && h.lon != null)
      .map((h) => ({ lat: Number(h.lat), lon: Number(h.lon) }));
    if (puntos.length < 2) {
      setPanel(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setCalculandoPanel(true);
      calcularPanelViaje({ puntos, vehiculoId: vehiculoId || null, precio: precio !== "" ? Number(precio) : null })
        .then(setPanel)
        .finally(() => setCalculandoPanel(false));
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [hitos, vehiculoId, precio]);

  function actualizarHito(i, campo, valor) {
    setHitos((hs) => hs.map((h, idx) => (idx === i ? { ...h, [campo]: valor } : h)));
  }

  async function irAPaso2() {
    setError(null);
    const result = await validarAsignacion({
      vehiculoId: vehiculoId || null, remolqueId: remolqueId || null, referencia: referencia.trim() || null,
    });
    if (!result.ok) {
      setError(result.errores.join(". "));
      return;
    }
    setAvisoAsignacion(result.avisos.length ? result.avisos.join(". ") : null);
    setPaso(2);
  }

  async function onAsignarChofer(id) {
    setChoferId(id);
    setChoferNombre(choferes.find((c) => c.id === id)?.nombre || "");
    setAviso561(null);
    const est = await getEstado561(id);
    if (est && est.pct7 >= 80) {
      setAviso561(`Cerca del límite semanal: quedan ${est.margen7} h (est.)`);
    }
  }

  async function crear() {
    setGuardando(true);
    setError(null);
    try {
      const result = await createViaje({
        referencia: referencia.trim() || null,
        choferId: choferId || null,
        vehiculoId: vehiculoId || null,
        remolqueId: remolqueId || null,
        hitos: hitos.filter((h) => h.direccion.trim()),
        precio: precio !== "" ? Number(precio) : null,
      });
      router.push(`/viajes/${result.viaje.id}`);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary no-underline mb-4 hover:text-ink">
        <ArrowLeft size={16} /> Volver
      </Link>
      <h1 className="text-xl font-medium text-ink mb-1">Nuevo viaje</h1>
      <p className="text-xs text-ink-muted mb-6">
        Versión de prueba del asistente guiado — el formulario clásico sigue disponible en{" "}
        <Link href="/viajes/nuevo" className="text-brand no-underline hover:underline">Nuevo viaje (clásico)</Link>.
      </p>

      <div className="flex items-center gap-2 mb-6">
        {PASOS.map((p, i) => (
          <div key={p.n} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 text-sm ${paso === p.n ? "text-ink font-medium" : paso > p.n ? "text-estado-ok" : "text-ink-muted"}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                paso > p.n ? "bg-green-50 text-estado-ok" : paso === p.n ? "bg-brand text-white" : "bg-surface-alt text-ink-muted"
              }`}>
                {paso > p.n ? <Check size={12} /> : p.n}
              </span>
              {p.label}
            </div>
            {i < PASOS.length - 1 && <ChevronRight size={14} className="text-ink-muted" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-estado-incidencia">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {paso === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="w-referencia" className="block text-xs text-ink-secondary mb-1">Referencia</label>
                <input
                  id="w-referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)}
                  placeholder="VJ-2055" maxLength={50}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
              </div>
              <div>
                <label htmlFor="w-precio" className="block text-xs text-ink-secondary mb-1">Precio (€)</label>
                <input
                  id="w-precio" type="number" step="any" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)}
                  placeholder="1200"
                  className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-ink">Paradas</label>
                <button
                  type="button" onClick={() => setHitos((hs) => [...hs, nuevoHito()])}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
                >
                  <Plus size={14} /> Añadir parada
                </button>
              </div>
              <div className="flex flex-col gap-3">
                {hitos.map((h, i) => (
                  <div key={i} className="bg-surface border border-border rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-xs text-ink-muted w-5">{i + 1}.</span>
                      <select
                        value={h.tipo} onChange={(e) => actualizarHito(i, "tipo", e.target.value)}
                        className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                      >
                        <option value="recogida">Recogida</option>
                        <option value="entrega">Entrega</option>
                      </select>
                      <input
                        value={h.direccion} onChange={(e) => actualizarHito(i, "direccion", e.target.value)}
                        placeholder="Dirección" maxLength={500}
                        className="flex-1 text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:border-brand"
                      />
                      {hitos.length > 2 && (
                        <button type="button" onClick={() => setHitos((hs) => hs.filter((_, idx) => idx !== i))} aria-label="Quitar parada" className="text-ink-muted hover:text-estado-incidencia p-1">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pl-7 mb-2">
                      <input
                        type="number" step="any" value={h.lat} onChange={(e) => actualizarHito(i, "lat", e.target.value)}
                        placeholder="Latitud" className="w-28 text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand"
                      />
                      <input
                        type="number" step="any" value={h.lon} onChange={(e) => actualizarHito(i, "lon", e.target.value)}
                        placeholder="Longitud" className="w-28 text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand"
                      />
                      <span className="text-xs text-ink-muted">para calcular km/coste en vivo</span>
                    </div>
                    <div className="flex items-center gap-2 pl-7">
                      <span className="text-xs text-ink-muted">Ventana:</span>
                      <input type="datetime-local" value={h.ventana_inicio} onChange={(e) => actualizarHito(i, "ventana_inicio", e.target.value)} className="text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand" />
                      <span className="text-xs text-ink-muted">–</span>
                      <input type="datetime-local" value={h.ventana_fin} onChange={(e) => actualizarHito(i, "ventana_fin", e.target.value)} className="text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={irAPaso2} className="self-start text-sm px-4 py-2 rounded-md bg-brand text-white font-medium">
              Siguiente: Asignación
            </button>
          </div>

          <aside className="bg-surface border border-border rounded-xl p-4 h-fit lg:sticky lg:top-4">
            <h2 className="text-sm font-medium text-ink mb-3">Cálculo en vivo</h2>
            {!panel ? (
              <p className="text-xs text-ink-muted">Añade latitud/longitud a 2 paradas para ver el cálculo.</p>
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                <div>
                  <div className="text-xs text-ink-secondary">Distancia</div>
                  <div className="text-ink font-medium">{panel.estimado && "~"}{panel.km.toLocaleString("es-ES")} km</div>
                </div>
                <div>
                  <div className="text-xs text-ink-secondary">Conducción / paradas / descansos</div>
                  <div className="text-ink font-medium">{panel.horasConduccion} h · {panel.paradas45min} · {panel.descansos11h}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-secondary">Noches fuera (est.)</div>
                  <div className="text-ink font-medium">{panel.noches}</div>
                </div>
                {panel.coste.total != null && (
                  <div>
                    <div className="text-xs text-ink-secondary">Coste estimado</div>
                    <div className="text-ink font-medium">{panel.coste.total.toLocaleString("es-ES")} €</div>
                  </div>
                )}
                {panel.precioSugerido != null && (
                  <div>
                    <div className="text-xs text-ink-secondary">Precio sugerido (margen {panel.margenObjetivo}%)</div>
                    <div className="text-ink font-medium">{panel.precioSugerido.toLocaleString("es-ES")} €</div>
                  </div>
                )}
                {panel.margenPct != null && (
                  <div className={`text-xs px-2 py-1.5 rounded-md ${panel.margenPct < 0 ? "bg-red-50" : panel.margenPct < 10 ? "bg-yellow-50" : "bg-green-50"} ${colorMargenPct(panel.margenPct)}`}>
                    Margen con tu precio: {panel.margen.toLocaleString("es-ES")} € ({panel.margenPct}%)
                  </div>
                )}
                {panel.estimado && (
                  <p className="text-xs text-yellow-700">~ distancia estimada en línea recta corregida.</p>
                )}
                {calculandoPanel && <p className="text-xs text-ink-muted">Recalculando…</p>}
              </div>
            )}
          </aside>
        </div>
      )}

      {paso === 2 && (
        <div className="flex flex-col gap-5 max-w-2xl">
          {avisoAsignacion && (
            <p className="text-xs text-yellow-700 flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> {avisoAsignacion}</p>
          )}
          <SugerenciaChofer
            viajeId={null}
            hitosOverride={hitos
              .filter((h) => h.lat !== "" && h.lon !== "" && h.lat != null && h.lon != null)
              .map((h, i) => ({ orden: i + 1, lat: Number(h.lat), lon: Number(h.lon) }))}
            onAsignado={onAsignarChofer}
          />
          {choferId && (
            <div className="text-sm text-ink bg-surface border border-border rounded-xl p-3">
              Asignado: <strong>{choferNombre}</strong>
              {aviso561 && <p className="text-xs text-yellow-700 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> {aviso561}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="w-vehiculo" className="block text-xs text-ink-secondary mb-1">Vehículo</label>
              <select id="w-vehiculo" value={vehiculoId} onChange={(e) => setVehiculoId(e.target.value)} className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand">
                <option value="">Sin asignar</option>
                {tractoras.map((v) => <option key={v.id} value={v.id}>{v.matricula} {v.marca && `· ${v.marca}`}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="w-remolque" className="block text-xs text-ink-secondary mb-1">Remolque</label>
              <select id="w-remolque" value={remolqueId} onChange={(e) => setRemolqueId(e.target.value)} className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand">
                <option value="">Sin remolque</option>
                {remolques.map((v) => <option key={v.id} value={v.id}>{v.matricula} {v.marca && `· ${v.marca}`}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPaso(1)} className="text-sm px-4 py-2 rounded-md border border-border text-ink-secondary">Atrás</button>
            <button onClick={() => setPaso(3)} className="text-sm px-4 py-2 rounded-md bg-brand text-white font-medium">Siguiente: Confirmar</button>
          </div>
        </div>
      )}

      {paso === 3 && (
        <div className="flex flex-col gap-4 max-w-xl">
          <div className="bg-surface border border-border rounded-xl p-4 text-sm flex flex-col gap-2">
            <div><span className="text-ink-secondary">Referencia:</span> {referencia || "—"}</div>
            <div><span className="text-ink-secondary">Precio:</span> {precio ? `${Number(precio).toLocaleString("es-ES")} €` : "—"}</div>
            <div><span className="text-ink-secondary">Paradas:</span> {hitos.filter((h) => h.direccion.trim()).length}</div>
            <div><span className="text-ink-secondary">Chófer:</span> {choferNombre || "Sin asignar"}</div>
            <div><span className="text-ink-secondary">Vehículo:</span> {tractoras.find((v) => v.id === vehiculoId)?.matricula || "Sin asignar"}</div>
            {panel && (
              <div className="pt-2 border-t border-border">
                <div className="text-ink-secondary text-xs mb-1">Viabilidad estimada</div>
                {panel.estimado && "~"}{panel.km.toLocaleString("es-ES")} km
                {panel.coste.total != null && ` · coste ${panel.coste.total.toLocaleString("es-ES")} €`}
                {panel.margen != null && ` · margen ${panel.margen.toLocaleString("es-ES")} € (${panel.margenPct}%)`}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPaso(2)} className="text-sm px-4 py-2 rounded-md border border-border text-ink-secondary">Atrás</button>
            <button onClick={crear} disabled={guardando} className="text-sm px-4 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40">
              {guardando ? "Creando…" : "Crear viaje"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
