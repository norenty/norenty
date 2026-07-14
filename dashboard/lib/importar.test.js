import { describe, it, expect } from "vitest";
import { autoMapColumns, ALIAS_VIAJE } from "./importar";

describe("autoMapColumns (IMP.1 — genérica por tipo de entidad)", () => {
  it("mapea columnas de viaje reales con ALIAS_VIAJE", () => {
    const cols = ["Referencia", "Origen", "Destino", "Chófer", "Matrícula"];
    const mapping = autoMapColumns(cols, ALIAS_VIAJE);
    expect(mapping.referencia).toBe("Referencia");
    expect(mapping.origen_direccion).toBe("Origen");
    expect(mapping.destino_direccion).toBe("Destino");
    expect(mapping.chofer_nombre).toBe("Chófer");
    expect(mapping.vehiculo_matricula).toBe("Matrícula");
  });

  it("con aliases custom mapea según ese juego, no el de viaje", () => {
    const cols = ["Nombre completo", "Idioma"];
    const aliasChofer = { nombre: ["nombre"], idioma: ["idioma"] };
    const mapping = autoMapColumns(cols, aliasChofer);
    expect(mapping.nombre).toBe("Nombre completo");
    expect(mapping.idioma).toBe("Idioma");
    expect(mapping.referencia).toBeUndefined();
  });

  it("sin aliases (undefined o vacío) no mapea nada, no lanza", () => {
    expect(autoMapColumns(["Referencia"], {})).toEqual({});
    expect(autoMapColumns(["Referencia"], undefined)).toEqual({});
  });

  it("con columnas vacías no lanza y no mapea nada", () => {
    expect(autoMapColumns([], ALIAS_VIAJE)).toEqual({});
  });

  it("no sobrescribe un campo ya mapeado por una columna anterior", () => {
    const cols = ["Referencia", "Ref"];
    const mapping = autoMapColumns(cols, ALIAS_VIAJE);
    expect(mapping.referencia).toBe("Referencia");
  });
});
