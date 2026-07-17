"""Escalación proactiva de retraso silencioso (R1, Fase 16, 2026-07-15) — hoy
`fuera_de_ventana` solo se detecta si el CHÓFER confirma la llegada tarde
(`bot.py`, `cb_llegada`). El caso "silencioso y tarde" -- el chófer nunca
confirma nada, la ventana pasa sin que nadie lo note salvo que alguien mire
el dashboard a mano -- es exactamente el que el producto existe para cazar,
y hoy no dispara ningún aviso. Este script lo cubre en dos niveles:

  Nivel 1 (inmediato): hito con `ventana_fin` vencida, sin completar, sin
  incidencia `fuera_de_ventana` todavía (dedup vía `incidencia.hito_id`) ->
  se crea la incidencia y se avisa a los gestores ACTIVOS de la empresa con
  `notif_fuera_ventana = true` (misma preferencia que R2 dejó de ser
  decorativa).

  Nivel 2 (escalación): esa incidencia sigue `estado='abierta'` más de
  `UMBRAL_ESCALACION_MIN` después de creada y aún no se escaló -> se avisa a
  TODOS los gestores activos de la empresa, IGNORANDO la preferencia (a los
  45 min sin que nadie la resuelva, deja de ser "opcional") y se marca
  `escalada_en` para no repetir. Una incidencia escala UNA VEZ.

  Resolución: cuando el hito se completa de verdad, `bot.py` (`cb_llegada`)
  cierra la incidencia abierta correspondiente -- este script deja de verla
  en la siguiente pasada, sin trabajo adicional aquí.

**Nota honesta (mismo criterio que monitor_heartbeat.py/monitor_integridad.py)**:
sin scheduler propio, se ejecuta vía cron de GitHub Actions
(`.github/workflows/monitores.yml`, cada 15 min) o a mano mientras tanto:

    python backend/db/monitor_retraso_silencioso.py
"""
import argparse
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")
# Seguridad (2026-07-08): secretos reales en ~/.norenty-secrets/.env, fuera del
# repo (ver RUNBOOK-SECRETS.md). override=True: gana sobre el .env del repo.
load_dotenv(Path.home() / ".norenty-secrets" / ".env", override=True)

sys.path.insert(0, str(Path(__file__).parent))
from monitor_heartbeat import enviar_telegram  # reutiliza el POST directo a la Bot API

UMBRAL_ESCALACION_MIN = 45  # valor inicial razonable, mismo estatus que otros umbrales del proyecto


def obtener_hitos_sin_alertar(cur):
    """Hitos de viajes en_curso con ventana_fin vencida, sin completar, y SIN
    ya una incidencia `fuera_de_ventana` registrada para ese hito (dedup --
    `incidencia.hito_id` existe desde 0001, se reutiliza como marca de "ya
    alertado" sin tabla nueva para el nivel 1)."""
    cur.execute("""
        SELECT h.id, h.orden, h.direccion, v.id, v.referencia, v.empresa_id, c.nombre, v.gestor_id
        FROM hito h
        JOIN viaje v ON v.id = h.viaje_id
        LEFT JOIN chofer c ON c.id = v.chofer_id
        WHERE v.estado = 'en_curso'
          AND h.estado != 'completado'
          AND h.ventana_fin IS NOT NULL
          AND h.ventana_fin < now()
          AND NOT EXISTS (
              SELECT 1 FROM incidencia i
              WHERE i.hito_id = h.id AND i.tipo = 'fuera_de_ventana'
          )
    """)
    return cur.fetchall()


def crear_incidencia(cur, hito_id, viaje_id, descripcion):
    cur.execute(
        "INSERT INTO incidencia (viaje_id, hito_id, tipo, descripcion, estado) "
        "VALUES (%s, %s, 'fuera_de_ventana', %s, 'abierta') RETURNING id",
        (viaje_id, hito_id, descripcion),
    )
    return cur.fetchone()[0]


def obtener_incidencias_a_escalar(cur, umbral_min=UMBRAL_ESCALACION_MIN):
    """Incidencias fuera_de_ventana abiertas, creadas hace más de umbral_min,
    que aún no se escalaron."""
    cur.execute(
        "SELECT i.id, i.viaje_id, v.referencia, v.empresa_id, v.gestor_id "
        "FROM incidencia i JOIN viaje v ON v.id = i.viaje_id "
        "WHERE i.tipo = 'fuera_de_ventana' AND i.estado = 'abierta' "
        "AND i.escalada_en IS NULL "
        "AND i.created_at < now() - (%s || ' minutes')::interval",
        (umbral_min,),
    )
    return cur.fetchall()


def marcar_escalada(cur, incidencia_id):
    cur.execute("UPDATE incidencia SET escalada_en = now() WHERE id = %s", (incidencia_id,))


def _filtrar_por_asignacion(gestores, gestor_id_asignado):
    """Fase 15 (2026-07-15, hallazgo posterior a F15.2): si el viaje tiene
    `gestor_id` asignado, solo ESE gestor (o un `admin`) debe enterarse --
    mismo criterio de visibilidad que la política RLS de F15.2. Este script
    conecta con `DATABASE_URL` (privilegios de servicio, sin RLS), así que
    sin este filtro un gestor no asignado recibía por Telegram avisos de
    viajes que ni siquiera puede ver en su propio dashboard."""
    if not gestor_id_asignado:
        return gestores
    return [g for g in gestores if g[1] == "admin" or g[2] == gestor_id_asignado]


def chats_gestores_nivel1(cur, empresa_id, gestor_id_asignado=None):
    """Gestores activos con la preferencia notif_fuera_ventana activada (R2)
    -- nivel 1 respeta la preferencia -- y, si el viaje tiene gestor
    asignado, solo ese gestor o un admin (Fase 15)."""
    cur.execute(
        "SELECT telegram_chat_id, rol, id FROM gestor "
        "WHERE empresa_id = %s AND activo = true AND notif_fuera_ventana = true "
        "AND telegram_chat_id IS NOT NULL",
        (empresa_id,),
    )
    gestores = _filtrar_por_asignacion(cur.fetchall(), gestor_id_asignado)
    return [fila[0] for fila in gestores]


def chats_gestores_todos(cur, empresa_id, gestor_id_asignado=None):
    """Todos los gestores activos de la empresa, IGNORANDO la preferencia --
    nivel 2 (escalación): a los 45 min sin resolver deja de ser opcional.
    SIGUE respetando la asignación (Fase 15): la urgencia no es excusa para
    filtrar información a quien no debería verla."""
    cur.execute(
        "SELECT telegram_chat_id, rol, id FROM gestor "
        "WHERE empresa_id = %s AND activo = true AND telegram_chat_id IS NOT NULL",
        (empresa_id,),
    )
    gestores = _filtrar_por_asignacion(cur.fetchall(), gestor_id_asignado)
    return [fila[0] for fila in gestores]


def mensaje_nivel1(referencia, orden, direccion, nombre_chofer):
    quien = nombre_chofer or "el chófer"
    donde = direccion or f"hito {orden}"
    return (
        f"⏰ RETRASO SIN CONFIRMAR — Viaje {referencia}\n\n"
        f"{quien} no ha confirmado la llegada a {donde} y la ventana horaria ya ha pasado. "
        f"Puede ser un simple olvido de marcar en el bot, o un retraso real -- conviene comprobarlo."
    )


def mensaje_nivel2(referencia):
    return (
        f"🔴 ESCALADO — Viaje {referencia}\n\n"
        f"El aviso de retraso sin confirmar sigue sin resolverse tras {UMBRAL_ESCALACION_MIN} min. "
        f"Se avisa a todo el equipo."
    )


def revisar_y_escalar(cur, token, umbral_min=UMBRAL_ESCALACION_MIN, enviar_fn=enviar_telegram):
    """Lógica central, pura sobre un cursor + una función de envío inyectable
    (mismo patrón que monitor_heartbeat.revisar_y_alertar, testeable sin red
    ni Postgres real)."""
    resultado = {"nivel1_creadas": 0, "nivel1_notificados": 0, "nivel2_escaladas": 0, "nivel2_notificados": 0}

    for hito_id, orden, direccion, viaje_id, referencia, empresa_id, nombre_chofer, gestor_id in obtener_hitos_sin_alertar(cur):
        ref = referencia or str(viaje_id)[:8]
        descripcion = f"{nombre_chofer or 'Chófer'} no confirmó la llegada a {direccion or f'hito {orden}'} (ventana vencida)."
        crear_incidencia(cur, hito_id, viaje_id, descripcion)
        resultado["nivel1_creadas"] += 1
        for chat in chats_gestores_nivel1(cur, empresa_id, gestor_id):
            enviar_fn(token, chat, mensaje_nivel1(ref, orden, direccion, nombre_chofer))
            resultado["nivel1_notificados"] += 1

    for incidencia_id, viaje_id, referencia, empresa_id, gestor_id in obtener_incidencias_a_escalar(cur, umbral_min):
        ref = referencia or str(viaje_id)[:8]
        for chat in chats_gestores_todos(cur, empresa_id, gestor_id):
            enviar_fn(token, chat, mensaje_nivel2(ref))
            resultado["nivel2_notificados"] += 1
        marcar_escalada(cur, incidencia_id)
        resultado["nivel2_escaladas"] += 1

    return resultado


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--umbral-escalacion", type=int, default=UMBRAL_ESCALACION_MIN)
    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not database_url:
        print("ERROR: falta DATABASE_URL en el entorno.", file=sys.stderr)
        sys.exit(1)
    if not token:
        print("ERROR: falta TELEGRAM_BOT_TOKEN en el entorno.", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            r = revisar_y_escalar(cur, token, args.umbral_escalacion)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(
        f"Nivel 1: {r['nivel1_creadas']} incidencia(s) nueva(s), {r['nivel1_notificados']} aviso(s). "
        f"Nivel 2: {r['nivel2_escaladas']} escalada(s), {r['nivel2_notificados']} aviso(s)."
    )


if __name__ == "__main__":
    main()
