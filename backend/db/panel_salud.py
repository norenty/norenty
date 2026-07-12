"""Pantalla de salud del sistema (ítem 10.7) — junta en un solo reporte los
SLOs internos (9.19), el estado del heartbeat (8.3/10.5) y las últimas
alertas de integridad (10.6), para que el OPERADOR (quien opera la
plataforma, no un gestor de una empresa cliente) vea todo de un vistazo.

**Decisión de diseño (por qué es un script y NO una página del dashboard
multi-tenant)**: `bot_heartbeat`/`alerta_bot_caido`/`alerta_integridad` son
estado GLOBAL de la plataforma (un único bot sirve a todas las empresas), no
datos de una empresa concreta. Hoy no existe un rol "admin de plataforma"
distinto del rol "admin de empresa" (ver `0032_roles_gestor.sql` — los roles
son intra-empresa: admin/gestor_operativo/solo_lectura). Meter esto en el
dashboard filtrado por tenant sería, en el mejor caso, mostrarle a un cliente
el estado de integridad de OTRO cliente (fuga entre tenants); construir un rol
de plataforma nuevo hoy sería especulativo (nadie lo necesita todavía, un
solo operador = tú). Por eso sigue el mismo patrón que
`calcular_slos.py`/`monitor_heartbeat.py`/`monitor_integridad.py`: herramienta
de operador vía `DATABASE_URL`, fuera de RLS.

Uso:
    python backend/db/panel_salud.py                 # ventana de 24h por defecto
    python backend/db/panel_salud.py --horas 168      # ventana custom
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
from calcular_slos import slo_disponibilidad_bot, slo_notificacion_asignacion, OBJETIVO_NOTIFICACION_S
from monitor_heartbeat import obtener_estado_heartbeat, UMBRAL_HEARTBEAT_S


def alertas_integridad_recientes(cur, limite: int = 10):
    """cur debe ser un cursor NORMAL (no RealDict): calcular_slos.py y
    monitor_heartbeat.py, que este módulo reutiliza, esperan tuplas por
    posición, no dicts. Se construyen los dicts aquí a mano."""
    cur.execute(
        "SELECT tipo, entidad_id, motivo, detectada_en FROM alerta_integridad "
        "ORDER BY detectada_en DESC LIMIT %s",
        (limite,),
    )
    return [
        {"tipo": f[0], "entidad_id": f[1], "motivo": f[2], "detectada_en": f[3]}
        for f in cur.fetchall()
    ]


def alertas_bot_recientes(cur, limite: int = 10):
    cur.execute(
        "SELECT enviada_en, resuelta_en FROM alerta_bot_caido "
        "ORDER BY enviada_en DESC LIMIT %s",
        (limite,),
    )
    return [{"enviada_en": f[0], "resuelta_en": f[1]} for f in cur.fetchall()]


def generar_panel(cur, horas: int = 24):
    """Junta todas las señales en un único dict. `cur` debe ser un cursor
    NORMAL (tuplas por posición) -- calcular_slos.py/monitor_heartbeat.py lo
    esperan así; alertas_integridad_recientes/alertas_bot_recientes
    construyen sus propios dicts a partir de tuplas."""
    heartbeat_caido, segundos_heartbeat = obtener_estado_heartbeat(cur)
    return {
        "horas": horas,
        "heartbeat": {"caido": heartbeat_caido, "segundos_desde_ultimo": segundos_heartbeat},
        "slo_disponibilidad": slo_disponibilidad_bot(cur, horas),
        "slo_notificacion": slo_notificacion_asignacion(cur, horas),
        "integridad_reciente": alertas_integridad_recientes(cur),
        "alertas_bot_recientes": alertas_bot_recientes(cur),
    }


def imprimir_panel(p):
    print(f"=== Panel de salud del sistema (ventana {p['horas']}h) ===\n")

    print("Heartbeat del bot")
    if p["heartbeat"]["caido"]:
        seg = p["heartbeat"]["segundos_desde_ultimo"]
        detalle = f"hace {round(seg / 60)} min" if seg is not None else "nunca registrado"
        print(f"  🔴 CAÍDO ({detalle}, umbral {UMBRAL_HEARTBEAT_S}s)")
    else:
        print(f"  🟢 activo (último latido hace {round(p['heartbeat']['segundos_desde_ultimo'])}s)")

    slo1 = p["slo_disponibilidad"]
    print("\nSLO 1 — Disponibilidad del bot (objetivo >= 99%)")
    if slo1["disponibilidad_pct"] is not None:
        print(f"  {slo1['disponibilidad_pct']}% ({slo1['latidos']} latidos)")
    else:
        print(f"  sin datos suficientes ({slo1['latidos']} latidos)")

    slo2 = p["slo_notificacion"]
    print(f"\nSLO 2 — Notificación de asignación en <{OBJETIVO_NOTIFICACION_S}s (objetivo >= 99%)")
    if slo2["pct_dentro_objetivo"] is not None:
        print(f"  {slo2['pct_dentro_objetivo']}% dentro del objetivo, p95={slo2['p95_s']}s ({slo2['asignaciones']} asignaciones)")
    else:
        print("  sin asignaciones en la ventana")

    print("\nIntegridad — últimas alertas (nunca se auto-resuelven, requieren revisión humana)")
    if not p["integridad_reciente"]:
        print("  sin roturas registradas")
    else:
        for a in p["integridad_reciente"]:
            print(f"  🔴 [{a['tipo']}] {a['entidad_id']}: {a['motivo']} (detectada {a['detectada_en']})")

    print("\nAlertas de bot caído — últimos episodios")
    if not p["alertas_bot_recientes"]:
        print("  sin episodios registrados")
    else:
        for a in p["alertas_bot_recientes"]:
            estado = "resuelto" if a["resuelta_en"] else "ABIERTO"
            print(f"  {estado}: enviada {a['enviada_en']}" + (f", resuelta {a['resuelta_en']}" if a["resuelta_en"] else ""))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--horas", type=int, default=24)
    args = parser.parse_args()

    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: falta DATABASE_URL en el entorno.", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    try:
        with conn.cursor() as cur:
            panel = generar_panel(cur, args.horas)
    finally:
        conn.close()

    imprimir_panel(panel)


if __name__ == "__main__":
    main()
