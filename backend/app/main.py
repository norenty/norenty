"""Norenty API — Milestone 0.

Esqueleto mínimo de FastAPI. Solo un endpoint de salud para comprobar
que el backend arranca. Sin lógica de negocio todavía.
"""

from fastapi import FastAPI

app = FastAPI(title="Norenty API", version="0.0.1")


@app.get("/health")
def health():
    """Comprueba que el backend está vivo."""
    return {"status": "ok"}
