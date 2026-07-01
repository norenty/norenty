"""Norenty API — Milestone 1."""

from fastapi import FastAPI
from .db import supabase

app = FastAPI(title="Norenty API", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/db/health")
def db_health():
    # Solo confirma conectividad; no expone recuento de filas de negocio en un
    # endpoint público (esta consulta usa la service role key, que salta RLS).
    supabase.table("empresa").select("id").limit(1).execute()
    return {"status": "ok", "db_connected": True}
