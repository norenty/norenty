"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MessageCircle, Send } from "lucide-react";
import { getMensajesPorChofer, enviarMensajeChofer } from "../../lib/data";
import { fmtFechaHora } from "../../lib/format";
import { useRealtimeRefresh } from "../../lib/realtime";

/**
 * 17.G.10 (2026-07-23/24) — feedback real tras probar el primer diseño (los
 * mensajes colgaban del VIAJE): un mensaje del chófer sin viaje activo, o de
 * un viaje distinto al que el gestor tenía abierto, se perdía de vista. Esta
 * es la vista de referencia: historial COMPLETO de este chófer, cualquier
 * viaje, con quién hablas primero, no de qué viaje. Vive en `/choferes/[id]`.
 */
export default function ChatChoferSection({ choferId }) {
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const finRef = useRef(null);

  const cargar = useCallback(async () => {
    if (!choferId) return;
    setMensajes(await getMensajesPorChofer(choferId));
  }, [choferId]);

  useEffect(() => { cargar(); }, [cargar]);
  useRealtimeRefresh(["mensaje_chofer"], cargar);

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "nearest" });
  }, [mensajes.length]);

  async function enviar() {
    if (!texto.trim() || !choferId || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      // Sin viaje_id a propósito: este chat no depende de que el chófer
      // tenga un viaje activo justo ahora -- el bot lo entrega igual.
      await enviarMensajeChofer({ choferId, texto });
      setTexto("");
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  if (!choferId) return null;

  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <h3 className="text-sm font-medium text-ink mb-3 flex items-center gap-1.5">
        <MessageCircle size={15} /> Chat con el chófer
      </h3>
      {mensajes.length === 0 ? (
        <p className="text-xs text-ink-muted mb-3">Sin mensajes todavía.</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-80 overflow-y-auto mb-3">
          {mensajes.map((m) => (
            <div
              key={m.id}
              className={`text-xs px-3 py-2 rounded-lg max-w-[85%] ${
                m.direccion === "gestor_a_chofer" ? "bg-brand/10 text-ink self-end ml-auto" : "bg-surface-alt text-ink"
              }`}
            >
              <p>{m.texto}</p>
              <div className="text-[10px] text-ink-muted mt-1">
                {m.viaje?.referencia && <>{m.viaje.referencia} · </>}
                {fmtFechaHora(m.created_at)}
                {m.direccion === "gestor_a_chofer" && (m.entregado_en ? " · entregado" : " · enviando…")}
              </div>
            </div>
          ))}
          <div ref={finRef} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") enviar(); }}
          placeholder="Escribe algo para el chófer..."
          maxLength={1000}
          className="flex-1 text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
        />
        <button
          onClick={enviar}
          disabled={enviando || !texto.trim()}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
        >
          <Send size={14} /> {enviando ? "…" : "Enviar"}
        </button>
      </div>
      {error && <p className="text-xs text-estado-incidencia mt-2">{error}</p>}
    </div>
  );
}
