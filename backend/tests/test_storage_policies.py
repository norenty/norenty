"""Test de regresión (auditoría de seguridad 2026-07-05): el bucket "pods" de
Storage tuvo una policy de SELECT abierta a CUALQUIER `authenticated` (0008)
que sobrevivió sin querer a la migración 0011 (que añadió el scope real por
empresa) — Postgres combina policies permisivas del mismo comando con OR, así
que la policy abierta anulaba por completo el aislamiento multi-tenant de las
fotos de POD (albaranes, firmas). Arreglado en 0036 (DROP de la policy
abierta). Este test evita que alguien reintroduzca, aquí o en `documentos`,
una policy de SELECT sobre Storage sin scope de empresa.

Se salta si no hay DATABASE_URL en el entorno (mismo criterio que los demás
scripts de `backend/db/`).
"""
import os
from pathlib import Path

import psycopg2
import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="requiere DATABASE_URL")

BUCKETS_PRIVADOS = ["pods", "documentos"]


def _policies_select_bucket(bucket: str):
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
                  FROM pg_policy pol
                  JOIN pg_class c ON c.oid = pol.polrelid
                 WHERE c.relname = 'objects' AND c.relnamespace = 'storage'::regnamespace
                   AND polcmd = 'r'
                   AND pg_get_expr(polqual, polrelid) ILIKE %s
                """,
                (f"%{bucket}%",),
            )
            return cur.fetchall()
    finally:
        conn.close()


@pytest.mark.parametrize("bucket", BUCKETS_PRIVADOS)
def test_bucket_privado_no_tiene_policy_select_sin_scope_de_empresa(bucket):
    policies = _policies_select_bucket(bucket)
    assert policies, f"no se encontró ninguna policy de SELECT sobre el bucket '{bucket}' -- inesperado"
    for nombre, using_expr in policies:
        assert "current_empresa_id" in (using_expr or ""), (
            f"policy '{nombre}' de SELECT sobre '{bucket}' NO filtra por empresa "
            f"(using: {using_expr}) -- reintroduce la fuga cross-tenant del hallazgo de seguridad 2026-07-05"
        )
