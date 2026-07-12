// Suite de aislamiento multi-tenant contra la BD REAL (ítem 8.4) — no confía
// en "las policies deberían aislar", lo DEMUESTRA: autenticado como el
// gestor de la empresa demo ("Transportes Demo Norenty"), verifica que
// ninguna consulta devuelve una sola fila de la OTRA empresa que existe en
// el proyecto ("Demo Transport S.L.", una empresa semilla con IDs
// predecibles — confirmados por consulta directa, no inventados).
//
// Como smoke.test.js (8.1): se salta entero si no hay credenciales en el
// entorno, para no romper CI en una máquina sin `.env`/`.env.local`.
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

const tieneCredenciales = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.DEMO_EMAIL &&
  process.env.DEMO_PASSWORD
);

// Empresa semilla ajena a la cuenta demo, confirmada por consulta directa a
// la BD (2026-07-04) — NO pertenece a demo@norenty.com.
const OTRA_EMPRESA_ID = "00000000-0000-0000-0000-000000000001";
const OTRO_VIAJE_ID = "00000000-0000-0000-0000-000000001000";
const OTRO_CHOFER_ID = "00000000-0000-0000-0000-000000000100";
const OTRO_HITO_ID = "00000000-0000-0000-0000-000000010001";

const tieneServiceRole = tieneCredenciales && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!tieneCredenciales)("aislamiento multi-tenant contra la BD real (8.4)", () => {
  let supabase;

  beforeAll(async () => {
    ({ supabase } = await import("./supabase.js"));
    const { error } = await supabase.auth.signInWithPassword({
      email: process.env.DEMO_EMAIL,
      password: process.env.DEMO_PASSWORD,
    });
    if (error) {
      throw new Error(`No se pudo iniciar sesión con la empresa demo: ${error.message}`);
    }
  }, 30000);

  it("no ve la fila de la otra empresa en la tabla empresa", async () => {
    const { data } = await supabase.from("empresa").select("id").eq("id", OTRA_EMPRESA_ID);
    expect(data || []).toHaveLength(0);
  });

  it("no ve el viaje de la otra empresa", async () => {
    const { data } = await supabase.from("viaje").select("id").eq("id", OTRO_VIAJE_ID);
    expect(data || []).toHaveLength(0);
  });

  it("no ve el chófer de la otra empresa", async () => {
    const { data } = await supabase.from("chofer").select("id").eq("id", OTRO_CHOFER_ID);
    expect(data || []).toHaveLength(0);
  });

  it("no ve el hito de la otra empresa (aislamiento vía viaje_id, no columna empresa_id directa)", async () => {
    const { data } = await supabase.from("hito").select("id").eq("id", OTRO_HITO_ID);
    expect(data || []).toHaveLength(0);
  });

  it("un listado general (sin filtro) de viajes JAMÁS incluye el id de la otra empresa", async () => {
    const { data } = await supabase.from("viaje").select("id");
    const ids = (data || []).map((v) => v.id);
    expect(ids).not.toContain(OTRO_VIAJE_ID);
  });

  it("un listado general de chóferes JAMÁS incluye el id de la otra empresa", async () => {
    const { data } = await supabase.from("chofer").select("id");
    const ids = (data || []).map((c) => c.id);
    expect(ids).not.toContain(OTRO_CHOFER_ID);
  });
});

// --- Aislamiento de ESCRITURAS cruzadas (ítem 10.3, ampliando el hallazgo de
// que la suite anterior solo cubría lecturas). RLS filtra el WHERE de un
// UPDATE/DELETE en silencio (0 filas afectadas, sin error explícito) -- por
// eso la única forma fiable de demostrarlo es re-consultar el dato de la OTRA
// empresa con una sesión de SERVICE ROLE (que salta RLS) y confirmar que
// sigue intacto tras el intento de escritura como la cuenta demo. ---
describe.skipIf(!tieneServiceRole)("aislamiento de escrituras cruzadas contra la BD real (10.3)", () => {
  let supabaseDemo, supabaseAdmin;
  let matriculaOriginal;

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    ({ supabase: supabaseDemo } = await import("./supabase.js"));
    supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { error } = await supabaseDemo.auth.signInWithPassword({
      email: process.env.DEMO_EMAIL,
      password: process.env.DEMO_PASSWORD,
    });
    if (error) throw new Error(`No se pudo iniciar sesión con la empresa demo: ${error.message}`);
  }, 30000);

  it("UPDATE del viaje de la otra empresa, como demo, NO cambia nada (RLS filtra el WHERE)", async () => {
    await supabaseDemo.from("viaje").update({ referencia: "HACKEADO_POR_TEST" }).eq("id", OTRO_VIAJE_ID);
    const { data } = await supabaseAdmin.from("viaje").select("referencia").eq("id", OTRO_VIAJE_ID).single();
    expect(data?.referencia).not.toBe("HACKEADO_POR_TEST");
  });

  it("DELETE del chófer de la otra empresa, como demo, NO borra nada (RLS filtra el WHERE)", async () => {
    await supabaseDemo.from("chofer").delete().eq("id", OTRO_CHOFER_ID);
    const { data } = await supabaseAdmin.from("chofer").select("id").eq("id", OTRO_CHOFER_ID).single();
    expect(data?.id).toBe(OTRO_CHOFER_ID); // sigue existiendo
  });

  it("INSERT de un hito en el viaje de la otra empresa, como demo, es rechazado", async () => {
    const { error } = await supabaseDemo
      .from("hito")
      .insert({ viaje_id: OTRO_VIAJE_ID, tipo: "entrega", orden: 99, direccion: "inyectado por test" });
    // O RLS lo rechaza con error, o (si algún día una policy permitiera el INSERT
    // sin comprobar el viaje_id) quedaría huérfano y visible por la otra empresa --
    // cualquiera de las dos formas se comprueba: debe haber error, O la fila no
    // debe existir para el service role bajo esa dirección inventada.
    if (!error) {
      const { data } = await supabaseAdmin
        .from("hito")
        .select("id")
        .eq("viaje_id", OTRO_VIAJE_ID)
        .eq("direccion", "inyectado por test");
      expect(data || []).toHaveLength(0);
    } else {
      expect(error).toBeTruthy();
    }
  });
});

// --- Aislamiento de las tablas NUEVAS de esta sesión (cliente 11.1, contexto
// 11.2) -- la suite original (8.4/10.3) se escribió antes de que existieran,
// así que nunca se probó su aislamiento cruzado de verdad. Se crea la fila de
// prueba con service role directamente en "Demo Transport S.L." (la empresa
// ajena a la cuenta demo), se verifica que la cuenta demo no la ve/toca, y se
// limpia con service role al final (nunca queda basura en la BD real). ---
describe.skipIf(!tieneServiceRole)("aislamiento de cliente/contexto (11.1/11.2) contra la BD real", () => {
  let supabaseDemo, supabaseAdmin;
  let clienteAjenoId, contextoAjenoId;

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    ({ supabase: supabaseDemo } = await import("./supabase.js"));
    supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { error } = await supabaseDemo.auth.signInWithPassword({
      email: process.env.DEMO_EMAIL,
      password: process.env.DEMO_PASSWORD,
    });
    if (error) throw new Error(`No se pudo iniciar sesión con la empresa demo: ${error.message}`);

    const { data: cliente, error: errCliente } = await supabaseAdmin
      .from("cliente")
      .insert({ empresa_id: OTRA_EMPRESA_ID, nombre: "__TEST_ISOLATION__ cliente ajeno" })
      .select("id")
      .single();
    if (errCliente) throw new Error("No se pudo crear el fixture de cliente: " + errCliente.message);
    clienteAjenoId = cliente.id;

    const { data: contexto, error: errContexto } = await supabaseAdmin
      .from("contexto")
      .insert({ empresa_id: OTRA_EMPRESA_ID, entidad: "viaje", entidad_id: OTRO_VIAJE_ID, texto: "__TEST_ISOLATION__ contexto ajeno" })
      .select("id")
      .single();
    if (errContexto) throw new Error("No se pudo crear el fixture de contexto: " + errContexto.message);
    contextoAjenoId = contexto.id;
  }, 30000);

  afterAll(async () => {
    if (clienteAjenoId) await supabaseAdmin.from("cliente").delete().eq("id", clienteAjenoId);
    if (contextoAjenoId) await supabaseAdmin.from("contexto").delete().eq("id", contextoAjenoId);
  });

  it("no ve el cliente de la otra empresa, ni por id ni en el listado general", async () => {
    const { data: porId } = await supabaseDemo.from("cliente").select("id").eq("id", clienteAjenoId);
    expect(porId || []).toHaveLength(0);
    const { data: listado } = await supabaseDemo.from("cliente").select("id");
    expect((listado || []).map((c) => c.id)).not.toContain(clienteAjenoId);
  });

  it("no ve el contexto de la otra empresa", async () => {
    const { data } = await supabaseDemo.from("contexto").select("id").eq("id", contextoAjenoId);
    expect(data || []).toHaveLength(0);
  });

  it("UPDATE del cliente ajeno, como demo, NO cambia nada (RLS filtra el WHERE)", async () => {
    await supabaseDemo.from("cliente").update({ nombre: "HACKEADO_POR_TEST" }).eq("id", clienteAjenoId);
    const { data } = await supabaseAdmin.from("cliente").select("nombre").eq("id", clienteAjenoId).single();
    expect(data?.nombre).not.toBe("HACKEADO_POR_TEST");
  });

  it("DELETE del contexto ajeno, como demo, NO borra nada (RLS filtra el WHERE)", async () => {
    await supabaseDemo.from("contexto").delete().eq("id", contextoAjenoId);
    const { data } = await supabaseAdmin.from("contexto").select("id").eq("id", contextoAjenoId).single();
    expect(data?.id).toBe(contextoAjenoId); // sigue existiendo
  });
});
