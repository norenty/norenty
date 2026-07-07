"""Tests del ítem 9.36: `migrate.py --check` debe FALLAR ante un checksum
inesperado en una migración ya aplicada, distinguiéndolo del drift conocido
y benigno de 0002-0011 (aplicadas a mano por MCP antes de que existiera el
runner). Grupo A: pura lógica, ninguna conexión a BD real.
"""
from db.migrate import ALLOWLIST_DRIFT_CONOCIDO, clasificar_migraciones


def test_migracion_no_aplicada_queda_pendiente():
    pending, drift = clasificar_migraciones([("0041_nueva.sql", "CREATE TABLE x();")], applied={})
    assert [n for n, _, _ in pending] == ["0041_nueva.sql"]
    assert drift == []


def test_migracion_aplicada_con_checksum_igual_no_es_pendiente_ni_drift():
    sql = "CREATE TABLE x();"
    checksum = __import__("hashlib").sha256(sql.encode("utf-8")).hexdigest()
    pending, drift = clasificar_migraciones([("0041_nueva.sql", sql)], applied={"0041_nueva.sql": checksum})
    assert pending == []
    assert drift == []


def test_checksum_distinto_en_allowlist_no_cuenta_como_drift_inesperado():
    nombre = next(iter(ALLOWLIST_DRIFT_CONOCIDO))
    pending, drift = clasificar_migraciones(
        [(nombre, "CREATE TABLE x();")],
        applied={nombre: "checksum-distinto-registrado-hace-tiempo"},
    )
    assert pending == []
    assert drift == []


def test_checksum_distinto_fuera_de_la_allowlist_es_drift_inesperado():
    nombre = "0041_nueva.sql"
    assert nombre not in ALLOWLIST_DRIFT_CONOCIDO
    pending, drift = clasificar_migraciones(
        [(nombre, "CREATE TABLE x();")],
        applied={nombre: "checksum-registrado-que-ya-no-coincide"},
    )
    assert pending == []
    assert drift == [nombre]


def test_mezcla_pendientes_y_drift_inesperado_a_la_vez():
    pending, drift = clasificar_migraciones(
        [
            ("0041_nueva.sql", "CREATE TABLE x();"),  # pendiente
            ("0042_hackeada.sql", "DROP TABLE y;"),   # drift inesperado
        ],
        applied={"0042_hackeada.sql": "checksum-viejo"},
    )
    assert [n for n, _, _ in pending] == ["0041_nueva.sql"]
    assert drift == ["0042_hackeada.sql"]
