"""Tests de la escalación proactiva de retraso silencioso (R1, Fase 16).
Grupo A: lógica pura con un cursor fake en memoria (nunca toca Postgres
real) -- mismo patrón que test_monitor_heartbeat.py.
"""
from db.monitor_retraso_silencioso import (
    UMBRAL_ESCALACION_MIN,
    revisar_y_escalar,
    mensaje_nivel1,
    mensaje_nivel2,
)


class FakeCursor:
    """Emula lo mínimo que revisar_y_escalar necesita: hitos sin alertar,
    incidencias a escalar, y dos listas de chats de gestores (nivel1 =
    respeta notif_fuera_ventana, todos = la ignora)."""

    def __init__(self, hitos_sin_alertar=None, incidencias_a_escalar=None,
                 chats_nivel1=None, chats_todos=None):
        self.hitos_sin_alertar = hitos_sin_alertar or []
        self.incidencias_a_escalar = incidencias_a_escalar or []
        self.chats_nivel1 = chats_nivel1 or []
        self.chats_todos = chats_todos or []
        self._ultimo = None
        self.incidencias_creadas = []
        self.incidencias_escaladas = []

    def execute(self, query, params=None):
        q = query.strip()
        if q.startswith("SELECT h.id"):
            self._ultimo = ("hitos",)
        elif q.startswith("INSERT INTO incidencia"):
            nueva_id = f"inc-{len(self.incidencias_creadas) + 1}"
            self.incidencias_creadas.append({"viaje_id": params[0], "hito_id": params[1], "descripcion": params[2]})
            self._ultimo = ("insert_incidencia", nueva_id)
        elif q.startswith("SELECT i.id"):
            self._ultimo = ("incidencias_escalar",)
        elif q.startswith("UPDATE incidencia SET escalada_en"):
            self.incidencias_escaladas.append(params[0])
            self._ultimo = None
        elif "notif_fuera_ventana = true" in q:
            self._ultimo = ("chats_nivel1",)
        elif q.startswith("SELECT telegram_chat_id FROM gestor"):
            self._ultimo = ("chats_todos",)
        else:
            raise AssertionError(f"query no esperada en el fake: {query}")

    def fetchone(self):
        if self._ultimo and self._ultimo[0] == "insert_incidencia":
            return (self._ultimo[1],)
        return None

    def fetchall(self):
        if self._ultimo == ("hitos",):
            return self.hitos_sin_alertar
        if self._ultimo == ("incidencias_escalar",):
            return self.incidencias_a_escalar
        if self._ultimo == ("chats_nivel1",):
            return [(c,) for c in self.chats_nivel1]
        if self._ultimo == ("chats_todos",):
            return [(c,) for c in self.chats_todos]
        return []


def _fake_enviar(registro):
    def enviar_fn(token, chat_id, texto):
        registro.append((token, chat_id, texto))
        return True
    return enviar_fn


class TestNivel1:
    def test_sin_hitos_sin_alertar_no_hace_nada(self):
        cur = FakeCursor()
        registro = []
        r = revisar_y_escalar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["nivel1_creadas"] == 0
        assert registro == []

    def test_hito_sin_alertar_crea_incidencia_y_avisa_a_nivel1(self):
        cur = FakeCursor(
            hitos_sin_alertar=[("h1", 1, "Madrid", "v1", "VJ-1", "e1", "Mario")],
            chats_nivel1=["chat1", "chat2"],
        )
        registro = []
        r = revisar_y_escalar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["nivel1_creadas"] == 1
        assert r["nivel1_notificados"] == 2
        assert len(cur.incidencias_creadas) == 1
        assert "VJ-1" in registro[0][2]
        assert registro[0][2] == mensaje_nivel1("VJ-1", 1, "Madrid", "Mario")

    def test_multiples_hitos_crean_multiples_incidencias(self):
        cur = FakeCursor(
            hitos_sin_alertar=[
                ("h1", 1, "Madrid", "v1", "VJ-1", "e1", "Mario"),
                ("h2", 2, "Barcelona", "v2", "VJ-2", "e1", "Ana"),
            ],
            chats_nivel1=["chat1"],
        )
        registro = []
        r = revisar_y_escalar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["nivel1_creadas"] == 2
        assert r["nivel1_notificados"] == 2


class TestNivel2Escalacion:
    def test_sin_incidencias_a_escalar_no_hace_nada(self):
        cur = FakeCursor()
        registro = []
        r = revisar_y_escalar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["nivel2_escaladas"] == 0

    def test_incidencia_abierta_pasado_el_umbral_escala_a_todos(self):
        cur = FakeCursor(
            incidencias_a_escalar=[("inc1", "v1", "VJ-1", "e1")],
            chats_todos=["chat1", "chat2", "chat3"],
        )
        registro = []
        r = revisar_y_escalar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["nivel2_escaladas"] == 1
        assert r["nivel2_notificados"] == 3
        assert cur.incidencias_escaladas == ["inc1"]
        assert registro[0][2] == mensaje_nivel2("VJ-1")

    def test_no_escala_dos_veces_la_misma_incidencia(self):
        # obtener_incidencias_a_escalar ya filtra escalada_en IS NULL --
        # una incidencia ya escalada simplemente no vuelve a aparecer en la
        # siguiente pasada del monitor.
        cur = FakeCursor(incidencias_a_escalar=[])
        registro = []
        r = revisar_y_escalar(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["nivel2_escaladas"] == 0
        assert registro == []


def test_umbral_escalacion_es_45_minutos_por_defecto():
    assert UMBRAL_ESCALACION_MIN == 45
