// Formateo de fecha/euros/km unificado (ítem 7A.12). Antes de este archivo,
// `.toLocaleString("es-ES")` y variantes de `.toLocaleDateString(...)` estaban
// repetidas en más de 15 sitios, con pequeñas variaciones de opciones difíciles
// de mantener consistentes. Mismos formatos exactos que ya se usaban, cero
// cambio de comportamiento — esto es solo el punto único donde vivir.

export function fmtEur(n) {
  if (n == null) return null;
  return `${n.toLocaleString("es-ES")} €`;
}

export function fmtKm(n) {
  if (n == null) return null;
  return `${n.toLocaleString("es-ES")} km`;
}

/** "04 ene 2026" — variante corta con año, mediodía fijo para evitar líos de zona horaria en fechas sin hora (date-only). */
export function fmtFecha(fechaStr) {
  if (!fechaStr) return null;
  return new Date(fechaStr + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

/** "04 enero 2026" — variante larga con año. */
export function fmtFechaLarga(fechaStr) {
  if (!fechaStr) return null;
  return new Date(fechaStr + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

/** "04 ene" — sin año, para listas donde el año no aporta (ej. historial reciente). */
export function fmtFechaCorta(fechaStr) {
  if (!fechaStr) return null;
  return new Date(fechaStr).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

/** "04 ene 14:30" — fecha+hora completas, para timestamps (created_at, eventos). */
export function fmtFechaHora(isoStr) {
  if (!isoStr) return null;
  return new Date(isoStr).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "14:30" — solo hora, para eventos del mismo día (ej. llegada real de un hito). */
export function fmtHora(isoStr) {
  if (!isoStr) return null;
  return new Date(isoStr).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Badge de caducidad de un documento: caducado (rojo) / caduca pronto en
 * ≤30 días (ámbar) / vigente (verde). Mismo umbral y clases que
 * DocumentosSection.jsx y documentos/page.jsx usaban por separado.
 * text-estado-ok sobre bg-green-50 no llega al contraste AA (4.5:1) en texto
 * pequeño (~3.15:1); text-green-700 sí lo cumple — por eso "vigente" usa
 * green-700 y no el token de estado-ok.
 */
export function badgeCaducidad(fechaCaducidad) {
  if (!fechaCaducidad) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const caduca = new Date(fechaCaducidad + "T00:00:00");
  const dias = Math.round((caduca - hoy) / 86400000);
  if (dias < 0) return { label: "Caducado", cls: "bg-red-50 text-estado-incidencia", dias };
  if (dias <= 30) return { label: "Caduca pronto", cls: "bg-yellow-50 text-yellow-700", dias };
  return { label: "Vigente", cls: "bg-green-50 text-green-700", dias };
}

/**
 * Clase de color para un margen/viabilidad: pérdidas (rojo) / ajustado por
 * debajo del umbral ámbar (ámbar) / sano (verde). `umbralAmbarPct` se pasa
 * explícito (UMBRAL_MARGEN_AMBAR_PCT vive en lib/data.js, no aquí, para no
 * crear una dependencia circular entre format.js y data.js).
 */
export function badgeMargen(margen, margenPct, umbralAmbarPct) {
  if (margen < 0) return "bg-red-50 text-estado-incidencia";
  if (margenPct < umbralAmbarPct) return "bg-yellow-50 text-yellow-700";
  return "bg-green-50 text-green-700";
}
