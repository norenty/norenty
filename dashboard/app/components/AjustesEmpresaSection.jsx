"use client";

import { useState } from "react";
import { Save, Building2, MapPin, Euro, Gauge, Target, Camera, Plus, Trash2 } from "lucide-react";
import RequireRol from "./RequireRol";
import DireccionAutocomplete from "./ui/DireccionAutocomplete";

/** Secciones de configuración de empresa en Ajustes (ítem 9.40): nombre,
 * ubicación base, coste/km, velocidad de planificación y coste desglosado.
 * Presentacional — el estado de cada campo y las funciones `guardarX` (que
 * llaman a `lib/data.js`, ítem 9.39) viven en `ajustes/page.jsx`. */
export default function AjustesEmpresaSection({
  empresa,
  empresaNombre,
  setEmpresaNombre,
  guardarEmpresa,
  bases,
  crearBase,
  eliminarBase,
  baseAccionando,
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
  valorAseguradoMaximo,
  setValorAseguradoMaximo,
  guardarValorAseguradoMaximo,
  indiceGasoil,
  guardando,
}) {
  // 18.C.3 (Fase 18, 2026-07-25): "podemos tener múltiples bases, es algo que
  // debe estar contemplado" -- formulario de alta local a esta sección (mismo
  // patrón que el filtro/selección de AjustesEquipoSection).
  const [nuevaBaseNombre, setNuevaBaseNombre] = useState("");
  const [nuevaBaseDireccion, setNuevaBaseDireccion] = useState("");
  const [nuevaBaseLat, setNuevaBaseLat] = useState("");
  const [nuevaBaseLon, setNuevaBaseLon] = useState("");
  const [anadiendoBase, setAnadiendoBase] = useState(false);

  async function anadirBase() {
    if (!nuevaBaseNombre.trim() || nuevaBaseLat === "" || nuevaBaseLon === "" || anadiendoBase) return;
    setAnadiendoBase(true);
    try {
      await crearBase(nuevaBaseNombre, nuevaBaseLat, nuevaBaseLon);
      setNuevaBaseNombre("");
      setNuevaBaseDireccion("");
      setNuevaBaseLat("");
      setNuevaBaseLon("");
    } finally {
      setAnadiendoBase(false);
    }
  }

  return (
    <>
      <section id="ajustes-empresa" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
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

      <section id="ajustes-ubicacion-base" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
        <div className="flex items-center gap-2 mb-1">
          <MapPin size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Bases / naves</h2>
        </div>
        <p className="text-xs text-ink-secondary mb-4">
          Naves o domicilios de la empresa. Se usan en el informe de nómina para calcular las
          noches fuera (un chófer no está atado a una base fija — cuenta la distancia a la más
          cercana). Añade al menos una si aún no la tienes.
        </p>

        {bases && bases.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {bases.map((b) => (
              <div key={b.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-surface-alt">
                <span className="flex-1 min-w-0 truncate text-ink">{b.nombre}</span>
                <span className="text-xs text-ink-muted font-mono shrink-0">{b.lat.toFixed(3)}, {b.lon.toFixed(3)}</span>
                <button
                  onClick={() => eliminarBase(b.id)}
                  disabled={baseAccionando === b.id}
                  aria-label={`Eliminar base ${b.nombre}`}
                  className="p-1 text-ink-muted hover:text-estado-incidencia disabled:opacity-40 shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 flex-wrap">
          <div className="w-40">
            <label className="block text-xs text-ink-secondary mb-1">Nombre</label>
            <input
              value={nuevaBaseNombre}
              onChange={(e) => setNuevaBaseNombre(e.target.value)}
              placeholder="Nave Madrid"
              maxLength={100}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-ink-secondary mb-1">Dirección</label>
            <DireccionAutocomplete
              value={nuevaBaseDireccion}
              onChangeDireccion={setNuevaBaseDireccion}
              onElegirSugerida={(d) => {
                setNuevaBaseDireccion(d.direccion);
                setNuevaBaseLat(String(d.lat));
                setNuevaBaseLon(String(d.lon));
              }}
              direcciones={[]}
              placeholder="Calle Mayor 3, Madrid"
            />
          </div>
          <button
            onClick={anadirBase}
            disabled={anadiendoBase || !nuevaBaseNombre.trim() || nuevaBaseLat === ""}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40 shrink-0"
          >
            <Plus size={16} /> Añadir
          </button>
        </div>
        {nuevaBaseDireccion && nuevaBaseLat === "" && (
          <p className="text-xs text-ink-muted mt-1.5">Elige una sugerencia de la lista para ubicar la dirección.</p>
        )}
      </section>

      <RequireRol roles={["admin"]}>
      <section id="ajustes-coste-km" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
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

      <section id="ajustes-velocidad" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
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
      <section id="ajustes-objetivos" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
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
          <div className="flex items-end gap-3">
            <div className="max-w-[10rem]">
              <label htmlFor="ajustes-valor-asegurado" className="block text-xs text-ink-secondary mb-1">Seguro carga máx. (€)</label>
              <input
                id="ajustes-valor-asegurado"
                type="number" step="any" min="0"
                value={valorAseguradoMaximo}
                onChange={(e) => setValorAseguradoMaximo(e.target.value)}
                placeholder="300000"
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <button
              onClick={guardarValorAseguradoMaximo}
              disabled={guardando}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
            >
              <Save size={16} /> Guardar
            </button>
          </div>
        </div>
        <p className="text-xs text-ink-secondary mt-2">
          Valor máximo cubierto por el seguro de mercancía (CMR). Si un viaje declara una carga
          por encima de este importe, se avisa al crearlo (ROADMAP 20.6).
        </p>
      </section>
      </RequireRol>

      <RequireRol roles={["admin"]}>
      <section id="ajustes-pod" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
        <div className="flex items-center gap-2 mb-1">
          <Camera size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Prueba de entrega (POD)</h2>
        </div>
        <p className="text-xs text-ink-secondary mb-4">
          El albarán firmado tiene valor legal como prueba de entrega, así que de momento
          queda siempre obligatorio (18.B.4: pendiente de consulta con asesoría legal antes
          de poder desactivarlo).
        </p>
        <label className="flex items-center gap-2 text-sm text-ink-secondary w-fit">
          <input type="checkbox" checked disabled className="rounded border-border" />
          Pedir foto de albarán en cada entrega (obligatorio)
        </label>
      </section>
      </RequireRol>

      <RequireRol roles={["admin"]}>
      <section id="ajustes-coste-desglosado" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
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
            {indiceGasoil?.precio_medio_eur != null && (
              <button
                type="button"
                onClick={() => setPrecioGasoil(String(indiceGasoil.precio_medio_eur))}
                className="mt-1 text-xs text-brand hover:underline"
              >
                Usar sugerido: {indiceGasoil.precio_medio_eur} €/l (media nacional)
              </button>
            )}
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
