"""Purga de geolocalización granular (ítem 9.13, ver PRIVACIDAD-RAT.md §2).

`ubicacion` es el dato personal más sensible del sistema (posición en tiempo
real del chófer). Se borra pasados N días (por defecto 90, configurable) para
minimizar la exposición: el bot y el dashboard solo consultan la ÚLTIMA
posición conocida de cada chófer (ver `obtener_ubicacion_chofer` en
`app/bot.py` y `handle_location`), nunca un histórico agregado — así que no
hay hoy ninguna función del producto que dependa de conservar filas viejas.

**Decisión de diseño (borrar, no agregar)**: el ítem 9.13 permite "agregar o
borrar". Se eligió BORRAR sin más porque no existe ninguna funcionalidad que
consuma un agregado histórico de `ubicacion` — añadir una capa de agregación
sería complejidad sin consumidor. Si en el futuro se necesitara analítica de
recorridos históricos, se puede introducir una tabla agregada ANTES de borrar,
sin tocar este script (solo insertar un paso previo).

`ejecucion_evento` y `pod` NO se tocan aquí: son la evidencia contractual del
servicio (ítems 9.6-9.8), se retienen indefinidamente por diseño.

**Nota honesta (mismo criterio que verificar_cadena.py/verificar_pod.py)**:
este script no tiene todavía un scheduler que lo ejecute solo — no existe
infraestructura de cron en el proyecto hoy (mismo motivo por el que las
alertas Telegram de documentos por caducar, ítem 4.4, quedaron pendientes de
un runner programado). Ejecutar manualmente (o vía Tarea Programada de
Windows/cron) mientras tanto:

    python backend/db/purgar_ubicacion.py                 # purga con 90 días
    python backend/db/purgar_ubicacion.py --dias 60        # umbral custom
    python backend/db/purgar_ubicacion.py --dry-run        # solo cuenta, no borra
"""
import argparse
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")

UBICACION_RETENCION_DIAS_DEFAULT = 90


def contar_filas_a_purgar(cur, dias: int) -> int:
    cur.execute(
        "SELECT count(*) FROM ubicacion WHERE created_at < now() - interval '1 day' * %s",
        (dias,),
    )
    return cur.fetchone()[0]


def purgar_ubicacion(cur, dias: int, dry_run: bool = False) -> int:
    """Borra las filas de `ubicacion` con más de `dias` días de antigüedad.
    Devuelve cuántas filas se borraron (o se borrarían, en `dry_run`). Si no
    hay nada que purgar, no ejecuta el DELETE (nada que hacer)."""
    total = contar_filas_a_purgar(cur, dias)
    if dry_run or total == 0:
        return total

    cur.execute(
        "DELETE FROM ubicacion WHERE created_at < now() - interval '1 day' * %s",
        (dias,),
    )
    return cur.rowcount


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dias", type=int, default=UBICACION_RETENCION_DIAS_DEFAULT)
    parser.add_argument("--dry-run", action="store_true", help="solo cuenta, no borra nada")
    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: falta DATABASE_URL en el entorno (.env o variable de entorno).", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            afectadas = purgar_ubicacion(cur, args.dias, dry_run=args.dry_run)

        if args.dry_run:
            conn.rollback()
            print(f"[dry-run] {afectadas} filas de ubicacion tienen más de {args.dias} días (no se ha borrado nada).")
        else:
            conn.commit()
            print(f"Purgadas {afectadas} filas de ubicacion con más de {args.dias} días.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
