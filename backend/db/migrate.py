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

# Ítem 9.36: 0002-0011 se aplicaron a mano por MCP antes de que existiera este runner
# (checksum registrado en su momento con el SQL tal como se aplicó entonces). Un drift
# de checksum en CUALQUIER OTRO archivo es una señal real de hand-edit accidental de una
# migración ya aplicada -- eso debe FALLAR (exit 1), no quedarse en un aviso cosmético
# indistinguible de este caso conocido y benigno.
ALLOWLIST_DRIFT_CONOCIDO = {
    "0002_valoracion_y_pod.sql",
    "0003_vehiculos_plantillas_ubicacion.sql",
    "0004_realtime.sql",
    "0005_constraints_negocio.sql",
    "0006_gestor_telegram_alertas.sql",
    "0007_preferencias_notificacion.sql",
    "0008_rls_endurecido.sql",
    "0009_tenancy_multiempresa.sql",
    "0010_mantenimiento_vehiculo.sql",
    "0011_bucket_pods_privado.sql",
}


def _checksum(sql: str) -> str:
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()


def clasificar_migraciones(files_sql, applied):
    """Lógica pura (ítem 9.36, testeable sin BD real): dado `files_sql`
    (lista de tuplas (nombre, sql)) y `applied` (dict nombre->checksum
    registrado en `schema_migrations`), devuelve `(pending, drift_inesperado)`.

    `pending`: lista de (nombre, sql, checksum) aún no aplicadas.
    `drift_inesperado`: nombres cuyo checksum registrado no coincide con el
    contenido local Y que NO están en `ALLOWLIST_DRIFT_CONOCIDO` -- señal real
    de que una migración ya aplicada se editó a mano por error.
    """
    pending = []
    drift_inesperado = []
    for nombre, sql in files_sql:
        checksum = _checksum(sql)
        if nombre in applied:
            if applied[nombre] != checksum and nombre not in ALLOWLIST_DRIFT_CONOCIDO:
                drift_inesperado.append(nombre)
            continue
        pending.append((nombre, sql, checksum))
    return pending, drift_inesperado


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

        files_sql = [(f.name, f.read_text(encoding="utf-8")) for f in files]
        pending, drift_inesperado = clasificar_migraciones(files_sql, applied)

        for nombre, sql in files_sql:
            if nombre in applied and applied[nombre] != _checksum(sql) and nombre in ALLOWLIST_DRIFT_CONOCIDO:
                print(f"AVISO (conocido, benigno): {nombre} ya aplicada pero el contenido "
                      f"local difiere del checksum registrado (backfill previo al runner).")

        print(f"Migraciones aplicadas: {len(applied)} | pendientes: {len(pending)}")
        for nombre, _, _ in pending:
            print(f"  pendiente: {nombre}")

        if drift_inesperado:
            print("ERROR: checksum inesperado en migraciones ya aplicadas (posible hand-edit "
                  "accidental de un archivo que ya se ejecutó contra la BD):")
            for nombre in drift_inesperado:
                print(f"  {nombre}")
            sys.exit(1)

        if check_only or not pending:
            return

        for nombre, sql, checksum in pending:
            print(f"Aplicando {nombre} ...")
            with conn.cursor() as cur:
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO schema_migrations (filename, checksum) VALUES (%s, %s)",
                    (nombre, checksum),
                )
            conn.commit()
            print(f"  OK: {nombre}")

        print("Migraciones al día.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
