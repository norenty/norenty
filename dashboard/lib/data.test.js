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
    gte(field, value) { rows = rows.filter((r) => r[field] != null && r[field] >= value); return builder; },
    lt(field, value) { rows = rows.filter((r) => r[field] != null && r[field] < value); return builder; },
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
    delete() {
      return {
        eq(field, value) {
          TABLES[table] = (TABLES[table] || []).filter((r) => r[field] !== value);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    update(payload) {
      return {
        eq(field, value) {
          const objetivo = (TABLES[table] || []).filter((r) => r[field] === value);
          objetivo.forEach((r) => Object.assign(r, payload));
          return Promise.resolve({ data: objetivo, error: null });
        },
      };
    },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return builder;
}

let rpcResultado = { data: null, error: null };
const rpcSpy = vi.fn();

vi.mock("./supabase", () => ({
  supabase: {
    from: (table) => makeBuilder(table),
    auth: {
      getSession: () => Promise.resolve({ data: { session: SESSION } }),
    },
    rpc: (fn, args) => {
      rpcSpy(fn, args);
      return Promise.resolve(rpcResultado);
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
  calcularCosteRuta,
  calcularPresupuesto,
  MARGEN_OBJETIVO_PCT_DEFAULT,
  kmCarreteraViaje,
  getViabilidadViaje,
  resolveVelocidadPlanificacion,
  calcularEtaConParadas,
  getEtaViaje,
  VELOCIDAD_PLANIFICACION_KMH,
  getParkings,
  createParkingPropio,
  getInvitaciones,
  createInvitacion,
  deleteInvitacion,
  kmAproxViaje,
  getEstado561,
  LIMITE_561_SEMANAL_H,
  LIMITE_561_BISEMANAL_H,
  scoreChofer,
  sugerirChofer,
  registrarDecisionAsignacion,
  getResumenHoy,
  getNotasRecientes,
  createNotaGestor,
  getGastosViaje,
  createGastoViaje,
  deleteGastoViaje,
  getMultasPorChofer,
  getMultasPorVehiculo,
  getPnlViaje,
  getMetricasRentabilidad,
  getPlanVsReal,
  getOnboardingEstado,
  calcularPanelViaje,
  createViaje,
  generarTokenPublico,
  revocarTokenPublico,
  getViajePublico,
  getBotHeartbeat,
  UMBRAL_HEARTBEAT_S,
  registrarAuditoria,
  getAuditLog,
} = await import("./data.js");

beforeEach(() => {
  TABLES = {};
  SESSION = null;
  osrmMock.mockReset();
  osrmMock.mockResolvedValue(100);
  rpcSpy.mockClear();
  rpcResultado = { data: null, error: null };
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

  it("permite poner en_curso un viaje con chófer asignado y documentación vigente", async () => {
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", vehiculo_id: null }];
    TABLES.documento = [
      { ambito: "chofer", entidad_id: "c1", tipo: "licencia", fecha_caducidad: null },
      { ambito: "chofer", entidad_id: "c1", tipo: "cap", fecha_caducidad: "2099-01-01" },
    ];
    const r = await validarCambioEstado("v1", "en_curso");
    expect(r.ok).toBe(true);
  });

  it("no valida nada especial para otros estados (ej. cancelado)", async () => {
    const r = await validarCambioEstado("v1", "cancelado");
    expect(r.ok).toBe(true);
  });

  it("bloquea en_curso si al chófer le falta documentación obligatoria (licencia/CAP)", async () => {
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", vehiculo_id: null }];
    TABLES.documento = [
      { ambito: "chofer", entidad_id: "c1", tipo: "licencia", fecha_caducidad: null },
      // sin CAP
    ];
    const r = await validarCambioEstado("v1", "en_curso");
    expect(r.ok).toBe(false);
    expect(r.errores[0]).toMatch(/chófer.*CAP/i);
  });

  it("bloquea en_curso si al chófer le caducó un documento obligatorio", async () => {
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", vehiculo_id: null }];
    TABLES.documento = [
      { ambito: "chofer", entidad_id: "c1", tipo: "licencia", fecha_caducidad: "2020-01-01" }, // caducada
      { ambito: "chofer", entidad_id: "c1", tipo: "cap", fecha_caducidad: null },
    ];
    const r = await validarCambioEstado("v1", "en_curso");
    expect(r.ok).toBe(false);
    expect(r.errores[0]).toMatch(/Licencia/);
  });

  it("bloquea en_curso si al vehículo asignado le falta documentación obligatoria", async () => {
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", vehiculo_id: "veh1" }];
    TABLES.documento = [
      { ambito: "chofer", entidad_id: "c1", tipo: "licencia", fecha_caducidad: null },
      { ambito: "chofer", entidad_id: "c1", tipo: "cap", fecha_caducidad: null },
      { ambito: "vehiculo", entidad_id: "veh1", tipo: "itv", fecha_caducidad: null },
      // sin seguro ni autorización de transporte
    ];
    const r = await validarCambioEstado("v1", "en_curso");
    expect(r.ok).toBe(false);
    expect(r.errores.find((e) => e.includes("vehículo"))).toMatch(/Seguro/);
  });

  it("no exige documentación del vehículo si no hay vehículo asignado todavía", async () => {
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", vehiculo_id: null }];
    TABLES.documento = [
      { ambito: "chofer", entidad_id: "c1", tipo: "licencia", fecha_caducidad: null },
      { ambito: "chofer", entidad_id: "c1", tipo: "cap", fecha_caducidad: null },
    ];
    const r = await validarCambioEstado("v1", "en_curso");
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

// Fixtures con fechas fijas en el pasado (para no depender de "hoy"), usadas
// junto a un rango explícito amplio que las cubra — ver ítem 6.4 (las
// funciones getMetricas* ahora filtran por rango server-side, últimos 90 días
// por defecto, así que fixtures de 2026-01 necesitan pasar su propio rango).
const RANGO_AMPLIO = { desde: "2020-01-01T00:00:00Z", hasta: "2030-01-01T00:00:00Z" };

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

    const r = await getMetricasPuntualidad(RANGO_AMPLIO);
    expect(r.totalConVentana).toBe(3);
    expect(r.totalTarde).toBe(1);
    expect(r.pctPuntualidad).toBe(67); // (3-1)/3 redondeado
    expect(r.peoresRutas[0]).toEqual({ referencia: "VJ-1", incidencias: 1 });
  });

  it("acota por defecto a los últimos 90 días (server-side)", async () => {
    const hace200dias = new Date(Date.now() - 200 * 86400000).toISOString();
    TABLES.hito = [{ id: "h1", viaje_id: "v1", ventana_fin: hace200dias }];
    TABLES.incidencia = [{ id: "i1", viaje_id: "v1", tipo: "fuera_de_ventana", created_at: hace200dias }];
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1" }];

    const r = await getMetricasPuntualidad(); // sin rango explícito -> default 90 días
    expect(r.totalConVentana).toBe(0);
    expect(r.totalTarde).toBe(0);
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
      { id: "v1", chofer_id: "c1", vehiculo_id: "veh1", created_at: "2026-01-01T10:00:00Z" },
      { id: "v2", chofer_id: "c1", vehiculo_id: "veh2", created_at: "2026-01-01T10:00:00Z" },
    ];
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.vehiculo = [{ id: "veh1", matricula: "1111AAA" }, { id: "veh2", matricula: "2222BBB" }];
    TABLES.incidencia = [
      { id: "i1", viaje_id: "v1", tipo: "averia", created_at: "2026-01-01T10:00:00Z" },
      { id: "i2", viaje_id: "v1", tipo: "averia", created_at: "2026-01-01T10:00:00Z" },
      { id: "i3", viaje_id: "v2", tipo: "otro", created_at: "2026-01-01T10:00:00Z" },
    ];

    const r = await getMetricasIncidencias(RANGO_AMPLIO);
    expect(r.total).toBe(3);
    expect(r.tasa).toBe(1.5);
    expect(r.porTipo[0]).toEqual({ tipo: "averia", count: 2 });
    expect(r.porChofer[0]).toEqual({ nombre: "Mario", count: 3 });
  });
});

describe("getMetricasChoferes", () => {
  it("devuelve una fila por chófer con viajes, valoración e incidencias", async () => {
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }, { id: "c2", nombre: "Ana" }];
    TABLES.viaje = [
      { id: "v1", chofer_id: "c1", created_at: "2026-01-01T10:00:00Z" },
      { id: "v2", chofer_id: "c1", created_at: "2026-01-01T10:00:00Z" },
    ];
    TABLES.valoracion = [
      { chofer_id: "c1", puntuacion: 5, created_at: "2026-01-01T10:00:00Z" },
      { chofer_id: "c1", puntuacion: 3, created_at: "2026-01-01T10:00:00Z" },
    ];
    TABLES.incidencia = [{ viaje_id: "v1", tipo: "otro", created_at: "2026-01-01T10:00:00Z" }];
    TABLES.hito = [{ viaje_id: "v1", ventana_fin: "2026-01-01T10:00:00Z" }];

    const r = await getMetricasChoferes(RANGO_AMPLIO);
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

    const r = await getMetricasFlota(RANGO_AMPLIO);
    expect(r.totalVehiculos).toBe(3);
    expect(r.vehiculosActivos).toBe(2);
    expect(r.enUso).toBe(1);
    expect(r.pctUtilizacion).toBe(50);
    expect(r.itvPendientes[0].matricula).toBe("2222BBB");
    expect(r.averiasRecientes[0].matricula).toBe("1111AAA");
  });

  it("ITV pendientes ignora el rango (estado actual); averías recientes SI lo respeta (histórico)", async () => {
    TABLES.vehiculo = [{ id: "veh1", matricula: "1111AAA", activo: true }];
    TABLES.viaje = [];
    TABLES.mantenimiento_vehiculo = [
      // ITV con vencimiento MUY lejos en el futuro, fuera de cualquier rango de "últimos N días".
      { id: "m1", vehiculo_id: "veh1", tipo: "itv", estado: "pendiente", fecha: "2099-01-01" },
      // Avería muy antigua, fuera del rango por defecto de 90 días.
      { id: "m2", vehiculo_id: "veh1", tipo: "averia", estado: "completado", fecha: "2020-01-01" },
    ];

    const r = await getMetricasFlota(); // rango por defecto (90 días)
    expect(r.itvPendientes.length).toBe(1); // no se filtra por rango
    expect(r.averiasRecientes.length).toBe(0); // sí se filtra por rango, y 2020 queda fuera
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
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo: "llegada", ocurrido_en: "2026-01-15T23:30:00Z" },
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
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo: "llegada", ocurrido_en: "2026-01-15T23:30:00Z" },
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
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo: "llegada", ocurrido_en: "2026-01-15T14:00:00Z" },
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
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo: "llegada", ocurrido_en: "2026-01-15T23:00:00Z" },
      { hito_id: "h2", viaje_id: "v1", chofer_id: "c1", tipo: "llegada", ocurrido_en: "2026-01-16T01:00:00Z" },
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
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo: "llegada", ocurrido_en: "2026-07-15T22:30:00Z" },
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
      { hito_id: "h1", viaje_id: "v1", chofer_id: "c1", tipo: "llegada", ocurrido_en: "2026-07-15T20:30:00Z" },
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
      { hito_id: "h3", viaje_id: "v1", chofer_id: "c1", tipo: "llegada", ocurrido_en: "2026-01-15T12:00:00Z" },
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
      { hito_id: "h2", viaje_id: "v1", chofer_id: "c1", tipo: "llegada", ocurrido_en: "2025-12-20T12:00:00Z" },
    ];
    const r = await getInformeNomina(1, 2026);
    expect(r.filas[0].km).toBe(0);
    expect(r.filas[0].viajes).toEqual([]);
    expect(osrmMock).not.toHaveBeenCalled();
  });

  it("marca estimado=true en la fila del chófer si OSRM falló para algún tramo del mes (fallback 6.1)", async () => {
    setBase(MADRID);
    osrmMock.mockResolvedValue(null); // OSRM caído -> fallback Haversine
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1", chofer_id: "c1", estado: "completado" }];
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...MADRID },
      { id: "h2", viaje_id: "v1", orden: 2, estado: "completado", ...BARCELONA },
    ];
    TABLES.ejecucion_evento = [
      { hito_id: "h2", viaje_id: "v1", chofer_id: "c1", tipo: "llegada", ocurrido_en: "2026-01-15T12:00:00Z" },
    ];
    const r = await getInformeNomina(1, 2026);
    expect(r.filas[0].estimado).toBe(true);
    expect(r.filas[0].km).toBeGreaterThan(0); // no se queda en 0 como antes del fallback
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

describe("calcularCosteRuta (7A.5 — desglose por capas)", () => {
  const vehiculo = { consumo_l_100km: 30, coste_km: 1.2 };
  const empresaCompleta = {
    precio_gasoil_litro: 1.5, coste_peaje_km: 0.1, dieta_noche_eur: 40, coste_conductor_km: 0.3, coste_km: 1.2,
  };

  it("modo desglosado: calcula cada capa y el total", () => {
    const r = calcularCosteRuta({ km: 500, noches: 1, vehiculo, empresa: empresaCompleta });
    expect(r.modo).toBe("desglosado");
    expect(r.combustible).toBeCloseTo(500 * 0.3 * 1.5, 2); // 225
    expect(r.conductor).toBeCloseTo(500 * 0.3, 2); // 150
    expect(r.peajes).toBeCloseTo(500 * 0.1, 2); // 50
    expect(r.dietas).toBe(40);
    expect(r.capasFaltantes).toEqual([]);
    expect(r.total).toBeCloseTo(225 + 150 + 50 + 40, 2);
  });

  it("cada capa faltante da null y se lista en capasFaltantes", () => {
    const r = calcularCosteRuta({
      km: 500, noches: 1, vehiculo,
      empresa: { precio_gasoil_litro: 1.5 }, // sin peaje/dieta/conductor
    });
    expect(r.conductor).toBeNull();
    expect(r.peajes).toBeNull();
    expect(r.dietas).toBeNull();
    expect(r.capasFaltantes.sort()).toEqual(["conductor", "dietas", "peajes"]);
    expect(r.total).toBeCloseTo(r.combustible, 2); // solo suma lo no-null
  });

  it("noches=0 da dietas=0 aunque falte la tarifa configurada", () => {
    const r = calcularCosteRuta({ km: 500, noches: 0, vehiculo, empresa: { precio_gasoil_litro: 1.5 } });
    expect(r.dietas).toBe(0);
    expect(r.capasFaltantes).not.toContain("dietas");
  });

  it("sin datos de combustible cae a modo blended (idéntico a 5.2)", () => {
    const r = calcularCosteRuta({ km: 620, noches: 0, vehiculo: { coste_km: 1.2 }, empresa: {} });
    expect(r.modo).toBe("blended");
    expect(r.total).toBeCloseTo(620 * 1.2, 2);
  });

  it("sin ningún coste configurado, modo y total son null", () => {
    const r = calcularCosteRuta({ km: 620, noches: 0, vehiculo: null, empresa: {} });
    expect(r.modo).toBeNull();
    expect(r.total).toBeNull();
  });
});

describe("calcularPresupuesto (7A.6 — presupuestador instantáneo)", () => {
  const MADRID = { lat: 40.4168, lon: -3.7038 };
  const BARCELONA = { lat: 41.3851, lon: 2.1734 };

  it("caso feliz completo: km, coste, precio sugerido con margen objetivo", async () => {
    TABLES.empresa = [{
      velocidad_planificacion_kmh: 75, coste_km: 1.2, margen_objetivo_pct: 20,
    }];
    osrmMock.mockResolvedValue(300);
    const r = await calcularPresupuesto({ puntos: [MADRID, BARCELONA] });
    expect(r.km).toBeGreaterThan(0);
    expect(r.coste.total).toBeGreaterThan(0);
    expect(r.precioSugerido).toBeCloseTo(r.coste.total / (1 - 20 / 100), 2);
    expect(r.margenObjetivo).toBe(20);
  });

  it("sin costes configurados, precioSugerido es null pero el resto del cálculo no falla", async () => {
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75 }];
    osrmMock.mockResolvedValue(300);
    const r = await calcularPresupuesto({ puntos: [MADRID, BARCELONA] });
    expect(r.precioSugerido).toBeNull();
    expect(r.km).toBeGreaterThan(0);
  });

  it("usa el margen objetivo de la empresa, o el default si no está configurado", async () => {
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75, coste_km: 1 }];
    osrmMock.mockResolvedValue(100);
    const r = await calcularPresupuesto({ puntos: [MADRID, BARCELONA] });
    expect(r.margenObjetivo).toBe(MARGEN_OBJETIVO_PCT_DEFAULT);
  });

  it("con menos de 2 puntos, km es 0 y no lanza", async () => {
    const r = await calcularPresupuesto({ puntos: [MADRID] });
    expect(r.km).toBe(0);
    expect(r.precioSugerido).toBeNull();
  });
});

describe("kmCarreteraViaje (viabilidad 5.2)", () => {
  it("suma los tramos OSRM entre hitos con coordenadas, ordenados por orden", async () => {
    osrmMock.mockResolvedValue(50);
    const r = await kmCarreteraViaje([
      { orden: 2, lat: 41, lon: 2 },
      { orden: 1, lat: 40, lon: -3 },
      { orden: 3, lat: 42, lon: 1 },
    ]);
    expect(r.km).toBe(100); // 2 tramos × 50
    expect(r.estimado).toBe(false);
    expect(osrmMock).toHaveBeenCalledTimes(2);
  });

  it("ignora hitos sin coordenadas", async () => {
    osrmMock.mockResolvedValue(50);
    const r = await kmCarreteraViaje([
      { orden: 1, lat: 40, lon: -3 },
      { orden: 2, lat: null, lon: null },
      { orden: 3, lat: 42, lon: 1 },
    ]);
    expect(r.km).toBe(50); // solo 1 tramo entre los 2 hitos con coords
    expect(osrmMock).toHaveBeenCalledTimes(1);
  });

  it("devuelve 0 con menos de 2 hitos con coordenadas", async () => {
    const r = await kmCarreteraViaje([{ orden: 1, lat: 40, lon: -3 }]);
    expect(r.km).toBe(0);
    expect(r.estimado).toBe(false);
    expect(osrmMock).not.toHaveBeenCalled();
  });

  // --- Fallback Haversine (ítem 6.1) ---

  it("usa Haversine × 1.3 y marca estimado=true si OSRM devuelve null en un tramo", async () => {
    osrmMock.mockResolvedValue(null);
    const r = await kmCarreteraViaje([
      { orden: 1, lat: 40.4168, lon: -3.7038 }, // Madrid
      { orden: 2, lat: 41.3851, lon: 2.1734 },  // Barcelona (~504 km en línea recta)
    ]);
    expect(r.estimado).toBe(true);
    expect(r.km).toBeGreaterThan(500); // 504km haversine × 1.3 ≈ 655km
    expect(r.km).toBeLessThan(700);
  });

  it("mezcla tramos OSRM reales con tramos estimados en el mismo viaje", async () => {
    osrmMock.mockResolvedValueOnce(100).mockResolvedValueOnce(null);
    const r = await kmCarreteraViaje([
      { orden: 1, lat: 40, lon: -3 },
      { orden: 2, lat: 40.5, lon: -3.5 },
      { orden: 3, lat: 41, lon: -4 },
    ]);
    expect(r.estimado).toBe(true);
    expect(r.km).toBeGreaterThan(100); // el tramo 1 (OSRM=100) + el tramo 2 (haversine estimado, >0)
  });

  it("no marca estimado si todos los tramos responden por OSRM", async () => {
    osrmMock.mockResolvedValue(80);
    const r = await kmCarreteraViaje([
      { orden: 1, lat: 40, lon: -3 },
      { orden: 2, lat: 41, lon: -4 },
    ]);
    expect(r.estimado).toBe(false);
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

  it("marca estimado=true si OSRM no responde (fallback Haversine, ítem 6.1)", async () => {
    TABLES.viaje = [{ id: "v1", precio: 1000, vehiculo_id: null }];
    TABLES.hito = [
      { viaje_id: "v1", orden: 1, lat: 40, lon: -3 },
      { viaje_id: "v1", orden: 2, lat: 41, lon: 2 },
    ];
    TABLES.empresa = [{ coste_km: 1.2 }];
    osrmMock.mockResolvedValue(null);

    const r = await getViabilidadViaje("v1");
    expect(r.estimado).toBe(true);
    expect(r.km).toBeGreaterThan(0);
    expect(r.margen).not.toBeNull(); // el margen se sigue calculando con el km estimado
  });
});

describe("resolveVelocidadPlanificacion (ETA 5.3)", () => {
  it("usa la velocidad de la empresa si está configurada y es positiva", () => {
    expect(resolveVelocidadPlanificacion({ velocidad_planificacion_kmh: 65 })).toBe(65);
  });

  it("cae al valor por defecto si la empresa no la tiene", () => {
    expect(resolveVelocidadPlanificacion({ velocidad_planificacion_kmh: null })).toBe(VELOCIDAD_PLANIFICACION_KMH);
    expect(resolveVelocidadPlanificacion(null)).toBe(VELOCIDAD_PLANIFICACION_KMH);
  });

  it("ignora un valor de empresa no positivo (dato corrupto)", () => {
    expect(resolveVelocidadPlanificacion({ velocidad_planificacion_kmh: 0 })).toBe(VELOCIDAD_PLANIFICACION_KMH);
    expect(resolveVelocidadPlanificacion({ velocidad_planificacion_kmh: -10 })).toBe(VELOCIDAD_PLANIFICACION_KMH);
  });
});

describe("calcularEtaConParadas (ETA 5.3 — Reglamento CE 561/2006, pura)", () => {
  it("0 horas de conducción: sin paradas", () => {
    const r = calcularEtaConParadas(0);
    expect(r).toEqual({ horasTotales: 0, paradas45min: 0, descansos11h: 0 });
  });

  it("por debajo de 4.5h: sin paradas obligatorias", () => {
    const r = calcularEtaConParadas(3);
    expect(r).toEqual({ horasTotales: 3, paradas45min: 0, descansos11h: 0 });
  });

  it("5h de conducción: 1 pausa de 45min, sin descanso diario", () => {
    const r = calcularEtaConParadas(5);
    expect(r.paradas45min).toBe(1);
    expect(r.descansos11h).toBe(0);
    expect(r.horasTotales).toBeCloseTo(5.75, 5); // 5h conduccion + 0.75h pausa
  });

  it("9h exactas: 1 pausa, termina justo en el límite diario sin necesitar descanso", () => {
    const r = calcularEtaConParadas(9);
    expect(r.paradas45min).toBe(1);
    expect(r.descansos11h).toBe(0);
    expect(r.horasTotales).toBeCloseTo(9.75, 5);
  });

  it("10h de conducción: supera el límite diario -> 1 pausa + 1 descanso de 11h", () => {
    const r = calcularEtaConParadas(10);
    expect(r.paradas45min).toBe(1);
    expect(r.descansos11h).toBe(1);
    expect(r.horasTotales).toBeCloseTo(21.75, 5); // 10h + 0.75h pausa + 11h descanso
  });

  it("18h de conducción (2 días completos de 9h): 2 pausas, 1 descanso", () => {
    const r = calcularEtaConParadas(18);
    expect(r.paradas45min).toBe(2);
    expect(r.descansos11h).toBe(1);
    expect(r.horasTotales).toBeCloseTo(30.5, 5); // 18h + 2×0.75h + 1×11h
  });
});

describe("getEtaViaje (ETA 5.3 — integración)", () => {
  it("calcula horas totales y paradas a partir de los km por carretera y la velocidad de la empresa", async () => {
    TABLES.viaje = [{ id: "v1" }];
    TABLES.hito = [
      { viaje_id: "v1", orden: 1, lat: 40, lon: -3 },
      { viaje_id: "v1", orden: 2, lat: 41, lon: 2 },
    ];
    TABLES.empresa = [{ velocidad_planificacion_kmh: 100 }];
    osrmMock.mockResolvedValue(500); // 1 tramo = 500 km

    const r = await getEtaViaje("v1");
    expect(r.km).toBe(500);
    expect(r.velocidadKmh).toBe(100);
    expect(r.horasConduccion).toBe(5); // 500km / 100km/h
    expect(r.paradas45min).toBe(1);
  });

  it("usa la velocidad por defecto (75) si la empresa no la configura", async () => {
    TABLES.viaje = [{ id: "v1" }];
    TABLES.hito = [
      { viaje_id: "v1", orden: 1, lat: 40, lon: -3 },
      { viaje_id: "v1", orden: 2, lat: 41, lon: 2 },
    ];
    TABLES.empresa = [{ velocidad_planificacion_kmh: null }];
    osrmMock.mockResolvedValue(75);

    const r = await getEtaViaje("v1");
    expect(r.velocidadKmh).toBe(VELOCIDAD_PLANIFICACION_KMH);
    expect(r.horasConduccion).toBe(1);
  });

  it("devuelve km 0 y sin paradas si no hay coordenadas suficientes", async () => {
    TABLES.viaje = [{ id: "v1" }];
    TABLES.hito = [{ viaje_id: "v1", orden: 1, lat: 40, lon: -3 }];
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75 }];

    const r = await getEtaViaje("v1");
    expect(r.km).toBe(0);
    expect(r.paradas45min).toBe(0);
    expect(osrmMock).not.toHaveBeenCalled();
  });

  it("marca estimado=true si OSRM no responde (fallback Haversine, ítem 6.1)", async () => {
    TABLES.viaje = [{ id: "v1" }];
    TABLES.hito = [
      { viaje_id: "v1", orden: 1, lat: 40, lon: -3 },
      { viaje_id: "v1", orden: 2, lat: 41, lon: 2 },
    ];
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75 }];
    osrmMock.mockResolvedValue(null);

    const r = await getEtaViaje("v1");
    expect(r.estimado).toBe(true);
    expect(r.km).toBeGreaterThan(0);
  });
});

describe("parkings (5.4)", () => {
  it("getParkings devuelve dataset abierto y propios (RLS filtra en real; el mock devuelve todo)", async () => {
    TABLES.parking = [
      { id: "p1", nombre: "Rest Area", tipo: "rest_area", lat: 41, lon: 2, fuente: "dataset_abierto" },
      { id: "p2", nombre: "Mi parking", tipo: "parking", lat: 40, lon: -3, fuente: "empresa" },
    ];
    const r = await getParkings();
    expect(r.length).toBe(2);
  });

  it("createParkingPropio inserta con la empresa del gestor y fuente='empresa'", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "emp1" }];
    const r = await createParkingPropio({ nombre: "  Parking N-II  ", tipo: "parking", lat: 40.5, lon: -3.2, notas: "" });
    expect(r.empresa_id).toBe("emp1");
    expect(r.fuente).toBe("empresa");
    expect(r.nombre).toBe("Parking N-II");
    expect(r.notas).toBeNull();
  });

  it("createParkingPropio lanza si no hay sesión (getCurrentEmpresaId falla)", async () => {
    SESSION = null;
    await expect(
      createParkingPropio({ nombre: "X", tipo: "parking", lat: 1, lon: 1 })
    ).rejects.toThrow(/No hay sesión activa/);
  });
});

describe("invitaciones (6.9)", () => {
  it("getInvitaciones devuelve las invitaciones (RLS filtra por empresa en real)", async () => {
    TABLES.invitacion = [
      { id: "i1", email: "a@x.com", codigo: "c1", usada_at: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "i2", email: "b@x.com", codigo: "c2", usada_at: "2026-01-02T00:00:00Z", created_at: "2026-01-02T00:00:00Z" },
    ];
    const r = await getInvitaciones();
    expect(r.length).toBe(2);
  });

  it("createInvitacion inserta con la empresa del gestor logueado", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "emp1" }];
    const r = await createInvitacion("  nuevo@empresa.com  ");
    expect(r.empresa_id).toBe("emp1");
    expect(r.email).toBe("nuevo@empresa.com");
  });

  it("createInvitacion lanza si no hay sesión", async () => {
    SESSION = null;
    await expect(createInvitacion("x@y.com")).rejects.toThrow(/No hay sesión activa/);
  });

  it("deleteInvitacion borra la fila", async () => {
    TABLES.invitacion = [{ id: "i1", email: "a@x.com" }];
    await deleteInvitacion("i1");
    expect(TABLES.invitacion.find((i) => i.id === "i1")).toBeUndefined();
  });
});

describe("estado 561 (7A.1)", () => {
  const MADRID = { lat: 40.4168, lon: -3.7038 };
  const BARCELONA = { lat: 41.3851, lon: 2.1734 }; // ~504 km Haversine

  function hace(dias) {
    return new Date(Date.now() - dias * 86400000).toISOString();
  }

  it("kmAproxViaje suma Haversine × 1.3 entre hitos con coords, ordenados", () => {
    const km = kmAproxViaje([
      { orden: 2, ...BARCELONA },
      { orden: 1, ...MADRID },
    ]);
    // ~504 km haversine × 1.3 ≈ 655 km
    expect(km).toBeGreaterThan(600);
    expect(km).toBeLessThan(700);
  });

  it("kmAproxViaje ignora hitos sin coordenadas", () => {
    const km = kmAproxViaje([
      { orden: 1, ...MADRID },
      { orden: 2, lat: null, lon: null },
    ]);
    expect(km).toBe(0);
  });

  it("sin eventos de llegada devuelve todo a cero y margen completo", async () => {
    TABLES.ejecucion_evento = [];
    const r = await getEstado561("c1");
    expect(r.horas7).toBe(0);
    expect(r.margen7).toBe(LIMITE_561_SEMANAL_H);
    expect(r.margen14).toBe(LIMITE_561_BISEMANAL_H);
    expect(r.estimado).toBe(true);
  });

  it("un viaje con llegada dentro de 7 días cuenta en horas7 y horas14", async () => {
    TABLES.ejecucion_evento = [
      { tipo: "llegada", chofer_id: "c1", viaje_id: "v1", ocurrido_en: hace(2) },
    ];
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...MADRID },
      { id: "h2", viaje_id: "v1", orden: 2, estado: "completado", ...BARCELONA },
    ];
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75 }];
    const r = await getEstado561("c1");
    expect(r.horas7).toBeGreaterThan(0);
    expect(r.horas7).toBe(r.horas14); // el mismo viaje cuenta en ambos periodos
    expect(r.margen7).toBeLessThan(LIMITE_561_SEMANAL_H);
  });

  it("un viaje de hace 10 días cuenta solo en horas14, no en horas7", async () => {
    TABLES.ejecucion_evento = [
      { tipo: "llegada", chofer_id: "c1", viaje_id: "v1", ocurrido_en: hace(10) },
    ];
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...MADRID },
      { id: "h2", viaje_id: "v1", orden: 2, estado: "completado", ...BARCELONA },
    ];
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75 }];
    const r = await getEstado561("c1");
    expect(r.horas7).toBe(0);
    expect(r.horas14).toBeGreaterThan(0);
  });

  it("una llegada de hace 20 días queda fuera de la ventana de 14", async () => {
    TABLES.ejecucion_evento = [
      { tipo: "llegada", chofer_id: "c1", viaje_id: "v1", ocurrido_en: hace(20) },
    ];
    const r = await getEstado561("c1");
    expect(r.horas14).toBe(0);
  });

  it("calcula pct y margen coherentes con los límites", async () => {
    TABLES.ejecucion_evento = [
      { tipo: "llegada", chofer_id: "c1", viaje_id: "v1", ocurrido_en: hace(1) },
    ];
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...MADRID },
      { id: "h2", viaje_id: "v1", orden: 2, estado: "completado", ...BARCELONA },
    ];
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75 }];
    const r = await getEstado561("c1");
    expect(r.pct7).toBe(Math.round((r.horas7 / LIMITE_561_SEMANAL_H) * 100));
    expect(r.margen7).toBeCloseTo(LIMITE_561_SEMANAL_H - r.horas7, 1);
  });
});

describe("motor de asignación (7A.2)", () => {
  const base = {
    tieneViajeActivo: false,
    estado561: { margen7: 56 },
    docsCaducados: [],
    distanciaOrigenKm: 20,
    metricas: { viajes: 10, pctPuntualidad: 100, incidencias: 0, valoracionMedia: 5 },
    horasViaje: 8,
  };

  it("disponibilidad: +40 si no tiene viaje activo, +0 si sí", () => {
    const libre = scoreChofer(base);
    const ocupado = scoreChofer({ ...base, tieneViajeActivo: true });
    expect(ocupado.score).toBe(libre.score - 40);
    expect(libre.razones).toContain("Disponible");
    expect(ocupado.razones).toContain("En viaje ahora");
  });

  it("margen 561: sin datos da un valor neutro, con margen amplio da máximo", () => {
    const sinDatos = scoreChofer({ ...base, estado561: null });
    const margenAmplio = scoreChofer({ ...base, estado561: { margen7: 56 }, horasViaje: 1 });
    expect(sinDatos.razones).toContain("Sin datos de horas");
    expect(margenAmplio.razones.some((r) => r.includes("margen semanal"))).toBe(true);
  });

  it("documentos caducados bloquea en vez de sumar puntos", () => {
    const ok = scoreChofer(base);
    const caducado = scoreChofer({ ...base, docsCaducados: ["licencia"] });
    expect(ok.razones).toContain("Documentos en vigor");
    expect(caducado.bloqueos[0]).toMatch(/licencia/);
    expect(caducado.score).toBe(ok.score - 15);
  });

  it("proximidad: escalones de distancia correctos", () => {
    expect(scoreChofer({ ...base, distanciaOrigenKm: null }).razones).toContain("Ubicación desconocida");
    const cerca = scoreChofer({ ...base, distanciaOrigenKm: 10 });
    const lejos = scoreChofer({ ...base, distanciaOrigenKm: 600 });
    expect(cerca.score).toBeGreaterThan(lejos.score);
  });

  it("historial: sin viajes da razón neutra, con buen desempeño puntúa alto", () => {
    const sinHistorial = scoreChofer({ ...base, metricas: null });
    const conHistorial = scoreChofer(base);
    expect(sinHistorial.razones).toContain("Sin historial de viajes");
    expect(conHistorial.razones.some((r) => r.includes("viajes previos"))).toBe(true);
  });

  it("historial penaliza incidencias frecuentes frente a un chófer limpio", () => {
    const limpio = scoreChofer({ ...base, metricas: { viajes: 10, pctPuntualidad: 100, incidencias: 0, valoracionMedia: 5 } });
    const conIncidencias = scoreChofer({ ...base, metricas: { viajes: 10, pctPuntualidad: 100, incidencias: 8, valoracionMedia: 5 } });
    expect(conIncidencias.score).toBeLessThan(limpio.score);
  });

  it("combinación máxima teórica da 100", () => {
    const r = scoreChofer(base); // disponible, margen máx, docs ok, cerca, historial perfecto
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThan(90);
  });

  it("sugerirChofer ordena por score y excluye el propio viaje de 'activo'", async () => {
    TABLES.chofer = [
      { id: "c1", nombre: "Ana", idioma: "es" },
      { id: "c2", nombre: "Bruno", idioma: "es" },
    ];
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", estado: "en_curso" }];
    TABLES.documento = [];
    TABLES.ubicacion = [];
    TABLES.hito = [
      { orden: 1, lat: 40.4168, lon: -3.7038, viaje_id: "v-actual" },
    ];
    TABLES.valoracion = [];
    TABLES.incidencia = [];
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75 }];
    TABLES.ejecucion_evento = [];

    const ranking = await sugerirChofer("v-actual");
    expect(ranking).toHaveLength(2);
    // c1 tiene un viaje activo en OTRO viaje (v1) -> penalizado frente a c2, libre
    const bruno = ranking.find((r) => r.chofer.id === "c2");
    const ana = ranking.find((r) => r.chofer.id === "c1");
    expect(bruno.score).toBeGreaterThan(ana.score);
  });

  it("sugerirChofer con viajeId null y hitosOverride (wizard 7A.11, viaje aún no creado)", async () => {
    TABLES.chofer = [{ id: "c1", nombre: "Ana", idioma: "es" }];
    TABLES.viaje = [];
    TABLES.documento = [];
    TABLES.ubicacion = [];
    TABLES.hito = []; // no se consulta: se usa hitosOverride
    TABLES.valoracion = [];
    TABLES.incidencia = [];
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75 }];
    TABLES.ejecucion_evento = [];

    const ranking = await sugerirChofer(null, {
      hitosOverride: [
        { orden: 1, lat: 40.4168, lon: -3.7038 },
        { orden: 2, lat: 41.3851, lon: 2.1734 },
      ],
    });
    expect(ranking).toHaveLength(1);
    expect(ranking[0].chofer.nombre).toBe("Ana");
    expect(ranking[0].razones).toContain("Disponible"); // sin viajes activos, nada que excluir
  });

  it("registrarDecisionAsignacion marca siguio_sugerencia correctamente", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.decision_asignacion = [];

    await registrarDecisionAsignacion({
      viajeId: "v1", choferSugeridoId: "c1", scoreSugerido: 90,
      choferElegidoId: "c1", scoreElegido: 90,
    });
    await registrarDecisionAsignacion({
      viajeId: "v2", choferSugeridoId: "c1", scoreSugerido: 90,
      choferElegidoId: "c2", scoreElegido: 70, motivo: "conoce la ruta",
    });

    expect(TABLES.decision_asignacion).toHaveLength(2);
    expect(TABLES.decision_asignacion[0].siguio_sugerencia).toBe(true);
    expect(TABLES.decision_asignacion[1].siguio_sugerencia).toBe(false);
    expect(TABLES.decision_asignacion[1].motivo).toBe("conoce la ruta");
  });

  it("registrarDecisionAsignacion no lanza si falla (sin sesión)", async () => {
    SESSION = null;
    await expect(
      registrarDecisionAsignacion({ viajeId: "v1", choferSugeridoId: null, choferElegidoId: "c1" })
    ).resolves.not.toThrow();
  });
});

describe("centro de mando Hoy + notas (7A.10)", () => {
  it("todoEnOrden es true cuando no hay nada pendiente", async () => {
    TABLES.documento = [];
    TABLES.incidencia = [];
    TABLES.viaje = [];
    const r = await getResumenHoy();
    expect(r.todoEnOrden).toBe(true);
    expect(r.docsPorCaducar).toBe(0);
    expect(r.incidencias.count).toBe(0);
  });

  it("todoEnOrden es false si hay incidencias abiertas, con la más antigua calculada", async () => {
    TABLES.documento = [];
    TABLES.viaje = [];
    TABLES.incidencia = [
      { id: "i1", estado: "abierta", created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
      { id: "i2", estado: "resuelta", created_at: new Date().toISOString() },
    ];
    const r = await getResumenHoy();
    expect(r.todoEnOrden).toBe(false);
    expect(r.incidencias.count).toBe(1);
    expect(r.incidencias.masAntiguaDias).toBeGreaterThanOrEqual(2);
  });

  it("detecta un viaje en riesgo (hito sin completar con ventana ya pasada)", async () => {
    TABLES.documento = [];
    TABLES.incidencia = [];
    TABLES.viaje = [{ id: "v1", referencia: "REF1", chofer_id: null, estado: "en_curso" }];
    TABLES.hito = [
      { viaje_id: "v1", estado: "pendiente", ventana_fin: new Date(Date.now() - 3600000).toISOString() },
    ];
    const r = await getResumenHoy();
    expect(r.viajesEnRiesgo.count).toBe(1);
    expect(r.viajesEnRiesgo.refs).toContain("REF1");
    expect(r.todoEnOrden).toBe(false);
  });

  it("561: solo cuenta chóferes con viaje activo ahora mismo", async () => {
    TABLES.documento = [];
    TABLES.incidencia = [];
    TABLES.hito = [];
    TABLES.viaje = [{ id: "v1", referencia: "REF1", chofer_id: "c1", estado: "en_curso" }];
    TABLES.chofer = [{ id: "c1", nombre: "Mario" }];
    TABLES.ejecucion_evento = [
      { tipo: "llegada", chofer_id: "c1", viaje_id: "v0", ocurrido_en: new Date().toISOString() },
    ];
    TABLES.hito = [
      { id: "h1", viaje_id: "v0", orden: 1, estado: "completado", lat: 40.4168, lon: -3.7038 },
      { id: "h2", viaje_id: "v0", orden: 2, estado: "completado", lat: 41.3851, lon: 2.1734 },
    ];
    TABLES.empresa = [{ velocidad_planificacion_kmh: 1 }]; // fuerza muchas horas -> pct7 alto
    const r = await getResumenHoy();
    expect(r.choferes561.nombres).toContain("Mario");
  });

  it("createNotaGestor resuelve el gestor_id de la sesión e inserta", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1", id: "g1" }];
    TABLES.nota_gestor = [];
    await createNotaGestor({ texto: "  ojo con este cliente  " });
    expect(TABLES.nota_gestor).toHaveLength(1);
    expect(TABLES.nota_gestor[0].texto).toBe("ojo con este cliente");
    expect(TABLES.nota_gestor[0].empresa_id).toBe("e1");
  });

  it("getNotasRecientes respeta el límite y ordena por más reciente", async () => {
    TABLES.nota_gestor = [
      { id: "n1", texto: "vieja", viaje_id: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "n2", texto: "nueva", viaje_id: null, created_at: "2026-02-01T00:00:00Z" },
      { id: "n3", texto: "media", viaje_id: null, created_at: "2026-01-15T00:00:00Z" },
    ];
    const r = await getNotasRecientes(2);
    expect(r).toHaveLength(2);
    expect(r[0].texto).toBe("nueva");
  });
});

describe("gastos del viaje (7A.7)", () => {
  it("createGastoViaje inserta con la empresa del gestor logueado", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.gasto_viaje = [];
    const g = await createGastoViaje({ viajeId: "v1", tipo: "repostaje", importe: 120, litros: 80 });
    expect(g.empresa_id).toBe("e1");
    expect(TABLES.gasto_viaje).toHaveLength(1);
    expect(TABLES.gasto_viaje[0].tipo).toBe("repostaje");
  });

  it("getGastosViaje filtra por viaje", async () => {
    TABLES.gasto_viaje = [
      { id: "g1", viaje_id: "v1", tipo: "peaje", importe: 10, fecha: "2026-01-01" },
      { id: "g2", viaje_id: "v2", tipo: "multa", importe: 100, fecha: "2026-01-01" },
    ];
    const r = await getGastosViaje("v1");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("g1");
  });

  it("getMultasPorChofer solo cuenta tipo multa y suma el total", async () => {
    TABLES.gasto_viaje = [
      { id: "g1", chofer_id: "c1", tipo: "multa", importe: 100, fecha: "2026-01-01" },
      { id: "g2", chofer_id: "c1", tipo: "peaje", importe: 10, fecha: "2026-01-01" },
      { id: "g3", chofer_id: "c1", tipo: "multa", importe: 50, fecha: "2026-02-01" },
    ];
    const r = await getMultasPorChofer("c1");
    expect(r.total).toBe(150);
    expect(r.ultimas).toHaveLength(2);
  });

  it("getMultasPorVehiculo funciona igual que por chófer pero filtrando por vehículo", async () => {
    TABLES.gasto_viaje = [
      { id: "g1", vehiculo_id: "vh1", tipo: "multa", importe: 200, fecha: "2026-01-01" },
      { id: "g2", vehiculo_id: "vh2", tipo: "multa", importe: 999, fecha: "2026-01-01" },
    ];
    const r = await getMultasPorVehiculo("vh1");
    expect(r.total).toBe(200);
  });

  it("deleteGastoViaje borra la fila", async () => {
    TABLES.gasto_viaje = [{ id: "g1", viaje_id: "v1", tipo: "peaje", importe: 10 }];
    await deleteGastoViaje("g1");
    expect(TABLES.gasto_viaje).toHaveLength(0);
  });
});

describe("P&L real del viaje (7A.8)", () => {
  const MADRID = { lat: 40.4168, lon: -3.7038 };
  const BARCELONA = { lat: 41.3851, lon: 2.1734 };

  function setupViaje({ precio = 1000, coste_km = 1 } = {}) {
    TABLES.viaje = [{ id: "v1", precio, vehiculo_id: null }];
    TABLES.hito = [
      { orden: 1, ...MADRID, viaje_id: "v1" },
      { orden: 2, ...BARCELONA, viaje_id: "v1" },
    ];
    TABLES.empresa = [{ coste_km, velocidad_planificacion_kmh: 75 }];
  }

  it("con gastos: calcula margen real y desviación frente al estimado", async () => {
    setupViaje();
    TABLES.gasto_viaje = [
      { id: "g1", viaje_id: "v1", tipo: "repostaje", importe: 100 },
      { id: "g2", viaje_id: "v1", tipo: "peaje", importe: 50 },
    ];
    const pnl = await getPnlViaje("v1");
    expect(pnl.gastosReales).toBe(150);
    expect(pnl.margenReal).toBe(pnl.precio - 150);
    expect(pnl.numGastos).toBe(2);
    expect(pnl.desviacionPct).not.toBeNull();
  });

  it("sin gastos: gastosReales es 0 y desviacionPct es null (nada que comparar)", async () => {
    setupViaje();
    TABLES.gasto_viaje = [];
    const pnl = await getPnlViaje("v1");
    expect(pnl.gastosReales).toBe(0);
    expect(pnl.desviacionPct).toBeNull();
    expect(pnl.numGastos).toBe(0);
  });

  it("sin precio: precio y margenReal son null, pero no lanza", async () => {
    setupViaje({ precio: null });
    TABLES.gasto_viaje = [{ id: "g1", viaje_id: "v1", tipo: "multa", importe: 100 }];
    const pnl = await getPnlViaje("v1");
    expect(pnl.precio).toBeNull();
    expect(pnl.margenReal).toBeNull();
  });

  it("getMetricasRentabilidad agrega margen real medio y detecta pérdidas reales", async () => {
    const haceUnaHora = new Date(Date.now() - 3600000).toISOString(); // claramente dentro de la ventana, sin empatar con "hasta"
    TABLES.viaje = [
      { id: "v1", referencia: "R1", precio: 1000, vehiculo_id: null, created_at: haceUnaHora },
      { id: "v2", referencia: "R2", precio: 100, vehiculo_id: null, created_at: haceUnaHora },
    ];
    TABLES.hito = [
      { orden: 1, ...MADRID, viaje_id: "v1" }, { orden: 2, ...BARCELONA, viaje_id: "v1" },
      { orden: 1, ...MADRID, viaje_id: "v2" }, { orden: 2, ...BARCELONA, viaje_id: "v2" },
    ];
    TABLES.empresa = [{ coste_km: 1, velocidad_planificacion_kmh: 75 }];
    TABLES.gasto_viaje = [
      { id: "g1", viaje_id: "v2", tipo: "multa", importe: 900 }, // v2 se va a pérdidas reales
    ];
    const r = await getMetricasRentabilidad();
    expect(r.viajesAPerdidasReales).toBe(1);
    expect(r.margenRealMedio).not.toBeNull();
    expect(r.top5.length).toBeGreaterThan(0);
  });
});

describe("plan-vs-real por hito (7A.9)", () => {
  it("hito a tiempo: delta <= 0", async () => {
    TABLES.hito = [{ id: "h1", viaje_id: "v1", orden: 1, ventana_fin: "2026-01-01T10:00:00Z" }];
    TABLES.ejecucion_evento = [{ tipo: "llegada", viaje_id: "v1", hito_id: "h1", ocurrido_en: "2026-01-01T09:50:00Z" }];
    const r = await getPlanVsReal("v1");
    expect(r.filas[0].estado).toBe("a_tiempo");
    expect(r.filas[0].deltaMin).toBeLessThanOrEqual(0);
    expect(r.resumen.aTiempo).toBe(1);
  });

  it("tarde leve: entre 1 y 60 minutos de retraso", async () => {
    TABLES.hito = [{ id: "h1", viaje_id: "v1", orden: 1, ventana_fin: "2026-01-01T10:00:00Z" }];
    TABLES.ejecucion_evento = [{ tipo: "llegada", viaje_id: "v1", hito_id: "h1", ocurrido_en: "2026-01-01T10:30:00Z" }];
    const r = await getPlanVsReal("v1");
    expect(r.filas[0].estado).toBe("tarde_leve");
    expect(r.filas[0].deltaMin).toBe(30);
  });

  it("tarde: más de 60 minutos de retraso", async () => {
    TABLES.hito = [{ id: "h1", viaje_id: "v1", orden: 1, ventana_fin: "2026-01-01T10:00:00Z" }];
    TABLES.ejecucion_evento = [{ tipo: "llegada", viaje_id: "v1", hito_id: "h1", ocurrido_en: "2026-01-01T12:00:00Z" }];
    const r = await getPlanVsReal("v1");
    expect(r.filas[0].estado).toBe("tarde");
    expect(r.filas[0].deltaMin).toBe(120);
  });

  it("sin ventana o sin llegada: estado sin_datos, no cuenta en el resumen", async () => {
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", orden: 1, ventana_fin: null },
      { id: "h2", viaje_id: "v1", orden: 2, ventana_fin: "2026-01-01T10:00:00Z" }, // sin llegada
    ];
    TABLES.ejecucion_evento = [];
    const r = await getPlanVsReal("v1");
    expect(r.filas.every((f) => f.estado === "sin_datos")).toBe(true);
    expect(r.resumen.conVentana).toBe(0);
  });

  it("resumen cuenta solo los hitos con datos completos", async () => {
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", orden: 1, ventana_fin: "2026-01-01T10:00:00Z" },
      { id: "h2", viaje_id: "v1", orden: 2, ventana_fin: "2026-01-01T12:00:00Z" },
    ];
    TABLES.ejecucion_evento = [
      { tipo: "llegada", viaje_id: "v1", hito_id: "h1", ocurrido_en: "2026-01-01T09:00:00Z" }, // a tiempo
      { tipo: "llegada", viaje_id: "v1", hito_id: "h2", ocurrido_en: "2026-01-01T13:00:00Z" }, // tarde
    ];
    const r = await getPlanVsReal("v1");
    expect(r.resumen.conVentana).toBe(2);
    expect(r.resumen.aTiempo).toBe(1);
  });
});

describe("onboarding (7A.13)", () => {
  it("empresa vacía: ningún paso completado", async () => {
    TABLES.vehiculo = [];
    TABLES.chofer = [];
    TABLES.viaje = [];
    TABLES.empresa = [{}];
    const r = await getOnboardingEstado();
    expect(r.completado).toBe(false);
    expect(r.pasos.every((p) => !p.done)).toBe(true);
  });

  it("empresa parcial: algunos pasos completados, otros no", async () => {
    TABLES.vehiculo = [{ id: "v1" }];
    TABLES.chofer = [{ id: "c1", chat_id: null }];
    TABLES.viaje = [];
    TABLES.empresa = [{}];
    const r = await getOnboardingEstado();
    expect(r.completado).toBe(false);
    expect(r.pasos.find((p) => p.id === "vehiculo").done).toBe(true);
    expect(r.pasos.find((p) => p.id === "chofer").done).toBe(true);
    expect(r.pasos.find((p) => p.id === "telegram").done).toBe(false);
    expect(r.pasos.find((p) => p.id === "viaje").done).toBe(false);
  });

  it("empresa completa: todos los pasos hechos", async () => {
    TABLES.vehiculo = [{ id: "v1" }];
    TABLES.chofer = [{ id: "c1", chat_id: "chat-1" }];
    TABLES.viaje = [{ id: "vi1" }];
    TABLES.empresa = [{ coste_km: 1.2 }];
    const r = await getOnboardingEstado();
    expect(r.completado).toBe(true);
    expect(r.pasos.every((p) => p.done)).toBe(true);
  });
});

describe("calcularPanelViaje (7A.11 — panel en vivo del wizard)", () => {
  const MADRID = { lat: 40.4168, lon: -3.7038 };
  const BARCELONA = { lat: 41.3851, lon: 2.1734 };

  it("con precio y coste configurados, calcula margen y margenPct", async () => {
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75, coste_km: 1 }];
    osrmMock.mockResolvedValue(100);
    const r = await calcularPanelViaje({ puntos: [MADRID, BARCELONA], precio: 1000 });
    expect(r.margen).toBe(1000 - r.coste.total);
    expect(r.margenPct).toBe(Math.round((r.margen / 1000) * 100));
  });

  it("sin precio, margen y margenPct son null pero el resto del cálculo sigue", async () => {
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75, coste_km: 1 }];
    osrmMock.mockResolvedValue(100);
    const r = await calcularPanelViaje({ puntos: [MADRID, BARCELONA] });
    expect(r.margen).toBeNull();
    expect(r.margenPct).toBeNull();
    expect(r.km).toBeGreaterThan(0);
  });

  it("sin coste configurado, margen es null aunque haya precio", async () => {
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75 }];
    osrmMock.mockResolvedValue(100);
    const r = await calcularPanelViaje({ puntos: [MADRID, BARCELONA], precio: 1000 });
    expect(r.margen).toBeNull();
  });
});

describe("createViaje acepta precio (7A.11)", () => {
  it("guarda el precio en el insert del viaje", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.viaje = [];
    TABLES.chofer = [];
    TABLES.vehiculo = [];
    const { viaje } = await createViaje({ referencia: "REF1", choferId: null, vehiculoId: null, remolqueId: null, hitos: [], precio: 1234 });
    expect(viaje.precio).toBe(1234);
  });

  it("sin precio, se guarda null (no rompe el alta existente)", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.viaje = [];
    TABLES.chofer = [];
    TABLES.vehiculo = [];
    const { viaje } = await createViaje({ referencia: "REF2", choferId: null, vehiculoId: null, remolqueId: null, hitos: [] });
    expect(viaje.precio).toBeNull();
  });
});

describe("portal de cliente (7A.14)", () => {
  it("generarTokenPublico crea un uuid, fija caducidad a 30 días y actualiza el viaje", async () => {
    TABLES.viaje = [{ id: "v1", token_publico: null, token_publico_expira: null }];
    const { token, expira } = await generarTokenPublico("v1");
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(TABLES.viaje[0].token_publico).toBe(token);
    expect(TABLES.viaje[0].token_publico_expira).toBe(expira);
    const diasHastaExpira = (new Date(expira) - Date.now()) / 86400000;
    expect(diasHastaExpira).toBeCloseTo(30, 0);
  });

  it("generarTokenPublico acepta una validez distinta a la por defecto", async () => {
    TABLES.viaje = [{ id: "v1", token_publico: null, token_publico_expira: null }];
    const { expira } = await generarTokenPublico("v1", { diasValidez: 7 });
    const dias = (new Date(expira) - Date.now()) / 86400000;
    expect(dias).toBeCloseTo(7, 0);
  });

  it("revocarTokenPublico limpia el token y la caducidad", async () => {
    TABLES.viaje = [{ id: "v1", token_publico: "abc-123", token_publico_expira: "2030-01-01T00:00:00Z" }];
    await revocarTokenPublico("v1");
    expect(TABLES.viaje[0].token_publico).toBeNull();
    expect(TABLES.viaje[0].token_publico_expira).toBeNull();
  });

  it("getViajePublico devuelve lo que la RPC responde (feliz)", async () => {
    rpcResultado = { data: { referencia: "REF1", estado: "en_curso", hitos: [] }, error: null };
    const r = await getViajePublico("token-valido");
    expect(rpcSpy).toHaveBeenCalledWith("viaje_publico", { p_token: "token-valido" });
    expect(r.referencia).toBe("REF1");
  });

  it("getViajePublico devuelve null si el token no existe", async () => {
    rpcResultado = { data: null, error: null };
    const r = await getViajePublico("token-invalido");
    expect(r).toBeNull();
  });
});

describe("health check del bot (8.3)", () => {
  it("activo=true si el último latido es reciente", async () => {
    TABLES.bot_heartbeat = [{ created_at: new Date(Date.now() - 10000).toISOString() }]; // hace 10s
    const r = await getBotHeartbeat();
    expect(r.activo).toBe(true);
    expect(r.segundosDesdeUltimo).toBeLessThan(UMBRAL_HEARTBEAT_S);
  });

  it("activo=false si el último latido es más viejo que el umbral", async () => {
    TABLES.bot_heartbeat = [{ created_at: new Date(Date.now() - (UMBRAL_HEARTBEAT_S + 60) * 1000).toISOString() }];
    const r = await getBotHeartbeat();
    expect(r.activo).toBe(false);
  });

  it("sin ningún latido registrado, activo=false y ultimoLatido=null", async () => {
    TABLES.bot_heartbeat = [];
    const r = await getBotHeartbeat();
    expect(r.activo).toBe(false);
    expect(r.ultimoLatido).toBeNull();
    expect(r.segundosDesdeUltimo).toBeNull();
  });

  it("toma el latido más reciente si hay varios", async () => {
    TABLES.bot_heartbeat = [
      { created_at: new Date(Date.now() - 500000).toISOString() },
      { created_at: new Date(Date.now() - 5000).toISOString() }, // el más reciente
    ];
    const r = await getBotHeartbeat();
    expect(r.segundosDesdeUltimo).toBeLessThan(20);
  });
});

describe("audit log (8.8)", () => {
  it("registrarAuditoria inserta con empresa y gestor resueltos de la sesión", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1", id: "g1" }];
    TABLES.audit_log = [];
    await registrarAuditoria({ entidad: "viaje", entidadId: "v1", accion: "cambio_estado", detalle: { de: "planificado", a: "en_curso" } });
    expect(TABLES.audit_log).toHaveLength(1);
    expect(TABLES.audit_log[0].empresa_id).toBe("e1");
    expect(TABLES.audit_log[0].gestor_id).toBe("g1");
    expect(TABLES.audit_log[0].accion).toBe("cambio_estado");
  });

  it("registrarAuditoria no lanza si falla (sin sesión)", async () => {
    SESSION = null;
    await expect(
      registrarAuditoria({ entidad: "viaje", entidadId: "v1", accion: "cambio_estado" })
    ).resolves.not.toThrow();
  });

  it("getAuditLog filtra por entidad+entidad_id y ordena por más reciente", async () => {
    TABLES.audit_log = [
      { id: "a1", entidad: "viaje", entidad_id: "v1", accion: "cambio_estado", created_at: "2026-01-01T00:00:00Z" },
      { id: "a2", entidad: "viaje", entidad_id: "v1", accion: "asignar_chofer", created_at: "2026-02-01T00:00:00Z" },
      { id: "a3", entidad: "viaje", entidad_id: "v2", accion: "cambio_estado", created_at: "2026-03-01T00:00:00Z" }, // otro viaje
    ];
    const r = await getAuditLog("viaje", "v1");
    expect(r).toHaveLength(2);
    expect(r[0].accion).toBe("asignar_chofer"); // el más reciente primero
  });
});
