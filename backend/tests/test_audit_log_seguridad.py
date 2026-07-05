"""Test de regresión (auditoría de seguridad 2026-07-05): `audit_log` debe
ser APPEND-ONLY de verdad — tenía una única policy `FOR ALL` scoped solo por
empresa, sin restricción de operación ni de rol, así que CUALQUIER gestor
(incluido `solo_lectura`) podía hacer UPDATE/DELETE de filas de auditoría,
contradiciendo el propósito mismo de la tabla ("trazabilidad total").
Arreglado en 0037: solo SELECT + INSERT (ambas scoped por empresa), sin
policy de UPDATE/DELETE (RLS deniega esas operaciones por defecto), más el
trigger de `solo_lectura` añadido a la tabla.

Se salta si no hay DATABASE_URL en el entorno.
"""
import os
from pathlib import Path

import psycopg2
import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="requiere DATABASE_URL")


def _conectar():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def test_audit_log_no_tiene_policy_de_update_ni_delete():
    conn = _conectar()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT polcmd FROM pg_policy pol
                  JOIN pg_class c ON c.oid = pol.polrelid
                 WHERE c.relname = 'audit_log'
                """
            )
            comandos = {row[0] for row in cur.fetchall()}
    finally:
        conn.close()
    # 'w' = UPDATE, 'd' = DELETE, '*' = FOR ALL (cualquiera de estos reabriría el hueco)
    assert not (comandos & {"w", "d", "*"}), (
        f"audit_log tiene una policy de UPDATE/DELETE/FOR-ALL ({comandos}) -- "
        "deja de ser append-only, reabre el hallazgo de seguridad 2026-07-05"
    )
    assert "r" in comandos and "a" in comandos, "audit_log debería seguir permitiendo SELECT+INSERT scoped por empresa"


def test_audit_log_tiene_el_trigger_de_solo_lectura():
    conn = _conectar()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM pg_trigger WHERE tgrelid = 'audit_log'::regclass "
                "AND tgname = 'trg_solo_lectura_audit_log' AND NOT tgisinternal"
            )
            existe = cur.fetchone() is not None
    finally:
        conn.close()
    assert existe, "falta trg_solo_lectura_audit_log -- un gestor solo_lectura podría insertar en audit_log"
