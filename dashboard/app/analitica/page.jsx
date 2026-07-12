"use client";

import { useEffect, useState } from "react";
import { Clock, AlertTriangle, Users, CarFront, TrendingUp } from "lucide-react";
import {
  getMetricasPuntualidad,
  getMetricasIncidencias,
  getMetricasChoferes,
  getMetricasFlota,
  getMetricasRentabilidad,
  getComparativaMensual,
} from "../../lib/data";
import { fmtEur } from "../../lib/format";

const VISTAS = [
  { id: "puntualidad", label: "Puntualidad", icon: Clock },
  { id: "incidencias", label: "Incidencias", icon: AlertTriangle },
  { id: "choferes", label: "Chóferes", icon: Users },
  { id: "flota", label: "Flota", icon: CarFront },
  { id: "rentabilidad", label: "Rentabilidad", icon: TrendingUp },
];

// Ítem 12.2 — controlling en el tiempo: flecha + % frente al periodo anterior
// de igual duración. `invertir`: para métricas donde SUBIR es malo (p.ej.
// "viajes a pérdidas"), invierte el color sin invertir la flecha (la flecha
// siempre indica la dirección real del cambio; el color indica si es bueno).
function Variacion({ comp, invertir = false, sufijo = "%" }) {
  if (!comp || comp.variacionPct == null) return null;
  const sube = comp.variacionPct > 0;
  const esBueno = invertir ? !sube : sube;
  const color = comp.variacionPct === 0 ? "text-ink-muted" : esBueno ? "text-estado-ok" : "text-estado-incidencia";
  const flecha = comp.variacionPct === 0 ? "→" : sube ? "▲" : "▼";
  return (
    <div className={`text-xs mt-1 ${color}`}>
      {flecha} {Math.abs(comp.variacionPct)}{sufijo} vs. periodo anterior
    </div>
  );
}

function Card({ label, value, sub, comp, invertirComp = false, sufijoComp }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="text-xs text-ink-secondary mb-1">{label}</div>
      <div className="text-2xl font-semibold text-ink">{value ?? "—"}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
      <Variacion comp={comp} invertir={invertirComp} sufijo={sufijoComp} />
    </div>
  );
}

function Barra({ label, count, max }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-32 shrink-0 text-ink-secondary truncate" title={label}>{label}</span>
      <div className="flex-1 h-2 bg-surface-alt rounded-full overflow-hidden">
        <div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-ink-muted">{count}</span>
    </div>
  );
}

function VistaPuntualidad({ datos, comparativa }) {
  const maxRuta = Math.max(1, ...datos.peoresRutas.map((r) => r.incidencias));
  const maxSemana = Math.max(1, ...datos.tendencia.map((s) => s.count));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Card
          label="% Puntualidad"
          value={datos.pctPuntualidad != null ? `${datos.pctPuntualidad}%` : null}
          comp={comparativa?.pctPuntualidad}
        />
        <Card label="Hitos con ventana" value={datos.totalConVentana} />
        <Card label="Fuera de ventana" value={datos.totalTarde} />
      </div>

      <div className="bg-surface border border-border rounded-xl p-4">
        <h3 className="text-sm font-medium text-ink mb-3">Tendencia (incidencias fuera de ventana, por semana)</h3>
        {datos.tendencia.length === 0 ? (
          <p className="text-xs text-ink-secondary">Sin datos suficientes.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {datos.tendencia.map((s) => (
              <Barra key={s.semana} label={s.semana} count={s.count} max={maxSemana} />
            ))}
          </div>
        )}
      </div>

      <div className="bg-surface border border-border rounded-xl p-4">
        <h3 className="text-sm font-medium text-ink mb-3">Peores rutas (más llegadas fuera de ventana)</h3>
        {datos.peoresRutas.length === 0 ? (
          <p className="text-xs text-ink-secondary">Sin incidencias de puntualidad.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {datos.peoresRutas.map((r) => (
              <Barra key={r.referencia} label={r.referencia} count={r.incidencias} max={maxRuta} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VistaIncidencias({ datos }) {
  const maxTipo = Math.max(1, ...datos.porTipo.map((t) => t.count));
  const maxChofer = Math.max(1, ...datos.porChofer.map((c) => c.count));
  const maxVehiculo = Math.max(1, ...datos.porVehiculo.map((v) => v.count));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Card label="Total incidencias" value={datos.total} />
        <Card label="Tasa por viaje" value={datos.tasa ?? "—"} sub="incidencias / viajes totales" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-surface border border-border rounded-xl p-4">
          <h3 className="text-sm font-medium text-ink mb-3">Por tipo</h3>
          <div className="flex flex-col gap-1.5">
            {datos.porTipo.length === 0 && <p className="text-xs text-ink-secondary">Sin incidencias.</p>}
            {datos.porTipo.map((t) => (
              <Barra key={t.tipo} label={t.tipo} count={t.count} max={maxTipo} />
            ))}
          </div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <h3 className="text-sm font-medium text-ink mb-3">Por chófer</h3>
          <div className="flex flex-col gap-1.5">
            {datos.porChofer.length === 0 && <p className="text-xs text-ink-secondary">Sin datos.</p>}
            {datos.porChofer.map((c) => (
              <Barra key={c.nombre} label={c.nombre} count={c.count} max={maxChofer} />
            ))}
          </div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <h3 className="text-sm font-medium text-ink mb-3">Por vehículo</h3>
          <div className="flex flex-col gap-1.5">
            {datos.porVehiculo.length === 0 && <p className="text-xs text-ink-secondary">Sin datos.</p>}
            {datos.porVehiculo.map((v) => (
              <Barra key={v.matricula} label={v.matricula} count={v.count} max={maxVehiculo} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function VistaChoferes({ datos }) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Móvil (< ~500px): 5 columnas no encogen bien, mejor scroll horizontal
          contenido que romper el layout. */}
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-ink-secondary text-left">
            <th className="px-4 py-2 font-medium">Chófer</th>
            <th className="px-4 py-2 font-medium">Viajes</th>
            <th className="px-4 py-2 font-medium">Valoración</th>
            <th className="px-4 py-2 font-medium">Incidencias</th>
            <th className="px-4 py-2 font-medium">% Puntualidad</th>
          </tr>
        </thead>
        <tbody>
          {datos.length === 0 ? (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-secondary">Sin chóferes.</td></tr>
          ) : (
            datos.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 text-ink">{c.nombre}</td>
                <td className="px-4 py-2.5 text-ink-secondary">{c.viajes}</td>
                <td className="px-4 py-2.5 text-ink-secondary">{c.valoracionMedia ?? "—"}</td>
                <td className="px-4 py-2.5 text-ink-secondary">{c.incidencias}</td>
                <td className="px-4 py-2.5 text-ink-secondary">{c.pctPuntualidad != null ? `${c.pctPuntualidad}%` : "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function VistaFlota({ datos }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Card label="Vehículos activos" value={`${datos.vehiculosActivos} / ${datos.totalVehiculos}`} />
        <Card label="En uso ahora" value={datos.enUso} />
        <Card label="% Utilización" value={datos.pctUtilizacion != null ? `${datos.pctUtilizacion}%` : null} />
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-ink">ITV pendientes</h3>
        </div>
        {datos.itvPendientes.length === 0 ? (
          <p className="text-sm text-ink-secondary p-4 text-center">Sin ITV pendientes.</p>
        ) : (
          datos.itvPendientes.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0 text-sm">
              <span className="text-ink font-mono">{m.matricula}</span>
              <span className="text-ink-muted text-xs">{m.fecha || "sin fecha"}</span>
            </div>
          ))
        )}
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-ink">Averías recientes</h3>
        </div>
        {datos.averiasRecientes.length === 0 ? (
          <p className="text-sm text-ink-secondary p-4 text-center">Sin averías registradas.</p>
        ) : (
          datos.averiasRecientes.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0 text-sm">
              <span className="text-ink font-mono">{m.matricula}</span>
              <span className="text-ink-muted text-xs">{m.fecha || "sin fecha"}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TablaRentabilidad({ titulo, filas }) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-ink">{titulo}</h3>
      </div>
      {filas.length === 0 ? (
        <p className="text-sm text-ink-secondary p-4 text-center">Sin datos suficientes.</p>
      ) : (
        filas.map((f) => (
          <div key={f.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0 text-sm">
            <span className="text-ink truncate">{f.referencia}</span>
            <span className={`font-medium ${f.margenReal < 0 ? "text-estado-incidencia" : "text-green-700"}`}>
              {fmtEur(f.margenReal)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function VistaRentabilidad({ datos, comparativa }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Card
          label="Margen real medio"
          value={fmtEur(datos.margenRealMedio)}
          comp={comparativa?.margenRealMedio}
          sufijoComp="%"
        />
        <Card
          label="Viajes a pérdidas (reales)"
          value={datos.viajesAPerdidasReales}
          comp={comparativa?.viajesAPerdidasReales}
          invertirComp
        />
        <Card
          label="Desviación media |real−estimado|"
          value={datos.desviacionMedia != null ? `${datos.desviacionMedia}%` : null}
          sub="solo viajes con gastos reales registrados — dice si el motor de costes acierta"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TablaRentabilidad titulo="Mejor margen real" filas={datos.top5} />
        <TablaRentabilidad titulo="Peor margen real" filas={datos.bottom5} />
      </div>
    </div>
  );
}

// Ítem 12.2: solo estas dos vistas tienen "comparar con el periodo anterior"
// con sentido de negocio claro hoy (margen/pérdidas, puntualidad).
const VISTAS_CON_COMPARATIVA = new Set(["puntualidad", "rentabilidad"]);

export default function Analitica() {
  const [vista, setVista] = useState("puntualidad");
  const [datos, setDatos] = useState(null);
  const [comparativa, setComparativa] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setComparativa(null);
    const cargar = {
      puntualidad: getMetricasPuntualidad,
      incidencias: getMetricasIncidencias,
      choferes: getMetricasChoferes,
      flota: getMetricasFlota,
      rentabilidad: getMetricasRentabilidad,
    }[vista];
    cargar().then((d) => { setDatos(d); setLoading(false); });
    if (VISTAS_CON_COMPARATIVA.has(vista)) {
      getComparativaMensual().then(setComparativa);
    }
  }, [vista]);

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-4">
        <h1 className="text-lg font-medium text-ink">Analítica</h1>
        <span className="text-xs text-ink-muted">
          {vista === "flota" ? "estado actual (averías: últimos 90 días)" : "últimos 90 días"}
        </span>
      </div>

      <div className="flex gap-1 mb-4 border-b border-border" role="tablist" aria-label="Vista de analítica">
        {VISTAS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={vista === id}
            onClick={() => setVista(id)}
            className={`flex items-center gap-1.5 text-sm px-3 py-2 border-b-2 -mb-px transition-colors ${
              vista === id
                ? "border-brand text-ink font-medium"
                : "border-transparent text-ink-secondary hover:text-ink"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {loading || !datos ? (
        <div className="h-64 bg-surface-alt rounded-xl animate-pulse" />
      ) : (
        <>
          {vista === "puntualidad" && <VistaPuntualidad datos={datos} comparativa={comparativa} />}
          {vista === "incidencias" && <VistaIncidencias datos={datos} />}
          {vista === "choferes" && <VistaChoferes datos={datos} />}
          {vista === "flota" && <VistaFlota datos={datos} />}
          {vista === "rentabilidad" && <VistaRentabilidad datos={datos} comparativa={comparativa} />}
        </>
      )}
    </div>
  );
}
