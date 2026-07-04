"use client";

import { useEffect, useState } from "react";
import { Save, User, Building2, Bell, Shield, Send, Copy, Check, MapPin, Euro, Gauge, Users, X, Activity } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { getSession, signOut } from "../../lib/auth";
import {
  VELOCIDAD_PLANIFICACION_KMH, getInvitaciones, createInvitacion, deleteInvitacion, getBotHeartbeat,
  getGestoresEmpresa, actualizarRolGestor, desactivarGestor, reactivarGestor,
} from "../../lib/data";
import RequireRol from "../components/RequireRol";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "gestor_operativo", label: "Gestor operativo" },
  { value: "solo_lectura", label: "Solo lectura" },
];

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME;

export default function AjustesPage() {
  const [user, setUser] = useState(null);
  const [empresa, setEmpresa] = useState(null);
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [baseLat, setBaseLat] = useState("");
  const [baseLon, setBaseLon] = useState("");
  const [costeKm, setCosteKm] = useState("");
  const [velocidadPlanificacion, setVelocidadPlanificacion] = useState("");
  const [precioGasoil, setPrecioGasoil] = useState("");
  const [costePeaje, setCostePeaje] = useState("");
  const [dietaNoche, setDietaNoche] = useState("");
  const [costeConductor, setCosteConductor] = useState("");
  const [gestor, setGestor] = useState(null);
  const [prefs, setPrefs] = useState({ notif_incidencias: true, notif_entregas: true, notif_fuera_ventana: false });
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [invitaciones, setInvitaciones] = useState([]);
  const [invitarEmail, setInvitarEmail] = useState("");
  const [invitando, setInvitando] = useState(false);
  const [codigoCopiadoId, setCodigoCopiadoId] = useState(null);
  const [heartbeat, setHeartbeat] = useState(null);
  const [gestores, setGestores] = useState([]);
  const [gestorAccionandoId, setGestorAccionandoId] = useState(null);

  useEffect(() => {
    function cargarHeartbeat() {
      getBotHeartbeat().then(setHeartbeat);
    }
    cargarHeartbeat();
    const intervalo = setInterval(cargarHeartbeat, 30000);
    return () => clearInterval(intervalo);
  }, []);

  useEffect(() => {
    async function init() {
      const session = await getSession();
      setUser(session?.user || null);

      if (session?.user) {
        const { data: g } = await supabase
          .from("gestor")
          .select("*")
          .eq("auth_user_id", session.user.id)
          .limit(1)
          .single();
        if (g) {
          setGestor(g);
          setPrefs({
            notif_incidencias: g.notif_incidencias ?? true,
            notif_entregas: g.notif_entregas ?? true,
            notif_fuera_ventana: g.notif_fuera_ventana ?? false,
          });

          const { data: emp } = await supabase
            .from("empresa")
            .select("*")
            .eq("id", g.empresa_id)
            .single();
          setEmpresa(emp);
          setEmpresaNombre(emp?.nombre || "");
          setBaseLat(emp?.base_lat != null ? String(emp.base_lat) : "");
          setBaseLon(emp?.base_lon != null ? String(emp.base_lon) : "");
          setCosteKm(emp?.coste_km != null ? String(emp.coste_km) : "");
          setVelocidadPlanificacion(emp?.velocidad_planificacion_kmh != null ? String(emp.velocidad_planificacion_kmh) : "");
          setPrecioGasoil(emp?.precio_gasoil_litro != null ? String(emp.precio_gasoil_litro) : "");
          setCostePeaje(emp?.coste_peaje_km != null ? String(emp.coste_peaje_km) : "");
          setDietaNoche(emp?.dieta_noche_eur != null ? String(emp.dieta_noche_eur) : "");
          setCosteConductor(emp?.coste_conductor_km != null ? String(emp.coste_conductor_km) : "");
          setInvitaciones(await getInvitaciones());
          setGestores(await getGestoresEmpresa());
        }
      }
    }
    init();
  }, []);

  async function refrescarGestores() {
    setGestores(await getGestoresEmpresa());
  }

  async function cambiarRolGestor(gestorId, nuevoRol) {
    setGestorAccionandoId(gestorId);
    try {
      await actualizarRolGestor(gestorId, nuevoRol);
      await refrescarGestores();
    } catch (err) {
      flash("Error: " + err.message);
    }
    setGestorAccionandoId(null);
  }

  async function onDesactivarGestor(g) {
    if (!window.confirm(`¿Desactivar a ${g.nombre}? Perderá acceso inmediatamente. Podrás reactivarlo luego.`)) return;
    setGestorAccionandoId(g.id);
    try {
      await desactivarGestor(g.id);
      await refrescarGestores();
    } catch (err) {
      flash("Error: " + err.message);
    }
    setGestorAccionandoId(null);
  }

  async function onReactivarGestor(g) {
    setGestorAccionandoId(g.id);
    try {
      await reactivarGestor(g.id);
      await refrescarGestores();
    } catch (err) {
      flash("Error: " + err.message);
    }
    setGestorAccionandoId(null);
  }

  function flash(msg) {
    setMensaje(msg);
    setTimeout(() => setMensaje(null), 2500);
  }

  async function guardarEmpresa() {
    if (!empresa) return;
    setGuardando(true);
    await supabase.from("empresa").update({ nombre: empresaNombre.trim() }).eq("id", empresa.id);
    flash("Guardado");
    setGuardando(false);
  }

  async function guardarBase() {
    if (!empresa) return;
    const lat = baseLat.trim() === "" ? null : Number(baseLat);
    const lon = baseLon.trim() === "" ? null : Number(baseLon);
    if ((lat != null && (Number.isNaN(lat) || lat < -90 || lat > 90)) ||
        (lon != null && (Number.isNaN(lon) || lon < -180 || lon > 180))) {
      flash("Error: coordenadas inválidas");
      return;
    }
    // Ambas o ninguna: una base a medias no sirve para el cálculo.
    if ((lat == null) !== (lon == null)) {
      flash("Error: rellena latitud y longitud, o deja ambas vacías");
      return;
    }
    setGuardando(true);
    await supabase.from("empresa").update({ base_lat: lat, base_lon: lon }).eq("id", empresa.id);
    flash("Ubicación base guardada");
    setGuardando(false);
  }

  async function guardarCoste() {
    if (!empresa) return;
    const coste = costeKm.trim() === "" ? null : Number(costeKm);
    if (coste != null && (Number.isNaN(coste) || coste < 0)) {
      flash("Error: el coste por km debe ser un número positivo");
      return;
    }
    setGuardando(true);
    await supabase.from("empresa").update({ coste_km: coste }).eq("id", empresa.id);
    flash("Coste por km guardado");
    setGuardando(false);
  }

  async function guardarVelocidad() {
    if (!empresa) return;
    const velocidad = velocidadPlanificacion.trim() === "" ? null : Number(velocidadPlanificacion);
    if (velocidad != null && (Number.isNaN(velocidad) || velocidad <= 0)) {
      flash("Error: la velocidad debe ser un número mayor que 0");
      return;
    }
    setGuardando(true);
    await supabase.from("empresa").update({ velocidad_planificacion_kmh: velocidad }).eq("id", empresa.id);
    flash("Velocidad de planificación guardada");
    setGuardando(false);
  }

  async function guardarDesglose() {
    if (!empresa) return;
    const campos = {
      precio_gasoil_litro: precioGasoil, coste_peaje_km: costePeaje,
      dieta_noche_eur: dietaNoche, coste_conductor_km: costeConductor,
    };
    const valores = {};
    for (const [campo, valorStr] of Object.entries(campos)) {
      const v = valorStr.trim() === "" ? null : Number(valorStr);
      if (v != null && (Number.isNaN(v) || v < 0)) {
        flash("Error: los valores deben ser números positivos");
        return;
      }
      valores[campo] = v;
    }
    setGuardando(true);
    await supabase.from("empresa").update(valores).eq("id", empresa.id);
    flash("Coste desglosado guardado");
    setGuardando(false);
  }

  async function enviarInvitacion(e) {
    e.preventDefault();
    if (!invitarEmail.trim()) return;
    setInvitando(true);
    try {
      await createInvitacion(invitarEmail);
      setInvitarEmail("");
      setInvitaciones(await getInvitaciones());
      flash("Invitación creada");
    } catch (err) {
      flash("Error: " + err.message);
    }
    setInvitando(false);
  }

  async function revocarInvitacion(id) {
    await deleteInvitacion(id);
    setInvitaciones(await getInvitaciones());
  }

  function copiarEnlaceInvitacion(inv) {
    const url = `${window.location.origin}/?invitacion=${inv.codigo}`;
    navigator.clipboard.writeText(url);
    setCodigoCopiadoId(inv.id);
    setTimeout(() => setCodigoCopiadoId(null), 2000);
  }

  async function cambiarPassword() {
    if (newPassword.length < 6) return;
    setGuardando(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      flash("Error: " + error.message.replace(/[<>]/g, ""));
    } else {
      flash("Contraseña actualizada");
      setNewPassword("");
    }
    setGuardando(false);
  }

  function copiarEnlaceTelegram() {
    if (!gestor || !BOT) return;
    navigator.clipboard.writeText(`https://t.me/${BOT}?start=gestor_${gestor.id}`);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  async function togglePref(key) {
    if (!gestor) return;
    const newVal = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: newVal }));
    await supabase.from("gestor").update({ [key]: newVal }).eq("id", gestor.id);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-medium text-ink mb-6">Ajustes</h1>

      {mensaje && (
        <div className={`mb-4 text-xs px-3 py-2 rounded-md ${mensaje.startsWith("Error") ? "bg-red-50 text-estado-incidencia" : "bg-green-50 text-estado-ok"}`}>
          {mensaje}
        </div>
      )}

      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <User size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Tu cuenta</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-ink-secondary mb-1">Email</label>
            <input
              value={user?.email || ""}
              readOnly
              className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface-alt text-ink-muted"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-secondary mb-1">ID</label>
            <input
              value={user?.id?.slice(0, 12) || ""}
              readOnly
              className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface-alt text-ink-muted font-mono"
            />
          </div>
        </div>
      </section>

      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Cambiar contraseña</h2>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-ink-secondary mb-1">Nueva contraseña</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              minLength={6}
              maxLength={128}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <button
            onClick={cambiarPassword}
            disabled={guardando || newPassword.length < 6}
            className="text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            Cambiar
          </button>
        </div>
      </section>

      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Send size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Alertas por Telegram</h2>
        </div>
        {!gestor ? (
          <p className="text-xs text-ink-muted">Cargando…</p>
        ) : gestor.telegram_chat_id ? (
          <p className="text-xs text-estado-ok">● Vinculado — recibirás aquí las alertas de incidencias y entregas.</p>
        ) : BOT ? (
          <div className="flex items-center gap-3">
            <p className="flex-1 text-xs text-ink-secondary">
              Sin vincular. Copia el enlace y ábrelo en Telegram para recibir alertas de incidencias y entregas en tiempo real.
            </p>
            <button
              onClick={copiarEnlaceTelegram}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-ink-secondary hover:bg-surface-alt shrink-0"
            >
              {copiado ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar enlace</>}
            </button>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">Bot no configurado (falta NEXT_PUBLIC_BOT_USERNAME).</p>
        )}
      </section>

      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Estado del bot</h2>
        </div>
        <p className="text-xs text-ink-secondary mb-3">
          Latido cada 2 min mientras el proceso del bot está vivo (ítem 8.3). Si lleva más de 5
          min sin señal, algo se ha caído y ningún chófer puede reportar hasta que se reinicie.
        </p>
        {!heartbeat ? (
          <p className="text-xs text-ink-muted">Cargando…</p>
        ) : heartbeat.activo ? (
          <p className="text-xs text-estado-ok">● Activo — último latido hace {heartbeat.segundosDesdeUltimo}s</p>
        ) : heartbeat.ultimoLatido ? (
          <p className="text-xs text-estado-incidencia">
            ● SIN SEÑAL — último latido hace {Math.round(heartbeat.segundosDesdeUltimo / 60)} min
          </p>
        ) : (
          <p className="text-xs text-estado-incidencia">● SIN SEÑAL — nunca se ha registrado un latido</p>
        )}
      </section>

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

      <RequireRol roles={["admin"]}>
      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Users size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Equipo</h2>
        </div>
        <p className="text-xs text-ink-secondary mb-4">
          Invita a otros gestores de tu empresa. El enlace une al gestor nuevo a
          TU empresa (no crea una nueva) y solo se puede usar una vez.
        </p>

        <form onSubmit={enviarInvitacion} className="flex items-end gap-2 mb-4">
          <div className="flex-1">
            <label className="block text-xs text-ink-secondary mb-1">Email a invitar</label>
            <input
              type="email"
              value={invitarEmail}
              onChange={(e) => setInvitarEmail(e.target.value)}
              placeholder="compañero@empresa.com"
              maxLength={254}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>
          <button
            type="submit"
            disabled={invitando}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            <Send size={16} /> Invitar
          </button>
        </form>

        {invitaciones.length === 0 ? (
          <p className="text-xs text-ink-muted">Sin invitaciones todavía.</p>
        ) : (
          <div className="flex flex-col gap-2 mb-5">
            {invitaciones.map((inv) => (
              <div key={inv.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-surface-alt">
                <span className="flex-1 text-ink">{inv.email}</span>
                {inv.usada_at ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-estado-ok">Usada</span>
                ) : (
                  <>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700">Pendiente</span>
                    <button
                      onClick={() => copiarEnlaceInvitacion(inv)}
                      className="p-1.5 text-ink-secondary hover:text-ink"
                      title="Copiar enlace de invitación"
                    >
                      {codigoCopiadoId === inv.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <button
                      onClick={() => revocarInvitacion(inv.id)}
                      className="p-1.5 text-ink-muted hover:text-estado-incidencia"
                      title="Revocar invitación"
                    >
                      <X size={14} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <h3 className="text-xs font-medium text-ink-secondary mb-2 mt-2">Gestores de la empresa</h3>
        {gestores.length === 0 ? (
          <p className="text-xs text-ink-muted">Cargando gestores…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {gestores.map((g) => {
              const esUnoMismo = g.auth_user_id === user?.id;
              return (
                <div key={g.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-surface-alt">
                  <div className="flex-1 min-w-0">
                    <div className="text-ink truncate">{g.nombre}{esUnoMismo && <span className="text-ink-muted"> (tú)</span>}</div>
                    <div className="text-xs text-ink-muted truncate">{g.email}</div>
                  </div>
                  <select
                    value={g.rol}
                    disabled={esUnoMismo || gestorAccionandoId === g.id}
                    onChange={(e) => cambiarRolGestor(g.id, e.target.value)}
                    title={esUnoMismo ? "No puedes cambiar tu propio rol" : "Cambiar rol"}
                    className="text-xs border border-border rounded-md px-2 py-1 disabled:opacity-40"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  {g.activo ? (
                    <button
                      onClick={() => onDesactivarGestor(g)}
                      disabled={esUnoMismo || gestorAccionandoId === g.id}
                      title={esUnoMismo ? "No puedes desactivarte a ti mismo" : "Desactivar gestor"}
                      className="text-xs px-2 py-1 rounded-md border border-border text-estado-incidencia hover:bg-red-50 disabled:opacity-40"
                    >
                      Desactivar
                    </button>
                  ) : (
                    <button
                      onClick={() => onReactivarGestor(g)}
                      disabled={gestorAccionandoId === g.id}
                      className="text-xs px-2 py-1 rounded-md border border-border text-estado-ok hover:bg-green-50 disabled:opacity-40"
                    >
                      Reactivar
                    </button>
                  )}
                  {!g.activo && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-ink-muted">Desactivado</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      </RequireRol>

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
          Por defecto {VELOCIDAD_PLANIFICACION_KMH} km/h. Déjalo vacío para usar ese valor.
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
              placeholder={String(VELOCIDAD_PLANIFICACION_KMH)}
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

      <section className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Bell size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Notificaciones</h2>
        </div>
        {!gestor ? (
          <p className="text-xs text-ink-muted">Cargando preferencias…</p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.notif_incidencias}
                onChange={() => togglePref("notif_incidencias")}
                className="accent-brand w-4 h-4"
              />
              <div>
                <div className="text-sm text-ink">Incidencias</div>
                <div className="text-xs text-ink-secondary">Notificar cuando se detecte una incidencia</div>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.notif_entregas}
                onChange={() => togglePref("notif_entregas")}
                className="accent-brand w-4 h-4"
              />
              <div>
                <div className="text-sm text-ink">Entregas completadas</div>
                <div className="text-xs text-ink-secondary">Notificar cuando un viaje se complete</div>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.notif_fuera_ventana}
                onChange={() => togglePref("notif_fuera_ventana")}
                className="accent-brand w-4 h-4"
              />
              <div>
                <div className="text-sm text-ink">Fuera de ventana</div>
                <div className="text-xs text-ink-secondary">Alerta cuando un hito se sale de su ventana horaria</div>
              </div>
            </label>
          </div>
        )}
      </section>

      <button
        onClick={() => signOut()}
        className="text-sm text-estado-incidencia hover:underline"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
