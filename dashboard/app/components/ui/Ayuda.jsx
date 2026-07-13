"use client";

import { useState, useRef, useEffect } from "react";
import { HelpCircle } from "lucide-react";

/**
 * Botón "?" que explica un término de jerga (561, POD...) en lenguaje llano.
 * Click/tap en vez de hover: funciona igual en móvil que en escritorio, a
 * diferencia de un tooltip con solo :hover (ítem de diseño 2026-07-13).
 */
export default function Ayuda({ texto }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    function fuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-label="Ayuda"
        className="text-ink-muted hover:text-ink-secondary"
      >
        <HelpCircle size={14} />
      </button>
      {abierto && (
        <span
          role="tooltip"
          className="absolute z-20 top-full left-1/2 -translate-x-1/2 mt-1.5 w-56 text-xs font-normal normal-case text-ink bg-surface border border-border rounded-md shadow-md p-2.5"
        >
          {texto}
        </span>
      )}
    </span>
  );
}
