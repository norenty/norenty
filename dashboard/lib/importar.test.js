import { describe, it, expect } from "vitest";
import { autoMapColumns, ALIAS_VIAJE, ALIAS_CHOFER, ALIAS_VEHICULO, CAMPOS_CHOFER, CAMPOS_VEHICULO } from "./importar";

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

describe("CAMPOS/ALIAS de chófer y vehículo (IMP.2 — importación masiva)", () => {
  it("mapea columnas de chófer reales", () => {
    const cols = ["Nombre del conductor", "Idioma"];
    const mapping = autoMapColumns(cols, ALIAS_CHOFER);
    expect(mapping.nombre).toBe("Nombre del conductor");
    expect(mapping.idioma).toBe("Idioma");
  });

  it("mapea columnas de vehículo reales", () => {
    const cols = ["Matrícula", "Tipo", "Marca", "Modelo"];
    const mapping = autoMapColumns(cols, ALIAS_VEHICULO);
    expect(mapping.matricula).toBe("Matrícula");
    expect(mapping.tipo).toBe("Tipo");
    expect(mapping.marca).toBe("Marca");
    expect(mapping.modelo).toBe("Modelo");
  });

  it("CAMPOS_CHOFER solo exige nombre como obligatorio", () => {
    expect(CAMPOS_CHOFER.find((c) => c.key === "nombre").required).toBe(true);
    expect(CAMPOS_CHOFER.find((c) => c.key === "idioma").required).toBeFalsy();
  });

  it("CAMPOS_VEHICULO solo exige matrícula como obligatoria", () => {
    expect(CAMPOS_VEHICULO.find((c) => c.key === "matricula").required).toBe(true);
    expect(CAMPOS_VEHICULO.find((c) => c.key === "tipo").required).toBeFalsy();
  });
});
