const TONE_CLS = {
  ok: "bg-green-50 text-green-700",
  warn: "bg-yellow-50 text-yellow-700",
  error: "bg-red-50 text-estado-incidencia",
  neutral: "bg-surface-alt text-ink-secondary",
};

/** Chip de estado consistente. tone="ok" usa green-700 (no text-estado-ok) a
 * propósito: sobre bg-green-50 el token estado-ok da ~3.15:1 de contraste,
 * insuficiente para texto pequeño (necesita 4.5:1) — green-700 sí lo cumple. */
export default function Badge({ tone = "neutral", children, className = "" }) {
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${TONE_CLS[tone] || TONE_CLS.neutral} ${className}`}>
      {children}
    </span>
  );
}
