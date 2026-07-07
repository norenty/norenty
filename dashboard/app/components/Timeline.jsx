import {
  MapPin,
  LogOut,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Circle,
} from "lucide-react";
import { fmtFechaHora } from "../../lib/format";

const eventoConfig = {
  llegada: { icon: MapPin, label: "Llegada al punto", color: "text-estado-en-curso" },
  salida: { icon: LogOut, label: "Salida del punto", color: "text-ink-secondary" },
  pod_subido: { icon: Camera, label: "Albarán recibido", color: "text-estado-ok" },
  viaje_completado: {
    icon: CheckCircle2,
    label: "Viaje completado",
    color: "text-estado-ok",
  },
  incidencia: { icon: AlertTriangle, label: "Incidencia", color: "text-estado-incidencia" },
  incidencia_reportada: {
    icon: AlertTriangle,
    label: "Incidencia reportada",
    color: "text-estado-incidencia",
  },
};

export default function Timeline({ eventos }) {
  if (!eventos || eventos.length === 0) {
    return (
      <p className="text-sm text-ink-secondary py-4">
        Sin eventos registrados todavía.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {eventos.map((ev, i) => {
        const tipoEvento = ev.tipo || ev.tipo_evento;
        const cfg = eventoConfig[tipoEvento] || {
          icon: Circle,
          label: tipoEvento || "Evento",
          color: "text-ink-muted",
        };
        const Icon = cfg.icon;
        const last = i === eventos.length - 1;

        return (
          <div key={ev.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={`mt-0.5 ${cfg.color}`}>
                <Icon size={18} />
              </div>
              {!last && <div className="w-px flex-1 bg-border my-1" />}
            </div>
            <div className={`pb-4 ${last ? "" : ""}`}>
              <div className="text-sm font-medium text-ink">{cfg.label}</div>
              <div className="font-mono text-xs text-ink-muted">
                {fmtFechaHora(ev.ocurrido_en) || ""}
              </div>
              {(ev.detalle || ev.datos?.direccion) && (
                <div className="text-xs text-ink-secondary mt-0.5">
                  {ev.detalle || ev.datos?.direccion}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
