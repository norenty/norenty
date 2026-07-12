import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Ítem 9.41b — smoke test de renderizado (mismo patrón que AjustesSecciones.test.jsx).
// No prueba la interacción real (exportar/anonimizar); eso lo cubren los tests de
// getExportacionChofer/anonimizarChofer en data.test.js (9.15), ya existentes.
vi.mock("./RequireRol", () => ({
  default: ({ children }) => children,
}));
vi.mock("../../lib/supabase", () => ({ supabase: { from: () => ({}) } }));

const { default: ArcoChoferSection } = await import("./ArcoChoferSection.jsx");

describe("ArcoChoferSection", () => {
  it("renderiza los botones de exportar y anonimizar", () => {
    const html = renderToStaticMarkup(
      <ArcoChoferSection choferId="c1" choferNombre="Mario" onAnonimizado={() => {}} />
    );
    expect(html).toContain("Derechos ARCO");
    expect(html).toContain("Exportar datos");
    expect(html).toContain("Anonimizar");
  });
});
