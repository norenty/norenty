"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getViajes } from "../lib/data";
import MetricCard from "./components/MetricCard";
import KanbanColumn from "./components/KanbanColumn";
import TripCard from "./components/TripCard";

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

  useEffect(() => {
    getViajes().then((data) => {
      setTrips(data);
      setLoading(false);
    });
  }, []);

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
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-medium text-ink">Operación</h1>
        <Link
          href="/viajes/nuevo"
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium no-underline"
        >
          <Plus size={16} /> Nuevo viaje
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
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
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-surface-alt rounded-lg h-48 animate-pulse" />
          ))}
        </div>
      ) : trips.length === 0 ? (
        <div className="text-center py-16 text-ink-secondary">
          <p className="text-sm">
            No hay viajes todavía. Crea el primero o asígnalo a un chófer.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {columnas.map((col) => (
            <KanbanColumn
              key={col.key}
              title={col.title}
              color={col.color}
              count={col.items.length}
            >
              {col.items.map((t) => (
                <Link
                  key={t.id}
                  href={`/viajes/${t.id}`}
                  className="block no-underline"
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
          ))}
        </div>
      )}
    </div>
  );
}
