"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { getSugerenciaCalibracion } from "../../lib/data";
import RequireRol from "./RequireRol";

/** Sugerencia de calibración (ítem 10.9b) — SIEMPRE suggestion-only: solo
 * PRELLENA los campos de velocidad/coste con el valor real observado; quien
 * decide si guardarlo es el gestor, pulsando el botón "Guardar" que ya existe
 * en cada sección (nunca se aplica sola). Ver ROADMAP.md 10.9 para el
 * principio rector ("el sistema aprende de su propia verdad, pero cada
 * ajuste se ofrece como sugerencia transparente, nunca mutación silenciosa"). */
export default function CalibracionSugerenciaSection({ onSugerirVelocidad, onSugerirCosteKm, onSugerirGasoil, onSugerirPeaje, onSugerirDieta }) {
  const [sugerencia, setSugerencia] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSugerenciaCalibracion()
      .then(setSugerencia)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!sugerencia?.suficiente) {
    return (
      <RequireRol roles={["admin"]}>
        <p className="text-xs text-ink-muted mb-4">
          Calibración automática: hacen falta {sugerencia?.minimoViajes ?? 20} viajes completos
          con datos suficientes (llevas {sugerencia?.numViajesConDatos ?? 0}) para poder
          comparar tus valores configurados con los reales.
        </p>
      </RequireRol>
    );
  }

  const { velocidad, costeKm, gasoil, peaje, dieta, numViajesConDatos } = sugerencia;
  const hayAlgunaSugerencia = velocidad.sugerir || costeKm.sugerir || gasoil?.sugerir || peaje?.sugerir || dieta?.sugerir;
  if (!hayAlgunaSugerencia) {
    return (
      <RequireRol roles={["admin"]}>
        <p className="text-xs text-estado-ok mb-4">
          ✓ Tus valores configurados coinciden con lo que dicen tus últimos {numViajesConDatos} viajes
          (velocidad y coste/km reales dentro de lo esperado).
        </p>
      </RequireRol>
    );
  }

  return (
    <RequireRol roles={["admin"]}>
      <div className="bg-surface border border-brand/30 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-brand" />
          <h3 className="text-sm font-medium text-ink">Sugerencia de calibración</h3>
        </div>
        <p className="text-xs text-ink-secondary mb-3">
          Basado en tus últimos {numViajesConDatos} viajes completos. Solo prellena los campos
          de abajo — tú decides si guardarlos.
        </p>
        <div className="flex flex-col gap-2">
          {velocidad.sugerir && (
            <div className="flex items-center justify-between text-xs bg-surface-alt rounded-md px-3 py-2">
              <span>
                Tu velocidad real media es <strong>{velocidad.real} km/h</strong>, no los{" "}
                {velocidad.configurada} km/h configurados.
              </span>
              <button
                onClick={() => onSugerirVelocidad?.(velocidad.real)}
                className="shrink-0 ml-2 text-xs px-2 py-1 rounded-md border border-brand text-brand hover:bg-brand/10"
              >
                Usar {velocidad.real} km/h
              </button>
            </div>
          )}
          {costeKm.sugerir && (
            <div className="flex items-center justify-between text-xs bg-surface-alt rounded-md px-3 py-2">
              <span>
                Tu coste/km real medio es <strong>{costeKm.real} €/km</strong>, no los{" "}
                {costeKm.configurado} €/km configurados.
              </span>
              <button
                onClick={() => onSugerirCosteKm?.(costeKm.real)}
                className="shrink-0 ml-2 text-xs px-2 py-1 rounded-md border border-brand text-brand hover:bg-brand/10"
              >
                Usar {costeKm.real} €/km
              </button>
            </div>
          )}
          {gasoil?.sugerir && (
            <div className="flex items-center justify-between text-xs bg-surface-alt rounded-md px-3 py-2">
              <span>
                Tu gasoil real medio (facturas de repostaje) es <strong>{gasoil.real} €/l</strong>, no
                los {gasoil.configurado} €/l configurados.
              </span>
              <button
                onClick={() => onSugerirGasoil?.(gasoil.real)}
                className="shrink-0 ml-2 text-xs px-2 py-1 rounded-md border border-brand text-brand hover:bg-brand/10"
              >
                Usar {gasoil.real} €/l
              </button>
            </div>
          )}
          {peaje?.sugerir && (
            <div className="flex items-center justify-between text-xs bg-surface-alt rounded-md px-3 py-2">
              <span>
                Tu peaje real medio es <strong>{peaje.real} €/km</strong>, no los{" "}
                {peaje.configurado} €/km configurados.
              </span>
              <button
                onClick={() => onSugerirPeaje?.(peaje.real)}
                className="shrink-0 ml-2 text-xs px-2 py-1 rounded-md border border-brand text-brand hover:bg-brand/10"
              >
                Usar {peaje.real} €/km
              </button>
            </div>
          )}
          {dieta?.sugerir && (
            <div className="flex items-center justify-between text-xs bg-surface-alt rounded-md px-3 py-2">
              <span>
                Tu dieta real media es <strong>{dieta.real} €/noche</strong>, no los{" "}
                {dieta.configurado} €/noche configurados.
              </span>
              <button
                onClick={() => onSugerirDieta?.(dieta.real)}
                className="shrink-0 ml-2 text-xs px-2 py-1 rounded-md border border-brand text-brand hover:bg-brand/10"
              >
                Usar {dieta.real} €/noche
              </button>
            </div>
          )}
        </div>
      </div>
    </RequireRol>
  );
}
