"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileWarning, Truck, CarFront, Users, AlertTriangle, Search, Image as ImageIcon } from "lucide-react";
import { getDocumentosPorCaducar, getConflictosMantenimientoViaje, buscarAlbaranes } from "../../lib/data";
import { TIPO_DOC_LABEL, AMBITO_LABEL } from "../../lib/labels";
import { fmtFecha, badgeCaducidad } from "../../lib/format";

// Fase 23, Bloque A (23.A.3) -- DISCOVERY.md insight 14: "me he pegado media
// hora buscando papeles en el armario". Sin pantalla nueva -- vive aquí porque
// es la misma familia de "papeleo del viaje" que ya cubre esta página.
function BuscadorAlbaranes() {
  const [filtros, setFiltros] = useState({ referencia: "", clienteNombre: "", matricula: "" });
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);

  async function buscar(e) {
    e.preventDefault();
    setBuscando(true);
    const r = await buscarAlbaranes({
      referencia: filtros.referencia.trim() || undefined,
      clienteNombre: filtros.clienteNombre.trim() || undefined,
      matricula: filtros.matricula.trim() || undefined,
    });
    setResultados(r);
    setBuscando(false);
  }

  return (
    <div className="max-w-3xl mt-8">
      <div className="flex items-center gap-2 mb-1">
        <Search size={18} className="text-ink-secondary" />
        <h2 className="text-lg font-medium text-ink">Buscar albaranes</h2>
      </div>
      <p className="text-sm text-ink-secondary mb-4">
        Por referencia de viaje, cliente o matrícula — evita revisar viaje a viaje.
      </p>
      <form onSubmit={buscar} className="bg-surface border border-border rounded-xl p-4 mb-4 flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs text-ink-secondary mb-1">Referencia</label>
          <input
            value={filtros.referencia}
            onChange={(e) => setFiltros({ ...filtros, referencia: e.target.value })}
            placeholder="VJ-1234"
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-32"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">Cliente</label>
          <input
            value={filtros.clienteNombre}
            onChange={(e) => setFiltros({ ...filtros, clienteNombre: e.target.value })}
            placeholder="Mercadona"
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-36"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">Matrícula</label>
          <input
            value={filtros.matricula}
            onChange={(e) => setFiltros({ ...filtros, matricula: e.target.value })}
            placeholder="1234 ABC"
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand w-32"
          />
        </div>
        <button
          type="submit"
          disabled={buscando}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
        >
          <Search size={16} /> {buscando ? "Buscando..." : "Buscar"}
        </button>
      </form>

      {resultados !== null && (
        resultados.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-6 text-center text-sm text-ink-secondary">
            Sin resultados con esos filtros.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            {resultados.map((a) => (
              <Link
                key={a.id}
                href={`/viajes/${a.viajeId}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 no-underline hover:bg-surface-alt transition-colors"
              >
                <ImageIcon size={16} className="text-ink-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink font-mono">{a.viajeReferencia || a.viajeId.slice(0, 8)}</div>
                  <div className="text-xs text-ink-muted">
                    {a.clienteNombre && `${a.clienteNombre} · `}
                    {a.matricula && `${a.matricula} · `}
                    {a.choferNombre && `${a.choferNombre} · `}
                    {fmtFecha(a.creadoEn)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      )}
    </div>
  );
}

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

      <BuscadorAlbaranes />
    </div>
  );
}
