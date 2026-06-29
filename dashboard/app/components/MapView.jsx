"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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

export default function MapView({ hitos, ubicaciones }) {
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
