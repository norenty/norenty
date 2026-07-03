"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Fuel, ParkingSquare, Siren, Bed, Receipt } from "lucide-react";
import { getGastosViaje, createGastoViaje, deleteGastoViaje } from "../../lib/data";

const TIPOS = ["repostaje", "peaje", "multa", "dieta", "otro"];
const TIPO_LABEL = {
  repostaje: "Repostaje", peaje: "Peaje", multa: "Multa", dieta: "Dieta", otro: "Otro",
};
const TIPO_ICON = {
  repostaje: Fuel, peaje: ParkingSquare, multa: Siren, dieta: Bed, otro: Receipt,
};

function initForm(choferId) {
  return { tipo: "repostaje", importe: "", litros: "", fecha: "", descripcion: "", choferId: choferId || "" };
}

export default function GastosViajeSection({ viajeId, choferId = null, vehiculoId = null }) {
  const [gastos, setGastos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(initForm(choferId));
  const [guardando, setGuardando] = useState(false);
  const [borrandoId, setBorrandoId] = useState(null);
  const [error, setError] = useState(null);

  async function cargar() {
    setGastos(await getGastosViaje(viajeId));
    setLoading(false);
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viajeId]);

  async function guardar(e) {
    e.preventDefault();
    if (!form.importe) return;
    setGuardando(true);
    setError(null);
    try {
      await createGastoViaje({
        viajeId,
        tipo: form.tipo,
        importe: parseFloat(form.importe),
        litros: form.tipo === "repostaje" && form.litros ? parseFloat(form.litros) : null,
        descripcion: form.descripcion.trim() || null,
        fecha: form.fecha || null,
        choferId: form.choferId || null,
        vehiculoId,
      });
      setForm(initForm(choferId));
      setMostrarForm(false);
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id) {
    if (borrandoId) return;
    setBorrandoId(id);
    await deleteGastoViaje(id);
    await cargar();
    setBorrandoId(null);
  }

  const total = gastos.reduce((s, g) => s + Number(g.importe), 0);
  const porTipo = TIPOS.map((t) => ({ tipo: t, total: gastos.filter((g) => g.tipo === t).reduce((s, g) => s + Number(g.importe), 0) })).filter((x) => x.total > 0);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-ink">Gastos</h2>
        <button
          onClick={() => setMostrarForm((v) => !v)}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-brand text-white"
        >
          <Plus size={13} /> Añadir gasto
        </button>
      </div>

      {mostrarForm && (
        <form onSubmit={guardar} className="p-4 border-b border-border bg-surface-alt">
          {error && (
            <p role="alert" className="text-xs text-estado-incidencia mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">{error}</p>
          )}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label htmlFor="gasto-tipo" className="block text-xs text-ink-secondary mb-1">Tipo</label>
              <select
                id="gasto-tipo"
                value={form.tipo}
                onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface"
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>{TIPO_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="gasto-importe" className="block text-xs text-ink-secondary mb-1">Importe (€) *</label>
              <input
                id="gasto-importe" type="number" step="0.01" min="0"
                value={form.importe}
                onChange={(e) => setForm((f) => ({ ...f, importe: e.target.value }))}
                placeholder="0.00"
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {form.tipo === "repostaje" && (
              <div>
                <label htmlFor="gasto-litros" className="block text-xs text-ink-secondary mb-1">Litros</label>
                <input
                  id="gasto-litros" type="number" step="0.01" min="0"
                  value={form.litros}
                  onChange={(e) => setForm((f) => ({ ...f, litros: e.target.value }))}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface"
                />
              </div>
            )}
            <div>
              <label htmlFor="gasto-fecha" className="block text-xs text-ink-secondary mb-1">Fecha</label>
              <input
                id="gasto-fecha" type="date"
                value={form.fecha}
                onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface"
              />
            </div>
          </div>
          <div className="mb-3">
            <label htmlFor="gasto-descripcion" className="block text-xs text-ink-secondary mb-1">Descripción</label>
            <input
              id="gasto-descripcion"
              value={form.descripcion}
              onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
              placeholder="Ej: Multa por exceso de velocidad"
              maxLength={300}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setMostrarForm(false)} className="text-xs px-3 py-2 rounded-md border border-border text-ink-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="text-xs px-3 py-2 rounded-md bg-brand text-white disabled:opacity-40">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      )}

      <div className="p-4">
        {loading ? (
          <div className="h-16 bg-surface-alt rounded-lg animate-pulse" />
        ) : gastos.length === 0 ? (
          <p className="text-xs text-ink-muted">Sin gastos registrados todavía.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {gastos.map((g) => {
              const Icon = TIPO_ICON[g.tipo] || Receipt;
              return (
                <div key={g.id} className="flex items-center gap-2 text-sm">
                  <Icon size={14} className="text-ink-muted shrink-0" />
                  <span className="flex-1 min-w-0 truncate">
                    {TIPO_LABEL[g.tipo]}{g.descripcion ? ` — ${g.descripcion}` : ""}
                    {g.fecha && <span className="text-ink-muted"> · {new Date(g.fecha + "T12:00:00").toLocaleDateString("es-ES")}</span>}
                  </span>
                  <span className="font-medium text-ink shrink-0">{Number(g.importe).toLocaleString("es-ES")} €</span>
                  <button
                    onClick={() => borrar(g.id)}
                    disabled={borrandoId === g.id}
                    aria-label="Borrar gasto"
                    className="p-1 text-ink-muted hover:text-estado-incidencia disabled:opacity-40 shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {gastos.length > 0 && (
        <div className="px-4 py-3 border-t border-border bg-surface-alt text-xs">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-ink-secondary mb-1">
            {porTipo.map((p) => (
              <span key={p.tipo}>{TIPO_LABEL[p.tipo]}: {p.total.toLocaleString("es-ES")} €</span>
            ))}
          </div>
          <div className="font-medium text-ink">Total gastos: {total.toLocaleString("es-ES")} €</div>
        </div>
      )}
    </div>
  );
}
