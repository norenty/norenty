"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileWarning, Truck, CarFront, Users, AlertTriangle } from "lucide-react";
import { getDocumentosPorCaducar, getConflictosMantenimientoViaje } from "../../lib/data";
import { TIPO_DOC_LABEL, AMBITO_LABEL } from "../../lib/labels";
import { fmtFecha, badgeCaducidad } from "../../lib/format";

const AMBITO_ICON = { viaje: Truck, vehiculo: CarFront, chofer: Users };

export default function DocumentosPorCaducar() {
  const [docs, setDocs] = useState([]);
  const [conflictos, setConflictos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getDocumentosPorCaducar(), getConflictosMantenimientoViaje()]).then(([d, c]) => {
      setDocs(d);
      setConflictos(c);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-64 bg-border rounded animate-pulse" />
        <div className="h-64 bg-border rounded-xl animate-pulse" />
      </div>
    );
  }

  const caducados = docs.filter((d) => badgeCaducidad(d.fecha_caducidad).dias < 0);
  const porCaducar = docs.filter((d) => badgeCaducidad(d.fecha_caducidad).dias >= 0);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <FileWarning size={20} className="text-yellow-600" />
        <h1 className="text-lg font-medium text-ink">Documentos por caducar</h1>
      </div>
      <p className="text-sm text-ink-secondary mb-4">
        Documentos de viajes, vehículos y chóferes caducados o que caducan en los próximos 30 días.
      </p>

      {conflictos.length > 0 && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden mb-4">
          <div className="px-4 py-2 bg-yellow-50 text-xs font-medium text-yellow-700 flex items-center gap-1.5">
            <AlertTriangle size={14} /> Conflictos ITV/viaje — {conflictos.length}
          </div>
          {conflictos.map((c) => (
            <Link
              key={`${c.vehiculoId}-${c.viajeId}`}
              href={`/viajes/${c.viajeId}`}
              className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 no-underline hover:bg-surface-alt transition-colors"
            >
              <CarFront size={16} className="text-ink-muted shrink-0" />
              <div className="flex-1 min-w-0 text-sm text-ink">
                <span className="font-mono">{c.matricula}</span> tiene ITV el {fmtFecha(c.fechaVencimiento)},
                pero el viaje <span className="font-mono">{c.referencia}</span> termina el {fmtFecha(c.fechaFinViaje)}
              </div>
            </Link>
          ))}
        </div>
      )}

      {docs.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-sm text-ink-secondary">
          Todo en orden: ningún documento caduca en los próximos 30 días.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {caducados.length > 0 && (
            <div className="px-4 py-2 bg-red-50 text-xs font-medium text-estado-incidencia">
              {caducados.length} caducado{caducados.length !== 1 ? "s" : ""}
            </div>
          )}
          {docs.map((d) => {
            const u = badgeCaducidad(d.fecha_caducidad);
            const Icon = AMBITO_ICON[d.ambito] || FileWarning;
            return (
              <Link
                key={d.id}
                href={d.href}
                className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 no-underline hover:bg-surface-alt transition-colors"
              >
                <Icon size={16} className="text-ink-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink">
                    {TIPO_DOC_LABEL[d.tipo] || d.tipo} — {d.entidadEtiqueta}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {AMBITO_LABEL[d.ambito]} · Caduca: {fmtFecha(d.fecha_caducidad)}
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${u.cls}`}>{u.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
