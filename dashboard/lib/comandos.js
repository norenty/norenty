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

// KPI: requieren `resumen` (getResumenHoy) ya cargado -- la etiqueta lleva la cifra.
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

// Navegación (F13 extensión 6.12, decisión 2026-07-15): destinos y ajustes
// concretos, sin datos que cargar -- la etiqueta es fija, no depende de
// `resumen`, así que funcionan desde el primer carácter, antes de que
// getResumenHoy() responda. Cubren tanto páginas completas como anclas
// dentro de /ajustes (id de <section>, ver AjustesXSection.jsx) para poder
// pedir "llévame a este ajuste" en vez de navegar a mano por el menú.
export const NAV_COMANDOS = [
  { id: "nav_nuevo_viaje", keywords: ["nuevo viaje", "crear viaje", "añadir viaje"], href: "/viajes/nuevo", label: "Nuevo viaje" },
  { id: "nav_analitica", keywords: ["analitica", "analisis", "estadisticas", "metricas", "kpi"], href: "/analitica", label: "Ir a Analítica" },
  { id: "nav_facturacion", keywords: ["facturacion", "factura", "exportar", "sap"], href: "/facturacion", label: "Ir a Facturación" },
  { id: "nav_presupuesto", keywords: ["presupuesto", "cotizador", "cotizacion", "precio sugerido"], href: "/presupuesto", label: "Ir a Presupuesto instantáneo" },
  { id: "nav_importar", keywords: ["importar", "excel", "csv", "carga masiva"], href: "/importar", label: "Ir a Importar" },
  { id: "nav_mapa", keywords: ["mapa", "ubicacion", "gps", "flota en vivo"], href: "/mapa", label: "Ir al Mapa" },
  { id: "nav_plantillas", keywords: ["plantillas", "ruta habitual", "plantilla de ruta"], href: "/plantillas", label: "Ir a Plantillas de ruta" },
  { id: "nav_nomina", keywords: ["nomina", "multas", "dietas", "noches fuera"], href: "/nomina", label: "Ir a Nómina" },

  { id: "ajustes_cuenta", keywords: ["cuenta", "email", "mi perfil"], href: "/ajustes#ajustes-cuenta", label: "Ajustes → Tu cuenta" },
  { id: "ajustes_contrasena", keywords: ["contraseña", "password", "clave", "cambiar contraseña"], href: "/ajustes#ajustes-contrasena", label: "Ajustes → Cambiar contraseña" },
  { id: "ajustes_notificaciones", keywords: ["notificaciones", "avisos", "alertas de incidencias"], href: "/ajustes#ajustes-notificaciones", label: "Ajustes → Notificaciones" },
  { id: "ajustes_mfa", keywords: ["verificacion en dos pasos", "doble factor", "2fa", "mfa", "autenticacion"], href: "/ajustes#ajustes-mfa", label: "Ajustes → Verificación en dos pasos" },
  { id: "ajustes_telegram", keywords: ["telegram", "vincular telegram", "bot de telegram"], href: "/ajustes#ajustes-telegram", label: "Ajustes → Alertas por Telegram" },
  { id: "ajustes_estado_bot", keywords: ["estado del bot", "bot caido", "latido", "heartbeat"], href: "/ajustes#ajustes-estado-bot", label: "Ajustes → Estado del bot" },
  { id: "ajustes_equipo", keywords: ["equipo", "invitar", "invitar gestor", "roles", "usuarios"], href: "/ajustes#ajustes-equipo", label: "Ajustes → Equipo" },
  { id: "ajustes_empresa", keywords: ["nombre de la empresa", "datos de empresa"], href: "/ajustes#ajustes-empresa", label: "Ajustes → Empresa" },
  { id: "ajustes_ubicacion_base", keywords: ["ubicacion base", "base de la empresa", "domicilio"], href: "/ajustes#ajustes-ubicacion-base", label: "Ajustes → Ubicación base" },
  { id: "ajustes_coste_km", keywords: ["coste por km", "coste de operacion", "euros por km"], href: "/ajustes#ajustes-coste-km", label: "Ajustes → Coste de operación" },
  { id: "ajustes_velocidad", keywords: ["velocidad de planificacion", "km/h"], href: "/ajustes#ajustes-velocidad", label: "Ajustes → Velocidad de planificación" },
  { id: "ajustes_objetivos", keywords: ["objetivo de puntualidad", "objetivo de margen", "objetivos"], href: "/ajustes#ajustes-objetivos", label: "Ajustes → Objetivos" },
  { id: "ajustes_pod", keywords: ["pod", "prueba de entrega", "albaran", "foto de albaran"], href: "/ajustes#ajustes-pod", label: "Ajustes → Prueba de entrega (POD)" },
  { id: "ajustes_coste_desglosado", keywords: ["coste desglosado", "gasoil", "peaje", "dieta"], href: "/ajustes#ajustes-coste-desglosado", label: "Ajustes → Coste desglosado" },
];

export function matchComandos(query, resumen) {
  if (!query || query.length < 2) return [];
  const q = normalizar(query);
  const kpi = resumen
    ? COMANDOS.filter((c) => c.keywords.some((k) => normalizar(k).includes(q))).map((c) => ({
        kind: "comando",
        id: c.id,
        label: c.label(resumen),
        href: c.href,
      }))
    : [];
  const nav = NAV_COMANDOS.filter((c) => c.keywords.some((k) => normalizar(k).includes(q))).map((c) => ({
    kind: "comando",
    id: c.id,
    label: c.label,
    href: c.href,
  }));
  return [...kpi, ...nav];
}
