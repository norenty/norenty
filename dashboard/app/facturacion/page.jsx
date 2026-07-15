"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Download, Receipt } from "lucide-react";
import { getDatosFacturacion, getClientes } from "../../lib/data";
import { fmtEur, fmtKm, fmtFechaCorta } from "../../lib/format";
import RequireRol from "../components/RequireRol";
import ErrorCargaReintentar from "../components/ui/ErrorCargaReintentar";

// F13.1 — export para facturación/integración (CSV+Excel). NO es un módulo
// contable: no calcula IVA ni genera asientos, solo saca los datos que ya
// tenemos en un formato que una gestoría o un ERP (SAP/similar) pueda
// ingerir, en vez de teclearlos a mano. Cabeceras estables a propósito.
const COLUMNAS = [
  { key: "referencia", label: "Referencia" },
  { key: "cliente", label: "Cliente" },
  { key: "clienteCif", label: "CIF" },
  { key: "fecha", label: "Fecha" },
  { key: "km", label: "Km" },
  { key: "precio", label: "Precio (€)" },
  { key: "costeEstimado", label: "Coste estimado (€)" },
  { key: "margenReal", label: "Margen real (€)" },
  { key: "repostaje", label: "Repostaje (€)" },
  { key: "peaje", label: "Peaje (€)" },
  { key: "multa", label: "Multa (€)" },
  { key: "dieta", label: "Dieta (€)" },
];

function filasPlanas(datos) {
  return datos.map((d) => ({
    ...d,
    fecha: d.fecha ? d.fecha.slice(0, 10) : "",
  }));
}

function exportarCSV(datos) {
  const header = COLUMNAS.map((c) => c.label).join(",") + "\n";
  const rows = filasPlanas(datos).map((d) =>
    COLUMNAS.map((c) => `"${String(d[c.key] ?? "").replace(/"/g, '""')}"`).join(",")
  ).join("\n");
  const blob = new Blob(["﻿" + header + rows], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "facturacion.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function exportarExcel(datos) {
  const ws = XLSX.utils.json_to_sheet(filasPlanas(datos), { header: COLUMNAS.map((c) => c.key) });
  XLSX.utils.sheet_add_aoa(ws, [COLUMNAS.map((c) => c.label)], { origin: "A1" });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Facturación");
  XLSX.writeFile(wb, "facturacion.xlsx");
}

export default function FacturacionPage() {
  const [datos, setDatos] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [clienteId, setClienteId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function cargar() {
    setLoading(true);
    setError(null);
    getDatosFacturacion({ clienteId: clienteId || null })
      .then(setDatos)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { getClientes().then(setClientes); }, []);
  useEffect(cargar, [clienteId]);

  const totalPrecio = datos ? datos.reduce((s, d) => s + (d.precio || 0), 0) : 0;

  return (
    <RequireRol roles={["admin"]} fallback={<p className="text-sm text-ink-muted">Visible solo para administradores.</p>}>
      <div>
        <h1 className="text-lg font-medium text-ink mb-1 flex items-center gap-2">
          <Receipt size={18} /> Facturación
        </h1>
        <p className="text-xs text-ink-secondary mb-4">
          Viajes completados de los últimos 90 días, listos para exportar a tu gestoría o ERP.
          No calcula IVA ni genera factura — es un export de los datos que ya tienes.
        </p>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <select
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
            className="text-sm border border-border rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          >
            <option value="">Todos los clientes</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          {datos && datos.length > 0 && (
            <>
              <button
                onClick={() => exportarCSV(datos)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
              >
                <Download size={13} /> Exportar CSV
              </button>
              <button
                onClick={() => exportarExcel(datos)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
              >
                <FileSpreadsheet size={13} /> Exportar Excel
              </button>
            </>
          )}
        </div>

        {error && <ErrorCargaReintentar mensaje="No se pudo cargar la facturación." onReintentar={cargar} />}
        {loading && !error && <p className="text-xs text-ink-muted">Calculando…</p>}

        {!loading && !error && datos && (
          datos.length === 0 ? (
            <p className="text-sm text-ink-secondary">Sin viajes completados en este periodo.</p>
          ) : (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-alt text-ink-secondary">
                      {COLUMNAS.map((c) => (
                        <th key={c.key} className="text-left px-3 py-2 font-medium whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datos.map((d, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 font-mono">{d.referencia}</td>
                        <td className="px-3 py-2">{d.cliente || "—"}</td>
                        <td className="px-3 py-2">{d.clienteCif || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{d.fecha ? fmtFechaCorta(d.fecha) : "—"}</td>
                        <td className="px-3 py-2">{d.km != null ? fmtKm(d.km) : "—"}</td>
                        <td className="px-3 py-2">{d.precio != null ? fmtEur(d.precio) : "—"}</td>
                        <td className="px-3 py-2">{d.costeEstimado != null ? fmtEur(d.costeEstimado) : "—"}</td>
                        <td className="px-3 py-2">{d.margenReal != null ? fmtEur(d.margenReal) : "—"}</td>
                        <td className="px-3 py-2">{d.repostaje ? fmtEur(d.repostaje) : "—"}</td>
                        <td className="px-3 py-2">{d.peaje ? fmtEur(d.peaje) : "—"}</td>
                        <td className="px-3 py-2">{d.multa ? fmtEur(d.multa) : "—"}</td>
                        <td className="px-3 py-2">{d.dieta ? fmtEur(d.dieta) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-2 border-t border-border text-xs text-ink-secondary">
                {datos.length} viajes · Total precio: <span className="font-medium text-ink">{fmtEur(totalPrecio)}</span>
              </div>
            </div>
          )
        )}
      </div>
    </RequireRol>
  );
}
