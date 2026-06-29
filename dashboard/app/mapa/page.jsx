"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "../../lib/supabase";

const MapView = dynamic(() => import("../components/MapView"), { ssr: false });

export default function MapaPage() {
  const [hitos, setHitos] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [loading, setLoading] = useState(true);

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
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div>
      <h1 className="text-xl font-medium text-ink mb-4">Mapa en vivo</h1>
      <div className="flex gap-3 mb-4">
        <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span className="w-3 h-3 rounded-full bg-estado-en-curso inline-block" /> Recogida
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span className="w-3 h-3 rounded-full bg-estado-ok inline-block" /> Entrega
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span className="w-3 h-3 rounded-full bg-brand inline-block" /> Chófer
        </div>
      </div>
      <div style={{ height: "calc(100vh - 180px)" }}>
        {loading ? (
          <div className="w-full h-full bg-surface-alt rounded-xl animate-pulse" />
        ) : (
          <MapView hitos={hitos} ubicaciones={ubicaciones} />
        )}
      </div>
    </div>
  );
}
