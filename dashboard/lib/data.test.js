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

// Mock del cliente OSRM: por defecto devuelve una distancia fija por tramo, sin
// tocar red. Los tests que necesitan un valor concreto lo sobreescriben.
const osrmMock = vi.fn(async () => 100);
vi.mock("./osrm", () => ({
  distanciaPorCarretera: (...args) => osrmMock(...args),
}));

const {
  validarAsignacion,
  validarCambioEstado,
  getCurrentEmpresaId,
  getDocumentosPorCaducar,
  getMetricasPuntualidad,
  getMetricasIncidencias,
  getMetricasChoferes,
  getMetricasFlota,
  getInformeNomina,
  resolveCosteKm,
  calcularMargen,
  kmCarreteraViaje,
  getViabilidadViaje,
} = await import("./data.js");

beforeEach(() => {
  TABLES = {};
  SESSION = null;
  osrmMock.mockReset();
  osrmMock.mockResolvedValue(100);
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

describe("getDocumentosPorCaducar", () => {
  function fechaOffset(dias) {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  it("excluye documentos sin fecha de caducidad", async () => {
    TABLES.documento = [{ id: "d1", ambito: "viaje", entidad_id: "v1", tipo: "cmr", fecha_caducidad: null }];
    const r = await getDocumentosPorCaducar();
    expect(r).toEqual([]);
  });

  it("excluye documentos que caducan en más de 30 días", async () => {
    TABLES.documento = [{ id: "d1", ambito: "viaje", entidad_id: "v1", tipo: "cmr", fecha_caducidad: fechaOffset(45) }];
    const r = await getDocumentosPorCaducar();
    expect(r).toEqual([]);
  });

  it("incluye documentos caducados y por caducar, ordenados por urgencia", async () => {
    TABLES.documento = [
      { id: "d-lejos", ambito: "vehiculo", entidad_id: "veh1", tipo: "itv", fecha_caducidad: fechaOffset(20) },
      { id: "d-caducado", ambito: "chofer", entidad_id: "c1", tipo: "cap", fecha_caducidad: fechaOffset(-5) },
      { id: "d-cerca", ambito: "viaje", entidad_id: "v1", tipo: "adr", fecha_caducidad: fechaOffset(2) },
    ];
    TABLES.vehiculo = [{ id: "veh1", matricula: "1234ABC" }];
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1" }];

    const r = await getDocumentosPorCaducar();
    expect(r.map((d) => d.id)).toEqual(["d-caducado", "d-cerca", "d-lejos"]);
    expect(r[0].entidadEtiqueta).toBe("Mario");
    expect(r[0].href).toBe("/choferes/c1");
    expect(r[1].entidadEtiqueta).toBe("VJ-1");
    expect(r[2].entidadEtiqueta).toBe("1234ABC");
  });
});

describe("getMetricasPuntualidad", () => {
  it("devuelve null si no hay hitos con ventana", async () => {
    TABLES.hito = [{ id: "h1", viaje_id: "v1", ventana_fin: null }];
    const r = await getMetricasPuntualidad();
    expect(r.pctPuntualidad).toBeNull();
  });

  it("calcula el % de puntualidad frente a incidencias fuera_de_ventana", async () => {
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", ventana_fin: "2026-01-01T10:00:00Z" },
      { id: "h2", viaje_id: "v1", ventana_fin: "2026-01-02T10:00:00Z" },
      { id: "h3", viaje_id: "v2", ventana_fin: "2026-01-03T10:00:00Z" },
      { id: "h4", viaje_id: "v2", ventana_fin: null },
    ];
    TABLES.incidencia = [
      { id: "i1", viaje_id: "v1", tipo: "fuera_de_ventana", created_at: "2026-01-01T10:00:00Z" },
      { id: "i2", viaje_id: "v2", tipo: "otro", created_at: "2026-01-01T10:00:00Z" },
    ];
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1" }, { id: "v2", referencia: "VJ-2" }];

    const r = await getMetricasPuntualidad();
    expect(r.totalConVentana).toBe(3);
    expect(r.totalTarde).toBe(1);
    expect(r.pctPuntualidad).toBe(67); // (3-1)/3 redondeado
    expect(r.peoresRutas[0]).toEqual({ referencia: "VJ-1", incidencias: 1 });
  });
});

describe("getMetricasIncidencias", () => {
  it("devuelve ceros/tasa null cuando no hay datos", async () => {
    const r = await getMetricasIncidencias();
    expect(r.total).toBe(0);
    expect(r.tasa).toBeNull();
  });

  it("calcula total, tasa y desglose por tipo/chofer/vehiculo", async () => {
    TABLES.viaje = [
      { id: "v1", chofer_id: "c1", vehiculo_id: "veh1" },
      { id: "v2", chofer_id: "c1", vehiculo_id: "veh2" },
    ];
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.vehiculo = [{ id: "veh1", matricula: "1111AAA" }, { id: "veh2", matricula: "2222BBB" }];
    TABLES.incidencia = [
      { id: "i1", viaje_id: "v1", tipo: "averia" },
      { id: "i2", viaje_id: "v1", tipo: "averia" },
      { id: "i3", viaje_id: "v2", tipo: "otro" },
    ];

    const r = await getMetricasIncidencias();
    expect(r.total).toBe(3);
    expect(r.tasa).toBe(1.5);
    expect(r.porTipo[0]).toEqual({ tipo: "averia", count: 2 });
    expect(r.porChofer[0]).toEqual({ nombre: "Mario", count: 3 });
  });
});

describe("getMetricasChoferes", () => {
  it("devuelve una fila por chófer con viajes, valoración e incidencias", async () => {
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }, { id: "c2", nombre: "Ana" }];
    TABLES.viaje = [{ id: "v1", chofer_id: "c1" }, { id: "v2", chofer_id: "c1" }];
    TABLES.valoracion = [{ chofer_id: "c1", puntuacion: 5 }, { chofer_id: "c1", puntuacion: 3 }];
    TABLES.incidencia = [{ viaje_id: "v1", tipo: "otro" }];
    TABLES.hito = [{ viaje_id: "v1", ventana_fin: "2026-01-01T10:00:00Z" }];

    const r = await getMetricasChoferes();
    const mario = r.find((c) => c.nombre === "Mario");
    expect(mario.viajes).toBe(2);
    expect(mario.valoracionMedia).toBe(4);
    expect(mario.incidencias).toBe(1);
    expect(mario.pctPuntualidad).toBe(100);

    const ana = r.find((c) => c.nombre === "Ana");
    expect(ana.viajes).toBe(0);
    expect(ana.valoracionMedia).toBeNull();
  });
});

describe("getMetricasFlota", () => {
  it("calcula utilización, ITV pendientes y averías recientes", async () => {
    TABLES.vehiculo = [
      { id: "veh1", matricula: "1111AAA", activo: true },
      { id: "veh2", matricula: "2222BBB", activo: true },
      { id: "veh3", matricula: "3333CCC", activo: false },
    ];
    TABLES.viaje = [{ vehiculo_id: "veh1", remolque_id: null, estado: "en_curso" }];
    TABLES.mantenimiento_vehiculo = [
      { id: "m1", vehiculo_id: "veh2", tipo: "itv", estado: "pendiente", fecha: "2026-08-01" },
      { id: "m2", vehiculo_id: "veh1", tipo: "averia", estado: "completado", fecha: "2026-06-01" },
    ];

    const r = await getMetricasFlota();
    expect(r.totalVehiculos).toBe(3);
    expect(r.vehiculosActivos).toBe(2);
    expect(r.enUso).toBe(1);
    expect(r.pctUtilizacion).toBe(50);
    expect(r.itvPendientes[0].matricula).toBe("2222BBB");
    expect(r.averiasRecientes[0].matricula).toBe("1111AAA");
  });
});

describe("getInformeNomina", () => {
  const MADRID = { lat: 40.4168, lon: -3.7038 }; // base
  const BARCELONA = { lat: 41.3851, lon: 2.1734 }; // lejos (>50km)
  const CERCA_MADRID = { lat: 40.42, lon: -3.71 }; // <50km de la base

  function setBase(punto) {
    TABLES.empresa = [{ id: "emp1", base_lat: punto?.lat ?? null, base_lon: punto?.lon ?? null }];
  }

  it("nochesFuera = null cuando la empresa no tiene base configurada", async () => {
    setBase(null);
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    const r = await getInformeNomina(1, 2026);
    expect(r.tieneBase).toBe(false);
    expect(r.filas[0].nochesFuera).toBeNull();
  });

  it("cuenta una noche fuera cuando hay llegada nocturna lejos de la base", async () => {
    setBase(MADRID);
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1", chofer_id: "c1", estado: "en_curso" }];
    TABLES.hito = [{ id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...BARCELONA }];
    TABLES.ejecucion_evento = [
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo_evento: "llegada", ocurrido_en: "2026-01-15T23:30:00Z" },
    ];
    const r = await getInformeNomina(1, 2026);
    expect(r.tieneBase).toBe(true);
    expect(r.filas[0].nochesFuera).toBe(1);
    expect(r.umbralKm).toBe(50);
  });

  it("NO cuenta noche fuera si la llegada nocturna es cerca de la base", async () => {
    setBase(MADRID);
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", estado: "en_curso" }];
    TABLES.hito = [{ id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...CERCA_MADRID }];
    TABLES.ejecucion_evento = [
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo_evento: "llegada", ocurrido_en: "2026-01-15T23:30:00Z" },
    ];
    const r = await getInformeNomina(1, 2026);
    expect(r.filas[0].nochesFuera).toBe(0);
  });

  it("NO cuenta noche fuera si la llegada lejana es de día (fuera de la ventana nocturna)", async () => {
    setBase(MADRID);
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", estado: "en_curso" }];
    TABLES.hito = [{ id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...BARCELONA }];
    TABLES.ejecucion_evento = [
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo_evento: "llegada", ocurrido_en: "2026-01-15T14:00:00Z" },
    ];
    const r = await getInformeNomina(1, 2026);
    expect(r.filas[0].nochesFuera).toBe(0);
  });

  it("dedup: dos llegadas lejanas la misma noche cuentan como UNA noche fuera", async () => {
    setBase(MADRID);
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", estado: "en_curso" }];
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...BARCELONA },
      { id: "h2", viaje_id: "v1", orden: 2, estado: "completado", ...BARCELONA },
    ];
    TABLES.ejecucion_evento = [
      // 23:00 del día 15 y 01:00 del día 16 -> ambas pertenecen a la noche del 15.
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo_evento: "llegada", ocurrido_en: "2026-01-15T23:00:00Z" },
      { hito_id: "h2", viaje_id: "v1", chofer_id: "c1", tipo_evento: "llegada", ocurrido_en: "2026-01-16T01:00:00Z" },
    ];
    const r = await getInformeNomina(1, 2026);
    expect(r.filas[0].nochesFuera).toBe(1);
  });

  it("evalúa la ventana horaria en hora local de España (CEST, UTC+2), no en UTC", async () => {
    setBase(MADRID);
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", estado: "en_curso" }];
    TABLES.hito = [{ id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...BARCELONA }];
    TABLES.ejecucion_evento = [
      // 22:30 UTC en julio = 00:30 en Madrid (CEST, +2) del día siguiente:
      // en UTC puro caería en la ventana del día 15, pero localmente es
      // madrugada del 16 y debe atribuirse a la noche del 15.
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo_evento: "llegada", ocurrido_en: "2026-07-15T22:30:00Z" },
    ];
    const r = await getInformeNomina(7, 2026);
    expect(r.filas[0].nochesFuera).toBe(1);
  });

  it("una llegada a las 21:30 UTC en julio (23:30 local CEST) NO cuenta fuera de ventana si local ya está dentro de ella", async () => {
    setBase(MADRID);
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", estado: "en_curso" }];
    TABLES.hito = [{ id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...BARCELONA }];
    TABLES.ejecucion_evento = [
      // 20:30 UTC en julio = 22:30 local (CEST) -> dentro de ventana localmente,
      // pero en UTC puro (20:30) estaría FUERA de la ventana [22,6). Confirma
      // que se usa hora local, no UTC.
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo_evento: "llegada", ocurrido_en: "2026-07-15T20:30:00Z" },
    ];
    const r = await getInformeNomina(7, 2026);
    expect(r.filas[0].nochesFuera).toBe(1);
  });

  it("suma km por carretera vía OSRM entre hitos completados consecutivos", async () => {
    setBase(MADRID);
    osrmMock.mockResolvedValue(120); // cada tramo = 120 km
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1", chofer_id: "c1", estado: "completado" }];
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...MADRID },
      { id: "h2", viaje_id: "v1", orden: 2, estado: "completado", ...CERCA_MADRID },
      { id: "h3", viaje_id: "v1", orden: 3, estado: "completado", ...BARCELONA },
    ];
    TABLES.ejecucion_evento = [
      { hito_id: "h3", viaje_id: "v1", chofer_id: "c1", tipo_evento: "llegada", ocurrido_en: "2026-01-15T12:00:00Z" },
    ];
    const r = await getInformeNomina(1, 2026);
    // 3 hitos completados -> 2 tramos -> 240 km. OSRM llamado 2 veces.
    expect(r.filas[0].km).toBe(240);
    expect(r.filas[0].viajes).toEqual(["VJ-1"]);
    expect(osrmMock).toHaveBeenCalledTimes(2);
  });

  it("ignora km de viajes sin actividad (ninguna llegada) en el mes", async () => {
    setBase(MADRID);
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1", chofer_id: "c1", estado: "completado" }];
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...MADRID },
      { id: "h2", viaje_id: "v1", orden: 2, estado: "completado", ...BARCELONA },
    ];
    // Llegada en DICIEMBRE, fuera del mes consultado (enero).
    TABLES.ejecucion_evento = [
      { hito_id: "h2", viaje_id: "v1", chofer_id: "c1", tipo_evento: "llegada", ocurrido_en: "2025-12-20T12:00:00Z" },
    ];
    const r = await getInformeNomina(1, 2026);
    expect(r.filas[0].km).toBe(0);
    expect(r.filas[0].viajes).toEqual([]);
    expect(osrmMock).not.toHaveBeenCalled();
  });
});

describe("resolveCosteKm (viabilidad 5.2 — capas)", () => {
  it("usa el coste del vehículo si lo tiene (capa más granular)", () => {
    const r = resolveCosteKm({ vehiculo: { coste_km: 1.35 }, empresa: { coste_km: 1.2 } });
    expect(r).toEqual({ costeKm: 1.35, fuente: "vehiculo" });
  });

  it("cae al coste de empresa si el vehículo no tiene", () => {
    const r = resolveCosteKm({ vehiculo: { coste_km: null }, empresa: { coste_km: 1.2 } });
    expect(r).toEqual({ costeKm: 1.2, fuente: "empresa" });
  });

  it("cae a empresa si no hay vehículo asignado", () => {
    const r = resolveCosteKm({ vehiculo: null, empresa: { coste_km: 1.2 } });
    expect(r).toEqual({ costeKm: 1.2, fuente: "empresa" });
  });

  it("devuelve null si no hay ningún coste configurado", () => {
    const r = resolveCosteKm({ vehiculo: null, empresa: { coste_km: null } });
    expect(r).toEqual({ costeKm: null, fuente: null });
  });
});

describe("calcularMargen (viabilidad 5.2)", () => {
  it("calcula coste, margen y margen %", () => {
    const r = calcularMargen({ precio: 1000, km: 620, costeKm: 1.2 });
    expect(r.coste).toBe(744);
    expect(r.margen).toBe(256);
    expect(Math.round(r.margenPct)).toBe(26);
  });

  it("margen negativo cuando el coste supera el precio", () => {
    const r = calcularMargen({ precio: 500, km: 620, costeKm: 1.2 });
    expect(r.margen).toBeLessThan(0);
  });

  it("devuelve nulls si falta cualquier dato (no inventa números)", () => {
    expect(calcularMargen({ precio: null, km: 620, costeKm: 1.2 }).margen).toBeNull();
    expect(calcularMargen({ precio: 1000, km: null, costeKm: 1.2 }).margen).toBeNull();
    expect(calcularMargen({ precio: 1000, km: 620, costeKm: null }).margen).toBeNull();
  });

  it("margenPct es null si el precio es 0 (evita dividir por cero)", () => {
    expect(calcularMargen({ precio: 0, km: 100, costeKm: 1 }).margenPct).toBeNull();
  });
});

describe("kmCarreteraViaje (viabilidad 5.2)", () => {
  it("suma los tramos OSRM entre hitos con coordenadas, ordenados por orden", async () => {
    osrmMock.mockResolvedValue(50);
    const km = await kmCarreteraViaje([
      { orden: 2, lat: 41, lon: 2 },
      { orden: 1, lat: 40, lon: -3 },
      { orden: 3, lat: 42, lon: 1 },
    ]);
    expect(km).toBe(100); // 2 tramos × 50
    expect(osrmMock).toHaveBeenCalledTimes(2);
  });

  it("ignora hitos sin coordenadas", async () => {
    osrmMock.mockResolvedValue(50);
    const km = await kmCarreteraViaje([
      { orden: 1, lat: 40, lon: -3 },
      { orden: 2, lat: null, lon: null },
      { orden: 3, lat: 42, lon: 1 },
    ]);
    expect(km).toBe(50); // solo 1 tramo entre los 2 hitos con coords
    expect(osrmMock).toHaveBeenCalledTimes(1);
  });

  it("devuelve 0 con menos de 2 hitos con coordenadas", async () => {
    const km = await kmCarreteraViaje([{ orden: 1, lat: 40, lon: -3 }]);
    expect(km).toBe(0);
    expect(osrmMock).not.toHaveBeenCalled();
  });
});

describe("getViabilidadViaje (viabilidad 5.2 — integración)", () => {
  it("devuelve el margen completo con coste de empresa y km de OSRM", async () => {
    TABLES.viaje = [{ id: "v1", precio: 1000, vehiculo_id: null }];
    TABLES.hito = [
      { viaje_id: "v1", orden: 1, lat: 40, lon: -3 },
      { viaje_id: "v1", orden: 2, lat: 41, lon: 2 },
    ];
    TABLES.empresa = [{ coste_km: 1.2 }];
    osrmMock.mockResolvedValue(300); // 1 tramo = 300 km

    const r = await getViabilidadViaje("v1");
    expect(r.km).toBe(300);
    expect(r.costeKm).toBe(1.2);
    expect(r.fuenteCoste).toBe("empresa");
    expect(r.coste).toBe(360);
    expect(r.margen).toBe(640);
  });

  it("el coste del vehículo asignado tiene prioridad sobre el de la empresa", async () => {
    TABLES.viaje = [{ id: "v1", precio: 1000, vehiculo_id: "veh1" }];
    TABLES.hito = [
      { viaje_id: "v1", orden: 1, lat: 40, lon: -3 },
      { viaje_id: "v1", orden: 2, lat: 41, lon: 2 },
    ];
    TABLES.empresa = [{ coste_km: 1.2 }];
    TABLES.vehiculo = [{ id: "veh1", coste_km: 2.0 }];
    osrmMock.mockResolvedValue(100);

    const r = await getViabilidadViaje("v1");
    expect(r.fuenteCoste).toBe("vehiculo");
    expect(r.coste).toBe(200); // 100 km × 2.0
  });

  it("margen null si no hay coste/km configurado en ninguna capa", async () => {
    TABLES.viaje = [{ id: "v1", precio: 1000, vehiculo_id: null }];
    TABLES.hito = [
      { viaje_id: "v1", orden: 1, lat: 40, lon: -3 },
      { viaje_id: "v1", orden: 2, lat: 41, lon: 2 },
    ];
    TABLES.empresa = [{ coste_km: null }];

    const r = await getViabilidadViaje("v1");
    expect(r.costeKm).toBeNull();
    expect(r.margen).toBeNull();
  });
});
