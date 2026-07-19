"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getSession, onAuthChange } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import LandingPage from "./LandingPage";
import LoginPage from "./LoginPage";
import MfaChallenge from "./MfaChallenge";
import RolProvider from "./RolProvider";

export default function AuthGuard({ children }) {
  const pathname = usePathname();
  const [session, setSession] = useState(undefined);
  // Un enlace de invitación (?invitacion=codigo, ítem 6.9) va directo al
  // formulario de registro -- quien lo recibe ya sabe qué es Norenty, no
  // hace falta enseñarle la landing de venta primero. Leído de
  // window.location (no useSearchParams) para no forzar bailout de
  // renderizado estático en el resto de páginas que cuelgan de este guard.
  const [tieneInvitacion, setTieneInvitacion] = useState(false);
  useEffect(() => {
    setTieneInvitacion(new URLSearchParams(window.location.search).has("invitacion"));
  }, []);
  // Landing pública (2026-07-19): todo en un solo dominio norenty.com, sin
  // subdominio de app aparte -- un visitante sin sesión ve primero el
  // argumento de venta (evidencia hash-chain), no el formulario de login
  // directamente. Toggle de estado local, no una ruta nueva: "Acceder" pasa
  // a mostrar el mismo LoginPage de siempre en el mismo dominio/URL.
  const [mostrarLogin, setMostrarLogin] = useState(false);
  // ítem 9.10: si el gestor tiene verificación en dos pasos activada, una
  // sesión recién iniciada solo con contraseña queda en aal1 — no da acceso
  // a `children` hasta superar el reto (aal2). undefined = todavía sin
  // comprobar; null = no aplica (sin MFA o ya en aal2).
  const [aal, setAal] = useState(undefined);

  useEffect(() => {
    getSession().then(setSession);
    const { data: listener } = onAuthChange(setSession);
    return () => listener?.subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setAal(undefined);
      return;
    }
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => setAal(data));
  }, [session]);

  // Portal de cliente (7A.14) y página de subprocesadores (9.14): públicas, sin sesión.
  if (pathname?.startsWith("/t/") || pathname === "/subprocesadores") return children;

  if (session === undefined) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return mostrarLogin || tieneInvitacion
      ? <LoginPage />
      : <LandingPage onAcceder={() => setMostrarLogin(true)} />;
  }

  if (aal === undefined) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    return (
      <MfaChallenge
        onVerificado={() =>
          supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => setAal(data))
        }
      />
    );
  }

  return <RolProvider>{children}</RolProvider>;
}
