"use client";

import { Search, Bell } from "lucide-react";

export default function Topbar() {
  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-5 border-b border-border bg-surface">
      <div className="flex-1 flex items-center gap-2 bg-surface-alt border border-border rounded-md px-3 py-1.5 text-sm text-ink-muted">
        <Search size={15} />
        <span>Buscar viaje, chófer…</span>
      </div>

      <button className="relative p-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt transition-colors">
        <Bell size={18} />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-estado-incidencia text-white text-[10px] rounded-full flex items-center justify-center font-medium">
          2
        </span>
      </button>

      <div className="w-8 h-8 rounded-full bg-surface-alt border border-border flex items-center justify-center text-xs font-medium text-ink-secondary">
        MG
      </div>
    </header>
  );
}
