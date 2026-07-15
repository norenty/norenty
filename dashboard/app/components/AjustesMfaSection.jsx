"use client";

import { KeyRound } from "lucide-react";

/** Sección "Verificación en dos pasos" (MFA, ítem 9.10) de Ajustes, extraída
 * en el ítem 9.40. Puramente presentacional — todo el estado y los handlers
 * de `supabase.auth.mfa.*` viven en `ajustes/page.jsx`. */
export default function AjustesMfaSection({
  mfaError,
  mfaEnrolando,
  mfaQr,
  mfaSecret,
  mfaCodigo,
  setMfaCodigo,
  mfaOcupado,
  mfaFactores,
  iniciarEnrolamientoMfa,
  confirmarEnrolamientoMfa,
  cancelarEnrolamientoMfa,
  desactivarMfa,
}) {
  return (
    <section id="ajustes-mfa" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
      <div className="flex items-center gap-2 mb-4">
        <KeyRound size={18} className="text-brand" />
        <h2 className="text-sm font-medium text-ink">Verificación en dos pasos</h2>
      </div>
      <p className="text-xs text-ink-secondary mb-4">
        Opcional. Además de tu contraseña, pide un código de 6 dígitos de una app de
        autenticación (Google Authenticator, Authy...) al iniciar sesión.
      </p>

      {mfaError && (
        <div className="mb-3 text-xs text-estado-incidencia bg-red-50 rounded-md p-2">{mfaError}</div>
      )}

      {mfaEnrolando ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-ink-secondary">
            Escanea este código QR con tu app de autenticación, o introduce el código manual.
          </p>
          {mfaQr && (
            <img
              src={`data:image/svg+xml;utf-8,${encodeURIComponent(mfaQr)}`}
              alt="Código QR de verificación en dos pasos"
              className="w-40 h-40 border border-border rounded-md"
            />
          )}
          {mfaSecret && (
            <div className="text-xs text-ink-muted font-mono bg-surface-alt rounded-md px-2 py-1.5 break-all">
              {mfaSecret}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs text-ink-secondary mb-1">Código de 6 dígitos</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={mfaCodigo}
                onChange={(e) => setMfaCodigo(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="w-full text-sm border border-border rounded-md px-3 py-2 focus:outline-none focus:border-brand"
              />
            </div>
            <button
              onClick={confirmarEnrolamientoMfa}
              disabled={mfaOcupado || mfaCodigo.length !== 6}
              className="text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
            >
              Confirmar
            </button>
            <button
              onClick={cancelarEnrolamientoMfa}
              disabled={mfaOcupado}
              className="text-sm px-3 py-2 rounded-md border border-border text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : mfaFactores.length > 0 ? (
        <div className="flex flex-col gap-2">
          {mfaFactores.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-surface-alt">
              <span className="flex-1 text-ink">{f.friendly_name || "Verificación en dos pasos"}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-estado-ok">Activa</span>
              <button
                onClick={() => desactivarMfa(f.id)}
                disabled={mfaOcupado}
                className="text-xs px-2 py-1 rounded-md border border-border text-estado-incidencia hover:bg-red-50 disabled:opacity-40"
              >
                Desactivar
              </button>
            </div>
          ))}
        </div>
      ) : (
        <button
          onClick={iniciarEnrolamientoMfa}
          disabled={mfaOcupado}
          className="text-sm px-3 py-2 rounded-md bg-brand text-white font-medium disabled:opacity-40"
        >
          Activar verificación en dos pasos
        </button>
      )}
    </section>
  );
}
