"""Verifica la integridad de la cadena hash de ejecucion_evento (ítem 9.7,
ver SPECS-9.md). Recorre cada partición (viaje_id), recomputa cada hash con el
MISMO algoritmo que el trigger de la migración 0031 y compara. Es de
SOLO-LECTURA: nunca hace UPDATE. Si la cadena está rota, reparar es una
decisión humana (hay que decidir qué evento es el legítimo), no automática.

Uso:
    python backend/db/verificar_cadena.py            # verifica TODA la tabla
    python backend/db/verificar_cadena.py --viaje <uuid>   # solo esa cadena

Salida OK: "Cadena integra: N eventos en M viajes." + exit 0.
Salida rota: "CADENA ROTA en viaje <uuid>, evento <uuid>: <motivo>" a stderr + exit 1.
Si SENTRY_DSN está configurado, una rotura también se captura a Sentry.
"""
import hashlib
import os
import sys
from datetime import timezone
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")


def _calc_hash(hash_prev, id_, viaje_id, hito_id, chofer_id, tipo, detalle, ocurrido_en):
    """Espejo EXACTO de ejecucion_evento_calc_hash() (migración 0031)."""
    ocurrido_utc = ocurrido_en.astimezone(timezone.utc)
    payload = "|".join([
        hash_prev or "",
        str(id_),
        str(viaje_id),
        str(hito_id) if hito_id else "",
        str(chofer_id) if chofer_id else "",
        tipo,
        detalle or "",
        ocurrido_utc.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def verificar_cadena(cur, viaje_id=None):
    """Recorre las cadenas y devuelve
    {'ok': bool, 'eventos_verificados': int, 'cadenas': int,
     'rotura': None | {'evento_id','viaje_id','motivo'}}.
    'motivo' en {'hash_no_coincide','hash_prev_roto','primer_evento_con_hash_prev'}.
    Se detiene y reporta el PRIMER evento roto (por partición, en orden canónico).
    """
    query = """
        SELECT id, viaje_id, hito_id, chofer_id, tipo, detalle, ocurrido_en,
               hash, hash_prev
          FROM ejecucion_evento
    """
    params = []
    if viaje_id:
        query += " WHERE viaje_id = %s"
        params.append(viaje_id)
    query += " ORDER BY viaje_id, ocurrido_en, registrado_en, id"

    cur.execute(query, params)
    filas = cur.fetchall()

    prev_hash_por_viaje = {}
    eventos_verificados = 0

    for fila in filas:
        v_id = fila["viaje_id"]
        esperado_prev = prev_hash_por_viaje.get(v_id)

        if fila["hash_prev"] != esperado_prev:
            motivo = "primer_evento_con_hash_prev" if esperado_prev is None else "hash_prev_roto"
            return {
                "ok": False,
                "eventos_verificados": eventos_verificados,
                "cadenas": len(prev_hash_por_viaje),
                "rotura": {"evento_id": str(fila["id"]), "viaje_id": str(v_id), "motivo": motivo},
            }

        h = _calc_hash(
            fila["hash_prev"], fila["id"], fila["viaje_id"], fila["hito_id"],
            fila["chofer_id"], fila["tipo"], fila["detalle"], fila["ocurrido_en"],
        )
        if h != fila["hash"]:
            return {
                "ok": False,
                "eventos_verificados": eventos_verificados,
                "cadenas": len(prev_hash_por_viaje),
                "rotura": {"evento_id": str(fila["id"]), "viaje_id": str(v_id), "motivo": "hash_no_coincide"},
            }

        prev_hash_por_viaje[v_id] = fila["hash"]
        eventos_verificados += 1

    return {
        "ok": True,
        "eventos_verificados": eventos_verificados,
        "cadenas": len(prev_hash_por_viaje),
        "rotura": None,
    }


def main():
    viaje_id = None
    if "--viaje" in sys.argv:
        viaje_id = sys.argv[sys.argv.index("--viaje") + 1]

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: falta DATABASE_URL en el entorno (.env o variable de entorno).", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            resultado = verificar_cadena(cur, viaje_id)
    finally:
        conn.close()

    if resultado["ok"]:
        print(f"Cadena integra: {resultado['eventos_verificados']} eventos en {resultado['cadenas']} viajes.")
        sys.exit(0)

    rotura = resultado["rotura"]
    mensaje = f"CADENA ROTA en viaje {rotura['viaje_id']}, evento {rotura['evento_id']}: {rotura['motivo']}"
    print(mensaje, file=sys.stderr)

    if os.environ.get("SENTRY_DSN"):
        try:
            import sentry_sdk
            sentry_sdk.init(dsn=os.environ["SENTRY_DSN"])
            sentry_sdk.capture_message(mensaje, level="error")
        except Exception:
            pass

    sys.exit(1)


if __name__ == "__main__":
    main()
