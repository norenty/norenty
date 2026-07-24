"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getViajes } from "../lib/data";
import { useRealtimeRefresh } from "../lib/realtime";
import MetricCard from "./components/MetricCard";
import KanbanColumn from "./components/KanbanColumn";
import TripCard from "./components/TripCard";
import ResumenHoy from "./components/ResumenHoy";
import ChecklistOnboarding from "./components/ChecklistOnboarding";

// Kanban drag-and-drop (2026-07-17): SOLO reordena dentro de la misma
// columna, no mueve tarjetas entre columnas -- el estado de un viaje lo
// marca la realidad observada (bot/GPS/POD), no arrastrarlo en el
// dashboard. Arrastrar entre columnas para "adelantar" el estado
// contradiría el principio central del producto (verdad observada, no lo
// que alguien dice que pasó). El orden es preferencia visual pura, se
// guarda en localStorage por columna, igual que el patrón ya usado en
// Sidebar.jsx (colapso de grupos) -- sin librería nueva.
const ORDEN_KEY_PREFIX = "norenty:kanban-orden:";

function ordenarSegunPreferencia(items, key) {
  if (typeof window === "undefined") return items;
  let orden;
  try {
    orden = JSON.parse(window.localStorage.getItem(ORDEN_KEY_PREFIX + key) || "[]");
  } catch {
    orden = [];
  }
  if (!orden.length) return items;
  const porId = new Map(items.map((it) => [it.id, it]));
  const ordenados = orden.map((id) => porId.get(id)).filter(Boolean);
  const idsOrdenados = new Set(ordenados.map((it) => it.id));
  const nuevos = items.filter((it) => !idsOrdenados.has(it.id));
  return [...ordenados, ...nuevos];
}

function guardarPreferenciaOrden(key, items) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ORDEN_KEY_PREFIX + key, JSON.stringify(items.map((it) => it.id)));
}

function classify(trips) {
  const conIncidencia = trips.filter((t) => t.incidencia);
  const resto = trips.filter((t) => !t.incidencia);
  return {
    planificados: resto.filter((t) => t.estado === "planificado"),
    enCurso: resto.filter((t) => t.estado === "en_curso"),
    completados: resto.filter((t) => t.estado === "completado"),
    incidencias: conIncidencia,
  };
}

export default function OperacionPage() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ordenVersion, setOrdenVersion] = useState(0);
  const arrastrando = useRef(null); // {columnaKey, id} de la tarjeta que se está soltando

  function refresh() {
    getViajes().then((data) => {
      setTrips(data);
      setLoading(false);
    });
  }

  useEffect(() => { refresh(); }, []);
  useRealtimeRefresh(["viaje", "hito", "ejecucion_evento", "incidencia"], refresh);

  const { planificados, enCurso, completados, incidencias } = classify(trips);

  const columnas = [
    {
      key: "plan",
      title: "Planificado",
      color: "text-estado-planificado",
      items: planificados,
    },
    {
      key: "curso",
      title: "En curso",
      color: "text-estado-en-curso",
      items: enCurso,
    },
    {
      key: "inc",
      title: "Incidencia",
      color: "text-estado-incidencia",
      items: incidencias,
    },
    {
      key: "comp",
      title: "Completado",
      color: "text-estado-ok",
      items: completados,
    },
  ];

  return (
    <div>
      <ChecklistOnboarding />
      <ResumenHoy />

      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-medium text-ink">Operación</h1>
        <Link
          href="/viajes/nuevo-w"
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium no-underline"
        >
          <Plus size={16} /> Nuevo viaje
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <MetricCard label="Viajes" value={trips.length} />
        <MetricCard
          label="En curso"
          value={enCurso.length}
          color="text-estado-en-curso"
        />
        <MetricCard
          label="Incidencias"
          value={incidencias.length}
          color="text-estado-incidencia"
        />
        <MetricCard
          label="Completados"
          value={completados.length}
          color="text-estado-ok"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-border rounded-lg h-48 animate-pulse" />
          ))}
        </div>
      ) : trips.length === 0 ? (
        <div className="text-center py-16 text-ink-secondary">
          <p className="text-sm">
            No hay viajes todavía. Crea el primero o asígnalo a un chófer.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" data-orden-version={ordenVersion}>
          {columnas.map((col) => {
            // ordenVersion no se lee aquí a propósito: solo fuerza el re-render
            // tras un drop, ordenarSegunPreferencia relee localStorage cada vez.
            const items = ordenarSegunPreferencia(col.items, col.key);
            return (
            <KanbanColumn
              key={col.key}
              title={col.title}
              color={col.color}
              count={items.length}
            >
              {items.map((t, i) => (
                <Link
                  key={t.id}
                  href={`/viajes/${t.id}`}
                  className="block no-underline"
                  draggable
                  onDragStart={() => { arrastrando.current = { columna: col.key, id: t.id }; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const origen = arrastrando.current;
                    arrastrando.current = null;
                    if (!origen || origen.columna !== col.key || origen.id === t.id) return;
                    const reordenados = [...items];
                    const desdeIdx = reordenados.findIndex((it) => it.id === origen.id);
                    if (desdeIdx === -1) return;
                    const [movido] = reordenados.splice(desdeIdx, 1);
                    reordenados.splice(i, 0, movido);
                    guardarPreferenciaOrden(col.key, reordenados);
                    setOrdenVersion((v) => v + 1);
                  }}
                >
                  <TripCard
                    referencia={t.referencia}
                    estado={t.estado}
                    choferNombre={t.chofer?.nombre}
                    choferIdioma={t.chofer?.idioma}
                    hitoActual={t.hitoActual}
                    hitosCompletados={t.hitosCompletados}
                    hitosTotal={t.hitosTotal}
                    alerta={t.incidencia ? t.incidencia.tipo : null}
                    alertaTipo={t.incidencia ? "incidencia" : null}
                  />
                </Link>
              ))}
            </KanbanColumn>
            );
          })}
        </div>
      )}
    </div>
  );
}
