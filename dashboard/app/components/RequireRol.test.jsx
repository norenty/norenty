import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Grupo A (SPECS-9-ROLES.md §6.1) — lógica pura de RequireRol, con mock de
// useRol (no toca Supabase ni RLS; eso lo cubre el Grupo B contra BD real).
const useRolMock = vi.fn();
vi.mock("./RolProvider", () => ({
  useRol: () => useRolMock(),
}));

const { default: RequireRol } = await import("./RequireRol.jsx");

describe("RequireRol (9.29 — gateo de UI por rol)", () => {
  it("(A1) renderiza children si el rol del gestor está en `roles`", () => {
    useRolMock.mockReturnValue({ rol: "admin", cargando: false });
    const html = renderToStaticMarkup(
      <RequireRol roles={["admin"]}><span>Solo admin</span></RequireRol>
    );
    expect(html).toContain("Solo admin");
  });

  it("(A2) NO renderiza children si el rol no está en `roles` (usa fallback si se da)", () => {
    useRolMock.mockReturnValue({ rol: "solo_lectura", cargando: false });
    const html = renderToStaticMarkup(
      <RequireRol roles={["admin"]} fallback={<span>Oculto</span>}><span>Solo admin</span></RequireRol>
    );
    expect(html).not.toContain("Solo admin");
    expect(html).toContain("Oculto");
  });

  it("(A3) no renderiza nada mientras `cargando=true` (evita parpadeo)", () => {
    useRolMock.mockReturnValue({ rol: null, cargando: true });
    const html = renderToStaticMarkup(
      <RequireRol roles={["admin"]} fallback={<span>Fallback</span>}><span>Contenido</span></RequireRol>
    );
    expect(html).toBe("");
  });

  it("azúcar `rol=` equivale a `roles={[rol]}`", () => {
    useRolMock.mockReturnValue({ rol: "gestor_operativo", cargando: false });
    const html = renderToStaticMarkup(
      <RequireRol rol="gestor_operativo"><span>Operativo</span></RequireRol>
    );
    expect(html).toContain("Operativo");
  });
});
