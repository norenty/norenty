"""Arranca el bot de Telegram en modo polling (desarrollo)."""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DOTENV_PATH", os.path.join(os.path.dirname(__file__), "..", ".env"))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from app.bot import create_bot_app

if __name__ == "__main__":
    print("Norenty Bot arrancando en modo polling...")
    bot_app = create_bot_app()
    bot_app.run_polling(drop_pending_updates=True)
