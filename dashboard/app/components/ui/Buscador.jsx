"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Search } from "lucide-react";

/**
 * Combobox de búsqueda por texto sobre una lista de opciones (2026-07-22,
 * hallazgo real en el primer smoke test: con flotas de cientos de vehículos/
 * chóferes, un `<select>` nativo o un ranking de 5 no basta — hace falta
 * poder escribir para filtrar entre TODAS las opciones).
 *
 * Genérico a propósito: recibe `opciones` como `{value, label, sublabel}[]`
 * (sublabel = el identificador diferenciador, ej. matrícula, para no
 * confundir vehículos del mismo modelo) y filtra por substring en label+
 * sublabel, sin distinguir mayúsculas/acentos exactos (match simple, no
 * hace falta más para listas de cientos, no miles).
 */
export default function Buscador({ opciones, value, onChange, placeholder = "Buscar...", vacioLabel = "Sin asignar" }) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);
  const inputRef = useRef(null);

  const seleccionado = opciones.find((o) => o.value === value) || null;

  useEffect(() => {
    function fuera(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  const filtradas = useMemo(() => {
    const q = texto.trim().toLowerCase();
    if (!q) return opciones;
    return opciones.filter((o) =>
      o.label.toLowerCase().includes(q) || (o.sublabel || "").toLowerCase().includes(q)
    );
  }, [opciones, texto]);

  function elegir(opcion) {
    onChange(opcion ? opcion.value : "");
    setTexto("");
    setAbierto(false);
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          ref={inputRef}
          value={abierto ? texto : (seleccionado ? `${seleccionado.label}${seleccionado.sublabel ? " · " + seleccionado.sublabel : ""}` : "")}
          onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
          onFocus={(e) => {
            // Muestra el texto ya elegido y lo selecciona entero (2026-07-22,
            // hallazgo real: vaciar el campo a "" en el propio onFocus dejaba un
            // instante visual con el cursor cayendo en medio del texto viejo antes
            // de que React repintara vacío). Con select-all, la primera tecla que
            // se escriba reemplaza todo al momento, sin ese parpadeo, y mientras
            // tanto se ve claramente lo que ya había seleccionado.
            setTexto(seleccionado ? `${seleccionado.label}${seleccionado.sublabel ? " · " + seleccionado.sublabel : ""}` : "");
            setAbierto(true);
            requestAnimationFrame(() => e.target.select());
          }}
          placeholder={placeholder}
          className="w-full text-sm border border-border rounded-md pl-8 pr-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>
      {abierto && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-surface border border-border rounded-md shadow-lg">
          <button
            type="button"
            onClick={() => elegir(null)}
            className="w-full text-left text-sm px-3 py-2 text-ink-muted hover:bg-surface-alt"
          >
            {vacioLabel}
          </button>
          {filtradas.length === 0 ? (
            <div className="text-xs text-ink-muted px-3 py-2">Sin resultados.</div>
          ) : (
            filtradas.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => elegir(o)}
                className="w-full text-left text-sm px-3 py-2 hover:bg-surface-alt flex items-center justify-between gap-2"
              >
                <span className="text-ink">{o.label}</span>
                {o.sublabel && <span className="text-xs text-ink-muted shrink-0">{o.sublabel}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
