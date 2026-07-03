import Link from "next/link";

const TONE_CLS = {
  ok: "text-ink",
  warn: "text-yellow-600",
  error: "text-estado-incidencia",
  neutral: "text-ink",
};

/** Tarjeta numérica reutilizable: número grande + label + nota opcional. Si
 * `href` está presente, toda la tarjeta es un enlace (patrón de ResumenHoy). */
export default function Stat({ label, value, sub, href, tone = "neutral" }) {
  const contenido = (
    <>
      <div className={`text-2xl font-semibold ${TONE_CLS[tone] || TONE_CLS.neutral}`}>{value ?? "—"}</div>
      <div className="text-xs text-ink-secondary mt-1">{label}</div>
      {sub && <div className="text-xs text-ink-muted mt-0.5">{sub}</div>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="bg-surface border border-border rounded-xl p-4 no-underline hover:border-brand transition-colors block">
        {contenido}
      </Link>
    );
  }
  return <div className="bg-surface border border-border rounded-xl p-4">{contenido}</div>;
}
