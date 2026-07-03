"use client";

import { useEffect, useState } from "react";
import { sugerirChofer, registrarDecisionAsignacion } from "../../lib/data";

/**
 * Ranking de chóferes sugeridos para un viaje, con el porqué de cada score
 * visible. La decisión es siempre del gestor: al asignar una fila que NO es
 * la sugerida (mayor score), se pide un motivo opcional — es el registro que
 * alimenta el aprendizaje futuro (7B.7), no un candado.
 */
export default function SugerenciaChofer({ viajeId, onAsignado }) {
  const [ranking, setRanking] = useState(null);
  const [pendiente, setPendiente] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [asignando, setAsignando] = useState(false);

  useEffect(() => {
    let activo = true;
    if (!viajeId) return;
    setRanking(null);
    sugerirChofer(viajeId).then((r) => {
      if (activo) setRanking(r);
    });
    return () => {
      activo = false;
    };
  }, [viajeId]);

  if (!viajeId) return null;

  if (!ranking) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-surface-alt rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (ranking.length === 0) {
    return <p className="text-xs text-ink-muted">No hay chóferes dados de alta todavía.</p>;
  }

  const top = ranking[0];

  async function confirmarAsignacion(fila, motivoTexto) {
    setAsignando(true);
    try {
      await onAsignado(fila.chofer.id);
      await registrarDecisionAsignacion({
        viajeId,
        choferSugeridoId: top.chofer.id,
        scoreSugerido: top.score,
        choferElegidoId: fila.chofer.id,
        scoreElegido: fila.score,
        motivo: motivoTexto || null,
      });
      setPendiente(null);
      setMotivo("");
    } finally {
      setAsignando(false);
    }
  }

  function handleAsignar(fila) {
    if (fila.chofer.id === top.chofer.id) {
      confirmarAsignacion(fila, null);
    } else {
      setPendiente(fila);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-ink-secondary">Sugerencia de asignación</h3>
      {ranking.slice(0, 5).map((fila) => (
        <div
          key={fila.chofer.id}
          className="flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-2"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">{fila.chofer.nombre}</span>
              {fila.chofer.idioma && (
                <span className="text-xs text-ink-muted">{fila.chofer.idioma.toUpperCase()}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {fila.razones.map((r, i) => (
                <span key={i} className="text-xs bg-surface-alt rounded-full px-2 py-0.5 text-ink-secondary">
                  {r}
                </span>
              ))}
              {fila.bloqueos.map((b, i) => (
                <span key={`b${i}`} className="text-xs bg-red-50 text-estado-incidencia rounded-full px-2 py-0.5">
                  {b}
                </span>
              ))}
            </div>
          </div>
          <div className="text-lg font-semibold text-ink shrink-0">{fila.score}</div>
          <button
            onClick={() => handleAsignar(fila)}
            disabled={asignando}
            className="text-xs px-3 py-1.5 rounded-md bg-brand text-white disabled:opacity-40 shrink-0"
          >
            Asignar
          </button>
        </div>
      ))}

      {pendiente && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex flex-col gap-2">
          <p className="text-xs text-yellow-800">
            ¿Por qué {pendiente.chofer.nombre} y no {top.chofer.nombre} (sugerido)? (opcional)
          </p>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (opcional)"
            className="text-sm border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <div className="flex gap-2">
            <button
              onClick={() => confirmarAsignacion(pendiente, motivo)}
              disabled={asignando}
              className="text-xs px-3 py-1.5 rounded-md bg-brand text-white disabled:opacity-40"
            >
              {motivo ? "Guardar y asignar" : "Confirmar sin motivo"}
            </button>
            <button
              onClick={() => { setPendiente(null); setMotivo(""); }}
              disabled={asignando}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-ink-secondary disabled:opacity-40"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
