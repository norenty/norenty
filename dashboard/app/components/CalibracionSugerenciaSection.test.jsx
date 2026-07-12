import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Ítem 10.9b — smoke tests de renderizado (mismo patrón que
// AjustesSecciones.test.jsx/ArcoChoferSection.test.jsx). La lógica de
// getSugerenciaCalibracion ya está cubierta en data.test.js (Grupo A).
vi.mock("./RequireRol", () => ({
  default: ({ children }) => children,
}));

const dataMock = vi.hoisted(() => ({ getSugerenciaCalibracion: vi.fn() }));
vi.mock("../../lib/data", () => dataMock);

const { default: CalibracionSugerenciaSection } = await import("./CalibracionSugerenciaSection.jsx");

// Nota: renderToStaticMarkup no espera efectos async (useEffect no corre en
// SSR), así que estos tests verifican el estado "loading" (null) -- el
// comportamiento tras cargar ya lo prueba data.test.js. Se deja documentado
// aquí por qué no se afirma más que esto sin @testing-library.
describe("CalibracionSugerenciaSection", () => {
  it("no revienta al renderizar en su estado inicial (loading)", () => {
    dataMock.getSugerenciaCalibracion.mockResolvedValue({ suficiente: false, numViajesConDatos: 0, minimoViajes: 20 });
    const html = renderToStaticMarkup(<CalibracionSugerenciaSection />);
    expect(html).toBe(""); // loading=true -> no renderiza nada todavía
  });
});
