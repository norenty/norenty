"""Verificación de integridad PROGRAMADA (ítem 10.6) — invoca `verificar_cadena`
(9.7, hash-chain de `ejecucion_evento`) y `verificar_hash_pod` (9.8, fotos de
POD), y si alguna rotura aparece, alerta por Telegram. Antes solo se
ejecutaban a mano; "la función de integridad no vale nada si la verificación
solo corre cuando alguien se acuerda de lanzarla".

A diferencia de la alerta de heartbeat (10.5, que SÍ se recupera sola), una
rotura de integridad NO se auto-resuelve — "reparar es una decisión humana"
(ya dicho en `verificar_cadena.py`). Por eso el anti-spam aquí es más simple:
una fila única por `(tipo, entidad_id)` rota (`alerta_integridad`, 0045,
`UNIQUE` + `ON CONFLICT DO NOTHING`) — se alerta la PRIMERA vez que se detecta
esa rotura concreta, nunca más, hasta que un humano la borre tras investigar.

**Nota honesta (mismo criterio que monitor_heartbeat.py)**: no hay scheduler
que lo ejecute solo — requiere cron/Tarea Programada (ver RUNBOOKS.md).

Uso:
    python backend/db/monitor_integridad.py
"""
import os
import sys
from pathlib import Path

import psycopg2.extras
from supabase import create_client

sys.path.insert(0, str(Path(__file__).parent))
from monitor_common import cargar_env, requerir_env, ejecutar_con_conexion, enviar_telegram, obtener_chats_gestores
from verificar_cadena import verificar_cadena
from verificar_pod import verificar_hash_pod

cargar_env()


def registrar_alerta_si_es_nueva(cur, tipo: str, entidad_id: str, motivo: str) -> bool:
    """Inserta la rotura en alerta_integridad. Devuelve True si es la PRIMERA
    vez que se ve esta rotura concreta (hay que alertar); False si ya se
    había alertado antes (no repetir)."""
    cur.execute(
        """
        INSERT INTO alerta_integridad (tipo, entidad_id, motivo)
        VALUES (%s, %s, %s)
        ON CONFLICT (tipo, entidad_id) DO NOTHING
        RETURNING id
        """,
        (tipo, entidad_id, motivo),
    )
    return cur.fetchone() is not None


def mensaje_rotura_cadena(rotura):
    return (
        f"🔴 INTEGRIDAD ROTA — cadena de ejecución. Viaje {rotura['viaje_id']}, "
        f"evento {rotura['evento_id']}: {rotura['motivo']}. Requiere investigación humana."
    )


def mensaje_rotura_pod(pod_id, motivo):
    return f"🔴 INTEGRIDAD ROTA — POD {pod_id}: {motivo}. Requiere investigación humana."


def revisar_integridad(cur_pg, sb, token, enviar_fn=enviar_telegram):
    """Ejecuta las dos verificaciones y alerta las roturas NUEVAS.
    `cur_pg`: cursor psycopg2 (RealDictCursor) para verificar_cadena y para
    registrar_alerta_si_es_nueva. `sb`: cliente supabase-py para verificar_pod.
    Devuelve un resumen para el CLI/tests."""
    resumen = {"cadena_ok": True, "pods_verificados": 0, "pods_rotos": 0, "alertas_nuevas": 0}

    resultado_cadena = verificar_cadena(cur_pg)
    resumen["cadena_ok"] = resultado_cadena["ok"]
    if not resultado_cadena["ok"]:
        rotura = resultado_cadena["rotura"]
        es_nueva = registrar_alerta_si_es_nueva(cur_pg, "cadena", rotura["evento_id"], rotura["motivo"])
        if es_nueva:
            for chat in obtener_chats_gestores(cur_pg):
                enviar_fn(token, chat, mensaje_rotura_cadena(rotura))
            resumen["alertas_nuevas"] += 1

    pods = sb.table("pod").select("id, foto_url, hash_sha256").execute().data or []
    resultados_pod = [verificar_hash_pod(sb, p) for p in pods]
    resumen["pods_verificados"] = len(pods)
    resumen["pods_rotos"] = len([r for r in resultados_pod if not r["ok"]])

    for r in resultados_pod:
        if r["ok"]:
            continue
        es_nueva = registrar_alerta_si_es_nueva(cur_pg, "pod", str(r["pod_id"]), r["motivo"])
        if es_nueva:
            for chat in obtener_chats_gestores(cur_pg):
                enviar_fn(token, chat, mensaje_rotura_pod(r["pod_id"], r["motivo"]))
            resumen["alertas_nuevas"] += 1

    return resumen


def main():
    database_url, token = requerir_env("DATABASE_URL", "TELEGRAM_BOT_TOKEN")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")

    sb = create_client(url, key)
    r = ejecutar_con_conexion(
        database_url,
        lambda cur: revisar_integridad(cur, sb, token),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )

    print(
        f"Cadena: {'OK' if r['cadena_ok'] else 'ROTA'}. "
        f"PODs: {r['pods_verificados']} verificados, {r['pods_rotos']} rotos. "
        f"Alertas nuevas enviadas: {r['alertas_nuevas']}."
    )
    if not r["cadena_ok"] or r["pods_rotos"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
