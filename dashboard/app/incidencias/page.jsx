"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, CheckCircle2, ExternalLink, ChevronDown } from "lucide-react";
import { supabase } from "../../lib/supabase";

const PAGE_SIZE = 20;

const ESTADO_LABELS = {
  abierta: { label: "Abierta", color: "text-estado-incidencia", bg: "bg-red-50" },
  en_revision: { label: "En revisión", color: "text-yellow-600", bg: "bg-yellow-50" },
  resuelta: { label: "Resuelta", color: "text-estado-ok", bg: "bg-green-50" },
};

const TIPO_LABELS = {
  fuera_de_ventana: "Fuera de ventana",
  rechazo_entrega: "Rechazo en entrega",
  documento_invalido: "Documento inválido",
  averia: "Avería",
  accidente: "Accidente",
  retraso: "Retraso",
  otro: "Otro",
};

export default function IncidenciasPage() {
  const [incidencias, setIncidencias] = useState([]);
  const [filtro, setFiltro] = useState("abiertas");
  const [loading, setLoading] = useState(true);
  const [loadingMas, setLoadingMas] = useState(false);
  const [hayMas, setHayMas] = useState(false);
  const [offset, setOffset] = useState(0);
  const [procesandoId, setProcesandoId] = useState(null);

  const fetchPage = useCallback(async (filtroActual, offsetActual, append = false) => {
    let query = supabase
      .from("incidencia")
      .select("*, viaje(id, referencia)")
      .order("created_at", { ascending: false })
      .range(offsetActual, offsetActual + PAGE_SIZE);

    if (filtroActual === "abiertas") {
      query = query.in("estado", ["abierta", "en_revision"]);
    } else if (filtroActual !== "todas") {
      query = query.eq("estado", filtroActual);
    }

    const { data } = await query;
    const rows = data || [];
    const mas = rows.length > PAGE_SIZE;
    const slice = mas ? rows.slice(0, PAGE_SIZE) : rows;

    setHayMas(mas);
    setIncidencias((prev) => append ? [...prev, ...slice] : slice);
  }, []);

  useEffect(() => {
    setLoading(true);
    setOffset(0);
    setIncidencias([]);
    fetchPage(filtro, 0, false).finally(() => setLoading(false));
  }, [filtro]);

  async function cargarMas() {
    const nuevoOffset = offset + PAGE_SIZE;
    setOffset(nuevoOffset);
    setLoadingMas(true);
    await fetchPage(filtro, nuevoOffset, true);
    setLoadingMas(false);
  }

  async function cambiarEstado(id, nuevoEstado) {
    if (procesandoId) return;
    setProcesandoId(id);
    try {
      await supabase.from("incidencia").update({ estado: nuevoEstado }).eq("id", id);
      // Reload current view (mantener offset)
      setLoading(true);
      await fetchPage(filtro, 0, false);
      setOffset(0);
      setLoading(false);
    } finally {
      setProcesandoId(null);
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-medium text-ink mb-1">Incidencias</h1>
      <p className="text-sm text-ink-secondary mb-5">
        Alertas y problemas detectados en los viajes.
      </p>

      <div className="flex gap-2 mb-5">
        {[
          { key: "abiertas", label: "Abiertas" },
          { key: "resuelta", label: "Resueltas" },
          { key: "todas", label: "Todas" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              filtro === f.key
                ? "bg-brand text-white border-brand"
                : "border-border text-ink-secondary hover:bg-surface-alt"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-surface-alt rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      ) : incidencias.length === 0 ? (
        <div className="text-center py-12">
          <AlertTriangle size={32} className="mx-auto text-ink-muted mb-3" />
          <p className="text-sm text-ink-secondary">
            {filtro === "abiertas"
              ? "No hay incidencias abiertas. Todo en orden."
              : "No hay incidencias con este filtro."}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {incidencias.map((inc) => {
              const est = ESTADO_LABELS[inc.estado] || ESTADO_LABELS.abierta;
              return (
                <div key={inc.id} className="bg-surface border border-border rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-full ${est.bg} flex items-center justify-center shrink-0`}>
                      {inc.estado === "resuelta" ? (
                        <CheckCircle2 size={18} className={est.color} />
                      ) : (
                        <AlertTriangle size={18} className={est.color} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-ink">
                          {TIPO_LABELS[inc.tipo] || inc.tipo}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${est.bg} ${est.color}`}>
                          {est.label}
                        </span>
                      </div>
                      {inc.descripcion && (
                        <p className="text-xs text-ink-secondary mb-1">{inc.descripcion}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-ink-muted">
                        {inc.viaje && (
                          <Link
                            href={`/viajes/${inc.viaje.id}`}
                            className="flex items-center gap-1 text-brand no-underline hover:underline"
                          >
                            {inc.viaje.referencia || inc.viaje.id.slice(0, 8)} <ExternalLink size={12} />
                          </Link>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {new Date(inc.created_at).toLocaleString("es-ES", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {inc.estado === "abierta" && (
                        <button
                          onClick={() => cambiarEstado(inc.id, "en_revision")}
                          disabled={procesandoId === inc.id}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-yellow-300 text-yellow-700 hover:bg-yellow-50 disabled:opacity-40"
                        >
                          {procesandoId === inc.id ? "…" : "Revisar"}
                        </button>
                      )}
                      {inc.estado !== "resuelta" && (
                        <button
                          onClick={() => cambiarEstado(inc.id, "resuelta")}
                          disabled={procesandoId === inc.id}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-estado-ok text-estado-ok hover:bg-green-50 disabled:opacity-40"
                        >
                          {procesandoId === inc.id ? "…" : "Resolver"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {hayMas && (
            <div className="mt-4 text-center">
              <button
                onClick={cargarMas}
                disabled={loadingMas}
                className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg border border-border text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
              >
                {loadingMas ? (
                  "Cargando..."
                ) : (
                  <><ChevronDown size={14} /> Ver más incidencias</>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
