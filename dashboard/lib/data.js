import { supabase } from "./supabase";
import { distanciaPorCarretera } from "./osrm";
import { TIPOS_DOC_VEHICULO, TIPOS_DOC_CHOFER } from "./labels";

const ALERTA_ESTADOS = ["abierta", "en_revision"];
const ESTADOS_ACTIVOS = ["planificado", "en_curso"];

// --- Informe de nómina (ítem 5.1) — parámetros ajustables ---
//
// Umbral de distancia a la base para contar una "noche fuera". 50 km es un valor
// inicial RAZONABLE, NO una cifra pactada con un gestor real: pendiente de ajustar
// cuando haya conversación con el cliente. Fácil de cambiar aquí.
export const UMBRAL_NOCHE_FUERA_KM = 50;

// --- Viabilidad / margen de viaje (ítem 5.2) — parámetro ajustable ---
// Margen % por debajo del cual un viaje se marca en ÁMBAR ("comercial se columpió
// en precio o viabilidad"). Un margen negativo siempre es ROJO. 10 % es un valor
// inicial RAZONABLE, NO pactado con un cliente real (igual que UMBRAL_NOCHE_FUERA_KM).
export const UMBRAL_MARGEN_AMBAR_PCT = 10;

// --- Dieta internacional por GPS (Fase 23, 23.B.1) ---
//
// DISCOVERY.md insight 12/21: "Por el GPS se podía ver si ha estado el día
// entero fuera de España, o más del 80%, y le pagas el internacional." Hoy
// esto se mete a mano, chófer por chófer, cada mes.
//
// Point-in-polygon EN LOCAL, sin llamar a Nominatim/terceros: son miles de
// puntos al mes y una nómina no puede depender de que un servicio externo
// esté vivo (mismo criterio que "para lo difícil, terceros; para nómina,
// nunca depender de un tercero que puede caerse", ver ROADMAP/DISCOVERY).
//
// ⚠️ Polígono SIMPLIFICADO a mano (frontera con Portugal y Pirineos
// aproximados por tramos rectos, no la línea fronteriza real) -- valor
// inicial razonable, NO pactado con cliente real, mismo estatus que
// UMBRAL_NOCHE_FUERA_KM. Ajustar con casos reales del primer piloto si
// aparece un falso positivo/negativo cerca de una frontera.
const ESPANA_PENINSULAR_POLIGONO = [
  [-7.68, 43.79], [-6.13, 43.53], [-3.82, 43.45], [-1.79, 43.38],
  [-1.75, 43.31], [-0.70, 42.87], [0.70, 42.68], [1.72, 42.47],
  [2.96, 42.43], [3.20, 41.92], [1.25, 41.15], [0.16, 40.15],
  [-0.33, 39.45], [-0.49, 38.35], [-0.68, 37.60], [-2.46, 36.83],
  [-4.42, 36.72], [-5.60, 36.13], [-7.40, 37.20], [-7.45, 37.18],
  [-7.03, 38.03], [-7.02, 39.03], [-6.83, 40.13], [-6.83, 41.03],
  [-6.53, 41.88], [-8.13, 42.13],
]; // [lon, lat], cierra implícitamente con el primer punto

// Islas/territorios fuera de la península: bounding box simple (suficiente,
// son áreas compactas sin frontera terrestre que aproximar).
const ESPANA_BBOXES = [
  { lonMin: 1.1, lonMax: 4.4, latMin: 38.6, latMax: 40.1 },     // Baleares
  { lonMin: -18.2, lonMax: -13.3, latMin: 27.6, latMax: 29.5 }, // Canarias
  { lonMin: -5.37, lonMax: -5.27, latMin: 35.86, latMax: 35.92 }, // Ceuta
  { lonMin: -2.99, lonMax: -2.89, latMin: 35.26, latMax: 35.32 }, // Melilla
];

function puntoEnPoligono(lon, lat, poligono) {
  // Ray casting estándar. `poligono`: array de [lon, lat].
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    const cruza = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

/** Punto dentro de España (peninsular + Baleares + Canarias + Ceuta/Melilla). */
export function puntoEnEspana(lat, lon) {
  if (lat == null || lon == null) return false;
  if (puntoEnPoligono(lon, lat, ESPANA_PENINSULAR_POLIGONO)) return true;
  return ESPANA_BBOXES.some((b) => lon >= b.lonMin && lon <= b.lonMax && lat >= b.latMin && lat <= b.latMax);
}

// Fracción del tiempo del día fuera de España a partir de la cual se cuenta
// como "día internacional" completo. Valor inicial razonable, NO pactado.
export const UMBRAL_DIA_INTERNACIONAL_PCT = 80;

/**
 * Dado un array de `ubicacion` (`{lat, lon, created_at}`) de UN chófer,
 * agrupa por día natural (UTC) y devuelve el Set de fechas (YYYY-MM-DD) en
 * las que el chófer estuvo fuera de España al menos `UMBRAL_DIA_INTERNACIONAL_PCT`
 * % de los pings de ese día. Pura, sin red -- reutilizable en tests.
 */
export function diasInternacionalPorPings(ubicaciones) {
  const porDia = {};
  for (const u of ubicaciones || []) {
    if (u.lat == null || u.lon == null || !u.created_at) continue;
    const dia = u.created_at.slice(0, 10); // YYYY-MM-DD, UTC (created_at es timestamptz)
    if (!porDia[dia]) porDia[dia] = { total: 0, fuera: 0 };
    porDia[dia].total += 1;
    if (!puntoEnEspana(u.lat, u.lon)) porDia[dia].fuera += 1;
  }
  const dias = new Set();
  for (const [dia, { total, fuera }] of Object.entries(porDia)) {
    if (total > 0 && (fuera / total) * 100 >= UMBRAL_DIA_INTERNACIONAL_PCT) dias.add(dia);
  }
  return dias;
}

// --- Invitaciones de equipo (ítem 9.10) — expiración explícita ---
// Debe coincidir EXACTAMENTE con el intervalo de la función usar_invitacion()
// (migración 0035) — es solo para mostrar el estado "Vencida" en la UI; la
// seguridad real (que el canje falle) la impone la función en Postgres.
export const INVITACION_VALIDEZ_DIAS = 7;

// --- ETA "cumple-561" (ítem 5.3) — parámetros ajustables ---
// Velocidad de planificación por defecto. 75 km/h es un HEURÍSTICO de flota
// (absorbe urbano/tráfico/repechos de un camión limitado legalmente a 90 km/h),
// NO un dato pactado con cliente real — mismo estatus que los umbrales anteriores.
export const VELOCIDAD_PLANIFICACION_KMH = 75;

// Reglamento (CE) 561/2006 — límites v1 (ver DISCOVERY.md para el detalle
// investigado). Simplificaciones deliberadas de esta v1, documentadas:
//  - Se usa siempre el límite diario base (9h) y el descanso normal (11h); NO se
//    modela la excepción de conducción diaria a 10h (máx. 2x/semana) ni el
//    descanso reducido (9h) — ambas requieren estado multi-viaje/multi-semana
//    que no existe en un cálculo por-viaje aislado. Esto hace el cálculo
//    CONSERVADOR (sobreestima el tiempo total, nunca lo infraestima).
//  - NO se comprueban los límites semanal (56h) / bisemanal (90h) / descanso
//    semanal (45h) por la misma razón: son estado acumulado entre viajes.
const PAUSA_TRAS_HORAS = 4.5;
const PAUSA_DURACION_H = 45 / 60;
const CONDUCCION_DIARIA_MAX_H = 9;
const DESCANSO_DIARIO_H = 11;

// Margen de seguridad sobre la pausa legal (Fase 23, DISCOVERY.md insight 21,
// 2026-07-29 -- amigo del usuario, planificador real): "si la parada son 45
// minutos, sumarle 55 o una hora por cosas que puedan pasar". No es parte del
// Reglamento 561/2006 -- es colchón operativo para que el ETA sea realista
// (encontrar hueco de aparcamiento, arrancar de nuevo, etc.), NO para cumplir
// la ley (eso ya lo hace PAUSA_DURACION_H tal cual). 15 min redondea 45→60
// min, valor inicial razonable, NO pactado con cliente real -- mismo estatus
// que el resto de umbrales del proyecto.
export const MARGEN_SEGURIDAD_PARADA_MIN = 15;

/**
 * Resuelve la velocidad de planificación a usar: la de la empresa si está
 * configurada (y es positiva), si no VELOCIDAD_PLANIFICACION_KMH por defecto.
 */
export function resolveVelocidadPlanificacion(empresa) {
  if (empresa && empresa.velocidad_planificacion_kmh != null && empresa.velocidad_planificacion_kmh > 0) {
    return empresa.velocidad_planificacion_kmh;
  }
  return VELOCIDAD_PLANIFICACION_KMH;
}

/**
 * Simula el Reglamento (CE) 561/2006 (versión v1 conservadora, ver nota arriba)
 * sobre un total de horas de CONDUCCIÓN pura, e inserta las pausas/descansos
 * obligatorios. Función PURA (sin red, sin fechas reales) — testeable a mano.
 *
 * @param {number} horasConduccionTotal
 * @returns {{horasTotales: number, paradas45min: number, descansos11h: number}}
 */
export function calcularEtaConParadas(horasConduccionTotal) {
  const EPS = 1e-9;
  let restante = horasConduccionTotal;
  let desdeUltimaPausa = 0;
  let conduccionHoy = 0;
  let horasTotales = 0;
  let paradas45min = 0;
  let descansos11h = 0;

  while (restante > EPS) {
    const margenPausa = PAUSA_TRAS_HORAS - desdeUltimaPausa;
    const margenDia = CONDUCCION_DIARIA_MAX_H - conduccionHoy;
    const tramo = Math.min(restante, margenPausa, margenDia);

    horasTotales += tramo;
    desdeUltimaPausa += tramo;
    conduccionHoy += tramo;
    restante -= tramo;

    if (restante <= EPS) break;

    if (conduccionHoy >= CONDUCCION_DIARIA_MAX_H - EPS) {
      horasTotales += DESCANSO_DIARIO_H;
      descansos11h++;
      conduccionHoy = 0;
      desdeUltimaPausa = 0; // un descanso largo también cubre/resetea la pausa corta
    } else if (desdeUltimaPausa >= PAUSA_TRAS_HORAS - EPS) {
      horasTotales += PAUSA_DURACION_H + MARGEN_SEGURIDAD_PARADA_MIN / 60;
      paradas45min++;
      desdeUltimaPausa = 0;
    }
  }

  return { horasTotales, paradas45min, descansos11h };
}

/**
 * ETA de un viaje respetando las paradas legales. Reutiliza kmCarreteraViaje
 * (5.2, ruta planificada = todos los hitos) y deriva horas de conducción como
 * km / velocidad de planificación — NO se usa la duración que da OSRM porque su
 * perfil "driving" está calibrado para turismos, no camiones, y subestimaría el
 * tiempo real de conducción.
 */
export async function getEtaViaje(viajeId) {
  const { data: viaje } = await supabase.from("viaje").select("id").eq("id", viajeId).single();
  if (!viaje) return null;

  const [{ data: hitos }, { data: empresas }] = await Promise.all([
    supabase.from("hito").select("orden, lat, lon").eq("viaje_id", viajeId),
    supabase.from("empresa").select("velocidad_planificacion_kmh"),
  ]);

  const empresa = (empresas || [])[0] || null;
  const velocidadKmh = resolveVelocidadPlanificacion(empresa);
  const { km, estimado } = await kmCarreteraViaje(hitos || []);
  const horasConduccion = km / velocidadKmh;
  const { horasTotales, paradas45min, descansos11h } = calcularEtaConParadas(horasConduccion);

  return {
    km: Math.round(km),
    estimado,
    velocidadKmh,
    horasConduccion: +horasConduccion.toFixed(1),
    horasTotales: +horasTotales.toFixed(1),
    paradas45min,
    descansos11h,
  };
}

// Ventana horaria alrededor de medianoche en la que un hito completado (llegada)
// cuenta como "el chófer estaba fuera esa noche". Del día D 22:00 al día D+1 06:00.
const NOCHE_HORA_INICIO = 22; // 22:00 del día D
const NOCHE_HORA_FIN = 6; //  06:00 del día D+1

// La operación es en España: la ventana horaria se evalúa en hora local
// (Europe/Madrid, con cambio de horario CET/CEST correcto vía Intl), no en UTC.
const ZONA_HORARIA_OPERACION = "Europe/Madrid";

// Descompone un timestamp ISO en año/mes/día/hora locales de ZONA_HORARIA_OPERACION.
function partesLocalOperacion(fechaIso) {
  const d = new Date(fechaIso);
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONA_HORARIA_OPERACION,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  // Intl con hour12:false puede devolver "24" para la medianoche exacta.
  let hora = parseInt(partes.hour, 10);
  if (hora === 24) hora = 0;
  return { anio: Number(partes.year), mes: Number(partes.month), dia: Number(partes.day), hora };
}

// Fecha (YYYY-MM-DD) a la que se atribuye la "noche fuera": si la llegada es de
// madrugada (antes de NOCHE_HORA_FIN), pertenece a la noche del día anterior.
function fechaNocheOperacion(fechaIso) {
  const { anio, mes, dia, hora } = partesLocalOperacion(fechaIso);
  // Mediodía UTC del día local para evitar que restar un día cruce un borde de DST.
  const d = new Date(Date.UTC(anio, mes - 1, dia, 12));
  if (hora < NOCHE_HORA_FIN) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Fecha local (YYYY-MM-DD) en ZONA_HORARIA_OPERACION -- distinto de
// fechaNocheOperacion: aquí NO hay desplazamiento de madrugada, es solo "qué
// día natural es esto en España", para saber si cae en sábado/domingo.
function fechaLocalOperacion(fechaIso) {
  const { anio, mes, dia } = partesLocalOperacion(fechaIso);
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

// --- Fin de semana con la regla de las 4,5h (Fase 23, 23.B.2) ---
//
// DISCOVERY.md insight 12: "Si han trabajado el fin de semana: solo medio
// sábado, sábado entero, solo medio domingo o domingo entero. No por horas.
// Si ha estado más de 4 horas y media trabajando, le pagas el día entero.
// Incluyendo el descanso, se suele incluir." -- el descanso cuenta DENTRO de
// la jornada, por eso se usa el SPAN (primer evento a último evento del día),
// no la suma de tramos activos.
export const UMBRAL_MEDIO_DIA_FIN_SEMANA_H = 4.5;

/** 'sabado' | 'domingo' | null para una fecha YYYY-MM-DD (día de la semana en
 * UTC puro -- una fecha-sin-hora no tiene zona horaria que ambigüe esto). */
export function claseFinDeSemana(fechaYYYYMMDD) {
  const [a, m, d] = fechaYYYYMMDD.split("-").map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0=domingo, 6=sábado
  if (dow === 6) return "sabado";
  if (dow === 0) return "domingo";
  return null;
}

/** 'completo' si > UMBRAL_MEDIO_DIA_FIN_SEMANA_H horas, 'medio' si hay
 * actividad pero menos, null si no hubo nada ese día. */
export function clasificarExtraFinDeSemana(horas) {
  if (horas > UMBRAL_MEDIO_DIA_FIN_SEMANA_H) return "completo";
  if (horas > 0) return "medio";
  return null;
}

/**
 * Dado un array de `ejecucion_evento` (`{ocurrido_en}`) de UN chófer en el
 * mes, agrupa por día local y clasifica cada sábado/domingo con actividad.
 * El "trabajado" es el SPAN del día (primer a último evento), no la suma de
 * tramos -- así el descanso de en medio cuenta dentro de la jornada, tal
 * como describió el gestor. Pura, sin red -- reutilizable en tests.
 */
export function extrasFinDeSemanaPorEventos(eventos) {
  const porDia = {};
  for (const e of eventos || []) {
    if (!e.ocurrido_en) continue;
    const fecha = fechaLocalOperacion(e.ocurrido_en);
    if (!claseFinDeSemana(fecha)) continue;
    const t = new Date(e.ocurrido_en).getTime();
    if (!porDia[fecha]) porDia[fecha] = { min: t, max: t };
    else {
      porDia[fecha].min = Math.min(porDia[fecha].min, t);
      porDia[fecha].max = Math.max(porDia[fecha].max, t);
    }
  }
  let diasCompletos = 0;
  let diasMedios = 0;
  for (const { min, max } of Object.values(porDia)) {
    const clase = clasificarExtraFinDeSemana((max - min) / 3600000);
    if (clase === "completo") diasCompletos++;
    else if (clase === "medio") diasMedios++;
  }
  return { diasCompletos, diasMedios };
}

// El Kanban de la home muestra planificado/en_curso/completados sin paginación de UI
// (ítem 9.32) — un histórico de completados sin límite crecería sin cota. Se acota a los
// más recientes por `created_at`: los activos (planificado/en_curso) casi siempre son
// recientes también, así que en la práctica siguen apareciendo todos.
export const LIMITE_VIAJES_HOME = 300;

export async function getViajes() {
  const { data: viajes, error } = await supabase
    .from("viaje")
    .select("*, chofer(nombre, idioma), hito(id, estado, tipo, direccion, orden)")
    .order("created_at", { ascending: false })
    .limit(LIMITE_VIAJES_HOME);

  if (error || !viajes) return [];

  const { data: incidencias } = await supabase
    .from("incidencia")
    .select("viaje_id, estado, tipo")
    .in("estado", ALERTA_ESTADOS);

  const incidenciaPorViaje = {};
  (incidencias || []).forEach((i) => {
    if (!incidenciaPorViaje[i.viaje_id]) incidenciaPorViaje[i.viaje_id] = i;
  });

  return viajes.map((v) => {
    const hitos = v.hito || [];
    const total = hitos.length;
    const completados = hitos.filter((h) => h.estado === "completado").length;
    const pendiente = [...hitos]
      .sort((a, b) => a.orden - b.orden)
      .find((h) => h.estado !== "completado");
    const incidencia = incidenciaPorViaje[v.id];

    return {
      id: v.id,
      referencia: v.referencia || v.id.slice(0, 8),
      estado: v.estado,
      created_at: v.created_at,
      chofer: v.chofer || { nombre: "Sin asignar", idioma: "" },
      hitosCompletados: completados,
      hitosTotal: total,
      hitoActual: pendiente
        ? `${pendiente.tipo === "recogida" ? "Recogida" : "Entrega"} · ${pendiente.direccion || "—"}`
        : null,
      incidencia: incidencia || null,
    };
  });
}

const VIAJES_PAGE = 50;

export async function getViajesLista({ offset = 0, estado = null } = {}) {
  let query = supabase
    .from("viaje")
    .select("*, chofer(nombre, idioma), hito(id, estado, tipo, direccion, orden)")
    .order("created_at", { ascending: false })
    .range(offset, offset + VIAJES_PAGE);

  if (estado) query = query.eq("estado", estado);

  const { data: viajes, error } = await query;
  if (error || !viajes) return { rows: [], hayMas: false };

  const hayMas = viajes.length > VIAJES_PAGE;
  const slice = hayMas ? viajes.slice(0, VIAJES_PAGE) : viajes;

  const ids = slice.map((v) => v.id);
  const { data: incidencias } = await supabase
    .from("incidencia")
    .select("viaje_id, estado, tipo")
    .in("estado", ALERTA_ESTADOS)
    .in("viaje_id", ids.length ? ids : ["__none__"]);

  const incidenciaPorViaje = {};
  (incidencias || []).forEach((i) => {
    if (!incidenciaPorViaje[i.viaje_id]) incidenciaPorViaje[i.viaje_id] = i;
  });

  const rows = slice.map((v) => {
    const hitos = v.hito || [];
    const total = hitos.length;
    const completados = hitos.filter((h) => h.estado === "completado").length;
    const pendiente = [...hitos].sort((a, b) => a.orden - b.orden).find((h) => h.estado !== "completado");
    return {
      id: v.id,
      referencia: v.referencia || v.id.slice(0, 8),
      estado: v.estado,
      created_at: v.created_at,
      chofer: v.chofer || { nombre: "Sin asignar", idioma: "" },
      // 18.C.1: sin gestor_id el viaje está "en el pool" (visible a todo el
      // equipo, pendiente de que el jefe de tráfico lo adjudique).
      gestor_id: v.gestor_id,
      hitosCompletados: completados,
      hitosTotal: total,
      hitoActual: pendiente
        ? `${pendiente.tipo === "recogida" ? "Recogida" : "Entrega"} · ${pendiente.direccion || "—"}`
        : null,
      incidencia: incidenciaPorViaje[v.id] || null,
    };
  });

  return { rows, hayMas };
}

export async function getViaje(id) {
  const { data: viaje } = await supabase
    .from("viaje")
    .select("*, chofer(id, nombre, idioma)")
    .eq("id", id)
    .single();

  if (!viaje) return null;

  const { data: hitos } = await supabase
    .from("hito")
    .select("*")
    .eq("viaje_id", id)
    .order("orden");

  const { data: eventos } = await supabase
    .from("ejecucion_evento")
    .select("*")
    .eq("viaje_id", id)
    .order("ocurrido_en", { ascending: true });

  const { data: pods } = await supabase
    .from("pod")
    .select("*")
    .eq("viaje_id", id);

  const { data: valoraciones } = await supabase
    .from("valoracion")
    .select("*")
    .eq("viaje_id", id)
    .order("created_at", { ascending: false });

  return {
    viaje,
    hitos: hitos || [],
    eventos: eventos || [],
    pods: pods || [],
    valoraciones: valoraciones || [],
  };
}

/**
 * Fase 23, Bloque A (23.A.3) — DISCOVERY.md insight 14: "me he pegado media
 * hora buscando papeles en el armario" (custodia real: 3 años albaranes, 10
 * facturas). Buscador sobre los POD ya almacenados -- sin storage nuevo, es
 * una VISTA sobre lo que ya hay. Todos los filtros son opcionales y se
 * combinan con AND; sin ninguno, trae los más recientes primero.
 *
 * @param {{referencia?, clienteNombre?, matricula?, choferId?, desde?, hasta?}} filtros
 */
export async function buscarAlbaranes(filtros = {}) {
  let query = supabase
    .from("pod")
    .select(
      "id, foto_url, hash_sha256, created_at, hito_id, " +
      "viaje:viaje_id(id, referencia, cliente:cliente_id(nombre), chofer:chofer_id(id, nombre), vehiculo:vehiculo_id(matricula))"
    )
    .order("created_at", { ascending: false });

  if (filtros.desde) query = query.gte("created_at", filtros.desde);
  if (filtros.hasta) query = query.lte("created_at", filtros.hasta);

  const { data } = await query;

  return (data || [])
    .filter((p) => p.viaje) // aislamiento: RLS ya scopa `pod` por empresa vía el viaje, esto filtra huérfanos
    .filter((p) => {
      if (filtros.referencia && !(p.viaje.referencia || "").toLowerCase().includes(filtros.referencia.toLowerCase())) return false;
      if (filtros.clienteNombre && !(p.viaje.cliente?.nombre || "").toLowerCase().includes(filtros.clienteNombre.toLowerCase())) return false;
      if (filtros.matricula && !(p.viaje.vehiculo?.matricula || "").toLowerCase().includes(filtros.matricula.toLowerCase())) return false;
      if (filtros.choferId && p.viaje.chofer?.id !== filtros.choferId) return false;
      return true;
    })
    .map((p) => ({
      id: p.id,
      fotoUrl: p.foto_url,
      hash: p.hash_sha256,
      creadoEn: p.created_at,
      viajeId: p.viaje.id,
      viajeReferencia: p.viaje.referencia,
      clienteNombre: p.viaje.cliente?.nombre || null,
      choferNombre: p.viaje.chofer?.nombre || null,
      matricula: p.viaje.vehiculo?.matricula || null,
    }));
}

/**
 * F13.2 — Dossier de evidencia para reclamaciones: reúne todo lo probatorio de
 * un viaje (cadena de hash de los eventos, POD con su hash SHA-256 y hora,
 * checkpoints, llegadas) para un documento imprimible que enseñar a un cliente
 * en una disputa. Solo lectura, composición de datos ya existentes.
 */
export async function getDossierViaje(viajeId) {
  const { data: viaje } = await supabase
    .from("viaje")
    .select("*, chofer(nombre), cliente(nombre, cif)")
    .eq("id", viajeId)
    .single();
  if (!viaje) return null;

  const [{ data: hitos }, { data: eventos }, { data: pods }] = await Promise.all([
    supabase.from("hito").select("id, orden, tipo, direccion, es_checkpoint").eq("viaje_id", viajeId).order("orden"),
    supabase.from("ejecucion_evento").select("tipo, detalle, ocurrido_en, hash, hash_prev, hito_id").eq("viaje_id", viajeId).order("ocurrido_en", { ascending: true }),
    supabase.from("pod").select("foto_url, hash_sha256, created_at, hito_id").eq("viaje_id", viajeId),
  ]);

  return { viaje, hitos: hitos || [], eventos: eventos || [], pods: pods || [] };
}

/**
 * Empresa del gestor actualmente logueado (multi-tenant: cada gestor pertenece
 * a una empresa, nunca "la primera que haya"). Lanza si no hay sesión o el
 * gestor no tiene empresa asociada — eso es un estado roto, no algo a ocultar.
 */
export async function getCurrentEmpresaId() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("No hay sesión activa");

  const { data: gestor, error } = await supabase
    .from("gestor")
    .select("empresa_id")
    .eq("auth_user_id", session.user.id)
    .single();

  if (error || !gestor?.empresa_id) {
    throw new Error("Tu cuenta no tiene una empresa asociada. Contacta con soporte.");
  }
  return gestor.empresa_id;
}

/**
 * Id y rol del gestor logueado, o null si no hay sesión (p.ej. contexto de
 * servidor/cron). Pensado para asignar `gestor_id` al crear un recurso
 * (Fase 15): un admin deja el recurso sin asignar (visible a todo el equipo,
 * igual que hoy), un gestor no-admin se lo asigna a sí mismo por defecto para
 * que la RLS de F15.2 lo siga viendo -- sin esto, todo lo creado por un
 * gestor no-admin quedaba huérfano (gestor_id NULL = visible a todos) y la
 * Fase 15 no protegía nada nuevo.
 */
async function getCurrentGestor() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data: gestor } = await supabase
    .from("gestor")
    .select("id, rol")
    .eq("auth_user_id", session.user.id)
    .single();
  return gestor || null;
}

/** `gestor_id` por defecto para un recurso recién creado: el propio gestor si
 * no es admin, o `null` (sin asignar) si es admin o no hay sesión. */
async function gestorIdPorDefecto() {
  const gestor = await getCurrentGestor();
  // rol ausente = admin por defecto en BD (0032) -- tratarlo igual aquí.
  if (!gestor || !gestor.rol || gestor.rol === "admin") return null;
  return gestor.id;
}

/** C.1/C.2 -- siempre el propio gestor, NUNCA null. Para los casos donde no
 * debe existir un estado "sin asignar" (choferes, decisión 2026-07-25: "creo
 * que nunca debería haber un chofer sin asignar un gestor") o donde NULL
 * perdería el rastro de auditoría (quién solicitó/resolvió una aprobación).
 * Distinto de gestorIdPorDefecto(), que sigue devolviendo null para admin --
 * ese es el comportamiento correcto para viaje.gestor_id (18.C.1, "pool" de
 * viajes SÍ es un estado válido, decisión aparte). */
async function gestorIdComoAutor() {
  const gestor = await getCurrentGestor();
  return gestor ? gestor.id : null;
}

// ==========================================================================
// Clientes (ítem 11.1) — el cliente como entidad de primera clase, para que el
// conocimiento gestor↔cliente tenga dónde vivir (precursor de la capa de
// contexto de 11.2). RLS por empresa; `viaje.referencia` se conserva intacto.
// ==========================================================================

/** Clientes activos de la empresa del gestor logueado (RLS limita a su empresa).
 * Ordenados por nombre en JS (`.order()` es no-op en el mock de tests, 0.3). */
export async function getClientes({ incluirInactivos = false } = {}) {
  let query = supabase.from("cliente").select("id, nombre, cif, email, telefono, notas, activo, created_at");
  if (!incluirInactivos) query = query.eq("activo", true);
  const { data } = await query;
  return (data || []).slice().sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
}

/**
 * Direcciones ya usadas antes por esta empresa, con sus coordenadas (2026-07-22,
 * hallazgo real en el primer smoke test: sin esto, el gestor tiene que escribir
 * la dirección Y teclear lat/lon a mano cada vez, aunque sea el mismo cliente de
 * siempre). Reutiliza `hito` (que YA guarda direccion+lat+lon de cada viaje
 * pasado) en vez de montar un geocodificador externo o una tabla de "lugares"
 * nueva — no hace falta: la dirección de "Adidas Madrid, polígono X" ya está
 * en la BD desde el primer viaje que se hizo allí.
 * Deduplicado por dirección (case-insensitive), la más reciente gana si hay
 * coordenadas ligeramente distintas para el mismo texto.
 */
export async function getDireccionesGuardadas() {
  const { data } = await supabase
    .from("hito")
    .select("direccion, lat, lon, created_at")
    .not("direccion", "is", null)
    .not("lat", "is", null)
    .not("lon", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);

  const vistas = new Set();
  const resultado = [];
  for (const h of data || []) {
    const clave = h.direccion.trim().toLowerCase();
    if (!clave || vistas.has(clave)) continue;
    vistas.add(clave);
    resultado.push({ direccion: h.direccion, lat: h.lat, lon: h.lon });
  }
  return resultado;
}

/**
 * Geocodificación de direcciones nuevas (18.D.2, 2026-07-24). Hallazgo del
 * usuario recorriendo el producto: *"la latitud y la longitud me parece que es
 * imposible, eso no lo utiliza nadie"*. Tenía razón — hasta ahora, una dirección
 * que la empresa NO hubiera usado antes obligaba a ir a Google Maps, sacar las
 * coordenadas y teclearlas. Inusable de verdad.
 *
 * Usa Nominatim (el geocodificador de OpenStreetMap, mismo proyecto que los
 * tiles del mapa) en vez de Google Maps: es gratis y no obliga a meter una
 * tarjeta ni una API key en el cliente. A cambio hay que respetar su política
 * de uso — de ahí el debounce en el componente, el mínimo de caracteres y la
 * caché de abajo. OJO PARA PRODUCCIÓN: la instancia pública de Nominatim pide
 * "uso no intensivo"; con volumen real hay que auto-hospedarla o pasar a un
 * proveedor de pago (ver ROADMAP 18.D.2).
 */
const cacheGeocoding = new Map();

export async function buscarDireccion(texto) {
  const q = (texto || "").trim();
  if (q.length < 4) return [];
  const clave = q.toLowerCase();
  if (cacheGeocoding.has(clave)) return cacheGeocoding.get(clave);

  // 18.D.2b: sesga (sin excluir) hacia España -- "si pongo Calle Mayor 3, es
  // más fácil que sea en Madrid que en Puertollano". `viewbox` SIN `bounded=1`
  // es una preferencia, no un filtro duro: sin `bounded`, Nominatim solo
  // reordena a favor de la zona, no descarta nada -- una empresa de transporte
  // hace rutas a Ámsterdam/Milán/Fráncfort/Lisboa (ver seed de Pepito) y esos
  // resultados tienen que poder seguir apareciendo. NO se usa `countrycodes`
  // a propósito: eso sí es un filtro duro y excluiría de raíz cualquier país
  // nuevo al que la empresa empiece a viajar.
  const VIEWBOX_ESPANA = "-9.8,44.0,4.6,35.8"; // lon_min,lat_max,lon_max,lat_min
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0" +
    `&viewbox=${VIEWBOX_ESPANA}` +
    "&q=" + encodeURIComponent(q);

  let resultados = [];
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json = await res.json();
    resultados = (json || [])
      .filter((r) => r.lat && r.lon)
      .map((r) => ({
        direccion: r.display_name,
        lat: Number(r.lat),
        lon: Number(r.lon),
      }));
  } catch {
    // Sin conexión o Nominatim caído: se degrada a escribir la dirección a mano,
    // que es exactamente el comportamiento que había antes. No rompe el alta.
    return [];
  }

  cacheGeocoding.set(clave, resultados);
  return resultados;
}

/**
 * Rutas guardadas (`plantilla_ruta`) de un cliente, para ofrecerlas en el
 * asistente de nuevo viaje (17.G.1 — antes las plantillas existían pero no
 * estaban conectadas al alta de viaje, había que rellenar todo a mano igual).
 * Si no hay `clienteId` devuelve las genéricas (sin cliente asociado), que
 * también sirven para cualquier cliente.
 */
export async function getPlantillasRuta(clienteId) {
  // 18.A.2 (caso a): solo se ofrecen plantillas aprobadas por el jefe de
  // tráfico -- una recién creada queda 'pendiente' hasta que la revisen.
  let query = supabase.from("plantilla_ruta").select("id, nombre, cliente_id").eq("estado_aprobacion", "aprobada").order("nombre");
  query = clienteId ? query.eq("cliente_id", clienteId) : query.is("cliente_id", null);
  const { data } = await query;
  return data || [];
}

/** Hitos de una plantilla de ruta, en orden — con lat/lon si se guardaron. */
export async function getPlantillaHitos(plantillaRutaId) {
  const { data } = await supabase
    .from("plantilla_hito")
    .select("orden, tipo, direccion, lat, lon")
    .eq("plantilla_ruta_id", plantillaRutaId)
    .order("orden");
  return data || [];
}

/** 18.A.2 (caso a) — dar de alta una ruta nueva. Nace 'pendiente' de
 * aprobación del jefe de tráfico (admin/gestor_operativo); no se ofrece en
 * el asistente de nuevo viaje (getPlantillasRuta) hasta que se apruebe. */
export async function crearPlantillaRuta({ nombre, clienteId = null, hitos = [] }) {
  const empresa_id = await getCurrentEmpresaId();
  const gestorId = await gestorIdComoAutor();
  const { data: plantilla, error } = await supabase
    .from("plantilla_ruta")
    .insert({ nombre, empresa_id, cliente_id: clienteId || null, estado_aprobacion: "pendiente" })
    .select()
    .single();
  if (error) throw error;

  const rows = (hitos || [])
    .filter((h) => h.direccion?.trim())
    .map((h, i) => ({
      plantilla_ruta_id: plantilla.id,
      orden: i + 1,
      tipo: h.tipo,
      direccion: h.direccion.trim(),
      lat: h.lat === "" || h.lat == null ? null : Number(h.lat),
      lon: h.lon === "" || h.lon == null ? null : Number(h.lon),
    }));
  if (rows.length) {
    const { error: errorHitos } = await supabase.from("plantilla_hito").insert(rows);
    if (errorHitos) throw errorHitos;
  }

  const { error: errorSolicitud } = await supabase.from("solicitud_aprobacion").insert({
    empresa_id,
    tipo: "ruta_nueva",
    entidad: "plantilla_ruta",
    entidad_id: plantilla.id,
    motivo: `Ruta nueva: "${nombre}"`,
    solicitado_por: gestorId,
  });
  if (errorSolicitud) throw errorSolicitud;

  return plantilla;
}

/** 18.A.2 — solicitudes pendientes de aprobación del jefe de tráfico
 * (admin/gestor_operativo), ambos casos (ruta nueva, viabilidad baja). */
export async function getSolicitudesAprobacion() {
  const { data, error } = await supabase
    .from("solicitud_aprobacion")
    .select("*, solicitante:solicitado_por(nombre)")
    .eq("estado", "pendiente")
    .order("solicitado_en", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Resuelve una solicitud (aprobar/rechazar). Si es un viaje con viabilidad
 * baja y se aprueba, lo desbloquea a 'planificado'; si es una ruta nueva y
 * se aprueba, queda disponible en el asistente de nuevo viaje. Rechazar solo
 * cierra la solicitud -- no borra ni cancela nada automáticamente, el jefe
 * de tráfico decide qué hacer con la entidad desde su pantalla habitual. */
export async function resolverSolicitudAprobacion(solicitudId, aprobar) {
  // Auditoría de seguridad (2026-07-26): defensa en profundidad -- RLS ya
  // exige empresa_id = current_empresa_id() en cada tabla, pero repetir el
  // filtro aquí evita que un fallo de RLS en una sola tabla se propague a
  // las otras dos que toca esta función.
  const empresaId = await getCurrentEmpresaId();
  const gestorId = await gestorIdComoAutor();
  const { data: solicitud, error: errorGet } = await supabase
    .from("solicitud_aprobacion")
    .select("entidad, entidad_id")
    .eq("id", solicitudId)
    .eq("empresa_id", empresaId)
    .single();
  if (errorGet) throw errorGet;

  const { error } = await supabase
    .from("solicitud_aprobacion")
    .update({ estado: aprobar ? "aprobada" : "rechazada", resuelto_por: gestorId, resuelto_en: new Date().toISOString() })
    .eq("id", solicitudId)
    .eq("empresa_id", empresaId);
  if (error) throw error;

  if (aprobar && solicitud.entidad === "viaje") {
    const { error: errorViaje } = await supabase.from("viaje").update({ estado: "planificado" }).eq("id", solicitud.entidad_id).eq("empresa_id", empresaId);
    if (errorViaje) throw errorViaje;
  } else if (solicitud.entidad === "plantilla_ruta") {
    const { error: errorPlantilla } = await supabase
      .from("plantilla_ruta")
      .update({ estado_aprobacion: aprobar ? "aprobada" : "rechazada" })
      .eq("id", solicitud.entidad_id)
      .eq("empresa_id", empresaId);
    if (errorPlantilla) throw errorPlantilla;
  }
}

// ==========================================================================
// Fase 25 — Vacaciones de gestor con aviso de cobertura mínima (25.3)
// ==========================================================================

/**
 * Calcula el aviso de cobertura para un rango de fechas: de los gestores activos
 * de la empresa, cuántos seguirían operativos si se aprobara una vacación en ese
 * rango (contando las ya aprobadas que se solapen + la que se está evaluando).
 * Decisión 25.1: esto SOLO informa -- nunca bloquea, el jefe de tráfico decide con
 * la cifra delante (mismo principio que `calcularAvisosViabilidad`).
 */
export async function calcularAvisoCoberturaVacaciones(fechaInicio, fechaFin, excluirVacacionId = null) {
  const empresaId = await getCurrentEmpresaId();
  const [{ data: gestores, error: errGestores }, { data: empresas, error: errEmpresa }] = await Promise.all([
    supabase.from("gestor").select("id").eq("empresa_id", empresaId).eq("activo", true),
    supabase.from("empresa").select("cobertura_minima_pct").eq("id", empresaId).single(),
  ]);
  if (errGestores) throw errGestores;
  if (errEmpresa) throw errEmpresa;

  const totalActivos = (gestores || []).length;
  const coberturaMinimaPct = Number(empresas?.cobertura_minima_pct ?? 70);
  if (totalActivos === 0) return { totalActivos: 0, deBajaSolapando: 0, pctCobertura: null, coberturaMinimaPct, avisoBajaCobertura: false };

  // Vacaciones ya aprobadas cuyo rango se solapa con [fechaInicio, fechaFin].
  // Solape de intervalos: A.inicio <= B.fin AND A.fin >= B.inicio.
  let query = supabase
    .from("vacaciones_gestor")
    .select("id, gestor_id")
    .eq("empresa_id", empresaId)
    .eq("estado", "aprobada")
    .lte("fecha_inicio", fechaFin)
    .gte("fecha_fin", fechaInicio);
  if (excluirVacacionId) query = query.neq("id", excluirVacacionId);
  const { data: solapadas, error: errSolapadas } = await query;
  if (errSolapadas) throw errSolapadas;

  // +1 por la propia solicitud que se está evaluando (aún no aprobada, o la que se
  // está a punto de aprobar) -- de ahí que se sume aparte del resultado de la query.
  const deBajaSolapando = new Set((solapadas || []).map((v) => v.gestor_id)).size + 1;
  const pctCobertura = Math.round(((totalActivos - deBajaSolapando) / totalActivos) * 100);

  return {
    totalActivos,
    deBajaSolapando,
    pctCobertura,
    coberturaMinimaPct,
    avisoBajaCobertura: pctCobertura < coberturaMinimaPct,
  };
}

/** El propio gestor solicita sus vacaciones (RLS: solo puede solicitar para sí
 * mismo, ver policy "gestor solicita sus propias vacaciones" de 0076). Calcula y
 * guarda el aviso de cobertura como snapshot textual, para que quede constancia de
 * qué se le mostró al jefe de tráfico en el momento de decidir. */
export async function solicitarVacaciones(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin || fechaFin < fechaInicio) {
    throw new Error("El rango de fechas no es válido");
  }
  const empresaId = await getCurrentEmpresaId();
  const gestorId = await gestorIdComoAutor();
  const aviso = await calcularAvisoCoberturaVacaciones(fechaInicio, fechaFin);
  const aviso_cobertura = aviso.avisoBajaCobertura
    ? `Cobertura ${aviso.pctCobertura}% (${aviso.deBajaSolapando} de ${aviso.totalActivos} de baja) — por debajo del mínimo de ${aviso.coberturaMinimaPct}%`
    : `Cobertura ${aviso.pctCobertura}% (${aviso.deBajaSolapando} de ${aviso.totalActivos} de baja) — dentro del mínimo`;

  const { error } = await supabase.from("vacaciones_gestor").insert({
    empresa_id: empresaId,
    gestor_id: gestorId,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    aviso_cobertura,
  });
  if (error) throw error;
  return aviso;
}

/** Vacaciones pendientes de aprobación (18.A.2/25 comparten el mismo patrón de
 * "jefe de tráfico resuelve", pero es una tabla propia -- no una entidad externa a
 * la que apuntar como `solicitud_aprobacion`). */
export async function getVacacionesPendientes() {
  const { data, error } = await supabase
    .from("vacaciones_gestor")
    .select("*, gestor:gestor_id(nombre)")
    .eq("estado", "pendiente")
    .order("solicitado_en", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Las propias solicitudes de vacaciones del gestor logueado, cualquier estado
 * (a diferencia de `getVacacionesPendientes`, que es la cola de aprobación del
 * jefe de tráfico y solo muestra las pendientes). */
export async function getMisVacaciones() {
  const gestorId = await gestorIdComoAutor();
  if (!gestorId) return [];
  const { data, error } = await supabase
    .from("vacaciones_gestor")
    .select("id, fecha_inicio, fecha_fin, estado, aviso_cobertura, solicitado_en")
    .eq("gestor_id", gestorId)
    .order("solicitado_en", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Aprueba/rechaza una solicitud de vacaciones. No reasigna nada automáticamente
 * (25.5, sugerencia de redistribución, queda para más adelante) -- el jefe de
 * tráfico sigue decidiendo qué hacer con los chóferes/viajes de ese gestor desde
 * "Asignación de chóferes (F15.3)", igual que hoy con bajas/vacaciones manuales. */
export async function resolverVacacion(vacacionId, aprobar) {
  const empresaId = await getCurrentEmpresaId();
  const gestorId = await gestorIdComoAutor();
  const { error } = await supabase
    .from("vacaciones_gestor")
    .update({ estado: aprobar ? "aprobada" : "rechazada", resuelto_por: gestorId, resuelto_en: new Date().toISOString() })
    .eq("id", vacacionId)
    .eq("empresa_id", empresaId);
  if (error) throw error;
}

/**
 * Fase 25.5 — sugerencia (NUNCA aplicación automática) de a qué gestor activo
 * repartir cada chófer de alguien que se va de vacaciones: al que menos chóferes
 * tenga ya asignados en ese momento (reparto equilibrado), recalculando la carga
 * chófer a chófer para no mandarlos todos al mismo sitio. Mismo flujo manual que ya
 * existe en "Asignación de chóferes" (F15.3) — esto solo pre-rellena la sugerencia,
 * el jefe de tráfico decide chófer por chófer si aplicarla.
 */
export async function sugerirRedistribucionVacacion(gestorId) {
  const empresaId = await getCurrentEmpresaId();
  const [{ data: choferesDelGestor }, { data: gestoresActivos }, { data: todosChoferes }] = await Promise.all([
    supabase.from("chofer").select("id, nombre").eq("empresa_id", empresaId).eq("gestor_id", gestorId),
    supabase.from("gestor").select("id, nombre").eq("empresa_id", empresaId).eq("activo", true).neq("id", gestorId),
    supabase.from("chofer").select("gestor_id").eq("empresa_id", empresaId),
  ]);
  if (!choferesDelGestor?.length || !gestoresActivos?.length) return [];

  const cargaPorGestor = {};
  gestoresActivos.forEach((g) => { cargaPorGestor[g.id] = 0; });
  (todosChoferes || []).forEach((c) => { if (c.gestor_id && c.gestor_id in cargaPorGestor) cargaPorGestor[c.gestor_id]++; });

  return choferesDelGestor.map((c) => {
    const [gestorSugeridoId] = Object.entries(cargaPorGestor).sort((a, b) => a[1] - b[1])[0];
    cargaPorGestor[gestorSugeridoId]++;
    return {
      choferId: c.id,
      choferNombre: c.nombre,
      gestorSugeridoId,
      gestorSugeridoNombre: gestoresActivos.find((g) => g.id === gestorSugeridoId)?.nombre,
    };
  });
}

export async function createCliente({ nombre, cif = null, email = null, telefono = null, notas = null }) {
  if (!nombre || !nombre.trim()) throw new Error("El nombre del cliente es obligatorio");
  const empresaId = await getCurrentEmpresaId();
  const { data, error } = await supabase
    .from("cliente")
    .insert({
      empresa_id: empresaId,
      nombre: nombre.trim(),
      cif: cif?.trim() || null,
      email: email?.trim() || null,
      telefono: telefono?.trim() || null,
      notas: notas?.trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function actualizarCliente(id, campos) {
  const payload = {};
  if (campos.nombre !== undefined) {
    if (!campos.nombre || !campos.nombre.trim()) throw new Error("El nombre del cliente es obligatorio");
    payload.nombre = campos.nombre.trim();
  }
  for (const k of ["cif", "email", "telefono", "notas"]) {
    if (campos[k] !== undefined) payload[k] = campos[k]?.trim() || null;
  }
  // Auditoría de seguridad (2026-07-26): defensa en profundidad, ver nota en resolverSolicitudAprobacion.
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("cliente").update(payload).eq("id", id).eq("empresa_id", empresaId);
  if (error) throw error;
}

/** Baja lógica (activo=false): no borra para no perder el histórico/contexto ligado. */
export async function desactivarCliente(id) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("cliente").update({ activo: false }).eq("id", id).eq("empresa_id", empresaId);
  if (error) throw error;
}

/** Asocia (o desasocia, con clienteId=null) un cliente a un viaje. No toca `referencia`. */
export async function asignarClienteAViaje(viajeId, clienteId) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("viaje").update({ cliente_id: clienteId }).eq("id", viajeId).eq("empresa_id", empresaId);
  if (error) throw error;
}

// ==========================================================================
// Invitaciones multi-gestor (ítem 6.9)
// ==========================================================================

/**
 * Invitaciones pendientes/usadas de la empresa del gestor logueado, con
 * `vencida` calculado en cliente para mostrarlo en la UI (ítem 9.10). El
 * cierre real de una invitación vencida lo hace `usar_invitacion()` en
 * Postgres (migración 0035); esto es solo para no enseñar como "Pendiente"
 * un enlace que ya no funciona.
 */
export async function getInvitaciones() {
  const { data } = await supabase
    .from("invitacion")
    .select("id, email, codigo, usada_at, created_at")
    .order("created_at", { ascending: false });
  const limite = Date.now() - INVITACION_VALIDEZ_DIAS * 24 * 60 * 60 * 1000;
  return (data || []).map((inv) => ({
    ...inv,
    vencida: !inv.usada_at && new Date(inv.created_at).getTime() < limite,
  }));
}

/** Crea una invitación para `email` en la empresa del gestor logueado. */
export async function createInvitacion(email) {
  const empresaId = await getCurrentEmpresaId();
  const { data, error } = await supabase
    .from("invitacion")
    .insert({ empresa_id: empresaId, email: email.trim() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Revoca (borra) una invitación pendiente. */
export async function deleteInvitacion(id) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("invitacion").delete().eq("id", id).eq("empresa_id", empresaId);
  if (error) throw error;
}

// ==========================================================================
// Ajustes de empresa (ítem 9.39) — extraído de ajustes/page.jsx para seguir
// la convención del resto del código: toda escritura pasa por una función
// nombrada y testeada de data.js, nunca un `supabase.from(...).update(...)`
// inline en un componente. Cada función valida y lanza Error con el mismo
// mensaje que antes mostraba `flash()`, para no cambiar el texto visible.
// ==========================================================================

export async function guardarNombreEmpresa(empresaId, nombre) {
  const { error } = await supabase.from("empresa").update({ nombre: nombre.trim() }).eq("id", empresaId);
  if (error) throw error;
}

export async function guardarBaseEmpresa(empresaId, baseLatStr, baseLonStr) {
  const lat = baseLatStr.trim() === "" ? null : Number(baseLatStr);
  const lon = baseLonStr.trim() === "" ? null : Number(baseLonStr);
  if ((lat != null && (Number.isNaN(lat) || lat < -90 || lat > 90)) ||
      (lon != null && (Number.isNaN(lon) || lon < -180 || lon > 180))) {
    throw new Error("coordenadas inválidas");
  }
  // Ambas o ninguna: una base a medias no sirve para el cálculo.
  if ((lat == null) !== (lon == null)) {
    throw new Error("rellena latitud y longitud, o deja ambas vacías");
  }
  const { error } = await supabase.from("empresa").update({ base_lat: lat, base_lon: lon }).eq("id", empresaId);
  if (error) throw error;
}

// ==========================================================================
// Múltiples bases/naves (18.C.3, Fase 18, 2026-07-25) — feedback del usuario:
// "podemos tener múltiples bases, es algo que debe estar contemplado", y un
// chófer no tiene por qué estar fijado a una base concreta (puede
// desplazarse entre ellas). `empresa.base_lat/base_lon` (0013) queda
// deprecado como fuente de verdad -- se migró a `base_empresa` (0061); las
// columnas viejas se dejan sin usar en vez de borrarlas (no destructivo).
// Gestión restringida a admin a nivel de UI (misma sección ya envuelta en
// RequireRol, 18.A.3b) -- no hace falta trigger nuevo en BD.
// ==========================================================================

export async function getBasesEmpresa() {
  const { data } = await supabase.from("base_empresa").select("id, nombre, lat, lon").order("nombre");
  return data || [];
}

export async function crearBaseEmpresa({ nombre, lat, lon }) {
  if (!nombre || !nombre.trim()) throw new Error("ponle un nombre a la base (ej. \"Nave Madrid\")");
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (Number.isNaN(latNum) || latNum < -90 || latNum > 90 || Number.isNaN(lonNum) || lonNum < -180 || lonNum > 180) {
    throw new Error("coordenadas inválidas");
  }
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("base_empresa").insert({ empresa_id: empresaId, nombre: nombre.trim(), lat: latNum, lon: lonNum });
  if (error) throw error;
}

export async function eliminarBaseEmpresa(baseId) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("base_empresa").delete().eq("id", baseId).eq("empresa_id", empresaId);
  if (error) throw error;
}

export async function guardarCosteKmEmpresa(empresaId, costeKmStr) {
  const coste = costeKmStr.trim() === "" ? null : Number(costeKmStr);
  if (coste != null && (Number.isNaN(coste) || coste < 0)) {
    throw new Error("el coste por km debe ser un número positivo");
  }
  const { error } = await supabase.from("empresa").update({ coste_km: coste }).eq("id", empresaId);
  if (error) throw error;
}

export async function guardarMargenObjetivoEmpresa(empresaId, margenStr) {
  const margen = margenStr.trim() === "" ? null : Number(margenStr);
  if (margen != null && (Number.isNaN(margen) || margen < 0 || margen >= 100)) {
    throw new Error("el margen objetivo debe ser un porcentaje entre 0 y 100 (sin llegar a 100)");
  }
  const { error } = await supabase.from("empresa").update({ margen_objetivo_pct: margen }).eq("id", empresaId);
  if (error) throw error;
}

/**
 * ROADMAP 20.6: valor máximo cubierto por el seguro de mercancía (CMR) de la
 * empresa. Nullable -- sin configurar, no se avisa de nada (mismo criterio
 * que margen_objetivo_pct).
 */
export async function guardarValorAseguradoMaximoEmpresa(empresaId, valorStr) {
  const valor = valorStr.trim() === "" ? null : Number(valorStr);
  if (valor != null && (Number.isNaN(valor) || valor < 0)) {
    throw new Error("el valor asegurado debe ser un número positivo");
  }
  const { error } = await supabase.from("empresa").update({ valor_asegurado_maximo_eur: valor }).eq("id", empresaId);
  if (error) throw error;
}

/**
 * ROADMAP 20.6: aviso cuando el valor de mercancía de un viaje supera el
 * máximo cubierto por el seguro de la empresa. Pura -- null si falta
 * cualquiera de los dos datos (nada configurado/declarado todavía).
 */
export function calcularAvisoSeguroCarga(valorMercanciaEur, valorAseguradoMaximoEur) {
  if (valorMercanciaEur == null || valorAseguradoMaximoEur == null) return null;
  if (valorMercanciaEur <= valorAseguradoMaximoEur) return null;
  return {
    valorMercanciaEur,
    valorAseguradoMaximoEur,
    excesoEur: Math.round((valorMercanciaEur - valorAseguradoMaximoEur) * 100) / 100,
  };
}

// Auditoría de seguridad (2026-07-26): el bot ya valida tamaño + magic bytes
// antes de subir una foto de POD (_foto_pod_valida, backend/app/bot.py:178),
// pero las subidas del dashboard (gastos/documentos) confiaban en el
// `file.type` que reporta el propio navegador -- fácil de falsear (un HTML/SVG
// con extensión .jpg tiene `file.type` de imagen si el navegador así lo cree).
// Mismo criterio que el bot: tamaño máximo + magic bytes reales, ANTES de
// subir a Storage. Límite de tamaño alineado con POD_MAX_BYTES del bot (10MB).
export const ARCHIVO_MAX_BYTES = 10 * 1024 * 1024;

const MAGIC_BYTES = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
  pdf: [0x25, 0x50, 0x44, 0x46], // "%PDF"
};

/**
 * Valida un archivo por tamaño + magic bytes reales (no por `file.type`,
 * que el navegador puede reportar mal o un atacante puede falsear). `tipos`
 * es un subconjunto de las claves de MAGIC_BYTES a aceptar.
 * @param {ArrayBuffer} buffer
 * @param {string[]} tipos
 */
export function validarArchivoSubida(buffer, tipos = ["jpeg", "png", "pdf"]) {
  if (!buffer || buffer.byteLength === 0) return { valido: false, error: "Archivo vacío." };
  if (buffer.byteLength > ARCHIVO_MAX_BYTES) {
    return { valido: false, error: `El archivo supera el máximo de ${ARCHIVO_MAX_BYTES / 1024 / 1024} MB.` };
  }
  const inicio = new Uint8Array(buffer.slice(0, 8));
  const coincide = tipos.some((t) => {
    const magic = MAGIC_BYTES[t];
    return magic && magic.every((b, i) => inicio[i] === b);
  });
  if (!coincide) {
    return { valido: false, error: "El contenido del archivo no coincide con un tipo permitido (imagen o PDF)." };
  }
  return { valido: true, error: null };
}

/**
 * `empresa.requiere_pod` existía en el esquema desde el Milestone 3
 * (migración 0002) pero nunca se conectó a ninguna pantalla ni al bot —
 * hasta hoy TODAS las empresas pedían foto de albarán siempre, sin
 * excepción, aunque la casilla para desactivarlo ya estaba en la BD.
 */
export async function guardarRequierePodEmpresa(empresaId, requierePod) {
  const { error } = await supabase.from("empresa").update({ requiere_pod: !!requierePod }).eq("id", empresaId);
  if (error) throw error;
}

export async function guardarObjetivoPuntualidadEmpresa(empresaId, objetivoStr) {
  const objetivo = objetivoStr.trim() === "" ? null : Number(objetivoStr);
  if (objetivo != null && (Number.isNaN(objetivo) || objetivo < 0 || objetivo > 100)) {
    throw new Error("el objetivo de puntualidad debe ser un porcentaje entre 0 y 100");
  }
  const { error } = await supabase.from("empresa").update({ objetivo_puntualidad_pct: objetivo }).eq("id", empresaId);
  if (error) throw error;
}

export async function guardarVelocidadEmpresa(empresaId, velocidadStr) {
  const velocidad = velocidadStr.trim() === "" ? null : Number(velocidadStr);
  if (velocidad != null && (Number.isNaN(velocidad) || velocidad <= 0)) {
    throw new Error("la velocidad debe ser un número mayor que 0");
  }
  const { error } = await supabase.from("empresa").update({ velocidad_planificacion_kmh: velocidad }).eq("id", empresaId);
  if (error) throw error;
}

/** `campos` es un objeto con las 4 claves de columna (precio_gasoil_litro,
 * coste_peaje_km, dieta_noche_eur, coste_conductor_km) -> string sin parsear
 * (tal como viene del input). Valida todas antes de escribir ninguna. */
export async function guardarDesgloseCosteEmpresa(empresaId, campos) {
  const valores = {};
  for (const [campo, valorStr] of Object.entries(campos)) {
    const v = valorStr.trim() === "" ? null : Number(valorStr);
    if (v != null && (Number.isNaN(v) || v < 0)) {
      throw new Error("los valores deben ser números positivos");
    }
    valores[campo] = v;
  }
  const { error } = await supabase.from("empresa").update(valores).eq("id", empresaId);
  if (error) throw error;
}

/** 18.B.3 — precio medio nacional de Gasóleo A (índice público del
 * Ministerio, actualizado por backend/db/actualizar_precio_gasoil.py), solo
 * como REFERENCIA para rellenar/arrancar una cotización. Nunca se aplica
 * solo -- devuelve null si el script todavía no se ha ejecutado nunca. */
export async function getIndiceGasoilNacional() {
  const { data, error } = await supabase
    .from("indice_gasoil_nacional")
    .select("precio_medio_eur, actualizado_en")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * COT.3 — capacidad de carga del vehículo (LDM/kg/m³, migración 0050). Las
 * tres son opcionales e independientes (el cliente rellena la que le importe).
 * `campos` = { ldm, kg, m3 } en string sin parsear (tal como viene del input).
 * Valida las tres antes de escribir ninguna, mismo patrón que
 * guardarDesgloseCosteEmpresa.
 */
export async function guardarCapacidadVehiculo(vehiculoId, campos) {
  const mapaColumna = { ldm: "capacidad_ldm", kg: "capacidad_kg", m3: "capacidad_m3" };
  const valores = {};
  for (const [campo, valorStr] of Object.entries(campos)) {
    const v = (valorStr ?? "").toString().trim() === "" ? null : Number(valorStr);
    if (v != null && (Number.isNaN(v) || v < 0)) {
      throw new Error("la capacidad debe ser un número positivo");
    }
    valores[mapaColumna[campo] || campo] = v;
  }
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("vehiculo").update(valores).eq("id", vehiculoId).eq("empresa_id", empresaId);
  if (error) throw error;
}

const SUBTIPOS_REMOLQUE = ["lona", "caja_cerrada", "frigorifico", "cisterna", "portacontenedor"];

/**
 * Subtipo físico de un remolque (lona/caja cerrada/frigorífico/cisterna/
 * portacontenedor) + rango de temperatura real si es frigorífico. Pedido por
 * el usuario (2026-07-30): el cliente pide un tipo de remolque concreto por
 * viaje (mercancía sensible = caja cerrada, frigo = rango de temperatura) —
 * este es el dato del VEHÍCULO real, distinto del que pide el viaje
 * (`viaje.remolque_requerido`, ver `guardarRequisitosRemolqueViaje`).
 */
export async function guardarSubtipoVehiculo(vehiculoId, { subtipo, temperaturaMin, temperaturaMax }) {
  if (subtipo && !SUBTIPOS_REMOLQUE.includes(subtipo)) throw new Error("subtipo de remolque no válido");
  const tMin = (temperaturaMin ?? "").toString().trim() === "" ? null : Number(temperaturaMin);
  const tMax = (temperaturaMax ?? "").toString().trim() === "" ? null : Number(temperaturaMax);
  if (tMin != null && Number.isNaN(tMin)) throw new Error("temperatura mínima no válida");
  if (tMax != null && Number.isNaN(tMax)) throw new Error("temperatura máxima no válida");
  if (tMin != null && tMax != null && tMin > tMax) throw new Error("la temperatura mínima no puede ser mayor que la máxima");
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase
    .from("vehiculo")
    .update({ subtipo: subtipo || null, temperatura_min: tMin, temperatura_max: tMax })
    .eq("id", vehiculoId)
    .eq("empresa_id", empresaId);
  if (error) throw error;
}

/** Requisito de remolque que pidió el CLIENTE para un viaje concreto —
 * separado del remolque real asignado a propósito (puede no cumplirlo, y
 * detectarlo es un ítem futuro, no este). */
export async function guardarRequisitosRemolqueViaje(viajeId, { remolqueRequerido, temperaturaMin, temperaturaMax }) {
  if (remolqueRequerido && !SUBTIPOS_REMOLQUE.includes(remolqueRequerido)) throw new Error("tipo de remolque no válido");
  const tMin = (temperaturaMin ?? "").toString().trim() === "" ? null : Number(temperaturaMin);
  const tMax = (temperaturaMax ?? "").toString().trim() === "" ? null : Number(temperaturaMax);
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase
    .from("viaje")
    .update({ remolque_requerido: remolqueRequerido || null, temperatura_requerida_min: tMin, temperatura_requerida_max: tMax })
    .eq("id", viajeId)
    .eq("empresa_id", empresaId);
  if (error) throw error;
}

/** empleado/autónomo (migración 0079) — "podemos subcontratar autónomos como
 * chóferes" (2026-07-30). Solo el dato por ahora, sin lógica de
 * nómina/facturación distinta todavía (un autónomo factura él, no entra en
 * 23.B). */
export async function guardarTipoColaboracionChofer(choferId, tipo) {
  if (!["empleado", "autonomo"].includes(tipo)) throw new Error("tipo de colaboración no válido");
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("chofer").update({ tipo_colaboracion: tipo }).eq("id", choferId).eq("empresa_id", empresaId);
  if (error) throw error;
}

// ==========================================================================
// Roles de gestor + expulsión (ítem 9.29 — ver SPECS-9-ROLES.md)
// ==========================================================================

/**
 * Gestores de la empresa del gestor logueado (RLS ya limita a la empresa,
 * `gestor_select_empresa` de 0009). Ordenados por nombre en JS: `.order()`
 * es NO-OP en el mock usado por los tests (0.3 de SPECS-7A).
 */
export async function getGestoresEmpresa() {
  const { data } = await supabase
    .from("gestor")
    .select("id, nombre, email, rol, roles, activo, auth_user_id");
  return (data || []).slice().sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
}

/**
 * Cambia el rol de un gestor de la empresa. Solo admin puede escribirlo
 * (GRANT UPDATE (rol,activo) + policy gestor_update_admin de 0032); la propia
 * policy rechaza si el llamante intenta editar su propia fila.
 * DEPRECATED tras 23.F.2 -- se mantiene solo mientras produccion no tenga la
 * migracion 0075: escribe `rol` (singular), y el trigger `trg_sync_roles_desde_rol`
 * de esa migracion sincroniza `roles` automaticamente. Usar `actualizarRolesGestor`
 * en cuanto 0075 este en produccion.
 */
export async function actualizarRolGestor(gestorId, nuevoRol) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("gestor").update({ rol: nuevoRol }).eq("id", gestorId).eq("empresa_id", empresaId);
  if (error) throw error;
}

/**
 * Fase 23, 23.F.2 -- roles combinables (migración 0075): escribe el array
 * `roles` directamente, sin tocar `rol`. Requiere que `roles` sea NO VACÍO --
 * la UI debe impedir deseleccionar el último rol (un gestor sin roles no vería
 * nada ni podría hacer nada, un estado sin sentido de negocio).
 */
export async function actualizarRolesGestor(gestorId, nuevosRoles) {
  if (!nuevosRoles || nuevosRoles.length === 0) {
    throw new Error("Un gestor debe tener al menos un rol");
  }
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("gestor").update({ roles: nuevosRoles }).eq("id", gestorId).eq("empresa_id", empresaId);
  if (error) throw error;
}

/** Desactiva (expulsa) a un gestor de la empresa. NO borra: solo activo=false. */
export async function desactivarGestor(gestorId) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("gestor").update({ activo: false }).eq("id", gestorId).eq("empresa_id", empresaId);
  if (error) throw error;
}

/** Reactiva a un gestor previamente desactivado. */
export async function reactivarGestor(gestorId) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("gestor").update({ activo: true }).eq("id", gestorId).eq("empresa_id", empresaId);
  if (error) throw error;
}

/**
 * F15.3: chóferes con su `gestor_id` (para la pantalla de asignación de
 * equipo, Ajustes → Equipo, admin-only). Distinto de `getChoferes()` (que no
 * expone `gestor_id`, usado en flujos que no lo necesitan) para no arrastrar
 * un campo nuevo a callers que no lo esperan.
 */
export async function getChoferesConGestor() {
  const { data } = await supabase
    .from("chofer")
    .select("id, nombre, gestor_id")
    .order("nombre");
  return data || [];
}

/**
 * F15.3: asigna (o desasigna con `gestorId = null`) un chófer a un gestor.
 * Solo `admin` puede escribir `gestor_id` (GRANT de columna + trigger
 * `gestor_id_solo_admin`, F15.2b) — un no-admin recibe el error de Postgres
 * tal cual, no se intenta adivinar el mensaje aquí.
 */
export async function guardarGestorChofer(choferId, gestorId) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("chofer").update({ gestor_id: gestorId || null }).eq("id", choferId).eq("empresa_id", empresaId);
  if (error) throw error;
}

/**
 * 18.C.1 (Fase 18, "pool de viajes", 2026-07-24) — el flujo real que describió
 * el usuario tras hablarlo con un gestor de tráfico de verdad: comercial/admin
 * crea el viaje SIN adjudicarlo a nadie (queda en el "pool", gestor_id NULL,
 * visible para todo el equipo por la RLS de F15.2); el jefe de tráfico decide
 * qué gestor lleva cada viaje; ese gestor decide después qué chófer concreto
 * lo hace. El backend de esto (columna, RLS, trigger admin-only) ya existía
 * desde F15.1/F15.2/F15.2b para atribución — solo faltaba la pantalla.
 *
 * Solo viajes no completados/cancelados: una vez cerrado un viaje, quién lo
 * llevó es historia, no algo que reasignar desde esta pantalla de reparto.
 */
export async function getViajesConGestor() {
  const { data } = await supabase
    .from("viaje")
    .select("id, referencia, estado, gestor_id, cliente:cliente_id(nombre)")
    .in("estado", ["planificado", "en_curso"])
    .order("created_at", { ascending: false });
  return data || [];
}

/** Asigna (o desasigna con `gestorId = null`) un viaje a un gestor — mismo
 * criterio y mismas protecciones (solo admin) que `guardarGestorChofer`. */
export async function guardarGestorViaje(viajeId, gestorId) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("viaje").update({ gestor_id: gestorId || null }).eq("id", viajeId).eq("empresa_id", empresaId);
  if (error) throw error;
}

/**
 * 17.G.10 (2026-07-23) — el dashboard SOLO inserta la fila (dirección
 * "gestor_a_chofer"); la entrega real por Telegram la hace el job
 * `procesar_mensajes_gestor` del bot (tick de 30s, mismo patrón ya probado
 * que `notificado_asignacion_en` para avisos de asignación de viaje). Así el
 * dashboard no depende de la disponibilidad del bot para guardar el mensaje.
 */
export async function enviarMensajeChofer({ viajeId = null, choferId, texto }) {
  if (!texto || !texto.trim()) throw new Error("El mensaje no puede estar vacío");
  const empresaId = await getCurrentEmpresaId();
  const gestor = await getCurrentGestor();
  const { error } = await supabase.from("mensaje_chofer").insert({
    empresa_id: empresaId,
    viaje_id: viajeId,
    chofer_id: choferId,
    gestor_id: gestor?.id || null,
    direccion: "gestor_a_chofer",
    texto: texto.trim(),
  });
  if (error) throw error;
}

/** Historial de mensajes (ambas direcciones) de un viaje, más reciente primero. */
export async function getMensajesChofer(viajeId) {
  const { data } = await supabase
    .from("mensaje_chofer")
    .select("id, direccion, texto, entregado_en, created_at")
    .eq("viaje_id", viajeId)
    .order("created_at", { ascending: false });
  return data || [];
}

/**
 * Historial COMPLETO de un chófer (todas sus conversaciones, tenga o no viaje
 * activo en cada momento) — feedback real: colgar los mensajes solo del viaje
 * significaba que un mensaje sin viaje (o de un viaje distinto al que estás
 * mirando) se perdía de vista. Esta es la vista de referencia: la persona con
 * la que hablas es el chófer, no un viaje concreto.
 */
export async function getMensajesPorChofer(choferId) {
  const { data } = await supabase
    .from("mensaje_chofer")
    .select("id, viaje_id, direccion, texto, entregado_en, created_at, viaje:viaje_id(referencia)")
    .eq("chofer_id", choferId)
    .order("created_at", { ascending: true });
  return data || [];
}

/**
 * Documentos con fecha de caducidad ya pasada o dentro de los próximos 30
 * días, ordenados por urgencia (los más próximos/caducados primero). Junta
 * la etiqueta y el enlace de la entidad (viaje/vehículo/chófer) a la que
 * pertenece cada documento, ya que "documento" no tiene FK directa a una
 * tabla concreta (el ámbito determina a cuál).
 */
export async function getDocumentosPorCaducar() {
  const limite = new Date();
  limite.setDate(limite.getDate() + 30);
  const limiteStr = limite.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("documento")
    .select("*")
    .not("fecha_caducidad", "is", null)
    .lte("fecha_caducidad", limiteStr);
  const rows = [...(data || [])];
  rows.sort((a, b) => a.fecha_caducidad.localeCompare(b.fecha_caducidad));

  const idsPorAmbito = { viaje: [], vehiculo: [], chofer: [] };
  rows.forEach((d) => { idsPorAmbito[d.ambito]?.push(d.entidad_id); });

  const [viajesR, vehiculosR, choferesR] = await Promise.all([
    idsPorAmbito.viaje.length ? supabase.from("viaje").select("id, referencia").in("id", idsPorAmbito.viaje) : Promise.resolve({ data: [] }),
    idsPorAmbito.vehiculo.length ? supabase.from("vehiculo").select("id, matricula").in("id", idsPorAmbito.vehiculo) : Promise.resolve({ data: [] }),
    idsPorAmbito.chofer.length ? supabase.from("chofer").select("id, nombre").in("id", idsPorAmbito.chofer) : Promise.resolve({ data: [] }),
  ]);

  const mapaViaje = Object.fromEntries((viajesR.data || []).map((v) => [v.id, v.referencia || v.id.slice(0, 8)]));
  const mapaVehiculo = Object.fromEntries((vehiculosR.data || []).map((v) => [v.id, v.matricula]));
  const mapaChofer = Object.fromEntries((choferesR.data || []).map((c) => [c.id, c.nombre]));

  return rows.map((d) => {
    const mapa = d.ambito === "viaje" ? mapaViaje : d.ambito === "vehiculo" ? mapaVehiculo : mapaChofer;
    const base = d.ambito === "viaje" ? "/viajes" : d.ambito === "vehiculo" ? "/vehiculos" : "/choferes";
    return {
      ...d,
      entidadEtiqueta: mapa[d.entidad_id] || "—",
      href: `${base}/${d.entidad_id}`,
    };
  });
}

/**
 * F14.1: cruza ITV pendiente de un vehículo contra los viajes que ya tiene
 * asignados -- `/documentos` ya avisa de la caducidad en sí, pero no de que
 * choque con la operación (un vehículo con ITV el día 20 con un viaje
 * asignado que termina el día 22). Solo evalúa viajes con `ventana_fin` en su
 * último hito (por `orden`); sin esa fecha no se puede comparar, se omite
 * -- mejor "sin dato" que un falso positivo.
 */
export async function getConflictosMantenimientoViaje() {
  const { data: pendientes } = await supabase
    .from("mantenimiento_vehiculo")
    .select("id, vehiculo_id, tipo, fecha")
    .eq("tipo", "itv")
    .eq("estado", "pendiente")
    .not("fecha", "is", null);

  const idsVehiculo = [...new Set((pendientes || []).map((m) => m.vehiculo_id))];
  if (idsVehiculo.length === 0) return [];

  const [{ data: vehiculos }, { data: viajes }] = await Promise.all([
    supabase.from("vehiculo").select("id, matricula").in("id", idsVehiculo),
    supabase.from("viaje").select("id, referencia, vehiculo_id").in("vehiculo_id", idsVehiculo).in("estado", ["planificado", "en_curso"]),
  ]);

  const idsViaje = (viajes || []).map((v) => v.id);
  const { data: hitos } = idsViaje.length
    ? await supabase.from("hito").select("viaje_id, orden, ventana_fin").in("viaje_id", idsViaje)
    : { data: [] };

  const finPorViaje = {};
  (hitos || []).forEach((h) => {
    if (!h.ventana_fin) return;
    const actual = finPorViaje[h.viaje_id];
    if (!actual || h.orden > actual.orden) finPorViaje[h.viaje_id] = { orden: h.orden, ventana_fin: h.ventana_fin };
  });

  const mapaVehiculo = Object.fromEntries((vehiculos || []).map((v) => [v.id, v.matricula]));
  const viajesPorVehiculo = {};
  (viajes || []).forEach((v) => {
    (viajesPorVehiculo[v.vehiculo_id] ||= []).push(v);
  });

  const conflictos = [];
  (pendientes || []).forEach((m) => {
    (viajesPorVehiculo[m.vehiculo_id] || []).forEach((v) => {
      const fin = finPorViaje[v.id];
      if (!fin) return; // sin ventana_fin en el viaje, no se puede evaluar
      if (fin.ventana_fin > m.fecha) {
        conflictos.push({
          vehiculoId: m.vehiculo_id,
          matricula: mapaVehiculo[m.vehiculo_id] || m.vehiculo_id,
          fechaVencimiento: m.fecha,
          viajeId: v.id,
          referencia: v.referencia || v.id.slice(0, 8),
          fechaFinViaje: fin.ventana_fin,
        });
      }
    });
  });

  return conflictos.sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
}

/** Semana ISO (YYYY-Www) de una fecha, para agrupar tendencias por semana. */
function semanaISO(fechaStr) {
  const d = new Date(fechaStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const inicioAno = new Date(d.getFullYear(), 0, 4);
  const semana = 1 + Math.round(((d - inicioAno) / 86400000 - 3 + ((inicioAno.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(semana).padStart(2, "0")}`;
}

// Rango por defecto para las agregaciones de /analitica (ítem 6.4): antes se
// cargaban las tablas enteras y se filtraba en cliente; ahora el rango se
// aplica en la query (.gte/.lt), server-side. 90 días es un valor por defecto
// razonable para un panel de "actividad reciente", no una cifra pactada.
const RANGO_METRICAS_DIAS_DEFAULT = 90;

function resolveRango({ desde, hasta } = {}) {
  const hastaFinal = hasta || new Date().toISOString();
  const desdeFinal = desde || new Date(Date.now() - RANGO_METRICAS_DIAS_DEFAULT * 86400000).toISOString();
  return { desde: desdeFinal, hasta: hastaFinal };
}

/**
 * Vista 1/4 de /analitica: puntualidad. Usa las incidencias tipo
 * "fuera_de_ventana" (creadas por el bot al confirmar llegada tarde) como
 * señal de "hito no puntual", frente al total de hitos con ventana definida.
 * `rango.desde`/`rango.hasta` (ISO) acotan el periodo; por defecto últimos 90
 * días, aplicado en servidor.
 */
export async function getMetricasPuntualidad(rango = {}) {
  const { desde, hasta } = resolveRango(rango);
  // Fase 19.6 (2026-07-25, ver ROADMAP: "la analítica calcula en el
  // navegador" -- primer paso real, no el rediseño completo). `totalConVentana`
  // solo necesita un NÚMERO, nunca las filas -- antes se traían todas para
  // contarlas en JS, sujeto al corte silencioso de 1000 de PostgREST (con
  // fleet grande, un solo periodo de 90 días ya puede superarlo). `count:
  // "exact", head: true` calcula el total en el servidor vía Content-Range,
  // sin transferir ni una fila y sin ese límite.
  const [{ count: totalConVentanaCount }, { data: tarde }, { data: empresas, error: errEmpresa }] = await Promise.all([
    supabase.from("hito").select("id", { count: "exact", head: true }).gte("ventana_fin", desde).lt("ventana_fin", hasta).not("ventana_fin", "is", null),
    supabase.from("incidencia").select("id, viaje_id, created_at").eq("tipo", "fuera_de_ventana").gte("created_at", desde).lt("created_at", hasta),
    supabase.from("empresa").select("objetivo_puntualidad_pct").limit(1),
  ]);
  if (errEmpresa) throw new Error(errEmpresa.message);

  // Fase 19.4 (2026-07-25, ver ROADMAP): antes se pedía `viaje` ENTERO (toda
  // la empresa, sin límite) solo para resolver la referencia de los viajes
  // con incidencia -- con >1000 viajes históricos, PostgREST lo cortaba en
  // silencio y "peores rutas" podía referenciar viajes que ni estaban en el
  // lote. Ahora solo se piden los viajes que de verdad aparecen en `tarde`
  // (siempre un conjunto pequeño: incidencias del periodo, no el histórico).
  const idsViajesTarde = [...new Set((tarde || []).map((i) => i.viaje_id))];
  const { data: viajes } = idsViajesTarde.length
    ? await supabase.from("viaje").select("id, referencia").in("id", idsViajesTarde)
    : { data: [] };

  const totalConVentana = totalConVentanaCount || 0;
  const totalTarde = (tarde || []).length;
  const pctPuntualidad = totalConVentana > 0
    ? Math.round(((totalConVentana - totalTarde) / totalConVentana) * 100)
    : null;
  const objetivoPuntualidadPct = empresas?.[0]?.objetivo_puntualidad_pct != null
    ? Number(empresas[0].objetivo_puntualidad_pct)
    : null;

  const mapaViaje = Object.fromEntries((viajes || []).map((v) => [v.id, v.referencia || v.id.slice(0, 8)]));
  const porRuta = {};
  (tarde || []).forEach((i) => {
    const ref = mapaViaje[i.viaje_id] || i.viaje_id;
    porRuta[ref] = (porRuta[ref] || 0) + 1;
  });
  const peoresRutas = Object.entries(porRuta)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([referencia, incidencias]) => ({ referencia, incidencias }));

  const porSemana = {};
  (tarde || []).forEach((i) => {
    const semana = semanaISO(i.created_at);
    porSemana[semana] = (porSemana[semana] || 0) + 1;
  });
  const tendencia = Object.entries(porSemana)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([semana, count]) => ({ semana, count }));

  return { pctPuntualidad, totalConVentana, totalTarde, peoresRutas, tendencia, objetivoPuntualidadPct };
}

/**
 * Vista "Gestores" de /analitica (12.5, petición del usuario) — rendimiento
 * por gestor para que el jefe de tráfico/oficina compare: cuántos viajes
 * gestiona cada uno, si sigue las sugerencias del sistema de asignación
 * (decision_asignacion, 7A.2) e incidencias totales de sus viajes. Solo
 * tiene sentido con más de un gestor con viajes asignados; con uno solo, la
 * tabla de comparación no aporta nada (se sigue devolviendo, la UI decide
 * si mostrarla).
 */
export async function getRendimientoGestores(rango = {}) {
  const { desde, hasta } = resolveRango(rango);
  const [
    { data: gestores, error: errGestores },
    { data: viajes, error: errViajes },
    { data: decisiones, error: errDecisiones },
    { data: incidencias, error: errIncidencias },
    // Fase 23, 23.G.2: hitos con ventana vencida en el periodo -- denominador de
    // puntualidad por gestor. Se acota por `ventana_fin` (no por `created_at` del
    // viaje, como las consultas de arriba) porque un hito puede vencer mucho
    // después de crearse el viaje que lo contiene.
    { data: hitosVentana, error: errHitos },
  ] = await Promise.all([
    supabase.from("gestor").select("id, nombre").eq("activo", true),
    supabase.from("viaje").select("id, gestor_id").gte("created_at", desde).lt("created_at", hasta),
    supabase.from("decision_asignacion").select("viaje_id, siguio_sugerencia").gte("created_at", desde).lt("created_at", hasta),
    supabase.from("incidencia").select("viaje_id, tipo, created_at, resuelta_en").gte("created_at", desde).lt("created_at", hasta),
    supabase.from("hito").select("id, viaje_id").gte("ventana_fin", desde).lt("ventana_fin", hasta).not("ventana_fin", "is", null),
  ]);
  if (errGestores) throw new Error(errGestores.message);
  if (errViajes) throw new Error(errViajes.message);
  if (errDecisiones) throw new Error(errDecisiones.message);
  if (errIncidencias) throw new Error(errIncidencias.message);
  if (errHitos) throw new Error(errHitos.message);

  // gestor_id de cada viaje referenciado por hitos/incidencias que no apareciera
  // ya en `viajes` (un hito puede vencer -- o una incidencia abrirse -- sobre un
  // viaje creado ANTES del rango). Mismo patrón "solo pedir lo referenciado" que
  // getMetricasPuntualidad (Fase 19.4): nunca traer la empresa entera.
  const gestorPorViajeConocido = Object.fromEntries((viajes || []).map((v) => [v.id, v.gestor_id]));
  const idsFaltantes = [...new Set(
    [...(hitosVentana || []).map((h) => h.viaje_id), ...(incidencias || []).map((i) => i.viaje_id)]
      .filter((vid) => !(vid in gestorPorViajeConocido))
  )];
  const { data: viajesFaltantes } = idsFaltantes.length
    ? await supabase.from("viaje").select("id, gestor_id").in("id", idsFaltantes)
    : { data: [] };
  const gestorPorViaje = { ...gestorPorViajeConocido, ...Object.fromEntries((viajesFaltantes || []).map((v) => [v.id, v.gestor_id])) };

  const viajesDeGestor = {};
  (viajes || []).forEach((v) => {
    if (!v.gestor_id) return;
    (viajesDeGestor[v.gestor_id] ||= new Set()).add(v.id);
  });

  const incidenciasPorViaje = {};
  (incidencias || []).forEach((i) => {
    incidenciasPorViaje[i.viaje_id] = (incidenciasPorViaje[i.viaje_id] || 0) + 1;
  });

  const decisionesPorViaje = {};
  (decisiones || []).forEach((d) => {
    (decisionesPorViaje[d.viaje_id] ||= []).push(d.siguio_sugerencia);
  });

  // 23.G.2: puntualidad e incidencias gestionadas, por gestor -- vía el
  // gestor_id del viaje al que pertenece el hito/incidencia (mismo criterio de
  // "de quién es" que el resto de este panel).
  const hitosPorGestor = {};
  (hitosVentana || []).forEach((h) => {
    const gid = gestorPorViaje[h.viaje_id];
    if (gid) hitosPorGestor[gid] = (hitosPorGestor[gid] || 0) + 1;
  });
  const tardePorGestor = {};
  const resolucionPorGestor = {};
  (incidencias || []).forEach((i) => {
    const gid = gestorPorViaje[i.viaje_id];
    if (!gid) return;
    if (i.tipo === "fuera_de_ventana") tardePorGestor[gid] = (tardePorGestor[gid] || 0) + 1;
    if (i.resuelta_en) (resolucionPorGestor[gid] ||= []).push((new Date(i.resuelta_en) - new Date(i.created_at)) / 60000);
  });

  return (gestores || [])
    .map((g) => {
      const idsViajes = viajesDeGestor[g.id] || new Set();
      const viajesGestionados = idsViajes.size;

      let totalDecisiones = 0, siguio = 0;
      idsViajes.forEach((vid) => {
        (decisionesPorViaje[vid] || []).forEach((s) => {
          totalDecisiones++;
          if (s) siguio++;
        });
      });
      const pctSiguioSugerencia = totalDecisiones > 0 ? Math.round((siguio / totalDecisiones) * 100) : null;

      let incidenciasTotal = 0;
      idsViajes.forEach((vid) => { incidenciasTotal += incidenciasPorViaje[vid] || 0; });

      const hitosConVentana = hitosPorGestor[g.id] || 0;
      const hitosTarde = tardePorGestor[g.id] || 0;
      const pctPuntualidad = hitosConVentana > 0
        ? Math.round(((hitosConVentana - hitosTarde) / hitosConVentana) * 100)
        : null;
      const resoluciones = resolucionPorGestor[g.id] || [];
      const minutosMediosResolucion = resoluciones.length
        ? Math.round(resoluciones.reduce((a, b) => a + b, 0) / resoluciones.length)
        : null;

      return {
        id: g.id, nombre: g.nombre, viajesGestionados, pctSiguioSugerencia, incidencias: incidenciasTotal,
        pctPuntualidad, minutosMediosResolucion,
      };
    })
    .sort((a, b) => b.viajesGestionados - a.viajesGestionados);
}

/**
 * Vista 2/4 de /analitica: incidencias totales, tasa y desglose. `rango`
 * (últimos 90 días por defecto) acota tanto las incidencias como los viajes
 * (para que la "tasa" compare el mismo periodo en numerador y denominador).
 */
export async function getMetricasIncidencias(rango = {}) {
  const { desde, hasta } = resolveRango(rango);
  const [{ data: incidencias }, { data: viajes }, { data: choferes }, { data: vehiculos }] = await Promise.all([
    supabase.from("incidencia").select("id, viaje_id, tipo").gte("created_at", desde).lt("created_at", hasta),
    supabase.from("viaje").select("id, chofer_id, vehiculo_id").gte("created_at", desde).lt("created_at", hasta),
    supabase.from("chofer").select("id, nombre"),
    supabase.from("vehiculo").select("id, matricula"),
  ]);

  const rows = incidencias || [];
  const total = rows.length;
  const totalViajes = (viajes || []).length;
  const tasa = totalViajes > 0 ? +(total / totalViajes).toFixed(2) : null;

  const mapaViajeChofer = Object.fromEntries((viajes || []).map((v) => [v.id, v.chofer_id]));
  const mapaViajeVehiculo = Object.fromEntries((viajes || []).map((v) => [v.id, v.vehiculo_id]));
  const mapaChofer = Object.fromEntries((choferes || []).map((c) => [c.id, c.nombre]));
  const mapaVehiculo = Object.fromEntries((vehiculos || []).map((v) => [v.id, v.matricula]));

  const porTipo = {};
  const porChofer = {};
  const porVehiculo = {};
  rows.forEach((i) => {
    porTipo[i.tipo] = (porTipo[i.tipo] || 0) + 1;

    const choferId = mapaViajeChofer[i.viaje_id];
    if (choferId) {
      const nombre = mapaChofer[choferId] || choferId;
      porChofer[nombre] = (porChofer[nombre] || 0) + 1;
    }
    const vehiculoId = mapaViajeVehiculo[i.viaje_id];
    if (vehiculoId) {
      const matricula = mapaVehiculo[vehiculoId] || vehiculoId;
      porVehiculo[matricula] = (porVehiculo[matricula] || 0) + 1;
    }
  });

  const orden = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

  return {
    total,
    tasa,
    porTipo: orden(porTipo).map(([tipo, count]) => ({ tipo, count })),
    porChofer: orden(porChofer).slice(0, 5).map(([nombre, count]) => ({ nombre, count })),
    porVehiculo: orden(porVehiculo).slice(0, 5).map(([matricula, count]) => ({ matricula, count })),
  };
}

/**
 * Vista 3/4 de /analitica: rendimiento por chófer. `rango` (últimos 90 días
 * por defecto) acota viajes, valoraciones, incidencias y hitos al mismo periodo.
 */
export async function getMetricasChoferes(rango = {}) {
  const { desde, hasta } = resolveRango(rango);
  const [{ data: choferes }, { data: viajes }, { data: valoraciones }, { data: incidencias }, { data: hitos }] =
    await Promise.all([
      // Fase 19.4: única query sin acotar por fecha aquí a propósito (es un
      // catálogo, no crece con la actividad) -- cota defensiva de todos modos
      // (ver ROADMAP Fase 19: PostgREST corta en 1000 filas sin avisar).
      supabase.from("chofer").select("id, nombre").order("id").limit(5000),
      supabase.from("viaje").select("id, chofer_id").gte("created_at", desde).lt("created_at", hasta),
      supabase.from("valoracion").select("chofer_id, puntuacion").gte("created_at", desde).lt("created_at", hasta),
      supabase.from("incidencia").select("viaje_id, tipo").gte("created_at", desde).lt("created_at", hasta),
      supabase.from("hito").select("viaje_id, ventana_fin").gte("ventana_fin", desde).lt("ventana_fin", hasta),
    ]);

  const mapaViajeChofer = Object.fromEntries((viajes || []).map((v) => [v.id, v.chofer_id]));

  const viajesPorChofer = {};
  (viajes || []).forEach((v) => {
    if (!v.chofer_id) return;
    viajesPorChofer[v.chofer_id] = (viajesPorChofer[v.chofer_id] || 0) + 1;
  });

  const valoracionesPorChofer = {};
  (valoraciones || []).forEach((val) => {
    (valoracionesPorChofer[val.chofer_id] ||= []).push(val.puntuacion);
  });

  const incidenciasPorChofer = {};
  const tardePorChofer = {};
  (incidencias || []).forEach((i) => {
    const choferId = mapaViajeChofer[i.viaje_id];
    if (!choferId) return;
    incidenciasPorChofer[choferId] = (incidenciasPorChofer[choferId] || 0) + 1;
    if (i.tipo === "fuera_de_ventana") {
      tardePorChofer[choferId] = (tardePorChofer[choferId] || 0) + 1;
    }
  });

  const conVentanaPorChofer = {};
  (hitos || []).forEach((h) => {
    if (!h.ventana_fin) return;
    const choferId = mapaViajeChofer[h.viaje_id];
    if (!choferId) return;
    conVentanaPorChofer[choferId] = (conVentanaPorChofer[choferId] || 0) + 1;
  });

  return (choferes || [])
    .map((c) => {
      const puntuaciones = valoracionesPorChofer[c.id] || [];
      const valoracionMedia = puntuaciones.length
        ? +(puntuaciones.reduce((s, p) => s + p, 0) / puntuaciones.length).toFixed(1)
        : null;
      const totalConVentana = conVentanaPorChofer[c.id] || 0;
      const tarde = tardePorChofer[c.id] || 0;
      const pctPuntualidad = totalConVentana > 0
        ? Math.round(((totalConVentana - tarde) / totalConVentana) * 100)
        : null;
      return {
        id: c.id,
        nombre: c.nombre,
        viajes: viajesPorChofer[c.id] || 0,
        valoracionMedia,
        incidencias: incidenciasPorChofer[c.id] || 0,
        pctPuntualidad,
      };
    })
    .sort((a, b) => b.viajes - a.viajes);
}

/**
 * F13.3: rendimiento/SLA por cliente para que el dueño/gestor vea qué cuentas
 * dan más volumen, cuáles cumplen ventana y cuáles dejan margen — mismo
 * patrón que getRendimientoGestores/getMetricasChoferes (agrega por entidad
 * sobre el rango). Viajes sin cliente_id se agrupan aparte, no se descartan
 * (id null, nombre "Sin cliente").
 */
export async function getMetricasPorCliente(rango = {}) {
  const { desde, hasta } = resolveRango(rango);
  const [{ data: clientes }, { data: viajes }, { data: incidencias }, { data: hitos }] = await Promise.all([
    // Fase 19.4: cota defensiva (ver ROADMAP Fase 19) aunque en la práctica
    // el número de clientes de una empresa rara vez se acerca a 1000.
    supabase.from("cliente").select("id, nombre").eq("activo", true).order("id").limit(5000),
    supabase.from("viaje").select("id, cliente_id, precio").gte("created_at", desde).lt("created_at", hasta),
    supabase.from("incidencia").select("viaje_id, tipo").gte("created_at", desde).lt("created_at", hasta),
    supabase.from("hito").select("viaje_id, ventana_fin").gte("ventana_fin", desde).lt("ventana_fin", hasta),
  ]);

  const mapaViajeCliente = Object.fromEntries((viajes || []).map((v) => [v.id, v.cliente_id || null]));

  const incidenciasPorCliente = {};
  const tardePorCliente = {};
  (incidencias || []).forEach((i) => {
    const clienteId = mapaViajeCliente[i.viaje_id] ?? null;
    incidenciasPorCliente[clienteId] = (incidenciasPorCliente[clienteId] || 0) + 1;
    if (i.tipo === "fuera_de_ventana") {
      tardePorCliente[clienteId] = (tardePorCliente[clienteId] || 0) + 1;
    }
  });

  const conVentanaPorCliente = {};
  (hitos || []).forEach((h) => {
    if (!h.ventana_fin) return;
    const clienteId = mapaViajeCliente[h.viaje_id] ?? null;
    conVentanaPorCliente[clienteId] = (conVentanaPorCliente[clienteId] || 0) + 1;
  });

  const viajesConPrecio = (viajes || []).filter((v) => v.precio != null);
  const pnls = await Promise.all(viajesConPrecio.map((v) => getPnlViaje(v.id)));
  const margenesPorCliente = {};
  viajesConPrecio.forEach((v, idx) => {
    const clienteId = v.cliente_id || null;
    const margenReal = pnls[idx].margenReal;
    if (margenReal == null) return;
    (margenesPorCliente[clienteId] ||= []).push(margenReal);
  });

  const viajesPorCliente = {};
  (viajes || []).forEach((v) => {
    const clienteId = v.cliente_id || null;
    viajesPorCliente[clienteId] = (viajesPorCliente[clienteId] || 0) + 1;
  });

  const grupos = [...(clientes || []).map((c) => ({ id: c.id, nombre: c.nombre }))];
  if (viajesPorCliente[null]) {
    grupos.push({ id: null, nombre: "Sin cliente" });
  }

  return grupos
    .map((g) => {
      const totalConVentana = conVentanaPorCliente[g.id] || 0;
      const tarde = tardePorCliente[g.id] || 0;
      const pctPuntualidad = totalConVentana > 0
        ? Math.round(((totalConVentana - tarde) / totalConVentana) * 100)
        : null;
      const margenes = margenesPorCliente[g.id] || [];
      const margenMedio = margenes.length
        ? Math.round(margenes.reduce((s, m) => s + m, 0) / margenes.length)
        : null;
      return {
        id: g.id,
        nombre: g.nombre,
        viajes: viajesPorCliente[g.id] || 0,
        pctPuntualidad,
        incidencias: incidenciasPorCliente[g.id] || 0,
        margenMedio,
      };
    })
    .filter((g) => g.viajes > 0)
    .sort((a, b) => b.viajes - a.viajes);
}

/**
 * Vista 4/4 de /analitica: estado de la flota. A diferencia de las otras 3
 * vistas, "vehículos activos"/"en uso"/"ITV pendientes" son estado ACTUAL
 * (instantáneo), no una serie histórica — no tiene sentido acotarlos a un
 * rango de fechas (una ITV pendiente sigue pendiente aunque su vencimiento
 * caiga fuera del rango). Solo "averías recientes" es realmente histórico, así
 * que el `rango` (últimos 90 días por defecto) se aplica SOLO ahí, en una
 * query separada de la de ITV para no romper esa distinción.
 */
export async function getMetricasFlota(rango = {}) {
  const { desde, hasta } = resolveRango(rango);
  const [{ data: vehiculos }, { data: viajesActivos }, { data: itvData }, { data: averiaData }] = await Promise.all([
    supabase.from("vehiculo").select("id, matricula, activo"),
    supabase.from("viaje").select("vehiculo_id, remolque_id, estado").eq("estado", "en_curso"),
    supabase.from("mantenimiento_vehiculo").select("id, vehiculo_id, tipo, estado, fecha").eq("tipo", "itv").eq("estado", "pendiente"),
    supabase.from("mantenimiento_vehiculo").select("id, vehiculo_id, tipo, estado, fecha").eq("tipo", "averia").gte("fecha", desde.slice(0, 10)).lt("fecha", hasta.slice(0, 10)),
  ]);

  const vehiculosActivos = (vehiculos || []).filter((v) => v.activo);
  const idsEnUso = new Set();
  (viajesActivos || []).forEach((v) => {
    if (v.vehiculo_id) idsEnUso.add(v.vehiculo_id);
    if (v.remolque_id) idsEnUso.add(v.remolque_id);
  });
  const enUso = vehiculosActivos.filter((v) => idsEnUso.has(v.id)).length;
  const pctUtilizacion = vehiculosActivos.length > 0
    ? Math.round((enUso / vehiculosActivos.length) * 100)
    : null;

  const mapaMatricula = Object.fromEntries((vehiculos || []).map((v) => [v.id, v.matricula]));

  const itvPendientes = (itvData || [])
    .map((m) => ({ ...m, matricula: mapaMatricula[m.vehiculo_id] || m.vehiculo_id }))
    .sort((a, b) => (a.fecha || "9999-99-99").localeCompare(b.fecha || "9999-99-99"));

  const averiasRecientes = (averiaData || [])
    .map((m) => ({ ...m, matricula: mapaMatricula[m.vehiculo_id] || m.vehiculo_id }))
    .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""))
    .slice(0, 5);

  return {
    totalVehiculos: (vehiculos || []).length,
    vehiculosActivos: vehiculosActivos.length,
    enUso,
    pctUtilizacion,
    itvPendientes,
    averiasRecientes,
  };
}

// Factor de corrección aplicado a la distancia en línea recta (Haversine) cuando
// OSRM no responde: una carretera real nunca es una línea recta, así que se
// corrige al alza. 1.3 es un valor de ingeniería de tráfico habitual, NO medido
// contra rutas reales de España — igual de "valor inicial razonable" que los
// demás umbrales del proyecto (ver UMBRAL_NOCHE_FUERA_KM, UMBRAL_MARGEN_AMBAR_PCT).
export const FACTOR_SINUOSIDAD_FALLBACK = 1.3;

/** Distancia en línea recta (Haversine) en km — usada como cálculo principal en
 * algunos casos y como fallback de `kmCarreteraViaje` cuando OSRM no responde. */
function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ==========================================================================
// F13.6: sugerencia de orden de paradas (SUGERENCIA, no dispatch automático —
// override consciente de "no planificamos rutas", decisión del usuario
// 2026-07-15). Pura: usa Haversine × FACTOR_SINUOSIDAD_FALLBACK para puntuar
// permutaciones (mismo criterio que kmAproxViaje) en vez de OSRM, que sería
// una llamada de red por permutación evaluada -- inviable incluso para pocos
// puntos intermedios. Origen y destino final quedan FIJOS; solo se reordenan
// los hitos intermedios, y v1 SOLO si todos son del mismo `tipo` (no rompe
// precedencia recogida→entrega mezclando tipos) -- ver limitación documentada
// en SPECS-FASE13.md, la versión que respeta precedencias mixtas es v2.
// ==========================================================================

const UMBRAL_AHORRO_SUGERENCIA_PCT = 2; // por debajo de esto, no molesta con la sugerencia

function distanciaTotalPuntos(puntos) {
  let km = 0;
  for (let i = 0; i < puntos.length - 1; i++) {
    km += haversineKm(puntos[i], puntos[i + 1]) * FACTOR_SINUOSIDAD_FALLBACK;
  }
  return km;
}

function permutaciones(arr) {
  if (arr.length <= 1) return [arr];
  const resultado = [];
  for (let i = 0; i < arr.length; i++) {
    const resto = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutaciones(resto)) resultado.push([arr[i], ...p]);
  }
  return resultado;
}

function vecinoMasCercanoOrden(origen, intermedios) {
  const restantes = [...intermedios];
  const ruta = [];
  let actual = origen;
  while (restantes.length) {
    let idxMin = 0, dMin = Infinity;
    restantes.forEach((p, idx) => {
      const d = haversineKm(actual, p);
      if (d < dMin) { dMin = d; idxMin = idx; }
    });
    const [siguiente] = restantes.splice(idxMin, 1);
    ruta.push(siguiente);
    actual = siguiente;
  }
  return ruta;
}

// Mejora local 2-opt: para N > 7 intermedios, fuerza bruta (N!) deja de ser
// viable -- nearest-neighbor da un punto de partida razonable y 2-opt lo pule
// invirtiendo tramos mientras siga reduciendo la distancia total.
function dosOpt(origen, rutaInicial, destino) {
  let actual = [...rutaInicial];
  const distanciaRuta = (r) => distanciaTotalPuntos([origen, ...r, destino]);
  let mejorDist = distanciaRuta(actual);
  let mejorada = true;
  while (mejorada) {
    mejorada = false;
    for (let i = 0; i < actual.length - 1; i++) {
      for (let j = i + 1; j < actual.length; j++) {
        const candidato = [...actual.slice(0, i), ...actual.slice(i, j + 1).reverse(), ...actual.slice(j + 1)];
        const d = distanciaRuta(candidato);
        if (d < mejorDist - 1e-9) {
          actual = candidato;
          mejorDist = d;
          mejorada = true;
        }
      }
    }
  }
  return actual;
}

/**
 * Sugiere un reorden de los hitos INTERMEDIOS (origen y destino final fijos)
 * que minimiza km totales estimados. Devuelve `null` si no hay nada que
 * reordenar (menos de 3 hitos con coordenadas, o los intermedios mezclan
 * tipos recogida/entrega -- limitación v1). Si el ahorro no supera
 * `umbralAhorroPct`, devuelve `mereceLaPena: false` sin `ordenSugerido` (no
 * es ruido si el orden actual ya es casi óptimo).
 */
export function sugerirOrdenParadas(hitos, umbralAhorroPct = UMBRAL_AHORRO_SUGERENCIA_PCT) {
  const conCoords = (hitos || [])
    .filter((h) => h.lat != null && h.lon != null)
    .sort((a, b) => a.orden - b.orden);
  if (conCoords.length < 3) return null;

  const origen = conCoords[0];
  const destino = conCoords[conCoords.length - 1];
  const intermedios = conCoords.slice(1, -1);

  const tipos = new Set(intermedios.map((h) => h.tipo));
  if (tipos.size > 1) return null;

  const kmActual = distanciaTotalPuntos([origen, ...intermedios, destino]);

  const ordenSugerido = intermedios.length <= 7
    ? permutaciones(intermedios).reduce(
        (mejor, perm) => (distanciaTotalPuntos([origen, ...perm, destino]) < distanciaTotalPuntos([origen, ...mejor, destino]) ? perm : mejor),
        intermedios
      )
    : dosOpt(origen, vecinoMasCercanoOrden(origen, intermedios), destino);

  const kmSugerido = distanciaTotalPuntos([origen, ...ordenSugerido, destino]);
  const ahorroKm = kmActual - kmSugerido;
  const ahorroPct = kmActual > 0 ? (ahorroKm / kmActual) * 100 : 0;

  if (ahorroPct <= umbralAhorroPct) {
    return { mereceLaPena: false, kmActual: Math.round(kmActual), kmSugerido: Math.round(kmSugerido), ahorroKm: Math.round(ahorroKm) };
  }

  return {
    mereceLaPena: true,
    ordenSugerido: [origen.id, ...ordenSugerido.map((h) => h.id), destino.id],
    kmActual: Math.round(kmActual),
    kmSugerido: Math.round(kmSugerido),
    ahorroKm: Math.round(ahorroKm),
  };
}

// ==========================================================================
// Estado 561 por chófer (ítem 7A.1) — horas de conducción estimadas vs. límites
// ==========================================================================

export const LIMITE_561_SEMANAL_H = 56; // Reglamento CE 561/2006
export const LIMITE_561_BISEMANAL_H = 90;

/**
 * Km aproximados de un viaje SIN llamar a OSRM (Haversine ×
 * FACTOR_SINUOSIDAD_FALLBACK entre hitos consecutivos con coordenadas, ordenados
 * por `orden`). Para el estado 561 no queremos N llamadas OSRM por chófer, así
 * que se acepta la aproximación en línea recta corregida. Pura, exportada para
 * tests.
 */
export function kmAproxViaje(hitos) {
  const conCoords = (hitos || [])
    .filter((h) => h.lat != null && h.lon != null)
    .sort((a, b) => a.orden - b.orden);
  let km = 0;
  for (let i = 0; i < conCoords.length - 1; i++) {
    km +=
      haversineKm(
        { lat: conCoords[i].lat, lon: conCoords[i].lon },
        { lat: conCoords[i + 1].lat, lon: conCoords[i + 1].lon }
      ) * FACTOR_SINUOSIDAD_FALLBACK;
  }
  return km;
}

/**
 * Avisa si el tiempo entre dos paradas consecutivas (según sus ventanas) no
 * alcanza para recorrer la distancia entre ellas, ni siquiera sin pausas
 * obligatorias (2026-07-22, hallazgo real: "Madrid a Burdeos en 1h" se podía
 * guardar tal cual, sin ningún aviso). Pura: Haversine × FACTOR_SINUOSIDAD_FALLBACK
 * para la distancia (mismo criterio que `kmAproxViaje`) y `calcularEtaConParadas`
 * para las horas necesarias (reutiliza el modelo 561/2006 ya existente, no
 * inventa un umbral nuevo). Solo evalúa pares con AMBAS coordenadas y AMBAS
 * ventanas — sin ventana no hay nada objetivo que comprobar, no se inventa.
 * `hitos` debe venir ya en el orden real del viaje (mismo criterio que
 * `kmAproxViaje` recibe hitos con `orden`, aquí se asume el orden del array).
 */
export function calcularAvisosViabilidad(hitos, velocidadKmh = VELOCIDAD_PLANIFICACION_KMH) {
  const avisos = [];
  const lista = hitos || [];
  for (let i = 0; i < lista.length - 1; i++) {
    const a = lista[i], b = lista[i + 1];
    if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) continue;
    const salida = a.ventana_fin || a.ventana_inicio;
    const llegada = b.ventana_inicio || b.ventana_fin;
    if (!salida || !llegada) continue;
    const horasDisponibles = (new Date(llegada).getTime() - new Date(salida).getTime()) / 3600000;
    if (!(horasDisponibles > 0)) continue; // fechas invertidas: lo marca otra validación, no se duplica aquí
    const km = haversineKm({ lat: Number(a.lat), lon: Number(a.lon) }, { lat: Number(b.lat), lon: Number(b.lon) }) * FACTOR_SINUOSIDAD_FALLBACK;
    const { horasTotales } = calcularEtaConParadas(km / velocidadKmh);
    if (horasTotales > horasDisponibles) {
      avisos.push({
        indice: i,
        km: Math.round(km),
        horasNecesarias: Math.round(horasTotales * 10) / 10,
        horasDisponibles: Math.round(horasDisponibles * 10) / 10,
        mensaje: `Entre la parada ${i + 1} y la ${i + 2}: ~${Math.round(km)} km, se necesitan ~${Math.round(horasTotales * 10) / 10} h (con descansos obligatorios) pero la ventana solo deja ${Math.round(horasDisponibles * 10) / 10} h — no parece viable.`,
      });
    }
  }
  return avisos;
}

/**
 * Horas de conducción ESTIMADAS de un chófer en los últimos 7 y 14 días, contra
 * los límites del Reglamento 561/2006 (56 h semanal, 90 h bisemanal).
 *
 * Aproximación deliberada (SIEMPRE `estimado: true`, nunca es tacógrafo): se
 * suman los km de los viajes con evento de llegada en el periodo (km / velocidad
 * de planificación), atribuyendo TODAS las horas del viaje al periodo de su
 * llegada. Es una cota razonable para avisar, no una cifra legal. La versión con
 * horas reales llega con la integración de tacógrafo (7B.4).
 */
/** Núcleo puro de getEstado561 — separado para que getEstado561ParaChoferes
 * (auditoría de arquitectura 2026-07-05) pueda calcular el estado de VARIOS
 * choferes con una sola tanda de consultas, sin duplicar esta lógica. */
function _calcularEstado561(llegadasChofer, hitosPorViaje, velocidad, desde7) {
  if (!llegadasChofer || llegadasChofer.length === 0) {
    return {
      horas7: 0, horas14: 0,
      margen7: LIMITE_561_SEMANAL_H, margen14: LIMITE_561_BISEMANAL_H,
      pct7: 0, pct14: 0, estimado: true,
    };
  }

  const viajeIds7 = new Set();
  const viajeIds14 = new Set();
  llegadasChofer.forEach((e) => {
    viajeIds14.add(e.viaje_id);
    if (e.ocurrido_en >= desde7) viajeIds7.add(e.viaje_id);
  });

  let horas7 = 0;
  let horas14 = 0;
  for (const viajeId of viajeIds14) {
    const completados = (hitosPorViaje[viajeId] || []).filter((h) => h.estado === "completado");
    const horas = kmAproxViaje(completados) / velocidad;
    horas14 += horas;
    if (viajeIds7.has(viajeId)) horas7 += horas;
  }

  horas7 = +horas7.toFixed(1);
  horas14 = +horas14.toFixed(1);
  return {
    horas7,
    horas14,
    margen7: +Math.max(0, LIMITE_561_SEMANAL_H - horas7).toFixed(1),
    margen14: +Math.max(0, LIMITE_561_BISEMANAL_H - horas14).toFixed(1),
    pct7: Math.round((horas7 / LIMITE_561_SEMANAL_H) * 100),
    pct14: Math.round((horas14 / LIMITE_561_BISEMANAL_H) * 100),
    estimado: true,
  };
}

export async function getEstado561(choferId, { ahora = new Date() } = {}) {
  const desde14 = new Date(ahora.getTime() - 14 * 86400000).toISOString();
  const desde7 = new Date(ahora.getTime() - 7 * 86400000).toISOString();

  // Ítem 9.35: "sin llegadas" (array vacío, chófer legítimamente sin
  // actividad) es distinto de "fallo real de lectura" (error presente) --
  // confundirlos aquí se veía como "561 limpio, 0%" en vez de un error real,
  // justo el riesgo que motivó esta decisión (nadie quiere fiarse de un
  // "vas bien con las horas" que en realidad es un fallo de red).
  const { data: llegadas, error: errorLlegadas } = await supabase
    .from("ejecucion_evento")
    .select("viaje_id, ocurrido_en")
    .eq("tipo", "llegada")
    .eq("chofer_id", choferId)
    .gte("ocurrido_en", desde14);
  if (errorLlegadas) throw errorLlegadas;

  if (!llegadas || llegadas.length === 0) {
    return _calcularEstado561([], {}, 1, desde7);
  }

  const viajeIds14 = [...new Set(llegadas.map((e) => e.viaje_id))];
  const [{ data: hitos, error: errorHitos }, { data: empresas }] = await Promise.all([
    supabase.from("hito").select("id, viaje_id, orden, estado, lat, lon").in("viaje_id", viajeIds14),
    supabase.from("empresa").select("velocidad_planificacion_kmh"),
  ]);
  // hitos alimenta el cálculo de km/horas de conducción; empresa es opcional
  // (resolveVelocidadPlanificacion ya cae a un valor por defecto sin ella).
  if (errorHitos) throw errorHitos;

  const velocidad = resolveVelocidadPlanificacion((empresas || [])[0] || null);
  const hitosPorViaje = {};
  (hitos || []).forEach((h) => { (hitosPorViaje[h.viaje_id] ||= []).push(h); });

  return _calcularEstado561(llegadas, hitosPorViaje, velocidad, desde7);
}

/**
 * Versión por lotes de getEstado561 para VARIOS choferes a la vez (ítem
 * introducido en la auditoría de arquitectura 2026-07-05): `sugerirChofer`
 * llamaba a `getEstado561` una vez POR CHOFER dentro de un `Promise.all` —
 * a la escala que persigue el producto (100+ conductores) son 200+
 * consultas en paralelo solo para rankear UNA asignación. Misma lógica que
 * `getEstado561`, pero en 2 consultas totales en vez de 2×N.
 */
export async function getEstado561ParaChoferes(choferIds, { ahora = new Date() } = {}) {
  const ids = [...new Set(choferIds)];
  if (!ids.length) return {};

  const desde14 = new Date(ahora.getTime() - 14 * 86400000).toISOString();
  const desde7 = new Date(ahora.getTime() - 7 * 86400000).toISOString();

  const { data: llegadas } = await supabase
    .from("ejecucion_evento")
    .select("chofer_id, viaje_id, ocurrido_en")
    .eq("tipo", "llegada")
    .in("chofer_id", ids)
    .gte("ocurrido_en", desde14);

  const llegadasPorChofer = {};
  (llegadas || []).forEach((e) => { (llegadasPorChofer[e.chofer_id] ||= []).push(e); });

  const viajeIdsTotal = [...new Set((llegadas || []).map((e) => e.viaje_id))];
  const [{ data: hitos }, { data: empresas }] = await Promise.all([
    viajeIdsTotal.length
      ? supabase.from("hito").select("id, viaje_id, orden, estado, lat, lon").in("viaje_id", viajeIdsTotal)
      : Promise.resolve({ data: [] }),
    supabase.from("empresa").select("velocidad_planificacion_kmh"),
  ]);

  const velocidad = resolveVelocidadPlanificacion((empresas || [])[0] || null);
  const hitosPorViaje = {};
  (hitos || []).forEach((h) => { (hitosPorViaje[h.viaje_id] ||= []).push(h); });

  const resultado = {};
  ids.forEach((choferId) => {
    resultado[choferId] = _calcularEstado561(llegadasPorChofer[choferId] || [], hitosPorViaje, velocidad, desde7);
  });
  return resultado;
}

/**
 * Fase 23, Bloque E (23.E.2) — DISCOVERY.md insight 18: "en vez de filtrar
 * mis camiones como yo, [el planificador] filtra todos los camiones que hay
 * en la delegación 1, que es Zaragoza." Reutiliza `base_empresa` (0061) como
 * delegación — **no existe hoy una columna `chofer.base_id`/`vehiculo.base_id`
 * explícita**, así que la delegación de cada chófer se DERIVA de la base más
 * cercana a su última posición conocida (mismo criterio que ya usa la nómina
 * para "noche fuera"), no de una asignación fija. Es una aproximación
 * honesta: un chófer que hoy está lejos de su base habitual (de viaje) puede
 * aparecer momentáneamente en otra delegación — encaja con la naturaleza de
 * la vista ("dónde está la flota AHORA"), no con un organigrama fijo.
 *
 * Columnas: matrícula (de la tractora acoplada, vía `acoplamiento` 0069),
 * chófer, horas conducidas/restantes de la semana (Reglamento 561/2006, ya
 * calculado por `getEstado561ParaChoferes`). **Pendiente:** `disponible_desde`
 * (23.D.1, todavía no construido — bloqueado por el despliegue de OSRM) no
 * se incluye; se añade cuando exista.
 *
 * @returns [{choferId, choferNombre, matricula, horasConducidasSemana, horasRestantesSemana}]
 */
export async function getVistaPlanificadorPorBase(baseId) {
  const empresaId = await getCurrentEmpresaId();

  const { data: bases } = await supabase.from("base_empresa").select("id, lat, lon").eq("empresa_id", empresaId);
  if (!bases || !bases.some((b) => b.id === baseId)) return [];

  const { data: acoplamientos } = await supabase
    .from("acoplamiento")
    .select("chofer_id, tractora_id")
    .eq("empresa_id", empresaId)
    .is("hasta", null)
    .not("tractora_id", "is", null);
  const conChofer = (acoplamientos || []).filter((a) => a.chofer_id);
  if (conChofer.length === 0) return [];

  const choferIds = [...new Set(conChofer.map((a) => a.chofer_id))];
  const tractoraIds = [...new Set(conChofer.map((a) => a.tractora_id))];

  const [{ data: choferes }, { data: tractoras }, { data: ubicaciones }, estado561] = await Promise.all([
    supabase.from("chofer").select("id, nombre, ciudad_residencia").in("id", choferIds),
    supabase.from("vehiculo").select("id, matricula").in("id", tractoraIds),
    supabase.from("ubicacion").select("chofer_id, lat, lon, created_at").in("chofer_id", choferIds).order("created_at", { ascending: false }),
    getEstado561ParaChoferes(choferIds),
  ]);

  const nombrePorChofer = Object.fromEntries((choferes || []).map((c) => [c.id, c.nombre]));
  const ciudadPorChofer = Object.fromEntries((choferes || []).map((c) => [c.id, c.ciudad_residencia]));
  const tractoraPorId = Object.fromEntries((tractoras || []).map((v) => [v.id, v]));
  const ultimaUbicPorChofer = {};
  (ubicaciones || []).forEach((u) => { if (!(u.chofer_id in ultimaUbicPorChofer)) ultimaUbicPorChofer[u.chofer_id] = u; });

  function baseMasCercanaId(punto) {
    let mejorId = null;
    let mejorDist = Infinity;
    for (const b of bases) {
      const d = haversineKm(punto, { lat: b.lat, lon: b.lon });
      if (d < mejorDist) { mejorDist = d; mejorId = b.id; }
    }
    return mejorId;
  }

  const filas = [];
  for (const a of conChofer) {
    const ping = ultimaUbicPorChofer[a.chofer_id];
    if (!ping) continue; // sin posición conocida, no se puede ubicar en ninguna delegación
    if (baseMasCercanaId({ lat: ping.lat, lon: ping.lon }) !== baseId) continue;

    const e561 = estado561[a.chofer_id] || {};
    filas.push({
      choferId: a.chofer_id,
      choferNombre: nombrePorChofer[a.chofer_id] || a.chofer_id,
      matricula: tractoraPorId[a.tractora_id]?.matricula || null,
      ciudadResidencia: ciudadPorChofer[a.chofer_id] || null,
      horasConducidasSemana: e561.horas7 ?? null,
      horasRestantesSemana: e561.margen7 ?? null,
    });
  }
  return filas;
}

// ==========================================================================
// Motor de asignación v1 (ítem 7A.2) — sugerencia con score explicado +
// registro de decisiones del gestor.
//
// La decisión de a quién asignar es SIEMPRE del gestor, nunca del chófer (el
// chófer solo se entera de su ruta, ver 7A.3) — el sistema sugiere con el
// porqué visible, el gestor asigna con un clic.
// ==========================================================================

export const PESOS_ASIGNACION = {
  disponibilidad: 40, margen561: 25, documentos: 15, proximidad: 10, historial: 10,
}; // valores iniciales razonables, NO pactados con cliente real — ajustables

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Puntúa un chófer para un viaje concreto. Pura, sin llamadas a red — toda la
 * información se resuelve antes en `sugerirChofer` y se le pasa aquí.
 *
 * El componente "historial" usa DESEMPEÑO REAL (puntualidad + tasa de
 * incidencias + valoración media, de `getMetricasChoferes`), no solo estrellas
 * — es la mejora pedida sobre la v0: "de quién hace qué ruta y cómo lo ha
 * hecho de bien". No se intenta correlacionar por ruta/cliente concretos en
 * v1 (el esquema no tiene un identificador reutilizable de ruta habitual y
 * forzarlo con fuzzy-matching de direcciones daría falsos positivos) — queda
 * anotado como posible mejora futura (7B) si el volumen de datos lo justifica.
 */
export function scoreChofer({ tieneViajeActivo, estado561, docsCaducados, distanciaOrigenKm, metricas, horasViaje }) {
  const razones = [];
  const bloqueos = [];
  let score = 0;

  if (!tieneViajeActivo) {
    score += 40;
    razones.push("Disponible");
  } else {
    razones.push("En viaje ahora");
  }

  if (estado561 == null) {
    score += 12;
    razones.push("Sin datos de horas");
  } else {
    const puntos = Math.round(clamp(estado561.margen7 / Math.max(horasViaje ?? 9, 1), 0, 1) * 25);
    score += puntos;
    razones.push(`${estado561.margen7} h de margen semanal (est.)`);
  }

  if (docsCaducados && docsCaducados.length > 0) {
    bloqueos.push(`Documento caducado: ${docsCaducados.join(", ")}`);
  } else {
    score += 15;
    razones.push("Documentos en vigor");
  }

  if (distanciaOrigenKm == null) {
    score += 5;
    razones.push("Ubicación desconocida");
  } else if (distanciaOrigenKm <= 50) {
    score += 10;
    razones.push(`a ~${Math.round(distanciaOrigenKm)} km del origen`);
  } else if (distanciaOrigenKm <= 200) {
    score += 6;
    razones.push(`a ~${Math.round(distanciaOrigenKm)} km del origen`);
  } else if (distanciaOrigenKm <= 500) {
    score += 3;
    razones.push(`a ~${Math.round(distanciaOrigenKm)} km del origen`);
  } else {
    score += 1;
    razones.push(`a ~${Math.round(distanciaOrigenKm)} km del origen`);
  }

  if (!metricas || metricas.viajes === 0) {
    score += 5;
    razones.push("Sin historial de viajes");
  } else {
    const puntualidadPts = metricas.pctPuntualidad != null ? Math.round((metricas.pctPuntualidad / 100) * 5) : 2;
    const incidenciasPts = Math.round(clamp(1 - metricas.incidencias / metricas.viajes, 0, 1) * 3);
    const valoracionPts = metricas.valoracionMedia != null ? Math.round((metricas.valoracionMedia / 5) * 2) : 1;
    score += puntualidadPts + incidenciasPts + valoracionPts;

    let razon = `${metricas.viajes} viajes previos`;
    if (metricas.pctPuntualidad != null) razon += `, ${metricas.pctPuntualidad}% puntual`;
    if (metricas.incidencias > 0) razon += `, ${metricas.incidencias} incid.`;
    razones.push(razon);
  }

  return { score, razones, bloqueos };
}

/**
 * Ranking de chóferes para un viaje, con score y razones. Reutiliza
 * `getMetricasChoferes` (4.5) para el componente de historial en vez de
 * reinventar el cálculo de puntualidad/incidencias.
 *
 * `viajeId` puede ser `null` (viaje aún no creado — wizard 7A.11, paso de
 * asignación antes de guardar). En ese caso hay que pasar `hitosOverride`
 * (los hitos en memoria del formulario) porque no hay fila en `hito` de la
 * que leer, y no se excluye ningún viaje de "activo" (no hay id propio que
 * excluir todavía).
 */
export async function sugerirChofer(viajeId, { hitosOverride = null } = {}) {
  const hoy = new Date().toISOString().slice(0, 10);

  let viajesActivosQuery = supabase.from("viaje").select("id, chofer_id").in("estado", ESTADOS_ACTIVOS);
  if (viajeId) viajesActivosQuery = viajesActivosQuery.neq("id", viajeId);

  // Fase 19.3 (2026-07-25, ver ROADMAP): el acotado a 2 días de la auditoría
  // de 2026-07-05 ya no basta a escala de flota real. Más abajo SOLO se usa
  // la posición MÁS RECIENTE de cada chófer (`ultimaUbicacionPorChofer`) --
  // con 1500 camiones pingueando cada pocos minutos, 2 días son cientos de
  // miles de filas descargadas para quedarse con, como mucho, 1500. Se
  // reduce a 3h: de sobra para "posición reciente" de un vehículo en ruta, y
  // si no hay ping en 3h el fallback ya existente ("ubicación desconocida")
  // es más honesto que una posición de hace dos días.
  const haceTresHoras = new Date(Date.now() - 3 * 3600000).toISOString();

  const [
    { data: choferes, error: errorChoferes },
    { data: viajesActivos, error: errorViajesActivos },
    { data: documentos },
    metricas,
    { data: ubicaciones },
    hitosResult,
    { data: empresas },
  ] = await Promise.all([
    supabase.from("chofer").select("id, nombre, idioma"),
    viajesActivosQuery,
    supabase.from("documento").select("entidad_id, tipo, fecha_caducidad").eq("ambito", "chofer"),
    getMetricasChoferes(),
    supabase.from("ubicacion").select("chofer_id, lat, lon, created_at").gte("created_at", haceTresHoras),
    hitosOverride ? Promise.resolve({ data: hitosOverride }) : supabase.from("hito").select("orden, lat, lon").eq("viaje_id", viajeId),
    supabase.from("empresa").select("velocidad_planificacion_kmh"),
  ]);
  // Ítem 9.35: chofer/viajesActivos alimentan el ranking entero -- un fallo
  // real aquí no debe verse como "ningún chófer disponible". documento/
  // ubicacion/empresa son opcionales a propósito (vacío es un estado de
  // negocio legítimo: sin docs caducados, sin GPS reciente, sin base
  // configurada, cada uno con su fallback ya existente).
  if (errorChoferes) throw errorChoferes;
  if (errorViajesActivos) throw errorViajesActivos;
  if (hitosResult.error) throw hitosResult.error;
  const hitos = hitosResult.data;

  // 1 sola tanda de consultas para el estado 561 de TODOS los choferes, en
  // vez de 1 por chófer (ver getEstado561ParaChoferes) — antes esto eran
  // 2×N consultas dentro del Promise.all del ranking de abajo.
  const estado561PorChofer = await getEstado561ParaChoferes((choferes || []).map((c) => c.id));

  const choferesConViajeActivo = new Set((viajesActivos || []).filter((v) => v.chofer_id).map((v) => v.chofer_id));

  const docsCaducadosPorChofer = {};
  (documentos || []).forEach((d) => {
    if (!["licencia", "cap"].includes(d.tipo)) return;
    if (d.fecha_caducidad && d.fecha_caducidad < hoy) {
      (docsCaducadosPorChofer[d.entidad_id] ||= []).push(d.tipo);
    }
  });

  const ultimaUbicacionPorChofer = {};
  (ubicaciones || []).forEach((u) => {
    const actual = ultimaUbicacionPorChofer[u.chofer_id];
    if (!actual || u.created_at > actual.created_at) ultimaUbicacionPorChofer[u.chofer_id] = u;
  });

  const metricasPorChofer = Object.fromEntries((metricas || []).map((m) => [m.id, m]));

  const hitosOrdenados = (hitos || []).filter((h) => h.lat != null && h.lon != null).sort((a, b) => a.orden - b.orden);
  const origen = hitosOrdenados[0] || null;
  const kmViaje = kmAproxViaje(hitos || []);
  const velocidadViaje = resolveVelocidadPlanificacion((empresas || [])[0] || null);
  const horasViaje = kmViaje / velocidadViaje;

  const ranking = (choferes || []).map((chofer) => {
    const ultimaUbicacion = ultimaUbicacionPorChofer[chofer.id];
    const distanciaOrigenKm = ultimaUbicacion && origen
      ? haversineKm(ultimaUbicacion, origen)
      : null;
    const estado561 = estado561PorChofer[chofer.id];
    const { score, razones, bloqueos } = scoreChofer({
      tieneViajeActivo: choferesConViajeActivo.has(chofer.id),
      estado561,
      docsCaducados: docsCaducadosPorChofer[chofer.id] || [],
      distanciaOrigenKm,
      metricas: metricasPorChofer[chofer.id] || null,
      horasViaje,
    });
    return { chofer: { id: chofer.id, nombre: chofer.nombre, idioma: chofer.idioma }, score, razones, bloqueos };
  });

  return ranking.sort((a, b) => b.score - a.score);
}

/**
 * Registra qué se sugirió vs. qué eligió el gestor — hook de aprendizaje
 * (7B.7). Nunca bloquea el flujo de asignar: si falla, se registra en
 * consola y se sigue.
 */
export async function registrarDecisionAsignacion({
  viajeId, choferSugeridoId, scoreSugerido, choferElegidoId, scoreElegido, motivo = null, tiempoVisibleMs = null,
}) {
  try {
    const empresaId = await getCurrentEmpresaId();
    const siguioSugerencia = choferSugeridoId != null && choferSugeridoId === choferElegidoId;
    await supabase.from("decision_asignacion").insert(
      {
        empresa_id: empresaId,
        viaje_id: viajeId,
        chofer_sugerido_id: choferSugeridoId,
        chofer_elegido_id: choferElegidoId,
        score_sugerido: scoreSugerido,
        score_elegido: scoreElegido,
        siguio_sugerencia: siguioSugerencia,
        motivo,
        // ROADMAP 10.10: señal pasiva y honesta para distinguir juicio real de
        // clic reflejo -- ver 0068_decision_asignacion_tiempo_visible.sql.
        tiempo_visible_ms: tiempoVisibleMs,
      },
      { returning: "minimal" }
    );
  } catch (e) {
    console.error("registrarDecisionAsignacion falló (no bloqueante):", e);
  }
}

// ==========================================================================
// Centro de mando "Hoy" (ítem 7A.10) — la home deja de ser solo el Kanban:
// abre con lo que de verdad necesita atención del gestor. Si todo está en
// orden, ese es el mensaje — no hay que ir a buscar nada más.
// ==========================================================================

export const UMBRAL_HUECO_UBICACION_H = 3; // valor inicial razonable, mismo estatus que otros umbrales del proyecto

/**
 * F14.2: pura. Dado el `created_at` del último ping de `ubicacion` de un chófer, decide si hay
 * un "hueco sospechoso" (posible GPS caído / app de Telegram cerrada) -- hoy solo se detecta si
 * alguien mira el mapa a mano. `null` (nunca hubo ningún ping) NO se marca: sería ruido avisar
 * de todo viaje que acaba de arrancar, se le da margen hasta el primer ping real.
 */
export function detectarHuecoUbicacion(ultimoPingIso, ahora = new Date(), umbralHoras = UMBRAL_HUECO_UBICACION_H) {
  if (!ultimoPingIso) return { hueco: false, horasSinSenal: null };
  const horas = (ahora.getTime() - new Date(ultimoPingIso).getTime()) / 3600000;
  return { hueco: horas >= umbralHoras, horasSinSenal: Math.round(horas) };
}

/**
 * F14.2: viajes `en_curso` cuyo chófer lleva `UMBRAL_HUECO_UBICACION_H` horas sin ningún ping de
 * `ubicacion` (UBI.1 ya los guarda) -- señal barata reutilizando datos que ya existen, sin
 * llamada externa nueva.
 */
export async function getViajesConHuecoUbicacion() {
  const { data: viajesEnCurso } = await supabase
    .from("viaje")
    .select("id, referencia, chofer_id")
    .eq("estado", "en_curso");

  const conChofer = (viajesEnCurso || []).filter((v) => v.chofer_id);
  if (conChofer.length === 0) return [];

  // Fase 19.8 (2026-07-25, ver ROADMAP): N+1 real -- antes 1 consulta a
  // `ubicacion` POR viaje en curso, dentro de un Promise.all (con 200 viajes
  // activos, 200 idas y vueltas de red solo para cargar la home). Ahora 1
  // sola consulta para todos los chóferes activos a la vez, reducida en JS a
  // "la más reciente por chófer" (mismo patrón que `ultimaUbicacionPorChofer`
  // en sugerirChofer). Ventana de 7 días (no ilimitada): de sobra para
  // cualquier viaje en_curso real -- si un viaje lleva más de 7 días activo
  // sin NINGÚN ping, hay un problema mucho más gordo que este umbral.
  const idsChofer = [...new Set(conChofer.map((v) => v.chofer_id))];
  const haceSieteDias = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: ubicacionesRecientes } = await supabase
    .from("ubicacion")
    .select("chofer_id, created_at")
    .in("chofer_id", idsChofer)
    .gte("created_at", haceSieteDias)
    .order("created_at", { ascending: false });

  const ultimoPingPorChofer = {};
  (ubicacionesRecientes || []).forEach((u) => {
    if (!(u.chofer_id in ultimoPingPorChofer)) ultimoPingPorChofer[u.chofer_id] = u.created_at;
  });

  return conChofer
    .map((v) => {
      const ultimoPing = ultimoPingPorChofer[v.chofer_id] || null;
      const { hueco, horasSinSenal } = detectarHuecoUbicacion(ultimoPing);
      return hueco ? { viajeId: v.id, referencia: v.referencia || v.id.slice(0, 8), horasSinSenal } : null;
    })
    .filter(Boolean);
}

// ==========================================================================
// Fase 23, Bloque C (23.C.2) — Posición derivada de cada unidad de transporte.
//
// Origen: DISCOVERY.md insight 9/21 (2026-07-27) — el gestor pidió literalmente
// que el sistema sepa dónde está cada remolque sin GPS propio de remolque, y
// hoy lo hace a mano cada mañana ("uno por uno, por GPS"). Solución: `ubicacion`
// sigue colgando SOLO del chófer (no hay telemetría de remolque, ver ROADMAP
// 23.0.3), pero cruzada con `acoplamiento` (0069) permite derivar la posición
// de la tractora y de cada remolque acoplado sin sensor propio.
//
// Regla de diseño no negociable: NUNCA se inventa una posición interpolando
// por la ruta teórica -- sería fabricar evidencia en un sistema cuyo valor ES
// la evidencia. Toda posición devuelta lleva su `fuente` y su antigüedad.
// ==========================================================================

export const UMBRAL_POSICION_OBSOLETA_MIN = 30; // valor inicial razonable, mismo estatus que otros umbrales del proyecto

/**
 * Posición derivada de TODAS las unidades vigentes de una empresa: chóferes,
 * sus tractoras y sus remolques acoplados, más los remolques sueltos.
 *
 * Cada unidad devuelve `{ tipo, id, lat, lon, fuente, actualizadoEn }` donde
 * `fuente` es una de:
 *   - 'directa'   -- hay un chófer acoplado y su último ping está dentro del
 *                    umbral. Máxima confianza.
 *   - 'obsoleta'  -- hay chófer acoplado pero su último ping es más viejo que
 *                    el umbral. Se devuelve la posición Y su antigüedad real,
 *                    nunca como si fuera actual.
 *   - 'congelada' -- remolque suelto (sin tractora vigente): se queda en el
 *                    punto de la última posición conocida ANTES de soltarse,
 *                    hasta que alguien lo vuelva a enganchar. Fiable para
 *                    saber que sigue ahí, inútil para saber si alguien se lo
 *                    llevó sin declararlo (eso requiere telemetría física,
 *                    ver ROADMAP 23.0.3).
 *   - 'desconocida' -- sin acoplamiento vigente y sin ping previo utilizable.
 *
 * No infiere identidad por cercanía (DISCOVERY.md insight 21: en Épila hay
 * 200 camiones juntos) -- la identidad viene SIEMPRE del acoplamiento
 * declarado, nunca de "está cerca de".
 */
export async function getPosicionUnidades() {
  const empresaId = await getCurrentEmpresaId();
  const ahora = new Date();

  const { data: acoplamientos } = await supabase
    .from("acoplamiento")
    .select("id, tractora_id, remolque_id, posicion, chofer_id")
    .eq("empresa_id", empresaId)
    .is("hasta", null);

  const vigentes = acoplamientos || [];
  const idsChofer = [...new Set(vigentes.map((a) => a.chofer_id).filter(Boolean))];

  const ultimaUbicacionPorChofer = {};
  if (idsChofer.length > 0) {
    const haceSieteDias = new Date(ahora.getTime() - 7 * 86400000).toISOString();
    const { data: ubicaciones } = await supabase
      .from("ubicacion")
      .select("chofer_id, lat, lon, created_at")
      .in("chofer_id", idsChofer)
      .gte("created_at", haceSieteDias)
      .order("created_at", { ascending: false });
    (ubicaciones || []).forEach((u) => {
      if (!(u.chofer_id in ultimaUbicacionPorChofer)) ultimaUbicacionPorChofer[u.chofer_id] = u;
    });
  }

  function posicionDeChofer(choferId) {
    const u = ultimaUbicacionPorChofer[choferId];
    if (!u) return null;
    const minutos = (ahora.getTime() - new Date(u.created_at).getTime()) / 60000;
    return {
      lat: u.lat,
      lon: u.lon,
      actualizadoEn: u.created_at,
      fuente: minutos <= UMBRAL_POSICION_OBSOLETA_MIN ? "directa" : "obsoleta",
    };
  }

  const resultado = [];
  const tractorasYaAnadidas = new Set(); // una tractora puede tener 2 remolques (duo) -> 2 filas de acoplamiento, 1 sola entidad tractora
  for (const a of vigentes) {
    const posChofer = a.chofer_id ? posicionDeChofer(a.chofer_id) : null;

    if (a.tractora_id && !tractorasYaAnadidas.has(a.tractora_id)) {
      tractorasYaAnadidas.add(a.tractora_id);
      resultado.push({
        tipo: "tractora",
        id: a.tractora_id,
        acoplamientoId: a.id,
        ...(posChofer || { lat: null, lon: null, actualizadoEn: null, fuente: "desconocida" }),
      });
    }
    resultado.push({
      tipo: "remolque",
      id: a.remolque_id,
      posicion: a.posicion,
      acoplamientoId: a.id,
      tractoraId: a.tractora_id,
      // Remolque suelto (sin tractora vigente): su posición es la del último
      // punto conocido -- se queda "congelado" ahí hasta que alguien declare
      // un nuevo enganche. Con tractora, comparte la posición del chófer.
      ...(a.tractora_id
        ? posChofer || { lat: null, lon: null, actualizadoEn: null, fuente: "desconocida" }
        : posChofer
          ? { ...posChofer, fuente: "congelada" }
          : { lat: null, lon: null, actualizadoEn: null, fuente: "desconocida" }),
    });
  }

  return resultado;
}

/**
 * Fase 23, Bloque E (23.E.3) — orden de trabajo != orden de carga.
 * DISCOVERY.md insight 18: "no es lo mismo el viaje del ordenador que el que
 * le mandas al chófer... te pone de 8 a 18, pues le pones a las 11 en
 * punto." Escribe la instrucción del gestor SIN tocar la ventana comercial
 * (`ventana_inicio`/`ventana_fin`, que sigue siendo lo vendido al cliente) —
 * son dos campos distintos a propósito, esa es toda la idea. `hito.notas`
 * (ya existía) se reutiliza para las observaciones ("para en este parking,
 * llama cuando estés vacío") en vez de crear un campo nuevo redundante.
 *
 * @param {string} hitoId
 * @param {{horaInstruccion?: string|null, nota?: string|null}} cambios
 */
export async function guardarInstruccionChofer(hitoId, { horaInstruccion, nota } = {}) {
  const payload = {};
  if (horaInstruccion !== undefined) payload.hora_instruccion_chofer = horaInstruccion || null;
  if (nota !== undefined) payload.notas = nota || null;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("hito").update(payload).eq("id", hitoId);
  if (error) throw error;
}

/**
 * Fase 23, Bloque C (23.C.4) — Contradicciones de acoplamiento: incoherencias
 * entre lo que dice el sistema y un hito activo, sin necesitar telemetría de
 * remolque (bloqueada en ROADMAP 23.0.3). Función de LECTURA, mismo patrón
 * que `getIncidenciasAbiertasParaMapa` -- sin tabla nueva, aislada por
 * `empresa_id` a través de las consultas normales de Supabase + RLS.
 *
 * NO reutiliza `alerta_integridad` (0045): esa tabla no tiene `empresa_id` ni
 * policies para `authenticated` -- es intencionalmente invisible al
 * dashboard, solo la usa el monitor de cron. Reutilizarla habría escondido la
 * alerta del gestor (o peor, filtrado datos entre empresas).
 *
 * Nunca corrige nada por sí sola: es una lista para que el gestor decida,
 * porque la corrección real depende de contexto que el sistema no tiene.
 * Solo mira hitos YA activos (`en_curso`/`completado`) -- un hito
 * `pendiente` sin remolque acoplado todavía es normal (el viaje no ha
 * arrancado), no una contradicción.
 */
export async function getContradiccionesAcoplamiento() {
  const empresaId = await getCurrentEmpresaId();

  const { data: hitos } = await supabase
    .from("hito")
    .select("id, remolque_id, estado, viaje:viaje_id(id, referencia, chofer_id, empresa_id)")
    .not("remolque_id", "is", null)
    .in("estado", ["en_curso", "completado"]);

  const hitosDeLaEmpresa = (hitos || []).filter((h) => h.viaje?.empresa_id === empresaId);
  if (hitosDeLaEmpresa.length === 0) return [];

  const idsRemolque = [...new Set(hitosDeLaEmpresa.map((h) => h.remolque_id))];
  const { data: acoplamientos } = await supabase
    .from("acoplamiento")
    .select("remolque_id, chofer_id")
    .eq("empresa_id", empresaId)
    .in("remolque_id", idsRemolque)
    .is("hasta", null);

  const vigentePorRemolque = {};
  (acoplamientos || []).forEach((a) => { vigentePorRemolque[a.remolque_id] = a; });

  const contradicciones = [];
  for (const h of hitosDeLaEmpresa) {
    const vigente = vigentePorRemolque[h.remolque_id];
    if (!vigente) {
      contradicciones.push({
        tipo: "sin_acoplamiento_vigente",
        hitoId: h.id,
        remolqueId: h.remolque_id,
        viajeId: h.viaje.id,
        viajeReferencia: h.viaje.referencia,
        detalle: "Este hito usa un remolque que, según el sistema, nadie tiene enganchado ahora mismo.",
      });
    } else if (h.viaje.chofer_id && vigente.chofer_id && vigente.chofer_id !== h.viaje.chofer_id) {
      contradicciones.push({
        tipo: "chofer_no_coincide",
        hitoId: h.id,
        remolqueId: h.remolque_id,
        viajeId: h.viaje.id,
        viajeReferencia: h.viaje.referencia,
        detalle: "El remolque de este hito está acoplado a otro chófer distinto del asignado al viaje.",
      });
    }
  }
  return contradicciones;
}

/**
 * Fase 23, Bloque B (23.B.3) — DISCOVERY.md insight 13: "¿Cuántos euros dijo
 * mi jefe? En palets que habían desaparecido. Miles y miles de euros." Dos
 * contadores que el chófer ya maneja físicamente (`hito.palets_entregados`,
 * `hito.palets_devueltos`, migración 0070) -- aquí solo se agregan por
 * cliente para ver quién no devuelve.
 *
 * @returns [{clienteNombre, entregados, devueltos, pendientes}], solo
 *          clientes con `pendientes > 0` (que es lo que hay que perseguir),
 *          ordenado de mayor a menor deuda.
 */
/**
 * Fase 23, Bloque B (23.B.4) — registra un retén: un día en que se para al
 * chófer para que pueda salir con disco limpio al día siguiente. Un solo
 * retén por chófer y fecha (`UNIQUE (chofer_id, fecha)` en 0071) -- volver a
 * llamar el mismo día actualiza el motivo en vez de duplicar.
 */
export async function registrarReten({ choferId, fecha, motivo = null, viajeSiguienteId = null }) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase
    .from("reten")
    .upsert(
      { empresa_id: empresaId, chofer_id: choferId, fecha, motivo, viaje_siguiente_id: viajeSiguienteId },
      { onConflict: "chofer_id,fecha" }
    );
  if (error) throw error;
}

export async function getPaletsPendientesPorCliente() {
  // Fase 19.1: acotar con .limit, nunca traer una tabla entera sin límite --
  // igual criterio que el resto del archivo (ver getInformeNomina más arriba).
  const { data: hitos } = await supabase
    .from("hito")
    .select("palets_entregados, palets_devueltos, viaje:viaje_id(cliente:cliente_id(nombre))")
    .limit(5000);

  const porCliente = {};
  for (const h of hitos || []) {
    if (h.palets_entregados == null && h.palets_devueltos == null) continue;
    const nombre = h.viaje?.cliente?.nombre;
    if (!nombre) continue; // sin cliente identificado, no se puede perseguir la deuda
    if (!porCliente[nombre]) porCliente[nombre] = { entregados: 0, devueltos: 0 };
    porCliente[nombre].entregados += h.palets_entregados || 0;
    porCliente[nombre].devueltos += h.palets_devueltos || 0;
  }

  return Object.entries(porCliente)
    .map(([clienteNombre, v]) => ({
      clienteNombre,
      entregados: v.entregados,
      devueltos: v.devueltos,
      pendientes: v.entregados - v.devueltos,
    }))
    .filter((c) => c.pendientes > 0)
    .sort((a, b) => b.pendientes - a.pendientes);
}

export async function getResumenHoy() {
  const ahoraIso = new Date().toISOString();

  const [
    documentosPorCaducar,
    { data: incidenciasAbiertas },
    { data: viajesEnCurso },
    { data: viajesActivosConPrecio },
    viajesConHueco,
  ] = await Promise.all([
    getDocumentosPorCaducar(),
    supabase.from("incidencia").select("id, created_at").in("estado", ALERTA_ESTADOS),
    supabase.from("viaje").select("id, referencia, chofer_id").eq("estado", "en_curso"),
    supabase.from("viaje").select("id, precio").in("estado", ESTADOS_ACTIVOS),
    getViajesConHuecoUbicacion(),
  ]);
  const huecosUbicacion = { count: viajesConHueco.length, refs: viajesConHueco.map((v) => v.referencia).slice(0, 3) };

  // Incidencias abiertas
  let masAntiguaDias = null;
  if (incidenciasAbiertas && incidenciasAbiertas.length > 0) {
    const masAntigua = incidenciasAbiertas.reduce((min, i) => (i.created_at < min ? i.created_at : min), incidenciasAbiertas[0].created_at);
    masAntiguaDias = Math.floor((Date.now() - new Date(masAntigua).getTime()) / 86400000);
  }

  // Viajes en riesgo: en curso con algún hito no completado cuya ventana ya pasó
  const idsEnCurso = (viajesEnCurso || []).map((v) => v.id);
  let viajesEnRiesgo = { count: 0, refs: [] };
  if (idsEnCurso.length > 0) {
    const { data: hitosRiesgo } = await supabase
      .from("hito")
      .select("viaje_id, estado, ventana_fin")
      .in("viaje_id", idsEnCurso);
    const viajeIdsEnRiesgo = new Set(
      (hitosRiesgo || [])
        .filter((h) => h.estado !== "completado" && h.ventana_fin && h.ventana_fin < ahoraIso)
        .map((h) => h.viaje_id)
    );
    const refs = (viajesEnCurso || [])
      .filter((v) => viajeIdsEnRiesgo.has(v.id))
      .map((v) => v.referencia || v.id.slice(0, 8));
    viajesEnRiesgo = { count: viajeIdsEnRiesgo.size, refs: refs.slice(0, 3) };
  }

  // Chóferes cerca del límite 561 — solo los que tienen viaje activo ahora mismo
  const choferIdsActivos = [...new Set((viajesEnCurso || []).map((v) => v.chofer_id).filter(Boolean))];
  let choferes561 = { count: 0, nombres: [] };
  if (choferIdsActivos.length > 0) {
    const { data: choferesData } = await supabase.from("chofer").select("id, nombre").in("id", choferIdsActivos);
    const mapaNombre = Object.fromEntries((choferesData || []).map((c) => [c.id, c.nombre]));
    const estados = await Promise.all(choferIdsActivos.map((id) => getEstado561(id)));
    const cerca = choferIdsActivos
      .map((id, i) => ({ id, nombre: mapaNombre[id] || id, estado: estados[i] }))
      .filter((c) => c.estado && c.estado.pct7 >= 80);
    choferes561 = { count: cerca.length, nombres: cerca.map((c) => c.nombre) };
  }

  // Viajes a pérdidas estimadas (tope 20 llamadas a getViabilidadViaje por coste)
  const candidatos = (viajesActivosConPrecio || []).filter((v) => v.precio != null).slice(0, 20);
  const viabilidades = await Promise.all(candidatos.map((v) => getViabilidadViaje(v.id)));
  const viajesPerdidas = { count: viabilidades.filter((v) => v && v.margen != null && v.margen < 0).length };

  const todoEnOrden =
    documentosPorCaducar.length === 0 &&
    (incidenciasAbiertas || []).length === 0 &&
    viajesEnRiesgo.count === 0 &&
    choferes561.count === 0 &&
    viajesPerdidas.count === 0 &&
    huecosUbicacion.count === 0;

  return {
    docsPorCaducar: documentosPorCaducar.length,
    incidencias: { count: (incidenciasAbiertas || []).length, masAntiguaDias },
    viajesEnRiesgo,
    choferes561,
    viajesPerdidas,
    huecosUbicacion,
    todoEnOrden,
  };
}

// --- Notas rápidas del gestor (7A.10) — cuaderno de bitácora sin estructura,
// pensado para capturar contexto de primera mano y poder minarlo más adelante
// (complementa el registro estructurado de decision_asignacion, 7A.2). ---

export async function getNotasRecientes(limite = 10, { viajeId = null } = {}) {
  let query = supabase.from("nota_gestor").select("id, texto, viaje_id, created_at, gestor:gestor_id(nombre)");
  if (viajeId) query = query.eq("viaje_id", viajeId);
  const { data } = await query;
  // Orden en JS (no en la query): el mock de tests no ordena de verdad, y esto
  // es barato para el volumen de un cuaderno de notas.
  return (data || []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limite);
}

export async function createNotaGestor({ texto, viajeId = null }) {
  const empresaId = await getCurrentEmpresaId();
  const { data: { session } } = await supabase.auth.getSession();
  let gestorId = null;
  if (session?.user) {
    const { data: gestor } = await supabase.from("gestor").select("id").eq("auth_user_id", session.user.id).single();
    gestorId = gestor?.id || null;
  }
  const { error } = await supabase.from("nota_gestor").insert({
    empresa_id: empresaId,
    gestor_id: gestorId,
    texto: texto.trim(),
    viaje_id: viajeId,
  });
  if (error) throw error;
}

// --- Capa de contexto (11.2) — memoria organizada y buscable de cada entidad
// (viaje/chofer/cliente), con procedencia (quien / que canal / cuando). Generaliza
// nota_gestor: mismo espiritu de cuaderno minable, anclable a cualquier entidad y
// con canal de origen. HOY solo se escriben los canales 'nota_manual' y 'email'
// desde el dashboard; 'llamada_transcrita'/'whatsapp' quedan para 11.3/11.6. ---

const CANALES_CONTEXTO_DASHBOARD = ["nota_manual", "email"];
export const LIMITE_CONTEXTO = 200;

/**
 * Lista el contexto anclado a una entidad, hecho mas reciente primero.
 * @param {"viaje"|"chofer"|"cliente"} entidad
 * @param {string} entidadId
 * @returns filas { id, canal, texto, resumen, autor_externo, ocurrido_en, created_at, gestor:{nombre} }
 */
export async function getContexto(entidad, entidadId) {
  const { data } = await supabase
    .from("contexto")
    .select("id, canal, texto, resumen, autor_externo, ocurrido_en, created_at, audio_url, gestor:gestor_id(nombre)")
    .eq("entidad", entidad)
    .eq("entidad_id", entidadId)
    .order("ocurrido_en", { ascending: false })
    .limit(LIMITE_CONTEXTO);
  return data || [];
}

/**
 * Crea una pieza de contexto anclada a una entidad. Resuelve gestor_id de la
 * sesion (autor interno), igual que createNotaGestor. `canal` limitado a los
 * usables desde el dashboard hoy; `ocurridoEn`/`resumen`/`autorExterno` opcionales.
 * @returns {string} id de la fila creada
 */
export async function createContexto({
  entidad,
  entidadId,
  texto,
  canal = "nota_manual",
  resumen = null,
  autorExterno = null,
  ocurridoEn = null,
}) {
  if (!["viaje", "chofer", "cliente"].includes(entidad)) {
    throw new Error(`entidad no valida: ${entidad}`);
  }
  if (!CANALES_CONTEXTO_DASHBOARD.includes(canal)) {
    throw new Error(`canal no permitido desde el dashboard: ${canal}`);
  }
  const empresaId = await getCurrentEmpresaId();
  const { data: { session } } = await supabase.auth.getSession();
  let gestorId = null;
  if (session?.user) {
    const { data: gestor } = await supabase
      .from("gestor").select("id").eq("auth_user_id", session.user.id).single();
    gestorId = gestor?.id || null;
  }
  const fila = {
    empresa_id: empresaId,
    entidad,
    entidad_id: entidadId,
    canal,
    texto: texto.trim(),
    resumen: resumen ? resumen.trim() : null,
    gestor_id: gestorId,
    autor_externo: autorExterno,
  };
  if (ocurridoEn) fila.ocurrido_en = ocurridoEn;
  const { data, error } = await supabase.from("contexto").insert(fila).select("id").single();
  if (error) throw error;
  return data.id;
}

/**
 * Informe de nómina auto-derivado (ítem 5.1). Para cada chófer de la empresa y
 * un mes/año dados, calcula:
 *   - nochesFuera: nº de noches del mes en que, en torno a medianoche, el chófer
 *     tenía un viaje en curso y su último hito completado (llegada) estaba a más
 *     de UMBRAL_NOCHE_FUERA_KM de la base de la empresa. Requiere que la empresa
 *     tenga base_lat/base_lon configuradas (si no, nochesFuera = null → "n/d").
 *   - km: km por CARRETERA REAL del mes, sumando la distancia OSRM entre hitos
 *     consecutivos completados de los viajes con actividad en el mes.
 *   - viajes: lista de referencias de viajes que contribuyeron a los km.
 *
 * v1 simplificada y sus supuestos están documentados en PROGRESS.md. El cálculo
 * vive en JS (mismo patrón que getMetricas*) y usa el cliente OSRM vía fetch,
 * mockeable en tests.
 *
 * @param {number} mes  1-12
 * @param {number} anio p.ej. 2026
 */
export async function getInformeNomina(mes, anio) {
  // Rango del mes [inicio, finExclusivo) en ISO. Ítem 6.4: aplicado en la
  // query (.gte/.lt) en vez de traer toda la tabla ejecucion_evento y filtrar
  // en cliente.
  const inicio = new Date(Date.UTC(anio, mes - 1, 1));
  const finExcl = new Date(Date.UTC(anio, mes, 1));
  const inicioISO = inicio.toISOString();
  const finISO = finExcl.toISOString();

  // Fase 19.1 (2026-07-25, hallazgo real: PostgREST corta CUALQUIER select()
  // sin `limit` en 1000 filas, SIN avisar -- comprobado empíricamente contra
  // la BD, ver ROADMAP.md Fase 19). `viaje`/`hito` se pedían ENTEROS, sin
  // acotar, aunque el informe es de UN MES. Con más de 1000 viajes/hitos en
  // el histórico total (fácil con una flota grande, no solo con años de
  // datos) la nómina se calcularía sobre un subconjunto arbitrario --
  // "planificado" en dinero real. Fix: primero se resuelven las llegadas del
  // mes (ya acotadas por fecha), y SOLO ENTONCES se piden viaje/hito de esos
  // viajes concretos -- de cientos de miles de filas históricas a, como
  // mucho, unos pocos miles ligados a la actividad real del mes.
  const [
    { data: choferes, error: errorChoferes },
    { data: llegadasMesRaw, error: errorLlegadas },
    { data: bases, error: errorBases },
  ] = await Promise.all([
    supabase.from("chofer").select("id, nombre").order("id").limit(5000),
    supabase.from("ejecucion_evento")
      .select("hito_id, viaje_id, chofer_id, tipo, ocurrido_en")
      .eq("tipo", "llegada")
      .gte("ocurrido_en", inicioISO)
      .lt("ocurrido_en", finISO),
    // 18.C.3: múltiples bases -- un chófer puede desplazarse entre naves, así
    // que "noche fuera" se calcula contra la base MÁS CERCANA de la empresa,
    // no una única fija (confirmar este criterio con el gestor real en el
    // discovery de 12.3 sigue pendiente).
    supabase.from("base_empresa").select("lat, lon"),
  ]);
  if (errorChoferes) throw errorChoferes;
  if (errorLlegadas) throw errorLlegadas;
  if (errorBases) throw errorBases;
  const llegadasMes = llegadasMesRaw || [];

  const viajeIdsMes = [...new Set(llegadasMes.map((e) => e.viaje_id))];
  const [
    { data: viajes, error: errorViajes },
    { data: hitos, error: errorHitos },
  ] = await Promise.all([
    viajeIdsMes.length
      ? supabase.from("viaje").select("id, referencia, chofer_id, estado, adr").in("id", viajeIdsMes)
      : Promise.resolve({ data: [] }),
    viajeIdsMes.length
      ? supabase.from("hito").select("id, viaje_id, orden, estado, lat, lon, carga_descarga_chofer").in("viaje_id", viajeIdsMes)
      : Promise.resolve({ data: [] }),
  ]);
  if (errorViajes) throw errorViajes;
  if (errorHitos) throw errorHitos;

  const tieneBase = (bases || []).length > 0;
  // Distancia a la base más cercana, no a una fija -- ver comentario arriba.
  function distanciaBaseMasCercana(punto) {
    return Math.min(...bases.map((b) => haversineKm(punto, { lat: b.lat, lon: b.lon })));
  }

  const hitoById = Object.fromEntries((hitos || []).map((h) => [h.id, h]));
  const viajeById = Object.fromEntries((viajes || []).map((v) => [v.id, v]));

  // 23.B.1: días internacionales por GPS -- solo para chóferes con actividad
  // este mes (mismo criterio de acotar por fecha+actividad que el resto del
  // informe, ver comentario de la Fase 19.1 más arriba).
  const idsChoferMes = [...new Set(llegadasMes.map((e) => e.chofer_id).filter(Boolean))];

  // 23.B.4: retenes del mes -- entidad propia (un día de un chófer, no un
  // viaje ni un hito), fuera del bucle de viajes/hitos de arriba.
  let retenesPorChofer = {};
  if (idsChoferMes.length > 0) {
    const { data: retenesMes, error: errorRetenes } = await supabase
      .from("reten")
      .select("chofer_id, fecha")
      .in("chofer_id", idsChoferMes)
      .gte("fecha", inicioISO.slice(0, 10))
      .lt("fecha", finISO.slice(0, 10));
    if (errorRetenes) throw errorRetenes;
    retenesPorChofer = {};
    (retenesMes || []).forEach((r) => {
      retenesPorChofer[r.chofer_id] = (retenesPorChofer[r.chofer_id] || 0) + 1;
    });
  }
  let ubicacionesMesPorChofer = {};
  if (idsChoferMes.length > 0) {
    const { data: ubicacionesMes, error: errorUbicaciones } = await supabase
      .from("ubicacion")
      .select("chofer_id, lat, lon, created_at")
      .in("chofer_id", idsChoferMes)
      .gte("created_at", inicioISO)
      .lt("created_at", finISO);
    if (errorUbicaciones) throw errorUbicaciones;
    ubicacionesMesPorChofer = {};
    (ubicacionesMes || []).forEach((u) => {
      (ubicacionesMesPorChofer[u.chofer_id] ||= []).push(u);
    });
  }

  // 23.B.2: fin de semana -- necesita TODOS los eventos del mes (no solo
  // llegadas) para medir el span real de actividad de cada sábado/domingo.
  let eventosMesPorChofer = {};
  if (idsChoferMes.length > 0) {
    const { data: eventosMes, error: errorEventosMes } = await supabase
      .from("ejecucion_evento")
      .select("chofer_id, ocurrido_en")
      .in("chofer_id", idsChoferMes)
      .gte("ocurrido_en", inicioISO)
      .lt("ocurrido_en", finISO);
    if (errorEventosMes) throw errorEventosMes;
    eventosMesPorChofer = {};
    (eventosMes || []).forEach((e) => {
      (eventosMesPorChofer[e.chofer_id] ||= []).push(e);
    });
  }

  // Inicializa el acumulador por chófer.
  const porChofer = {};
  (choferes || []).forEach((c) => {
    porChofer[c.id] = {
      id: c.id,
      nombre: c.nombre,
      km: 0,
      estimado: false,
      // Set de fechas (YYYY-MM-DD) que ya cuentan como noche fuera (dedup).
      _nochesSet: new Set(),
      _viajes: new Set(),
      diasInternacional: diasInternacionalPorPings(ubicacionesMesPorChofer[c.id]).size,
      finDeSemana: extrasFinDeSemanaPorEventos(eventosMesPorChofer[c.id]),
      // 23.B.4: extras con marca manual -- ningún sensor los da.
      _viajesAdrSet: new Set(),
      cargaDescargaChofer: 0,
      retenes: retenesPorChofer[c.id] || 0,
    };
  });

  // --- Noches fuera ---
  // Una llegada cuenta si: hora local en [22:00, 06:00), su viaje NO está
  // cancelado, hay coords del hito y de la base, y la distancia supera el umbral.
  if (tieneBase) {
    for (const ev of llegadasMes) {
      const chofer = porChofer[ev.chofer_id];
      if (!chofer) continue;
      const hito = hitoById[ev.hito_id];
      if (!hito || hito.lat == null || hito.lon == null) continue;
      const viaje = viajeById[ev.viaje_id];
      if (viaje && viaje.estado === "cancelado") continue;

      const { hora } = partesLocalOperacion(ev.ocurrido_en);
      const enVentana = hora >= NOCHE_HORA_INICIO || hora < NOCHE_HORA_FIN;
      if (!enVentana) continue;

      const distancia = distanciaBaseMasCercana({ lat: hito.lat, lon: hito.lon });
      if (distancia > UMBRAL_NOCHE_FUERA_KM) {
        chofer._nochesSet.add(fechaNocheOperacion(ev.ocurrido_en));
      }
    }
  }

  // --- Km por carretera real ---
  // Viajes con actividad (alguna llegada) en el mes. Para cada uno, hitos
  // completados ordenados por `orden`, distancia OSRM entre consecutivos.
  const viajesConActividad = new Set(llegadasMes.map((e) => e.viaje_id));

  for (const viajeId of viajesConActividad) {
    const viaje = viajeById[viajeId];
    if (!viaje || !viaje.chofer_id) continue;
    const chofer = porChofer[viaje.chofer_id];
    if (!chofer) continue;

    const completados = (hitos || []).filter(
      (h) => h.viaje_id === viajeId && h.estado === "completado"
    );
    // kmCarreteraViaje ya filtra por coordenadas y ordena por `orden`; reutilizarla
    // aquí (en vez de duplicar el bucle OSRM) es lo que le da a nómina el mismo
    // fallback Haversine que viabilidad/ETA (ítem 6.1).
    const { km: kmViaje, estimado } = await kmCarreteraViaje(completados);

    if (completados.length >= 2) {
      chofer.km += kmViaje;
      if (estimado) chofer.estimado = true;
      chofer._viajes.add(viaje.referencia || viaje.id.slice(0, 8));
    }

    // 23.B.4: ADR es por viaje (flag en `viaje.adr`); carga/descarga por el
    // chófer es por hito (`hito.carga_descarga_chofer`) -- se cuentan sobre
    // los mismos viajes/hitos con actividad este mes, sin consulta aparte.
    if (viaje.adr) chofer._viajesAdrSet.add(viajeId);
    chofer.cargaDescargaChofer += completados.filter((h) => h.carga_descarga_chofer).length;
  }

  const filas = Object.values(porChofer).map((c) => ({
    id: c.id,
    nombre: c.nombre,
    nochesFuera: tieneBase ? c._nochesSet.size : null,
    km: Math.round(c.km),
    estimado: c.estimado,
    viajes: [...c._viajes],
    diasInternacional: c.diasInternacional,
    finDeSemana: c.finDeSemana,
    viajesAdr: c._viajesAdrSet.size,
    cargaDescargaChofer: c.cargaDescargaChofer,
    retenes: c.retenes,
  }));

  filas.sort((a, b) => b.km - a.km);

  return { filas, tieneBase, umbralKm: UMBRAL_NOCHE_FUERA_KM };
}

// ==========================================================================
// Viabilidad / margen de viaje (ítem 5.2)
// ==========================================================================

/**
 * Resuelve el coste/km a aplicar a un viaje, POR CAPAS: usa el dato más granular
 * disponible y cae al menos granular. v1: vehículo → empresa. (v2 añadirá el
 * desglose combustible/conductor/peajes como capas por delante, sin tocar esto.)
 * @returns {{costeKm: number|null, fuente: 'vehiculo'|'empresa'|null}}
 */
export function resolveCosteKm({ vehiculo, empresa }) {
  if (vehiculo && vehiculo.coste_km != null) return { costeKm: vehiculo.coste_km, fuente: "vehiculo" };
  if (empresa && empresa.coste_km != null) return { costeKm: empresa.coste_km, fuente: "empresa" };
  return { costeKm: null, fuente: null };
}

/**
 * Coste de una ruta desglosado por capas (ítem 7A.5): combustible real,
 * peajes, dietas y conductor, cada uno opcional según qué datos tenga
 * configurados la empresa/vehículo — "elige hasta dónde llega" poblando
 * datos (extiende la decisión de 5.2). Si no hay datos de combustible cae a
 * modo "blended" (el €/km único de 5.2), para no perder la funcionalidad
 * existente cuando la empresa aún no ha configurado el desglose. Pura.
 *
 * @returns {{ modo: "desglosado"|"blended"|null, combustible: number|null,
 *   conductor: number|null, peajes: number|null, dietas: number|null,
 *   total: number|null, capasFaltantes: string[] }}
 */
/**
 * `excluirConceptos` (18.D.5, 2026-07-24) — checkboxes de "Simulación" en
 * /presupuesto para excluir un concepto de ESTE cálculo puntual sin tocar la
 * configuración real de Ajustes. Pedido explícito del usuario: *"lo haría en
 * simulación con unos ticks que tú quieras incluir"*. El concepto se sigue
 * calculando y mostrando (para que se vea cuánto pesaba), solo se resta del
 * total -- no se confunde con "no configurado" (`capasFaltantes`), que es un
 * caso distinto (dato que falta, no dato que se decide ignorar).
 */
export function calcularCosteRuta({ km, noches = 0, vehiculo, empresa, excluirConceptos = [] }) {
  const excluir = new Set(excluirConceptos);
  const tieneCombustible = vehiculo?.consumo_l_100km != null && empresa?.precio_gasoil_litro != null;

  if (!tieneCombustible) {
    const { costeKm } = resolveCosteKm({ vehiculo, empresa });
    const total = costeKm != null ? +(km * costeKm).toFixed(2) : null;
    return {
      modo: total != null ? "blended" : null,
      combustible: null,
      conductor: null,
      peajes: null,
      dietas: null,
      total,
      capasFaltantes: [],
      excluidos: [],
    };
  }

  const combustible = +(km * (vehiculo.consumo_l_100km / 100) * empresa.precio_gasoil_litro).toFixed(2);
  const conductor = empresa?.coste_conductor_km != null ? +(km * empresa.coste_conductor_km).toFixed(2) : null;
  const peajes = empresa?.coste_peaje_km != null ? +(km * empresa.coste_peaje_km).toFixed(2) : null;
  const dietas = noches === 0 ? 0 : (empresa?.dieta_noche_eur != null ? +(noches * empresa.dieta_noche_eur).toFixed(2) : null);

  const capasFaltantes = [];
  if (conductor == null) capasFaltantes.push("conductor");
  if (peajes == null) capasFaltantes.push("peajes");
  if (dietas == null) capasFaltantes.push("dietas");

  const sumables = { combustible, conductor, peajes, dietas };
  const total = +Object.entries(sumables)
    .filter(([nombre, v]) => v != null && !excluir.has(nombre))
    .reduce((s, [, v]) => s + v, 0)
    .toFixed(2);

  return { modo: "desglosado", combustible, conductor, peajes, dietas, total, capasFaltantes, excluidos: [...excluir] };
}

// COT.4 — Camión completo (FTL) vs. grupaje: el estándar del sector mide la
// capacidad por TRES dimensiones a la vez (LDM, peso, volumen); la ocupación
// real la marca la que se llena primero. 85% es un valor inicial razonable,
// NO pactado con un cliente real (mismo estatus que UMBRAL_MARGEN_AMBAR_PCT).
export const UMBRAL_FTL_PCT = 85;

/**
 * @param {{ldm?: number, kg?: number, m3?: number}} carga
 * @param {{ldm?: number, kg?: number, m3?: number}} capacidad
 * @returns {{pctLdm: number|null, pctKg: number|null, pctM3: number|null,
 *   pctOcupacion: number|null, dimensionLimitante: "ldm"|"kg"|"m3"|null,
 *   tipo: "completo"|"grupaje"|"desconocido"}}
 */
export function calcularOcupacion(carga, capacidad) {
  const pcts = {};
  for (const dim of ["ldm", "kg", "m3"]) {
    const c = carga?.[dim];
    const cap = capacidad?.[dim];
    if (c != null && cap != null && cap > 0) {
      pcts[dim] = (c / cap) * 100;
    }
  }
  const dims = Object.keys(pcts);
  if (dims.length === 0) {
    return { pctLdm: null, pctKg: null, pctM3: null, pctOcupacion: null, dimensionLimitante: null, tipo: "desconocido" };
  }
  const dimensionLimitante = dims.reduce((max, d) => (pcts[d] > pcts[max] ? d : max), dims[0]);
  const pctOcupacion = pcts[dimensionLimitante];
  return {
    pctLdm: pcts.ldm ?? null,
    pctKg: pcts.kg ?? null,
    pctM3: pcts.m3 ?? null,
    pctOcupacion,
    dimensionLimitante,
    tipo: pctOcupacion >= UMBRAL_FTL_PCT ? "completo" : "grupaje",
    // 18.D.6: "que sea viable realmente hacerlo" -- si la dimensión que más
    // aprieta supera el 100%, la carga NO cabe en el vehículo asignado, no es
    // solo "está muy lleno". Antes esto solo se veía como una barra al 100%
    // sin distinguir "justo lleno" de "no cabe".
    excedeCapacidad: pctOcupacion > 100,
  };
}

/**
 * Margen de un viaje dado el ingreso (`precio`), los `km` y el `costeKm`.
 * Devuelve null en los campos que no se puedan calcular (falta precio, km o coste)
 * — no se inventa un número, para que la UI muestre "n/d" en vez de engañar.
 * @returns {{coste: number|null, margen: number|null, margenPct: number|null}}
 */
export function calcularMargen({ precio, km, costeKm }) {
  if (precio == null || km == null || costeKm == null) {
    return { coste: null, margen: null, margenPct: null };
  }
  const coste = km * costeKm;
  const margen = precio - coste;
  const margenPct = precio > 0 ? (margen / precio) * 100 : null;
  return { coste, margen, margenPct };
}

/**
 * Km por carretera real de un viaje: suma OSRM entre hitos consecutivos con
 * coordenadas, ordenados por `orden`. Para VIABILIDAD/ETA se usan TODOS los
 * hitos (ruta planificada); para NÓMINA el llamador filtra antes a los
 * completados. Devuelve km=0 si hay menos de 2 hitos con coordenadas.
 *
 * FALLBACK (ítem 6.1): si OSRM no responde para un tramo (self-host caído, sin
 * contenedor en dev), ese tramo se calcula con Haversine × FACTOR_SINUOSIDAD_FALLBACK
 * en vez de contarlo como 0 km (que es lo que pasaba antes — silenciosamente
 * subestimaba el viaje entero). `estimado: true` si ALGÚN tramo usó el fallback,
 * para que la UI lo marque como aproximado en vez de presentarlo como exacto.
 * @returns {Promise<{km: number, estimado: boolean}>}
 */
// Caché en memoria de kmCarreteraViaje (ítem 9.33): el mismo viaje se recalcula
// varias veces en una sesión (getResumenHoy hasta 20 en paralelo, getViabilidadViaje,
// nómina...) sin que sus hitos cambien entre medias. La clave es la firma de los
// hitos con coordenadas (orden+lat+lon) — si esa firma no cambia, el resultado de
// OSRM tampoco puede cambiar. TTL corto porque OSRM/tráfico real no cambia la
// distancia entre dos puntos fijos; solo se invalida por firma distinta o por edad.
const CACHE_KM_TTL_MS = 5 * 60 * 1000;
const _cacheKmCarretera = new Map();

function _firmaHitos(conCoords) {
  return conCoords.map((h) => `${h.orden}:${h.lat}:${h.lon}`).join("|");
}

export function _limpiarCacheKmCarreteraParaTests() {
  _cacheKmCarretera.clear();
}

export async function kmCarreteraViaje(hitos) {
  const conCoords = (hitos || [])
    .filter((h) => h.lat != null && h.lon != null)
    .sort((a, b) => a.orden - b.orden);

  const firma = _firmaHitos(conCoords);
  const cacheado = _cacheKmCarretera.get(firma);
  if (cacheado && Date.now() - cacheado.en < CACHE_KM_TTL_MS) {
    return cacheado.resultado;
  }

  let km = 0;
  let estimado = false;
  for (let i = 0; i < conCoords.length - 1; i++) {
    const origen = { lat: conCoords[i].lat, lon: conCoords[i].lon };
    const destino = { lat: conCoords[i + 1].lat, lon: conCoords[i + 1].lon };
    const d = await distanciaPorCarretera(origen, destino);
    if (d != null) {
      km += d;
    } else {
      km += haversineKm(origen, destino) * FACTOR_SINUOSIDAD_FALLBACK;
      estimado = true;
    }
  }
  const resultado = { km, estimado };
  _cacheKmCarretera.set(firma, { resultado, en: Date.now() });
  return resultado;
}

/**
 * Viabilidad/margen de un viaje. Junta precio (ingreso) + coste/km resuelto por
 * capas (vehículo→empresa) + km por carretera, y devuelve el margen. Lo que falte
 * se devuelve como null. Mismo patrón que getMetricas / getInformeNomina.
 */
export async function getViabilidadViaje(viajeId) {
  // Ítem 9.35: distinguir "no existe el viaje" (PGRST116, legítimo) de un
  // fallo real de lectura (cualquier otro error -> lanzar, no tragarlo como
  // "sin datos" -- confundirlo aquí se veía como "sin margen calculable" en
  // vez de un aviso de error real, el riesgo exacto que motivó 9.34/9.35).
  const { data: viaje, error: errorViaje } = await supabase
    .from("viaje")
    .select("id, precio, vehiculo_id")
    .eq("id", viajeId)
    .single();
  if (errorViaje && errorViaje.code !== "PGRST116") throw errorViaje;
  if (!viaje) return null;

  const [{ data: hitos, error: errorHitos }, { data: empresas, error: errorEmpresas }, vehiculoRes] = await Promise.all([
    supabase.from("hito").select("orden, lat, lon").eq("viaje_id", viajeId),
    supabase.from("empresa").select("coste_km, velocidad_planificacion_kmh, precio_gasoil_litro, coste_peaje_km, dieta_noche_eur, coste_conductor_km"),
    viaje.vehiculo_id
      ? supabase.from("vehiculo").select("coste_km, consumo_l_100km").eq("id", viaje.vehiculo_id).single()
      : Promise.resolve({ data: null }),
  ]);
  // hitos/empresa alimentan el cálculo entero de coste/margen: un fallo real
  // aquí no debe verse como "0 km"/"sin coste configurado". vehiculo es
  // opcional a propósito (cae a coste de empresa, caso de negocio legítimo).
  if (errorHitos) throw errorHitos;
  if (errorEmpresas) throw errorEmpresas;

  const empresa = (empresas || [])[0] || null;
  const vehiculo = vehiculoRes.data || null;
  const { costeKm, fuente } = resolveCosteKm({ vehiculo, empresa });
  const { km, estimado } = await kmCarreteraViaje(hitos || []);

  const velocidad = resolveVelocidadPlanificacion(empresa);
  const { descansos11h } = calcularEtaConParadas(km / velocidad);
  const desglose = calcularCosteRuta({ km, noches: descansos11h, vehiculo, empresa });

  // desglose.total ya cubre tanto el modo blended (mismo resultado que
  // calcularMargen con costeKm, ítem 5.2) como el desglosado (7A.5) — un único
  // cálculo de coste "real" en vez de dos en paralelo.
  const coste = desglose.total;
  const margen = coste != null && viaje.precio != null ? viaje.precio - coste : null;
  const margenPct = margen != null && viaje.precio > 0 ? (margen / viaje.precio) * 100 : null;

  return {
    precio: viaje.precio,
    km: Math.round(km),
    estimado,
    costeKm,
    fuenteCoste: fuente,
    coste: coste != null ? Math.round(coste) : null,
    margen: margen != null ? Math.round(margen) : null,
    margenPct: margenPct != null ? Math.round(margenPct) : null,
    desglose,
  };
}

// ==========================================================================
// Presupuestador instantáneo (ítem 7A.6) — "¿me sale a cuenta esta carga?"
// en menos de un minuto, sin crear el viaje.
// ==========================================================================

export const MARGEN_OBJETIVO_PCT_DEFAULT = 15; // valor inicial razonable, NO pactado con cliente real

/**
 * @param {{puntos: {lat:number, lon:number}[], vehiculoId?: string|null}} args
 * `puntos` en orden de paso (origen → ... → destino), mínimo 2 para tener algo que calcular.
 */
// COT.1 — overrides "what-if" del cotizador: fusiona valores hipotéticos
// (sube el gasoil, 78 km/h en vez de 75, otro margen) sobre la config REAL de
// empresa/vehículo, SIN tocar lo guardado. Pura. Solo aplica claves no-nulas;
// no muta los objetos originales. Mapeo clave override → columna.
export function aplicarOverridesPresupuesto(empresa, vehiculo, overrides) {
  if (!overrides) return { empresa, vehiculo };
  const e = { ...(empresa || {}) };
  const v = vehiculo ? { ...vehiculo } : vehiculo;
  const setE = (col, val) => { if (val != null) e[col] = val; };
  setE("velocidad_planificacion_kmh", overrides.velocidadKmh);
  setE("precio_gasoil_litro", overrides.precioGasoilLitro);
  setE("coste_km", overrides.costeKm);
  setE("coste_conductor_km", overrides.costeConductorKm);
  setE("coste_peaje_km", overrides.costePeajeKm);
  setE("dieta_noche_eur", overrides.dietaNocheEur);
  setE("margen_objetivo_pct", overrides.margenObjetivoPct);
  if (v && overrides.consumoL100km != null) v.consumo_l_100km = overrides.consumoL100km;
  return { empresa: e, vehiculo: v };
}

export async function calcularPresupuesto({ puntos, vehiculoId = null, overrides = null }) {
  const hitosFalsos = (puntos || []).map((p, i) => ({ ...p, orden: i + 1 }));

  if (hitosFalsos.length < 2) {
    return {
      km: 0, estimado: false, horasConduccion: 0, horasTotales: 0, paradas45min: 0, descansos11h: 0,
      noches: 0, coste: { modo: null, combustible: null, conductor: null, peajes: null, dietas: null, total: null, capasFaltantes: [] },
      precioSugerido: null, margenObjetivo: MARGEN_OBJETIVO_PCT_DEFAULT,
    };
  }

  const { km, estimado } = await kmCarreteraViaje(hitosFalsos);

  const [{ data: empresas, error: errorEmpresas }, vehiculoRes] = await Promise.all([
    supabase.from("empresa").select("velocidad_planificacion_kmh, coste_km, precio_gasoil_litro, coste_peaje_km, dieta_noche_eur, coste_conductor_km, margen_objetivo_pct"),
    vehiculoId
      ? supabase.from("vehiculo").select("coste_km, consumo_l_100km").eq("id", vehiculoId).single()
      : Promise.resolve({ data: null }),
  ]);
  // Ítem 9.35: empresa alimenta todo el presupuesto (velocidad, coste,
  // margen objetivo) -- un fallo real aquí no debe verse como "sin coste
  // configurado". vehiculo es opcional a propósito (cae a coste de empresa).
  if (errorEmpresas) throw errorEmpresas;
  const empresaReal = (empresas || [])[0] || null;
  const vehiculoReal = vehiculoRes.data || null;
  const { empresa, vehiculo } = aplicarOverridesPresupuesto(empresaReal, vehiculoReal, overrides);

  const velocidad = resolveVelocidadPlanificacion(empresa);
  const horasConduccion = km / velocidad;
  const eta = calcularEtaConParadas(horasConduccion);
  const noches = eta.descansos11h;

  const coste = calcularCosteRuta({ km, noches, vehiculo, empresa, excluirConceptos: overrides?.excluirConceptos || [] });

  const margenObjetivo = empresa?.margen_objetivo_pct ?? MARGEN_OBJETIVO_PCT_DEFAULT;
  const precioSugerido = coste.total != null
    ? +(coste.total / (1 - margenObjetivo / 100)).toFixed(2)
    : null;

  return {
    km: Math.round(km),
    estimado,
    horasConduccion: +horasConduccion.toFixed(1),
    horasTotales: +eta.horasTotales.toFixed(1),
    paradas45min: eta.paradas45min,
    descansos11h: eta.descansos11h,
    noches,
    coste,
    precioSugerido,
    margenObjetivo,
  };
}

/**
 * Panel de cálculo en vivo del wizard "Nuevo viaje" (ítem 7A.11): mismo
 * cálculo que el presupuestador (7A.6) más el margen del precio que el
 * gestor va introduciendo, para el semáforo del panel lateral. Composición
 * pura sobre `calcularPresupuesto`, sin duplicar el cálculo de coste.
 */
export async function calcularPanelViaje({ puntos, vehiculoId = null, precio = null }) {
  const presupuesto = await calcularPresupuesto({ puntos, vehiculoId });
  const costeTotal = presupuesto.coste.total;
  const margen = precio != null && costeTotal != null ? +(precio - costeTotal).toFixed(2) : null;
  const margenPct = margen != null && precio > 0 ? Math.round((margen / precio) * 100) : null;
  return { ...presupuesto, margen, margenPct };
}

// ==========================================================================
// Gastos del viaje (ítem 7A.7) — repostajes, peajes, multas, dietas reales.
// Base del P&L real (7A.8): comparar lo estimado con lo que de verdad costó.
// ==========================================================================

export async function getGastosViaje(viajeId) {
  const { data } = await supabase.from("gasto_viaje").select("*").eq("viaje_id", viajeId);
  return (data || []).sort((a, b) => (a.fecha || a.created_at) < (b.fecha || b.created_at) ? 1 : -1);
}

export async function createGastoViaje({ viajeId, tipo, importe, litros = null, descripcion = null, fecha = null, choferId = null, vehiculoId = null, fotoUrl = null, fotoHash = null }) {
  const empresaId = await getCurrentEmpresaId();
  const { data, error } = await supabase
    .from("gasto_viaje")
    .insert({
      empresa_id: empresaId,
      viaje_id: viajeId,
      chofer_id: choferId,
      vehiculo_id: vehiculoId,
      tipo,
      importe,
      litros,
      descripcion,
      fecha,
      foto_url: fotoUrl,          // ruta en el bucket 'documentos' (12.1), o null
      foto_hash_sha256: fotoHash, // SHA-256 de la imagen, evidencia con integridad
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteGastoViaje(id) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("gasto_viaje").delete().eq("id", id).eq("empresa_id", empresaId);
  if (error) throw error;
}

export async function getMultasPorChofer(choferId) {
  const { data } = await supabase.from("gasto_viaje").select("*").eq("chofer_id", choferId);
  const multas = (data || []).filter((g) => g.tipo === "multa").sort((a, b) => (a.fecha || a.created_at) < (b.fecha || b.created_at) ? 1 : -1);
  return { total: multas.reduce((s, m) => s + Number(m.importe), 0), ultimas: multas.slice(0, 5) };
}

export async function getMultasPorVehiculo(vehiculoId) {
  const { data } = await supabase.from("gasto_viaje").select("*").eq("vehiculo_id", vehiculoId);
  const multas = (data || []).filter((g) => g.tipo === "multa").sort((a, b) => (a.fecha || a.created_at) < (b.fecha || b.created_at) ? 1 : -1);
  return { total: multas.reduce((s, m) => s + Number(m.importe), 0), ultimas: multas.slice(0, 5) };
}

// ==========================================================================
// P&L real del viaje (ítem 7A.8) — compara lo estimado con lo que de verdad
// costó (gastos reales de 7A.7). Es la métrica que dice si el motor de
// costes (7A.5) acierta o no.
// ==========================================================================

export async function getPnlViaje(viajeId) {
  const [viabilidad, gastos] = await Promise.all([
    getViabilidadViaje(viajeId),
    getGastosViaje(viajeId),
  ]);

  const precio = viabilidad?.precio ?? null;
  const costeEstimado = viabilidad?.coste ?? null;
  const margenEstimado = viabilidad?.margen ?? null;
  const gastosReales = gastos.reduce((s, g) => s + Number(g.importe), 0);
  const margenReal = precio != null ? precio - gastosReales : null;
  const desviacionPct = (costeEstimado != null && costeEstimado !== 0 && gastos.length > 0)
    ? Math.round(((gastosReales - costeEstimado) / costeEstimado) * 100)
    : null;

  return {
    precio,
    costeEstimado,
    margenEstimado,
    gastosReales,
    margenReal,
    desviacionPct,
    numGastos: gastos.length,
  };
}

/**
 * Rentabilidad real de los viajes con precio en un rango: margen real
 * (precio − gastos reales agregados), no el estimado. La métrica clave es la
 * desviación media |real−estimado| — dice si el motor de costes (7A.5) es de
 * fiar o hay que ajustarlo.
 */
export async function getMetricasRentabilidad(rango = {}) {
  const { desde, hasta } = resolveRango(rango);
  const [{ data: viajes, error: errorViajes }, { data: empresas }] = await Promise.all([
    supabase.from("viaje").select("id, referencia, precio, created_at").gte("created_at", desde).lt("created_at", hasta),
    supabase.from("empresa").select("margen_objetivo_pct").limit(1),
  ]);
  // Ítem 9.35: un fallo real aquí no debe verse como "sin viajes en el
  // periodo" (0 viajes a pérdidas, margen medio null es un resultado
  // legítimo distinto de "la consulta falló").
  if (errorViajes) throw errorViajes;
  const margenObjetivoPct = empresas?.[0]?.margen_objetivo_pct != null ? Number(empresas[0].margen_objetivo_pct) : null;

  const conPrecio = (viajes || []).filter((v) => v.precio != null);

  const filas = await Promise.all(
    conPrecio.map(async (v) => {
      const pnl = await getPnlViaje(v.id);
      return { id: v.id, referencia: v.referencia || v.id.slice(0, 8), mes: (v.created_at || "").slice(0, 7), ...pnl };
    })
  );

  const conAmbos = filas.filter((f) => f.desviacionPct != null);
  const margenRealMedio = filas.length
    ? Math.round(filas.reduce((s, f) => s + (f.margenReal ?? 0), 0) / filas.length)
    : null;
  // Auditoría 2026-07-15 (mismo patrón que R4): margen_objetivo_pct
  // (Ajustes → Empresa) es un %, pero margenRealMedio es € -- no se pueden
  // comparar. margenRealMedioPct sí es directamente comparable (media de
  // margenReal/precio por viaje, no margenRealMedio€/precioMedio€, que
  // pesaría de más a los viajes caros).
  const conMargenPct = filas.filter((f) => f.margenReal != null && f.precio > 0);
  const margenRealMedioPct = conMargenPct.length
    ? Math.round(conMargenPct.reduce((s, f) => s + (f.margenReal / f.precio) * 100, 0) / conMargenPct.length)
    : null;
  const viajesAPerdidasReales = filas.filter((f) => f.margenReal != null && f.margenReal < 0).length;
  const desviacionMedia = conAmbos.length
    ? Math.round(conAmbos.reduce((s, f) => s + Math.abs(f.desviacionPct), 0) / conAmbos.length)
    : null;

  const ordenadas = [...filas].filter((f) => f.margenReal != null).sort((a, b) => b.margenReal - a.margenReal);

  // F13.4: margen estimado vs. real por mes, para el panel ejecutivo de
  // /analitica. Solo filas con AMBOS valores (mismo criterio que
  // `desviacionMedia`) entran en la media del mes -- comparar estimado de
  // unos viajes con real de otros distintos no sería honesto.
  const porMesAcc = {};
  filas.forEach((f) => {
    if (!f.mes || f.margenEstimado == null || f.margenReal == null) return;
    (porMesAcc[f.mes] ||= []).push(f);
  });
  const porMes = Object.keys(porMesAcc)
    .sort()
    .map((mes) => {
      const fs = porMesAcc[mes];
      const media = (campo) => Math.round(fs.reduce((s, f) => s + f[campo], 0) / fs.length);
      return { mes, margenEstimadoMedio: media("margenEstimado"), margenRealMedio: media("margenReal"), numViajes: fs.length };
    });

  return {
    margenRealMedio,
    margenRealMedioPct,
    margenObjetivoPct,
    viajesAPerdidasReales,
    desviacionMedia,
    // viajesConDesviacion (10.8): cuántos viajes tenían gastos reales Y coste
    // estimado a la vez -- el tamaño de muestra real de `desviacionMedia`,
    // para saber si esa media es de fiar o de 2 viajes sueltos.
    viajesConDesviacion: conAmbos.length,
    top5: ordenadas.slice(0, 5),
    bottom5: ordenadas.slice(-5).reverse(),
    porMes,
  };
}

/**
 * Versión ligera de `getMetricasRentabilidad` pensada solo para la campana de
 * notificaciones (R6): esta necesita `margenRealMedioPct`/`margenObjetivoPct`
 * para comparar contra el objetivo, nada más -- ni `top5`/`bottom5`/`porMes`
 * ni la desviación estimado-vs-real (que exige `getViabilidadViaje`, con sus
 * propias consultas de ruta/vehículo).
 *
 * Hallazgo 2026-07-15 (auditoría post-R6): `NotificationCenter` llamaba a
 * `getMetricasRentabilidad` completa en cada montaje/cambio de rol Y en cada
 * INSERT realtime de incidencia/evento para sesiones admin -- eso son
 * ~2N+2 idas a BD (una `getViabilidadViaje` + una `getGastosViaje` POR viaje
 * con precio) solo para una comparación de dos números. Esta versión hace 2
 * consultas en bloque (viajes del rango, gastos de esos viajes con `.in()`)
 * y suma en JS, sin N+1.
 */
export async function getAlertaMargen(rango = {}) {
  const { desde, hasta } = resolveRango(rango);
  const [{ data: viajes, error: errorViajes }, { data: empresas }] = await Promise.all([
    supabase.from("viaje").select("id, precio, created_at").gte("created_at", desde).lt("created_at", hasta),
    supabase.from("empresa").select("margen_objetivo_pct").limit(1),
  ]);
  if (errorViajes) throw errorViajes;
  const margenObjetivoPct = empresas?.[0]?.margen_objetivo_pct != null ? Number(empresas[0].margen_objetivo_pct) : null;

  const conPrecio = (viajes || []).filter((v) => v.precio != null && v.precio > 0);
  if (!conPrecio.length) return { margenRealMedioPct: null, margenObjetivoPct };

  const ids = conPrecio.map((v) => v.id);
  const { data: gastos } = await supabase.from("gasto_viaje").select("viaje_id, importe").in("viaje_id", ids);
  const gastosPorViaje = {};
  (gastos || []).forEach((g) => {
    gastosPorViaje[g.viaje_id] = (gastosPorViaje[g.viaje_id] || 0) + Number(g.importe);
  });

  const pcts = conPrecio.map((v) => {
    const margenReal = v.precio - (gastosPorViaje[v.id] || 0);
    return (margenReal / v.precio) * 100;
  });
  const margenRealMedioPct = Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length);

  return { margenRealMedioPct, margenObjetivoPct };
}

/**
 * F13.1 — Export para facturación/integración (NO módulo contable): una fila
 * plana por viaje completado, lista para CSV/Excel hacia la gestoría o un
 * ERP (SAP/similar). Composición pura sobre `getViabilidadViaje`/
 * `getGastosViaje`, ya existentes — sin query de negocio nueva.
 */
export async function getDatosFacturacion({ desde, hasta, clienteId = null } = {}) {
  const { desde: d, hasta: h } = resolveRango({ desde, hasta });
  let query = supabase
    .from("viaje")
    .select("id, referencia, created_at, cliente(nombre, cif)")
    .eq("estado", "completado")
    .gte("created_at", d)
    .lt("created_at", h);
  if (clienteId) query = query.eq("cliente_id", clienteId);
  const { data: viajes, error } = await query;
  if (error) throw error;

  return Promise.all((viajes || []).map(async (v) => {
    const [viabilidad, gastos] = await Promise.all([
      getViabilidadViaje(v.id),
      getGastosViaje(v.id),
    ]);
    const gastosPorTipo = {};
    for (const g of gastos) {
      gastosPorTipo[g.tipo] = (gastosPorTipo[g.tipo] || 0) + Number(g.importe);
    }
    const totalGastos = Object.values(gastosPorTipo).reduce((s, x) => s + x, 0);
    const margenReal = viabilidad?.precio != null ? +(viabilidad.precio - totalGastos).toFixed(2) : null;
    return {
      referencia: v.referencia || v.id.slice(0, 8),
      cliente: v.cliente?.nombre || null,
      clienteCif: v.cliente?.cif || null,
      fecha: v.created_at,
      km: viabilidad?.km ?? null,
      precio: viabilidad?.precio ?? null,
      costeEstimado: viabilidad?.coste ?? null,
      margenReal,
      repostaje: +((gastosPorTipo.repostaje || 0).toFixed(2)),
      peaje: +((gastosPorTipo.peaje || 0).toFixed(2)),
      multa: +((gastosPorTipo.multa || 0).toFixed(2)),
      dieta: +((gastosPorTipo.dieta || 0).toFixed(2)),
    };
  }));
}

// ==========================================================================
// Verdad observada (ítem 10.8) — registro histórico del error de estimación,
// base de datos del aprendizaje (Bloque I). Cada snapshot es una FOTO de un
// periodo: cuánto se desvió lo real de lo estimado, en los ejes ya
// calculables sin duplicar lógica de negocio en otro lenguaje (puntualidad,
// desviación de coste). El ratio de sinuosidad real (km OSRM/Haversine) se
// deja fuera a propósito: hoy no hay ninguna llamada que compare ambos
// valores para el mismo tramo -- se añadirá cuando 10.9 lo necesite de
// verdad, no de forma especulativa ahora. Tabla APPEND-ONLY (0046).
// ==========================================================================

/** Agrega puntualidad de TODOS los hitos con `ventana_fin` en el rango (no
 * de un solo viaje, a diferencia de getPlanVsReal). Mismo criterio de "hito
 * más reciente" que getMetricasPuntualidad. */
async function agregarPuntualidadPeriodo(desde, hasta) {
  // Fase 19.2 (2026-07-25, ver ROADMAP): `ejecucion_evento` pedía TODAS las
  // llegadas de la historia de la empresa, sin fecha ni `limit` -- esta tabla
  // crece con cada hito completado, para siempre. Con una flota grande supera
  // los 1000 filas del corte silencioso de PostgREST en semanas, no años, y
  // "% de hitos a tiempo" empezaría a calcularse sobre una muestra arbitraria.
  // Se acota por `ocurrido_en` igual que `hito` por `ventana_fin` -- misma
  // ventana temporal, un hito con ventana en el periodo llega casi siempre
  // dentro del mismo periodo.
  const [{ data: hitos }, { data: eventos }] = await Promise.all([
    supabase.from("hito").select("id, ventana_fin").gte("ventana_fin", desde).lt("ventana_fin", hasta),
    supabase.from("ejecucion_evento").select("hito_id, ocurrido_en").eq("tipo", "llegada").gte("ocurrido_en", desde).lt("ocurrido_en", hasta),
  ]);

  const llegadaPorHito = {};
  (eventos || []).forEach((e) => {
    const actual = llegadaPorHito[e.hito_id];
    if (!actual || e.ocurrido_en < actual) llegadaPorHito[e.hito_id] = e.ocurrido_en;
  });

  const deltas = [];
  (hitos || []).forEach((h) => {
    const llegada = h.ventana_fin ? llegadaPorHito[h.id] : null;
    if (llegada) deltas.push((new Date(llegada).getTime() - new Date(h.ventana_fin).getTime()) / 60000);
  });

  const aTiempo = deltas.filter((d) => d <= 0).length;
  return {
    numHitosConDatos: deltas.length,
    pctATiempo: deltas.length ? Math.round((aTiempo / deltas.length) * 100) : null,
    deltaMedioMin: deltas.length ? Math.round(deltas.reduce((s, d) => s + d, 0) / deltas.length) : null,
  };
}

/**
 * Calcula y GUARDA un snapshot de "verdad observada" para la empresa del
 * gestor logueado, del periodo dado (por defecto últimos 30 días -- una
 * cadencia mensual tiene más sentido de tendencia que los 90 días por
 * defecto del resto de /analitica). Sin scheduler que lo dispare solo
 * todavía (mismo criterio honesto que monitor_heartbeat.py/panel_salud.py):
 * hay que invocarlo manualmente (o desde una futura pantalla) hasta que
 * exista una cadencia programada.
 */
export async function crearSnapshotVerdadObservada(rango = {}) {
  const desde = rango.desde || new Date(Date.now() - 30 * 86400000).toISOString();
  const hasta = rango.hasta || new Date().toISOString();
  const empresaId = await getCurrentEmpresaId();

  const [puntualidad, rentabilidad] = await Promise.all([
    agregarPuntualidadPeriodo(desde, hasta),
    getMetricasRentabilidad({ desde, hasta }),
  ]);

  const { data, error } = await supabase
    .from("verdad_observada")
    .insert({
      empresa_id: empresaId,
      periodo_desde: desde,
      periodo_hasta: hasta,
      num_viajes_con_datos: puntualidad.numHitosConDatos + rentabilidad.viajesConDesviacion,
      pct_hitos_a_tiempo: puntualidad.pctATiempo,
      delta_llegada_medio_min: puntualidad.deltaMedioMin,
      desviacion_coste_pct_media: rentabilidad.desviacionMedia,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Histórico de snapshots de la empresa logueada, más reciente primero —
 * la "tendencia" que 10.9 (calibración) consumirá más adelante. */
export async function getTendenciaVerdadObservada(limite = 24) {
  const { data } = await supabase
    .from("verdad_observada")
    .select("*")
    .order("periodo_desde", { ascending: false })
    .limit(limite);
  return data || [];
}

// ==========================================================================
// Calibración de parámetros por empresa (ítem 10.9b, decisión 2026-07-12:
// N=20 viajes con datos, SIEMPRE suggestion-only — nunca se aplica sola).
// Compara velocidad real y coste/km real (los dos ejes calculables sin
// llamadas OSRM extra especulativas, mismo criterio que 10.8) contra los
// valores configurados en `empresa`, y los OFRECE como sugerencia. La
// mediana (no la media) se usa a propósito: un viaje atípico (atasco,
// avería) no debe arrastrar la sugerencia.
// ==========================================================================

const MIN_VIAJES_CALIBRACION_DEFAULT = 20;
const UMBRAL_DIFERENCIA_SUGERENCIA_PCT = 10; // no molestar por diferencias pequeñas/ruido

function mediana(valores) {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 !== 0
    ? ordenados[mitad]
    : (ordenados[mitad - 1] + ordenados[mitad]) / 2;
}

/**
 * Calcula (sin guardar nada) la sugerencia de calibración para la empresa
 * logueada. `minimoViajes`: por debajo de este umbral, `suficiente: false` —
 * ni se calcula ni se sugiere nada (evita sugerencias de 2 viajes sueltos).
 */
export async function getSugerenciaCalibracion({ minimoViajes = MIN_VIAJES_CALIBRACION_DEFAULT } = {}) {
  const [{ data: empresas }, { data: viajes }] = await Promise.all([
    supabase.from("empresa").select("id, velocidad_planificacion_kmh, coste_km, precio_gasoil_litro, coste_peaje_km, dieta_noche_eur"),
    supabase.from("viaje").select("id").eq("estado", "completado"),
  ]);
  const empresa = (empresas || [])[0] || null;
  const idsViajes = (viajes || []).map((v) => v.id);

  if (!empresa || idsViajes.length === 0) {
    return { suficiente: false, numViajesConDatos: 0, minimoViajes };
  }

  const [{ data: hitos }, { data: eventos }, { data: gastos }] = await Promise.all([
    supabase.from("hito").select("id, viaje_id, orden, estado, lat, lon").in("viaje_id", idsViajes),
    supabase.from("ejecucion_evento").select("viaje_id, tipo, ocurrido_en").eq("tipo", "llegada").in("viaje_id", idsViajes),
    supabase.from("gasto_viaje").select("viaje_id, importe, tipo, litros").in("viaje_id", idsViajes),
  ]);

  const gastosPorViaje = {};
  // 18.B.2: gastos reales por capa (gasoil/peaje/dieta) -- desglosados aparte
  // del total, para sugerir cada campo del coste desglosado por su cuenta.
  // "conductor" queda fuera a propósito: no hay ningún gasto_viaje de ese
  // tipo (es coste de nómina, no un gasto imputado al viaje), así que no hay
  // dato real del que tirar todavía.
  const muestrasGasoil = [];
  const muestrasDieta = [];
  const peajePorViaje = {};
  (gastos || []).forEach((g) => {
    gastosPorViaje[g.viaje_id] = (gastosPorViaje[g.viaje_id] || 0) + Number(g.importe);
    if (g.tipo === "repostaje" && g.litros > 0 && g.importe > 0) muestrasGasoil.push(Number(g.importe) / Number(g.litros));
    if (g.tipo === "dieta" && g.importe > 0) muestrasDieta.push(Number(g.importe));
    if (g.tipo === "peaje" && g.importe > 0) peajePorViaje[g.viaje_id] = (peajePorViaje[g.viaje_id] || 0) + Number(g.importe);
  });

  const muestrasVelocidad = [];
  const muestrasCosteKm = [];
  const muestrasPeajeKm = [];
  const viajesConAlgunDato = new Set();

  for (const viajeId of idsViajes) {
    const hitosViaje = (hitos || []).filter((h) => h.viaje_id === viajeId);
    const completados = hitosViaje.filter((h) => h.estado === "completado");
    if (completados.length < 2) continue;

    const { km } = await kmCarreteraViaje(completados);
    if (!km || km <= 0) continue;

    const llegadasViaje = (eventos || [])
      .filter((e) => e.viaje_id === viajeId)
      .map((e) => new Date(e.ocurrido_en).getTime())
      .sort((a, b) => a - b);
    if (llegadasViaje.length >= 2) {
      const horas = (llegadasViaje[llegadasViaje.length - 1] - llegadasViaje[0]) / 3600000;
      if (horas > 0) {
        muestrasVelocidad.push(km / horas);
        viajesConAlgunDato.add(viajeId);
      }
    }

    const gastosViaje = gastosPorViaje[viajeId];
    if (gastosViaje != null && gastosViaje > 0) {
      muestrasCosteKm.push(gastosViaje / km);
      viajesConAlgunDato.add(viajeId);
    }

    if (peajePorViaje[viajeId]) muestrasPeajeKm.push(peajePorViaje[viajeId] / km);
  }

  const numViajesConDatos = viajesConAlgunDato.size;
  if (numViajesConDatos < minimoViajes) {
    return { suficiente: false, numViajesConDatos, minimoViajes };
  }

  // ponytail: las 5 capas (velocidad/costeKm/gasoil/peaje/dieta) comparten
  // exactamente la misma forma {real, configurado, sugerir} -- un solo
  // helper en vez de repetir el cálculo de diferencia % y el objeto 5 veces.
  function capaSugerencia(real, configurado, decimales) {
    const factor = 10 ** decimales;
    const diffPct = real != null && configurado != null && configurado !== 0
      ? Math.abs((real - configurado) / configurado) * 100
      : null;
    return {
      real: real != null ? Math.round(real * factor) / factor : null,
      configurado: configurado ?? null,
      sugerir: diffPct != null && diffPct >= UMBRAL_DIFERENCIA_SUGERENCIA_PCT,
    };
  }

  return {
    suficiente: true,
    numViajesConDatos,
    minimoViajes,
    velocidad: capaSugerencia(mediana(muestrasVelocidad), empresa.velocidad_planificacion_kmh, 0),
    costeKm: capaSugerencia(mediana(muestrasCosteKm), empresa.coste_km, 2),
    // 18.B.2: mismo criterio -- solo sugerencia, nunca se sobreescribe solo.
    // null si no hay muestras de esa capa todavía (p.ej. ningún gasto de
    // tipo 'dieta' registrado).
    gasoil: capaSugerencia(mediana(muestrasGasoil), empresa.precio_gasoil_litro, 3),
    peaje: capaSugerencia(mediana(muestrasPeajeKm), empresa.coste_peaje_km, 2),
    dieta: capaSugerencia(mediana(muestrasDieta), empresa.dieta_noche_eur, 2),
  };
}

/** Variación porcentual de `actual` respecto a `anterior`. null si no se puede
 * calcular (falta alguno, o el anterior es 0 — dividir por cero no informa). */
function variacionPct(actual, anterior) {
  if (actual == null || anterior == null || anterior === 0) return null;
  return Math.round(((actual - anterior) / Math.abs(anterior)) * 100);
}

/**
 * Ítem 12.2 — controlling en el tiempo: compara el periodo actual (mismo rango
 * que el resto de /analitica) contra el periodo inmediatamente anterior de
 * igual duración, para las 3 métricas de mayor riesgo real (margen, viajes a
 * pérdidas, puntualidad). Pura agregación sobre `getMetricasRentabilidad`/
 * `getMetricasPuntualidad` ya existentes — no añade tablas ni cálculos nuevos.
 */
export async function getComparativaMensual(rango = {}) {
  const { desde, hasta } = resolveRango(rango);
  const duracionMs = new Date(hasta).getTime() - new Date(desde).getTime();
  const rangoAnterior = {
    desde: new Date(new Date(desde).getTime() - duracionMs).toISOString(),
    hasta: desde,
  };

  const [rentActual, rentAnterior, puntActual, puntAnterior, incActual, incAnterior] = await Promise.all([
    getMetricasRentabilidad({ desde, hasta }),
    getMetricasRentabilidad(rangoAnterior),
    getMetricasPuntualidad({ desde, hasta }),
    getMetricasPuntualidad(rangoAnterior),
    getMetricasIncidencias({ desde, hasta }),
    getMetricasIncidencias(rangoAnterior),
  ]);

  return {
    margenRealMedio: {
      actual: rentActual.margenRealMedio,
      anterior: rentAnterior.margenRealMedio,
      variacionPct: variacionPct(rentActual.margenRealMedio, rentAnterior.margenRealMedio),
    },
    viajesAPerdidasReales: {
      actual: rentActual.viajesAPerdidasReales,
      anterior: rentAnterior.viajesAPerdidasReales,
      variacionPct: variacionPct(rentActual.viajesAPerdidasReales, rentAnterior.viajesAPerdidasReales),
    },
    pctPuntualidad: {
      actual: puntActual.pctPuntualidad,
      anterior: puntAnterior.pctPuntualidad,
      variacionPct: variacionPct(puntActual.pctPuntualidad, puntAnterior.pctPuntualidad),
    },
    tasaIncidencias: {
      actual: incActual.tasa,
      anterior: incAnterior.tasa,
      variacionPct: variacionPct(incActual.tasa, incAnterior.tasa),
    },
  };
}

/**
 * Auditoría de código (2026-07-15, mismo patrón que R1/R2 de Fase 16):
 * `empresa.objetivo_puntualidad_pct` (Ajustes → Empresa) solo se usaba como
 * color pasivo en una card de `/analitica` — un gestor que no abre esa
 * pestaña nunca se entera de que el objetivo se está incumpliendo. Pura:
 * dado el resultado ya calculado de `getMetricasPuntualidad()` (que ya trae
 * `objetivoPuntualidadPct`, sin query nueva), decide si hay que alertar.
 * `null` si no hay objetivo configurado, o si se está cumpliendo.
 */
export function alertaObjetivoPuntualidad(metricas) {
  if (!metricas || metricas.objetivoPuntualidadPct == null || metricas.pctPuntualidad == null) return null;
  if (metricas.pctPuntualidad >= metricas.objetivoPuntualidadPct) return null;
  return { objetivo: metricas.objetivoPuntualidadPct, actual: metricas.pctPuntualidad };
}

/**
 * Auditoría de código (2026-07-15, mismo patrón que `alertaObjetivoPuntualidad`
 * y R1/R2 de Fase 16): `empresa.margen_objetivo_pct` no se leía en NINGÚN
 * sitio del bot, y en el dashboard solo alimentaba el precio sugerido del
 * presupuestador (hacia adelante) -- nunca se comparaba contra el margen
 * REAL ya conseguido. Pura: usa `margenRealMedioPct` (media de
 * margenReal/precio por viaje, no €/€ que sesgaría hacia los viajes caros).
 */
export function alertaObjetivoMargen(metricas) {
  if (!metricas || metricas.margenObjetivoPct == null || metricas.margenRealMedioPct == null) return null;
  if (metricas.margenRealMedioPct >= metricas.margenObjetivoPct) return null;
  return { objetivo: metricas.margenObjetivoPct, actual: metricas.margenRealMedioPct };
}

/**
 * R3 (Fase 16, 2026-07-15): informe ejecutivo para el jefe de tráfico —
 * compone (sin queries de negocio nuevas) las métricas que ya existen en un
 * único objeto plano pensado para imprimir/exportar, no para pintar cards
 * interactivas. `getMetricasPuntualidad`/`getMetricasRentabilidad` se piden
 * dos veces cada una (aquí y dentro de `getComparativaMensual`) porque son
 * funciones independientes ya usadas así en el resto de `/analitica` (mismo
 * criterio que el resto del proyecto: composición simple sobre datos ya
 * cacheables por Supabase, no una optimización prematura).
 */
export async function getInformeEjecutivo(rango = {}) {
  const { desde, hasta } = resolveRango(rango);
  const [puntualidad, rentabilidad, flota, comparativa, gestores] = await Promise.all([
    getMetricasPuntualidad({ desde, hasta }),
    getMetricasRentabilidad({ desde, hasta }),
    getMetricasFlota({ desde, hasta }),
    getComparativaMensual({ desde, hasta }),
    getRendimientoGestores({ desde, hasta }),
  ]);

  return { periodo: { desde, hasta }, puntualidad, rentabilidad, flota, comparativa, gestores };
}

// ==========================================================================
// Plan-vs-real por hito (ítem 7A.9) — para cada hito, la ventana planificada
// vs. la llegada real (evento de tipo "llegada"), con el delta en minutos.
// ==========================================================================

export async function getPlanVsReal(viajeId) {
  const [{ data: hitos }, { data: eventos }] = await Promise.all([
    supabase.from("hito").select("id, orden, ventana_fin").eq("viaje_id", viajeId),
    supabase.from("ejecucion_evento").select("hito_id, ocurrido_en").eq("tipo", "llegada").eq("viaje_id", viajeId),
  ]);

  const llegadaPorHito = {};
  (eventos || []).forEach((e) => {
    const actual = llegadaPorHito[e.hito_id];
    if (!actual || e.ocurrido_en < actual) llegadaPorHito[e.hito_id] = e.ocurrido_en;
  });

  const filas = (hitos || [])
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((h) => {
      const llegadaReal = llegadaPorHito[h.id] || null;
      let deltaMin = null;
      let estado = "sin_datos";
      if (h.ventana_fin && llegadaReal) {
        deltaMin = Math.round((new Date(llegadaReal).getTime() - new Date(h.ventana_fin).getTime()) / 60000);
        estado = deltaMin <= 0 ? "a_tiempo" : deltaMin <= 60 ? "tarde_leve" : "tarde";
      }
      return { hitoId: h.id, orden: h.orden, deltaMin, llegadaReal, estado };
    });

  const conVentana = filas.filter((f) => f.estado !== "sin_datos").length;
  const aTiempo = filas.filter((f) => f.estado === "a_tiempo").length;

  return { filas, resumen: { aTiempo, conVentana } };
}

// --- Validación de POD, capa barata (decisión 2026-07-13) ---
// Antes de pagar visión LLM por imagen (coste + riesgo de alucinación), cruzar
// señales que YA tenemos gratis: el POD se sube mucho después de la llegada
// confirmada al hito es una bandera de coherencia, no un veredicto. Solo AVISA
// (badge en la UI), nunca cambia estado_validacion por sí sola — mismo
// principio "sugerencia, nunca mutación silenciosa" que 10.8/10.9.
// 120 min es un valor inicial razonable, no pactado con un cliente real
// (mismo estatus que UMBRAL_MARGEN_AMBAR_PCT/UMBRAL_NOCHE_FUERA_KM).
export const UMBRAL_POD_TARDIO_MIN = 120;

// --- Triaje de urgencia de incidencias (7B.2, Nivel 2 de la escalera de captura) ---
//
// Decisión de diseño (2026-07-19): la investigación del sector da los TIPOS de
// incidencia habituales (mecánicas, operativas, climáticas, administrativas) pero
// NO existe una escala de urgencia estándar en transporte por carretera que se
// pueda implementar tal cual. Así que NO se inventa una escala subjetiva: la
// urgencia se DERIVA de hechos objetivos que el sistema ya tiene (ventana de
// entrega vencida, viaje en curso, incidencia ya escalada, tipo de incidencia).
//
// Se CALCULA en vivo, no se persiste: la urgencia de un retraso crece según se
// acerca la ventana, así que un valor congelado en el momento de crear la
// incidencia quedaría obsoleto en minutos.
//
// Devuelve `motivos` además del nivel: el gestor tiene derecho a saber POR QUÉ
// el sistema dice que algo es urgente (mismo principio de "sugerencia explicable,
// nunca caja negra" que 10.9b/sugerirChofer).
//
// Umbral inicial razonable, NO pactado con cliente real (mismo estatus que
// UMBRAL_POD_TARDIO_MIN / UMBRAL_MARGEN_AMBAR_PCT). El discovery con un gestor
// real lo afinará; el objetivo aquí es que deje de estar TODO al mismo nivel.
export const UMBRAL_VENTANA_EN_RIESGO_MIN = 120;

export function calcularUrgenciaIncidencia(incidencia, { hito = null, viaje = null, ahora = null } = {}) {
  if (!incidencia) return null;
  if (incidencia.estado === "resuelta") return { nivel: "baja", motivos: ["Resuelta"] };

  const ahoraMs = (ahora ? new Date(ahora) : new Date()).getTime();
  const viajeEnCurso = viaje?.estado === "en_curso";
  const motivos = [];
  let nivel = "baja";

  const subir = (n, motivo) => {
    motivos.push(motivo);
    const orden = { baja: 0, media: 1, alta: 2 };
    if (orden[n] > orden[nivel]) nivel = n;
  };

  // Seguridad de personas: no admite matices ni depende del contexto.
  if (incidencia.tipo === "accidente") subir("alta", "Accidente");

  // El sistema ya escaló (R1 nivel 2): nadie respondió en la ventana de gracia.
  if (incidencia.escalada_en) subir("alta", "Ya escalada al equipo");

  // Ventana de entrega: el hecho más objetivo que existe (contractual).
  const ventanaFin = hito?.ventana_fin ? new Date(hito.ventana_fin).getTime() : null;
  if (ventanaFin != null) {
    const minutosRestantes = Math.round((ventanaFin - ahoraMs) / 60000);
    if (minutosRestantes < 0) {
      subir("alta", `Ventana de entrega vencida hace ${Math.abs(minutosRestantes)} min`);
    } else if (minutosRestantes <= UMBRAL_VENTANA_EN_RIESGO_MIN) {
      subir("media", `Quedan ${minutosRestantes} min de ventana`);
    }
  }

  // Avería: bloquea el viaje si ya está rodando; si está planificado hay margen
  // para reasignar sin que nadie espere.
  if (incidencia.tipo === "averia") {
    subir(viajeEnCurso ? "alta" : "media", viajeEnCurso ? "Avería con viaje en curso" : "Avería (viaje aún planificado)");
  }

  // Bloqueos comerciales/administrativos: paran la entrega, pero no son seguridad.
  if (["rechazo_entrega", "documento_invalido"].includes(incidencia.tipo) && viajeEnCurso) {
    subir("media", incidencia.tipo === "rechazo_entrega" ? "Rechazo en entrega" : "Documento inválido en ruta");
  }

  if (motivos.length === 0) motivos.push("Sin señales de urgencia");
  return { nivel, motivos };
}

export function calcularDesfasePod(pod, eventos) {
  const llegada = (eventos || []).find((e) => e.tipo === "llegada" && e.hito_id === pod.hito_id);
  if (!llegada) return { minutos: null, tardio: false };
  const minutos = Math.round((new Date(pod.created_at).getTime() - new Date(llegada.ocurrido_en).getTime()) / 60000);
  return { minutos, tardio: minutos > UMBRAL_POD_TARDIO_MIN };
}

// ==========================================================================
// Onboarding (ítem 7A.13) — checklist guiado para una empresa recién creada.
// ==========================================================================

export async function getOnboardingEstado() {
  // Fase 19 (mismo patrón encontrado el 2026-07-25, ver ROADMAP): esto solo
  // necesita saber si "existe al menos 1" -- traía la tabla ENTERA (vehículo/
  // chófer/viaje) solo para mirar `.length > 0`. Con una empresa consolidada
  // (no recién dada de alta, que es cuando de verdad importa este checklist)
  // eso puede ser toda la flota histórica. `.limit(1)` basta: nunca hace
  // falta más de una fila para responder "sí/no".
  const [
    { data: vehiculos },
    { data: choferesTelegram },
    { data: choferes },
    { data: viajes },
    { data: empresas },
  ] = await Promise.all([
    supabase.from("vehiculo").select("id").limit(1),
    supabase.from("chofer").select("id").not("chat_id", "is", null).limit(1),
    supabase.from("chofer").select("id").limit(1),
    supabase.from("viaje").select("id").limit(1),
    supabase.from("empresa").select("coste_km, precio_gasoil_litro").limit(1),
  ]);

  const empresa = (empresas || [])[0] || null;

  const pasos = [
    { id: "vehiculo", done: (vehiculos || []).length > 0, label: "Añade tu primer vehículo", href: "/vehiculos" },
    { id: "chofer", done: (choferes || []).length > 0, label: "Añade tu primer chófer", href: "/choferes" },
    { id: "telegram", done: (choferesTelegram || []).length > 0, label: "Vincula un chófer a Telegram", href: "/choferes" },
    { id: "viaje", done: (viajes || []).length > 0, label: "Crea tu primer viaje", href: "/viajes/nuevo-w" },
    { id: "costes", done: !!(empresa?.coste_km != null || empresa?.precio_gasoil_litro != null), label: "Configura tus costes de operación", href: "/ajustes" },
  ];

  return { pasos, completado: pasos.every((p) => p.done) };
}

// ==========================================================================
// Portal de cliente — tracking público sin login (ítem 7A.14). El token es
// la única credencial (uuid impredecible, mismo patrón que usar_invitacion de
// 6.9); la lectura pasa SIEMPRE por la RPC SECURITY DEFINER `viaje_publico`,
// que solo expone referencia/estado/hitos/última posición aproximada — nunca
// precio, coste, nombre del chófer ni matrícula.
// ==========================================================================

export const DIAS_VALIDEZ_TOKEN_PUBLICO_DEFAULT = 30; // valor inicial razonable, NO pactado con cliente real

/** Genera (o regenera) el enlace público con caducidad — un enlace compartido
 * no debe vivir para siempre (8.5). `diasValidez` opcional para casos que
 * necesiten una ventana distinta (ej. un seguimiento puntual más corto). */
export async function generarTokenPublico(viajeId, { diasValidez = DIAS_VALIDEZ_TOKEN_PUBLICO_DEFAULT } = {}) {
  const empresaId = await getCurrentEmpresaId();
  const token = crypto.randomUUID();
  const expira = new Date(Date.now() + diasValidez * 86400000).toISOString();
  const { error } = await supabase
    .from("viaje")
    .update({ token_publico: token, token_publico_expira: expira })
    .eq("id", viajeId)
    .eq("empresa_id", empresaId);
  if (error) throw error;
  return { token, expira };
}

export async function revocarTokenPublico(viajeId) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase
    .from("viaje")
    .update({ token_publico: null, token_publico_expira: null })
    .eq("id", viajeId)
    .eq("empresa_id", empresaId);
  if (error) throw error;
}

export async function getViajePublico(token) {
  const { data, error } = await supabase.rpc("viaje_publico", { p_token: token });
  if (error) throw error;
  return data || null;
}

// ==========================================================================
// Health check del bot (ítem 8.3) — "el canal con el chófer nunca se cae en
// silencio": el bot inserta un latido cada 2 min (HEARTBEAT_INTERVAL_S en
// bot.py); si el último es más viejo que este umbral, algo va mal y hay que
// enterarse desde Ajustes, no cuando un chófer lleve horas sin poder reportar.
// ==========================================================================

export const UMBRAL_HEARTBEAT_S = 300; // 2.5x el intervalo del bot (120s) — valor inicial razonable

export async function getBotHeartbeat() {
  // Orden + limit(1) en el servidor: la tabla crece sin fin (una fila cada 2
  // min) y un select() sin acotar se trunca en el límite por defecto de
  // PostgREST (1000 filas) sin garantía de que sean las más recientes —
  // con más de ~33h de histórico esto hacía ver "SIN SEÑAL" con el bot vivo.
  const { data } = await supabase
    .from("bot_heartbeat")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  const ultimoLatido = data?.[0]?.created_at || null;
  const segundosDesdeUltimo = ultimoLatido
    ? Math.floor((Date.now() - new Date(ultimoLatido).getTime()) / 1000)
    : null;
  const activo = segundosDesdeUltimo != null && segundosDesdeUltimo < UMBRAL_HEARTBEAT_S;
  return { ultimoLatido, segundosDesdeUltimo, activo };
}

// ==========================================================================
// Audit log ligero (ítem 8.8) — quién cambió qué y cuándo. `entidad` sigue
// la misma convención de ámbito que `documento` (viaje/vehiculo/chofer).
// ==========================================================================

/** Nunca bloquea la acción que audita: si falla, se registra en consola y se
 * sigue (mismo criterio que registrarDecisionAsignacion, 7A.2). */
export async function registrarAuditoria({ entidad, entidadId, accion, detalle = {} }) {
  try {
    const empresaId = await getCurrentEmpresaId();
    const { data: { session } } = await supabase.auth.getSession();
    let gestorId = null;
    if (session?.user) {
      const { data: gestor } = await supabase.from("gestor").select("id").eq("auth_user_id", session.user.id).single();
      gestorId = gestor?.id || null;
    }
    await supabase.from("audit_log").insert(
      { empresa_id: empresaId, gestor_id: gestorId, entidad, entidad_id: entidadId, accion, detalle },
      { returning: "minimal" }
    );
  } catch (e) {
    console.error("registrarAuditoria falló (no bloqueante):", e);
  }
}

// audit_log es append-only (migración 0037): una entidad longeva puede acumular actividad
// sin límite. Se pide ordenado y acotado server-side en vez de traer todo y ordenar en JS —
// la pantalla de actividad (ítem 9.32) muestra un feed reciente, no un histórico completo.
export const LIMITE_AUDIT_LOG = 200;

export async function getAuditLog(entidad, entidadId) {
  const { data } = await supabase
    .from("audit_log")
    .select("id, accion, detalle, created_at, gestor:gestor_id(nombre)")
    .eq("entidad", entidad)
    .eq("entidad_id", entidadId)
    .order("created_at", { ascending: false })
    .limit(LIMITE_AUDIT_LOG);
  return data || [];
}

/**
 * Fase 23, 23.G.1 — mismo `audit_log` de 8.8, pero filtrado por AUTOR en vez de por
 * entidad: "qué ha cambiado esta persona", no "qué ha cambiado este viaje". Para el panel
 * de equipo (`AjustesEquipoSection.jsx`), donde el jefe de tráfico quiere ver la actividad
 * de un gestor concreto, no la de un viaje concreto. Se añade `entidad`/`entidad_id` al
 * select (no solo `accion`/`detalle`) porque aquí, a diferencia de la vista por viaje, no
 * hay contexto ya visible de a qué viaje/chófer pertenece cada entrada.
 */
export async function getAuditLogPorGestor(gestorId) {
  const { data } = await supabase
    .from("audit_log")
    .select("id, entidad, entidad_id, accion, detalle, created_at")
    .eq("gestor_id", gestorId)
    .order("created_at", { ascending: false })
    .limit(LIMITE_AUDIT_LOG);
  return data || [];
}

// ==========================================================================
// Parkings para camión (ítem 5.4)
// ==========================================================================

/**
 * Todos los parkings visibles para el gestor: el dataset abierto global
 * (fuente='dataset_abierto', empresa_id NULL — ver backend/db/seed_parking_abierto.py,
 * datos Fraunhofer/Zenodo CC-BY 4.0; NO es la certificación oficial SSTPA) más
 * los propios de su empresa (fuente='empresa'). RLS hace el filtrado real.
 */
// El mapa necesita el dataset completo (no es una lista paginable). Un límite duro de
// .limit() NO basta -- PostgREST corta en 1000 filas de todas formas (mismo hallazgo que
// Fase 19/getExportacionChofer); desde que el dataset abierto pasó de España (~763) a
// Europa (~19.700, ROADMAP 20.4) haría falta paginar sí o sí. LIMITE_PARKINGS_MAXIMO es
// una cota de seguridad (no un límite de query): si algún día el dataset se dispara por un
// error de seed, esto para de traer páginas en vez de descargar el planeta entero (9.32).
export const LIMITE_PARKINGS_MAXIMO = 50000;

export async function getParkings() {
  const filas = await traerTodasLasFilas(
    supabase.from("parking").select("id, nombre, tipo, lat, lon, confianza, fuente, notas, vigilado")
  );
  return filas.slice(0, LIMITE_PARKINGS_MAXIMO);
}

/**
 * ROADMAP 21.4: sedes de clientes para el mapa. No hay columna lat/lon en
 * `cliente` -- en vez de añadir un formulario de dirección nuevo (duplicaría
 * lo que ya existe), se reutilizan las direcciones que YA quedaron guardadas
 * en `hito` de los viajes de ese cliente (mismo espíritu que
 * getDireccionesGuardadas). Dedup por dirección, la más reciente gana.
 */
export async function getSedesClientes() {
  const { data } = await supabase
    .from("viaje")
    .select("cliente(nombre), hito(direccion, lat, lon, created_at)")
    .not("cliente_id", "is", null);

  const vistas = new Set();
  const sedes = [];
  for (const v of data || []) {
    const clienteNombre = v.cliente?.nombre;
    if (!clienteNombre) continue;
    for (const h of v.hito || []) {
      if (!h.direccion || h.lat == null || h.lon == null) continue;
      const clave = `${clienteNombre.trim().toLowerCase()}|${h.direccion.trim().toLowerCase()}`;
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      sedes.push({ clienteNombre, direccion: h.direccion, lat: h.lat, lon: h.lon });
    }
  }
  return sedes;
}

/**
 * ROADMAP 21.2: incidencias abiertas/en revisión, con el chófer al que
 * afectan (vía el viaje), para poder marcarlas sobre el mapa en vivo. La
 * reasignación de chófer/vehículo en sí YA EXISTE en `/viajes/[id]` (con
 * confirmación + auditoría) -- esto solo enlaza esa pantalla desde el mapa,
 * no duplica la lógica de reasignar.
 */
export async function getIncidenciasAbiertasParaMapa() {
  const { data } = await supabase
    .from("incidencia")
    .select("id, tipo, descripcion, created_at, viaje:viaje_id(id, referencia, chofer_id)")
    .in("estado", ALERTA_ESTADOS);
  return (data || [])
    .filter((i) => i.viaje?.chofer_id)
    .map((i) => ({
      id: i.id,
      tipo: i.tipo,
      descripcion: i.descripcion,
      viajeId: i.viaje.id,
      viajeReferencia: i.viaje.referencia,
      choferId: i.viaje.chofer_id,
    }));
}

/**
 * ROADMAP 21.1: parkings que caen "en el camino" de una ruta (lista de hitos
 * ordenados con lat/lon) -- un parking cuenta si está a `radioKm` o menos de
 * CUALQUIER hito de la ruta. Pura, sin red: filtro geométrico simple sobre
 * datos ya cargados, no hace falta OSRM para esto (es una vista orientativa,
 * no un cálculo de facturación).
 */
export function calcularParkingsEnRuta(parkings, hitosRuta, radioKm = 20) {
  const puntos = (hitosRuta || []).filter((h) => h.lat != null && h.lon != null);
  if (!puntos.length) return [];
  return (parkings || []).filter((p) => {
    if (p.lat == null || p.lon == null) return false;
    return puntos.some((h) => haversineKm({ lat: p.lat, lon: p.lon }, { lat: h.lat, lon: h.lon }) <= radioKm);
  });
}

// ==========================================================================
// Derechos ARCO (ítem 9.15 — ver PRIVACIDAD-ARCO.md para el procedimiento
// completo y la tensión con la cadena de custodia de 9.6-9.8)
// ==========================================================================

/**
 * Derecho de ACCESO: recopila todo lo que el esquema real tiene ligado a un
 * chófer, tal cual existe hoy. Solo lectura, sin privilegios especiales.
 */
/**
 * Fase 19.5 (2026-07-25, ver ROADMAP): a diferencia del resto de la Fase 19
 * (donde un `limit` defensivo basta porque son vistas/KPIs), esto es un
 * export de derechos ARCO (RGPD) -- aquí "casi todo" no vale, tiene que ser
 * TODO. `ubicacion` es la tabla de riesgo real: un chófer en activo genera
 * un ping GPS cada pocos minutos, así que su historial supera las 1000 filas
 * del corte silencioso de PostgREST en cuestión de días de trabajo, no de
 * años. Pagina de verdad en vez de limitar.
 */
async function traerTodasLasFilas(query, pageSize = 1000) {
  const filas = [];
  let desde = 0;
  for (;;) {
    const { data, error } = await query.range(desde, desde + pageSize - 1);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < pageSize) break;
    desde += pageSize;
  }
  return filas;
}

export async function getExportacionChofer(choferId) {
  const [chofer, viajes, ubicaciones, valoraciones, documentos, decisiones] = await Promise.all([
    supabase.from("chofer").select("*").eq("id", choferId).single(),
    supabase.from("viaje").select("id, referencia, estado, created_at").eq("chofer_id", choferId),
    traerTodasLasFilas(supabase.from("ubicacion").select("lat, lon, velocidad, rumbo, created_at").eq("chofer_id", choferId).order("created_at")),
    supabase.from("valoracion").select("puntuacion, nota, created_at, viaje_id").eq("chofer_id", choferId),
    supabase.from("documento").select("tipo, fecha_emision, fecha_caducidad, estado, created_at").eq("ambito", "chofer").eq("entidad_id", choferId),
    supabase.from("decision_asignacion").select("viaje_id, siguio_sugerencia, motivo, created_at").or(`chofer_sugerido_id.eq.${choferId},chofer_elegido_id.eq.${choferId}`),
  ]);
  return {
    chofer: chofer.data || null,
    viajes: viajes.data || [],
    ubicaciones,
    valoraciones: valoraciones.data || [],
    documentos: documentos.data || [],
    decisiones: decisiones.data || [],
  };
}

/**
 * Derechos de CANCELACIÓN/OPOSICIÓN: borra/anonimiza lo que SÍ se puede
 * tocar sin romper la cadena de custodia ni chocar con los GRANT de columna
 * de 0019 (ver PRIVACIDAD-ARCO.md §3 para la tensión completa):
 *  - `documento` (licencia/CAP del chófer): se borra por completo.
 *  - `chofer.nombre`/`telefono`: se anonimizan (únicas columnas de `chofer`
 *    que el dashboard puede escribir, 0019).
 * NO toca (a propósito, documentado, no un olvido):
 *  - `chofer.chat_id`: el dashboard no tiene permiso de escritura (0019).
 *  - `ubicacion`: el dashboard tiene REVOKE total de escritura (0019); un
 *    borrado inmediato requiere `backend/db/purgar_ubicacion.py` con
 *    DATABASE_URL, no esta función.
 *  - `ejecucion_evento`/`pod`: tocar su `chofer_id` invalidaría el hash
 *    guardado (9.6-9.8) — indistinguible de una manipulación real.
 *  - `valoracion`/`decision_asignacion`: registros de la empresa sobre su
 *    propia operación, se dejan intactos a propósito (pendiente de 9.11).
 */
export async function anonimizarChofer(choferId) {
  const empresaId = await getCurrentEmpresaId();
  const { error: errorDocumento } = await supabase
    .from("documento")
    .delete()
    .eq("ambito", "chofer")
    .eq("entidad_id", choferId)
    .eq("empresa_id", empresaId);
  if (errorDocumento) throw errorDocumento;

  const { error } = await supabase
    .from("chofer")
    .update({ nombre: "Chófer eliminado a petición propia", telefono: null })
    .eq("id", choferId)
    .eq("empresa_id", empresaId);
  if (error) throw error;
}

/** Alta de un parking propio de la empresa (su mapa curado). */
export async function createParkingPropio({ nombre, tipo, lat, lon, notas, vigilado = null }) {
  const empresaId = await getCurrentEmpresaId();
  const { data, error } = await supabase
    .from("parking")
    .insert({
      empresa_id: empresaId,
      nombre: nombre.trim(),
      tipo: tipo || "parking",
      lat,
      lon,
      notas: notas?.trim() || null,
      fuente: "empresa",
      vigilado,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Borra un parking propio. RLS impide borrar los del dataset abierto. */
export async function deleteParkingPropio(id) {
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("parking").delete().eq("id", id).eq("empresa_id", empresaId);
  if (error) throw error;
}

export async function getChoferes() {
  const { data } = await supabase
    .from("chofer")
    .select("id, nombre, idioma, chat_id")
    .order("created_at", { ascending: false });
  return data || [];
}

/**
 * Fase 1 del bot de llamadas (SPECS-BOT-LLAMADAS.md, 2026-07-14): normaliza
 * un teléfono a E.164 (+34600111222) para poder identificar al chófer por
 * Caller ID el día que exista un canal de voz. Pura. Devuelve null si está
 * vacío o no tiene pinta de teléfono real (evita guardar basura en
 * silencio — el llamador decide si eso es un error o simplemente "sin
 * teléfono").
 */
export function normalizarTelefonoE164(telefono, prefijoDefault = "+34") {
  if (telefono == null) return null;
  let t = telefono.toString().trim().replace(/[\s\-().]/g, "");
  if (t === "") return null;
  if (t.startsWith("00")) t = "+" + t.slice(2);
  if (!t.startsWith("+")) t = prefijoDefault + t.replace(/^0+/, "");
  return /^\+[1-9]\d{7,14}$/.test(t) ? t : null;
}

export async function createChofer({ nombre, idioma, telefono = null }) {
  const empresa_id = await getCurrentEmpresaId();
  // C.2: nunca "sin asignar", ni siquiera si lo crea el admin -- ver
  // gestorIdComoAutor(). El jefe de tráfico redistribuye después si hace falta.
  const gestor_id = await gestorIdComoAutor();
  let telefonoNormalizado = null;
  if (telefono != null && telefono.toString().trim() !== "") {
    telefonoNormalizado = normalizarTelefonoE164(telefono);
    if (!telefonoNormalizado) throw new Error("el teléfono no parece válido");
  }
  const { data, error } = await supabase
    .from("chofer")
    .insert({ nombre, idioma: idioma || "es", telefono: telefonoNormalizado, empresa_id, gestor_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Editar el teléfono de un chófer ya existente (ficha `/choferes/[id]`).
 * Vacío borra el teléfono (null); si no, se normaliza igual que en el alta. */
export async function guardarTelefonoChofer(choferId, telefonoStr) {
  const t = (telefonoStr ?? "").toString().trim();
  const normalizado = t === "" ? null : normalizarTelefonoE164(t);
  if (t !== "" && !normalizado) throw new Error("el teléfono no parece válido");
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("chofer").update({ telefono: normalizado }).eq("id", choferId).eq("empresa_id", empresaId);
  if (error) throw error;
}

/**
 * Ciudad de residencia del chófer (migración 0078) -- el punto de partida para
 * el "parámetro a tener en cuenta" que pidió el usuario viendo el Planificador
 * vacío: la restricción real de "vuelta a casa el fin de semana"
 * (DISCOVERY.md, retorno a casa como restricción dura). Solo el dato por
 * ahora -- el algoritmo de restricción sobre él es un ítem de planificación
 * aparte, no se improvisa aquí.
 */
export async function guardarCiudadResidenciaChofer(choferId, ciudadStr) {
  const c = (ciudadStr ?? "").toString().trim();
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("chofer").update({ ciudad_residencia: c || null }).eq("id", choferId).eq("empresa_id", empresaId);
  if (error) throw error;
}

/** 17.G.10 (2026-07-23): el gestor guarda su propio teléfono para que el bot
 * pueda ofrecer al chófer un botón de "llamada urgente" además del mensaje de
 * texto/voz normal -- pedido explícito del usuario ("en caso de emergencia
 * hablar por teléfono es clave"). Mismo patrón de validación que el chófer. */
export async function guardarTelefonoGestor(gestorId, telefonoStr) {
  const t = (telefonoStr ?? "").toString().trim();
  const normalizado = t === "" ? null : normalizarTelefonoE164(t);
  if (t !== "" && !normalizado) throw new Error("el teléfono no parece válido");
  const empresaId = await getCurrentEmpresaId();
  const { error } = await supabase.from("gestor").update({ telefono: normalizado }).eq("id", gestorId).eq("empresa_id", empresaId);
  if (error) throw error;
  return normalizado;
}

/**
 * IMP.2 — mismo patrón que `createChofer`, usada tanto por el alta manual
 * (`/vehiculos`) como por el importador masivo. No comprueba duplicados de
 * matrícula aquí (no hay constraint UNIQUE en la BD) — el llamador decide
 * (el alta manual ya comprueba contra su lista cargada; el importador no,
 * a propósito, ver "FUERA DE ESTE LOOP" en SPECS-IMPORTADOR-MASIVO.md).
 */
export async function createVehiculo({ matricula, tipo = "tractora", marca = null, modelo = null }) {
  const mat = (matricula || "").trim().toUpperCase();
  if (!mat) throw new Error("la matrícula no puede estar vacía");
  const empresa_id = await getCurrentEmpresaId();
  const { data, error } = await supabase
    .from("vehiculo")
    .insert({ matricula: mat, tipo: tipo || "tractora", marca: (marca || "").toString().trim() || null, modelo: (modelo || "").toString().trim() || null, empresa_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// --- Validaciones de conflicto ---

/**
 * Conflicto de un recurso físico (chófer/vehículo/remolque) ya asignado a
 * OTRO viaje activo. Hallazgo real (2026-07-22): antes esto SIEMPRE era un
 * aviso, ni siquiera cuando el otro viaje estaba "en_curso" ahora mismo —
 * físicamente imposible (un camión no puede estar en dos sitios a la vez).
 * Distingue el caso real: si el conflicto es con un viaje "en_curso",
 * `bloqueante=true` (se convierte en error, no deja crear el viaje); si es
 * con uno solo "planificado" (a futuro, aún sin arrancar), se queda en aviso
 * — es la forma normal de planificar con antelación el siguiente viaje de un
 * camión antes de que el actual arranque.
 */
async function checkConflictoRecurso(campo, valorId, excluirViajeId, etiqueta) {
  if (!valorId) return null;
  let query = supabase
    .from("viaje")
    .select("id, referencia, estado")
    .eq(campo, valorId)
    .in("estado", ESTADOS_ACTIVOS);
  if (excluirViajeId) query = query.neq("id", excluirViajeId);
  const { data } = await query.order("estado").limit(1).single();
  if (!data) return null;
  const ref = data.referencia || data.id.slice(0, 8);
  const bloqueante = data.estado === "en_curso";
  return {
    mensaje: bloqueante
      ? `${etiqueta} ya está EN CURSO en el viaje ${ref} ahora mismo — no puede estar en dos viajes a la vez`
      : `${etiqueta} ya está planificado en el viaje ${ref} (todavía no ha arrancado)`,
    bloqueante,
  };
}

async function checkConflictoChofer(choferId, excluirViajeId) {
  return checkConflictoRecurso("chofer_id", choferId, excluirViajeId, "Este chófer");
}

async function checkConflictoVehiculo(vehiculoId, excluirViajeId) {
  return checkConflictoRecurso("vehiculo_id", vehiculoId, excluirViajeId, "Este vehículo");
}

async function checkConflictoRemolque(remolqueId, excluirViajeId) {
  return checkConflictoRecurso("remolque_id", remolqueId, excluirViajeId, "Este remolque");
}

async function checkReferenciaDuplicada(referencia, excluirViajeId) {
  if (!referencia) return null;
  let query = supabase
    .from("viaje")
    .select("id")
    .eq("referencia", referencia);
  if (excluirViajeId) query = query.neq("id", excluirViajeId);
  const { data } = await query.limit(1).single();
  if (data) return `Ya existe un viaje con referencia "${referencia}"`;
  return null;
}

/**
 * Referencia sugerida para un viaje nuevo (2026-07-22, hallazgo real: no tiene
 * sentido pedirle al gestor que se invente una referencia a mano cada vez).
 * Correlativo simple `VJ-0001`, `VJ-0002`... por empresa, basado en cuántos
 * viajes existen ya. Es una SUGERENCIA prellenada, no un campo bloqueado: el
 * gestor puede seguir editándola (algunas empresas ya tienen su propia
 * numeración de un TMS anterior y quieren mantenerla).
 */
export async function getReferenciaSugerida() {
  const { data } = await supabase.from("viaje").select("id");
  return `VJ-${String((data || []).length + 1).padStart(4, "0")}`;
}

export async function validarAsignacion({ choferId, vehiculoId, remolqueId, referencia, excluirViajeId }) {
  const avisos = [];
  const errores = [];

  const [confChofer, confVeh, confRem, confRef] = await Promise.all([
    checkConflictoChofer(choferId, excluirViajeId),
    checkConflictoVehiculo(vehiculoId, excluirViajeId),
    checkConflictoRemolque(remolqueId, excluirViajeId),
    checkReferenciaDuplicada(referencia, excluirViajeId),
  ]);

  for (const conf of [confChofer, confVeh, confRem]) {
    if (!conf) continue;
    (conf.bloqueante ? errores : avisos).push(conf.mensaje);
  }
  if (confRef) errores.push(confRef);

  if (vehiculoId) {
    const { data: veh } = await supabase.from("vehiculo").select("activo").eq("id", vehiculoId).single();
    if (veh && !veh.activo) errores.push("El vehículo seleccionado está inactivo");
  }
  if (remolqueId) {
    const { data: rem } = await supabase.from("vehiculo").select("activo").eq("id", remolqueId).single();
    if (rem && !rem.activo) errores.push("El remolque seleccionado está inactivo");
  }

  return { avisos, errores, ok: errores.length === 0 };
}

// Documentación legalmente obligatoria antes de arrancar un viaje (confirmado
// con el usuario 2026-07-04): ITV, seguro y autorización de transporte del
// vehículo; licencia de conducir y CAP del chófer. Se exige que exista Y esté
// vigente (sin fecha_caducidad, o con fecha_caducidad todavía no pasada) — un
// documento caducado cuenta como si no existiera. No se exige nada del
// ámbito "viaje" (CMR/albarán/ADR): esos se generan durante la ejecución, no
// antes de arrancar.
const DOCS_OBLIGATORIOS_VEHICULO = ["itv", "seguro", "autorizacion_transporte"];
const DOCS_OBLIGATORIOS_CHOFER = ["licencia", "cap"];

/** Tipos de `tiposRequeridos` que faltan o están caducados para esa entidad. */
async function documentosFaltantes(ambito, entidadId, tiposRequeridos) {
  if (!entidadId) return tiposRequeridos;
  const hoy = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("documento")
    .select("tipo, fecha_caducidad")
    .eq("ambito", ambito)
    .eq("entidad_id", entidadId);

  const vigentes = new Set();
  (data || []).forEach((d) => {
    if (!tiposRequeridos.includes(d.tipo)) return;
    if (!d.fecha_caducidad || d.fecha_caducidad >= hoy) vigentes.add(d.tipo);
  });
  return tiposRequeridos.filter((t) => !vigentes.has(t));
}

export async function validarCambioEstado(viajeId, nuevoEstado) {
  const errores = [];

  if (nuevoEstado === "completado") {
    const { data: hitos } = await supabase
      .from("hito")
      .select("id, estado")
      .eq("viaje_id", viajeId);
    const pendientes = (hitos || []).filter((h) => h.estado !== "completado");
    if (pendientes.length > 0) {
      errores.push(`Quedan ${pendientes.length} hito(s) sin completar`);
    }
  }

  if (nuevoEstado === "en_curso") {
    const { data: viaje } = await supabase
      .from("viaje")
      .select("chofer_id, vehiculo_id")
      .eq("id", viajeId)
      .single();
    if (!viaje?.chofer_id) {
      errores.push("No se puede poner en curso sin chófer asignado");
    } else {
      const faltantesChofer = await documentosFaltantes("chofer", viaje.chofer_id, DOCS_OBLIGATORIOS_CHOFER);
      if (faltantesChofer.length > 0) {
        const labels = faltantesChofer.map((t) => TIPOS_DOC_CHOFER.find((x) => x.value === t)?.label || t);
        errores.push(`Documentación del chófer incompleta o caducada: ${labels.join(", ")}`);
      }
    }
    if (viaje?.vehiculo_id) {
      const faltantesVehiculo = await documentosFaltantes("vehiculo", viaje.vehiculo_id, DOCS_OBLIGATORIOS_VEHICULO);
      if (faltantesVehiculo.length > 0) {
        const labels = faltantesVehiculo.map((t) => TIPOS_DOC_VEHICULO.find((x) => x.value === t)?.label || t);
        errores.push(`Documentación del vehículo incompleta o caducada: ${labels.join(", ")}`);
      }
    }
  }

  return { errores, ok: errores.length === 0 };
}

export async function createViaje({ referencia, choferId, vehiculoId, remolqueId, hitos, precio = null, clienteId = null, carga = null }) {
  const validacion = await validarAsignacion({ choferId, vehiculoId, remolqueId, referencia });
  if (!validacion.ok) {
    throw new Error(validacion.errores.join(". "));
  }

  const empresa_id = await getCurrentEmpresaId();
  const gestor_id = await gestorIdPorDefecto();
  // CARGA.2: cierra el círculo de COT.3/4 -- la carga real del viaje (LDM/kg/
  // m3), antes solo capturada en la calculadora standalone. Retrocompatible:
  // sin `carga`, las 3 columnas salen null igual que hoy.
  const num = (v) => (v !== undefined && v !== "" && v != null ? Number(v) : null);

  // 18.A.2 (caso b): si la viabilidad no da 100% (ventanas horarias
  // imposibles con descansos legales, ya calculado por calcularAvisosViabilidad),
  // el viaje NO se planifica solo -- nace 'pendiente_aprobacion' y se abre una
  // solicitud para el jefe de tráfico, en vez de dejarlo pasar en silencio.
  const avisosViabilidad = calcularAvisosViabilidad(hitos || []);
  const estadoInicial = avisosViabilidad.length > 0 ? "pendiente_aprobacion" : "planificado";

  const { data: viaje, error } = await supabase
    .from("viaje")
    .insert({
      referencia: referencia || null,
      chofer_id: choferId || null,
      vehiculo_id: vehiculoId || null,
      remolque_id: remolqueId || null,
      cliente_id: clienteId || null,
      empresa_id,
      gestor_id,
      estado: estadoInicial,
      precio: precio != null ? precio : null,
      carga_ldm: num(carga?.ldm),
      carga_kg: num(carga?.kg),
      carga_m3: num(carga?.m3),
      valor_mercancia_eur: num(carga?.valorMercancia),
    })
    .select()
    .single();
  if (error) throw error;

  // ROADMAP 20.6: aviso si la carga declarada supera el seguro de la empresa.
  let avisoSeguro = null;
  if (viaje.valor_mercancia_eur != null) {
    const { data: empresaRow } = await supabase
      .from("empresa").select("valor_asegurado_maximo_eur").eq("id", empresa_id).single();
    avisoSeguro = calcularAvisoSeguroCarga(viaje.valor_mercancia_eur, empresaRow?.valor_asegurado_maximo_eur ?? null);
  }

  if (avisosViabilidad.length > 0) {
    await supabase.from("solicitud_aprobacion").insert({
      empresa_id,
      tipo: "viabilidad_baja",
      entidad: "viaje",
      entidad_id: viaje.id,
      motivo: avisosViabilidad.map((a) => a.mensaje).join(" / "),
      solicitado_por: await gestorIdComoAutor(),
    });
  }

  const validos = (hitos || []).filter((h) => h.direccion || h.tipo);
  if (validos.length) {
    const rows = validos.map((h, i) => ({
      viaje_id: viaje.id,
      orden: i + 1,
      tipo: h.tipo,
      direccion: h.direccion || null,
      // lat/lon opcionales (7A.11: el wizard los captura para el panel de
      // cálculo en vivo; /viajes/nuevo no los manda y sigue guardando null,
      // igual que antes).
      lat: h.lat !== undefined && h.lat !== "" && h.lat != null ? Number(h.lat) : null,
      lon: h.lon !== undefined && h.lon !== "" && h.lon != null ? Number(h.lon) : null,
      ventana_inicio: h.ventana_inicio || null,
      ventana_fin: h.ventana_fin || null,
      estado: "pendiente",
      // CHK.2: checkpoint = punto de control detectado por GPS, sin botón ni
      // POD. Retrocompatible: si el llamador no manda estos campos (código
      // existente), sale false/null, igual que hoy.
      es_checkpoint: !!h.es_checkpoint,
      radio_m: h.radio_m !== undefined && h.radio_m !== "" && h.radio_m != null ? Number(h.radio_m) : null,
    }));
    await supabase.from("hito").insert(rows);
  }
  return { viaje, avisos: validacion.avisos, pendienteAprobacion: avisosViabilidad.length > 0, avisoSeguro };
}
