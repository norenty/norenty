import { describe, it, expect } from "vitest";
import { normalizar, matchComandos } from "./comandos";

const RESUMEN = {
  docsPorCaducar: 3,
  incidencias: { count: 1, masAntiguaDias: 2 },
  viajesEnRiesgo: { count: 0, refs: [] },
  choferes561: { count: 2, nombres: ["Ana", "Luis"] },
  viajesPerdidas: { count: 1 },
  todoEnOrden: false,
};

describe("normalizar", () => {
  it("quita acentos y pasa a minúsculas", () => {
    expect(normalizar("Límite")).toBe("limite");
    expect(normalizar("PÉRDIDAS")).toBe("perdidas");
    expect(normalizar("Cháfer")).toBe("chafer");
  });
});

describe("matchComandos (6.12 extendido — command palette sin IA)", () => {
  it("sin query (< 2 caracteres) no devuelve nada", () => {
    expect(matchComandos("d", RESUMEN)).toEqual([]);
    expect(matchComandos("", RESUMEN)).toEqual([]);
  });

  it("sin resumen todavía cargado no devuelve nada", () => {
    expect(matchComandos("documentos", null)).toEqual([]);
  });

  it("'documentos' mapea a docs_caducar con el conteo real", () => {
    const r = matchComandos("documentos", RESUMEN);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "docs_caducar", href: "/documentos", label: "3 documentos por caducar" });
  });

  it("singular cuando el conteo es 1", () => {
    const r = matchComandos("documentos", { ...RESUMEN, docsPorCaducar: 1 });
    expect(r[0].label).toBe("1 documento por caducar");
  });

  it("'561' mapea a choferes_561", () => {
    const r = matchComandos("561", RESUMEN);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "choferes_561", href: "/choferes", label: "2 chóferes cerca del límite 561" });
  });

  it("es insensible a acentos y mayúsculas (query acentuada, keyword sin acento)", () => {
    const r = matchComandos("Límite", RESUMEN);
    expect(r.map((x) => x.id)).toContain("choferes_561");
  });

  it("'perdidas' mapea a viajes_perdidas", () => {
    const r = matchComandos("perdidas", RESUMEN);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "viajes_perdidas", href: "/viajes", label: "1 viaje a pérdidas (est.)" });
  });

  it("'riesgo' mapea solo a viajes_riesgo, no a otros comandos", () => {
    const r = matchComandos("riesgo", RESUMEN);
    expect(r.map((x) => x.id)).toEqual(["viajes_riesgo"]);
    expect(r[0].label).toBe("0 viajes en riesgo");
  });

  it("'incidencias' mapea a incidencias_abiertas con plural/singular correcto", () => {
    const r = matchComandos("incidencias", RESUMEN);
    expect(r[0].label).toBe("1 incidencia abierta");
  });

  it("query sin ningún match devuelve lista vacía", () => {
    expect(matchComandos("xyzxyz", RESUMEN)).toEqual([]);
  });
});
