"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, MapPin, Package, Clock, Truck, Edit3, Check, X,
} from "lucide-react";
import { getViaje, getChoferes } from "../../../lib/data";
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
  const [incidencias, setIncidencias] = useState([]);

  const load = useCallback(async () => {
    const d = await getViaje(id);
    setData(d);
    setLoading(false);

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
    await supabase.from("viaje").update({ estado: nuevoEstado }).eq("id", id);
    setEditandoEstado(false);
    load();
  }

  async function cambiarChofer(choferId) {
    await supabase.from("viaje").update({ chofer_id: choferId || null }).eq("id", id);
    setEditandoChofer(false);
    load();
  }

  async function abrirEditChofer() {
    const c = await getChoferes();
    setChoferes(c);
    setEditandoChofer(true);
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
                className={`text-xs px-2 py-1 rounded-full ${val.bg} ${val.c} hover:opacity-80`}
              >
                {val.t}
              </button>
            ))}
            <button onClick={() => setEditandoEstado(false)} className="p-1 text-ink-muted"><X size={14} /></button>
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

      <div className="flex items-center gap-4 mb-6 text-sm text-ink-secondary">
        {editandoChofer ? (
          <div className="flex items-center gap-2">
            <select
              defaultValue={viaje.chofer?.id || ""}
              onChange={(e) => cambiarChofer(e.target.value)}
              className="text-sm border border-border rounded-md px-2 py-1"
            >
              <option value="">Sin asignar</option>
              {choferes.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre} ({c.idioma?.toUpperCase()})</option>
              ))}
            </select>
            <button onClick={() => setEditandoChofer(false)} className="p-1 text-ink-muted"><X size={14} /></button>
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

      <div className="grid grid-cols-[1fr_320px] gap-6">
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
                      <img src={p.foto_url} alt="Albarán" className="w-full h-40 object-cover bg-surface-alt" />
                      <div className="p-2 flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ep.color}`}>{ep.label}</span>
                        {p.estado_validacion === "pendiente" && (
                          <div className="flex gap-1 ml-auto">
                            <button
                              onClick={async () => { await supabase.from("pod").update({ estado_validacion: "valido" }).eq("id", p.id); load(); }}
                              className="text-xs px-2 py-1 rounded border border-estado-ok text-estado-ok hover:bg-green-50"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={async () => { await supabase.from("pod").update({ estado_validacion: "invalido" }).eq("id", p.id); load(); }}
                              className="text-xs px-2 py-1 rounded border border-estado-incidencia text-estado-incidencia hover:bg-red-50"
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
        </aside>
      </div>
    </div>
  );
}
