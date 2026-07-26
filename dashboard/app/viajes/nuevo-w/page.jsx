"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, AlertTriangle, Check, ChevronRight, ChevronUp, ChevronDown, Package, Route } from "lucide-react";
import { getChoferes, createViaje, validarAsignacion, calcularPanelViaje, getEstado561, UMBRAL_MARGEN_AMBAR_PCT, getClientes, calcularOcupacion, sugerirOrdenParadas, getDireccionesGuardadas, getReferenciaSugerida, calcularAvisosViabilidad, getPlantillasRuta, getPlantillaHitos } from "../../../lib/data";
import { supabase } from "../../../lib/supabase";
import SugerenciaChofer from "../../components/SugerenciaChofer";
import Buscador from "../../components/ui/Buscador";
import DireccionAutocomplete from "../../components/ui/DireccionAutocomplete";
import { badgeMargen, fmtEur, fmtKm } from "../../../lib/format";
import RequireRol from "../../components/RequireRol";

// Wizard "Nuevo viaje" (7A.11) — promovido a flujo POR DEFECTO 2026-07-23
// (decisión explícita del usuario, 17.G.3): todos los enlaces "Nuevo viaje"
// (sidebar, /, /viajes) apuntan aquí. /viajes/nuevo se mantiene como
// alternativa de una sola pantalla, ya no se elimina ni se deja de mantener,
// pero deja de recibir features nuevas en paralelo (evitar duplicar trabajo
// en dos wizards). Los hitos aquí SÍ capturan lat/lon (a diferencia de
// /viajes/nuevo, que solo pide dirección de texto) porque el panel de
// cálculo en vivo necesita coordenadas para estimar km/coste/precio sugerido.
function nuevoHito(tipo = "entrega") {
  return { tipo, direccion: "", lat: "", lon: "", ventana_inicio: "", ventana_fin: "", es_checkpoint: false, radio_m: "" };
}

const PASOS = [
  { n: 1, label: "Ruta" },
  { n: 2, label: "Asignación" },
  { n: 3, label: "Confirmar" },
];

/** Lee `?puntos=`/`vehiculoId=`/`precio=` (precarga desde el presupuestador,
 * 7A.6 → 7A.11) y devuelve los hitos iniciales, o null si no hay nada válido
 * que precargar. `puntos` es el JSON de `{label, lat, lon}[]` de /presupuesto. */
function prefillHitosDesdeUrl(searchParams) {
  try {
    const raw = searchParams.get("puntos");
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length < 2) return null;
    return arr.map((p, i) => ({
      tipo: i === 0 ? "recogida" : "entrega",
      direccion: p.label || "",
      lat: p.lat != null ? String(p.lat) : "",
      lon: p.lon != null ? String(p.lon) : "",
      // 18.D.4: si venían fechas de carga/descarga desde /presupuesto, se
      // conservan -- ya se molestó en ponerlas una vez, no hay que repetirlo.
      ventana_inicio: p.ventana_inicio || "",
      ventana_fin: p.ventana_fin || "",
      es_checkpoint: false,
      radio_m: "",
    }));
  } catch {
    return null;
  }
}

export default function NuevoViajeWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [paso, setPaso] = useState(1);
  const [referencia, setReferencia] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clientes, setClientes] = useState([]);
  const [precio, setPrecio] = useState(() => searchParams.get("precio") || "");
  const [hitos, setHitos] = useState(() => prefillHitosDesdeUrl(searchParams) || [nuevoHito("recogida"), nuevoHito("entrega")]);
  const [choferId, setChoferId] = useState("");
  const [choferNombre, setChoferNombre] = useState("");
  const [vehiculoId, setVehiculoId] = useState(() => searchParams.get("vehiculoId") || "");
  const [remolqueId, setRemolqueId] = useState("");
  const [vehiculos, setVehiculos] = useState([]);
  const [choferes, setChoferes] = useState([]);
  const [direccionesGuardadas, setDireccionesGuardadas] = useState([]);
  const [panel, setPanel] = useState(null);
  const [calculandoPanel, setCalculandoPanel] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [avisoAsignacion, setAvisoAsignacion] = useState(null);
  const [aviso561, setAviso561] = useState(null);
  const [carga, setCarga] = useState({ ldm: "", kg: "", m3: "", valorMercancia: "" });
  const [sugerenciaOrden, setSugerenciaOrden] = useState(null);
  const [plantillas, setPlantillas] = useState([]);
  const [plantillaId, setPlantillaId] = useState("");
  const debounceRef = useRef(null);

  useEffect(() => {
    getChoferes().then(setChoferes);
    supabase.from("vehiculo").select("id, matricula, tipo, marca, modelo, capacidad_ldm, capacidad_kg, capacidad_m3").eq("activo", true).order("matricula")
      .then(({ data }) => setVehiculos(data || []));
    getClientes().then(setClientes);
    getDireccionesGuardadas().then(setDireccionesGuardadas);
    getReferenciaSugerida().then(setReferencia);
  }, []);

  // Hallazgo real 2026-07-22: "Madrid a Burdeos en 1h" se podía guardar tal
  // cual, sin ningún aviso. Recalcula en cada cambio de hitos (barato, es
  // sync/puro, no hace falta debounce como el panel de km/coste que sí llama
  // a red más abajo).
  const avisosViabilidad = useMemo(() => calcularAvisosViabilidad(hitos), [hitos]);

  // 17.G.1: al elegir cliente, ofrecer sus rutas guardadas (plantilla_ruta)
  // para no rellenar direcciones/coordenadas a mano si ya se hizo antes.
  useEffect(() => {
    setPlantillaId("");
    getPlantillasRuta(clienteId || null).then(setPlantillas);
  }, [clienteId]);

  async function cargarPlantilla(id) {
    setPlantillaId(id);
    if (!id) return;
    const hitosPlantilla = await getPlantillaHitos(id);
    if (!hitosPlantilla.length) return;
    setHitos(
      hitosPlantilla.map((h) => ({
        tipo: h.tipo,
        direccion: h.direccion || "",
        lat: h.lat != null ? String(h.lat) : "",
        lon: h.lon != null ? String(h.lon) : "",
        ventana_inicio: "",
        ventana_fin: "",
        es_checkpoint: false,
        radio_m: "",
      }))
    );
  }

  const tractoras = vehiculos.filter((v) => ["tractora", "rigido", "furgoneta"].includes(v.tipo));
  const remolques = vehiculos.filter((v) => v.tipo === "remolque");
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

  // Panel lateral: recalcula con debounce 500ms cuando cambian hitos con
  // coords, vehículo o precio. CARGA.3: la ocupación (arriba) es un cálculo
  // puro y síncrono aparte, no necesita entrar en este debounce.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const puntos = hitos
      .filter((h) => h.lat !== "" && h.lon !== "" && h.lat != null && h.lon != null)
      .map((h) => ({ lat: Number(h.lat), lon: Number(h.lon) }));
    if (puntos.length < 2) {
      setPanel(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setCalculandoPanel(true);
      calcularPanelViaje({ puntos, vehiculoId: vehiculoId || null, precio: precio !== "" ? Number(precio) : null })
        .then(setPanel)
        .finally(() => setCalculandoPanel(false));
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [hitos, vehiculoId, precio]);

  function actualizarHito(i, campo, valor) {
    setHitos((hs) => hs.map((h, idx) => (idx === i ? { ...h, [campo]: valor } : h)));
    setSugerenciaOrden(null); // F13.6: cualquier edición manual invalida la sugerencia calculada
  }

  // F13.6 (SUGERENCIA, no dispatch automático): usa el índice del array como
  // id sintético -- estos hitos aún no existen en BD, no tienen id real.
  function sugerirOrden() {
    const conId = hitos.map((h, i) => ({
      ...h, id: i, orden: i,
      lat: h.lat === "" ? null : Number(h.lat),
      lon: h.lon === "" ? null : Number(h.lon),
    }));
    const r = sugerirOrdenParadas(conId);
    // null = falta coordenadas o las paradas intermedias mezclan tipos
    // (recogida+entrega, limitación v1) -- se comunica igual, no en silencio.
    setSugerenciaOrden(r || { mereceLaPena: false, sinDatos: true });
  }

  function aplicarOrdenSugerido() {
    if (!sugerenciaOrden?.mereceLaPena) return;
    setHitos((hs) => sugerenciaOrden.ordenSugerido.map((idx) => hs[idx]));
    setSugerenciaOrden(null);
  }

  async function irAPaso2() {
    setError(null);
    const result = await validarAsignacion({
      vehiculoId: vehiculoId || null, remolqueId: remolqueId || null, referencia: referencia.trim() || null,
    });
    if (!result.ok) {
      setError(result.errores.join(". "));
      return;
    }
    setAvisoAsignacion(result.avisos.length ? result.avisos.join(". ") : null);
    setPaso(2);
  }

  async function onAsignarChofer(id) {
    setChoferId(id);
    setChoferNombre(choferes.find((c) => c.id === id)?.nombre || "");
    setAviso561(null);
    try {
      const est = await getEstado561(id);
      if (est && est.pct7 >= 80) {
        setAviso561(`Cerca del límite semanal: quedan ${est.margen7} h (est.)`);
      }
    } catch {
      // Aviso secundario (no bloquea la asignación, 9.35): si falla, se
      // omite el aviso de 561 en vez de romper el wizard de nuevo viaje.
    }
  }

  async function crear() {
    setGuardando(true);
    setError(null);
    try {
      const result = await createViaje({
        referencia: referencia.trim() || null,
        choferId: choferId || null,
        vehiculoId: vehiculoId || null,
        remolqueId: remolqueId || null,
        clienteId: clienteId || null,
        hitos: hitos.filter((h) => h.direccion.trim()),
        precio: precio !== "" ? Number(precio) : null,
        carga,
      });
      // 18.A.2 (caso b): la viabilidad no daba 100% -- el viaje se creó pero
      // queda pendiente de aprobación del jefe de tráfico antes de arrancar.
      if (result.pendienteAprobacion) {
        alert("Este viaje se ha creado como pendiente de aprobación: la ventana horaria no parece viable con los descansos legales obligatorios. Un admin o gestor operativo debe aprobarlo en Ajustes → Equipo antes de que arranque.");
      }
      // ROADMAP 20.6: la carga declarada supera el seguro máximo de la empresa.
      if (result.avisoSeguro) {
        alert(
          `Aviso: la carga declarada (${result.avisoSeguro.valorMercanciaEur.toLocaleString("es-ES")} €) supera el ` +
          `seguro máximo de la empresa (${result.avisoSeguro.valorAseguradoMaximoEur.toLocaleString("es-ES")} €) por ` +
          `${result.avisoSeguro.excesoEur.toLocaleString("es-ES")} €. El viaje se ha creado igualmente.`
        );
      }
      router.push(`/viajes/${result.viaje.id}`);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary no-underline mb-4 hover:text-ink">
        <ArrowLeft size={16} /> Volver
      </Link>
      <h1 className="text-xl font-medium text-ink mb-1">Nuevo viaje</h1>
      <p className="text-xs text-ink-muted mb-6">
        ¿Prefieres el formulario de una sola pantalla?{" "}
        <Link href="/viajes/nuevo" className="text-brand no-underline hover:underline">Nuevo viaje (clásico)</Link>.
      </p>

      <div className="flex items-center gap-2 mb-6">
        {PASOS.map((p, i) => (
          <div key={p.n} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 text-sm ${paso === p.n ? "text-ink font-medium" : paso > p.n ? "text-estado-ok" : "text-ink-muted"}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                paso > p.n ? "bg-green-50 text-estado-ok" : paso === p.n ? "bg-brand text-white" : "bg-border text-ink-muted"
              }`}>
                {paso > p.n ? <Check size={12} /> : p.n}
              </span>
              {p.label}
            </div>
            {i < PASOS.length - 1 && <ChevronRight size={14} className="text-ink-muted" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-estado-incidencia">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {paso === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="w-referencia" className="block text-xs text-ink-secondary mb-1">Referencia</label>
                <input
                  id="w-referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)}
                  placeholder="VJ-2055" maxLength={50}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
              </div>
              <div>
                <label htmlFor="w-cliente" className="block text-xs text-ink-secondary mb-1">Cliente</label>
                <Buscador
                  opciones={clientes.map((c) => ({ value: c.id, label: c.nombre }))}
                  value={clienteId}
                  onChange={setClienteId}
                  placeholder="Buscar cliente..."
                  vacioLabel="Sin cliente asociado"
                />
              </div>
              <RequireRol roles={["admin"]}>
                <div>
                  <label htmlFor="w-precio" className="block text-xs text-ink-secondary mb-1">Precio (€)</label>
                  <input
                    id="w-precio" type="number" step="any" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)}
                    placeholder="1200"
                    className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                  />
                </div>
              </RequireRol>
            </div>

            {plantillas.length > 0 && (
              <div>
                <label className="block text-xs text-ink-secondary mb-1">
                  Cargar desde ruta guardada {clienteId ? "de este cliente" : "genérica"} (rellena las paradas por ti)
                </label>
                <Buscador
                  opciones={plantillas.map((p) => ({ value: p.id, label: p.nombre }))}
                  value={plantillaId}
                  onChange={cargarPlantilla}
                  placeholder="Buscar ruta guardada..."
                  vacioLabel="No usar plantilla"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-ink">Paradas</label>
                <div className="flex items-center gap-2">
                  {hitos.length > 3 && (
                    <button
                      type="button" onClick={sugerirOrden}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
                    >
                      <Route size={14} /> Sugerir orden óptimo
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setHitos((hs) => [...hs.slice(0, -1), nuevoHito("entrega"), hs[hs.length - 1]])}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-ink-secondary hover:bg-surface-alt"
                  >
                    <Plus size={14} /> Añadir parada intermedia
                  </button>
                </div>
              </div>
              {sugerenciaOrden && (
                <div className="mb-3 text-xs bg-surface-alt border border-border rounded-md px-3 py-2 flex items-center justify-between gap-2">
                  {sugerenciaOrden.mereceLaPena ? (
                    <>
                      <span className="text-ink-secondary">
                        Ahorro estimado reordenando las paradas intermedias: <strong className="text-ink">{sugerenciaOrden.ahorroKm} km</strong>
                        {" "}({sugerenciaOrden.kmActual} km → {sugerenciaOrden.kmSugerido} km). Estimación en línea recta, no sustituye el cálculo con OSRM.
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button type="button" onClick={aplicarOrdenSugerido} className="text-xs px-2 py-1 rounded-md bg-brand text-white font-medium">Aplicar</button>
                        <button type="button" onClick={() => setSugerenciaOrden(null)} className="text-xs px-2 py-1 rounded-md border border-border text-ink-secondary">Descartar</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="text-ink-secondary">
                        {sugerenciaOrden.sinDatos
                          ? "No se puede sugerir un orden: faltan coordenadas en alguna parada, o las paradas intermedias mezclan recogidas y entregas."
                          : "El orden actual ya es (casi) óptimo — no merece la pena reordenar."}
                      </span>
                      <button type="button" onClick={() => setSugerenciaOrden(null)} className="text-xs px-2 py-1 rounded-md border border-border text-ink-secondary shrink-0">Cerrar</button>
                    </>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-3">
                {hitos.map((h, i) => {
                  const esPrimera = i === 0;
                  const esUltima = i === hitos.length - 1;
                  const esIntermedia = !esPrimera && !esUltima;
                  return (
                  <div key={i} className="bg-surface border border-border rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-xs text-ink-muted w-5">{i + 1}.</span>
                      {esIntermedia ? (
                        <select
                          value={h.tipo} onChange={(e) => actualizarHito(i, "tipo", e.target.value)}
                          className="text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:border-brand"
                        >
                          <option value="recogida">Recogida</option>
                          <option value="entrega">Entrega</option>
                        </select>
                      ) : (
                        // Primera y última parada: tipo fijo, no editable (2026-07-22,
                        // decisión de producto: toda ruta empieza en recogida y acaba
                        // en entrega; las intermedias sí se eligen libremente).
                        <span className="text-sm text-ink-secondary px-2 py-1.5 w-24 shrink-0">
                          {esPrimera ? "Recogida" : "Entrega"}
                        </span>
                      )}
                      <DireccionAutocomplete
                        value={h.direccion}
                        onChangeDireccion={(v) => actualizarHito(i, "direccion", v)}
                        onElegirSugerida={(d) => {
                          actualizarHito(i, "direccion", d.direccion);
                          actualizarHito(i, "lat", String(d.lat));
                          actualizarHito(i, "lon", String(d.lon));
                        }}
                        direcciones={direccionesGuardadas}
                        placeholder="Dirección"
                      />
                      {esIntermedia && (
                        <>
                          <button
                            type="button" disabled={i <= 1} aria-label="Mover antes"
                            onClick={() => setHitos((hs) => { const c = [...hs]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; })}
                            className="text-ink-muted hover:text-brand p-1 disabled:opacity-30"
                          >
                            <ChevronUp size={16} />
                          </button>
                          <button
                            type="button" disabled={i >= hitos.length - 2} aria-label="Mover después"
                            onClick={() => setHitos((hs) => { const c = [...hs]; [c[i], c[i + 1]] = [c[i + 1], c[i]]; return c; })}
                            className="text-ink-muted hover:text-brand p-1 disabled:opacity-30"
                          >
                            <ChevronDown size={16} />
                          </button>
                          <button type="button" onClick={() => setHitos((hs) => hs.filter((_, idx) => idx !== i))} aria-label="Quitar parada" className="text-ink-muted hover:text-estado-incidencia p-1">
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pl-7 mb-2">
                      {/* 18.D.2: elegir una sugerencia del buscador ya rellena esto — el
                          usuario ya no debería necesitar teclear coordenadas nunca. Se deja
                          un ajuste manual, plegado, solo para el caso raro en que el
                          geocodificador no encuentre el punto exacto. */}
                      <span className={`text-xs ${h.lat && h.lon ? "text-estado-ok" : "text-ink-muted"}`}>
                        {h.lat && h.lon
                          ? `✓ ubicado (${Number(h.lat).toFixed(3)}, ${Number(h.lon).toFixed(3)})`
                          : "elige una sugerencia para ubicar el punto"}
                      </span>
                      <details className="text-xs text-ink-muted">
                        <summary className="cursor-pointer hover:text-ink-secondary">ajustar a mano</summary>
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            type="number" step="any" value={h.lat} onChange={(e) => actualizarHito(i, "lat", e.target.value)}
                            placeholder="Latitud" className="w-28 text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand"
                          />
                          <input
                            type="number" step="any" value={h.lon} onChange={(e) => actualizarHito(i, "lon", e.target.value)}
                            placeholder="Longitud" className="w-28 text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand"
                          />
                        </div>
                      </details>
                    </div>
                    <div className="flex items-center gap-2 pl-7 mb-2">
                      <span className="text-xs text-ink-muted">Ventana:</span>
                      <input type="datetime-local" value={h.ventana_inicio} onChange={(e) => actualizarHito(i, "ventana_inicio", e.target.value)} className="text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand" />
                      <span className="text-xs text-ink-muted">–</span>
                      <input type="datetime-local" value={h.ventana_fin} onChange={(e) => actualizarHito(i, "ventana_fin", e.target.value)} className="text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand" />
                    </div>
                    <div className="flex items-center gap-2 pl-7">
                      <label className="flex items-center gap-1.5 text-xs text-ink-secondary cursor-pointer">
                        <input
                          type="checkbox" checked={h.es_checkpoint}
                          onChange={(e) => actualizarHito(i, "es_checkpoint", e.target.checked)}
                          className="rounded border-border"
                        />
                        Punto de control obligatorio (checkpoint)
                      </label>
                      {h.es_checkpoint && (
                        <input
                          type="number" step="1" min="0" value={h.radio_m}
                          onChange={(e) => actualizarHito(i, "radio_m", e.target.value)}
                          placeholder="por defecto: 300m"
                          className="w-32 text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-brand"
                        />
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>

            {avisosViabilidad.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {avisosViabilidad.map((a) => (
                  <p key={a.indice} className="text-xs text-estado-incidencia flex items-start gap-1.5 bg-red-50 rounded-md px-2.5 py-2">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {a.mensaje}
                  </p>
                ))}
              </div>
            )}
            <button onClick={irAPaso2} className="self-start text-sm px-4 py-2 rounded-md bg-brand text-white font-medium">
              Siguiente: Asignación
            </button>
          </div>

          <aside className="bg-surface border border-border rounded-xl p-4 h-fit lg:sticky lg:top-4">
            <h2 className="text-sm font-medium text-ink mb-3">Cálculo en vivo</h2>
            {!panel ? (
              <p className="text-xs text-ink-muted">Añade latitud/longitud a 2 paradas para ver el cálculo.</p>
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                <div>
                  <div className="text-xs text-ink-secondary">Distancia</div>
                  <div className="text-ink font-medium">{panel.estimado && "~"}{fmtKm(panel.km)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-secondary">Conducción / paradas / descansos</div>
                  <div className="text-ink font-medium">{panel.horasConduccion} h · {panel.paradas45min} · {panel.descansos11h}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-secondary">Noches fuera (est.)</div>
                  <div className="text-ink font-medium">{panel.noches}</div>
                </div>
                <RequireRol roles={["admin"]}>
                  {panel.coste.total != null && (
                    <div>
                      <div className="text-xs text-ink-secondary">Coste estimado</div>
                      <div className="text-ink font-medium">{fmtEur(panel.coste.total)}</div>
                    </div>
                  )}
                  {panel.precioSugerido != null && (
                    <div>
                      <div className="text-xs text-ink-secondary">Precio sugerido (margen {panel.margenObjetivo}%)</div>
                      <div className="text-ink font-medium">{fmtEur(panel.precioSugerido)}</div>
                    </div>
                  )}
                  {panel.margenPct != null && (
                    <div className={`text-xs px-2 py-1.5 rounded-md ${badgeMargen(panel.margen, panel.margenPct, UMBRAL_MARGEN_AMBAR_PCT)}`}>
                      Margen con tu precio: {fmtEur(panel.margen)} ({panel.margenPct}%)
                    </div>
                  )}
                </RequireRol>
                {panel.estimado && (
                  <p className="text-xs text-yellow-700">~ distancia estimada en línea recta corregida.</p>
                )}
                {calculandoPanel && <p className="text-xs text-ink-muted">Recalculando…</p>}
              </div>
            )}
          </aside>
        </div>
      )}

      {paso === 2 && (
        <div className="flex flex-col gap-5 max-w-2xl">
          {/* 18.C.2 (Fase 18, "pool de viajes", 2026-07-24): esto es opcional a
              propósito. Feedback real del usuario, confirmado con un gestor de
              tráfico de verdad: quien CREA el viaje no tiene por qué saber (ni
              decidir) qué camión concreto lo hace -- eso lo decide después el
              jefe de tráfico/gestor al que se le adjudique. Sin elegir nada
              aquí, el viaje se crea "en el pool" (sin gestor, sin chófer, sin
              vehículo) y se reparte luego desde Ajustes → Equipo. */}
          <div className="text-xs text-ink-secondary bg-surface-alt border border-border rounded-md px-3 py-2">
            Todo esto es opcional. Si no sabes todavía quién lo va a hacer, salta directamente a{" "}
            <button type="button" onClick={() => setPaso(3)} className="underline text-brand font-medium">
              Confirmar
            </button>{" "}
            y el viaje se crea sin asignar, en el pool — se reparte después desde Ajustes → Equipo.
          </div>
          {avisoAsignacion && (
            <p className="text-xs text-yellow-700 flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> {avisoAsignacion}</p>
          )}
          <SugerenciaChofer
            viajeId={null}
            hitosOverride={hitos
              .filter((h) => h.lat !== "" && h.lon !== "" && h.lat != null && h.lon != null)
              .map((h, i) => ({ orden: i + 1, lat: Number(h.lat), lon: Number(h.lon) }))}
            onAsignado={onAsignarChofer}
          />
          <div>
            <label className="block text-xs text-ink-secondary mb-1">
              O busca directamente entre todos los chóferes (la sugerencia de arriba solo muestra los 5 mejores)
            </label>
            <Buscador
              opciones={choferes.map((c) => ({ value: c.id, label: c.nombre, sublabel: c.idioma?.toUpperCase() }))}
              value={choferId}
              onChange={(id) => id && onAsignarChofer(id)}
              placeholder="Buscar chófer por nombre..."
            />
          </div>
          {choferId && (
            <div className="text-sm text-ink bg-surface border border-border rounded-xl p-3">
              Asignado: <strong>{choferNombre}</strong>
              {aviso561 && <p className="text-xs text-yellow-700 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> {aviso561}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="w-vehiculo" className="block text-xs text-ink-secondary mb-1">Vehículo</label>
              <Buscador
                opciones={tractoras.map((v) => ({ value: v.id, label: v.matricula, sublabel: [v.marca, v.modelo].filter(Boolean).join(" ") }))}
                value={vehiculoId}
                onChange={setVehiculoId}
                placeholder="Matrícula, marca o modelo..."
              />
            </div>
            <div>
              <label htmlFor="w-remolque" className="block text-xs text-ink-secondary mb-1">Remolque</label>
              <Buscador
                opciones={remolques.map((v) => ({ value: v.id, label: v.matricula, sublabel: [v.marca, v.modelo].filter(Boolean).join(" ") }))}
                value={remolqueId}
                onChange={setRemolqueId}
                placeholder="Matrícula, marca o modelo..."
                vacioLabel="Sin remolque"
              />
            </div>
          </div>

          <div>
            <label htmlFor="w-valor-mercancia" className="block text-xs text-ink-secondary mb-1">Valor de mercancía (€, opcional)</label>
            <input id="w-valor-mercancia" type="number" step="any" min="0" value={carga.valorMercancia}
              onChange={(e) => setCarga((c) => ({ ...c, valorMercancia: e.target.value }))}
              placeholder="Para avisar si supera el seguro de la empresa"
              className="w-full max-w-xs text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand" />
          </div>

          {vehiculoId && (
            <div>
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
                      <label htmlFor="w-carga-ldm" className="block text-xs text-ink-secondary mb-1">LDM</label>
                      <input id="w-carga-ldm" type="number" step="any" min="0" value={carga.ldm}
                        onChange={(e) => setCarga((c) => ({ ...c, ldm: e.target.value }))}
                        placeholder={`máx. ${vehiculoSeleccionado.capacidad_ldm ?? "—"}`}
                        className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand" />
                    </div>
                    <div>
                      <label htmlFor="w-carga-kg" className="block text-xs text-ink-secondary mb-1">kg</label>
                      <input id="w-carga-kg" type="number" step="any" min="0" value={carga.kg}
                        onChange={(e) => setCarga((c) => ({ ...c, kg: e.target.value }))}
                        placeholder={`máx. ${vehiculoSeleccionado.capacidad_kg ?? "—"}`}
                        className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand" />
                    </div>
                    <div>
                      <label htmlFor="w-carga-m3" className="block text-xs text-ink-secondary mb-1">m³</label>
                      <input id="w-carga-m3" type="number" step="any" min="0" value={carga.m3}
                        onChange={(e) => setCarga((c) => ({ ...c, m3: e.target.value }))}
                        placeholder={`máx. ${vehiculoSeleccionado.capacidad_m3 ?? "—"}`}
                        className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand" />
                    </div>
                  </div>
                  {ocupacion?.pctOcupacion != null && (
                    <div className="mt-3 max-w-md">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ocupacion.tipo === "completo" ? "bg-brand/10 text-brand" : "bg-border text-ink-secondary"}`}>
                          {ocupacion.tipo === "completo" ? "Camión completo (FTL)" : "Grupaje"}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {Math.round(ocupacion.pctOcupacion)}% — limita {ocupacion.dimensionLimitante?.toUpperCase()}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-border overflow-hidden">
                        <div className={`h-full rounded-full ${ocupacion.excedeCapacidad ? "bg-estado-incidencia" : ocupacion.tipo === "completo" ? "bg-brand" : "bg-ink-muted"}`} style={{ width: `${Math.min(100, ocupacion.pctOcupacion)}%` }} />
                      </div>
                      {ocupacion.excedeCapacidad && (
                        <p className="text-xs text-estado-incidencia flex items-start gap-1.5 bg-red-50 rounded-md px-2.5 py-2 mt-2">
                          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                          La carga supera la capacidad de {ocupacion.dimensionLimitante?.toUpperCase()} del vehículo — no cabe, elige otro vehículo o reduce la carga.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => setPaso(1)} className="text-sm px-4 py-2 rounded-md border border-border text-ink-secondary">Atrás</button>
            <button onClick={() => setPaso(3)} className="text-sm px-4 py-2 rounded-md bg-brand text-white font-medium">Siguiente: Confirmar</button>
          </div>
        </div>
      )}

      {paso === 3 && (
        <div className="flex flex-col gap-4 max-w-xl">
          <div className="bg-surface border border-border rounded-xl p-4 text-sm flex flex-col gap-2">
            <div><span className="text-ink-secondary">Referencia:</span> {referencia || "—"}</div>
            <div><span className="text-ink-secondary">Cliente:</span> {clientes.find((c) => c.id === clienteId)?.nombre || "Sin cliente asociado"}</div>
            <div><span className="text-ink-secondary">Precio:</span> {precio ? fmtEur(Number(precio)) : "—"}</div>
            <div><span className="text-ink-secondary">Paradas:</span> {hitos.filter((h) => h.direccion.trim()).length}</div>
            <div><span className="text-ink-secondary">Chófer:</span> {choferNombre || "Sin asignar (va al pool)"}</div>
            <div><span className="text-ink-secondary">Vehículo:</span> {tractoras.find((v) => v.id === vehiculoId)?.matricula || "Sin asignar (va al pool)"}</div>
            {remolqueId && (
              <div><span className="text-ink-secondary">Remolque:</span> {remolques.find((v) => v.id === remolqueId)?.matricula || "Sin asignar"}</div>
            )}
            {panel && (
              <div className="pt-2 border-t border-border">
                <div className="text-ink-secondary text-xs mb-1">Viabilidad estimada</div>
                {panel.estimado && "~"}{fmtKm(panel.km)}
                {panel.coste.total != null && ` · coste ${fmtEur(panel.coste.total)}`}
                {panel.margen != null && ` · margen ${fmtEur(panel.margen)} (${panel.margenPct}%)`}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPaso(2)} className="text-sm px-4 py-2 rounded-md border border-border text-ink-secondary">Atrás</button>
            <button onClick={crear} disabled={guardando} className="text-sm px-4 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40">
              {guardando ? "Creando…" : "Crear viaje"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
