"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { getParkings, createParkingPropio, deleteParkingPropio } from "../../lib/data";
import { TIPOS_PARKING } from "../../lib/labels";

const MapView = dynamic(() => import("../components/MapView"), { ssr: false });

function initParkingForm() {
  return { nombre: "", tipo: "parking", lat: "", lon: "", notas: "" };
}

export default function MapaPage() {
  const [hitos, setHitos] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [parkings, setParkings] = useState([]);
  const [verParkings, setVerParkings] = useState(false);
  const [mostrarFormParking, setMostrarFormParking] = useState(false);
  const [formParking, setFormParking] = useState(initParkingForm());
  const [guardandoParking, setGuardandoParking] = useState(false);
  const [errorParking, setErrorParking] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadParkings = useCallback(async () => {
    setParkings(await getParkings());
  }, []);

  useEffect(() => {
    async function load() {
      const { data: hitosData } = await supabase
        .from("hito")
        .select("id, tipo, direccion, lat, lon, estado, viaje_id")
        .not("lat", "is", null);

      const { data: choferesData } = await supabase
        .from("chofer")
        .select("id, nombre");

      const choferMap = {};
      (choferesData || []).forEach((c) => { choferMap[c.id] = c.nombre; });

      const { data: ubicData } = await supabase.rpc("ultimas_ubicaciones").catch(() => ({ data: null }));

      let ubicFinal = [];
      if (ubicData) {
        ubicFinal = ubicData.map((u) => ({ ...u, chofer_nombre: choferMap[u.chofer_id] || "Chófer" }));
      } else {
        const { data: rawUbic } = await supabase
          .from("ubicacion")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        ubicFinal = (rawUbic || []).map((u) => ({ ...u, chofer_nombre: choferMap[u.chofer_id] || "Chófer" }));
      }

      setHitos(hitosData || []);
      setUbicaciones(ubicFinal);
      await loadParkings();
      setLoading(false);
    }
    load();
  }, [loadParkings]);

  async function guardarParking(e) {
    e.preventDefault();
    const lat = Number(formParking.lat);
    const lon = Number(formParking.lon);
    if (!formParking.nombre.trim() || Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setErrorParking("Nombre y coordenadas válidas son obligatorios.");
      return;
    }
    setGuardandoParking(true);
    setErrorParking(null);
    try {
      await createParkingPropio({ ...formParking, lat, lon });
      setFormParking(initParkingForm());
      setMostrarFormParking(false);
      setVerParkings(true);
      await loadParkings();
    } catch (err) {
      setErrorParking(err.message);
    } finally {
      setGuardandoParking(false);
    }
  }

  async function borrarParking(id) {
    await deleteParkingPropio(id);
    await loadParkings();
  }

  return (
    <div>
      <h1 className="text-xl font-medium text-ink mb-4">Mapa en vivo</h1>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span className="w-3 h-3 rounded-full bg-estado-en-curso inline-block" /> Recogida
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span className="w-3 h-3 rounded-full bg-estado-ok inline-block" /> Entrega
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span className="w-3 h-3 rounded-full bg-brand inline-block" /> Chófer
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-secondary cursor-pointer ml-2">
          <input
            type="checkbox"
            checked={verParkings}
            onChange={(e) => setVerParkings(e.target.checked)}
            className="accent-brand w-3.5 h-3.5"
          />
          Parkings ({parkings.length})
        </label>
        <button
          onClick={() => setMostrarFormParking((v) => !v)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-ink-secondary hover:bg-surface-alt ml-auto"
        >
          <Plus size={12} /> Parking propio
        </button>
      </div>

      {mostrarFormParking && (
        <form onSubmit={guardarParking} className="bg-surface border border-border rounded-xl p-3 mb-4 flex flex-wrap items-end gap-3">
          {errorParking && (
            <p role="alert" className="w-full text-xs text-estado-incidencia">{errorParking}</p>
          )}
          <div className="flex-1 min-w-[10rem]">
            <label htmlFor="parking-nombre" className="block text-xs text-ink-secondary mb-1">Nombre *</label>
            <input
              id="parking-nombre"
              value={formParking.nombre}
              onChange={(e) => setFormParking((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Parking Ctra. N-II km 34"
              maxLength={200}
              className="w-full text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div>
            <label htmlFor="parking-tipo" className="block text-xs text-ink-secondary mb-1">Tipo</label>
            <select
              id="parking-tipo"
              value={formParking.tipo}
              onChange={(e) => setFormParking((f) => ({ ...f, tipo: e.target.value }))}
              className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 bg-surface"
            >
              {TIPOS_PARKING.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label htmlFor="parking-lat" className="block text-xs text-ink-secondary mb-1">Latitud *</label>
            <input
              id="parking-lat"
              type="number" step="any" value={formParking.lat}
              onChange={(e) => setFormParking((f) => ({ ...f, lat: e.target.value }))}
              placeholder="40.4168"
              className="w-full text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div className="w-28">
            <label htmlFor="parking-lon" className="block text-xs text-ink-secondary mb-1">Longitud *</label>
            <input
              id="parking-lon"
              type="number" step="any" value={formParking.lon}
              onChange={(e) => setFormParking((f) => ({ ...f, lon: e.target.value }))}
              placeholder="-3.7038"
              className="w-full text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <button
            type="submit"
            disabled={guardandoParking}
            className="text-xs px-3 py-2 rounded-md bg-brand text-white disabled:opacity-40"
          >
            {guardandoParking ? "Guardando…" : "Guardar"}
          </button>
        </form>
      )}

      <div style={{ height: "calc(100vh - 180px)" }}>
        {loading ? (
          <div className="w-full h-full bg-surface-alt rounded-xl animate-pulse" />
        ) : (
          <MapView
            hitos={hitos}
            ubicaciones={ubicaciones}
            parkings={verParkings ? parkings : []}
            onBorrarParking={borrarParking}
          />
        )}
      </div>
    </div>
  );
}
