"use client";

import { useState } from "react";
import { Route } from "lucide-react";
import { supabase } from "../../lib/supabase";

/**
 * Pantalla intermedia entre login y dashboard cuando el gestor tiene
 * verificación en dos pasos activada (ítem 9.10) y la sesión actual todavía
 * está en aal1 (solo contraseña). AuthGuard la muestra en vez de `children`
 * hasta que se supere el reto — la sesión ya existe, pero no da acceso a
 * datos hasta verificar el segundo factor.
 */
export default function MfaChallenge({ onVerificado }) {
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function verificar(e) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const { data: factores, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const factor = (factores?.totp || [])[0];
      if (!factor) throw new Error("No se encontró tu factor de verificación en dos pasos.");

      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: codigo,
      });
      if (verifyError) throw verifyError;
      onVerificado();
    } catch (err) {
      setError(err.message);
    }
    setCargando(false);
  }

  return (
    <div className="h-screen flex items-center justify-center bg-surface-alt">
      <div className="w-full max-w-sm px-4">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center text-white">
            <Route size={22} />
          </div>
          <span className="text-2xl font-semibold text-ink">Norenty</span>
        </div>

        <form
          onSubmit={verificar}
          className="bg-surface border border-border rounded-xl p-6 flex flex-col gap-4"
        >
          <h2 className="text-lg font-medium text-ink text-center">Verificación en dos pasos</h2>
          <p className="text-xs text-ink-secondary text-center">
            Introduce el código de 6 dígitos de tu app de autenticación.
          </p>

          {error && (
            <div className="text-xs text-estado-incidencia bg-red-50 rounded-md p-2">{error}</div>
          )}

          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
            autoFocus
            className="w-full text-center text-lg tracking-widest border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
          />

          <button
            type="submit"
            disabled={cargando || codigo.length !== 6}
            className="w-full text-sm py-2.5 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            {cargando ? "Verificando…" : "Verificar"}
          </button>
        </form>
      </div>
    </div>
  );
}
