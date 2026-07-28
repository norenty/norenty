"use client";

import { useEffect, useState } from "react";
import { Route } from "lucide-react";
import { getBasesEmpresa, getVistaPlanificadorPorBase } from "../../lib/data";
import RequireRol from "../components/RequireRol";
import EmptyState from "../components/ui/EmptyState";

// Fase 23, 23.E.2 -- DISCOVERY.md insight 18: "en vez de filtrar mis
// camiones como yo, filtra todos los camiones que hay en la delegación 1,
// que es Zaragoza. ¿Cuántos camiones hay mañana en Zaragoza?"
function PlanificadorContenido() {
  const [bases, setBases] = useState([]);
  const [baseId, setBaseId] = useState(null);
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBasesEmpresa().then((b) => {
      setBases(b);
      if (b.length > 0) setBaseId(b[0].id);
      else setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!baseId) return;
    setLoading(true);
    getVistaPlanificadorPorBase(baseId).then((f) => {
      setFilas(f);
      setLoading(false);
    });
  }, [baseId]);

  if (bases.length === 0 && !loading) {
    return (
      <EmptyState
        icon={Route}
        titulo="Todavía no hay ninguna base configurada"
        texto="Configura al menos una base en Ajustes → Ubicación base para poder filtrar la flota por delegación."
      />
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Route size={20} className="text-brand" />
        <h1 className="text-lg font-medium text-ink">Planificador</h1>
      </div>
      <p className="text-sm text-ink-secondary mb-4">
        La flota de una delegación, ahora mismo — derivado de la última posición conocida de
        cada chófer, no de una asignación fija.
      </p>

      <div className="flex gap-2 mb-4">
        {bases.map((b) => (
          <button
            key={b.id}
            onClick={() => setBaseId(b.id)}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              baseId === b.id ? "bg-brand text-white border-brand" : "border-border text-ink-secondary hover:bg-surface-alt"
            }`}
          >
            {b.nombre}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-48 bg-border rounded-xl animate-pulse" />
      ) : filas.length === 0 ? (
        <EmptyState
          icon={Route}
          titulo="Sin camiones en esta delegación ahora mismo"
          texto="Ningún chófer con tractora acoplada tiene su última posición conocida cerca de esta base."
        />
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-ink-secondary text-left">
                <th className="px-4 py-2 font-medium">Matrícula</th>
                <th className="px-4 py-2 font-medium">Chófer</th>
                <th className="px-4 py-2 font-medium">Horas esta semana</th>
                <th className="px-4 py-2 font-medium">Horas restantes (561)</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.choferId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 text-ink font-mono">{f.matricula || "—"}</td>
                  <td className="px-4 py-2.5 text-ink">{f.choferNombre}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{f.horasConducidasSemana ?? "n/d"} h</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{f.horasRestantesSemana ?? "n/d"} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-muted mt-3">
        Pendiente: cuándo y dónde queda libre cada tractora (23.D.1) — se añade cuando esté
        construido. Hoy solo se muestran las horas de conducción de la semana (Reglamento
        561/2006), que ya vetan o no un viaje nuevo.
      </p>
    </div>
  );
}

export default function PlanificadorPage() {
  return (
    <RequireRol roles={["admin", "planificador"]}>
      <PlanificadorContenido />
    </RequireRol>
  );
}
