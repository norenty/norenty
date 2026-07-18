"""Detección de checkpoint saltado (CHK.6, 2026-07-17) — un checkpoint
(`hito.es_checkpoint=true`) puede no cruzarse por muchos motivos legítimos: el
chófer tomó otra ruta, paró un poco antes, el GPS falló un momento. La
pregunta que importa no es "¿se saltó el checkpoint?" (eso ya se sabe: no hay
evento `checkpoint_pasado`) sino "¿hay evidencia de que NUNCA pasó por ahí?" --
si hay, es un dato a mirar; si no hay ningún ping cerca en todo el histórico
del viaje, probablemente sí se desvió de la ruta prevista.

Este script NO alerta solo por "ventana vencida" (eso es fuera_de_ventana,
R1) -- alerta solo cuando el viaje ya avanzó MÁS ALLÁ del checkpoint (un hito
de orden posterior está completado) Y, revisando el histórico completo de
`ubicacion` de ese chófer durante el viaje, NUNCA hubo un ping dentro del
`radio_m` del checkpoint. Si sí lo hubo pero el evento no se registró (un
hueco de cobertura del ping "en caliente" de `handle_location`), se
autocorrige: se inserta el `checkpoint_pasado` que faltaba y no se avisa a
nadie -- no es una incidencia, es solo evidencia tardía.

    python backend/db/monitor_checkpoint_saltado.py
"""
import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from monitor_common import cargar_env, requerir_env, ejecutar_con_conexion, enviar_telegram
from monitor_retraso_silencioso import _filtrar_por_asignacion  # mismo filtro de Fase 15

cargar_env()

UMBRAL_GEO_LLEGADA_M = 300  # mismo default que bot.py:punto_en_checkpoint, sin radio_m propio


def haversine_km(lat1, lon1, lat2, lon2):
    """Copia deliberada de bot.py:haversine_km -- este script corre standalone
    (psycopg2 directo, no importa bot.py, que arrastra python-telegram-bot y
    el resto del runtime del bot)."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def obtener_checkpoints_pendientes_de_revision(cur):
    """Checkpoints cuyo viaje ya avanzó más allá (un hito de orden posterior
    está completado, o el viaje ya está completado del todo), sin evento
    checkpoint_pasado y sin incidencia checkpoint_saltado previa (dedup, mismo
    patrón que R1)."""
    cur.execute("""
        SELECT h.id, h.orden, h.direccion, h.lat, h.lon, h.radio_m,
               v.id, v.referencia, v.empresa_id, v.chofer_id, v.gestor_id, v.created_at
        FROM hito h
        JOIN viaje v ON v.id = h.viaje_id
        WHERE h.es_checkpoint = true
          AND h.lat IS NOT NULL AND h.lon IS NOT NULL
          AND v.estado IN ('en_curso', 'completado')
          AND NOT EXISTS (
              SELECT 1 FROM ejecucion_evento e
              WHERE e.hito_id = h.id AND e.tipo = 'checkpoint_pasado'
          )
          AND NOT EXISTS (
              SELECT 1 FROM incidencia i
              WHERE i.hito_id = h.id AND i.tipo = 'checkpoint_saltado'
          )
          AND (
              v.estado = 'completado'
              OR EXISTS (
                  SELECT 1 FROM hito h2
                  WHERE h2.viaje_id = h.viaje_id AND h2.orden > h.orden AND h2.estado = 'completado'
              )
          )
    """)
    return cur.fetchall()


def hubo_ping_cerca(cur, chofer_id, lat, lon, radio_m, desde):
    """Recorre el histórico de `ubicacion` del chófer desde el inicio del
    viaje y comprueba si ALGÚN ping cayó dentro del radio -- evidencia de que
    sí pasó por ahí aunque el evento en caliente no se registrara."""
    cur.execute(
        "SELECT lat, lon FROM ubicacion WHERE chofer_id = %s AND created_at >= %s",
        (chofer_id, desde),
    )
    umbral = radio_m if radio_m else UMBRAL_GEO_LLEGADA_M
    for plat, plon in cur.fetchall():
        if haversine_km(plat, plon, lat, lon) * 1000 <= umbral:
            return True
    return False


def autocorregir_checkpoint(cur, hito_id, viaje_id, chofer_id):
    cur.execute(
        "INSERT INTO ejecucion_evento (viaje_id, hito_id, chofer_id, tipo, detalle) "
        "VALUES (%s, %s, %s, 'checkpoint_pasado', 'detectado a posteriori por monitor_checkpoint_saltado')",
        (viaje_id, hito_id, chofer_id),
    )


def crear_incidencia_checkpoint_saltado(cur, hito_id, viaje_id, descripcion):
    cur.execute(
        "INSERT INTO incidencia (viaje_id, hito_id, tipo, descripcion, estado) "
        "VALUES (%s, %s, 'checkpoint_saltado', %s, 'abierta') RETURNING id",
        (viaje_id, hito_id, descripcion),
    )
    return cur.fetchone()[0]


def chats_gestores_incidencias(cur, empresa_id, gestor_id_asignado=None):
    """Gestores activos con notif_incidencias activada (R2) -- checkpoint
    saltado se trata como cualquier otra incidencia, no como fuera_de_ventana
    (no es un tema de horario, es de ruta) -- y respeta la asignación de
    Fase 15."""
    cur.execute(
        "SELECT telegram_chat_id, rol, id FROM gestor "
        "WHERE empresa_id = %s AND activo = true AND notif_incidencias = true "
        "AND telegram_chat_id IS NOT NULL",
        (empresa_id,),
    )
    gestores = _filtrar_por_asignacion(cur.fetchall(), gestor_id_asignado)
    return [fila[0] for fila in gestores]


def mensaje_checkpoint_saltado(referencia, direccion, orden):
    donde = direccion or f"checkpoint {orden}"
    return (
        f"📍 CHECKPOINT NO REGISTRADO — Viaje {referencia}\n\n"
        f"No hay ningún dato de GPS que confirme el paso por {donde}. Puede ser una ruta "
        f"alternativa, una parada distinta, o un fallo de cobertura -- conviene revisarlo con "
        f"el chófer."
    )


def revisar_checkpoints(cur, token, enviar_fn=enviar_telegram):
    resultado = {"autocorregidos": 0, "incidencias_creadas": 0, "notificados": 0}

    filas = obtener_checkpoints_pendientes_de_revision(cur)
    for hito_id, orden, direccion, lat, lon, radio_m, viaje_id, referencia, empresa_id, chofer_id, gestor_id, creado_en in filas:
        if chofer_id and hubo_ping_cerca(cur, chofer_id, lat, lon, radio_m, creado_en):
            autocorregir_checkpoint(cur, hito_id, viaje_id, chofer_id)
            resultado["autocorregidos"] += 1
            continue

        ref = referencia or str(viaje_id)[:8]
        descripcion = f"Checkpoint {direccion or f'orden {orden}'} sin ping de GPS cercano en todo el viaje."
        crear_incidencia_checkpoint_saltado(cur, hito_id, viaje_id, descripcion)
        resultado["incidencias_creadas"] += 1
        for chat in chats_gestores_incidencias(cur, empresa_id, gestor_id):
            enviar_fn(token, chat, mensaje_checkpoint_saltado(ref, direccion, orden))
            resultado["notificados"] += 1

    return resultado


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    database_url, token = requerir_env("DATABASE_URL", "TELEGRAM_BOT_TOKEN")

    r = ejecutar_con_conexion(database_url, lambda cur: revisar_checkpoints(cur, token))

    print(
        f"{r['autocorregidos']} checkpoint(s) autocorregido(s) (ping tardío encontrado). "
        f"{r['incidencias_creadas']} incidencia(s) nueva(s), {r['notificados']} aviso(s)."
    )


if __name__ == "__main__":
    main()
