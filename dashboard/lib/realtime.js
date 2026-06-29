import { useEffect, useRef } from "react";
import { supabase } from "./supabase";

export function useRealtimeRefresh(tables, callback) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    let channel = supabase.channel("dashboard-" + tables.join("-"));
    tables.forEach((table) => {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => cbRef.current()
      );
    });
    channel.subscribe();
    return () => supabase.removeChannel(channel);
  }, [tables.join(",")]);
}
