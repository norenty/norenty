"use client";

import { useEffect, useState } from "react";
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
  FileWarning,
  BarChart3,
  Wallet,
  Calculator,
  Menu,
  X,
  ChevronDown,
} from "lucide-react";

// Ítem 9.30: enlace suelto (fuera de cualquier grupo, siempre visible/expandido).
const topLink = { href: "/", label: "Hoy", icon: LayoutDashboard };

// Ítem 9.30: grupos colapsables. "Parkings" no tiene página propia hoy (vive
// dentro de /mapa), así que no se añade entrada nueva para él.
// "Importar" no estaba contemplado en la spec original; se coloca en
// "Maestros" por afinidad (es donde se dan de alta datos maestros).
const groups = [
  {
    id: "operacion",
    label: "Operación",
    links: [
      { href: "/viajes", label: "Viajes", icon: Truck },
      { href: "/mapa", label: "Mapa", icon: Map },
      { href: "/incidencias", label: "Incidencias", icon: AlertTriangle },
    ],
  },
  {
    id: "maestros",
    label: "Maestros",
    links: [
      { href: "/vehiculos", label: "Vehículos", icon: CarFront },
      { href: "/choferes", label: "Chóferes", icon: Users },
      { href: "/plantillas", label: "Plantillas de ruta", icon: Route },
      { href: "/importar", label: "Importar", icon: Upload },
    ],
  },
  {
    id: "documentos",
    label: "Documentos y cumplimiento",
    links: [
      { href: "/documentos", label: "Documentos", icon: FileWarning },
    ],
  },
  {
    id: "analisis",
    label: "Análisis",
    links: [
      { href: "/analitica", label: "Analítica", icon: BarChart3 },
      { href: "/nomina", label: "Nómina", icon: Wallet },
      { href: "/presupuesto", label: "Presupuesto", icon: Calculator },
    ],
  },
];

// Enlace suelto abajo, fuera de cualquier grupo.
const bottomLink = { href: "/ajustes", label: "Ajustes", icon: Settings };

const STORAGE_KEY = "norenty-sidebar-groups";

function NavLink({ href, label, icon: Icon, active, onClick }) {
  return (
    <Link
      href={href}
      onClick={onClick}
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
}

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Por defecto todos los grupos van expandidos (mejor primera impresión);
  // localStorage sobreescribe esto en cargas siguientes.
  const [expanded, setExpanded] = useState(() =>
    Object.fromEntries(groups.map((g) => [g.id, true]))
  );

  // Cargar estado persistido de localStorage al montar.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setExpanded((prev) => ({ ...prev, ...JSON.parse(stored) }));
      }
    } catch {
      // localStorage no disponible o JSON corrupto: se ignora, quedan los defaults.
    }
  }, []);

  // El grupo que contiene la ruta activa se auto-expande, aunque el usuario
  // lo hubiera contraído antes. Nunca debe esconder la página en la que estás.
  useEffect(() => {
    const activeGroup = groups.find((g) =>
      g.links.some((l) => l.href === pathname)
    );
    if (activeGroup) {
      setExpanded((prev) =>
        prev[activeGroup.id] ? prev : { ...prev, [activeGroup.id]: true }
      );
    }
  }, [pathname]);

  function toggleGroup(id) {
    setExpanded((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // localStorage no disponible (modo privado, etc.): se ignora.
      }
      return next;
    });
  }

  // Portal de cliente (7A.14): /t/[token] es público, sin navegación interna.
  if (pathname?.startsWith("/t/")) return null;

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
        <NavLink
          {...topLink}
          active={pathname === topLink.href}
          onClick={() => setOpen(false)}
        />

        {groups.map((group) => {
          const isExpanded = !!expanded[group.id];
          return (
            <div key={group.id} className="mt-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={isExpanded}
                className="flex items-center justify-between w-full gap-2 px-2.5 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide text-ink-muted hover:bg-surface-alt hover:text-ink transition-colors focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              >
                <span>{group.label}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform ${isExpanded ? "" : "-rotate-90"}`}
                />
              </button>
              {isExpanded && (
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {group.links.map(({ href, label, icon: Icon }) => (
                    <NavLink
                      key={href}
                      href={href}
                      label={label}
                      icon={Icon}
                      active={pathname === href}
                      onClick={() => setOpen(false)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="mt-1 pt-1 border-t border-border">
          <NavLink
            {...bottomLink}
            active={pathname === bottomLink.href}
            onClick={() => setOpen(false)}
          />
        </div>
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
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-md bg-surface border border-border text-ink print:hidden"
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
      <aside className="hidden md:flex w-52 shrink-0 flex-col border-r border-border bg-surface p-3 gap-1 print:hidden">
        {content}
      </aside>
    </>
  );
}
