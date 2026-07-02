"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Route } from "lucide-react";
import { signIn, signUp, resetPassword } from "../../lib/auth";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const invitacionCodigo = searchParams.get("invitacion");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [modo, setModo] = useState("login");
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [loading, setLoading] = useState(false);

  // Un enlace de invitación (?invitacion=codigo) va directo al formulario de
  // registro: el que lo recibe casi siempre no tiene cuenta todavía.
  useEffect(() => {
    if (invitacionCodigo) setModo("registro");
  }, [invitacionCodigo]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    setLoading(true);
    try {
      if (modo === "login") {
        await signIn(email, password);
      } else if (modo === "registro") {
        await signUp(email, password, empresaNombre, invitacionCodigo);
        setMensaje(
          invitacionCodigo
            ? "Cuenta creada y unida a tu equipo. Revisa tu email para confirmarla."
            : "Cuenta y empresa creadas. Revisa tu email para confirmarla."
        );
      } else if (modo === "reset") {
        await resetPassword(email);
        setMensaje("Email de recuperación enviado. Revisa tu bandeja.");
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
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
          onSubmit={handleSubmit}
          className="bg-surface border border-border rounded-xl p-6 flex flex-col gap-4"
        >
          <h2 className="text-lg font-medium text-ink text-center">
            {modo === "login" ? "Iniciar sesión" : modo === "registro" ? "Crear cuenta" : "Recuperar contraseña"}
          </h2>

          {error && (
            <div className="text-xs text-estado-incidencia bg-red-50 rounded-md p-2">
              {error}
            </div>
          )}

          {mensaje && (
            <div className="text-xs text-estado-ok bg-green-50 rounded-md p-2">
              {mensaje}
            </div>
          )}

          <div>
            <label className="block text-xs text-ink-secondary mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
            />
          </div>

          {modo === "registro" && invitacionCodigo && (
            <div className="text-xs text-ink-secondary bg-surface-alt rounded-md p-2">
              Te han invitado a unirte a un equipo existente en Norenty.
            </div>
          )}

          {modo === "registro" && !invitacionCodigo && (
            <div>
              <label className="block text-xs text-ink-secondary mb-1">Nombre de tu empresa</label>
              <input
                type="text"
                value={empresaNombre}
                onChange={(e) => setEmpresaNombre(e.target.value)}
                required
                maxLength={200}
                placeholder="Transportes Ejemplo S.L."
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
              />
            </div>
          )}

          {modo !== "reset" && (
            <div>
              <label className="block text-xs text-ink-secondary mb-1">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                maxLength={128}
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-sm py-2.5 rounded-md bg-brand text-white font-medium disabled:opacity-40"
          >
            {loading
              ? "Cargando…"
              : modo === "login"
              ? "Entrar"
              : modo === "registro"
              ? "Crear cuenta"
              : "Enviar email de recuperación"}
          </button>

          <div className="flex flex-col gap-1 text-xs text-center text-ink-secondary">
            {modo === "login" && (
              <>
                <p>
                  ¿No tienes cuenta?{" "}
                  <button type="button" onClick={() => { setModo("registro"); setError(null); setMensaje(null); }} className="text-brand underline">
                    Regístrate
                  </button>
                </p>
                <p>
                  <button type="button" onClick={() => { setModo("reset"); setError(null); setMensaje(null); }} className="text-brand underline">
                    ¿Olvidaste tu contraseña?
                  </button>
                </p>
              </>
            )}
            {modo === "registro" && (
              <p>
                ¿Ya tienes cuenta?{" "}
                <button type="button" onClick={() => { setModo("login"); setError(null); setMensaje(null); }} className="text-brand underline">
                  Inicia sesión
                </button>
              </p>
            )}
            {modo === "reset" && (
              <p>
                <button type="button" onClick={() => { setModo("login"); setError(null); setMensaje(null); }} className="text-brand underline">
                  Volver al login
                </button>
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
