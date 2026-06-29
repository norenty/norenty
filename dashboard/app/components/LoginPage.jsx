"use client";

import { useState } from "react";
import { Route } from "lucide-react";
import { signIn, signUp } from "../../lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [modo, setModo] = useState("login");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (modo === "login") {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="h-screen flex items-center justify-center bg-surface-alt">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center text-white">
            <Route size={22} />
          </div>
          <span className="text-2xl font-semibold text-ink">Norenty</span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-xl p-6 flex flex-col gap-4"
        >
          <h2 className="text-lg font-medium text-ink text-center">
            {modo === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </h2>

          {error && (
            <div className="text-xs text-estado-incidencia bg-red-50 rounded-md p-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs text-ink-secondary mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>

          <div>
            <label className="block text-xs text-ink-secondary mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full text-sm py-2.5 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            {loading
              ? "Cargando…"
              : modo === "login"
              ? "Entrar"
              : "Crear cuenta"}
          </button>

          <p className="text-xs text-center text-ink-secondary">
            {modo === "login" ? (
              <>
                ¿No tienes cuenta?{" "}
                <button
                  type="button"
                  onClick={() => setModo("registro")}
                  className="text-brand underline"
                >
                  Regístrate
                </button>
              </>
            ) : (
              <>
                ¿Ya tienes cuenta?{" "}
                <button
                  type="button"
                  onClick={() => setModo("login")}
                  className="text-brand underline"
                >
                  Inicia sesión
                </button>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
