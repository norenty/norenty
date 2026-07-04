"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, MapPin, Package, Clock, Truck, Edit3, Check, X, AlertTriangle, Euro, Gauge, Copy, Share2, History, ChevronDown,
} from "lucide-react";
import PodImage from "../../components/PodImage";
import DocumentosSection from "../../components/DocumentosSection";
import SugerenciaChofer from "../../components/SugerenciaChofer";
import GastosViajeSection from "../../components/GastosViajeSection";
import {
  getViaje, getChoferes, validarCambioEstado, validarAsignacion,
  getViabilidadViaje, UMBRAL_MARGEN_AMBAR_PCT, getEtaViaje, getEstado561, getPnlViaje, getPlanVsReal,
  generarTokenPublico, revocarTokenPublico, DIAS_VALIDEZ_TOKEN_PUBLICO_DEFAULT, registrarAuditoria, getAuditLog,
} from "../../../lib/data";
import { supabase } from "../../../lib/supabase";
import { useRealtimeRefresh } from "../../../lib/realtime";
import Timeline from "../../components/Timeline";
import RatingControl from "../../components/RatingControl";
import { ESTADO_VIAJE, ESTADO_HITO, ESTADO_POD, TIPOS_DOC_VIAJE, LABEL_CAPA } from "../../../lib/labels";
import { badgeMargen } from "../../../lib/format";
import RequireRol from "../../components/RequireRol";

/** Etiqueta legible de una entrada de audit_log (8.8) — el detalle exacto de
 * cada acción vive en `detalle` (jsonb), esto solo lo traduce a texto. */
function describirAuditoria(a) {
  const d = a.detalle || {};
  switch (a.accion) {
    case "cambio_estado":
      return `Cambió el estado de "${d.de || "—"}" a "${d.a || "—"}"`;
    case "asignar_chofer":
      return d.chofer_nuevo ? "Asignó un chófer" : "Quitó la asignación de chófer";
    case "cambio_precio":
      return `Cambió el precio de ${d.de ?? "—"} € a ${d.a ?? "—"} €`;
    case "generar_token_publico":
      return "Generó el enlace de seguimiento público";
    case "revocar_token_publico":
      return "Revocó el enlace de seguimiento público";
    case "borrar_documento":
      return `Borró un documento (${d.tipo || "?"})`;
    default:
      return a.accion;
  }
}

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
  const [pnl, setPnl] = useState(null);
  const [planVsReal, setPlanVsReal] = useState(null);
  const [actividad, setActividad] = useState([]);
  const [mostrarActividad, setMostrarActividad] = useState(false);
  const [generandoToken, setGenerandoToken] = useState(false);
  const [copiadoEnlace, setCopiadoEnlace] = useState(false);
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
    getPnlViaje(id).then(setPnl);
    getPlanVsReal(id).then(setPlanVsReal);
    getAuditLog("viaje", id).then(setActividad);

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
  useRealtimeRefresh(["viaje", "hito", "ejecucion_evento", "gasto_viaje"], load);

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
      registrarAuditoria({ entidad: "viaje", entidadId: id, accion: "cambio_estado", detalle: { de: viaje.estado, a: nuevoEstado } });
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
      // notificado_asignacion_en se resetea para que el bot avise al chófer
      // nuevo (7A.3) aunque el viaje ya hubiera notificado antes a otro.
      await supabase.from("viaje").update({ chofer_id: newChoferId || null, notificado_asignacion_en: null }).eq("id", id);
      registrarAuditoria({
        entidad: "viaje", entidadId: id, accion: "asignar_chofer",
        detalle: { chofer_anterior: viaje.chofer?.id || null, chofer_nuevo: newChoferId || null },
      });
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
      registrarAuditoria({ entidad: "viaje", entidadId: id, accion: "cambio_precio", detalle: { de: viaje.precio, a: precio } });
      setEditandoPrecio(false);
      await load();
    } finally {
      setGuardandoPrecio(false);
    }
  }

  async function generarEnlace() {
    setGenerandoToken(true);
    try {
      await generarTokenPublico(id);
      registrarAuditoria({ entidad: "viaje", entidadId: id, accion: "generar_token_publico" });
      await load();
    } finally {
      setGenerandoToken(false);
    }
  }

  async function revocarEnlace() {
    if (!confirm("¿Revocar el enlace? El cliente dejará de poder verlo.")) return;
    await revocarTokenPublico(id);
    registrarAuditoria({ entidad: "viaje", entidadId: id, accion: "revocar_token_publico" });
    await load();
  }

  function copiarEnlacePublico(token) {
    const url = `${window.location.origin}/t/${token}`;
    navigator.clipboard.writeText(url);
    setCopiadoEnlace(true);
    setTimeout(() => setCopiadoEnlace(false), 2000);
  }

  if (loading) return <div className="h-64 bg-surface-alt rounded-lg animate-pulse" />;
  if (!data) return <p className="text-sm text-ink-secondary">Viaje no encontrado.</p>;

  const { viaje, hitos, eventos, pods, valoraciones } = data;
  const ref = viaje.referencia || viaje.id.slice(0, 8);
  const ev = ESTADO_VIAJE[viaje.estado] || ESTADO_VIAJE.planificado;

  return (
    <div>
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary no-underline mb-4 hover:text-ink">
        <ArrowLeft size={16} /> Volver a operación
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <h1 className="font-mono text-xl text-ink">{ref}</h1>

        {editandoEstado ? (
          <div className="flex items-center gap-1">
            {Object.entries(ESTADO_VIAJE).map(([key, val]) => (
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
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-ink">Hitos del viaje</h2>
              {planVsReal && planVsReal.resumen.conVentana > 0 && (
                <span className="text-xs text-ink-secondary">
                  {planVsReal.resumen.aTiempo}/{planVsReal.resumen.conVentana} hitos a tiempo
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {hitos.map((h) => {
                const e = ESTADO_HITO[h.estado] || ESTADO_HITO.pendiente;
                const pvr = planVsReal?.filas.find((f) => f.hitoId === h.id);
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
                      {pvr && pvr.estado !== "sin_datos" && (
                        <div className={`text-xs mt-0.5 ${
                          pvr.estado === "a_tiempo" ? "text-green-700" : pvr.estado === "tarde_leve" ? "text-yellow-700" : "text-estado-incidencia"
                        }`}>
                          Llegó {new Date(pvr.llegadaReal).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                          {" "}({pvr.deltaMin <= 0 ? "a tiempo" : `+${pvr.deltaMin} min`})
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

          {actividad.length > 0 && (
            <section>
              <button
                onClick={() => setMostrarActividad((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-medium text-ink mb-3"
              >
                <History size={15} /> Actividad ({actividad.length})
                <ChevronDown size={14} className={`text-ink-muted transition-transform ${mostrarActividad ? "rotate-180" : ""}`} />
              </button>
              {mostrarActividad && (
                <div className="flex flex-col gap-2">
                  {actividad.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 text-xs bg-surface border border-border rounded-lg px-3 py-2">
                      <span className="flex-1 text-ink-secondary">{describirAuditoria(a)}</span>
                      <span className="text-ink-muted shrink-0">
                        {a.gestor?.nombre ? `${a.gestor.nombre} · ` : ""}
                        {new Date(a.created_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
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
              if (viabilidad.coste == null) return <p className="text-xs text-ink-secondary">Configura el coste/km (o el desglose de coste) en Ajustes, o en la ficha del vehículo, para ver el margen.</p>;
              if (viabilidad.km === 0) return <p className="text-xs text-ink-secondary">Sin km calculables: faltan coordenadas en los hitos o el servicio de rutas no responde.</p>;

              const { margen, margenPct, km, costeKm, coste, fuenteCoste, estimado, desglose } = viabilidad;
              const cls = badgeMargen(margen, margenPct, UMBRAL_MARGEN_AMBAR_PCT);
              return (
                <div>
                  <div className={`rounded-lg px-3 py-2 mb-2 ${cls}`}>
                    <div className="text-lg font-semibold">{margen.toLocaleString("es-ES")} € <span className="text-sm font-normal">({margenPct}%)</span></div>
                    <div className="text-xs">
                      {margen < 0 ? "A pérdidas — revisar precio" : margenPct < UMBRAL_MARGEN_AMBAR_PCT ? "Margen ajustado" : "Margen sano"}
                    </div>
                  </div>
                  <div className="text-xs text-ink-muted space-y-0.5">
                    {desglose?.modo === "desglosado" ? (
                      <div className="space-y-0.5">
                        {["combustible", "conductor", "peajes", "dietas"].map((capa) => (
                          <div key={capa} className="flex justify-between">
                            <span>{LABEL_CAPA[capa]}</span>
                            <span>
                              {desglose[capa] != null
                                ? `${desglose[capa].toLocaleString("es-ES")} €`
                                : <span className="text-ink-muted">— configura {LABEL_CAPA[capa].toLowerCase()} en Ajustes</span>}
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between font-medium text-ink-secondary pt-0.5 border-t border-border">
                          <span>Total</span><span>{coste.toLocaleString("es-ES")} €</span>
                        </div>
                      </div>
                    ) : (
                      <div>{estimado && "~"}{km.toLocaleString("es-ES")} km × {costeKm} €/km = {coste.toLocaleString("es-ES")} € de coste</div>
                    )}
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
              <Euro size={15} /> Resultado (P&amp;L)
            </h2>
            {!pnl ? (
              <p className="text-xs text-ink-muted">Calculando…</p>
            ) : pnl.numGastos === 0 ? (
              <p className="text-xs text-ink-secondary">Aún sin gastos reales — añádelos en la sección Gastos.</p>
            ) : (
              <div className="text-sm">
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div>
                    <div className="text-xs text-ink-secondary mb-0.5">Estimado</div>
                    <div className="text-ink">{pnl.costeEstimado != null ? `${pnl.costeEstimado.toLocaleString("es-ES")} €` : "—"}</div>
                    <div className="text-xs text-ink-muted">margen: {pnl.margenEstimado != null ? `${pnl.margenEstimado.toLocaleString("es-ES")} €` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-secondary mb-0.5">Real</div>
                    <div className="text-ink">{pnl.gastosReales.toLocaleString("es-ES")} €</div>
                    <div className="text-xs text-ink-muted">margen: {pnl.margenReal != null ? `${pnl.margenReal.toLocaleString("es-ES")} €` : "—"}</div>
                  </div>
                </div>
                {pnl.desviacionPct != null && (
                  <div className={`text-xs px-2 py-1.5 rounded-md ${pnl.desviacionPct <= 0 ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}`}>
                    Desviación real vs. estimado: {pnl.desviacionPct > 0 ? "+" : ""}{pnl.desviacionPct}%
                  </div>
                )}
              </div>
            )}
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
                  const ep = ESTADO_POD[p.estado_validacion] || ESTADO_POD.pendiente;
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

          <section className="bg-surface border border-border rounded-xl p-4">
            <h2 className="text-sm font-medium text-ink mb-3 flex items-center gap-1.5">
              <Share2 size={15} /> Compartir con el cliente
            </h2>
            {viaje.token_publico ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={typeof window !== "undefined" ? `${window.location.origin}/t/${viaje.token_publico}` : ""}
                    className="flex-1 text-xs border border-border rounded-md px-2 py-1.5 bg-surface-alt text-ink-secondary"
                  />
                  <button
                    onClick={() => copiarEnlacePublico(viaje.token_publico)}
                    aria-label="Copiar enlace"
                    className="p-1.5 text-ink-muted hover:text-ink shrink-0"
                  >
                    {copiadoEnlace ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
                {viaje.token_publico_expira && (
                  <p className="text-xs text-ink-muted">
                    Caduca el {new Date(viaje.token_publico_expira).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}
                  </p>
                )}
                <div className="flex gap-3">
                  <button onClick={generarEnlace} disabled={generandoToken} className="self-start text-xs text-ink-secondary hover:underline disabled:opacity-40">
                    Renovar (+{DIAS_VALIDEZ_TOKEN_PUBLICO_DEFAULT} días)
                  </button>
                  <button onClick={revocarEnlace} className="self-start text-xs text-estado-incidencia hover:underline">
                    Revocar enlace
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={generarEnlace}
                disabled={generandoToken}
                className="text-xs px-3 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
              >
                {generandoToken ? "Generando…" : "Generar enlace"}
              </button>
            )}
          </section>

          <GastosViajeSection viajeId={viaje.id} choferId={viaje.chofer?.id} vehiculoId={vehiculo?.id} />

          <DocumentosSection ambito="viaje" entidadId={viaje.id} tipos={TIPOS_DOC_VIAJE} />
        </aside>
      </div>
    </div>
  );
}
