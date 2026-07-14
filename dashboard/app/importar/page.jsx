"use client";

import { useState } from "react";
import { Upload, FileSpreadsheet, Check, AlertCircle, ArrowRight, ArrowLeft, Truck, Users, Route } from "lucide-react";
import Link from "next/link";
import {
  parseFile, autoMapColumns,
  CAMPOS_VIAJE, ALIAS_VIAJE, CAMPOS_CHOFER, ALIAS_CHOFER, CAMPOS_VEHICULO, ALIAS_VEHICULO,
} from "../../lib/importar";
import { supabase } from "../../lib/supabase";
import { getCurrentEmpresaId, getChoferes, createChofer, createVehiculo } from "../../lib/data";

// IMP.3: el importador cubre 3 tipos de entidad. El orden de dependencia
// (chóferes/vehículos antes que viajes) se comunica en el paso de selección,
// no se fuerza — algunos usuarios ya tienen chóferes/vehículos dados de alta.
const TIPOS_IMPORT = {
  choferes: {
    label: "Chóferes", labelPlural: "chóferes", icon: Users,
    descripcion: "Sube un CSV/Excel con el nombre (y opcionalmente el idioma) de cada chófer.",
    campos: CAMPOS_CHOFER, alias: ALIAS_CHOFER,
  },
  vehiculos: {
    label: "Vehículos", labelPlural: "vehículos", icon: Truck,
    descripcion: "Sube un CSV/Excel con la matrícula (y opcionalmente tipo/marca/modelo) de cada vehículo.",
    campos: CAMPOS_VEHICULO, alias: ALIAS_VEHICULO,
  },
  viajes: {
    label: "Viajes", labelPlural: "viajes", icon: Route,
    descripcion: "Sube un Excel (.xlsx) o CSV exportado desde tu TMS. Los chóferes/vehículos referenciados deben existir ya.",
    campos: CAMPOS_VIAJE, alias: ALIAS_VIAJE,
  },
};

const PASOS = ["Tipo", "Subir archivo", "Mapear columnas", "Vista previa", "Resultado"];

export default function ImportarPage() {
  const [paso, setPaso] = useState(0);
  const [tipo, setTipo] = useState(null);
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [mapping, setMapping] = useState({});
  const [resultado, setResultado] = useState(null);
  const [loading, setLoading] = useState(false);

  const config = tipo ? TIPOS_IMPORT[tipo] : null;

  function elegirTipo(t) {
    setTipo(t);
    setPaso(1);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const data = await parseFile(file);
      if (!data.length) throw new Error("El archivo está vacío");
      const cols = Object.keys(data[0]);
      setRows(data);
      setColumns(cols);
      setMapping(autoMapColumns(cols, config.alias));
      setPaso(2);
    } catch (err) {
      alert(err.message);
    }
    setLoading(false);
  }

  function updateMapping(campo, col) {
    setMapping((m) => ({ ...m, [campo]: col || undefined }));
  }

  function getMappedRows() {
    return rows.map((row) => {
      const mapped = {};
      for (const { key } of config.campos) {
        mapped[key] = mapping[key] ? (row[mapping[key]] ?? "").toString().trim() : "";
      }
      return mapped;
    });
  }

  async function ejecutarImportChoferes(mapped) {
    let ok = 0;
    const errores = [];
    for (let i = 0; i < mapped.length; i++) {
      const r = mapped[i];
      try {
        if (!r.nombre) throw new Error("falta el nombre");
        await createChofer({ nombre: r.nombre, idioma: r.idioma || undefined });
        ok++;
      } catch (err) {
        errores.push({ fila: i + 1, ref: r.nombre, error: err.message || "Error desconocido" });
      }
    }
    return { ok, errores };
  }

  async function ejecutarImportVehiculos(mapped) {
    let ok = 0;
    const errores = [];
    for (let i = 0; i < mapped.length; i++) {
      const r = mapped[i];
      try {
        await createVehiculo({ matricula: r.matricula, tipo: r.tipo || undefined, marca: r.marca, modelo: r.modelo });
        ok++;
      } catch (err) {
        errores.push({ fila: i + 1, ref: r.matricula, error: err.message || "Error desconocido" });
      }
    }
    return { ok, errores };
  }

  async function ejecutarImportViajes(mapped) {
    const empresa_id = await getCurrentEmpresaId();
    const choferes = await getChoferes();
    const choferMap = {};
    choferes.forEach((c) => {
      choferMap[c.nombre.toLowerCase()] = c.id;
    });

    const { data: allVehiculos } = await supabase
      .from("vehiculo")
      .select("id, matricula, tipo")
      .eq("activo", true);
    const vehMap = {};
    (allVehiculos || []).forEach((v) => {
      vehMap[v.matricula.toUpperCase()] = v;
    });

    let ok = 0;
    const errores = [];

    for (let i = 0; i < mapped.length; i++) {
      const r = mapped[i];
      try {
        let chofer_id = null;
        if (r.chofer_nombre) {
          chofer_id = choferMap[r.chofer_nombre.toLowerCase()] || null;
        }

        let vehiculo_id = null;
        if (r.vehiculo_matricula) {
          const v = vehMap[r.vehiculo_matricula.toUpperCase()];
          vehiculo_id = v?.id || null;
        }

        let remolque_id = null;
        if (r.remolque_matricula) {
          const v = vehMap[r.remolque_matricula.toUpperCase()];
          remolque_id = v?.id || null;
        }

        const { data: viaje, error } = await supabase
          .from("viaje")
          .insert({
            referencia: r.referencia || `IMP-${i + 1}`,
            chofer_id,
            vehiculo_id,
            remolque_id,
            empresa_id,
            estado: "planificado",
          })
          .select("id")
          .single();
        if (error) throw error;

        const hitos = [];
        if (r.origen_direccion) {
          hitos.push({
            viaje_id: viaje.id,
            orden: 1,
            tipo: "recogida",
            direccion: r.origen_direccion,
            ventana_inicio: r.ventana_inicio || null,
            ventana_fin: r.ventana_fin || null,
            estado: "pendiente",
          });
        }
        if (r.destino_direccion) {
          hitos.push({
            viaje_id: viaje.id,
            orden: hitos.length + 1,
            tipo: "entrega",
            direccion: r.destino_direccion,
            estado: "pendiente",
          });
        }
        if (hitos.length) await supabase.from("hito").insert(hitos);
        ok++;
      } catch (err) {
        const msg = err.message?.includes("violates") ? "Conflicto de datos (duplicado o referencia inválida)" : (err.message || "Error desconocido");
        errores.push({ fila: i + 1, ref: r.referencia, error: msg });
      }
    }
    return { ok, errores };
  }

  async function ejecutarImport() {
    setLoading(true);
    const mapped = getMappedRows();
    const { ok, errores } = tipo === "choferes" ? await ejecutarImportChoferes(mapped)
      : tipo === "vehiculos" ? await ejecutarImportVehiculos(mapped)
      : await ejecutarImportViajes(mapped);

    setResultado({ ok, errores, total: mapped.length });
    setPaso(4);
    setLoading(false);
  }

  return (
    <div className="max-w-3xl">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary no-underline mb-4 hover:text-ink">
        <ArrowLeft size={16} /> Volver
      </Link>
      <h1 className="text-xl font-medium text-ink mb-1">Importar {config ? config.labelPlural : "datos"}</h1>
      <p className="text-sm text-ink-secondary mb-6">
        {config ? config.descripcion : "Da de alta chóferes, vehículos o viajes en lote desde un Excel/CSV, en vez de uno a uno."}
      </p>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {PASOS.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
              i <= paso ? "bg-brand text-white" : "bg-surface-alt text-ink-muted"
            }`}>
              {i < paso ? <Check size={14} /> : i + 1}
            </div>
            <span className={`text-xs ${i <= paso ? "text-ink" : "text-ink-muted"}`}>{label}</span>
            {i < PASOS.length - 1 && <ArrowRight size={14} className="text-ink-muted" />}
          </div>
        ))}
      </div>

      {/* Paso 0: ¿Qué quieres importar? */}
      {paso === 0 && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-ink-secondary bg-surface-alt border border-border rounded-lg px-3 py-2">
            Si es la primera vez, importa primero <b>chóferes</b> y <b>vehículos</b>, y deja
            <b> viajes</b> para el final — así el importador de viajes puede enlazar cada fila con
            el chófer/vehículo correcto.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.entries(TIPOS_IMPORT).map(([id, t]) => {
              const Icon = t.icon;
              return (
                <button
                  key={id}
                  onClick={() => elegirTipo(id)}
                  className="flex flex-col items-center gap-2 p-6 bg-surface border border-border rounded-xl hover:border-brand hover:bg-surface-alt/50 transition-colors text-center"
                >
                  <Icon size={26} className="text-brand" />
                  <span className="text-sm font-medium text-ink">{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Paso 1: Subir archivo */}
      {paso === 1 && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col items-center gap-3 p-10 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-brand hover:bg-surface-alt/50 transition-colors">
            <Upload size={32} className="text-ink-muted" />
            <span className="text-sm text-ink-secondary">
              {loading ? "Procesando…" : "Arrastra o haz clic para seleccionar .xlsx, .csv"}
            </span>
            <input type="file" accept=".csv,.tsv,.xlsx,.xls" onChange={handleFile} className="hidden" />
          </label>
          <button onClick={() => setPaso(0)} className="self-start text-sm px-3 py-2 rounded-md border border-border text-ink-secondary">Atrás</button>
        </div>
      )}

      {/* Paso 2: Mapear columnas */}
      {paso === 2 && (
        <div className="flex flex-col gap-4">
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileSpreadsheet size={18} className="text-brand" />
              <span className="text-sm font-medium text-ink">{rows.length} filas encontradas · {columns.length} columnas</span>
            </div>
            <p className="text-xs text-ink-secondary mb-4">
              Indica qué columna de tu archivo corresponde a cada campo. Las auto-detectadas ya están marcadas.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {config.campos.map(({ key, label, required }) => (
                <div key={key}>
                  <label className="block text-xs text-ink-secondary mb-1">
                    {label} {required && <span className="text-estado-incidencia">*</span>}
                  </label>
                  <select
                    value={mapping[key] || ""}
                    onChange={(e) => updateMapping(key, e.target.value)}
                    className="w-full text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                  >
                    <option value="">— No mapear —</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPaso(1)} className="text-sm px-3 py-2 rounded-md border border-border text-ink-secondary">Atrás</button>
            <button
              onClick={() => setPaso(3)}
              disabled={!mapping[config.campos.find((c) => c.required)?.key]}
              className="text-sm px-4 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
            >
              Vista previa
            </button>
          </div>
        </div>
      )}

      {/* Paso 3: Preview */}
      {paso === 3 && (
        <div className="flex flex-col gap-4">
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-alt">
                    <th className="text-left px-3 py-2 font-medium text-ink-secondary">#</th>
                    {config.campos.filter(({ key }) => mapping[key]).map(({ key, label }) => (
                      <th key={key} className="text-left px-3 py-2 font-medium text-ink-secondary">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {getMappedRows().slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 text-ink-muted">{i + 1}</td>
                      {config.campos.filter(({ key }) => mapping[key]).map(({ key }) => (
                        <td key={key} className="px-3 py-2 text-ink max-w-[200px] truncate">{r[key]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 10 && (
              <div className="text-xs text-ink-muted px-3 py-2 border-t border-border">
                Mostrando 10 de {rows.length} filas
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPaso(2)} className="text-sm px-3 py-2 rounded-md border border-border text-ink-secondary">Atrás</button>
            <button
              onClick={ejecutarImport}
              disabled={loading}
              className="text-sm px-4 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
            >
              {loading ? `Importando… (${rows.length} ${config.labelPlural})` : `Importar ${rows.length} ${config.labelPlural}`}
            </button>
          </div>
        </div>
      )}

      {/* Paso 4: Resultado */}
      {paso === 4 && resultado && (
        <div className="flex flex-col gap-4">
          <div className="bg-surface border border-border rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              {resultado.errores.length === 0 ? (
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
                  <Check size={20} className="text-estado-ok" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-yellow-50 flex items-center justify-center">
                  <AlertCircle size={20} className="text-yellow-600" />
                </div>
              )}
              <div>
                <div className="text-sm font-medium text-ink">
                  {resultado.ok} de {resultado.total} {config.labelPlural} importados correctamente
                </div>
                {resultado.errores.length > 0 && (
                  <div className="text-xs text-ink-secondary">
                    {resultado.errores.length} errores
                  </div>
                )}
              </div>
            </div>
            {resultado.errores.length > 0 && (
              <div className="mt-3 bg-red-50 rounded-md p-3">
                {resultado.errores.slice(0, 5).map((e, i) => (
                  <div key={i} className="text-xs text-estado-incidencia">
                    Fila {e.fila} ({e.ref}): {e.error}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Link href="/" className="text-sm px-4 py-2 rounded-md bg-brand text-white font-medium no-underline">
              Ir al Kanban
            </Link>
            <button
              onClick={() => { setPaso(0); setTipo(null); setRows([]); setResultado(null); }}
              className="text-sm px-3 py-2 rounded-md border border-border text-ink-secondary"
            >
              Importar otro archivo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
