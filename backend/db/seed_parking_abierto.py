"""Siembra la tabla `parking` con el dataset ABIERTO de ubicaciones de parking/
descanso/repostaje para camión (Fraunhofer ISI vía Zenodo, CC-BY 4.0):

  Link, S. & Plötz, P. (2024). Geospatial truck parking locations data for
  Europe. Data in Brief, 54, 110277. https://doi.org/10.1016/j.dib.2024.110277
  Dataset: https://zenodo.org/records/10231359 (CSV, sin login, licencia abierta)

IMPORTANTE (honesto): esto NO es el registro oficial "SSTPA" de parkings
certificados seguros de la UE (ese requiere una cuenta ECAS + acceso DATEX II,
sigue pendiente — ver ítem 5.4 en ROADMAP.md). Es una capa más amplia de
"dónde hay parking/descanso/repostaje conocido para camión", construida sobre
OpenStreetMap y validada por los autores — el caso de uso real que describió
el gestor de tráfico consultado (ver DISCOVERY.md).

v1: solo se siembra España (--pais ES por defecto); ampliar con --pais FR o
--pais TODOS cuando haga falta.

Usa SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY del .env (igual que el bot; el
service role salta RLS, necesario porque las filas globales llevan empresa_id
NULL que ningún gestor podría insertar). Idempotente: borra el dataset abierto
del país indicado antes de reinsertar.

Uso:
    python backend/db/seed_parking_abierto.py
    python backend/db/seed_parking_abierto.py --pais TODOS
"""
import argparse
import csv
import io
import os
import sys
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

# override=True: en esta máquina existe una SUPABASE_SERVICE_ROLE_KEY vacía a
# nivel de sistema que eclipsaría la del .env (load_dotenv no pisa por defecto).
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env", override=True)
# Seguridad (2026-07-08): secretos reales en ~/.norenty-secrets/.env, fuera del
# repo (ver RUNBOOK-SECRETS.md). Se carga el ultimo para que gane sobre lo anterior.
load_dotenv(Path.home() / ".norenty-secrets" / ".env", override=True)

CSV_URL = "https://zenodo.org/records/10231359/files/truckParkingLocationsEurope_MediumHigh_v03.csv?download=1"

TIPO_MAP = {
    "parking": "parking",
    "parking / rest area": "parking",
    "rest area": "rest_area",
    "truck stop / rest area": "rest_area",
    "fueling": "fueling",
    "fueling / truck stop": "fueling",
}


def parsear_filas(contenido_csv: str, pais: str):
    reader = csv.DictReader(io.StringIO(contenido_csv), delimiter=";")
    filas = []
    for row in reader:
        if pais != "TODOS" and row.get("country", "").strip().upper() != pais.upper():
            continue
        try:
            lat = float(row["lat"])
            lon = float(row["lon"])
        except (KeyError, ValueError, TypeError):
            continue
        nombre = (row.get("name") or "").strip() or "Parking"
        filas.append({
            "nombre": nombre,
            "tipo": TIPO_MAP.get(nombre.lower(), "otro"),
            "lat": lat,
            "lon": lon,
            "pais": (row.get("country") or "").strip() or None,
            "confianza": (row.get("truckParkingConfidence") or "").strip() or None,
            "fuente": "dataset_abierto",
            "empresa_id": None,
        })
    return filas


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pais", default="ES", help="Código ISO2 (ej. ES, FR) o TODOS. Por defecto: ES.")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        print("ERROR: faltan SUPABASE_URL y una clave (SERVICE_ROLE o ANON) en el entorno (.env).")
        sys.exit(1)
    if not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        print("AVISO: sin SERVICE_ROLE_KEY, usando ANON key — solo funciona si existe una "
              "política RLS que permita insertar/borrar filas del dataset abierto.")

    print(f"Descargando dataset abierto de {CSV_URL} ...")
    with urllib.request.urlopen(CSV_URL, timeout=60) as resp:
        contenido = resp.read().decode("utf-8")

    filas = parsear_filas(contenido, args.pais)
    print(f"Filas a insertar (país={args.pais}): {len(filas)}")

    sb = create_client(url, key)

    # returning="minimal": evita que PostgREST intente devolver las filas
    # afectadas, lo que requeriría pasar también la política SELECT (que con
    # anon key falla porque anon no puede ejecutar current_empresa_id()).
    borrado = sb.table("parking").delete(returning="minimal").eq("fuente", "dataset_abierto")
    if args.pais != "TODOS":
        borrado = borrado.eq("pais", args.pais)
    borrado.execute()

    # Insertar por lotes para no exceder límites de payload.
    LOTE = 200
    for i in range(0, len(filas), LOTE):
        sb.table("parking").insert(filas[i:i + LOTE], returning="minimal").execute()
        print(f"  insertadas {min(i + LOTE, len(filas))}/{len(filas)}")

    print("OK.")


if __name__ == "__main__":
    main()
