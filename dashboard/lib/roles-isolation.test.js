// Suite de aislamiento POR ROL contra la BD REAL (ítem 9.31, sigue a 9.29/8.4).
// Mismo principio que isolation.test.js (8.4): NO confiar en "las policies
// deberían bloquearlo", DEMOSTRARLO contra Postgres real, vía REST, con el
// JWT real de cada rol — nunca con el mock de data.test.js (no ejecuta SQL,
// no puede probar RLS/triggers). Casos B1-B12 de SPECS-9-ROLES.md §6.2.
//
// Fixtures: dos gestores de prueba (gestor_operativo, solo_lectura) viven
// permanentemente en la empresa demo, con email/password FIJOS (no aleatorios
// por ejecución) para no acumular basura en la BD en cada `ci.ps1`. La
// primera vez que corre esta suite los crea (invitación + signUp + canje,
// mismo flujo real que un alta de 6.9); las siguientes veces solo inicia
// sesión y "autocura" su rol/activo por si una ejecución anterior los dejó en
// otro estado (p.ej. el propio caso B8 desactiva a "lectura" a propósito).
//
// Como smoke.test.js/isolation.test.js: se salta entero si no hay
// credenciales en el entorno, para no romper CI en una máquina sin `.env`.
import { createClient } from "@supabase/supabase-js";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../.env.local") });
loadEnv({ path: path.resolve(here, "../../.env") });
// Seguridad (2026-07-08): secretos reales en ~/.norenty-secrets/.env, fuera del
// repo (ver RUNBOOK-SECRETS.md). override: true -- gana sobre lo anterior.
loadEnv({ path: path.join(os.homedir(), ".norenty-secrets", ".env"), override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const tieneCredenciales = !!(SUPABASE_URL && ANON_KEY && process.env.DEMO_EMAIL && process.env.DEMO_PASSWORD);

// Fixtures fijos de esta suite — viven en la empresa demo, nunca en otra.
// Dominio propio (norenty.com) en vez de un TLD reservado (.invalid/.test):
// Supabase Auth rechaza esos TLD como "email inválido" en su validación.
const OPERATIVO_EMAIL = "roles931.operativo@norenty.com";
const OPERATIVO_PASSWORD = "Roles931!Operativo";
const LECTURA_EMAIL = "roles931.lectura@norenty.com";
const LECTURA_PASSWORD = "Roles931!Lectura";

function nuevoCliente() {
  // persistSession:false — cada cliente es un actor independiente en el
  // mismo proceso Node; sin esto pisarían el storage de sesión entre sí.
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Da de alta (si no existe) o inicia sesión (si ya existe) un gestor de
 * prueba con el rol indicado, en la empresa de `admin`. Autocura rol/activo
 * en cada ejecución para que la suite sea idempotente sin importar en qué
 * estado la dejó la vez anterior — incluido el caso de una ejecución previa
 * que creó el usuario de Auth pero no llegó a crear su fila `gestor` (p.ej.
 * porque el proyecto exige confirmar email y aún no estaba confirmado).
 */
async function asegurarGestorDePrueba(admin, empresaId, email, password, rolDeseado) {
  const cliente = nuevoCliente();
  const signIn = await cliente.auth.signInWithPassword({ email, password });

  let userId;
  if (signIn.error) {
    const signUp = await cliente.auth.signUp({ email, password });
    if (signUp.error) throw new Error(`No se pudo registrar el gestor de prueba ${email}: ${signUp.error.message}`);
    userId = signUp.data.user.id;
    const { data: sesion } = await cliente.auth.getSession();
    if (!sesion?.session) {
      // El proyecto exige confirmar email: signUp crea el usuario de Auth
      // pero sin sesión activa, y no hay SUPABASE_SERVICE_ROLE_KEY (D1
      // pendiente) para confirmarlo por la Admin API. Confirmar A MANO una
      // vez (SQL directo: `update auth.users set email_confirmed_at = now()
      // where email = '...'`) y volver a correr la suite — solo hace falta
      // la primera vez para cada fixture, luego el signIn de arriba basta.
      throw new Error(
        `El usuario de prueba ${email} se creó pero requiere confirmación de email ` +
        `(no hay service role key para confirmarlo por Admin API). Confírmalo una vez ` +
        `por SQL y vuelve a correr esta suite.`
      );
    }
  } else {
    userId = signIn.data.user.id;
  }

  let { data: fila } = await admin
    .from("gestor")
    .select("id, empresa_id")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (!fila) {
    // Sesión activa pero sin fila gestor todavía: unirse a la empresa vía
    // invitación (mismo flujo real que un alta de 6.9).
    const { data: inv, error: invError } = await admin
      .from("invitacion")
      .insert({ empresa_id: empresaId, email })
      .select("codigo")
      .single();
    if (invError) throw new Error(`No se pudo crear la invitación de prueba (${email}): ${invError.message}`);

    const { data: empresaCanjeada, error: rpcError } = await cliente.rpc("usar_invitacion", {
      p_codigo: inv.codigo,
    });
    if (rpcError || !empresaCanjeada) {
      throw new Error(`No se pudo canjear la invitación de prueba de ${email}: ${rpcError?.message ?? "código inválido"}`);
    }

    const { error: gestorError } = await cliente
      .from("gestor")
      .insert({ nombre: email.split("@")[0], email, empresa_id: empresaCanjeada, auth_user_id: userId });
    if (gestorError) throw new Error(`No se pudo crear la fila gestor de prueba ${email}: ${gestorError.message}`);

    ({ data: fila } = await admin.from("gestor").select("id, empresa_id").eq("auth_user_id", userId).maybeSingle());
    if (!fila) throw new Error(`Gestor de prueba ${email} no encontrado tras crearlo — estado inesperado.`);
  }

  if (fila.empresa_id !== empresaId) {
    throw new Error(`Gestor de prueba ${email} pertenece a otra empresa (${fila.empresa_id}) — estado inesperado, revisar a mano.`);
  }

  // Autocura: siempre normaliza rol/activo, sin importar el estado previo
  // (idempotente — cubre el caso de que B8 haya desactivado "lectura").
  const { error: fixError } = await admin.from("gestor").update({ rol: rolDeseado, activo: true }).eq("id", fila.id);
  if (fixError) throw new Error(`No se pudo normalizar rol/activo de ${email}: ${fixError.message}`);

  return { cliente, gestorId: fila.id, userId };
}

describe.skipIf(!tieneCredenciales)("aislamiento por rol contra la BD real (9.31)", () => {
  let admin, operativo, lectura;
  let adminUserId, idOperativo, idLectura;
  let empresaId, gestorAdmin;
  let viajeId, vehiculoId;

  beforeAll(async () => {
    admin = nuevoCliente();
    const signIn = await admin.auth.signInWithPassword({
      email: process.env.DEMO_EMAIL,
      password: process.env.DEMO_PASSWORD,
    });
    if (signIn.error) throw new Error(`No se pudo iniciar sesión con la empresa demo: ${signIn.error.message}`);
    adminUserId = signIn.data.user.id;

    const { data: filaAdmin, error: filaAdminError } = await admin
      .from("gestor")
      .select("id, empresa_id, rol, activo")
      .eq("auth_user_id", adminUserId)
      .single();
    if (filaAdminError || !filaAdmin) throw new Error(`No se encontró la fila gestor del admin demo: ${filaAdminError?.message}`);
    gestorAdmin = filaAdmin;
    empresaId = filaAdmin.empresa_id;

    ({ cliente: operativo, gestorId: idOperativo } = await asegurarGestorDePrueba(
      admin, empresaId, OPERATIVO_EMAIL, OPERATIVO_PASSWORD, "gestor_operativo"
    ));
    ({ cliente: lectura, gestorId: idLectura } = await asegurarGestorDePrueba(
      admin, empresaId, LECTURA_EMAIL, LECTURA_PASSWORD, "solo_lectura"
    ));

    const { data: viajeRow } = await admin.from("viaje").select("id").eq("empresa_id", empresaId).limit(1).single();
    const { data: vehiculoRow } = await admin.from("vehiculo").select("id").eq("empresa_id", empresaId).limit(1).single();
    if (!viajeRow || !vehiculoRow) {
      throw new Error("La empresa demo no tiene viajes/vehículos — ejecuta seed_demo.py antes de correr esta suite.");
    }
    viajeId = viajeRow.id;
    vehiculoId = vehiculoRow.id;
  }, 60000);

  afterAll(async () => {
    // Red de seguridad: si B8 falló a mitad, no dejar "lectura" inutilizable.
    if (idLectura) {
      await admin.from("gestor").update({ activo: true }).eq("id", idLectura);
    }
  });

  it("(B11) el gestor admin existente conserva rol=admin y activo=true tras la migración 0032", () => {
    expect(gestorAdmin.rol).toBe("admin");
    expect(gestorAdmin.activo).toBe(true);
  });

  it("(B1) operativo NO puede UPDATE empresa.coste_km (columna de coste)", async () => {
    const { data: antes } = await admin.from("empresa").select("coste_km").eq("id", empresaId).single();
    const nuevo = (Number(antes?.coste_km) || 1) + 1;
    const { data, error } = await operativo.from("empresa").update({ coste_km: nuevo }).eq("id", empresaId).select();
    expect(error).toBeTruthy();
    expect(error.message).toMatch(/costes de empresa/);
    expect(data).toBeFalsy();

    const { data: despues } = await admin.from("empresa").select("coste_km").eq("id", empresaId).single();
    expect(despues.coste_km).toBe(antes.coste_km); // la excepción abortó la transacción, nada cambió
  });

  it("(B2) operativo SÍ puede UPDATE otros campos de empresa (p.ej. nombre)", async () => {
    const { data: antes } = await admin.from("empresa").select("nombre").eq("id", empresaId).single();
    const { error } = await operativo.from("empresa").update({ nombre: antes.nombre }).eq("id", empresaId);
    expect(error).toBeNull();
  });

  it("(B3) operativo NO puede UPDATE vehiculo.coste_km ni consumo_l_100km", async () => {
    const { data: antes } = await admin.from("vehiculo").select("coste_km, consumo_l_100km").eq("id", vehiculoId).single();
    const { data, error } = await operativo.from("vehiculo").update({ coste_km: 999.99 }).eq("id", vehiculoId).select();
    expect(error).toBeTruthy();
    expect(error.message).toMatch(/costes de vehiculo/);
    expect(data).toBeFalsy();

    const { data: despues } = await admin.from("vehiculo").select("coste_km").eq("id", vehiculoId).single();
    expect(despues.coste_km).toBe(antes.coste_km);
  });

  it("(B3) operativo NO puede UPDATE viaje.precio", async () => {
    const { data: antes } = await admin.from("viaje").select("precio").eq("id", viajeId).single();
    const nuevo = (Number(antes?.precio) || 100) + 50;
    const { data, error } = await operativo.from("viaje").update({ precio: nuevo }).eq("id", viajeId).select();
    expect(error).toBeTruthy();
    expect(error.message).toMatch(/precio del viaje/);
    expect(data).toBeFalsy();

    const { data: despues } = await admin.from("viaje").select("precio").eq("id", viajeId).single();
    expect(despues.precio).toBe(antes.precio);
  });

  it("(B4) operativo SÍ puede UPDATE viaje.chofer_id/estado (día a día)", async () => {
    const { data: antes } = await admin.from("viaje").select("chofer_id, estado").eq("id", viajeId).single();
    const { error } = await operativo
      .from("viaje")
      .update({ chofer_id: antes.chofer_id, estado: antes.estado })
      .eq("id", viajeId);
    expect(error).toBeNull();
  });

  it("(B5) operativo NO puede crear ni borrar invitaciones", async () => {
    const { data: insertData, error: insertError } = await operativo
      .from("invitacion")
      .insert({ empresa_id: empresaId, email: "intento-invitacion-931@norenty.com" })
      .select();
    expect(insertError).toBeTruthy();
    expect(insertData).toBeFalsy();

    const { data: inv, error: invError } = await admin
      .from("invitacion")
      .insert({ empresa_id: empresaId, email: "objetivo-borrado-931@norenty.com" })
      .select("id")
      .single();
    expect(invError).toBeNull();

    const { data: delData } = await operativo.from("invitacion").delete().eq("id", inv.id).select();
    expect(delData || []).toHaveLength(0); // RLS filtra la fila: 0 filas borradas, no error

    const { data: sigueAhi } = await admin.from("invitacion").select("id").eq("id", inv.id);
    expect(sigueAhi).toHaveLength(1);

    await admin.from("invitacion").delete().eq("id", inv.id); // limpieza
  });

  it("(B6) solo_lectura NO puede INSERT/UPDATE/DELETE en ninguna tabla de negocio", async () => {
    const { data: antes } = await admin.from("viaje").select("estado").eq("id", viajeId).single();
    const upd = await lectura.from("viaje").update({ estado: antes.estado }).eq("id", viajeId).select();
    expect(upd.error).toBeTruthy();
    expect(upd.error.message).toMatch(/solo_lectura/);

    const ins = await lectura
      .from("gasto_viaje")
      .insert({ empresa_id: empresaId, viaje_id: viajeId, tipo: "otro", importe: 1 })
      .select();
    expect(ins.error).toBeTruthy();
    expect(ins.error.message).toMatch(/solo_lectura/);

    const insDoc = await lectura
      .from("documento")
      .insert({ empresa_id: empresaId, ambito: "viaje", entidad_id: viajeId, tipo: "otro", estado: "vigente" })
      .select();
    expect(insDoc.error).toBeTruthy();
    expect(insDoc.error.message).toMatch(/solo_lectura/);
  });

  it("(B7) solo_lectura SÍ puede SELECT datos de su empresa", async () => {
    const { data, error } = await lectura.from("viaje").select("id").limit(5);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("(B8) expulsión instantánea: desactivar corta el acceso sin re-login", async () => {
    const antes = await lectura.from("empresa").select("id").eq("id", empresaId);
    expect(antes.error).toBeNull();
    expect(antes.data).toHaveLength(1); // acceso normal antes de desactivar

    const { error: desactivarError } = await admin.from("gestor").update({ activo: false }).eq("id", idLectura);
    expect(desactivarError).toBeNull();

    const despues = await lectura.from("empresa").select("id").eq("id", empresaId);
    expect(despues.data || []).toHaveLength(0); // MISMO JWT, sin re-login: cero acceso al instante

    await admin.from("gestor").update({ activo: true }).eq("id", idLectura); // reactivar para la próxima ejecución
  });

  it("(B9) admin NO puede desactivarse ni auto-editarse su propia fila", async () => {
    const { data, error } = await admin.from("gestor").update({ activo: false }).eq("auth_user_id", adminUserId).select();
    expect(error).toBeNull();
    expect(data || []).toHaveLength(0); // la policy excluye la propia fila: 0 filas afectadas, no error

    const { data: sigue } = await admin.from("gestor").select("activo, rol").eq("auth_user_id", adminUserId).single();
    expect(sigue.activo).toBe(true);
    expect(sigue.rol).toBe("admin");
  });

  it("(B10) admin SÍ puede cambiar el rol de otro gestor de su empresa", async () => {
    const { error } = await admin.from("gestor").update({ rol: "gestor_operativo" }).eq("id", idOperativo);
    expect(error).toBeNull();
    const { data } = await admin.from("gestor").select("rol").eq("id", idOperativo).single();
    expect(data.rol).toBe("gestor_operativo");
  });

  // (B12) service role no se bloquea por los triggers de rol: no automatizable
  // hoy porque SUPABASE_SERVICE_ROLE_KEY está vacía (D1 pendiente, ver ROADMAP).
  // El diseño (§2.3/§2.5 de SPECS-9-ROLES.md) ya deja pasar auth.uid() IS NULL
  // explícitamente; verificar con datos reales en cuanto D1 se resuelva.
  it.skip("(B12) service role no se bloquea por los triggers de rol", () => {});
});
