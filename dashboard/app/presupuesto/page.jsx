"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Calculator, Plus, Trash2, AlertTriangle } from "lucide-react";
import { calcularPresupuesto } from "../../lib/data";
import { supabase } from "../../lib/supabase";

function nuevoPunto() {
  return { label: "", lat: "", lon: "" };
}

const LABEL_CAPA = { combustible: "Combustible", conductor: "Conductor", peajes: "Peajes", dietas: "Dietas" };

export default function PresupuestoPage() {
  const [puntos, setPuntos] = useState([nuevoPunto(), nuevoPunto()]);
  const [vehiculos, setVehiculos] = useState([]);
  const [vehiculoId, setVehiculoId] = useState("");
  const [resultado, setResultado] = useState(null);
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.from("vehiculo").select("id, matricula").eq("activo", true).order("matricula").then(({ data }) => setVehiculos(data || []));
  }, []);

  function actualizarPunto(i, campo, valor) {
    setPuntos((ps) => ps.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p)));
  }

  function quitarPunto(i) {
    setPuntos((ps) => ps.filter((_, idx) => idx !== i));
  }

  async function calcular() {
    setError(null);
    const validos = puntos
      .filter((p) => p.lat !== "" && p.lon !== "")
      .map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) }));

    if (validos.length < 2) {
      setError("Añade al menos 2 puntos con latitud y longitud.");
      return;
    }
    if (validos.some((p) => Number.isNaN(p.lat) || Number.isNaN(p.lon))) {
      setError("Latitud/longitud inválidas.");
      return;
    }

    setCalculando(true);
    try {
      const r = await calcularPresupuesto({ puntos: validos, vehiculoId: vehiculoId || null });
      setResultado(r);
    } finally {
      setCalculando(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-medium text-ink mb-1 flex items-center gap-2">
        <Calculator size={20} /> Presupuesto instantáneo
      </h1>
      <p className="text-sm text-ink-secondary mb-5">
        Calcula si una carga sale a cuenta antes de comprometerte: km, horas, noches fuera y el
        precio que deberías cobrar para tu margen objetivo — sin crear el viaje.
      </p>

      <div className="bg-surface border border-border rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-ink">Paradas (en orden)</h2>
          <button
            type="button"
            onClick={() => setPuntos((ps) => [...ps, nuevoPunto()])}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
          >
            <Plus size={14} /> Añadir parada
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {puntos.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="font-mono text-xs text-ink-muted w-5">{i + 1}.</span>
              <input
                value={p.label}
                onChange={(e) => actualizarPunto(i, "label", e.target.value)}
                placeholder="Etiqueta (opcional)"
                className="flex-1 text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
              <input
                type="number" step="any"
                value={p.lat}
                onChange={(e) => actualizarPunto(i, "lat", e.target.value)}
                placeholder="Latitud"
                className="w-28 text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
              <input
                type="number" step="any"
                value={p.lon}
                onChange={(e) => actualizarPunto(i, "lon", e.target.value)}
                placeholder="Longitud"
                className="w-28 text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
              <button
                type="button"
                onClick={() => quitarPunto(i)}
                disabled={puntos.length <= 2}
                aria-label="Quitar parada"
                className="p-2 text-ink-muted hover:text-estado-incidencia disabled:opacity-30"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 max-w-xs">
          <label htmlFor="presupuesto-vehiculo" className="block text-xs text-ink-secondary mb-1">Vehículo (opcional)</label>
          <select
            id="presupuesto-vehiculo"
            value={vehiculoId}
            onChange={(e) => setVehiculoId(e.target.value)}
            className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          >
            <option value="">Sin especificar</option>
            {vehiculos.map((v) => (
              <option key={v.id} value={v.id}>{v.matricula}</option>
            ))}
          </select>
        </div>

        {error && (
          <p role="alert" className="mt-3 flex items-center gap-1.5 text-xs text-estado-incidencia">
            <AlertTriangle size={13} /> {error}
          </p>
        )}

        <button
          onClick={calcular}
          disabled={calculando}
          className="mt-4 text-sm px-4 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
        >
          {calculando ? "Calculando…" : "Calcular"}
        </button>
      </div>

      {resultado && (
        <div className="bg-surface border border-border rounded-xl p-5">
          <div className="mb-4">
            <div className="text-xs text-ink-secondary mb-1">Precio sugerido</div>
            {resultado.precioSugerido != null ? (
              <div className="text-2xl font-semibold text-ink">
                {resultado.precioSugerido.toLocaleString("es-ES")} €
                <span className="text-sm font-normal text-ink-muted"> (margen {resultado.margenObjetivo}%)</span>
              </div>
            ) : (
              <p className="text-sm text-ink-secondary">
                Configura el coste (€/km o desglose) en Ajustes para ver el precio sugerido.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
            <div>
              <div className="text-xs text-ink-secondary">Distancia</div>
              <div className="font-medium text-ink">{resultado.estimado && "~"}{resultado.km.toLocaleString("es-ES")} km</div>
            </div>
            <div>
              <div className="text-xs text-ink-secondary">Conducción</div>
              <div className="font-medium text-ink">{resultado.horasConduccion} h</div>
            </div>
            <div>
              <div className="text-xs text-ink-secondary">Paradas / descansos</div>
              <div className="font-medium text-ink">{resultado.paradas45min} · {resultado.descansos11h}</div>
            </div>
            <div>
              <div className="text-xs text-ink-secondary">Noches fuera (est.)</div>
              <div className="font-medium text-ink">{resultado.noches}</div>
            </div>
          </div>

          {resultado.estimado && (
            <p className="text-xs text-yellow-700 mb-3">
              ~ distancia estimada en línea recta corregida; instala OSRM para km por carretera reales.
            </p>
          )}

          {resultado.coste.total != null && (
            <div className="text-xs text-ink-muted space-y-0.5 border-t border-border pt-3">
              {resultado.coste.modo === "desglosado" ? (
                ["combustible", "conductor", "peajes", "dietas"].map((capa) => (
                  <div key={capa} className="flex justify-between">
                    <span>{LABEL_CAPA[capa]}</span>
                    <span>
                      {resultado.coste[capa] != null
                        ? `${resultado.coste[capa].toLocaleString("es-ES")} €`
                        : <span>— configura {LABEL_CAPA[capa].toLowerCase()} en Ajustes</span>}
                    </span>
                  </div>
                ))
              ) : (
                <div>Coste estimado (€/km): {resultado.coste.total.toLocaleString("es-ES")} €</div>
              )}
              <div className="flex justify-between font-medium text-ink-secondary pt-0.5 border-t border-border">
                <span>Total coste</span><span>{resultado.coste.total.toLocaleString("es-ES")} €</span>
              </div>
            </div>
          )}

          {/* TODO(7A.11): "Crear viaje con estos datos" precargará el wizard de nuevo viaje
              con estas paradas/vehículo/precio en vez de solo enlazar a un form vacío. */}
          <Link
            href="/viajes/nuevo"
            className="mt-4 inline-flex text-sm px-4 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt no-underline"
          >
            Crear viaje
          </Link>
        </div>
      )}
    </div>
  );
}
