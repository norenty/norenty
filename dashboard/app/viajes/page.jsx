"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getViajes } from "../../lib/data";

const estadoLabel = {
  planificado: { t: "Planificado", c: "text-estado-planificado" },
  en_curso: { t: "En curso", c: "text-estado-en-curso" },
  completado: { t: "Completado", c: "text-estado-ok" },
  cancelado: { t: "Cancelado", c: "text-ink-muted" },
};

export default function ViajesPage() {
  const [viajes, setViajes] = useState([]);

  useEffect(() => {
    getViajes().then(setViajes);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-medium text-ink">Viajes</h1>
        <Link
          href="/viajes/nuevo"
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium no-underline"
        >
          <Plus size={16} /> Nuevo viaje
        </Link>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {viajes.map((v) => {
          const e = estadoLabel[v.estado] || estadoLabel.planificado;
          return (
            <Link
              key={v.id}
              href={`/viajes/${v.id}`}
              className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0 no-underline hover:bg-surface-alt"
            >
              <span className="font-mono text-sm text-ink-secondary w-28">
                {v.referencia}
              </span>
              <span className="flex-1 text-sm text-ink">{v.chofer?.nombre}</span>
              <span className="text-xs text-ink-secondary">
                {v.hitosCompletados}/{v.hitosTotal} hitos
              </span>
              <span className={`text-xs font-medium w-24 text-right ${e.c}`}>
                {e.t}
              </span>
            </Link>
          );
        })}
        {viajes.length === 0 && (
          <p className="text-sm text-ink-secondary p-4">No hay viajes todavía.</p>
        )}
      </div>
    </div>
  );
}
