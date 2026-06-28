import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

_url = os.environ["SUPABASE_URL"]
_key = os.environ["SUPABASE_ANON_KEY"]

supabase: Client = create_client(_url, _key)
