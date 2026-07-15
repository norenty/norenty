"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Fuel, ParkingSquare, Siren, Bed, Receipt, Image as ImageIcon } from "lucide-react";
import { getGastosViaje, createGastoViaje, deleteGastoViaje, getCurrentEmpresaId } from "../../lib/data";
import { supabase } from "../../lib/supabase";
import { TIPO_GASTO_LABEL as TIPO_LABEL } from "../../lib/labels";
import RequireRol from "./RequireRol";
import { fmtEur } from "../../lib/format";

const TIPOS = ["repostaje", "peaje", "multa", "dieta", "otro"];
const TIPO_ICON = {
  repostaje: Fuel, peaje: ParkingSquare, multa: Siren, dieta: Bed, otro: Receipt,
};
const SIGNED_URL_TTL = 60; // segundos, mismo criterio que DocumentosSection

function initForm(choferId) {
  return { tipo: "repostaje", importe: "", litros: "", fecha: "", descripcion: "", choferId: choferId || "", foto: null };
}

/** SHA-256 de un archivo en el navegador (Web Crypto), mismo principio de
 * evidencia-con-integridad que el POD (ítem 12.1): la foto del ticket/multa
 * queda hasheada, no solo guardada. */
async function sha256DeArchivo(file) {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function GastosViajeSection({ viajeId, choferId = null, vehiculoId = null }) {
  const [gastos, setGastos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(initForm(choferId));
  const [guardando, setGuardando] = useState(false);
  const [borrandoId, setBorrandoId] = useState(null);
  const [error, setError] = useState(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [abriendoId, setAbriendoId] = useState(null);

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
      let fotoUrl = null;
      let fotoHash = null;
      if (form.foto) {
        setSubiendoFoto(true);
        const empresaId = await getCurrentEmpresaId();
        const ext = form.foto.name.split(".").pop() || "jpg";
        const path = `${empresaId}/gasto/${viajeId}/${crypto.randomUUID()}.${ext}`;
        fotoHash = await sha256DeArchivo(form.foto);
        const { error: uploadErr } = await supabase.storage
          .from("documentos")
          .upload(path, form.foto, { contentType: form.foto.type || undefined });
        if (uploadErr) throw uploadErr;
        fotoUrl = path;
        setSubiendoFoto(false);
      }
      await createGastoViaje({
        viajeId,
        tipo: form.tipo,
        importe: parseFloat(form.importe),
        litros: form.tipo === "repostaje" && form.litros ? parseFloat(form.litros) : null,
        descripcion: form.descripcion.trim() || null,
        fecha: form.fecha || null,
        choferId: form.choferId || null,
        vehiculoId,
        fotoUrl,
        fotoHash,
      });
      setForm(initForm(choferId));
      setMostrarForm(false);
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
      setSubiendoFoto(false);
    }
  }

  async function borrar(id, g) {
    if (borrandoId) return;
    setBorrandoId(id);
    if (g?.foto_url) {
      await supabase.storage.from("documentos").remove([g.foto_url]);
    }
    await deleteGastoViaje(id);
    await cargar();
    setBorrandoId(null);
  }

  async function verFoto(g) {
    if (!g.foto_url || abriendoId) return;
    setAbriendoId(g.id);
    try {
      const { data, error: err } = await supabase.storage
        .from("documentos")
        .createSignedUrl(g.foto_url, SIGNED_URL_TTL);
      if (err || !data?.signedUrl) return;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } finally {
      setAbriendoId(null);
    }
  }

  const total = gastos.reduce((s, g) => s + Number(g.importe), 0);
  const porTipo = TIPOS.map((t) => ({ tipo: t, total: gastos.filter((g) => g.tipo === t).reduce((s, g) => s + Number(g.importe), 0) })).filter((x) => x.total > 0);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-ink">Gastos</h2>
        <RequireRol roles={["admin", "gestor_operativo"]}>
          <button
            onClick={() => setMostrarForm((v) => !v)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-brand text-white"
          >
            <Plus size={13} /> Añadir gasto
          </button>
        </RequireRol>
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
          <div className="mb-3">
            <label htmlFor="gasto-foto" className="block text-xs text-ink-secondary mb-1">
              Foto del ticket/multa (opcional)
            </label>
            <input
              id="gasto-foto"
              type="file"
              accept="image/*"
              onChange={(e) => setForm((f) => ({ ...f, foto: e.target.files?.[0] || null }))}
              className="w-full text-xs text-ink-secondary file:mr-2 file:text-xs file:px-2 file:py-1.5 file:rounded-md file:border file:border-border file:bg-surface"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setMostrarForm(false)} className="text-xs px-3 py-2 rounded-md border border-border text-ink-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="text-xs px-3 py-2 rounded-md bg-brand text-white disabled:opacity-40">
              {guardando ? (subiendoFoto ? "Subiendo foto…" : "Guardando…") : "Guardar"}
            </button>
          </div>
        </form>
      )}

      <div className="p-4">
        {loading ? (
          <div className="h-16 bg-border rounded-lg animate-pulse" />
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
                  <span className="font-medium text-ink shrink-0">{fmtEur(Number(g.importe))}</span>
                  {g.foto_url && (
                    <button
                      onClick={() => verFoto(g)}
                      disabled={abriendoId === g.id}
                      aria-label="Ver foto del gasto"
                      title="Ver foto adjunta"
                      className="p-1 text-ink-muted hover:text-brand disabled:opacity-40 shrink-0"
                    >
                      <ImageIcon size={13} />
                    </button>
                  )}
                  <RequireRol roles={["admin", "gestor_operativo"]}>
                    <button
                      onClick={() => borrar(g.id, g)}
                      disabled={borrandoId === g.id}
                      aria-label="Borrar gasto"
                      className="p-1 text-ink-muted hover:text-estado-incidencia disabled:opacity-40 shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </RequireRol>
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
              <span key={p.tipo}>{TIPO_LABEL[p.tipo]}: {fmtEur(p.total)}</span>
            ))}
          </div>
          <div className="font-medium text-ink">Total gastos: {fmtEur(total)}</div>
        </div>
      )}
    </div>
  );
}
