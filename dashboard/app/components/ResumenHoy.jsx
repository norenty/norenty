"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { getResumenHoy, getNotasRecientes, createNotaGestor } from "../../lib/data";

function fmtHace(iso) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

function Tarjeta({ href, valor, label, detalle, tono = "neutral" }) {
  const color = valor > 0 ? (tono === "ambar" ? "text-yellow-600" : "text-estado-incidencia") : "text-ink";
  return (
    <Link
      href={href}
      className="bg-surface border border-border rounded-xl p-4 no-underline hover:border-brand transition-colors flex flex-col gap-1"
    >
      <div className="flex items-center justify-between">
        <span className={`text-2xl font-semibold ${color}`}>{valor}</span>
        <ArrowRight size={14} className="text-ink-muted" />
      </div>
      <span className="text-xs text-ink-secondary">{label}</span>
      {detalle && <span className="text-xs text-ink-muted">{detalle}</span>}
    </Link>
  );
}

export default function ResumenHoy() {
  const [resumen, setResumen] = useState(null);
  const [notas, setNotas] = useState([]);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);

  function cargarNotas() {
    getNotasRecientes(10).then(setNotas);
  }

  useEffect(() => {
    getResumenHoy().then(setResumen);
    cargarNotas();
  }, []);

  async function anadirNota() {
    if (!texto.trim() || guardando) return;
    setGuardando(true);
    try {
      await createNotaGestor({ texto });
      setTexto("");
      cargarNotas();
    } finally {
      setGuardando(false);
    }
  }

  if (!resumen) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-24 bg-border rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="mb-6">
      {resumen.todoEnOrden ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 text-green-700 text-sm font-medium mb-6">
          <CheckCircle2 size={18} />
          Todo en orden — nada requiere tu atención ahora mismo.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Tarjeta href="/documentos" valor={resumen.docsPorCaducar} label="Documentos por caducar" tono="ambar" />
          <Tarjeta
            href="/incidencias"
            valor={resumen.incidencias.count}
            label="Incidencias abiertas"
            detalle={resumen.incidencias.masAntiguaDias != null ? `la más antigua: ${resumen.incidencias.masAntiguaDias} d` : null}
          />
          <Tarjeta
            href="/viajes"
            valor={resumen.viajesEnRiesgo.count}
            label="Viajes en riesgo"
            detalle={resumen.viajesEnRiesgo.refs.length ? resumen.viajesEnRiesgo.refs.join(", ") : null}
          />
          <Tarjeta
            href="/choferes"
            valor={resumen.choferes561.count}
            label="Chóferes cerca del límite 561"
            tono="ambar"
            detalle={resumen.choferes561.nombres.length ? resumen.choferes561.nombres.join(", ") : null}
          />
          <Tarjeta href="/viajes" valor={resumen.viajesPerdidas.count} label="Viajes a pérdidas (est.)" />
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl p-4">
        <h2 className="text-sm font-medium text-ink mb-3">Notas rápidas</h2>
        <div className="flex gap-2 mb-3">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") anadirNota(); }}
            placeholder="Apunta algo de contexto (opcional, para el equipo)"
            className="flex-1 text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <button
            onClick={anadirNota}
            disabled={guardando || !texto.trim()}
            className="text-sm px-3 py-2 rounded-md bg-brand text-white disabled:opacity-40 shrink-0"
          >
            Añadir
          </button>
        </div>
        {notas.length === 0 ? (
          <p className="text-xs text-ink-muted">Sin notas todavía.</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
            {notas.map((n) => (
              <div key={n.id} className="text-xs border-b border-border pb-2 last:border-0 last:pb-0">
                <span className="text-ink-muted">{fmtHace(n.created_at)}</span>
                {n.gestor?.nombre && <span className="text-ink-muted"> · {n.gestor.nombre}</span>}
                <p className="text-ink mt-0.5">{n.texto}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
