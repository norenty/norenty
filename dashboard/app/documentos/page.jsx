"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileWarning, Truck, CarFront, Users } from "lucide-react";
import { getDocumentosPorCaducar } from "../../lib/data";

const TIPO_LABEL = {
  cmr: "CMR / Carta de porte",
  albaran: "Albarán",
  adr: "ADR",
  itv: "ITV",
  seguro: "Seguro",
  autorizacion_transporte: "Autorización de transporte",
  licencia: "Licencia de conducir",
  cap: "CAP",
  otro: "Otro",
};

const AMBITO_ICON = { viaje: Truck, vehiculo: CarFront, chofer: Users };
const AMBITO_LABEL = { viaje: "Viaje", vehiculo: "Vehículo", chofer: "Chófer" };

function fmtFecha(f) {
  return new Date(f + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function urgencia(fechaCaducidad) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const caduca = new Date(fechaCaducidad + "T00:00:00");
  const dias = Math.round((caduca - hoy) / 86400000);
  if (dias < 0) return { label: "Caducado", cls: "bg-red-50 text-estado-incidencia", dias };
  return { label: "Caduca pronto", cls: "bg-yellow-50 text-yellow-700", dias };
}

export default function DocumentosPorCaducar() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocumentosPorCaducar().then((d) => { setDocs(d); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-64 bg-surface-alt rounded animate-pulse" />
        <div className="h-64 bg-surface-alt rounded-xl animate-pulse" />
      </div>
    );
  }

  const caducados = docs.filter((d) => urgencia(d.fecha_caducidad).dias < 0);
  const porCaducar = docs.filter((d) => urgencia(d.fecha_caducidad).dias >= 0);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <FileWarning size={20} className="text-yellow-600" />
        <h1 className="text-lg font-medium text-ink">Documentos por caducar</h1>
      </div>
      <p className="text-sm text-ink-secondary mb-4">
        Documentos de viajes, vehículos y chóferes caducados o que caducan en los próximos 30 días.
      </p>

      {docs.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-sm text-ink-secondary">
          Todo en orden: ningún documento caduca en los próximos 30 días.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {caducados.length > 0 && (
            <div className="px-4 py-2 bg-red-50 text-xs font-medium text-estado-incidencia">
              {caducados.length} caducado{caducados.length !== 1 ? "s" : ""}
            </div>
          )}
          {docs.map((d) => {
            const u = urgencia(d.fecha_caducidad);
            const Icon = AMBITO_ICON[d.ambito] || FileWarning;
            return (
              <Link
                key={d.id}
                href={d.href}
                className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 no-underline hover:bg-surface-alt transition-colors"
              >
                <Icon size={16} className="text-ink-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink">
                    {TIPO_LABEL[d.tipo] || d.tipo} — {d.entidadEtiqueta}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {AMBITO_LABEL[d.ambito]} · Caduca: {fmtFecha(d.fecha_caducidad)}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${u.cls}`}>{u.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
