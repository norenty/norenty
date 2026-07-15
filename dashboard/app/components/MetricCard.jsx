// Ítem de diseño (2026-07-15): antes usaba bg-surface-alt, EXACTAMENTE el
// mismo color que el fondo de la página (body en globals.css) -- la tarjeta
// era invisible, sin ningún borde que la separase. bg-surface (blanco) +
// border + rounded-xl la hace visible Y la mete en la convención de
// "tarjeta" del dashboard, que ya lleva sombra suave centralizada en CSS.
export default function MetricCard({ label, value, color }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className="text-xs text-ink-secondary">{label}</div>
      <div className={`text-xl font-semibold ${color || "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}
