"""Tests de la cola de trabajos (ítem 9.18, spec en SPECS-9.md "Bloque colas").

Grupo A (este archivo): lógica pura en Python — enrutado de `procesar_uno`,
la fórmula de backoff (espejo de la que corre de verdad en SQL dentro de
`marcar_fallido`, igual criterio que `verificar_cadena.py` con el hash-chain),
y `enqueue` contra `FakeSupabase`. NO prueba el claim/locking ni la
concurrencia real — eso depende del motor Postgres (`FOR UPDATE SKIP
LOCKED`) y se verifica a mano contra la BD real (Grupo B, documentado en
PROGRESS.md), nunca fingido aquí.
"""
import pytest

from app import cola, db
from tests.fakes import FakeSupabase


def _calcular_backoff_segundos(intentos: int) -> int:
    """Espejo EXACTO de la fórmula SQL de marcar_fallido (backoff exponencial
    base 2, unidad 60s) — si esto y el SQL alguna vez divergen, es un bug."""
    return 60 * (2 ** (intentos - 1))


@pytest.fixture
def fake_db(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(db, "supabase", fake)
    return fake


class TestProcesarUno:
    def test_handler_registrado_devuelve_ok(self):
        cola.registrar_handler("test_ok", lambda payload: None)
        ok, error = cola.procesar_uno({"kind": "test_ok", "payload": {}})
        assert ok is True
        assert error is None

    def test_kind_sin_handler_devuelve_error_claro(self):
        ok, error = cola.procesar_uno({"kind": "kind_que_no_existe_nunca", "payload": {}})
        assert ok is False
        assert error == "kind desconocido: kind_que_no_existe_nunca"

    def test_handler_que_lanza_devuelve_el_mensaje_de_la_excepcion(self):
        def handler_roto(payload):
            raise ValueError("x")

        cola.registrar_handler("test_roto", handler_roto)
        ok, error = cola.procesar_uno({"kind": "test_roto", "payload": {}})
        assert ok is False
        assert error == "x"

    def test_noop_ya_esta_registrado_y_no_hace_nada(self):
        ok, error = cola.procesar_uno({"kind": "noop", "payload": {"cualquier": "cosa"}})
        assert ok is True
        assert error is None

    def test_validar_pod_es_un_stub_que_falla_con_mensaje_claro(self):
        ok, error = cola.procesar_uno({"kind": "validar_pod", "payload": {}})
        assert ok is False
        assert "D3/7B" in error


class TestBackoff:
    @pytest.mark.parametrize("intentos,esperado", [(1, 60), (2, 120), (3, 240), (4, 480)])
    def test_formula_exponencial_base_2_unidad_60s(self, intentos, esperado):
        assert _calcular_backoff_segundos(intentos) == esperado


class TestEnqueue:
    def test_inserta_kind_payload_y_max_intentos(self, fake_db):
        cola.enqueue("noop", {"a": 1}, max_intentos=3)
        assert len(fake_db.tables["cola_trabajo"]) == 1
        fila = fake_db.tables["cola_trabajo"][0]
        assert fila["kind"] == "noop"
        assert fila["payload"] == {"a": 1}
        assert fila["max_intentos"] == 3

    def test_empresa_id_solo_se_incluye_si_se_pasa(self, fake_db):
        cola.enqueue("noop", {})
        assert "empresa_id" not in fake_db.tables["cola_trabajo"][0]

        cola.enqueue("noop", {}, empresa_id="e1")
        assert fake_db.tables["cola_trabajo"][1]["empresa_id"] == "e1"

    def test_max_intentos_por_defecto_es_5(self, fake_db):
        cola.enqueue("noop", {})
        assert fake_db.tables["cola_trabajo"][0]["max_intentos"] == 5
