"use client";

import { usePathname } from "next/navigation";
import { Search, LogOut } from "lucide-react";
import { signOut } from "../../lib/auth";
import NotificationCenter from "./NotificationCenter";

export default function Topbar() {
  const pathname = usePathname();

  // Portal de cliente (7A.14): /t/[token] es público, sin topbar interna.
  if (pathname?.startsWith("/t/")) return null;

  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-3 md:px-5 border-b border-border bg-surface pl-14 md:pl-5 print:hidden">
      <button
        onClick={() => window.dispatchEvent(new Event("open-global-search"))}
        className="flex-1 flex items-center gap-2 bg-surface-alt border border-border rounded-md px-3 py-1.5 text-left hover:border-ink-muted transition-colors"
      >
        <Search size={15} className="text-ink-muted shrink-0" />
        <span className="flex-1 text-sm text-ink-muted">Buscar o preguntar (documentos por caducar, viajes a pérdidas…)</span>
        <kbd className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded bg-surface text-ink-muted font-mono shrink-0">Ctrl K</kbd>
      </button>

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
