"use client";

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

  return (
    <aside className="w-52 shrink-0 flex flex-col border-r border-border bg-surface p-3 gap-1">
      <Link
        href="/"
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
          className="flex items-center gap-2 px-2.5 py-2 rounded-md text-sm no-underline bg-brand text-white font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={18} /> Nuevo viaje
        </Link>
      </div>
    </aside>
  );
}
