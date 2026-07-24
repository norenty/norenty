/** Tarjeta con cabecera título+icono+acciones y borde — el patrón repetido en
 * DocumentosSection, GastosViajeSection, mantenimiento de vehículo, etc.
 *
 * `noPadding` (2026-07-24, ampliado al migrar DocumentosSection/
 * GastosViajeSection): esas secciones tienen un panel de formulario a ancho
 * completo entre la cabecera y la lista (su propio padding y fondo), que no
 * cabe bien dentro de un único `<div className="p-4">` — con `noPadding` el
 * contenido se renderiza tal cual, sin el wrapper con padding, y cada bloque
 * interno gestiona su propio espaciado (como ya hacían antes de migrar).
 *
 * `variant="plain"` (2026-07-24, migrando analítica/nómina/facturación): esas
 * pantallas ya tenían SU PROPIO patrón simple y consistente entre sí — título
 * `h3` sin separador, todo dentro del mismo padding — distinto del estilo con
 * separador (pensado para cuando hay acciones en la cabecera). No es "el
 * mismo patrón mal escrito", es un segundo estilo legítimo ya establecido;
 * forzar el separador ahí sería un cambio visual que nadie pidió. `variant`
 * elige cuál de los dos aplicar, mismo componente, sin bifurcar en dos.
 */
export default function SectionCard({ title, icon: Icon, actions, children, noPadding = false, variant = "bordered" }) {
  if (variant === "plain") {
    return (
      <div className="bg-surface border border-border rounded-xl p-4">
        {title && (
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-ink flex items-center gap-1.5">
              {Icon && <Icon size={15} />} {title}
            </h3>
            {actions}
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-ink flex items-center gap-1.5">
          {Icon && <Icon size={15} />} {title}
        </h2>
        {actions}
      </div>
      {noPadding ? children : <div className="p-4">{children}</div>}
    </div>
  );
}
