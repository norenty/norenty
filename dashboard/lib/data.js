import { supabase } from "./supabase";

const ALERTA_ESTADOS = ["abierta", "en_revision"];

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

export async function getDefaultEmpresaId() {
  const { data } = await supabase
    .from("empresa")
    .select("id")
    .order("created_at")
    .limit(1)
    .single();
  return data?.id || null;
}

export async function getChoferes() {
  const { data } = await supabase
    .from("chofer")
    .select("id, nombre, idioma, chat_id")
    .order("created_at", { ascending: false });
  return data || [];
}

export async function createChofer({ nombre, idioma }) {
  const empresa_id = await getDefaultEmpresaId();
  const { data, error } = await supabase
    .from("chofer")
    .insert({ nombre, idioma: idioma || "es", empresa_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createViaje({ referencia, choferId, hitos }) {
  const empresa_id = await getDefaultEmpresaId();
  const { data: viaje, error } = await supabase
    .from("viaje")
    .insert({
      referencia: referencia || null,
      chofer_id: choferId || null,
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
  return viaje;
}
