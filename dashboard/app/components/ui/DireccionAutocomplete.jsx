"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { MapPin, History, Loader2 } from "lucide-react";
import { buscarDireccion } from "../../../lib/data";

/**
 * Input de dirección con dos fuentes de sugerencias:
 *
 *  1. Direcciones que la empresa YA ha usado antes (instantáneo, sale de los
 *     hitos pasados que ya están en la BD). Van primero a propósito: si el
 *     gestor va otra vez al almacén de siempre, esa es la respuesta buena.
 *  2. Búsqueda en el mapa vía Nominatim/OpenStreetMap (18.D.2) para direcciones
 *     nuevas. Antes de esto, una dirección no usada nunca obligaba a teclear
 *     latitud y longitud a mano — inusable en la práctica.
 *
 * Escribir texto libre sigue estando permitido (a diferencia de `Buscador`):
 * las sugerencias ayudan, no encierran. Elegir cualquiera de las dos rellena
 * lat/lon a la vez que la dirección.
 */
export default function DireccionAutocomplete({ value, onChangeDireccion, onElegirSugerida, direcciones, placeholder }) {
  const [abierto, setAbierto] = useState(false);
  const [resultadosMapa, setResultadosMapa] = useState([]);
  const [buscando, setBuscando] = useState(false);
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

  // Debounce largo (600 ms) y mínimo de 4 caracteres: Nominatim es un servicio
  // público y gratuito, no se le puede disparar una petición por tecla.
  useEffect(() => {
    const q = value.trim();
    if (!abierto || q.length < 4) {
      setResultadosMapa([]);
      setBuscando(false);
      return;
    }
    let cancelado = false;
    setBuscando(true);
    const t = setTimeout(async () => {
      const r = await buscarDireccion(q);
      if (cancelado) return;
      setResultadosMapa(r);
      setBuscando(false);
    }, 600);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [value, abierto]);

  // No repetir en "del mapa" una dirección que ya está en "usadas antes".
  const yaUsadas = new Set(sugeridas.map((d) => d.direccion.toLowerCase()));
  const delMapa = resultadosMapa.filter((d) => !yaUsadas.has(d.direccion.toLowerCase())).slice(0, 5);

  function elegir(d) {
    onElegirSugerida(d);
    setAbierto(false);
    setResultadosMapa([]);
  }

  const hayAlgoQueMostrar = sugeridas.length > 0 || delMapa.length > 0 || buscando;

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
      {abierto && hayAlgoQueMostrar && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-surface border border-border rounded-md shadow-lg">
          {sugeridas.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-ink-muted flex items-center gap-1">
                <History size={11} /> Ya usadas antes
              </div>
              {sugeridas.map((d, i) => (
                <button
                  key={`prev-${i}`}
                  type="button"
                  onClick={() => elegir(d)}
                  className="w-full text-left text-xs px-3 py-2 hover:bg-surface-alt text-ink-secondary"
                >
                  {d.direccion}
                </button>
              ))}
            </>
          )}
          {(delMapa.length > 0 || buscando) && (
            <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-ink-muted flex items-center gap-1">
              {buscando ? <Loader2 size={11} className="animate-spin" /> : <MapPin size={11} />}
              {buscando ? "Buscando en el mapa…" : "Del mapa"}
            </div>
          )}
          {delMapa.map((d, i) => (
            <button
              key={`geo-${i}`}
              type="button"
              onClick={() => elegir(d)}
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
