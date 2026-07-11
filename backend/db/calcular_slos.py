"""Calcula los SLOs internos definidos en el ítem 9.19, a partir de datos que
YA existen en la BD real (`bot_heartbeat`, `audit_log`, `viaje.notificado_asignacion_en`)
— sin infraestructura nueva, tal como pide el ítem.

**SLO 1 — Disponibilidad del bot**: el bot no debe estar "sin señal" (hueco
entre latidos > `UMBRAL_HEARTBEAT_S=300s`, el MISMO umbral que ya usa
`dashboard/lib/data.js` en el ítem 8.3 para el aviso de "bot caído") más del
1% del tiempo en la ventana analizada. Objetivo: **disponibilidad ≥ 99%**.

**SLO 2 — Notificación de asignación**: desde que un gestor asigna un chófer
a un viaje (`audit_log.accion='asignar_chofer'`) hasta que el bot le notifica
por Telegram (`viaje.notificado_asignacion_en`), debería pasar menos de 60s
el 99% de las veces — mismo umbral usado como ejemplo en el propio ítem del
roadmap, coherente con que el job de notificación corre cada 30s
(`bot.py`, `procesar_notificaciones_asignacion`).

**SLO 3 — Latencia de respuesta del bot (<5s el 99% de las veces)**: **NO
calculable hoy**, y se dice así explícitamente en vez de fingir un número.
Necesitaría (a) instrumentar la duración de cada respuesta en los logs
estructurados del ítem 9.5 (no se hace todavía — los campos añadidos son de
contexto, no de tiempo) y (b) un destino de logs consultable — hoy van a
stdout sin persistir en ningún sitio, mismo hueco ya documentado en 9.5
("monitor externo... bloqueado por Gate A"). Se deja anotado, no simulado.

Uso:
    python backend/db/calcular_slos.py                  # ventana de 24h por defecto
    python backend/db/calcular_slos.py --horas 168       # ventana custom (p.ej. 1 semana)
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

UMBRAL_HEARTBEAT_S = 300       # mismo umbral que dashboard/lib/data.js (8.3)
OBJETIVO_NOTIFICACION_S = 60   # mismo umbral que el ejemplo del ítem 9.19


def slo_disponibilidad_bot(cur, horas: int) -> dict:
    """% de tiempo sin un hueco entre latidos mayor que UMBRAL_HEARTBEAT_S,
    en la ventana de las últimas `horas`. `cur.fetchall()` debe devolver filas
    de una sola columna (`created_at`) ya ordenadas ascendentemente."""
    cur.execute(
        """
        SELECT created_at FROM bot_heartbeat
         WHERE created_at > now() - (interval '1 hour' * %s)
         ORDER BY created_at
        """,
        (horas,),
    )
    latidos = [fila[0] for fila in cur.fetchall()]
    if len(latidos) < 2:
        return {"latidos": len(latidos), "disponibilidad_pct": None, "hueco_maximo_s": None}

    huecos = [(latidos[i + 1] - latidos[i]).total_seconds() for i in range(len(latidos) - 1)]
    ventana_total_s = (latidos[-1] - latidos[0]).total_seconds()
    tiempo_sin_senal = sum(h - UMBRAL_HEARTBEAT_S for h in huecos if h > UMBRAL_HEARTBEAT_S)
    disponibilidad_pct = (1 - tiempo_sin_senal / ventana_total_s) * 100 if ventana_total_s > 0 else None
    return {
        "latidos": len(latidos),
        "disponibilidad_pct": round(disponibilidad_pct, 2) if disponibilidad_pct is not None else None,
        "hueco_maximo_s": round(max(huecos), 1) if huecos else None,
    }


def slo_notificacion_asignacion(cur, horas: int) -> dict:
    """% de asignaciones notificadas dentro de OBJETIVO_NOTIFICACION_S, en la
    ventana de las últimas `horas`. `cur.fetchall()` debe devolver filas de
    una sola columna (`delta_s`, segundos entre asignar y notificar)."""
    cur.execute(
        """
        SELECT EXTRACT(EPOCH FROM (v.notificado_asignacion_en - a.created_at)) AS delta_s
          FROM audit_log a
          JOIN viaje v ON v.id = a.entidad_id
         WHERE a.entidad = 'viaje' AND a.accion = 'asignar_chofer'
           AND v.notificado_asignacion_en IS NOT NULL
           AND v.notificado_asignacion_en > a.created_at
           AND a.created_at > now() - (interval '1 hour' * %s)
        """,
        (horas,),
    )
    deltas = sorted(fila[0] for fila in cur.fetchall() if fila[0] is not None and fila[0] >= 0)
    if not deltas:
        return {"asignaciones": 0, "pct_dentro_objetivo": None, "p95_s": None}
    dentro = sum(1 for d in deltas if d <= OBJETIVO_NOTIFICACION_S)
    p95 = deltas[int(len(deltas) * 0.95)] if deltas else None
    return {
        "asignaciones": len(deltas),
        "pct_dentro_objetivo": round(dentro / len(deltas) * 100, 1),
        "p95_s": round(p95, 1) if p95 is not None else None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--horas", type=int, default=24)
    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: falta DATABASE_URL en el entorno.", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    try:
        with conn.cursor() as cur:
            slo1 = slo_disponibilidad_bot(cur, args.horas)
        with conn.cursor() as cur:
            slo2 = slo_notificacion_asignacion(cur, args.horas)
    finally:
        conn.close()

    print(f"Ventana analizada: últimas {args.horas}h\n")

    print("SLO 1 — Disponibilidad del bot (objetivo: >= 99%)")
    print(f"  latidos registrados: {slo1['latidos']}")
    if slo1["disponibilidad_pct"] is not None:
        print(f"  disponibilidad: {slo1['disponibilidad_pct']}%")
        print(f"  hueco máximo entre latidos: {slo1['hueco_maximo_s']}s")
    else:
        print("  sin datos suficientes (menos de 2 latidos en la ventana)")
    print()

    print(f"SLO 2 — Notificación de asignación en <{OBJETIVO_NOTIFICACION_S}s (objetivo: >= 99%)")
    print(f"  asignaciones medidas: {slo2['asignaciones']}")
    if slo2["pct_dentro_objetivo"] is not None:
        print(f"  % dentro del objetivo: {slo2['pct_dentro_objetivo']}%")
        print(f"  p95: {slo2['p95_s']}s")
    else:
        print("  sin asignaciones en la ventana")
    print()

    print("SLO 3 — Latencia de respuesta del bot <5s el 99% de las veces: NO calculable hoy")
    print("  (falta instrumentar duración en los logs estructurados de 9.5 + un destino de")
    print("   logs consultable — mismo hueco ya documentado ahí, bloqueado por Gate A)")


if __name__ == "__main__":
    main()
