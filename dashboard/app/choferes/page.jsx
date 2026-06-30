"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Check, UserPlus } from "lucide-react";
import { getChoferes, createChofer } from "../../lib/data";

const IDIOMAS = ["es", "ro", "ar", "fr", "it", "en", "pt", "de"];
const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME;

export default function ChoferesPage() {
  const [choferes, setChoferes] = useState([]);
  const [nombre, setNombre] = useState("");
  const [idioma, setIdioma] = useState("es");
  const [guardando, setGuardando] = useState(false);
  const [copiado, setCopiado] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    getChoferes().then(setChoferes);
  }
  useEffect(load, []);

  async function añadir(e) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setError(null);
    const dup = choferes.find((c) => c.nombre.toLowerCase() === nombre.trim().toLowerCase());
    if (dup) { setError(`Ya existe un chófer con el nombre "${dup.nombre}"`); return; }
    setGuardando(true);
    try {
      await createChofer({ nombre: nombre.trim(), idioma });
      setNombre("");
      setIdioma("es");
    } catch (err) {
      setError(err.message);
    }
    setGuardando(false);
    load();
  }

  function copiar(texto, id) {
    navigator.clipboard.writeText(texto);
    setCopiado(id);
    setTimeout(() => setCopiado(null), 2000);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-medium text-ink mb-1">Chóferes</h1>
      <p className="text-sm text-ink-secondary mb-6">
        Da de alta chóferes y comparte su enlace de vinculación con Telegram.
      </p>

      {error && (
        <div className="mb-4 text-xs px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-estado-incidencia flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-ink-muted ml-2">✕</button>
        </div>
      )}

      <form
        onSubmit={añadir}
        className="bg-surface border border-border rounded-xl p-4 mb-6 flex items-end gap-3"
      >
        <div className="flex-1">
          <label className="block text-xs text-ink-secondary mb-1">Nombre</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre del chófer"
            maxLength={100}
            className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="block text-xs text-ink-secondary mb-1">Idioma</label>
          <select
            value={idioma}
            onChange={(e) => setIdioma(e.target.value)}
            className="text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
          >
            {IDIOMAS.map((i) => (
              <option key={i} value={i}>
                {i.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={guardando || !nombre.trim()}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
        >
          <UserPlus size={16} /> Añadir
        </button>
      </form>

      <div className="flex flex-col gap-2">
        {choferes.map((c) => {
          const link = BOT ? `https://t.me/${BOT}?start=${c.id}` : null;
          return (
            <div
              key={c.id}
              className="bg-surface border border-border rounded-xl p-4 flex items-center gap-4"
            >
              <Link
                href={`/choferes/${c.id}`}
                className="flex items-center gap-3 flex-1 min-w-0 no-underline group"
              >
                <div className="w-9 h-9 rounded-full bg-blue-50 text-estado-en-curso flex items-center justify-center text-sm font-medium shrink-0">
                  {c.nombre.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink group-hover:text-brand transition-colors">
                    {c.nombre}
                    <span className="font-mono text-xs ml-2 px-1.5 py-0.5 rounded-full bg-surface-alt text-ink-secondary">
                      {c.idioma?.toUpperCase()}
                    </span>
                  </div>
                  {c.chat_id ? (
                    <span className="text-xs text-estado-ok">● Vinculado a Telegram</span>
                  ) : (
                    <span className="text-xs text-ink-muted">○ Sin vincular</span>
                  )}
                </div>
              </Link>

              {!c.chat_id && link && (
                <button
                  onClick={() => copiar(link, c.id)}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
                >
                  {copiado === c.id ? (
                    <>
                      <Check size={14} /> Copiado
                    </>
                  ) : (
                    <>
                      <Copy size={14} /> Copiar enlace de alta
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
        {choferes.length === 0 && (
          <p className="text-sm text-ink-secondary py-4">
            No hay chóferes todavía. Añade el primero arriba.
          </p>
        )}
      </div>
    </div>
  );
}
