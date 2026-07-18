"""Verificación bajo demanda de la integridad de la foto de una incidencia
(F14.6, 0057_incidencia_foto.sql) — mismo principio de evidencia que
verificar_pod.py (9.8): la foto de una incidencia (carga mal estibada, daño,
control de carretera) es evidencia igual que un POD, y hoy no tenía su propio
verificador.

El bot calcula el SHA-256 de la foto en el momento de subirla (mismo patrón
hash-antes-de-subir de handle_photo) y lo guarda en incidencia.foto_hash_sha256.
Este script descarga el fichero REAL desde Storage (bucket "pods", reutilizado
por 0057 — la incidencia no tiene bucket propio) y recalcula su hash,
comparándolo con el guardado — detecta si el fichero en Storage se ha
sustituido o alterado desde que se subió.

LIMITACIÓN HONESTA: mismo cliente/permisos que verificar_pod.py (SUPABASE_SERVICE_ROLE_KEY
con fallback a SUPABASE_ANON_KEY). Sin la service role key ni una sesión de
gestor autenticada, la descarga fallará por permisos (bucket "pods" con RLS
por empresa, ver migración 0011).

No todas las incidencias tienen foto (foto_url/foto_hash_sha256 son nullable,
F14.6 es opcional): las incidencias sin foto se omiten, no se cuentan como
rotas.

Uso:
    python backend/db/verificar_incidencia_foto.py <incidencia_id>
    python backend/db/verificar_incidencia_foto.py --todos
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from db.verificar_pod import calcular_hash_sha256

load_dotenv(Path(__file__).parent.parent.parent / ".env")
# Seguridad (2026-07-08): secretos reales en ~/.norenty-secrets/.env, fuera del
# repo (ver RUNBOOK-SECRETS.md). override=True: gana sobre el .env del repo.
load_dotenv(Path.home() / ".norenty-secrets" / ".env", override=True)


def _cliente():
    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_ANON_KEY"]
    return create_client(url, key)


def verificar_hash_incidencia(sb, incidencia: dict) -> dict:
    """Descarga el fichero real de Storage (bucket "pods") y compara su hash con
    el guardado. `incidencia` es un dict con al menos {id, foto_url, foto_hash_sha256}.
    Devuelve {'incidencia_id', 'ok': bool, 'motivo': None|'archivo_no_encontrado'|'hash_no_coincide'}.
    NUNCA escribe nada: es de solo-lectura, igual que verificar_pod.py.
    """
    try:
        datos = sb.storage.from_("pods").download(incidencia["foto_url"])
    except Exception as exc:
        return {"incidencia_id": incidencia["id"], "ok": False, "motivo": f"archivo_no_encontrado: {exc}"}

    hash_real = calcular_hash_sha256(bytes(datos))
    if hash_real != incidencia["foto_hash_sha256"]:
        return {"incidencia_id": incidencia["id"], "ok": False, "motivo": "hash_no_coincide"}
    return {"incidencia_id": incidencia["id"], "ok": True, "motivo": None}


def main():
    sb = _cliente()

    if "--todos" in sys.argv:
        incidencias = (
            sb.table("incidencia")
            .select("id, foto_url, foto_hash_sha256")
            .not_.is_("foto_url", "null")
            .execute()
            .data
            or []
        )
        if not incidencias:
            print("No hay incidencias con foto que verificar.")
            sys.exit(0)
    else:
        if len(sys.argv) < 2:
            print("Uso: python backend/db/verificar_incidencia_foto.py <incidencia_id> | --todos", file=sys.stderr)
            sys.exit(1)
        incidencia_id = sys.argv[1]
        r = (
            sb.table("incidencia")
            .select("id, foto_url, foto_hash_sha256")
            .eq("id", incidencia_id)
            .execute()
        )
        incidencias = r.data or []
        if not incidencias:
            print(f"ERROR: no existe la incidencia {incidencia_id} (o RLS no la deja ver).", file=sys.stderr)
            sys.exit(1)
        if incidencias[0]["foto_url"] is None:
            print(f"La incidencia {incidencia_id} no tiene foto adjunta. Nada que verificar.")
            sys.exit(0)

    rotos = [verificar_hash_incidencia(sb, inc) for inc in incidencias]
    rotos = [r for r in rotos if not r["ok"]]
    for r in rotos:
        print(f"ROTO: incidencia {r['incidencia_id']}: {r['motivo']}", file=sys.stderr)

    if rotos:
        print(f"{len(rotos)}/{len(incidencias)} incidencia(s) con foto con integridad rota.", file=sys.stderr)
        sys.exit(1)

    print(f"Integridad OK: {len(incidencias)} foto(s) de incidencia verificadas.")
    sys.exit(0)


if __name__ == "__main__":
    main()
