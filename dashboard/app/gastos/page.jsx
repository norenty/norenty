"use client";

import { useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { getGastosEmpresa, createGastoEmpresa, deleteGastoEmpresa, CATEGORIAS_GASTO_EMPRESA } from "../../lib/data";
import { CATEGORIA_GASTO_EMPRESA_LABEL } from "../../lib/labels";
import { fmtEur, fmtFecha } from "../../lib/format";
import EmptyState from "../components/ui/EmptyState";
import RequireRol from "../components/RequireRol";

function formVacio() {
  return { categoria: "otro", importe: "", proveedor: "", descripcion: "", fecha: "" };
}

export default function GastosPage() {
  const [gastos, setGastos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(formVacio());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [borrandoId, setBorrandoId] = useState(null);

  async function load() {
    setLoading(true);
    setGastos(await getGastosEmpresa({}));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function añadir(e) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      await createGastoEmpresa({
        categoria: form.categoria,
        importe: form.importe,
        proveedor: form.proveedor || null,
        descripcion: form.descripcion || null,
        fecha: form.fecha || null,
      });
      setForm(formVacio());
      await load();
    } catch (err) {
      setError(err.message);
    }
    setGuardando(false);
  }

  async function borrar(id) {
    setBorrandoId(id);
    try {
      await deleteGastoEmpresa(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
    setBorrandoId(null);
  }

  function exportarCSV() {
    const header = "Fecha,Categoría,Importe,Proveedor,Descripción\n";
    const rows = gastos.map((g) =>
      [
        g.fecha,
        CATEGORIA_GASTO_EMPRESA_LABEL[g.categoria] || g.categoria,
        g.importe,
        g.proveedor || "",
        g.descripcion || "",
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    const blob = new Blob(["﻿" + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gastos-empresa-norenty-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const total = gastos.reduce((s, g) => s + Number(g.importe), 0);

  return (
    <RequireRol roles={["admin"]}>
      <div className="max-w-3xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-medium text-ink">Gastos de empresa</h1>
          <button
            onClick={exportarCSV}
            disabled={gastos.length === 0}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
          >
            <Download size={16} /> Exportar CSV
          </button>
        </div>
        <p className="text-sm text-ink-secondary mb-6">
          Gastos que NO están atados a un viaje ni a un vehículo concreto — leasing, seguro,
          nómina, alquiler. Exporta a CSV para tu gestoría; Norenty no sustituye tu software de
          contabilidad, lo alimenta.
        </p>

        {error && (
          <div className="mb-4 text-xs px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-estado-incidencia flex items-center justify-between">
            {error}
            <button onClick={() => setError(null)} className="text-ink-muted ml-2">✕</button>
          </div>
        )}

        <form onSubmit={añadir} className="bg-surface border border-border rounded-xl p-4 mb-6 flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Categoría</label>
            <select
              value={form.categoria}
              onChange={(e) => setForm({ ...form, categoria: e.target.value })}
              className="text-sm border border-border rounded-md px-3 py-2 bg-surface focus:outline-none focus:border-brand"
            >
              {CATEGORIAS_GASTO_EMPRESA.map((c) => (
                <option key={c} value={c}>{CATEGORIA_GASTO_EMPRESA_LABEL[c]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Importe (€)</label>
            <input
              type="number" step="any" min="0"
              value={form.importe}
              onChange={(e) => setForm({ ...form, importe: e.target.value })}
              placeholder="1200"
              className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-28"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Fecha</label>
            <input
              type="date"
              value={form.fecha}
              onChange={(e) => setForm({ ...form, fecha: e.target.value })}
              className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <div className="flex-1 min-w-[9rem]">
            <label className="block text-xs text-ink-secondary mb-1">Proveedor</label>
            <input
              value={form.proveedor}
              onChange={(e) => setForm({ ...form, proveedor: e.target.value })}
              placeholder="Leasing Renault SA"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <div className="flex-1 min-w-[9rem]">
            <label className="block text-xs text-ink-secondary mb-1">Descripción</label>
            <input
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              placeholder="Factura nº..."
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <button
            type="submit"
            disabled={guardando || !form.importe}
            className="text-sm px-4 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            {guardando ? "Guardando…" : "Añadir"}
          </button>
        </form>

        {loading ? (
          <div className="h-40 bg-border rounded-xl animate-pulse" />
        ) : gastos.length === 0 ? (
          <EmptyState
            titulo="Todavía no hay gastos generales"
            texto="Añade el primero con el formulario de arriba — últimos 90 días por defecto."
          />
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="hidden md:grid grid-cols-[100px_120px_1fr_1fr_80px_40px] gap-2 px-4 py-2 bg-surface-alt border-b border-border text-xs font-medium text-ink-secondary">
              <span>Fecha</span>
              <span>Categoría</span>
              <span>Proveedor</span>
              <span>Descripción</span>
              <span className="text-right">Importe</span>
              <span></span>
            </div>
            {gastos.map((g) => (
              <div
                key={g.id}
                className="flex flex-col md:grid md:grid-cols-[100px_120px_1fr_1fr_80px_40px] gap-1 md:gap-2 md:items-center px-4 py-3 border-b border-border last:border-0"
              >
                <span className="text-xs text-ink-muted">{fmtFecha(g.fecha)}</span>
                <span className="text-sm text-ink">{CATEGORIA_GASTO_EMPRESA_LABEL[g.categoria] || g.categoria}</span>
                <span className="text-sm text-ink-secondary truncate">{g.proveedor || "—"}</span>
                <span className="text-sm text-ink-secondary truncate">{g.descripcion || "—"}</span>
                <span className="text-sm text-ink text-right font-mono">{fmtEur(g.importe)}</span>
                <button
                  onClick={() => borrar(g.id)}
                  disabled={borrandoId === g.id}
                  aria-label="Eliminar gasto"
                  className="text-ink-muted hover:text-estado-incidencia p-1 justify-self-end disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div className="flex justify-between px-4 py-3 bg-surface-alt text-sm font-medium text-ink">
              <span>Total ({gastos.length})</span>
              <span className="font-mono">{fmtEur(total)}</span>
            </div>
          </div>
        )}
      </div>
    </RequireRol>
  );
}
