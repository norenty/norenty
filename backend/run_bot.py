"""Arranca el bot de Telegram.

Modo por defecto: polling (desarrollo, no requiere endpoint público).
Modo webhook: se activa solo si BOT_WEBHOOK_URL está definida en el entorno.
Requiere además BOT_WEBHOOK_SECRET (token secreto que Telegram reenvía en cada
petición, para verificar que el request viene de Telegram y no de un tercero
que adivine la URL) y opcionalmente BOT_WEBHOOK_PORT (por defecto 8443) y
BOT_LISTEN (por defecto 0.0.0.0).

El modo webhook requiere un servidor con HTTPS público accesible por Telegram;
hasta que eso exista (ver sección Despliegue en ROADMAP.md, pospuesta), este
modo no se activa salvo que se configure explícitamente BOT_WEBHOOK_URL.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DOTENV_PATH", os.path.join(os.path.dirname(__file__), "..", ".env"))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
# Seguridad (2026-07-08): secretos reales en ~/.norenty-secrets/.env, fuera del
# repo (ver RUNBOOK-SECRETS.md). override=True: gana sobre el .env del repo.
load_dotenv(Path.home() / ".norenty-secrets" / ".env", override=True)

from app.bot import create_bot_app

if __name__ == "__main__":
    webhook_url = os.environ.get("BOT_WEBHOOK_URL")
    bot_app = create_bot_app()

    if webhook_url:
        secret = os.environ.get("BOT_WEBHOOK_SECRET")
        if not secret:
            print("ERROR: BOT_WEBHOOK_URL definida pero falta BOT_WEBHOOK_SECRET.")
            sys.exit(1)

        # Diagnóstico 2026-08-08 (smoke test): Railway asigna el puerto real de
        # forma dinámica vía $PORT y su proxy solo enruta ahí -- si el proceso
        # escuchaba en BOT_WEBHOOK_PORT (por defecto 8443) sin coincidir con
        # $PORT, Railway devuelve "Application failed to respond"/502 a
        # Telegram aunque el proceso esté perfectamente vivo por dentro (el
        # job_queue seguía corriendo y el heartbeat seguía llegando -- eso fue
        # lo que lo delató). $PORT manda siempre que exista; BOT_WEBHOOK_PORT
        # sigue disponible como override explícito para quien no esté en
        # Railway.
        port = int(os.environ.get("PORT") or os.environ.get("BOT_WEBHOOK_PORT", "8443"))
        listen = os.environ.get("BOT_LISTEN", "0.0.0.0")

        print(f"Norenty Bot arrancando en modo webhook ({webhook_url}) ...")
        bot_app.run_webhook(
            listen=listen,
            port=port,
            url_path=secret,
            webhook_url=f"{webhook_url.rstrip('/')}/{secret}",
            secret_token=secret,
            drop_pending_updates=True,
        )
    else:
        print("Norenty Bot arrancando en modo polling...")
        bot_app.run_polling(drop_pending_updates=True)
