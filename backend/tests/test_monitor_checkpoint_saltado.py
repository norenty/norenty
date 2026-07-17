"""Tests de la detección de checkpoint saltado (CHK.6, 2026-07-17).
Grupo A: lógica pura con un cursor fake en memoria (nunca toca Postgres
real) -- mismo patrón que test_monitor_retraso_silencioso.py.
"""
from db.monitor_checkpoint_saltado import (
    UMBRAL_GEO_LLEGADA_M,
    revisar_checkpoints,
    mensaje_checkpoint_saltado,
    haversine_km,
)

MADRID = (40.4168, -3.7038)
BARCELONA = (41.3851, 2.1734)


class FakeCursor:
    """(chat_id, rol, id, activo, notif_incidencias) por gestor -- mismo
    patrón que test_monitor_retraso_silencioso.py. `pings`: lista de (lat,
    lon) que representa TODO el histórico de ubicacion del chófer."""

    def __init__(self, checkpoints=None, pings=None, gestores=None):
        self.checkpoints = checkpoints or []
        self.pings = pings or []
        self.gestores = gestores or []
        self._ultimo = None
        self.eventos_creados = []
        self.incidencias_creadas = []

    def execute(self, query, params=None):
        q = query.strip()
        if q.startswith("SELECT h.id"):
            self._ultimo = ("checkpoints",)
        elif q.startswith("SELECT lat, lon FROM ubicacion"):
            self._ultimo = ("pings",)
        elif q.startswith("INSERT INTO ejecucion_evento"):
            self.eventos_creados.append({"viaje_id": params[0], "hito_id": params[1], "chofer_id": params[2]})
            self._ultimo = None
        elif q.startswith("INSERT INTO incidencia"):
            nueva_id = f"inc-{len(self.incidencias_creadas) + 1}"
            self.incidencias_creadas.append({"viaje_id": params[0], "hito_id": params[1], "descripcion": params[2]})
            self._ultimo = ("insert_incidencia", nueva_id)
        elif q.startswith("SELECT telegram_chat_id, rol, id FROM gestor"):
            self._ultimo = ("chats",)
        else:
            raise AssertionError(f"query no esperada en el fake: {query}")

    def fetchone(self):
        if self._ultimo and self._ultimo[0] == "insert_incidencia":
            return (self._ultimo[1],)
        return None

    def fetchall(self):
        if self._ultimo == ("checkpoints",):
            return self.checkpoints
        if self._ultimo == ("pings",):
            return self.pings
        if self._ultimo == ("chats",):
            return [(g[0], g[1], g[2]) for g in self.gestores if g[3] and g[4]]
        return []


def _fake_enviar(registro):
    def enviar_fn(token, chat_id, texto):
        registro.append((token, chat_id, texto))
        return True
    return enviar_fn


def _checkpoint(hito_id="h1", orden=1, direccion="Zaragoza", lat=None, lon=None, radio_m=None,
                 viaje_id="v1", referencia="VJ-1", empresa_id="e1", chofer_id="c1", gestor_id=None,
                 creado_en="2026-07-17T00:00:00Z"):
    lat = MADRID[0] if lat is None else lat
    lon = MADRID[1] if lon is None else lon
    return (hito_id, orden, direccion, lat, lon, radio_m, viaje_id, referencia, empresa_id, chofer_id, gestor_id, creado_en)


class TestSinPingCerca:
    def test_sin_ningun_ping_crea_incidencia_y_avisa(self):
        cur = FakeCursor(
            checkpoints=[_checkpoint()],
            pings=[],
            gestores=[("chat1", "gestor_operativo", "g1", True, True)],
        )
        registro = []
        r = revisar_checkpoints(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["incidencias_creadas"] == 1
        assert r["notificados"] == 1
        assert r["autocorregidos"] == 0
        assert len(cur.incidencias_creadas) == 1
        assert registro[0][2] == mensaje_checkpoint_saltado("VJ-1", "Zaragoza", 1)

    def test_pings_lejos_del_checkpoint_tambien_cuenta_como_saltado(self):
        cur = FakeCursor(
            checkpoints=[_checkpoint()],
            pings=[BARCELONA],  # lejísimos de Madrid
            gestores=[("chat1", "gestor_operativo", "g1", True, True)],
        )
        registro = []
        r = revisar_checkpoints(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["incidencias_creadas"] == 1
        assert r["autocorregidos"] == 0

    def test_gestor_sin_preferencia_de_incidencias_no_recibe_el_aviso(self):
        cur = FakeCursor(
            checkpoints=[_checkpoint()],
            pings=[],
            gestores=[("chat1", "gestor_operativo", "g1", True, False)],
        )
        registro = []
        r = revisar_checkpoints(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["incidencias_creadas"] == 1
        assert r["notificados"] == 0


class TestConPingCerca:
    def test_ping_dentro_del_radio_autocorrige_sin_avisar(self):
        cerca = (MADRID[0] + 0.0005, MADRID[1] + 0.0005)  # ~60m, dentro del default 300m
        cur = FakeCursor(
            checkpoints=[_checkpoint()],
            pings=[cerca],
            gestores=[("chat1", "gestor_operativo", "g1", True, True)],
        )
        registro = []
        r = revisar_checkpoints(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["autocorregidos"] == 1
        assert r["incidencias_creadas"] == 0
        assert registro == []
        assert cur.eventos_creados == [{"viaje_id": "v1", "hito_id": "h1", "chofer_id": "c1"}]

    def test_respeta_radio_m_propio_del_checkpoint_si_esta_configurado(self):
        # a 150m -- fuera de un radio_m=50 configurado a mano, aunque esté
        # dentro del default de 300m.
        a_150m = (MADRID[0] + 0.00135, MADRID[1])
        cur = FakeCursor(
            checkpoints=[_checkpoint(radio_m=50)],
            pings=[a_150m],
            gestores=[("chat1", "gestor_operativo", "g1", True, True)],
        )
        r = revisar_checkpoints(cur, "TOKEN", enviar_fn=_fake_enviar([]))
        assert r["autocorregidos"] == 0
        assert r["incidencias_creadas"] == 1


class TestFase15FiltroPorAsignacion:
    def test_gestor_no_asignado_no_recibe_el_aviso(self):
        cur = FakeCursor(
            checkpoints=[_checkpoint(gestor_id="g-asignado")],
            pings=[],
            gestores=[("chat-ajeno", "gestor_operativo", "g-otro", True, True)],
        )
        registro = []
        r = revisar_checkpoints(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["notificados"] == 0
        assert registro == []

    def test_gestor_asignado_si_recibe_el_aviso(self):
        cur = FakeCursor(
            checkpoints=[_checkpoint(gestor_id="g-asignado")],
            pings=[],
            gestores=[
                ("chat-asignado", "gestor_operativo", "g-asignado", True, True),
                ("chat-ajeno", "gestor_operativo", "g-otro", True, True),
            ],
        )
        registro = []
        r = revisar_checkpoints(cur, "TOKEN", enviar_fn=_fake_enviar(registro))
        assert r["notificados"] == 1
        assert registro[0][1] == "chat-asignado"


def test_sin_checkpoints_pendientes_no_hace_nada():
    cur = FakeCursor()
    r = revisar_checkpoints(cur, "TOKEN", enviar_fn=_fake_enviar([]))
    assert r == {"autocorregidos": 0, "incidencias_creadas": 0, "notificados": 0}


def test_haversine_km_distancia_conocida_madrid_barcelona():
    km = haversine_km(*MADRID, *BARCELONA)
    assert 490 < km < 510  # distancia real ~505km


def test_umbral_geo_llegada_m_default_es_300():
    assert UMBRAL_GEO_LLEGADA_M == 300
