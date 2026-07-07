"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Route, MapPin, Package, CheckCircle2 } from "lucide-react";
import { getViajePublico } from "../../../lib/data";
import { ESTADO_VIAJE } from "../../../lib/labels";
import { fmtFechaHora } from "../../../lib/format";

const POLL_MS = 60000;

function fmtHace(iso) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

export default function PortalCliente() {
  const { token } = useParams();
  const [viaje, setViaje] = useState(undefined); // undefined = cargando, null = no encontrado

  useEffect(() => {
    let activo = true;
    function cargar() {
      getViajePublico(token).then((v) => { if (activo) setViaje(v); }).catch(() => { if (activo) setViaje(null); });
    }
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => { activo = false; clearInterval(intervalo); };
  }, [token]);

  if (viaje === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!viaje) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-sm text-ink-secondary">Este enlace no es válido o ha caducado.</p>
      </div>
    );
  }

  const ev = ESTADO_VIAJE[viaje.estado] || ESTADO_VIAJE.planificado;
  const hitos = viaje.hitos || [];

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-6 text-ink">
          <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center text-white">
            <Route size={16} />
          </div>
          <span className="text-base font-semibold">Norenty</span>
        </div>

        <div className="bg-surface border border-border rounded-xl p-5 mb-4">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-medium text-ink">{viaje.referencia || "Tu envío"}</h1>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ev.bg} ${ev.c}`}>{ev.t}</span>
          </div>
          {viaje.ultima_posicion && (
            <p className="text-xs text-ink-secondary mt-2">
              Última posición: {fmtHace(viaje.ultima_posicion.ts)} —{" "}
              <a
                href={`https://www.google.com/maps?q=${viaje.ultima_posicion.lat},${viaje.ultima_posicion.lon}`}
                target="_blank" rel="noopener noreferrer"
                className="text-brand no-underline hover:underline"
              >
                ver en el mapa
              </a>
            </p>
          )}
        </div>

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {hitos.map((h) => (
            <div key={h.orden} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
              {h.estado === "completado" ? (
                <CheckCircle2 size={18} className="text-estado-ok shrink-0" />
              ) : h.tipo === "recogida" ? (
                <Package size={18} className="text-ink-muted shrink-0" />
              ) : (
                <MapPin size={18} className="text-ink-muted shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${h.estado === "completado" ? "text-ink-muted line-through" : "text-ink"}`}>
                  {h.orden}. {h.tipo === "recogida" ? "Recogida" : "Entrega"} — {h.direccion || "—"}
                </div>
                {(h.ventana_inicio || h.ventana_fin) && (
                  <div className="text-xs text-ink-muted">
                    Ventana: {fmtFechaHora(h.ventana_inicio) || "?"}
                    {" – "}
                    {fmtFechaHora(h.ventana_fin) || "?"}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-ink-muted mt-6">Seguimiento proporcionado por Norenty</p>
      </div>
    </div>
  );
}
