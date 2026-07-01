"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, FileText, ExternalLink, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { getCurrentEmpresaId } from "../../lib/data";

const SIGNED_URL_TTL = 3600;

function initForm(tipos) {
  return { tipo: tipos[0]?.value || "otro", fecha_emision: "", fecha_caducidad: "", notas: "", archivo: null };
}

function badgeFor(doc) {
  if (!doc.fecha_caducidad) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const caduca = new Date(doc.fecha_caducidad + "T00:00:00");
  const dias = Math.round((caduca - hoy) / 86400000);
  if (dias < 0) return { label: "Caducado", cls: "bg-red-50 text-estado-incidencia" };
  if (dias <= 30) return { label: "Caduca pronto", cls: "bg-yellow-50 text-yellow-700" };
  return { label: "Vigente", cls: "bg-green-50 text-estado-ok" };
}

function fmtFecha(f) {
  if (!f) return null;
  return new Date(f + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Sección de documentos reutilizable (registro documental: CMR/albarán/ADR en
 * viaje, ITV/seguro/autorización en vehículo, licencia/CAP en chófer). Sube
 * archivos al bucket privado "documentos" y guarda metadatos en la tabla
 * "documento". Soporta imagen y PDF: el enlace de ver/descargar resuelve una
 * signed URL bajo demanda, no asume que sea una imagen.
 */
export default function DocumentosSection({ ambito, entidadId, tipos, titulo = "Documentos" }) {
  const [documentos, setDocumentos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState(initForm(tipos));
  const [guardando, setGuardando] = useState(false);
  const [borrandoId, setBorrandoId] = useState(null);
  const [abriendoId, setAbriendoId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("documento")
      .select("*")
      .eq("ambito", ambito)
      .eq("entidad_id", entidadId)
      .order("fecha_caducidad", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    setDocumentos(data || []);
    setLoading(false);
  }, [ambito, entidadId]);

  useEffect(() => { load(); }, [load]);

  async function guardar(e) {
    e.preventDefault();
    if (!form.tipo || !form.archivo) {
      setError("Selecciona un tipo y un archivo.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const empresaId = await getCurrentEmpresaId();
      const ext = form.archivo.name.split(".").pop() || "pdf";
      const path = `${empresaId}/${ambito}/${entidadId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("documentos")
        .upload(path, form.archivo, { contentType: form.archivo.type || undefined });
      if (uploadErr) throw uploadErr;

      const { error: insertErr } = await supabase.from("documento").insert({
        empresa_id: empresaId,
        ambito,
        entidad_id: entidadId,
        tipo: form.tipo,
        fecha_emision: form.fecha_emision || null,
        fecha_caducidad: form.fecha_caducidad || null,
        archivo_url: path,
        notas: form.notas.trim() || null,
      });
      if (insertErr) throw insertErr;

      setForm(initForm(tipos));
      setMostrarForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function verDescargar(doc) {
    if (abriendoId) return;
    setAbriendoId(doc.id);
    try {
      const { data, error: err } = await supabase.storage
        .from("documentos")
        .createSignedUrl(doc.archivo_url, SIGNED_URL_TTL);
      if (err || !data?.signedUrl) return;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } finally {
      setAbriendoId(null);
    }
  }

  async function borrar(doc) {
    if (borrandoId) return;
    setBorrandoId(doc.id);
    try {
      await supabase.storage.from("documentos").remove([doc.archivo_url]);
      await supabase.from("documento").delete().eq("id", doc.id);
      await load();
    } finally {
      setBorrandoId(null);
    }
  }

  function tipoLabel(valor) {
    return tipos.find((t) => t.value === valor)?.label || valor;
  }

  if (loading) {
    return <div className="h-32 bg-surface-alt rounded-xl animate-pulse" />;
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-ink">{titulo}</h2>
        <button
          onClick={() => setMostrarForm((v) => !v)}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-brand text-white"
        >
          <Plus size={13} /> Añadir documento
        </button>
      </div>

      {mostrarForm && (
        <form onSubmit={guardar} className="p-4 border-b border-border bg-surface-alt">
          {error && (
            <p className="text-xs text-estado-incidencia mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">{error}</p>
          )}
          <div className="mb-3">
            <label className="block text-xs text-ink-secondary mb-1">Tipo *</label>
            <select
              value={form.tipo}
              onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
            >
              {tipos.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-ink-secondary mb-1">Fecha emisión</label>
              <input
                type="date"
                value={form.fecha_emision}
                onChange={(e) => setForm((f) => ({ ...f, fecha_emision: e.target.value }))}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-secondary mb-1">Fecha caducidad</label>
              <input
                type="date"
                value={form.fecha_caducidad}
                onChange={(e) => setForm((f) => ({ ...f, fecha_caducidad: e.target.value }))}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-ink-secondary mb-1">Archivo (imagen o PDF) *</label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setForm((f) => ({ ...f, archivo: e.target.files?.[0] || null }))}
              className="w-full text-sm text-ink-secondary"
            />
          </div>
          <div className="mb-3">
            <label className="block text-xs text-ink-secondary mb-1">Notas</label>
            <input
              value={form.notas}
              onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
              placeholder="Opcional"
              maxLength={300}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand bg-surface"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setMostrarForm(false); setForm(initForm(tipos)); setError(null); }}
              className="text-xs px-3 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="text-xs px-3 py-2 rounded-md bg-brand text-white disabled:opacity-40"
            >
              {guardando ? "Subiendo…" : "Guardar"}
            </button>
          </div>
        </form>
      )}

      {documentos.length === 0 ? (
        <p className="text-sm text-ink-secondary p-6 text-center">
          Sin documentos todavía. Añade el primero con el botón de arriba.
        </p>
      ) : (
        <div>
          {documentos.map((doc) => {
            const badge = badgeFor(doc);
            return (
              <div key={doc.id} className="flex items-start gap-3 px-4 py-3 border-b border-border last:border-0">
                <div className="w-8 h-8 rounded-full bg-surface-alt flex items-center justify-center shrink-0 mt-0.5">
                  <FileText size={14} className="text-ink-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-sm font-medium text-ink">{tipoLabel(doc.tipo)}</span>
                    {badge && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    )}
                  </div>
                  {doc.notas && <p className="text-xs text-ink-secondary mb-1">{doc.notas}</p>}
                  <div className="flex gap-3 text-xs text-ink-muted flex-wrap">
                    {doc.fecha_emision && <span>Emitido: {fmtFecha(doc.fecha_emision)}</span>}
                    {doc.fecha_caducidad && <span>Caduca: {fmtFecha(doc.fecha_caducidad)}</span>}
                  </div>
                </div>
                <button
                  onClick={() => verDescargar(doc)}
                  disabled={abriendoId === doc.id}
                  className="text-ink-muted hover:text-ink disabled:opacity-40 shrink-0 p-1"
                  title="Ver / descargar"
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  onClick={() => borrar(doc)}
                  disabled={borrandoId === doc.id}
                  className="text-ink-muted hover:text-estado-incidencia disabled:opacity-40 shrink-0 p-1"
                  title="Eliminar documento"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
