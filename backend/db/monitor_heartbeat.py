"""Alerta real de "bot caído" (ítem 10.5) — hoy el heartbeat perdido (>5 min,
`UMBRAL_HEARTBEAT_S`, mismo umbral que usa `dashboard/lib/data.js` ítem 8.3)
solo se ve en una tarjeta pasiva de Ajustes que nadie mira si no tiene la
pestaña abierta. Este script comprueba el heartbeat y, si está caído, manda
Telegram a los gestores con `telegram_chat_id` vinculado — UNA VEZ por episodio
de caída (anti-spam vía `alerta_bot_caido`, 0044), no en cada ejecución. Cuando
el heartbeat se recupera, manda un aviso de recuperación y cierra el episodio.

**Nota honesta (mismo criterio que purgar_ubicacion.py/calcular_slos.py)**: este
script no tiene todavía un scheduler que lo ejecute solo — no existe
infraestructura de cron en el proyecto hoy. Ejecutar manualmente (o vía Tarea
Programada de Windows/cron, cada 1-5 min) mientras tanto:

    python backend/db/monitor_heartbeat.py
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from monitor_common import cargar_env, requerir_env, ejecutar_con_conexion, enviar_telegram, obtener_chats_gestores

cargar_env()

UMBRAL_HEARTBEAT_S = 300  # mismo umbral que dashboard/lib/data.js (8.3)


def obtener_estado_heartbeat(cur, umbral_s: int = UMBRAL_HEARTBEAT_S):
    """(caido: bool, segundos_desde_ultimo: float|None). segundos=None si nunca
    hubo un latido (tabla vacía) -> se considera caído."""
    cur.execute("SELECT EXTRACT(EPOCH FROM (now() - max(created_at))) FROM bot_heartbeat")
    segundos = cur.fetchone()[0]
    caido = segundos is None or segundos > umbral_s
    return caido, segundos


def hay_alerta_abierta(cur):
    """id de la alerta abierta (resuelta_en IS NULL) más reciente, o None."""
    cur.execute("SELECT id FROM alerta_bot_caido WHERE resuelta_en IS NULL ORDER BY enviada_en DESC LIMIT 1")
    fila = cur.fetchone()
    return fila[0] if fila else None


def abrir_alerta(cur):
    cur.execute("INSERT INTO alerta_bot_caido DEFAULT VALUES RETURNING id")
    return cur.fetchone()[0]


def resolver_alerta(cur, alerta_id):
    cur.execute("UPDATE alerta_bot_caido SET resuelta_en = now() WHERE id = %s", (alerta_id,))


def mensaje_caida(segundos):
    minutos = round(segundos / 60) if segundos is not None else None
    detalle = f"último latido hace {minutos} min" if minutos is not None else "nunca se ha registrado un latido"
    return f"🔴 ALERTA — el bot de Norenty parece caído ({detalle}). Ningún chófer puede reportar hasta que se reinicie."


def mensaje_recuperado():
    return "🟢 El bot de Norenty ha vuelto a responder — la alerta anterior queda cerrada."


def revisar_y_alertar(cur, token, umbral_s: int = UMBRAL_HEARTBEAT_S, enviar_fn=enviar_telegram):
    """Lógica central, pura sobre un cursor + una función de envío inyectable
    (así se testea sin tocar la red ni Postgres real, ver test_monitor_heartbeat.py)."""
    caido, segundos = obtener_estado_heartbeat(cur, umbral_s)
    alerta_abierta_id = hay_alerta_abierta(cur)
    resultado = {"caido": caido, "segundos_desde_ultimo": segundos, "accion": "ninguna", "notificados": 0}

    if caido and not alerta_abierta_id:
        chats = obtener_chats_gestores(cur)
        for chat in chats:
            enviar_fn(token, chat, mensaje_caida(segundos))
        abrir_alerta(cur)
        resultado["accion"] = "alerta_enviada"
        resultado["notificados"] = len(chats)
    elif not caido and alerta_abierta_id:
        chats = obtener_chats_gestores(cur)
        for chat in chats:
            enviar_fn(token, chat, mensaje_recuperado())
        resolver_alerta(cur, alerta_abierta_id)
        resultado["accion"] = "recuperacion_enviada"
        resultado["notificados"] = len(chats)

    return resultado


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--umbral", type=int, default=UMBRAL_HEARTBEAT_S)
    args = parser.parse_args()

    database_url, token = requerir_env("DATABASE_URL", "TELEGRAM_BOT_TOKEN")

    r = ejecutar_con_conexion(database_url, lambda cur: revisar_y_alertar(cur, token, args.umbral))

    if r["accion"] == "ninguna":
        estado = "caído (ya notificado)" if r["caido"] else "activo"
        print(f"Heartbeat {estado}. segundos_desde_ultimo={r['segundos_desde_ultimo']}. Sin acción nueva.")
    else:
        print(f"{r['accion']}: {r['notificados']} gestor(es) notificado(s). segundos_desde_ultimo={r['segundos_desde_ultimo']}.")


if __name__ == "__main__":
    main()
