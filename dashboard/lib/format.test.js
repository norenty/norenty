import { describe, it, expect } from "vitest";
import { fmtEur, fmtKm, fmtFecha, badgeCaducidad, badgeMargen, resolverFechaRelativa } from "./format.js";

describe("fmtEur / fmtKm", () => {
  it("formatea euros con el sufijo correcto", () => {
    expect(fmtEur(1234.5)).toBe(`${(1234.5).toLocaleString("es-ES")} €`);
  });

  it("formatea km con el sufijo correcto", () => {
    expect(fmtKm(1234)).toBe(`${(1234).toLocaleString("es-ES")} km`);
  });

  it("devuelven null si el valor es null", () => {
    expect(fmtEur(null)).toBeNull();
    expect(fmtKm(null)).toBeNull();
  });
});

describe("fmtFecha", () => {
  it("formatea una fecha date-only sin desfase de zona horaria", () => {
    const r = fmtFecha("2026-01-04");
    expect(r).toContain("2026");
    expect(r).toContain("04");
  });

  it("devuelve null si no hay fecha", () => {
    expect(fmtFecha(null)).toBeNull();
    expect(fmtFecha("")).toBeNull();
  });
});

describe("badgeCaducidad", () => {
  it("caducado: fecha ya pasada", () => {
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const r = badgeCaducidad(ayer);
    expect(r.label).toBe("Caducado");
    expect(r.dias).toBeLessThan(0);
  });

  it("caduca pronto: dentro de 30 días", () => {
    const en15dias = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
    const r = badgeCaducidad(en15dias);
    expect(r.label).toBe("Caduca pronto");
  });

  it("vigente: más de 30 días, con contraste AA (green-700, no estado-ok)", () => {
    const en60dias = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const r = badgeCaducidad(en60dias);
    expect(r.label).toBe("Vigente");
    expect(r.cls).toContain("text-green-700");
  });

  it("devuelve null si no hay fecha de caducidad", () => {
    expect(badgeCaducidad(null)).toBeNull();
  });
});

describe("badgeMargen", () => {
  it("margen negativo siempre es rojo, sin importar el pct", () => {
    expect(badgeMargen(-100, 50, 10)).toBe("bg-red-50 text-estado-incidencia");
  });

  it("margen positivo pero por debajo del umbral ámbar es ámbar", () => {
    expect(badgeMargen(50, 5, 10)).toBe("bg-yellow-50 text-yellow-700");
  });

  it("margen sano por encima del umbral es verde", () => {
    expect(badgeMargen(500, 30, 10)).toBe("bg-green-50 text-green-700");
  });
});

describe("resolverFechaRelativa (Fase 23, 23.D.5)", () => {
  const HOY = new Date("2026-07-29T15:00:00Z");

  it("'.' resuelve a hoy", () => {
    expect(resolverFechaRelativa(".", HOY)).toBe("2026-07-29");
  });

  it("'+1' resuelve a mañana", () => {
    expect(resolverFechaRelativa("+1", HOY)).toBe("2026-07-30");
  });

  it("'+2' resuelve a pasado mañana", () => {
    expect(resolverFechaRelativa("+2", HOY)).toBe("2026-07-31");
  });

  it("'-1' resuelve a ayer", () => {
    expect(resolverFechaRelativa("-1", HOY)).toBe("2026-07-28");
  });

  it("'+' sin número por defecto es +1 día", () => {
    expect(resolverFechaRelativa("+", HOY)).toBe("2026-07-30");
  });

  it("'-' sin número por defecto es -1 día", () => {
    expect(resolverFechaRelativa("-", HOY)).toBe("2026-07-28");
  });

  it("resuelve correctamente cruzando el fin de mes", () => {
    const finDeMes = new Date("2026-07-31T15:00:00Z");
    expect(resolverFechaRelativa("+1", finDeMes)).toBe("2026-08-01");
  });

  it("texto que no matchea el patrón devuelve null (no confundir con 'hoy')", () => {
    expect(resolverFechaRelativa("mañana", HOY)).toBeNull();
    expect(resolverFechaRelativa("2026-08-01", HOY)).toBeNull();
    expect(resolverFechaRelativa("", HOY)).toBeNull();
  });

  it("valores no-string nunca lanzan, devuelven null", () => {
    expect(resolverFechaRelativa(null, HOY)).toBeNull();
    expect(resolverFechaRelativa(undefined, HOY)).toBeNull();
    expect(resolverFechaRelativa(5, HOY)).toBeNull();
  });
});
