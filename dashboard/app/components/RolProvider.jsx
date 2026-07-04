"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const RolContext = createContext({ rol: null, activo: null, cargando: true });
export const useRol = () => useContext(RolContext);

export default function RolProvider({ children }) {
  const [estado, setEstado] = useState({ rol: null, activo: null, cargando: true });

  useEffect(() => {
    let vivo = true;
    async function cargar() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { if (vivo) setEstado({ rol: null, activo: null, cargando: false }); return; }
      const { data } = await supabase
        .from("gestor")
        .select("rol, activo")
        .eq("auth_user_id", session.user.id)
        .single();
      if (vivo) setEstado({ rol: data?.rol ?? null, activo: data?.activo ?? null, cargando: false });
    }
    cargar();
    const { data: sub } = supabase.auth.onAuthStateChange(() => cargar());
    return () => { vivo = false; sub?.subscription?.unsubscribe(); };
  }, []);

  if (!estado.cargando && estado.activo === false) {
    return (
      <div className="h-screen flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold mb-2">Tu acceso a esta empresa ha sido revocado.</p>
          <p className="text-sm text-gray-500">Contacta con un administrador.</p>
        </div>
      </div>
    );
  }

  return <RolContext.Provider value={estado}>{children}</RolContext.Provider>;
}
