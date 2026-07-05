"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getSession, onAuthChange } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import LoginPage from "./LoginPage";
import MfaChallenge from "./MfaChallenge";
import RolProvider from "./RolProvider";

export default function AuthGuard({ children }) {
  const pathname = usePathname();
  const [session, setSession] = useState(undefined);
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

  // Portal de cliente (7A.14): páginas /t/[token] son públicas, sin sesión.
  if (pathname?.startsWith("/t/")) return children;

  if (session === undefined) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
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
