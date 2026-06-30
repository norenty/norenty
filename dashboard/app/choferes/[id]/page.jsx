"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Copy, Check, Star, Truck, ChevronDown, MessageSquare,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";

const IDIOMA_LABEL = { es: "ES", ro: "RO", ar: "AR", fr: "FR", it: "IT", en: "EN", pt: "PT", de: "DE" };
const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME;
const ESTADO_LABEL = {
  planificado: { t: "Planificado", c: "text-estado-planificado", bg: "bg-blue-50" },
  en_curso: { t: "En curso", c: "text-estado-en-curso", bg: "bg-indigo-50" },
  completado: { t: "Completado", c: "text-estado-ok", bg: "bg-green-50" },
  cancelado: { t: "Cancelado", c: "text-ink-muted", bg: "bg-gray-100" },
};
const PAGE = 20;

export default function ChoferDetalle() {
  const { id } = useParams();
  const [chofer, setChofer] = useState(null);
  const [viajes, setViajes] = useState([]);
  const [valoraciones, setValoraciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMas, setLoadingMas] = useState(false);
  const [hayMas, setHayMas] = useState(false);
  const [offset, setOffset] = useState(0);
  const [copiado, setCopiado] = useState(false);

  const fetchViajes = useCallback(async (off, append = false) => {
    const { data } = await supabase
      .from("viaje")
      .select("id, referencia, estado, created_at, hito(id, estado)")
      .eq("chofer_id", id)
      .order("created_at", { ascending: false })
      .range(off, off + PAGE);

    const rows = data || [];
    const mas = rows.length > PAGE;
    const slice = mas ? rows.slice(0, PAGE) : rows;

    setHayMas(mas);
    setViajes((prev) => append ? [...prev, ...slice] : slice);
  }, [id]);

  useEffect(() => {
    async function load() {
      const { data: c } = await supabase
        .from("chofer")
        .select("*")
        .eq("id", id)
        .single();
      setChofer(c);

      const { data: v } = await supabase
        .from("valoracion")
        .select("*")
        .eq("chofer_id", id)
        .order("created_at", { ascending: false })
        .limit(5);
      setValoraciones(v || []);

      await fetchViajes(0, false);
      setLoading(false);
    }
    load();
  }, [id, fetchViajes]);

  async function cargarMas() {
    const nuevoOffset = offset + PAGE;
    setOffset(nuevoOffset);
    setLoadingMas(true);
    await fetchViajes(nuevoOffset, true);
    setLoadingMas(false);
  }

  function copiarEnlace() {
    if (!chofer || !BOT) return;
    navigator.clipboard.writeText(`https://t.me/${BOT}?start=${chofer.id}`);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  const mediaValoracion = valoraciones.length
    ? (valoraciones.reduce((s, v) => s + (v.puntuacion || 0), 0) / valoraciones.length).toFixed(1)
    : null;

  const viajesCompletados = viajes.filter((v) => v.estado === "completado").length;

  if (loading) {
    return (
      <div className="max-w-3xl space-y-4">
        <div className="h-24 bg-surface-alt rounded-xl animate-pulse" />
        <div className="h-48 bg-surface-alt rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!chofer) {
    return (
      <div className="max-w-3xl">
        <Link href="/choferes" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary mb-4 no-underline hover:text-ink">
          <ArrowLeft size={16} /> Chóferes
        </Link>
        <p className="text-sm text-ink-secondary">Chófer no encontrado.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link href="/choferes" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary mb-4 no-underline hover:text-ink">
        <ArrowLeft size={16} /> Chóferes
      </Link>

      {/* Cabecera */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-estado-en-curso flex items-center justify-center text-base font-semibold shrink-0">
            {chofer.nombre.split(" ").map((w) => w[0]).join("").slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h1 className="text-lg font-medium text-ink">{chofer.nombre}</h1>
              <span className="font-mono text-xs px-1.5 py-0.5 rounded-full bg-surface-alt text-ink-secondary">
                {IDIOMA_LABEL[chofer.idioma] || chofer.idioma}
              </span>
            </div>
            {chofer.chat_id ? (
              <div className="flex items-center gap-1.5 text-xs text-estado-ok">
                <MessageSquare size={13} /> Vinculado a Telegram
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-muted">○ Sin vincular a Telegram</span>
                {BOT && (
                  <button
                    onClick={copiarEnlace}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
                  >
                    {copiado ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar enlace</>}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            {mediaValoracion && (
              <div className="flex items-center gap-1 text-yellow-500 text-sm font-medium">
                <Star size={15} fill="currentColor" /> {mediaValoracion}
              </div>
            )}
            <div className="text-xs text-ink-muted mt-0.5">{viajes.length} viajes cargados</div>
          </div>
        </div>
      </div>

      {/* Valoraciones recientes */}
      {valoraciones.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-4 mb-4">
          <h2 className="text-sm font-medium text-ink mb-3 flex items-center gap-2">
            <Star size={15} className="text-yellow-500" /> Valoraciones recientes
          </h2>
          <div className="flex flex-col gap-2">
            {valoraciones.map((v) => (
              <div key={v.id} className="flex items-start gap-3">
                <div className="flex gap-0.5 shrink-0 mt-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      size={12}
                      className={s <= v.puntuacion ? "text-yellow-400 fill-yellow-400" : "text-border"}
                    />
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  {v.comentario && (
                    <p className="text-xs text-ink-secondary">{v.comentario}</p>
                  )}
                  <span className="text-xs text-ink-muted">
                    {new Date(v.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historial de viajes */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-ink flex items-center gap-2">
            <Truck size={15} /> Historial de viajes
          </h2>
          <span className="text-xs text-ink-muted">{viajesCompletados} completados</span>
        </div>

        {viajes.length === 0 ? (
          <p className="text-sm text-ink-secondary p-4 text-center">Sin viajes asignados.</p>
        ) : (
          <>
            {viajes.map((v) => {
              const e = ESTADO_LABEL[v.estado] || ESTADO_LABEL.planificado;
              const total = (v.hito || []).length;
              const completados = (v.hito || []).filter((h) => h.estado === "completado").length;
              return (
                <Link
                  key={v.id}
                  href={`/viajes/${v.id}`}
                  className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 no-underline hover:bg-surface-alt transition-colors"
                >
                  <span className="font-mono text-sm text-ink w-28 shrink-0">{v.referencia || v.id.slice(0, 8)}</span>
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <div className="flex-1 h-1.5 bg-surface-alt rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full"
                        style={{ width: total ? `${(completados / total) * 100}%` : "0%" }}
                      />
                    </div>
                    <span className="text-xs text-ink-muted">{completados}/{total}</span>
                  </div>
                  <span className="text-xs text-ink-muted shrink-0">
                    {new Date(v.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${e.bg} ${e.c} shrink-0`}>{e.t}</span>
                </Link>
              );
            })}
            {hayMas && (
              <div className="p-3 text-center border-t border-border">
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
    </div>
  );
}
