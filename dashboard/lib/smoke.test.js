// Smoke tests contra la BD REAL (ítem 8.1) — NO mockean supabase. Existen
// porque los 3 bugs que le llegaron al usuario en producción (nómina
// consultando una columna inexistente, el mapa crasheando por un
// `.rpc().catch()` mal encadenado, y el bootstrap de RLS) pasaron TODOS los
// tests unitarios: el mock de `data.test.js` replica el esquema que
// ASUMIMOS, no el que la BD REALMENTE tiene. Este archivo llama a las
// funciones de lectura reales contra el proyecto Supabase real, autenticado
// como la empresa demo, y solo comprueba que no lanzan y que la forma del
// resultado es la esperada — no reemplaza a data.test.js, lo complementa.
//
// Se salta entero (sin fallar el CI) si no hay credenciales en el entorno —
// así una máquina sin `.env`/`.env.local` sigue teniendo CI verde; en la
// máquina de desarrollo con las claves puestas, si esto falla es una señal
// real de que algo está roto contra la BD de verdad, no un mock desincronizado.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { describe, it, expect, beforeAll } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../.env.local") });
loadEnv({ path: path.resolve(here, "../../.env") }); // no pisa NEXT_PUBLIC_* ya cargadas, añade DEMO_EMAIL/DEMO_PASSWORD

const tieneCredenciales = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.DEMO_EMAIL &&
  process.env.DEMO_PASSWORD
);

describe.skipIf(!tieneCredenciales)("smoke test contra la BD real (8.1)", () => {
  let supabase;
  let data;
  let viajeIdReal = null;

  beforeAll(async () => {
    ({ supabase } = await import("./supabase.js"));
    data = await import("./data.js");

    const { error } = await supabase.auth.signInWithPassword({
      email: process.env.DEMO_EMAIL,
      password: process.env.DEMO_PASSWORD,
    });
    if (error) {
      throw new Error(`No se pudo iniciar sesión con la empresa demo (${process.env.DEMO_EMAIL}): ${error.message}`);
    }

    const { data: viajes } = await supabase.from("viaje").select("id").limit(1);
    viajeIdReal = viajes?.[0]?.id || null;
  }, 30000);

  it("getViajes() no lanza y devuelve un array", async () => {
    const r = await data.getViajes();
    expect(Array.isArray(r)).toBe(true);
  });

  it("getResumenHoy() no lanza y trae las 5 claves esperadas", async () => {
    const r = await data.getResumenHoy();
    expect(r).toHaveProperty("docsPorCaducar");
    expect(r).toHaveProperty("incidencias");
    expect(r).toHaveProperty("viajesEnRiesgo");
    expect(r).toHaveProperty("choferes561");
    expect(r).toHaveProperty("viajesPerdidas");
    expect(typeof r.todoEnOrden).toBe("boolean");
  });

  it("getMetricasRentabilidad() no lanza (7A.8)", async () => {
    const r = await data.getMetricasRentabilidad();
    expect(r).toHaveProperty("margenRealMedio");
    expect(Array.isArray(r.top5)).toBe(true);
    expect(Array.isArray(r.bottom5)).toBe(true);
  });

  it("getInformeNomina(mes, año) no lanza contra el mes actual", async () => {
    const ahora = new Date();
    const r = await data.getInformeNomina(ahora.getUTCMonth() + 1, ahora.getUTCFullYear());
    expect(Array.isArray(r.filas)).toBe(true);
  });

  it("getViabilidadViaje(id) y getPlanVsReal(id) no lanzan con un viaje real", async () => {
    if (!viajeIdReal) return; // sin datos demo, no hay id que probar — no es un fallo del código
    const viab = await data.getViabilidadViaje(viajeIdReal);
    expect(viab).not.toBeNull();
    expect(viab).toHaveProperty("km");

    const pvr = await data.getPlanVsReal(viajeIdReal);
    expect(pvr).toHaveProperty("filas");
    expect(pvr).toHaveProperty("resumen");
  });

  it("la RPC viaje_publico() responde (null con un token inexistente) sin lanzar", async () => {
    const r = await data.getViajePublico("00000000-0000-0000-0000-000000000000");
    expect(r).toBeNull();
  });
});
