"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell, AlertTriangle, Check, Truck, X, FileWarning } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { getDocumentosPorCaducar } from "../../lib/data";
import { TIPO_DOC_LABEL } from "../../lib/labels";

export default function NotificationCenter() {
  const router = useRouter();
  const [notifs, setNotifs] = useState([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function loadNotifs() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [incRes, evtRes, docsPorCaducar] = await Promise.all([
      supabase
        .from("incidencia")
        .select("id, tipo, descripcion, created_at, viaje_id, viaje(referencia)")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("ejecucion_evento")
        .select("id, tipo, detalle, ocurrido_en, viaje_id, viaje(referencia)")
        .gte("ocurrido_en", since)
        .order("ocurrido_en", { ascending: false })
        .limit(10),
      getDocumentosPorCaducar(),
    ]);

    const items = [
      ...(incRes.data || []).map((i) => ({
        id: `inc-${i.id}`,
        type: "incidencia",
        icon: AlertTriangle,
        iconColor: "text-estado-incidencia",
        title: i.tipo,
        sub: i.descripcion || "",
        ref: i.viaje?.referencia || i.viaje_id?.slice(0, 8),
        href: `/viajes/${i.viaje_id}`,
        time: i.created_at,
      })),
      ...(evtRes.data || []).map((e) => ({
        id: `evt-${e.id}`,
        type: "evento",
        icon: e.tipo === "entrega_completada" ? Check : Truck,
        iconColor: e.tipo === "entrega_completada" ? "text-estado-ok" : "text-brand",
        title: (e.tipo || "").replace(/_/g, " "),
        sub: e.detalle || "",
        ref: e.viaje?.referencia || e.viaje_id?.slice(0, 8),
        href: `/viajes/${e.viaje_id}`,
        time: e.ocurrido_en,
      })),
      ...docsPorCaducar.map((d) => ({
        id: `doc-${d.id}`,
        type: "documento",
        icon: FileWarning,
        iconColor: "text-yellow-600",
        title: `${TIPO_DOC_LABEL[d.tipo] || d.tipo} por caducar`,
        sub: d.entidadEtiqueta,
        ref: d.fecha_caducidad,
        href: d.href,
        time: d.created_at,
      })),
    ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 15);

    setNotifs(items);
    setUnread(items.filter((n) => n.type === "incidencia" || n.type === "documento").length);
  }

  useEffect(() => {
    loadNotifs();
    const channel = supabase
      .channel("notifs")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "incidencia" }, loadNotifs)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ejecucion_evento" }, loadNotifs)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  function ir(href) {
    setOpen(false);
    router.push(href);
  }

  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (diff < 1) return "ahora";
    if (diff < 60) return `${diff}m`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h`;
    return `${Math.floor(diff / 1440)}d`;
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); if (!open) loadNotifs(); }}
        className="relative p-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt transition-colors"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-estado-incidencia text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-surface border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-medium text-ink">Notificaciones</span>
            <button onClick={() => setOpen(false)} className="text-ink-muted"><X size={16} /></button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifs.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-ink-muted">
                Sin actividad en las últimas 24 horas
              </div>
            ) : (
              notifs.map((n) => {
                const Icon = n.icon;
                return (
                  <button
                    key={n.id}
                    onClick={() => ir(n.href)}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface-alt transition-colors text-left border-b border-border last:border-0"
                  >
                    <Icon size={16} className={`mt-0.5 shrink-0 ${n.iconColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-ink capitalize">{n.title}</div>
                      {n.sub && <div className="text-xs text-ink-secondary truncate">{n.sub}</div>}
                      <div className="text-[10px] text-ink-muted mt-0.5">
                        {n.ref} · {timeAgo(n.time)}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
