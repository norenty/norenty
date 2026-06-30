import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock de Supabase: query builder en memoria sobre tablas fake ---
let TABLES = {};
let SESSION = null;

function makeBuilder(table) {
  let rows = [...(TABLES[table] || [])];
  const builder = {
    select() { return builder; },
    eq(field, value) { rows = rows.filter((r) => r[field] === value); return builder; },
    neq(field, value) { rows = rows.filter((r) => r[field] !== value); return builder; },
    in(field, values) { rows = rows.filter((r) => values.includes(r[field])); return builder; },
    order() { return builder; },
    limit(n) { rows = rows.slice(0, n); return builder; },
    single() {
      return Promise.resolve(
        rows.length ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } }
      );
    },
    insert(obj) {
      const row = { id: "new-id-" + Math.random().toString(36).slice(2), ...obj };
      (TABLES[table] = TABLES[table] || []).push(row);
      return {
        select() { return this; },
        single() { return Promise.resolve({ data: row, error: null }); },
        then(resolve) { resolve({ data: [row], error: null }); },
      };
    },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return builder;
}

vi.mock("./supabase", () => ({
  supabase: {
    from: (table) => makeBuilder(table),
    auth: {
      getSession: () => Promise.resolve({ data: { session: SESSION } }),
    },
  },
}));

const {
  validarAsignacion,
  validarCambioEstado,
  getCurrentEmpresaId,
} = await import("./data.js");

beforeEach(() => {
  TABLES = {};
  SESSION = null;
});

describe("validarAsignacion", () => {
  it("no devuelve avisos ni errores cuando no hay conflictos", async () => {
    const r = await validarAsignacion({ choferId: "c1", vehiculoId: "v1", remolqueId: "r1", referencia: "VJ-1" });
    expect(r.ok).toBe(true);
    expect(r.avisos).toEqual([]);
    expect(r.errores).toEqual([]);
  });

  it("avisa si el chófer ya está en un viaje activo (planificado)", async () => {
    TABLES.viaje = [{ id: "v-existente", referencia: "VJ-0", chofer_id: "c1", estado: "planificado" }];
    const r = await validarAsignacion({ choferId: "c1" });
    expect(r.ok).toBe(true); // es aviso, no bloquea
    expect(r.avisos[0]).toMatch(/chófer ya está asignado/);
  });

  it("NO avisa si el viaje activo del chófer es el mismo que se está editando (excluirViajeId)", async () => {
    TABLES.viaje = [{ id: "v-actual", referencia: "VJ-0", chofer_id: "c1", estado: "planificado" }];
    const r = await validarAsignacion({ choferId: "c1", excluirViajeId: "v-actual" });
    expect(r.avisos).toEqual([]);
  });

  it("NO avisa si el viaje del chófer está completado (no es estado activo)", async () => {
    TABLES.viaje = [{ id: "v-old", referencia: "VJ-OLD", chofer_id: "c1", estado: "completado" }];
    const r = await validarAsignacion({ choferId: "c1" });
    expect(r.avisos).toEqual([]);
  });

  it("avisa si el vehículo ya está en un viaje en_curso", async () => {
    TABLES.viaje = [{ id: "v-existente", referencia: "VJ-2", vehiculo_id: "veh1", estado: "en_curso" }];
    const r = await validarAsignacion({ vehiculoId: "veh1" });
    expect(r.avisos[0]).toMatch(/vehículo ya está asignado/);
  });

  it("avisa si el remolque ya está en un viaje activo", async () => {
    TABLES.viaje = [{ id: "v-existente", referencia: "VJ-3", remolque_id: "rem1", estado: "planificado" }];
    const r = await validarAsignacion({ remolqueId: "rem1" });
    expect(r.avisos[0]).toMatch(/remolque ya está asignado/);
  });

  it("ERROR (bloqueante) si la referencia ya existe", async () => {
    TABLES.viaje = [{ id: "v-existente", referencia: "VJ-DUP" }];
    const r = await validarAsignacion({ referencia: "VJ-DUP" });
    expect(r.ok).toBe(false);
    expect(r.errores[0]).toMatch(/Ya existe un viaje con referencia/);
  });

  it("ERROR si el vehículo seleccionado está inactivo", async () => {
    TABLES.vehiculo = [{ id: "veh-inactivo", activo: false }];
    const r = await validarAsignacion({ vehiculoId: "veh-inactivo" });
    expect(r.ok).toBe(false);
    expect(r.errores).toContain("El vehículo seleccionado está inactivo");
  });

  it("ERROR si el remolque seleccionado está inactivo", async () => {
    TABLES.vehiculo = [{ id: "rem-inactivo", activo: false }];
    const r = await validarAsignacion({ remolqueId: "rem-inactivo" });
    expect(r.ok).toBe(false);
    expect(r.errores).toContain("El remolque seleccionado está inactivo");
  });

  it("acumula varios avisos y errores a la vez", async () => {
    TABLES.viaje = [
      { id: "vA", referencia: "VJ-A", chofer_id: "c1", estado: "planificado" },
      { id: "vB", referencia: "VJ-DUP" },
    ];
    TABLES.vehiculo = [{ id: "veh-x", activo: false }];
    const r = await validarAsignacion({ choferId: "c1", vehiculoId: "veh-x", referencia: "VJ-DUP" });
    expect(r.ok).toBe(false);
    expect(r.avisos.length).toBe(1);
    expect(r.errores.length).toBe(2);
  });
});

describe("validarCambioEstado", () => {
  it("permite completar un viaje con todos los hitos completados", async () => {
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", estado: "completado" },
      { id: "h2", viaje_id: "v1", estado: "completado" },
    ];
    const r = await validarCambioEstado("v1", "completado");
    expect(r.ok).toBe(true);
  });

  it("bloquea completar un viaje con hitos pendientes", async () => {
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", estado: "completado" },
      { id: "h2", viaje_id: "v1", estado: "pendiente" },
    ];
    const r = await validarCambioEstado("v1", "completado");
    expect(r.ok).toBe(false);
    expect(r.errores[0]).toMatch(/1 hito\(s\) sin completar/);
  });

  it("bloquea poner en_curso un viaje sin chófer asignado", async () => {
    TABLES.viaje = [{ id: "v1", chofer_id: null }];
    const r = await validarCambioEstado("v1", "en_curso");
    expect(r.ok).toBe(false);
    expect(r.errores).toContain("No se puede poner en curso sin chófer asignado");
  });

  it("permite poner en_curso un viaje con chófer asignado", async () => {
    TABLES.viaje = [{ id: "v1", chofer_id: "c1" }];
    const r = await validarCambioEstado("v1", "en_curso");
    expect(r.ok).toBe(true);
  });

  it("no valida nada especial para otros estados (ej. cancelado)", async () => {
    const r = await validarCambioEstado("v1", "cancelado");
    expect(r.ok).toBe(true);
  });
});

describe("getCurrentEmpresaId", () => {
  it("lanza si no hay sesión activa", async () => {
    SESSION = null;
    await expect(getCurrentEmpresaId()).rejects.toThrow(/No hay sesión activa/);
  });

  it("lanza si el gestor no tiene empresa asociada", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [];
    await expect(getCurrentEmpresaId()).rejects.toThrow(/no tiene una empresa asociada/);
  });

  it("devuelve la empresa del gestor logueado", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "empresa-123" }];
    const id = await getCurrentEmpresaId();
    expect(id).toBe("empresa-123");
  });
});
