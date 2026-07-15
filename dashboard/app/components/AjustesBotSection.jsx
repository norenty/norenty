"use client";

import { Send, Copy, Check, Activity } from "lucide-react";

/** Secciones "Alertas por Telegram" y "Estado del bot" de Ajustes (ítem
 * 9.40) — ambas sobre el estado de la integración con el bot, por eso
 * conviven en un mismo componente. Presentacional: el estado (heartbeat,
 * gestor) y los handlers viven en `ajustes/page.jsx`. */
export default function AjustesBotSection({ gestor, bot, copiado, copiarEnlaceTelegram, heartbeat }) {
  return (
    <>
      <section id="ajustes-telegram" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
        <div className="flex items-center gap-2 mb-4">
          <Send size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Alertas por Telegram</h2>
        </div>
        {!gestor ? (
          <p className="text-xs text-ink-muted">Cargando…</p>
        ) : gestor.telegram_chat_id ? (
          <p className="text-xs text-estado-ok">● Vinculado — recibirás aquí las alertas de incidencias y entregas.</p>
        ) : bot ? (
          <div className="flex items-center gap-3">
            <p className="flex-1 text-xs text-ink-secondary">
              Sin vincular. Copia el enlace y ábrelo en Telegram para recibir alertas de incidencias y entregas en tiempo real.
            </p>
            <button
              onClick={copiarEnlaceTelegram}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-ink-secondary hover:bg-surface-alt shrink-0"
            >
              {copiado ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar enlace</>}
            </button>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">Bot no configurado (falta NEXT_PUBLIC_BOT_USERNAME).</p>
        )}
      </section>

      <section id="ajustes-estado-bot" className="bg-surface border border-border rounded-xl p-5 mb-4 scroll-mt-20">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={18} className="text-brand" />
          <h2 className="text-sm font-medium text-ink">Estado del bot</h2>
        </div>
        <p className="text-xs text-ink-secondary mb-3">
          Latido cada 2 min mientras el proceso del bot está vivo (ítem 8.3). Si lleva más de 5
          min sin señal, algo se ha caído y ningún chófer puede reportar hasta que se reinicie.
        </p>
        {!heartbeat ? (
          <p className="text-xs text-ink-muted">Cargando…</p>
        ) : heartbeat.activo ? (
          <p className="text-xs text-estado-ok">● Activo — último latido hace {heartbeat.segundosDesdeUltimo}s</p>
        ) : heartbeat.ultimoLatido ? (
          <p className="text-xs text-estado-incidencia">
            ● SIN SEÑAL — último latido hace {Math.round(heartbeat.segundosDesdeUltimo / 60)} min
          </p>
        ) : (
          <p className="text-xs text-estado-incidencia">● SIN SEÑAL — nunca se ha registrado un latido</p>
        )}
      </section>
    </>
  );
}
