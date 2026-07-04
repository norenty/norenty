"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Search, Upload, Download, ChevronDown, Truck } from "lucide-react";
import { getViajesLista } from "../../lib/data";
import { ESTADO_VIAJE } from "../../lib/labels";
import EmptyState from "../components/ui/EmptyState";

const ESTADOS = [
  { key: null, label: "Todos" },
  { key: "planificado", label: "Planificado", c: "text-estado-planificado" },
  { key: "en_curso", label: "En curso", c: "text-estado-en-curso" },
  { key: "completado", label: "Completado", c: "text-estado-ok" },
  { key: "cancelado", label: "Cancelado", c: "text-ink-muted" },
];

export default function ViajesPage() {
  const [viajes, setViajes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMas, setLoadingMas] = useState(false);
  const [hayMas, setHayMas] = useState(false);
  const [offset, setOffset] = useState(0);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState(null);

  const fetchPage = useCallback(async (estado, off, append = false) => {
    const { rows, hayMas: mas } = await getViajesLista({ offset: off, estado });
    setHayMas(mas);
    setViajes((prev) => append ? [...prev, ...rows] : rows);
  }, []);

  useEffect(() => {
    setLoading(true);
    setOffset(0);
    setViajes([]);
    setBusqueda("");
    fetchPage(filtroEstado, 0, false).finally(() => setLoading(false));
  }, [filtroEstado]);

  async function cargarMas() {
    const nuevoOffset = offset + 50;
    setOffset(nuevoOffset);
    setLoadingMas(true);
    await fetchPage(filtroEstado, nuevoOffset, true);
    setLoadingMas(false);
  }

  function exportarCSV() {
    const header = "Referencia,Chófer,Estado,Hitos completados,Hitos total,Creado\n";
    const rows = filtrados.map((v) =>
      [
        v.referencia,
        v.chofer?.nombre || "Sin asignar",
        v.estado,
        v.hitosCompletados,
        v.hitosTotal,
        v.created_at ? new Date(v.created_at).toLocaleDateString("es-ES") : "",
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    const blob = new Blob(["﻿" + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `viajes-norenty-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filtrados = busqueda
    ? viajes.filter((v) => {
        const q = busqueda.toLowerCase();
        return (
          (v.referencia || "").toLowerCase().includes(q) ||
          (v.chofer?.nombre || "").toLowerCase().includes(q) ||
          (v.hitoActual || "").toLowerCase().includes(q)
        );
      })
    : viajes;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-medium text-ink">Viajes</h1>
        <div className="flex gap-2">
          <button
            onClick={exportarCSV}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
          >
            <Download size={16} /> Exportar
          </button>
          <Link
            href="/importar"
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-border text-ink-secondary no-underline hover:bg-surface-alt"
          >
            <Upload size={16} /> Importar
          </Link>
          <Link
            href="/viajes/nuevo"
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium no-underline"
          >
            <Plus size={16} /> Nuevo viaje
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 flex items-center gap-2 bg-surface border border-border rounded-md px-3 py-2">
          <Search size={15} className="text-ink-muted" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por referencia, chófer o dirección…"
            className="flex-1 text-sm bg-transparent outline-none"
          />
        </div>
        <div className="flex gap-1">
          {ESTADOS.map((e) => (
            <button
              key={e.key ?? "todos"}
              onClick={() => setFiltroEstado(e.key)}
              className={`text-xs px-2.5 py-1.5 rounded-full border ${
                filtroEstado === e.key
                  ? "bg-brand text-white border-brand"
                  : "border-border text-ink-secondary hover:bg-surface-alt"
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs text-ink-muted mb-2">
        {filtrados.length} viaje{filtrados.length !== 1 ? "s" : ""}
        {busqueda && ` para "${busqueda}"`}
        {hayMas && !busqueda && " (hay más — usa «Ver más» abajo)"}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-surface-alt rounded-xl h-14 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="hidden md:grid grid-cols-[120px_1fr_100px_100px_80px] gap-2 px-4 py-2 bg-surface-alt border-b border-border text-xs font-medium text-ink-secondary">
              <span>Referencia</span>
              <span>Chófer / Hito actual</span>
              <span>Progreso</span>
              <span>Creado</span>
              <span className="text-right">Estado</span>
            </div>
            {filtrados.map((v) => {
              const e = ESTADO_VIAJE[v.estado] || ESTADO_VIAJE.planificado;
              return (
                <Link
                  key={v.id}
                  href={`/viajes/${v.id}`}
                  className="flex flex-col md:grid md:grid-cols-[120px_1fr_100px_100px_80px] gap-1 md:gap-2 md:items-center px-4 py-3 border-b border-border last:border-0 no-underline hover:bg-surface-alt transition-colors"
                >
                  <span className="font-mono text-sm text-ink">{v.referencia}</span>
                  <div className="min-w-0">
                    <div className="text-sm text-ink truncate">{v.chofer?.nombre || "Sin asignar"}</div>
                    {v.hitoActual && (
                      <div className="text-xs text-ink-secondary truncate">{v.hitoActual}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-surface-alt rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full"
                        style={{ width: v.hitosTotal ? `${(v.hitosCompletados / v.hitosTotal) * 100}%` : "0%" }}
                      />
                    </div>
                    <span className="text-xs text-ink-muted">{v.hitosCompletados}/{v.hitosTotal}</span>
                  </div>
                  <span className="text-xs text-ink-muted">
                    {v.created_at
                      ? new Date(v.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })
                      : "—"}
                  </span>
                  <span className={`text-xs font-medium text-right px-2 py-0.5 rounded-full ${e.bg} ${e.c}`}>
                    {e.t}
                  </span>
                </Link>
              );
            })}
            {filtrados.length === 0 && (
              busqueda ? (
                <p className="text-sm text-ink-secondary p-4 text-center">Sin resultados para "{busqueda}"</p>
              ) : (
                <EmptyState
                  icon={Truck}
                  titulo="Todavía no hay viajes"
                  texto="Crea tu primer viaje o impórtalos desde Excel/CSV."
                  ctaLabel="Nuevo viaje"
                  ctaHref="/viajes/nuevo"
                />
              )
            )}
          </div>

          {hayMas && !busqueda && (
            <div className="mt-4 text-center">
              <button
                onClick={cargarMas}
                disabled={loadingMas}
                className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg border border-border text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
              >
                {loadingMas ? "Cargando..." : <><ChevronDown size={14} /> Ver más viajes</>}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
