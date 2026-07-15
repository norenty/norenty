"use client";

import { useEffect, useState } from "react";
import { Moon, Route as RouteIcon, Download, Printer } from "lucide-react";
import { getInformeNomina } from "../../lib/data";
import RequireRol from "../components/RequireRol";
import { fmtKm } from "../../lib/format";
import ErrorCargaReintentar from "../components/ui/ErrorCargaReintentar";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function exportarCSV(informe, mes, anio) {
  const header = "Chófer,Noches fuera,Km (carretera),Estimado,Viajes\n";
  const rows = informe.filas.map((f) =>
    [
      f.nombre,
      f.nochesFuera ?? "n/d",
      f.km,
      f.estimado ? "sí" : "no",
      f.viajes.join("; "),
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
  ).join("\n");
  const blob = new Blob(["﻿" + header + rows], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nomina-${MESES[mes - 1].toLowerCase()}-${anio}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Nomina() {
  const ahora = new Date();
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  const [anio, setAnio] = useState(ahora.getFullYear());
  const [informe, setInforme] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function cargar() {
    setLoading(true);
    setError(null);
    getInformeNomina(mes, anio)
      .then((d) => setInforme(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { cargar(); }, [mes, anio]);

  const anios = [];
  for (let a = ahora.getFullYear(); a >= ahora.getFullYear() - 3; a--) anios.push(a);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 print:block">
        <h1 className="text-lg font-medium text-ink">Nómina</h1>
        {informe && (
          <div className="flex gap-2 print:hidden">
            <RequireRol roles={["admin"]}>
              <button
                onClick={() => exportarCSV(informe, mes, anio)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
              >
                <Download size={13} /> Exportar CSV
              </button>
            </RequireRol>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
            >
              <Printer size={13} /> Imprimir / PDF
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-ink-secondary mb-4">
        Noches fuera y km por carretera de cada chófer, derivados de los hitos de sus viajes.
        <span className="hidden print:inline"> — {MESES[mes - 1]} {anio}</span>
      </p>

      <div className="flex items-center gap-2 mb-4 print:hidden">
        <label htmlFor="nomina-mes" className="sr-only">Mes</label>
        <select
          id="nomina-mes"
          value={mes}
          onChange={(e) => setMes(Number(e.target.value))}
          className="text-sm border border-border rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        >
          {MESES.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <label htmlFor="nomina-anio" className="sr-only">Año</label>
        <select
          id="nomina-anio"
          value={anio}
          onChange={(e) => setAnio(Number(e.target.value))}
          className="text-sm border border-border rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        >
          {anios.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {error ? (
        <ErrorCargaReintentar mensaje="No se pudo cargar el informe de nómina." onReintentar={cargar} />
      ) : loading || !informe ? (
        <div className="h-64 bg-border rounded-xl animate-pulse" />
      ) : (
        <>
          {!informe.tieneBase && (
            <div className="mb-4 text-xs px-3 py-2 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
              La empresa no tiene una ubicación base configurada, así que las
              noches fuera no se pueden calcular (aparecen como “n/d”). Configúrala
              en Ajustes → Ubicación base.
            </div>
          )}

          <div className="text-xs text-ink-muted mb-2">
            Umbral de “noche fuera”: más de {informe.umbralKm} km de la base.
          </div>

          <div className="bg-surface border border-border rounded-xl overflow-hidden print:border-0 print:rounded-none">
            {/* Móvil (< ~500px): la tabla no encoge bien con 4 columnas, mejor
                scroll horizontal contenido que romper el layout de la página. */}
            <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-ink-secondary text-left">
                  <th className="px-4 py-2 font-medium">Chófer</th>
                  <th className="px-4 py-2 font-medium">
                    <span className="inline-flex items-center gap-1"><Moon size={13} /> Noches fuera</span>
                  </th>
                  <th className="px-4 py-2 font-medium">
                    <span className="inline-flex items-center gap-1"><RouteIcon size={13} /> Km (carretera)</span>
                  </th>
                  <th className="px-4 py-2 font-medium">Viajes</th>
                </tr>
              </thead>
              <tbody>
                {informe.filas.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-secondary">Sin chóferes.</td></tr>
                ) : (
                  informe.filas.map((f) => (
                    <tr key={f.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 text-ink">{f.nombre}</td>
                      <td className="px-4 py-2.5 text-ink-secondary">{f.nochesFuera ?? "n/d"}</td>
                      <td className="px-4 py-2.5 text-ink-secondary">
                        {f.estimado && <span title="Estimado: OSRM no respondió para algún tramo, se usó distancia en línea recta corregida">~</span>}
                        {fmtKm(f.km)}
                      </td>
                      <td className="px-4 py-2.5 text-ink-muted text-xs">
                        {f.viajes.length ? f.viajes.join(", ") : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>

          <p className="text-xs text-ink-muted mt-3">
            v1: la noche fuera se estima por la llegada nocturna (22:00–06:00) más
            lejana a la base; los km se calculan por carretera real entre hitos
            completados. Pendiente de ajustar el umbral con el gestor.
            {informe.filas.some((f) => f.estimado) && (
              <> Las filas con “~” tienen algún tramo estimado en línea recta
              corregida porque el servicio de rutas (OSRM) no respondió — instala
              OSRM para km por carretera reales en todos los tramos.</>
            )}
          </p>
        </>
      )}
    </div>
  );
}
