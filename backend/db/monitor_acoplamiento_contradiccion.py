"""Alerta proactiva de contradicción de acoplamiento (ROADMAP 23.C.4, cerrado 2026-08-02).

`getContradiccionesAcoplamiento()` (dashboard/lib/data.js) ya calculaba esto pero era de
lectura pasiva -- alguien tenía que entrar al dashboard a mirarlo. Este monitor es la
MISMA lógica (deliberadamente duplicada, no importada: ese código vive en JS del lado del
cliente/servidor Next.js, este script es Python standalone psycopg2, mismo patrón que los
otros 4 monitores de backend/db/) pero activa: crea una incidencia real y avisa al gestor,
en vez de esperar a que alguien abra una pantalla.

Caso real que lo motivó (2026-07-30, WhatsApp de un camionero): a un chófer le cambiaron de
remolque sin registrar el cambio en el sistema -- nadie se enteró hasta que el propio
chófer lo mencionó de pasada.

Frecuencia: mismo grupo de 15 min que monitor_checkpoint_saltado.py (decisión 2026-08-02) --
es igual de urgente que un checkpoint saltado: cuanto antes se detecte, antes se corrige
antes de que el viaje avance más con el remolque equivocado.

    python backend/db/monitor_acoplamiento_contradiccion.py
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from monitor_common import cargar_env, requerir_env, ejecutar_con_conexion, enviar_telegram
from monitor_retraso_silencioso import _filtrar_por_asignacion  # mismo filtro de Fase 15

cargar_env()


def obtener_hitos_con_remolque_activo(cur):
    """Hitos con remolque_id, del viaje ya en marcha (en_curso/completado) -- un hito
    `pendiente` sin remolque acoplado todavía es normal (el viaje no ha arrancado)."""
    cur.execute("""
        SELECT h.id, h.remolque_id, v.id, v.referencia, v.empresa_id, v.chofer_id, v.gestor_id
        FROM hito h
        JOIN viaje v ON v.id = h.viaje_id
        WHERE h.remolque_id IS NOT NULL
          AND h.estado IN ('en_curso', 'completado')
          AND NOT EXISTS (
              SELECT 1 FROM incidencia i
              WHERE i.hito_id = h.id AND i.tipo = 'acoplamiento_contradiccion'
          )
    """)
    return cur.fetchall()


def acoplamiento_vigente(cur, remolque_id):
    cur.execute(
        "SELECT chofer_id FROM acoplamiento WHERE remolque_id = %s AND hasta IS NULL LIMIT 1",
        (remolque_id,),
    )
    fila = cur.fetchone()
    return fila[0] if fila else "SIN_ACOPLAMIENTO"


def crear_incidencia_contradiccion(cur, hito_id, viaje_id, descripcion):
    cur.execute(
        "INSERT INTO incidencia (viaje_id, hito_id, tipo, descripcion, estado) "
        "VALUES (%s, %s, 'acoplamiento_contradiccion', %s, 'abierta') RETURNING id",
        (viaje_id, hito_id, descripcion),
    )
    return cur.fetchone()[0]


def chats_gestores_incidencias(cur, empresa_id, gestor_id_asignado=None):
    cur.execute(
        "SELECT telegram_chat_id, rol, id FROM gestor "
        "WHERE empresa_id = %s AND activo = true AND notif_incidencias = true "
        "AND telegram_chat_id IS NOT NULL",
        (empresa_id,),
    )
    gestores = _filtrar_por_asignacion(cur.fetchall(), gestor_id_asignado)
    return [fila[0] for fila in gestores]


def mensaje_contradiccion(referencia, tipo):
    if tipo == "sin_acoplamiento_vigente":
        detalle = "el sistema no tiene registrado ningún acoplamiento vigente para ese remolque"
    else:
        detalle = "el remolque está acoplado, según el sistema, a OTRO chófer distinto"
    return (
        f"🔀 CONTRADICCIÓN DE ACOPLAMIENTO — Viaje {referencia}\n\n"
        f"Este viaje usa un remolque, pero {detalle}. Puede ser un cambio de remolque no "
        f"registrado -- conviene comprobarlo antes de que el viaje avance más."
    )


def revisar_acoplamientos(cur, token, enviar_fn=enviar_telegram):
    resultado = {"incidencias_creadas": 0, "notificados": 0}

    for hito_id, remolque_id, viaje_id, referencia, empresa_id, chofer_id, gestor_id in obtener_hitos_con_remolque_activo(cur):
        vigente_chofer_id = acoplamiento_vigente(cur, remolque_id)

        if vigente_chofer_id == "SIN_ACOPLAMIENTO":
            tipo = "sin_acoplamiento_vigente"
            descripcion = "Este hito usa un remolque que, según el sistema, nadie tiene enganchado ahora mismo."
        elif chofer_id and vigente_chofer_id != chofer_id:
            tipo = "chofer_no_coincide"
            descripcion = "El remolque de este hito está acoplado a otro chófer distinto del asignado al viaje."
        else:
            continue  # sin contradicción -- nada que hacer

        ref = referencia or str(viaje_id)[:8]
        crear_incidencia_contradiccion(cur, hito_id, viaje_id, descripcion)
        resultado["incidencias_creadas"] += 1
        for chat in chats_gestores_incidencias(cur, empresa_id, gestor_id):
            enviar_fn(token, chat, mensaje_contradiccion(ref, tipo))
            resultado["notificados"] += 1

    return resultado


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    database_url, token = requerir_env("DATABASE_URL", "TELEGRAM_BOT_TOKEN")

    r = ejecutar_con_conexion(database_url, lambda cur: revisar_acoplamientos(cur, token))

    print(f"{r['incidencias_creadas']} incidencia(s) nueva(s), {r['notificados']} aviso(s).")


if __name__ == "__main__":
    main()
