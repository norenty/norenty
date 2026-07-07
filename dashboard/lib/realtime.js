import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

// Debounce del refresh (ítem 9.33): sin esto, una ráfaga de N eventos de realtime
// (p.ej. varios hitos completándose seguidos, o un import masivo) relanza el callback
// N veces seguidas — cada uno potencialmente disparando un abanico de llamadas OSRM
// (getResumenHoy/getViabilidadViaje). Coalescer en una ventana corta a una sola
// llamada tras la ráfaga es suficiente: no hace falta ver cada evento individual,
// solo saber que "algo cambió" y refrescar una vez.
export const DEBOUNCE_REALTIME_MS = 800;

/** Coalesce llamadas a `fn` que llegan dentro de una ventana de `ms`: cada llamada
 * reinicia el temporizador, así que solo se ejecuta una vez, `ms` después de la
 * ÚLTIMA llamada de la ráfaga. Devuelve la función debounced y un `cancel()` para
 * limpiar el temporizador pendiente (uso: cleanup de useEffect). Pura, sin React,
 * para poder testearla sin renderizar un componente. */
export function debounce(fn, ms) {
  let timeoutId = null;
  function debounced(...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn(...args);
    }, ms);
  }
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
  };
  return debounced;
}

export function useRealtimeRefresh(tables, callback) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const refrescarDebounced = debounce(() => cbRef.current(), DEBOUNCE_REALTIME_MS);
    let channel = supabase.channel("dashboard-" + tables.join("-"));
    tables.forEach((table) => {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => refrescarDebounced()
      );
    });
    channel.subscribe();
    return () => {
      refrescarDebounced.cancel();
      supabase.removeChannel(channel);
    };
  }, [tables.join(",")]);
}
