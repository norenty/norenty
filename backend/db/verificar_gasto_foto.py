"""Verificación bajo demanda de la integridad de la foto de un gasto de viaje
(12.1, 0043_gasto_foto.sql) — mismo principio de evidencia que verificar_pod.py
(9.8) y verificar_incidencia_foto.py: la foto de un gasto (ticket de gasolina,
peaje, multa) es evidencia igual que un POD, y hasta ahora no tenía su propio
verificador de integridad.

El dashboard calcula el SHA-256 de la foto en el navegador (Web Crypto,
`crypto.subtle.digest`) antes de subirla y lo guarda en gasto_viaje.foto_hash_sha256.
Este script descarga el fichero REAL desde Storage (bucket "documentos",
reutilizado por 0043 — el gasto no tiene bucket propio, ruta
{empresa_id}/gasto/{viaje_id}/...) y recalcula su hash, comparándolo con el
guardado — detecta si el fichero en Storage se ha sustituido o alterado desde
que se subió.

LIMITACIÓN HONESTA: mismo cliente/permisos que verificar_pod.py/verificar_incidencia_foto.py
(SUPABASE_SERVICE_ROLE_KEY con fallback a SUPABASE_ANON_KEY). Sin la service
role key ni una sesión de gestor autenticada, la descarga fallará por permisos
(bucket "documentos" con RLS por empresa, ver migración 0012).

No todos los gastos tienen foto (foto_url/foto_hash_sha256 son nullable, la
mayoría de gastos seguirán sin foto): los gastos sin foto se omiten, no se
cuentan como rotos.

Uso:
    python backend/db/verificar_gasto_foto.py <gasto_id>
    python backend/db/verificar_gasto_foto.py --todos
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


def verificar_hash_gasto(sb, gasto: dict) -> dict:
    """Descarga el fichero real de Storage (bucket "documentos") y compara su
    hash con el guardado. `gasto` es un dict con al menos {id, foto_url, foto_hash_sha256}.
    Devuelve {'gasto_id', 'ok': bool, 'motivo': None|'archivo_no_encontrado'|'hash_no_coincide'}.
    NUNCA escribe nada: es de solo-lectura, igual que verificar_pod.py.
    """
    try:
        datos = sb.storage.from_("documentos").download(gasto["foto_url"])
    except Exception as exc:
        return {"gasto_id": gasto["id"], "ok": False, "motivo": f"archivo_no_encontrado: {exc}"}

    hash_real = calcular_hash_sha256(bytes(datos))
    if hash_real != gasto["foto_hash_sha256"]:
        return {"gasto_id": gasto["id"], "ok": False, "motivo": "hash_no_coincide"}
    return {"gasto_id": gasto["id"], "ok": True, "motivo": None}


def main():
    sb = _cliente()

    if "--todos" in sys.argv:
        gastos = (
            sb.table("gasto_viaje")
            .select("id, foto_url, foto_hash_sha256")
            .not_.is_("foto_url", "null")
            .execute()
            .data
            or []
        )
        if not gastos:
            print("No hay gastos con foto que verificar.")
            sys.exit(0)
    else:
        if len(sys.argv) < 2:
            print("Uso: python backend/db/verificar_gasto_foto.py <gasto_id> | --todos", file=sys.stderr)
            sys.exit(1)
        gasto_id = sys.argv[1]
        r = (
            sb.table("gasto_viaje")
            .select("id, foto_url, foto_hash_sha256")
            .eq("id", gasto_id)
            .execute()
        )
        gastos = r.data or []
        if not gastos:
            print(f"ERROR: no existe el gasto {gasto_id} (o RLS no lo deja ver).", file=sys.stderr)
            sys.exit(1)
        if gastos[0]["foto_url"] is None:
            print(f"El gasto {gasto_id} no tiene foto adjunta. Nada que verificar.")
            sys.exit(0)

    rotos = [verificar_hash_gasto(sb, g) for g in gastos]
    rotos = [r for r in rotos if not r["ok"]]
    for r in rotos:
        print(f"ROTO: gasto {r['gasto_id']}: {r['motivo']}", file=sys.stderr)

    if rotos:
        print(f"{len(rotos)}/{len(gastos)} gasto(s) con foto con integridad rota.", file=sys.stderr)
        sys.exit(1)

    print(f"Integridad OK: {len(gastos)} foto(s) de gasto verificadas.")
    sys.exit(0)


if __name__ == "__main__":
    main()
