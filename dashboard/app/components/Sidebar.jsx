"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Map,
  AlertTriangle,
  Truck,
  Users,
  Settings,
  Route,
  Plus,
  Upload,
  CarFront,
  Menu,
  X,
} from "lucide-react";

const links = [
  { href: "/", label: "Operación", icon: LayoutDashboard },
  { href: "/mapa", label: "Mapa", icon: Map },
  { href: "/incidencias", label: "Incidencias", icon: AlertTriangle },
  { href: "/viajes", label: "Viajes", icon: Truck },
  { href: "/choferes", label: "Chóferes", icon: Users },
  { href: "/vehiculos", label: "Vehículos", icon: CarFront },
  { href: "/plantillas", label: "Plantillas", icon: Route },
  { href: "/importar", label: "Importar", icon: Upload },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const content = (
    <>
      <Link
        href="/"
        onClick={() => setOpen(false)}
        className="flex items-center gap-2 px-2 py-3 mb-2 no-underline"
      >
        <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center text-white">
          <Route size={16} />
        </div>
        <span className="text-base font-semibold text-ink">Norenty</span>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm no-underline transition-colors ${
                active
                  ? "bg-surface-alt text-ink font-medium"
                  : "text-ink-secondary hover:bg-surface-alt hover:text-ink"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto pt-3 border-t border-border">
        <Link
          href="/viajes/nuevo"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 px-2.5 py-2 rounded-md text-sm no-underline bg-brand text-white font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={18} /> Nuevo viaje
        </Link>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-md bg-surface border border-border text-ink"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-52 flex flex-col border-r border-border bg-surface p-3 gap-1 transform transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 text-ink-muted"
        >
          <X size={20} />
        </button>
        {content}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-52 shrink-0 flex-col border-r border-border bg-surface p-3 gap-1">
        {content}
      </aside>
    </>
  );
}
