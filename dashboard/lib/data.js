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
  const { error } = await supabase.from("cliente").update(payload).eq("id", id);
  if (error) throw error;
}

/** Baja lógica (activo=false): no borra para no perder el histórico/contexto ligado. */
export async function desactivarCliente(id) {
  const { error } = await supabase.from("cliente").update({ activo: false }).eq("id", id);
  if (error) throw error;
}

/** Asocia (o desasocia, con clienteId=null) un cliente a un viaje. No toca `referencia`. */
export async function asignarClienteAViaje(viajeId, clienteId) {
  const { error } = await supabase.from("viaje").update({ cliente_id: clienteId }).eq("id", viajeId);
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
  const { error } = await supabase.from("invitacion").delete().eq("id", id);
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

export async function guardarCosteKmEmpresa(empresaId, costeKmStr) {
  const coste = costeKmStr.trim() === "" ? null : Number(costeKmStr);
  if (coste != null && (Number.isNaN(coste) || coste < 0)) {
    throw new Error("el coste por km debe ser un número positivo");
  }
  const { error } = await supabase.from("empresa").update({ coste_km: coste }).eq("id", empresaId);
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
    .select("id, nombre, email, rol, activo, auth_user_id");
  return (data || []).slice().sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
}

/**
 * Cambia el rol de un gestor de la empresa. Solo admin puede escribirlo
 * (GRANT UPDATE (rol,activo) + policy gestor_update_admin de 0032); la propia
 * policy rechaza si el llamante intenta editar su propia fila.
 */
export async function actualizarRolGestor(gestorId, nuevoRol) {
  const { error } = await supabase.from("gestor").update({ rol: nuevoRol }).eq("id", gestorId);
  if (error) throw error;
}

/** Desactiva (expulsa) a un gestor de la empresa. NO borra: solo activo=false. */
export async function desactivarGestor(gestorId) {
  const { error } = await supabase.from("gestor").update({ activo: false }).eq("id", gestorId);
  if (error) throw error;
}

/** Reactiva a un gestor previamente desactivado. */
export async function reactivarGestor(gestorId) {
  const { error } = await supabase.from("gestor").update({ activo: true }).eq("id", gestorId);
  if (error) throw error;
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

  // ubicacion acotada a los últimos 2 días (auditoría de arquitectura
  // 2026-07-05): antes traía la tabla ENTERA de la empresa sin límite de
  // fecha, creciendo para siempre con cada ping GPS histórico. Una posición
  // de hace más de 2 días tampoco sirve ya para "proximidad al origen".
  const haceDosDias = new Date(Date.now() - 2 * 86400000).toISOString();

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
    supabase.from("ubicacion").select("chofer_id, lat, lon, created_at").gte("created_at", haceDosDias),
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
  viajeId, choferSugeridoId, scoreSugerido, choferElegidoId, scoreElegido, motivo = null,
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

export async function getResumenHoy() {
  const ahoraIso = new Date().toISOString();

  const [
    documentosPorCaducar,
    { data: incidenciasAbiertas },
    { data: viajesEnCurso },
    { data: viajesActivosConPrecio },
  ] = await Promise.all([
    getDocumentosPorCaducar(),
    supabase.from("incidencia").select("id, created_at").in("estado", ALERTA_ESTADOS),
    supabase.from("viaje").select("id, referencia, chofer_id").eq("estado", "en_curso"),
    supabase.from("viaje").select("id, precio").in("estado", ESTADOS_ACTIVOS),
  ]);

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
    viajesPerdidas.count === 0;

  return {
    docsPorCaducar: documentosPorCaducar.length,
    incidencias: { count: (incidenciasAbiertas || []).length, masAntiguaDias },
    viajesEnRiesgo,
    choferes561,
    viajesPerdidas,
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
    .select("id, canal, texto, resumen, autor_externo, ocurrido_en, created_at, gestor:gestor_id(nombre)")
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

  const [
    { data: choferes, error: errorChoferes },
    { data: viajes, error: errorViajes },
    { data: hitos, error: errorHitos },
    { data: llegadasMesRaw, error: errorLlegadas },
    { data: empresas, error: errorEmpresas },
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
  // Ítem 9.35: las 5 alimentan el informe entero (lista de chóferes, mapa de
  // viajes/hitos, llegadas del mes, base de la empresa) -- ninguna es un
  // "vacío legítimo" a este nivel, así que un fallo real aquí debe lanzar,
  // no verse como "0 km"/"0 noches fuera" para todos los chóferes.
  if (errorChoferes) throw errorChoferes;
  if (errorViajes) throw errorViajes;
  if (errorHitos) throw errorHitos;
  if (errorLlegadas) throw errorLlegadas;
  if (errorEmpresas) throw errorEmpresas;
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
export function calcularCosteRuta({ km, noches = 0, vehiculo, empresa }) {
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

  const total = +[combustible, conductor, peajes, dietas].filter((v) => v != null).reduce((s, v) => s + v, 0).toFixed(2);

  return { modo: "desglosado", combustible, conductor, peajes, dietas, total, capasFaltantes };
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
export async function calcularPresupuesto({ puntos, vehiculoId = null }) {
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
  const empresa = (empresas || [])[0] || null;
  const vehiculo = vehiculoRes.data || null;

  const velocidad = resolveVelocidadPlanificacion(empresa);
  const horasConduccion = km / velocidad;
  const eta = calcularEtaConParadas(horasConduccion);
  const noches = eta.descansos11h;

  const coste = calcularCosteRuta({ km, noches, vehiculo, empresa });

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
  const { error } = await supabase.from("gasto_viaje").delete().eq("id", id);
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
  const { data: viajes, error: errorViajes } = await supabase
    .from("viaje")
    .select("id, referencia, precio")
    .gte("created_at", desde)
    .lt("created_at", hasta);
  // Ítem 9.35: un fallo real aquí no debe verse como "sin viajes en el
  // periodo" (0 viajes a pérdidas, margen medio null es un resultado
  // legítimo distinto de "la consulta falló").
  if (errorViajes) throw errorViajes;

  const conPrecio = (viajes || []).filter((v) => v.precio != null);

  const filas = await Promise.all(
    conPrecio.map(async (v) => {
      const pnl = await getPnlViaje(v.id);
      return { id: v.id, referencia: v.referencia || v.id.slice(0, 8), ...pnl };
    })
  );

  const conAmbos = filas.filter((f) => f.desviacionPct != null);
  const margenRealMedio = filas.length
    ? Math.round(filas.reduce((s, f) => s + (f.margenReal ?? 0), 0) / filas.length)
    : null;
  const viajesAPerdidasReales = filas.filter((f) => f.margenReal != null && f.margenReal < 0).length;
  const desviacionMedia = conAmbos.length
    ? Math.round(conAmbos.reduce((s, f) => s + Math.abs(f.desviacionPct), 0) / conAmbos.length)
    : null;

  const ordenadas = [...filas].filter((f) => f.margenReal != null).sort((a, b) => b.margenReal - a.margenReal);

  return {
    margenRealMedio,
    viajesAPerdidasReales,
    desviacionMedia,
    // viajesConDesviacion (10.8): cuántos viajes tenían gastos reales Y coste
    // estimado a la vez -- el tamaño de muestra real de `desviacionMedia`,
    // para saber si esa media es de fiar o de 2 viajes sueltos.
    viajesConDesviacion: conAmbos.length,
    top5: ordenadas.slice(0, 5),
    bottom5: ordenadas.slice(-5).reverse(),
  };
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
  const [{ data: hitos }, { data: eventos }] = await Promise.all([
    supabase.from("hito").select("id, ventana_fin").gte("ventana_fin", desde).lt("ventana_fin", hasta),
    supabase.from("ejecucion_evento").select("hito_id, ocurrido_en").eq("tipo", "llegada"),
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
    supabase.from("empresa").select("id, velocidad_planificacion_kmh, coste_km"),
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
    supabase.from("gasto_viaje").select("viaje_id, importe").in("viaje_id", idsViajes),
  ]);

  const gastosPorViaje = {};
  (gastos || []).forEach((g) => {
    gastosPorViaje[g.viaje_id] = (gastosPorViaje[g.viaje_id] || 0) + Number(g.importe);
  });

  const muestrasVelocidad = [];
  const muestrasCosteKm = [];
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
  }

  const numViajesConDatos = viajesConAlgunDato.size;
  if (numViajesConDatos < minimoViajes) {
    return { suficiente: false, numViajesConDatos, minimoViajes };
  }

  const velocidadReal = mediana(muestrasVelocidad);
  const costeKmReal = mediana(muestrasCosteKm);
  const velocidadConfigurada = empresa.velocidad_planificacion_kmh ?? null;
  const costeKmConfigurado = empresa.coste_km ?? null;

  function difierePct(real, configurado) {
    if (real == null || configurado == null || configurado === 0) return null;
    return Math.abs((real - configurado) / configurado) * 100;
  }

  const diffVelocidad = difierePct(velocidadReal, velocidadConfigurada);
  const diffCosteKm = difierePct(costeKmReal, costeKmConfigurado);

  return {
    suficiente: true,
    numViajesConDatos,
    minimoViajes,
    velocidad: {
      real: velocidadReal != null ? Math.round(velocidadReal) : null,
      configurada: velocidadConfigurada,
      sugerir: diffVelocidad != null && diffVelocidad >= UMBRAL_DIFERENCIA_SUGERENCIA_PCT,
    },
    costeKm: {
      real: costeKmReal != null ? Math.round(costeKmReal * 100) / 100 : null,
      configurado: costeKmConfigurado,
      sugerir: diffCosteKm != null && diffCosteKm >= UMBRAL_DIFERENCIA_SUGERENCIA_PCT,
    },
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

  const [rentActual, rentAnterior, puntActual, puntAnterior] = await Promise.all([
    getMetricasRentabilidad({ desde, hasta }),
    getMetricasRentabilidad(rangoAnterior),
    getMetricasPuntualidad({ desde, hasta }),
    getMetricasPuntualidad(rangoAnterior),
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
  };
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

// ==========================================================================
// Onboarding (ítem 7A.13) — checklist guiado para una empresa recién creada.
// ==========================================================================

export async function getOnboardingEstado() {
  const [
    { data: vehiculos },
    { data: choferes },
    { data: viajes },
    { data: empresas },
  ] = await Promise.all([
    supabase.from("vehiculo").select("id"),
    supabase.from("chofer").select("id, chat_id"),
    supabase.from("viaje").select("id"),
    supabase.from("empresa").select("coste_km, precio_gasoil_litro"),
  ]);

  const empresa = (empresas || [])[0] || null;

  const pasos = [
    { id: "vehiculo", done: (vehiculos || []).length > 0, label: "Añade tu primer vehículo", href: "/vehiculos" },
    { id: "chofer", done: (choferes || []).length > 0, label: "Añade tu primer chófer", href: "/choferes" },
    { id: "telegram", done: (choferes || []).some((c) => c.chat_id), label: "Vincula un chófer a Telegram", href: "/choferes" },
    { id: "viaje", done: (viajes || []).length > 0, label: "Crea tu primer viaje", href: "/viajes/nuevo" },
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
  const token = crypto.randomUUID();
  const expira = new Date(Date.now() + diasValidez * 86400000).toISOString();
  const { error } = await supabase
    .from("viaje")
    .update({ token_publico: token, token_publico_expira: expira })
    .eq("id", viajeId);
  if (error) throw error;
  return { token, expira };
}

export async function revocarTokenPublico(viajeId) {
  const { error } = await supabase
    .from("viaje")
    .update({ token_publico: null, token_publico_expira: null })
    .eq("id", viajeId);
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
  const { data } = await supabase.from("bot_heartbeat").select("created_at");
  const filas = (data || []).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const ultimoLatido = filas[0]?.created_at || null;
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

// ==========================================================================
// Parkings para camión (ítem 5.4)
// ==========================================================================

/**
 * Todos los parkings visibles para el gestor: el dataset abierto global
 * (fuente='dataset_abierto', empresa_id NULL — ver backend/db/seed_parking_abierto.py,
 * datos Fraunhofer/Zenodo CC-BY 4.0; NO es la certificación oficial SSTPA) más
 * los propios de su empresa (fuente='empresa'). RLS hace el filtrado real.
 */
// El mapa necesita el dataset completo (no es una lista paginable), pero un límite duro
// evita que un dataset abierto corrupto/inflado o un futuro error de seed tumbe la página
// sin aviso (ítem 9.32). 5000 cubre con margen el dataset Fraunhofer/Zenodo de España
// actual + los propios de una empresa.
export const LIMITE_PARKINGS = 5000;

export async function getParkings() {
  const { data } = await supabase
    .from("parking")
    .select("id, nombre, tipo, lat, lon, confianza, fuente, notas")
    .limit(LIMITE_PARKINGS);
  return data || [];
}

// ==========================================================================
// Derechos ARCO (ítem 9.15 — ver PRIVACIDAD-ARCO.md para el procedimiento
// completo y la tensión con la cadena de custodia de 9.6-9.8)
// ==========================================================================

/**
 * Derecho de ACCESO: recopila todo lo que el esquema real tiene ligado a un
 * chófer, tal cual existe hoy. Solo lectura, sin privilegios especiales.
 */
export async function getExportacionChofer(choferId) {
  const [chofer, viajes, ubicaciones, valoraciones, documentos, decisiones] = await Promise.all([
    supabase.from("chofer").select("*").eq("id", choferId).single(),
    supabase.from("viaje").select("id, referencia, estado, created_at").eq("chofer_id", choferId),
    supabase.from("ubicacion").select("lat, lon, velocidad, rumbo, created_at").eq("chofer_id", choferId),
    supabase.from("valoracion").select("puntuacion, nota, created_at, viaje_id").eq("chofer_id", choferId),
    supabase.from("documento").select("tipo, fecha_emision, fecha_caducidad, estado, created_at").eq("ambito", "chofer").eq("entidad_id", choferId),
    supabase.from("decision_asignacion").select("viaje_id, siguio_sugerencia, motivo, created_at").or(`chofer_sugerido_id.eq.${choferId},chofer_elegido_id.eq.${choferId}`),
  ]);
  return {
    chofer: chofer.data || null,
    viajes: viajes.data || [],
    ubicaciones: ubicaciones.data || [],
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
  const { error: errorDocumento } = await supabase
    .from("documento")
    .delete()
    .eq("ambito", "chofer")
    .eq("entidad_id", choferId);
  if (errorDocumento) throw errorDocumento;

  const { error } = await supabase
    .from("chofer")
    .update({ nombre: "Chófer eliminado a petición propia", telefono: null })
    .eq("id", choferId);
  if (error) throw error;
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
  const { error } = await supabase.from("parking").delete().eq("id", id);
  if (error) throw error;
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

export async function createViaje({ referencia, choferId, vehiculoId, remolqueId, hitos, precio = null, clienteId = null }) {
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
      cliente_id: clienteId || null,
      empresa_id,
      estado: "planificado",
      precio: precio != null ? precio : null,
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
      // lat/lon opcionales (7A.11: el wizard los captura para el panel de
      // cálculo en vivo; /viajes/nuevo no los manda y sigue guardando null,
      // igual que antes).
      lat: h.lat !== undefined && h.lat !== "" && h.lat != null ? Number(h.lat) : null,
      lon: h.lon !== undefined && h.lon !== "" && h.lon != null ? Number(h.lon) : null,
      ventana_inicio: h.ventana_inicio || null,
      ventana_fin: h.ventana_fin || null,
      estado: "pendiente",
    }));
    await supabase.from("hito").insert(rows);
  }
  return { viaje, avisos: validacion.avisos };
}
