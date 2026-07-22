"""Aísla la suite de tests del fichero de secretos personal del desarrollador.

Hallazgo real (2026-07-22): `bot.py` carga `~/.norenty-secrets/.env` con
`override=True` al importarse — si esa variable está vacía en el fichero real
de quien corre los tests (p. ej. porque acaba de reorganizar dev/prod), los
tests del bot fallan con `InvalidToken`, sin que el código tenga ningún fallo
real. Los tests no deberían depender del contenido del fichero personal de
nadie. Este conftest se ejecuta ANTES de que pytest importe cualquier módulo
de test (y por tanto antes de que `app.bot` se importe y dispare su propio
`load_dotenv`):

1. Fija valores dummy con formato válido para las variables que `bot.py`
   exige al importarse (`os.environ["TELEGRAM_BOT_TOKEN"]`) — `setdefault`,
   así que si el entorno de CI ya trae algo real, no se pisa.
2. Redirige `Path.home()` a un directorio temporal vacío, para que el
   `load_dotenv(..., override=True)` de `bot.py` no encuentre
   `~/.norenty-secrets/.env` y por tanto no pueda sobreescribir nada con un
   valor vacío del fichero real.

Efecto colateral deseado: los tests que dependen de `DATABASE_URL` real
(`test_storage_policies.py`, `test_audit_log_seguridad.py`) ya se saltaban
solos si no estaba definida (`pytest.mark.skipif`) — con esto se saltan de
forma consistente en cualquier máquina, en vez de depender de si el fichero
personal de quien ejecuta los tests la trae rellena o no.
"""
import os
import tempfile
from pathlib import Path

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "123456789:TEST-dummy-token-formato-valido-no-real")
os.environ.setdefault("SUPABASE_URL", "https://test-hermetico.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key-hermetico")

_fake_home = tempfile.mkdtemp(prefix="norenty-tests-home-")
os.environ["USERPROFILE"] = _fake_home  # Path.home() en Windows
os.environ["HOME"] = _fake_home  # Path.home() en POSIX, por si el CI corre en Linux/Mac
