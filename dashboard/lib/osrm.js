// Cliente OSRM (Open Source Routing Machine) para distancia por CARRETERA REAL
// entre dos puntos, no en línea recta. Usado por el informe de nómina (ítem 5.1)
// para sumar km reales entre hitos consecutivos de un viaje.
//
// El servicio OSRM se levanta en desarrollo con docker-compose (ver
// infra/osrm/README.md). En tests NUNCA se llama al servicio real: se mockea
// `distanciaPorCarretera` o el `fetch` global. En producción el despliegue del
// contenedor OSRM queda pendiente junto con "Despliegue" (sección pospuesta).

// Configurable por entorno. `NEXT_PUBLIC_OSRM_URL` para que sea visible en el
// cliente Next.js; cae a `OSRM_URL` (server) y a localhost por defecto.
const OSRM_URL =
  (typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_OSRM_URL || process.env.OSRM_URL)) ||
  "http://localhost:5000";

/**
 * Distancia por carretera (en KILÓMETROS) entre `origen` y `destino`, ambos
 * `{ lat, lon }`. Devuelve `null` si OSRM no responde, no encuentra ruta, o
 * faltan coordenadas — nunca lanza, para que un tramo sin ruta no tumbe el
 * cálculo del informe completo (se contabiliza como 0 km ese tramo, con aviso).
 *
 * @param {{lat:number, lon:number}} origen
 * @param {{lat:number, lon:number}} destino
 * @returns {Promise<number|null>} km por carretera, o null si no se pudo calcular
 */
export async function distanciaPorCarretera(origen, destino) {
  if (
    !origen ||
    !destino ||
    origen.lat == null ||
    origen.lon == null ||
    destino.lat == null ||
    destino.lon == null
  ) {
    return null;
  }

  const coords = `${origen.lon},${origen.lat};${destino.lon},${destino.lat}`;
  const url = `${OSRM_URL}/route/v1/driving/${coords}?overview=false`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code !== "Ok" || !json.routes || !json.routes.length) return null;
    // OSRM devuelve la distancia en metros.
    return json.routes[0].distance / 1000;
  } catch {
    return null;
  }
}

export { OSRM_URL };
