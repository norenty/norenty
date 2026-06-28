import { MapPin, Flag, Clock, Camera, AlertTriangle } from "lucide-react";

const estadoConfig = {
  planificado: {
    bg: "bg-gray-100",
    text: "text-estado-planificado",
    label: "Planificado",
  },
  en_curso: {
    bg: "bg-blue-50",
    text: "text-estado-en-curso",
    label: "En curso",
  },
  completado: { bg: "bg-green-50", text: "text-estado-ok", label: "OK" },
  cancelado: { bg: "bg-gray-100", text: "text-ink-muted", label: "Cancelado" },
};

export default function TripCard({
  referencia,
  estado,
  choferNombre,
  choferIdioma,
  hitoActual,
  hitosCompletados,
  hitosTotal,
  alerta,
  alertaTipo,
}) {
  const cfg = estadoConfig[estado] || estadoConfig.planificado;

  return (
    <div
      className={`bg-surface border rounded-lg p-2.5 ${
        alertaTipo === "incidencia"
          ? "border-estado-incidencia"
          : "border-border"
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-xs text-ink-secondary">
          {referencia}
        </span>
        <span
          className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}
        >
          {cfg.label}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-ink-secondary mt-1.5">
        <div className="w-5 h-5 rounded-full bg-blue-50 text-estado-en-curso flex items-center justify-center text-[10px] font-medium">
          {choferNombre
            ?.split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)}
        </div>
        <span>{choferNombre}</span>
        {choferIdioma && (
          <span className="font-mono text-[10px] px-1 py-px rounded-full bg-surface-alt">
            {choferIdioma}
          </span>
        )}
      </div>

      {hitoActual && (
        <div className="flex items-center gap-1.5 text-xs text-ink-secondary mt-1.5">
          <MapPin size={13} />
          {hitoActual}
        </div>
      )}

      {alerta && (
        <div
          className={`flex items-center gap-1.5 text-xs mt-1.5 ${
            alertaTipo === "incidencia"
              ? "text-estado-incidencia"
              : "text-estado-riesgo"
          }`}
        >
          {alertaTipo === "incidencia" ? (
            <AlertTriangle size={13} />
          ) : alertaTipo === "pod" ? (
            <Camera size={13} />
          ) : (
            <Clock size={13} />
          )}
          {alerta}
        </div>
      )}

      <div className="flex items-center gap-1.5 text-xs text-ink-secondary mt-1.5">
        <Flag size={13} />
        {hitosCompletados}/{hitosTotal} hitos
      </div>
    </div>
  );
}
