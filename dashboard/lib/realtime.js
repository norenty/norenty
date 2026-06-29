import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

export function useRealtimeRefresh(tables, callback) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "viaje" }, () => cbRef.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "hito" }, () => cbRef.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "ejecucion_evento" }, () => cbRef.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "incidencia" }, () => cbRef.current())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
