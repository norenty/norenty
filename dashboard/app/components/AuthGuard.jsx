"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getSession, onAuthChange } from "../../lib/auth";
import LoginPage from "./LoginPage";
import RolProvider from "./RolProvider";

export default function AuthGuard({ children }) {
  const pathname = usePathname();
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    getSession().then(setSession);
    const { data: listener } = onAuthChange(setSession);
    return () => listener?.subscription?.unsubscribe();
  }, []);

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

  return <RolProvider>{children}</RolProvider>;
}
