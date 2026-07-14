import Papa from "papaparse";
import * as XLSX from "xlsx";

export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "csv" || ext === "tsv") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => resolve(result.data),
        error: reject,
      });
    } else if (["xlsx", "xls"].includes(ext)) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: "" });
        resolve(data);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    } else {
      reject(new Error("Formato no soportado. Usa .csv, .tsv, .xlsx o .xls"));
    }
  });
}

export const CAMPOS_VIAJE = [
  { key: "referencia", label: "Referencia", required: true },
  { key: "origen_direccion", label: "Dirección origen (recogida)" },
  { key: "destino_direccion", label: "Dirección destino (entrega)" },
  { key: "chofer_nombre", label: "Nombre del chófer" },
  { key: "vehiculo_matricula", label: "Matrícula vehículo" },
  { key: "remolque_matricula", label: "Matrícula remolque" },
  { key: "ventana_inicio", label: "Fecha/hora inicio" },
  { key: "ventana_fin", label: "Fecha/hora fin" },
  { key: "notas", label: "Notas" },
];

export const ALIAS_VIAJE = {
  referencia: ["referencia", "ref", "reference", "codigo", "código", "id_viaje", "nº", "numero"],
  origen_direccion: ["origen", "recogida", "pickup", "from", "direccion_origen", "dir_origen", "carga"],
  destino_direccion: ["destino", "entrega", "delivery", "to", "direccion_destino", "dir_destino", "descarga"],
  chofer_nombre: ["chofer", "chófer", "conductor", "driver", "nombre_chofer"],
  vehiculo_matricula: ["vehiculo", "vehículo", "matricula", "matrícula", "placa", "tractora", "camion", "camión"],
  remolque_matricula: ["remolque", "trailer", "semi", "matricula_remolque"],
  ventana_inicio: ["fecha_inicio", "inicio", "fecha", "date", "start", "hora_inicio", "ventana_inicio"],
  ventana_fin: ["fecha_fin", "fin", "end", "hora_fin", "ventana_fin"],
  notas: ["notas", "notes", "observaciones", "comentarios"],
};

// IMP.1: autoMapColumns pasa a ser agnóstica del tipo de entidad — el
// llamador decide qué campos/alias mapear (viaje, chófer, vehículo...).
export function autoMapColumns(fileColumns, aliases) {
  const mapping = {};
  for (const [campo, words] of Object.entries(aliases || {})) {
    for (const col of fileColumns) {
      const norm = col.toLowerCase().replace(/[^a-záéíóúñü0-9]/gi, "");
      if (words.some((w) => norm.includes(w.replace(/[^a-záéíóúñü0-9]/gi, "")))) {
        if (!mapping[campo]) mapping[campo] = col;
      }
    }
  }
  return mapping;
}
