"use client";

import { RefreshCw } from "lucide-react";

/** Ítem 9.34/9.35 — decisión del usuario (2026-07-12): un fallo real de
 * lectura debe verse como un AVISO VISIBLE con botón de reintentar, distinto
 * de "sin datos" (vacío legítimo). Componente compartido para no reinventar
 * el patrón en cada página que llame a una de las funciones financieras. */
export default function ErrorCargaReintentar({ mensaje = "No se pudo cargar. Puede ser un problema de conexión.", onReintentar }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 text-xs px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-estado-incidencia"
    >
      <span>{mensaje}</span>
      <button
        onClick={onReintentar}
        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-estado-incidencia text-estado-incidencia hover:bg-red-100"
      >
        <RefreshCw size={12} /> Reintentar
      </button>
    </div>
  );
}
