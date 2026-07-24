"use client";

import { useEffect, useState, useCallback } from "react";
import { MessageSquareText, Mic, Play } from "lucide-react";
import { getContexto } from "../../lib/data";
import { supabase } from "../../lib/supabase";
import { fmtFechaHora } from "../../lib/format";
import SectionCard from "./ui/SectionCard";

/**
 * Feed de contexto del viaje (11.2) — la capa de datos existía desde la Fase 11
 * pero nunca tuvo UI, así que el conocimiento capturado era invisible para el
 * gestor. Lo estrena la nota de voz del chófer (11.3, Nivel 1 de la escalera de
 * captura): un audio anclado al viaje que el gestor puede escuchar aquí.
 *
 * Sin transcripción todavía (gated por deploy + 11.5): las notas de voz muestran
 * el reproductor y el marcador de "sin transcribir". Cuando Whisper corra
 * retroactivamente sobre los audios ya guardados, `texto` pasará a traer la
 * transcripción real y se pintará aquí sin tocar este componente.
 */
const SIGNED_URL_TTL = 60;

const CANAL_LABEL = {
  nota_manual: "Nota",
  email: "Email",
  llamada_transcrita: "Llamada",
  whatsapp: "WhatsApp",
  nota_voz: "Nota de voz",
};

export default function ContextoViajeSection({ viajeId }) {
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [abriendoId, setAbriendoId] = useState(null);

  const cargar = useCallback(async () => {
    const datos = await getContexto("viaje", viajeId);
    setFilas(datos);
  }, [viajeId]);

  useEffect(() => {
    setLoading(true);
    cargar().finally(() => setLoading(false));
  }, [cargar]);

  async function escuchar(fila) {
    if (!fila.audio_url || abriendoId) return;
    setAbriendoId(fila.id);
    try {
      const { data, error } = await supabase.storage
        .from("pods")
        .createSignedUrl(fila.audio_url, SIGNED_URL_TTL);
      if (error || !data?.signedUrl) return;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } finally {
      setAbriendoId(null);
    }
  }

  if (loading) {
    return <div className="bg-border rounded-xl h-24 animate-pulse" />;
  }

  if (filas.length === 0) return null;

  return (
    <SectionCard title="Contexto del viaje" icon={MessageSquareText}>
      <div className="flex flex-col gap-3">
        {filas.map((f) => (
          <div key={f.id} className="border-b border-border last:border-0 pb-3 last:pb-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-alt text-ink-secondary flex items-center gap-1">
                {f.canal === "nota_voz" && <Mic size={11} />}
                {CANAL_LABEL[f.canal] || f.canal}
              </span>
              <span className="text-xs text-ink-muted">{fmtFechaHora(f.ocurrido_en)}</span>
              {(f.gestor?.nombre || f.autor_externo) && (
                <span className="text-xs text-ink-muted">
                  · {f.gestor?.nombre || f.autor_externo}
                </span>
              )}
            </div>
            {f.audio_url && (
              <button
                onClick={() => escuchar(f)}
                disabled={abriendoId === f.id}
                className="text-xs px-2.5 py-1.5 mb-1 rounded-md border border-border text-brand hover:bg-surface-alt disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                <Play size={12} /> {abriendoId === f.id ? "Abriendo…" : "Escuchar"}
              </button>
            )}
            <p className="text-xs text-ink-secondary">{f.texto}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
