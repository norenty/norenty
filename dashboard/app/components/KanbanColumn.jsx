// Ítem de diseño (2026-07-15): añade border-border (antes solo bg-surface-alt,
// el mismo gris que el fondo de la página -- la columna no tenía ningún límite
// visible, se fundía con el body). rounded-xl la mete en la convención de
// tarjeta (sombra suave centralizada en globals.css).
export default function KanbanColumn({ title, color, count, children }) {
  return (
    <div className="bg-surface-alt border border-border rounded-xl p-2.5 min-w-0 flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className={`text-xs font-medium ${color}`}>
          <span
            className={`inline-block w-2 h-2 rounded-full mr-1.5`}
            style={{ background: "currentColor" }}
          />
          {title}
        </span>
        <span className="text-[11px] text-ink-muted">{count}</span>
      </div>
      {children}
    </div>
  );
}
