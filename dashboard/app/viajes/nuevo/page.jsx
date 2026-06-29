"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { getChoferes, createViaje } from "../../../lib/data";

function nuevoHito() {
  return { tipo: "entrega", direccion: "", ventana_inicio: "", ventana_fin: "" };
}

export default function NuevoViaje() {
  const router = useRouter();
  const [choferes, setChoferes] = useState([]);
  const [referencia, setReferencia] = useState("");
  const [choferId, setChoferId] = useState("");
  const [hitos, setHitos] = useState([nuevoHito()]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    getChoferes().then(setChoferes);
  }, []);

  function actualizarHito(i, campo, valor) {
    setHitos((hs) => hs.map((h, idx) => (idx === i ? { ...h, [campo]: valor } : h)));
  }
  function añadirHito() {
    setHitos((hs) => [...hs, nuevoHito()]);
  }
  function quitarHito(i) {
    setHitos((hs) => hs.filter((_, idx) => idx !== i));
  }

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    const viaje = await createViaje({
      referencia: referencia.trim(),
      choferId: choferId || null,
      hitos: hitos.filter((h) => h.direccion.trim()),
    });
    router.push(`/viajes/${viaje.id}`);
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-ink-secondary no-underline mb-4 hover:text-ink"
      >
        <ArrowLeft size={16} /> Volver
      </Link>
      <h1 className="text-xl font-medium text-ink mb-6">Nuevo viaje</h1>

      <form onSubmit={guardar} className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-secondary mb-1">
              Referencia
            </label>
            <input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="VJ-2055"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Chófer</label>
            <select
              value={choferId}
              onChange={(e) => setChoferId(e.target.value)}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            >
              <option value="">Sin asignar</option>
              {choferes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} ({c.idioma?.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-ink">Hitos</label>
            <button
              type="button"
              onClick={añadirHito}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
            >
              <Plus size={14} /> Añadir hito
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {hitos.map((h, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-xs text-ink-muted w-5">{i + 1}.</span>
                  <select
                    value={h.tipo}
                    onChange={(e) => actualizarHito(i, "tipo", e.target.value)}
                    className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                  >
                    <option value="recogida">Recogida</option>
                    <option value="entrega">Entrega</option>
                  </select>
                  <input
                    value={h.direccion}
                    onChange={(e) => actualizarHito(i, "direccion", e.target.value)}
                    placeholder="Dirección"
                    className="flex-1 text-sm border border-border rounded-md px-3 py-1.5 focus:outline-none focus:border-brand"
                  />
                  {hitos.length > 1 && (
                    <button
                      type="button"
                      onClick={() => quitarHito(i)}
                      className="text-ink-muted hover:text-estado-incidencia p-1"
                      aria-label="Quitar hito"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 pl-7">
                  <span className="text-xs text-ink-muted">Ventana:</span>
                  <input
                    type="datetime-local"
                    value={h.ventana_inicio}
                    onChange={(e) => actualizarHito(i, "ventana_inicio", e.target.value)}
                    className="text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand"
                  />
                  <span className="text-xs text-ink-muted">–</span>
                  <input
                    type="datetime-local"
                    value={h.ventana_fin}
                    onChange={(e) => actualizarHito(i, "ventana_fin", e.target.value)}
                    className="text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={guardando}
          className="self-start text-sm px-4 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
        >
          {guardando ? "Creando…" : "Crear viaje"}
        </button>
      </form>
    </div>
  );
}
