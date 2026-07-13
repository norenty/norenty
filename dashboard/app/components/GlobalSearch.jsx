"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search, ArrowRight } from "lucide-react";
import { supabase } from "../../lib/supabase";

const TIPO_LABEL = { viaje: "Viaje", chofer: "Chófer", vehiculo: "Vehículo" };

export default function GlobalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const timer = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      const isShortcut = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isShortcut) {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (e.key === "Escape" && open) close();
    }
    function onOpenRequest() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("open-global-search", onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-global-search", onOpenRequest);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  function buscar(q) {
    setQuery(q);
    setActiveIndex(0);
    clearTimeout(timer.current);
    if (q.length < 2) { setResults([]); return; }

    timer.current = setTimeout(async () => {
      const escaped = q.replace(/%/g, "\\%").replace(/_/g, "\\_");
      const [viajes, choferes, vehiculos] = await Promise.all([
        supabase.from("viaje").select("id, referencia, estado").ilike("referencia", `%${escaped}%`).limit(5),
        supabase.from("chofer").select("id, nombre").ilike("nombre", `%${escaped}%`).limit(5),
        supabase.from("vehiculo").select("id, matricula").ilike("matricula", `%${escaped}%`).limit(5),
      ]);

      setResults([
        ...(viajes.data || []).map((v) => ({
          tipo: "viaje",
          id: v.id,
          label: v.referencia || v.id.slice(0, 8),
          sub: v.estado,
          href: `/viajes/${v.id}`,
        })),
        ...(choferes.data || []).map((c) => ({
          tipo: "chofer",
          id: c.id,
          label: c.nombre,
          sub: "Chófer",
          href: `/choferes/${c.id}`,
        })),
        ...(vehiculos.data || []).map((v) => ({
          tipo: "vehiculo",
          id: v.id,
          label: v.matricula,
          sub: "Vehículo",
          href: `/vehiculos/${v.id}`,
        })),
      ]);
    }, 250);
  }

  function ir(href) {
    close();
    router.push(href);
  }

  function onInputKeyDown(e) {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[activeIndex];
      if (item) ir(item.href);
    }
  }

  // Portal de cliente (7A.14): /t/[token] no tiene chrome interna.
  if (pathname?.startsWith("/t/")) return null;
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4">
      <div className="fixed inset-0 bg-black/30" onClick={close} />
      <div className="relative w-full max-w-lg bg-surface border border-border rounded-xl shadow-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search size={16} className="text-ink-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => buscar(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Buscar viaje, chófer, vehículo…"
            className="flex-1 text-sm bg-transparent outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted font-mono shrink-0">Esc</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {query.length >= 2 && results.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-ink-muted">Sin resultados</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.tipo}-${r.id}`}
              onClick={() => ir(r.href)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-border last:border-0 transition-colors ${
                i === activeIndex ? "bg-surface-alt" : "hover:bg-surface-alt"
              }`}
            >
              <span className="text-xs px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted font-mono shrink-0">
                {TIPO_LABEL[r.tipo]}
              </span>
              <span className="text-sm text-ink flex-1 truncate">{r.label}</span>
              <span className="text-xs text-ink-muted shrink-0">{r.sub}</span>
              {i === activeIndex && <ArrowRight size={14} className="text-ink-muted shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
