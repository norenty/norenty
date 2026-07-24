// Ítem de diseño (2026-07-15): antes usaba bg-surface-alt, EXACTAMENTE el
// mismo color que el fondo de la página (body en globals.css) -- la tarjeta
// era invisible, sin ningún borde que la separase. bg-surface (blanco) +
// border + rounded-xl la hace visible Y la mete en la convención de
// "tarjeta" del dashboard, que ya lleva sombra suave centralizada en CSS.

// Ítem 12.2 — controlling en el tiempo: flecha + % frente al periodo anterior
// de igual duración. `invertir`: para métricas donde SUBIR es malo (p.ej.
// "viajes a pérdidas"), invierte el color sin invertir la flecha (la flecha
// siempre indica la dirección real del cambio; el color indica si es bueno).
export function Variacion({ comp, invertir = false, sufijo = "%" }) {
  if (!comp || comp.variacionPct == null) return null;
  const sube = comp.variacionPct > 0;
  const esBueno = invertir ? !sube : sube;
  const color = comp.variacionPct === 0 ? "text-ink-muted" : esBueno ? "text-estado-ok" : "text-estado-incidencia";
  const flecha = comp.variacionPct === 0 ? "→" : sube ? "▲" : "▼";
  return (
    <div className={`text-xs mt-1 ${color}`}>
      {flecha} {Math.abs(comp.variacionPct)}{sufijo} vs. periodo anterior
    </div>
  );
}

// size="sm" (por defecto, portada): compacta, sin sub/comp.
// size="lg" (analítica): más aire, admite `sub` y `comp` (variación vs. periodo anterior).
export default function MetricCard({ label, value, color, sub, comp, invertirComp = false, sufijoComp, size = "sm" }) {
  const lg = size === "lg";
  return (
    <div className={`bg-surface border border-border rounded-xl ${lg ? "p-4" : "p-3"}`}>
      <div className={`text-xs text-ink-secondary ${lg ? "mb-1" : ""}`}>{label}</div>
      <div className={`${lg ? "text-2xl" : "text-xl"} font-semibold ${color || "text-ink"}`}>
        {value ?? (lg ? "—" : value)}
      </div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
      <Variacion comp={comp} invertir={invertirComp} sufijo={sufijoComp} />
    </div>
  );
}
