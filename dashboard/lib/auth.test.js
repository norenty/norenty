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
let existingGestor = null;
let signUpUser = { id: "user-1" };

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      signUp: vi.fn(async () => ({ data: { user: signUpUser }, error: null })),
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

const { signUp } = await import("./auth.js");

beforeEach(() => {
  insertEmpresaSpy.mockClear();
  insertGestorSpy.mockClear();
  existingGestor = null;
  signUpUser = { id: "user-1" };
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
