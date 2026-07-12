"""Tests de la verificación de integridad programada (ítem 10.6). Grupo A:
lógica pura con cursor/cliente Supabase fakes — verifica el anti-spam
(una sola alerta por rotura concreta, nunca se resuelve sola) para cadena y
para POD, y que un run limpio no alerta nada.
"""
from unittest.mock import MagicMock

from db.monitor_integridad import revisar_integridad


class FakeCursorIntegridad:
    """Emula lo que registrar_alerta_si_es_nueva necesita: un INSERT ... ON
    CONFLICT DO NOTHING RETURNING id, con las roturas ya registradas
    pasadas desde fuera (simula alertas ya guardadas de una ejecución previa)."""

    def __init__(self, ya_alertadas=None, gestores_chat_ids=None):
        self.ya_alertadas = set(ya_alertadas or [])  # {(tipo, entidad_id)}
        self.gestores = gestores_chat_ids or []
        self._resultado = None

    def execute(self, query, params=None):
        q = query.strip()
        if q.startswith("INSERT INTO alerta_integridad"):
            tipo, entidad_id, _motivo = params
            clave = (tipo, entidad_id)
            if clave in self.ya_alertadas:
                self._resultado = None
            else:
                self.ya_alertadas.add(clave)
                self._resultado = ("nueva",)
        elif q.startswith("SELECT telegram_chat_id FROM gestor"):
            self._resultado = ("gestores",)
        else:
            raise AssertionError(f"query no esperada: {query}")

    def fetchone(self):
        return ("insertada",) if self._resultado == ("nueva",) else None

    def fetchall(self):
        return [(c,) for c in self.gestores] if self._resultado == ("gestores",) else []


def _fake_enviar(registro):
    def enviar_fn(token, chat_id, texto):
        registro.append((chat_id, texto))
        return True
    return enviar_fn


def _fake_supabase(pods):
    """pods: lista de dicts {id, foto_url, hash_sha256} que devuelve el
    SELECT; verificar_hash_pod se mockea aparte via monkeypatch de modulo."""
    sb = MagicMock()
    sb.table.return_value.select.return_value.execute.return_value.data = pods
    return sb


class TestCadenaIntegra:
    def test_cadena_ok_y_sin_pods_no_alerta_nada(self, monkeypatch):
        monkeypatch.setattr(
            "db.monitor_integridad.verificar_cadena",
            lambda cur: {"ok": True, "eventos_verificados": 5, "cadenas": 2, "rotura": None},
        )
        cur = FakeCursorIntegridad(gestores_chat_ids=["chat1"])
        sb = _fake_supabase([])
        registro = []
        r = revisar_integridad(cur, sb, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["cadena_ok"] is True
        assert r["alertas_nuevas"] == 0
        assert registro == []


class TestCadenaRota:
    def test_rotura_de_cadena_nueva_alerta_una_vez(self, monkeypatch):
        rotura = {"evento_id": "ev1", "viaje_id": "v1", "motivo": "hash_no_coincide"}
        monkeypatch.setattr(
            "db.monitor_integridad.verificar_cadena",
            lambda cur: {"ok": False, "eventos_verificados": 3, "cadenas": 1, "rotura": rotura},
        )
        cur = FakeCursorIntegridad(gestores_chat_ids=["chat1", "chat2"])
        sb = _fake_supabase([])
        registro = []
        r = revisar_integridad(cur, sb, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["cadena_ok"] is False
        assert r["alertas_nuevas"] == 1
        assert len(registro) == 2  # los 2 gestores

    def test_misma_rotura_ya_alertada_NO_vuelve_a_notificar(self, monkeypatch):
        """El caso central del anti-spam: una rotura de integridad NO se
        auto-resuelve (a diferencia del heartbeat), así que un segundo run
        con la MISMA rotura no debe re-notificar nunca."""
        rotura = {"evento_id": "ev1", "viaje_id": "v1", "motivo": "hash_no_coincide"}
        monkeypatch.setattr(
            "db.monitor_integridad.verificar_cadena",
            lambda cur: {"ok": False, "eventos_verificados": 3, "cadenas": 1, "rotura": rotura},
        )
        cur = FakeCursorIntegridad(ya_alertadas={("cadena", "ev1")}, gestores_chat_ids=["chat1"])
        sb = _fake_supabase([])
        registro = []
        r = revisar_integridad(cur, sb, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["alertas_nuevas"] == 0
        assert registro == []


class TestPod:
    def test_pod_roto_nuevo_alerta_una_vez(self, monkeypatch):
        monkeypatch.setattr(
            "db.monitor_integridad.verificar_cadena",
            lambda cur: {"ok": True, "eventos_verificados": 0, "cadenas": 0, "rotura": None},
        )
        monkeypatch.setattr(
            "db.monitor_integridad.verificar_hash_pod",
            lambda sb, pod: {"pod_id": pod["id"], "ok": False, "motivo": "hash_no_coincide"},
        )
        cur = FakeCursorIntegridad(gestores_chat_ids=["chat1"])
        sb = _fake_supabase([{"id": "p1", "foto_url": "x", "hash_sha256": "abc"}])
        registro = []
        r = revisar_integridad(cur, sb, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["pods_verificados"] == 1
        assert r["pods_rotos"] == 1
        assert r["alertas_nuevas"] == 1
        assert len(registro) == 1

    def test_pod_roto_ya_alertado_no_repite(self, monkeypatch):
        monkeypatch.setattr(
            "db.monitor_integridad.verificar_cadena",
            lambda cur: {"ok": True, "eventos_verificados": 0, "cadenas": 0, "rotura": None},
        )
        monkeypatch.setattr(
            "db.monitor_integridad.verificar_hash_pod",
            lambda sb, pod: {"pod_id": pod["id"], "ok": False, "motivo": "archivo_no_encontrado"},
        )
        cur = FakeCursorIntegridad(ya_alertadas={("pod", "p1")}, gestores_chat_ids=["chat1"])
        sb = _fake_supabase([{"id": "p1", "foto_url": "x", "hash_sha256": "abc"}])
        registro = []
        r = revisar_integridad(cur, sb, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["alertas_nuevas"] == 0
        assert registro == []

    def test_pods_sanos_no_alertan(self, monkeypatch):
        monkeypatch.setattr(
            "db.monitor_integridad.verificar_cadena",
            lambda cur: {"ok": True, "eventos_verificados": 0, "cadenas": 0, "rotura": None},
        )
        monkeypatch.setattr(
            "db.monitor_integridad.verificar_hash_pod",
            lambda sb, pod: {"pod_id": pod["id"], "ok": True, "motivo": None},
        )
        cur = FakeCursorIntegridad(gestores_chat_ids=["chat1"])
        sb = _fake_supabase([{"id": "p1", "foto_url": "x", "hash_sha256": "abc"}])
        registro = []
        r = revisar_integridad(cur, sb, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["pods_rotos"] == 0
        assert r["alertas_nuevas"] == 0
        assert registro == []
