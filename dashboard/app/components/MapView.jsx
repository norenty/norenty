"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TIPO_PARKING_LABEL } from "../../lib/labels";

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
  html: '<div style="width:32px;height:32px;border-radius:50%;background:#4F46E5;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px">🚛</div>',
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
const ICON_PARKING_PROPIO = new L.DivIcon({
  className: "",
  html: '<div style="width:20px;height:20px;border-radius:4px;background:#D97706;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700">P</div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [points, map]);
  return null;
}

export default function MapView({ hitos, ubicaciones, parkings, onBorrarParking }) {
  // Los parkings NO entran en fitBounds: son capa de contexto (763 en toda
  // España), no deben forzar el zoom fuera de la operación.
  const allPoints = [
    ...(hitos || []).filter((h) => h.lat && h.lon),
    ...(ubicaciones || []).filter((u) => u.lat && u.lon),
  ];
  const center = allPoints.length
    ? [allPoints[0].lat, allPoints[0].lon]
    : [40.4168, -3.7038];

  return (
    <MapContainer
      center={center}
      zoom={6}
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
                <span style={{ color: "#64748B" }}>{h.estado}</span>
              </div>
            </Popup>
          </Marker>
        ))}

      {(parkings || []).map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lon]}
          icon={p.fuente === "empresa" ? ICON_PARKING_PROPIO : ICON_PARKING}
        >
          <Popup>
            <div style={{ fontSize: 13 }}>
              <strong>{TIPO_PARKING_LABEL[p.tipo] || p.nombre}</strong>
              <br />
              {p.fuente === "empresa" ? "Parking propio de la empresa" : "Dataset abierto (Fraunhofer/OSM)"}
              {p.confianza && (
                <>
                  <br />
                  <span style={{ color: "#64748B" }}>Confianza: {p.confianza}</span>
                </>
              )}
              {p.notas && (
                <>
                  <br />
                  <span style={{ color: "#64748B" }}>{p.notas}</span>
                </>
              )}
              {p.fuente === "empresa" && onBorrarParking && (
                <>
                  <br />
                  <button
                    onClick={() => onBorrarParking(p.id)}
                    style={{ marginTop: 6, fontSize: 12, color: "#DC2626", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
                  >
                    Eliminar
                  </button>
                </>
              )}
            </div>
          </Popup>
        </Marker>
      ))}

      {(ubicaciones || []).map((u) => (
        <Marker key={u.id} position={[u.lat, u.lon]} icon={ICON_CHOFER}>
          <Popup>
            <div style={{ fontSize: 13 }}>
              <strong>{u.chofer_nombre || "Chófer"}</strong>
              <br />
              {u.velocidad != null && `${Math.round(u.velocidad)} km/h`}
              <br />
              <span style={{ color: "#64748B" }}>
                {new Date(u.created_at).toLocaleTimeString("es-ES")}
              </span>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
