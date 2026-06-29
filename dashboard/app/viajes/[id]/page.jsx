"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, Package, Clock } from "lucide-react";
import { getViaje } from "../../../lib/data";
import Timeline from "../../components/Timeline";
import RatingControl from "../../components/RatingControl";

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

  const load = useCallback(() => {
    getViaje(id).then((d) => {
      setData(d);
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="h-64 bg-surface-alt rounded-lg animate-pulse" />;
  }

  if (!data) {
    return <p className="text-sm text-ink-secondary">Viaje no encontrado.</p>;
  }

  const { viaje, hitos, eventos, pods, valoraciones } = data;
  const ref = viaje.referencia || viaje.id.slice(0, 8);

  return (
    <div>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-ink-secondary no-underline mb-4 hover:text-ink"
      >
        <ArrowLeft size={16} /> Volver a operación
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-mono text-xl text-ink">{ref}</h1>
        <span className="text-sm text-ink-secondary">
          {viaje.chofer?.nombre}
          {viaje.chofer?.idioma && (
            <span className="font-mono text-xs ml-1.5 px-1.5 py-0.5 rounded-full bg-surface-alt">
              {viaje.chofer.idioma.toUpperCase()}
            </span>
          )}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-6">
        <div className="flex flex-col gap-6">
          <section>
            <h2 className="text-sm font-medium text-ink mb-3">Hitos del viaje</h2>
            <div className="flex flex-col gap-2">
              {hitos.map((h) => {
                const e = estadoHito[h.estado] || estadoHito.pendiente;
                return (
                  <div
                    key={h.id}
                    className="bg-surface border border-border rounded-xl p-3 flex items-center gap-3"
                  >
                    <div className="text-ink-muted">
                      {h.tipo === "recogida" ? (
                        <Package size={18} />
                      ) : (
                        <MapPin size={18} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink">
                        {h.orden}. {h.tipo === "recogida" ? "Recogida" : "Entrega"} ·{" "}
                        {h.direccion || "—"}
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

          <section>
            <h2 className="text-sm font-medium text-ink mb-3">
              Log de ejecución
            </h2>
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
            <h2 className="text-sm font-medium text-ink mb-3">
              Albaranes (POD)
            </h2>
            {pods.length === 0 ? (
              <p className="text-xs text-ink-secondary">Sin albaranes todavía.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {pods.map((p) => {
                  const ep = estadoPod[p.estado_validacion] || estadoPod.pendiente;
                  return (
                    <div
                      key={p.id}
                      className="bg-surface border border-border rounded-xl overflow-hidden"
                    >
                      <img
                        src={p.foto_url}
                        alt="Albarán"
                        className="w-full h-40 object-cover bg-surface-alt"
                      />
                      <div className="p-2">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${ep.color}`}
                        >
                          {ep.label}
                        </span>
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
