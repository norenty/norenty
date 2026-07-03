/** Tarjeta con cabecera título+icono+acciones y borde — el patrón repetido en
 * DocumentosSection, GastosViajeSection, mantenimiento de vehículo, etc. */
export default function SectionCard({ title, icon: Icon, actions, children }) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-ink flex items-center gap-1.5">
          {Icon && <Icon size={15} />} {title}
        </h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
