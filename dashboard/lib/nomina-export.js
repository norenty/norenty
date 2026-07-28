// Fase 23, 23.B.5 -- generación del CSV de nómina, aislada en su propio
// módulo (sin dependencia de Supabase) para poder testearla sin arrancar
// todo el cliente y para que sea el primer paso de separar `data.js` por
// dominio (el análisis de arquitectura con graphify confirmó que el código
// de nómina ya forma un bloque natural, cohesión 0.33 dentro del archivo
// monolítico -- este módulo es la extracción de la parte de exportación).
//
// Ojo Fase 19 (truncamiento silencioso a 1000 filas): `filas` debe venir YA
// completo en memoria desde getInformeNomina -- esta función solo formatea,
// nunca pagina ni corta, y así se verifica explícitamente en los tests.
export function filasNominaACsv(filas) {
  const header = [
    "Chófer", "Noches fuera", "Km (carretera)", "Estimado",
    "Días internacional", "Fines de semana completos", "Fines de semana medios",
    "Viajes ADR", "Cargas/descargas por el chófer", "Retenes", "Viajes",
  ].join(",") + "\n";
  const rows = filas.map((f) =>
    [
      f.nombre,
      f.nochesFuera ?? "n/d",
      f.km,
      f.estimado ? "sí" : "no",
      f.diasInternacional ?? 0,
      f.finDeSemana?.diasCompletos ?? 0,
      f.finDeSemana?.diasMedios ?? 0,
      f.viajesAdr ?? 0,
      f.cargaDescargaChofer ?? 0,
      f.retenes ?? 0,
      f.viajes.join("; "),
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
  ).join("\n");
  return header + rows;
}
