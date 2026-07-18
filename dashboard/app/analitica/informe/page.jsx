"use client";

import { useEffect, useState } from "react";
import { Printer, ClipboardList } from "lucide-react";
import { getInformeEjecutivo } from "../../../lib/data";
import { fmtEur, fmtFechaCorta } from "../../../lib/format";
import ErrorCargaReintentar from "../../components/ui/ErrorCargaReintentar";
import RequireRol from "../../components/RequireRol";

// R3 (Fase 16, 2026-07-15): pedido explícito del usuario — un informe que el
// jefe de tráfico pueda generar, leer de un vistazo y enviar. Mismo patrón
// `print:` que /nomina y el dossier de F13.2 (window.print() a PDF, sin
// librería nueva). Admin-only: es una herramienta de dirección, no del día a
// día del gestor (mismo criterio que Analítica → Gestores/Clientes/Evolución).

function Variacion({ v, invertir = false, sufijo = "%" }) {
  if (v == null || v.variacionPct == null) return null;
  const sube = v.variacionPct > 0;
  const esBueno = invertir ? !sube : sube;
  const color = v.variacionPct === 0 ? "text-ink-muted" : esBueno ? "text-estado-ok" : "text-estado-incidencia";
  const flecha = v.variacionPct === 0 ? "→" : sube ? "▲" : "▼";
  return (
    <span className={`text-xs ${color}`}>
      {flecha} {Math.abs(v.variacionPct)}{sufijo} vs. periodo anterior
    </span>
  );
}

function Bloque({ titulo, children }) {
  return (
    <section className="bg-surface border border-border rounded-xl p-4 print:border-0 print:rounded-none print:break-inside-avoid">
      <h2 className="text-sm font-medium text-ink mb-3">{titulo}</h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div>
      <div className="text-xs text-ink-secondary mb-0.5">{label}</div>
      <div className="text-xl font-semibold text-ink">{value ?? "—"}</div>
      {sub}
    </div>
  );
}

export default function InformeEjecutivo() {
  const [informe, setInforme] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function cargar() {
    setLoading(true);
    setError(null);
    getInformeEjecutivo()
      .then(setInforme)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { cargar(); }, []);

  return (
    <RequireRol roles={["admin"]} fallback={<p className="text-sm text-ink-muted">Visible solo para administradores.</p>}>
      <div className="max-w-3xl">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h1 className="text-xl font-medium text-ink flex items-center gap-2">
            <ClipboardList size={20} /> Informe ejecutivo
          </h1>
          {informe && (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-ink-secondary hover:bg-surface-alt print:hidden"
            >
              <Printer size={13} /> Imprimir / PDF
            </button>
          )}
        </div>
        <p className="text-sm text-ink-secondary mb-4">
          {informe ? (
            <>Últimos 90 días — {fmtFechaCorta(informe.periodo.desde)} a {fmtFechaCorta(informe.periodo.hasta)}</>
          ) : (
            "Resumen de puntualidad, rentabilidad y flota, listo para analizar o enviar."
          )}
        </p>

        {error ? (
          <ErrorCargaReintentar mensaje="No se pudo cargar el informe." onReintentar={cargar} />
        ) : loading || !informe ? (
          <div className="h-64 bg-border rounded-xl animate-pulse" />
        ) : (
          <div className="flex flex-col gap-4">
            <Bloque titulo="Puntualidad">
              <div className="grid grid-cols-2 gap-4">
                <Kpi
                  label="% Puntualidad"
                  value={informe.puntualidad.pctPuntualidad != null ? `${informe.puntualidad.pctPuntualidad}%` : null}
                  sub={<Variacion v={informe.comparativa.pctPuntualidad} />}
                />
                <Kpi label="Hitos fuera de ventana" value={informe.puntualidad.totalTarde} />
              </div>
            </Bloque>

            <Bloque titulo="Rentabilidad">
              <div className="grid grid-cols-2 gap-4">
                <Kpi
                  label="Margen real medio"
                  value={fmtEur(informe.rentabilidad.margenRealMedio)}
                  sub={<Variacion v={informe.comparativa.margenRealMedio} />}
                />
                <Kpi
                  label="Viajes a pérdidas"
                  value={informe.rentabilidad.viajesAPerdidasReales}
                  sub={<Variacion v={informe.comparativa.viajesAPerdidasReales} invertir />}
                />
              </div>
            </Bloque>

            <Bloque titulo="Flota">
              <div className="grid grid-cols-3 gap-4">
                <Kpi label="Vehículos activos" value={informe.flota.vehiculosActivos} sub={<span className="text-xs text-ink-muted">de {informe.flota.totalVehiculos}</span>} />
                <Kpi label="% Utilización" value={informe.flota.pctUtilizacion != null ? `${informe.flota.pctUtilizacion}%` : null} />
                <Kpi label="ITV pendientes" value={informe.flota.itvPendientes.length} />
              </div>
            </Bloque>

            <Bloque titulo="Incidencias">
              <div className="grid grid-cols-2 gap-4">
                <Kpi
                  label="Tasa (por viaje)"
                  value={informe.comparativa.tasaIncidencias.actual ?? "—"}
                  sub={<Variacion v={informe.comparativa.tasaIncidencias} invertir />}
                />
              </div>
            </Bloque>

            {informe.gestores.length > 0 && (
              <Bloque titulo="Gestores">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-ink-secondary text-left">
                        <th className="py-1.5 font-medium">Gestor</th>
                        <th className="py-1.5 font-medium">Viajes</th>
                        <th className="py-1.5 font-medium">% siguió sugerencia</th>
                        <th className="py-1.5 font-medium">Incidencias</th>
                      </tr>
                    </thead>
                    <tbody>
                      {informe.gestores.map((g) => (
                        <tr key={g.id} className="border-b border-border last:border-0">
                          <td className="py-1.5 text-ink">{g.nombre}</td>
                          <td className="py-1.5 text-ink-secondary">{g.viajesGestionados}</td>
                          <td className="py-1.5 text-ink-secondary">
                            {g.pctSiguioSugerencia != null ? `${g.pctSiguioSugerencia}%` : "—"}
                          </td>
                          <td className="py-1.5 text-ink-secondary">{g.incidencias}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Bloque>
            )}

            <p className="text-xs text-ink-muted print:hidden">
              Generado el {fmtFechaCorta(new Date().toISOString())} — mismos datos que Analítica, en formato para analizar o enviar.
            </p>
          </div>
        )}
      </div>
    </RequireRol>
  );
}
