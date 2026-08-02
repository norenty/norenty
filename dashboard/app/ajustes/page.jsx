"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getSession, signOut, signOutTodasLasSesiones } from "../../lib/auth";
import {
  VELOCIDAD_PLANIFICACION_KMH, UMBRAL_VUELTA_CASA_KM_DEFAULT, guardarUmbralVueltaCasaEmpresa, getInvitaciones, createInvitacion, deleteInvitacion, getBotHeartbeat,
  getGestoresEmpresa, actualizarRolGestor, actualizarRolesGestor, desactivarGestor, reactivarGestor, INVITACION_VALIDEZ_DIAS,
  guardarNombreEmpresa, getBasesEmpresa, crearBaseEmpresa, eliminarBaseEmpresa, guardarCosteKmEmpresa, guardarVelocidadEmpresa,
  guardarDesgloseCosteEmpresa, guardarObjetivoPuntualidadEmpresa, guardarMargenObjetivoEmpresa,
  guardarValorAseguradoMaximoEmpresa,
  getChoferesConGestor, guardarGestorChofer, guardarTelefonoGestor,
  getViajesConGestor, guardarGestorViaje, getIndiceGasoilNacional,
  getSolicitudesAprobacion, resolverSolicitudAprobacion, registrarAuditoria,
  getMisVacaciones, solicitarVacaciones, getVacacionesPendientes, resolverVacacion,
  sugerirRedistribucionVacacion,
} from "../../lib/data";
import RequireRol from "../components/RequireRol";
import AjustesPerfilSection from "../components/AjustesPerfilSection";
import AjustesMfaSection from "../components/AjustesMfaSection";
import AjustesBotSection from "../components/AjustesBotSection";
import AjustesEmpresaSection from "../components/AjustesEmpresaSection";
import CalibracionSugerenciaSection from "../components/CalibracionSugerenciaSection";
import AjustesEquipoSection from "../components/AjustesEquipoSection";

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME;

export default function AjustesPage() {
  const [user, setUser] = useState(null);
  const [empresa, setEmpresa] = useState(null);
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [bases, setBases] = useState([]);
  const [baseAccionando, setBaseAccionando] = useState(null);
  const [costeKm, setCosteKm] = useState("");
  const [objetivoPuntualidad, setObjetivoPuntualidad] = useState("");
  const [margenObjetivo, setMargenObjetivo] = useState("");
  const [valorAseguradoMaximo, setValorAseguradoMaximo] = useState("");
  const [velocidadPlanificacion, setVelocidadPlanificacion] = useState("");
  const [umbralVueltaCasa, setUmbralVueltaCasa] = useState("");
  const [precioGasoil, setPrecioGasoil] = useState("");
  const [costePeaje, setCostePeaje] = useState("");
  const [dietaNoche, setDietaNoche] = useState("");
  const [costeConductor, setCosteConductor] = useState("");
  const [indiceGasoil, setIndiceGasoil] = useState(null);
  const [gestor, setGestor] = useState(null);
  const [prefs, setPrefs] = useState({ notif_incidencias: true, notif_entregas: true, notif_fuera_ventana: false });
  const [telefonoGestor, setTelefonoGestor] = useState("");
  const [guardandoTelefonoGestor, setGuardandoTelefonoGestor] = useState(false);
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
  const [choferesEquipo, setChoferesEquipo] = useState([]);
  const [choferAccionandoId, setChoferAccionandoId] = useState(null);
  const [viajesPool, setViajesPool] = useState([]);
  const [viajeAccionandoId, setViajeAccionandoId] = useState(null);
  const [solicitudesAprobacion, setSolicitudesAprobacion] = useState([]);
  const [solicitudAccionandoId, setSolicitudAccionandoId] = useState(null);
  const [misVacaciones, setMisVacaciones] = useState([]);
  const [vacacionesPendientes, setVacacionesPendientes] = useState([]);
  const [vacacionAccionandoId, setVacacionAccionandoId] = useState(null);
  const [fechaInicioVacaciones, setFechaInicioVacaciones] = useState("");
  const [fechaFinVacaciones, setFechaFinVacaciones] = useState("");
  const [solicitandoVacaciones, setSolicitandoVacaciones] = useState(false);
  const [sugerenciaRedistribucion, setSugerenciaRedistribucion] = useState(null);
  const [aplicandoSugerenciaId, setAplicandoSugerenciaId] = useState(null);
  const [mfaFactores, setMfaFactores] = useState([]);
  const [mfaEnrolando, setMfaEnrolando] = useState(false);
  const [mfaQr, setMfaQr] = useState(null);
  const [mfaSecret, setMfaSecret] = useState(null);
  const [mfaFactorId, setMfaFactorId] = useState(null);
  const [mfaCodigo, setMfaCodigo] = useState("");
  const [mfaError, setMfaError] = useState(null);
  const [mfaOcupado, setMfaOcupado] = useState(false);
  const [cerrandoSesiones, setCerrandoSesiones] = useState(false);

  useEffect(() => {
    function cargarHeartbeat() {
      getBotHeartbeat().then(setHeartbeat);
    }
    cargarHeartbeat();
    const intervalo = setInterval(cargarHeartbeat, 30000);
    return () => clearInterval(intervalo);
  }, []);

  async function cargarFactoresMfa() {
    const { data } = await supabase.auth.mfa.listFactors();
    setMfaFactores((data?.totp || []).filter((f) => f.status === "verified"));
  }

  useEffect(() => {
    cargarFactoresMfa();
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
          setTelefonoGestor(g.telefono || "");
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
          setBases(await getBasesEmpresa());
          setCosteKm(emp?.coste_km != null ? String(emp.coste_km) : "");
          setObjetivoPuntualidad(emp?.objetivo_puntualidad_pct != null ? String(emp.objetivo_puntualidad_pct) : "");
          setMargenObjetivo(emp?.margen_objetivo_pct != null ? String(emp.margen_objetivo_pct) : "");
          setValorAseguradoMaximo(emp?.valor_asegurado_maximo_eur != null ? String(emp.valor_asegurado_maximo_eur) : "");
          setVelocidadPlanificacion(emp?.velocidad_planificacion_kmh != null ? String(emp.velocidad_planificacion_kmh) : "");
          setUmbralVueltaCasa(emp?.umbral_vuelta_casa_km != null ? String(emp.umbral_vuelta_casa_km) : "");
          setPrecioGasoil(emp?.precio_gasoil_litro != null ? String(emp.precio_gasoil_litro) : "");
          setCostePeaje(emp?.coste_peaje_km != null ? String(emp.coste_peaje_km) : "");
          setDietaNoche(emp?.dieta_noche_eur != null ? String(emp.dieta_noche_eur) : "");
          setCosteConductor(emp?.coste_conductor_km != null ? String(emp.coste_conductor_km) : "");
          try {
            setIndiceGasoil(await getIndiceGasoilNacional());
          } catch {
            // 18.B.3: la sugerencia es un extra, nunca debe romper la carga de Ajustes
          }
          setInvitaciones(await getInvitaciones());
          setGestores(await getGestoresEmpresa());
          setChoferesEquipo(await getChoferesConGestor());
          setViajesPool(await getViajesConGestor());
          setSolicitudesAprobacion(await getSolicitudesAprobacion());
          setMisVacaciones(await getMisVacaciones());
          setVacacionesPendientes(await getVacacionesPendientes());
        }
      }
    }
    init();
  }, []);

  async function refrescarGestores() {
    setGestores(await getGestoresEmpresa());
  }

  async function onSolicitarVacaciones() {
    setSolicitandoVacaciones(true);
    try {
      await solicitarVacaciones(fechaInicioVacaciones, fechaFinVacaciones);
      setFechaInicioVacaciones("");
      setFechaFinVacaciones("");
      setMisVacaciones(await getMisVacaciones());
      setVacacionesPendientes(await getVacacionesPendientes());
    } catch (err) {
      flash("Error: " + err.message);
    }
    setSolicitandoVacaciones(false);
  }

  async function onResolverVacacion(vacacion, aprobar) {
    setVacacionAccionandoId(vacacion.id);
    try {
      await resolverVacacion(vacacion.id, aprobar);
      setVacacionesPendientes(await getVacacionesPendientes());
      // Fase 25.5: al aprobar, sugerir (nunca aplicar sola) una redistribución de
      // los chóferes de quien se va -- mismo flujo manual de F15.3, pre-rellenado.
      if (aprobar) {
        const items = await sugerirRedistribucionVacacion(vacacion.gestor_id);
        setSugerenciaRedistribucion(items.length ? { gestorNombre: vacacion.gestor?.nombre, items } : null);
      }
    } catch (err) {
      flash("Error: " + err.message);
    }
    setVacacionAccionandoId(null);
  }

  async function onAplicarSugerenciaRedistribucion(choferId, gestorId) {
    setAplicandoSugerenciaId(choferId);
    try {
      await cambiarGestorChofer(choferId, gestorId);
      setSugerenciaRedistribucion((prev) => {
        if (!prev) return prev;
        const items = prev.items.filter((it) => it.choferId !== choferId);
        return items.length ? { ...prev, items } : null;
      });
    } catch (err) {
      flash("Error: " + err.message);
    }
    setAplicandoSugerenciaId(null);
  }

  async function cambiarGestorChofer(choferId, gestorId) {
    setChoferAccionandoId(choferId);
    try {
      await guardarGestorChofer(choferId, gestorId);
      setChoferesEquipo(await getChoferesConGestor());
    } catch (err) {
      flash("Error: " + err.message);
    }
    setChoferAccionandoId(null);
  }

  async function cambiarGestorViaje(viajeId, gestorId) {
    setViajeAccionandoId(viajeId);
    try {
      // Fase 23, 23.E.4: es el traspaso planificador -> gestor real
      // ("decide qué gestor lleva cada viaje", DISCOVERY.md insight 18) --
      // hoy se pierde de viva voz ("a veces se sientan en mi misma
      // oficina"), y cuando se pierde, duele: "me cambió el horario el de
      // arriba y no me acuerdo". Se audita con quién estaba antes y con
      // quién queda, visible luego en el detalle del viaje.
      const anterior = viajesPool.find((v) => v.id === viajeId)?.gestor_id || null;
      await guardarGestorViaje(viajeId, gestorId);
      registrarAuditoria({
        entidad: "viaje", entidadId: viajeId, accion: "cambio_gestor_asignado",
        detalle: { de: anterior, a: gestorId || null },
      });
      setViajesPool(await getViajesConGestor());
    } catch (err) {
      flash("Error: " + err.message);
    }
    setViajeAccionandoId(null);
  }

  async function resolverSolicitud(solicitudId, aprobar) {
    setSolicitudAccionandoId(solicitudId);
    try {
      await resolverSolicitudAprobacion(solicitudId, aprobar);
      setSolicitudesAprobacion(await getSolicitudesAprobacion());
    } catch (err) {
      flash("Error: " + err.message);
    }
    setSolicitudAccionandoId(null);
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

  // Fase 23, 23.F.2: multi-rol (migración 0075) -- escribe `roles` directamente,
  // sin pasar por el `rol` singular.
  async function cambiarRolesGestor(gestorId, nuevosRoles) {
    setGestorAccionandoId(gestorId);
    try {
      await actualizarRolesGestor(gestorId, nuevosRoles);
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
    try {
      await guardarNombreEmpresa(empresa.id, empresaNombre);
      flash("Guardado");
    } catch (err) {
      flash("Error: " + err.message);
    }
    setGuardando(false);
  }

  // 18.C.3: sustituye a guardarBase (una única lat/lon) por gestión de varias
  // bases -- crearBase/eliminarBase en base_empresa (migración 0061).
  async function crearBase(nombre, lat, lon) {
    try {
      await crearBaseEmpresa({ nombre, lat, lon });
      setBases(await getBasesEmpresa());
      flash("Base añadida");
    } catch (err) {
      flash("Error: " + err.message);
    }
  }

  async function eliminarBase(baseId) {
    setBaseAccionando(baseId);
    try {
      await eliminarBaseEmpresa(baseId);
      setBases(await getBasesEmpresa());
    } catch (err) {
      flash("Error: " + err.message);
    }
    setBaseAccionando(null);
  }

  async function guardarCoste() {
    if (!empresa) return;
    setGuardando(true);
    try {
      await guardarCosteKmEmpresa(empresa.id, costeKm);
      flash("Coste por km guardado");
    } catch (err) {
      flash("Error: " + err.message);
    }
    setGuardando(false);
  }

  async function guardarObjetivoPuntualidad() {
    if (!empresa) return;
    setGuardando(true);
    try {
      await guardarObjetivoPuntualidadEmpresa(empresa.id, objetivoPuntualidad);
      flash("Objetivo de puntualidad guardado");
    } catch (err) {
      flash("Error: " + err.message);
    }
    setGuardando(false);
  }

  async function guardarMargen() {
    if (!empresa) return;
    setGuardando(true);
    try {
      await guardarMargenObjetivoEmpresa(empresa.id, margenObjetivo);
      flash("Margen objetivo guardado");
    } catch (err) {
      flash("Error: " + err.message);
    }
    setGuardando(false);
  }

  async function guardarValorAseguradoMaximo() {
    if (!empresa) return;
    setGuardando(true);
    try {
      await guardarValorAseguradoMaximoEmpresa(empresa.id, valorAseguradoMaximo);
      flash("Valor asegurado guardado");
    } catch (err) {
      flash("Error: " + err.message);
    }
    setGuardando(false);
  }

  async function guardarVelocidad() {
    if (!empresa) return;
    setGuardando(true);
    try {
      await guardarVelocidadEmpresa(empresa.id, velocidadPlanificacion);
      flash("Velocidad de planificación guardada");
    } catch (err) {
      flash("Error: " + err.message);
    }
    setGuardando(false);
  }

  async function guardarUmbralVueltaCasa() {
    if (!empresa) return;
    setGuardando(true);
    try {
      await guardarUmbralVueltaCasaEmpresa(empresa.id, umbralVueltaCasa);
      flash("Umbral de vuelta a casa guardado");
    } catch (err) {
      flash("Error: " + err.message);
    }
    setGuardando(false);
  }

  async function guardarDesglose() {
    if (!empresa) return;
    setGuardando(true);
    try {
      await guardarDesgloseCosteEmpresa(empresa.id, {
        precio_gasoil_litro: precioGasoil, coste_peaje_km: costePeaje,
        dieta_noche_eur: dietaNoche, coste_conductor_km: costeConductor,
      });
      flash("Coste desglosado guardado");
    } catch (err) {
      flash("Error: " + err.message);
    }
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

  // --- Verificación en dos pasos / MFA (ítem 9.10) ---
  async function iniciarEnrolamientoMfa() {
    setMfaError(null);
    setMfaOcupado(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Norenty" });
    setMfaOcupado(false);
    if (error) {
      setMfaError(error.message);
      return;
    }
    setMfaQr(data.totp.qr_code);
    setMfaSecret(data.totp.secret);
    setMfaFactorId(data.id);
    setMfaEnrolando(true);
  }

  async function confirmarEnrolamientoMfa() {
    setMfaError(null);
    setMfaOcupado(true);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
    if (challengeError) {
      setMfaError(challengeError.message);
      setMfaOcupado(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId, challengeId: challenge.id, code: mfaCodigo,
    });
    setMfaOcupado(false);
    if (verifyError) {
      setMfaError(verifyError.message);
      return;
    }
    flash("Verificación en dos pasos activada");
    setMfaEnrolando(false);
    setMfaQr(null);
    setMfaSecret(null);
    setMfaFactorId(null);
    setMfaCodigo("");
    await cargarFactoresMfa();
  }

  async function cancelarEnrolamientoMfa() {
    if (mfaFactorId) {
      await supabase.auth.mfa.unenroll({ factorId: mfaFactorId }); // limpia el factor sin verificar a medias
    }
    setMfaEnrolando(false);
    setMfaQr(null);
    setMfaSecret(null);
    setMfaFactorId(null);
    setMfaCodigo("");
    setMfaError(null);
  }

  async function desactivarMfa(factorId) {
    if (!window.confirm("¿Desactivar la verificación en dos pasos? Volverás a entrar solo con tu contraseña.")) return;
    setMfaOcupado(true);
    await supabase.auth.mfa.unenroll({ factorId });
    setMfaOcupado(false);
    await cargarFactoresMfa();
  }

  async function onCerrarTodasLasSesiones() {
    if (!window.confirm("Se cerrará tu sesión en TODOS los dispositivos, incluido este. Tendrás que volver a iniciar sesión. ¿Continuar?")) return;
    setCerrandoSesiones(true);
    try {
      await signOutTodasLasSesiones();
    } catch (err) {
      flash("Error: " + err.message.replace(/[<>]/g, ""));
      setCerrandoSesiones(false);
    }
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

  async function onGuardarTelefonoGestor() {
    if (!gestor) return;
    setGuardandoTelefonoGestor(true);
    setMensaje(null);
    try {
      const normalizado = await guardarTelefonoGestor(gestor.id, telefonoGestor);
      setTelefonoGestor(normalizado || "");
      setMensaje("Teléfono guardado.");
    } catch (err) {
      setMensaje("Error: " + err.message);
    } finally {
      setGuardandoTelefonoGestor(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-medium text-ink mb-6">Ajustes</h1>

      {mensaje && (
        <div className={`mb-4 text-xs px-3 py-2 rounded-md ${mensaje.startsWith("Error") ? "bg-red-50 text-estado-incidencia" : "bg-green-50 text-estado-ok"}`}>
          {mensaje}
        </div>
      )}

      <AjustesPerfilSection
        user={user}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        guardando={guardando}
        cambiarPassword={cambiarPassword}
        gestor={gestor}
        prefs={prefs}
        togglePref={togglePref}
        cerrandoSesiones={cerrandoSesiones}
        onCerrarTodasLasSesiones={onCerrarTodasLasSesiones}
        onSignOut={() => signOut()}
        telefonoGestor={telefonoGestor}
        setTelefonoGestor={setTelefonoGestor}
        guardandoTelefonoGestor={guardandoTelefonoGestor}
        onGuardarTelefonoGestor={onGuardarTelefonoGestor}
        misVacaciones={misVacaciones}
        fechaInicioVacaciones={fechaInicioVacaciones}
        setFechaInicioVacaciones={setFechaInicioVacaciones}
        fechaFinVacaciones={fechaFinVacaciones}
        setFechaFinVacaciones={setFechaFinVacaciones}
        solicitandoVacaciones={solicitandoVacaciones}
        onSolicitarVacaciones={onSolicitarVacaciones}
      />

      <AjustesMfaSection
        mfaError={mfaError}
        mfaEnrolando={mfaEnrolando}
        mfaQr={mfaQr}
        mfaSecret={mfaSecret}
        mfaCodigo={mfaCodigo}
        setMfaCodigo={setMfaCodigo}
        mfaOcupado={mfaOcupado}
        mfaFactores={mfaFactores}
        iniciarEnrolamientoMfa={iniciarEnrolamientoMfa}
        confirmarEnrolamientoMfa={confirmarEnrolamientoMfa}
        cancelarEnrolamientoMfa={cancelarEnrolamientoMfa}
        desactivarMfa={desactivarMfa}
      />

      <AjustesBotSection
        gestor={gestor}
        bot={BOT}
        copiado={copiado}
        copiarEnlaceTelegram={copiarEnlaceTelegram}
        heartbeat={heartbeat}
      />

      <RequireRol roles={["admin"]}>
        <AjustesEquipoSection
          invitaciones={invitaciones}
          invitarEmail={invitarEmail}
          setInvitarEmail={setInvitarEmail}
          invitando={invitando}
          enviarInvitacion={enviarInvitacion}
          revocarInvitacion={revocarInvitacion}
          copiarEnlaceInvitacion={copiarEnlaceInvitacion}
          codigoCopiadoId={codigoCopiadoId}
          invitacionValidezDias={INVITACION_VALIDEZ_DIAS}
          gestores={gestores}
          user={user}
          gestorAccionandoId={gestorAccionandoId}
          cambiarRolGestor={cambiarRolGestor}
          cambiarRolesGestor={cambiarRolesGestor}
          onDesactivarGestor={onDesactivarGestor}
          onReactivarGestor={onReactivarGestor}
          choferes={choferesEquipo}
          cambiarGestorChofer={cambiarGestorChofer}
          choferAccionandoId={choferAccionandoId}
          viajesPool={viajesPool}
          cambiarGestorViaje={cambiarGestorViaje}
          viajeAccionandoId={viajeAccionandoId}
          solicitudesAprobacion={solicitudesAprobacion}
          resolverSolicitud={resolverSolicitud}
          solicitudAccionandoId={solicitudAccionandoId}
          vacacionesPendientes={vacacionesPendientes}
          onResolverVacacion={onResolverVacacion}
          vacacionAccionandoId={vacacionAccionandoId}
          sugerenciaRedistribucion={sugerenciaRedistribucion}
          onAplicarSugerenciaRedistribucion={onAplicarSugerenciaRedistribucion}
          onDescartarSugerenciaRedistribucion={() => setSugerenciaRedistribucion(null)}
          aplicandoSugerenciaId={aplicandoSugerenciaId}
        />
      </RequireRol>

      <CalibracionSugerenciaSection
        onSugerirVelocidad={(v) => setVelocidadPlanificacion(String(v))}
        onSugerirCosteKm={(v) => setCosteKm(String(v))}
        onSugerirGasoil={(v) => setPrecioGasoil(String(v))}
        onSugerirPeaje={(v) => setCostePeaje(String(v))}
        onSugerirDieta={(v) => setDietaNoche(String(v))}
      />

      {/* 18.A.3b (Fase 18, 2026-07-25): parámetros de empresa (coste/km, velocidad,
          objetivos, coste desglosado...) bloqueados a admin -- feedback directo del
          usuario, "no entiendo cómo puede ser que puedas cambiarlo tú, una persona
          normal". Mismo patrón que Facturación (18.E.1): RequireRol, no inputs
          deshabilitados uno a uno. */}
      <RequireRol roles={["admin"]}>
      <AjustesEmpresaSection
        empresa={empresa}
        empresaNombre={empresaNombre}
        setEmpresaNombre={setEmpresaNombre}
        guardarEmpresa={guardarEmpresa}
        bases={bases}
        crearBase={crearBase}
        eliminarBase={eliminarBase}
        baseAccionando={baseAccionando}
        costeKm={costeKm}
        setCosteKm={setCosteKm}
        guardarCoste={guardarCoste}
        objetivoPuntualidad={objetivoPuntualidad}
        setObjetivoPuntualidad={setObjetivoPuntualidad}
        guardarObjetivoPuntualidad={guardarObjetivoPuntualidad}
        margenObjetivo={margenObjetivo}
        setMargenObjetivo={setMargenObjetivo}
        guardarMargen={guardarMargen}
        valorAseguradoMaximo={valorAseguradoMaximo}
        setValorAseguradoMaximo={setValorAseguradoMaximo}
        guardarValorAseguradoMaximo={guardarValorAseguradoMaximo}
        velocidadPlanificacion={velocidadPlanificacion}
        setVelocidadPlanificacion={setVelocidadPlanificacion}
        guardarVelocidad={guardarVelocidad}
        velocidadPlanificacionDefault={VELOCIDAD_PLANIFICACION_KMH}
        umbralVueltaCasa={umbralVueltaCasa}
        setUmbralVueltaCasa={setUmbralVueltaCasa}
        guardarUmbralVueltaCasa={guardarUmbralVueltaCasa}
        umbralVueltaCasaDefault={UMBRAL_VUELTA_CASA_KM_DEFAULT}
        precioGasoil={precioGasoil}
        setPrecioGasoil={setPrecioGasoil}
        costePeaje={costePeaje}
        setCostePeaje={setCostePeaje}
        dietaNoche={dietaNoche}
        setDietaNoche={setDietaNoche}
        costeConductor={costeConductor}
        setCosteConductor={setCosteConductor}
        guardarDesglose={guardarDesglose}
        indiceGasoil={indiceGasoil}
        guardando={guardando}
      />
      </RequireRol>
    </div>
  );
}
