import { supabase } from "./supabase";
import { distanciaPorCarretera } from "./osrm";

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
      horasTotales += PAUSA_DURACION_H;
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

export async function getViajes() {
  const { data: viajes, error } = await supabase
    .from("viaje")
    .select("*, chofer(nombre, idioma), hito(id, estado, tipo, direccion, orden)")
    .order("created_at", { ascending: false });

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

// ==========================================================================
// Invitaciones multi-gestor (ítem 6.9)
// ==========================================================================

/** Invitaciones pendientes/usadas de la empresa del gestor logueado. */
export async function getInvitaciones() {
  const { data } = await supabase
    .from("invitacion")
    .select("id, email, codigo, usada_at, created_at")
    .order("created_at", { ascending: false });
  return data || [];
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
  await supabase.from("invitacion").delete().eq("id", id);
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

  const { data } = await supabase.from("documento").select("*");
  const rows = (data || []).filter((d) => d.fecha_caducidad && d.fecha_caducidad <= limiteStr);
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
  const [{ data: hitos }, { data: tarde }, { data: viajes }] = await Promise.all([
    supabase.from("hito").select("id, viaje_id, ventana_fin").gte("ventana_fin", desde).lt("ventana_fin", hasta),
    supabase.from("incidencia").select("id, viaje_id, created_at").eq("tipo", "fuera_de_ventana").gte("created_at", desde).lt("created_at", hasta),
    supabase.from("viaje").select("id, referencia"),
  ]);

  const totalConVentana = (hitos || []).filter((h) => h.ventana_fin).length;
  const totalTarde = (tarde || []).length;
  const pctPuntualidad = totalConVentana > 0
    ? Math.round(((totalConVentana - totalTarde) / totalConVentana) * 100)
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

  return { pctPuntualidad, totalConVentana, totalTarde, peoresRutas, tendencia };
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
      supabase.from("chofer").select("id, nombre"),
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

  const [
    { data: choferes },
    { data: viajes },
    { data: hitos },
    { data: llegadasMesRaw },
    { data: empresas },
  ] = await Promise.all([
    supabase.from("chofer").select("id, nombre"),
    supabase.from("viaje").select("id, referencia, chofer_id, estado"),
    supabase.from("hito").select("id, viaje_id, orden, estado, lat, lon"),
    supabase.from("ejecucion_evento")
      .select("hito_id, viaje_id, chofer_id, tipo, ocurrido_en")
      .eq("tipo", "llegada")
      .gte("ocurrido_en", inicioISO)
      .lt("ocurrido_en", finISO),
    supabase.from("empresa").select("id, base_lat, base_lon"),
  ]);
  const llegadasMes = llegadasMesRaw || [];

  const base = (empresas || [])[0];
  const tieneBase = base && base.base_lat != null && base.base_lon != null;
  const basePunto = tieneBase ? { lat: base.base_lat, lon: base.base_lon } : null;

  const hitoById = Object.fromEntries((hitos || []).map((h) => [h.id, h]));
  const viajeById = Object.fromEntries((viajes || []).map((v) => [v.id, v]));

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

      const distancia = haversineKm(basePunto, { lat: hito.lat, lon: hito.lon });
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
  }

  const filas = Object.values(porChofer).map((c) => ({
    id: c.id,
    nombre: c.nombre,
    nochesFuera: tieneBase ? c._nochesSet.size : null,
    km: Math.round(c.km),
    estimado: c.estimado,
    viajes: [...c._viajes],
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
export async function kmCarreteraViaje(hitos) {
  const conCoords = (hitos || [])
    .filter((h) => h.lat != null && h.lon != null)
    .sort((a, b) => a.orden - b.orden);
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
  return { km, estimado };
}

/**
 * Viabilidad/margen de un viaje. Junta precio (ingreso) + coste/km resuelto por
 * capas (vehículo→empresa) + km por carretera, y devuelve el margen. Lo que falte
 * se devuelve como null. Mismo patrón que getMetricas / getInformeNomina.
 */
export async function getViabilidadViaje(viajeId) {
  const { data: viaje } = await supabase
    .from("viaje")
    .select("id, precio, vehiculo_id")
    .eq("id", viajeId)
    .single();
  if (!viaje) return null;

  const [{ data: hitos }, { data: empresas }, vehiculoRes] = await Promise.all([
    supabase.from("hito").select("orden, lat, lon").eq("viaje_id", viajeId),
    supabase.from("empresa").select("coste_km"),
    viaje.vehiculo_id
      ? supabase.from("vehiculo").select("coste_km").eq("id", viaje.vehiculo_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const empresa = (empresas || [])[0] || null;
  const vehiculo = vehiculoRes.data || null;
  const { costeKm, fuente } = resolveCosteKm({ vehiculo, empresa });
  const { km, estimado } = await kmCarreteraViaje(hitos || []);
  const { coste, margen, margenPct } = calcularMargen({ precio: viaje.precio, km, costeKm });

  return {
    precio: viaje.precio,
    km: Math.round(km),
    estimado,
    costeKm,
    fuenteCoste: fuente,
    coste: coste != null ? Math.round(coste) : null,
    margen: margen != null ? Math.round(margen) : null,
    margenPct: margenPct != null ? Math.round(margenPct) : null,
  };
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
export async function getParkings() {
  const { data } = await supabase
    .from("parking")
    .select("id, nombre, tipo, lat, lon, confianza, fuente, notas");
  return data || [];
}

/** Alta de un parking propio de la empresa (su mapa curado). */
export async function createParkingPropio({ nombre, tipo, lat, lon, notas }) {
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
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Borra un parking propio. RLS impide borrar los del dataset abierto. */
export async function deleteParkingPropio(id) {
  await supabase.from("parking").delete().eq("id", id);
}

export async function getChoferes() {
  const { data } = await supabase
    .from("chofer")
    .select("id, nombre, idioma, chat_id")
    .order("created_at", { ascending: false });
  return data || [];
}

export async function createChofer({ nombre, idioma }) {
  const empresa_id = await getCurrentEmpresaId();
  const { data, error } = await supabase
    .from("chofer")
    .insert({ nombre, idioma: idioma || "es", empresa_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// --- Validaciones de conflicto ---

async function checkConflictoChofer(choferId, excluirViajeId) {
  if (!choferId) return null;
  let query = supabase
    .from("viaje")
    .select("id, referencia")
    .eq("chofer_id", choferId)
    .in("estado", ESTADOS_ACTIVOS);
  if (excluirViajeId) query = query.neq("id", excluirViajeId);
  const { data } = await query.limit(1).single();
  if (data) {
    return `Este chófer ya está asignado al viaje ${data.referencia || data.id.slice(0, 8)} (activo)`;
  }
  return null;
}

async function checkConflictoVehiculo(vehiculoId, excluirViajeId) {
  if (!vehiculoId) return null;
  let query = supabase
    .from("viaje")
    .select("id, referencia")
    .eq("vehiculo_id", vehiculoId)
    .in("estado", ESTADOS_ACTIVOS);
  if (excluirViajeId) query = query.neq("id", excluirViajeId);
  const { data } = await query.limit(1).single();
  if (data) {
    return `Este vehículo ya está asignado al viaje ${data.referencia || data.id.slice(0, 8)} (activo)`;
  }
  return null;
}

async function checkConflictoRemolque(remolqueId, excluirViajeId) {
  if (!remolqueId) return null;
  let query = supabase
    .from("viaje")
    .select("id, referencia")
    .eq("remolque_id", remolqueId)
    .in("estado", ESTADOS_ACTIVOS);
  if (excluirViajeId) query = query.neq("id", excluirViajeId);
  const { data } = await query.limit(1).single();
  if (data) {
    return `Este remolque ya está asignado al viaje ${data.referencia || data.id.slice(0, 8)} (activo)`;
  }
  return null;
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

export async function validarAsignacion({ choferId, vehiculoId, remolqueId, referencia, excluirViajeId }) {
  const avisos = [];
  const errores = [];

  const [confChofer, confVeh, confRem, confRef] = await Promise.all([
    checkConflictoChofer(choferId, excluirViajeId),
    checkConflictoVehiculo(vehiculoId, excluirViajeId),
    checkConflictoRemolque(remolqueId, excluirViajeId),
    checkReferenciaDuplicada(referencia, excluirViajeId),
  ]);

  if (confChofer) avisos.push(confChofer);
  if (confVeh) avisos.push(confVeh);
  if (confRem) avisos.push(confRem);
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
      .select("chofer_id")
      .eq("id", viajeId)
      .single();
    if (!viaje?.chofer_id) {
      errores.push("No se puede poner en curso sin chófer asignado");
    }
  }

  return { errores, ok: errores.length === 0 };
}

export async function createViaje({ referencia, choferId, vehiculoId, remolqueId, hitos }) {
  const validacion = await validarAsignacion({ choferId, vehiculoId, remolqueId, referencia });
  if (!validacion.ok) {
    throw new Error(validacion.errores.join(". "));
  }

  const empresa_id = await getCurrentEmpresaId();
  const { data: viaje, error } = await supabase
    .from("viaje")
    .insert({
      referencia: referencia || null,
      chofer_id: choferId || null,
      vehiculo_id: vehiculoId || null,
      remolque_id: remolqueId || null,
      empresa_id,
      estado: "planificado",
    })
    .select()
    .single();
  if (error) throw error;

  const validos = (hitos || []).filter((h) => h.direccion || h.tipo);
  if (validos.length) {
    const rows = validos.map((h, i) => ({
      viaje_id: viaje.id,
      orden: i + 1,
      tipo: h.tipo,
      direccion: h.direccion || null,
      ventana_inicio: h.ventana_inicio || null,
      ventana_fin: h.ventana_fin || null,
      estado: "pendiente",
    }));
    await supabase.from("hito").insert(rows);
  }
  return { viaje, avisos: validacion.avisos };
}
