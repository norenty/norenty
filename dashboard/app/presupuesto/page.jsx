"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Calculator, Plus, Trash2, AlertTriangle, SlidersHorizontal, RotateCcw, Package } from "lucide-react";
import { calcularPresupuesto, calcularOcupacion } from "../../lib/data";
import { supabase } from "../../lib/supabase";
import { LABEL_CAPA } from "../../lib/labels";
import { fmtEur, fmtKm } from "../../lib/format";
import SectionCard from "../components/ui/SectionCard";

function nuevoPunto() {
  return { label: "", lat: "", lon: "" };
}

const WHAT_IF_VACIO = { velocidadKmh: "", precioGasoilLitro: "", margenObjetivoPct: "" };

export default function PresupuestoPage() {
  const [puntos, setPuntos] = useState([nuevoPunto(), nuevoPunto()]);
  const [vehiculos, setVehiculos] = useState([]);
  const [vehiculoId, setVehiculoId] = useState("");
  const [resultado, setResultado] = useState(null);
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [whatIf, setWhatIf] = useState(WHAT_IF_VACIO);
  const timerWhatIf = useRef(null);
  const [carga, setCarga] = useState({ ldm: "", kg: "", m3: "" });

  useEffect(() => {
    supabase
      .from("vehiculo")
      .select("id, matricula, capacidad_ldm, capacidad_kg, capacidad_m3")
      .eq("activo", true)
      .order("matricula")
      .then(({ data }) => setVehiculos(data || []));
    supabase
      .from("empresa")
      .select("velocidad_planificacion_kmh, precio_gasoil_litro, margen_objetivo_pct")
      .then(({ data }) => setConfig((data || [])[0] || null));
  }, []);

  const vehiculoSeleccionado = vehiculos.find((v) => v.id === vehiculoId) || null;
  const tieneCapacidad = !!(vehiculoSeleccionado && (
    vehiculoSeleccionado.capacidad_ldm != null || vehiculoSeleccionado.capacidad_kg != null || vehiculoSeleccionado.capacidad_m3 != null
  ));
  const ocupacion = tieneCapacidad
    ? calcularOcupacion(
        { ldm: carga.ldm === "" ? null : Number(carga.ldm), kg: carga.kg === "" ? null : Number(carga.kg), m3: carga.m3 === "" ? null : Number(carga.m3) },
        { ldm: vehiculoSeleccionado.capacidad_ldm, kg: vehiculoSeleccionado.capacidad_kg, m3: vehiculoSeleccionado.capacidad_m3 }
      )
    : null;

  function actualizarPunto(i, campo, valor) {
    setPuntos((ps) => ps.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p)));
  }

  function quitarPunto(i) {
    setPuntos((ps) => ps.filter((_, idx) => idx !== i));
  }

  // COT.1/COT.2: valores what-if (gasoil/velocidad/margen) por encima de la
  // config real, nunca la tocan. Solo las claves rellenas entran como override.
  function overridesActivos() {
    const overrides = {};
    if (whatIf.velocidadKmh !== "") overrides.velocidadKmh = Number(whatIf.velocidadKmh);
    if (whatIf.precioGasoilLitro !== "") overrides.precioGasoilLitro = Number(whatIf.precioGasoilLitro);
    if (whatIf.margenObjetivoPct !== "") overrides.margenObjetivoPct = Number(whatIf.margenObjetivoPct);
    return Object.keys(overrides).length > 0 ? overrides : null;
  }

  const calcular = useCallback(async () => {
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
      const r = await calcularPresupuesto({ puntos: validos, vehiculoId: vehiculoId || null, overrides: overridesActivos() });
      setResultado(r);
    } catch (err) {
      // Ítem 9.35: un fallo real de lectura se muestra como error visible
      // (el botón "Calcular" de abajo ya sirve de "reintentar"), no como
      // "sin resultado".
      setError("No se pudo calcular el presupuesto: " + err.message);
    } finally {
      setCalculando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puntos, vehiculoId, whatIf]);

  // Recalcula en vivo (debounced) al mover un control what-if, pero solo si
  // ya hay un resultado en pantalla — no dispara el primer cálculo solo.
  useEffect(() => {
    if (!resultado) return;
    clearTimeout(timerWhatIf.current);
    timerWhatIf.current = setTimeout(() => { calcular(); }, 250);
    return () => clearTimeout(timerWhatIf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whatIf.velocidadKmh, whatIf.precioGasoilLitro, whatIf.margenObjetivoPct]);

  function restablecerWhatIf() {
    setWhatIf(WHAT_IF_VACIO);
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

      <div className="mb-4">
      <SectionCard
        variant="plain"
        title="Paradas (en orden)"
        actions={
          <button
            type="button"
            onClick={() => setPuntos((ps) => [...ps, nuevoPunto()])}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
          >
            <Plus size={14} /> Añadir parada
          </button>
        }
      >
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

        {vehiculoId && (
          <div className="mt-4 pt-4 border-t border-border">
            <h2 className="text-sm font-medium text-ink mb-2 flex items-center gap-1.5">
              <Package size={14} /> Carga (opcional)
            </h2>
            {!tieneCapacidad ? (
              <p className="text-xs text-ink-secondary">
                Este vehículo no tiene capacidad configurada — <Link href={`/vehiculos/${vehiculoId}`} className="underline">añádela en su ficha</Link> para ver si la carga es camión completo o grupaje.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 max-w-md">
                  <div>
                    <label htmlFor="carga-ldm" className="block text-xs text-ink-secondary mb-1">LDM</label>
                    <input
                      id="carga-ldm" type="number" step="any" min="0"
                      value={carga.ldm}
                      onChange={(e) => setCarga((c) => ({ ...c, ldm: e.target.value }))}
                      placeholder={`máx. ${vehiculoSeleccionado.capacidad_ldm ?? "—"}`}
                      className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                    />
                  </div>
                  <div>
                    <label htmlFor="carga-kg" className="block text-xs text-ink-secondary mb-1">kg</label>
                    <input
                      id="carga-kg" type="number" step="any" min="0"
                      value={carga.kg}
                      onChange={(e) => setCarga((c) => ({ ...c, kg: e.target.value }))}
                      placeholder={`máx. ${vehiculoSeleccionado.capacidad_kg ?? "—"}`}
                      className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                    />
                  </div>
                  <div>
                    <label htmlFor="carga-m3" className="block text-xs text-ink-secondary mb-1">m³</label>
                    <input
                      id="carga-m3" type="number" step="any" min="0"
                      value={carga.m3}
                      onChange={(e) => setCarga((c) => ({ ...c, m3: e.target.value }))}
                      placeholder={`máx. ${vehiculoSeleccionado.capacidad_m3 ?? "—"}`}
                      className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                    />
                  </div>
                </div>
                {ocupacion.pctOcupacion != null && (
                  <div className="mt-3 max-w-md">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ocupacion.tipo === "completo" ? "bg-brand/10 text-brand" : "bg-surface-alt text-ink-secondary"}`}>
                        {ocupacion.tipo === "completo" ? "Camión completo (FTL)" : "Grupaje"}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {Math.round(ocupacion.pctOcupacion)}% — limita {ocupacion.dimensionLimitante?.toUpperCase()}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-alt overflow-hidden">
                      <div
                        className={`h-full rounded-full ${ocupacion.tipo === "completo" ? "bg-brand" : "bg-ink-muted"}`}
                        style={{ width: `${Math.min(100, ocupacion.pctOcupacion)}%` }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-ink flex items-center gap-1.5">
              <SlidersHorizontal size={14} /> Simulación (opcional)
            </h2>
            {(whatIf.velocidadKmh !== "" || whatIf.precioGasoilLitro !== "" || whatIf.margenObjetivoPct !== "") && (
              <button
                type="button"
                onClick={restablecerWhatIf}
                className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
              >
                <RotateCcw size={12} /> Restablecer
              </button>
            )}
          </div>
          <p className="text-xs text-ink-secondary mb-3">
            Prueba otros valores sin tocar tu configuración de Ajustes — el resultado se recalcula solo.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="whatif-velocidad" className="block text-xs text-ink-secondary mb-1">Velocidad media (km/h)</label>
              <input
                id="whatif-velocidad"
                type="number" step="any"
                value={whatIf.velocidadKmh}
                onChange={(e) => setWhatIf((w) => ({ ...w, velocidadKmh: e.target.value }))}
                placeholder={`Por defecto: ${config?.velocidad_planificacion_kmh ?? 75}`}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <div>
              <label htmlFor="whatif-gasoil" className="block text-xs text-ink-secondary mb-1">Precio gasoil (€/L)</label>
              <input
                id="whatif-gasoil"
                type="number" step="any"
                value={whatIf.precioGasoilLitro}
                onChange={(e) => setWhatIf((w) => ({ ...w, precioGasoilLitro: e.target.value }))}
                placeholder={`Por defecto: ${config?.precio_gasoil_litro ?? "sin configurar"}`}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <div>
              <label htmlFor="whatif-margen" className="block text-xs text-ink-secondary mb-1">Margen objetivo (%)</label>
              <input
                id="whatif-margen"
                type="number" step="any"
                value={whatIf.margenObjetivoPct}
                onChange={(e) => setWhatIf((w) => ({ ...w, margenObjetivoPct: e.target.value }))}
                placeholder={`Por defecto: ${config?.margen_objetivo_pct ?? 15}`}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
          </div>
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
      </SectionCard>
      </div>

      {resultado && (
        <div className="bg-surface border border-border rounded-xl p-5">
          {(whatIf.velocidadKmh !== "" || whatIf.precioGasoilLitro !== "" || whatIf.margenObjetivoPct !== "") && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {whatIf.velocidadKmh !== "" && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand/10 text-brand font-medium">
                  Simulando: {whatIf.velocidadKmh} km/h
                </span>
              )}
              {whatIf.precioGasoilLitro !== "" && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand/10 text-brand font-medium">
                  Simulando: gasoil {whatIf.precioGasoilLitro} €/L
                </span>
              )}
              {whatIf.margenObjetivoPct !== "" && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand/10 text-brand font-medium">
                  Simulando: margen {whatIf.margenObjetivoPct}%
                </span>
              )}
            </div>
          )}
          <div className="mb-4">
            <div className="text-xs text-ink-secondary mb-1">Precio sugerido</div>
            {resultado.precioSugerido != null ? (
              <div className="text-2xl font-semibold text-ink">
                {fmtEur(resultado.precioSugerido)}
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
              <div className="font-medium text-ink">{resultado.estimado && "~"}{fmtKm(resultado.km)}</div>
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
                        ? fmtEur(resultado.coste[capa])
                        : <span>— configura {LABEL_CAPA[capa].toLowerCase()} en Ajustes</span>}
                    </span>
                  </div>
                ))
              ) : (
                <div>Coste estimado (€/km): {fmtEur(resultado.coste.total)}</div>
              )}
              <div className="flex justify-between font-medium text-ink-secondary pt-0.5 border-t border-border">
                <span>Total coste</span><span>{fmtEur(resultado.coste.total)}</span>
              </div>
            </div>
          )}

          <Link
            href={`/viajes/nuevo-w?${new URLSearchParams({
              puntos: JSON.stringify(puntos.filter((p) => p.lat !== "" && p.lon !== "")),
              ...(vehiculoId ? { vehiculoId } : {}),
              ...(resultado.precioSugerido != null ? { precio: String(resultado.precioSugerido) } : {}),
            }).toString()}`}
            className="mt-4 inline-flex text-sm px-4 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt no-underline"
          >
            Crear viaje con estos datos
          </Link>
        </div>
      )}
    </div>
  );
}
