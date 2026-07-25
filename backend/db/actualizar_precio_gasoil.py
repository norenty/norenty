"""18.B.3 — Precio del gasoil automático, como REFERENCIA para arrancar una
cotización (no sustituye el dato real de las facturas de repostaje de los
chóferes, eso es 18.B.2 y sigue pendiente). El comercial/admin siempre puede
sobreescribirlo a mano en Ajustes — este script solo mantiene actualizada la
sugerencia, nunca toca `empresa.precio_gasoil_litro` directamente.

Fuente: API REST pública del Ministerio para la Transición Ecológica
(geoportal de precios de carburantes). Devuelve el precio de "Precio Gasoleo A"
de cada gasolinera del país (miles de filas) — no hay endpoint de media
nacional, así que se calcula aquí la media de las estaciones con precio
válido (>0) y se guarda en `indice_gasoil_nacional` (migración 0062).

**Nota honesta (mismo criterio que purgar_ubicacion.py/monitor_heartbeat.py)**:
este script no tiene todavía un scheduler que lo ejecute solo — no existe
infraestructura de cron en el proyecto hoy. Ejecutar manualmente (o vía Tarea
Programada de Windows/cron, una vez al día basta: el precio del gasoil no
cambia varias veces al día):

    python backend/db/actualizar_precio_gasoil.py
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from monitor_common import cargar_env, requerir_env, ejecutar_con_conexion

cargar_env()

URL_MINISTERIO = (
    "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/"
    "PreciosCarburantes/EstacionesTerrestres/"
)


def descargar_estaciones(url: str = URL_MINISTERIO, timeout: int = 30):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        cuerpo = resp.read().decode("latin-1")  # el servicio del Ministerio no usa UTF-8
    datos = json.loads(cuerpo)
    return datos.get("ListaEESSPrecio", [])


def calcular_precio_medio(estaciones):
    """Media de "Precio Gasoleo A" entre las estaciones con precio válido.
    El campo llega como texto con coma decimal (p.ej. "1,589") o vacío si esa
    gasolinera no vende gasóleo A. Devuelve (media, num_estaciones) o
    (None, 0) si no hay ningún precio válido."""
    precios = []
    for est in estaciones:
        texto = (est.get("Precio Gasoleo A") or "").strip()
        if not texto:
            continue
        try:
            precio = float(texto.replace(",", "."))
        except ValueError:
            continue
        if precio > 0:
            precios.append(precio)
    if not precios:
        return None, 0
    return round(sum(precios) / len(precios), 3), len(precios)


def guardar_indice(cur, precio_medio, num_estaciones):
    cur.execute(
        """
        INSERT INTO indice_gasoil_nacional (id, precio_medio_eur, num_estaciones, actualizado_en)
        VALUES (true, %s, %s, now())
        ON CONFLICT (id) DO UPDATE SET
          precio_medio_eur = EXCLUDED.precio_medio_eur,
          num_estaciones = EXCLUDED.num_estaciones,
          actualizado_en = now()
        """,
        (precio_medio, num_estaciones),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="solo calcula e imprime, no escribe en la BD")
    args = parser.parse_args()

    database_url = requerir_env("DATABASE_URL")

    estaciones = descargar_estaciones()
    precio_medio, num_estaciones = calcular_precio_medio(estaciones)

    if precio_medio is None:
        print("ERROR: no se pudo calcular ningun precio valido (respuesta vacia o formato inesperado).", file=sys.stderr)
        sys.exit(1)

    print(f"Precio medio Gasoleo A: {precio_medio} EUR/l (de {num_estaciones} gasolineras)")

    if args.dry_run:
        print("--dry-run: no se ha escrito nada en la base de datos.")
        return

    ejecutar_con_conexion(database_url, lambda cur: guardar_indice(cur, precio_medio, num_estaciones))
    print("Guardado en indice_gasoil_nacional.")


if __name__ == "__main__":
    main()
