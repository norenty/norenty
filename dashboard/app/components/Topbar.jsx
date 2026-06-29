"use client";

import { Search, Bell, LogOut } from "lucide-react";
import { signOut } from "../../lib/auth";

export default function Topbar() {
  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-5 border-b border-border bg-surface">
      <div className="flex-1 flex items-center gap-2 bg-surface-alt border border-border rounded-md px-3 py-1.5 text-sm text-ink-muted">
        <Search size={15} />
        <span>Buscar viaje, chófer…</span>
      </div>

      <button className="relative p-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt transition-colors">
        <Bell size={18} />
      </button>

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
