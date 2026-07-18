"""Tests del módulo compartido de los 4 monitores standalone (monitor_common.py,
2026-07-18) -- extraído tras detectar, vía un grafo de conocimiento del repo (graphify),
que monitor_heartbeat.py/monitor_retraso_silencioso.py/monitor_checkpoint_saltado.py/
monitor_integridad.py copiaban el mismo andamiaje (carga de .env, comprobación de
variables de entorno, conexión/commit/rollback/close de psycopg2, POST a Telegram) por
separado en cada uno.
"""
import pytest

from db.monitor_common import requerir_env, ejecutar_con_conexion


class TestRequerirEnv:
    def test_una_variable_presente_devuelve_su_valor(self, monkeypatch):
        monkeypatch.setenv("FOO", "bar")
        assert requerir_env("FOO") == "bar"

    def test_varias_variables_presentes_devuelve_tupla_en_orden(self, monkeypatch):
        monkeypatch.setenv("FOO", "1")
        monkeypatch.setenv("BAR", "2")
        assert requerir_env("FOO", "BAR") == ("1", "2")

    def test_variable_faltante_termina_con_exit_1(self, monkeypatch, capsys):
        monkeypatch.delenv("FALTA_ESTA", raising=False)
        with pytest.raises(SystemExit) as exc:
            requerir_env("FALTA_ESTA")
        assert exc.value.code == 1
        assert "FALTA_ESTA" in capsys.readouterr().err

    def test_una_de_varias_faltante_reporta_solo_la_que_falta(self, monkeypatch, capsys):
        monkeypatch.setenv("PRESENTE", "x")
        monkeypatch.delenv("AUSENTE", raising=False)
        with pytest.raises(SystemExit):
            requerir_env("PRESENTE", "AUSENTE")
        err = capsys.readouterr().err
        assert "AUSENTE" in err
        assert "PRESENTE" not in err


class FakeConn:
    def __init__(self):
        self.committed = False
        self.rolled_back = False
        self.closed = False
        self.autocommit = None

    def cursor(self, cursor_factory=None):
        self.cursor_factory_usado = cursor_factory
        return FakeCursorCtx()

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class FakeCursorCtx:
    def __enter__(self):
        return "el-cursor-fake"

    def __exit__(self, *a):
        return False


class TestEjecutarConConexion:
    def test_exito_hace_commit_y_cierra(self, monkeypatch):
        fake_conn = FakeConn()
        monkeypatch.setattr("db.monitor_common.psycopg2.connect", lambda url: fake_conn)

        resultado = ejecutar_con_conexion("postgres://fake", lambda cur: cur.upper())

        assert resultado == "EL-CURSOR-FAKE"
        assert fake_conn.committed is True
        assert fake_conn.rolled_back is False
        assert fake_conn.closed is True
        assert fake_conn.autocommit is False

    def test_excepcion_hace_rollback_cierra_y_relanza(self, monkeypatch):
        fake_conn = FakeConn()
        monkeypatch.setattr("db.monitor_common.psycopg2.connect", lambda url: fake_conn)

        def falla(cur):
            raise ValueError("boom")

        with pytest.raises(ValueError, match="boom"):
            ejecutar_con_conexion("postgres://fake", falla)

        assert fake_conn.committed is False
        assert fake_conn.rolled_back is True
        assert fake_conn.closed is True

    def test_pasa_el_cursor_factory(self, monkeypatch):
        fake_conn = FakeConn()
        monkeypatch.setattr("db.monitor_common.psycopg2.connect", lambda url: fake_conn)
        marcador = object()

        ejecutar_con_conexion("postgres://fake", lambda cur: None, cursor_factory=marcador)

        assert fake_conn.cursor_factory_usado is marcador
