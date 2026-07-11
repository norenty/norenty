import os
from pathlib import Path
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
# Seguridad (2026-07-08): los secretos REALES viven fuera del repo, en
# ~/.norenty-secrets/.env -- nunca en un archivo que las herramientas de un
# agente de código puedan leer por accidente. override=True: si existe, gana
# sobre lo que hubiera en el .env del repo (que debe quedar vacío/sin secretos).
load_dotenv(Path.home() / ".norenty-secrets" / ".env", override=True)

_url = os.environ["SUPABASE_URL"]
_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_ANON_KEY"]

supabase: Client = create_client(_url, _key)
