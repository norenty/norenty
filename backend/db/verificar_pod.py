"""Verificación bajo demanda de la integridad de un POD (ítem 9.8, misma
filosofía de evidencia que el hash-chain de ejecucion_evento, 9.6/9.7).

El bot calcula el SHA-256 de la foto en el momento de subirla (backend/app/bot.py,
handle_photo) y lo guarda en pod.hash_sha256. Este script descarga el fichero
REAL desde Storage y recalcula su hash, comparándolo con el guardado — detecta
si el fichero en Storage se ha sustituido o alterado desde que se subió.

LIMITACIÓN HONESTA: usa el mismo cliente que el bot (SUPABASE_SERVICE_ROLE_KEY
con fallback a SUPABASE_ANON_KEY, mismo patrón que backend/app/db.py). Sin la
service role key (D1, sigue pendiente) NI una sesión de gestor autenticada, la
descarga fallará por permisos (el bucket "pods" solo permite SELECT a
`authenticated`/`service_role`, con RLS por empresa — ver migración 0011).

Uso:
    python backend/db/verificar_pod.py <pod_id>
    python backend/db/verificar_pod.py --todos
"""
import hashlib
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent.parent.parent / ".env")
# Seguridad (2026-07-08): secretos reales en ~/.norenty-secrets/.env, fuera del
# repo (ver RUNBOOK-SECRETS.md). override=True: gana sobre el .env del repo.
load_dotenv(Path.home() / ".norenty-secrets" / ".env", override=True)


def _cliente():
    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_ANON_KEY"]
    return create_client(url, key)


def calcular_hash_sha256(datos: bytes) -> str:
    return hashlib.sha256(datos).hexdigest()


def verificar_hash_pod(sb, pod: dict) -> dict:
    """Descarga el fichero real de Storage y compara su hash con el guardado.
    `pod` es un dict con al menos {id, foto_url, hash_sha256}.
    Devuelve {'pod_id', 'ok': bool, 'motivo': None|'archivo_no_encontrado'|'hash_no_coincide'}.
    NUNCA escribe nada: es de solo-lectura, igual que verificar_cadena.py.
    """
    try:
        datos = sb.storage.from_("pods").download(pod["foto_url"])
    except Exception as exc:
        return {"pod_id": pod["id"], "ok": False, "motivo": f"archivo_no_encontrado: {exc}"}

    hash_real = calcular_hash_sha256(bytes(datos))
    if hash_real != pod["hash_sha256"]:
        return {"pod_id": pod["id"], "ok": False, "motivo": "hash_no_coincide"}
    return {"pod_id": pod["id"], "ok": True, "motivo": None}


def main():
    sb = _cliente()

    if "--todos" in sys.argv:
        pods = sb.table("pod").select("id, foto_url, hash_sha256").execute().data or []
        if not pods:
            print("No hay PODs que verificar.")
            sys.exit(0)
    else:
        if len(sys.argv) < 2:
            print("Uso: python backend/db/verificar_pod.py <pod_id> | --todos", file=sys.stderr)
            sys.exit(1)
        pod_id = sys.argv[1]
        r = sb.table("pod").select("id, foto_url, hash_sha256").eq("id", pod_id).execute()
        pods = r.data or []
        if not pods:
            print(f"ERROR: no existe el pod {pod_id} (o RLS no lo deja ver).", file=sys.stderr)
            sys.exit(1)

    rotos = [verificar_hash_pod(sb, pod) for pod in pods]
    rotos = [r for r in rotos if not r["ok"]]
    for r in rotos:
        print(f"ROTO: pod {r['pod_id']}: {r['motivo']}", file=sys.stderr)

    if rotos:
        print(f"{len(rotos)}/{len(pods)} POD con integridad rota.", file=sys.stderr)
        sys.exit(1)

    print(f"Integridad OK: {len(pods)} POD verificados.")
    sys.exit(0)


if __name__ == "__main__":
    main()
