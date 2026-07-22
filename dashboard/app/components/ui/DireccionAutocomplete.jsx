"use client";

import { useState, useMemo, useRef, useEffect } from "react";

/**
 * Input de dirección con sugerencias de direcciones ya usadas antes por la
 * empresa (2026-07-22). A diferencia de `Buscador`, aquí SIEMPRE se puede
 * escribir texto libre (una dirección nueva que nunca se ha usado) — las
 * sugerencias son una ayuda, no una lista cerrada. Elegir una sugerencia
 * rellena lat/lon a la vez que la dirección, para no tener que teclearlas.
 */
export default function DireccionAutocomplete({ value, onChangeDireccion, onElegirSugerida, direcciones, placeholder }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function fuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  const sugeridas = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return direcciones.filter((d) => d.direccion.toLowerCase().includes(q)).slice(0, 6);
  }, [direcciones, value]);

  return (
    <div ref={ref} className="relative flex-1">
      <input
        value={value}
        onChange={(e) => { onChangeDireccion(e.target.value); setAbierto(true); }}
        onFocus={() => setAbierto(true)}
        placeholder={placeholder}
        maxLength={500}
        className="w-full text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:border-brand"
      />
      {abierto && sugeridas.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-surface border border-border rounded-md shadow-lg">
          {sugeridas.map((d, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { onElegirSugerida(d); setAbierto(false); }}
              className="w-full text-left text-xs px-3 py-2 hover:bg-surface-alt text-ink-secondary"
            >
              {d.direccion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
