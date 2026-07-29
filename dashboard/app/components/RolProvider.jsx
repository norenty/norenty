"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

// Fase 23, 23.F.2: `roles` (array, puede tener más de un valor -- ver migración 0075)
// es la fuente de verdad nueva; `rol` (singular) se mantiene por compatibilidad con
// cualquier sitio que aún no se haya migrado a leer `roles`. Mientras la BD de
// producción no tenga 0075 aplicada, `roles` puede venir undefined -- de ahí el
// fallback a `[rol]` más abajo, para que ningún gestor pierda acceso durante el
// despliegue escalonado (dev ya migrado, prod pendiente).
const RolContext = createContext({ rol: null, roles: [], activo: null, cargando: true });
export const useRol = () => useContext(RolContext);

export default function RolProvider({ children }) {
  const [estado, setEstado] = useState({ rol: null, roles: [], activo: null, cargando: true });

  useEffect(() => {
    let vivo = true;
    async function cargar() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { if (vivo) setEstado({ rol: null, roles: [], activo: null, cargando: false }); return; }
      const { data } = await supabase
        .from("gestor")
        .select("rol, roles, activo")
        .eq("auth_user_id", session.user.id)
        .single();
      const roles = data?.roles?.length ? data.roles : (data?.rol ? [data.rol] : []);
      if (vivo) setEstado({ rol: data?.rol ?? null, roles, activo: data?.activo ?? null, cargando: false });
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
