import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock deliberadamente simple, centrado en un solo bug real (2026-07-02):
// signUp() hacía `.from("empresa").insert(...).select("id").single()`, lo cual
// pide RETURNING. La policy SELECT de `empresa` es `id = current_empresa_id()`,
// y en el momento del alta el usuario NO tiene fila en `gestor` todavía, así que
// `current_empresa_id()` es NULL y Postgres rechaza el RETURNING con "new row
// violates row-level security policy" — el INSERT en sí era válido, pero pedir
// la fila de vuelta no. Detectado al probar contra RLS real (ítem 6.2), no por
// estos tests — un mock en memoria no reproduce RLS. Este test es una guarda de
// regresión: fija la FORMA correcta de la llamada (id generado en cliente, sin
// `.select()` en el insert de empresa) para que el bug no pueda volver sin que
// un test rompa.

const insertEmpresaSpy = vi.fn();
const insertGestorSpy = vi.fn();
const rpcSpy = vi.fn();
const signOutSpy = vi.fn(async () => ({ error: null }));
let existingGestor = null;
let signUpUser = { id: "user-1" };
let rpcResultado = { data: null, error: null };

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      signUp: vi.fn(async () => ({ data: { user: signUpUser }, error: null })),
      signOut: signOutSpy,
    },
    rpc: (fn, args) => {
      rpcSpy(fn, args);
      return Promise.resolve(rpcResultado);
    },
    from: (table) => {
      if (table === "gestor") {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                single: () => Promise.resolve(
                  existingGestor
                    ? { data: existingGestor, error: null }
                    : { data: null, error: { message: "no rows" } }
                ),
              }),
            }),
          }),
          insert: (obj) => {
            insertGestorSpy(obj);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === "empresa") {
        return {
          insert: (obj) => {
            insertEmpresaSpy(obj);
            // Deliberadamente NO expone `.select()` en la promesa devuelta: si el
            // código de producción encadenara `.select().single()` aquí, este
            // mock lanzaría un TypeError inmediato — igual que RLS real rompería
            // la llamada, pero cazado en el momento en que se escribe el test,
            // no al desplegar contra una BD real.
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`tabla no mockeada: ${table}`);
    },
  },
}));

const { signUp, signOut, signOutTodasLasSesiones } = await import("./auth.js");

beforeEach(() => {
  insertEmpresaSpy.mockClear();
  insertGestorSpy.mockClear();
  rpcSpy.mockClear();
  signOutSpy.mockClear();
  existingGestor = null;
  signUpUser = { id: "user-1" };
  rpcResultado = { data: null, error: null };
});

describe("signUp (regresión: alta de empresa nueva sin pedir RETURNING)", () => {
  it("inserta la empresa con un id generado en el cliente, sin encadenar .select()", async () => {
    await signUp("nueva@empresa.com", "password123", "Mi Empresa Nueva");

    expect(insertEmpresaSpy).toHaveBeenCalledTimes(1);
    const payload = insertEmpresaSpy.mock.calls[0][0];
    expect(payload.nombre).toBe("Mi Empresa Nueva");
    expect(typeof payload.id).toBe("string");
    expect(payload.id.length).toBeGreaterThan(10); // UUID generado en cliente
  });

  it("vincula el gestor nuevo al MISMO id de empresa generado (no depende de RETURNING)", async () => {
    await signUp("nueva@empresa.com", "password123", "Mi Empresa Nueva");

    const empresaId = insertEmpresaSpy.mock.calls[0][0].id;
    expect(insertGestorSpy).toHaveBeenCalledTimes(1);
    const gestorPayload = insertGestorSpy.mock.calls[0][0];
    expect(gestorPayload.empresa_id).toBe(empresaId);
    expect(gestorPayload.auth_user_id).toBe("user-1");
  });

  it("NO crea empresa/gestor si el usuario ya tiene una vinculada", async () => {
    existingGestor = { id: "g1" };
    await signUp("existente@empresa.com", "password123", "Otra Empresa");

    expect(insertEmpresaSpy).not.toHaveBeenCalled();
    expect(insertGestorSpy).not.toHaveBeenCalled();
  });

  it("lanza si no se indica nombre de empresa", async () => {
    await expect(signUp("a@b.com", "password123", "")).rejects.toThrow(/nombre de tu empresa/);
    expect(insertEmpresaSpy).not.toHaveBeenCalled();
  });
});

describe("signUp con invitacionCodigo (ítem 6.9 — unirse a empresa existente)", () => {
  it("NO exige nombre de empresa si hay código de invitación", async () => {
    rpcResultado = { data: "empresa-invitada-1", error: null };
    await expect(signUp("nuevo@empresa.com", "password123", "", "codigo-123")).resolves.toBeDefined();
  });

  it("canjea la invitación vía RPC y NO crea una empresa nueva", async () => {
    rpcResultado = { data: "empresa-invitada-1", error: null };
    await signUp("nuevo@empresa.com", "password123", "", "codigo-123");

    expect(rpcSpy).toHaveBeenCalledWith("usar_invitacion", { p_codigo: "codigo-123" });
    expect(insertEmpresaSpy).not.toHaveBeenCalled();
  });

  it("vincula el gestor a la empresa devuelta por la invitación", async () => {
    rpcResultado = { data: "empresa-invitada-1", error: null };
    await signUp("nuevo@empresa.com", "password123", "", "codigo-123");

    expect(insertGestorSpy).toHaveBeenCalledTimes(1);
    expect(insertGestorSpy.mock.calls[0][0].empresa_id).toBe("empresa-invitada-1");
  });

  it("lanza un error claro si la invitación no es válida o ya se usó (RPC devuelve null)", async () => {
    rpcResultado = { data: null, error: null };
    await expect(
      signUp("nuevo@empresa.com", "password123", "", "codigo-invalido")
    ).rejects.toThrow(/no es válida o ya ha sido usada/);
    expect(insertGestorSpy).not.toHaveBeenCalled();
  });
});

describe("signOut — scope explícito (ítem 9.10)", () => {
  it("signOut() normal usa scope local (NO cierra otros dispositivos)", async () => {
    await signOut();
    expect(signOutSpy).toHaveBeenCalledWith({ scope: "local" });
  });

  it("signOutTodasLasSesiones() usa scope global explícito", async () => {
    await signOutTodasLasSesiones();
    expect(signOutSpy).toHaveBeenCalledWith({ scope: "global" });
  });

  it("signOutTodasLasSesiones() lanza si Supabase devuelve error", async () => {
    signOutSpy.mockResolvedValueOnce({ error: { message: "fallo de red" } });
    await expect(signOutTodasLasSesiones()).rejects.toThrow(/fallo de red/);
  });
});
