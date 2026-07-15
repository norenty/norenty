"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer, ShieldCheck } from "lucide-react";
import { getDossierViaje } from "../../../../lib/data";
import PodImage from "../../../components/PodImage";
import { ESTADO_HITO } from "../../../../lib/labels";
import { fmtFechaHora } from "../../../../lib/format";

/** F13.2 — Dossier de evidencia para reclamaciones: reúne lo probatorio de un
 * viaje (cadena de hash + POD + checkpoints) en una vista imprimible, para
 * enseñar a un cliente en una disputa. `window.print()` a PDF, mismo patrón
 * que el informe de /nomina — sin librería nueva. */
export default function DossierViaje() {
  const { id } = useParams();
  const [dossier, setDossier] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDossierViaje(id).then((d) => { setDossier(d); setLoading(false); });
  }, [id]);

  if (loading) {
    return <div className="max-w-3xl"><div className="h-48 bg-border rounded-xl animate-pulse" /></div>;
  }

  if (!dossier) {
    return (
      <div className="max-w-3xl">
        <Link href={`/viajes/${id}`} className="inline-flex items-center gap-1.5 text-sm text-ink-secondary no-underline mb-4 hover:text-ink">
          <ArrowLeft size={16} /> Volver al viaje
        </Link>
        <p className="text-sm text-ink-secondary">Viaje no encontrado.</p>
      </div>
    );
  }

  const { viaje, hitos, eventos, pods } = dossier;
  const ref = viaje.referencia || viaje.id.slice(0, 8);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4 print:hidden">
        <Link href={`/viajes/${id}`} className="inline-flex items-center gap-1.5 text-sm text-ink-secondary no-underline hover:text-ink">
          <ArrowLeft size={16} /> Volver al viaje
        </Link>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
        >
          <Printer size={13} /> Imprimir / PDF
        </button>
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 print:border-0">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={18} className="text-brand" />
          <h1 className="text-lg font-medium text-ink">Dossier de evidencia — Viaje {ref}</h1>
        </div>
        <p className="text-xs text-ink-secondary mb-5">
          Cada registro de este viaje lleva una huella criptográfica encadenada (hash) que ni
          Norenty puede alterar sin que se note: modificar cualquier evento invalidaría todos los
          posteriores. Este documento reúne los hechos registrados para su uso en una reclamación.
        </p>

        <div className="grid grid-cols-2 gap-3 text-xs mb-6 pb-5 border-b border-border">
          <div><span className="text-ink-secondary">Cliente:</span> {viaje.cliente?.nombre || "—"}{viaje.cliente?.cif ? ` (${viaje.cliente.cif})` : ""}</div>
          <div><span className="text-ink-secondary">Chófer:</span> {viaje.chofer?.nombre || "—"}</div>
          <div><span className="text-ink-secondary">Estado final:</span> {viaje.estado}</div>
          <div><span className="text-ink-secondary">Generado:</span> {fmtFechaHora(new Date().toISOString())}</div>
        </div>

        <h2 className="text-sm font-medium text-ink mb-2">Paradas y llegadas</h2>
        <div className="flex flex-col gap-2 mb-6">
          {hitos.map((h) => {
            const llegada = eventos.find((e) => e.tipo === "llegada" && e.hito_id === h.id);
            const e = ESTADO_HITO[h.estado] || ESTADO_HITO.pendiente;
            return (
              <div key={h.id} className="flex items-center gap-3 text-xs border border-border rounded-lg px-3 py-2">
                <span className="font-mono text-ink-muted w-5">{h.orden}.</span>
                <span className="flex-1 text-ink">
                  {h.tipo === "recogida" ? "Recogida" : "Entrega"} — {h.direccion || "—"}
                  {h.es_checkpoint && <span className="ml-1.5 text-brand">· checkpoint</span>}
                </span>
                <span className="text-ink-secondary">{llegada ? `Llegada: ${fmtFechaHora(llegada.ocurrido_en)}` : "sin llegada registrada"}</span>
                <span className={`px-2 py-0.5 rounded-full ${e.color}`}>{e.label}</span>
              </div>
            );
          })}
        </div>

        {pods.length > 0 && (
          <>
            <h2 className="text-sm font-medium text-ink mb-2">Albaranes (prueba de entrega)</h2>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {pods.map((p, i) => (
                <div key={i} className="border border-border rounded-lg overflow-hidden">
                  <PodImage path={p.foto_url} className="w-full h-32" />
                  <div className="p-2 text-[11px] text-ink-muted space-y-0.5">
                    <div>Subido: {fmtFechaHora(p.created_at)}</div>
                    <div className="font-mono truncate" title={p.hash_sha256}>sha256: {p.hash_sha256?.slice(0, 24)}…</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <h2 className="text-sm font-medium text-ink mb-2">Cadena de eventos (registro completo)</h2>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-surface-alt text-ink-secondary">
                <th className="text-left px-3 py-1.5 font-medium">Cuándo</th>
                <th className="text-left px-3 py-1.5 font-medium">Evento</th>
                <th className="text-left px-3 py-1.5 font-medium">Hash</th>
              </tr>
            </thead>
            <tbody>
              {eventos.map((e, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-1.5 text-ink-secondary whitespace-nowrap">{fmtFechaHora(e.ocurrido_en)}</td>
                  <td className="px-3 py-1.5 text-ink">{e.tipo}{e.detalle ? ` — ${e.detalle}` : ""}</td>
                  <td className="px-3 py-1.5 font-mono text-ink-muted truncate max-w-[140px]" title={e.hash}>{e.hash ? e.hash.slice(0, 16) + "…" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
