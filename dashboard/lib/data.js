import { supabase } from "./supabase";

const ALERTA_ESTADOS = ["abierta", "en_revision"];
const ESTADOS_ACTIVOS = ["planificado", "en_curso"];

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
