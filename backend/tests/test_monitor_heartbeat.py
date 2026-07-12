"""Tests de la alerta real de 'bot caído' (ítem 10.5). Grupo A: lógica pura
con un cursor fake en memoria (nunca toca Postgres real) — verifica el
anti-spam (una sola alerta por episodio de caída) y la recuperación.
"""
from db.monitor_heartbeat import (
    UMBRAL_HEARTBEAT_S,
    revisar_y_alertar,
    mensaje_caida,
    mensaje_recuperado,
)


class FakeCursor:
    """Emula lo mínimo que revisar_y_alertar necesita: SELECT del segundos
    (parametrizado desde fuera), alerta_bot_caido en memoria, y gestores."""

    def __init__(self, segundos_desde_ultimo, gestores_chat_ids, alerta_abierta_id=None):
        self.segundos = segundos_desde_ultimo
        self.gestores = gestores_chat_ids
        self.alerta_abierta_id = alerta_abierta_id
        self._ultimo_resultado = None
        self.alertas_abiertas_creadas = 0
        self.alertas_resueltas = []

    def execute(self, query, params=None):
        q = query.strip()
        if "EXTRACT(EPOCH" in q:
            self._ultimo_resultado = ("segundos",)
        elif q.startswith("SELECT id FROM alerta_bot_caido"):
            self._ultimo_resultado = ("alerta_abierta",)
        elif q.startswith("INSERT INTO alerta_bot_caido"):
            self.alerta_abierta_id = "nueva-alerta-id"
            self.alertas_abiertas_creadas += 1
            self._ultimo_resultado = ("insert",)
        elif q.startswith("UPDATE alerta_bot_caido"):
            self.alertas_resueltas.append(params[0])
            self._ultimo_resultado = None
        elif q.startswith("SELECT telegram_chat_id FROM gestor"):
            self._ultimo_resultado = ("gestores",)
        else:
            raise AssertionError(f"query no esperada en el fake: {query}")

    def fetchone(self):
        if self._ultimo_resultado == ("segundos",):
            return (self.segundos,)
        if self._ultimo_resultado == ("alerta_abierta",):
            return (self.alerta_abierta_id,) if self.alerta_abierta_id else None
        if self._ultimo_resultado == ("insert",):
            return (self.alerta_abierta_id,)
        return None

    def fetchall(self):
        if self._ultimo_resultado == ("gestores",):
            return [(c,) for c in self.gestores]
        return []


def _fake_enviar(registro):
    def enviar_fn(token, chat_id, texto):
        registro.append((token, chat_id, texto))
        return True
    return enviar_fn


class TestObtenerEstadoHeartbeat:
    def test_dentro_del_umbral_no_esta_caido(self):
        cur = FakeCursor(segundos_desde_ultimo=60, gestores_chat_ids=[])
        registro = []
        r = revisar_y_alertar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["caido"] is False
        assert r["accion"] == "ninguna"
        assert registro == []


class TestAlertaDeCaida:
    def test_caido_sin_alerta_abierta_notifica_y_abre_alerta(self):
        cur = FakeCursor(segundos_desde_ultimo=1000, gestores_chat_ids=["chat1", "chat2"], alerta_abierta_id=None)
        registro = []
        r = revisar_y_alertar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["caido"] is True
        assert r["accion"] == "alerta_enviada"
        assert r["notificados"] == 2
        assert len(registro) == 2
        assert cur.alertas_abiertas_creadas == 1
        # el mensaje enviado es el de caida, no el de recuperacion
        assert registro[0][2] == mensaje_caida(1000)

    def test_caido_con_alerta_ya_abierta_NO_vuelve_a_notificar(self):
        """El caso central del anti-spam: si ya hay una alerta abierta, un
        segundo tick del cron no debe volver a mandar Telegram."""
        cur = FakeCursor(segundos_desde_ultimo=1000, gestores_chat_ids=["chat1"], alerta_abierta_id="alerta-existente")
        registro = []
        r = revisar_y_alertar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["accion"] == "ninguna"
        assert registro == []
        assert cur.alertas_abiertas_creadas == 0

    def test_sin_ningun_latido_registrado_se_considera_caido(self):
        cur = FakeCursor(segundos_desde_ultimo=None, gestores_chat_ids=["chat1"], alerta_abierta_id=None)
        registro = []
        r = revisar_y_alertar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["caido"] is True
        assert r["accion"] == "alerta_enviada"


class TestRecuperacion:
    def test_recuperado_con_alerta_abierta_notifica_y_la_cierra(self):
        cur = FakeCursor(segundos_desde_ultimo=30, gestores_chat_ids=["chat1"], alerta_abierta_id="alerta-vieja")
        registro = []
        r = revisar_y_alertar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["caido"] is False
        assert r["accion"] == "recuperacion_enviada"
        assert r["notificados"] == 1
        assert cur.alertas_resueltas == ["alerta-vieja"]
        assert registro[0][2] == mensaje_recuperado()

    def test_activo_sin_alerta_abierta_no_hace_nada(self):
        cur = FakeCursor(segundos_desde_ultimo=30, gestores_chat_ids=["chat1"], alerta_abierta_id=None)
        registro = []
        r = revisar_y_alertar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["accion"] == "ninguna"
        assert registro == []


def test_umbral_por_defecto_es_300s_como_el_dashboard():
    assert UMBRAL_HEARTBEAT_S == 300
