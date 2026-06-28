"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import MetricCard from "./components/MetricCard";
import KanbanColumn from "./components/KanbanColumn";
import TripCard from "./components/TripCard";

const demoTrips = [
  {
    id: "1",
    referencia: "VJ-2041",
    estado: "en_curso",
    chofer: { nombre: "Javi M.", idioma: "RO" },
    hitoActual: "Entrega · Mercabarna",
    hitosCompletados: 3,
    hitosTotal: 5,
  },
  {
    id: "2",
    referencia: "VJ-2044",
    estado: "en_curso",
    chofer: { nombre: "Adil K.", idioma: "AR" },
    hitoActual: "Recogida · Getafe",
    hitosCompletados: 1,
    hitosTotal: 4,
  },
  {
    id: "3",
    referencia: "VJ-2039",
    estado: "en_curso",
    chofer: { nombre: "Luca P.", idioma: "IT" },
    alerta: "Tarde · cierra 16:00",
    alertaTipo: "riesgo",
    hitosCompletados: 2,
    hitosTotal: 3,
  },
  {
    id: "4",
    referencia: "VJ-2036",
    estado: "en_curso",
    chofer: { nombre: "Sara N.", idioma: "ES" },
    alerta: "Falta albarán",
    alertaTipo: "pod",
    hitosCompletados: 4,
    hitosTotal: 4,
  },
  {
    id: "5",
    referencia: "VJ-2030",
    estado: "en_curso",
    chofer: { nombre: "Diego F.", idioma: "ES" },
    alerta: "Dirección errónea",
    alertaTipo: "incidencia",
    hitosCompletados: 1,
    hitosTotal: 3,
  },
  {
    id: "6",
    referencia: "VJ-2028",
    estado: "en_curso",
    chofer: { nombre: "Mamadou B.", idioma: "FR" },
    alerta: "Albarán ilegible",
    alertaTipo: "incidencia",
    hitosCompletados: 3,
    hitosTotal: 4,
  },
  {
    id: "7",
    referencia: "VJ-2050",
    estado: "planificado",
    chofer: { nombre: "Ana R.", idioma: "ES" },
    hitoActual: "Pendiente · Valencia",
    hitosCompletados: 0,
    hitosTotal: 3,
  },
  {
    id: "8",
    referencia: "VJ-2025",
    estado: "completado",
    chofer: { nombre: "Pavel D.", idioma: "RO" },
    hitosCompletados: 5,
    hitosTotal: 5,
  },
];

function classifyTrips(trips) {
  const planificados = trips.filter((t) => t.estado === "planificado");
  const enCurso = trips.filter(
    (t) => t.estado === "en_curso" && !t.alerta
  );
  const enRiesgo = trips.filter(
    (t) => t.alerta && t.alertaTipo !== "incidencia"
  );
  const incidencias = trips.filter(
    (t) => t.alerta && t.alertaTipo === "incidencia"
  );
  const completados = trips.filter((t) => t.estado === "completado");

  return { planificados, enCurso, enRiesgo, incidencias, completados };
}

export default function OperacionPage() {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("viaje")
        .select("*, chofer(nombre, idioma)")
        .order("created_at", { ascending: false });

      if (data && data.length > 0) {
        setTrips(
          data.map((v) => ({
            id: v.id,
            referencia: v.referencia || v.id.slice(0, 8),
            estado: v.estado,
            chofer: v.chofer || { nombre: "Sin asignar", idioma: "" },
            hitosCompletados: 0,
            hitosTotal: 0,
          }))
        );
      } else {
        setTrips(demoTrips);
      }
      setLoading(false);
    }
    load();
  }, []);

  const { planificados, enCurso, enRiesgo, incidencias, completados } =
    classifyTrips(trips);

  const total = trips.length;

  return (
    <div>
      <div className="grid grid-cols-4 gap-3 mb-5">
        <MetricCard label="Viajes hoy" value={total} />
        <MetricCard
          label="En curso"
          value={enCurso.length + enRiesgo.length + incidencias.length}
          color="text-estado-en-curso"
        />
        <MetricCard
          label="En riesgo"
          value={enRiesgo.length}
          color="text-estado-riesgo"
        />
        <MetricCard
          label="Incidencias"
          value={incidencias.length}
          color="text-estado-incidencia"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-surface-alt rounded-lg h-48 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          <KanbanColumn
            title="Planificado"
            color="text-estado-planificado"
            count={planificados.length}
          >
            {planificados.map((t) => (
              <TripCard
                key={t.id}
                referencia={t.referencia}
                estado={t.estado}
                choferNombre={t.chofer?.nombre}
                choferIdioma={t.chofer?.idioma}
                hitoActual={t.hitoActual}
                hitosCompletados={t.hitosCompletados}
                hitosTotal={t.hitosTotal}
              />
            ))}
          </KanbanColumn>

          <KanbanColumn
            title="En curso"
            color="text-estado-en-curso"
            count={enCurso.length}
          >
            {enCurso.map((t) => (
              <TripCard
                key={t.id}
                referencia={t.referencia}
                estado={t.estado}
                choferNombre={t.chofer?.nombre}
                choferIdioma={t.chofer?.idioma}
                hitoActual={t.hitoActual}
                hitosCompletados={t.hitosCompletados}
                hitosTotal={t.hitosTotal}
              />
            ))}
          </KanbanColumn>

          <KanbanColumn
            title="En riesgo"
            color="text-estado-riesgo"
            count={enRiesgo.length}
          >
            {enRiesgo.map((t) => (
              <TripCard
                key={t.id}
                referencia={t.referencia}
                estado={t.estado}
                choferNombre={t.chofer?.nombre}
                choferIdioma={t.chofer?.idioma}
                alerta={t.alerta}
                alertaTipo={t.alertaTipo}
                hitosCompletados={t.hitosCompletados}
                hitosTotal={t.hitosTotal}
              />
            ))}
          </KanbanColumn>

          <KanbanColumn
            title="Incidencia"
            color="text-estado-incidencia"
            count={incidencias.length}
          >
            {incidencias.map((t) => (
              <TripCard
                key={t.id}
                referencia={t.referencia}
                estado={t.estado}
                choferNombre={t.chofer?.nombre}
                choferIdioma={t.chofer?.idioma}
                alerta={t.alerta}
                alertaTipo="incidencia"
                hitosCompletados={t.hitosCompletados}
                hitosTotal={t.hitosTotal}
              />
            ))}
          </KanbanColumn>
        </div>
      )}
    </div>
  );
}
