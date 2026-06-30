"""Runner de migraciones SQL: aplica backend/db/migrations/*.sql en orden,
una sola vez cada una, de forma reproducible (sustituye a aplicar por MCP ad-hoc).

Requiere DATABASE_URL (connection string de Postgres de Supabase, con
contraseña: Project Settings > Database > Connection string > URI).

Uso:
    python backend/db/migrate.py          # aplica las migraciones pendientes
    python backend/db/migrate.py --check  # solo lista estado, no aplica nada
"""
import hashlib
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

load_dotenv(Path(__file__).parent.parent.parent / ".env")


def _checksum(sql: str) -> str:
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()


def _ensure_tracking_table(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename    text PRIMARY KEY,
            checksum    text NOT NULL,
            applied_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def main():
    check_only = "--check" in sys.argv

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: falta DATABASE_URL en el entorno (.env o variable de entorno).")
        sys.exit(1)

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print("No hay archivos de migración en backend/db/migrations/.")
        return

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            _ensure_tracking_table(cur)
            conn.commit()

            cur.execute("SELECT filename, checksum FROM schema_migrations")
            applied = dict(cur.fetchall())

        pending = []
        for f in files:
            sql = f.read_text(encoding="utf-8")
            checksum = _checksum(sql)
            if f.name in applied:
                if applied[f.name] != checksum:
                    print(f"AVISO: {f.name} ya aplicada pero el contenido local difiere del checksum registrado.")
                continue
            pending.append((f, sql, checksum))

        print(f"Migraciones aplicadas: {len(applied)} | pendientes: {len(pending)}")
        for f, _, _ in pending:
            print(f"  pendiente: {f.name}")

        if check_only or not pending:
            return

        for f, sql, checksum in pending:
            print(f"Aplicando {f.name} ...")
            with conn.cursor() as cur:
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO schema_migrations (filename, checksum) VALUES (%s, %s)",
                    (f.name, checksum),
                )
            conn.commit()
            print(f"  OK: {f.name}")

        print("Migraciones al día.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
