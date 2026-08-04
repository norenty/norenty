"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { TIPO_PARKING_LABEL } from "../../lib/labels";
import RequireRol from "./RequireRol";

const ICON_RECOGIDA = new L.DivIcon({
  className: "",
  html: '<div style="width:28px;height:28px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:600">R</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});
const ICON_ENTREGA = new L.DivIcon({
  className: "",
  html: '<div style="width:28px;height:28px;border-radius:50%;background:#16A34A;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:600">E</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});
const ICON_CHOFER = new L.DivIcon({
  className: "",
  html: `<div style="position:relative;width:32px;height:32px">
    <div class="chofer-pulso" style="position:absolute;inset:-8px;border-radius:50%;background:#2563EB;opacity:.35"></div>
    <div style="position:relative;width:32px;height:32px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px">🚛</div>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});
// ROADMAP 21.2: chófer con una incidencia abierta -- mismo icono de camión,
// aro rojo en vez de azul, para verlo de un vistazo cruzado con su posición.
const ICON_CHOFER_INCIDENCIA = new L.DivIcon({
  className: "",
  html: `<div style="position:relative;width:32px;height:32px">
    <div class="chofer-pulso" style="position:absolute;inset:-8px;border-radius:50%;background:#DC2626;opacity:.35"></div>
    <div style="position:relative;width:32px;height:32px;border-radius:50%;background:#DC2626;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px">🚛</div>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

// Parkings: icono discreto (más pequeño que hitos/chóferes, es capa de contexto).
const ICON_PARKING = new L.DivIcon({
  className: "",
  html: '<div style="width:18px;height:18px;border-radius:4px;background:#475569;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700">P</div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});
// ROADMAP 20.4: parking propio marcado explícitamente como vigilado -- icono
// con escudo en vez de "P" para que destaque frente al resto en el mapa.
const ICON_PARKING_VIGILADO = new L.DivIcon({
  className: "",
  html: '<div style="width:20px;height:20px;border-radius:4px;background:#16A34A;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px">🛡️</div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});
const ICON_PARKING_PROPIO = new L.DivIcon({
  className: "",
  html: '<div style="width:20px;height:20px;border-radius:4px;background:#D97706;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700">P</div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// ROADMAP 21.4: sede de cliente -- icono de edificio, distinto de hitos/
// parkings/chófer para no confundir "dónde entrego" con "quién es el cliente".
const ICON_CLIENTE = new L.DivIcon({
  className: "",
  html: '<div style="width:22px;height:22px;border-radius:4px;background:#7C3AED;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px">🏢</div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
      map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 13, duration: 1.2 });
    }
  }, [points, map]);
  return null;
}

export default function MapView({ hitos, ubicaciones, parkings, clientes, rutaHitos, onBorrarParking }) {
  // Los parkings/clientes NO entran en fitBounds: son capas de contexto (miles
  // de puntos en toda Europa), no deben forzar el zoom fuera de la operación.
  // La ruta seleccionada (21.1) SÍ entra -- es justo lo que se quiere ver.
  const allPoints = [
    ...(hitos || []).filter((h) => h.lat && h.lon),
    ...(ubicaciones || []).filter((u) => u.lat && u.lon),
    ...(rutaHitos || []).filter((h) => h.lat && h.lon),
  ];
  const center = allPoints.length
    ? [allPoints[0].lat, allPoints[0].lon]
    : [40.4168, -3.7038];

  return (
    <MapContainer
      center={center}
      zoom={6}
      minZoom={3}
      maxBounds={[[20, -35], [72, 45]]}
      maxBoundsViscosity={1.0}
      worldCopyJump={false}
      style={{ width: "100%", height: "100%", borderRadius: "12px" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={allPoints} />

      {(hitos || [])
        .filter((h) => h.lat && h.lon)
        .map((h) => (
          <Marker
            key={h.id}
            position={[h.lat, h.lon]}
            icon={h.tipo === "recogida" ? ICON_RECOGIDA : ICON_ENTREGA}
          >
            <Popup>
              <div style={{ fontSize: 13 }}>
                <strong>{h.tipo === "recogida" ? "Recogida" : "Entrega"}</strong>
                <br />
                {h.direccion || "—"}
                <br />
                <span className="text-ink-secondary">{h.estado}</span>
              </div>
            </Popup>
          </Marker>
        ))}

      {(parkings || []).map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lon]}
          icon={p.vigilado === true ? ICON_PARKING_VIGILADO : p.fuente === "empresa" ? ICON_PARKING_PROPIO : ICON_PARKING}
        >
          <Popup>
            <div style={{ fontSize: 13 }}>
              <strong>{TIPO_PARKING_LABEL[p.tipo] || p.nombre}</strong>
              <br />
              {p.fuente === "empresa" ? "Parking propio de la empresa" : "Dataset abierto (Fraunhofer/OSM)"}
              <br />
              <span className={p.vigilado === true ? "text-estado-ok" : "text-ink-secondary"}>
                {p.vigilado === true ? "🛡️ Vigilado" : p.vigilado === false ? "Sin vigilancia" : "Vigilancia: desconocida"}
              </span>
              {p.confianza && (
                <>
                  <br />
                  <span className="text-ink-secondary">Confianza: {p.confianza}</span>
                </>
              )}
              {p.notas && (
                <>
                  <br />
                  <span className="text-ink-secondary">{p.notas}</span>
                </>
              )}
              {p.fuente === "empresa" && onBorrarParking && (
                <RequireRol roles={["admin", "gestor_operativo"]}>
                  <br />
                  <button
                    onClick={() => onBorrarParking(p.id)}
                    className="text-estado-incidencia underline bg-transparent border-0 cursor-pointer p-0"
                    style={{ marginTop: 6, fontSize: 12 }}
                  >
                    Eliminar
                  </button>
                </RequireRol>
              )}
            </div>
          </Popup>
        </Marker>
      ))}

      {(ubicaciones || []).map((u) => (
        <Marker key={u.id} position={[u.lat, u.lon]} icon={u.incidencia ? ICON_CHOFER_INCIDENCIA : ICON_CHOFER}>
          <Popup>
            <div style={{ fontSize: 13 }}>
              <strong>{u.chofer_nombre || "Chófer"}</strong>
              <br />
              {u.velocidad != null && `${Math.round(u.velocidad)} km/h`}
              <br />
              <span className="text-ink-secondary">
                {new Date(u.created_at).toLocaleTimeString("es-ES")}
              </span>
              {u.incidencia && (
                <>
                  <br />
                  <span className="text-estado-incidencia font-semibold">
                    ⚠ Incidencia: {u.incidencia.tipo}
                  </span>
                  <br />
                  <Link href={`/viajes/${u.incidencia.viajeId}`} className="text-brand underline">
                    Ver viaje {u.incidencia.viajeReferencia || ""} (reasignar chófer/vehículo)
                  </Link>
                </>
              )}
            </div>
          </Popup>
        </Marker>
      ))}

      {(clientes || []).map((c, i) => (
        <Marker key={`${c.clienteNombre}-${i}`} position={[c.lat, c.lon]} icon={ICON_CLIENTE}>
          <Popup>
            <div style={{ fontSize: 13 }}>
              <strong>{c.clienteNombre}</strong>
              <br />
              {c.direccion}
            </div>
          </Popup>
        </Marker>
      ))}

      {rutaHitos && rutaHitos.length > 1 && (
        <Polyline
          positions={rutaHitos.map((h) => [h.lat, h.lon])}
          pathOptions={{ color: "#2563EB", weight: 3, dashArray: "6 6" }}
        />
      )}
    </MapContainer>
  );
}
