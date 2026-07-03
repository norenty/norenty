"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, MapPin, Package, Clock, Truck, Edit3, Check, X, AlertTriangle, Euro, Gauge,
} from "lucide-react";
import PodImage from "../../components/PodImage";
import DocumentosSection from "../../components/DocumentosSection";
import SugerenciaChofer from "../../components/SugerenciaChofer";
import {
  getViaje, getChoferes, validarCambioEstado, validarAsignacion,
  getViabilidadViaje, UMBRAL_MARGEN_AMBAR_PCT, getEtaViaje, getEstado561,
} from "../../../lib/data";
import { supabase } from "../../../lib/supabase";
import { useRealtimeRefresh } from "../../../lib/realtime";
import Timeline from "../../components/Timeline";
import RatingControl from "../../components/RatingControl";

const estadoViaje = {
  planificado: { t: "Planificado", c: "text-estado-planificado", bg: "bg-blue-50" },
  en_curso: { t: "En curso", c: "text-estado-en-curso", bg: "bg-indigo-50" },
  completado: { t: "Completado", c: "text-estado-ok", bg: "bg-green-50" },
  cancelado: { t: "Cancelado", c: "text-ink-muted", bg: "bg-gray-100" },
};

const estadoHito = {
  pendiente: { label: "Pendiente", color: "text-ink-muted" },
  en_curso: { label: "En curso", color: "text-estado-en-curso" },
  completado: { label: "Completado", color: "text-estado-ok" },
  fallido: { label: "Fallido", color: "text-estado-incidencia" },
};

const TIPOS_DOC_VIAJE = [
  { value: "cmr", label: "CMR / Carta de porte" },
  { value: "albaran", label: "Albarán" },
  { value: "adr", label: "ADR (mercancía peligrosa)" },
  { value: "otro", label: "Otro" },
];

const estadoPod = {
  pendiente: { label: "Sin validar", color: "bg-gray-100 text-ink-secondary" },
  valido: { label: "Válido", color: "bg-green-50 text-estado-ok" },
  invalido: { label: "Inválido", color: "bg-red-50 text-estado-incidencia" },
  dudoso: { label: "Dudoso", color: "bg-orange-50 text-estado-riesgo" },
};

export default function ViajeDetalle() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [vehiculo, setVehiculo] = useState(null);
  const [remolque, setRemolque] = useState(null);
  const [editandoEstado, setEditandoEstado] = useState(false);
  const [editandoChofer, setEditandoChofer] = useState(false);
  const [choferes, setChoferes] = useState([]);
  const [aviso561, setAviso561] = useState(null);
  const [incidencias, setIncidencias] = useState([]);
  const [error, setError] = useState(null);
  const [guardandoEstado, setGuardandoEstado] = useState(false);
  const [guardandoChofer, setGuardandoChofer] = useState(false);
  const [procesandoPod, setProcesandoPod] = useState(null);
  const [viabilidad, setViabilidad] = useState(null);
  const [eta, setEta] = useState(null);
  const [editandoPrecio, setEditandoPrecio] = useState(false);
  const [precioInput, setPrecioInput] = useState("");
  const [guardandoPrecio, setGuardandoPrecio] = useState(false);

  const load = useCallback(async () => {
    const d = await getViaje(id);
    setData(d);
    setLoading(false);
    getViabilidadViaje(id).then(setViabilidad);
    getEtaViaje(id).then(setEta);

    if (d?.viaje) {
      if (d.viaje.vehiculo_id) {
        const { data: v } = await supabase.from("vehiculo").select("matricula, tipo, marca, modelo").eq("id", d.viaje.vehiculo_id).single();
        setVehiculo(v);
      }
      if (d.viaje.remolque_id) {
        const { data: r } = await supabase.from("vehiculo").select("matricula, tipo, marca").eq("id", d.viaje.remolque_id).single();
        setRemolque(r);
      }
      const { data: inc } = await supabase.from("incidencia").select("*").eq("viaje_id", id).order("created_at", { ascending: false });
      setIncidencias(inc || []);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["viaje", "hito", "ejecucion_evento"], load);

  async function cambiarEstado(nuevoEstado) {
    if (guardandoEstado) return;
    setError(null);
    setGuardandoEstado(true);
    try {
      const v = await validarCambioEstado(id, nuevoEstado);
      if (!v.ok) {
        setError(v.errores.join(". "));
        setEditandoEstado(false);
        return;
      }
      await supabase.from("viaje").update({ estado: nuevoEstado }).eq("id", id);
      setEditandoEstado(false);
      await load();
    } finally {
      setGuardandoEstado(false);
    }
  }

  async function cambiarChofer(newChoferId) {
    if (guardandoChofer) return;
    setError(null);
    if (newChoferId) {
      const v = await validarAsignacion({ choferId: newChoferId, excluirViajeId: id });
      if (v.avisos.length > 0) {
        if (!confirm(`Atención:\n\n${v.avisos.join("\n")}\n\n¿Asignar de todos modos?`)) {
          setEditandoChofer(false);
          return;
        }
      }
    }
    setGuardandoChofer(true);
    try {
      await supabase.from("viaje").update({ chofer_id: newChoferId || null }).eq("id", id);
      setEditandoChofer(false);
      await load();
    } finally {
      setGuardandoChofer(false);
    }
  }

  async function validarPod(podId, estadoValidacion) {
    if (procesandoPod) return;
    setProcesandoPod(podId);
    try {
      await supabase.from("pod").update({ estado_validacion: estadoValidacion }).eq("id", podId);
      await load();
    } finally {
      setProcesandoPod(null);
    }
  }

  async function abrirEditChofer() {
    const c = await getChoferes();
    setChoferes(c);
    setEditandoChofer(true);
  }

  async function guardarPrecio() {
    if (guardandoPrecio) return;
    const precio = precioInput.trim() === "" ? null : Number(precioInput);
    if (precio != null && (Number.isNaN(precio) || precio < 0)) {
      setError("El precio debe ser un número positivo.");
      return;
    }
    setGuardandoPrecio(true);
    setError(null);
    try {
      await supabase.from("viaje").update({ precio }).eq("id", id);
      setEditandoPrecio(false);
      await load();
    } finally {
      setGuardandoPrecio(false);
    }
  }

  if (loading) return <div className="h-64 bg-surface-alt rounded-lg animate-pulse" />;
  if (!data) return <p className="text-sm text-ink-secondary">Viaje no encontrado.</p>;

  const { viaje, hitos, eventos, pods, valoraciones } = data;
  const ref = viaje.referencia || viaje.id.slice(0, 8);
  const ev = estadoViaje[viaje.estado] || estadoViaje.planificado;

  return (
    <div>
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary no-underline mb-4 hover:text-ink">
        <ArrowLeft size={16} /> Volver a operación
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <h1 className="font-mono text-xl text-ink">{ref}</h1>

        {editandoEstado ? (
          <div className="flex items-center gap-1">
            {Object.entries(estadoViaje).map(([key, val]) => (
              <button
                key={key}
                onClick={() => cambiarEstado(key)}
                disabled={guardandoEstado}
                className={`text-xs px-2 py-1 rounded-full ${val.bg} ${val.c} hover:opacity-80 disabled:opacity-40`}
              >
                {guardandoEstado ? "…" : val.t}
              </button>
            ))}
            <button onClick={() => setEditandoEstado(false)} disabled={guardandoEstado} className="p-1 text-ink-muted disabled:opacity-40"><X size={14} /></button>
          </div>
        ) : (
          <button
            onClick={() => setEditandoEstado(true)}
            className={`text-xs px-2.5 py-1 rounded-full ${ev.bg} ${ev.c} hover:opacity-80 flex items-center gap-1`}
          >
            {ev.t} <Edit3 size={12} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 mb-2 text-sm text-ink-secondary">
        {editandoChofer ? (
          <div className="flex items-center gap-2">
            <select
              defaultValue={viaje.chofer?.id || ""}
              onChange={(e) => {
                const cid = e.target.value;
                setAviso561(null);
                cambiarChofer(cid);
                if (cid) {
                  const nombre = choferes.find((c) => c.id === cid)?.nombre || "El chófer";
                  getEstado561(cid).then((est) => {
                    if (est && est.pct7 >= 80) {
                      setAviso561(`${nombre} cerca del límite semanal: quedan ${est.margen7} h (est.)`);
                    }
                  });
                }
              }}
              disabled={guardandoChofer}
              className="text-sm border border-border rounded-md px-2 py-1 disabled:opacity-40"
            >
              <option value="">Sin asignar</option>
              {choferes.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre} ({c.idioma?.toUpperCase()})</option>
              ))}
            </select>
            <button onClick={() => { setEditandoChofer(false); setAviso561(null); }} disabled={guardandoChofer} className="p-1 text-ink-muted disabled:opacity-40"><X size={14} /></button>
          </div>
        ) : (
          <button onClick={abrirEditChofer} className="flex items-center gap-1 hover:text-ink">
            {viaje.chofer?.nombre || "Sin asignar"}
            {viaje.chofer?.idioma && (
              <span className="font-mono text-xs ml-1 px-1.5 py-0.5 rounded-full bg-surface-alt">
                {viaje.chofer.idioma.toUpperCase()}
              </span>
            )}
            <Edit3 size={12} />
          </button>
        )}

        {vehiculo && (
          <span className="flex items-center gap-1">
            <Truck size={14} /> {vehiculo.matricula}
            {vehiculo.marca && ` · ${vehiculo.marca} ${vehiculo.modelo || ""}`}
          </span>
        )}
        {remolque && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-surface-alt">
            Remolque: {remolque.matricula}
          </span>
        )}
      </div>

      {editandoChofer && (
        <div className="mb-4">
          <SugerenciaChofer viajeId={id} onAsignado={(choferId) => cambiarChofer(choferId)} />
        </div>
      )}

      {aviso561 && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200 text-xs text-yellow-700">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {aviso561}
          <button onClick={() => setAviso561(null)} className="ml-auto shrink-0"><X size={14} /></button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-estado-incidencia">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto shrink-0"><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="flex flex-col gap-6">
          <section>
            <h2 className="text-sm font-medium text-ink mb-3">Hitos del viaje</h2>
            <div className="flex flex-col gap-2">
              {hitos.map((h) => {
                const e = estadoHito[h.estado] || estadoHito.pendiente;
                return (
                  <div key={h.id} className="bg-surface border border-border rounded-xl p-3 flex items-center gap-3">
                    <div className="text-ink-muted">
                      {h.tipo === "recogida" ? <Package size={18} /> : <MapPin size={18} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink">
                        {h.orden}. {h.tipo === "recogida" ? "Recogida" : "Entrega"} · {h.direccion || "—"}
                      </div>
                      {(h.ventana_inicio || h.ventana_fin) && (
                        <div className="flex items-center gap-1 text-xs text-ink-secondary mt-0.5">
                          <Clock size={12} />
                          {h.ventana_inicio || "?"} – {h.ventana_fin || "?"}
                        </div>
                      )}
                    </div>
                    <span className={`text-xs font-medium ${e.color}`}>{e.label}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {incidencias.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-ink mb-3">Incidencias ({incidencias.length})</h2>
              <div className="flex flex-col gap-2">
                {incidencias.map((inc) => (
                  <div key={inc.id} className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-3">
                    <span className="text-xs font-medium text-estado-incidencia">{inc.tipo}</span>
                    <span className="flex-1 text-xs text-ink-secondary">{inc.descripcion || "—"}</span>
                    <span className="text-xs text-ink-muted">
                      {new Date(inc.created_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-medium text-ink mb-3">Log de ejecución</h2>
            <Timeline eventos={eventos} />
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <section className="bg-surface border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-ink flex items-center gap-1.5">
                <Euro size={15} /> Viabilidad
              </h2>
              {!editandoPrecio && (
                <button
                  onClick={() => { setPrecioInput(viaje.precio != null ? String(viaje.precio) : ""); setEditandoPrecio(true); }}
                  className="text-xs text-ink-secondary hover:text-ink flex items-center gap-1"
                >
                  <Edit3 size={12} /> Precio
                </button>
              )}
            </div>

            {editandoPrecio ? (
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="number"
                  step="any"
                  min="0"
                  autoFocus
                  aria-label="Precio del viaje en euros"
                  value={precioInput}
                  onChange={(e) => setPrecioInput(e.target.value)}
                  placeholder="Precio del viaje (€)"
                  className="flex-1 text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                <button onClick={guardarPrecio} disabled={guardandoPrecio} aria-label="Guardar precio" className="p-1.5 text-estado-ok disabled:opacity-40"><Check size={16} /></button>
                <button onClick={() => setEditandoPrecio(false)} disabled={guardandoPrecio} aria-label="Cancelar edición del precio" className="p-1.5 text-ink-muted disabled:opacity-40"><X size={16} /></button>
              </div>
            ) : (
              <div className="text-sm text-ink mb-3">
                Precio: <span className="font-medium">{viaje.precio != null ? `${viaje.precio.toLocaleString("es-ES")} €` : "—"}</span>
              </div>
            )}

            {(() => {
              if (!viabilidad) return <p className="text-xs text-ink-muted">Calculando…</p>;
              if (viaje.precio == null) return <p className="text-xs text-ink-secondary">Añade el precio para ver el margen.</p>;
              if (viabilidad.costeKm == null) return <p className="text-xs text-ink-secondary">Configura el coste/km en Ajustes (o en la ficha del vehículo) para ver el margen.</p>;
              if (viabilidad.km === 0) return <p className="text-xs text-ink-secondary">Sin km calculables: faltan coordenadas en los hitos o el servicio de rutas no responde.</p>;

              const { margen, margenPct, km, costeKm, coste, fuenteCoste, estimado } = viabilidad;
              // text-estado-ok (#16A34A) sobre bg-green-50 da ~3.15:1 de contraste —
              // pasa para texto grande (≥3:1) pero NO para el texto pequeño de abajo
              // (necesita 4.5:1). green-700 sí cumple en ambos tamaños.
              const cls = margen < 0
                ? "bg-red-50 text-estado-incidencia"
                : margenPct < UMBRAL_MARGEN_AMBAR_PCT
                ? "bg-yellow-50 text-yellow-700"
                : "bg-green-50 text-green-700";
              return (
                <div>
                  <div className={`rounded-lg px-3 py-2 mb-2 ${cls}`}>
                    <div className="text-lg font-semibold">{margen.toLocaleString("es-ES")} € <span className="text-sm font-normal">({margenPct}%)</span></div>
                    <div className="text-xs">
                      {margen < 0 ? "A pérdidas — revisar precio" : margenPct < UMBRAL_MARGEN_AMBAR_PCT ? "Margen ajustado" : "Margen sano"}
                    </div>
                  </div>
                  <div className="text-xs text-ink-muted space-y-0.5">
                    <div>{estimado && "~"}{km.toLocaleString("es-ES")} km × {costeKm} €/km = {coste.toLocaleString("es-ES")} € de coste</div>
                    <div>Coste/km según: {fuenteCoste === "vehiculo" ? "vehículo asignado" : "empresa"}</div>
                    {estimado && (
                      <div className="text-yellow-700">~ distancia estimada en línea recta corregida; instala OSRM para km por carretera reales.</div>
                    )}
                  </div>
                </div>
              );
            })()}
          </section>

          <section className="bg-surface border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium text-ink mb-3 flex items-center gap-1.5">
              <Gauge size={15} /> Tiempo estimado (con paradas legales)
            </h2>
            {!eta ? (
              <p className="text-xs text-ink-muted">Calculando…</p>
            ) : eta.km === 0 ? (
              <p className="text-xs text-ink-secondary">Sin km calculables: faltan coordenadas en los hitos o el servicio de rutas no responde.</p>
            ) : (
              <div>
                <div className="text-sm text-ink mb-2">
                  <span className="font-semibold text-lg">{eta.horasTotales} h</span>
                  <span className="text-ink-secondary"> totales</span>
                </div>
                <div className="text-xs text-ink-muted space-y-0.5">
                  <div>{eta.estimado && "~"}{eta.km.toLocaleString("es-ES")} km a {eta.velocidadKmh} km/h → {eta.horasConduccion} h de conducción</div>
                  {(eta.paradas45min > 0 || eta.descansos11h > 0) ? (
                    <div>
                      + {eta.paradas45min} parada{eta.paradas45min !== 1 ? "s" : ""} de 45 min
                      {eta.descansos11h > 0 && ` + ${eta.descansos11h} descanso${eta.descansos11h !== 1 ? "s" : ""} de 11h`}
                    </div>
                  ) : (
                    <div>Sin paradas obligatorias en este trayecto.</div>
                  )}
                  {eta.estimado && (
                    <div className="text-yellow-700">~ distancia estimada en línea recta corregida; instala OSRM para km por carretera reales.</div>
                  )}
                  <div className="pt-1">
                    Estimación v1 (Reglamento CE 561/2006): no considera límites semanales/bisemanales
                    ni descansos reducidos — conservadora, nunca infraestima.
                  </div>
                </div>
              </div>
            )}
          </section>

          <RatingControl
            choferId={viaje.chofer?.id}
            viajeId={viaje.id}
            valoraciones={valoraciones}
            onSaved={load}
          />

          <section>
            <h2 className="text-sm font-medium text-ink mb-3">Albaranes (POD)</h2>
            {pods.length === 0 ? (
              <p className="text-xs text-ink-secondary">Sin albaranes todavía.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {pods.map((p) => {
                  const ep = estadoPod[p.estado_validacion] || estadoPod.pendiente;
                  return (
                    <div key={p.id} className="bg-surface border border-border rounded-xl overflow-hidden">
                      {p.foto_url && (
                        <PodImage path={p.foto_url} className="w-full h-40" />
                      )}
                      <div className="p-2 flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ep.color}`}>{ep.label}</span>
                        {p.estado_validacion === "pendiente" && (
                          <div className="flex gap-1 ml-auto">
                            <button
                              onClick={() => validarPod(p.id, "valido")}
                              disabled={procesandoPod === p.id}
                              className="text-xs px-2 py-1 rounded border border-estado-ok text-estado-ok hover:bg-green-50 disabled:opacity-40"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={() => validarPod(p.id, "invalido")}
                              disabled={procesandoPod === p.id}
                              className="text-xs px-2 py-1 rounded border border-estado-incidencia text-estado-incidencia hover:bg-red-50 disabled:opacity-40"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <DocumentosSection ambito="viaje" entidadId={viaje.id} tipos={TIPOS_DOC_VIAJE} />
        </aside>
      </div>
    </div>
  );
}
