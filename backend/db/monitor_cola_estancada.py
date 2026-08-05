"""Alerta real de "cola de trabajos estancada" (auditoría 2026-08-04, hallazgo #6).

`cola_trabajo` (0040_cola_trabajos.sql) es la cola async del bot -- si por lo que sea
deja de drenarse (worker caído, DATABASE_URL faltante al arrancar, error persistente),
antes solo se veía en un log de arranque que nadie mira. Mismo patrón anti-spam que
monitor_heartbeat.py (0044/alerta_bot_caido): abre un episodio la primera vez que se
detecta estancamiento, avisa a los gestores, y lo cierra con un aviso de recuperación
cuando la cola vuelve a drenar por debajo del umbral.

"Estancada" = hay al menos UMBRAL_FILAS filas en 'pendiente'/'fallido' con la más
antigua esperando más de UMBRAL_MINUTOS -- un pico momentáneo de trabajo no es una
alerta, un trabajo viejo que nadie recoge sí lo es.

    python backend/db/monitor_cola_estancada.py
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from monitor_common import cargar_env, requerir_env, ejecutar_con_conexion, enviar_telegram, obtener_chats_gestores

cargar_env()

UMBRAL_MINUTOS = 15
UMBRAL_FILAS = 5


def obtener_estado_cola(cur, umbral_minutos: int = UMBRAL_MINUTOS, umbral_filas: int = UMBRAL_FILAS):
    """(estancada: bool, filas_atascadas: int). Solo cuentan filas reclamables
    (pendiente/fallido) cuya disponible_en ya venció hace más de umbral_minutos --
    una fila con backoff en curso no es "estancada", solo está esperando su turno."""
    cur.execute(
        "SELECT count(*) FROM cola_trabajo "
        "WHERE estado IN ('pendiente','fallido') "
        "AND disponible_en < now() - (%s || ' minutes')::interval",
        (umbral_minutos,),
    )
    filas_atascadas = cur.fetchone()[0]
    return filas_atascadas >= umbral_filas, filas_atascadas


def hay_alerta_abierta(cur):
    cur.execute("SELECT id FROM alerta_cola_estancada WHERE resuelta_en IS NULL ORDER BY enviada_en DESC LIMIT 1")
    fila = cur.fetchone()
    return fila[0] if fila else None


def abrir_alerta(cur):
    cur.execute("INSERT INTO alerta_cola_estancada DEFAULT VALUES RETURNING id")
    return cur.fetchone()[0]


def resolver_alerta(cur, alerta_id):
    cur.execute("UPDATE alerta_cola_estancada SET resuelta_en = now() WHERE id = %s", (alerta_id,))


def mensaje_estancada(filas):
    return (
        f"🟠 ALERTA — la cola de trabajos del bot tiene {filas} tarea(s) sin procesar desde "
        f"hace más de {UMBRAL_MINUTOS} min. Revisa si el worker/bot está corriendo con "
        f"DATABASE_URL configurada."
    )


def mensaje_recuperado():
    return "🟢 La cola de trabajos del bot ha vuelto a drenar con normalidad -- la alerta anterior queda cerrada."


def revisar_y_alertar(cur, token, umbral_minutos: int = UMBRAL_MINUTOS, umbral_filas: int = UMBRAL_FILAS, enviar_fn=enviar_telegram):
    estancada, filas = obtener_estado_cola(cur, umbral_minutos, umbral_filas)
    alerta_abierta_id = hay_alerta_abierta(cur)
    resultado = {"estancada": estancada, "filas_atascadas": filas, "accion": "ninguna", "notificados": 0}

    if estancada and not alerta_abierta_id:
        chats = obtener_chats_gestores(cur)
        for chat in chats:
            enviar_fn(token, chat, mensaje_estancada(filas))
        abrir_alerta(cur)
        resultado["accion"] = "alerta_enviada"
        resultado["notificados"] = len(chats)
    elif not estancada and alerta_abierta_id:
        chats = obtener_chats_gestores(cur)
        for chat in chats:
            enviar_fn(token, chat, mensaje_recuperado())
        resolver_alerta(cur, alerta_abierta_id)
        resultado["accion"] = "recuperacion_enviada"
        resultado["notificados"] = len(chats)

    return resultado


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--umbral-minutos", type=int, default=UMBRAL_MINUTOS)
    parser.add_argument("--umbral-filas", type=int, default=UMBRAL_FILAS)
    args = parser.parse_args()

    database_url, token = requerir_env("DATABASE_URL", "TELEGRAM_BOT_TOKEN")

    r = ejecutar_con_conexion(
        database_url,
        lambda cur: revisar_y_alertar(cur, token, args.umbral_minutos, args.umbral_filas),
    )

    if r["accion"] == "ninguna":
        estado = "estancada (ya notificado)" if r["estancada"] else "drenando con normalidad"
        print(f"Cola {estado}. filas_atascadas={r['filas_atascadas']}. Sin acción nueva.")
    else:
        print(f"{r['accion']}: {r['notificados']} gestor(es) notificado(s). filas_atascadas={r['filas_atascadas']}.")


if __name__ == "__main__":
    main()
