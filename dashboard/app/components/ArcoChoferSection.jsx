"use client";

import { useState } from "react";
import { Download, ShieldOff } from "lucide-react";
import { getExportacionChofer, anonimizarChofer } from "../../lib/data";
import RequireRol from "./RequireRol";
import SectionCard from "./ui/SectionCard";

/** Pantalla de derechos ARCO (ítem 9.41b) — exportar/anonimizar datos de un
 * chófer sin pasar por la consola del navegador. Reutiliza
 * getExportacionChofer/anonimizarChofer (9.15), ya testeadas; ver
 * PRIVACIDAD-ARCO.md para qué se anonimiza y qué NO se toca (y por qué). */
export default function ArcoChoferSection({ choferId, choferNombre, onAnonimizado }) {
  const [exportando, setExportando] = useState(false);
  const [anonimizando, setAnonimizando] = useState(false);
  const [error, setError] = useState(null);

  async function exportar() {
    if (exportando) return;
    setExportando(true);
    setError(null);
    try {
      const datos = await getExportacionChofer(choferId);
      const blob = new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `exportacion-chofer-${choferId.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExportando(false);
    }
  }

  async function anonimizar() {
    if (anonimizando) return;
    const confirmado = window.confirm(
      `¿Anonimizar a ${choferNombre}? Esto es IRREVERSIBLE.\n\n` +
      "Se borrarán sus documentos (licencia/CAP) y se sustituirá su nombre/teléfono.\n\n" +
      "NO se tocan (por diseño, ver PRIVACIDAD-ARCO.md): el registro de ejecución de viajes " +
      "(hash-chain), los POD, las valoraciones ni las decisiones de asignación — son evidencia " +
      "de la operación de la empresa, no solo datos del chófer.\n\n" +
      "Su vínculo de Telegram y su historial de ubicación requieren un paso manual aparte " +
      "(ver PRIVACIDAD-ARCO.md §3) — esto NO los borra."
    );
    if (!confirmado) return;

    setAnonimizando(true);
    setError(null);
    try {
      await anonimizarChofer(choferId);
      onAnonimizado?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setAnonimizando(false);
    }
  }

  return (
    <RequireRol roles={["admin"]}>
      <SectionCard variant="plain" title="Derechos ARCO">
        <p className="text-xs text-ink-secondary mb-3">
          Acceso, rectificación, cancelación y oposición sobre los datos de este chófer. Ver{" "}
          <span className="font-mono">PRIVACIDAD-ARCO.md</span> para el detalle de qué se
          incluye y qué limitaciones tiene cada acción.
        </p>

        {error && (
          <p role="alert" className="text-xs text-estado-incidencia mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportar}
            disabled={exportando}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
          >
            <Download size={13} /> {exportando ? "Exportando…" : "Exportar datos (acceso)"}
          </button>
          <button
            onClick={anonimizar}
            disabled={anonimizando}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border border-border text-estado-incidencia hover:bg-red-50 disabled:opacity-40"
          >
            <ShieldOff size={13} /> {anonimizando ? "Anonimizando…" : "Anonimizar (cancelación/oposición)"}
          </button>
        </div>
      </SectionCard>
    </RequireRol>
  );
}
