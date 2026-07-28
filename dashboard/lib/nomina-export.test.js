import { describe, it, expect } from "vitest";
import { filasNominaACsv } from "./nomina-export";

function filaBase(overrides = {}) {
  return {
    nombre: "Mario",
    nochesFuera: 2,
    km: 500,
    estimado: false,
    diasInternacional: 1,
    finDeSemana: { diasCompletos: 1, diasMedios: 0 },
    viajesAdr: 0,
    cargaDescargaChofer: 0,
    retenes: 0,
    viajes: ["VJ-1", "VJ-2"],
    ...overrides,
  };
}

describe("filasNominaACsv (Fase 23, 23.B.5)", () => {
  it("incluye todos los conceptos de la Fase 23 en la cabecera", () => {
    const csv = filasNominaACsv([filaBase()]);
    const cabecera = csv.split("\n")[0];
    expect(cabecera).toContain("Días internacional");
    expect(cabecera).toContain("Fines de semana completos");
    expect(cabecera).toContain("Fines de semana medios");
    expect(cabecera).toContain("Viajes ADR");
    expect(cabecera).toContain("Cargas/descargas por el chófer");
    expect(cabecera).toContain("Retenes");
  });

  it("una fila real contiene los valores de todos los conceptos nuevos", () => {
    const csv = filasNominaACsv([filaBase({ diasInternacional: 3, viajesAdr: 2, retenes: 1 })]);
    const fila = csv.split("\n")[1];
    expect(fila).toContain('"3"');
    expect(fila).toContain('"2"');
    expect(fila).toContain('"1"');
  });

  it("no trunca en silencio: procesa más de 1000 filas (hallazgo Fase 19)", () => {
    const muchasFilas = Array.from({ length: 1500 }, (_, i) => filaBase({ nombre: `Chofer ${i}` }));
    const csv = filasNominaACsv(muchasFilas);
    expect(csv.trim().split("\n")).toHaveLength(1501); // +1 por la cabecera
    expect(csv).toContain("Chofer 0");
    expect(csv).toContain("Chofer 1499");
  });

  it("nochesFuera null se exporta como 'n/d', no como texto vacío ni error", () => {
    const csv = filasNominaACsv([filaBase({ nochesFuera: null })]);
    expect(csv).toContain('"n/d"');
  });

  it("finDeSemana ausente no rompe la exportación (defaults a 0)", () => {
    const csv = filasNominaACsv([filaBase({ finDeSemana: undefined })]);
    const fila = csv.split("\n")[1];
    expect(fila).toBeTruthy();
  });
});
