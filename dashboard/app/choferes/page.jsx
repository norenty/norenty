"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Check, UserPlus, Users, Search, Plus, X } from "lucide-react";
import { getChoferes, createChofer } from "../../lib/data";
import EmptyState from "../components/ui/EmptyState";
import { normalizar } from "../components/ui/Buscador";

const IDIOMAS = ["es", "ro", "ar", "fr", "it", "en", "pt", "de"];
const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME;

export default function ChoferesPage() {
  const [choferes, setChoferes] = useState([]);
  const [nombre, setNombre] = useState("");
  const [idioma, setIdioma] = useState("es");
  const [telefono, setTelefono] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [copiado, setCopiado] = useState(null);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [mostrarAlta, setMostrarAlta] = useState(false);

  function load() {
    getChoferes().then(setChoferes);
  }
  useEffect(load, []);

  // 2026-07-23, bug real reportado por el usuario: esta pantalla no tenía
  // NINGÚN buscador -- el único campo de texto era el de "añadir chófer
  // nuevo", así que escribir un nombre para ENCONTRAR a alguien y darle a
  // Enter creaba un chófer nuevo con ese texto ("escribo 'luc' y me genera un
  // chófer"). Buscador de verdad, separado del alta, mismo criterio de
  // normalización (sin tildes, ordenado por relevancia) que el resto de la app.
  const choferesFiltrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q) return choferes;
    return choferes
      .filter((c) => normalizar(c.nombre).includes(q))
      .sort((a, b) => {
        const aEmpieza = normalizar(a.nombre).startsWith(q) ? 0 : 1;
        const bEmpieza = normalizar(b.nombre).startsWith(q) ? 0 : 1;
        if (aEmpieza !== bEmpieza) return aEmpieza - bEmpieza;
        return a.nombre.localeCompare(b.nombre);
      });
  }, [choferes, busqueda]);

  async function añadir(e) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setError(null);
    const dup = choferes.find((c) => c.nombre.toLowerCase() === nombre.trim().toLowerCase());
    if (dup) { setError(`Ya existe un chófer con el nombre "${dup.nombre}"`); return; }
    setGuardando(true);
    try {
      await createChofer({ nombre: nombre.trim(), idioma, telefono: telefono.trim() || null });
      setNombre("");
      setIdioma("es");
      setTelefono("");
    } catch (err) {
      setError(err.message);
    }
    setGuardando(false);
    setMostrarAlta(false);
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

      <div className="flex items-center gap-2 mb-6">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar chófer por nombre..."
            className="w-full text-sm border border-border rounded-md pl-9 pr-3 py-2.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
        {!mostrarAlta && (
          <button
            type="button"
            onClick={() => setMostrarAlta(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-2.5 rounded-md bg-brand text-white font-medium whitespace-nowrap"
          >
            <Plus size={16} /> Añadir chófer
          </button>
        )}
      </div>

      {/* 2026-07-23, bug real repetido: con el formulario de alta SIEMPRE
          visible justo debajo del buscador, escribir en el campo equivocado
          ("Nombre" en vez de "Buscar...") y darle a Enter creaba un chófer
          basura ("muño", "LUc"...) -- son dos cajas de texto casi idénticas
          una encima de otra. Ahora el alta solo aparece tras un clic explícito
          en "Añadir chófer", así el buscador es la única caja de texto visible
          por defecto y no hay ambigüedad posible sobre cuál es cuál. */}
      {mostrarAlta && (
        <form
          onSubmit={añadir}
          className="bg-surface border border-border rounded-xl p-4 mb-6 flex items-end gap-3"
        >
          <div className="flex-1">
            <label className="block text-xs text-ink-secondary mb-1">Nombre</label>
            <input
              autoFocus
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
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Teléfono (opcional)</label>
            <input
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="+34 600 111 222"
              className="w-36 text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <button
            type="submit"
            disabled={guardando || !nombre.trim()}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            <UserPlus size={16} /> Añadir
          </button>
          <button
            type="button"
            onClick={() => { setMostrarAlta(false); setNombre(""); setTelefono(""); setError(null); }}
            className="p-2 text-ink-muted hover:text-ink"
          >
            <X size={16} />
          </button>
        </form>
      )}

      <div className="flex flex-col gap-2">
        {choferesFiltrados.map((c) => {
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
                <div className="flex items-center gap-2">
                  <a
                    href={link}
                    target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-brand text-white font-medium no-underline hover:opacity-90"
                  >
                    Abrir Telegram
                  </a>
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
                        <Copy size={14} /> Copiar enlace
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {choferes.length === 0 && (
          <EmptyState icon={Users} titulo="Todavía no hay chóferes" texto='Añade el primero con el botón "Añadir chófer" de arriba.' />
        )}
        {choferes.length > 0 && choferesFiltrados.length === 0 && (
          <p className="text-xs text-ink-muted px-1">Ningún chófer coincide con "{busqueda}".</p>
        )}
      </div>
    </div>
  );
}
