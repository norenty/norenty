"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { supabase } from "../../lib/supabase";

export default function RatingControl({ choferId, viajeId, valoraciones, onSaved }) {
  const ultima = valoraciones?.[0];
  const [puntuacion, setPuntuacion] = useState(ultima?.puntuacion || 0);
  const [hover, setHover] = useState(0);
  const [nota, setNota] = useState(ultima?.nota || "");
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  async function guardar() {
    if (!puntuacion || !choferId) return;
    setGuardando(true);
    await supabase.from("valoracion").insert({
      chofer_id: choferId,
      viaje_id: viajeId,
      puntuacion,
      nota: nota || null,
    });
    setGuardando(false);
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2500);
    onSaved && onSaved();
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <h3 className="text-sm font-medium text-ink mb-1">Valoración del chófer</h3>
      <p className="text-xs text-ink-secondary mb-3">
        Tu criterio sobre cómo ha ido este viaje (1 a 5).
      </p>

      <div className="flex gap-1 mb-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setPuntuacion(n)}
            className="p-0.5"
            aria-label={`${n} estrellas`}
          >
            <Star
              size={24}
              className={
                n <= (hover || puntuacion)
                  ? "text-estado-riesgo fill-estado-riesgo"
                  : "text-border-strong"
              }
            />
          </button>
        ))}
      </div>

      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Nota opcional (puntualidad, trato, estado de la carga…)"
        rows={2}
        className="w-full text-sm border border-border rounded-md p-2 mb-3 resize-none focus:outline-none focus:border-brand"
      />

      <button
        onClick={guardar}
        disabled={!puntuacion || guardando}
        className="text-sm px-3 py-1.5 rounded-md bg-brand text-white font-medium disabled:opacity-40 transition-opacity"
      >
        {guardando ? "Guardando…" : guardado ? "Guardado ✓" : "Guardar valoración"}
      </button>

      {valoraciones && valoraciones.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="text-xs text-ink-muted mb-2">Histórico</div>
          {valoraciones.map((v) => (
            <div key={v.id} className="flex items-center gap-2 text-xs mb-1">
              <span className="font-mono text-estado-riesgo">
                {"★".repeat(v.puntuacion)}
                <span className="text-border-strong">
                  {"★".repeat(5 - v.puntuacion)}
                </span>
              </span>
              {v.nota && <span className="text-ink-secondary">{v.nota}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
