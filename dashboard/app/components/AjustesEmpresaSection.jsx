"use client";

import { Save, Building2, MapPin, Euro, Gauge, Target } from "lucide-react";
import RequireRol from "./RequireRol";

/** Secciones de configuración de empresa en Ajustes (ítem 9.40): nombre,
 * ubicación base, coste/km, velocidad de planificación y coste desglosado.
 * Presentacional — el estado de cada campo y las funciones `guardarX` (que
 * llaman a `lib/data.js`, ítem 9.39) viven en `ajustes/page.jsx`. */
export default function AjustesEmpresaSection({
  empresa,
  empresaNombre,
  setEmpresaNombre,
  guardarEmpresa,
  baseLat,
  setBaseLat,
  baseLon,
  setBaseLon,
  guardarBase,
  costeKm,
  setCosteKm,
  guardarCoste,
  velocidadPlanificacion,
  setVelocidadPlanificacion,
  guardarVelocidad,
  velocidadPlanificacionDefault,
  precioGasoil,
  setPrecioGasoil,
  costePeaje,
  setCostePeaje,
  dietaNoche,
  setDietaNoche,
  costeConductor,
  setCosteConductor,
  guardarDesglose,
  objetivoPuntualidad,
  setObjetivoPuntualidad,
  guardarObjetivoPuntualidad,
  margenObjetivo,
  setMargenObjetivo,
  guardarMargen,
  guardando,
}) {
  return (
    <>
      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Empresa</h2>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-ink-secondary mb-1">Nombre</label>
            <input
              value={empresaNombre}
              onChange={(e) => setEmpresaNombre(e.target.value)}
              maxLength={200}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <button
            onClick={guardarEmpresa}
            disabled={guardando}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            <Save size={16} /> Guardar
          </button>
        </div>
        {empresa && (
          <div className="mt-3 text-xs text-ink-muted">
            ID empresa: <span className="font-mono">{empresa.id.slice(0, 12)}…</span>
          </div>
        )}
      </section>

      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <MapPin size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Ubicación base</h2>
        </div>
        <p className="text-xs text-ink-secondary mb-4">
          Coordenadas del domicilio/base de la empresa. Se usan en el informe de
          nómina para calcular las noches fuera (cuando un chófer duerme lejos de
          la base). Déjalas vacías si aún no las tienes.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Latitud</label>
            <input
              type="number"
              step="any"
              value={baseLat}
              onChange={(e) => setBaseLat(e.target.value)}
              placeholder="40.4168"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Longitud</label>
            <input
              type="number"
              step="any"
              value={baseLon}
              onChange={(e) => setBaseLon(e.target.value)}
              placeholder="-3.7038"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
        </div>
        <div className="mt-3">
          <button
            onClick={guardarBase}
            disabled={guardando}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            <Save size={16} /> Guardar base
          </button>
        </div>
      </section>

      <RequireRol roles={["admin"]}>
      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Euro size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Coste de operación</h2>
        </div>
        <p className="text-xs text-ink-secondary mb-4">
          Coste medio por kilómetro de tu flota (combustible + conductor + amortización…).
          Se usa para calcular el margen de cada viaje y detectar los que van a pérdidas.
          Puedes afinarlo por camión en la ficha de cada vehículo (tiene prioridad sobre este).
          Déjalo vacío si aún no lo tienes.
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-[12rem]">
            <label className="block text-xs text-ink-secondary mb-1">Coste por km (€)</label>
            <input
              type="number"
              step="any"
              min="0"
              value={costeKm}
              onChange={(e) => setCosteKm(e.target.value)}
              placeholder="1.20"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <button
            onClick={guardarCoste}
            disabled={guardando}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            <Save size={16} /> Guardar coste
          </button>
        </div>
      </section>
      </RequireRol>

      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Gauge size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Velocidad de planificación</h2>
        </div>
        <p className="text-xs text-ink-secondary mb-4">
          Velocidad media usada para estimar cuántas horas de conducción tiene un viaje (y con
          ello, cuántas paradas legales — 45 min cada 4,5h, descansos de 11h — le corresponden).
          Por defecto {velocidadPlanificacionDefault} km/h. Déjalo vacío para usar ese valor.
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-[12rem]">
            <label className="block text-xs text-ink-secondary mb-1">Velocidad (km/h)</label>
            <input
              type="number"
              step="any"
              min="1"
              value={velocidadPlanificacion}
              onChange={(e) => setVelocidadPlanificacion(e.target.value)}
              placeholder={String(velocidadPlanificacionDefault)}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <button
            onClick={guardarVelocidad}
            disabled={guardando}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            <Save size={16} /> Guardar velocidad
          </button>
        </div>
      </section>

      <RequireRol roles={["admin"]}>
      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Target size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Objetivos</h2>
        </div>
        <p className="text-xs text-ink-secondary mb-4">
          Se muestran como referencia frente al dato real: la puntualidad en Analítica →
          Puntualidad, el margen en el precio sugerido de Presupuesto instantáneo. Deja vacío
          el que aún no quieras fijar.
        </p>
        <div className="flex items-end gap-6 flex-wrap">
          <div className="flex items-end gap-3">
            <div className="max-w-[10rem]">
              <label htmlFor="ajustes-objetivo-puntualidad" className="block text-xs text-ink-secondary mb-1">Puntualidad (%)</label>
              <input
                id="ajustes-objetivo-puntualidad"
                type="number" step="any" min="0" max="100"
                value={objetivoPuntualidad}
                onChange={(e) => setObjetivoPuntualidad(e.target.value)}
                placeholder="95"
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <button
              onClick={guardarObjetivoPuntualidad}
              disabled={guardando}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
            >
              <Save size={16} /> Guardar
            </button>
          </div>
          <div className="flex items-end gap-3">
            <div className="max-w-[10rem]">
              <label htmlFor="ajustes-margen-objetivo" className="block text-xs text-ink-secondary mb-1">Margen (%)</label>
              <input
                id="ajustes-margen-objetivo"
                type="number" step="any" min="0" max="99"
                value={margenObjetivo}
                onChange={(e) => setMargenObjetivo(e.target.value)}
                placeholder="15"
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <button
              onClick={guardarMargen}
              disabled={guardando}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
            >
              <Save size={16} /> Guardar
            </button>
          </div>
        </div>
      </section>
      </RequireRol>

      <RequireRol roles={["admin"]}>
      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Euro size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Coste desglosado (avanzado)</h2>
        </div>
        <p className="text-xs text-ink-secondary mb-4">
          Rellena estos campos para que el coste de cada viaje se calcule por capas (combustible
          real + peajes + dietas + conductor) en vez de un único €/km. Cada campo es opcional: los
          que dejes vacíos simplemente no se suman al total, y se te avisa en cada viaje de qué
          falta por configurar. El consumo del camión (l/100km) se configura en la ficha de cada
          vehículo.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label htmlFor="ajustes-gasoil" className="block text-xs text-ink-secondary mb-1">Gasoil (€/l)</label>
            <input
              id="ajustes-gasoil" type="number" step="any" min="0"
              value={precioGasoil} onChange={(e) => setPrecioGasoil(e.target.value)} placeholder="1.50"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div>
            <label htmlFor="ajustes-peaje" className="block text-xs text-ink-secondary mb-1">Peaje (€/km)</label>
            <input
              id="ajustes-peaje" type="number" step="any" min="0"
              value={costePeaje} onChange={(e) => setCostePeaje(e.target.value)} placeholder="0.10"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div>
            <label htmlFor="ajustes-dieta" className="block text-xs text-ink-secondary mb-1">Dieta (€/noche)</label>
            <input
              id="ajustes-dieta" type="number" step="any" min="0"
              value={dietaNoche} onChange={(e) => setDietaNoche(e.target.value)} placeholder="40"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div>
            <label htmlFor="ajustes-conductor" className="block text-xs text-ink-secondary mb-1">Conductor (€/km)</label>
            <input
              id="ajustes-conductor" type="number" step="any" min="0"
              value={costeConductor} onChange={(e) => setCosteConductor(e.target.value)} placeholder="0.30"
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
        </div>
        <button
          onClick={guardarDesglose}
          disabled={guardando}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
        >
          <Save size={16} /> Guardar coste desglosado
        </button>
      </section>
      </RequireRol>
    </>
  );
}
