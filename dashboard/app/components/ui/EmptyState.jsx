import Link from "next/link";

/** Estado vacío con acción, en vez de un simple "Sin datos". `ctaHref` para
 * navegar, `onCta` para una acción en la misma página (p.ej. abrir un form). */
export default function EmptyState({ icon: Icon, titulo, texto, ctaLabel, ctaHref, onCta }) {
  return (
    <div className="text-center py-10 px-4">
      {Icon && <Icon size={28} className="mx-auto mb-3 text-ink-muted" />}
      {titulo && <p className="text-sm font-medium text-ink mb-1">{titulo}</p>}
      {texto && <p className="text-sm text-ink-secondary mb-4">{texto}</p>}
      {ctaLabel && ctaHref && (
        <Link href={ctaHref} className="inline-flex text-sm px-3 py-2 rounded-md bg-brand text-white font-medium no-underline">
          {ctaLabel}
        </Link>
      )}
      {ctaLabel && onCta && !ctaHref && (
        <button onClick={onCta} className="text-sm px-3 py-2 rounded-md bg-brand text-white font-medium">
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
