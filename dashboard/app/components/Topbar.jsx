"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, LogOut } from "lucide-react";
import { signOut } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import NotificationCenter from "./NotificationCenter";

export default function Topbar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function buscar(q) {
    setQuery(q);
    clearTimeout(timer.current);
    if (q.length < 2) { setResults([]); setOpen(false); return; }

    timer.current = setTimeout(async () => {
      const escaped = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const [viajes, choferes] = await Promise.all([
        supabase
          .from("viaje")
          .select("id, referencia, estado")
          .ilike("referencia", `%${escaped}%`)
          .limit(5),
        supabase
          .from("chofer")
          .select("id, nombre")
          .ilike("nombre", `%${escaped}%`)
          .limit(5),
      ]);

      const items = [
        ...(viajes.data || []).map((v) => ({
          type: "viaje",
          id: v.id,
          label: v.referencia || v.id.slice(0, 8),
          sub: v.estado,
          href: `/viajes/${v.id}`,
        })),
        ...(choferes.data || []).map((c) => ({
          type: "chofer",
          id: c.id,
          label: c.nombre,
          sub: "Chófer",
          href: `/choferes`,
        })),
      ];
      setResults(items);
      setOpen(items.length > 0);
    }, 250);
  }

  function ir(href) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-3 md:px-5 border-b border-border bg-surface pl-14 md:pl-5">
      <div className="flex-1 relative" ref={ref}>
        <div className="flex items-center gap-2 bg-surface-alt border border-border rounded-md px-3 py-1.5">
          <Search size={15} className="text-ink-muted" />
          <input
            value={query}
            onChange={(e) => buscar(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Buscar viaje, chófer…"
            className="flex-1 text-sm bg-transparent outline-none"
          />
        </div>
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-lg z-50 overflow-hidden">
            {results.map((r) => (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => ir(r.href)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-alt transition-colors"
              >
                <span className="text-xs px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted font-mono">
                  {r.type === "viaje" ? "VJ" : "CH"}
                </span>
                <span className="text-sm text-ink flex-1">{r.label}</span>
                <span className="text-xs text-ink-muted">{r.sub}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <NotificationCenter />

      <button
        onClick={() => signOut()}
        className="p-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt transition-colors"
        title="Cerrar sesión"
      >
        <LogOut size={18} />
      </button>
    </header>
  );
}
