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
    lte(field, value) { rows = rows.filter((r) => r[field] != null && r[field] <= value); return builder; },
    not(field, op, value) {
      // Solo soporta el patrón usado hoy: .not(field, "is", null).
      if (op === "is" && value === null) rows = rows.filter((r) => r[field] != null);
      return builder;
    },
    or(condStr) {
      // Solo soporta el patrón usado hoy: "campo.eq.valor,campo2.eq.valor2".
      const conds = condStr.split(",").map((c) => {
        const [field, op, ...resto] = c.split(".");
        return { field, op, value: resto.join(".") };
      });
      rows = rows.filter((r) => conds.some(({ field, op, value }) => op === "eq" && String(r[field]) === value));
      return builder;
    },
    order(field, opts) {
      const asc = !opts || opts.ascending !== false;
      rows = [...rows].sort((a, b) => {
        if (a[field] < b[field]) return asc ? -1 : 1;
        if (a[field] > b[field]) return asc ? 1 : -1;
        return 0;
      });
      return builder;
    },
    limit(n) { rows = rows.slice(0, n); return builder; },
    single() {
      if (SELECT_ERRORS[table]) {
        return Promise.resolve({ data: null, error: SELECT_ERRORS[table] });
      }
      return Promise.resolve(
        rows.length
          ? { data: rows[0], error: null }
          // code PGRST116 = "no rows" real de PostgREST -- lo distinguen las
          // funciones de 9.35 de un fallo real de lectura.
          : { data: null, error: { message: "no rows", code: "PGRST116" } }
      );
    },
    insert(objOrArr) {
      // Soporta tanto insert(objeto) como insert([...filas]) (p.ej. los
      // hitos de createViaje, que insertan varias filas de golpe).
      const arr = Array.isArray(objOrArr) ? objOrArr : [objOrArr];
      const inserted = arr.map((obj) => ({ id: "new-id-" + Math.random().toString(36).slice(2), ...obj }));
      (TABLES[table] = TABLES[table] || []).push(...inserted);
      return {
        select() { return this; },
        single() { return Promise.resolve({ data: inserted[0], error: null }); },
        then(resolve) { resolve({ data: inserted, error: null }); },
      };
    },
    delete() {
      // Acumula todos los .eq() encadenados (p.ej. .delete().eq("ambito","chofer").eq("entidad_id",id))
      // y solo aplica el borrado al resolverse (thenable) -- fiel al builder real de Supabase,
      // que no ejecuta nada hasta el await final.
      const filtros = [];
      const delChain = {
        eq(field, value) {
          filtros.push([field, value]);
          return delChain;
        },
        then(resolve) {
          const coincide = (r) => filtros.every(([f, v]) => r[f] === v);
          TABLES[table] = (TABLES[table] || []).filter((r) => !coincide(r));
          resolve({ data: null, error: null });
        },
      };
      return delChain;
    },
    update(payload) {
      return {
        eq(field, value) {
          if (UPDATE_ERRORS[table]) {
            return Promise.resolve({ data: null, error: UPDATE_ERRORS[table] });
          }
          const objetivo = (TABLES[table] || []).filter((r) => r[field] === value);
          objetivo.forEach((r) => Object.assign(r, payload));
          return Promise.resolve({ data: objetivo, error: null });
        },
      };
    },
    then(resolve) {
      // Simula un fallo real de lectura (ítem 9.35): SELECT_ERRORS.viaje =
      // {message:"..."} -> la próxima query SELECT sobre "viaje" resuelve
      // con ese error en vez de filas, para probar que las funciones
      // financieras LANZAN de verdad en vez de tragarlo como "sin datos".
      if (SELECT_ERRORS[table]) {
        resolve({ data: null, error: SELECT_ERRORS[table] });
        return;
      }
      resolve({ data: rows, error: null });
    },
  };
  return builder;
}

let rpcResultado = { data: null, error: null };
const rpcSpy = vi.fn();
// Simula un UPDATE que Supabase rechaza (RLS, etc.) para una tabla concreta;
// se resetea en beforeEach. UPDATE_ERRORS.gestor = {message: "..."} -> el
// próximo .update().eq() sobre "gestor" devuelve ese error en vez de mutar.
let UPDATE_ERRORS = {};
let SELECT_ERRORS = {};

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
  getConflictosMantenimientoViaje,
  detectarHuecoUbicacion,
  getViajesConHuecoUbicacion,
  getMetricasPuntualidad,
  getMetricasIncidencias,
  getMetricasChoferes,
  getMetricasFlota,
  getInformeNomina,
  resolveCosteKm,
  calcularMargen,
  calcularCosteRuta,
  calcularPresupuesto,
  aplicarOverridesPresupuesto,
  MARGEN_OBJETIVO_PCT_DEFAULT,
  kmCarreteraViaje,
  _limpiarCacheKmCarreteraParaTests,
  getViabilidadViaje,
  resolveVelocidadPlanificacion,
  calcularEtaConParadas,
  getEtaViaje,
  VELOCIDAD_PLANIFICACION_KMH,
  getParkings,
  createParkingPropio,
  getExportacionChofer,
  anonimizarChofer,
  getInvitaciones,
  createInvitacion,
  deleteInvitacion,
  INVITACION_VALIDEZ_DIAS,
  getGestoresEmpresa,
  actualizarRolGestor,
  desactivarGestor,
  reactivarGestor,
  guardarNombreEmpresa,
  guardarBaseEmpresa,
  guardarCosteKmEmpresa,
  guardarVelocidadEmpresa,
  guardarDesgloseCosteEmpresa,
  guardarCapacidadVehiculo,
  createVehiculo,
  createChofer,
  getDossierViaje,
  getDatosFacturacion,
  guardarTelefonoChofer,
  getChoferesConGestor,
  guardarGestorChofer,
  normalizarTelefonoE164,
  guardarObjetivoPuntualidadEmpresa,
  guardarRequierePodEmpresa,
  guardarMargenObjetivoEmpresa,
  getRendimientoGestores,
  getMetricasPorCliente,
  kmAproxViaje,
  calcularAvisosViabilidad,
  sugerirOrdenParadas,
  getEstado561,
  getEstado561ParaChoferes,
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
  getAlertaMargen,
  getComparativaMensual,
  getInformeEjecutivo,
  alertaObjetivoPuntualidad,
  alertaObjetivoMargen,
  crearSnapshotVerdadObservada,
  getTendenciaVerdadObservada,
  getSugerenciaCalibracion,
  getPlanVsReal,
  calcularDesfasePod,
  calcularUrgenciaIncidencia,
  UMBRAL_POD_TARDIO_MIN,
  calcularOcupacion,
  UMBRAL_FTL_PCT,
  getOnboardingEstado,
  calcularPanelViaje,
  createViaje,
  getReferenciaSugerida,
  generarTokenPublico,
  revocarTokenPublico,
  getViajePublico,
  getBotHeartbeat,
  UMBRAL_HEARTBEAT_S,
  registrarAuditoria,
  getAuditLog,
  getClientes,
  getDireccionesGuardadas,
  createCliente,
  actualizarCliente,
  desactivarCliente,
  asignarClienteAViaje,
  getContexto,
  createContexto,
  LIMITE_CONTEXTO,
} = await import("./data.js");

beforeEach(() => {
  TABLES = {};
  SESSION = null;
  osrmMock.mockReset();
  osrmMock.mockResolvedValue(100);
  rpcSpy.mockClear();
  rpcResultado = { data: null, error: null };
  UPDATE_ERRORS = {};
  SELECT_ERRORS = {};
  _limpiarCacheKmCarreteraParaTests();
});

describe("getReferenciaSugerida", () => {
  it("sugiere VJ-0001 cuando no hay viajes todavía", async () => {
    TABLES.viaje = [];
    expect(await getReferenciaSugerida()).toBe("VJ-0001");
  });

  it("sugiere el siguiente correlativo, con ceros a la izquierda", async () => {
    TABLES.viaje = Array.from({ length: 41 }, (_, i) => ({ id: `v${i}` }));
    expect(await getReferenciaSugerida()).toBe("VJ-0042");
  });
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
    expect(r.avisos[0]).toMatch(/chófer ya está planificado/);
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

  it("BLOQUEA (error, no aviso) si el vehículo ya está en un viaje en_curso ahora mismo", async () => {
    // Hallazgo real (2026-07-22): un camión no puede estar en dos viajes a la
    // vez si el otro ya está en_curso -- eso sí es un error, no un aviso.
    TABLES.viaje = [{ id: "v-existente", referencia: "VJ-2", vehiculo_id: "veh1", estado: "en_curso" }];
    const r = await validarAsignacion({ vehiculoId: "veh1" });
    expect(r.ok).toBe(false);
    expect(r.errores[0]).toMatch(/EN CURSO/);
    expect(r.avisos).toEqual([]);
  });

  it("solo avisa (no bloquea) si el vehículo está en otro viaje aún planificado (no arrancado)", async () => {
    TABLES.viaje = [{ id: "v-existente", referencia: "VJ-2b", vehiculo_id: "veh1", estado: "planificado" }];
    const r = await validarAsignacion({ vehiculoId: "veh1" });
    expect(r.ok).toBe(true);
    expect(r.avisos[0]).toMatch(/planificado/);
  });

  it("avisa si el remolque ya está en un viaje activo", async () => {
    TABLES.viaje = [{ id: "v-existente", referencia: "VJ-3", remolque_id: "rem1", estado: "planificado" }];
    const r = await validarAsignacion({ remolqueId: "rem1" });
    expect(r.avisos[0]).toMatch(/remolque ya está planificado/);
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

describe("getConflictosMantenimientoViaje (F14.1 — ITV pendiente vs. viaje asignado)", () => {
  it("detecta conflicto: ITV antes de que termine el viaje", async () => {
    TABLES.mantenimiento_vehiculo = [
      { id: "m1", vehiculo_id: "veh1", tipo: "itv", estado: "pendiente", fecha: "2026-08-20" },
    ];
    TABLES.vehiculo = [{ id: "veh1", matricula: "1234ABC" }];
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1", vehiculo_id: "veh1", estado: "planificado" }];
    TABLES.hito = [
      { viaje_id: "v1", orden: 1, ventana_fin: "2026-08-21T10:00:00Z" },
      { viaje_id: "v1", orden: 2, ventana_fin: "2026-08-22T10:00:00Z" },
    ];
    const r = await getConflictosMantenimientoViaje();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ matricula: "1234ABC", referencia: "VJ-1", fechaVencimiento: "2026-08-20" });
  });

  it("no detecta conflicto si el viaje termina antes del vencimiento", async () => {
    TABLES.mantenimiento_vehiculo = [
      { id: "m1", vehiculo_id: "veh1", tipo: "itv", estado: "pendiente", fecha: "2026-08-20" },
    ];
    TABLES.vehiculo = [{ id: "veh1", matricula: "1234ABC" }];
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1", vehiculo_id: "veh1", estado: "planificado" }];
    TABLES.hito = [{ viaje_id: "v1", orden: 1, ventana_fin: "2026-08-10T10:00:00Z" }];
    const r = await getConflictosMantenimientoViaje();
    expect(r).toEqual([]);
  });

  it("omite el viaje si no tiene ventana_fin (sin dato, no falso positivo)", async () => {
    TABLES.mantenimiento_vehiculo = [
      { id: "m1", vehiculo_id: "veh1", tipo: "itv", estado: "pendiente", fecha: "2026-08-20" },
    ];
    TABLES.vehiculo = [{ id: "veh1", matricula: "1234ABC" }];
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1", vehiculo_id: "veh1", estado: "planificado" }];
    TABLES.hito = [{ viaje_id: "v1", orden: 1, ventana_fin: null }];
    const r = await getConflictosMantenimientoViaje();
    expect(r).toEqual([]);
  });

  it("ignora ITV completadas y viajes ya finalizados/cancelados", async () => {
    TABLES.mantenimiento_vehiculo = [
      { id: "m1", vehiculo_id: "veh1", tipo: "itv", estado: "completado", fecha: "2026-08-20" },
    ];
    TABLES.vehiculo = [{ id: "veh1", matricula: "1234ABC" }];
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1", vehiculo_id: "veh1", estado: "completado" }];
    TABLES.hito = [{ viaje_id: "v1", orden: 1, ventana_fin: "2026-08-25T10:00:00Z" }];
    const r = await getConflictosMantenimientoViaje();
    expect(r).toEqual([]);
  });

  it("sin ITV pendientes, no consulta nada más y devuelve vacío", async () => {
    TABLES.mantenimiento_vehiculo = [];
    const r = await getConflictosMantenimientoViaje();
    expect(r).toEqual([]);
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

  it("expone el objetivo_puntualidad_pct de la empresa (12.5), null si no está configurado", async () => {
    const sinConfigurar = await getMetricasPuntualidad();
    expect(sinConfigurar.objetivoPuntualidadPct).toBeNull();

    TABLES.empresa = [{ objetivo_puntualidad_pct: 95 }];
    const r = await getMetricasPuntualidad();
    expect(r.objetivoPuntualidadPct).toBe(95);
  });
});

describe("alertaObjetivoPuntualidad (auditoría 2026-07-15 — objetivo dejaba de ser solo un color pasivo)", () => {
  it("null si no hay objetivo configurado", () => {
    expect(alertaObjetivoPuntualidad({ pctPuntualidad: 50, objetivoPuntualidadPct: null })).toBeNull();
  });

  it("null si no hay datos de puntualidad todavía", () => {
    expect(alertaObjetivoPuntualidad({ pctPuntualidad: null, objetivoPuntualidadPct: 95 })).toBeNull();
  });

  it("null si el objetivo se está cumpliendo (actual >= objetivo)", () => {
    expect(alertaObjetivoPuntualidad({ pctPuntualidad: 95, objetivoPuntualidadPct: 95 })).toBeNull();
    expect(alertaObjetivoPuntualidad({ pctPuntualidad: 98, objetivoPuntualidadPct: 95 })).toBeNull();
  });

  it("alerta si el objetivo se está incumpliendo", () => {
    const r = alertaObjetivoPuntualidad({ pctPuntualidad: 80, objetivoPuntualidadPct: 95 });
    expect(r).toEqual({ objetivo: 95, actual: 80 });
  });
});

describe("alertaObjetivoMargen (auditoría 2026-07-15 — margen_objetivo_pct no se leía en ningún sitio)", () => {
  it("null si no hay objetivo configurado", () => {
    expect(alertaObjetivoMargen({ margenRealMedioPct: 5, margenObjetivoPct: null })).toBeNull();
  });

  it("null si no hay datos de margen todavía", () => {
    expect(alertaObjetivoMargen({ margenRealMedioPct: null, margenObjetivoPct: 15 })).toBeNull();
  });

  it("null si el objetivo se está cumpliendo", () => {
    expect(alertaObjetivoMargen({ margenRealMedioPct: 20, margenObjetivoPct: 15 })).toBeNull();
  });

  it("alerta si el margen real está por debajo del objetivo", () => {
    const r = alertaObjetivoMargen({ margenRealMedioPct: 5, margenObjetivoPct: 15 });
    expect(r).toEqual({ objetivo: 15, actual: 5 });
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

describe("getRendimientoGestores (12.5 — comparación de gestores para el jefe de tráfico/oficina)", () => {
  it("devuelve una fila por gestor activo, con viajes 0 si no gestiona ninguno", async () => {
    TABLES.gestor = [{ id: "g1", nombre: "Laura", activo: true }, { id: "g2", nombre: "Pedro", activo: true }];
    const r = await getRendimientoGestores(RANGO_AMPLIO);
    expect(r).toHaveLength(2);
    const pedro = r.find((g) => g.nombre === "Pedro");
    expect(pedro.viajesGestionados).toBe(0);
    expect(pedro.pctSiguioSugerencia).toBeNull();
    expect(pedro.incidencias).toBe(0);
  });

  it("excluye gestores desactivados", async () => {
    TABLES.gestor = [{ id: "g1", nombre: "Laura", activo: true }, { id: "g2", nombre: "Ex", activo: false }];
    const r = await getRendimientoGestores(RANGO_AMPLIO);
    expect(r.map((g) => g.nombre)).toEqual(["Laura"]);
  });

  it("cuenta viajes gestionados, % de sugerencias seguidas e incidencias, solo de SUS viajes", async () => {
    TABLES.gestor = [{ id: "g1", nombre: "Laura", activo: true }, { id: "g2", nombre: "Pedro", activo: true }];
    TABLES.viaje = [
      { id: "v1", gestor_id: "g1", created_at: "2026-01-01T10:00:00Z" },
      { id: "v2", gestor_id: "g1", created_at: "2026-01-01T10:00:00Z" },
      { id: "v3", gestor_id: "g2", created_at: "2026-01-01T10:00:00Z" },
    ];
    TABLES.decision_asignacion = [
      { viaje_id: "v1", siguio_sugerencia: true, created_at: "2026-01-01T10:00:00Z" },
      { viaje_id: "v2", siguio_sugerencia: false, created_at: "2026-01-01T10:00:00Z" },
      { viaje_id: "v3", siguio_sugerencia: true, created_at: "2026-01-01T10:00:00Z" },
    ];
    TABLES.incidencia = [
      { viaje_id: "v1", created_at: "2026-01-01T10:00:00Z" },
      { viaje_id: "v1", created_at: "2026-01-01T10:00:00Z" },
      { viaje_id: "v3", created_at: "2026-01-01T10:00:00Z" },
    ];

    const r = await getRendimientoGestores(RANGO_AMPLIO);
    const laura = r.find((g) => g.nombre === "Laura");
    expect(laura.viajesGestionados).toBe(2);
    expect(laura.pctSiguioSugerencia).toBe(50); // 1 de 2
    expect(laura.incidencias).toBe(2);

    const pedro = r.find((g) => g.nombre === "Pedro");
    expect(pedro.viajesGestionados).toBe(1);
    expect(pedro.pctSiguioSugerencia).toBe(100);
    expect(pedro.incidencias).toBe(1);
  });

  it("ordena de más a menos viajes gestionados", async () => {
    TABLES.gestor = [{ id: "g1", nombre: "Poco", activo: true }, { id: "g2", nombre: "Mucho", activo: true }];
    TABLES.viaje = [
      { id: "v1", gestor_id: "g1", created_at: "2026-01-01T10:00:00Z" },
      { id: "v2", gestor_id: "g2", created_at: "2026-01-01T10:00:00Z" },
      { id: "v3", gestor_id: "g2", created_at: "2026-01-01T10:00:00Z" },
    ];
    const r = await getRendimientoGestores(RANGO_AMPLIO);
    expect(r.map((g) => g.nombre)).toEqual(["Mucho", "Poco"]);
  });
});

describe("getMetricasPorCliente (F13.3 — SLA/rendimiento por cliente)", () => {
  it("agrupa viajes, incidencias y puntualidad por cliente, y agrupa aparte los sin cliente", async () => {
    TABLES.cliente = [{ id: "cl1", nombre: "Acme", activo: true }, { id: "cl2", nombre: "Beta", activo: true }];
    TABLES.viaje = [
      { id: "v1", cliente_id: "cl1", precio: null, created_at: "2026-01-01T10:00:00Z" },
      { id: "v2", cliente_id: "cl1", precio: null, created_at: "2026-01-01T10:00:00Z" },
      { id: "v3", cliente_id: "cl2", precio: null, created_at: "2026-01-01T10:00:00Z" },
      { id: "v4", cliente_id: null, precio: null, created_at: "2026-01-01T10:00:00Z" },
    ];
    TABLES.incidencia = [
      { viaje_id: "v1", tipo: "fuera_de_ventana", created_at: "2026-01-01T10:00:00Z" },
      { viaje_id: "v3", tipo: "otro", created_at: "2026-01-01T10:00:00Z" },
    ];
    TABLES.hito = [
      { viaje_id: "v1", ventana_fin: "2026-01-01T10:00:00Z" },
      { viaje_id: "v2", ventana_fin: "2026-01-01T10:00:00Z" },
      { viaje_id: "v3", ventana_fin: "2026-01-01T10:00:00Z" },
    ];

    const r = await getMetricasPorCliente(RANGO_AMPLIO);

    const acme = r.find((c) => c.nombre === "Acme");
    expect(acme.viajes).toBe(2);
    expect(acme.incidencias).toBe(1);
    expect(acme.pctPuntualidad).toBe(50); // 1 de 2 con ventana llegó tarde

    const beta = r.find((c) => c.nombre === "Beta");
    expect(beta.viajes).toBe(1);
    expect(beta.pctPuntualidad).toBe(100);

    const sinCliente = r.find((c) => c.nombre === "Sin cliente");
    expect(sinCliente.viajes).toBe(1);
  });

  it("clientes activos sin viajes en el rango no aparecen (no aportan nada a la tabla)", async () => {
    TABLES.cliente = [{ id: "cl1", nombre: "Sinviajes", activo: true }];
    TABLES.viaje = [];
    const r = await getMetricasPorCliente(RANGO_AMPLIO);
    expect(r).toHaveLength(0);
  });

  it("calcula el margen medio real (precio - gastos) por cliente", async () => {
    TABLES.cliente = [{ id: "cl1", nombre: "Acme", activo: true }];
    TABLES.viaje = [
      { id: "v1", cliente_id: "cl1", precio: 1000, vehiculo_id: null, created_at: "2026-01-01T10:00:00Z" },
      { id: "v2", cliente_id: "cl1", precio: 500, vehiculo_id: null, created_at: "2026-01-01T10:00:00Z" },
    ];
    TABLES.gasto_viaje = [
      { id: "g1", viaje_id: "v1", tipo: "repostaje", importe: 200 },
      { id: "g2", viaje_id: "v2", tipo: "peaje", importe: 100 },
    ];
    const r = await getMetricasPorCliente(RANGO_AMPLIO);
    const acme = r.find((c) => c.nombre === "Acme");
    // margenes: 800 y 400 -> media 600
    expect(acme.margenMedio).toBe(600);
  });

  it("ordena de más a menos viajes", async () => {
    TABLES.cliente = [{ id: "cl1", nombre: "Poco", activo: true }, { id: "cl2", nombre: "Mucho", activo: true }];
    TABLES.viaje = [
      { id: "v1", cliente_id: "cl1", precio: null, created_at: "2026-01-01T10:00:00Z" },
      { id: "v2", cliente_id: "cl2", precio: null, created_at: "2026-01-01T10:00:00Z" },
      { id: "v3", cliente_id: "cl2", precio: null, created_at: "2026-01-01T10:00:00Z" },
    ];
    const r = await getMetricasPorCliente(RANGO_AMPLIO);
    expect(r.map((c) => c.nombre)).toEqual(["Mucho", "Poco"]);
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

  // --- COT.1: overrides what-if ---
  it("override de precioGasoilLitro sube combustible y total", async () => {
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75, coste_km: 1.2, margen_objetivo_pct: 20, precio_gasoil_litro: 1.4 }];
    TABLES.vehiculo = [{ id: "veh1", consumo_l_100km: 30 }];
    osrmMock.mockResolvedValue(300);
    const base = await calcularPresupuesto({ puntos: [MADRID, BARCELONA], vehiculoId: "veh1" });
    osrmMock.mockResolvedValue(300);
    const conGasoilCaro = await calcularPresupuesto({ puntos: [MADRID, BARCELONA], vehiculoId: "veh1", overrides: { precioGasoilLitro: 1.8 } });
    expect(conGasoilCaro.coste.combustible).toBeGreaterThan(base.coste.combustible);
    expect(conGasoilCaro.coste.total).toBeGreaterThan(base.coste.total);
  });

  it("override de velocidadKmh cambia las horas de conducción", async () => {
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75, coste_km: 1.2 }];
    osrmMock.mockResolvedValue(300);
    const base = await calcularPresupuesto({ puntos: [MADRID, BARCELONA] });
    osrmMock.mockResolvedValue(300);
    const masRapido = await calcularPresupuesto({ puntos: [MADRID, BARCELONA], overrides: { velocidadKmh: 90 } });
    expect(masRapido.horasConduccion).toBeLessThan(base.horasConduccion);
  });

  it("override de margenObjetivoPct cambia el precio sugerido", async () => {
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75, coste_km: 1.2, margen_objetivo_pct: 20 }];
    osrmMock.mockResolvedValue(300);
    const r = await calcularPresupuesto({ puntos: [MADRID, BARCELONA], overrides: { margenObjetivoPct: 30 } });
    expect(r.margenObjetivo).toBe(30);
    expect(r.precioSugerido).toBeCloseTo(r.coste.total / (1 - 30 / 100), 2);
  });

  it("sin overrides el resultado es idéntico a no pasar el argumento", async () => {
    TABLES.empresa = [{ velocidad_planificacion_kmh: 75, coste_km: 1.2, margen_objetivo_pct: 20 }];
    osrmMock.mockResolvedValue(300);
    const sinArg = await calcularPresupuesto({ puntos: [MADRID, BARCELONA] });
    osrmMock.mockResolvedValue(300);
    const conNull = await calcularPresupuesto({ puntos: [MADRID, BARCELONA], overrides: null });
    expect(conNull).toEqual(sinArg);
  });

  it("aplicarOverridesPresupuesto no muta los objetos originales", () => {
    const empresa = { coste_km: 1.2 };
    const vehiculo = { consumo_l_100km: 30 };
    const r = aplicarOverridesPresupuesto(empresa, vehiculo, { costeKm: 2, consumoL100km: 40 });
    expect(empresa.coste_km).toBe(1.2);
    expect(vehiculo.consumo_l_100km).toBe(30);
    expect(r.empresa.coste_km).toBe(2);
    expect(r.vehiculo.consumo_l_100km).toBe(40);
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

  it("(9.10) marca vencida=true una invitación pendiente más vieja que INVITACION_VALIDEZ_DIAS", async () => {
    const haceMucho = new Date(Date.now() - (INVITACION_VALIDEZ_DIAS + 1) * 86400000).toISOString();
    TABLES.invitacion = [
      { id: "i1", email: "a@x.com", codigo: "c1", usada_at: null, created_at: haceMucho },
    ];
    const r = await getInvitaciones();
    expect(r[0].vencida).toBe(true);
  });

  it("(9.10) vencida=false para una invitación pendiente reciente", async () => {
    TABLES.invitacion = [
      { id: "i1", email: "a@x.com", codigo: "c1", usada_at: null, created_at: new Date().toISOString() },
    ];
    const r = await getInvitaciones();
    expect(r[0].vencida).toBe(false);
  });

  it("(9.10) una invitación USADA nunca se marca vencida, aunque sea vieja", async () => {
    const haceMucho = new Date(Date.now() - (INVITACION_VALIDEZ_DIAS + 30) * 86400000).toISOString();
    TABLES.invitacion = [
      { id: "i1", email: "a@x.com", codigo: "c1", usada_at: haceMucho, created_at: haceMucho },
    ];
    const r = await getInvitaciones();
    expect(r[0].vencida).toBe(false);
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

describe("clientes (11.1 — cliente como entidad de primera clase)", () => {
  beforeEach(() => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "emp1" }];
  });

  it("getClientes devuelve solo activos por defecto, ordenados por nombre", async () => {
    TABLES.cliente = [
      { id: "c1", nombre: "Zeta SL", activo: true },
      { id: "c2", nombre: "Alfa SL", activo: true },
      { id: "c3", nombre: "Inactivo SL", activo: false },
    ];
    const r = await getClientes();
    expect(r.map((c) => c.nombre)).toEqual(["Alfa SL", "Zeta SL"]);
  });

  it("getClientes incluye inactivos si se pide", async () => {
    TABLES.cliente = [
      { id: "c1", nombre: "Alfa SL", activo: true },
      { id: "c3", nombre: "Baja SL", activo: false },
    ];
    const r = await getClientes({ incluirInactivos: true });
    expect(r).toHaveLength(2);
  });

  it("getDireccionesGuardadas dedup por dirección, la más reciente gana, ignora hitos sin coords", async () => {
    TABLES.hito = [
      { direccion: "Adidas Madrid, Polígono Norte", lat: 40.4, lon: -3.7, created_at: "2026-06-01T00:00:00Z" },
      // Misma dirección repetida en un viaje más reciente -- debe ganar esta, no la de arriba.
      { direccion: "Adidas Madrid, Polígono Norte", lat: 40.41, lon: -3.71, created_at: "2026-07-01T00:00:00Z" },
      { direccion: "Nike Barcelona", lat: 41.4, lon: 2.2, created_at: "2026-06-15T00:00:00Z" },
      { direccion: null, lat: 1, lon: 1, created_at: "2026-06-15T00:00:00Z" },
      { direccion: "Sin coordenadas", lat: null, lon: null, created_at: "2026-06-15T00:00:00Z" },
    ];
    const r = await getDireccionesGuardadas();
    expect(r).toHaveLength(2);
    const adidas = r.find((d) => d.direccion === "Adidas Madrid, Polígono Norte");
    expect(adidas.lat).toBe(40.41); // la version mas reciente (por created_at desc), no la primera
  });

  it("createCliente inserta con la empresa del gestor y recorta espacios", async () => {
    const r = await createCliente({ nombre: "  Mercadona  ", cif: " B123 ", email: "", telefono: "600111222" });
    expect(r.empresa_id).toBe("emp1");
    expect(r.nombre).toBe("Mercadona");
    expect(r.cif).toBe("B123");
    expect(r.email).toBeNull(); // string vacío -> null
    expect(r.telefono).toBe("600111222");
  });

  it("createCliente exige nombre no vacío", async () => {
    await expect(createCliente({ nombre: "   " })).rejects.toThrow("nombre del cliente es obligatorio");
  });

  it("actualizarCliente solo toca los campos dados y valida el nombre", async () => {
    TABLES.cliente = [{ id: "c1", nombre: "Viejo", email: "a@x.com", activo: true }];
    await actualizarCliente("c1", { email: "  nuevo@x.com  " });
    expect(TABLES.cliente[0].email).toBe("nuevo@x.com");
    expect(TABLES.cliente[0].nombre).toBe("Viejo"); // intacto
    await expect(actualizarCliente("c1", { nombre: "" })).rejects.toThrow("obligatorio");
  });

  it("desactivarCliente hace baja lógica (no borra)", async () => {
    TABLES.cliente = [{ id: "c1", nombre: "X", activo: true }];
    await desactivarCliente("c1");
    expect(TABLES.cliente[0].activo).toBe(false);
    expect(TABLES.cliente.find((c) => c.id === "c1")).toBeDefined();
  });

  it("asignarClienteAViaje pone cliente_id sin tocar la referencia", async () => {
    TABLES.viaje = [{ id: "v1", referencia: "ALB-123", cliente_id: null }];
    await asignarClienteAViaje("v1", "c1");
    expect(TABLES.viaje[0].cliente_id).toBe("c1");
    expect(TABLES.viaje[0].referencia).toBe("ALB-123"); // conservada
  });

  it("asignarClienteAViaje con null desasocia", async () => {
    TABLES.viaje = [{ id: "v1", referencia: "ALB-123", cliente_id: "c1" }];
    await asignarClienteAViaje("v1", null);
    expect(TABLES.viaje[0].cliente_id).toBeNull();
  });
});

describe("contexto (11.2 — capa de conocimiento, ver SPECS-11.md §8)", () => {
  beforeEach(() => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "emp1", id: "g1" }];
    TABLES.contexto = [];
  });

  it("(a) createContexto con campos mínimos inserta el shape correcto y devuelve el id", async () => {
    const id = await createContexto({ entidad: "viaje", entidadId: "v1", texto: "  hola  " });
    expect(id).toBeDefined();
    const fila = TABLES.contexto.find((c) => c.id === id);
    expect(fila.entidad).toBe("viaje");
    expect(fila.entidad_id).toBe("v1");
    expect(fila.canal).toBe("nota_manual");
    expect(fila.texto).toBe("hola");
    expect(fila.empresa_id).toBe("emp1");
    expect(fila.gestor_id).toBe("g1");
  });

  it("(b) createContexto resuelve gestor_id de la sesión activa", async () => {
    // Nota: a diferencia de lo descrito en SPECS-11.md §8(b), "sin sesión" no puede
    // probarse como gestor_id=null porque createContexto llama getCurrentEmpresaId()
    // primero (mismo patrón que createNotaGestor), que YA exige sesión y lanza antes
    // de llegar a la resolución de gestor_id -- ver getCurrentEmpresaId, data.js:325.
    const id = await createContexto({ entidad: "viaje", entidadId: "v1", texto: "hola" });
    expect(TABLES.contexto.find((c) => c.id === id).gestor_id).toBe("g1");
  });

  it("(b2) createContexto sin sesión activa lanza (vía getCurrentEmpresaId, no gestor_id silencioso)", async () => {
    SESSION = null;
    await expect(
      createContexto({ entidad: "viaje", entidadId: "v1", texto: "hola" })
    ).rejects.toThrow("sesión activa");
  });

  it("(c) createContexto rechaza entidad inválida", async () => {
    await expect(
      createContexto({ entidad: "vehiculo", entidadId: "x1", texto: "hola" })
    ).rejects.toThrow("entidad no valida: vehiculo");
    expect(TABLES.contexto).toHaveLength(0);
  });

  it("(d) createContexto rechaza canal reservado desde el dashboard", async () => {
    await expect(
      createContexto({ entidad: "viaje", entidadId: "v1", texto: "hola", canal: "llamada_transcrita" })
    ).rejects.toThrow("canal no permitido desde el dashboard: llamada_transcrita");
    expect(TABLES.contexto).toHaveLength(0);
  });

  it("(e) createContexto acepta canal='email' y campos opcionales", async () => {
    const id = await createContexto({
      entidad: "viaje", entidadId: "v1", texto: "cuerpo", canal: "email",
      resumen: "  r  ", autorExterno: "contacto cliente", ocurridoEn: "2026-01-01T00:00:00Z",
    });
    const fila = TABLES.contexto.find((c) => c.id === id);
    expect(fila.canal).toBe("email");
    expect(fila.resumen).toBe("r");
    expect(fila.autor_externo).toBe("contacto cliente");
    expect(fila.ocurrido_en).toBe("2026-01-01T00:00:00Z");
  });

  it("(f) resumen/autorExterno omitidos quedan null; sin ocurridoEn no se manda en el payload", async () => {
    const id = await createContexto({ entidad: "viaje", entidadId: "v1", texto: "hola" });
    const fila = TABLES.contexto.find((c) => c.id === id);
    expect(fila.resumen).toBeNull();
    expect(fila.autor_externo).toBeNull();
    expect(fila.ocurrido_en).toBeUndefined(); // el mock no aplica el DEFAULT de la BD real
  });

  it("(g) getContexto filtra por entidad+entidadId", async () => {
    TABLES.contexto = [
      { id: "c1", entidad: "viaje", entidad_id: "v1", texto: "a", ocurrido_en: "2026-01-01" },
      { id: "c2", entidad: "viaje", entidad_id: "v2", texto: "b", ocurrido_en: "2026-01-02" },
    ];
    const r = await getContexto("viaje", "v1");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("c1");
  });

  it("(h) getContexto ordena por ocurrido_en descendente (hecho más reciente primero)", async () => {
    TABLES.contexto = [
      { id: "c1", entidad: "viaje", entidad_id: "v1", texto: "vieja", ocurrido_en: "2026-01-01" },
      { id: "c2", entidad: "viaje", entidad_id: "v1", texto: "reciente", ocurrido_en: "2026-03-01" },
      { id: "c3", entidad: "viaje", entidad_id: "v1", texto: "media", ocurrido_en: "2026-02-01" },
    ];
    const r = await getContexto("viaje", "v1");
    expect(r.map((c) => c.id)).toEqual(["c2", "c3", "c1"]);
  });

  it("(i) getContexto con tabla vacía devuelve []", async () => {
    const r = await getContexto("viaje", "v1");
    expect(r).toEqual([]);
  });
});

describe("ajustes de empresa (9.39 — extraído de ajustes/page.jsx a data.js)", () => {
  beforeEach(() => {
    TABLES.empresa = [{ id: "e1", nombre: "Norenty" }];
  });

  it("guardarNombreEmpresa recorta espacios y guarda", async () => {
    await guardarNombreEmpresa("e1", "  Nueva SL  ");
    expect(TABLES.empresa[0].nombre).toBe("Nueva SL");
  });

  it("guardarBaseEmpresa guarda lat/lon válidas", async () => {
    await guardarBaseEmpresa("e1", "40.4", "-3.7");
    expect(TABLES.empresa[0].base_lat).toBe(40.4);
    expect(TABLES.empresa[0].base_lon).toBe(-3.7);
  });

  it("guardarBaseEmpresa acepta ambas vacías (borra la base)", async () => {
    await guardarBaseEmpresa("e1", "", "");
    expect(TABLES.empresa[0].base_lat).toBeNull();
    expect(TABLES.empresa[0].base_lon).toBeNull();
  });

  it("guardarBaseEmpresa rechaza coordenadas fuera de rango", async () => {
    await expect(guardarBaseEmpresa("e1", "200", "-3.7")).rejects.toThrow("coordenadas inválidas");
  });

  it("guardarBaseEmpresa rechaza que solo una de las dos esté vacía", async () => {
    await expect(guardarBaseEmpresa("e1", "40.4", "")).rejects.toThrow("rellena latitud y longitud");
  });

  it("guardarCosteKmEmpresa guarda un coste válido", async () => {
    await guardarCosteKmEmpresa("e1", "1.5");
    expect(TABLES.empresa[0].coste_km).toBe(1.5);
  });

  it("guardarCosteKmEmpresa rechaza negativos", async () => {
    await expect(guardarCosteKmEmpresa("e1", "-1")).rejects.toThrow("número positivo");
  });

  it("guardarVelocidadEmpresa rechaza cero o negativo", async () => {
    await expect(guardarVelocidadEmpresa("e1", "0")).rejects.toThrow("mayor que 0");
  });

  it("guardarVelocidadEmpresa guarda un valor válido", async () => {
    await guardarVelocidadEmpresa("e1", "80");
    expect(TABLES.empresa[0].velocidad_planificacion_kmh).toBe(80);
  });

  it("guardarObjetivoPuntualidadEmpresa guarda un porcentaje válido", async () => {
    await guardarObjetivoPuntualidadEmpresa("e1", "95");
    expect(TABLES.empresa[0].objetivo_puntualidad_pct).toBe(95);
  });

  it("guardarRequierePodEmpresa guarda true/false tal cual", async () => {
    await guardarRequierePodEmpresa("e1", false);
    expect(TABLES.empresa[0].requiere_pod).toBe(false);
    await guardarRequierePodEmpresa("e1", true);
    expect(TABLES.empresa[0].requiere_pod).toBe(true);
  });

  it("guardarObjetivoPuntualidadEmpresa vacío guarda null (quitar el objetivo)", async () => {
    await guardarObjetivoPuntualidadEmpresa("e1", "");
    expect(TABLES.empresa[0].objetivo_puntualidad_pct).toBeNull();
  });

  it("guardarObjetivoPuntualidadEmpresa rechaza fuera de 0-100", async () => {
    await expect(guardarObjetivoPuntualidadEmpresa("e1", "150")).rejects.toThrow("entre 0 y 100");
    await expect(guardarObjetivoPuntualidadEmpresa("e1", "-5")).rejects.toThrow("entre 0 y 100");
  });

  it("guardarMargenObjetivoEmpresa guarda un porcentaje válido", async () => {
    await guardarMargenObjetivoEmpresa("e1", "20");
    expect(TABLES.empresa[0].margen_objetivo_pct).toBe(20);
  });

  it("guardarMargenObjetivoEmpresa vacío guarda null", async () => {
    await guardarMargenObjetivoEmpresa("e1", "");
    expect(TABLES.empresa[0].margen_objetivo_pct).toBeNull();
  });

  it("guardarMargenObjetivoEmpresa rechaza negativos y >=100", async () => {
    await expect(guardarMargenObjetivoEmpresa("e1", "-1")).rejects.toThrow("entre 0 y 100");
    await expect(guardarMargenObjetivoEmpresa("e1", "100")).rejects.toThrow("entre 0 y 100");
  });

  it("guardarDesgloseCosteEmpresa guarda las 4 columnas parseadas", async () => {
    await guardarDesgloseCosteEmpresa("e1", {
      precio_gasoil_litro: "1.5", coste_peaje_km: "0.1", dieta_noche_eur: "30", coste_conductor_km: "0.4",
    });
    expect(TABLES.empresa[0]).toMatchObject({
      precio_gasoil_litro: 1.5, coste_peaje_km: 0.1, dieta_noche_eur: 30, coste_conductor_km: 0.4,
    });
  });

  it("guardarDesgloseCosteEmpresa no escribe nada si algún valor es inválido", async () => {
    await expect(
      guardarDesgloseCosteEmpresa("e1", { precio_gasoil_litro: "-1", coste_peaje_km: "0.1", dieta_noche_eur: "", coste_conductor_km: "" })
    ).rejects.toThrow("números positivos");
    expect(TABLES.empresa[0].precio_gasoil_litro).toBeUndefined();
  });
});

describe("normalizarTelefonoE164 (bot de llamadas, fase 1 — SPECS-BOT-LLAMADAS.md)", () => {
  it("ya en E.164 se queda igual", () => {
    expect(normalizarTelefonoE164("+34600111222")).toBe("+34600111222");
  });

  it("quita espacios, guiones y paréntesis", () => {
    expect(normalizarTelefonoE164("+34 600-111 (222)")).toBe("+34600111222");
  });

  it("00 al principio se convierte en +", () => {
    expect(normalizarTelefonoE164("0034600111222")).toBe("+34600111222");
  });

  it("nacional sin prefijo usa el prefijo por defecto (+34)", () => {
    expect(normalizarTelefonoE164("600111222")).toBe("+34600111222");
  });

  it("nacional con 0 inicial no duplica el prefijo", () => {
    expect(normalizarTelefonoE164("0600111222")).toBe("+34600111222");
  });

  it("acepta un prefijo por defecto distinto", () => {
    expect(normalizarTelefonoE164("712345678", "+40")).toBe("+40712345678");
  });

  it("vacío o solo espacios devuelve null", () => {
    expect(normalizarTelefonoE164("")).toBeNull();
    expect(normalizarTelefonoE164("   ")).toBeNull();
    expect(normalizarTelefonoE164(null)).toBeNull();
  });

  it("demasiado corto para ser un teléfono real devuelve null", () => {
    expect(normalizarTelefonoE164("123")).toBeNull();
  });
});

describe("createChofer / guardarTelefonoChofer (bot de llamadas, fase 1)", () => {
  beforeEach(() => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "emp1" }];
    TABLES.chofer = [];
  });

  it("createChofer sin teléfono guarda null", async () => {
    const c = await createChofer({ nombre: "Mario", idioma: "es" });
    expect(c.telefono).toBeNull();
  });

  it("createChofer normaliza el teléfono al guardarlo", async () => {
    const c = await createChofer({ nombre: "Mario", idioma: "es", telefono: "600 111 222" });
    expect(c.telefono).toBe("+34600111222");
  });

  it("createChofer rechaza un teléfono inválido sin llegar a insertar", async () => {
    await expect(createChofer({ nombre: "Mario", telefono: "abc" })).rejects.toThrow("no parece válido");
    expect(TABLES.chofer).toHaveLength(0);
  });

  it("createChofer creado por un gestor no-admin se auto-asigna su gestor_id (hallazgo post-F15.2: si no, quedaba visible a todo el equipo para siempre)", async () => {
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "emp1", id: "g-operativo", rol: "gestor_operativo" }];
    const c = await createChofer({ nombre: "Mario", idioma: "es" });
    expect(c.gestor_id).toBe("g-operativo");
  });

  it("createChofer creado por un admin queda sin asignar (visible a todo el equipo, igual que hoy)", async () => {
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "emp1", id: "g-admin", rol: "admin" }];
    const c = await createChofer({ nombre: "Mario", idioma: "es" });
    expect(c.gestor_id).toBeNull();
  });

  it("guardarTelefonoChofer actualiza el teléfono normalizado", async () => {
    TABLES.chofer = [{ id: "c1", nombre: "Mario", telefono: null }];
    await guardarTelefonoChofer("c1", "600111222");
    expect(TABLES.chofer[0].telefono).toBe("+34600111222");
  });

  it("guardarTelefonoChofer con string vacío borra el teléfono", async () => {
    TABLES.chofer = [{ id: "c1", nombre: "Mario", telefono: "+34600111222" }];
    await guardarTelefonoChofer("c1", "");
    expect(TABLES.chofer[0].telefono).toBeNull();
  });

  it("guardarTelefonoChofer rechaza un valor inválido sin tocar el existente", async () => {
    TABLES.chofer = [{ id: "c1", nombre: "Mario", telefono: "+34600111222" }];
    await expect(guardarTelefonoChofer("c1", "abc")).rejects.toThrow("no parece válido");
    expect(TABLES.chofer[0].telefono).toBe("+34600111222");
  });
});

describe("getChoferesConGestor / guardarGestorChofer (F15.3 — asignación de equipo)", () => {
  it("getChoferesConGestor devuelve id/nombre/gestor_id, ordenados por nombre", async () => {
    TABLES.chofer = [
      { id: "c1", nombre: "Zoe", gestor_id: "g1" },
      { id: "c2", nombre: "Ana", gestor_id: null },
    ];
    const r = await getChoferesConGestor();
    expect(r.map((c) => c.nombre)).toEqual(["Ana", "Zoe"]);
    expect(r.find((c) => c.nombre === "Zoe").gestor_id).toBe("g1");
  });

  it("guardarGestorChofer asigna un gestor_id", async () => {
    TABLES.chofer = [{ id: "c1", nombre: "Mario", gestor_id: null }];
    await guardarGestorChofer("c1", "g1");
    expect(TABLES.chofer[0].gestor_id).toBe("g1");
  });

  it("guardarGestorChofer con null desasigna (vuelve a 'Sin asignar')", async () => {
    TABLES.chofer = [{ id: "c1", nombre: "Mario", gestor_id: "g1" }];
    await guardarGestorChofer("c1", null);
    expect(TABLES.chofer[0].gestor_id).toBeNull();
  });
});

describe("createVehiculo (IMP.2 — alta manual y por importación masiva)", () => {
  beforeEach(() => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "emp1" }];
    TABLES.vehiculo = [];
  });

  it("normaliza la matrícula a mayúsculas y recorta espacios en marca/modelo", async () => {
    const r = await createVehiculo({ matricula: " 1234abc ", tipo: "rigido", marca: " Volvo ", modelo: " FH " });
    expect(r.matricula).toBe("1234ABC");
    expect(r.marca).toBe("Volvo");
    expect(r.modelo).toBe("FH");
    expect(r.empresa_id).toBe("emp1");
  });

  it("tipo por defecto es tractora si no se indica", async () => {
    const r = await createVehiculo({ matricula: "9999XYZ" });
    expect(r.tipo).toBe("tractora");
  });

  it("marca/modelo vacíos guardan null, no cadena vacía", async () => {
    const r = await createVehiculo({ matricula: "1111AAA", marca: "", modelo: "" });
    expect(r.marca).toBeNull();
    expect(r.modelo).toBeNull();
  });

  it("rechaza matrícula vacía sin llegar a insertar", async () => {
    await expect(createVehiculo({ matricula: "   " })).rejects.toThrow("matrícula no puede estar vacía");
    expect(TABLES.vehiculo).toHaveLength(0);
  });
});

describe("guardarCapacidadVehiculo (COT.3 — capacidad de carga LDM/kg/m³)", () => {
  beforeEach(() => {
    TABLES.vehiculo = [{ id: "v1", matricula: "1234ABC" }];
  });

  it("guarda las 3 dimensiones parseadas", async () => {
    await guardarCapacidadVehiculo("v1", { ldm: "13.6", kg: "24000", m3: "90" });
    expect(TABLES.vehiculo[0]).toMatchObject({ capacidad_ldm: 13.6, capacidad_kg: 24000, capacidad_m3: 90 });
  });

  it("vacío guarda null en esa dimensión, las demás no se tocan", async () => {
    await guardarCapacidadVehiculo("v1", { ldm: "", kg: "24000", m3: "" });
    expect(TABLES.vehiculo[0].capacidad_ldm).toBeNull();
    expect(TABLES.vehiculo[0].capacidad_kg).toBe(24000);
    expect(TABLES.vehiculo[0].capacidad_m3).toBeNull();
  });

  it("rechaza un valor negativo y no escribe nada", async () => {
    await expect(guardarCapacidadVehiculo("v1", { ldm: "-1", kg: "24000", m3: "90" })).rejects.toThrow("positivo");
    expect(TABLES.vehiculo[0].capacidad_ldm).toBeUndefined();
  });
});

describe("gestión de roles del equipo (9.29 — sin cobertura hasta la auditoría CTO 2026-07-05)", () => {
  it("getGestoresEmpresa devuelve los gestores ordenados por nombre", async () => {
    TABLES.gestor = [
      { id: "g1", nombre: "Zoe", email: "z@x.com", rol: "admin", activo: true, auth_user_id: "u1" },
      { id: "g2", nombre: "Ana", email: "a@x.com", rol: "gestor_operativo", activo: true, auth_user_id: "u2" },
    ];
    const r = await getGestoresEmpresa();
    expect(r.map((g) => g.nombre)).toEqual(["Ana", "Zoe"]);
  });

  it("actualizarRolGestor cambia el rol de la fila indicada", async () => {
    TABLES.gestor = [{ id: "g1", nombre: "Ana", rol: "admin", activo: true }];
    await actualizarRolGestor("g1", "solo_lectura");
    expect(TABLES.gestor[0].rol).toBe("solo_lectura");
  });

  it("actualizarRolGestor lanza si Supabase devuelve error (p.ej. RLS rechaza auto-promoción)", async () => {
    TABLES.gestor = [{ id: "g1", nombre: "Ana", rol: "admin", activo: true }];
    UPDATE_ERRORS.gestor = { message: "no puedes editar tu propia fila" };
    await expect(actualizarRolGestor("g1", "admin")).rejects.toThrow(/no puedes editar tu propia fila/);
  });

  it("desactivarGestor pone activo=false", async () => {
    TABLES.gestor = [{ id: "g1", nombre: "Ana", rol: "gestor_operativo", activo: true }];
    await desactivarGestor("g1");
    expect(TABLES.gestor[0].activo).toBe(false);
  });

  it("reactivarGestor pone activo=true", async () => {
    TABLES.gestor = [{ id: "g1", nombre: "Ana", rol: "gestor_operativo", activo: false }];
    await reactivarGestor("g1");
    expect(TABLES.gestor[0].activo).toBe(true);
  });

  it("desactivarGestor lanza si Supabase devuelve error", async () => {
    TABLES.gestor = [{ id: "g1", nombre: "Ana", rol: "admin", activo: true }];
    UPDATE_ERRORS.gestor = { message: "no puedes desactivarte a ti mismo" };
    await expect(desactivarGestor("g1")).rejects.toThrow(/no puedes desactivarte a ti mismo/);
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

  describe("calcularAvisosViabilidad (hallazgo real 2026-07-22: Madrid a Burdeos en 1h se guardaba sin avisar)", () => {
    it("avisa cuando la ventana entre paradas no alcanza ni sin descansos", () => {
      const avisos = calcularAvisosViabilidad([
        { ...MADRID, ventana_inicio: "2026-01-01T08:00:00Z", ventana_fin: "2026-01-01T09:00:00Z" },
        { lat: 44.8378, lon: -0.5792, ventana_inicio: "2026-01-01T10:00:00Z", ventana_fin: "2026-01-01T10:00:00Z" }, // Burdeos, ~800km reales
      ]);
      expect(avisos).toHaveLength(1);
      expect(avisos[0].mensaje).toMatch(/no parece viable/);
      expect(avisos[0].horasDisponibles).toBe(1);
    });

    it("NO avisa cuando la ventana sí alcanza de sobra", () => {
      const avisos = calcularAvisosViabilidad([
        { ...MADRID, ventana_inicio: "2026-01-01T08:00:00Z", ventana_fin: "2026-01-01T08:00:00Z" },
        { ...BARCELONA, ventana_inicio: "2026-01-01T18:00:00Z", ventana_fin: "2026-01-01T18:00:00Z" }, // 10h para ~655km estimados
      ]);
      expect(avisos).toHaveLength(0);
    });

    it("NO avisa si falta alguna ventana (no hay nada objetivo que comprobar)", () => {
      const avisos = calcularAvisosViabilidad([
        { ...MADRID, ventana_inicio: "", ventana_fin: "" },
        { ...BARCELONA, ventana_inicio: "2026-01-01T09:00:00Z", ventana_fin: "" },
      ]);
      expect(avisos).toHaveLength(0);
    });

    it("NO avisa si falta alguna coordenada", () => {
      const avisos = calcularAvisosViabilidad([
        { lat: null, lon: null, ventana_inicio: "2026-01-01T08:00:00Z", ventana_fin: "2026-01-01T08:00:00Z" },
        { ...BARCELONA, ventana_inicio: "2026-01-01T09:00:00Z", ventana_fin: "2026-01-01T09:00:00Z" },
      ]);
      expect(avisos).toHaveLength(0);
    });
  });

  describe("sugerirOrdenParadas (F13.6 — sugerencia de orden, nunca dispatch automático)", () => {
    const A = { id: "a", orden: 1, tipo: "recogida", lat: 0, lon: 0 };
    const B = { id: "b", orden: 2, tipo: "recogida", lat: 0, lon: 2 };
    const C = { id: "c", orden: 3, tipo: "recogida", lat: 0, lon: 1 };
    const D = { id: "d", orden: 4, tipo: "recogida", lat: 0, lon: 3 };
    const E = { id: "e", orden: 5, tipo: "recogida", lat: 0, lon: 4 };

    it("con 4 puntos en línea fuera de orden, sugiere el orden que minimiza km y fija origen/destino", () => {
      const r = sugerirOrdenParadas([A, B, C, D, E]);
      expect(r.mereceLaPena).toBe(true);
      expect(r.ordenSugerido[0]).toBe("a");
      expect(r.ordenSugerido[r.ordenSugerido.length - 1]).toBe("e");
      expect(r.ordenSugerido).toEqual(["a", "c", "b", "d", "e"]); // orden por longitud creciente
      expect(r.kmSugerido).toBeLessThan(r.kmActual);
    });

    it("si el orden actual ya es (casi) óptimo, no sugiere (mereceLaPena: false, sin ordenSugerido)", () => {
      // El campo `orden` (no la posición en el array) es lo que define la
      // secuencia actual -- estos puntos ya están en orden de longitud creciente.
      const yaOptimo = [
        { id: "a", orden: 1, tipo: "recogida", lat: 0, lon: 0 },
        { id: "c", orden: 2, tipo: "recogida", lat: 0, lon: 1 },
        { id: "b", orden: 3, tipo: "recogida", lat: 0, lon: 2 },
        { id: "d", orden: 4, tipo: "recogida", lat: 0, lon: 3 },
        { id: "e", orden: 5, tipo: "recogida", lat: 0, lon: 4 },
      ];
      const r = sugerirOrdenParadas(yaOptimo);
      expect(r.mereceLaPena).toBe(false);
      expect(r.ordenSugerido).toBeUndefined();
    });

    it("intermedios con tipos mezclados (recogida+entrega) devuelve null -- limitación v1", () => {
      const r = sugerirOrdenParadas([A, B, { ...C, tipo: "entrega" }, D, E]);
      expect(r).toBeNull();
    });

    it("con menos de 3 hitos con coordenadas devuelve null (nada que reordenar)", () => {
      expect(sugerirOrdenParadas([A, E])).toBeNull();
    });

    it("ignora hitos sin coordenadas al decidir si hay algo que reordenar", () => {
      const r = sugerirOrdenParadas([A, B, C, D, E, { id: "sin-coords", orden: 6, lat: null, lon: null }]);
      expect(r.ordenSugerido[0]).toBe("a");
    });
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

  describe("getEstado561ParaChoferes (auditoría arquitectura 2026-07-05 — versión por lotes)", () => {
    it("devuelve el mismo resultado que getEstado561 individual, para varios choferes a la vez", async () => {
      TABLES.ejecucion_evento = [
        { tipo: "llegada", chofer_id: "c1", viaje_id: "v1", ocurrido_en: hace(1) },
        { tipo: "llegada", chofer_id: "c2", viaje_id: "v2", ocurrido_en: hace(10) },
      ];
      TABLES.hito = [
        { id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...MADRID },
        { id: "h2", viaje_id: "v1", orden: 2, estado: "completado", ...BARCELONA },
        { id: "h3", viaje_id: "v2", orden: 1, estado: "completado", ...MADRID },
        { id: "h4", viaje_id: "v2", orden: 2, estado: "completado", ...BARCELONA },
      ];
      TABLES.empresa = [{ velocidad_planificacion_kmh: 75 }];

      const individual1 = await getEstado561("c1");
      const individual2 = await getEstado561("c2");
      const porLotes = await getEstado561ParaChoferes(["c1", "c2"]);

      expect(porLotes.c1).toEqual(individual1);
      expect(porLotes.c2).toEqual(individual2);
    });

    it("un chófer sin ninguna llegada devuelve el resultado por defecto (margen completo)", async () => {
      TABLES.ejecucion_evento = [
        { tipo: "llegada", chofer_id: "c1", viaje_id: "v1", ocurrido_en: hace(1) },
      ];
      TABLES.hito = [
        { id: "h1", viaje_id: "v1", orden: 1, estado: "completado", ...MADRID },
        { id: "h2", viaje_id: "v1", orden: 2, estado: "completado", ...BARCELONA },
      ];
      TABLES.empresa = [{ velocidad_planificacion_kmh: 75 }];

      const r = await getEstado561ParaChoferes(["c1", "c-sin-viajes"]);
      expect(r["c-sin-viajes"]).toEqual({
        horas7: 0, horas14: 0,
        margen7: LIMITE_561_SEMANAL_H, margen14: LIMITE_561_BISEMANAL_H,
        pct7: 0, pct14: 0, estimado: true,
      });
      expect(r.c1.horas7).toBeGreaterThan(0);
    });

    it("lista vacía de choferes devuelve objeto vacío sin consultar nada", async () => {
      const r = await getEstado561ParaChoferes([]);
      expect(r).toEqual({});
    });
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

describe("detectarHuecoUbicacion / getViajesConHuecoUbicacion (F14.2)", () => {
  it("sin ningún ping todavía, no marca hueco (margen a viajes recién empezados)", () => {
    const r = detectarHuecoUbicacion(null);
    expect(r.hueco).toBe(false);
    expect(r.horasSinSenal).toBeNull();
  });

  it("último ping reciente (dentro del umbral), no marca hueco", () => {
    const haceUnaHora = new Date(Date.now() - 3600000).toISOString();
    const r = detectarHuecoUbicacion(haceUnaHora);
    expect(r.hueco).toBe(false);
  });

  it("último ping más antiguo que el umbral, marca hueco", () => {
    const hace4h = new Date(Date.now() - 4 * 3600000).toISOString();
    const r = detectarHuecoUbicacion(hace4h);
    expect(r.hueco).toBe(true);
    expect(r.horasSinSenal).toBeGreaterThanOrEqual(4);
  });

  it("getViajesConHuecoUbicacion detecta el viaje con chófer sin señal reciente", async () => {
    TABLES.viaje = [
      { id: "v1", referencia: "REF1", chofer_id: "c1", estado: "en_curso" },
      { id: "v2", referencia: "REF2", chofer_id: "c2", estado: "en_curso" },
    ];
    TABLES.ubicacion = [
      { chofer_id: "c1", created_at: new Date(Date.now() - 5 * 3600000).toISOString() },
      { chofer_id: "c2", created_at: new Date().toISOString() },
    ];
    const r = await getViajesConHuecoUbicacion();
    expect(r.map((x) => x.referencia)).toEqual(["REF1"]);
  });

  it("getViajesConHuecoUbicacion ignora viajes sin chófer asignado", async () => {
    TABLES.viaje = [{ id: "v1", referencia: "REF1", chofer_id: null, estado: "en_curso" }];
    TABLES.ubicacion = [];
    const r = await getViajesConHuecoUbicacion();
    expect(r).toEqual([]);
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

  it("createGastoViaje (12.1) guarda foto_url y foto_hash_sha256 cuando se pasan", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.gasto_viaje = [];
    const g = await createGastoViaje({
      viajeId: "v1", tipo: "multa", importe: 90,
      fotoUrl: "e1/gasto/v1/abc.jpg", fotoHash: "deadbeef",
    });
    expect(g.foto_url).toBe("e1/gasto/v1/abc.jpg");
    expect(g.foto_hash_sha256).toBe("deadbeef");
  });

  it("createGastoViaje sin foto deja foto_url/foto_hash_sha256 en null", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.gasto_viaje = [];
    const g = await createGastoViaje({ viajeId: "v1", tipo: "peaje", importe: 10 });
    expect(g.foto_url).toBeNull();
    expect(g.foto_hash_sha256).toBeNull();
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

  it("margenRealMedioPct (auditoría 2026-07-15): media de margenReal/precio, no €/€ (no sesga a los viajes caros)", async () => {
    // haceUnaHora, no new Date(): claramente dentro de la ventana, sin
    // empatar con "hasta" (mismo criterio que el test de arriba -- usar el
    // instante exacto de "ahora" puede caer justo en el borde de `.lt()` y
    // volverse flaky por una carrera de milisegundos).
    const haceUnaHora = new Date(Date.now() - 3600000).toISOString();
    TABLES.viaje = [
      { id: "v1", referencia: "R1", precio: 1000, vehiculo_id: null, created_at: haceUnaHora }, // margen 1000, 100%
      { id: "v2", referencia: "R2", precio: 100, vehiculo_id: null, created_at: haceUnaHora },  // margen 50, 50%
    ];
    TABLES.hito = [
      { orden: 1, ...MADRID, viaje_id: "v1" }, { orden: 2, ...BARCELONA, viaje_id: "v1" },
      { orden: 1, ...MADRID, viaje_id: "v2" }, { orden: 2, ...BARCELONA, viaje_id: "v2" },
    ];
    TABLES.empresa = [{ coste_km: 0, velocidad_planificacion_kmh: 75, margen_objetivo_pct: 60 }];
    TABLES.gasto_viaje = [{ id: "g1", viaje_id: "v2", tipo: "peaje", importe: 50 }];

    const r = await getMetricasRentabilidad();
    expect(r.margenRealMedioPct).toBe(75); // media de (100+50)/2, NO ponderada por precio
    expect(r.margenObjetivoPct).toBe(60);
  });

  it("getAlertaMargen (R8, auditoría 2026-07-15): mismo resultado que getMetricasRentabilidad sin N+1 -- 2 consultas en bloque, no una por viaje", async () => {
    const haceUnaHora = new Date(Date.now() - 3600000).toISOString();
    TABLES.viaje = [
      { id: "v1", referencia: "R1", precio: 1000, vehiculo_id: null, created_at: haceUnaHora }, // margen 1000, 100%
      { id: "v2", referencia: "R2", precio: 100, vehiculo_id: null, created_at: haceUnaHora },  // margen 50, 50%
    ];
    TABLES.empresa = [{ coste_km: 0, velocidad_planificacion_kmh: 75, margen_objetivo_pct: 60 }];
    TABLES.gasto_viaje = [{ id: "g1", viaje_id: "v2", tipo: "peaje", importe: 50 }];

    const r = await getAlertaMargen();
    expect(r.margenRealMedioPct).toBe(75);
    expect(r.margenObjetivoPct).toBe(60);
  });

  it("getAlertaMargen sin viajes con precio devuelve margenRealMedioPct null", async () => {
    TABLES.viaje = [];
    TABLES.empresa = [{ margen_objetivo_pct: 60 }];
    TABLES.gasto_viaje = [];
    const r = await getAlertaMargen();
    expect(r.margenRealMedioPct).toBeNull();
    expect(r.margenObjetivoPct).toBe(60);
  });

  it("F13.4: getMetricasRentabilidad agrega margen estimado vs. real por mes, solo con costeEstimado disponible", async () => {
    TABLES.viaje = [
      { id: "v1", referencia: "R1", precio: 1000, vehiculo_id: null, created_at: "2026-01-15T00:00:00Z" },
      { id: "v2", referencia: "R2", precio: 800, vehiculo_id: null, created_at: "2026-02-10T00:00:00Z" },
      // Sin gastos reales -> margenReal no null (gastosReales=0), pero SIN coste
      // estimado (empresa sin coste_km/hitos consistentes) no debería faltar el mes.
    ];
    TABLES.hito = [
      { orden: 1, ...MADRID, viaje_id: "v1" }, { orden: 2, ...BARCELONA, viaje_id: "v1" },
      { orden: 1, ...MADRID, viaje_id: "v2" }, { orden: 2, ...BARCELONA, viaje_id: "v2" },
    ];
    TABLES.empresa = [{ coste_km: 1, velocidad_planificacion_kmh: 75 }];
    TABLES.gasto_viaje = [{ id: "g1", viaje_id: "v1", tipo: "peaje", importe: 50 }];

    const r = await getMetricasRentabilidad(RANGO_AMPLIO);
    expect(r.porMes.map((m) => m.mes)).toEqual(["2026-01", "2026-02"]);
    const enero = r.porMes.find((m) => m.mes === "2026-01");
    expect(enero.margenRealMedio).toBe(1000 - 50);
    expect(enero.numViajes).toBe(1);
  });

  it("getInformeEjecutivo (R3) no lanza y compone la forma esperada", async () => {
    TABLES.viaje = [{ id: "v1", referencia: "R1", precio: 1000, vehiculo_id: null, created_at: "2026-03-15T00:00:00Z" }];
    TABLES.hito = [{ orden: 1, ...MADRID, viaje_id: "v1" }, { orden: 2, ...BARCELONA, viaje_id: "v1" }];
    TABLES.empresa = [{ coste_km: 0, velocidad_planificacion_kmh: 75 }];
    TABLES.vehiculo = [{ id: "veh1", matricula: "1234ABC", activo: true }];
    TABLES.gasto_viaje = [];
    TABLES.incidencia = [];
    TABLES.mantenimiento_vehiculo = [];

    const r = await getInformeEjecutivo({ desde: "2026-03-01T00:00:00Z", hasta: "2026-04-01T00:00:00Z" });
    expect(r.periodo.desde).toBe("2026-03-01T00:00:00Z");
    expect(r.puntualidad).toHaveProperty("pctPuntualidad");
    expect(r.rentabilidad).toHaveProperty("margenRealMedio");
    expect(r.flota).toHaveProperty("totalVehiculos");
    expect(r.comparativa).toHaveProperty("margenRealMedio");
    expect(r.comparativa).toHaveProperty("tasaIncidencias");
    expect(r.gestores).toEqual([]);
  });

  it("getComparativaMensual (12.2) compara el periodo actual contra el anterior de igual duración", async () => {
    TABLES.viaje = [
      // periodo actual: [2026-03-01, 2026-04-01)
      { id: "v1", referencia: "R1", precio: 2000, vehiculo_id: null, created_at: "2026-03-15T00:00:00Z" },
      // periodo anterior (misma duración, justo antes): [2026-01-29T.., 2026-03-01)
      { id: "v2", referencia: "R2", precio: 1000, vehiculo_id: null, created_at: "2026-02-15T00:00:00Z" },
    ];
    TABLES.hito = [
      { orden: 1, ...MADRID, viaje_id: "v1" }, { orden: 2, ...BARCELONA, viaje_id: "v1" },
      { orden: 1, ...MADRID, viaje_id: "v2" }, { orden: 2, ...BARCELONA, viaje_id: "v2" },
    ];
    TABLES.empresa = [{ coste_km: 0, velocidad_planificacion_kmh: 75 }];
    TABLES.gasto_viaje = [];
    TABLES.incidencia = [];

    const r = await getComparativaMensual({ desde: "2026-03-01T00:00:00Z", hasta: "2026-04-01T00:00:00Z" });
    expect(r.margenRealMedio.actual).toBe(2000);
    expect(r.margenRealMedio.anterior).toBe(1000);
    expect(r.margenRealMedio.variacionPct).toBe(100); // dobló
    expect(r.viajesAPerdidasReales.actual).toBe(0);
    expect(r.pctPuntualidad.actual).toBeNull(); // sin hitos con ventana_fin en ninguna tabla
  });

  it("getComparativaMensual incluye la tasa de incidencias del periodo actual vs. el anterior", async () => {
    TABLES.viaje = [
      { id: "v1", referencia: "R1", precio: 1000, vehiculo_id: null, created_at: "2026-03-15T00:00:00Z" },
      { id: "v2", referencia: "R2", precio: 1000, vehiculo_id: null, created_at: "2026-02-15T00:00:00Z" },
    ];
    TABLES.hito = [];
    TABLES.empresa = [{ coste_km: 0, velocidad_planificacion_kmh: 75 }];
    TABLES.gasto_viaje = [];
    // 2 incidencias en el periodo actual (1 viaje), 0 en el anterior -> tasa sube de 0 a 2
    TABLES.incidencia = [
      { id: "i1", viaje_id: "v1", tipo: "otro", created_at: "2026-03-16T00:00:00Z" },
      { id: "i2", viaje_id: "v1", tipo: "otro", created_at: "2026-03-17T00:00:00Z" },
    ];

    const r = await getComparativaMensual({ desde: "2026-03-01T00:00:00Z", hasta: "2026-04-01T00:00:00Z" });
    expect(r.tasaIncidencias.actual).toBe(2);
    expect(r.tasaIncidencias.anterior).toBe(0);
    expect(r.tasaIncidencias.variacionPct).toBeNull(); // anterior es 0, evita dividir por 0
  });

  it("variación es null cuando el periodo anterior no tiene datos (evita dividir por 0/null)", async () => {
    TABLES.viaje = [
      { id: "v1", referencia: "R1", precio: 500, vehiculo_id: null, created_at: "2026-03-15T00:00:00Z" },
    ];
    TABLES.hito = [{ orden: 1, ...MADRID, viaje_id: "v1" }, { orden: 2, ...BARCELONA, viaje_id: "v1" }];
    TABLES.empresa = [{ coste_km: 0, velocidad_planificacion_kmh: 75 }];
    TABLES.gasto_viaje = [];
    TABLES.incidencia = [];

    const r = await getComparativaMensual({ desde: "2026-03-01T00:00:00Z", hasta: "2026-04-01T00:00:00Z" });
    expect(r.margenRealMedio.anterior).toBeNull();
    expect(r.margenRealMedio.variacionPct).toBeNull();
  });
});

describe("verdad observada (10.8 — registro histórico del error de estimación)", () => {
  const MADRID = { lat: 40.4168, lon: -3.7038 };
  const BARCELONA = { lat: 41.3851, lon: 2.1734 };

  beforeEach(() => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.verdad_observada = [];
  });

  it("crearSnapshotVerdadObservada agrega puntualidad + desviación de coste y guarda la fila", async () => {
    TABLES.hito = [
      { id: "h1", viaje_id: "v1", orden: 1, ventana_fin: "2026-03-05T10:00:00Z" }, // a tiempo
      { id: "h2", viaje_id: "v1", orden: 2, ventana_fin: "2026-03-10T10:00:00Z" }, // tarde
    ];
    TABLES.ejecucion_evento = [
      { hito_id: "h1", tipo: "llegada", ocurrido_en: "2026-03-05T09:50:00Z" }, // 10 min antes
      { hito_id: "h2", tipo: "llegada", ocurrido_en: "2026-03-10T10:30:00Z" }, // 30 min tarde
    ];
    TABLES.viaje = [{ id: "v2", referencia: "R2", precio: 1000, vehiculo_id: null, created_at: "2026-03-15T00:00:00Z" }];
    TABLES.hito = TABLES.hito.concat([
      { orden: 1, ...MADRID, viaje_id: "v2" }, { orden: 2, ...BARCELONA, viaje_id: "v2" },
    ]);
    TABLES.empresa = [{ coste_km: 1, velocidad_planificacion_kmh: 75 }];
    TABLES.gasto_viaje = [{ id: "g1", viaje_id: "v2", tipo: "otro", importe: 50 }];

    const fila = await crearSnapshotVerdadObservada({ desde: "2026-03-01T00:00:00Z", hasta: "2026-04-01T00:00:00Z" });
    expect(fila.empresa_id).toBe("e1");
    expect(fila.pct_hitos_a_tiempo).toBe(50); // 1 de 2 a tiempo
    expect(fila.delta_llegada_medio_min).toBe(10); // (-10 + 30) / 2
    expect(fila.desviacion_coste_pct_media).not.toBeNull();
    expect(TABLES.verdad_observada).toHaveLength(1);
  });

  it("crearSnapshotVerdadObservada sin ningún dato guarda nulls, no lanza", async () => {
    TABLES.hito = [];
    TABLES.ejecucion_evento = [];
    TABLES.viaje = [];
    TABLES.empresa = [{ coste_km: 1, velocidad_planificacion_kmh: 75 }];
    TABLES.gasto_viaje = [];

    const fila = await crearSnapshotVerdadObservada({ desde: "2026-03-01T00:00:00Z", hasta: "2026-04-01T00:00:00Z" });
    expect(fila.pct_hitos_a_tiempo).toBeNull();
    expect(fila.delta_llegada_medio_min).toBeNull();
    expect(fila.desviacion_coste_pct_media).toBeNull();
    expect(fila.num_viajes_con_datos).toBe(0);
  });

  it("getTendenciaVerdadObservada devuelve el histórico ordenado, más reciente primero", async () => {
    TABLES.verdad_observada = [
      { id: "s1", empresa_id: "e1", periodo_desde: "2026-01-01T00:00:00Z" },
      { id: "s2", empresa_id: "e1", periodo_desde: "2026-03-01T00:00:00Z" },
      { id: "s3", empresa_id: "e1", periodo_desde: "2026-02-01T00:00:00Z" },
    ];
    const r = await getTendenciaVerdadObservada();
    expect(r.map((s) => s.id)).toEqual(["s2", "s3", "s1"]);
  });
});

describe("sugerencia de calibración (10.9b — suggestion-only, N=20)", () => {
  const MADRID = { lat: 40.4168, lon: -3.7038 };
  const BARCELONA = { lat: 41.3851, lon: 2.1734 };

  // Cada viaje: 2 hitos completados (osrmMock por defecto devuelve 100km,
  // ver beforeEach global), 2 llegadas separadas 2h (-> 50 km/h), un gasto
  // de 100€ (-> 1€/km de coste real).
  function construirViajes(n) {
    const viajes = [];
    const hitos = [];
    const eventos = [];
    const gastos = [];
    for (let i = 0; i < n; i++) {
      const id = `v${i}`;
      viajes.push({ id, estado: "completado" });
      hitos.push({ id: `h${i}a`, viaje_id: id, orden: 1, estado: "completado", ...MADRID });
      hitos.push({ id: `h${i}b`, viaje_id: id, orden: 2, estado: "completado", ...BARCELONA });
      eventos.push({ viaje_id: id, tipo: "llegada", ocurrido_en: "2026-03-01T08:00:00Z" });
      eventos.push({ viaje_id: id, tipo: "llegada", ocurrido_en: "2026-03-01T10:00:00Z" });
      gastos.push({ viaje_id: id, importe: 100 });
    }
    return { viajes, hitos, eventos, gastos };
  }

  it("con menos viajes que el mínimo, suficiente=false y no calcula nada", async () => {
    const { viajes, hitos, eventos, gastos } = construirViajes(5);
    TABLES.viaje = viajes;
    TABLES.hito = hitos;
    TABLES.ejecucion_evento = eventos;
    TABLES.gasto_viaje = gastos;
    TABLES.empresa = [{ id: "e1", velocidad_planificacion_kmh: 75, coste_km: 2 }];

    const r = await getSugerenciaCalibracion({ minimoViajes: 20 });
    expect(r.suficiente).toBe(false);
    expect(r.numViajesConDatos).toBe(5);
  });

  it("con 20 viajes y valores configurados muy distintos de los reales, sugiere actualizar ambos", async () => {
    const { viajes, hitos, eventos, gastos } = construirViajes(20);
    TABLES.viaje = viajes;
    TABLES.hito = hitos;
    TABLES.ejecucion_evento = eventos;
    TABLES.gasto_viaje = gastos;
    TABLES.empresa = [{ id: "e1", velocidad_planificacion_kmh: 75, coste_km: 2 }];

    const r = await getSugerenciaCalibracion({ minimoViajes: 20 });
    expect(r.suficiente).toBe(true);
    expect(r.numViajesConDatos).toBe(20);
    expect(r.velocidad.real).toBe(50); // 100km / 2h
    expect(r.velocidad.configurada).toBe(75);
    expect(r.velocidad.sugerir).toBe(true);
    expect(r.costeKm.real).toBe(1); // 100€ / 100km
    expect(r.costeKm.configurado).toBe(2);
    expect(r.costeKm.sugerir).toBe(true);
  });

  it("con valores configurados ya cercanos a los reales, NO sugiere (evita ruido)", async () => {
    const { viajes, hitos, eventos, gastos } = construirViajes(20);
    TABLES.viaje = viajes;
    TABLES.hito = hitos;
    TABLES.ejecucion_evento = eventos;
    TABLES.gasto_viaje = gastos;
    TABLES.empresa = [{ id: "e1", velocidad_planificacion_kmh: 51, coste_km: 1.02 }];

    const r = await getSugerenciaCalibracion({ minimoViajes: 20 });
    expect(r.velocidad.sugerir).toBe(false);
    expect(r.costeKm.sugerir).toBe(false);
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

describe("calcularUrgenciaIncidencia — triaje sobre hechos objetivos (7B.2, 2026-07-19)", () => {
  const AHORA = "2026-07-19T12:00:00Z";

  it("un accidente es siempre alta, sin depender del contexto", () => {
    const r = calcularUrgenciaIncidencia({ tipo: "accidente", estado: "abierta" }, { ahora: AHORA });
    expect(r.nivel).toBe("alta");
    expect(r.motivos).toContain("Accidente");
  });

  it("una incidencia ya escalada es alta (nadie respondió en la ventana de gracia)", () => {
    const r = calcularUrgenciaIncidencia(
      { tipo: "otro", estado: "abierta", escalada_en: "2026-07-19T11:00:00Z" },
      { ahora: AHORA },
    );
    expect(r.nivel).toBe("alta");
    expect(r.motivos).toContain("Ya escalada al equipo");
  });

  it("ventana de entrega ya vencida sube a alta y dice cuánto hace", () => {
    const r = calcularUrgenciaIncidencia(
      { tipo: "retraso", estado: "abierta" },
      { hito: { ventana_fin: "2026-07-19T11:30:00Z" }, ahora: AHORA },
    );
    expect(r.nivel).toBe("alta");
    expect(r.motivos.some((m) => m.includes("vencida hace 30 min"))).toBe(true);
  });

  it("ventana próxima (dentro del umbral) es media, no alta", () => {
    const r = calcularUrgenciaIncidencia(
      { tipo: "retraso", estado: "abierta" },
      { hito: { ventana_fin: "2026-07-19T13:00:00Z" }, ahora: AHORA },
    );
    expect(r.nivel).toBe("media");
    expect(r.motivos.some((m) => m.includes("Quedan 60 min"))).toBe(true);
  });

  it("avería distingue viaje en curso (alta) de planificado (media)", () => {
    const enCurso = calcularUrgenciaIncidencia(
      { tipo: "averia", estado: "abierta" },
      { viaje: { estado: "en_curso" }, ahora: AHORA },
    );
    const planificado = calcularUrgenciaIncidencia(
      { tipo: "averia", estado: "abierta" },
      { viaje: { estado: "planificado" }, ahora: AHORA },
    );
    expect(enCurso.nivel).toBe("alta");
    expect(planificado.nivel).toBe("media");
  });

  it("una incidencia sin señales objetivas se queda en baja y lo dice", () => {
    const r = calcularUrgenciaIncidencia(
      { tipo: "otro", estado: "abierta" },
      { viaje: { estado: "planificado" }, ahora: AHORA },
    );
    expect(r.nivel).toBe("baja");
    expect(r.motivos).toContain("Sin señales de urgencia");
  });

  it("una incidencia resuelta nunca es urgente", () => {
    const r = calcularUrgenciaIncidencia(
      { tipo: "accidente", estado: "resuelta", escalada_en: "2026-07-19T10:00:00Z" },
      { ahora: AHORA },
    );
    expect(r.nivel).toBe("baja");
  });
});

describe("calcularDesfasePod — capa barata de validación de POD (decisión 2026-07-13)", () => {
  it("POD subido poco después de la llegada: no tardío", () => {
    const pod = { hito_id: "h1", created_at: "2026-01-01T10:05:00Z" };
    const eventos = [{ tipo: "llegada", hito_id: "h1", ocurrido_en: "2026-01-01T10:00:00Z" }];
    const r = calcularDesfasePod(pod, eventos);
    expect(r.minutos).toBe(5);
    expect(r.tardio).toBe(false);
  });

  it(`POD subido justo por debajo del umbral (${UMBRAL_POD_TARDIO_MIN} min): no tardío`, () => {
    const pod = { hito_id: "h1", created_at: "2026-01-01T11:59:00Z" };
    const eventos = [{ tipo: "llegada", hito_id: "h1", ocurrido_en: "2026-01-01T10:00:00Z" }];
    const r = calcularDesfasePod(pod, eventos);
    expect(r.minutos).toBe(119);
    expect(r.tardio).toBe(false);
  });

  it("POD subido muy por encima del umbral: tardío", () => {
    const pod = { hito_id: "h1", created_at: "2026-01-01T14:00:00Z" };
    const eventos = [{ tipo: "llegada", hito_id: "h1", ocurrido_en: "2026-01-01T10:00:00Z" }];
    const r = calcularDesfasePod(pod, eventos);
    expect(r.minutos).toBe(240);
    expect(r.tardio).toBe(true);
  });

  it("sin evento de llegada para ese hito: no marca tardío (sin datos, no falso positivo)", () => {
    const pod = { hito_id: "h1", created_at: "2026-01-01T14:00:00Z" };
    const r = calcularDesfasePod(pod, []);
    expect(r.minutos).toBeNull();
    expect(r.tardio).toBe(false);
  });

  it("ignora eventos de otro tipo o de otro hito", () => {
    const pod = { hito_id: "h1", created_at: "2026-01-01T14:00:00Z" };
    const eventos = [
      { tipo: "salida", hito_id: "h1", ocurrido_en: "2026-01-01T09:00:00Z" },
      { tipo: "llegada", hito_id: "h2", ocurrido_en: "2026-01-01T09:00:00Z" },
    ];
    const r = calcularDesfasePod(pod, eventos);
    expect(r.minutos).toBeNull();
  });
});

describe("calcularOcupacion — FTL vs. grupaje (COT.4)", () => {
  it("limitado por peso: kg decide aunque LDM/m3 vayan holgados", () => {
    const r = calcularOcupacion({ ldm: 2, kg: 20000, m3: 10 }, { ldm: 13.6, kg: 24000, m3: 90 });
    expect(r.dimensionLimitante).toBe("kg");
    expect(r.pctOcupacion).toBeCloseTo((20000 / 24000) * 100, 5);
    expect(r.tipo).toBe("grupaje");
  });

  it("limitado por volumen (m3)", () => {
    const r = calcularOcupacion({ ldm: 1, kg: 500, m3: 85 }, { ldm: 13.6, kg: 24000, m3: 90 });
    expect(r.dimensionLimitante).toBe("m3");
    expect(r.pctOcupacion).toBeCloseTo((85 / 90) * 100, 5);
  });

  it("limitado por LDM", () => {
    const r = calcularOcupacion({ ldm: 13, kg: 100, m3: 1 }, { ldm: 13.6, kg: 24000, m3: 90 });
    expect(r.dimensionLimitante).toBe("ldm");
    expect(r.pctOcupacion).toBeCloseTo((13 / 13.6) * 100, 5);
  });

  it(`frontera del umbral (${UMBRAL_FTL_PCT}%): por debajo es grupaje, por encima es completo`, () => {
    const debajo = calcularOcupacion({ kg: 20399 }, { kg: 24000 }); // 84.99%
    expect(debajo.tipo).toBe("grupaje");
    const encima = calcularOcupacion({ kg: 20400 }, { kg: 24000 }); // 85.0%
    expect(encima.tipo).toBe("completo");
  });

  it("sin capacidad conocida (vehículo sin configurar): tipo desconocido, no falla", () => {
    const r = calcularOcupacion({ ldm: 5, kg: 10000, m3: 30 }, {});
    expect(r.tipo).toBe("desconocido");
    expect(r.pctOcupacion).toBeNull();
    expect(r.dimensionLimitante).toBeNull();
  });

  it("sin carga (todo vacío): tipo desconocido", () => {
    const r = calcularOcupacion({}, { ldm: 13.6, kg: 24000, m3: 90 });
    expect(r.tipo).toBe("desconocido");
  });
});

describe("getDatosFacturacion (F13.1 — export para facturación/integración)", () => {
  const MADRID = { lat: 40.4168, lon: -3.7038 };
  const BARCELONA = { lat: 41.3851, lon: 2.1734 };

  const ahora = new Date().toISOString();

  beforeEach(() => {
    osrmMock.mockResolvedValue(300);
    TABLES.empresa = [{ id: "e1", coste_km: 1 }];
  });

  it("agrega un viaje completado con precio, coste, km y gastos por tipo", async () => {
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1", estado: "completado", precio: 1000, vehiculo_id: null, created_at: ahora, cliente: { nombre: "Acme", cif: "B1" } }];
    TABLES.hito = [{ viaje_id: "v1", orden: 1, ...MADRID }, { viaje_id: "v1", orden: 2, ...BARCELONA }];
    TABLES.gasto_viaje = [
      { viaje_id: "v1", tipo: "repostaje", importe: 100 },
      { viaje_id: "v1", tipo: "peaje", importe: 20 },
    ];

    const filas = await getDatosFacturacion({});
    expect(filas).toHaveLength(1);
    expect(filas[0].referencia).toBe("VJ-1");
    expect(filas[0].cliente).toBe("Acme");
    expect(filas[0].precio).toBe(1000);
    expect(filas[0].repostaje).toBe(100);
    expect(filas[0].peaje).toBe(20);
    expect(filas[0].margenReal).toBe(880); // 1000 - 100 - 20
  });

  it("filtra por cliente cuando se pasa clienteId", async () => {
    TABLES.viaje = [
      { id: "v1", referencia: "VJ-1", estado: "completado", cliente_id: "c1", precio: 500, created_at: ahora, cliente: { nombre: "Acme" } },
      { id: "v2", referencia: "VJ-2", estado: "completado", cliente_id: "c2", precio: 600, created_at: ahora, cliente: { nombre: "Otro" } },
    ];
    TABLES.hito = [];
    TABLES.gasto_viaje = [];

    const filas = await getDatosFacturacion({ clienteId: "c1" });
    expect(filas).toHaveLength(1);
    expect(filas[0].referencia).toBe("VJ-1");
  });

  it("sin viajes completados devuelve lista vacía, no lanza", async () => {
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1", estado: "planificado", precio: 500 }];
    TABLES.hito = [];
    TABLES.gasto_viaje = [];
    const filas = await getDatosFacturacion({});
    expect(filas).toEqual([]);
  });
});

describe("getDossierViaje (F13.2 — dossier de evidencia para reclamaciones)", () => {
  it("reúne viaje, hitos, eventos y pods sin lanzar", async () => {
    TABLES.viaje = [{ id: "v1", referencia: "VJ-1", estado: "completado", chofer: { nombre: "Mario" }, cliente: { nombre: "Acme", cif: "B1" } }];
    TABLES.hito = [{ id: "h1", viaje_id: "v1", orden: 1, tipo: "entrega", direccion: "Madrid", es_checkpoint: false }];
    TABLES.ejecucion_evento = [{ viaje_id: "v1", hito_id: "h1", tipo: "llegada", ocurrido_en: "2026-01-01T10:00:00Z", hash: "abc123" }];
    TABLES.pod = [{ viaje_id: "v1", hito_id: "h1", foto_url: "e1/v1/h1/x.jpg", hash_sha256: "deadbeef", created_at: "2026-01-01T10:05:00Z" }];

    const d = await getDossierViaje("v1");
    expect(d.viaje.referencia).toBe("VJ-1");
    expect(d.hitos).toHaveLength(1);
    expect(d.eventos).toHaveLength(1);
    expect(d.pods).toHaveLength(1);
  });

  it("viaje inexistente devuelve null", async () => {
    TABLES.viaje = [];
    const d = await getDossierViaje("no-existe");
    expect(d).toBeNull();
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

  it("creado por un gestor no-admin se auto-asigna su gestor_id (hallazgo post-F15.2)", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1", id: "g-operativo", rol: "gestor_operativo" }];
    TABLES.viaje = [];
    TABLES.chofer = [];
    TABLES.vehiculo = [];
    const { viaje } = await createViaje({ referencia: "REF1B", choferId: null, vehiculoId: null, remolqueId: null, hitos: [] });
    expect(viaje.gestor_id).toBe("g-operativo");
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

describe("createViaje persiste la carga (CARGA.2)", () => {
  it("guarda las 3 dimensiones de carga si se pasan", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.viaje = [];
    TABLES.chofer = [];
    TABLES.vehiculo = [];
    TABLES.hito = [];
    const { viaje } = await createViaje({
      referencia: "CARGA-1", choferId: null, vehiculoId: null, remolqueId: null, hitos: [],
      carga: { ldm: "13.6", kg: "24000", m3: "90" },
    });
    expect(viaje.carga_ldm).toBe(13.6);
    expect(viaje.carga_kg).toBe(24000);
    expect(viaje.carga_m3).toBe(90);
  });

  it("sin carga, las 3 columnas quedan null (retrocompatible)", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.viaje = [];
    TABLES.chofer = [];
    TABLES.vehiculo = [];
    TABLES.hito = [];
    const { viaje } = await createViaje({ referencia: "CARGA-2", choferId: null, vehiculoId: null, remolqueId: null, hitos: [] });
    expect(viaje.carga_ldm).toBeNull();
    expect(viaje.carga_kg).toBeNull();
    expect(viaje.carga_m3).toBeNull();
  });
});

describe("createViaje persiste es_checkpoint/radio_m (CHK.2)", () => {
  it("guarda es_checkpoint=true y radio_m tal cual", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.viaje = [];
    TABLES.chofer = [];
    TABLES.vehiculo = [];
    TABLES.hito = [];
    await createViaje({
      referencia: "CHK-1", choferId: null, vehiculoId: null, remolqueId: null,
      hitos: [{ tipo: "recogida", direccion: "Aduana Irún", es_checkpoint: true, radio_m: "150" }],
    });
    expect(TABLES.hito).toHaveLength(1);
    expect(TABLES.hito[0].es_checkpoint).toBe(true);
    expect(TABLES.hito[0].radio_m).toBe(150);
  });

  it("hito sin esos campos guarda false/null (retrocompatible)", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.viaje = [];
    TABLES.chofer = [];
    TABLES.vehiculo = [];
    TABLES.hito = [];
    await createViaje({
      referencia: "CHK-2", choferId: null, vehiculoId: null, remolqueId: null,
      hitos: [{ tipo: "entrega", direccion: "Almacén" }],
    });
    expect(TABLES.hito[0].es_checkpoint).toBe(false);
    expect(TABLES.hito[0].radio_m).toBeNull();
  });
});

describe("createViaje acepta clienteId (11.1b — no sustituye a referencia)", () => {
  it("guarda cliente_id sin dejar de guardar referencia", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.viaje = [];
    TABLES.chofer = [];
    TABLES.vehiculo = [];
    const { viaje } = await createViaje({
      referencia: "ALB-99", choferId: null, vehiculoId: null, remolqueId: null, hitos: [], clienteId: "c1",
    });
    expect(viaje.cliente_id).toBe("c1");
    expect(viaje.referencia).toBe("ALB-99");
  });

  it("sin clienteId, se guarda null (no rompe el alta existente)", async () => {
    SESSION = { user: { id: "u1" } };
    TABLES.gestor = [{ auth_user_id: "u1", empresa_id: "e1" }];
    TABLES.viaje = [];
    TABLES.chofer = [];
    TABLES.vehiculo = [];
    const { viaje } = await createViaje({ referencia: "REF3", choferId: null, vehiculoId: null, remolqueId: null, hitos: [] });
    expect(viaje.cliente_id).toBeNull();
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

describe("derechos ARCO (9.15)", () => {
  beforeEach(() => {
    TABLES.chofer = [{ id: "c1", nombre: "Mario", telefono: "600111222", idioma: "es", chat_id: "chat-1" }];
    TABLES.viaje = [{ id: "v1", chofer_id: "c1", referencia: "VJ-1", estado: "completado", created_at: "2026-01-01" }];
    TABLES.ubicacion = [{ chofer_id: "c1", lat: 40.1, lon: -3.1, created_at: "2026-01-01" }];
    TABLES.valoracion = [{ chofer_id: "c1", puntuacion: 5, nota: "bien", created_at: "2026-01-01", viaje_id: "v1" }];
    TABLES.documento = [
      { id: "d1", ambito: "chofer", entidad_id: "c1", tipo: "licencia", estado: "vigente", created_at: "2026-01-01" },
      { id: "d2", ambito: "viaje", entidad_id: "v1", tipo: "cmr", estado: "vigente", created_at: "2026-01-01" },
    ];
    TABLES.decision_asignacion = [
      { viaje_id: "v1", chofer_sugerido_id: "c1", chofer_elegido_id: "c1", siguio_sugerencia: true, created_at: "2026-01-01" },
      { viaje_id: "v2", chofer_sugerido_id: "otro", chofer_elegido_id: "otro", siguio_sugerencia: true, created_at: "2026-01-01" },
    ];
  });

  it("getExportacionChofer recopila todas las tablas ligadas al chófer", async () => {
    const r = await getExportacionChofer("c1");
    expect(r.chofer.nombre).toBe("Mario");
    expect(r.viajes).toHaveLength(1);
    expect(r.ubicaciones).toHaveLength(1);
    expect(r.valoraciones).toHaveLength(1);
    expect(r.documentos).toHaveLength(1); // solo el de ámbito chofer, no el de viaje
    expect(r.decisiones).toHaveLength(1); // solo donde aparece c1, no "otro"
  });

  it("anonimizarChofer borra el documento del chófer pero no el de otro ámbito", async () => {
    await anonimizarChofer("c1");
    const restantes = TABLES.documento.map((d) => d.id);
    expect(restantes).not.toContain("d1");
    expect(restantes).toContain("d2");
  });

  it("anonimizarChofer anonimiza nombre/telefono pero NO toca chat_id", async () => {
    await anonimizarChofer("c1");
    const c = TABLES.chofer[0];
    expect(c.nombre).toBe("Chófer eliminado a petición propia");
    expect(c.telefono).toBeNull();
    expect(c.chat_id).toBe("chat-1"); // 0019: el dashboard no puede tocar chat_id, no se intenta
  });

  it("anonimizarChofer NO toca ubicacion ni ejecucion_evento (tensión de 9.6-9.8, ver PRIVACIDAD-ARCO.md)", async () => {
    TABLES.ejecucion_evento = [{ chofer_id: "c1", tipo: "llegada", hash: "abc" }];
    await anonimizarChofer("c1");
    expect(TABLES.ubicacion).toHaveLength(1);
    expect(TABLES.ejecucion_evento).toHaveLength(1);
    expect(TABLES.ejecucion_evento[0].chofer_id).toBe("c1");
  });
});

describe("9.35 — las funciones financieras LANZAN ante un fallo real de lectura (no lo tragan como \"sin datos\")", () => {
  const MADRID = { lat: 40.4168, lon: -3.7038 };
  const BARCELONA = { lat: 41.3851, lon: 2.1734 };

  beforeEach(() => {
    TABLES.viaje = [{ id: "v1", precio: 1000, vehiculo_id: null, estado: "completado", created_at: "2026-03-01T00:00:00Z" }];
    TABLES.hito = [{ orden: 1, ...MADRID, viaje_id: "v1" }, { orden: 2, ...BARCELONA, viaje_id: "v1" }];
    TABLES.empresa = [{ coste_km: 1, velocidad_planificacion_kmh: 75 }];
    TABLES.gasto_viaje = [];
    TABLES.chofer = [{ id: "c1", nombre: "Mario", idioma: "es" }];
    TABLES.ejecucion_evento = [];
  });

  it("getViabilidadViaje lanza si falla la query de hito (crítica)", async () => {
    SELECT_ERRORS.hito = { message: "conexión perdida" };
    await expect(getViabilidadViaje("v1")).rejects.toThrow("conexión perdida");
  });

  it("getViabilidadViaje NO lanza si el viaje simplemente no existe (PGRST116, caso legítimo)", async () => {
    const r = await getViabilidadViaje("no-existe");
    expect(r).toBeNull();
  });

  it("getInformeNomina lanza si falla la query de viaje (crítica)", async () => {
    SELECT_ERRORS.viaje = { message: "fallo real" };
    await expect(getInformeNomina(3, 2026)).rejects.toThrow("fallo real");
  });

  it("getEstado561 lanza si falla la query de ejecucion_evento (crítica)", async () => {
    SELECT_ERRORS.ejecucion_evento = { message: "fallo de red" };
    await expect(getEstado561("c1")).rejects.toThrow("fallo de red");
  });

  it("getEstado561 NO lanza si legítimamente no hay llegadas (array vacío)", async () => {
    const r = await getEstado561("c1");
    expect(r).not.toBeNull();
  });

  it("calcularPresupuesto lanza si falla la query de empresa (crítica)", async () => {
    SELECT_ERRORS.empresa = { message: "fallo real" };
    await expect(calcularPresupuesto({ puntos: [MADRID, BARCELONA] })).rejects.toThrow("fallo real");
  });

  it("sugerirChofer lanza si falla la query de chofer (crítica)", async () => {
    SELECT_ERRORS.chofer = { message: "fallo real" };
    await expect(sugerirChofer(null, { hitosOverride: [{ orden: 1, ...MADRID }] })).rejects.toThrow("fallo real");
  });

  it("getMetricasRentabilidad lanza si falla la query de viaje (crítica)", async () => {
    SELECT_ERRORS.viaje = { message: "fallo real" };
    await expect(getMetricasRentabilidad()).rejects.toThrow("fallo real");
  });
});
