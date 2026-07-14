// Command palette de consultas (6.12 extendido, decisión 2026-07-13): mapeo
// determinista de texto -> función de datos que ya existe (getResumenHoy) ->
// vista filtrada. Sin IA, sin coste, sin alucinación.

export function normalizar(s) {
  // Quita diacríticos comparando código de carácter (evita escapes Unicode
  // en el literal de regex, frágiles según el editor/encoding).
  return s
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0x0300 || code > 0x036f; // fuera del bloque de marcas combinantes
    })
    .join("")
    .toLowerCase();
}

export const COMANDOS = [
  {
    id: "docs_caducar",
    keywords: ["documentos", "documento", "caducar", "caducidad", "caduca", "vencen", "vencimiento"],
    href: "/documentos",
    label: (r) => `${r.docsPorCaducar} documento${r.docsPorCaducar === 1 ? "" : "s"} por caducar`,
  },
  {
    id: "incidencias_abiertas",
    keywords: ["incidencias", "incidencia", "abiertas"],
    href: "/incidencias",
    label: (r) => `${r.incidencias.count} incidencia${r.incidencias.count === 1 ? "" : "s"} abierta${r.incidencias.count === 1 ? "" : "s"}`,
  },
  {
    id: "viajes_riesgo",
    keywords: ["riesgo", "viajes en riesgo", "retraso", "retrasados", "retrasado"],
    href: "/viajes",
    label: (r) => `${r.viajesEnRiesgo.count} viaje${r.viajesEnRiesgo.count === 1 ? "" : "s"} en riesgo`,
  },
  {
    id: "choferes_561",
    keywords: ["561", "limite", "horas de conduccion", "conduccion"],
    href: "/choferes",
    label: (r) => `${r.choferes561.count} chófer${r.choferes561.count === 1 ? "" : "es"} cerca del límite 561`,
  },
  {
    id: "viajes_perdidas",
    keywords: ["perdidas", "perdida", "margen negativo", "margen"],
    href: "/viajes",
    label: (r) => `${r.viajesPerdidas.count} viaje${r.viajesPerdidas.count === 1 ? "" : "s"} a pérdidas (est.)`,
  },
];

export function matchComandos(query, resumen) {
  if (!resumen || !query || query.length < 2) return [];
  const q = normalizar(query);
  return COMANDOS.filter((c) => c.keywords.some((k) => normalizar(k).includes(q))).map((c) => ({
    kind: "comando",
    id: c.id,
    label: c.label(resumen),
    href: c.href,
  }));
}
